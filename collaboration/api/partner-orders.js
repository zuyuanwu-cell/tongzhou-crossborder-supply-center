import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { partnerOrderProjectionSchema, partnerOrderReportSchema } from "../shared/contracts.js";
import { assertResourcePermission, assertWorkItemPermission } from "./access.js";
import { linkPartnerAiDraftToCommand } from "./partner-ai.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function assertEnabled() {
  if (!collaborationConfig.oemEnabled) fail("生产与采购协同尚未通过上线门禁。", 403, "feature_disabled");
}

function assertPartnerRole(auth) {
  if (!auth?.membership || !["organization_admin", "manager", "operator"].includes(auth.membership.role)) {
    fail("当前岗位无权提交订单协同反馈。", 403, "forbidden");
  }
}

function orderResource(itemType) {
  return itemType === "production_order"
    ? { ref: "production", view: "production.order.view" }
    : { ref: "procurement", view: "procurement.order.view" };
}

function assertOrganizationType(organization, itemType) {
  const allowed = itemType === "production_order"
    ? new Set(["production_factory"])
    : new Set(["material_supplier", "packaging_factory", "production_factory"]);
  if (!allowed.has(organization.organization_type)) fail("目标组织类型与订单协同类型不匹配。", 409, "organization_type_mismatch");
}

function iso(value) {
  return value ? new Date(value).toISOString() : "";
}

function reportFromRow(row) {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    lineId: row.line_id || "",
    commandId: row.command_id,
    reportType: row.report_type,
    stage: row.stage,
    progressPercent: row.progress_percent == null ? null : Number(row.progress_percent),
    result: row.result,
    quantity: row.quantity == null ? null : Number(row.quantity),
    expectedAt: iso(row.expected_at),
    severity: row.severity,
    title: row.title,
    note: row.note,
    details: row.details || {},
    submittedBy: row.submitted_by,
    createdAt: iso(row.created_at),
  };
}

export async function applyPartnerOrderProjection(input) {
  assertEnabled();
  const projection = partnerOrderProjectionSchema.parse(input);
  return withSystem(async (client) => {
    const seen = await client.query("SELECT status FROM integration_inbox WHERE source_event_id=$1", [projection.eventId]);
    if (seen.rows[0]?.status === "applied") return { ok: true, idempotentReplay: true };
    if (!seen.rows[0]) {
      await client.query("INSERT INTO integration_inbox(source_event_id,event_type,payload,status) VALUES ($1,'core.partner_order_projection',$2,'processing')", [projection.eventId, projection]);
    } else {
      await client.query("UPDATE integration_inbox SET status='processing',attempt_count=attempt_count+1,last_error=NULL WHERE source_event_id=$1", [projection.eventId]);
    }
    try {
      const organizationResult = await client.query("SELECT * FROM organizations WHERE code=$1 AND status='active'", [projection.organizationCode]);
      const organization = organizationResult.rows[0];
      if (!organization) fail("目标协作组织不存在或已停用。", 404, "organization_not_found");
      assertOrganizationType(organization, projection.itemType);
      const resource = orderResource(projection.itemType);
      await assertResourcePermission(client, organization.id, "organization", resource.ref, resource.view);

      const projectRef = projection.publicPayload.projectCode || projection.publicPayload.orderNo;
      const projectType = projection.orderType === "production" ? "oem" : "procurement";
      const projectResult = await client.query(
        `INSERT INTO collaboration_projects(organization_id,core_ref_type,core_ref_id,project_type,title,status,public_summary,version)
         VALUES ($1,'partner_order_project',$2,$3,$4,'active',$5,$6)
         ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO UPDATE SET
           title=CASE WHEN collaboration_projects.version<=excluded.version THEN excluded.title ELSE collaboration_projects.title END,
           public_summary=CASE WHEN collaboration_projects.version<=excluded.version THEN excluded.public_summary ELSE collaboration_projects.public_summary END,
           version=GREATEST(collaboration_projects.version,excluded.version)
         RETURNING id`,
        [organization.id, projectRef, projectType, `${projection.publicPayload.productName || projection.title} · ${projectRef}`, projection.publicPayload, projection.version],
      );
      const spaceType = projection.orderType === "production" ? "production" : "procurement";
      const spaceResult = await client.query(
        `INSERT INTO collaboration_spaces(organization_id,project_id,space_type,title,status,version)
         VALUES ($1,$2,$3,$4,'open',$5)
         ON CONFLICT(organization_id,project_id,space_type) DO UPDATE SET
           title=CASE WHEN collaboration_spaces.version<=excluded.version THEN excluded.title ELSE collaboration_spaces.title END,
           version=GREATEST(collaboration_spaces.version,excluded.version)
         RETURNING id`,
        [organization.id, projectResult.rows[0].id, spaceType, projection.title, projection.version],
      );
      const existing = await client.query("SELECT id,version FROM work_items WHERE organization_id=$1 AND core_ref_type=$2 AND core_ref_id=$3 FOR UPDATE", [organization.id, projection.coreRefType, projection.coreRefId]);
      if (existing.rows[0] && Number(existing.rows[0].version) > projection.version) {
        await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
        return { ok: true, ignoredStaleVersion: true, workItemId: existing.rows[0].id, version: Number(existing.rows[0].version) };
      }
      const itemResult = await client.query(
        `INSERT INTO work_items(organization_id,space_id,core_ref_type,core_ref_id,item_type,title,description,status,priority,public_payload,due_at,version,last_core_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
         ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO UPDATE SET
           space_id=excluded.space_id,item_type=excluded.item_type,title=excluded.title,description=excluded.description,
           status=excluded.status,priority=excluded.priority,public_payload=excluded.public_payload,due_at=excluded.due_at,
           version=excluded.version,last_core_synced_at=now()
         RETURNING *`,
        [organization.id, spaceResult.rows[0].id, projection.coreRefType, projection.coreRefId, projection.itemType, projection.title, projection.description, projection.status, projection.priority, projection.publicPayload, projection.dueAt || null, projection.version],
      );
      const item = itemResult.rows[0];
      await client.query("UPDATE partner_order_lines SET active=false WHERE organization_id=$1 AND work_item_id=$2", [organization.id, item.id]);
      for (const line of projection.lines) {
        await client.query(
          `INSERT INTO partner_order_lines(organization_id,work_item_id,line_ref,line_type,sku,product_name,specification,image_url,planned_quantity,unit,required_at,responsibility,unit_price,currency,active,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,'')::date,$12,$13,$14,true,'{}'::jsonb)
           ON CONFLICT(organization_id,work_item_id,line_ref) DO UPDATE SET
             line_type=excluded.line_type,sku=excluded.sku,product_name=excluded.product_name,specification=excluded.specification,
             image_url=excluded.image_url,planned_quantity=excluded.planned_quantity,unit=excluded.unit,required_at=excluded.required_at,
             responsibility=excluded.responsibility,unit_price=excluded.unit_price,currency=excluded.currency,active=true`,
          [organization.id, item.id, line.lineRef, line.lineType, line.sku, line.productName, line.specification, line.imageUrl || "", line.plannedQuantity, line.unit, line.requiredDate || "", line.responsibility, line.unitPrice ?? null, line.currency],
        );
      }
      if (projection.itemType === "production_order") {
        for (const milestone of projection.milestones) {
          await client.query(
            `INSERT INTO production_milestones(organization_id,space_id,work_item_id,milestone_type,title,planned_at,status,public_payload,version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT(organization_id,work_item_id,milestone_type) DO UPDATE SET
               title=excluded.title,planned_at=excluded.planned_at,status=excluded.status,
               completed_at=CASE WHEN excluded.status='completed' THEN COALESCE(production_milestones.completed_at,now()) ELSE NULL END,
               public_payload=excluded.public_payload,
               version=GREATEST(production_milestones.version,excluded.version)`,
            [organization.id, spaceResult.rows[0].id, item.id, milestone.milestoneType, milestone.title, milestone.plannedAt || null, milestone.status, milestone.publicPayload, projection.version],
          );
        }
      }
      await client.query(
        "INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_name,body,metadata) VALUES ($1,$2,'core.partner_order_projection','供应链中台',$3,$4)",
        [organization.id, item.id, projection.version === 1 ? "订单已发布到本组织工作台" : "订单内容已由中台更新", { sourceEventId: projection.eventId, version: projection.version, orderType: projection.orderType }],
      );
      await client.query(
        "INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status) VALUES ($1,$2,$3,$4,'in_app','sent')",
        [organization.id, item.id, projection.version === 1 ? "收到新的协同订单" : "协同订单已更新", projection.title],
      );
      await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
      return { ok: true, workItemId: item.id, version: Number(item.version), lineCount: projection.lines.length, idempotentReplay: false };
    } catch (error) {
      await client.query("UPDATE integration_inbox SET status='failed',last_error=$2 WHERE source_event_id=$1", [projection.eventId, String(error.message || error).slice(0, 2_000)]);
      throw error;
    }
  });
}

function reportPermission(itemType, reportType) {
  if (itemType === "production_order") return {
    production_progress: "production.progress.update",
    material_readiness: "production.material.update",
    exception: "production.exception.report",
    shipment: "production.shipment.submit",
  }[reportType] || "";
  if (itemType === "purchase_order") return {
    purchase_fulfillment: "procurement.fulfillment.update",
    exception: "procurement.exception.report",
    shipment: "procurement.fulfillment.update",
  }[reportType] || "";
  return "";
}

function reportColumns(input, line) {
  if (input.reportType === "production_progress") {
    const hasMilestones = Boolean(input.materialStatus || input.preproductionSampleStatus || input.productionStatus || input.expectedDeliveryDate);
    if (!hasMilestones) return {
      stage: input.stage,
      progressPercent: input.progressPercent,
      result: "reported",
      quantity: input.completedQuantity,
      expectedAt: input.expectedCompletionDate,
      title: "生产进度更新",
      note: input.note,
      details: { completedQuantity: input.completedQuantity },
    };
    const derivedStage = input.productionStatus === "completed" ? "ready_to_ship"
      : input.productionStatus === "started" ? (input.stage || "filling")
        : input.materialStatus === "ready" ? "planning" : "material_preparation";
    return {
      stage: derivedStage,
      progressPercent: input.progressPercent ?? null,
      result: "reported",
      quantity: input.completedQuantity,
      expectedAt: input.expectedDeliveryDate,
      title: "生产里程碑更新",
      note: input.note,
      details: {
        completedQuantity: input.completedQuantity,
        materialStatus: input.materialStatus,
        preproductionSampleStatus: input.preproductionSampleStatus,
        preproductionSampleDate: input.preproductionSampleDate,
        productionStatus: input.productionStatus,
        productionStartDate: input.productionStartDate,
        expectedDeliveryDate: input.expectedDeliveryDate,
        legacyExpectedCompletionDate: input.expectedCompletionDate,
      },
    };
  }
  if (input.reportType === "material_readiness") return {
    stage: input.readiness, progressPercent: null, result: input.testResult, quantity: input.arrivedQuantity,
    expectedAt: input.testedAt, title: `${line?.product_name || "物料"}到齐与测试`, note: input.note || input.exceptionDescription,
    details: { lineRef: line?.line_ref || "", lineType: line?.line_type || "", testResult: input.testResult, exceptionDescription: input.exceptionDescription, testedAt: input.testedAt },
  };
  if (input.reportType === "purchase_fulfillment") return {
    stage: input.stage, progressPercent: null, result: "reported", quantity: input.completedQuantity,
    expectedAt: input.expectedDeliveryDate, title: "采购履约进度", note: input.note,
    details: { completedQuantity: input.completedQuantity },
  };
  if (input.reportType === "exception") return {
    stage: input.category, progressPercent: null, result: "open", quantity: input.affectedQuantity,
    expectedAt: input.expectedResolutionDate, severity: input.severity, title: input.title, note: input.description,
    details: { category: input.category, affectedQuantity: input.affectedQuantity, expectedResolutionDate: input.expectedResolutionDate },
  };
  return {
    stage: "shipped", progressPercent: null, result: "submitted", quantity: input.shippedQuantity,
    expectedAt: input.shippedAt, title: "发货反馈", note: input.note,
    details: { carrier: input.carrier, trackingNo: input.trackingNo, shippedAt: input.shippedAt },
  };
}

export async function submitPartnerOrderReport(auth, workItemId, body, { idempotencyKey, expectedVersion, aiDraftId = "" }) {
  assertEnabled();
  assertPartnerRole(auth);
  const input = partnerOrderReportSchema.parse(body);
  const key = String(idempotencyKey || "");
  if (!key || key.length > 160) fail("请提供有效的 Idempotency-Key。", 400, "idempotency_key_required");
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version <= 0) fail("请提供有效的 If-Match 任务版本。", 428, "version_required");

  return withOrganization(auth.organization.id, async (client) => {
    const replay = await client.query("SELECT * FROM partner_commands WHERE organization_id=$1 AND idempotency_key=$2", [auth.organization.id, key]);
    if (replay.rows[0]) {
      if (replay.rows[0].work_item_id !== workItemId || replay.rows[0].command_type !== `order_${input.reportType}`) fail("Idempotency-Key 已用于其他操作。", 409, "idempotency_key_conflict");
      const report = await client.query("SELECT * FROM partner_order_reports WHERE organization_id=$1 AND command_id=$2", [auth.organization.id, replay.rows[0].id]);
      return { ok: true, idempotentReplay: true, commandId: replay.rows[0].id, report: report.rows[0] ? reportFromRow(report.rows[0]) : null };
    }
    const itemResult = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2 FOR UPDATE", [workItemId, auth.organization.id]);
    const item = itemResult.rows[0];
    if (!item || !["production_order", "purchase_order"].includes(item.item_type)) fail("协同订单不存在。", 404, "not_found");
    if (!["accepted", "in_progress", "pending_sync"].includes(item.status)) fail("请先接单，或等待当前状态恢复后再提交。", 409, "invalid_state");
    if (Number(item.version) !== version) fail("订单已更新，请刷新后重试。", 409, "version_conflict");
    const plannedQuantity = Number(item.public_payload?.quantity || 0);
    const reportedQuantity = input.reportType === "production_progress" ? Number(input.completedQuantity || 0) : input.reportType === "shipment" ? Number(input.shippedQuantity || 0) : 0;
    if (plannedQuantity > 0 && reportedQuantity > plannedQuantity) fail("反馈数量不能超过订单计划数量；超量请通过异常上报。", 400, "quantity_exceeded");
    const permission = reportPermission(item.item_type, input.reportType);
    if (!permission) fail("当前订单不支持此类反馈。", 403, "forbidden");
    await assertWorkItemPermission(client, auth.organization.id, item, permission);

    let line = null;
    if (input.reportType === "material_readiness") {
      const lineResult = await client.query(
        "SELECT * FROM partner_order_lines WHERE id=$1 AND work_item_id=$2 AND organization_id=$3 AND active=true",
        [input.lineId, workItemId, auth.organization.id],
      );
      line = lineResult.rows[0];
      if (!line || !["raw_material", "packaging"].includes(line.line_type)) fail("物料或包材行不存在。", 404, "line_not_found");
      if (Number(input.arrivedQuantity) > Number(line.planned_quantity)) fail("到齐数量不能超过订单计划数量；超量请通过异常上报。", 400, "quantity_exceeded");
    }
    const columns = reportColumns(input, line);
    const commandPayload = line ? { ...input, line: { lineRef: line.line_ref, lineType: line.line_type, sku: line.sku, productName: line.product_name } } : input;
    const commandResult = await client.query(
      `INSERT INTO partner_commands(organization_id,work_item_id,command_type,idempotency_key,expected_version,payload,risk_level,status,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'medium','pending_sync',$7) RETURNING *`,
      [auth.organization.id, workItemId, `order_${input.reportType}`, key, version, commandPayload, auth.user.id],
    );
    const command = commandResult.rows[0];
    if (aiDraftId) {
      if (!["production_progress", "purchase_fulfillment"].includes(input.reportType)) fail("AI 快捷汇报草稿不能用于该反馈类型。", 409, "ai_draft_action_mismatch");
      await linkPartnerAiDraftToCommand(client, {
        auth, workItemId, workItemVersion: version, draftId: aiDraftId, commandId: command.id, expectedDraftType: input.reportType,
        submittedPayload: input,
      });
    }
    const reportResult = await client.query(
      `INSERT INTO partner_order_reports(organization_id,work_item_id,line_id,command_id,report_type,stage,progress_percent,result,quantity,expected_at,severity,title,note,details,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,'')::date,$11,$12,$13,$14,$15) RETURNING *`,
      [auth.organization.id, workItemId, line?.id || null, command.id, input.reportType, columns.stage || "", columns.progressPercent ?? null, columns.result || "", columns.quantity ?? null, columns.expectedAt || "", columns.severity || "", columns.title || "", columns.note || "", columns.details || {}, auth.user.id],
    );
    const updated = await client.query("UPDATE work_items SET status='in_progress',version=version+1 WHERE id=$1 AND organization_id=$2 RETURNING version", [workItemId, auth.organization.id]);
    await client.query(
      "INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [auth.organization.id, workItemId, `partner.order.${input.reportType}`, auth.user.id, auth.user.displayName, columns.note || columns.title, { commandId: command.id, reportId: reportResult.rows[0].id, stage: columns.stage, result: columns.result, severity: columns.severity || "" }],
    );
    await client.query("INSERT INTO integration_outbox(event_type,aggregate_type,aggregate_id,payload) VALUES ('partner.command.created','partner_command',$1,$2)", [command.id, { commandId: command.id, organizationId: auth.organization.id, workItemId, action: command.command_type }]);
    await client.query(
      "INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata) VALUES ($1,$2,$3,$4,'work_item',$5,'accepted',$6)",
      [auth.organization.id, auth.user.id, auth.user.displayName, `partner_order.${input.reportType}`, workItemId, { commandId: command.id, reportId: reportResult.rows[0].id }],
    );
    return { ok: true, idempotentReplay: false, commandId: command.id, workItemVersion: Number(updated.rows[0].version), report: reportFromRow(reportResult.rows[0]) };
  });
}

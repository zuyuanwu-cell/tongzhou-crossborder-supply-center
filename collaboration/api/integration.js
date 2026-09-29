import { collaborationProjectionSchema, commandResultSchema, inventoryProjectionSchema } from "../shared/contracts.js";
import { withSystem } from "./db.js";
import { safeEqual } from "./security.js";
import { collaborationConfig } from "./config.js";
import { assertResourcePermission } from "./access.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

const warehouseItemTypes = new Set(["warehouse_inbound", "warehouse_outbound", "warehouse_transfer", "warehouse_stockup", "warehouse_exception"]);
const workItemStatuses = new Set(["pending", "accepted", "in_progress", "pending_approval", "pending_sync", "completed", "rejected", "cancelled"]);

function internalWorkItem(row) {
  return {
    id: row.id,
    organizationCode: row.organization_code,
    organizationName: row.organization_name,
    coreRefType: row.core_ref_type,
    coreRefId: row.core_ref_id,
    itemType: row.item_type,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    publicPayload: row.public_payload || {},
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : "",
    version: Number(row.version),
    lastCoreSyncedAt: row.last_core_synced_at ? new Date(row.last_core_synced_at).toISOString() : "",
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function assertInternalRequest(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(token, collaborationConfig.internalToken)) fail("内部集成凭证无效。", 401, "invalid_internal_token");
}

async function organizationByCode(client, code) {
  const result = await client.query("SELECT * FROM organizations WHERE code=$1 AND status='active'", [code]);
  if (!result.rows[0]) fail("目标协作组织不存在或已停用。", 404, "organization_not_found");
  return result.rows[0];
}

export async function applyCollaborationProjection(input) {
  const projection = collaborationProjectionSchema.parse(input);
  return withSystem(async (client) => {
    const seen = await client.query("SELECT status FROM integration_inbox WHERE source_event_id=$1", [projection.eventId]);
    if (seen.rows[0]?.status === "applied") return { ok: true, idempotentReplay: true };
    if (!seen.rows[0]) {
      await client.query("INSERT INTO integration_inbox(source_event_id,event_type,payload,status) VALUES ($1,'core.projection',$2,'processing')", [projection.eventId, projection]);
    } else {
      await client.query("UPDATE integration_inbox SET status='processing',attempt_count=attempt_count+1,last_error=NULL WHERE source_event_id=$1", [projection.eventId]);
    }
    try {
      const organization = await organizationByCode(client, projection.organizationCode);
      await assertResourcePermission(client, organization.id, "warehouse", projection.publicPayload.warehouseRef, "warehouse.task.view");
      const projectResult = await client.query(
        `INSERT INTO collaboration_projects(organization_id,core_ref_type,core_ref_id,project_type,title,status,public_summary,version)
         VALUES ($1,$2,$3,'warehouse',$4,'active',$5,$6)
         ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO UPDATE SET
           title=CASE WHEN collaboration_projects.version <= excluded.version THEN excluded.title ELSE collaboration_projects.title END,
           public_summary=CASE WHEN collaboration_projects.version <= excluded.version THEN excluded.public_summary ELSE collaboration_projects.public_summary END,
           version=GREATEST(collaboration_projects.version,excluded.version)
         RETURNING id,version`,
        [organization.id, projection.coreRefType, projection.coreRefId, projection.title, projection.publicPayload, projection.version],
      );
      const project = projectResult.rows[0];
      const spaceResult = await client.query(
        `INSERT INTO collaboration_spaces(organization_id,project_id,space_type,title,status,version)
         VALUES ($1,$2,'warehouse',$3,'open',$4)
         ON CONFLICT(organization_id,project_id,space_type) DO UPDATE SET
           title=CASE WHEN collaboration_spaces.version <= excluded.version THEN excluded.title ELSE collaboration_spaces.title END,
           version=GREATEST(collaboration_spaces.version,excluded.version)
         RETURNING id,version`,
        [organization.id, project.id, projection.publicPayload.warehouseName, projection.version],
      );
      const space = spaceResult.rows[0];
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
        [organization.id, space.id, projection.coreRefType, projection.coreRefId, projection.itemType, projection.title, projection.description, projection.status, projection.priority, projection.publicPayload, projection.dueAt || null, projection.version],
      );
      const item = itemResult.rows[0];
      await client.query("DELETE FROM warehouse_task_lines WHERE organization_id=$1 AND work_item_id=$2", [organization.id, item.id]);
      for (const line of projection.lines) {
        await client.query(
          `INSERT INTO warehouse_task_lines(organization_id,work_item_id,sku,product_name,image_url,planned_quantity,completed_quantity,unit,lot_no,barcode,production_date,expiry_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [organization.id, item.id, line.sku, line.productName, line.imageUrl || null, line.plannedQuantity, line.completedQuantity, line.unit, line.lotNo || null, line.barcode || null, line.productionDate || null, line.expiryDate || null],
        );
      }
      await client.query(
        `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_name,body,metadata)
         VALUES ($1,$2,'core.projection','供应链中台','任务已从内部中台发布或更新',$3)`,
        [organization.id, item.id, { sourceEventId: projection.eventId, version: projection.version }],
      );
      await client.query(
        `INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status)
         VALUES ($1,$2,$3,$4,'in_app','sent')`,
        [organization.id, item.id, projection.version === 1 ? "收到新的协同任务" : "协同任务已更新", projection.title],
      );
      await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
      return { ok: true, workItemId: item.id, version: Number(item.version), idempotentReplay: false };
    } catch (error) {
      await client.query("UPDATE integration_inbox SET status='failed',last_error=$2 WHERE source_event_id=$1", [projection.eventId, String(error.message || error).slice(0, 2_000)]);
      throw error;
    }
  });
}

export async function applyInventoryProjection(input) {
  const projection = inventoryProjectionSchema.parse(input);
  return withSystem(async (client) => {
    const seen = await client.query("SELECT status FROM integration_inbox WHERE source_event_id=$1", [projection.eventId]);
    if (seen.rows[0]?.status === "applied") return { ok: true, idempotentReplay: true };
    if (!seen.rows[0]) await client.query("INSERT INTO integration_inbox(source_event_id,event_type,payload,status) VALUES ($1,'core.inventory_projection',$2,'processing')", [projection.eventId, projection]);
    const organization = await organizationByCode(client, projection.organizationCode);
    await assertResourcePermission(client, organization.id, "warehouse", projection.warehouseRef, "warehouse.inventory.view");
    const projectedSkus = projection.items.map((item) => item.sku);
    const deleted = await client.query(
      `DELETE FROM warehouse_inventory_projections
        WHERE organization_id=$1 AND warehouse_ref=$2 AND version<=$3
          AND (cardinality($4::text[])=0 OR NOT (sku=ANY($4::text[])))`,
      [organization.id, projection.warehouseRef, projection.version, projectedSkus],
    );
    for (const item of projection.items) {
      await client.query(
        `INSERT INTO warehouse_inventory_projections(organization_id,warehouse_ref,warehouse_name,sku,product_name,image_url,available_quantity,locked_quantity,in_transit_quantity,unit,last_core_synced_at,version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(organization_id,warehouse_ref,sku) DO UPDATE SET
           warehouse_name=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.warehouse_name ELSE warehouse_inventory_projections.warehouse_name END,
           product_name=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.product_name ELSE warehouse_inventory_projections.product_name END,
           image_url=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.image_url ELSE warehouse_inventory_projections.image_url END,
           available_quantity=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.available_quantity ELSE warehouse_inventory_projections.available_quantity END,
           locked_quantity=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.locked_quantity ELSE warehouse_inventory_projections.locked_quantity END,
           in_transit_quantity=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.in_transit_quantity ELSE warehouse_inventory_projections.in_transit_quantity END,
           unit=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.unit ELSE warehouse_inventory_projections.unit END,
           last_core_synced_at=CASE WHEN warehouse_inventory_projections.version <= excluded.version THEN excluded.last_core_synced_at ELSE warehouse_inventory_projections.last_core_synced_at END,
           version=GREATEST(warehouse_inventory_projections.version,excluded.version)`,
        [organization.id, projection.warehouseRef, projection.warehouseName, item.sku, item.productName, item.imageUrl || "", item.availableQuantity, item.lockedQuantity, item.inTransitQuantity, item.unit, projection.syncedAt, projection.version],
      );
    }
    await client.query("UPDATE integration_inbox SET status='applied',processed_at=now() WHERE source_event_id=$1", [projection.eventId]);
    return { ok: true, itemCount: projection.items.length, deletedItemCount: deleted.rowCount };
  });
}

export async function listInternalWorkItems(filters = {}) {
  const limit = Math.max(1, Math.min(100, Number(filters.limit || 50)));
  const offset = Math.max(0, Number(filters.offset || 0));
  const status = workItemStatuses.has(String(filters.status || "")) ? String(filters.status) : "";
  const itemType = warehouseItemTypes.has(String(filters.itemType || "")) ? String(filters.itemType) : "";
  const organizationCode = String(filters.organizationCode || "").trim().slice(0, 64);
  const keyword = String(filters.keyword || "").trim().slice(0, 100);
  const warehouseRefs = Array.from(new Set(String(filters.warehouseRefs || "").split(",").map((value) => value.trim().slice(0, 120)).filter(Boolean))).slice(0, 500);
  const scopedSkus = Array.from(new Set(String(filters.skus || "").split(",").map((value) => value.replace(/\s+/g, "").toUpperCase().slice(0, 100)).filter(Boolean))).slice(0, 2_000);
  return withSystem(async (client) => {
    const baseConditions = ["w.item_type LIKE 'warehouse_%'"];
    const baseParams = [];
    if (organizationCode) { baseParams.push(organizationCode); baseConditions.push(`o.code=$${baseParams.length}`); }
    if (itemType) { baseParams.push(itemType); baseConditions.push(`w.item_type=$${baseParams.length}`); }
    if (warehouseRefs.length) { baseParams.push(warehouseRefs); baseConditions.push(`w.public_payload->>'warehouseRef'=ANY($${baseParams.length}::text[])`); }
    if (scopedSkus.length) {
      baseParams.push(scopedSkus);
      baseConditions.push(`EXISTS (SELECT 1 FROM warehouse_task_lines scoped_line WHERE scoped_line.work_item_id=w.id)
        AND NOT EXISTS (
          SELECT 1 FROM warehouse_task_lines scoped_line
           WHERE scoped_line.work_item_id=w.id
             AND NOT (upper(regexp_replace(scoped_line.sku,'\\s+','','g'))=ANY($${baseParams.length}::text[]))
        )`);
    }
    if (keyword) {
      baseParams.push(`%${keyword}%`);
      baseConditions.push(`(w.title ILIKE $${baseParams.length} OR w.core_ref_id ILIKE $${baseParams.length} OR w.public_payload->>'referenceNo' ILIKE $${baseParams.length} OR o.name ILIKE $${baseParams.length})`);
    }
    const listConditions = [...baseConditions];
    const listParams = [...baseParams];
    if (status) { listParams.push(status); listConditions.push(`w.status=$${listParams.length}`); }
    listParams.push(limit, offset);
    const select = `SELECT w.*,o.code AS organization_code,o.name AS organization_name
                      FROM work_items w JOIN organizations o ON o.id=w.organization_id`;
    const [rows, countRows, totalRows] = await Promise.all([
      client.query(
        `${select} WHERE ${listConditions.join(" AND ")}
         ORDER BY CASE w.priority WHEN 'urgent' THEN 0 ELSE 1 END,w.updated_at DESC,w.id
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      ),
      client.query(
        `SELECT w.status,count(*)::int AS count
           FROM work_items w JOIN organizations o ON o.id=w.organization_id
          WHERE ${baseConditions.join(" AND ")} GROUP BY w.status`,
        baseParams,
      ),
      client.query(
        `SELECT count(*)::int AS count FROM work_items w JOIN organizations o ON o.id=w.organization_id
          WHERE ${listConditions.join(" AND ")}`,
        listParams.slice(0, -2),
      ),
    ]);
    return {
      items: rows.rows.map(internalWorkItem),
      counts: Object.fromEntries(countRows.rows.map((row) => [row.status, Number(row.count)])),
      total: Number(totalRows.rows[0]?.count || 0),
      limit,
      offset,
    };
  });
}

export async function getInternalWorkItem(workItemId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(workItemId || ""))) fail("协同任务编号不正确。", 400, "invalid_work_item_id");
  return withSystem(async (client) => {
    const itemResult = await client.query(
      `SELECT w.*,o.code AS organization_code,o.name AS organization_name
         FROM work_items w JOIN organizations o ON o.id=w.organization_id
        WHERE w.id=$1 AND w.item_type LIKE 'warehouse_%'`,
      [workItemId],
    );
    const row = itemResult.rows[0];
    if (!row) fail("协同任务不存在。", 404, "not_found");
    const [lines, events, attachments, commands] = await Promise.all([
      client.query("SELECT id,sku,product_name,image_url,planned_quantity,completed_quantity,unit,lot_no,barcode,production_date,expiry_date FROM warehouse_task_lines WHERE work_item_id=$1 AND organization_id=$2 ORDER BY sku,id", [workItemId, row.organization_id]),
      client.query("SELECT id,event_type,actor_name,body,metadata,created_at FROM work_item_events WHERE work_item_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 200", [workItemId, row.organization_id]),
      client.query("SELECT id,file_name,mime_type,size_bytes,scan_status,created_at FROM attachments WHERE work_item_id=$1 AND organization_id=$2 ORDER BY created_at DESC", [workItemId, row.organization_id]),
      client.query("SELECT id,command_type,status,risk_level,submitted_at,processed_at,result_code,result_message,core_reference FROM partner_commands WHERE work_item_id=$1 AND organization_id=$2 ORDER BY submitted_at DESC LIMIT 100", [workItemId, row.organization_id]),
    ]);
    return {
      item: internalWorkItem(row),
      lines: lines.rows.map((line) => ({
        id: line.id,
        sku: line.sku,
        productName: line.product_name,
        imageUrl: line.image_url || "",
        plannedQuantity: Number(line.planned_quantity),
        completedQuantity: Number(line.completed_quantity),
        unit: line.unit,
        lotNo: line.lot_no || "",
        barcode: line.barcode || "",
        productionDate: line.production_date ? String(line.production_date).slice(0, 10) : "",
        expiryDate: line.expiry_date ? String(line.expiry_date).slice(0, 10) : "",
      })),
      events: events.rows.map((event) => ({ id: event.id, eventType: event.event_type, actorName: event.actor_name, body: event.body, metadata: event.metadata || {}, createdAt: new Date(event.created_at).toISOString() })),
      attachments: attachments.rows.map((attachment) => ({ id: attachment.id, fileName: attachment.file_name, mimeType: attachment.mime_type, sizeBytes: Number(attachment.size_bytes), scanStatus: attachment.scan_status, createdAt: new Date(attachment.created_at).toISOString() })),
      commands: commands.rows.map((command) => ({ id: command.id, commandType: command.command_type, status: command.status, riskLevel: command.risk_level, submittedAt: new Date(command.submitted_at).toISOString(), processedAt: command.processed_at ? new Date(command.processed_at).toISOString() : "", resultCode: command.result_code || "", resultMessage: command.result_message || "", coreReference: command.core_reference || "" })),
    };
  });
}

export async function listPendingCommands({ after = "", limit = 100, includeApprovals = false } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit || 100)));
  return withSystem(async (client) => {
    const [afterTime, afterId] = String(after || "").split("|");
    const safeAfterTime = Number.isNaN(Date.parse(afterTime || "")) ? "1970-01-01T00:00:00.000Z" : afterTime;
    const safeAfterId = /^[0-9a-f-]{36}$/i.test(afterId || "") ? afterId : "00000000-0000-0000-0000-000000000000";
    const params = [safeAfterTime, safeAfterId, safeLimit];
    const includePendingApprovals = includeApprovals === true || includeApprovals === "true" || includeApprovals === "1";
    const statuses = includePendingApprovals ? "('pending_sync','pending_approval')" : "('pending_sync')";
    const result = await client.query(
      `SELECT c.id,c.organization_id,o.code AS organization_code,c.work_item_id,w.core_ref_type,w.core_ref_id,w.item_type,w.public_payload,
              c.command_type,c.idempotency_key,c.expected_version,c.payload,c.risk_level,c.status,c.submitted_at,
              u.display_name AS submitted_by_name
         FROM partner_commands c
         JOIN organizations o ON o.id=c.organization_id
         JOIN work_items w ON w.id=c.work_item_id
         JOIN collaboration_users u ON u.id=c.submitted_by
        WHERE c.status IN ${statuses} AND (c.submitted_at,c.id) > ($1::timestamptz,$2::uuid)
        ORDER BY c.submitted_at,c.id LIMIT $3`,
      params,
    );
    return {
      commands: result.rows.map((row) => ({
        id: row.id, organizationId: row.organization_id, organizationCode: row.organization_code,
        workItemId: row.work_item_id, coreRefType: row.core_ref_type, coreRefId: row.core_ref_id, itemType: row.item_type, publicPayload: row.public_payload,
        commandType: row.command_type, idempotencyKey: row.idempotency_key, expectedVersion: Number(row.expected_version),
        payload: row.payload, riskLevel: row.risk_level, status: row.status, submittedByName: row.submitted_by_name,
        submittedAt: new Date(row.submitted_at).toISOString(),
      })),
      nextCursor: result.rows.at(-1)?.submitted_at ? `${new Date(result.rows.at(-1).submitted_at).toISOString()}|${result.rows.at(-1).id}` : after,
    };
  });
}

export async function reviewCommand(commandId, { approved, note = "", reviewer = "供应链中台" }) {
  return withSystem(async (client) => {
    const result = await client.query("SELECT * FROM partner_commands WHERE id=$1 FOR UPDATE", [commandId]);
    const command = result.rows[0];
    if (!command) fail("协同指令不存在。", 404, "not_found");
    if (command.status !== "pending_approval") fail("该指令不在待审批状态。", 409, "invalid_state");
    const status = approved ? "pending_sync" : "rejected";
    await client.query("UPDATE approvals SET status=$2,reviewed_by=$3,reviewed_at=now(),review_note=$4 WHERE command_id=$1", [commandId, approved ? "approved" : "rejected", reviewer, String(note).slice(0, 2_000)]);
    await client.query("UPDATE partner_commands SET status=$2,result_message=$3,processed_at=CASE WHEN $2='rejected' THEN now() ELSE NULL END WHERE id=$1", [commandId, status, approved ? "" : String(note).slice(0, 2_000)]);
    await client.query("UPDATE work_items SET status=$3,version=version+1 WHERE id=$1 AND organization_id=$2", [command.work_item_id, command.organization_id, approved ? "pending_sync" : "rejected"]);
    await client.query(
      `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_name,body,metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [command.organization_id, command.work_item_id, approved ? "core.approval.approved" : "core.approval.rejected", reviewer, note || (approved ? "内部审批已通过，等待写入主账。" : "内部审批未通过。"), { commandId }],
    );
    await client.query(
      `INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status)
       VALUES ($1,$2,$3,$4,'in_app','sent')`,
      [command.organization_id, command.work_item_id, approved ? "作业申请已通过审批" : "作业申请已被驳回", note || (approved ? "系统正在同步主账，请勿重复提交。" : "请打开工单查看处理结果。")],
    );
    return { ok: true, commandId, status };
  });
}

export async function completeCommand(commandId, input) {
  const resultPayload = commandResultSchema.parse(input);
  return withSystem(async (client) => {
    const commandResult = await client.query("SELECT c.*,w.core_ref_type FROM partner_commands c JOIN work_items w ON w.id=c.work_item_id WHERE c.id=$1 FOR UPDATE OF c", [commandId]);
    const command = commandResult.rows[0];
    if (!command) fail("协同指令不存在。", 404, "not_found");
    if (["applied", "rejected", "failed"].includes(command.status)) return { ok: true, idempotentReplay: true, status: command.status };
    const commandStatus = resultPayload.status;
    await client.query(
      `UPDATE partner_commands SET status=$2,result_code=$3,result_message=$4,core_reference=$5,processed_at=now() WHERE id=$1`,
      [commandId, commandStatus, resultPayload.resultCode || null, resultPayload.message || null, resultPayload.coreReference || null],
    );
    const itemStatus = commandStatus === "applied" ? (command.command_type === "complete" || command.core_ref_type === "partner_warehouse_operation" ? "completed" : "in_progress") : commandStatus;
    const versionExpression = resultPayload.workItemVersion ? "$4" : "version+1";
    const params = [command.work_item_id, command.organization_id, itemStatus];
    if (resultPayload.workItemVersion) params.push(resultPayload.workItemVersion);
    await client.query(`UPDATE work_items SET status=$3,version=${versionExpression},last_core_synced_at=now() WHERE id=$1 AND organization_id=$2`, params);
    await client.query(
      `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_name,body,metadata)
       VALUES ($1,$2,$3,'供应链中台',$4,$5)`,
      [command.organization_id, command.work_item_id, `core.command.${commandStatus}`, resultPayload.message || "中台已处理协同指令", { commandId, coreReference: resultPayload.coreReference }],
    );
    await client.query(
      `INSERT INTO notifications(organization_id,work_item_id,title,body,channel,delivery_status)
       VALUES ($1,$2,$3,$4,'in_app','sent')`,
      [command.organization_id, command.work_item_id, commandStatus === "applied" ? "操作已同步" : "操作处理结果", resultPayload.message || `状态：${commandStatus}`],
    );
    return { ok: true, commandId, status: commandStatus };
  });
}

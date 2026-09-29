import { randomUUID } from "node:crypto";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { canPerformAction } from "./permissions.js";
import { riskByAction, warehouseOperationSchema, workItemActionSchema } from "../shared/contracts.js";
import { actionPermission, assertResourcePermission, assertWorkItemPermission, workItemAccessPredicate } from "./access.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function pagination(input) {
  const limit = Math.max(1, Math.min(100, Number(input.limit || 30)));
  const offset = Math.max(0, Number(input.offset || 0));
  return { limit, offset };
}

function normalizedSku(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function operationReference(operationType, supplied = "") {
  if (String(supplied || "").trim()) return String(supplied).trim();
  const prefix = { inbound: "WRK-RK", outbound: "WRK-CK", stocktake: "WRK-PD" }[operationType] || "WRK";
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${prefix}-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function workItemFromRow(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
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

export async function listWorkItems(auth, filters = {}) {
  const { limit, offset } = pagination(filters);
  const allowedStatuses = new Set(["pending", "accepted", "in_progress", "pending_approval", "pending_sync", "completed", "rejected", "cancelled"]);
  const status = allowedStatuses.has(filters.status) ? filters.status : "";
  const keyword = String(filters.keyword || "").trim().slice(0, 100);
  return withOrganization(auth.organization.id, async (client) => {
    const conditions = ["organization_id=$1", workItemAccessPredicate];
    const params = [auth.organization.id];
    if (status) { params.push(status); conditions.push(`status=$${params.length}`); }
    if (keyword) { params.push(`%${keyword}%`); conditions.push(`(title ILIKE $${params.length} OR public_payload->>'referenceNo' ILIKE $${params.length})`); }
    params.push(limit, offset);
    const rows = await client.query(
      `SELECT * FROM work_items WHERE ${conditions.join(" AND ")}
       ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
                CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const counts = await client.query(
      `SELECT status,count(*)::int AS count FROM work_items WHERE organization_id=$1 AND ${workItemAccessPredicate} GROUP BY status`,
      [auth.organization.id],
    );
    return { items: rows.rows.map(workItemFromRow), counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])), limit, offset };
  });
}

export async function getWorkItem(auth, workItemId) {
  return withOrganization(auth.organization.id, async (client) => {
    const itemResult = await client.query(`SELECT * FROM work_items WHERE id=$1 AND organization_id=$2 AND ${workItemAccessPredicate}`, [workItemId, auth.organization.id]);
    const row = itemResult.rows[0];
    if (!row) fail("任务不存在。", 404, "not_found");
    const [lines, events, attachments, commands] = await Promise.all([
      client.query("SELECT id,sku,product_name,image_url,planned_quantity,completed_quantity,unit,lot_no,barcode,production_date,expiry_date FROM warehouse_task_lines WHERE work_item_id=$1 AND organization_id=$2 ORDER BY sku,id", [workItemId, auth.organization.id]),
      client.query("SELECT id,event_type,actor_name,body,metadata,created_at FROM work_item_events WHERE work_item_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 100", [workItemId, auth.organization.id]),
      client.query("SELECT id,file_name,mime_type,size_bytes,scan_status,created_at FROM attachments WHERE work_item_id=$1 AND organization_id=$2 ORDER BY created_at DESC", [workItemId, auth.organization.id]),
      client.query("SELECT id,command_type,status,submitted_at,processed_at,result_code,result_message,core_reference FROM partner_commands WHERE work_item_id=$1 AND organization_id=$2 ORDER BY submitted_at DESC LIMIT 50", [workItemId, auth.organization.id]),
    ]);
    const oem = collaborationConfig.oemEnabled && ["filing_task", "sampling_task", "packaging_quote", "production_order"].includes(row.item_type)
      ? await Promise.all([
        client.query("SELECT id,artifact_type,title,version,status,public_payload,created_at,updated_at FROM oem_artifacts WHERE space_id=$1 AND organization_id=$2 ORDER BY created_at DESC", [row.space_id, auth.organization.id]),
        client.query("SELECT id,currency,amount,minimum_order_quantity,lead_time_days,terms,status,version,submitted_at FROM supplier_quotes WHERE work_item_id=$1 AND organization_id=$2 ORDER BY version DESC", [workItemId, auth.organization.id]),
        client.query("SELECT id,milestone_type,title,planned_at,completed_at,status,public_payload,version,updated_at FROM production_milestones WHERE work_item_id=$1 AND organization_id=$2 ORDER BY planned_at NULLS LAST,created_at", [workItemId, auth.organization.id]),
      ])
      : null;
    return {
      item: workItemFromRow(row),
      lines: lines.rows.map((line) => ({
        id: line.id, sku: line.sku, productName: line.product_name, imageUrl: line.image_url || "",
        plannedQuantity: Number(line.planned_quantity), completedQuantity: Number(line.completed_quantity), unit: line.unit,
        lotNo: line.lot_no || "", barcode: line.barcode || "", productionDate: line.production_date || "", expiryDate: line.expiry_date || "",
      })),
      events: events.rows.map((event) => ({ ...event, eventType: event.event_type, actorName: event.actor_name, createdAt: new Date(event.created_at).toISOString(), event_type: undefined, actor_name: undefined, created_at: undefined })),
      attachments: attachments.rows.map((item) => ({ id: item.id, fileName: item.file_name, mimeType: item.mime_type, sizeBytes: Number(item.size_bytes), scanStatus: item.scan_status, createdAt: new Date(item.created_at).toISOString() })),
      commands: commands.rows.map((item) => ({ id: item.id, commandType: item.command_type, status: item.status, submittedAt: new Date(item.submitted_at).toISOString(), processedAt: item.processed_at ? new Date(item.processed_at).toISOString() : "", resultCode: item.result_code || "", resultMessage: item.result_message || "", coreReference: item.core_reference || "" })),
      oem: oem ? {
        artifacts: oem[0].rows.map((item) => ({ id: item.id, artifactType: item.artifact_type, title: item.title, version: item.version, status: item.status, publicPayload: item.public_payload, createdAt: new Date(item.created_at).toISOString(), updatedAt: new Date(item.updated_at).toISOString() })),
        quotes: oem[1].rows.map((item) => ({ id: item.id, currency: item.currency, amount: Number(item.amount), minimumOrderQuantity: Number(item.minimum_order_quantity), leadTimeDays: item.lead_time_days, terms: item.terms, status: item.status, version: item.version, submittedAt: new Date(item.submitted_at).toISOString() })),
        milestones: oem[2].rows.map((item) => ({ id: item.id, milestoneType: item.milestone_type, title: item.title, plannedAt: item.planned_at ? new Date(item.planned_at).toISOString() : "", completedAt: item.completed_at ? new Date(item.completed_at).toISOString() : "", status: item.status, publicPayload: item.public_payload, version: item.version, updatedAt: new Date(item.updated_at).toISOString() })),
      } : null,
    };
  });
}

function nextStatus(action, risk) {
  if (risk === "high") return "pending_approval";
  if (["inbound_confirm", "outbound_confirm", "transfer_receive", "complete"].includes(action)) return "pending_sync";
  if (action === "accept") return "accepted";
  return "in_progress";
}

export async function submitWorkItemAction(auth, workItemId, body, { idempotencyKey, expectedVersion }) {
  if (!idempotencyKey || idempotencyKey.length > 160) fail("请提供有效的 Idempotency-Key。", 400, "idempotency_key_required");
  const parsed = workItemActionSchema.safeParse(body);
  if (!parsed.success) fail(parsed.error.issues[0]?.message || "操作内容不正确。", 400, "invalid_action_payload");
  const action = parsed.data.action;
  if (!canPerformAction(auth.membership, action)) fail("当前岗位无权执行此操作。", 403, "forbidden");
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version <= 0) fail("请提供有效的 If-Match 任务版本。", 428, "version_required");

  return withOrganization(auth.organization.id, async (client) => {
    const existing = await client.query("SELECT * FROM partner_commands WHERE organization_id=$1 AND idempotency_key=$2", [auth.organization.id, idempotencyKey]);
    const itemResult = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2 FOR UPDATE", [workItemId, auth.organization.id]);
    const item = itemResult.rows[0];
    if (!item) fail("任务不存在。", 404, "not_found");
    const requiredPermission = actionPermission(item.item_type, action);
    if (!requiredPermission) fail("该任务不支持此操作。", 403, "forbidden");
    await assertWorkItemPermission(client, auth.organization.id, item, requiredPermission);
    if (existing.rows[0]) {
      if (existing.rows[0].work_item_id !== item.id || existing.rows[0].command_type !== action) fail("Idempotency-Key 已用于其他操作。", 409, "idempotency_key_conflict");
      return {
        command: {
          id: existing.rows[0].id,
          type: existing.rows[0].command_type,
          status: existing.rows[0].status,
          riskLevel: existing.rows[0].risk_level,
        },
        idempotentReplay: true,
      };
    }
    if (Number(item.version) !== version) fail("任务已被更新，请刷新后重试。", 409, "version_conflict");
    if (["completed", "cancelled", "rejected"].includes(item.status)) fail("当前任务状态不允许继续操作。", 409, "invalid_state");
    const allowedStates = {
      accept: ["pending"],
      progress: ["accepted", "in_progress"],
      report_exception: ["accepted", "in_progress"],
      inbound_confirm: ["accepted", "in_progress"],
      outbound_confirm: ["accepted", "in_progress"],
      transfer_receive: ["accepted", "in_progress"],
      inventory_adjustment: ["accepted", "in_progress"],
      complete: ["accepted", "in_progress"],
    }[action] || [];
    if (!allowedStates.includes(item.status)) fail("当前工单状态不能执行该操作，请刷新后重试。", 409, "invalid_state");
    if (!collaborationConfig.oemEnabled && ["filing_task", "sampling_task", "packaging_quote", "production_order"].includes(item.item_type)) fail("OEM 协同尚未通过上线门禁。", 403, "feature_disabled");

    let risk = riskByAction[action] || "high";
    if (["inbound_confirm", "outbound_confirm", "transfer_receive"].includes(action)) {
      const lineRows = await client.query("SELECT sku,planned_quantity FROM warehouse_task_lines WHERE work_item_id=$1 AND organization_id=$2", [workItemId, auth.organization.id]);
      const planned = new Map(lineRows.rows.map((line) => [normalizedSku(line.sku), Number(line.planned_quantity)]));
      const submitted = new Set();
      for (const line of parsed.data.lines) {
        const sku = normalizedSku(line.sku);
        if (submitted.has(sku)) fail("同一 SKU 不能重复提交。", 400, "duplicate_sku");
        submitted.add(sku);
        if (!planned.has(sku)) fail(`SKU ${sku} 不在当前工单中。`, 400, "unknown_task_sku");
        if (Number(line.quantity) > Number(planned.get(sku))) risk = "high";
      }
    }
    const status = risk === "high" ? "pending_approval" : "pending_sync";
    const commandResult = await client.query(
      `INSERT INTO partner_commands(organization_id,work_item_id,command_type,idempotency_key,expected_version,payload,risk_level,status,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [auth.organization.id, workItemId, action, idempotencyKey, version, parsed.data, risk, status, auth.user.id],
    );
    const command = commandResult.rows[0];
    if (risk === "high") await client.query("INSERT INTO approvals(organization_id,command_id) VALUES ($1,$2)", [auth.organization.id, command.id]);
    if (["inbound_confirm", "outbound_confirm", "transfer_receive"].includes(action)) {
      for (const line of parsed.data.lines) {
        await client.query(
          `UPDATE warehouse_task_lines SET completed_quantity=$4,lot_no=NULLIF($5,''),barcode=NULLIF($6,''),production_date=NULLIF($7,'')::date,expiry_date=NULLIF($8,'')::date
            WHERE work_item_id=$1 AND organization_id=$2 AND upper(regexp_replace(sku,'\\s','','g'))=$3`,
          [workItemId, auth.organization.id, normalizedSku(line.sku), line.quantity, line.lotNo || "", line.barcode || "", line.productionDate || "", line.expiryDate || ""],
        );
      }
    }
    const updated = await client.query(
      "UPDATE work_items SET status=$3,version=version+1 WHERE id=$1 AND organization_id=$2 RETURNING *",
      [workItemId, auth.organization.id, nextStatus(action, risk)],
    );
    await client.query(
      `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [auth.organization.id, workItemId, `partner.${action}`, auth.user.id, auth.user.displayName, parsed.data.note || parsed.data.reason || "", { commandId: command.id, risk }],
    );
    await client.query(
      `INSERT INTO integration_outbox(event_type,aggregate_type,aggregate_id,payload)
       VALUES ('partner.command.created','partner_command',$1,$2)`,
      [command.id, { commandId: command.id, organizationId: auth.organization.id, workItemId, action }],
    );
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,$4,'work_item',$5,'accepted',$6)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, `work_item.${action}`, workItemId, { commandId: command.id, risk }],
    );
    return { command: { id: command.id, type: action, status: command.status, riskLevel: risk }, item: workItemFromRow(updated.rows[0]), idempotentReplay: false };
  });
}

export async function createWarehouseOperation(auth, body, { idempotencyKey }) {
  if (!idempotencyKey || idempotencyKey.length > 160) fail("请提供有效的 Idempotency-Key。", 400, "idempotency_key_required");
  const parsed = warehouseOperationSchema.safeParse(body);
  if (!parsed.success) fail(parsed.error.issues[0]?.message || "仓库作业内容不正确。", 400, "invalid_operation_payload");
  if (auth.organization.type !== "warehouse") fail("只有仓库组织可以发起仓库作业。", 403, "forbidden");
  const input = parsed.data;
  const config = {
    inbound: { action: "inbound_confirm", itemType: "warehouse_inbound", title: "仓库自主入库", permission: "warehouse.inbound.confirm" },
    outbound: { action: "outbound_confirm", itemType: "warehouse_outbound", title: "仓库自主出库", permission: "warehouse.outbound.confirm" },
    stocktake: { action: "inventory_adjustment", itemType: "warehouse_exception", title: "库存盘点差异", permission: "warehouse.inventory.adjust.request" },
  }[input.operationType];
  if (!canPerformAction(auth.membership, config.action)) fail("当前岗位无权发起此作业。", 403, "forbidden");

  return withOrganization(auth.organization.id, async (client) => {
    const replay = await client.query("SELECT * FROM partner_commands WHERE organization_id=$1 AND idempotency_key=$2", [auth.organization.id, idempotencyKey]);
    if (replay.rows[0]) {
      const itemResult = await client.query("SELECT * FROM work_items WHERE id=$1 AND organization_id=$2", [replay.rows[0].work_item_id, auth.organization.id]);
      return { item: workItemFromRow(itemResult.rows[0]), command: { id: replay.rows[0].id, type: replay.rows[0].command_type, status: replay.rows[0].status, riskLevel: replay.rows[0].risk_level }, idempotentReplay: true };
    }
    await assertResourcePermission(client, auth.organization.id, "warehouse", input.warehouseRef, "warehouse.task.view");
    await assertResourcePermission(client, auth.organization.id, "warehouse", input.warehouseRef, config.permission);
    const grantResult = await client.query("SELECT resource_name FROM organization_access_grants WHERE organization_id=$1 AND resource_type='warehouse' AND resource_ref=$2", [auth.organization.id, input.warehouseRef]);
    const warehouseName = String(grantResult.rows[0]?.resource_name || input.warehouseRef);
    const normalizedLines = input.lines.map((line) => ({ ...line, sku: normalizedSku(line.sku) }));
    if (new Set(normalizedLines.map((line) => line.sku)).size !== normalizedLines.length) fail("同一 SKU 不能重复提交。", 400, "duplicate_sku");
    const skuValues = normalizedLines.map((line) => line.sku);
    const projectionResult = await client.query(
      `SELECT sku,product_name,image_url,available_quantity,locked_quantity,unit
         FROM warehouse_inventory_projections
        WHERE organization_id=$1 AND warehouse_ref=$2 AND upper(regexp_replace(sku,'\\s','','g'))=ANY($3::text[])`,
      [auth.organization.id, input.warehouseRef, skuValues],
    );
    const projected = new Map(projectionResult.rows.map((row) => [normalizedSku(row.sku), row]));
    if (input.operationType !== "inbound") {
      const missing = skuValues.filter((sku) => !projected.has(sku));
      if (missing.length) fail(`以下 SKU 不在本仓库存中：${missing.join("、")}`, 409, "inventory_projection_missing");
    }
    if (input.operationType === "outbound") {
      for (const line of normalizedLines) {
        const available = Number(projected.get(line.sku)?.available_quantity || 0);
        if (Number(line.quantity) > available) fail(`${line.sku} 可用库存不足，当前投影可用 ${available}。`, 409, "insufficient_projected_stock");
      }
    }

    const referenceNo = operationReference(input.operationType, input.referenceNo);
    const duplicateReference = await client.query("SELECT 1 FROM work_items WHERE organization_id=$1 AND core_ref_type='partner_warehouse_operation' AND core_ref_id=$2", [auth.organization.id, referenceNo]);
    if (duplicateReference.rows[0]) fail("该外部单号已经提交，请勿重复创建。", 409, "reference_no_exists");
    await client.query(
      `INSERT INTO collaboration_projects(organization_id,core_ref_type,core_ref_id,project_type,title,status,public_summary,version)
       VALUES ($1,'warehouse_self_service',$2,'warehouse',$3,'active',$4,1)
       ON CONFLICT(organization_id,core_ref_type,core_ref_id) DO NOTHING`,
      [auth.organization.id, input.warehouseRef, `${warehouseName}自主作业`, { warehouseRef: input.warehouseRef, warehouseName }],
    );
    const projectResult = await client.query("SELECT id FROM collaboration_projects WHERE organization_id=$1 AND core_ref_type='warehouse_self_service' AND core_ref_id=$2", [auth.organization.id, input.warehouseRef]);
    await client.query(
      `INSERT INTO collaboration_spaces(organization_id,project_id,space_type,title,status,version)
       VALUES ($1,$2,'warehouse',$3,'open',1)
       ON CONFLICT(organization_id,project_id,space_type) DO NOTHING`,
      [auth.organization.id, projectResult.rows[0].id, `${warehouseName}作业空间`],
    );
    const spaceResult = await client.query("SELECT id FROM collaboration_spaces WHERE organization_id=$1 AND project_id=$2 AND space_type='warehouse'", [auth.organization.id, projectResult.rows[0].id]);
    const itemResult = await client.query(
      `INSERT INTO work_items(organization_id,space_id,core_ref_type,core_ref_id,item_type,title,description,status,priority,public_payload,version)
       VALUES ($1,$2,'partner_warehouse_operation',$3,$4,$5,$6,'pending_approval','normal',$7,1) RETURNING *`,
      [auth.organization.id, spaceResult.rows[0].id, referenceNo, config.itemType, `${config.title} · ${referenceNo}`, input.note, { referenceNo, warehouseRef: input.warehouseRef, warehouseName, note: input.note, initiatedBy: "partner" }],
    );
    const item = itemResult.rows[0];
    const commandLines = [];
    for (const line of normalizedLines) {
      const snapshot = projected.get(line.sku);
      const productName = String(snapshot?.product_name || line.productName || line.sku).trim();
      const imageUrl = String(snapshot?.image_url || "");
      const unit = String(snapshot?.unit || line.unit || "件");
      const planned = input.operationType === "stocktake" ? Number(snapshot.available_quantity) + Number(snapshot.locked_quantity) : Number(line.quantity);
      const completed = input.operationType === "stocktake" ? Number(line.countedQuantity) : Number(line.quantity);
      await client.query(
        `INSERT INTO warehouse_task_lines(organization_id,work_item_id,sku,product_name,image_url,planned_quantity,completed_quantity,unit,lot_no,barcode,production_date,expiry_date,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULLIF($9,''),NULLIF($10,''),NULLIF($11,'')::date,NULLIF($12,'')::date,$13)`,
        [auth.organization.id, item.id, line.sku, productName, imageUrl, planned, completed, unit, line.lotNo || "", line.barcode || "", line.productionDate || "", line.expiryDate || "", input.operationType === "stocktake" ? { countedQuantity: completed, bookQuantity: planned } : {}],
      );
      if (input.operationType === "stocktake") {
        const delta = completed - planned;
        if (delta) commandLines.push({ sku: line.sku, quantity: Math.abs(delta), direction: delta > 0 ? "increase" : "decrease", lotNo: "", barcode: "", productionDate: "", expiryDate: "" });
      } else {
        commandLines.push({ sku: line.sku, quantity: Number(line.quantity), lotNo: line.lotNo || "", barcode: line.barcode || "", productionDate: line.productionDate || "", expiryDate: line.expiryDate || "" });
      }
    }
    if (!commandLines.length) fail("本次盘点与账面库存一致，无需提交调整申请。", 409, "no_inventory_difference");
    const payload = input.operationType === "stocktake"
      ? { action: config.action, lines: commandLines, reason: input.note }
      : { action: config.action, lines: commandLines, note: input.note };
    const commandResult = await client.query(
      `INSERT INTO partner_commands(organization_id,work_item_id,command_type,idempotency_key,expected_version,payload,risk_level,status,submitted_by)
       VALUES ($1,$2,$3,$4,1,$5,'high','pending_approval',$6) RETURNING *`,
      [auth.organization.id, item.id, config.action, idempotencyKey, payload, auth.user.id],
    );
    const command = commandResult.rows[0];
    await client.query("INSERT INTO approvals(organization_id,command_id) VALUES ($1,$2)", [auth.organization.id, command.id]);
    await client.query(
      `INSERT INTO work_item_events(organization_id,work_item_id,event_type,actor_user_id,actor_name,body,metadata)
       VALUES ($1,$2,'partner.operation_created',$3,$4,$5,$6)`,
      [auth.organization.id, item.id, auth.user.id, auth.user.displayName, input.note, { commandId: command.id, operationType: input.operationType, referenceNo }],
    );
    await client.query("INSERT INTO integration_outbox(event_type,aggregate_type,aggregate_id,payload) VALUES ('partner.command.created','partner_command',$1,$2)", [command.id, { commandId: command.id, organizationId: auth.organization.id, workItemId: item.id, action: config.action }]);
    await client.query(
      `INSERT INTO audit_log(organization_id,actor_user_id,actor_name,action,object_type,object_id,result,metadata)
       VALUES ($1,$2,$3,'warehouse.operation.create','work_item',$4,'pending_approval',$5)`,
      [auth.organization.id, auth.user.id, auth.user.displayName, item.id, { commandId: command.id, operationType: input.operationType, warehouseRef: input.warehouseRef, referenceNo }],
    );
    return { item: workItemFromRow(item), command: { id: command.id, type: config.action, status: command.status, riskLevel: "high" }, idempotentReplay: false };
  });
}

export async function listInventory(auth, filters = {}) {
  const { limit, offset } = pagination(filters);
  const keyword = String(filters.keyword || "").trim().slice(0, 100);
  return withOrganization(auth.organization.id, async (client) => {
    const params = [auth.organization.id];
    let keywordClause = "";
    if (keyword) { params.push(`%${keyword}%`); keywordClause = ` AND (sku ILIKE $2 OR product_name ILIKE $2)`; }
    params.push(limit, offset);
    const result = await client.query(
      `SELECT warehouse_ref,warehouse_name,sku,product_name,image_url,available_quantity,locked_quantity,in_transit_quantity,unit,last_core_synced_at,version
         FROM warehouse_inventory_projections
        WHERE organization_id=$1
          AND (available_quantity > 0 OR locked_quantity > 0 OR in_transit_quantity > 0)
          AND EXISTS (
            SELECT 1 FROM organization_access_grants access_grant
             WHERE access_grant.organization_id=warehouse_inventory_projections.organization_id
               AND access_grant.resource_type='warehouse'
               AND access_grant.resource_ref=warehouse_inventory_projections.warehouse_ref
               AND access_grant.permissions ? 'warehouse.inventory.view'
          )${keywordClause}
        ORDER BY product_name,sku LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      items: result.rows.map((row) => ({ warehouseRef: row.warehouse_ref, warehouseName: row.warehouse_name, sku: row.sku, productName: row.product_name, imageUrl: row.image_url || "", availableQuantity: Number(row.available_quantity), lockedQuantity: Number(row.locked_quantity), inTransitQuantity: Number(row.in_transit_quantity), unit: row.unit, lastCoreSyncedAt: new Date(row.last_core_synced_at).toISOString(), version: Number(row.version) })),
      limit,
      offset,
    };
  });
}

export async function listNotifications(auth, filters = {}) {
  const { limit, offset } = pagination(filters);
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `SELECT id,work_item_id,title,body,channel,delivery_status,read_at,created_at
         FROM notifications
        WHERE organization_id=$1 AND (user_id IS NULL OR user_id=$2)
          AND (work_item_id IS NULL OR EXISTS (
            SELECT 1 FROM work_items
             WHERE work_items.id=notifications.work_item_id AND ${workItemAccessPredicate}
          ))
        ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [auth.organization.id, auth.user.id, limit, offset],
    );
    return { items: result.rows.map((row) => ({ id: row.id, workItemId: row.work_item_id || "", title: row.title, body: row.body, channel: row.channel, deliveryStatus: row.delivery_status, readAt: row.read_at ? new Date(row.read_at).toISOString() : "", createdAt: new Date(row.created_at).toISOString() })), limit, offset };
  });
}

export async function markNotificationRead(auth, notificationId) {
  return withOrganization(auth.organization.id, async (client) => {
    const result = await client.query(
      `UPDATE notifications SET read_at=COALESCE(read_at,now()),delivery_status='read'
        WHERE id=$1 AND organization_id=$2 AND (user_id IS NULL OR user_id=$3)
          AND (work_item_id IS NULL OR EXISTS (
            SELECT 1 FROM work_items
             WHERE work_items.id=notifications.work_item_id AND ${workItemAccessPredicate}
          )) RETURNING id,read_at`,
      [notificationId, auth.organization.id, auth.user.id],
    );
    if (!result.rows[0]) fail("消息不存在。", 404, "not_found");
    return { id: result.rows[0].id, readAt: new Date(result.rows[0].read_at).toISOString() };
  });
}

export async function organizationDashboard(auth) {
  return withOrganization(auth.organization.id, async (client) => {
    const [work, unread, stock] = await Promise.all([
      client.query(`SELECT count(*) FILTER (WHERE status NOT IN ('completed','cancelled','rejected'))::int AS open,count(*) FILTER (WHERE priority='urgent' AND status NOT IN ('completed','cancelled','rejected'))::int AS urgent,count(*) FILTER (WHERE status IN ('pending_sync','pending_approval'))::int AS waiting FROM work_items WHERE organization_id=$1 AND ${workItemAccessPredicate}`, [auth.organization.id]),
      client.query(`SELECT count(*)::int AS count FROM notifications WHERE organization_id=$1 AND (user_id IS NULL OR user_id=$2) AND read_at IS NULL AND (work_item_id IS NULL OR EXISTS (SELECT 1 FROM work_items WHERE work_items.id=notifications.work_item_id AND ${workItemAccessPredicate}))`, [auth.organization.id, auth.user.id]),
      client.query("SELECT count(DISTINCT sku)::int AS sku_count,max(last_core_synced_at) AS synced_at FROM warehouse_inventory_projections WHERE organization_id=$1 AND EXISTS (SELECT 1 FROM organization_access_grants access_grant WHERE access_grant.organization_id=warehouse_inventory_projections.organization_id AND access_grant.resource_type='warehouse' AND access_grant.resource_ref=warehouse_inventory_projections.warehouse_ref AND access_grant.permissions ? 'warehouse.inventory.view')", [auth.organization.id]),
    ]);
    return { openTasks: work.rows[0].open, urgentTasks: work.rows[0].urgent, waitingTasks: work.rows[0].waiting, unreadNotifications: unread.rows[0].count, inventorySkuCount: stock.rows[0].sku_count, inventorySyncedAt: stock.rows[0].synced_at ? new Date(stock.rows[0].synced_at).toISOString() : "" };
  });
}

export function validationError(error) {
  if (error instanceof z.ZodError) return fail(error.issues[0]?.message || "请求内容不正确。", 400, "validation_failed");
  throw error;
}

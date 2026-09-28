import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withOrganization, withSystem } from "./db.js";
import { canPerformAction } from "./permissions.js";
import { riskByAction, workItemActionSchema } from "../shared/contracts.js";
import { actionPermission, assertWorkItemPermission, workItemAccessPredicate } from "./access.js";

function fail(message, statusCode = 400, code = "invalid_request") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function pagination(input) {
  const limit = Math.max(1, Math.min(100, Number(input.limit || 30)));
  const offset = Math.max(0, Number(input.offset || 0));
  return { limit, offset };
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
    if (!collaborationConfig.oemEnabled && ["filing_task", "sampling_task", "packaging_quote", "production_order"].includes(item.item_type)) fail("OEM 协同尚未通过上线门禁。", 403, "feature_disabled");

    const risk = riskByAction[action] || "high";
    const status = risk === "high" ? "pending_approval" : "pending_sync";
    const commandResult = await client.query(
      `INSERT INTO partner_commands(organization_id,work_item_id,command_type,idempotency_key,expected_version,payload,risk_level,status,submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [auth.organization.id, workItemId, action, idempotencyKey, version, parsed.data, risk, status, auth.user.id],
    );
    const command = commandResult.rows[0];
    if (risk === "high") await client.query("INSERT INTO approvals(organization_id,command_id) VALUES ($1,$2)", [auth.organization.id, command.id]);
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

export async function listInventory(auth, filters = {}) {
  const { limit, offset } = pagination(filters);
  const keyword = String(filters.keyword || "").trim().slice(0, 100);
  return withOrganization(auth.organization.id, async (client) => {
    const params = [auth.organization.id];
    let keywordClause = "";
    if (keyword) { params.push(`%${keyword}%`); keywordClause = ` AND (sku ILIKE $2 OR product_name ILIKE $2)`; }
    params.push(limit, offset);
    const result = await client.query(
      `SELECT warehouse_ref,warehouse_name,sku,product_name,available_quantity,locked_quantity,in_transit_quantity,unit,last_core_synced_at,version
         FROM warehouse_inventory_projections
        WHERE organization_id=$1
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
      items: result.rows.map((row) => ({ warehouseRef: row.warehouse_ref, warehouseName: row.warehouse_name, sku: row.sku, productName: row.product_name, availableQuantity: Number(row.available_quantity), lockedQuantity: Number(row.locked_quantity), inTransitQuantity: Number(row.in_transit_quantity), unit: row.unit, lastCoreSyncedAt: new Date(row.last_core_synced_at).toISOString(), version: Number(row.version) })),
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

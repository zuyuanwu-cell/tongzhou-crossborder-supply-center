import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetch } from "undici";
import { createSessionToken } from "../server/user-auth.js";

function loadEnv(path) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(resolve(process.cwd(), ".env"));

const baseUrl = String(process.env.STOCKUP_AUDIT_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const cacheDir = resolve(process.env.CACHE_DIR || resolve(process.cwd(), ".cache"));
const users = JSON.parse(readFileSync(resolve(cacheDir, "users.json"), "utf8"));
const admin = (users.users || []).find((user) => user.status !== "disabled" && user.role === "admin");
if (!admin) throw new Error("No active administrator account is available for the read-only production audit.");
const secret = String(process.env.AUTH_SESSION_SECRET || "");
if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured.");
const token = createSessionToken(admin, secret, 10 * 60_000, users.roles || []);

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${payload.message || "request failed"}`);
  return payload;
}

const [health, bridge, organizations, options, requestResult, purchaseResult, workOrderResult, dashboard, remoteTaskResult, approvals] = await Promise.all([
  get("/api/health"),
  get("/api/collaboration-bridge/status"),
  get("/api/collaboration-bridge/organizations?status=active"),
  get("/api/collaboration-bridge/warehouse-tasks/options"),
  get("/api/stockup/collaboration/requests?page=1&pageSize=100"),
  get("/api/stockup/collaboration/purchase-orders?limit=1000"),
  get("/api/stockup/collaboration/warehouse-work-orders?limit=1000"),
  get("/api/stockup/collaboration/warehouse-work-orders/dashboard"),
  get("/api/collaboration-bridge/warehouse-tasks?limit=1000"),
  get("/api/collaboration-bridge/approvals"),
]);

const requests = requestResult.items || [];
const purchaseOrders = purchaseResult.purchaseOrders || [];
const workOrders = workOrderResult.workOrders || [];
const remoteTasks = remoteTaskResult.items || remoteTaskResult.workItems || [];
const workOrderById = new Map(workOrders.map((item) => [String(item.id), item]));
const remoteByCoreRef = new Map(remoteTasks.map((item) => [String(item.coreRefId || item.core_ref_id || ""), item]));

const fullyRegisteredWithoutWarehouse = purchaseOrders.flatMap((order) => {
  const requestIds = [...new Set((order.lines || []).map((line) => String(line.requestId || "")).filter(Boolean))];
  const complete = (order.lines || []).length > 0 && order.lines.every((line) => Number(line.receivedQty || 0) + Number(line.cancelledQty || 0) >= Number(line.quantity || 0));
  if (!complete) return [];
  return requestIds.filter((requestId) => {
    const request = requests.find((item) => String(item.id) === requestId);
    return request && (request.lines || []).some((line) => Number(line.purchaseReceivedQty || 0) > 0 && Number(line.warehouseExpectedQty || 0) <= 0);
  }).map((requestId) => ({ purchaseNo: order.purchaseNo, requestNo: requests.find((item) => String(item.id) === requestId)?.requestNo || requestId }));
});

const warehouseHandoffDiagnostics = requests
  .filter((request) => (request.lines || []).some((line) => Number(line.purchaseReceivedQty || 0) > Number(line.warehouseExpectedQty || 0)))
  .map((request) => ({
    requestNo: request.requestNo,
    requestId: request.id,
    lines: (request.lines || []).map((line) => ({
      requestLineId: line.id,
      sku: line.sku,
      status: line.status,
      requestedQty: Number(line.requestedQty || 0),
      purchaseReceivedQty: Number(line.purchaseReceivedQty || 0),
      warehouseExpectedQty: Number(line.warehouseExpectedQty || 0),
      purchaseLines: purchaseOrders.flatMap((order) => (order.lines || [])
        .filter((purchaseLine) => String(purchaseLine.requestLineId || "") === String(line.id))
        .map((purchaseLine) => ({
          purchaseNo: order.purchaseNo,
          purchaseOrderLineId: purchaseLine.id,
          quantity: Number(purchaseLine.quantity || 0),
          receivedQty: Number(purchaseLine.receivedQty || 0),
          cancelledQty: Number(purchaseLine.cancelledQty || 0),
          status: purchaseLine.status,
        }))),
    })),
  }));

const publishedMissingRemote = workOrders
  .filter((item) => item.publishedAt || item.collaborationEventId)
  .filter((item) => !remoteByCoreRef.has(String(item.id)))
  .map((item) => item.workOrderNo);

const remoteMissingCore = remoteTasks
  .filter((item) => String(item.coreRefType || item.core_ref_type || "") === "stockup_warehouse_work_order")
  .filter((item) => !workOrderById.has(String(item.coreRefId || item.core_ref_id || "")))
  .map((item) => item.referenceNo || item.title || item.id);

const countBy = (items, key) => items.reduce((result, item) => {
  const value = String(item[key] || "unknown");
  result[value] = (result[value] || 0) + 1;
  return result;
}, {});

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  health: { ok: health.ok, schedulerTasks: health.scheduler?.tasks?.length || 0, schedulerFailed: (health.scheduler?.tasks || []).filter((task) => task.status === "failed").length },
  bridge: { enabled: bridge.enabled, running: bridge.running, lastError: bridge.lastError || "", pendingOutbox: bridge.pending_outbox ?? bridge.pendingOutbox ?? null, pendingCommands: bridge.pending_commands ?? bridge.pendingCommands ?? null },
  organizations: { active: (organizations.organizations || []).length, warehouseOrganizations: (options.organizations || []).length, authorizedWarehouses: (options.organizations || []).reduce((sum, item) => sum + (item.warehouses || []).length, 0) },
  requests: { total: requests.length, v2: requests.filter((item) => Number(item.workflowVersion || 1) === 2).length, byStatus: countBy(requests, "status") },
  purchaseOrders: { total: purchaseOrders.length, byStatus: countBy(purchaseOrders, "status"), fullyRegisteredWithoutWarehouse, warehouseHandoffDiagnostics },
  warehouseWorkOrders: {
    total: workOrders.length,
    byStatus: countBy(workOrders, "status"),
    items: workOrders.map((item) => ({
      id: item.id,
      workOrderNo: item.workOrderNo,
      requestNo: item.requestNo,
      organizationCode: item.organizationCode,
      domesticWarehouseId: item.domesticWarehouseId,
      domesticWarehouseName: item.domesticWarehouseName,
      expectedArrivalAt: item.expectedArrivalAt,
      status: item.status,
      publishedAt: item.publishedAt,
      version: item.version,
      lineCount: (item.lines || []).length,
      expectedQty: item.expectedQty,
      receivedQty: item.receivedQty,
      goodQty: item.goodQty,
    })),
    dashboard: { counts: dashboard.counts || {}, totals: dashboard.totals || {} },
    publishedMissingRemote,
  },
  remoteTasks: {
    total: remoteTasks.length,
    byStatus: countBy(remoteTasks, "status"),
    items: remoteTasks.map((item) => ({ id: item.id, referenceNo: item.referenceNo, title: item.title, status: item.status, coreRefType: item.coreRefType || item.core_ref_type, coreRefId: item.coreRefId || item.core_ref_id, organizationCode: item.organizationCode || item.organization_code })),
    remoteMissingCore,
  },
  approvals: { pending: (approvals.approvals || []).length },
}, null, 2));

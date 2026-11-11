import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fetch as undiciFetch } from "undici";

if (!globalThis.fetch) globalThis.fetch = undiciFetch;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndexPath = resolve(repoRoot, "dist", "index.html");
const port = String(22000 + Math.floor(Math.random() * 10000));
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "smoke-internal-code";
const timeoutMs = 60000;
const smokeCacheDir = mkdtempSync(join(tmpdir(), "tongzhou-smoke-"));
const smokeBackupDir = mkdtempSync(join(tmpdir(), "tongzhou-smoke-backup-"));
const movementHistoryDbPath = resolve(smokeCacheDir, "movement-history.sqlite");
const webhookPayloads = [];
const webhookServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk.toString(); });
  req.on("end", () => {
    try { webhookPayloads.push(JSON.parse(body || "{}")); } catch { webhookPayloads.push({ raw: body }); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
  });
});
await new Promise((resolveListen) => webhookServer.listen(0, "127.0.0.1", resolveListen));
const webhookPort = webhookServer.address().port;

writeFileSync(resolve(smokeCacheDir, "orders-sync.json"), JSON.stringify({
  syncedAt: "2026-08-28T00:00:00.000Z",
  results: [{ warehouseId: "id-warehouse", ok: true, orderApiComplete: true, orderApiTotal: 1, orderApiReadRows: 1 }],
  orders: [{
    providerId: "sea_wms",
    warehouseId: "id-warehouse",
    warehouseName: "印尼仓",
    country: "印度尼西亚",
    orderId: "ORDER-1",
    orderNo: "ORDER-1",
    lineId: "LINE-1",
    shippedAt: "2026-08-28 10:00:00",
    platform: "tiktok",
    shopName: "Beauty Store",
    projectGroup: "旧项目",
    sku: "TZKJ-SJJ001",
    productName: "测试产品",
    quantity: 2,
    salesAmount: 10000,
    currency: "IDR",
    salesAmountScope: "order_allocated",
    salesAmountSource: "order.orderAmount",
    salesAmountOrderTotal: 10000,
    salesAmountAllocationResidual: 0,
    salesAmountValid: true,
  }],
}), "utf8");
writeFileSync(resolve(smokeCacheDir, "miaoshou-shops.json"), JSON.stringify({
  syncedAt: "2026-08-28T00:05:00.000Z",
  shops: [{ shopId: "MS-ID-1", platform: "tiktok", site: "ID", platformShopName: "Beauty Store", shopNick: "印尼测试别称" }],
}), "utf8");

if (!existsSync(distIndexPath)) {
  console.error("dist/index.html is missing. Run `npm run build` before `npm run smoke:api`.");
  process.exit(1);
}

const child = spawn(process.execPath, ["server/server.js"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    API_PORT: port,
    NODE_ENV: "development",
    INTERNAL_ACCESS_CODE: accessCode,
    AUTH_SESSION_SECRET: "smoke-session-secret",
    AUTO_SYNC_INTERVAL_MS: "0",
    PERFORMANCE_FX_AUTO_SYNC: "false",
    ORDER_SYNC_TIMEOUT_MS: "1000",
    WAREHOUSE_TEST_TIMEOUT_MS: "2000",
    WMS_REQUEST_TIMEOUT_MS: "2000",
    MOVEMENT_HISTORY_DB_PATH: movementHistoryDbPath,
    STOCKUP_COLLABORATION_DB_PATH: resolve(smokeCacheDir, "stockup-collaboration.sqlite"),
    DOMESTIC_INVENTORY_DB_PATH: resolve(smokeCacheDir, "domestic-inventory.sqlite"),
    CACHE_DIR: smokeCacheDir,
    SYSTEM_BACKUP_DIR: smokeBackupDir,
    SYSTEM_BACKUP_ENV_PATH: resolve(smokeBackupDir, "target.env"),
    SKIP_ENV_FILE: "true",
    SHOP_METRICS_INGEST_TOKEN: "smoke-shop-metrics-ingest-token-0123456789",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let childOutput = "";
child.stdout.on("data", (chunk) => {
  childOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  childOutput += chunk.toString();
});

const timer = setTimeout(() => {
  child.kill();
  console.error(`Smoke test timed out after ${timeoutMs}ms.`);
  if (childOutput.trim()) console.error(childOutput.trim());
  process.exit(1);
}, timeoutMs);

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited early with code ${child.exitCode}.\n${childOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("API server did not become healthy in time.");
}

async function expectJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function expectRejectedJson(path, options = {}, expectedStatus = 400) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  if (response.status !== expectedStatus || data.ok !== false) {
    throw new Error(`${path} should have been rejected with ${expectedStatus}: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function expectHtmlRoot() {
  const response = await fetch(`${baseUrl}/`);
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) {
    throw new Error(`/ returned ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!contentType.includes("text/html") || !text.includes('id="root"')) {
    throw new Error("/ did not return the built frontend HTML.");
  }
}

async function waitForSystemBackupJob(id, headers, acceptedStatuses, waitMs = 15000) {
  const accepted = new Set(acceptedStatuses);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const response = await expectJson(`/api/system-backup/jobs/${id}`, { headers });
    if (accepted.has(response.job?.status)) return response.job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`System backup job ${id} timed out.`);
}

function containsObjectKey(value, targetKey) {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, targetKey)) return true;
  return Object.values(value).some((child) => containsObjectKey(child, targetKey));
}

async function main() {
  await waitForHealth();
  console.log("[ok] API health");

  const setup = await expectJson("/api/setup");
  if (typeof setup.setupRequired !== "boolean") {
    throw new Error("/api/setup did not return setupRequired boolean.");
  }
  console.log("[ok] Setup status");

  const adminUsername = "smoke-admin";
  const adminPassword = "smoke-admin-password";
  if (setup.setupRequired) {
    await expectJson("/api/setup/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: adminUsername, password: adminPassword, displayName: "Smoke Admin" }),
    });
  }

  await expectHtmlRoot();
  console.log("[ok] Root frontend fallback");

  const login = await expectJson("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  if (login.user?.role !== "admin" || !login.token) {
    throw new Error(`/api/login did not return an admin user token: ${JSON.stringify(login).slice(0, 500)}`);
  }
  console.log("[ok] Admin login");

  const authHeaders = { Authorization: `Bearer ${login.token}` };
  const me = await expectJson("/api/me", { headers: authHeaders });
  if (me.user?.role !== "admin") {
    throw new Error(`/api/me did not preserve admin role: ${JSON.stringify(me).slice(0, 500)}`);
  }
  console.log("[ok] /api/me admin session");

  const anonymousBackupStatus = await fetch(`${baseUrl}/api/system-backup/status`);
  if (anonymousBackupStatus.status !== 401) throw new Error(`Anonymous system backup status was not blocked: ${anonymousBackupStatus.status}`);
  const legacyBackupStatus = await fetch(`${baseUrl}/api/system-backup/status`, { headers: { Authorization: `Bearer ${accessCode}` } });
  if (legacyBackupStatus.status !== 403) throw new Error(`Legacy access code unexpectedly reached system backup: ${legacyBackupStatus.status}`);
  const backupStatus = await expectJson("/api/system-backup/status", { headers: authHeaders });
  if (!backupStatus.gitSha || backupStatus.scope?.excluded?.length < 2 || backupStatus.importEnabled !== false) {
    throw new Error(`System backup status is incomplete: ${JSON.stringify(backupStatus).slice(0, 500)}`);
  }
  const packagePassword = "smoke-backup-password";
  const exportCreated = await expectJson("/api/system-backup/export", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ reauthPassword: adminPassword, packagePassword }),
  });
  const exportJob = await waitForSystemBackupJob(exportCreated.job.id, authHeaders, ["completed", "failed"]);
  if (exportJob.status !== "completed") throw new Error(`System backup export failed: ${exportJob.error}`);
  const downloadTicket = await expectJson(`/api/system-backup/jobs/${exportJob.id}/download-ticket`, { method: "POST", headers: authHeaders });
  const downloadResponse = await fetch(`${baseUrl}/api/system-backup/download`, {
    headers: { ...authHeaders, "X-Backup-Download-Ticket": downloadTicket.token },
  });
  const packageBytes = Buffer.from(await downloadResponse.arrayBuffer());
  if (!downloadResponse.ok || packageBytes.subarray(0, 7).toString("ascii") !== "TZBAK01") {
    throw new Error("System backup download did not return an encrypted .tzbak package.");
  }
  const importCreated = await expectJson("/api/system-backup/import", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      reauthPassword: adminPassword,
      packagePassword,
      fileName: "smoke-backup.tzbak",
      fileSize: packageBytes.length,
      envMode: "migration",
    }),
  });
  await expectJson(`/api/system-backup/import/${importCreated.job.id}/file`, {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/octet-stream", "X-Backup-Upload-Token": importCreated.uploadToken },
    body: packageBytes,
  });
  const importJob = await waitForSystemBackupJob(importCreated.job.id, authHeaders, ["validated", "failed"]);
  if (importJob.status !== "validated" || importJob.preview?.gitSha !== backupStatus.gitSha) {
    throw new Error(`System backup import validation failed: ${JSON.stringify(importJob).slice(0, 600)}`);
  }
  const disabledApply = await fetch(`${baseUrl}/api/system-backup/import/${importJob.id}/apply`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ reauthPassword: adminPassword, confirmation: "确认恢复" }),
  });
  if (disabledApply.status !== 409) throw new Error(`System restore was not blocked while disabled: ${disabledApply.status}`);
  console.log("[ok] encrypted system backup export, download, import validation and restore safety gate");

  const overseasReconciliation = await expectJson("/api/overseas-inventory-reconciliation?period=month&anchorDate=2026-08-31", { headers: authHeaders });
  if (overseasReconciliation.scope !== "overseas"
    || !Array.isArray(overseasReconciliation.warehouses)
    || !Array.isArray(overseasReconciliation.returnFacts)
    || overseasReconciliation.ranges?.current?.from !== "2026-08-01"
    || typeof overseasReconciliation.summary?.varianceQty !== "number"
    || !Array.isArray(overseasReconciliation.outboundOrderReconciliation?.rows)
    || typeof overseasReconciliation.outboundOrderReconciliation?.summary?.shippedQty !== "number") {
    throw new Error(`Overseas inventory reconciliation payload is incomplete: ${JSON.stringify(overseasReconciliation).slice(0, 700)}`);
  }
  const anonymousOverseasReconciliation = await fetch(`${baseUrl}/api/overseas-inventory-reconciliation`);
  if (anonymousOverseasReconciliation.status !== 403) {
    throw new Error(`Anonymous overseas inventory reconciliation was not blocked: ${anonymousOverseasReconciliation.status}`);
  }
  console.log("[ok] overseas inventory reconciliation scope, ranges and authorization");

  const inventoryLedger = await expectJson("/api/inventory-ledger?from=2026-08-01&to=2026-08-31&timezone=Asia%2FShanghai", { headers: authHeaders });
  if (!Array.isArray(inventoryLedger.rows) || typeof inventoryLedger.summary?.rowCount !== "number") {
    throw new Error(`Inventory daily ledger payload is incomplete: ${JSON.stringify(inventoryLedger).slice(0, 500)}`);
  }
  const anonymousInventoryLedger = await fetch(`${baseUrl}/api/inventory-ledger?from=2026-08-01&to=2026-08-31`);
  if (anonymousInventoryLedger.status !== 403) {
    throw new Error(`Anonymous inventory daily ledger was not blocked: ${anonymousInventoryLedger.status}`);
  }
  console.log("[ok] inventory daily ledger range query and authorization");

  const collaborationWarehouses = await expectJson("/api/stockup/collaboration/warehouses", { headers: authHeaders });
  if (!Array.isArray(collaborationWarehouses.warehouses) || !collaborationWarehouses.warehouses.length) {
    throw new Error("Stockup collaboration did not expose scoped warehouse options.");
  }
  const destination = collaborationWarehouses.warehouses[0];
  const collaborationRequest = await expectJson("/api/stockup/collaboration/requests", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json", "Idempotency-Key": "smoke-stockup-request-1" },
    body: JSON.stringify({
      project: "Smoke Operations",
      destinationCountry: destination.country || "Russia",
      destinationWarehouseId: destination.id,
      destinationWarehouseName: destination.name,
      expectedArrivalAt: "2026-12-31",
      priority: "normal",
      reason: "smoke test",
      submit: true,
      lines: [
        { sku: "SMOKE-SKU-001", productName: "Smoke product A", method: "purchase", requestedQty: 10, unit: "pcs", targetUnitCostCny: 8.5 },
        { sku: "SMOKE-SKU-002", productName: "Smoke product B", method: "outsourced", requestedQty: 5, unit: "pcs", targetUnitCostCny: 12 },
      ],
    }),
  });
  const collaborationDetail = await expectJson(`/api/stockup/collaboration/requests/${encodeURIComponent(collaborationRequest.requestId)}`, { headers: authHeaders });
  if (collaborationDetail.request?.lines?.length !== 2
    || collaborationDetail.request?.workflowVersion !== 2
    || collaborationDetail.request?.status !== "submitted") {
    throw new Error(`Stockup collaboration request workflow was not persisted correctly: ${JSON.stringify(collaborationDetail).slice(0, 600)}`);
  }
  console.log("[ok] stockup collaboration warehouse options and multi-product request");

  const domesticWarehouse = await expectJson("/api/domestic-inventory/warehouses", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ code: "CN-SMOKE-01", name: "Smoke 国内成品仓", province: "广东", city: "广州" }),
  });
  const domesticInbound = await expectJson("/api/domestic-inventory/movements", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json", "Idempotency-Key": "smoke-domestic-inbound-1" },
    body: JSON.stringify({
      warehouseId: domesticWarehouse.warehouse.id,
      type: "inbound",
      referenceNo: "SMOKE-PO-001",
      lines: [{ sku: "SMOKE-SKU-001", productName: "Smoke product A", unit: "pcs", quantity: 12, unitCostCny: 8.5 }],
    }),
  });
  const domesticInventory = await expectJson("/api/domestic-inventory", { headers: authHeaders });
  if (!domesticInbound.movementNo || domesticInventory.summary?.onHandQty !== 12 || domesticInventory.balances?.[0]?.sku !== "SMOKE-SKU-001") {
    throw new Error(`Domestic inventory API did not persist the inbound flow correctly: ${JSON.stringify(domesticInventory).slice(0, 600)}`);
  }
  console.log("[ok] domestic warehouse master, inbound flow and inventory ledger");

  const returnQueryNeedsScope = await expectJson("/api/warehouse-returns/query", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "TRACK-SMOKE-001", queryType: "tracking" }),
  });
  if (!returnQueryNeedsScope.needsInput || returnQueryNeedsScope.complete || !returnQueryNeedsScope.requiredFields?.includes("warehouseId") || !returnQueryNeedsScope.requiredFields?.includes("dateRange")) {
    throw new Error(`/api/warehouse-returns/query did not require scoped warehouse and date input: ${JSON.stringify(returnQueryNeedsScope).slice(0, 600)}`);
  }
  const platformReturnQueryNeedsScope = await expectJson("/api/warehouse-returns/query", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "PLATFORM-SMOKE-001", queryType: "platform_order" }),
  });
  if (!platformReturnQueryNeedsScope.needsInput || !platformReturnQueryNeedsScope.requiredFields?.includes("warehouseId") || platformReturnQueryNeedsScope.requiredFields?.includes("dateRange")) {
    throw new Error(`/api/warehouse-returns/query did not limit the platform-order fallback to warehouse selection: ${JSON.stringify(platformReturnQueryNeedsScope).slice(0, 600)}`);
  }
  const anonymousReturnQuery = await fetch(`${baseUrl}/api/warehouse-returns/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "TRACK-SMOKE-001", queryType: "tracking" }),
  });
  if (anonymousReturnQuery.status !== 403) throw new Error(`Anonymous WMS return query was not blocked: ${anonymousReturnQuery.status}`);
  console.log("[ok] WMS return query requires explicit scope and authentication");

  const productOptions = await expectJson("/api/after-sales/products?country=ID&limit=5", { headers: authHeaders });
  if (!Array.isArray(productOptions.products) || !productOptions.products.length || !productOptions.products[0]?.sku || !("unitCostCny" in productOptions.products[0])) {
    throw new Error(`/api/after-sales/products did not return selectable products with cost fields: ${JSON.stringify(productOptions).slice(0, 600)}`);
  }
  console.log("[ok] after-sales product picker API");

  const robots = await expectJson("/api/wecom-notifications/robots", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke collaboration robot", webhookUrl: `http://127.0.0.1:${webhookPort}/robot`, enabled: true }),
  });
  const collaborationRobot = robots.robots?.find((robot) => robot.name === "Smoke collaboration robot");
  if (!collaborationRobot?.id) throw new Error("Smoke collaboration robot was not created.");
  const emptyRecipientHeaders = { ...authHeaders, "Content-Type": "application/json" };
  await expectRejectedJson("/api/wecom-notifications/test", {
    method: "POST",
    headers: emptyRecipientHeaders,
    body: JSON.stringify({ robotIds: [], text: "should not send" }),
  });
  await expectRejectedJson("/api/wecom-notifications/operating-summary", {
    method: "POST",
    headers: emptyRecipientHeaders,
    body: JSON.stringify({ robotIds: [], linkUrl: "#dashboard" }),
  });
  await expectRejectedJson("/api/wecom-notifications/schedules", {
    method: "POST",
    headers: emptyRecipientHeaders,
    body: JSON.stringify({ name: "unsafe empty schedule", robotIds: [], enabled: true, mode: "daily", time: "09:00", text: "should not save" }),
  });
  await expectRejectedJson("/api/wecom-notifications/scenes", {
    method: "POST",
    headers: emptyRecipientHeaders,
    body: JSON.stringify({ scenes: { stockupRecommendation: { enabled: true, robotIds: [], triggerMode: "daily", scheduleTime: "09:15" } } }),
  });
  console.log("[ok] WeCom test, summary, schedule and scene APIs reject an empty recipient scope");
  const sceneConfiguration = await expectJson("/api/wecom-notifications/scenes", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ scenes: {
      afterSalesNew: { enabled: true, robotIds: [collaborationRobot.id], warehouseRobotIds: { "id-shenniu-jakarta": [collaborationRobot.id] }, linkUrl: "#after-sales" },
      afterSalesProgress: { enabled: true, robotIds: [collaborationRobot.id], linkUrl: "#after-sales" },
      stockupRecommendation: { enabled: true, robotIds: [collaborationRobot.id], triggerMode: "daily", scheduleTime: "09:15", linkUrl: "#stockup" },
    } }),
  });
  if (sceneConfiguration.scenes?.stockupRecommendation?.triggerMode !== "daily" || sceneConfiguration.scenes?.stockupRecommendation?.scheduleTime !== "09:15") {
    throw new Error(`Stockup alert schedule was not persisted: ${JSON.stringify(sceneConfiguration.scenes?.stockupRecommendation)}`);
  }
  console.log("[ok] stockup alert supports an explicit Beijing-time daily schedule");
  const projectTeams = await expectJson("/api/wecom-notifications/project-teams", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ projectTeams: [{ id: "smoke-team", name: "Smoke 项目组", enabled: true, robotIds: [collaborationRobot.id], mentionUserIds: ["smoke_lead"] }] }),
  });
  if (projectTeams.projectTeams?.[0]?.name !== "Smoke 项目组") throw new Error("Project notification team was not saved.");
  const selectableTeams = await expectJson("/api/warehouse-collaboration/notification-teams", { headers: authHeaders });
  if (selectableTeams.teams?.[0]?.id !== "smoke-team") throw new Error("Reporter notification-team choices were not exposed.");
  const warehouseTicket = await expectJson("/api/warehouse-tickets", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ warehouseId: "id-shenniu-jakarta", category: "订单催促", priority: "urgent", relatedOrderNumber: "SMOKE-ORDER-1", title: "请核查订单", description: "请反馈预计出库时间", attachmentIds: [], notificationTeamId: "smoke-team" }),
  });
  if (warehouseTicket.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes(`ticket=${warehouseTicket.ticket.id}`)) {
    throw new Error(`Warehouse ticket creation did not synchronously deliver a deep-link webhook: ${JSON.stringify(warehouseTicket).slice(0, 600)}`);
  }
  const warehouseReminder = await expectJson(`/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/remind`, {
    method: "POST",
    headers: authHeaders,
  });
  if (warehouseReminder.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("仓库工单催办提醒") || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes(`ticket=${warehouseTicket.ticket.id}`)) {
    throw new Error("Warehouse ticket reminder did not notify the target warehouse with a deep link.");
  }
  const repeatedWarehouseReminder = await fetch(`${baseUrl}/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/remind`, { method: "POST", headers: authHeaders });
  if (repeatedWarehouseReminder.status !== 429 || !repeatedWarehouseReminder.headers.get("retry-after")) {
    throw new Error(`Warehouse ticket reminder cooldown was not enforced: ${repeatedWarehouseReminder.status}.`);
  }
  const warehouseAccepted = await expectJson(`/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept", note: "开始核查" }),
  });
  if (warehouseAccepted.notification?.routeLabel !== "项目群：Smoke 项目组" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("<@smoke_lead>")) {
    throw new Error("Warehouse ticket progress was not routed to the frozen project group with a WeCom mention.");
  }
  const warehouseReply = await expectJson(`/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply", note: "预计 16:00 前出库" }),
  });
  if (warehouseReply.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("仓库回复工单")) {
    throw new Error("Warehouse ticket reply did not notify operations immediately.");
  }
  const evidenceVideoUpload = await expectJson("/api/after-sales/uploads/file?kind=evidence&fileName=customer-feedback.mp4", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "video/mp4" },
    body: Buffer.from("000000186674797069736f6d00000000", "hex"),
  });
  if (!evidenceVideoUpload.upload?.id || evidenceVideoUpload.upload?.mimeType !== "video/mp4") {
    throw new Error("After-sales evidence video was not uploaded through the binary route.");
  }
  const webhookCountBeforeDraft = webhookPayloads.length;
  const afterSalesDraft = await expectJson("/api/after-sales/drafts", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNumber: "SMOKE-AS-ORDER-1",
      order: { orderNumber: "SMOKE-AS-ORDER-1", orderIdentity: "SMOKE-AS-1", platform: "tiktok", site: "ID", shopId: "SHOP-1", shopAlias: "测试店", orderStartedAt: "2026-09-01T10:00:00.000Z", packagingFeeCny: 1.9 },
      customer: { recipientInfo: "收件人：测试用户\n电话：081234\n地址：Jakarta" },
      warehouseId: "id-shenniu-jakarta",
      originalItems: [{ sku: "TZKJ-SJJ001", productName: "测试产品", orderedQty: 1, affectedQty: 1, unitCostCny: 10 }],
      reissueItems: [],
      primaryReasonCode: "warehouse_short_shipment",
      secondaryReasonCode: "wrong_item_bad_review_no_return",
      evidenceIds: [evidenceVideoUpload.upload.id],
      operatorRemark: "等待客户确认处理方式",
    }),
  });
  if (!afterSalesDraft.draft?.id || webhookPayloads.length !== webhookCountBeforeDraft) {
    throw new Error("Saving an after-sales draft failed or incorrectly triggered a webhook.");
  }
  const listedAfterSalesDrafts = await expectJson("/api/after-sales/drafts", { headers: authHeaders });
  if (listedAfterSalesDrafts.drafts?.length !== 1 || listedAfterSalesDrafts.drafts[0].secondaryReason !== "仓库发错货，客户差评不退货") {
    throw new Error("After-sales draft list did not preserve the selected resolution.");
  }
  const afterSales = await expectJson("/api/after-sales", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      draftId: afterSalesDraft.draft.id,
      order: { orderNumber: "SMOKE-AS-ORDER-1", orderIdentity: "SMOKE-AS-1", platform: "tiktok", site: "ID", shopId: "SHOP-1", shopAlias: "测试店", orderStartedAt: "2026-09-01T10:00:00.000Z", packagingFeeCny: 1.9 },
      customer: { recipientInfo: "收件人：测试用户\n电话：081234\n地址：Jakarta" },
      warehouseId: "id-shenniu-jakarta",
      originalItems: [{ sku: "TZKJ-SJJ001", productName: "测试产品", imageUrl: "", orderedQty: 1, affectedQty: 1, unitCostCny: 10, costSource: "smoke" }],
      reissueItems: [{ sku: "TZKJ-SJJ001", productName: "测试产品", imageUrl: "", quantity: 1, unitCostCny: 10, costSource: "smoke" }],
      primaryReason: "仓库错发",
      primaryReasonCode: "warehouse_wrong_item",
      secondaryReason: "补发且留错品",
      secondaryReasonCode: "reship_keep_wrong_item",
      needsReissue: true,
      evidenceIds: [evidenceVideoUpload.upload.id],
      operatorRemark: "smoke",
      additionalLiabilityCny: 0,
      customerRecoveryCny: 0,
      notificationTeamId: "smoke-team",
    }),
  });
  if (afterSales.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes(`ticket=${afterSales.ticket.id}`)) {
    throw new Error("After-sales creation did not synchronously deliver a warehouse webhook.");
  }
  if (!afterSales.ticket?.evidence?.some((item) => item.id === evidenceVideoUpload.upload.id && item.mimeType === "video/mp4")) {
    throw new Error("After-sales evidence video was not linked to the created ticket.");
  }
  const draftsAfterSubmit = await expectJson("/api/after-sales/drafts", { headers: authHeaders });
  if (draftsAfterSubmit.drafts?.length) throw new Error("Submitted after-sales draft was not removed from the draft box.");
  const evidenceVideoResponse = await fetch(`${baseUrl}${new URL(evidenceVideoUpload.upload.url).pathname}`, { headers: authHeaders });
  if (!evidenceVideoResponse.ok || evidenceVideoResponse.headers.get("content-type") !== "video/mp4") {
    throw new Error(`After-sales evidence video could not be read with its media type: ${evidenceVideoResponse.status}.`);
  }
  const afterSalesReminder = await expectJson(`/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/remind`, {
    method: "POST",
    headers: authHeaders,
  });
  if (afterSalesReminder.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("售后单催办提醒") || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes(`ticket=${afterSales.ticket.id}`)) {
    throw new Error("After-sales reminder did not notify the target warehouse with a deep link.");
  }
  const repeatedAfterSalesReminder = await fetch(`${baseUrl}/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/remind`, { method: "POST", headers: authHeaders });
  if (repeatedAfterSalesReminder.status !== 429 || !repeatedAfterSalesReminder.headers.get("retry-after")) {
    throw new Error(`After-sales reminder cooldown was not enforced: ${repeatedAfterSalesReminder.status}.`);
  }
  const labelUpload = await expectJson("/api/after-sales/uploads", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: "label.pdf", kind: "label", dataUrl: "data:application/pdf;base64,JVBERi0xLjQ=" }),
  });
  const attachedLabel = await expectJson(`/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/labels`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ labelUploadIds: [labelUpload.upload.id], note: "补发面单" }),
  });
  if (attachedLabel.notification?.status !== "sent" || attachedLabel.notification?.teamId !== "smoke-team" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("补发面单：已上传 1 张") || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("<@smoke_lead>")) {
    throw new Error("After-sales label upload did not notify operations immediately.");
  }
  const cancelledAfterSales = await expectJson(`/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", note: "smoke accidental cancellation" }),
  });
  if (cancelledAfterSales.ticket?.status !== "cancelled" || cancelledAfterSales.ticket?.cancelledFromStatus !== "pending_warehouse") {
    throw new Error("After-sales cancellation did not preserve the previous workflow status.");
  }
  const activatedAfterSales = await expectJson(`/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "activate", note: "恢复误作废售后单" }),
  });
  if (activatedAfterSales.ticket?.status !== "pending_warehouse" || activatedAfterSales.notification?.status !== "sent" || !String(webhookPayloads.at(-1)?.markdown?.content || "").includes("售后单重新激活")) {
    throw new Error("After-sales activation did not restore the workflow or notify the target warehouse.");
  }
  console.log("[ok] warehouse collaboration synchronous webhook chain");

  const missingWarehouseScopeResponse = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke-warehouse-empty", password: "warehouse123", displayName: "未绑定仓库", role: "warehouse" }),
  });
  if (missingWarehouseScopeResponse.status !== 400 || !String((await missingWarehouseScopeResponse.json()).message || "").includes("至少绑定一个仓库")) {
    throw new Error("Warehouse account creation did not reject an empty warehouse scope.");
  }
  const isolationWarehouses = await expectJson("/api/warehouses", { headers: authHeaders });
  const ownWarehouseId = "id-shenniu-jakarta";
  const otherWarehouseId = isolationWarehouses.warehouses?.find((warehouse) => warehouse.id && warehouse.id !== ownWarehouseId)?.id;
  if (!otherWarehouseId) throw new Error("Warehouse isolation smoke test needs at least two configured warehouses.");
  async function createAndLoginWarehouse(username, warehouseId) {
    const password = "warehouse123";
    const created = await expectJson("/api/users", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        displayName: `${warehouseId} 测试账号`,
        role: "warehouse",
        dataScopes: { countries: [], warehouseIds: [warehouseId], skus: [] },
      }),
    });
    const session = await expectJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { id: created.user?.id, headers: { Authorization: `Bearer ${session.token}` } };
  }
  const ownWarehouseAccount = await createAndLoginWarehouse("smoke-warehouse-own", ownWarehouseId);
  const otherWarehouseAccount = await createAndLoginWarehouse("smoke-warehouse-other", otherWarehouseId);
  const warehouseReminderByWarehouse = await fetch(`${baseUrl}/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/remind`, { method: "POST", headers: ownWarehouseAccount.headers });
  const afterSalesReminderByWarehouse = await fetch(`${baseUrl}/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/remind`, { method: "POST", headers: ownWarehouseAccount.headers });
  const afterSalesActivationByWarehouse = await fetch(`${baseUrl}/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...ownWarehouseAccount.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "activate" }),
  });
  if (warehouseReminderByWarehouse.status !== 403 || afterSalesReminderByWarehouse.status !== 403 || afterSalesActivationByWarehouse.status !== 403) {
    throw new Error(`Warehouse account unexpectedly used an admin collaboration action: ticket reminder ${warehouseReminderByWarehouse.status}, after-sales reminder ${afterSalesReminderByWarehouse.status}, after-sales activation ${afterSalesActivationByWarehouse.status}.`);
  }
  const ownWarehouseTickets = await expectJson("/api/warehouse-tickets", { headers: ownWarehouseAccount.headers });
  const otherWarehouseTickets = await expectJson("/api/warehouse-tickets", { headers: otherWarehouseAccount.headers });
  const ownAfterSales = await expectJson("/api/after-sales", { headers: ownWarehouseAccount.headers });
  const otherAfterSales = await expectJson("/api/after-sales", { headers: otherWarehouseAccount.headers });
  const warehouseReturnQuery = await fetch(`${baseUrl}/api/warehouse-returns/query`, {
    method: "POST",
    headers: { ...ownWarehouseAccount.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "TRACK-SMOKE-001", queryType: "tracking", warehouseId: ownWarehouseId, dateFrom: "2026-09-01", dateTo: "2026-09-13" }),
  });
  if (warehouseReturnQuery.status !== 403) throw new Error(`Warehouse operator unexpectedly queried WMS return data: ${warehouseReturnQuery.status}`);
  if (!ownWarehouseTickets.tickets?.some((ticket) => ticket.id === warehouseTicket.ticket.id) || otherWarehouseTickets.tickets?.some((ticket) => ticket.id === warehouseTicket.ticket.id)) {
    throw new Error("Warehouse ticket lists were not isolated by the account warehouse binding.");
  }
  if (!ownAfterSales.tickets?.some((ticket) => ticket.id === afterSales.ticket.id) || otherAfterSales.tickets?.some((ticket) => ticket.id === afterSales.ticket.id)) {
    throw new Error("After-sales lists were not isolated by the account warehouse binding.");
  }
  await expectJson(`/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}`, { headers: ownWarehouseAccount.headers });
  await expectJson(`/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}`, { headers: ownWarehouseAccount.headers });
  const crossWarehouseTicketDetail = await fetch(`${baseUrl}/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}`, { headers: otherWarehouseAccount.headers });
  const crossWarehouseAfterSalesDetail = await fetch(`${baseUrl}/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}`, { headers: otherWarehouseAccount.headers });
  if (crossWarehouseTicketDetail.status !== 404 || crossWarehouseAfterSalesDetail.status !== 404) {
    throw new Error(`Cross-warehouse detail access was not hidden: ticket ${crossWarehouseTicketDetail.status}, after-sales ${crossWarehouseAfterSalesDetail.status}.`);
  }
  const crossWarehouseTicketUpdate = await fetch(`${baseUrl}/api/warehouse-tickets/${encodeURIComponent(warehouseTicket.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...otherWarehouseAccount.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reply", note: "不应写入" }),
  });
  const crossWarehouseAfterSalesUpdate = await fetch(`${baseUrl}/api/after-sales/${encodeURIComponent(afterSales.ticket.id)}/warehouse`, {
    method: "PATCH",
    headers: { ...otherWarehouseAccount.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept", warehouseRemark: "不应写入" }),
  });
  if (crossWarehouseTicketUpdate.status !== 404 || crossWarehouseAfterSalesUpdate.status !== 404) {
    throw new Error(`Cross-warehouse update was not blocked: ticket ${crossWarehouseTicketUpdate.status}, after-sales ${crossWarehouseAfterSalesUpdate.status}.`);
  }
  await expectJson(`/api/users/${encodeURIComponent(ownWarehouseAccount.id)}`, { method: "DELETE", headers: authHeaders });
  await expectJson(`/api/users/${encodeURIComponent(otherWarehouseAccount.id)}`, { method: "DELETE", headers: authHeaders });
  console.log("[ok] warehouse account list and detail isolation");

  const scheduler = await expectJson("/api/sync-scheduler", { headers: authHeaders });
  if (!scheduler.enabled || !Array.isArray(scheduler.tasks) || scheduler.tasks.length < 10 || scheduler.counts?.running === undefined) {
    throw new Error(`/api/sync-scheduler did not expose the background task state: ${JSON.stringify(scheduler).slice(0, 500)}`);
  }
  if (!scheduler.tasks.some((task) => task.id === "warehouse-return-facts")) {
    throw new Error("/api/sync-scheduler did not register warehouse-return-facts");
  }
  console.log("[ok] staggered sync scheduler status");

  const actionLog = await expectJson("/api/action-log", { headers: authHeaders });
  const loginEntry = (actionLog.entries || []).find((entry) => entry.action === "登录系统");
  if (!loginEntry?.details?.loginIp) {
    throw new Error(`/api/action-log did not record login IP after login: ${JSON.stringify(actionLog).slice(0, 500)}`);
  }
  console.log("[ok] /api/action-log login IP");

  const orderAnalysis = await expectJson("/api/order-analysis", { headers: authHeaders });
  if (!orderAnalysis.counts || !orderAnalysis.options || !Array.isArray(orderAnalysis.daily) || !Array.isArray(orderAnalysis.recentOrders)) {
    throw new Error("/api/order-analysis did not return counts, options, daily trend, and recent orders.");
  }
  if (!Array.isArray(orderAnalysis.options.projectGroups) || !Array.isArray(orderAnalysis.byProjectGroup)) {
    throw new Error("/api/order-analysis did not return project group filters and ranking.");
  }
  console.log("[ok] /api/order-analysis");

  const performance = await expectJson("/api/performance-analytics?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
  if (!performance.reconciliation?.rowCountMatched || performance.shopDirectory?.matchedShopCount !== 1) {
    throw new Error(`/api/performance-analytics did not reconcile WMS facts or match the Miaoshou alias: ${JSON.stringify(performance).slice(0, 800)}`);
  }
  if (!performance.dataVersion || performance.sourceQuality?.status !== "official" || !Number.isFinite(performance.queryDurationMs)) {
    throw new Error(`/api/performance-analytics did not expose a versioned official snapshot: ${JSON.stringify(performance).slice(0, 800)}`);
  }
  if (!Number.isFinite(performance.workerQueryDurationMs) || performance.scannedFactCount !== 1) {
    throw new Error(`/api/performance-analytics did not expose the bounded worker query diagnostics: ${JSON.stringify(performance).slice(0, 800)}`);
  }
  if (!performance.resultCounts || performance.products.length > 100 || performance.recentFacts.length > 50) {
    throw new Error(`/api/performance-analytics did not return a bounded result payload: ${JSON.stringify(performance).slice(0, 800)}`);
  }
  if (!Array.isArray(performance.supplementalProductCosts)) {
    throw new Error("/api/performance-analytics did not expose the supplemental product cost ledger.");
  }
  const invalidSupplementalCostImport = await fetch(`${baseUrl}/api/performance-analytics/supplemental-costs`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ sku: "SMOKE-INVALID", country: "ID", unitCostCny: 0, effectiveDate: "2026-99-99" }] }),
  });
  if (invalidSupplementalCostImport.status !== 400) {
    throw new Error(`invalid supplemental product cost import was not rejected atomically: ${invalidSupplementalCostImport.status}`);
  }
  console.log("[ok] performance supplemental cost ledger and atomic validation");
  if (performance.totals?.profitCoverageRate > 0) {
    const reconciledProfit = Number(performance.totals.profitSalesCny || 0) - Number(performance.totals.profitCogsCny || 0);
    if (Math.abs(reconciledProfit - Number(performance.totals.estimatedProfitCny || 0)) > 0.01) {
      throw new Error(`/api/performance-analytics mixed revenue and cost cohorts: ${JSON.stringify(performance.totals).slice(0, 800)}`);
    }
  }
  if (performance.transactionSource?.requested !== "shadow" || performance.transactionSource?.effective !== "wms" || performance.transactionSource?.activationEligible) {
    throw new Error(`/api/performance-analytics did not default to the safe Miaoshou shadow mode: ${JSON.stringify(performance.transactionSource).slice(0, 800)}`);
  }
  const invalidRevenueBasis = await fetch(`${baseUrl}/api/performance-analytics/revenue-basis`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ revenueBasis: "gmv" }),
  });
  if (invalidRevenueBasis.status !== 400) throw new Error(`invalid Miaoshou revenue basis was accepted: ${invalidRevenueBasis.status}`);
  const revenueBasis = await expectJson("/api/performance-analytics/revenue-basis", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ revenueBasis: "orderAmount" }),
  });
  if (revenueBasis.revenueBasis !== "orderAmount") throw new Error(`Miaoshou revenue basis was not saved: ${JSON.stringify(revenueBasis)}`);
  // 切换口径后后台重算，期间返回上一版快照；轮询直到新口径生效。
  let performanceWithBasis = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    performanceWithBasis = await expectJson("/api/performance-analytics?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
    if (performanceWithBasis.transactionSource?.reconciliation?.revenueBasis === "orderAmount") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (performanceWithBasis.transactionSource?.reconciliation?.revenueBasis !== "orderAmount" || !Array.isArray(performanceWithBasis.transactionSource?.reconciliation?.basisComparison)) {
    throw new Error(`/api/performance-analytics did not apply the Miaoshou revenue basis: ${JSON.stringify(performanceWithBasis.transactionSource?.reconciliation).slice(0, 600)}`);
  }
  console.log("[ok] Miaoshou revenue basis setting and per-basis comparison");
  const unsafeSourceSwitch = await fetch(`${baseUrl}/api/performance-analytics/revenue-source`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ revenueSource: "miaoshou" }),
  });
  if (unsafeSourceSwitch.status !== 409) {
    throw new Error(`unsafe Miaoshou revenue activation was not blocked: ${unsafeSourceSwitch.status}`);
  }
  const shop = performance.shopDirectory.shops[0];
  if (shop.displayName !== "印尼测试别称" || !shop.key) {
    throw new Error(`/api/performance-analytics did not expose the Miaoshou shop alias: ${JSON.stringify(shop)}`);
  }
  const assigned = await expectJson("/api/shop-directory/project-group", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKeys: [shop.key], projectGroup: "东南亚项目" }),
  });
  if (assigned.updatedCount !== 1 || assigned.shopDirectory.shops[0]?.projectGroup !== "东南亚项目") {
    throw new Error(`/api/shop-directory/project-group did not apply the one-shop-one-project rule: ${JSON.stringify(assigned).slice(0, 800)}`);
  }
  const assignedPerformance = await expectJson("/api/performance-analytics?dateFrom=2026-08-28&dateTo=2026-08-28&projectGroup=%E4%B8%9C%E5%8D%97%E4%BA%9A%E9%A1%B9%E7%9B%AE", { headers: authHeaders });
  if (assignedPerformance.totals?.orderLines !== 1) {
    throw new Error("performance analytics did not filter by the configured main project group.");
  }
  console.log("[ok] shop alias, reconciliation, and main project group assignment");

  // 日汇总接口：分区物化后同步到汇总存储（内存或 PostgreSQL）。
  let summaryTotal = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    summaryTotal = await expectJson("/api/performance-analytics/summary?dateFrom=2026-08-28&dateTo=2026-08-28&groupBy=total", { headers: authHeaders });
    if (summaryTotal.rows[0]?.orderCount === 1) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (summaryTotal.rows[0]?.orderCount !== 1 || summaryTotal.rows[0]?.quantity !== 2) {
    throw new Error(`/api/performance-analytics/summary did not aggregate the order facts: ${JSON.stringify(summaryTotal).slice(0, 600)}`);
  }
  if (process.env.ANALYTICS_DATABASE_URL && summaryTotal.backend !== "postgres") throw new Error(`summary did not use PostgreSQL: ${summaryTotal.backend}`);
  const summaryByShop = await expectJson(`/api/performance-analytics/summary?dateFrom=2026-08-28&dateTo=2026-08-28&groupBy=shop&projectGroup=${encodeURIComponent("东南亚项目")}`, { headers: authHeaders });
  if (summaryByShop.rows.length !== 1 || summaryByShop.rows[0].shopKey !== shop.key) throw new Error(`/api/performance-analytics/summary shop grouping failed: ${JSON.stringify(summaryByShop.rows)}`);
  const invalidSummary = await fetch(`${baseUrl}/api/performance-analytics/summary?groupBy=everything`, { headers: authHeaders });
  if (invalidSummary.status !== 400) throw new Error(`invalid summary groupBy was accepted: ${invalidSummary.status}`);
  const performancePartitioned = await expectJson("/api/performance-analytics?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
  if (!performancePartitioned.partitionStats || !(performancePartitioned.partitionStats.partitionCount >= 1)) throw new Error(`/api/performance-analytics did not expose partition stats: ${JSON.stringify(performancePartitioned.partitionStats)}`);
  console.log(`[ok] partitioned materialization and daily summary (${summaryTotal.backend})`);

  const binding = await expectJson("/api/shop-directory/miaoshou-binding", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKey: shop.key, miaoshouShopId: "MS-ID-1" }),
  });
  if (binding.shopDirectory.shops.find((item) => item.key === shop.key)?.miaoshouMatchSource !== "manual") throw new Error(`Miaoshou manual binding was not applied: ${JSON.stringify(binding).slice(0, 600)}`);
  const invalidBinding = await fetch(`${baseUrl}/api/shop-directory/miaoshou-binding`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKey: shop.key, miaoshouShopId: "NOT-A-SHOP" }),
  });
  if (invalidBinding.status !== 400) throw new Error(`binding to an unknown Miaoshou shop was accepted: ${invalidBinding.status}`);
  await expectJson("/api/shop-directory/miaoshou-binding", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKey: shop.key, miaoshouShopId: null }),
  });
  const enabledShops = await expectJson("/api/performance-analytics/miaoshou-shops", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKeys: [shop.key], enabled: true }),
  });
  if (enabledShops.revenueSource !== "per_shop" || !enabledShops.enabledShopKeys.includes(shop.key)) throw new Error(`per-shop Miaoshou activation failed: ${JSON.stringify(enabledShops)}`);
  let perShopPerformance = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    perShopPerformance = await expectJson("/api/performance-analytics?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
    if (perShopPerformance.transactionSource?.requested === "per_shop") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  const shopRow = perShopPerformance.transactionSource?.reconciliation?.shops?.find((row) => row.shopKey === shop.key);
  if (perShopPerformance.transactionSource?.requested !== "per_shop" || !shopRow?.enabled || shopRow.effective || perShopPerformance.transactionSource.effective !== "wms") {
    throw new Error(`per-shop mode did not gate the unmatched shop: ${JSON.stringify(perShopPerformance.transactionSource).slice(0, 800)}`);
  }
  await expectJson("/api/performance-analytics/miaoshou-shops", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ shopKeys: [shop.key], enabled: false }),
  });
  console.log("[ok] Miaoshou manual shop binding and per-shop activation gate");

  const unauthenticatedShopDaily = await fetch(`${baseUrl}/api/shop-daily-report?dateFrom=2026-08-28&dateTo=2026-08-28`);
  if (unauthenticatedShopDaily.status !== 403) throw new Error(`/api/shop-daily-report allowed anonymous access: ${unauthenticatedShopDaily.status}`);
  const unauthenticatedShopOrders = await fetch(`${baseUrl}/api/shop-daily-report/orders?dateFrom=2026-08-28&dateTo=2026-08-28&shopKey=smoke`);
  if (unauthenticatedShopOrders.status !== 403) throw new Error(`/api/shop-daily-report/orders allowed anonymous access: ${unauthenticatedShopOrders.status}`);
  const shopDailyBaseline = await expectJson("/api/shop-daily-report?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
  if (shopDailyBaseline.rows.length !== 1 || shopDailyBaseline.rows[0].shopKey !== shop.key || shopDailyBaseline.rows[0].sources.revenue !== "system" || shopDailyBaseline.rows[0].orderCount !== 1) {
    throw new Error(`/api/shop-daily-report did not fall back to central order facts: ${JSON.stringify(shopDailyBaseline.rows).slice(0, 800)}`);
  }
  const shopDailyOrders = await expectJson(`/api/shop-daily-report/orders?dateFrom=2026-08-28&dateTo=2026-08-28&shopKey=${encodeURIComponent(shop.key)}`, { headers: authHeaders });
  if (!shopDailyOrders.orders?.length || !shopDailyOrders.orders[0]?.orderNo || !Array.isArray(shopDailyOrders.orders[0]?.items)) {
    throw new Error(`/api/shop-daily-report/orders did not return order drilldown: ${JSON.stringify(shopDailyOrders).slice(0, 800)}`);
  }
  const shopDailyTsv = ["日期\t店铺\t平台\t国家\t支付金额\t访客数\t订单数\t站内推广费", "2026-08-28\t印尼测试别称\tTikTok\t印尼\t20000\t50\t2\t1000"].join("\n");
  const shopDailyPreview = await expectJson("/api/shop-daily-report/import", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ content: shopDailyTsv, dryRun: true }),
  });
  if (shopDailyPreview.rowCount !== 1 || shopDailyPreview.errorCount !== 0 || shopDailyPreview.sample[0]?.shopKey !== shop.key || shopDailyPreview.written !== undefined) {
    throw new Error(`/api/shop-daily-report/import preview did not match the shop alias: ${JSON.stringify(shopDailyPreview).slice(0, 800)}`);
  }
  const shopDailyImport = await expectJson("/api/shop-daily-report/import", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ content: shopDailyTsv, dryRun: false }),
  });
  if (shopDailyImport.written !== 1) throw new Error(`/api/shop-daily-report/import did not write: ${JSON.stringify(shopDailyImport)}`);
  const wrongIngest = await fetch(`${baseUrl}/api/shop-daily-report/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Token": "wrong" },
    body: JSON.stringify({ rows: [] }),
  });
  if (wrongIngest.status !== 401) throw new Error(`shop metrics ingest accepted an invalid token: ${wrongIngest.status}`);
  const ingest = await expectJson("/api/shop-daily-report/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Ingest-Token": "smoke-shop-metrics-ingest-token-0123456789" },
    body: JSON.stringify({ source: "ziniao", rows: [{ date: "2026-08-28", shopKey: shop.key, impressions: 999, addToCart: 7 }] }),
  });
  if (ingest.written !== 1) throw new Error(`shop metrics ingest did not write: ${JSON.stringify(ingest)}`);
  const pairDenied = await fetch(`${baseUrl}/api/shop-daily-report/ingest/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (pairDenied.status !== 401) throw new Error(`ingest pairing accepted an anonymous request: ${pairDenied.status}`);
  const paired = await expectJson("/api/shop-daily-report/ingest/pair", { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ device: "smoke" }) });
  if (paired.token !== "smoke-shop-metrics-ingest-token-0123456789") throw new Error(`ingest pairing returned an unexpected token: ${JSON.stringify(paired).slice(0, 200)}`);
  const ingestShopsDenied = await fetch(`${baseUrl}/api/shop-daily-report/ingest/shops`, { headers: { "X-Ingest-Token": "wrong" } });
  if (ingestShopsDenied.status !== 401) throw new Error(`ingest shop list accepted an invalid token: ${ingestShopsDenied.status}`);
  const ingestShops = await expectJson("/api/shop-daily-report/ingest/shops", { headers: { "X-Ingest-Token": "smoke-shop-metrics-ingest-token-0123456789" } });
  if (!ingestShops.shops.some((item) => item.shopKey === shop.key && item.shopName && item.countryCode)) {
    throw new Error(`ingest shop list is missing the directory shop: ${JSON.stringify(ingestShops).slice(0, 400)}`);
  }
  // 采集中心：节点配对、心跳、用节点令牌写入、下发命令、运行记录与日志
  const nodePair = await expectJson("/api/collector/nodes/pair", { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ name: "冒烟节点", hostname: "SMOKE", platforms: ["Shopee"], version: "0.3.0" }) });
  const nodeHeaders = { "X-Node-Token": nodePair.token, "Content-Type": "application/json" };
  const nodeBeat = await expectJson("/api/collector/agent/heartbeat", { method: "POST", headers: nodeHeaders, body: JSON.stringify({ version: "0.3.0", localSchedule: { enabled: true, times: ["09:30"], lookbackDays: 3 }, stores: [{ storeId: "s1", storeName: "冒烟店", platform: "Shopee", site: "ID", enabled: true, matched: true }] }) });
  if (!nodeBeat.schedule?.enabled || nodeBeat.schedule.times[0] !== "09:30") throw new Error(`collector heartbeat schedule mismatch: ${JSON.stringify(nodeBeat)}`);
  const nodeIngest = await expectJson("/api/shop-daily-report/ingest", { method: "POST", headers: { "X-Ingest-Token": nodePair.token, "Content-Type": "application/json" }, body: JSON.stringify({ source: "ziniao", dryRun: true, rows: [] }) });
  if (!nodeIngest.dryRun) throw new Error("collector node token was not accepted by ingest");
  const collectorNodes = await expectJson("/api/collector/nodes", { headers: authHeaders });
  const smokeNode = collectorNodes.nodes.find((item) => item.id === nodePair.node.id);
  if (!smokeNode?.online || smokeNode.enabledStoreCount !== 1) throw new Error(`collector node not listed online: ${JSON.stringify(collectorNodes).slice(0, 300)}`);
  await expectJson(`/api/collector/nodes/${smokeNode.id}`, { method: "PATCH", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ schedule: { enabled: true, times: ["21:30", "09:00"], lookbackDays: 2 } }) });
  const collectCommand = await expectJson(`/api/collector/nodes/${smokeNode.id}/commands`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ type: "collect", dates: ["2026-11-07"] }) });
  const nodeBeat2 = await expectJson("/api/collector/agent/heartbeat", { method: "POST", headers: nodeHeaders, body: "{}" });
  if (nodeBeat2.schedule.times.join(",") !== "09:00,21:30" || nodeBeat2.commands[0]?.id !== collectCommand.command.id) throw new Error(`collector schedule/command not delivered: ${JSON.stringify(nodeBeat2)}`);
  await expectJson("/api/collector/agent/runs", { method: "POST", headers: nodeHeaders, body: JSON.stringify({ run: { id: "smoke_run", commandId: collectCommand.command.id, status: "partial", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), dates: ["2026-11-07"], stores: [{ storeId: "s1", storeName: "冒烟店", status: "failed", message: "未登录" }] } }) });
  await expectJson("/api/collector/agent/logs", { method: "POST", headers: nodeHeaders, body: JSON.stringify({ lines: [{ level: "error", message: "冒烟店 未登录" }] }) });
  const retried = await expectJson(`/api/collector/nodes/${smokeNode.id}/runs/smoke_run/retry`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: "{}" });
  if (retried.command.storeIds?.[0] !== "s1") throw new Error(`collector retry did not target failed store: ${JSON.stringify(retried)}`);
  const collectorLogs = await expectJson(`/api/collector/nodes/${smokeNode.id}/logs`, { headers: authHeaders });
  if (!collectorLogs.lines.some((line) => line.message.includes("未登录"))) throw new Error("collector logs missing");
  const anonymousNodes = await fetch(`${baseUrl}/api/collector/nodes`);
  if (anonymousNodes.status !== 401) throw new Error(`collector nodes allowed anonymous access: ${anonymousNodes.status}`);
  const badAgent = await fetch(`${baseUrl}/api/collector/agent/heartbeat`, { method: "POST", headers: { "X-Node-Token": "tzcn_bad", "Content-Type": "application/json" }, body: "{}" });
  if (badAgent.status !== 401) throw new Error(`collector agent accepted a bad token: ${badAgent.status}`);
  await expectJson("/api/shop-daily-report/review-orders", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ shopKey: shop.key, date: "2026-08-28", orderNo: "REVIEW-1", amount: 5000, receivedAmount: 4000, quantity: 1 }] }),
  });
  const invalidFeeRules = await fetch(`${baseUrl}/api/shop-daily-report/fee-rules`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ rules: [{ scope: "country", countryKey: "ID" }] }),
  });
  if (invalidFeeRules.status !== 400) throw new Error(`fee rules without a global default were accepted: ${invalidFeeRules.status}`);
  const savedFeeRules = await expectJson("/api/shop-daily-report/fee-rules", {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ rules: [{ scope: "default", commissionRate: 0.165 }, { scope: "country", countryKey: "ID", perOrderFee: 1250, adTaxRate: 0.11, fixedLocalPerCny: 2400 }] }),
  });
  if (savedFeeRules.rules.length !== 2) throw new Error(`fee rules were not saved: ${JSON.stringify(savedFeeRules)}`);
  const shopDaily = await expectJson("/api/shop-daily-report?dateFrom=2026-08-28&dateTo=2026-08-28", { headers: authHeaders });
  const dailyRow = shopDaily.rows[0];
  if (shopDaily.rows.length !== 1 || dailyRow.sources.revenue !== "import" || dailyRow.payLocal !== 20000 || dailyRow.visitors !== 50 || dailyRow.impressions !== 999 || dailyRow.addToCart !== 7) {
    throw new Error(`/api/shop-daily-report did not merge imported and collected metrics: ${JSON.stringify(dailyRow).slice(0, 800)}`);
  }
  if (dailyRow.reviewCount !== 1 || dailyRow.realOrders !== 1 || Math.abs(dailyRow.realSalesCny - 15000 / 2400) > 0.01 || dailyRow.ruleId !== "country:ID") {
    throw new Error(`/api/shop-daily-report did not apply review orders or the country fee rule: ${JSON.stringify(dailyRow).slice(0, 800)}`);
  }
  const expectedDailyProfit = (15000 / 2400) * (1 - 0.165) - 1250 / 2400 - (1000 * 1.11) / 2400 - ((1000 / 2400) + 10.4) - dailyRow.productCostCny - dailyRow.operationFeeCny;
  if (Math.abs(dailyRow.profitCny - expectedDailyProfit) > 0.01) {
    throw new Error(`/api/shop-daily-report profit formula mismatch: expected ${expectedDailyProfit}, got ${dailyRow.profitCny}`);
  }
  console.log("[ok] shop daily report import, collector ingest, review orders and fee rules");

  const movement = await expectJson("/api/movement", { headers: authHeaders });
  if ((movement.warehouseDiagnostics || []).some((item) => !item.actionTitle || !Array.isArray(item.actionItems))) {
    throw new Error("/api/movement warehouse diagnostics are missing action guidance fields.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => !Array.isArray(item.unmatchedSkus))) {
    throw new Error("/api/movement warehouse diagnostics are missing unmatched SKU governance lists.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => !Array.isArray(item.outOfWindowSkus))) {
    throw new Error("/api/movement warehouse diagnostics are missing out-of-window order SKU lists.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => !Array.isArray(item.missingSkuOrders))) {
    throw new Error("/api/movement warehouse diagnostics are missing missing-SKU order lists.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => item.reason === "missing_sku" && item.actionTitle !== "补齐订单明细 SKU")) {
    throw new Error("/api/movement missing-SKU diagnostics do not provide the expected action title.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => typeof item.orderApiReachedPageLimit !== "boolean")) {
    throw new Error("/api/movement warehouse diagnostics are missing order pagination metadata.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => item.reason === "order_page_truncated" && item.actionTitle !== "扩大订单分页重同步")) {
    throw new Error("/api/movement truncated order-page diagnostics do not provide the expected action title.");
  }
  if ((movement.warehouseDiagnostics || []).some((item) => item.latestOrderSyncJob !== null && item.latestOrderSyncJob !== undefined && !("failedChunks" in item.latestOrderSyncJob))) {
    throw new Error("/api/movement warehouse diagnostics latest order sync job is missing failedChunks.");
  }
  const warehouseSalesRows = (movement.items || []).flatMap((item) => item.salesWarehouseBreakdown || []);
  if (warehouseSalesRows.some((row) => !("sales3" in row) || !("sales7" in row) || !("sales30" in row) || !Array.isArray(row.trend30))) {
    throw new Error("/api/movement warehouse sales breakdown is missing per-window sales fields.");
  }
  console.log("[ok] /api/movement");

  const movementHistoryCapture = await expectJson("/api/movement-history/capture", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: "Asia/Shanghai" }),
  });
  if (!movementHistoryCapture.snapshot?.date || !Array.isArray(movementHistoryCapture.snapshot?.rows)) {
    throw new Error("/api/movement-history/capture did not return a persisted daily snapshot.");
  }
  const movementHistory = await expectJson(`/api/movement-history?date=${encodeURIComponent(movementHistoryCapture.snapshot.date)}&timezone=Asia%2FShanghai`, { headers: authHeaders });
  if (!movementHistory.snapshot || !Array.isArray(movementHistory.trend) || !Array.isArray(movementHistory.timezones)) {
    throw new Error("/api/movement-history did not return snapshot, trend, and timezone metadata.");
  }
  if (!String(movementHistory.databasePath || "").endsWith(".sqlite")) {
    throw new Error("/api/movement-history did not report a SQLite database path.");
  }
  const [snapshotYear, snapshotMonth] = movementHistoryCapture.snapshot.date.split("-").map(Number);
  const previousMonthDate = new Date(Date.UTC(snapshotYear, snapshotMonth - 2, 15)).toISOString().slice(0, 10);
  await expectJson("/api/movement-history/capture", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ date: previousMonthDate, timezone: "Asia/Shanghai" }),
  });
  const unauthorizedComparison = await fetch(`${baseUrl}/api/movement-history/compare?period=month&anchorDate=${movementHistoryCapture.snapshot.date}`);
  if (unauthorizedComparison.status !== 403) {
    throw new Error(`/api/movement-history/compare did not enforce admin authentication: ${unauthorizedComparison.status}`);
  }
  const movementComparison = await expectJson(`/api/movement-history/compare?period=month&anchorDate=${movementHistoryCapture.snapshot.date}&timezone=Asia%2FShanghai`, { headers: authHeaders });
  if (!movementComparison.currentSnapshot?.date || !movementComparison.previousSnapshot?.date) {
    throw new Error(`/api/movement-history/compare did not return current and previous snapshots: ${JSON.stringify(movementComparison).slice(0, 500)}`);
  }
  if (!Array.isArray(movementComparison.rows) || !movementComparison.summary || !movementComparison.inventorySummary || !movementComparison.thresholds) {
    throw new Error("/api/movement-history/compare did not return comparison rows, summary, inventory reconciliation, and thresholds.");
  }
  if ((movementComparison.rows || []).some((row) => !("changeType" in row) || !("inventoryVarianceQty" in row) || !("orderCoverage" in row))) {
    throw new Error("/api/movement-history/compare rows are missing status change or inventory reconciliation fields.");
  }
  const movementHistoryExport = await fetch(`${baseUrl}/api/movement-history/export?date=${encodeURIComponent(movementHistoryCapture.snapshot.date)}&timezone=Asia%2FShanghai`, {
    headers: authHeaders,
  });
  const movementHistoryCsv = await movementHistoryExport.text();
  if (!movementHistoryExport.ok || !movementHistoryCsv.includes("日期,时区,仓库")) {
    throw new Error(`/api/movement-history/export did not return the expected CSV: ${movementHistoryCsv.slice(0, 200)}`);
  }
  console.log("[ok] /api/movement-history");
  console.log("[ok] /api/movement-history/compare permissions and payload");

  await expectJson("/api/stockup", { headers: authHeaders });
  const dashboardStockup = await expectJson("/api/stockup?view=dashboard", { headers: authHeaders });
  const productionStockup = await expectJson("/api/stockup?view=production", { headers: authHeaders });
  const recommendationStockup = await expectJson("/api/stockup?view=stockup-recommendations&inboundLimit=25", { headers: authHeaders });
  if (dashboardStockup.view !== "dashboard" || dashboardStockup.recommendations.length || dashboardStockup.inboundOrders.length) {
    throw new Error("/api/stockup dashboard projection returned unnecessary detail rows.");
  }
  if (productionStockup.view !== "production" || productionStockup.recommendations.length || productionStockup.inboundOrders.length) {
    throw new Error("/api/stockup production projection returned unrelated recommendation or inbound rows.");
  }
  if (recommendationStockup.view !== "stockup-recommendations" || recommendationStockup.inboundOrders.length > 25 || recommendationStockup.pagination?.inbound?.returned !== recommendationStockup.inboundOrders.length) {
    throw new Error("/api/stockup recommendation projection did not paginate inbound rows.");
  }
  console.log("[ok] /api/stockup");

  const warehouses = await expectJson("/api/warehouses", { headers: authHeaders });
  if (!Array.isArray(warehouses.lastSync?.warehouseOnlyInventory) || !Array.isArray(warehouses.lastSync?.productMissingWarehouseItems)) {
    throw new Error("/api/warehouses did not return both SKU governance lists.");
  }
  console.log("[ok] /api/warehouses");

  const unauthorizedMiaoshou = await fetch(`${baseUrl}/api/miaoshou`);
  if (![401, 403].includes(unauthorizedMiaoshou.status)) {
    throw new Error(`/api/miaoshou did not enforce admin authentication: ${unauthorizedMiaoshou.status}`);
  }
  const miaoshou = await expectJson("/api/miaoshou", { headers: authHeaders });
  if (!Array.isArray(miaoshou.shops) || !Array.isArray(miaoshou.tasks) || !Array.isArray(miaoshou.config?.scopes)) {
    throw new Error("/api/miaoshou did not return configuration, shops, and tasks.");
  }
  const miaoshouConfigured = await expectJson("/api/miaoshou/config", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      appKey: "smoke-app-key",
      appSecret: "smoke-app-secret",
      automationEnabled: false,
      scopes: [{ platform: "shopee", site: "ID" }],
    }),
  });
  if (!miaoshouConfigured.config?.hasCredentials || JSON.stringify(miaoshouConfigured).includes("smoke-app-secret")) {
    throw new Error("/api/miaoshou/config did not save credentials safely or exposed AppSecret in its response.");
  }
  console.log("[ok] /api/miaoshou permissions and safe configuration");

  await expectJson("/api/distributor-applications", { headers: authHeaders });
  console.log("[ok] /api/distributor-applications");

  const distributorPassword = "smoke-partner-password";
  const createdDistributor = await expectJson("/api/users", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke-partner", password: distributorPassword, displayName: "Smoke Partner", role: "distributor" }),
  });
  const distributorId = createdDistributor.user?.id;
  if (!distributorId) throw new Error("/api/users did not create the smoke distributor.");
  await expectJson(`/api/users/${encodeURIComponent(distributorId)}/permissions`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      permissionOverrides: { allow: ["movement", "direct_price"], deny: [] },
      dataScopes: { countries: [], warehouseIds: [], skus: [] },
    }),
  });
  const notificationProfile = await expectJson(`/api/users/${encodeURIComponent(distributorId)}/notification-profile`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ notificationTeamId: "smoke-team", wecomUserId: "smoke_partner", mentionOnProgress: true }),
  });
  if (notificationProfile.user?.notificationTeamId !== "smoke-team" || notificationProfile.user?.wecomUserId !== "smoke_partner") {
    throw new Error("User project notification profile was not persisted safely.");
  }
  const distributorLogin = await expectJson("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke-partner", password: distributorPassword }),
  });
  if (!distributorLogin.user?.permissions?.includes("movement") || distributorLogin.user?.permissions?.includes("direct_price") || distributorLogin.user?.notificationTeamId !== "smoke-team") {
    throw new Error("Distributor effective permissions did not grant movement while enforcing the direct-price hard deny.");
  }
  const distributorHeaders = { Authorization: `Bearer ${distributorLogin.token}` };
  const initialDistributorProducts = await expectJson("/api/products?mode=detail", { headers: distributorHeaders });
  const scopedProduct = initialDistributorProducts.catalog?.[0];
  if (!scopedProduct?.sku || !scopedProduct?.country) throw new Error("Distributor sample catalog did not provide a SKU and country for data-scope testing.");
  await expectJson(`/api/users/${encodeURIComponent(distributorId)}/permissions`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ dataScopes: { countries: [scopedProduct.country], warehouseIds: [], skus: [scopedProduct.sku] } }),
  });
  await expectJson(`/api/users/${encodeURIComponent(distributorId)}/permissions`, {
    method: "PATCH",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ permissionOverrides: { allow: ["movement", "direct_price"], deny: ["inventory"] } }),
  });
  const refreshedDistributor = await expectJson("/api/me", { headers: distributorHeaders });
  if (!refreshedDistributor.user?.permissions?.includes("movement") || refreshedDistributor.user?.permissions?.includes("direct_price") || refreshedDistributor.user?.permissions?.includes("inventory")) {
    throw new Error("Updated distributor permissions were not applied to the active session immediately.");
  }
  if (refreshedDistributor.user?.dataScopes?.skus?.[0] !== scopedProduct.sku.toUpperCase()) {
    throw new Error("Partial permission updates did not preserve distributor data scopes.");
  }
  const distributorProducts = await expectJson("/api/products?mode=detail", { headers: distributorHeaders });
  for (const forbiddenKey of ["directPrice", "directCostPrice", "directCurrency", "directCostCurrency", "raw"]) {
    if (containsObjectKey(distributorProducts, forbiddenKey)) {
      throw new Error(`/api/products leaked forbidden distributor field: ${forbiddenKey}`);
    }
  }
  for (const forbiddenInventoryKey of ["stockQty", "lockedQty", "inTransitQty", "warehouseTotalQty", "warehouseOnlyInventory"]) {
    if (containsObjectKey(distributorProducts, forbiddenInventoryKey)) {
      throw new Error(`/api/products leaked inventory field after inventory permission was denied: ${forbiddenInventoryKey}`);
    }
  }
  if ((distributorProducts.catalog || []).some((item) => item.country !== scopedProduct.country || ![item.sku, item.skuNo, item.countrySku].map((value) => String(value || "").toUpperCase()).includes(scopedProduct.sku.toUpperCase()))) {
    throw new Error("Distributor product data scope returned a catalog row outside its country/SKU limits.");
  }
  const distributorMovement = await expectJson("/api/movement", { headers: distributorHeaders });
  if ((distributorMovement.items || []).some((item) => "availableQty" in item || "warehouseBreakdown" in item)) {
    throw new Error("Sales-only movement permission leaked inventory fields.");
  }
  const unauthorizedUsers = await fetch(`${baseUrl}/api/users`, { headers: distributorHeaders });
  if (unauthorizedUsers.status !== 401) {
    throw new Error(`Non-admin distributor unexpectedly accessed user administration: ${unauthorizedUsers.status}`);
  }
  await expectJson(`/api/users/${encodeURIComponent(distributorId)}`, { method: "DELETE", headers: authHeaders });
  console.log("[ok] configurable distributor permissions and direct-price non-penetration");

  const operatingSummary = await expectJson("/api/wecom-notifications/operating-summary", {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ dryRun: true, linkUrl: "#dashboard", linkText: "View dashboard" }),
  });
  if (!String(operatingSummary.content || "").includes("同舟今日经营摘要")) {
    throw new Error("/api/wecom-notifications/operating-summary did not generate the expected summary content.");
  }
  console.log("[ok] /api/wecom-notifications/operating-summary dry run");
}

try {
  await main();
} finally {
  clearTimeout(timer);
  child.kill();
  webhookServer.close();
  rmSync(smokeCacheDir, { recursive: true, force: true });
  rmSync(smokeBackupDir, { recursive: true, force: true });
}

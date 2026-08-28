import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndexPath = resolve(repoRoot, "dist", "index.html");
const port = String(22000 + Math.floor(Math.random() * 10000));
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "smoke-internal-code";
const timeoutMs = 30000;
const smokeCacheDir = mkdtempSync(join(tmpdir(), "tongzhou-smoke-"));
const movementHistoryDbPath = resolve(smokeCacheDir, "movement-history.sqlite");

writeFileSync(resolve(smokeCacheDir, "orders-sync.json"), JSON.stringify({
  syncedAt: "2026-08-28T00:00:00.000Z",
  results: [],
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
    salesAmountScope: "line",
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
    ORDER_SYNC_TIMEOUT_MS: "1000",
    WAREHOUSE_TEST_TIMEOUT_MS: "2000",
    WMS_REQUEST_TIMEOUT_MS: "2000",
    MOVEMENT_HISTORY_DB_PATH: movementHistoryDbPath,
    CACHE_DIR: smokeCacheDir,
    SKIP_ENV_FILE: "true",
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

  await expectHtmlRoot();
  console.log("[ok] Root frontend fallback");

  const login = await expectJson("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
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
  if (unauthorizedComparison.status !== 401) {
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
  console.log("[ok] /api/stockup");

  const warehouses = await expectJson("/api/warehouses", { headers: authHeaders });
  if (!Array.isArray(warehouses.lastSync?.warehouseOnlyInventory) || !Array.isArray(warehouses.lastSync?.productMissingWarehouseItems)) {
    throw new Error("/api/warehouses did not return both SKU governance lists.");
  }
  console.log("[ok] /api/warehouses");

  const unauthorizedMiaoshou = await fetch(`${baseUrl}/api/miaoshou`);
  if (unauthorizedMiaoshou.status !== 401) {
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
  const distributorLogin = await expectJson("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "smoke-partner", password: distributorPassword }),
  });
  if (!distributorLogin.user?.permissions?.includes("movement") || distributorLogin.user?.permissions?.includes("direct_price")) {
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
  rmSync(smokeCacheDir, { recursive: true, force: true });
}

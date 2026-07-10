import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndexPath = resolve(repoRoot, "dist", "index.html");
const port = String(22000 + Math.floor(Math.random() * 10000));
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "smoke-internal-code";
const timeoutMs = 30000;
const movementHistoryDbPath = resolve(repoRoot, ".cache", `smoke-movement-history-${port}.sqlite`);

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
  if (login.user?.role !== "direct" || !login.token) {
    throw new Error(`/api/login did not return a direct user token: ${JSON.stringify(login).slice(0, 500)}`);
  }
  console.log("[ok] Direct login");

  const authHeaders = { Authorization: `Bearer ${login.token}` };
  const me = await expectJson("/api/me", { headers: authHeaders });
  if (me.user?.role !== "direct") {
    throw new Error(`/api/me did not preserve direct role: ${JSON.stringify(me).slice(0, 500)}`);
  }
  console.log("[ok] /api/me direct session");

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
  const movementHistoryExport = await fetch(`${baseUrl}/api/movement-history/export?date=${encodeURIComponent(movementHistoryCapture.snapshot.date)}&timezone=Asia%2FShanghai`, {
    headers: authHeaders,
  });
  const movementHistoryCsv = await movementHistoryExport.text();
  if (!movementHistoryExport.ok || !movementHistoryCsv.includes("日期,时区,仓库")) {
    throw new Error(`/api/movement-history/export did not return the expected CSV: ${movementHistoryCsv.slice(0, 200)}`);
  }
  console.log("[ok] /api/movement-history");

  await expectJson("/api/stockup", { headers: authHeaders });
  console.log("[ok] /api/stockup");

  const warehouses = await expectJson("/api/warehouses", { headers: authHeaders });
  if (!Array.isArray(warehouses.lastSync?.warehouseOnlyInventory) || !Array.isArray(warehouses.lastSync?.productMissingWarehouseItems)) {
    throw new Error("/api/warehouses did not return both SKU governance lists.");
  }
  console.log("[ok] /api/warehouses");

  await expectJson("/api/distributor-applications", { headers: authHeaders });
  console.log("[ok] /api/distributor-applications");

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
  rmSync(movementHistoryDbPath, { force: true });
}

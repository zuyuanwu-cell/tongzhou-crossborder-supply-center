import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fetch } from "undici";
import { createSkuCodingRegistry } from "../server/sku-coding-registry.js";
import { createSkuCodingService } from "../server/sku-coding-service.js";

const unitDir = mkdtempSync(join(tmpdir(), "tongzhou-sku-service-"));
try {
  const registry = createSkuCodingRegistry({ filePath: join(unitDir, "registry.json") });
  const workflow = {
    demands: [{ id: "demand-1", productName: "新品 A", demandBatchNo: "XQ-001" }],
    productOptions: [{ id: "old", sku: "TZKJ-IDWG033", productName: "旧品" }],
    productCodingQueue: [{ id: "product-1", productName: "新品 A", sourceDemandRecordId: "demand-1", sourceDemandBatchNo: "XQ-001" }],
  };
  const calls = [];
  const service = createSkuCodingService({
    registry,
    completeProductCodingFn: async (input) => ({ ok: true, productRecordId: "jdy-product-1", demandRecordId: "demand-1", sku: input.sku }),
    createWarehouseProductFn: async (connection, product) => {
      calls.push({ connection: connection.id, product });
      if (connection.id === "bad-wms") throw new Error("模拟 WMS 失败");
      return { ok: true, externalId: `${connection.id}:${product.sku}` };
    },
    resolveConnection: (id) => ({ id, providerId: id === "ru-wms" ? "yunwms_ru" : "sea_wms" }),
  });
  const snapshot = service.snapshot(workflow, []);
  const idwg = snapshot.rules.find((item) => item.prefix === "TZKJ-IDWG");
  const reservation = service.reserve({ ruleId: idwg.id, productRecordId: "product-1" }, workflow, { id: "admin", name: "管理员" });
  assert.equal(reservation.sku, "TZKJ-IDWG034");
  const archived = await service.complete({
    reservationId: reservation.id,
    productRecordId: "product-1",
    warehouseConnectionIds: ["good-wms", "bad-wms"],
    product: { productName: "新品 A", productNameEn: "New A", weightKg: 0.2 },
  }, workflow, { id: "admin", name: "管理员" });
  assert.equal(archived.status, "partial");
  assert.equal(archived.warehouseResults.filter((item) => item.status === "success").length, 1);
  assert.equal(archived.warehouseResults.filter((item) => item.status === "failed").length, 1);
  assert.equal(calls[0].product.sku, "TZKJ-IDWG034");
  assert.equal(registry.getReservation(reservation.id).jdyRecordId, "jdy-product-1");

  const retried = await service.retry({ reservationId: reservation.id, warehouseConnectionIds: ["bad-wms"] }, { id: "admin", name: "管理员" }, {
    createWarehouseProductFn: async (connection, product) => ({ ok: true, externalId: `${connection.id}:${product.sku}` }),
  });
  assert.equal(retried.status, "completed");
  assert.equal(retried.warehouseResults.every((item) => item.status === "success"), true);
} finally {
  rmSync(unitDir, { recursive: true, force: true });
}

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-sku-api-"));
const port = 21787 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "sku-coding-api-test";
let child = null;

writeFileSync(join(cacheDir, "stockup-workflow.json"), JSON.stringify({
  ok: true,
  source: "test",
  syncedAt: "2026-10-13T00:00:00.000Z",
  warnings: [],
  counts: { demands: 1, pendingDemands: 0, pendingExecutionLines: 0, pendingShipmentLines: 0, pendingCostShipments: 0, pendingLockShipments: 0, activeExecutionLines: 0, activeWorkItems: 1, stockupOrders: 0, stockupLines: 0, shipments: 0, shipmentLines: 0, fees: 0, feeAmountCny: 0, costBatches: 0, lockedCostBatches: 0, codingQueue: 1 },
  demands: [{ id: "demand-api", demandBatchNo: "XQ-API", productName: "API 新品", sku: "" }],
  stockupOrders: [], stockupLines: [], shipments: [], fees: [], costBatches: [], costLedger: [],
  productOptions: [{ id: "old-api", sku: "TZKJ-IDWG033", productName: "历史商品" }],
  productCodingQueue: [{ id: "product-api", productName: "API 新品", temporaryProductNo: "TMP-API", sourceDemandRecordId: "demand-api", sourceDemandBatchNo: "XQ-API", skuCodingStatus: "待编码" }],
}), "utf8");

function startServer() {
  child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      CACHE_DIR: cacheDir,
      INTERNAL_ACCESS_CODE: accessCode,
      AUTH_SESSION_SECRET: "sku-coding-api-session",
      NODE_ENV: "development",
      SKIP_ENV_FILE: "true",
      SYNC_SCHEDULER_ENABLED: "false",
      BACKGROUND_JOBS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child?.exitCode !== null) throw new Error(`server exited: ${child?.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server start timeout");
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

async function jsonRequest(path, { token = "", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json() };
}

try {
  startServer();
  await waitForServer();
  const login = await jsonRequest("/api/login", { method: "POST", body: { code: accessCode } });
  assert.equal(login.response.status, 200);
  const token = login.payload.token;

  const initial = await jsonRequest("/api/stockup/workflow/product-coding", { token });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.rules.find((item) => item.prefix === "TZKJ-IDWG").nextSku, "TZKJ-IDWG034");

  const custom = await jsonRequest("/api/stockup/workflow/product-coding/rules", {
    token, method: "PUT", body: { name: "ABC 自主品牌", prefix: "TZKJ-ABC", digits: 3, kind: "自主品牌", brand: "ABC", enabled: true },
  });
  assert.equal(custom.response.status, 200);
  assert.equal(custom.payload.rule.nextSku, "TZKJ-ABC001");

  const reserved = await jsonRequest("/api/stockup/workflow/product-coding/reservations", {
    token, method: "POST", body: { ruleId: "rule-idwg", productRecordId: "product-api" },
  });
  assert.equal(reserved.response.status, 201);
  assert.equal(reserved.payload.reservation.sku, "TZKJ-IDWG034");

  const dryRun = await jsonRequest("/api/stockup/workflow/product-coding", {
    token, method: "POST", body: { reservationId: reserved.payload.reservation.id, productRecordId: "product-api", product: { productName: "API 新品", brand: "测试品牌" }, dryRun: true },
  });
  assert.equal(dryRun.response.status, 200);
  assert.equal(dryRun.payload.sku, "TZKJ-IDWG034");

  const cancelled = await jsonRequest(`/api/stockup/workflow/product-coding/reservations/${encodeURIComponent(reserved.payload.reservation.id)}`, {
    token, method: "DELETE", body: { reason: "测试撤销" },
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.reservation.status, "cancelled");
  console.log("sku coding API tests passed");
} finally {
  await stopServer();
  rmSync(cacheDir, { recursive: true, force: true });
}

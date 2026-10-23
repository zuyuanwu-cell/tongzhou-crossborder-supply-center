import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

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

const sourceDb = resolve(process.env.STOCKUP_COLLABORATION_DB_PATH || resolve(process.cwd(), ".cache/stockup-collaboration.sqlite"));
const requestNo = String(process.env.STOCKUP_HANDOFF_REPRO_REQUEST_NO || "BR-20261020-AKUR0");
const temp = mkdtempSync(resolve(tmpdir(), "stockup-production-handoff-repro-"));
const clonedDb = resolve(temp, "stockup-clone.sqlite");

try {
  copyFileSync(sourceDb, clonedDb);
  const store = await initStockupCollaborationStore(clonedDb);
  const service = createStockupCollaborationService(store);
  const context = { auth: { role: "admin", user: { id: "production-repro", displayName: "生产只读复现" } }, viewAll: true, viewCost: true, revealSupplier: true };
  const request = service.listRequests({ keyword: requestNo, page: 1, pageSize: 100 }, context).items.find((item) => item.requestNo === requestNo);
  assert.ok(request, `未找到备货需求 ${requestNo}`);

  const lines = request.lines
    .filter((line) => line.status !== "procurement_cancelled")
    .map((line) => ({ requestLineId: line.id, expectedQty: Math.max(0, Number(line.purchaseReceivedQty || 0) - Number(line.warehouseExpectedQty || 0)) }))
    .filter((line) => line.expectedQty > 0);
  assert.ok(lines.length, `${requestNo} 没有可移交的采购到货商品`);

  const workOrder = service.createWarehouseWorkOrder({
    requestId: request.id,
    organizationCode: "production-repro-warehouse",
    domesticWarehouseId: "production-repro-warehouse",
    domesticWarehouseName: "生产数据副本验证仓",
    submit: true,
    lines,
  }, context, `production-repro:${request.id}`).workOrder;

  const blockedSkus = request.lines.filter((line) => Number(line.purchaseReceivedQty || 0) <= Number(line.warehouseExpectedQty || 0)).map((line) => line.sku);
  assert.equal(workOrder.lines.some((line) => blockedSkus.includes(line.sku)), false, "无采购到货数量的商品不应进入国内仓工单");
  console.log(JSON.stringify({
    ok: true,
    sourceDatabaseMutated: false,
    requestNo,
    submittedSkuCount: workOrder.lines.length,
    submittedExpectedQty: workOrder.expectedQty,
    excludedSkus: blockedSkus,
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

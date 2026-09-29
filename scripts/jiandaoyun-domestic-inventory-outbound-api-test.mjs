import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";
import { createJiandaoyunDomesticInventoryOutboundApi } from "../server/jiandaoyun-domestic-inventory-outbound-api.js";

const temp = mkdtempSync(resolve(tmpdir(), "jiandaoyun-domestic-outbound-"));
try {
  const store = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const service = createDomesticInventoryService(store);
  const adminAuth = { role: "admin", user: { id: "admin", displayName: "管理员", role: "admin", dataScopes: {} } };
  const context = { auth: adminAuth, countries: [], warehouseIds: [], skus: [] };
  const warehouse = service.createWarehouse({ code: "CN-GZ-01", name: "广州成品仓" }, context).warehouse;
  service.createMovement({
    warehouseId: warehouse.id,
    type: "inbound",
    referenceNo: "IN-A",
    lines: [{ sku: "TZKJ-TEST-001", productName: "测试成品", unit: "件", quantity: 10, lotNo: "LOT-A", barcode: "690000000001" }],
  }, context, "seed-a");
  service.createMovement({
    warehouseId: warehouse.id,
    type: "inbound",
    referenceNo: "IN-B",
    lines: [{ sku: "TZKJ-TEST-001", productName: "测试成品", unit: "件", quantity: 8, lotNo: "LOT-B", barcode: "690000000002" }],
  }, context, "seed-b");

  const actions = [];
  const handler = createJiandaoyunDomesticInventoryOutboundApi({
    service,
    token: "test-outbound-token",
    appendActionLog: (...args) => actions.push(args),
  });

  async function invoke(body, token = "test-outbound-token") {
    const request = Readable.from([JSON.stringify(body)]);
    request.method = "POST";
    request.headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const response = {
      statusCode: 0,
      headers: {},
      body: "",
      writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
      end(chunk = "") { this.body += String(chunk); },
    };
    const handled = await handler(request, response, new URL("/api/integrations/jiandaoyun/domestic-inventory/outbound", "http://localhost"));
    return { handled, status: response.statusCode, payload: JSON.parse(response.body) };
  }

  const base = {
    warehouse: "CN-GZ-01",
    sourceRecordId: "jdy-outbound-001",
    sourceLineId: "line-001",
    sourceType: "国内仓发货单",
    referenceNo: "CKSQ-2026-001",
    sku: " tzkj-test-001 ",
    quantity: 4,
    lotNo: "LOT-A",
  };

  const unauthorized = await invoke(base, "wrong-token");
  assert.equal(unauthorized.status, 401);

  const preview = await invoke({ ...base, dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.dryRun, true);
  assert.equal(preview.payload.beforeQty, 18);
  assert.equal(preview.payload.afterQty, 14);
  assert.equal(service.list({ warehouseId: warehouse.id }, context).balances[0].onHandQty, 18);

  const created = await invoke(base);
  assert.equal(created.status, 201);
  assert.match(created.payload.movementNo, /^CK-/);
  assert.equal(created.payload.productName, "测试成品");
  assert.equal(created.payload.beforeQty, 18);
  assert.equal(created.payload.afterQty, 14);
  assert.equal(service.listLots({ warehouseId: warehouse.id, lotNo: "LOT-A" }, context).lots[0].remainingQty, 6);
  assert.equal(service.listLots({ warehouseId: warehouse.id, lotNo: "LOT-B" }, context).lots[0].remainingQty, 8);

  const replay = await invoke({ ...base, quantity: 12 });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.idempotentReplay, true);
  assert.equal(replay.payload.quantity, 4);
  assert.equal(service.list({ warehouseId: warehouse.id }, context).balances[0].onHandQty, 14);

  const insufficientBatch = await invoke({ ...base, sourceRecordId: "jdy-outbound-002", sourceLineId: "line-002", quantity: 7 });
  assert.equal(insufficientBatch.status, 409);
  assert.equal(insufficientBatch.payload.code, "insufficient_lot_stock");
  assert.equal(service.list({ warehouseId: warehouse.id }, context).balances[0].onHandQty, 14);

  const fifo = await invoke({ ...base, sourceRecordId: "jdy-outbound-003", sourceLineId: "line-003", lotNo: "", quantity: 8 });
  assert.equal(fifo.status, 201);
  assert.equal(service.list({ warehouseId: warehouse.id }, context).balances[0].onHandQty, 6);
  assert.equal(service.listLots({ warehouseId: warehouse.id, lotNo: "LOT-A" }, context).lots[0].remainingQty, 0);
  assert.equal(service.listLots({ warehouseId: warehouse.id, lotNo: "LOT-B" }, context).lots[0].remainingQty, 6);

  const insufficient = await invoke({ ...base, sourceRecordId: "jdy-outbound-004", sourceLineId: "line-004", lotNo: "", quantity: 7 });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.payload.code, "insufficient_stock");
  assert.equal(actions.length, 3);

  console.log("jiandaoyun domestic inventory outbound API tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}


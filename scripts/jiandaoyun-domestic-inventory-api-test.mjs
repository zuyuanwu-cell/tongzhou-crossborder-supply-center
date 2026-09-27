import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { initDomesticInventoryStore } from "../server/domestic-inventory-db.js";
import { createDomesticInventoryService } from "../server/domestic-inventory-service.js";
import { createJiandaoyunDomesticInventoryApi } from "../server/jiandaoyun-domestic-inventory-api.js";

const temp = mkdtempSync(resolve(tmpdir(), "jiandaoyun-domestic-inventory-"));
try {
  const store = await initDomesticInventoryStore(resolve(temp, "inventory.sqlite"));
  const service = createDomesticInventoryService(store);
  const adminAuth = { role: "admin", user: { id: "admin", displayName: "管理员", role: "admin", dataScopes: {} } };
  const context = { auth: adminAuth, countries: [], warehouseIds: [], skus: [] };
  const warehouse = service.createWarehouse({ code: "CN-GZ-01", name: "广州成品仓" }, context).warehouse;
  const actions = [];
  const handler = createJiandaoyunDomesticInventoryApi({
    service,
    token: "test-plugin-token",
    appendActionLog: (...args) => actions.push(args),
  });

  async function invoke(body, token = "test-plugin-token") {
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
    const handled = await handler(request, response, new URL("/api/integrations/jiandaoyun/domestic-inventory/inbound", "http://localhost"));
    return { handled, status: response.statusCode, payload: JSON.parse(response.body) };
  }

  const base = {
    warehouse: "CN-GZ-01",
    sourceRecordId: "jdy-data-001",
    sourceType: "委外入库单",
    referenceNo: "WWRK-2026-001",
    sku: "tzkj-test-001",
    productName: "测试成品",
    quantity: 21,
    unit: "件",
    packagingMode: "carton",
    cartonCount: 2,
    unitsPerCarton: 10,
    looseQuantity: 1,
    cartonLengthCm: 40,
    cartonWidthCm: 30,
    cartonHeightCm: 20,
    cartonWeightKg: 8,
    lotNo: "LOT-001",
    barcode: "690000000001",
    productionDate: "2026-09-20",
  };

  const unauthorized = await invoke(base, "wrong-token");
  assert.equal(unauthorized.status, 401);

  const preview = await invoke({ ...base, dryRun: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.dryRun, true);
  assert.equal(service.list({}, context).balances.length, 0);

  const created = await invoke(base);
  assert.equal(created.status, 201);
  assert.equal(created.payload.warehouseId, warehouse.id);
  assert.equal(created.payload.sku, "TZKJ-TEST-001");
  assert.equal(service.list({}, context).balances[0].onHandQty, 21);

  const replay = await invoke({ ...base, quantity: 99 });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.idempotentReplay, true);
  assert.equal(service.list({}, context).balances[0].onHandQty, 21);
  assert.equal(actions.length, 2);

  const invalidCarton = await invoke({ ...base, sourceRecordId: "jdy-data-002", cartonCount: 1 });
  assert.equal(invalidCarton.status, 400);
  assert.equal(invalidCarton.payload.code, "packaging_quantity_mismatch");

  const missingWarehouse = await invoke({ ...base, sourceRecordId: "jdy-data-003", warehouse: "不存在仓" });
  assert.equal(missingWarehouse.status, 404);
  assert.equal(missingWarehouse.payload.code, "warehouse_not_found");

  console.log("jiandaoyun domestic inventory API tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

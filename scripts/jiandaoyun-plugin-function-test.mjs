import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("integrations/jiandaoyun-domestic-inventory/inbound-function.js"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let request = null;
const requireForTest = (name) => {
  assert.equal(name, "axios");
  return async (options) => {
    request = options;
    return { data: { ok: true, message: "校验通过，未写入库存。", dryRun: true, warehouseId: "dwh-1", warehouseCode: "CN-GZ-01", warehouseName: "广州成品仓", sku: "TZKJ-001", quantity: 20 } };
  };
};

const execute = new AsyncFunction("require", "agentConf", "triggerConf", source);
const output = await execute(requireForTest, {
  apiBaseUrl: "https://gyl.tongzhoukuajing.com/",
  accessToken: "secret-token",
}, {
  warehouse: "CN-GZ-01",
  sourceRecordId: "data-1",
  sourceType: "委外入库单",
  sku: " tzkj-001 ",
  productName: "产品一",
  quantity: "20",
  packagingMode: "按箱",
  cartonCount: 2,
  unitsPerCarton: 10,
  cartonLengthCm: 40,
  cartonWidthCm: 30,
  cartonHeightCm: 20,
  cartonWeightKg: 8,
  dryRun: "是",
});

assert.equal(request.url, "https://gyl.tongzhoukuajing.com/api/integrations/jiandaoyun/domestic-inventory/inbound");
assert.equal(request.headers.Authorization, "Bearer secret-token");
assert.equal(request.data.sku, "TZKJ-001");
assert.equal(request.data.packagingMode, "carton");
assert.equal(request.data.dryRun, true);
assert.equal(output.success, true);
assert.equal(output.movementNo, "");
console.log("jiandaoyun plugin function tests passed");

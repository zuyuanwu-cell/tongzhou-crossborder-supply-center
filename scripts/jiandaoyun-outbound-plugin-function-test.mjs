import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve("integrations/jiandaoyun-domestic-inventory-outbound/outbound-function.js"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let request = null;
const requireForTest = (name) => {
  assert.equal(name, "axios");
  return async (options) => {
    request = options;
    return { data: { ok: true, message: "校验通过，未扣减库存。", dryRun: true, warehouseId: "dwh-1", warehouseCode: "CN-GZ-01", warehouseName: "广州成品仓", sku: "TZKJ-001", productName: "测试产品", unit: "件", quantity: 20, beforeQty: 100, afterQty: 80 } };
  };
};

const execute = new AsyncFunction("require", "agentConf", "triggerConf", source);
const output = await execute(requireForTest, {
  apiBaseUrl: "https://gyl.tongzhoukuajing.com/",
  accessToken: "outbound-secret-token",
}, {
  warehouse: "CN-GZ-01",
  sourceRecordId: "data-1",
  sourceLineId: "line-1",
  sourceType: "发货出库单",
  sku: " tzkj-001 ",
  quantity: "20",
  lotNo: "LOT-001",
  dryRun: "是",
});

assert.equal(request.url, "https://gyl.tongzhoukuajing.com/api/integrations/jiandaoyun/domestic-inventory/outbound");
assert.equal(request.headers.Authorization, "Bearer outbound-secret-token");
assert.equal(request.data.sku, "TZKJ-001");
assert.equal(request.data.lotNo, "LOT-001");
assert.equal(request.data.dryRun, true);
assert.equal(output.success, true);
assert.equal(output.beforeQty, 100);
assert.equal(output.afterQty, 80);
console.log("jiandaoyun outbound plugin function tests passed");


import assert from "node:assert/strict";
import { normalizeWarehouseConnectionBindings, resolveWarehouseBinding, warehouseBindingChanged } from "../server/warehouse-binding.js";
import { normalizeWarehouseCosts } from "../server/normalize-products.js";

const existingYun = {
  providerId: "yunwms_ru",
  warehouseCode: "",
  warehouseId: "DD002",
  resolvedWarehouseId: "DD002",
};

assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "DD001", warehouseId: "DD002" }, existingYun),
  { warehouseCode: "DD001", warehouseId: "DD001", resolvedWarehouseId: "DD001" },
);
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "" }, existingYun),
  { warehouseCode: "DD002", warehouseId: "DD002", resolvedWarehouseId: "DD002" },
);
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "yunwms_ru", warehouseCode: "MX001" }, null),
  { warehouseCode: "MX001", warehouseId: "MX001", resolvedWarehouseId: "MX001" },
);

const existingSea = {
  providerId: "sea_wms",
  warehouseCode: "ID-JKT",
  warehouseId: "56064",
  resolvedWarehouseId: "56064",
};
assert.deepEqual(
  resolveWarehouseBinding({ providerId: "sea_wms", warehouseCode: "ID-JKT", warehouseId: "56065" }, existingSea),
  { warehouseCode: "ID-JKT", warehouseId: "56065", resolvedWarehouseId: "56065" },
);
assert.equal(warehouseBindingChanged(existingYun, { ...existingYun, warehouseCode: "DD001", warehouseId: "DD001" }), true);
assert.equal(warehouseBindingChanged(existingYun, { ...existingYun, baseUrl: `${existingYun.baseUrl || "https://example.com"}/` }), true);
assert.equal(warehouseBindingChanged(existingYun, { ...existingYun }), false);

const untouchedSeaConnection = { id: "sea-id", providerId: "sea_wms", warehouseCode: "YINNI", warehouseId: "56064" };
const normalizedConnections = normalizeWarehouseConnectionBindings([
  {
    id: "ru-warehouse-2",
    name: "俄罗斯2仓",
    providerId: "yunwms_ru",
    warehouseCode: "DD001",
    warehouseId: "",
    resolvedWarehouseId: "",
  },
  {
    id: "ru-warehouse-1",
    name: "俄罗斯1仓",
    providerId: "yunwms_ru",
    warehouseCode: "",
    warehouseId: "MX001",
    resolvedWarehouseId: "",
  },
  untouchedSeaConnection,
]);
assert.equal(normalizedConnections.changed, true);
assert.equal(normalizedConnections.changedCount, 2);
assert.deepEqual(
  normalizedConnections.connections.slice(0, 2).map(({ name, warehouseCode, warehouseId, resolvedWarehouseId }) => ({ name, warehouseCode, warehouseId, resolvedWarehouseId })),
  [
    { name: "俄罗斯2仓", warehouseCode: "DD001", warehouseId: "DD001", resolvedWarehouseId: "DD001" },
    { name: "俄罗斯1仓", warehouseCode: "MX001", warehouseId: "MX001", resolvedWarehouseId: "MX001" },
  ],
);
assert.equal(normalizedConnections.connections[2], untouchedSeaConnection, "SEA WMS connections must not be changed");
assert.deepEqual(
  new Set(normalizedConnections.changedWarehouseIds),
  new Set(["ru-warehouse-2", "DD001", "ru-warehouse-1", "MX001"]),
);

const customYunCode = normalizeWarehouseConnectionBindings([{
  id: "ru-warehouse-1-custom",
  name: "俄罗斯1仓",
  providerId: "yunwms_ru",
  warehouseCode: "NEW001",
  warehouseId: "NEW001",
  resolvedWarehouseId: "NEW001",
}]);
assert.equal(customYunCode.changed, false, "an explicit administrator-configured warehouse code must not be overwritten");
assert.equal(customYunCode.connections[0].warehouseCode, "NEW001");

const alreadyNormalizedConnections = normalizeWarehouseConnectionBindings(normalizedConnections.connections);
assert.equal(alreadyNormalizedConnections.changed, false, "the migration must be idempotent");
assert.equal(alreadyNormalizedConnections.changedCount, 0);
assert.deepEqual(alreadyNormalizedConnections.changedWarehouseIds, []);

assert.deepEqual(
  normalizeWarehouseCosts([{
    _id: "cost-1",
    updateTime: "2026-10-09T08:49:37.141Z",
    _widget_1772266457311: " tzkj-nk001 ",
    _widget_1772266457312: "NatureKiss 脱毛膏",
    _widget_1772266457342: 11.01,
    _widget_1772266457355: "正常",
  }]),
  [{
    id: "cost-1",
    warehouseCode: "DD001",
    warehouseName: "俄罗斯2仓",
    sku: "TZKJ-NK001",
    productName: "NatureKiss 脱毛膏",
    unitCostCny: 11.01,
    productStatus: "正常",
    effectiveAt: "2026-10-09T08:49:37.141Z",
    source: "jiandaoyun_weighted_supply_price",
  }],
);

console.log("warehouse binding tests passed");

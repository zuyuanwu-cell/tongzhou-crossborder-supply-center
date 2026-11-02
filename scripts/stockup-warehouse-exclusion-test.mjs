import assert from "node:assert/strict";
import {
  excludeMovementWarehouses,
  isExcludedWarehouseRecord,
  resolveExcludedWarehouseIdentifiers,
} from "../server/movement-access.js";

const connections = [
  {
    id: "connection-guotou",
    warehouseId: "warehouse-guotou",
    resolvedWarehouseId: "WMS-GT-01",
    name: "国投仓",
  },
  {
    id: "connection-yinni",
    warehouseId: "warehouse-yinni",
    resolvedWarehouseId: "WMS-ID-01",
    name: "神牛印尼仓",
  },
];

const excludedIdentifiers = resolveExcludedWarehouseIdentifiers(connections, ["connection-guotou"]);
assert.deepEqual(
  [...excludedIdentifiers].sort(),
  ["WMS-GT-01", "connection-guotou", "warehouse-guotou"].sort(),
  "选择连接编号后应同时排除连接、配置仓库和 WMS 解析仓库编号",
);
assert.equal(isExcludedWarehouseRecord({ warehouseId: "WMS-GT-01" }, excludedIdentifiers), true);
assert.equal(isExcludedWarehouseRecord({ warehouseId: "WMS-ID-01" }, excludedIdentifiers), false);

const sources = {
  products: { catalog: [{ id: "sku-1" }, { id: "sku-2" }] },
  warehouse: {
    products: [
      { sku: "sku-1", warehouseId: "WMS-GT-01", quantity: 100 },
      { sku: "sku-2", warehouseId: "WMS-ID-01", quantity: 20 },
    ],
    inventory: [
      { sku: "sku-1", warehouseId: "warehouse-guotou", quantity: 100 },
      { sku: "sku-2", warehouseId: "warehouse-yinni", quantity: 20 },
    ],
    results: [
      { warehouseId: "connection-guotou", ok: true },
      { warehouseId: "connection-yinni", ok: true },
    ],
  },
  orders: {
    orders: [
      { id: "order-1", warehouseId: "WMS-GT-01" },
      { id: "order-2", warehouseId: "WMS-ID-01" },
    ],
    results: [
      { warehouseId: "warehouse-guotou", count: 1 },
      { warehouseId: "warehouse-yinni", count: 1 },
    ],
  },
  connections,
};

const filtered = excludeMovementWarehouses(sources, ["connection-guotou"]);
assert.deepEqual(filtered.products, sources.products, "排除只影响仓库范围，不应删除产品档案");
assert.deepEqual(filtered.warehouse.products.map((item) => item.sku), ["sku-2"]);
assert.deepEqual(filtered.warehouse.inventory.map((item) => item.sku), ["sku-2"]);
assert.deepEqual(filtered.warehouse.results.map((item) => item.warehouseId), ["connection-yinni"]);
assert.deepEqual(filtered.orders.orders.map((item) => item.id), ["order-2"]);
assert.deepEqual(filtered.orders.results.map((item) => item.warehouseId), ["warehouse-yinni"]);
assert.deepEqual(filtered.connections.map((item) => item.id), ["connection-yinni"]);

console.log("STOCKUP_WAREHOUSE_EXCLUSION_TEST_OK");

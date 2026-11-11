import assert from "node:assert/strict";
import { collectWarehouseInventorySync } from "../server/warehouse-inventory-sync.js";

const output = await collectWarehouseInventorySync({
  connections: [{ id: "unconfigured" }, { id: "healthy" }],
  previousProducts: [{ warehouseId: "unconfigured", sku: "STALE-PRODUCT" }],
  previousInventory: [{ warehouseId: "unconfigured", sku: "STALE-INVENTORY", availableQty: 7 }],
  syncConnection: async (connection) => {
    if (connection.id === "unconfigured") throw new Error("explicit warehouse_code is required");
    return {
      warehouseId: connection.id,
      ok: true,
      skipped: false,
      products: [{ warehouseId: connection.id, sku: "FRESH-PRODUCT" }],
      inventory: [{ warehouseId: connection.id, sku: "FRESH-INVENTORY", availableQty: 11 }],
    };
  },
});

assert.deepEqual(output.results.map((item) => ({ warehouseId: item.warehouseId, ok: item.ok, stale: item.stale })), [
  { warehouseId: "unconfigured", ok: false, stale: true },
  { warehouseId: "healthy", ok: true, stale: false },
]);
assert.deepEqual(output.products.map((item) => item.sku), ["STALE-PRODUCT", "FRESH-PRODUCT"]);
assert.deepEqual(output.inventory.map((item) => item.sku), ["STALE-INVENTORY", "FRESH-INVENTORY"]);
assert.match(output.results[0].message, /warehouse_code/);
assert.equal(output.results[0].inventoryCount, 1);

console.log("warehouse inventory sync isolation tests passed");

import assert from "node:assert/strict";
import { buildMovementPayload } from "../server/movement-analytics.js";

const payload = buildMovementPayload(
  {
    catalog: [{
      id: "product-1",
      sku: "SKU-001",
      countrySku: "ID-SKU-001",
      name: "Test product",
      country: "印度尼西亚",
      unit: "件",
      stockQty: 30,
      lockedQty: 0,
      inTransitQty: 5,
      warehouseBreakdown: [{ warehouseId: "warehouse-1", warehouseName: "Jakarta" }],
    }],
    productBase: [],
  },
  { inventory: [] },
  { syncedAt: new Date().toISOString(), orders: [], results: [] },
);

assert.equal(payload.items.length, 1);
const [item] = payload.items;
assert.equal(item.identityScope, "SKU×国家");
assert.equal(item.dataCompleteness, "complete");
assert.equal(item.calculation.ruleVersion, "movement-v2");
assert.equal(item.calculation.window, "3/7/30/90天");
assert.equal(item.calculation.includesInTransit, false);
assert.match(item.calculation.formula, /7日均销/);

console.log("movement explainability tests passed");

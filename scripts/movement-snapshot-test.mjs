import assert from "node:assert/strict";
import { buildMovementSnapshotRows, movementSnapshotTotals } from "../server/movement-snapshot.js";

const item = {
  sku: "SKU-001",
  countrySku: "MY-SKU-001",
  name: "Test product",
  country: "马来西亚",
  availableQty: 15,
  lockedQty: 0,
  inTransitQty: 0,
  totalQty: 15,
  sales3: 6,
  sales7: 12,
  sales15: 18,
  sales30: 30,
  sales60: 40,
  sales90: 50,
  leadDays: 30,
  targetCoverDays: 50,
  source: "product",
  dataCompleteness: "complete",
  warehouseBreakdown: [
    { warehouseId: "shenniu-my", warehouseName: "神牛马来仓", availableQty: 10, lockedQty: 0, inTransitQty: 0, totalQty: 10 },
    { warehouseId: "dou-my", warehouseName: "斗仓", availableQty: 5, lockedQty: 0, inTransitQty: 0, totalQty: 5 },
  ],
  salesWarehouseBreakdown: [
    { warehouseId: "shenniu-my", warehouseName: "神牛马来仓", sales3: 6, sales7: 12, sales15: 18, sales30: 30, sales60: 40, sales90: 50 },
  ],
};

const rows = buildMovementSnapshotRows({ items: [item] }, [
  { id: "shenniu-my", name: "神牛马来仓", country: "马来西亚" },
  { id: "dou-my", name: "斗仓", country: "马来西亚" },
]);

assert.equal(rows.length, 2);
const shenniu = rows.find((row) => row.warehouseId === "shenniu-my");
const dou = rows.find((row) => row.warehouseId === "dou-my");
assert.equal(shenniu.sales30, 30, "warehouse-attributed sales remain on the matched warehouse");
assert.equal(dou.sales30, 0, "country sales are not copied to a warehouse without matched orders");
assert.equal(dou.salesAttribution, "warehouse_zero");
assert.equal(dou.dataGap, "");
assert.equal(dou.dataCompleteness, "complete");
assert.equal(dou.replenishQty, 0, "zero warehouse sales never create a replenishment quantity");

const totals = movementSnapshotTotals(rows);
assert.equal(totals.sales30, 30, "warehouse totals count country sales once");
assert.equal(totals.unattributedSalesRows, 0);

const [unallocated] = buildMovementSnapshotRows({
  items: [{ ...item, warehouseBreakdown: [], salesWarehouseBreakdown: [] }],
});
assert.equal(unallocated.sales30, 30, "an explicitly unallocated aggregate row keeps country-level sales");
assert.equal(unallocated.availableQty, 15);
assert.equal(unallocated.salesAttribution, "country");

const residualRows = buildMovementSnapshotRows({
  items: [{
    ...item,
    sales30: 35,
    sales60: 45,
    sales90: 60,
  }],
}, [
  { id: "shenniu-my", name: "神牛马来仓", country: "马来西亚" },
  { id: "dou-my", name: "斗仓", country: "马来西亚" },
]);
const residual = residualRows.find((row) => row.salesAttribution === "unallocated");
assert.ok(residual, "country sales not attributed to a warehouse stay visible as a residual row");
assert.equal(residual.warehouseName, "未分仓销量");
assert.equal(residual.availableQty, 0);
assert.equal(residual.sales30, 5);
assert.match(residual.dataGap, /warehouse_sales_unattributed/);
assert.equal(residual.replenishQty, 0);
assert.equal(movementSnapshotTotals(residualRows).sales30, 35);

console.log("movement snapshot attribution tests passed");

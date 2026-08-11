import assert from "node:assert/strict";
import { buildMovementComparison, resolveMovementComparisonRanges } from "../server/movement-comparison.js";

const monthRanges = resolveMovementComparisonRanges({ period: "month", anchorDate: "2026-08-11" });
assert.deepEqual(monthRanges.current, { from: "2026-08-01", to: "2026-08-31", label: "2026年8月" });
assert.deepEqual(monthRanges.previous, { from: "2026-07-01", to: "2026-07-31", label: "2026年7月" });

const weekRanges = resolveMovementComparisonRanges({ period: "week", anchorDate: "2026-08-11" });
assert.equal(weekRanges.current.from, "2026-08-10");
assert.equal(weekRanges.current.to, "2026-08-16");
assert.equal(weekRanges.previous.from, "2026-08-03");
assert.equal(weekRanges.previous.to, "2026-08-09");

const quarterRanges = resolveMovementComparisonRanges({ period: "quarter", anchorDate: "2026-08-11" });
assert.deepEqual(quarterRanges.current, { from: "2026-07-01", to: "2026-09-30", label: "2026年第3季度" });
assert.deepEqual(quarterRanges.previous, { from: "2026-04-01", to: "2026-06-30", label: "2026年第2季度" });

const yearRanges = resolveMovementComparisonRanges({ period: "year", anchorDate: "2026-08-11" });
assert.equal(yearRanges.current.from, "2026-01-01");
assert.equal(yearRanges.previous.from, "2025-01-01");

const customRanges = resolveMovementComparisonRanges({ period: "custom", from: "2026-08-01", to: "2026-08-10" });
assert.deepEqual(customRanges.previous, { from: "2026-07-22", to: "2026-07-31", label: "2026-07-22 至 2026-07-31" });

const previousRows = [
  {
    sku: "SKU-A",
    countrySku: "马来西亚-SKU-A",
    productName: "产品A",
    warehouseId: "warehouse-1",
    warehouseName: "测试仓",
    availableQty: 80,
    lockedQty: 20,
    sales30: 40,
    daysCover: 60,
    status: "健康",
  },
  {
    sku: "SKU-B",
    countrySku: "马来西亚-SKU-B",
    productName: "产品B",
    warehouseId: "warehouse-1",
    warehouseName: "测试仓",
    availableQty: 50,
    lockedQty: 0,
    sales30: 0,
    daysCover: null,
    status: "滞销",
  },
  {
    sku: "SKU-C",
    productName: "产品C",
    warehouseId: "warehouse-1",
    warehouseName: "测试仓",
    availableQty: 10,
    lockedQty: 0,
    sales30: 1,
    daysCover: 120,
    status: "慢销",
  },
];

const currentRows = [
  {
    ...previousRows[0],
    availableQty: 65,
    lockedQty: 5,
    sales30: 0,
    daysCover: null,
    status: "滞销",
  },
  {
    ...previousRows[1],
    availableQty: 45,
    sales30: 25,
    daysCover: 50,
    status: "健康",
  },
  {
    sku: "SKU-D",
    productName: "产品D",
    warehouseId: "warehouse-1",
    warehouseName: "测试仓",
    availableQty: 30,
    lockedQty: 0,
    sales30: 2,
    daysCover: 110,
    status: "慢销",
  },
];

const snapshots = [
  { date: "2026-07-31", timezone: "Asia/Shanghai", capturedAt: "2026-07-31T15:00:00.000Z", rows: previousRows },
  { date: "2026-08-11", timezone: "Asia/Shanghai", capturedAt: "2026-08-11T15:00:00.000Z", rows: currentRows },
];
const orders = [
  { warehouseId: "warehouse-1", sku: "SKU-A", quantity: 20, shippedAt: "2026-08-05 10:00:00" },
  { warehouseId: "warehouse-1", sku: "SKU-B", quantity: 5, shippedAt: "2026-08-06 10:00:00" },
  { warehouseId: "warehouse-1", sku: "UNKNOWN", quantity: 3, shippedAt: "2026-08-07 10:00:00" },
  { warehouseId: "warehouse-1", sku: "SKU-A", quantity: 999, shippedAt: "2026-07-31 10:00:00" },
];

const comparison = buildMovementComparison({
  snapshots,
  orders,
  ranges: monthRanges,
  warehouseId: "warehouse-1",
  ordersSyncedAt: "2026-08-11T16:00:00.000Z",
  orderCoverageDaysByWarehouse: { "warehouse-1": 90 },
});

assert.equal(comparison.currentSnapshot.date, "2026-08-11");
assert.equal(comparison.previousSnapshot.date, "2026-07-31");
assert.equal(comparison.summary.currentSku, 3);
assert.equal(comparison.summary.previousSku, 3);
assert.equal(comparison.summary.normal, 1);
assert.equal(comparison.summary.slow, 1);
assert.equal(comparison.summary.stagnant, 1);
assert.equal(comparison.summary.changed, 2);
assert.equal(comparison.summary.worsened, 1);
assert.equal(comparison.summary.improved, 1);
assert.equal(comparison.summary.added, 1);
assert.equal(comparison.summary.removed, 1);
assert.equal(comparison.summary.inventoryAnomaly, 1);
assert.equal(comparison.inventorySummary.openingOnHandQty, 150);
assert.equal(comparison.inventorySummary.closingOnHandQty, 115);
assert.equal(comparison.inventorySummary.outboundQty, 25);
assert.equal(comparison.inventorySummary.expectedClosingQty, 125);
assert.equal(comparison.inventorySummary.varianceQty, -10);
assert.equal(comparison.inventorySummary.unmatchedOrderRows, 1);
assert.equal(comparison.inventorySummary.unmatchedOutboundQty, 3);
assert.equal(comparison.inventorySummary.orderCoverageComplete, true);

const skuA = comparison.rows.find((row) => row.sku === "SKU-A");
assert.equal(skuA.previousStatus, "健康");
assert.equal(skuA.currentStatus, "滞销");
assert.equal(skuA.changeType, "worsened");
assert.equal(skuA.openingOnHandQty, 100);
assert.equal(skuA.outboundQty, 20);
assert.equal(skuA.expectedClosingQty, 80);
assert.equal(skuA.closingOnHandQty, 70);
assert.equal(skuA.inventoryVarianceQty, -10);
assert.equal(skuA.inventoryAnomaly, true);
assert.equal(skuA.inventoryReliable, true);

const skuB = comparison.rows.find((row) => row.sku === "SKU-B");
assert.equal(skuB.changeType, "improved");
assert.equal(skuB.inventoryVarianceQty, 0);
assert.equal(skuB.inventoryAnomaly, false);

const filtered = buildMovementComparison({
  snapshots,
  orders,
  ranges: monthRanges,
  warehouseId: "warehouse-1",
  sku: "产品A",
  ordersSyncedAt: "2026-08-11T16:00:00.000Z",
});
assert.equal(filtered.rows.length, 1);
assert.equal(filtered.rows[0].sku, "SKU-A");

console.log("[ok] movement comparison ranges");
console.log("[ok] SKU status changes");
console.log("[ok] inventory versus outbound reconciliation");
console.log("[ok] anomaly and order coverage metadata");

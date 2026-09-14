import assert from "node:assert/strict";
import { buildInventoryValuePayload } from "../server/inventory-value.js";

const products = {
  productBase: [
    { sku: "SKU-A", name: "产品A" },
    { sku: "SKU-B", name: "产品B" },
    { sku: "SKU-C", name: "产品C" },
    { sku: "SKU-D", name: "产品D" },
  ],
  catalog: [
    { sku: "SKU-A", name: "产品A", country: "印度尼西亚", directPrice: 10, directCurrency: "CNY" },
    { sku: "SKU-B", name: "产品B", country: "印度尼西亚", directPrice: 0, directCurrency: "CNY" },
    { sku: "SKU-D", name: "产品D", country: "印度尼西亚", directPrice: 7, directCurrency: "CNY" },
  ],
};

const snapshots = [
  {
    date: "2026-09-01",
    rows: [
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-A", availableQty: 10, inTransitQty: 2, totalQty: 12 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-B", lockedQty: 2, totalQty: 2 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-D", availableQty: 1, totalQty: 1 },
    ],
  },
  {
    date: "2026-09-08",
    rows: [
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-A", availableQty: 12, inTransitQty: 3, waitInQty: 1, totalQty: 16 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-B", lockedQty: 3, totalQty: 3 },
      { warehouseId: "WH-ID", warehouseName: "印尼仓", country: "印度尼西亚", sku: "SKU-C", availableQty: 4, totalQty: 4 },
    ],
  },
];

const payload = buildInventoryValuePayload({
  snapshots,
  products,
  supplementalCosts: [
    { sku: "SKU-A", countryKey: "ID", unitCostCny: 99, effectiveDate: "2026-09-08", enabled: true },
    { sku: "SKU-B", countryKey: "ID", unitCostCny: 5, effectiveDate: "2026-09-08", enabled: true },
  ],
  filters: { period: "day" },
  manageCosts: true,
});

assert.equal(payload.timeline.length, 2);
assert.equal(payload.currentPeriod.snapshotDate, "2026-09-08");
assert.equal(payload.previousPeriod.snapshotDate, "2026-09-01");
assert.equal(payload.summary.onHandQty, 19, "on-hand excludes in-transit and wait-in quantities");
assert.equal(payload.summary.inTransitQty, 3);
assert.equal(payload.summary.onHandValueCny, 135, "missing-cost stock is excluded from the known value");
assert.equal(payload.summary.previousOnHandValueCny, 117, "manual fallback can reconstruct older snapshots");
assert.equal(payload.summary.periodChangeCny, 18);
assert.equal(payload.summary.missingCostSkuCount, 1);
assert.equal(payload.summary.coveredOnHandQty, 15);
assert.equal(payload.summary.costCoverageRate, 0.7895);
assert.equal(payload.permissions.manageCosts, true);

const directRow = payload.rows.find((row) => row.sku === "SKU-A");
assert.equal(directRow.unitCostCny, 10, "direct supply price always wins over a manual supplement");
assert.equal(directRow.costSource, "direct_price");
assert.equal(directRow.onHandValueCny, 120);
assert.equal(directRow.valueChangeCny, 20);

const manualRow = payload.rows.find((row) => row.sku === "SKU-B");
assert.equal(manualRow.unitCostCny, 5);
assert.equal(manualRow.costSource, "manual_supplement");
assert.equal(manualRow.previousValueCny, 10);

const missingRow = payload.missingCosts.find((row) => row.sku === "SKU-C");
assert.equal(missingRow.onHandQty, 4);

const removedRow = payload.rows.find((row) => row.sku === "SKU-D");
assert.equal(removedRow.onHandQty, 0, "SKUs that leave inventory remain visible in the change detail");
assert.equal(removedRow.valueChangeCny, -7);

const weekly = buildInventoryValuePayload({ snapshots, products, supplementalCosts: [], filters: { period: "week" } });
assert.equal(weekly.timeline.length, 2, "weekly mode keeps the latest snapshot in each week");

const filtered = buildInventoryValuePayload({ snapshots, products, supplementalCosts: [], filters: { period: "day", warehouseId: "OTHER" } });
assert.equal(filtered.summary.onHandQty, 0, "warehouse filters are applied before valuation");

console.log("inventory value tests passed");

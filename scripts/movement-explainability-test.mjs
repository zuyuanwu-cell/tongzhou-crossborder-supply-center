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
  {
    syncedAt: "2026-10-10T01:00:00.000Z",
    orders: [
      { warehouseId: "warehouse-1", warehouseName: "Jakarta", country: "印度尼西亚", sku: "SKU-001", quantity: 7, shippedAt: "2026-10-09 13:00:00" },
      { warehouseId: "warehouse-1", warehouseName: "Jakarta", country: "印度尼西亚", sku: "SKU-001", quantity: 2, shippedAt: "2026-10-10 09:00:00" },
    ],
    results: [{ warehouseId: "warehouse-1", ok: true }],
  },
  {
    todayKey: "2026-10-10",
    evidenceDate: "2026-10-09",
    orderSyncDateKey: "2026-10-10",
    yesterdaySnapshot: {
      date: "2026-10-09",
      capturedAt: "2026-10-09T15:30:00.000Z",
      rows: [
        { warehouseId: "warehouse-1", warehouseName: "Jakarta", country: "印度尼西亚", sku: "SKU-001", lockedQty: 5 },
        { warehouseId: "warehouse-2", warehouseName: "Surabaya", country: "印度尼西亚", sku: "SKU-001", lockedQty: 3 },
      ],
    },
  },
);

assert.equal(payload.items.length, 1);
assert.equal(payload.orderDataAvailable, true, "a populated order snapshot is treated as usable sales data");
assert.equal(payload.orderDataComplete, true);
const [item] = payload.items;
assert.equal(item.identityScope, "SKU×国家");
assert.equal(item.dataCompleteness, "complete");
assert.equal(item.calculation.ruleVersion, "movement-v2");
assert.equal(item.calculation.window, "3/7/30/90天");
assert.equal(item.calculation.includesInTransit, false);
assert.match(item.calculation.formula, /7日均销/);
assert.equal(item.yesterdayOutboundQty, 7, "yesterday outbound is aggregated from shipped order lines");
assert.equal(item.yesterdayReservedQty, 8, "yesterday reservation is aggregated from the exact-date locked inventory snapshot");
assert.deepEqual(item.yesterdayWarehouseBreakdown, [
  { warehouseId: "warehouse-1", warehouseName: "Jakarta", yesterdayOutboundQty: 7, yesterdayReservedQty: 5 },
  { warehouseId: "warehouse-2", warehouseName: "Surabaya", yesterdayOutboundQty: 0, yesterdayReservedQty: 3 },
], "yesterday evidence remains attributable when the risk table is filtered to one warehouse");
assert.deepEqual(payload.evidence, {
  date: "2026-10-09",
  outboundAvailable: true,
  reservedAvailable: true,
  reservedSnapshotAt: "2026-10-09T15:30:00.000Z",
});

const unavailableEvidencePayload = buildMovementPayload(
  { catalog: [{ id: "product-2", sku: "SKU-002", countrySku: "ID-SKU-002", name: "Stale product", country: "印度尼西亚" }], productBase: [] },
  { inventory: [] },
  { syncedAt: "2026-10-09T09:00:00.000Z", orders: [], results: [] },
  { todayKey: "2026-10-10", evidenceDate: "2026-10-09", orderSyncDateKey: "2026-10-09" },
);
assert.equal(unavailableEvidencePayload.items[0].yesterdayOutboundQty, null, "stale order sync never reports a misleading zero");
assert.equal(unavailableEvidencePayload.items[0].yesterdayReservedQty, null, "a missing yesterday snapshot stays unavailable");

const runningPayload = buildMovementPayload(
  { catalog: [], productBase: [] },
  { inventory: [] },
  {
    syncedAt: new Date().toISOString(),
    orders: [{ warehouseId: "warehouse-1", sku: "SKU-001", quantity: 1, shippedAt: new Date().toISOString() }],
    results: [{ warehouseId: "warehouse-1", ok: false, backgroundRunning: true }],
  },
);
assert.equal(runningPayload.orderDataComplete, false, "a running background sync is not publish-ready");

console.log("movement explainability tests passed");

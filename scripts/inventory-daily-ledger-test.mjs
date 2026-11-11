import assert from "node:assert/strict";
import { buildInventoryDailyLedger } from "../server/inventory-daily-ledger.js";

const snapshots = [
  { date: "2026-11-09", timezone: "Asia/Shanghai", capturedAt: "2026-11-09T15:59:00.000Z", rows: [{ warehouseId: "WH-1", warehouseName: "Warehouse 1", sku: "SKU-A", availableQty: 8, lockedQty: 2 }] },
  { date: "2026-11-10", timezone: "Asia/Shanghai", capturedAt: "2026-11-10T15:59:00.000Z", rows: [{ warehouseId: "WH-1", warehouseName: "Warehouse 1", sku: "SKU-A", availableQty: 12, lockedQty: 1, faultyQty: 2, temporaryQty: 1, inTransitQty: 7 }] },
];

const payload = buildInventoryDailyLedger({
  bizDate: "2026-11-10",
  timezone: "Asia/Shanghai",
  snapshots,
  outboundOrders: [
    { warehouseId: "WH-1", sku: "SKU-A", quantity: 3, shippedAt: "2026-11-10 09:00:00" },
    { warehouseId: "WH-1", sku: "SKU-A", quantity: 1, outboundType: "b2b", shippedAt: "2026-11-10 10:00:00" },
  ],
  inboundReceipts: [{ warehouseId: "WH-1", sku: "SKU-A", shelvedQty: 5, arrivedAt: "2026-11-10 11:00:00" }],
  inventoryMovements: [
    { warehouseId: "WH-1", sku: "SKU-A", type: "transfer_in", quantity: 2, occurredAt: "2026-11-10 12:00:00" },
    { warehouseId: "WH-1", sku: "SKU-A", type: "transfer_out", quantity: 1, occurredAt: "2026-11-10 13:00:00" },
    { warehouseId: "WH-1", sku: "SKU-A", type: "adjustment", signedQty: -1, occurredAt: "2026-11-10 14:00:00" },
  ],
  returnFacts: [{ warehouseId: "WH-1", sku: "SKU-A", restockedQty: 2, dispositionDate: "2026-11-10" }],
  valuations: [{ warehouseId: "WH-1", sku: "SKU-A", unitCostCny: 6, costBasis: "effective_dated_manual_cost", costEffectiveDate: "2026-11-01", rateEffectiveDate: "2026-11-10" }],
});

assert.equal(payload.status, "ready");
assert.equal(payload.rows.length, 1);
const row = payload.rows[0];
assert.equal(row.openingQty, 10);
assert.equal(row.inboundQty, 5);
assert.equal(row.returnRestockQty, 2);
assert.equal(row.transferInQty, 2);
assert.equal(row.transferOutQty, 1);
assert.equal(row.orderOutboundQty, 3);
assert.equal(row.otherOutboundQty, 1);
assert.equal(row.adjustQty, -1);
assert.equal(row.expectedClosingQty, 13);
assert.equal(row.closingQty, 13);
assert.equal(row.varianceQty, 0);
assert.equal(row.faultyQty, 2);
assert.equal(row.temporaryQty, 1);
assert.equal(row.inTransitQty, 7);
assert.equal(row.inventoryValueCny, 78);

const missing = buildInventoryDailyLedger({
  bizDate: "2026-11-11",
  timezone: "Asia/Shanghai",
  snapshots,
  outboundOrders: [{ warehouseId: "WH-1", sku: "SKU-A", quantity: 1, shippedAt: "2026-11-11 10:00:00" }],
  ordersComplete: false,
  movementsComplete: false,
});
assert.equal(missing.status, "partial");
assert.deepEqual(missing.dataFlags, ["closing_snapshot_missing", "orders_incomplete", "movements_incomplete"]);
assert.equal(missing.rows[0].dataFlags.includes("cost_missing"), false, "missing closing stock does not create a false cost gap");

const offSchedule = buildInventoryDailyLedger({
  bizDate: "2026-11-10",
  timezone: "Asia/Shanghai",
  snapshots: [
    snapshots[0],
    { ...snapshots[1], capturedAt: "2026-11-10T04:00:00.000Z" },
  ],
});
assert.equal(offSchedule.status, "partial");
assert.equal(offSchedule.dataFlags.includes("closing_snapshot_off_schedule"), true, "midday snapshots are not silently treated as end-of-day truth");

console.log("inventory daily ledger tests passed");

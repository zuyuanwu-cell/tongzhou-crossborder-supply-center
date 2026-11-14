import assert from "node:assert/strict";
import {
  buildOverseasInventoryReconciliation,
  resolveOverseasReconciliationRanges,
  summarizeReturnSource,
} from "../server/overseas-inventory-reconciliation.js";

const ranges = resolveOverseasReconciliationRanges({ period: "month", anchorDate: "2026-10-10" });
assert.deepEqual(ranges.current, { from: "2026-10-01", to: "2026-10-31", label: "2026年10月" });
assert.deepEqual(ranges.previous, { from: "2026-09-01", to: "2026-09-30", label: "2026年9月" });

const staleReturnSource = summarizeReturnSource({
  states: [{ warehouseId: "wh-id", warehouseName: "测试仓", syncedAt: "2026-10-11T00:00:00.000Z", from: "2026-09-01", to: "2026-10-31", complete: true, error: "" }],
  requiredRange: { from: "2026-10-01", to: "2026-11-30" },
  now: new Date("2026-11-11T00:00:00.000Z"),
  staleAfterMs: 26 * 60 * 60 * 1000,
});
assert.equal(staleReturnSource.status, "partial");
assert.equal(staleReturnSource.stale, true);
assert.equal(staleReturnSource.coverageTo, "2026-10-31");
assert.match(staleReturnSource.message, /未完整覆盖/);

const freshReturnSource = summarizeReturnSource({
  states: [{ warehouseId: "wh-id", warehouseName: "测试仓", syncedAt: "2026-11-11T00:00:00.000Z", from: "2026-10-01", to: "2026-11-30", complete: true, error: "" }],
  requiredRange: { from: "2026-10-01", to: "2026-11-30" },
  now: new Date("2026-11-11T01:00:00.000Z"),
});
assert.equal(freshReturnSource.status, "ready");
assert.equal(freshReturnSource.stale, false);

const warehouse = { id: "wh-id", name: "印尼雅加达仓", country: "印尼", providerId: "sea_wms" };
const snapshots = [
  {
    date: "2026-08-31", timezone: "Asia/Shanghai", capturedAt: "2026-08-31T16:00:00.000Z",
    rows: [{ warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country, sku: "SKU-A", productName: "产品 A", availableQty: 72, lockedQty: 8 }],
  },
  {
    date: "2026-09-30", timezone: "Asia/Shanghai", capturedAt: "2026-09-30T16:00:00.000Z",
    rows: [
      { warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country, sku: "SKU-A", productName: "产品 A", availableQty: 90, lockedQty: 10 },
      { warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country, sku: "SKU-B", productName: "产品 B", availableQty: 40, lockedQty: 0 },
    ],
  },
  {
    date: "2026-10-10", timezone: "Asia/Shanghai", capturedAt: "2026-10-10T16:00:00.000Z",
    rows: [
      { warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country, sku: "SKU-A", productName: "产品 A", availableQty: 91, lockedQty: 9 },
      { warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country, sku: "SKU-B", productName: "产品 B", availableQty: 34, lockedQty: 0 },
    ],
  },
];

const outboundOrders = [
  { warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", quantity: 20, shippedAt: "2026-10-04 12:00:00", platformOrderSn: "ORDER-1", shopAlias: "店铺 Alpha" },
  { warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-B", productName: "产品 B", quantity: 8, shippedAt: "2026-10-05 12:00:00", platformOrderSn: "ORDER-2", shopAlias: "店铺 Beta" },
  { warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", quantity: 4, shippedAt: "2026-09-10 12:00:00", platformOrderSn: "ORDER-OLD", shopAlias: "店铺 Alpha" },
];

const inboundReceipts = [
  { warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", receivedQty: 15, goodQty: 15, shelvedQty: 15, arrivedAt: "2026-10-03 09:00:00", receiptNo: "SH-001" },
];

const inboundShipments = [
  { warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-B", productName: "产品 B", quantity: 12, actualShippedAt: "2026-10-08", eta: "2026-10-20", shipmentNo: "FY-001" },
];

const wmsReturnOrders = [
  {
    id: "return-1", warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country,
    returnOrderNumber: "RET-001", originalOrderNumber: "ORDER-1", status: "mixed", statusLabel: "混合处理",
    createdAt: "2026-10-06 10:00:00", completedAt: "2026-10-07 09:00:00", updatedAt: "2026-10-09 10:00:00",
    items: [{ id: "r1-a", sku: "SKU-A", productName: "产品 A", expectedQty: 5, receivedQty: 5, restockedQty: 3, scrappedQty: 1, pendingQty: 1, badQty: 1 }],
  },
  {
    id: "return-2", warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country,
    returnOrderNumber: "RET-002", originalOrderNumber: "ORDER-2", status: "in_transit", statusLabel: "在途中",
    createdAt: "2026-10-08 10:00:00", updatedAt: "2026-10-08 10:00:00",
    items: [{ id: "r2-b", sku: "SKU-B", productName: "产品 B", expectedQty: 2, receivedQty: 0, restockedQty: 0, scrappedQty: 0, pendingQty: 0 }],
  },
  {
    id: "return-draft", warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country,
    returnOrderNumber: "RET-DRAFT", originalOrderNumber: "ORDER-2", status: "draft", statusLabel: "已申请未寄出",
    createdAt: "2026-10-09 10:00:00", updatedAt: "2026-10-10 10:00:00",
    items: [{ id: "draft-b", sku: "SKU-B", productName: "产品 B", expectedQty: 2, receivedQty: 0, restockedQty: 0, scrappedQty: 0, pendingQty: 0 }],
  },
  {
    id: "return-cancelled", warehouseId: "wh-id", warehouseName: warehouse.name, country: warehouse.country,
    returnOrderNumber: "RET-CANCELLED", originalOrderNumber: "ORDER-2", status: "cancelled", statusLabel: "已取消",
    createdAt: "2026-10-09 10:00:00", updatedAt: "2026-10-10 10:00:00",
    items: [{ id: "cancelled-b", sku: "SKU-B", productName: "产品 B", expectedQty: 99, receivedQty: 0, restockedQty: 0, scrappedQty: 0, pendingQty: 0 }],
  },
];

const afterSalesTickets = [{
  id: "AS-001", originalOrderNumber: "ORDER-1", warehouseId: "wh-id", warehouseName: warehouse.name,
  shopAlias: "店铺 Alpha", secondaryReason: "客户退全款且退货", status: "pending_warehouse", createdAt: "2026-10-06 11:00:00",
  originalItems: [{ sku: "SKU-A", productName: "产品 A", quantity: 5 }],
}];

const payload = buildOverseasInventoryReconciliation({
  ranges,
  snapshots,
  warehouses: [warehouse],
  outboundOrders,
  inboundReceipts,
  inboundShipments,
  wmsReturnOrders,
  afterSalesTickets,
  claimMap: {},
  timezone: "Asia/Shanghai",
  sources: { inventorySyncedAt: "2026-10-10T16:00:00.000Z", ordersSyncedAt: "2026-10-10T17:00:00.000Z", returnsSyncedAt: "2026-10-10T18:00:00.000Z" },
});

assert.equal(payload.scope, "overseas");
assert.equal(payload.warehouses.length, 1);
assert.equal(payload.sources.inventory.status, "partial");
assert.equal(payload.sources.inventory.requestedSnapshotDate, "2026-10-31");
assert.equal(payload.sources.inventory.gapDays, 21);
assert.equal(payload.snapshots.closing.boundaryMatch, false);
assert.equal(payload.warehouses[0].coverage.closingSnapshot, "partial");
assert.equal(payload.summary.actualInventoryQty, 134);
assert.equal(payload.summary.openingInventoryQty, 140);
assert.equal(payload.summary.inboundQty, 15);
assert.equal(payload.summary.outboundQty, 28);
assert.equal(payload.summary.restockedQty, 3);
assert.equal(payload.summary.theoreticalInventoryQty, 130);
assert.equal(payload.summary.varianceQty, 4);
assert.equal(payload.summary.returnQty, 9);
assert.equal(payload.summary.inTransitReturnQty, 2);
assert.equal(payload.summary.draftReturnQty, 2);
assert.equal(payload.summary.unreceivedReturnQty, 2, "draft requests are excluded from unreceived/in-transit quantities");
assert.equal(payload.summary.pendingReturnQty, 1);
assert.equal(payload.summary.scrappedQty, 1);
assert.equal(payload.summary.badQty, 1);
assert.equal(payload.summary.damageRate, 0.4);
assert.equal(payload.summary.unclaimedReturnCount, 2);
assert.equal(payload.summary.unclaimedReturnQty, 4);
assert.equal(payload.summary.inboundInTransitQty, 12);
assert.equal(payload.returnFacts.length, 3);
assert.equal(payload.returnFacts.some((item) => item.returnOrderNumber === "RET-CANCELLED"), false, "cancelled returns do not enter return quantities");
assert.equal(payload.returnFacts.find((item) => item.returnOrderNumber === "RET-002").dispositionDate, "", "mutable updatedAt is not used as a completion/disposition date");
assert.equal(payload.returnFacts.find((item) => item.returnOrderNumber === "RET-001").claimStatus, "matched");
assert.equal(payload.returnFacts.find((item) => item.returnOrderNumber === "RET-002").claimStatus, "unclaimed");
assert.equal(payload.rankings.skus[0].sku, "SKU-A");
assert.equal(payload.rankings.skus[0].returnQty, 5);
assert.equal(payload.rankings.shops.find((item) => item.shopName === "店铺 Alpha").returnQty, 5);
assert.equal(payload.rankings.shops.find((item) => item.shopName === "店铺 Beta").returnQty, 4);
assert.equal(payload.warehouses[0].skuRows.find((item) => item.sku === "SKU-A").varianceQty, 2);
assert.equal(payload.warehouses[0].skuRows.find((item) => item.sku === "SKU-B").varianceQty, 2);
assert.deepEqual(payload.warehouses[0].skuRows.find((item) => item.sku === "SKU-A").returnFactIds, ["return-1::SKU-A"]);
assert.equal("returnFacts" in payload.warehouses[0].skuRows.find((item) => item.sku === "SKU-A"), false, "return facts are returned once at the top level");
assert.equal(payload.warehouses[0].coverage.transferMovements, "missing");
assert.equal(payload.comparison.summary.returnQty.change, 9);

const claimed = buildOverseasInventoryReconciliation({
  ranges,
  snapshots,
  warehouses: [warehouse],
  outboundOrders,
  inboundReceipts,
  inboundShipments,
  wmsReturnOrders,
  afterSalesTickets,
  claimMap: { "return-2::SKU-B": { ownerId: "u-1", ownerName: "运营小舟", claimedAt: "2026-10-10T18:10:00.000Z" } },
});
assert.equal(claimed.returnFacts.find((item) => item.returnOrderNumber === "RET-002").claimStatus, "claimed");
assert.equal(claimed.summary.unclaimedReturnCount, 1);

const ledgerPreferred = buildOverseasInventoryReconciliation({
  ranges: {
    period: "custom",
    anchorDate: "2026-10-03",
    current: { from: "2026-10-02", to: "2026-10-03", label: "current" },
    previous: { from: "2026-09-30", to: "2026-10-01", label: "previous" },
  },
  snapshots: [{
    date: "2026-10-03", timezone: "Asia/Shanghai", capturedAt: "2026-10-03T16:00:00.000Z",
    rows: [{ warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", availableQty: 999, lockedQty: 0 }],
  }],
  dailyLedgerRows: [
    { bizDate: "2026-09-30", timezone: "Asia/Shanghai", warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", openingQty: 110, inboundQty: 0, returnRestockQty: 0, transferInQty: 0, transferOutQty: 0, orderOutboundQty: 5, otherOutboundQty: 0, adjustQty: 0, closingQty: 105, dataFlags: [], updatedAt: "2026-09-30T16:00:00.000Z" },
    { bizDate: "2026-10-01", timezone: "Asia/Shanghai", warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", openingQty: 105, inboundQty: 0, returnRestockQty: 0, transferInQty: 0, transferOutQty: 0, orderOutboundQty: 5, otherOutboundQty: 0, adjustQty: 0, closingQty: 100, dataFlags: [], updatedAt: "2026-10-01T16:00:00.000Z" },
    { bizDate: "2026-10-02", timezone: "Asia/Shanghai", warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", openingQty: 100, inboundQty: 10, returnRestockQty: 1, transferInQty: 0, transferOutQty: 0, orderOutboundQty: 11, otherOutboundQty: 0, adjustQty: 0, closingQty: 100, dataFlags: [], updatedAt: "2026-10-02T16:00:00.000Z" },
    { bizDate: "2026-10-03", timezone: "Asia/Shanghai", warehouseId: "wh-id", warehouseName: warehouse.name, sku: "SKU-A", productName: "产品 A", openingQty: 100, inboundQty: 0, returnRestockQty: 0, transferInQty: 0, transferOutQty: 0, orderOutboundQty: 10, otherOutboundQty: 0, adjustQty: 0, closingQty: 90, dataFlags: [], updatedAt: "2026-10-03T16:00:00.000Z" },
  ],
  warehouses: [warehouse],
  timezone: "Asia/Shanghai",
  sources: { orderComplete: true },
});
assert.equal(ledgerPreferred.summary.openingInventoryQty, 100);
assert.equal(ledgerPreferred.summary.actualInventoryQty, 90, "daily ledger takes precedence over conflicting legacy snapshots");
assert.equal(ledgerPreferred.summary.inboundQty, 10);
assert.equal(ledgerPreferred.summary.restockedQty, 1);
assert.equal(ledgerPreferred.summary.outboundQty, 21);
assert.equal(ledgerPreferred.summary.varianceQty, 0);
assert.equal(ledgerPreferred.summary.afterSalesCoverageRate, null, "zero return denominator is reported as unavailable, not 100%");
assert.equal(ledgerPreferred.sources.inventory.status, "ready");
assert.equal(ledgerPreferred.sources.transfers.status, "ready");
assert.equal(ledgerPreferred.dateBasis.timezone, "Asia/Shanghai");
assert.deepEqual(ledgerPreferred.dataWindow.requested, { from: "2026-10-02", to: "2026-10-03", label: "current" });
assert.deepEqual(ledgerPreferred.dataWindow.actual, { from: "2026-09-30", to: "2026-10-03" });
assert.equal(ledgerPreferred.dataWindow.complete, true);

console.log("[ok] overseas reconciliation formula");
console.log("[ok] WMS return lifecycle and unclaimed facts");
console.log("[ok] SKU, shop, and warehouse drill-down rankings");
console.log("[ok] indexed daily ledger preferred over compatibility snapshots");
console.log("[ok] WMS return source freshness and zero-denominator coverage");

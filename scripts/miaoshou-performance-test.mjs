import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPerformanceAnalyticsStore } from "../server/performance-analytics-db.js";
import { buildPerformanceAnalyticsPayload, materializePerformanceFacts } from "../server/performance-analytics.js";
import { createMiaoshouPerformanceSyncService } from "../server/miaoshou-performance-sync.js";
import {
  normalizeMiaoshouCancellations,
  normalizeMiaoshouPackages,
  normalizeMiaoshouReturns,
  reconcileMiaoshouPerformance,
} from "../server/miaoshou-performance.js";

const packagePayload = {
  data: {
    orderPackageList: [
      {
        opOrderPackageId: 10,
        orderInfo: {
          opOrderId: 100,
          platform: "tiktok",
          shopId: 200,
          platformOrderSn: "ORDER-1",
          site: "ID",
          currency: "IDR",
          payAmount: 100,
          orderAmount: 110,
          commissionFee: 5,
          actualShippingCost: 3,
          gmtOrderStart: "2026-08-01 10:00:00",
        },
        items: [
          { opOrderItemId: 1, opOrderPackageItemId: 11, platformOuterSkuId: "SKU-A", quantity: 1, discountedPrice: 60 },
        ],
      },
      {
        opOrderPackageId: 11,
        orderInfo: {
          opOrderId: 100,
          platform: "tiktok",
          shopId: 200,
          platformOrderSn: "ORDER-1",
          site: "ID",
          currency: "IDR",
          payAmount: 100,
        },
        items: [
          // The same order item can be physically split across packages. Distinct
          // package-item IDs must both count toward the fulfilled quantity.
          { opOrderItemId: 1, opOrderPackageItemId: 12, platformOuterSkuId: "SKU-A", quantity: 2, discountedPrice: 60 },
          { opOrderItemId: 2, opOrderPackageItemId: 13, platformOuterSkuId: "SKU-B", quantity: 2, discountedPrice: 20 },
        ],
      },
    ],
  },
};

const normalized = normalizeMiaoshouPackages(packagePayload);
assert.equal(normalized.packageCount, 2);
assert.equal(normalized.sourceRowCount, 2);
assert.equal(normalized.orders.length, 1);
assert.equal(normalized.items.length, 3);
assert.equal(normalized.items.reduce((sum, item) => sum + item.quantity, 0), 5);
assert.equal(normalized.orders[0].payAmount, 100);

const returns = normalizeMiaoshouReturns({
  data: {
    orderReturnList: [{
      opOrderReturnId: 900,
      platform: "tiktok",
      shopId: 200,
      platformOrderSn: "ORDER-1",
      currency: "IDR",
      refundAmount: 10,
      appReturnStatusText: "退款成功",
      gmtFinish: "2026-08-03 12:00:00",
    }],
  },
});
assert.equal(returns.length, 1);
assert.equal(returns[0].finalized, true);

const facts = [
  { id: "w1", sourceSystem: "sea_wms", warehouseId: "id", sourceOrderId: "ORDER-1", orderNo: "ORDER-1", orderDate: "2026-08-01", country: "ID", platform: "TikTok Shop", miaoshouShopId: "200", sku: "SKU-A", quantity: 3, salesAmount: 60, currency: "IDR", salesAmountValid: true },
  { id: "w2", sourceSystem: "sea_wms", warehouseId: "id", sourceOrderId: "ORDER-1", orderNo: "ORDER-1", orderDate: "2026-08-01", country: "ID", platform: "TikTok Shop", miaoshouShopId: "200", sku: "SKU-B", quantity: 2, salesAmount: 40, currency: "IDR", salesAmountValid: true },
];
const shadow = reconcileMiaoshouPerformance({
  facts,
  orders: normalized.orders,
  items: normalized.items,
  returns,
  requestedSource: "shadow",
  syncState: { status: "success", lastSuccessAt: "2026-08-04T00:00:00.000Z" },
});
assert.equal(shadow.reconciliation.orderMatchRate, 1);
assert.equal(shadow.reconciliation.quantityVarianceRate, 0);
assert.equal(shadow.reconciliation.amountVarianceRate, 0);
assert.equal(shadow.reconciliation.activationEligible, true);
assert.equal(shadow.reconciliation.effectiveSource, "wms");
assert.equal(shadow.facts.reduce((sum, row) => sum + row.salesAmount, 0), 100);
assert.equal(shadow.facts.reduce((sum, row) => sum + row.miaoshouNetAmount, 0), 90);

const approved = reconcileMiaoshouPerformance({
  facts,
  orders: normalized.orders,
  items: normalized.items,
  returns,
  requestedSource: "miaoshou",
  syncState: { status: "success", lastSuccessAt: "2026-08-04T00:00:00.000Z" },
});
assert.equal(approved.reconciliation.effectiveSource, "miaoshou");
assert.ok(approved.facts.every((row) => row.salesAmountScope === "miaoshou_order_allocated"));
assert.equal(approved.facts.reduce((sum, row) => sum + row.miaoshouCommissionAmount, 0), 5);
assert.equal(approved.facts.reduce((sum, row) => sum + row.miaoshouLogisticsAmount, 0), 3);
const approvedPayload = buildPerformanceAnalyticsPayload({
  materializedFacts: materializePerformanceFacts({
    facts: approved.facts,
    products: {
      productBase: [
        { sku: "SKU-A", name: "A", brand: "Brand" },
        { sku: "SKU-B", name: "B", brand: "Brand" },
      ],
      catalog: [
        { sku: "SKU-A", country: "ID", directCostPrice: 1, directCostCurrency: "CNY" },
        { sku: "SKU-B", country: "ID", directCostPrice: 1, directCostCurrency: "CNY" },
      ],
    },
    exchangeRates: [
      { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 1 },
      { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
    ],
  }),
  exchangeRates: [
    { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 1 },
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
  ],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.equal(approvedPayload.totals.commissionFeeCny, 5);
assert.equal(approvedPayload.totals.logisticsFeeCny, 3);
assert.equal(approvedPayload.totals.contributionProfitCny, 74.9);
assert.equal(approvedPayload.totals.contributionSalesCny, 90);
assert.equal(approvedPayload.totals.contributionOperatingCostCny, 15.1);
assert.equal(approvedPayload.totals.contributionSalesCny - approvedPayload.totals.contributionOperatingCostCny, approvedPayload.totals.contributionProfitCny);
assert.equal(approvedPayload.quality.contributionCoverageRate, 1);

const active = reconcileMiaoshouPerformance({
  facts: facts.map((row) => ({ ...row, salesAmount: 1 })),
  orders: normalized.orders,
  items: normalized.items,
  returns,
  requestedSource: "miaoshou",
  syncState: { status: "success", lastSuccessAt: "2026-08-04T00:00:00.000Z" },
});
assert.equal(active.reconciliation.effectiveSource, "wms", "amount variance must block unsafe activation");

const cancellation = normalizeMiaoshouCancellations({
  data: { cancelList: [{ platform: "tiktok", shopId: 200, platformOrderSn: "ORDER-1", appReturnStatusText: "cancelled", textReasonCn: "buyer cancelled" }] },
});
assert.equal(cancellation[0].identity, "tiktok|200|ORDER-1|cancel");
assert.equal(cancellation[0].appCancelStatusText, "cancelled");
assert.equal(cancellation[0].reason, "buyer cancelled");
const cancelled = reconcileMiaoshouPerformance({
  facts,
  orders: normalized.orders,
  items: normalized.items,
  returns,
  cancellations: cancellation,
  requestedSource: "miaoshou",
  syncState: { status: "success", lastSuccessAt: "2026-08-04T00:00:00.000Z" },
});
assert.equal(cancelled.reconciliation.activationEligible, false);
assert.equal(cancelled.reconciliation.cancelledOutboundOrders, 1);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "tongzhou-miaoshou-performance-"));
try {
  const dbPath = join(temporaryDirectory, "analytics.sqlite");
  const store = await initPerformanceAnalyticsStore(dbPath);
  store.upsertMiaoshouPerformance({
    orders: normalized.orders,
    items: normalized.items,
    returns,
    cancellations: cancellation,
  }, { status: "success", lastSuccessAt: "2026-08-04T00:00:00.000Z" });
  const reopened = await initPerformanceAnalyticsStore(dbPath);
  const snapshot = reopened.listMiaoshouPerformance();
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.items.length, 3);
  assert.equal(snapshot.returns[0].refundAmount, 10);
  assert.equal(snapshot.cancellations[0].finalized, true);
  assert.equal(reopened.getMiaoshouPerformanceSyncState().status, "success");

  const calls = { packages: 0, returns: 0, cancellations: 0 };
  const inputs = { packages: [], returns: [], cancellations: [] };
  const connector = {
    performanceContext: () => ({
      hasCredentials: true,
      shopsSyncedAt: "2026-08-01T00:00:00.000Z",
      shops: [{ shopId: "200", platform: "tiktok", site: "ID" }],
    }),
    searchPerformancePackages: async (input) => {
      calls.packages += 1;
      inputs.packages.push(input);
      return packagePayload;
    },
    searchPerformanceReturns: async (input) => {
      calls.returns += 1;
      inputs.returns.push(input);
      return { data: { orderReturnList: [] } };
    },
    searchPerformanceCancellations: async (input) => {
      calls.cancellations += 1;
      inputs.cancellations.push(input);
      return { data: { orderCancelList: [] } };
    },
  };
  const syncService = createMiaoshouPerformanceSyncService({
    connector,
    store: reopened,
    now: () => new Date("2026-08-05T00:00:00.000Z"),
  });
  const syncResult = await syncService.run({ dateFrom: "2026-08-01", dateTo: "2026-08-01", force: true });
  assert.equal(syncResult.status, "success");
  assert.equal(syncResult.orderCount, 1);
  assert.deepEqual(calls, { packages: 1, returns: 1, cancellations: 1 });
  assert.equal(inputs.packages.at(-1).gmtModifiedTo, "2026-08-01 23:59:59");
  assert.equal(inputs.returns.at(-1).gmtStartTo, "2026-08-01 23:59:59");

  calls.packages = 0;
  calls.returns = 0;
  calls.cancellations = 0;
  const fullSweep = await syncService.run({ reason: "scheduled", force: true });
  assert.equal(fullSweep.status, "success");
  assert.equal(fullSweep.afterSalesDateFrom, "2026-05-08");
  assert.equal(fullSweep.lastAfterSalesFullSweepAt, "2026-08-05T00:00:00.000Z");
  assert.deepEqual(calls, { packages: 1, returns: 13, cancellations: 13 });
  assert.equal(inputs.packages.at(-1).gmtModifiedTo, "2026-08-05 08:00:00");
  assert.equal(inputs.returns.at(-1).gmtStartTo, "2026-08-05 08:00:00");

  calls.packages = 0;
  calls.returns = 0;
  calls.cancellations = 0;
  const incrementalSweep = await syncService.run({ reason: "scheduled", force: true });
  assert.equal(incrementalSweep.afterSalesDateFrom, "2026-08-03");
  assert.deepEqual(calls, { packages: 1, returns: 1, cancellations: 1 });

  const futureDateResult = await syncService.run({ dateFrom: "2026-08-05", dateTo: "2026-08-07", force: true });
  assert.equal(futureDateResult.dateTo, "2026-08-05", "future end dates must be clamped to the current business date");
  assert.equal(inputs.packages.at(-1).gmtModifiedTo, "2026-08-05 08:00:00");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("miaoshou performance tests passed");

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { gunzipSync, gzipSync } from "node:zlib";
import { allocateOrderSalesAmount, normalizeSeaOrderRows, normalizeYunOrderRows } from "../server/wms-adapters.js";
import {
  DEFAULT_PACKAGING_FEE_RULES,
  buildPerformanceAnalyticsPayload,
  calculatePackagingFeeCny,
  materializePerformanceFacts,
} from "../server/performance-analytics.js";
import { initPerformanceAnalyticsStore, legacyCorrectedOrders } from "../server/performance-analytics-db.js";
import { createPerformanceAnalyticsQueryService } from "../server/performance-query-service.js";

function runMaterializationWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../server/performance-materialization-worker.js", import.meta.url), { workerData });
    worker.once("message", (result) => {
      if (result?.ok) resolve(result);
      else reject(new Error(result?.message || "materialization worker failed"));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`materialization worker exited with code ${code}`));
    });
  });
}

const allocations = allocateOrderSalesAmount([
  { quantity: 1 },
  { quantity: 3 },
], 80);
assert.deepEqual(allocations, [20, 60]);
assert.equal(allocations.reduce((sum, value) => sum + value, 0), 80);
assert.deepEqual(allocateOrderSalesAmount([{ quantity: 2, unit_price: 100 }], 0), [0]);

const adapterConnection = { id: "warehouse", name: "Warehouse", country: "ID", providerId: "sea_wms" };
const seaRows = normalizeSeaOrderRows({
  orderId: "SEA-1",
  platformOrderSn: "SEA-1",
  stage: "has_out_storage",
  gmtOutStorage: "2026-08-01 12:00:00",
  orderAmount: 80,
  currency: "MYR",
  items: [
    { id: "1", sku: "A", quantity: 1, discountedPrice: 20 },
    { id: "2", sku: "B", quantity: 3, discountedPrice: 60 },
  ],
}, adapterConnection);
assert.deepEqual(seaRows.map((row) => row.salesAmount), [20, 60]);
assert.ok(seaRows.every((row) => row.salesAmountValid && row.salesAmountSource === "order.orderAmount"));

const yunRows = normalizeYunOrderRows({
  order_id: "RU-1",
  order_code: "RU-1",
  order_sale_amount: 0,
  order_sale_currency: "",
  currency: "RMB",
  items: [{ product_sku: "A", quantity: 2, unit_price: 2500 }],
}, { ...adapterConnection, country: "RU", providerId: "yunwms_ru" });
assert.equal(yunRows[0].salesAmount, 0);
assert.equal(yunRows[0].currency, "");
assert.equal(yunRows[0].salesAmountValid, false);

const corrected = legacyCorrectedOrders([
  { providerId: "yunwms_ru", warehouseId: "ru", orderId: "O1", sku: "A", quantity: 1, salesAmount: 80 },
  { providerId: "yunwms_ru", warehouseId: "ru", orderId: "O1", sku: "B", quantity: 3, salesAmount: 80 },
]);
assert.deepEqual(corrected.map((row) => row.salesAmount), [20, 60]);
assert.ok(corrected.every((row) => row.salesAmountScope === "legacy_order_allocated"));

assert.equal(calculatePackagingFeeCny("ID", 1), 1.9);
assert.equal(calculatePackagingFeeCny("ID", 4), 1.9);
assert.equal(calculatePackagingFeeCny("ID", 5), 2.1);
assert.equal(calculatePackagingFeeCny("MY", 8), 2.7);
assert.equal(calculatePackagingFeeCny("VN", 0), 0);
assert.equal(calculatePackagingFeeCny("RU", 1), 6);
assert.equal(calculatePackagingFeeCny("RU", 20), 6);
assert.equal(calculatePackagingFeeCny("PH", 3), 0);
assert.equal(calculatePackagingFeeCny("ID", 3, [{ ...DEFAULT_PACKAGING_FEE_RULES[0], enabled: false }]), 0);

const products = {
  productBase: [
    { sku: "A", skuNo: "001", name: "产品 A", brand: "品牌甲", category: "个护", latestLandedUnitCostCny: 999, latestCostEffectiveAt: "2026-01-01" },
    { sku: "B", skuNo: "002", name: "产品 B", brand: "品牌乙", category: "家居" },
  ],
  catalog: [
    { sku: "A", skuNo: "001", country: "印度尼西亚", directCostPrice: 2, directCostCurrency: "USD" },
    { sku: "A", skuNo: "001", country: "俄罗斯", directCostPrice: 50, directCostCurrency: "CNY" },
  ],
};
const facts = [
  { id: "1", sourceSystem: "sea_wms", sourceOrderId: "O1", orderNo: "O1", orderDate: "2026-08-01", warehouseId: "id", warehouseName: "印尼仓", country: "印尼", platform: "TikTok", shopName: "店铺A", projectGroup: "同舟", sku: "A", productName: "A", quantity: 2, salesAmount: 10000, currency: "IDR", salesAmountScope: "order_allocated", salesAmountValid: true },
  { id: "2", sourceSystem: "yunwms_ru", sourceOrderId: "O2", orderNo: "O2", orderDate: "2026-08-01", warehouseId: "ru", warehouseName: "俄罗斯仓", country: "俄罗斯", platform: "Ozon", shopName: "店铺B", projectGroup: "同舟", sku: "B", productName: "B", quantity: 1, salesAmount: 100, currency: "CNY", salesAmountScope: "order_allocated", salesAmountValid: true },
  { id: "3", sourceSystem: "sea_wms", sourceOrderId: "O3", orderNo: "O3", orderDate: "2026-08-01", warehouseId: "id", warehouseName: "印尼仓", country: "印尼", platform: "TikTok", shopName: "店铺A", projectGroup: "同舟", sku: "UNKNOWN", productName: "未建档", quantity: 1, salesAmount: 10, currency: "USD", salesAmountScope: "order_allocated", salesAmountValid: true },
];
const payload = buildPerformanceAnalyticsPayload({
  facts,
  products,
  exchangeRates: [
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
    { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
    { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
  ],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
const materializedPayload = buildPerformanceAnalyticsPayload({
  materializedFacts: materializePerformanceFacts({
    facts,
    products,
    exchangeRates: [
      { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
      { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
      { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
    ],
  }),
  exchangeRates: [
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
    { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
    { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
  ],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.deepEqual(materializedPayload.totals, payload.totals);
assert.deepEqual(materializedPayload.quality, payload.quality);
assert.equal(payload.totals.salesCny, 175.5);
assert.equal(payload.totals.productCostCny, 28.4);
assert.equal(payload.totals.packagingFeeCny, 9.8);
assert.equal(payload.totals.cogsCny, 38.2);
assert.equal(payload.totals.profitSalesCny, 4.5);
assert.equal(payload.totals.profitCogsCny, 30.3);
assert.equal(payload.totals.profitProductCostCny, 28.4);
assert.equal(payload.totals.profitPackagingFeeCny, 1.9);
assert.equal(payload.totals.estimatedProfitCny, -25.8);
assert.equal(payload.totals.profitSalesCny - payload.totals.profitCogsCny, payload.totals.estimatedProfitCny);
assert.equal(payload.quality.unmatchedProductLines, 1);
assert.equal(payload.quality.missingCostLines, 2);
assert.equal(payload.products.find((row) => row.sku === "A")?.brand, "品牌甲");
assert.equal(payload.products.find((row) => row.sku === "A")?.unitCostCny, 14.2);
assert.equal(payload.recentFacts.find((row) => row.sku === "A")?.costCovered, true);

const queryService = createPerformanceAnalyticsQueryService();
try {
  const workerResult = await queryService.query({
    dataVersion: "test-v1",
    materializedFacts: materializePerformanceFacts({
      facts,
      products,
      exchangeRates: [
        { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
        { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
        { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
      ],
    }),
    exchangeRates: [
      { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
      { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
      { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
    ],
    packagingFeeRules: DEFAULT_PACKAGING_FEE_RULES,
    filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01", country: "印尼" },
    scopes: { warehouseIds: ["id"], countries: [], skus: [] },
    limits: { products: 1, recentFacts: 1 },
  });
  assert.equal(workerResult.payload.totals.orderLines, 2);
  assert.equal(workerResult.payload.resultCounts.products, 2);
  assert.equal(workerResult.payload.products.length, 1);
  assert.equal(workerResult.payload.recentFacts.length, 1);
  assert.deepEqual(workerResult.visibleShopKeys, []);
  assert.equal(workerResult.scannedFactCount, 2);

  const unrestrictedWorkerResult = await queryService.query({
    dataVersion: "test-v1",
    materializedFacts: [],
    exchangeRates: [],
    packagingFeeRules: [],
    filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
    scopes: { warehouseIds: [], countries: [], skus: [] },
    limits: { products: 1, recentFacts: 1 },
  });
  assert.equal(unrestrictedWorkerResult.visibleShopKeys, null);
  assert.equal(unrestrictedWorkerResult.scannedFactCount, 3);
} finally {
  await queryService.close();
}

const russianCostPayload = buildPerformanceAnalyticsPayload({
  facts: [{ ...facts[0], id: "ru-cost", country: "俄罗斯", salesAmount: 100, currency: "CNY", quantity: 1 }],
  products,
  exchangeRates: [
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
    { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
  ],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.equal(russianCostPayload.products[0].unitCostCny, 50, "俄罗斯订单必须匹配俄罗斯直营成本价");
assert.equal(russianCostPayload.totals.productCostCny, 50);
assert.equal(russianCostPayload.totals.packagingFeeCny, 6);
assert.equal(russianCostPayload.totals.cogsCny, 56);

const supplementalCostFacts = materializePerformanceFacts({
  facts: [
    { ...facts[1], id: "supplement-b", sku: "B", orderDate: "2026-08-01", quantity: 2 },
    { ...facts[1], id: "catalog-wins", sku: "A", orderDate: "2026-08-01", quantity: 1 },
    { ...facts[2], id: "supplement-unknown", country: "印尼", orderDate: "2026-08-01", quantity: 3 },
  ],
  products,
  exchangeRates: [{ currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 }],
  supplementalProductCosts: [
    { sku: "B", countryKey: "RU", countryName: "俄罗斯", unitCostCny: 30, effectiveDate: "2026-07-01", enabled: true },
    { sku: "B", countryKey: "RU", countryName: "俄罗斯", unitCostCny: 40, effectiveDate: "2026-09-01", enabled: true },
    { sku: "A", countryKey: "RU", countryName: "俄罗斯", unitCostCny: 999, effectiveDate: "2026-01-01", enabled: true },
    { sku: "UNKNOWN", countryKey: "ID", countryName: "印度尼西亚", unitCostCny: 8, effectiveDate: "2026-01-01", enabled: true },
  ],
});
assert.equal(supplementalCostFacts.find((row) => row.id === "supplement-b")?.unitCostCny, 30, "order date must use the latest already-effective supplemental cost");
assert.equal(supplementalCostFacts.find((row) => row.id === "supplement-b")?.costSource, "supplemental_manual");
assert.equal(supplementalCostFacts.find((row) => row.id === "catalog-wins")?.unitCostCny, 50, "catalog country direct cost must win over supplemental cost");
assert.equal(supplementalCostFacts.find((row) => row.id === "catalog-wins")?.costSource, "product_catalog_direct");
assert.equal(supplementalCostFacts.find((row) => row.id === "supplement-unknown")?.unitCostCny, 8, "supplemental cost must cover SKUs missing from the product catalog");
assert.equal(supplementalCostFacts.find((row) => row.id === "supplement-unknown")?.productMatched, false, "cost supplementation must not pretend that a product master record exists");
const disabledSupplementalFact = materializePerformanceFacts({
  facts: [{ ...facts[1], id: "disabled-supplement", sku: "B", orderDate: "2026-08-01" }],
  products,
  exchangeRates: [{ currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 }],
  supplementalProductCosts: [{ sku: "B", countryKey: "RU", unitCostCny: 30, effectiveDate: "2026-07-01", enabled: false }],
})[0];
assert.equal(disabledSupplementalFact.unitCostCny, 0, "a disabled latest supplemental version must stop applying that manual cost");

const missingRevenueCostPayload = buildPerformanceAnalyticsPayload({
  facts: [{ ...facts[0], id: "cost-only", salesAmount: 0, currency: "", salesAmountValid: false }],
  products,
  exchangeRates: [{ currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 }],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.equal(missingRevenueCostPayload.totals.salesCny, 0);
assert.equal(missingRevenueCostPayload.totals.productCostCny, 28.4);
assert.equal(missingRevenueCostPayload.totals.packagingFeeCny, 1.9);
assert.equal(missingRevenueCostPayload.totals.cogsCny, 30.3);
assert.equal(missingRevenueCostPayload.totals.profitSalesCny, 0);
assert.equal(missingRevenueCostPayload.totals.profitCogsCny, 0);
assert.equal(missingRevenueCostPayload.totals.estimatedProfitCny, 0);
assert.equal(missingRevenueCostPayload.quality.invalidSalesAmountLines, 1);

const multiLineOrderPayload = buildPerformanceAnalyticsPayload({
  facts: [
    { ...facts[0], id: "multi-1", sourceOrderId: "MULTI", orderNo: "MULTI", quantity: 3, salesAmount: 30, currency: "CNY" },
    { ...facts[0], id: "multi-2", sourceOrderId: "MULTI", orderNo: "MULTI", quantity: 2, salesAmount: 20, currency: "CNY" },
  ],
  products,
  exchangeRates: [
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
    { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
  ],
  packagingFeeRules: DEFAULT_PACKAGING_FEE_RULES,
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.equal(multiLineOrderPayload.totals.quantity, 5);
assert.equal(multiLineOrderPayload.totals.productCostCny, 71);
assert.equal(multiLineOrderPayload.totals.packagingFeeCny, 2.1);
assert.equal(multiLineOrderPayload.totals.cogsCny, 73.1);
assert.deepEqual(
  multiLineOrderPayload.recentFacts.map((row) => row.packagingFeeCny).sort((left, right) => left - right),
  [0.84, 1.26],
);

const disabledPackagingPayload = buildPerformanceAnalyticsPayload({
  facts: [facts[0]],
  products,
  exchangeRates: [
    { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
    { currency: "USD", effectiveDate: "2026-01-01", rateToCny: 7.1 },
  ],
  packagingFeeRules: [{ ...DEFAULT_PACKAGING_FEE_RULES[0], enabled: false }],
  filters: { dateFrom: "2026-08-01", dateTo: "2026-08-01" },
});
assert.equal(disabledPackagingPayload.totals.packagingFeeCny, 0);
assert.equal(disabledPackagingPayload.quality.missingPackagingRuleLines, 0, "an intentionally disabled country rule is configured, not missing");

const temporaryDirectory = mkdtempSync(join(tmpdir(), "tongzhou-performance-"));
try {
  const store = await initPerformanceAnalyticsStore(join(temporaryDirectory, "analytics.sqlite"));
  store.replaceSalesFacts([
    { providerId: "yunwms_ru", warehouseId: "ru", warehouseName: "俄罗斯仓", country: "俄罗斯", orderId: "O1", orderNo: "O1", shippedAt: "2026-08-01", sku: "A", quantity: 1, salesAmount: 80, currency: "CNY", salesAmountValid: true, salesAmountSource: "test" },
    { providerId: "yunwms_ru", warehouseId: "ru", warehouseName: "俄罗斯仓", country: "俄罗斯", orderId: "O1", orderNo: "O1", shippedAt: "2026-08-01", sku: "B", quantity: 3, salesAmount: 80, currency: "CNY", salesAmountValid: true, salesAmountSource: "test" },
  ], "2026-08-01T00:00:00.000Z");
  const stored = store.listSalesFacts({ dateFrom: "2026-08-01", dateTo: "2026-08-01" });
  assert.equal(stored.length, 2);
  assert.equal(stored.reduce((sum, row) => sum + row.salesAmount, 0), 80);
  store.upsertExchangeRates([{ currency: "IDR", effectiveDate: "2026-08-01", rateToCny: 0.00045 }]);
  assert.equal(store.listExchangeRates().find((row) => row.currency === "IDR")?.rateToCny, 0.00045);
  store.upsertExchangeRates([{ currency: "IDR", effectiveDate: "2026-08-01", rateToCny: 0.0004 }], "auto:frankfurter", { preserveOverrides: true });
  assert.equal(store.listExchangeRates().find((row) => row.currency === "IDR")?.rateToCny, 0.00045, "manual rates must win over same-day automatic rates");
  store.setExchangeRateSyncState({ lastSuccessAt: "2026-08-01T01:00:00.000Z", currencies: ["IDR"] });
  assert.deepEqual(store.getExchangeRateSyncState().currencies, ["IDR"]);
  store.setPerformanceSettings({
    packagingFeeRules: [
      { countryKey: "ID", countryName: "Indonesia", mode: "tiered", baseFeeCny: 2.2, includedQuantity: 3, additionalFeePerItemCny: 0.3, enabled: true },
    ],
    updatedBy: "test-admin",
  });
  store.upsertSupplementalProductCosts([
    { sku: "SKU-MISSING", countryKey: "ID", countryName: "印度尼西亚", productName: "未建档产品", unitCostCny: 6.25, effectiveDate: "2026-08-01", enabled: true, note: "首次导入" },
  ], "test-admin");
  assert.equal(store.listSupplementalProductCosts().length, 1);
  assert.equal(store.getMetadata().enabledSupplementalCostCount, 1);
  store.upsertSupplementalProductCosts([
    { sku: "SKU-MISSING", countryKey: "ID", countryName: "印度尼西亚", productName: "未建档产品", unitCostCny: 6.5, effectiveDate: "2026-08-01", enabled: false, note: "停用版本" },
  ], "test-reviewer");
  assert.equal(store.listSupplementalProductCosts().length, 1, "same SKU, country and effective date must update instead of duplicate");
  assert.equal(store.listSupplementalProductCosts()[0].unitCostCny, 6.5);
  assert.equal(store.listSupplementalProductCosts()[0].enabled, false);
  store.upsertMiaoshouPerformance({
    orders: [
      { identity: "shopee|SHOP-1|ORDER-LOOKUP-1", platform: "shopee", shopId: "SHOP-1", platformOrderSn: "ORDER-LOOKUP-1", site: "ID" },
      { identity: "shopee|SHOP-2|ORDER-LOOKUP-2", platform: "shopee", shopId: "SHOP-2", platformOrderSn: "ORDER-LOOKUP-2", site: "ID" },
    ],
  });
  assert.deepEqual(
    store.findMiaoshouOrdersByPlatformOrderSns(["ORDER-LOOKUP-2", "NOT-FOUND"]).map((row) => row.platformOrderSn),
    ["ORDER-LOOKUP-2"],
  );
  const reopenedStore = await initPerformanceAnalyticsStore(join(temporaryDirectory, "analytics.sqlite"));
  assert.equal(reopenedStore.getPerformanceSettings().packagingFeeRules[0].baseFeeCny, 2.2);
  assert.equal(reopenedStore.getPerformanceSettings().updatedBy, "test-admin");
  assert.equal(reopenedStore.listSupplementalProductCosts()[0].updatedBy, "test-reviewer");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const workerDirectory = mkdtempSync(join(tmpdir(), "tongzhou-performance-worker-"));
try {
  const workerDatabasePath = join(workerDirectory, "analytics.sqlite");
  const emptyStore = await initPerformanceAnalyticsStore(workerDatabasePath);
  emptyStore.close?.();
  const workerOrderCachePath = join(workerDirectory, "orders-sync.json");
  const workerMaterializationCachePath = join(workerDirectory, "performance-materialized.json.gz");
  const workerSyncedAt = "2026-09-08T15:30:00.000Z";
  writeFileSync(workerOrderCachePath, JSON.stringify({
    syncedAt: workerSyncedAt,
    orders: [{ ...facts[0], id: "worker-order", sourceOrderId: "WORKER-1", orderNo: "WORKER-1" }],
  }));
  writeFileSync(workerMaterializationCachePath, gzipSync(Buffer.from(JSON.stringify({ dataVersion: "stale-but-recent" }))));
  const workerResult = await runMaterializationWorker({
    dbPath: workerDatabasePath,
    orderCachePath: workerOrderCachePath,
    cachePath: workerMaterializationCachePath,
    sourceSyncedAt: "stale-db-timestamp",
    shopDirectory: {},
    products,
    exchangeRates: [
      { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 },
      { currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 0.00045 },
    ],
    packagingFeeRules: [],
    supplementalProductCosts: [],
    requestedSource: "wms",
    dataVersion: "worker-order-cache-test",
  });
  assert.equal(workerResult.facts.length, 1, "the worker must materialize directly from the order snapshot");
  assert.equal(workerResult.facts[0].orderNo, "WORKER-1");
  assert.equal(workerResult.sourceSyncedAt, workerSyncedAt, "the order snapshot timestamp must win over stale DB metadata");
  const persistedWorkerResult = JSON.parse(gunzipSync(readFileSync(workerMaterializationCachePath)).toString("utf8"));
  assert.equal(persistedWorkerResult.dataVersion, "worker-order-cache-test", "a fresh stale cache file must still be replaced by the new data version");
  assert.equal(persistedWorkerResult.sourceSyncedAt, workerSyncedAt);
} finally {
  rmSync(workerDirectory, { recursive: true, force: true });
}

console.log("performance analytics tests passed");

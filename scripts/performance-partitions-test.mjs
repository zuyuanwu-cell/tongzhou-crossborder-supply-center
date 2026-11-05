import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializePerformanceFacts } from "../server/performance-analytics.js";
import { materializeWithPartitions, partitionFacts, summarizePartitionRows } from "../server/performance-partitions.js";
import { createAnalyticsSummaryStore } from "../server/analytics-summary-store.js";
import { miaoshouBusinessDate, reconcileMiaoshouPerformance } from "../server/miaoshou-performance.js";
import { buildShopDirectory, shopDirectoryKey } from "../server/shop-directory.js";

const products = {
  productBase: [{ sku: "SKU-A", name: "A", brand: "BrandA" }, { sku: "SKU-B", name: "B", brand: "BrandB" }],
  catalog: [
    { sku: "SKU-A", country: "印度尼西亚", directCostPrice: 2, directCostCurrency: "CNY" },
    { sku: "SKU-B", country: "印度尼西亚", directCostPrice: 3, directCostCurrency: "CNY" },
  ],
};
const packagingFeeRules = [{ countryKey: "ID", countryName: "印度尼西亚", mode: "tiered", baseFeeCny: 1.9, includedQuantity: 4, additionalFeePerItemCny: 0.2, enabled: true }];
const baseRates = [{ currency: "IDR", effectiveDate: "2026-06-01", rateToCny: 0.0004 }, { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1 }];

function fact(day, order, sku, quantity, amount, extra = {}) {
  return {
    id: `${order}-${sku}`, sourceSystem: "sea_wms", warehouseId: "id", warehouseName: "印尼仓", sourceOrderId: order, orderNo: order,
    orderDate: day, shippedAt: `${day} 10:00:00`, country: "印度尼西亚", platform: "shopee", shopName: "Alpha", shopKey: "ID|shopee|alpha",
    sku, quantity, salesAmount: amount, currency: "IDR", salesAmountValid: true, ...extra,
  };
}

const facts = [
  fact("2026-06-01", "O1", "SKU-A", 2, 100000),
  fact("2026-06-01", "O1", "SKU-B", 3, 50000),
  fact("2026-06-02", "O2", "SKU-A", 1, 30000),
  fact("2026-06-03", "O3", "SKU-B", 1, 20000),
];
const materialize = (rates) => (subset) => materializePerformanceFacts({ facts: subset, products, exchangeRates: rates, packagingFeeRules });
const canonical = (rows) => rows.map((row) => JSON.stringify(row)).sort();

// --- 分区：同一订单落在同一分区 -------------------------------------------------------
const split = partitionFacts([...facts, fact("2026-06-04", "O1", "SKU-A", 1, 1)]);
assert.equal(split.get("2026-06-01").facts.length, 3, "拆分发货的订单按最早日期归入同一分区");
assert.equal(split.has("2026-06-04"), false);

const directory = mkdtempSync(join(tmpdir(), "perf-partitions-"));
try {
  const cacheDirectory = join(directory, "partitions");
  const first = materializeWithPartitions({ facts, cacheDirectory, staticHash: "s1", exchangeRates: baseRates, materialize: materialize(baseRates) });
  assert.equal(first.stats.partitionCount, 3);
  assert.equal(first.stats.rebuiltPartitionCount, 3);
  assert.deepEqual(canonical(first.rows), canonical(materialize(baseRates)(facts)), "分区物化结果与全量物化一致");
  const packagingTotal = first.rows.filter((row) => row.orderNo === "O1").reduce((sum, row) => sum + row.packagingFeeCny, 0);
  assert.ok(Math.abs(packagingTotal - 1.9 - 0.2) < 1e-6, "打包费按整单 5 件计算");

  const second = materializeWithPartitions({ facts, cacheDirectory, staticHash: "s1", exchangeRates: baseRates, materialize: materialize(baseRates) });
  assert.equal(second.stats.rebuiltPartitionCount, 0, "数据没变时不重算任何分区");
  assert.deepEqual(canonical(second.rows), canonical(first.rows));

  const changedFacts = facts.map((row) => (row.orderNo === "O3" ? { ...row, salesAmount: 25000 } : row));
  const third = materializeWithPartitions({ facts: changedFacts, cacheDirectory, staticHash: "s1", exchangeRates: baseRates, materialize: materialize(baseRates) });
  assert.deepEqual(third.rebuiltKeys, ["2026-06-03"], "只重算变化的日期");
  assert.deepEqual(canonical(third.rows), canonical(materialize(baseRates)(changedFacts)));

  const futureRates = [...baseRates, { currency: "IDR", effectiveDate: "2026-06-03", rateToCny: 0.00045 }];
  const fourth = materializeWithPartitions({ facts: changedFacts, cacheDirectory, staticHash: "s1", exchangeRates: futureRates, materialize: materialize(futureRates) });
  assert.deepEqual(fourth.rebuiltKeys, ["2026-06-03"], "新汇率只影响生效日期之后的分区");
  assert.deepEqual(canonical(fourth.rows), canonical(materialize(futureRates)(changedFacts)));

  const fifth = materializeWithPartitions({ facts: changedFacts, cacheDirectory, staticHash: "s2", exchangeRates: futureRates, materialize: materialize(futureRates) });
  assert.equal(fifth.stats.rebuiltPartitionCount, 3, "产品或规则变化时全部重算");

  const sixth = materializeWithPartitions({ facts: changedFacts.filter((row) => row.orderNo !== "O2"), cacheDirectory, staticHash: "s2", exchangeRates: futureRates, materialize: materialize(futureRates) });
  assert.deepEqual(sixth.removedKeys, ["2026-06-02"], "没有数据的分区被移除");

  // --- 日汇总 ----------------------------------------------------------------------
  const summary = summarizePartitionRows(first.rows, "2026-06-01");
  const day1 = summary.shopDay.find((row) => row.date === "2026-06-01");
  assert.equal(day1.orderCount, 1);
  assert.equal(day1.quantity, 5);
  assert.ok(Math.abs(day1.salesCny - 60) < 1e-6);

  // --- 汇总存储（内存） --------------------------------------------------------------
  const memoryStore = createAnalyticsSummaryStore({ partitionDir: cacheDirectory });
  await memoryStore.sync();
  const totalMemory = await memoryStore.query({ groupBy: "total", filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30" } });
  const expectedSales = sixth.rows.filter((row) => row.revenueCovered).reduce((sum, row) => sum + row.salesCny, 0);
  assert.ok(Math.abs(totalMemory.rows[0].salesCny - expectedSales) < 0.01, "内存汇总与事实合计一致");
  assert.equal(totalMemory.rows[0].orderCount, 2);
  const byBrand = await memoryStore.query({ groupBy: "brand", filters: {} });
  assert.deepEqual(byBrand.rows.map((row) => row.brand).sort(), ["BrandA", "BrandB"]);
  const byDay = await memoryStore.query({ groupBy: "day", filters: { country: "ID" } });
  assert.deepEqual(byDay.rows.map((row) => row.date), ["2026-06-01", "2026-06-03"]);

  // --- 汇总存储（PostgreSQL，可选） ---------------------------------------------------
  const databaseUrl = process.env.TEST_ANALYTICS_DATABASE_URL;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query("DROP TABLE IF EXISTS analytics_shop_daily, analytics_sku_daily, analytics_partitions");
    await admin.end();
    const pgStore = createAnalyticsSummaryStore({ databaseUrl, partitionDir: cacheDirectory });
    const firstSync = await pgStore.sync();
    assert.equal(firstSync.synced, 2);
    const again = await pgStore.sync();
    assert.equal(again.synced, 0, "分区哈希未变时不重复写入");
    for (const groupBy of ["total", "day", "shop", "brand", "sku"]) {
      const fromPg = await pgStore.query({ groupBy, filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30" } });
      const fromMemory = await memoryStore.query({ groupBy, filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30" } });
      assert.equal(fromPg.backend, "postgres");
      const key = (row) => JSON.stringify([row.date, row.shopKey, row.brand, row.sku]);
      const normalize = (rows) => rows.map((row) => ({ key: key(row), salesCny: Math.round(row.salesCny * 100), orderCount: row.orderCount, quantity: row.quantity })).sort((a, b) => a.key.localeCompare(b.key));
      assert.deepEqual(normalize(fromPg.rows), normalize(fromMemory.rows), `PostgreSQL 与内存汇总一致：${groupBy}`);
    }
    materializeWithPartitions({ facts: [...changedFacts.filter((row) => row.orderNo !== "O2"), fact("2026-06-05", "O5", "SKU-A", 1, 10000)], cacheDirectory, staticHash: "s2", exchangeRates: futureRates, materialize: materialize(futureRates) });
    const incremental = await pgStore.sync();
    assert.equal(incremental.synced, 1, "只同步新增或变化的分区");
    const afterAdd = await pgStore.query({ groupBy: "day", filters: {} });
    assert.ok(afterAdd.rows.some((row) => row.date === "2026-06-05"));
    await pgStore.close();
    console.log("[ok] postgres summary store");
  } else {
    console.log("[skip] postgres summary store (set TEST_ANALYTICS_DATABASE_URL)");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// --- 按店铺切换妙手口径 + 妙手主来源 ---------------------------------------------------
assert.equal(miaoshouBusinessDate("2026-06-01T17:30:00.000Z", "ID"), "2026-06-02", "印尼按 UTC+7 归日");
assert.equal(miaoshouBusinessDate("2026-06-01T15:30:00.000Z", "MY"), "2026-06-01");

const orders = [];
const items = [];
const wmsFacts = [];
for (let index = 0; index < 12; index += 1) {
  const orderNo = `GOOD-${index}`;
  orders.push({ identity: `shopee|MS1|${orderNo}`, platform: "shopee", shopId: "MS1", platformOrderSn: orderNo, site: "ID", currency: "IDR", payAmount: 1000, paidAt: "2026-06-01T03:00:00.000Z" });
  items.push({ identity: `shopee|MS1|${orderNo}|1`, orderIdentity: `shopee|MS1|${orderNo}`, platformOuterSkuId: "SKU-A", quantity: 1, discountedPrice: 1000 });
  wmsFacts.push(fact("2026-06-03", orderNo, "SKU-A", 1, 1000, { shopName: "Good Shop", rawShopName: "Good Shop", shopKey: "ID|shopee|goodshop", miaoshouShopId: "MS1" }));
}
for (let index = 0; index < 12; index += 1) {
  const orderNo = `BAD-${index}`;
  if (index % 2 === 0) {
    orders.push({ identity: `shopee|MS2|${orderNo}`, platform: "shopee", shopId: "MS2", platformOrderSn: orderNo, site: "ID", currency: "IDR", payAmount: 1000, paidAt: "2026-06-01T03:00:00.000Z" });
    items.push({ identity: `shopee|MS2|${orderNo}|1`, orderIdentity: `shopee|MS2|${orderNo}`, platformOuterSkuId: "SKU-A", quantity: 1 });
  }
  wmsFacts.push(fact("2026-06-03", orderNo, "SKU-A", 1, 1000, { shopName: "Bad Shop", rawShopName: "Bad Shop", shopKey: "ID|shopee|badshop", miaoshouShopId: "MS2" }));
}
// 只在妙手里、还没出库的订单
orders.push({ identity: "shopee|MS1|PENDING-1", platform: "shopee", shopId: "MS1", platformOrderSn: "PENDING-1", site: "ID", currency: "IDR", payAmount: 5000, paidAt: "2026-06-02T18:00:00.000Z" });
items.push({ identity: "shopee|MS1|PENDING-1|1", orderIdentity: "shopee|MS1|PENDING-1", platformOuterSkuId: "SKU-B", quantity: 2, discountedPrice: 2500 });
orders.push({ identity: "shopee|MS1|CANCELLED-1", platform: "shopee", shopId: "MS1", platformOrderSn: "CANCELLED-1", site: "ID", currency: "IDR", payAmount: 5000, paidAt: "2026-06-02T03:00:00.000Z" });
const shopDirectory = {
  shops: [
    { key: "ID|shopee|goodshop", rawName: "Good Shop", displayName: "Good Shop", platform: "shopee", country: "印度尼西亚", projectGroup: "一组", miaoshouShopId: "MS1" },
    { key: "ID|shopee|badshop", rawName: "Bad Shop", displayName: "Bad Shop", platform: "shopee", country: "印度尼西亚", projectGroup: "二组", miaoshouShopId: "MS2" },
  ],
};
const syncState = { status: "success", lastSuccessAt: "2026-06-04T00:00:00.000Z" };
const cancellations = [{ orderIdentity: "shopee|MS1|CANCELLED-1", finalized: true, statusClass: "finalized" }];

const shadow = reconcileMiaoshouPerformance({ facts: wmsFacts, orders, items, cancellations, syncState, shopDirectory, requestedSource: "shadow", enabledShopKeys: ["ID|shopee|goodshop"] });
assert.equal(shadow.reconciliation.effectiveSource, "wms", "影子模式不替换");
assert.equal(shadow.facts.length, wmsFacts.length);
const good = shadow.reconciliation.shops.find((row) => row.shopKey === "ID|shopee|goodshop");
const bad = shadow.reconciliation.shops.find((row) => row.shopKey === "ID|shopee|badshop");
assert.equal(good.activationEligible, true);
assert.equal(good.miaoshouOnlyOrderCount, 2);
assert.equal(bad.activationEligible, false);
assert.match(bad.blockers.join(""), /匹配率/);
assert.equal(shadow.reconciliation.activationEligible, false, "全局门槛被差店铺拖累");

const perShop = reconcileMiaoshouPerformance({ facts: wmsFacts, orders, items, cancellations, syncState, shopDirectory, requestedSource: "per_shop", enabledShopKeys: ["ID|shopee|goodshop", "ID|shopee|badshop"] });
assert.equal(perShop.reconciliation.effectiveSource, "mixed");
assert.equal(perShop.reconciliation.effectiveShopCount, 1, "只有达标的店铺生效");
const goodFacts = perShop.facts.filter((row) => row.shopKey === "ID|shopee|goodshop");
assert.ok(goodFacts.filter((row) => row.sourceSystem === "sea_wms").every((row) => row.orderDate === "2026-06-01" && row.orderDateSource === "miaoshou_paid"), "已切换店铺按支付日期归日");
const pending = goodFacts.filter((row) => row.sourceSystem === "miaoshou");
assert.equal(pending.length, 1, "补入未出库的妙手订单，已取消订单不补");
assert.equal(pending[0].orderDate, "2026-06-03", "印尼 UTC+7：UTC 18:00 归到次日");
assert.equal(pending[0].salesAmount, 5000);
assert.equal(pending[0].fulfillmentStatus, "pending_wms");
assert.equal(perShop.reconciliation.addedMiaoshouFactCount, 1);
const badFacts = perShop.facts.filter((row) => row.shopKey === "ID|shopee|badshop");
assert.ok(badFacts.every((row) => row.orderDate === "2026-06-03" && row.salesAmountScope !== "miaoshou_order_allocated"), "未达标店铺保持 WMS");

const gapBlocked = reconcileMiaoshouPerformance({ facts: wmsFacts, orders, items, syncState: { ...syncState, afterSalesGaps: [{ kind: "return", platform: "shopee" }] }, shopDirectory, requestedSource: "per_shop", enabledShopKeys: ["ID|shopee|goodshop"] });
assert.equal(gapBlocked.reconciliation.effectiveShopCount, 0, "同平台有售后缺口时不切换");

// --- 店铺人工绑定妙手 ID ---------------------------------------------------------------
const wmsOrders = [{ country: "印度尼西亚", platform: "shopee", shopName: "Store Alpha (ID)", warehouseId: "id", orderId: "1" }];
const key = shopDirectoryKey({ ...wmsOrders[0], rawShopName: "Store Alpha (ID)" });
const miaoshouShops = [{ shopId: "S-9", platform: "shopee", site: "ID", platformShopName: "Store Alpha", shopNick: "Alpha 印尼" }];
const auto = buildShopDirectory({ orders: wmsOrders, miaoshouShops, settings: {} });
assert.equal(auto.shops[0].miaoshouMatched, false, "名称不完全一致时不自动关联");
assert.equal(auto.shops[0].miaoshouSuggestedShopId, "S-9", "给出建议");
const bound = buildShopDirectory({ orders: wmsOrders, miaoshouShops, settings: { shopMiaoshouBindings: { [key]: { miaoshouShopId: "S-9" } } } });
assert.equal(bound.shops[0].miaoshouShopId, "S-9");
assert.equal(bound.shops[0].miaoshouMatchSource, "manual");
const unbound = buildShopDirectory({ orders: [{ ...wmsOrders[0], shopName: "Store Alpha" }], miaoshouShops, settings: { shopMiaoshouBindings: { [shopDirectoryKey({ ...wmsOrders[0], rawShopName: "Store Alpha" })]: { miaoshouShopId: "" } } } });
assert.equal(unbound.shops[0].miaoshouMatched, false, "明确不关联时不自动匹配");
const stale = buildShopDirectory({ orders: wmsOrders, miaoshouShops, settings: { shopMiaoshouBindings: { [key]: { miaoshouShopId: "GONE" } } } });
assert.equal(stale.shops[0].miaoshouBindingStale, true);
assert.equal(bound.miaoshouShops.length, 1);

console.log("performance partitions tests passed");

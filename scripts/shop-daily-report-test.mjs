import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateSystemShopDaily,
  buildShopDailyOrderDrilldown,
  buildShopDailyReport,
  normalizeShopFeeRules,
  parseReportDate,
  parseShopDailyImport,
  prepareShopDailyMetrics,
  resolveShopFeeRule,
} from "../server/shop-daily-report.js";
import { initShopDailyReportStore } from "../server/shop-daily-report-db.js";
import { shopDirectoryKey } from "../server/shop-directory.js";

const close = (actual, expected, message, tolerance = 0.01) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`);
};

const shopA = { country: "印度尼西亚", platform: "Shopee", rawName: "Alpha Beauty Store", displayName: "Alpha Beauty Store", projectGroup: "印尼一组" };
shopA.key = shopDirectoryKey({ ...shopA, rawShopName: shopA.rawName });
const shopB = { country: "印度尼西亚", platform: "TikTok", rawName: "Beta Glow Shop", displayName: "Beta Glow Shop", projectGroup: "印尼二组" };
shopB.key = shopDirectoryKey({ ...shopB, rawShopName: shopB.rawName });
const shopTwin = { country: "印度尼西亚", platform: "TikTok", rawName: "Alpha Beauty Store", displayName: "Alpha Beauty Store", projectGroup: "印尼二组" };
shopTwin.key = shopDirectoryKey({ ...shopTwin, rawShopName: shopTwin.rawName });
const shops = [shopA, shopB];

// --- 日期识别 ---------------------------------------------------------------
assert.equal(parseReportDate("46174"), "2026-06-01", "Excel 序列号");
assert.equal(parseReportDate("2026/6/3"), "2026-06-03");
assert.equal(parseReportDate("2026年6月3日"), "2026-06-03");
assert.equal(parseReportDate("6月3日", 2026), "2026-06-03");
assert.equal(parseReportDate("汇总"), "");

// --- 解析运营表（从 Excel 直接复制，两行表头、合并日期、占位行、汇总行） --------------
const header1 = ["店铺数据-印尼汇率计算-2400", "", "", "", "", "", "", "", "", "测评", "", "", "", "", "", "", "实际成交", "", "", "推广", "", "", "", "", "", "", "数据指标", "", "", "", "", "", "产品\n成本", "利润", ""];
const header2 = ["日期", "店铺", "国家", "支付金额", "（人民币）", "展示数", "访客数", "订单数", "加购人数", "测评金额", "实际收款\n金额", "测评金额\n（人民币）", "实际收款\n(人民币)", "差额\n(人民币)", "测评数量", "测评成本", "真实成交金额", "真实成交金额（人民币）", "真实订单数", "站内\n推广费", "站内推广费  （人民币）", "站外\n推广费", "站外推广费  （人民币）", "总推广费", "总推广费(人民币)", "ROI", "点击单价", "点击率", "加购率", "转化率", "客单价\n(外币)", "客单价\n（人民币）", "", "利润预估", "操作费"];
function sheetRow(values) {
  const row = new Array(header2.length).fill("");
  for (const [column, value] of Object.entries(values)) row[Number(column)] = String(value);
  return row;
}
const tsv = [
  header1,
  header2,
  sheetRow({ 0: "46174", 1: "Alpha Beauty Store", 2: "印尼", 3: "8,181,960", 4: "3409.15", 5: "81733", 6: "1635", 7: "59", 8: "205", 19: "2078066", 32: "878.19", 34: "98.4" }),
  sheetRow({ 1: "Beta Glow Shop", 2: "印尼", 3: "1912270", 5: "20869", 6: "645", 7: "19", 8: "84", 9: "66000", 10: "55532", 14: "1", 19: "906126" }),
  sheetRow({ 1: "7", 2: "印尼" }),
  sheetRow({ 0: "46175", 1: "Alpha Beauty Store", 2: "印尼", 3: "5691903", 5: "71424", 6: "1296", 7: "46", 8: "132", 19: "1516437" }),
  sheetRow({ 0: "汇总", 1: "Alpha Beauty Store", 2: "印尼", 3: "13873863" }),
].map((cells) => cells.map((value) => (value.includes("\n") ? `"${value}"` : value)).join("\t")).join("\n");

const parsed = parseShopDailyImport(tsv, { defaultYear: 2026 });
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.rows.length, 3, "占位行和汇总行不导入");
assert.equal(parsed.skipped, 2);
assert.ok(parsed.columns.includes("productCostCny"), "合并单元格里的「产品成本」表头来自第一行");
assert.ok(!parsed.columns.includes("profit"), "人民币换算列与利润列不导入");
assert.equal(parsed.rows[0].date, "2026-06-01");
assert.equal(parsed.rows[1].date, "2026-06-01", "合并日期向下沿用");
assert.equal(parsed.rows[0].payAmount, 8181960, "千分位逗号");
assert.equal(parsed.rows[0].productCostCny, 878.19);
assert.equal(parsed.rows[0].operationFeeCny, 98.4);
assert.equal(parsed.rows[1].reviewAmount, 66000);
assert.equal(parsed.rows[1].reviewReceived, 55532);

const csv = "日期,店铺,平台,国家,访客数,站内推广费\n2026-06-02,Beta Glow Shop,TikTok,ID,700,\"1,000\"\n";
const parsedCsv = parseShopDailyImport(csv);
assert.equal(parsedCsv.rows[0].visitors, 700);
assert.equal(parsedCsv.rows[0].adOnsite, 1000);
assert.equal(parseShopDailyImport("hello\nworld").errors.length, 1, "缺少表头时提示");

// --- 店铺匹配 -----------------------------------------------------------------
const prepared = prepareShopDailyMetrics(parsed.rows, shops);
assert.equal(prepared.errors.length, 0);
assert.equal(prepared.rows.find((row) => row.date === "2026-06-01" && row.shopName === "Alpha Beauty Store")?.shopKey, shopA.key);
const ambiguous = prepareShopDailyMetrics([{ date: "2026-06-01", shopName: "Alpha Beauty Store", country: "印尼", visitors: 1 }], [shopA, shopTwin]);
assert.equal(ambiguous.rows.length, 0, "同名店铺不能猜");
assert.match(ambiguous.errors[0].message, /平台/);
const disambiguated = prepareShopDailyMetrics([{ date: "2026-06-01", shopName: "alpha beauty store", country: "ID", platform: "TikTok Shop", visitors: 1 }], [shopA, shopTwin]);
assert.equal(disambiguated.rows[0].shopKey, shopTwin.key, "平台列用于区分同名店铺");
const standalone = prepareShopDailyMetrics([{ date: "2026-06-01", shopName: "New Shop", country: "印尼", platform: "shopee", visitors: 3 }], shops);
assert.equal(standalone.rows.length, 1);
assert.equal(standalone.rows[0].standalone, true);
assert.equal(standalone.warnings.length, 1);

// --- 费率规则匹配 ---------------------------------------------------------------
const rules = normalizeShopFeeRules([
  { scope: "default", commissionRate: 0.165, reviewUnitCostCny: 10.4 },
  { scope: "country", countryKey: "印尼", commissionRate: 0.165, perOrderFee: 1250, adTaxRate: 0.11, fixedLocalPerCny: 2400 },
  {
    scope: "shop", shopKey: shopB.key, mode: "stacked", stackedNetRate: 0.868, stackedFactor1: 0.97, stackedFactor2: 0.95,
    stackedExtraRate: 0.05, perOrderFee: 1.6, perOrderFeeCurrency: "CNY", adTaxRate: 0.11, fixedLocalPerCny: 2400,
    useSystemOperationFee: false,
  },
]);
assert.equal(resolveShopFeeRule(rules, { shopKey: shopA.key, country: "印度尼西亚", platform: "Shopee" }).id, "country:ID");
assert.equal(resolveShopFeeRule(rules, { shopKey: shopB.key, country: "印度尼西亚" }).id, `shop:${shopB.key}`);
assert.equal(resolveShopFeeRule(rules, { country: "越南" }).id, "default");

// --- 日报计算与运营表公式一致 -----------------------------------------------------
const metrics = prepared.rows.map((row) => ({ shopKey: row.shopKey, date: row.date, currency: "", source: "import", ...row.values }));
const report = buildShopDailyReport({
  shops,
  metrics,
  rules,
  exchangeRates: [{ currency: "IDR", effectiveDate: "2026-01-01", rateToCny: 1 / 2300 }],
  filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30" },
});
const alpha = report.rows.find((row) => row.shopKey === shopA.key && row.date === "2026-06-01");
const rate = 2400;
const R = 8181960 / rate;
const Y = (2078066 * 1.11) / rate;
close(alpha.payCny, 8181960 / rate, "支付金额人民币按固定汇率");
close(alpha.realSalesCny, R, "真实成交");
close(alpha.adTotalCny, Y, "推广费含税");
close(alpha.roi, R / Y, "ROI", 0.0001);
close(alpha.visitRate, 1635 / 81733, "点击率", 0.0001);
close(alpha.conversionRate, 59 / 1635, "转化率", 0.0001);
close(alpha.aovLocal, 8181960 / 59, "客单价外币", 1);
const expectedStandard = R - R * 0.165 - (59 * 1250) / rate - Y - 0 - 878.19 - 98.4;
close(alpha.profitCny, expectedStandard, "标准公式利润");
close(alpha.platformFeeCny, R * 0.165 + (59 * 1250) / rate, "平台扣费拆分");

const beta = report.rows.find((row) => row.shopKey === shopB.key);
const betaRealSales = (1912270 - 66000) / rate;
const betaReview = (66000 - 55532) / rate + 1 * 10.4;
const betaAd = (906126 * 1.11) / rate;
close(beta.reviewCostCny, betaReview, "测评成本 = 差额 + 数量 × 单位成本");
assert.equal(beta.realOrders, 18);
const expectedStacked = ((betaRealSales * 0.868 - betaAd) * 0.97) * 0.95 - betaReview - 18 * 1.6 - 0 - betaRealSales * 0.05;
close(beta.profitCny, expectedStacked, "叠乘公式利润");
assert.ok(beta.flags.includes("missing_ad") === false);

// 汇总比率用合计重算，而不是把每天的比率相加。
const alphaShop = report.shops.find((row) => row.shopKey === shopA.key);
assert.equal(alphaShop.days, 2);
close(alphaShop.conversionRate, (59 + 46) / (1635 + 1296), "店铺转化率按合计计算", 0.0001);
close(report.totals.visitors, 1635 + 645 + 1296, "总访客");
close(report.totals.realSalesCny, report.rows.reduce((sum, row) => sum + row.realSalesCny, 0), "总成交等于明细合计");

// --- 中台订单兜底与测评订单登记 ----------------------------------------------------
const systemFacts = [
  { shopKey: shopA.key, shopName: "Alpha Beauty Store", country: "印度尼西亚", platform: "Shopee", orderDate: "2026-06-05", orderIdentity: "wms|1|A1", orderNo: "A1", quantity: 2, salesAmount: 230000, currency: "IDR", salesAmountValid: true, revenueCovered: true, salesCny: 100, productCostCny: 20, packagingFeeCny: 1.9 },
  { shopKey: shopA.key, shopName: "Alpha Beauty Store", country: "印度尼西亚", platform: "Shopee", orderDate: "2026-06-05", orderIdentity: "wms|1|A2", orderNo: "A2", quantity: 1, salesAmount: 115000, currency: "IDR", salesAmountValid: true, revenueCovered: true, salesCny: 50, productCostCny: 10, packagingFeeCny: 1.9 },
  { shopKey: shopA.key, orderDate: "2026-05-30", orderIdentity: "wms|1|OLD", orderNo: "OLD", quantity: 1, salesAmount: 50000, currency: "IDR", salesAmountValid: true, revenueCovered: true, salesCny: 20 },
];
const system = aggregateSystemShopDaily(systemFacts, { dateFrom: "2026-06-01", dateTo: "2026-06-30", orderNos: ["A2", "OLD"] });
assert.equal(system.rows.length, 1);
assert.equal(system.rows[0].orderCount, 2);
assert.equal(system.rows[0].salesAmount, 345000);
assert.equal(system.orderLookup.A2.amount, 115000);
assert.equal(system.orderLookup.OLD.amount, 50000, "测评订单查询不受日期区间限制");
const fallback = buildShopDailyReport({
  shops,
  systemDaily: system.rows,
  reviewOrders: [{ shopKey: shopA.key, date: "2026-06-05", orderNo: "A2", amount: null, receivedAmount: 100000, quantity: 1 }],
  reviewOrderLookup: system.orderLookup,
  rules,
  filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30" },
});
const fallbackRow = fallback.rows[0];
assert.equal(fallbackRow.sources.revenue, "system");
assert.ok(fallbackRow.flags.includes("system_revenue"));
assert.ok(fallbackRow.flags.includes("missing_traffic"));
assert.equal(fallbackRow.orderCount, 2);
assert.equal(fallbackRow.reviewCount, 1);
close(fallbackRow.reviewAmountCny, 115000 / rate, "登记订单号自动取订单金额");
close(fallbackRow.productCostCny, 30, "未导入成本时使用中台产品成本");
close(fallbackRow.operationFeeCny, 3.8, "未导入操作费时使用中台打包费");
assert.equal(fallback.quality.rowsUsingSystemRevenue, 1);

// --- 订单穿透：多商品行合并、搜索、分页与金额汇总 -------------------------------
const detailFacts = [
  { ...systemFacts[0], orderIdentity: "wms|1|A1", sku: "SKU-1", productName: "洁面泡沫", imageUrl: "https://example.com/1.jpg", salesCny: 70, salesAmount: 161000, productCostCny: 14, packagingFeeCny: 1.2, status: "shipped", sourceSystem: "wms" },
  { ...systemFacts[0], orderIdentity: "wms|1|A1", sku: "SKU-2", productName: "护手霜", quantity: 1, salesCny: 30, salesAmount: 69000, productCostCny: 6, packagingFeeCny: 0.7, status: "shipped", sourceSystem: "wms" },
  { ...systemFacts[1], sku: "SKU-3", productName: "防晒霜", status: "pending", sourceSystem: "wms" },
  { ...systemFacts[2], sku: "SKU-OLD", productName: "旧订单" },
];
const details = buildShopDailyOrderDrilldown(detailFacts, { dateFrom: "2026-06-01", dateTo: "2026-06-30", shopKey: shopA.key, page: 1, pageSize: 1 });
assert.equal(details.total, 2, "日期与店铺范围内有两笔订单");
assert.equal(details.pageCount, 2);
assert.equal(details.orders[0].items.length, 2, "同一订单的多条商品行合并");
assert.equal(details.orders[0].quantity, 3);
assert.equal(details.orders[0].salesCny, 100);
assert.equal(details.totals.salesCny, 150, "汇总使用全部匹配订单而非当前页");
const searchedDetails = buildShopDailyOrderDrilldown(detailFacts, { dateFrom: "2026-06-01", dateTo: "2026-06-30", shopKey: shopA.key, search: "防晒" });
assert.equal(searchedDetails.total, 1, "支持按商品名称搜索订单");
assert.equal(searchedDetails.orders[0].orderNo, "A2");

// --- 筛选 ---------------------------------------------------------------------
const filtered = buildShopDailyReport({ shops, metrics, rules, filters: { dateFrom: "2026-06-01", dateTo: "2026-06-30", projectGroup: "印尼二组" } });
assert.deepEqual([...new Set(filtered.rows.map((row) => row.shopKey))], [shopB.key]);

// --- 存储：分字段合并写入 -----------------------------------------------------------
const directory = mkdtempSync(join(tmpdir(), "shop-daily-"));
try {
  const dbPath = join(directory, "shop-daily.sqlite");
  const store = await initShopDailyReportStore(dbPath);
  store.upsertMetrics([{ shopKey: shopA.key, date: "2026-06-01", values: { visitors: 100, impressions: 1000 } }], { source: "ziniao", updatedBy: "collector" });
  store.upsertMetrics([{ shopKey: shopA.key, date: "2026-06-01", values: { adOnsite: 5000 } }], { source: "import", updatedBy: "运营" });
  let stored = store.listMetrics({ dateFrom: "2026-06-01", dateTo: "2026-06-01" });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].visitors, 100, "后写入推广费不覆盖已采集流量");
  assert.equal(stored[0].adOnsite, 5000);
  assert.equal(stored[0].payAmount, null, "未提供的字段保持为空");
  assert.equal(stored[0].fieldSources.visitors, "ziniao", "按字段记录来源");
  assert.equal(stored[0].fieldSources.adOnsite, "import");
  const sourced = buildShopDailyReport({ shops, metrics: stored, rules, filters: {} });
  assert.equal(sourced.rows[0].sources.traffic, "ziniao");
  assert.equal(sourced.rows[0].sources.ad, "import");

  const saved = store.saveReviewOrders([{ shopKey: shopA.key, date: "2026-06-01", orderNo: "X1", amount: 10000 }], "运营");
  store.saveReviewOrders([{ shopKey: shopA.key, date: "2026-06-01", orderNo: "X1", amount: 12000 }], "运营");
  assert.equal(store.listReviewOrders({}).length, 1, "同一店铺同一订单号只登记一次");
  assert.equal(store.listReviewOrders({})[0].amount, 12000);
  const savedRules = store.setFeeRules([{ scope: "default", commissionRate: 0.2 }], "财务");
  assert.equal(savedRules[0].commissionRate, 0.2);
  store.close();

  const reopened = await initShopDailyReportStore(dbPath);
  stored = reopened.listMetrics({});
  assert.equal(stored[0].adOnsite, 5000, "重启后数据仍在");
  assert.equal(reopened.getFeeRules()[0].commissionRate, 0.2);
  assert.equal(reopened.deleteReviewOrder(saved[0].id), 1);
  assert.equal(reopened.metadata().metricCount, 1);
  assert.equal(reopened.listImportLog().length, 2);
  reopened.close();
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log("shop daily report tests passed");

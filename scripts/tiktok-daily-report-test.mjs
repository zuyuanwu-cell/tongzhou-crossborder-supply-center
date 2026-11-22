import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildShopDailyReport } from "../server/shop-daily-report.js";
import { initShopDailyReportStore } from "../server/shop-daily-report-db.js";

const require = createRequire(import.meta.url);
const platforms = require("../desktop/tongzhou-zhishu/core/platforms");
const tiktok = require("../desktop/tongzhou-zhishu/core/platforms/tiktok");
const { extractMetrics, fillRequest, placeholderValues, validateTemplate } = require("../desktop/tongzhou-zhishu/core/recipe");

assert.equal(platforms.getPlatform("tiktok")?.id, "tiktok");
assert.equal(tiktok.matchStore({ platform: "TikTok Shop" }), true);
assert.equal(tiktok.matchStore({ platform: "Shopee" }), false);
assert.equal(tiktok.originFor("MY"), "https://seller-my.tiktok.com");
assert.equal(tiktok.defaultSalesChannel("ID"), "UNSPECIFIED");
assert.equal(tiktok.defaultSalesChannel("VN"), "TIKTOK_SHOP");
assert.equal(tiktok.checkPage({ href: "https://seller-id.tiktok.com/compass/overview" }).ok, true);
assert.equal(tiktok.checkPage({ href: "https://seller-id.tiktok.com/account/login" }).code, "NOT_LOGGED_IN");
const tiktokTemplate = tiktok.builtinTemplates()[0];
assert.equal(tiktokTemplate.requiresCalibration, undefined);
assert.deepEqual(validateTemplate(tiktokTemplate), []);

const malaysiaRequest = fillRequest(tiktokTemplate.endpoints[0], placeholderValues({
  date: "2026-11-20", site: "MY", origin: tiktok.originFor("MY"),
}));
assert.match(malaysiaRequest.url, /us_overview_stats$/);
const malaysiaBody = JSON.parse(malaysiaRequest.body);
assert.equal(malaysiaBody.query_condition[0].query_time.timezone_offset, 480);
assert.deepEqual(malaysiaBody.query_condition[0].metrics.map((metric) => metric.metric_id), [4024, 4031, 6068, 6070]);

const indonesiaRequest = fillRequest(tiktokTemplate.endpoints[0], placeholderValues({
  date: "2026-11-20", site: "ID", origin: tiktok.originFor("ID"),
}));
assert.match(indonesiaRequest.url, /toko_overview_stats$/);
const indonesiaBody = JSON.parse(indonesiaRequest.body);
assert.equal(indonesiaBody.query_condition[0].query_time.timezone_offset, 420);
assert.deepEqual(indonesiaBody.query_condition[0].metrics.map((metric) => metric.metric_id), [6189, 6187, 6196, 6198]);

const overviewResponse = (values) => ({ json: { data: [{ intervals: [{ rows: [{ values }] }] }] } });
assert.deepEqual(extractMetrics(tiktokTemplate, {
  overview: overviewResponse({ 4024: "123.45", 4031: "6", 6068: "789", 6070: "45" }),
}), { values: { payAmount: 123.45, orderCount: 6, impressions: 789, visitors: 45 }, missing: [] });
assert.deepEqual(extractMetrics(tiktokTemplate, {
  overview: overviewResponse({ 6189: "543.21", 6187: "9", 6196: "876", 6198: "54" }),
}), { values: { payAmount: 543.21, orderCount: 9, impressions: 876, visitors: 54 }, missing: [] });

const directory = mkdtempSync(join(tmpdir(), "tongzhou-tiktok-daily-"));
const dbPath = join(directory, "daily.db");
const store = await initShopDailyReportStore(dbPath);
const shopKey = "ID|TikTok Shop|beta-glow";
const base = {
  shopKey,
  date: "2026-11-20",
  shopName: "Beta Glow",
  country: "印度尼西亚",
  platform: "TikTok Shop",
  currency: "IDR",
  purchaseChannel: "APP",
  timezone: "Asia/Jakarta",
  definitionVersion: "tiktok-daily-v1",
};

store.upsertMetrics([
  {
    ...base,
    salesChannel: "TIKTOK_SHOP",
    dataStatus: "PARTIAL",
    missingModules: ["live"],
    values: {
      payAmount: 1_000_000,
      orderCount: 10,
      buyerCount: 9,
      sellerGmv: 700_000,
      affiliateGmv: 300_000,
      productCardGmv: 400_000,
      videoGmv: 600_000,
      adsCost: 100_000,
      adsGrossRevenue: 500_000,
      refundAmount: 10_000,
      cancelAmount: 5_000,
      stockOnHand: 120,
    },
  },
  {
    ...base,
    salesChannel: "TOKOPEDIA",
    dataStatus: "COMPLETE",
    missingModules: [],
    values: {
      payAmount: 500_000,
      orderCount: 5,
      buyerCount: 5,
      sellerGmv: 500_000,
      productCardGmv: 500_000,
      stockOnHand: 100,
    },
  },
], { source: "desktop:tiktok", updatedBy: "test" });

const stored = store.listMetrics({ dateFrom: "2026-11-20", dateTo: "2026-11-20" });
assert.equal(stored.length, 2);
assert.deepEqual(stored.map((row) => row.salesChannel).sort(), ["TIKTOK_SHOP", "TOKOPEDIA"]);
assert.deepEqual(stored.find((row) => row.salesChannel === "TIKTOK_SHOP")?.missingModules, ["live"]);

const shops = [{
  key: shopKey,
  country: "印度尼西亚",
  platform: "TikTok Shop",
  rawName: "Beta Glow",
  displayName: "Beta Glow",
}];
const report = buildShopDailyReport({
  shops,
  metrics: stored,
  exchangeRates: [{ currency: "IDR", effectiveDate: "2026-11-20", rateToCny: 0.00043 }],
  filters: { dateFrom: "2026-11-20", dateTo: "2026-11-20" },
});
assert.equal(report.tiktok.available, true);
assert.equal(report.tiktok.business.orders, 15, "印尼双渠道按渠道去重后汇总");
assert.equal(report.tiktok.business.buyers, 14);
assert.deepEqual(report.tiktok.channels, ["TIKTOK_SHOP", "TOKOPEDIA"]);
assert.equal(report.tiktok.dataStatus, "PARTIAL");
assert.deepEqual(report.tiktok.missingModules, ["live", "buyer_dedup"], "跨渠道买家数必须标记待周期去重");
assert.equal(report.tiktok.business.stockOnHand, 120, "共享库存取最新快照，不得双算");
assert.ok(report.tiktok.ads.roas > 0);

const tokopediaOnly = buildShopDailyReport({
  shops,
  metrics: stored,
  exchangeRates: [{ currency: "IDR", effectiveDate: "2026-11-20", rateToCny: 0.00043 }],
  filters: { dateFrom: "2026-11-20", dateTo: "2026-11-20", salesChannel: "TOKOPEDIA" },
});
assert.equal(tokopediaOnly.tiktok.business.orders, 5);
assert.deepEqual(tokopediaOnly.tiktok.channels, ["TOKOPEDIA"]);

store.close();
rmSync(directory, { recursive: true, force: true });
console.log("TIKTOK_DAILY_REPORT_TEST_OK");

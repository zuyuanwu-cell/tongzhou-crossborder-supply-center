"use strict";

const SELLER_ORIGINS = Object.freeze({
  ID: "https://seller-id.tiktok.com",
  MY: "https://seller-my.tiktok.com",
  VN: "https://seller-vn.tiktok.com",
});

const DISCOVERY_PAGES = Object.freeze(["/compass/overview", "/analytics/overview", "/home"]);
const API_PATTERN = /\/api\/|analytics|compass|dashboard|report|order/iu;
const SITE_WORDS = Object.freeze({
  ID: /印尼|印度尼西亚|indonesia|\.co\.id|seller-id/iu,
  MY: /马来西亚|malaysia|\.com\.my|seller-my/iu,
  VN: /越南|vietnam|\.vn|seller-vn/iu,
});

function text(value) { return String(value ?? "").trim(); }

function matchStore(store = {}) {
  return /tiktok|tokopedia|抖音国际/iu.test([
    store.platform, store.platformName, store.storeName, store.name, store.url,
  ].map(text).join(" "));
}

function storeSite(store = {}) {
  const haystack = [store.country, store.countryName, store.platformName, store.storeName, store.url].map(text).join(" ");
  for (const [site, pattern] of Object.entries(SITE_WORDS)) if (pattern.test(haystack)) return { site, sellerCenter: site };
  return { site: "", sellerCenter: "" };
}

function originFor(site = "ID") { return SELLER_ORIGINS[text(site).toUpperCase()] || SELLER_ORIGINS.ID; }

function defaultSalesChannel(site = "") {
  const normalized = text(site).toUpperCase();
  // 印尼同时存在 TikTok Shop 与 Tokopedia，未从真实接口识别前不能擅自归类。
  return normalized === "ID" ? "UNSPECIFIED" : "TIKTOK_SHOP";
}

function checkPage(info = {}) {
  const href = text(info.href || info.url);
  const content = `${href} ${text(info.title)} ${text(info.text || info.body)}`;
  if (/login|passport|登录|登入/iu.test(content)) {
    return { ok: false, code: "NOT_LOGGED_IN", message: "TikTok Shop 卖家中心未登录，请先打开该店铺完成登录。" };
  }
  if (/seller-(id|my|vn)\.tiktok\.com|seller\.tiktokglobalshop\.com/iu.test(href)) return { ok: true };
  return { ok: false, code: "WRONG_PAGE", message: "当前页面不是 TikTok Shop 卖家中心。" };
}

function calibratedTemplate() {
  return {
    id: "builtin:tiktok-daily-v1",
    platform: "tiktok",
    name: "TikTok 三国店铺日报（官方概览）",
    version: 2,
    builtin: true,
    endpoints: [{
      id: "overview",
      label: "店铺概览",
      method: "POST",
      url: "{origin}{statsPath}",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_condition: [{
          query_time: { start: "{date}", end: "{date}", timezone_offset: "@@{timezoneOffset}@@" },
          compare_to_time: { start: "{compareDate}", end: "{compareDate}" },
          metrics: "@@{statsMetrics}@@",
          date_completion: { enabled: true, granularity: 0 },
          where_filter: { ready_time: { value_list: ["{date}"] } },
          group_by: [],
        }],
      })
        .replace('"@@{timezoneOffset}@@"', "{timezoneOffset}")
        .replace('"@@{statsMetrics}@@"', "{statsMetrics}"),
    }],
    metrics: {
      payAmount: { parts: [
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.4024", optional: true },
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6189", optional: true },
      ] },
      orderCount: { parts: [
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.4031", optional: true },
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6187", optional: true },
      ] },
      impressions: { parts: [
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6068", optional: true },
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6196", optional: true },
      ] },
      visitors: { parts: [
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6070", optional: true },
        { endpoint: "overview", path: "data[0].intervals[0].rows[0].values.6198", optional: true },
      ] },
    },
    notes: [
      "内置模板已按印尼、马来西亚、越南真实卖家中心概览接口完成只读校准。",
      "接口缺失的字段保持缺失，不会写成 0，避免污染店铺日报。",
      "印尼 TikTok Shop 与 Tokopedia 继续分别保留 salesChannel 后再汇总。",
    ],
  };
}

function builtinTemplates() { return [calibratedTemplate()]; }

function blankTemplate({ name = "TikTok 自定义采集模板" } = {}) {
  return {
    id: `custom:tiktok:${Date.now()}`,
    platform: "tiktok",
    name,
    version: 1,
    builtin: false,
    endpoints: [],
    metrics: {},
  };
}

module.exports = {
  id: "tiktok",
  name: "TikTok Shop",
  SELLER_ORIGINS,
  DISCOVERY_PAGES,
  API_PATTERN,
  matchStore,
  storeSite,
  originFor,
  defaultSalesChannel,
  checkPage,
  builtinTemplates,
  blankTemplate,
  identityRequests: () => [],
  parseIdentity: () => null,
  defaultTemplateId: "builtin:tiktok-daily-v1",
  shopIdHint: "TikTok Shop 店铺 ID / Tokopedia 店铺 ID",
  pageCheck: { path: "/compass/overview" },
  siteTimezones: Object.freeze({ ID: "Asia/Jakarta", MY: "Asia/Kuala_Lumpur", VN: "Asia/Ho_Chi_Minh" }),
  salesChannels: Object.freeze({ ID: ["TIKTOK_SHOP", "TOKOPEDIA"], MY: ["TIKTOK_SHOP"], VN: ["TIKTOK_SHOP"] }),
};

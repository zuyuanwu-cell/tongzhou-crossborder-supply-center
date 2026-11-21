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

function calibrationTemplate() {
  return {
    id: "builtin:tiktok-calibration",
    platform: "tiktok",
    name: "TikTok 三国采集模板（待校准）",
    version: 1,
    builtin: true,
    requiresCalibration: true,
    endpoints: [],
    metrics: {},
    notes: [
      "首次使用请在模板校准页采样真实店铺接口。",
      "未校准前不会把缺失字段写成 0，避免污染店铺日报。",
      "印尼 TikTok Shop 与 Tokopedia 必须保留 salesChannel 后再汇总。",
    ],
  };
}

function builtinTemplates() { return [calibrationTemplate()]; }

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
  defaultTemplateId: "builtin:tiktok-calibration",
  shopIdHint: "TikTok Shop 店铺 ID / Tokopedia 店铺 ID",
  pageCheck: { path: "/compass/overview" },
  siteTimezones: Object.freeze({ ID: "Asia/Jakarta", MY: "Asia/Kuala_Lumpur", VN: "Asia/Ho_Chi_Minh" }),
  salesChannels: Object.freeze({ ID: ["TIKTOK_SHOP", "TOKOPEDIA"], MY: ["TIKTOK_SHOP"], VN: ["TIKTOK_SHOP"] }),
};

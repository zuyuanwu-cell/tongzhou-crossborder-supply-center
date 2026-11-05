"use strict";

// Shopee 平台适配器。
// 数据来源：已在紫鸟店铺浏览器登录的 Shopee 卖家中心，在页面内同源调用卖家中心自己的数据接口
// （商业分析 mydata、广告 pas），不需要 Shopee 开放平台授权，也不读取 Cookie。
// 内置模板的接口与字段于 2026-11-05 在真实印尼本土店上验证；卖家中心改版时可在「设置 → 高级」重新校准。

const SELLER_ORIGINS = Object.freeze([
  { id: "ID", label: "印尼本土卖家中心", origin: "https://seller.shopee.co.id" },
  { id: "MY", label: "马来本土卖家中心", origin: "https://seller.shopee.com.my" },
  { id: "TH", label: "泰国本土卖家中心", origin: "https://seller.shopee.co.th" },
  { id: "VN", label: "越南本土卖家中心", origin: "https://banhang.shopee.vn" },
  { id: "PH", label: "菲律宾本土卖家中心", origin: "https://seller.shopee.ph" },
  { id: "SG", label: "新加坡本土卖家中心", origin: "https://seller.shopee.sg" },
  { id: "TW", label: "台湾本土卖家中心", origin: "https://seller.shopee.tw" },
  { id: "BR", label: "巴西本土卖家中心", origin: "https://seller.shopee.com.br" },
  { id: "MX", label: "墨西哥本土卖家中心", origin: "https://seller.shopee.com.mx" },
  { id: "cnsc", label: "中国卖家中心（CNSC，跨境店）", origin: "https://seller.shopee.cn" },
]);

const SITE_WORDS = Object.freeze([
  ["印尼", "ID"], ["印度尼西亚", "ID"], ["马来", "MY"], ["泰国", "TH"], ["越南", "VN"], ["菲律宾", "PH"],
  ["新加坡", "SG"], ["台湾", "TW"], ["巴西", "BR"], ["墨西哥", "MX"], ["哥伦比亚", "CO"], ["智利", "CL"],
]);

// 校准时建议打开的页面。
const DISCOVERY_PAGES = Object.freeze([
  { id: "dashboard", label: "商业分析 · 概览", path: "/datacenter/overview" },
  { id: "traffic", label: "商业分析 · 流量", path: "/datacenter/traffic/overview" },
  { id: "ads", label: "营销中心 · Shopee 广告", path: "/portal/marketing/pas/index" },
]);

const API_PATTERN = "/api/(mydata|pas)/";

/** 紫鸟店铺是否为 Shopee：紫鸟平台名形如「Shopee-印尼-本土」。 */
function matchStore(store) {
  return /shopee|虾皮/i.test(String(store.platformName || ""));
}

/** 从紫鸟平台名识别站点与卖家中心：「Shopee-印尼-本土」→ { site: "ID", sellerCenter: "ID" }。 */
function storeSite(store) {
  const text = `${store.platformName || ""} ${store.storeName || ""}`;
  const site = SITE_WORDS.find(([word]) => text.includes(word))?.[1] || "";
  const crossBorder = /跨境|cnsc|全球/i.test(String(store.platformName || ""));
  return { site, sellerCenter: crossBorder ? "cnsc" : site || "cnsc" };
}

function originFor(sellerCenter) {
  return SELLER_ORIGINS.find((item) => item.id === sellerCenter)?.origin || "";
}

/** 掉登录 / 风控页面识别。 */
function checkPage(info) {
  const href = String(info?.href || "");
  const textValue = `${info?.title || ""} ${info?.text || ""}`;
  if (/\/account\/signin|\/login|accounts\.shopee/i.test(href)) {
    return { ok: false, code: "NOT_LOGGED_IN", message: "Shopee 卖家中心未登录，请在紫鸟里打开这个店铺手动登录一次。" };
  }
  if (/verify|captcha|security-check/i.test(href) || /验证码|安全验证|captcha/i.test(textValue)) {
    return { ok: false, code: "CAPTCHA", message: "Shopee 要求安全验证，请在紫鸟窗口里手动完成后重试。" };
  }
  if (!/shopee|banhang/i.test(href)) {
    return { ok: false, code: "WRONG_PAGE", message: `当前页面不是 Shopee 卖家中心：${href || "空白页"}` };
  }
  return { ok: true };
}

/**
 * 内置模板（本土店）。{origin} 按店铺站点替换；
 * 商业分析接口按「站点当地自然日」取数：period=day、start_time=当天 0 点、end_time=次日 0 点。
 */
const BUILTIN_LOCAL = Object.freeze({
  id: "builtin:shopee-local",
  builtin: true,
  platform: "shopee",
  name: "Shopee 本土店（内置）",
  sellerCenter: "auto",
  collectPath: "/datacenter/overview",
  endpoints: [
    {
      id: "km",
      label: "商业分析·关键指标",
      method: "GET",
      url: "{origin}/api/mydata/v3/dashboard/key-metrics/?start_time={startTs}&end_time={endTsNext}&period=day&fetag=fetag",
      body: null,
      headers: {},
    },
    {
      id: "product",
      label: "商业分析·商品概览",
      method: "GET",
      url: "{origin}/api/mydata/v2/product/overview/?start_time={startTs}&end_time={endTsNext}&period=day",
      body: null,
      headers: {},
    },
    {
      id: "traffic",
      label: "商业分析·流量来源",
      method: "GET",
      url: "{origin}/api/mydata/v1/dashboard/traffic-sources/?start_time={startTs}&end_time={endTsNext}&period=day&order_type=confirmed&need_paid_ads_data=false",
      body: null,
      headers: {},
    },
    {
      id: "ads",
      label: "Shopee 广告·按天报表",
      method: "POST",
      url: "{origin}/api/pas/v1/report/get_time_graph/",
      body: '{"agg_interval":4,"campaign_type":"product_homepage_v2","start_time":{startTs},"end_time":{endTs},"need_roi_target_setting":false,"filter_params":{"campaign_type":"new_cpc_homepage"}}',
      headers: { "content-type": "application/json" },
    },
  ],
  metrics: {
    payAmount: { endpoint: "km", path: "result.paid_gmv.value", scale: 1 },
    orderCount: { endpoint: "km", path: "result.paid_orders.value", scale: 1 },
    visitors: { endpoint: "km", path: "result.shop_uv.value", scale: 1 },
    addToCart: { endpoint: "product", path: "atc_uv.value", scale: 1 },
    impressions: { endpoint: "traffic", path: "result.product_card.total.product_impressions", scale: 1 },
    adOnsite: { endpoint: "ads", path: "data.report_by_time[*].metrics.cost", scale: 100000 },
  },
  updatedAt: "2026-11-05T00:00:00.000Z",
});

function builtinTemplates() {
  return [JSON.parse(JSON.stringify(BUILTIN_LOCAL))];
}

/** 新建空模板（校准后填充 endpoints 与 metrics）。 */
function blankTemplate({ sellerCenter = "ID", name = "" } = {}) {
  return {
    id: "",
    platform: "shopee",
    name: name || `Shopee ${SELLER_ORIGINS.find((item) => item.id === sellerCenter)?.label || ""}`,
    sellerCenter,
    collectPath: DISCOVERY_PAGES[0].path,
    endpoints: [],
    metrics: {},
    updatedAt: "",
  };
}

module.exports = {
  id: "shopee",
  name: "Shopee",
  SELLER_ORIGINS,
  DISCOVERY_PAGES,
  API_PATTERN,
  matchStore,
  storeSite,
  originFor,
  checkPage,
  blankTemplate,
  builtinTemplates,
  defaultTemplateId: BUILTIN_LOCAL.id,
  shopIdHint: "CNSC 多站点时填写 Shopee 店铺 ID（卖家中心地址栏 cnsc_shop_id= 后面的数字）",
};

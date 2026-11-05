"use strict";

// Shopee 平台适配器。
// 数据来源：已在紫鸟店铺浏览器登录的 Shopee 卖家中心（中国卖家中心 CNSC 或当地站点卖家中心），
// 在页面内同源调用卖家中心自身的数据接口（商业分析 / 广告），不需要 Shopee 开放平台授权。
// 卖家中心接口是内部接口、可能改版，所以接口地址和字段映射不写死，而是由「校准」生成模板。

const SELLER_ORIGINS = Object.freeze([
  { id: "cnsc", label: "中国卖家中心（CNSC，跨境店）", origin: "https://seller.shopee.cn" },
  { id: "ID", label: "印尼本地卖家中心", origin: "https://seller.shopee.co.id" },
  { id: "MY", label: "马来本地卖家中心", origin: "https://seller.shopee.com.my" },
  { id: "TH", label: "泰国本地卖家中心", origin: "https://seller.shopee.co.th" },
  { id: "VN", label: "越南本地卖家中心", origin: "https://banhang.shopee.vn" },
  { id: "PH", label: "菲律宾本地卖家中心", origin: "https://seller.shopee.ph" },
  { id: "SG", label: "新加坡本地卖家中心", origin: "https://seller.shopee.sg" },
  { id: "TW", label: "台湾本地卖家中心", origin: "https://seller.shopee.tw" },
  { id: "BR", label: "巴西本地卖家中心", origin: "https://seller.shopee.com.br" },
  { id: "MX", label: "墨西哥本地卖家中心", origin: "https://seller.shopee.com.mx" },
]);

// 校准时建议打开的页面（路径在卖家中心改版后可在界面里改）。
const DISCOVERY_PAGES = Object.freeze([
  { id: "dashboard", label: "商业分析 · 概览（访客、曝光、加购、销售额、订单）", path: "/datacenter/dashboard" },
  { id: "traffic", label: "商业分析 · 流量", path: "/datacenter/traffic/overview" },
  { id: "ads", label: "营销中心 · Shopee 广告（广告花费）", path: "/portal/marketing/pas/index" },
]);

// 记录哪些请求：卖家中心的数据接口都在 /api/ 下。
const API_PATTERN = "/api/(mydata|datacenter|marketing|pas|ads|selleraccount|v\\d)/|/api/.*(report|metric|overview|dashboard|summary|traffic|performance)";

function matchStore(store) {
  return /shopee|虾皮/i.test(`${store.platformName || ""} ${store.storeName || ""}`);
}

function originFor(sellerCenter) {
  return SELLER_ORIGINS.find((item) => item.id === sellerCenter)?.origin || SELLER_ORIGINS[0].origin;
}

/** 掉登录 / 风控页面识别。 */
function checkPage(info) {
  const href = String(info?.href || "");
  const textValue = `${info?.title || ""} ${info?.text || ""}`;
  if (/\/account\/signin|\/login|accounts\.shopee/i.test(href) || /登录|Log ?in|Sign ?in/i.test(info?.title || "")) {
    return { ok: false, code: "NOT_LOGGED_IN", message: "Shopee 卖家中心未登录，请先在紫鸟里手动登录一次该店铺。" };
  }
  if (/verify|captcha|security-check/i.test(href) || /验证码|安全验证|captcha/i.test(textValue)) {
    return { ok: false, code: "CAPTCHA", message: "Shopee 要求安全验证，请在紫鸟窗口里手动完成后重试。" };
  }
  if (!/shopee/i.test(href)) {
    return { ok: false, code: "WRONG_PAGE", message: `当前页面不是 Shopee 卖家中心：${href || "空白页"}` };
  }
  return { ok: true };
}

/** 新建空模板（校准后填充 endpoints 与 metrics）。 */
function blankTemplate({ sellerCenter = "cnsc", name = "" } = {}) {
  const origin = originFor(sellerCenter);
  return {
    id: "",
    platform: "shopee",
    name: name || `Shopee ${SELLER_ORIGINS.find((item) => item.id === sellerCenter)?.label || ""}`,
    sellerCenter,
    collectPage: `${origin}${DISCOVERY_PAGES[0].path}`,
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
  originFor,
  checkPage,
  blankTemplate,
  // 跨境店常见一个 CNSC 账号下有多个站点店铺：采集目标可以填写 Shopee 店铺 ID，
  // 模板里的 {shopId} 会被替换（例如 cnsc_shop_id 参数）。
  shopIdHint: "CNSC 多站点时填写 Shopee 店铺 ID（卖家中心地址栏 cnsc_shop_id= 后面的数字）",
};

// 店铺日报：把运营每天手填的「店铺数据表」搬进中台。
// 订单、成交额、产品成本、打包费复用经营贡献事实；流量、推广费、测评由导入或紫鸟采集写入；
// 费率按店铺 > 平台+国家 > 国家 > 全局默认 逐级匹配，所有汇率和利润公式统一在这里计算。

import { shopDirectoryKey } from "./shop-directory.js";
import { normalizedCountryKey } from "./performance-analytics.js";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/[,\s，]/g, "").replace(/^[¥￥$]/, "");
  if (!raw || raw === "-" || raw === "—") return null;
  const percent = raw.endsWith("%");
  const numeric = Number(percent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(numeric)) return null;
  return percent ? numeric / 100 : numeric;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function ratio(numerator, denominator) {
  const bottom = number(denominator);
  return bottom > 0 ? number(numerator) / bottom : null;
}

function normalizedToken(value) {
  return text(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function normalizedPlatform(value) {
  const token = normalizedToken(value);
  if (!token) return "";
  if (token.includes("tiktok") || token.includes("tokopedia") || token === "tk" || token === "tt") return "tiktok";
  if (token.includes("shopee") || token.includes("虾皮")) return "shopee";
  if (token.includes("lazada")) return "lazada";
  if (token.includes("ozon")) return "ozon";
  return token;
}

export const COUNTRY_CURRENCY = Object.freeze({ ID: "IDR", MY: "MYR", VN: "VND", PH: "PHP", TH: "THB", SG: "SGD", RU: "RUB", BR: "BRL", MX: "MXN" });
const COUNTRY_NAMES = Object.freeze({ ID: "印度尼西亚", MY: "马来西亚", VN: "越南", PH: "菲律宾", TH: "泰国", SG: "新加坡", RU: "俄罗斯" });

export function currencyForCountry(country) {
  return COUNTRY_CURRENCY[normalizedCountryKey(country)] || "";
}

// ---------------------------------------------------------------------------
// 费率规则
// ---------------------------------------------------------------------------

export const SHOP_FEE_RULE_MODES = Object.freeze(["standard", "stacked"]);

const RULE_DEFAULTS = Object.freeze({
  mode: "standard",
  commissionRate: 0.165,
  perOrderFee: 0,
  perOrderFeeCurrency: "LOCAL",
  adTaxRate: 0,
  reviewUnitCostCny: 10.4,
  fixedLocalPerCny: 0,
  stackedNetRate: 0.868,
  stackedFactor1: 0.97,
  stackedFactor2: 0.95,
  stackedExtraRate: 0.05,
  useSystemProductCost: true,
  useSystemOperationFee: true,
});

export const DEFAULT_SHOP_FEE_RULES = Object.freeze([
  Object.freeze({ ...RULE_DEFAULTS, id: "default", scope: "default", label: "全局默认" }),
  Object.freeze({ ...RULE_DEFAULTS, id: "country:ID", scope: "country", countryKey: "ID", label: "印度尼西亚", perOrderFee: 1250, adTaxRate: 0.11 }),
  Object.freeze({ ...RULE_DEFAULTS, id: "country:MY", scope: "country", countryKey: "MY", label: "马来西亚", adTaxRate: 0.08 }),
]);

function ruleId(rule) {
  if (rule.scope === "default") return "default";
  if (rule.scope === "country") return `country:${rule.countryKey}`;
  if (rule.scope === "platform") return `platform:${rule.platform}|${rule.countryKey}`;
  return `shop:${rule.shopKey}`;
}

function boundedRate(value, fallback, max = 1) {
  const numeric = nullableNumber(value);
  if (numeric === null) return fallback;
  return Math.min(max, Math.max(0, numeric));
}

function nonNegative(value, fallback) {
  const numeric = nullableNumber(value);
  return numeric === null ? fallback : Math.max(0, numeric);
}

export function normalizeShopFeeRule(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const scope = ["default", "country", "platform", "shop"].includes(text(source.scope)) ? text(source.scope) : "default";
  const rule = {
    scope,
    countryKey: scope === "country" || scope === "platform" ? normalizedCountryKey(source.countryKey || source.country) : "",
    platform: scope === "platform" ? normalizedPlatform(source.platform) : "",
    shopKey: scope === "shop" ? text(source.shopKey) : "",
    label: text(source.label),
    mode: SHOP_FEE_RULE_MODES.includes(text(source.mode)) ? text(source.mode) : RULE_DEFAULTS.mode,
    commissionRate: boundedRate(source.commissionRate, RULE_DEFAULTS.commissionRate),
    perOrderFee: nonNegative(source.perOrderFee, RULE_DEFAULTS.perOrderFee),
    perOrderFeeCurrency: text(source.perOrderFeeCurrency).toUpperCase() === "CNY" ? "CNY" : "LOCAL",
    adTaxRate: boundedRate(source.adTaxRate, RULE_DEFAULTS.adTaxRate),
    reviewUnitCostCny: nonNegative(source.reviewUnitCostCny, RULE_DEFAULTS.reviewUnitCostCny),
    fixedLocalPerCny: nonNegative(source.fixedLocalPerCny, 0),
    stackedNetRate: boundedRate(source.stackedNetRate, RULE_DEFAULTS.stackedNetRate),
    stackedFactor1: boundedRate(source.stackedFactor1, RULE_DEFAULTS.stackedFactor1),
    stackedFactor2: boundedRate(source.stackedFactor2, RULE_DEFAULTS.stackedFactor2),
    stackedExtraRate: boundedRate(source.stackedExtraRate, RULE_DEFAULTS.stackedExtraRate),
    useSystemProductCost: source.useSystemProductCost === undefined ? RULE_DEFAULTS.useSystemProductCost : Boolean(source.useSystemProductCost),
    useSystemOperationFee: source.useSystemOperationFee === undefined ? RULE_DEFAULTS.useSystemOperationFee : Boolean(source.useSystemOperationFee),
    updatedAt: text(source.updatedAt),
    updatedBy: text(source.updatedBy),
  };
  rule.id = ruleId(rule);
  if (!rule.label) {
    rule.label = scope === "default" ? "全局默认"
      : scope === "country" ? (COUNTRY_NAMES[rule.countryKey] || rule.countryKey)
        : scope === "platform" ? `${rule.platform} · ${COUNTRY_NAMES[rule.countryKey] || rule.countryKey}`
          : rule.shopKey;
  }
  return rule;
}

export function validateShopFeeRule(rule) {
  if (rule.scope === "country" && !/^[A-Z]{2}$/.test(rule.countryKey)) return "国家规则需要有效的国家。";
  if (rule.scope === "platform" && (!/^[A-Z]{2}$/.test(rule.countryKey) || !rule.platform)) return "平台规则需要国家和平台。";
  if (rule.scope === "shop" && !rule.shopKey) return "店铺规则需要选择店铺。";
  return "";
}

export function normalizeShopFeeRules(rules) {
  const list = Array.isArray(rules) && rules.length ? rules : DEFAULT_SHOP_FEE_RULES;
  const byId = new Map();
  for (const item of list) {
    const rule = normalizeShopFeeRule(item);
    if (validateShopFeeRule(rule)) continue;
    byId.set(rule.id, rule);
  }
  if (!byId.has("default")) byId.set("default", normalizeShopFeeRule({ scope: "default" }));
  const order = { default: 0, country: 1, platform: 2, shop: 3 };
  return [...byId.values()].sort((left, right) => order[left.scope] - order[right.scope] || left.id.localeCompare(right.id));
}

export function resolveShopFeeRule(rules, shop = {}) {
  const byId = new Map(normalizeShopFeeRules(rules).map((rule) => [rule.id, rule]));
  const countryKey = normalizedCountryKey(shop.country);
  const platform = normalizedPlatform(shop.platform);
  return byId.get(`shop:${text(shop.shopKey || shop.key)}`)
    || (platform && countryKey ? byId.get(`platform:${platform}|${countryKey}`) : null)
    || (countryKey ? byId.get(`country:${countryKey}`) : null)
    || byId.get("default");
}

// ---------------------------------------------------------------------------
// 汇率
// ---------------------------------------------------------------------------

export function buildRateLookup(exchangeRates = []) {
  const lookup = new Map();
  for (const row of Array.isArray(exchangeRates) ? exchangeRates : []) {
    const currency = text(row.currency).toUpperCase();
    const rateToCny = number(row.rateToCny);
    if (!currency || rateToCny <= 0) continue;
    const values = lookup.get(currency) || [];
    values.push({ effectiveDate: text(row.effectiveDate).slice(0, 10) || "2000-01-01", rateToCny });
    lookup.set(currency, values);
  }
  for (const values of lookup.values()) values.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  return lookup;
}

function marketRateToCny(lookup, currency, date) {
  if (!currency) return 0;
  if (["CNY", "RMB"].includes(currency)) return 1;
  let matched = null;
  for (const value of lookup.get(currency) || []) {
    if (!date || value.effectiveDate <= date) matched = value;
    else break;
  }
  // 当日之前没有汇率时，退回最早的一条，避免整行无法换算。
  return matched?.rateToCny || lookup.get(currency)?.[0]?.rateToCny || 0;
}

// ---------------------------------------------------------------------------
// 日报计算
// ---------------------------------------------------------------------------

const METRIC_FIELDS = Object.freeze([
  "payAmount", "orderCount", "impressions", "visitors", "addToCart",
  "reviewAmount", "reviewReceived", "reviewCount",
  "adOnsite", "adOffsite", "productCostCny", "operationFeeCny",
]);

export { METRIC_FIELDS };

function emptySums() {
  return {
    payCny: 0, payLocal: 0, impressions: 0, visitors: 0, orderCount: 0, addToCart: 0,
    reviewAmountCny: 0, reviewReceivedCny: 0, reviewLossCny: 0, reviewCount: 0, reviewCostCny: 0,
    realSalesCny: 0, realSalesLocal: 0, realOrders: 0,
    adOnsiteCny: 0, adOffsiteCny: 0, adTotalCny: 0, adOnsiteLocal: 0, adOffsiteLocal: 0,
    productCostCny: 0, operationFeeCny: 0, platformFeeCny: 0, profitCny: 0,
    systemOrderCount: 0, systemSalesCny: 0,
    days: 0,
  };
}

function addSums(target, row) {
  for (const key of Object.keys(target)) {
    if (key === "days") target.days += 1;
    else target[key] += number(row[key]);
  }
}

function withRatios(sums, { singleCurrency = true } = {}) {
  const result = { ...sums };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === "number") result[key] = round(result[key], key.endsWith("Local") ? 0 : 2);
  }
  result.roi = ratio(sums.realSalesCny, sums.adTotalCny);
  result.costPerVisitorCny = ratio(sums.adOnsiteCny, sums.visitors);
  result.visitRate = ratio(sums.visitors, sums.impressions);
  result.addToCartRate = ratio(sums.addToCart, sums.visitors);
  result.conversionRate = ratio(sums.realOrders, sums.visitors);
  result.aovCny = ratio(sums.realSalesCny, sums.realOrders);
  result.aovLocal = singleCurrency ? ratio(sums.realSalesLocal, sums.realOrders) : null;
  result.profitMargin = ratio(sums.profitCny, sums.realSalesCny);
  if (!singleCurrency) {
    result.payLocal = null;
    result.realSalesLocal = null;
    result.adOnsiteLocal = null;
    result.adOffsiteLocal = null;
  }
  for (const key of ["roi", "costPerVisitorCny", "visitRate", "addToCartRate", "conversionRate", "aovCny", "aovLocal", "profitMargin"]) {
    if (result[key] !== null) result[key] = round(result[key], key === "aovLocal" ? 0 : 4);
  }
  return result;
}

function fieldSource(metric, field) {
  return text(metric?.fieldSources?.[field]) || text(metric?.source) || "import";
}

function shopIdentity(shop) {
  return {
    shopKey: text(shop.key || shop.shopKey),
    shopName: text(shop.displayName || shop.shopName || shop.rawName),
    rawShopName: text(shop.rawName || shop.rawShopName || shop.shopName),
    country: text(shop.country),
    countryKey: normalizedCountryKey(shop.country),
    platform: text(shop.platform),
    projectGroup: text(shop.projectGroup),
  };
}

/**
 * @param {object} input
 * @param {Array} input.shops            店铺目录（经营贡献的店铺归属），用于名称、国家、平台、项目组
 * @param {Array} input.systemDaily      经营贡献事实按 店铺+日期 汇总后的结果
 * @param {Array} input.metrics          导入/采集写入的店铺日数据
 * @param {Array} input.reviewOrders     测评订单登记
 * @param {object} input.reviewOrderLookup 订单号 -> 系统订单金额
 * @param {Array} input.rules            费率规则
 * @param {Array} input.exchangeRates    经营汇率
 * @param {object} input.filters         dateFrom/dateTo/shopKey/projectGroup/country/platform
 */
export function buildShopDailyReport({
  shops = [],
  systemDaily = [],
  metrics = [],
  reviewOrders = [],
  reviewOrderLookup = {},
  rules = DEFAULT_SHOP_FEE_RULES,
  exchangeRates = [],
  filters = {},
} = {}) {
  const dateFrom = text(filters.dateFrom);
  const dateTo = text(filters.dateTo);
  const normalizedRules = normalizeShopFeeRules(rules);
  const rateLookup = buildRateLookup(exchangeRates);
  const shopByKey = new Map();
  for (const shop of Array.isArray(shops) ? shops : []) {
    const identity = shopIdentity(shop);
    if (identity.shopKey) shopByKey.set(identity.shopKey, identity);
  }
  const cells = new Map();
  function cell(shopKey, date) {
    const key = `${shopKey}\u0000${date}`;
    let current = cells.get(key);
    if (!current) {
      current = { shopKey, date, system: null, metric: null, reviews: [] };
      cells.set(key, current);
    }
    return current;
  }
  function inRange(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  }
  function ensureShop(shopKey, fallback = {}) {
    if (shopByKey.has(shopKey)) return shopByKey.get(shopKey);
    const [site = "", platform = ""] = shopKey.split("|");
    const identity = {
      shopKey,
      shopName: text(fallback.shopName) || shopKey.split("|").slice(2).join("|") || shopKey,
      rawShopName: text(fallback.shopName),
      country: text(fallback.country) || site,
      countryKey: normalizedCountryKey(fallback.country || site),
      platform: text(fallback.platform) || platform,
      projectGroup: text(fallback.projectGroup),
      standalone: true,
    };
    shopByKey.set(shopKey, identity);
    return identity;
  }

  for (const row of Array.isArray(systemDaily) ? systemDaily : []) {
    const shopKey = text(row.shopKey);
    const date = text(row.date);
    if (!shopKey || !inRange(date)) continue;
    ensureShop(shopKey, row);
    cell(shopKey, date).system = row;
  }
  for (const row of Array.isArray(metrics) ? metrics : []) {
    const shopKey = text(row.shopKey);
    const date = text(row.date);
    if (!shopKey || !inRange(date)) continue;
    ensureShop(shopKey, row);
    cell(shopKey, date).metric = row;
  }
  for (const row of Array.isArray(reviewOrders) ? reviewOrders : []) {
    const shopKey = text(row.shopKey);
    const date = text(row.date);
    if (!shopKey || !inRange(date)) continue;
    ensureShop(shopKey, row);
    cell(shopKey, date).reviews.push(row);
  }

  const shopFilter = text(filters.shopKey || filters.shopName);
  const groupFilter = text(filters.projectGroup);
  const countryFilter = text(filters.country) ? normalizedCountryKey(filters.country) : "";
  const platformFilter = normalizedPlatform(filters.platform);

  const rows = [];
  const quality = {
    rowsWithoutTraffic: 0,
    rowsWithoutAd: 0,
    rowsUsingSystemRevenue: 0,
    rowsWithoutRate: 0,
    reviewOrdersWithoutAmount: 0,
    reviewOrdersWithoutReceived: 0,
    standaloneShopCount: 0,
  };

  for (const entry of cells.values()) {
    const shop = shopByKey.get(entry.shopKey);
    if (shopFilter && shop.shopKey !== shopFilter) continue;
    if (groupFilter && shop.projectGroup !== groupFilter) continue;
    if (countryFilter && shop.countryKey !== countryFilter) continue;
    if (platformFilter && normalizedPlatform(shop.platform) !== platformFilter) continue;

    const rule = resolveShopFeeRule(normalizedRules, shop);
    const metric = entry.metric || {};
    const system = entry.system || {};
    const currency = text(metric.currency).toUpperCase() || text(system.currency).toUpperCase() || currencyForCountry(shop.country) || "CNY";
    const rateToCny = rule.fixedLocalPerCny > 0 ? 1 / rule.fixedLocalPerCny : marketRateToCny(rateLookup, currency, entry.date);
    const localPerCny = rateToCny > 0 ? 1 / rateToCny : 0;
    const toCny = (value) => (rateToCny > 0 ? number(value) * rateToCny : 0);
    const flags = [];
    if (rateToCny <= 0) {
      flags.push("missing_rate");
      quality.rowsWithoutRate += 1;
    }

    // 支付金额 / 订单数：平台口径优先（导入或紫鸟），否则退回中台订单事实。
    const metricPay = nullableNumber(metric.payAmount);
    const metricOrders = nullableNumber(metric.orderCount);
    let payLocal;
    let payCny;
    let paySource;
    if (metricPay !== null) {
      payLocal = metricPay;
      payCny = toCny(metricPay);
      paySource = fieldSource(metric, "payAmount");
    } else if (entry.system) {
      payLocal = text(system.currency).toUpperCase() === currency ? number(system.salesAmount) : null;
      payCny = number(system.salesCny);
      paySource = "system";
      flags.push("system_revenue");
      quality.rowsUsingSystemRevenue += 1;
    } else {
      payLocal = 0;
      payCny = 0;
      paySource = "none";
    }
    const orderCount = metricOrders !== null ? metricOrders : number(system.orderCount);

    // 测评：有订单登记时以登记为准，否则使用导入的当日测评汇总。
    let reviewAmountLocal = 0;
    let reviewReceivedLocal = 0;
    let reviewCount = 0;
    let reviewSource = "none";
    if (entry.reviews.length) {
      reviewSource = "registry";
      for (const review of entry.reviews) {
        const lookup = reviewOrderLookup[text(review.orderNo)];
        let amount = nullableNumber(review.amount);
        if (amount === null && lookup && text(lookup.currency).toUpperCase() === currency) amount = number(lookup.amount);
        if (amount === null) {
          flags.push("review_amount_missing");
          quality.reviewOrdersWithoutAmount += 1;
        }
        const received = nullableNumber(review.receivedAmount);
        if (received === null) quality.reviewOrdersWithoutReceived += 1;
        reviewAmountLocal += number(amount);
        reviewReceivedLocal += number(received);
        reviewCount += Math.max(1, number(review.quantity) || 1);
      }
    } else if (nullableNumber(metric.reviewAmount) !== null || nullableNumber(metric.reviewCount) !== null) {
      reviewSource = "import";
      reviewAmountLocal = number(metric.reviewAmount);
      reviewReceivedLocal = number(metric.reviewReceived);
      reviewCount = number(metric.reviewCount);
    }
    const reviewAmountCny = toCny(reviewAmountLocal);
    const reviewReceivedCny = toCny(reviewReceivedLocal);
    const reviewLossCny = reviewAmountCny - reviewReceivedCny;
    const reviewCostCny = reviewLossCny + reviewCount * rule.reviewUnitCostCny;

    // 真实成交 = 支付 − 测评；当支付金额来自中台订单且无法确定本币时，用人民币直接扣减。
    const realSalesCny = Math.max(0, payCny - reviewAmountCny);
    const realSalesLocal = payLocal === null ? null : Math.max(0, payLocal - reviewAmountLocal);
    const realOrders = Math.max(0, orderCount - reviewCount);

    // 推广费：外币，含税换算人民币。
    const adOnsiteLocal = nullableNumber(metric.adOnsite);
    const adOffsiteLocal = nullableNumber(metric.adOffsite);
    if (adOnsiteLocal === null && adOffsiteLocal === null) {
      flags.push("missing_ad");
      quality.rowsWithoutAd += 1;
    }
    const adOnsiteCny = toCny(number(adOnsiteLocal) * (1 + rule.adTaxRate));
    const adOffsiteCny = toCny(number(adOffsiteLocal) * (1 + rule.adTaxRate));
    const adTotalCny = adOnsiteCny + adOffsiteCny;

    const impressions = nullableNumber(metric.impressions);
    const visitors = nullableNumber(metric.visitors);
    const addToCart = nullableNumber(metric.addToCart);
    if (impressions === null && visitors === null) {
      flags.push("missing_traffic");
      quality.rowsWithoutTraffic += 1;
    }

    // 成本：导入值优先；未导入且规则允许时，使用中台产品成本 / 打包费。
    const metricProductCost = nullableNumber(metric.productCostCny);
    const metricOperationFee = nullableNumber(metric.operationFeeCny);
    const productCostCny = metricProductCost !== null ? metricProductCost
      : rule.useSystemProductCost ? number(system.productCostCny) : 0;
    const productCostSource = metricProductCost !== null ? "import" : rule.useSystemProductCost && entry.system ? "system" : "none";
    const operationFeeCny = metricOperationFee !== null ? metricOperationFee
      : rule.useSystemOperationFee ? number(system.packagingFeeCny) : 0;
    const operationFeeSource = metricOperationFee !== null ? "import" : rule.useSystemOperationFee && entry.system ? "system" : "none";

    const perOrderFeeCny = rule.perOrderFeeCurrency === "CNY" ? rule.perOrderFee : toCny(rule.perOrderFee);
    let profitCny;
    if (rule.mode === "stacked") {
      profitCny = ((realSalesCny * rule.stackedNetRate - adTotalCny) * rule.stackedFactor1) * rule.stackedFactor2
        - reviewCostCny - realOrders * perOrderFeeCny - productCostCny - realSalesCny * rule.stackedExtraRate - operationFeeCny;
    } else {
      profitCny = realSalesCny * (1 - rule.commissionRate) - realOrders * perOrderFeeCny
        - adTotalCny - reviewCostCny - productCostCny - operationFeeCny;
    }
    // 平台扣费 = 收入中除显式成本以外被公式扣掉的部分（佣金、每单费用、税费系数等）。
    const platformFeeCny = realSalesCny - adTotalCny - reviewCostCny - productCostCny - operationFeeCny - profitCny;

    const row = {
      date: entry.date,
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      country: shop.country,
      platform: shop.platform,
      projectGroup: shop.projectGroup,
      currency,
      localPerCny: round(localPerCny, 4),
      rateSource: rule.fixedLocalPerCny > 0 ? "fixed" : "market",
      ruleId: rule.id,
      ruleMode: rule.mode,
      payLocal,
      payCny,
      impressions: number(impressions),
      visitors: number(visitors),
      orderCount,
      addToCart: number(addToCart),
      reviewAmountLocal,
      reviewReceivedLocal,
      reviewAmountCny,
      reviewReceivedCny,
      reviewLossCny,
      reviewCount,
      reviewCostCny,
      realSalesLocal,
      realSalesCny,
      realOrders,
      adOnsiteLocal: number(adOnsiteLocal),
      adOffsiteLocal: number(adOffsiteLocal),
      adOnsiteCny,
      adOffsiteCny,
      adTotalCny,
      productCostCny,
      operationFeeCny,
      platformFeeCny,
      profitCny,
      systemOrderCount: number(system.orderCount),
      systemSalesCny: number(system.salesCny),
      sources: {
        revenue: paySource,
        traffic: visitors !== null ? fieldSource(metric, "visitors") : impressions !== null ? fieldSource(metric, "impressions") : "none",
        ad: adOnsiteLocal !== null ? fieldSource(metric, "adOnsite") : adOffsiteLocal !== null ? fieldSource(metric, "adOffsite") : "none",
        review: reviewSource,
        productCost: productCostSource,
        operationFee: operationFeeSource,
      },
      flags: [...new Set(flags)],
      standaloneShop: Boolean(shop.standalone),
      updatedAt: text(metric.updatedAt),
      updatedBy: text(metric.updatedBy),
    };
    rows.push(row);
  }

  rows.sort((left, right) => right.date.localeCompare(left.date) || left.shopName.localeCompare(right.shopName, "zh-CN"));

  const shopSummaries = new Map();
  const total = emptySums();
  const currencies = new Set();
  for (const row of rows) {
    const summary = shopSummaries.get(row.shopKey) || {
      shopKey: row.shopKey,
      shopName: row.shopName,
      country: row.country,
      platform: row.platform,
      projectGroup: row.projectGroup,
      currency: row.currency,
      ruleId: row.ruleId,
      ruleMode: row.ruleMode,
      standaloneShop: row.standaloneShop,
      flagCounts: {},
      sums: emptySums(),
    };
    addSums(summary.sums, row);
    for (const flag of row.flags) summary.flagCounts[flag] = (summary.flagCounts[flag] || 0) + 1;
    shopSummaries.set(row.shopKey, summary);
    addSums(total, row);
    currencies.add(row.currency);
  }
  quality.standaloneShopCount = [...shopSummaries.values()].filter((item) => item.standaloneShop).length;

  const publicRows = rows.map((row) => {
    const sums = withRatios({ ...emptySums(), ...Object.fromEntries(Object.keys(emptySums()).map((key) => [key, row[key] ?? 0])) }, { singleCurrency: row.payLocal !== null });
    const { days: _days, ...ratios } = sums;
    return {
      ...row,
      ...ratios,
      payLocal: row.payLocal === null ? null : round(row.payLocal, 0),
      realSalesLocal: row.realSalesLocal === null ? null : round(row.realSalesLocal, 0),
      reviewAmountLocal: round(row.reviewAmountLocal, 0),
      reviewReceivedLocal: round(row.reviewReceivedLocal, 0),
    };
  });

  return {
    filters: { dateFrom, dateTo, shopKey: shopFilter, projectGroup: groupFilter, country: text(filters.country), platform: text(filters.platform) },
    rows: publicRows,
    shops: [...shopSummaries.values()]
      .map((summary) => {
        const { sums, ...rest } = summary;
        return { ...rest, ...withRatios(sums, { singleCurrency: true }) };
      })
      .sort((left, right) => right.realSalesCny - left.realSalesCny || left.shopName.localeCompare(right.shopName, "zh-CN")),
    totals: withRatios(total, { singleCurrency: currencies.size <= 1 }),
    currencies: [...currencies],
    quality,
    rules: normalizedRules,
  };
}

// ---------------------------------------------------------------------------
// 导入：支持运营现有 Excel 直接复制粘贴（制表符）或 CSV
// ---------------------------------------------------------------------------

const HEADER_ALIASES = [
  ["date", ["日期", "date", "统计日期", "数据日期"]],
  ["shop", ["店铺", "店铺名称", "店铺名", "shop", "shopname", "store"]],
  ["shopKey", ["店铺键", "shopkey"]],
  ["country", ["国家", "站点", "country", "site"]],
  ["platform", ["平台", "platform"]],
  ["currency", ["币种", "currency"]],
  ["payAmount", ["支付金额", "销售额", "gmv", "payamount"]],
  ["impressions", ["展示数", "曝光数", "曝光", "展示", "impressions"]],
  ["visitors", ["访客数", "访客", "visitors"]],
  ["orderCount", ["订单数", "订单量", "orders", "ordercount"]],
  ["addToCart", ["加购人数", "加购数", "加购", "addtocart"]],
  ["reviewAmount", ["测评金额", "reviewamount"]],
  ["reviewReceived", ["实际收款金额", "实际收款", "reviewreceived"]],
  ["reviewCount", ["测评数量", "测评单数", "reviewcount"]],
  ["adOnsite", ["站内推广费", "站内推广", "广告费", "adonsite"]],
  ["adOffsite", ["站外推广费", "站外推广", "adoffsite"]],
  ["productCostCny", ["产品成本", "productcost", "productcostcny"]],
  ["operationFeeCny", ["操作费", "operationfee", "operationfeecny"]],
];

function headerKey(value) {
  const raw = text(value);
  // 带「人民币」的列是表格里的换算结果，统一由中台重新计算，不导入。
  if (!raw || raw.includes("人民币")) return "";
  const token = normalizedToken(raw);
  for (const [key, aliases] of HEADER_ALIASES) {
    if (aliases.some((alias) => normalizedToken(alias) === token)) return key;
  }
  return "";
}

function splitDelimited(textContent) {
  const content = String(textContent ?? "").replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] || "";
  const delimiter = content.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cellValue) => text(cellValue)));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function parseReportDate(value, defaultYear = new Date().getFullYear()) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{5}(\.\d+)?$/.test(raw)) {
    const serial = Math.floor(Number(raw));
    if (serial > 30000 && serial < 80000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }
  }
  let match = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
  match = raw.match(/^(\d{1,2})[-/.月](\d{1,2})[日号]?$/);
  if (match) return `${defaultYear}-${pad(match[1])}-${pad(match[2])}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${pad(match[1])}-${pad(match[2])}`;
  return "";
}

function locateHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const keys = rows[index].map(headerKey);
    if (keys.includes("shop") || keys.includes("shopKey")) {
      const previous = index > 0 ? rows[index - 1] : [];
      // 运营表第二行是字段名，被合并的列（如「产品成本」）名字在第一行。
      const merged = rows[index].map((cellValue, column) => headerKey(cellValue) || (text(cellValue) ? "" : headerKey(previous[column])));
      return { index, keys: merged };
    }
  }
  return null;
}

/**
 * 解析导入文本，返回规范化后的行；不访问数据库。
 */
export function parseShopDailyImport(content, { defaultYear = new Date().getFullYear(), defaultCountry = "", defaultPlatform = "" } = {}) {
  const table = splitDelimited(content);
  const header = locateHeader(table);
  if (!header) {
    return { rows: [], errors: [{ line: 0, message: "没有找到表头：至少需要「日期」和「店铺」两列。" }], skipped: 0, columns: [] };
  }
  if (!header.keys.includes("date")) {
    return { rows: [], errors: [{ line: header.index + 1, message: "表头缺少「日期」列。" }], skipped: 0, columns: [] };
  }
  const columns = [...new Set(header.keys.filter(Boolean))];
  const rows = [];
  const errors = [];
  let skipped = 0;
  let carriedDate = "";
  for (let index = header.index + 1; index < table.length; index += 1) {
    const cells = table[index];
    const record = {};
    header.keys.forEach((key, column) => {
      if (key && record[key] === undefined) record[key] = cells[column];
    });
    const rawDate = text(record.date);
    if (/汇总|合计|总计/.test(rawDate) || /汇总|合计|总计/.test(text(record.shop))) {
      skipped += 1;
      continue;
    }
    const parsedDate = parseReportDate(rawDate, defaultYear);
    if (rawDate && !parsedDate) {
      errors.push({ line: index + 1, message: `无法识别日期「${rawDate}」` });
      continue;
    }
    if (parsedDate) carriedDate = parsedDate;
    const shop = text(record.shop);
    const shopKey = text(record.shopKey);
    // 运营表为每天预留了用数字占位的空行。
    if ((!shop && !shopKey) || /^\d+$/.test(shop)) {
      skipped += 1;
      continue;
    }
    const values = {};
    for (const field of METRIC_FIELDS) {
      if (record[field] === undefined) continue;
      const numeric = nullableNumber(record[field]);
      if (numeric === null && text(record[field])) {
        errors.push({ line: index + 1, message: `「${shop || shopKey}」的 ${field} 不是数字：${text(record[field])}` });
      }
      if (numeric !== null) values[field] = numeric;
    }
    if (!Object.keys(values).length) {
      skipped += 1;
      continue;
    }
    if (!carriedDate) {
      errors.push({ line: index + 1, message: `「${shop}」缺少日期` });
      continue;
    }
    rows.push({
      line: index + 1,
      date: carriedDate,
      shopName: shop,
      shopKey,
      country: text(record.country) || defaultCountry,
      platform: text(record.platform) || defaultPlatform,
      currency: text(record.currency).toUpperCase(),
      ...values,
    });
  }
  return { rows, errors, skipped, columns };
}

// ---------------------------------------------------------------------------
// 店铺匹配
// ---------------------------------------------------------------------------

export function buildShopMatcher(shops = []) {
  const index = new Map();
  const known = new Map();
  for (const shop of Array.isArray(shops) ? shops : []) {
    const identity = shopIdentity(shop);
    if (!identity.shopKey) continue;
    known.set(identity.shopKey, identity);
    const names = [shop.displayName, shop.rawName, shop.alias, shop.miaoshouShopName, shop.miaoshouAlias, shop.shopName]
      .map(normalizedToken)
      .filter(Boolean);
    for (const name of new Set(names)) {
      const list = index.get(name) || [];
      list.push(identity);
      index.set(name, list);
    }
  }
  return function match({ shopKey = "", shopName = "", country = "", platform = "" } = {}) {
    if (text(shopKey)) {
      const exact = known.get(text(shopKey));
      return exact ? { status: "matched", shop: exact } : { status: "unknown_key", shop: null };
    }
    const countryKey = text(country) ? normalizedCountryKey(country) : "";
    const platformKey = normalizedPlatform(platform);
    let candidates = index.get(normalizedToken(shopName)) || [];
    if (countryKey) candidates = candidates.filter((shop) => !shop.countryKey || shop.countryKey === countryKey);
    if (platformKey) candidates = candidates.filter((shop) => normalizedPlatform(shop.platform) === platformKey);
    const unique = [...new Map(candidates.map((shop) => [shop.shopKey, shop])).values()];
    if (unique.length === 1) return { status: "matched", shop: unique[0] };
    if (unique.length > 1) return { status: "ambiguous", shop: null, candidates: unique.map((shop) => `${shop.shopName}（${shop.platform || "未知平台"}·${shop.country}）`) };
    // 中台订单里还没有的店铺（例如新店），按 国家|平台|店铺名 建立独立店铺键。
    const standaloneKey = shopDirectoryKey({ country: countryKey || country, platform: platformKey || "manual", rawShopName: shopName });
    return {
      status: "standalone",
      shop: standaloneKey ? {
        shopKey: standaloneKey,
        shopName: text(shopName),
        country: COUNTRY_NAMES[countryKey] || text(country),
        countryKey,
        platform: platformKey || "manual",
        projectGroup: "",
      } : null,
    };
  };
}

/**
 * 解析 + 匹配店铺，产出可写入数据库的指标行。
 */
export function prepareShopDailyMetrics(parsedRows = [], shops = []) {
  const match = buildShopMatcher(shops);
  const prepared = [];
  const errors = [];
  const warnings = [];
  const standalone = new Map();
  for (const row of parsedRows) {
    const result = match(row);
    if (!result.shop) {
      const label = row.shopName || row.shopKey;
      errors.push({
        line: row.line || 0,
        message: result.status === "ambiguous"
          ? `「${label}」匹配到多个店铺：${result.candidates.join("、")}。请补充「平台」或「国家」列。`
          : `「${label}」不是有效的店铺。`,
      });
      continue;
    }
    if (result.status === "standalone") standalone.set(result.shop.shopKey, result.shop.shopName);
    const values = {};
    for (const field of METRIC_FIELDS) if (row[field] !== undefined && row[field] !== null) values[field] = row[field];
    prepared.push({
      shopKey: result.shop.shopKey,
      shopName: result.shop.shopName,
      country: result.shop.country,
      platform: result.shop.platform,
      date: row.date,
      currency: row.currency || "",
      standalone: result.status === "standalone",
      values,
    });
  }
  for (const [key, name] of standalone) {
    warnings.push({ shopKey: key, message: `「${name}」在中台订单里还没有出现，已作为独立店铺记录，后续出现订单后可在店铺归属中核对。` });
  }
  // 同一店铺同一天出现多次时，以最后一行为准。
  const merged = new Map();
  for (const row of prepared) {
    const key = `${row.shopKey}\u0000${row.date}`;
    const current = merged.get(key);
    merged.set(key, current ? { ...current, ...row, values: { ...current.values, ...row.values } } : row);
  }
  return { rows: [...merged.values()], errors, warnings };
}

// ---------------------------------------------------------------------------
// 经营贡献事实 -> 店铺日汇总（在查询 Worker 中运行）
// ---------------------------------------------------------------------------

export function aggregateSystemShopDaily(facts = [], { dateFrom = "", dateTo = "", orderNos = [] } = {}) {
  const wanted = new Set((Array.isArray(orderNos) ? orderNos : []).map(text).filter(Boolean));
  const groups = new Map();
  const orderLookup = {};
  for (const fact of Array.isArray(facts) ? facts : []) {
    const date = text(fact.orderDate);
    const orderNo = text(fact.orderNo || fact.sourceOrderId);
    if (wanted.size && orderNo && wanted.has(orderNo)) {
      const current = orderLookup[orderNo] || { shopKey: text(fact.shopKey), date, amount: 0, currency: text(fact.currency).toUpperCase() };
      if (fact.salesAmountValid) current.amount += number(fact.salesAmount);
      orderLookup[orderNo] = current;
    }
    const shopKey = text(fact.shopKey);
    if (!shopKey || !date || (dateFrom && date < dateFrom) || (dateTo && date > dateTo)) continue;
    const key = `${shopKey}\u0000${date}`;
    const group = groups.get(key) || {
      shopKey,
      date,
      shopName: text(fact.shopName),
      country: text(fact.country),
      platform: text(fact.platform),
      projectGroup: text(fact.projectGroup),
      orders: new Set(),
      quantity: 0,
      currencies: new Map(),
      salesCny: 0,
      productCostCny: 0,
      packagingFeeCny: 0,
      revenueCoveredLines: 0,
      lines: 0,
    };
    group.orders.add(text(fact.orderIdentity) || orderNo);
    group.quantity += number(fact.quantity);
    group.lines += 1;
    if (fact.salesAmountValid && text(fact.currency)) {
      const currency = text(fact.currency).toUpperCase();
      group.currencies.set(currency, (group.currencies.get(currency) || 0) + number(fact.salesAmount));
    }
    if (fact.revenueCovered) {
      group.salesCny += number(fact.salesCny);
      group.revenueCoveredLines += 1;
    }
    group.productCostCny += number(fact.productCostCny);
    group.packagingFeeCny += number(fact.packagingFeeCny);
    groups.set(key, group);
  }
  const rows = [...groups.values()].map((group) => {
    const [currency = "", salesAmount = 0] = [...group.currencies.entries()].sort((left, right) => right[1] - left[1])[0] || [];
    return {
      shopKey: group.shopKey,
      date: group.date,
      shopName: group.shopName,
      country: group.country,
      platform: group.platform,
      projectGroup: group.projectGroup,
      orderCount: group.orders.size,
      quantity: round(group.quantity, 4),
      currency,
      salesAmount: group.currencies.size === 1 ? round(salesAmount, 4) : 0,
      salesCny: round(group.salesCny, 4),
      productCostCny: round(group.productCostCny, 4),
      packagingFeeCny: round(group.packagingFeeCny, 4),
      revenueCoverageRate: group.lines ? round(group.revenueCoveredLines / group.lines, 4) : 0,
    };
  });
  return { rows, orderLookup };
}

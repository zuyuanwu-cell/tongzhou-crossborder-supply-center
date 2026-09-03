import { JIANYUN_FORMS } from "./field-mapping.js";

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function rawFieldValue(record, fieldId) {
  const field = record?.raw?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function dateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function normalizedSkuKeys(value) {
  const raw = text(value).toUpperCase();
  if (!raw) return [];
  const keys = new Set([raw]);
  const match = raw.match(/(TZKJ-[A-Z0-9-]+)$/i);
  if (match) keys.add(match[1].toUpperCase());
  return [...keys];
}

export function normalizedCountryKey(value) {
  const token = text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
  if (["id", "印度尼西亚", "印尼", "indonesia"].includes(token)) return "ID";
  if (["my", "马来西亚", "马来", "malaysia"].includes(token)) return "MY";
  if (["vn", "越南", "vietnam"].includes(token)) return "VN";
  if (["ru", "俄罗斯", "俄罗斯联邦", "russia"].includes(token)) return "RU";
  if (["ph", "菲律宾", "philippines"].includes(token)) return "PH";
  if (["th", "泰国", "thailand"].includes(token)) return "TH";
  return token.toUpperCase();
}

export const DEFAULT_PACKAGING_FEE_RULES = Object.freeze([
  Object.freeze({ countryKey: "ID", countryName: "印度尼西亚", mode: "tiered", baseFeeCny: 1.9, includedQuantity: 4, additionalFeePerItemCny: 0.2, enabled: true }),
  Object.freeze({ countryKey: "MY", countryName: "马来西亚", mode: "tiered", baseFeeCny: 1.9, includedQuantity: 4, additionalFeePerItemCny: 0.2, enabled: true }),
  Object.freeze({ countryKey: "VN", countryName: "越南", mode: "tiered", baseFeeCny: 1.9, includedQuantity: 4, additionalFeePerItemCny: 0.2, enabled: true }),
  Object.freeze({ countryKey: "RU", countryName: "俄罗斯", mode: "flat", baseFeeCny: 6, includedQuantity: 0, additionalFeePerItemCny: 0, enabled: true }),
]);

export function normalizePackagingFeeRules(rules = DEFAULT_PACKAGING_FEE_RULES) {
  const input = Array.isArray(rules) && rules.length ? rules : DEFAULT_PACKAGING_FEE_RULES;
  const normalized = new Map();
  for (const source of input) {
    const countryKey = normalizedCountryKey(source?.countryKey || source?.countryName || source?.country);
    if (!/^[A-Z]{2}$/.test(countryKey)) continue;
    const mode = source?.mode === "flat" ? "flat" : "tiered";
    normalized.set(countryKey, {
      countryKey,
      countryName: text(source?.countryName || source?.country, countryKey),
      mode,
      baseFeeCny: Math.max(0, round(source?.baseFeeCny, 4)),
      includedQuantity: mode === "flat" ? 0 : Math.max(0, Math.floor(number(source?.includedQuantity))),
      additionalFeePerItemCny: mode === "flat" ? 0 : Math.max(0, round(source?.additionalFeePerItemCny, 4)),
      enabled: source?.enabled !== false,
    });
  }
  return [...normalized.values()].sort((left, right) => left.countryKey.localeCompare(right.countryKey));
}

export function calculatePackagingFeeCny(country, quantity, rules = DEFAULT_PACKAGING_FEE_RULES) {
  const countryKey = normalizedCountryKey(country);
  const rule = normalizePackagingFeeRules(rules).find((item) => item.countryKey === countryKey && item.enabled);
  const orderQuantity = Math.max(0, number(quantity));
  if (!rule || orderQuantity <= 0) return 0;
  if (rule.mode === "flat") return round(rule.baseFeeCny, 4);
  return round(rule.baseFeeCny + Math.max(0, orderQuantity - rule.includedQuantity) * rule.additionalFeePerItemCny, 4);
}

function performanceOrderIdentity(source) {
  return [source?.sourceSystem, source?.warehouseId, source?.sourceOrderId || source?.orderNo || source?.id].map(text).join("|");
}

function productIdentity(product, base = null) {
  const fields = JIANYUN_FORMS.productBase.fields;
  const latestLandedUnitCostCny = number(
    base?.latestLandedUnitCostCny
      ?? rawFieldValue(base, fields.latestLandedUnitCostCny),
  );
  const latestCostEffectiveAt = dateKey(
    base?.latestCostEffectiveAt
      ?? rawFieldValue(base, fields.latestCostEffectiveAt),
  );
  return {
    sku: text(product?.sku || base?.sku || product?.skuNo || base?.skuNo),
    skuNo: text(product?.skuNo || base?.skuNo),
    countrySku: text(product?.countrySku),
    productName: text(product?.name || base?.name || product?.nameEn || base?.nameEn, "未建档产品"),
    brand: text(product?.brand || base?.brand, "未建档品牌"),
    category: text(product?.category || base?.category, "未分类"),
    imageUrl: text(product?.imageUrl || base?.imageUrl),
    country: text(product?.country),
    countryKey: normalizedCountryKey(product?.country),
    directCostPrice: number(product?.directCostPrice ?? product?.directPrice),
    directCostCurrency: text(product?.directCostCurrency || product?.directCurrency).toUpperCase(),
    latestCostBatchId: text(base?.latestCostBatchId ?? rawFieldValue(base, fields.latestCostBatchId)),
    latestLandedUnitCostCny,
    latestCostEffectiveAt,
  };
}

export function buildPerformanceProductLookup(products = {}) {
  const lookup = new Map();
  const baseByKey = new Map();
  for (const base of products.productBase || []) {
    for (const value of [base.sku, base.skuNo]) {
      for (const key of normalizedSkuKeys(value)) if (!baseByKey.has(key)) baseByKey.set(key, base);
    }
  }
  const add = (product, base = null) => {
    const row = productIdentity(product, base);
    for (const value of [row.sku, row.skuNo, row.countrySku]) {
      for (const key of normalizedSkuKeys(value)) {
        const candidates = lookup.get(key) || [];
        if (!candidates.some((candidate) => candidate.countryKey === row.countryKey && candidate.sku === row.sku && candidate.skuNo === row.skuNo)) {
          candidates.push(row);
          lookup.set(key, candidates);
        }
      }
    }
  };
  for (const base of products.productBase || []) add(base, base);
  for (const product of products.catalog || []) {
    const base = [product.sku, product.skuNo]
      .flatMap(normalizedSkuKeys)
      .map((key) => baseByKey.get(key))
      .find(Boolean) || null;
    add(product, base);
  }
  return lookup;
}

function productForCountry(lookup, sku, country) {
  const candidates = normalizedSkuKeys(sku)
    .flatMap((key) => lookup.get(key) || []);
  const countryKey = normalizedCountryKey(country);
  if (countryKey) {
    const exact = candidates.filter((candidate) => candidate.countryKey === countryKey);
    if (exact.length) return exact.find((candidate) => candidate.directCostPrice > 0) || exact[0];
  }
  return candidates.find((candidate) => !candidate.countryKey) || null;
}

export function normalizeSupplementalProductCosts(rows = []) {
  const normalized = [];
  for (const source of Array.isArray(rows) ? rows : []) {
    const sku = text(source?.sku).toUpperCase();
    const countryKey = normalizedCountryKey(source?.countryKey || source?.countryName || source?.country);
    const unitCostCny = Math.max(0, number(source?.unitCostCny));
    const effectiveDate = dateKey(source?.effectiveDate);
    if (!sku || !/^[A-Z]{2}$/.test(countryKey) || unitCostCny <= 0 || !effectiveDate) continue;
    normalized.push({
      ...source,
      sku,
      countryKey,
      countryName: text(source?.countryName || source?.country, countryKey),
      productName: text(source?.productName),
      unitCostCny: round(unitCostCny, 6),
      effectiveDate,
      enabled: source?.enabled !== false,
    });
  }
  return normalized.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
}

function buildSupplementalCostLookup(rows = []) {
  const lookup = new Map();
  for (const row of normalizeSupplementalProductCosts(rows)) {
    for (const skuKey of normalizedSkuKeys(row.sku)) {
      const key = `${skuKey}|${row.countryKey}`;
      const versions = lookup.get(key) || [];
      versions.push(row);
      lookup.set(key, versions);
    }
  }
  for (const versions of lookup.values()) versions.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  return lookup;
}

function supplementalCostFor(lookup, sku, country, orderDate) {
  const countryKey = normalizedCountryKey(country);
  if (!countryKey) return null;
  const versions = normalizedSkuKeys(sku).flatMap((skuKey) => lookup.get(`${skuKey}|${countryKey}`) || []);
  let matched = null;
  for (const row of versions) {
    if ((!orderDate || row.effectiveDate <= orderDate) && (!matched || row.effectiveDate > matched.effectiveDate)) matched = row;
  }
  return matched?.enabled ? matched : null;
}

function buildRateLookup(exchangeRates = []) {
  const lookup = new Map();
  for (const row of exchangeRates) {
    const currency = text(row.currency).toUpperCase();
    const rateToCny = number(row.rateToCny);
    if (!currency || rateToCny <= 0) continue;
    const values = lookup.get(currency) || [];
    values.push({ ...row, currency, effectiveDate: dateKey(row.effectiveDate) || "2000-01-01", rateToCny });
    lookup.set(currency, values);
  }
  for (const values of lookup.values()) values.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return lookup;
}

function rateFor(lookup, currency, orderDate) {
  const values = lookup.get(text(currency).toUpperCase()) || [];
  let matched = null;
  for (const value of values) {
    if (!orderDate || value.effectiveDate <= orderDate) matched = value;
    else break;
  }
  return matched;
}

function aggregateTemplate(key, extra = {}) {
  return {
    key,
    ...extra,
    orderIds: new Set(),
    orderLines: 0,
    quantity: 0,
    salesCny: 0,
    profitSalesCny: 0,
    profitProductCostCny: 0,
    profitPackagingFeeCny: 0,
    profitCogsCny: 0,
    productCostCny: 0,
    packagingFeeCny: 0,
    cogsCny: 0,
    commissionFeeCny: 0,
    logisticsFeeCny: 0,
    operatingCostCny: 0,
    estimatedProfitCny: 0,
    contributionSalesCny: 0,
    contributionOperatingCostCny: 0,
    contributionProfitCny: 0,
    revenueCoveredLines: 0,
    costCoveredLines: 0,
    packagingCoveredLines: 0,
    profitCoveredLines: 0,
    contributionCoveredLines: 0,
    costMatchedQty: 0,
    amounts: new Map(),
    shops: new Set(),
    platforms: new Set(),
    warehouses: new Set(),
    skus: new Set(),
  };
}

function addFact(target, fact) {
  target.orderIds.add(fact.orderIdentity);
  target.orderLines += 1;
  target.quantity += fact.quantity;
  if (fact.salesAmountValid && fact.currency) {
    target.amounts.set(fact.currency, (target.amounts.get(fact.currency) || 0) + fact.salesAmount);
  }
  if (fact.revenueCovered) {
    target.salesCny += fact.salesCny;
    target.revenueCoveredLines += 1;
  }
  if (fact.productCostCovered) {
    target.productCostCny += fact.productCostCny;
    target.costMatchedQty += fact.quantity;
  }
  if (fact.packagingCostCovered) {
    target.packagingFeeCny += fact.packagingFeeCny;
    target.packagingCoveredLines += 1;
  }
  target.cogsCny += fact.cogsCny;
  target.commissionFeeCny += fact.commissionFeeCny || 0;
  target.logisticsFeeCny += fact.logisticsFeeCny || 0;
  target.operatingCostCny += fact.operatingCostCny || fact.cogsCny;
  if (fact.costCovered) {
    target.costCoveredLines += 1;
  }
  if (fact.profitCovered) {
    target.profitSalesCny += fact.salesCny;
    target.profitProductCostCny += fact.productCostCny;
    target.profitPackagingFeeCny += fact.packagingFeeCny;
    target.profitCogsCny += fact.cogsCny;
    target.estimatedProfitCny += fact.estimatedProfitCny;
    target.profitCoveredLines += 1;
  }
  if (fact.contributionCovered) {
    target.contributionSalesCny += fact.salesCny;
    target.contributionOperatingCostCny += fact.operatingCostCny;
    target.contributionProfitCny += fact.contributionProfitCny;
    target.contributionCoveredLines += 1;
  }
  if (fact.shopName) target.shops.add(fact.shopName);
  if (fact.platform) target.platforms.add(fact.platform);
  if (fact.warehouseName || fact.warehouseId) target.warehouses.add(fact.warehouseName || fact.warehouseId);
  if (fact.sku) target.skus.add(fact.sku);
}

function publicAggregate(row, totalSalesCny) {
  const orderLines = row.orderLines || 0;
  const quantity = row.quantity || 0;
  const estimatedProfitCny = round(row.estimatedProfitCny);
  const contributionProfitCny = round(row.contributionProfitCny);
  return {
    ...Object.fromEntries(Object.entries(row).filter(([, value]) => !(value instanceof Set) && !(value instanceof Map))),
    orderCount: row.orderIds.size,
    orderLines,
    quantity: round(quantity, 4),
    amountsByCurrency: [...row.amounts.entries()]
      .map(([currency, amount]) => ({ currency, amount: round(amount, 4) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    salesCny: round(row.salesCny),
    profitSalesCny: round(row.profitSalesCny),
    profitProductCostCny: round(row.profitProductCostCny),
    profitPackagingFeeCny: round(row.profitPackagingFeeCny),
    profitCogsCny: round(row.profitCogsCny),
    productCostCny: round(row.productCostCny),
    packagingFeeCny: round(row.packagingFeeCny),
    cogsCny: round(row.cogsCny),
    commissionFeeCny: round(row.commissionFeeCny),
    logisticsFeeCny: round(row.logisticsFeeCny),
    operatingCostCny: round(row.operatingCostCny),
    estimatedProfitCny,
    contributionSalesCny: round(row.contributionSalesCny),
    contributionOperatingCostCny: round(row.contributionOperatingCostCny),
    contributionProfitCny,
    grossMargin: ratio(estimatedProfitCny, row.profitSalesCny),
    contributionMargin: ratio(contributionProfitCny, row.contributionSalesCny),
    contributionRate: ratio(row.salesCny, totalSalesCny),
    revenueCoverageRate: ratio(row.revenueCoveredLines, orderLines),
    profitCoverageRate: ratio(row.profitCoveredLines, orderLines),
    contributionCoverageRate: ratio(row.contributionCoveredLines, orderLines),
    costCoverageRate: ratio(row.costCoveredLines, orderLines),
    productCostCoverageRate: ratio(row.costMatchedQty, quantity),
    packagingCoverageRate: ratio(row.packagingCoveredLines, orderLines),
    shopCount: row.shops.size,
    platformCount: row.platforms.size,
    warehouseCount: row.warehouses.size,
    skuCount: row.skus.size,
  };
}

function resultLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function buildPerformanceAnalyticsPayloadLegacy({ facts = [], products = {}, exchangeRates = [], packagingFeeRules = DEFAULT_PACKAGING_FEE_RULES, supplementalProductCosts = [], filters = {}, limits = {}, onMaterializedFact = null } = {}) {
  const productLookup = buildPerformanceProductLookup(products);
  const supplementalCostLookup = buildSupplementalCostLookup(supplementalProductCosts);
  const rateLookup = buildRateLookup(exchangeRates);
  const normalizedPackagingFeeRules = normalizePackagingFeeRules(packagingFeeRules);
  const packagingRuleByCountry = new Map(normalizedPackagingFeeRules.filter((rule) => rule.enabled).map((rule) => [rule.countryKey, rule]));
  const configuredPackagingCountries = new Set(normalizedPackagingFeeRules.map((rule) => rule.countryKey));
  const activePackagingCountries = new Set(normalizedPackagingFeeRules.filter((rule) => rule.enabled).map((rule) => rule.countryKey));
  const orderQuantities = new Map();
  for (const source of facts) {
    const orderIdentity = performanceOrderIdentity(source);
    orderQuantities.set(orderIdentity, (orderQuantities.get(orderIdentity) || 0) + Math.max(0, number(source?.quantity)));
  }
  const brandFilter = text(filters.brand);
  const keyword = text(filters.keyword).toLowerCase();
  const optionCountries = new Set();
  const optionWarehouses = new Map();
  const optionPlatforms = new Set();
  const optionShops = new Map();
  const optionProjectGroups = new Set();
  const optionBrands = new Set();
  const recentFacts = [];
  const total = aggregateTemplate("total");
  const productMap = new Map();
  const brandMap = new Map();
  const dailyMap = new Map();
  const quality = {
    totalLines: 0,
    missingSkuLines: 0,
    unmatchedProductLines: 0,
    missingBrandLines: 0,
    missingCurrencyLines: 0,
    missingExchangeRateLines: 0,
    zeroSalesAmountLines: 0,
    missingCostLines: 0,
    missingPackagingRuleLines: 0,
    invalidSalesAmountLines: 0,
    allocationMismatchLines: 0,
    futureCostFallbackLines: 0,
    legacyAllocatedLines: 0,
  };

  for (const source of facts) {
    const product = productForCountry(productLookup, source.sku, source.country);
    const productName = text(product?.productName || source.productName || source.sku, "未建档产品");
    const brand = text(product?.brand, "未建档品牌");
    if (source.country) optionCountries.add(source.country);
    if (source.warehouseId) optionWarehouses.set(source.warehouseId, {
      warehouseId: source.warehouseId,
      warehouseName: source.warehouseName || source.warehouseId,
      country: source.country,
    });
    if (source.platform) optionPlatforms.add(source.platform);
    if (source.shopName) optionShops.set(source.shopKey || source.shopName, {
      value: source.shopKey || source.shopName,
      label: source.shopName,
      rawName: source.rawShopName || source.shopName,
      alias: source.shopAlias || "",
      projectGroup: source.projectGroup || "",
      miaoshouMatched: Boolean(source.miaoshouMatched),
    });
    if (source.projectGroup) optionProjectGroups.add(source.projectGroup);
    if (brand) optionBrands.add(brand);
    if (text(filters.country) && normalizedCountryKey(source.country) !== normalizedCountryKey(filters.country)) continue;
    if (text(filters.warehouseId) && text(source.warehouseId) !== text(filters.warehouseId)) continue;
    if (text(filters.platform) && text(source.platform) !== text(filters.platform)) continue;
    if (text(filters.shopName) && text(source.shopKey || source.shopName) !== text(filters.shopName)) continue;
    if (text(filters.projectGroup) && text(source.projectGroup) !== text(filters.projectGroup)) continue;
    if (brandFilter && brand !== brandFilter) continue;
    if (keyword && ![source.orderNo, source.sourceOrderId, source.sku, source.productName, productName, brand, source.shopName]
      .map((value) => text(value).toLowerCase()).some((value) => value.includes(keyword))) continue;
    const quantity = Math.max(0, number(source.quantity));
    const salesAmount = Math.max(0, number(source.salesAmount));
    const currency = text(source.currency).toUpperCase();
    const orderDate = dateKey(source.orderDate || source.shippedAt || source.createdAt);
    const rate = rateFor(rateLookup, currency, orderDate);
    const salesAmountValid = source.salesAmountValid === true;
    const revenueCovered = Boolean(salesAmountValid && currency && rate && salesAmount > 0);
    const salesCny = revenueCovered ? round(salesAmount * rate.rateToCny, 6) : 0;
    const catalogUnitCostOriginal = Math.max(0, number(product?.directCostPrice));
    const catalogCostCurrency = text(product?.directCostCurrency).toUpperCase();
    const catalogCostRate = catalogUnitCostOriginal > 0 && catalogCostCurrency ? rateFor(rateLookup, catalogCostCurrency, orderDate) : null;
    const supplementalCost = catalogUnitCostOriginal <= 0 ? supplementalCostFor(supplementalCostLookup, source.sku, source.country, orderDate) : null;
    const unitCostOriginal = supplementalCost ? supplementalCost.unitCostCny : catalogUnitCostOriginal;
    const costCurrency = supplementalCost ? "CNY" : catalogCostCurrency;
    const costRate = supplementalCost ? { rateToCny: 1, effectiveDate: supplementalCost.effectiveDate } : catalogCostRate;
    const unitCostCny = supplementalCost ? supplementalCost.unitCostCny : costRate ? round(unitCostOriginal * costRate.rateToCny, 6) : 0;
    const costEffectiveAt = supplementalCost?.effectiveDate || "";
    const futureCostFallback = false;
    const productCostCovered = unitCostCny > 0 && quantity > 0;
    const productCostCny = productCostCovered ? round(quantity * unitCostCny, 6) : 0;
    const orderIdentity = performanceOrderIdentity(source);
    const orderQuantity = orderQuantities.get(orderIdentity) || quantity;
    const packagingCountryKey = normalizedCountryKey(source.country);
    const packagingRule = packagingRuleByCountry.get(packagingCountryKey);
    const packagingFeeOrderCny = packagingRule
      ? packagingRule.mode === "flat"
        ? round(packagingRule.baseFeeCny, 4)
        : round(packagingRule.baseFeeCny + Math.max(0, orderQuantity - packagingRule.includedQuantity) * packagingRule.additionalFeePerItemCny, 4)
      : 0;
    const packagingRuleConfigured = configuredPackagingCountries.has(packagingCountryKey);
    const packagingRuleApplied = activePackagingCountries.has(packagingCountryKey);
    const packagingCostCovered = packagingRuleConfigured;
    const packagingFeeCny = packagingRuleApplied && orderQuantity > 0
      ? round(packagingFeeOrderCny * quantity / orderQuantity, 6)
      : 0;
    const costCovered = productCostCovered && packagingCostCovered;
    // Report every known cost component even when the row is not fully covered;
    // profit remains gated on complete revenue and cost coverage below.
    const cogsCny = round(productCostCny + packagingFeeCny, 6);
    const profitCovered = revenueCovered && costCovered;
    const estimatedProfitCny = profitCovered ? round(salesCny - cogsCny, 6) : 0;
    const miaoshouRate = rateFor(rateLookup, source.miaoshouCurrency, orderDate);
    const transactionCostCovered = source.salesAmountScope === "miaoshou_order_allocated" && Boolean(miaoshouRate);
    const commissionFeeCny = transactionCostCovered ? round(number(source.miaoshouCommissionAmount) * miaoshouRate.rateToCny, 6) : 0;
    const logisticsFeeCny = transactionCostCovered ? round(number(source.miaoshouLogisticsAmount) * miaoshouRate.rateToCny, 6) : 0;
    const operatingCostCny = round(cogsCny + commissionFeeCny + logisticsFeeCny, 6);
    const contributionCovered = profitCovered && transactionCostCovered;
    const contributionProfitCny = contributionCovered ? round(salesCny - operatingCostCny, 6) : 0;
    const row = {
      ...source,
      orderIdentity,
      orderDate,
      quantity,
      salesAmount,
      currency,
      productName,
      brand,
      productMatched: Boolean(product),
      category: text(product?.category, "未分类"),
      imageUrl: text(product?.imageUrl),
      rateToCny: rate?.rateToCny || 0,
      rateEffectiveDate: rate?.effectiveDate || "",
      salesAmountValid,
      revenueCovered,
      salesCny,
      unitCostCny,
      unitCostOriginal,
      costCurrency,
      costRateToCny: costRate?.rateToCny || 0,
      costRateEffectiveDate: costRate?.effectiveDate || "",
      costSource: productCostCovered ? supplementalCost ? "supplemental_manual" : "product_catalog_direct" : "",
      costCountry: supplementalCost?.countryName || text(product?.country),
      costBatchId: supplementalCost ? `${supplementalCost.sku}|${supplementalCost.countryKey}|${supplementalCost.effectiveDate}` : "",
      costEffectiveAt,
      costCovered,
      productCostCovered,
      futureCostFallback,
      productCostCny,
      packagingFeeOrderCny,
      packagingFeeCny,
      packagingRuleConfigured,
      packagingRuleApplied,
      packagingCostCovered,
      cogsCny,
      commissionFeeCny,
      logisticsFeeCny,
      operatingCostCny,
      profitCovered,
      estimatedProfitCny,
      transactionCostCovered,
      contributionCovered,
      contributionProfitCny,
    };
    if (typeof onMaterializedFact === "function") onMaterializedFact(row);
    quality.totalLines += 1;
    if (!text(source.sku)) quality.missingSkuLines += 1;
    if (!product) quality.unmatchedProductLines += 1;
    if (!product || brand === "未建档品牌") quality.missingBrandLines += 1;
    if (!currency) quality.missingCurrencyLines += 1;
    if (currency && !rate) quality.missingExchangeRateLines += 1;
    if (salesAmount <= 0) quality.zeroSalesAmountLines += 1;
    if (!salesAmountValid) quality.invalidSalesAmountLines += 1;
    if (Math.abs(number(source.salesAmountAllocationResidual)) > 0.01) quality.allocationMismatchLines += 1;
    if (!productCostCovered) quality.missingCostLines += 1;
    if (!packagingRuleConfigured) quality.missingPackagingRuleLines += 1;
    if (futureCostFallback) quality.futureCostFallbackLines += 1;
    if (source.salesAmountScope === "legacy_order_allocated") quality.legacyAllocatedLines += 1;
    addFact(total, row);
    const productKey = row.sku || row.productName;
    const productRow = productMap.get(productKey) || aggregateTemplate(productKey, {
      sku: row.sku || "",
      productName: row.productName,
      brand: row.brand,
      category: row.category,
      imageUrl: row.imageUrl,
      unitCostCny: row.unitCostCny,
      costEffectiveAt: row.costEffectiveAt,
      futureCostFallback: row.futureCostFallback,
    });
    addFact(productRow, row);
    productRow.futureCostFallback ||= row.futureCostFallback;
    productMap.set(productKey, productRow);
    const brandRow = brandMap.get(row.brand) || aggregateTemplate(row.brand, { brand: row.brand });
    addFact(brandRow, row);
    brandMap.set(row.brand, brandRow);
    const dailyRow = dailyMap.get(row.orderDate) || aggregateTemplate(row.orderDate, { date: row.orderDate });
    addFact(dailyRow, row);
    dailyMap.set(row.orderDate, dailyRow);
    if (recentFacts.length < resultLimit(limits.recentFacts, 100)) recentFacts.push({
      id: row.id,
      orderDate: row.orderDate,
      orderNo: row.orderNo,
      shopKey: row.shopKey || "",
      shopName: row.shopName || "",
      projectGroup: row.projectGroup || "",
      sku: row.sku,
      productName: row.productName,
      brand: row.brand,
      quantity: row.quantity,
      salesAmount: row.salesAmount,
      currency: row.currency,
      salesCny: round(row.salesCny),
      unitCostCny: round(row.unitCostCny, 4),
      productCostCny: round(row.productCostCny),
      packagingFeeCny: round(row.packagingFeeCny),
      cogsCny: round(row.cogsCny),
      commissionFeeCny: round(row.commissionFeeCny),
      logisticsFeeCny: round(row.logisticsFeeCny),
      operatingCostCny: round(row.operatingCostCny),
      estimatedProfitCny: round(row.estimatedProfitCny),
      contributionProfitCny: round(row.contributionProfitCny),
      revenueCovered: row.revenueCovered,
      costCovered: row.costCovered,
      productCostCovered: row.productCostCovered,
      packagingCostCovered: row.packagingCostCovered,
      profitCovered: row.profitCovered,
      contributionCovered: row.contributionCovered,
    });
  }
  const totalPublic = publicAggregate(total, total.salesCny);
  const productsResult = [...productMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((a, b) => b.salesCny - a.salesCny || b.quantity - a.quantity);
  const brandsResult = [...brandMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((a, b) => b.salesCny - a.salesCny || b.quantity - a.quantity);
  const daily = [...dailyMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((a, b) => a.date.localeCompare(b.date));
  const currencySummary = totalPublic.amountsByCurrency.map((item) => {
    const values = rateLookup.get(item.currency) || [];
    const latest = values[values.length - 1];
    return { ...item, rateToCny: latest?.rateToCny || 0, rateEffectiveDate: latest?.effectiveDate || "" };
  });
  const totalLines = quality.totalLines;
  const revenueCoveredLines = total.revenueCoveredLines;
  const profitCoveredLines = total.profitCoveredLines;
  const quantity = total.quantity;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    basis: "wms_outbound",
    filters: {
      dateFrom: text(filters.dateFrom),
      dateTo: text(filters.dateTo),
      country: text(filters.country),
      warehouseId: text(filters.warehouseId),
      platform: text(filters.platform),
      shopName: text(filters.shopName),
      projectGroup: text(filters.projectGroup),
      brand: brandFilter,
      keyword: text(filters.keyword),
    },
    totals: totalPublic,
    quality: {
      ...quality,
      revenueCoverageRate: ratio(revenueCoveredLines, totalLines),
      costCoverageRate: ratio(total.costCoveredLines, totalLines),
      productCostCoverageRate: ratio(total.costMatchedQty, quantity),
      packagingCoverageRate: ratio(total.packagingCoveredLines, totalLines),
      profitCoverageRate: ratio(profitCoveredLines, totalLines),
      contributionCoverageRate: ratio(total.contributionCoveredLines, totalLines),
    },
    packagingFeeRules: normalizedPackagingFeeRules,
    currencySummary,
    resultCounts: { products: productsResult.length, brands: brandsResult.length },
    topProduct: productsResult[0] || null,
    topBrand: brandsResult[0] || null,
    products: productsResult.slice(0, resultLimit(limits.products, productsResult.length)),
    brands: brandsResult,
    daily,
    recentFacts,
    options: {
      countries: [...optionCountries].sort(),
      warehouses: [...optionWarehouses.values()].sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "zh-CN")),
      platforms: [...optionPlatforms].sort(),
      shops: [...optionShops.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
      projectGroups: [...optionProjectGroups].sort(),
      brands: [...optionBrands].sort(),
    },
  };
}

export function materializePerformanceFacts({ facts = [], products = {}, exchangeRates = [], packagingFeeRules = DEFAULT_PACKAGING_FEE_RULES, supplementalProductCosts = [] } = {}) {
  const rows = [];
  buildPerformanceAnalyticsPayloadLegacy({
    facts,
    products,
    exchangeRates,
    packagingFeeRules,
    supplementalProductCosts,
    filters: {},
    onMaterializedFact: (row) => rows.push(row),
  });
  return rows;
}

function materializedRecentFact(row) {
  return {
    id: row.id,
    orderDate: row.orderDate,
    orderNo: row.orderNo,
    shopKey: row.shopKey || "",
    shopName: row.shopName || "",
    projectGroup: row.projectGroup || "",
    sku: row.sku,
    productName: row.productName,
    brand: row.brand,
    quantity: row.quantity,
    salesAmount: row.salesAmount,
    currency: row.currency,
    salesCny: round(row.salesCny),
    unitCostCny: round(row.unitCostCny, 4),
    productCostCny: round(row.productCostCny),
    packagingFeeCny: round(row.packagingFeeCny),
    cogsCny: round(row.cogsCny),
    commissionFeeCny: round(row.commissionFeeCny),
    logisticsFeeCny: round(row.logisticsFeeCny),
    operatingCostCny: round(row.operatingCostCny),
    estimatedProfitCny: round(row.estimatedProfitCny),
    contributionProfitCny: round(row.contributionProfitCny),
    revenueCovered: row.revenueCovered,
    costCovered: row.costCovered,
    productCostCovered: row.productCostCovered,
    packagingCostCovered: row.packagingCostCovered,
    profitCovered: row.profitCovered,
    contributionCovered: row.contributionCovered,
  };
}

function buildPerformanceAnalyticsPayloadFromMaterialized({ materializedFacts = [], exchangeRates = [], packagingFeeRules = DEFAULT_PACKAGING_FEE_RULES, filters = {}, limits = {} } = {}) {
  const rateLookup = buildRateLookup(exchangeRates);
  const normalizedPackagingFeeRules = normalizePackagingFeeRules(packagingFeeRules);
  const brandFilter = text(filters.brand);
  const keyword = text(filters.keyword).toLowerCase();
  const optionCountries = new Set();
  const optionWarehouses = new Map();
  const optionPlatforms = new Set();
  const optionShops = new Map();
  const optionProjectGroups = new Set();
  const optionBrands = new Set();
  const recentFacts = [];
  const total = aggregateTemplate("total");
  const productMap = new Map();
  const brandMap = new Map();
  const dailyMap = new Map();
  const quality = {
    totalLines: 0,
    missingSkuLines: 0,
    unmatchedProductLines: 0,
    missingBrandLines: 0,
    missingCurrencyLines: 0,
    missingExchangeRateLines: 0,
    zeroSalesAmountLines: 0,
    missingCostLines: 0,
    missingPackagingRuleLines: 0,
    invalidSalesAmountLines: 0,
    allocationMismatchLines: 0,
    futureCostFallbackLines: 0,
    legacyAllocatedLines: 0,
  };

  for (const row of materializedFacts) {
    if (row.country) optionCountries.add(row.country);
    if (row.warehouseId) optionWarehouses.set(row.warehouseId, {
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName || row.warehouseId,
      country: row.country,
    });
    if (row.platform) optionPlatforms.add(row.platform);
    if (row.shopName) optionShops.set(row.shopKey || row.shopName, {
      value: row.shopKey || row.shopName,
      label: row.shopName,
      rawName: row.rawShopName || row.shopName,
      alias: row.shopAlias || "",
      projectGroup: row.projectGroup || "",
      miaoshouMatched: Boolean(row.miaoshouMatched),
    });
    if (row.projectGroup) optionProjectGroups.add(row.projectGroup);
    if (row.brand) optionBrands.add(row.brand);
    if (text(filters.country) && normalizedCountryKey(row.country) !== normalizedCountryKey(filters.country)) continue;
    if (text(filters.warehouseId) && text(row.warehouseId) !== text(filters.warehouseId)) continue;
    if (text(filters.platform) && text(row.platform) !== text(filters.platform)) continue;
    if (text(filters.shopName) && text(row.shopKey || row.shopName) !== text(filters.shopName)) continue;
    if (text(filters.projectGroup) && text(row.projectGroup) !== text(filters.projectGroup)) continue;
    if (brandFilter && row.brand !== brandFilter) continue;
    if (keyword && ![row.orderNo, row.sourceOrderId, row.sku, row.productName, row.brand, row.shopName]
      .map((value) => text(value).toLowerCase()).some((value) => value.includes(keyword))) continue;

    quality.totalLines += 1;
    if (!text(row.sku)) quality.missingSkuLines += 1;
    if (!row.productMatched) quality.unmatchedProductLines += 1;
    if (!row.productMatched || row.brand === "未建档品牌") quality.missingBrandLines += 1;
    if (!row.currency) quality.missingCurrencyLines += 1;
    if (row.currency && !row.rateToCny) quality.missingExchangeRateLines += 1;
    if (row.salesAmount <= 0) quality.zeroSalesAmountLines += 1;
    if (!row.salesAmountValid) quality.invalidSalesAmountLines += 1;
    if (Math.abs(number(row.salesAmountAllocationResidual)) > 0.01) quality.allocationMismatchLines += 1;
    if (!row.productCostCovered) quality.missingCostLines += 1;
    if (!row.packagingRuleConfigured) quality.missingPackagingRuleLines += 1;
    if (row.futureCostFallback) quality.futureCostFallbackLines += 1;
    if (row.salesAmountScope === "legacy_order_allocated") quality.legacyAllocatedLines += 1;
    addFact(total, row);

    const productKey = row.sku || row.productName;
    const productRow = productMap.get(productKey) || aggregateTemplate(productKey, {
      sku: row.sku || "",
      productName: row.productName,
      brand: row.brand,
      category: row.category,
      imageUrl: row.imageUrl,
      unitCostCny: row.unitCostCny,
      costEffectiveAt: row.costEffectiveAt,
      futureCostFallback: row.futureCostFallback,
    });
    addFact(productRow, row);
    productRow.futureCostFallback ||= row.futureCostFallback;
    productMap.set(productKey, productRow);
    const brandRow = brandMap.get(row.brand) || aggregateTemplate(row.brand, { brand: row.brand });
    addFact(brandRow, row);
    brandMap.set(row.brand, brandRow);
    const dailyRow = dailyMap.get(row.orderDate) || aggregateTemplate(row.orderDate, { date: row.orderDate });
    addFact(dailyRow, row);
    dailyMap.set(row.orderDate, dailyRow);
    if (recentFacts.length < resultLimit(limits.recentFacts, 100)) recentFacts.push(materializedRecentFact(row));
  }

  const totalPublic = publicAggregate(total, total.salesCny);
  const productsResult = [...productMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((left, right) => right.salesCny - left.salesCny || right.quantity - left.quantity);
  const brandsResult = [...brandMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((left, right) => right.salesCny - left.salesCny || right.quantity - left.quantity);
  const daily = [...dailyMap.values()].map((row) => publicAggregate(row, total.salesCny))
    .sort((left, right) => left.date.localeCompare(right.date));
  const currencySummary = totalPublic.amountsByCurrency.map((item) => {
    const values = rateLookup.get(item.currency) || [];
    const latest = values[values.length - 1];
    return { ...item, rateToCny: latest?.rateToCny || 0, rateEffectiveDate: latest?.effectiveDate || "" };
  });
  const totalLines = quality.totalLines;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    basis: "wms_outbound",
    filters: {
      dateFrom: text(filters.dateFrom),
      dateTo: text(filters.dateTo),
      country: text(filters.country),
      warehouseId: text(filters.warehouseId),
      platform: text(filters.platform),
      shopName: text(filters.shopName),
      projectGroup: text(filters.projectGroup),
      brand: brandFilter,
      keyword: text(filters.keyword),
    },
    totals: totalPublic,
    quality: {
      ...quality,
      revenueCoverageRate: ratio(total.revenueCoveredLines, totalLines),
      costCoverageRate: ratio(total.costCoveredLines, totalLines),
      productCostCoverageRate: ratio(total.costMatchedQty, total.quantity),
      packagingCoverageRate: ratio(total.packagingCoveredLines, totalLines),
      profitCoverageRate: ratio(total.profitCoveredLines, totalLines),
      contributionCoverageRate: ratio(total.contributionCoveredLines, totalLines),
    },
    packagingFeeRules: normalizedPackagingFeeRules,
    currencySummary,
    resultCounts: { products: productsResult.length, brands: brandsResult.length },
    topProduct: productsResult[0] || null,
    topBrand: brandsResult[0] || null,
    products: productsResult.slice(0, resultLimit(limits.products, productsResult.length)),
    brands: brandsResult,
    daily,
    recentFacts,
    options: {
      countries: [...optionCountries].sort(),
      warehouses: [...optionWarehouses.values()].sort((left, right) => left.warehouseName.localeCompare(right.warehouseName, "zh-CN")),
      platforms: [...optionPlatforms].sort(),
      shops: [...optionShops.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
      projectGroups: [...optionProjectGroups].sort(),
      brands: [...optionBrands].sort(),
    },
  };
}

export function buildPerformanceAnalyticsPayload(input = {}) {
  if (Array.isArray(input.materializedFacts)) return buildPerformanceAnalyticsPayloadFromMaterialized(input);
  return buildPerformanceAnalyticsPayloadLegacy(input);
}

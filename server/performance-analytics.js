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

function normalizedCountryKey(value) {
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
    cogsCny: 0,
    estimatedProfitCny: 0,
    revenueCoveredLines: 0,
    profitCoveredLines: 0,
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
  target.amounts.set(fact.currency || "未识别", (target.amounts.get(fact.currency || "未识别") || 0) + fact.salesAmount);
  if (fact.revenueCovered) {
    target.salesCny += fact.salesCny;
    target.revenueCoveredLines += 1;
  }
  if (fact.profitCovered) {
    target.profitSalesCny += fact.salesCny;
    target.cogsCny += fact.cogsCny;
    target.estimatedProfitCny += fact.estimatedProfitCny;
    target.profitCoveredLines += 1;
    target.costMatchedQty += fact.quantity;
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
    cogsCny: round(row.cogsCny),
    estimatedProfitCny,
    grossMargin: ratio(estimatedProfitCny, row.profitSalesCny),
    contributionRate: ratio(row.salesCny, totalSalesCny),
    revenueCoverageRate: ratio(row.revenueCoveredLines, orderLines),
    profitCoverageRate: ratio(row.profitCoveredLines, orderLines),
    costCoverageRate: ratio(row.costMatchedQty, quantity),
    shopCount: row.shops.size,
    platformCount: row.platforms.size,
    warehouseCount: row.warehouses.size,
    skuCount: row.skus.size,
  };
}

export function buildPerformanceAnalyticsPayload({ facts = [], products = {}, exchangeRates = [], filters = {} } = {}) {
  const productLookup = buildPerformanceProductLookup(products);
  const rateLookup = buildRateLookup(exchangeRates);
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
    const revenueCovered = Boolean(currency && rate && salesAmount > 0);
    const salesCny = revenueCovered ? round(salesAmount * rate.rateToCny, 6) : 0;
    const unitCostOriginal = Math.max(0, number(product?.directCostPrice));
    const costCurrency = text(product?.directCostCurrency).toUpperCase();
    const costRate = unitCostOriginal > 0 && costCurrency ? rateFor(rateLookup, costCurrency, orderDate) : null;
    const unitCostCny = costRate ? round(unitCostOriginal * costRate.rateToCny, 6) : 0;
    const costEffectiveAt = "";
    const futureCostFallback = false;
    const costCovered = unitCostCny > 0 && quantity > 0;
    const cogsCny = costCovered ? round(quantity * unitCostCny, 6) : 0;
    const profitCovered = revenueCovered && costCovered;
    const estimatedProfitCny = profitCovered ? round(salesCny - cogsCny, 6) : 0;
    const orderIdentity = [source.sourceSystem, source.warehouseId, source.sourceOrderId || source.orderNo].map(text).join("|");
    const row = {
      ...source,
      orderIdentity,
      orderDate,
      quantity,
      salesAmount,
      currency,
      productName,
      brand,
      category: text(product?.category, "未分类"),
      imageUrl: text(product?.imageUrl),
      rateToCny: rate?.rateToCny || 0,
      rateEffectiveDate: rate?.effectiveDate || "",
      revenueCovered,
      salesCny,
      unitCostCny,
      unitCostOriginal,
      costCurrency,
      costRateToCny: costRate?.rateToCny || 0,
      costRateEffectiveDate: costRate?.effectiveDate || "",
      costSource: costCovered ? "product_catalog_direct" : "",
      costCountry: text(product?.country),
      costBatchId: "",
      costEffectiveAt,
      costCovered,
      futureCostFallback,
      cogsCny,
      profitCovered,
      estimatedProfitCny,
    };
    quality.totalLines += 1;
    if (!text(source.sku)) quality.missingSkuLines += 1;
    if (!product) quality.unmatchedProductLines += 1;
    if (!product || brand === "未建档品牌") quality.missingBrandLines += 1;
    if (!currency) quality.missingCurrencyLines += 1;
    if (currency && !rate) quality.missingExchangeRateLines += 1;
    if (salesAmount <= 0) quality.zeroSalesAmountLines += 1;
    if (!costCovered) quality.missingCostLines += 1;
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
    if (recentFacts.length < 100) recentFacts.push({
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
      cogsCny: round(row.cogsCny),
      estimatedProfitCny: round(row.estimatedProfitCny),
      revenueCovered: row.revenueCovered,
      costCovered: row.costCovered,
      profitCovered: row.profitCovered,
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
      costCoverageRate: ratio(total.costMatchedQty, quantity),
      profitCoverageRate: ratio(profitCoveredLines, totalLines),
    },
    currencySummary,
    topProduct: productsResult[0] || null,
    topBrand: brandsResult[0] || null,
    products: productsResult,
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

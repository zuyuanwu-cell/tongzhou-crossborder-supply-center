import { buildPerformanceProductLookup, normalizedCountryKey } from "./performance-analytics.js";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
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

function periodBucket(snapshotDate, period) {
  const value = dateKey(snapshotDate);
  if (!value) return null;
  if (period === "month") {
    return { key: value.slice(0, 7), label: value.slice(0, 7) };
  }
  if (period === "week") {
    const date = new Date(`${value}T00:00:00.000Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const from = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    const to = date.toISOString().slice(0, 10);
    return { key: from, label: `${from.slice(5)} 至 ${to.slice(5)}` };
  }
  return { key: value, label: value.slice(5) };
}

function latestSnapshotsByPeriod(snapshots, period) {
  const grouped = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const bucket = periodBucket(snapshot?.date, period);
    if (!bucket) continue;
    const current = grouped.get(bucket.key);
    if (!current || dateKey(snapshot.date) > dateKey(current.snapshot.date)) {
      grouped.set(bucket.key, { ...bucket, snapshot });
    }
  }
  return [...grouped.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function buildSupplementalLookup(rows) {
  const lookup = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const countryKey = normalizedCountryKey(row?.countryKey || row?.countryName || row?.country);
    const effectiveDate = dateKey(row?.effectiveDate);
    if (!countryKey || !effectiveDate) continue;
    for (const skuKey of normalizedSkuKeys(row?.sku)) {
      const key = `${skuKey}|${countryKey}`;
      const versions = lookup.get(key) || [];
      versions.push({ ...row, countryKey, effectiveDate });
      lookup.set(key, versions);
    }
  }
  for (const versions of lookup.values()) versions.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  return lookup;
}

function supplementalCostFor(lookup, sku, country, snapshotDate) {
  const countryKey = normalizedCountryKey(country);
  const versions = normalizedSkuKeys(sku).flatMap((skuKey) => lookup.get(`${skuKey}|${countryKey}`) || []);
  let matched = null;
  for (const version of versions) {
    if (version.effectiveDate <= snapshotDate && (!matched || version.effectiveDate > matched.effectiveDate)) matched = version;
  }
  if (!matched) matched = versions.find((version) => version.enabled !== false) || null;
  return matched?.enabled === false ? null : matched;
}

function buildRateLookup(rows) {
  const lookup = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const currency = text(row?.currency).toUpperCase();
    const rateToCny = number(row?.rateToCny);
    if (!currency || rateToCny <= 0) continue;
    const values = lookup.get(currency) || [];
    values.push({ effectiveDate: dateKey(row?.effectiveDate) || "2000-01-01", rateToCny });
    lookup.set(currency, values);
  }
  for (const values of lookup.values()) values.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  return lookup;
}

function rateFor(lookup, currency, snapshotDate) {
  const normalized = text(currency).toUpperCase();
  if (["CNY", "RMB"].includes(normalized)) return { rateToCny: 1, effectiveDate: snapshotDate };
  let matched = null;
  for (const row of lookup.get(normalized) || []) {
    if (row.effectiveDate <= snapshotDate) matched = row;
    else break;
  }
  return matched;
}

function productForCountry(lookup, sku, country) {
  const candidates = normalizedSkuKeys(sku).flatMap((key) => lookup.get(key) || []);
  const countryKey = normalizedCountryKey(country);
  const exact = candidates.filter((candidate) => candidate.countryKey === countryKey);
  if (exact.length) return exact.find((candidate) => number(candidate.directCostPrice) > 0) || exact[0];
  return candidates.find((candidate) => !candidate.countryKey) || null;
}

function resolveCost({ productLookup, supplementalLookup, rateLookup, sku, country, snapshotDate }) {
  const product = productForCountry(productLookup, sku, country);
  const directPrice = number(product?.directCostPrice);
  if (directPrice > 0) {
    const currency = text(product?.directCostCurrency || "CNY").toUpperCase();
    const rate = rateFor(rateLookup, currency, snapshotDate);
    if (rate) {
      return {
        unitCostCny: round(directPrice * rate.rateToCny, 6),
        source: "direct_price",
        sourceLabel: "直营供货价",
        product,
      };
    }
  }
  const supplemental = supplementalCostFor(supplementalLookup, sku, country, snapshotDate);
  if (number(supplemental?.unitCostCny) > 0) {
    return {
      unitCostCny: round(supplemental.unitCostCny, 6),
      source: "manual_supplement",
      sourceLabel: "手工补录",
      product,
      supplemental,
    };
  }
  return { unitCostCny: null, source: "missing", sourceLabel: "缺失", product };
}

function quantities(row) {
  const availableQty = Math.max(0, number(row?.availableQty));
  const lockedQty = Math.max(0, number(row?.lockedQty));
  const faultyQty = Math.max(0, number(row?.faultyQty));
  const temporaryQty = Math.max(0, number(row?.temporaryQty));
  const waitInQty = Math.max(0, number(row?.waitInQty));
  const inTransitQty = Math.max(0, number(row?.inTransitQty));
  const onHandQty = availableQty + lockedQty + faultyQty + temporaryQty;
  const totalQty = Math.max(onHandQty + waitInQty + inTransitQty, Math.max(0, number(row?.totalQty)));
  return { onHandQty, waitInQty, inTransitQty, totalQty };
}

function aggregateSnapshot(snapshot, context) {
  const rows = new Map();
  const missing = new Map();
  const summary = {
    date: dateKey(snapshot?.date),
    onHandQty: 0,
    inTransitQty: 0,
    totalQty: 0,
    coveredOnHandQty: 0,
    onHandValueCny: 0,
    inTransitValueCny: 0,
    totalValueCny: 0,
    missingCostSkuCount: 0,
    costCoverageRate: 0,
  };

  for (const item of snapshot?.rows || []) {
    const countryKey = normalizedCountryKey(item.country);
    const sku = text(item.sku || item.countrySku).toUpperCase();
    if (!sku) continue;
    const qty = quantities(item);
    const cost = resolveCost({ ...context, sku, country: item.country, snapshotDate: summary.date });
    const identity = `${countryKey}|${sku}`;
    const current = rows.get(identity) || {
      key: identity,
      sku,
      country: text(item.country),
      countryKey,
      productName: text(item.productName || cost.product?.productName || sku),
      imageUrl: text(cost.product?.imageUrl),
      warehouseNames: new Set(),
      onHandQty: 0,
      inTransitQty: 0,
      totalQty: 0,
      unitCostCny: cost.unitCostCny,
      costSource: cost.source,
      costSourceLabel: cost.sourceLabel,
      onHandValueCny: 0,
      inTransitValueCny: 0,
      totalValueCny: 0,
    };
    if (item.warehouseName || item.warehouseId) current.warehouseNames.add(text(item.warehouseName || item.warehouseId));
    current.onHandQty += qty.onHandQty;
    current.inTransitQty += qty.inTransitQty;
    current.totalQty += qty.totalQty;
    if (cost.unitCostCny !== null) {
      current.onHandValueCny += qty.onHandQty * cost.unitCostCny;
      current.inTransitValueCny += qty.inTransitQty * cost.unitCostCny;
      current.totalValueCny += qty.totalQty * cost.unitCostCny;
      summary.coveredOnHandQty += qty.onHandQty;
    }
    rows.set(identity, current);

    summary.onHandQty += qty.onHandQty;
    summary.inTransitQty += qty.inTransitQty;
    summary.totalQty += qty.totalQty;
    if (cost.unitCostCny !== null) {
      summary.onHandValueCny += qty.onHandQty * cost.unitCostCny;
      summary.inTransitValueCny += qty.inTransitQty * cost.unitCostCny;
      summary.totalValueCny += qty.totalQty * cost.unitCostCny;
    } else if (qty.onHandQty > 0) {
      const gap = missing.get(identity) || {
        key: identity,
        sku,
        country: text(item.country),
        countryKey,
        productName: text(item.productName || cost.product?.productName || sku),
        onHandQty: 0,
        warehouseNames: new Set(),
      };
      gap.onHandQty += qty.onHandQty;
      if (item.warehouseName || item.warehouseId) gap.warehouseNames.add(text(item.warehouseName || item.warehouseId));
      missing.set(identity, gap);
    }
  }

  summary.onHandValueCny = round(summary.onHandValueCny);
  summary.inTransitValueCny = round(summary.inTransitValueCny);
  summary.totalValueCny = round(summary.totalValueCny);
  summary.missingCostSkuCount = missing.size;
  summary.costCoverageRate = summary.onHandQty > 0 ? round(summary.coveredOnHandQty / summary.onHandQty, 4) : 1;
  return {
    summary,
    rows: [...rows.values()].map((row) => ({
      ...row,
      warehouseNames: [...row.warehouseNames],
      onHandValueCny: round(row.onHandValueCny),
      inTransitValueCny: round(row.inTransitValueCny),
      totalValueCny: round(row.totalValueCny),
    })),
    missing: [...missing.values()].map((row) => ({ ...row, warehouseNames: [...row.warehouseNames] })),
  };
}

function matchesFilters(row, filters) {
  if (filters.warehouseId && text(row.warehouseId) !== filters.warehouseId) return false;
  if (filters.country && normalizedCountryKey(row.country) !== normalizedCountryKey(filters.country)) return false;
  return true;
}

export function buildInventoryValuePayload({
  snapshots = [],
  products = {},
  supplementalCosts = [],
  exchangeRates = [],
  filters = {},
  manageCosts = false,
} = {}) {
  const period = ["day", "week", "month"].includes(filters.period) ? filters.period : "day";
  const warehouseId = text(filters.warehouseId);
  const country = text(filters.country);
  const keyword = text(filters.keyword).toLowerCase();
  const scopedSnapshots = (Array.isArray(snapshots) ? snapshots : []).map((snapshot) => ({
    ...snapshot,
    rows: (snapshot?.rows || []).filter((row) => matchesFilters(row, { warehouseId, country })),
  }));
  const periods = latestSnapshotsByPeriod(scopedSnapshots, period);
  const productLookup = buildPerformanceProductLookup(products);
  const context = {
    productLookup,
    supplementalLookup: buildSupplementalLookup(supplementalCosts),
    rateLookup: buildRateLookup(exchangeRates),
  };
  const valuedPeriods = periods.map((item) => ({ ...item, value: aggregateSnapshot(item.snapshot, context) }));
  const current = valuedPeriods.at(-1) || null;
  const previous = valuedPeriods.at(-2) || null;
  const previousRows = new Map((previous?.value.rows || []).map((row) => [row.key, row]));
  const currentRows = new Map((current?.value.rows || []).map((row) => [row.key, row]));
  const rowKeys = new Set([...currentRows.keys(), ...previousRows.keys()]);
  let rows = [...rowKeys].map((key) => {
    const currentRow = currentRows.get(key);
    const previousRow = previousRows.get(key);
    const row = currentRow || {
      ...previousRow,
      onHandQty: 0,
      inTransitQty: 0,
      totalQty: 0,
      onHandValueCny: 0,
      inTransitValueCny: 0,
      totalValueCny: 0,
    };
    const previousValueCny = number(previousRow?.onHandValueCny);
    const valueChangeCny = round(row.onHandValueCny - previousValueCny);
    return {
      ...row,
      previousOnHandQty: number(previousRow?.onHandQty),
      previousValueCny,
      quantityChange: round(row.onHandQty - number(previousRow?.onHandQty), 4),
      valueChangeCny,
      valueChangeRate: previousValueCny > 0 ? round(valueChangeCny / previousValueCny, 4) : null,
    };
  });
  if (keyword) {
    rows = rows.filter((row) => [row.sku, row.productName, row.country, ...row.warehouseNames].join(" ").toLowerCase().includes(keyword));
  }
  rows.sort((left, right) => Math.abs(right.valueChangeCny) - Math.abs(left.valueChangeCny) || right.onHandValueCny - left.onHandValueCny);

  const currentSummary = current?.value.summary || aggregateSnapshot({ date: "", rows: [] }, context).summary;
  const previousSummary = previous?.value.summary || null;
  const periodChangeCny = round(currentSummary.onHandValueCny - number(previousSummary?.onHandValueCny));
  const warehouseOptions = new Map();
  const countryOptions = new Map();
  for (const snapshot of snapshots) {
    for (const row of snapshot?.rows || []) {
      if (row.warehouseId) warehouseOptions.set(String(row.warehouseId), text(row.warehouseName || row.warehouseId));
      const key = normalizedCountryKey(row.country);
      if (key) countryOptions.set(key, text(row.country || key));
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    basis: "current_direct_price",
    period,
    filters: { warehouseId, country, keyword: text(filters.keyword) },
    permissions: { manageCosts: Boolean(manageCosts) },
    options: {
      warehouses: [...warehouseOptions].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
      countries: [...countryOptions].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    },
    currentPeriod: current ? { key: current.key, label: current.label, snapshotDate: current.value.summary.date } : null,
    previousPeriod: previous ? { key: previous.key, label: previous.label, snapshotDate: previous.value.summary.date } : null,
    summary: {
      ...currentSummary,
      previousOnHandValueCny: number(previousSummary?.onHandValueCny),
      periodChangeCny,
      periodChangeRate: number(previousSummary?.onHandValueCny) > 0 ? round(periodChangeCny / previousSummary.onHandValueCny, 4) : null,
    },
    timeline: valuedPeriods.slice(-24).map((item) => ({
      key: item.key,
      label: item.label,
      snapshotDate: item.value.summary.date,
      onHandValueCny: item.value.summary.onHandValueCny,
      inTransitValueCny: item.value.summary.inTransitValueCny,
      onHandQty: item.value.summary.onHandQty,
      costCoverageRate: item.value.summary.costCoverageRate,
      missingCostSkuCount: item.value.summary.missingCostSkuCount,
    })),
    rows,
    missingCosts: (current?.value.missing || []).sort((left, right) => right.onHandQty - left.onHandQty),
    supplementalCostCount: supplementalCosts.length,
  };
}

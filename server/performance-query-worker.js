import { parentPort } from "node:worker_threads";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildPerformanceAnalyticsPayload } from "./performance-analytics.js";
import { buildOrderAnalysisFromFacts } from "./order-analysis.js";
import { aggregateSystemShopDaily, buildShopDailyOrderDrilldown } from "./shop-daily-report.js";
import { readPartitionIndex, readPartitionRows } from "./performance-partitions.js";

let dataVersion = "";
let facts = [];
let exchangeRates = [];
let packagingFeeRules = [];

function text(value) {
  return String(value ?? "").trim();
}

function withinScope(row, scopes = {}) {
  const warehouseIds = Array.isArray(scopes.warehouseIds) ? scopes.warehouseIds : [];
  const countries = Array.isArray(scopes.countries) ? scopes.countries : [];
  const skus = Array.isArray(scopes.skus) ? scopes.skus : [];
  if (warehouseIds.length && !warehouseIds.includes(text(row.warehouseId))) return false;
  if (countries.length && !countries.includes(text(row.country))) return false;
  if (skus.length) {
    const rowSkus = [row.sku, row.skuNo, row.countrySku].map((value) => text(value).toUpperCase()).filter(Boolean);
    if (!rowSkus.some((sku) => skus.includes(sku))) return false;
  }
  return true;
}

function lowerBound(rows, date) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (text(rows[middle]?.orderDate) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(rows, date) {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (text(rows[middle]?.orderDate) <= date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function dateSlice(filters = {}) {
  const from = text(filters.dateFrom);
  const to = text(filters.dateTo);
  const start = from ? lowerBound(facts, from) : 0;
  const end = to ? upperBound(facts, to) : facts.length;
  return facts.slice(start, end);
}

function queryPerformance(message) {
  const startedAt = Date.now();
  const scopes = message.scopes || {};
  const hasDataScope = [scopes.warehouseIds, scopes.countries, scopes.skus]
    .some((values) => Array.isArray(values) && values.length > 0);
  const scopedAllFacts = hasDataScope ? facts.filter((row) => withinScope(row, scopes)) : facts;
  const visibleShopKeys = hasDataScope
    ? [...new Set(scopedAllFacts.map((row) => text(row.shopKey)).filter(Boolean))]
    : null;
  const rangedFacts = dateSlice(message.filters);
  const queryFacts = hasDataScope ? rangedFacts.filter((row) => withinScope(row, scopes)) : rangedFacts;
  const payload = buildPerformanceAnalyticsPayload({
    materializedFacts: queryFacts,
    exchangeRates,
    packagingFeeRules,
    filters: message.filters || {},
    limits: message.limits || {},
  });
  return {
    payload,
    visibleShopKeys,
    workerQueryDurationMs: Date.now() - startedAt,
    scannedFactCount: queryFacts.length,
  };
}

function queryOrderAnalysis(message) {
  const startedAt = Date.now();
  const scopes = message.scopes || {};
  const hasDataScope = [scopes.warehouseIds, scopes.countries, scopes.skus]
    .some((values) => Array.isArray(values) && values.length > 0);
  const scopedFacts = hasDataScope ? facts.filter((row) => withinScope(row, scopes)) : facts;
  const visibleShopKeys = hasDataScope
    ? [...new Set(scopedFacts.map((row) => text(row.shopKey)).filter(Boolean))]
    : null;
  const payload = buildOrderAnalysisFromFacts({
    facts: scopedFacts,
    filters: message.filters || {},
    onlyRussia: message.onlyRussia !== false,
    scope: message.scope || "",
    recentLimit: message.limits?.recentOrders || 200,
  });
  return {
    payload,
    visibleShopKeys,
    workerQueryDurationMs: Date.now() - startedAt,
    scannedFactCount: scopedFacts.length,
  };
}

function queryShopDaily(message) {
  const startedAt = Date.now();
  const scopes = message.scopes || {};
  const hasDataScope = [scopes.warehouseIds, scopes.countries, scopes.skus]
    .some((values) => Array.isArray(values) && values.length > 0);
  const filters = message.filters || {};
  const orderNos = Array.isArray(message.params?.orderNos) ? message.params.orderNos : [];
  // 测评订单号可能早于查询区间，需要在全部事实里查找；否则只扫描日期区间。
  const source = orderNos.length ? facts : dateSlice(filters);
  const scopedFacts = hasDataScope ? source.filter((row) => withinScope(row, scopes)) : source;
  const payload = aggregateSystemShopDaily(scopedFacts, { dateFrom: text(filters.dateFrom), dateTo: text(filters.dateTo), orderNos });
  return {
    payload,
    visibleShopKeys: hasDataScope ? [...new Set(scopedFacts.map((row) => text(row.shopKey)).filter(Boolean))] : null,
    workerQueryDurationMs: Date.now() - startedAt,
    scannedFactCount: scopedFacts.length,
  };
}

function queryShopDailyOrders(message) {
  const startedAt = Date.now();
  const scopes = message.scopes || {};
  const hasDataScope = [scopes.warehouseIds, scopes.countries, scopes.skus]
    .some((values) => Array.isArray(values) && values.length > 0);
  const rangedFacts = dateSlice(message.filters || {});
  const scopedFacts = hasDataScope ? rangedFacts.filter((row) => withinScope(row, scopes)) : rangedFacts;
  const payload = buildShopDailyOrderDrilldown(scopedFacts, {
    ...(message.filters || {}),
    ...(message.params || {}),
  });
  return {
    payload,
    visibleShopKeys: hasDataScope ? [...new Set(scopedFacts.map((row) => text(row.shopKey)).filter(Boolean))] : null,
    workerQueryDurationMs: Date.now() - startedAt,
    scannedFactCount: scopedFacts.length,
  };
}

// 分区缓存：key -> { hash, rows }。刷新时只重新读取哈希变化的分区。
const partitionCache = new Map();

function loadPartitions(partitionDir) {
  const startedAt = Date.now();
  const index = readPartitionIndex(partitionDir);
  const entries = Object.entries(index.partitions || {});
  if (!entries.length) throw new Error("经营分析分区尚未生成，请稍后重试。");
  let reloaded = 0;
  const next = new Map();
  for (const [key, meta] of entries) {
    const hash = text(meta?.hash);
    const cached = partitionCache.get(key);
    if (cached && cached.hash === hash) {
      next.set(key, cached);
      continue;
    }
    next.set(key, { hash, rows: readPartitionRows(partitionDir, key, hash) });
    reloaded += 1;
  }
  partitionCache.clear();
  for (const [key, value] of next) partitionCache.set(key, value);
  const rows = [];
  for (const value of partitionCache.values()) for (const row of value.rows) rows.push(row);
  rows.sort((left, right) => text(left.orderDate).localeCompare(text(right.orderDate)));
  return { rows, stats: { partitionCount: entries.length, reloadedPartitionCount: reloaded, durationMs: Date.now() - startedAt } };
}

function initialize(message = {}) {
  let initialFacts = Array.isArray(message.facts) ? message.facts : null;
  if (!initialFacts && message.partitionDir) {
    initialFacts = loadPartitions(message.partitionDir).rows;
  }
  if (!initialFacts && message.cachePath && existsSync(message.cachePath)) {
    const snapshot = JSON.parse(gunzipSync(readFileSync(message.cachePath)).toString("utf8"));
    if (text(message.dataVersion) && text(snapshot.dataVersion) !== text(message.dataVersion)) {
      throw new Error("经营分析快照版本已变化，请稍后重试。");
    }
    initialFacts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  }
  dataVersion = text(message.dataVersion);
  facts = initialFacts || [];
  facts.sort((left, right) => text(left.orderDate).localeCompare(text(right.orderDate)));
  exchangeRates = Array.isArray(message.exchangeRates) ? message.exchangeRates : [];
  packagingFeeRules = Array.isArray(message.packagingFeeRules) ? message.packagingFeeRules : [];
  parentPort.postMessage({ type: "ready", dataVersion, factCount: facts.length });
}

parentPort.on("message", (message = {}) => {
  if (message.type === "initialize") {
    try {
      initialize(message);
    } catch (error) {
      parentPort.postMessage({
        type: "initialization-error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : "",
      });
    }
    return;
  }
  if (message.type === "refresh") {
    try {
      // 读取失败（物化线程正在替换文件）时重试一次。
      let loaded;
      try {
        loaded = loadPartitions(message.partitionDir);
      } catch {
        loaded = loadPartitions(message.partitionDir);
      }
      facts = loaded.rows;
      dataVersion = text(message.dataVersion);
      exchangeRates = Array.isArray(message.exchangeRates) ? message.exchangeRates : exchangeRates;
      packagingFeeRules = Array.isArray(message.packagingFeeRules) ? message.packagingFeeRules : packagingFeeRules;
      parentPort.postMessage({ type: "refreshed", dataVersion, factCount: facts.length, stats: loaded.stats });
    } catch (error) {
      parentPort.postMessage({ type: "refresh-error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }
  if (message.type !== "query") return;
  try {
    const result = message.queryType === "order-analysis"
      ? queryOrderAnalysis(message)
      : message.queryType === "shop-daily-orders"
        ? queryShopDailyOrders(message)
      : message.queryType === "shop-daily"
        ? queryShopDaily(message)
        : queryPerformance(message);
    parentPort.postMessage({ type: "result", id: message.id, dataVersion, ...result });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "",
    });
  }
});

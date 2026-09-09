import { parentPort } from "node:worker_threads";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { buildPerformanceAnalyticsPayload } from "./performance-analytics.js";
import { buildOrderAnalysisFromFacts } from "./order-analysis.js";

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
    recentLimit: message.limits?.recentOrders || 200,
  });
  return {
    payload,
    visibleShopKeys,
    workerQueryDurationMs: Date.now() - startedAt,
    scannedFactCount: scopedFacts.length,
  };
}

function initialize(message = {}) {
  let initialFacts = Array.isArray(message.facts) ? message.facts : null;
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
  if (message.type !== "query") return;
  try {
    const result = message.queryType === "order-analysis"
      ? queryOrderAnalysis(message)
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

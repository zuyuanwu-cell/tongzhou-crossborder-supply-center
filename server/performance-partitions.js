// 经营事实按天分区物化。
//
// 对账后的事实按「订单最早日期」分区（同一订单的所有行落在同一分区，保证打包费按整单计算）。
// 每个分区的哈希 = 全局规则版本 + 截至分区最大日期的汇率 + 分区内事实内容。
// 哈希不变的分区直接复用上次的物化结果，只重算变化的日期；同时为每个分区产出日汇总，
// 供汇总接口和 PostgreSQL 汇总表使用。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const PARTITION_SCHEMA_VERSION = "partitions-v1";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function dateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}

export function factDate(fact) {
  return dateKey(fact?.orderDate || fact?.shippedAt || fact?.createdAt) || "undated";
}

// 与 performance-analytics.js 中 performanceOrderIdentity 保持一致。
export function factOrderIdentity(fact) {
  return [fact?.sourceSystem, fact?.warehouseId, fact?.sourceOrderId || fact?.orderNo || fact?.id].map(text).join("|");
}

/**
 * 把事实分配到分区：同一订单取其所有行中最早的日期。
 */
export function partitionFacts(facts = []) {
  const orderPartition = new Map();
  for (const fact of facts) {
    const identity = factOrderIdentity(fact);
    const date = factDate(fact);
    const current = orderPartition.get(identity);
    if (!current || date < current) orderPartition.set(identity, date);
  }
  const partitions = new Map();
  for (const fact of facts) {
    const key = orderPartition.get(factOrderIdentity(fact)) || factDate(fact);
    const entry = partitions.get(key) || { key, facts: [], maxDate: "" };
    entry.facts.push(fact);
    const date = factDate(fact);
    if (date !== "undated" && date > entry.maxDate) entry.maxDate = date;
    partitions.set(key, entry);
  }
  return partitions;
}

/**
 * 汇率按生效日期排序后做链式哈希；分区只依赖「生效日期 ≤ 分区最大日期」的汇率。
 */
export function buildRateChain(exchangeRates = []) {
  const rates = (Array.isArray(exchangeRates) ? exchangeRates : [])
    .map((row) => ({ currency: text(row.currency).toUpperCase(), effectiveDate: dateKey(row.effectiveDate) || "2000-01-01", rateToCny: number(row.rateToCny) }))
    .filter((row) => row.currency && row.rateToCny > 0)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate) || left.currency.localeCompare(right.currency) || left.rateToCny - right.rateToCny);
  const chain = [];
  let previous = "";
  for (const rate of rates) {
    previous = sha1(`${previous}|${rate.currency}|${rate.effectiveDate}|${rate.rateToCny}`);
    chain.push({ effectiveDate: rate.effectiveDate, hash: previous });
  }
  return function rateHashUpTo(date) {
    if (!chain.length) return "";
    if (!date || date === "undated") return chain[chain.length - 1].hash;
    let low = 0;
    let high = chain.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (chain[middle].effectiveDate <= date) low = middle + 1;
      else high = middle;
    }
    return low > 0 ? chain[low - 1].hash : "";
  };
}

export function partitionContentHash(partition, { staticHash, rateHashUpTo }) {
  const lines = partition.facts.map((fact) => JSON.stringify(fact));
  lines.sort();
  const hash = createHash("sha1");
  hash.update(`${PARTITION_SCHEMA_VERSION}|${staticHash}|${rateHashUpTo(partition.maxDate || partition.key)}|${lines.length}`);
  for (const line of lines) {
    hash.update(line);
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 20);
}

function safeFileKey(key) {
  return text(key).replace(/[^0-9A-Za-z_-]/g, "_") || "undated";
}

function readJsonGz(path) {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"));
}

function writeAtomic(path, buffer) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, buffer);
  renameSync(temporary, path);
}

// ---------------------------------------------------------------------------
// 日汇总
// ---------------------------------------------------------------------------

const SUMMARY_METRICS = [
  "orderLines", "quantity", "salesCny", "productCostCny", "packagingFeeCny", "cogsCny",
  "profitSalesCny", "profitCogsCny", "estimatedProfitCny", "commissionFeeCny", "logisticsFeeCny",
  "contributionSalesCny", "contributionProfitCny", "revenueCoveredLines", "costCoveredLines", "profitCoveredLines", "contributionCoveredLines",
];

function emptyMetrics() {
  return Object.fromEntries(SUMMARY_METRICS.map((key) => [key, 0]));
}

function addRow(metrics, row) {
  metrics.orderLines += 1;
  metrics.quantity += number(row.quantity);
  if (row.revenueCovered) {
    metrics.salesCny += number(row.salesCny);
    metrics.revenueCoveredLines += 1;
  }
  if (row.productCostCovered) metrics.productCostCny += number(row.productCostCny);
  if (row.packagingCostCovered) metrics.packagingFeeCny += number(row.packagingFeeCny);
  metrics.cogsCny += number(row.cogsCny);
  metrics.commissionFeeCny += number(row.commissionFeeCny);
  metrics.logisticsFeeCny += number(row.logisticsFeeCny);
  if (row.costCovered) metrics.costCoveredLines += 1;
  if (row.profitCovered) {
    metrics.profitSalesCny += number(row.salesCny);
    metrics.profitCogsCny += number(row.cogsCny);
    metrics.estimatedProfitCny += number(row.estimatedProfitCny);
    metrics.profitCoveredLines += 1;
  }
  if (row.contributionCovered) {
    metrics.contributionSalesCny += number(row.salesCny);
    metrics.contributionProfitCny += number(row.contributionProfitCny);
    metrics.contributionCoveredLines += 1;
  }
}

function finalizeMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, key.endsWith("Lines") ? value : round(value, 4)]));
}

export function revenueSourceOf(row) {
  return text(row.revenueSourceSystem) || (text(row.salesAmountScope) === "miaoshou_order_allocated" ? "miaoshou" : "wms");
}

/**
 * 店铺 × 日（订单数可加总）与 SKU × 日两级汇总。
 */
export function summarizePartitionRows(rows = [], partitionKey = "") {
  const shopDay = new Map();
  const skuDay = new Map();
  for (const row of rows) {
    const date = factDate(row);
    const shopKey = text(row.shopKey) || text(row.shopName) || "unassigned";
    const warehouseId = text(row.warehouseId);
    const source = revenueSourceOf(row);
    const shopKeyId = [date, shopKey, warehouseId, source].join("\u0000");
    let shop = shopDay.get(shopKeyId);
    if (!shop) {
      shop = {
        partitionKey,
        date,
        shopKey,
        shopName: text(row.shopName),
        warehouseId,
        warehouseName: text(row.warehouseName),
        country: text(row.country),
        platform: text(row.platform),
        projectGroup: text(row.projectGroup),
        revenueSource: source,
        orders: new Set(),
        metrics: emptyMetrics(),
      };
      shopDay.set(shopKeyId, shop);
    }
    shop.orders.add(text(row.orderIdentity) || factOrderIdentity(row));
    addRow(shop.metrics, row);

    const sku = text(row.sku) || text(row.productName) || "unknown";
    const skuKeyId = [date, shopKey, warehouseId, source, sku].join("\u0000");
    let skuEntry = skuDay.get(skuKeyId);
    if (!skuEntry) {
      skuEntry = {
        partitionKey,
        date,
        shopKey,
        warehouseId,
        country: text(row.country),
        platform: text(row.platform),
        projectGroup: text(row.projectGroup),
        revenueSource: source,
        sku,
        productName: text(row.productName),
        brand: text(row.brand),
        orders: new Set(),
        metrics: emptyMetrics(),
      };
      skuDay.set(skuKeyId, skuEntry);
    }
    skuEntry.orders.add(text(row.orderIdentity) || factOrderIdentity(row));
    addRow(skuEntry.metrics, row);
  }
  const publish = (entry) => {
    const { orders, metrics, ...rest } = entry;
    return { ...rest, orderCount: orders.size, ...finalizeMetrics(metrics) };
  };
  return { shopDay: [...shopDay.values()].map(publish), skuDay: [...skuDay.values()].map(publish) };
}

// ---------------------------------------------------------------------------
// 分区缓存
// ---------------------------------------------------------------------------

export function createPartitionCache(directory) {
  const root = text(directory);
  const indexPath = root ? join(root, "index.json") : "";

  function readIndex() {
    if (!indexPath || !existsSync(indexPath)) return { schema: PARTITION_SCHEMA_VERSION, partitions: {} };
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      return parsed?.schema === PARTITION_SCHEMA_VERSION && parsed.partitions && typeof parsed.partitions === "object"
        ? parsed
        : { schema: PARTITION_SCHEMA_VERSION, partitions: {} };
    } catch {
      return { schema: PARTITION_SCHEMA_VERSION, partitions: {} };
    }
  }

  // 文件名带上分区哈希：读取方（查询线程、汇总同步）按索引里的哈希读取，
  // 物化线程写新版本时不会覆盖正在被读取的旧文件。
  function rowsPath(key, hash) {
    return partitionRowsPath(root, key, hash);
  }

  function summaryPath(key, hash) {
    return partitionSummaryPath(root, key, hash);
  }

  function readRows(key, hash) {
    return readJsonGz(rowsPath(key, hash));
  }

  function readSummary(key, hash) {
    const path = summaryPath(key, hash);
    return existsSync(path) ? readJsonGz(path) : null;
  }

  function writePartition(key, hash, rows, summary) {
    writeAtomic(rowsPath(key, hash), gzipSync(Buffer.from(JSON.stringify(rows)), { level: 1 }));
    writeAtomic(summaryPath(key, hash), gzipSync(Buffer.from(JSON.stringify(summary)), { level: 1 }));
    return { hash, rowCount: rows.length, shopDayCount: summary.shopDay.length, skuDayCount: summary.skuDay.length, updatedAt: new Date().toISOString() };
  }

  function writeIndex(index) {
    writeAtomic(indexPath, Buffer.from(JSON.stringify(index)));
  }

  // 删除不在当前或上一版索引中的文件；保留上一版，给仍在读取旧索引的线程留出时间。
  function cleanupOrphans(index, previousIndex = null) {
    if (!root || !existsSync(root)) return;
    const valid = new Set();
    for (const source of [index, previousIndex]) {
      for (const [key, meta] of Object.entries(source?.partitions || {})) valid.add(`${safeFileKey(key)}.${text(meta?.hash)}`);
    }
    for (const name of readdirSync(root)) {
      const match = name.match(/^(.+)\.(rows|summary)\.json\.gz$/);
      if (match && !valid.has(match[1])) rmSync(join(root, name), { force: true });
    }
  }

  return { root, readIndex, readRows, readSummary, writePartition, writeIndex, cleanupOrphans, ensure: () => root && mkdirSync(root, { recursive: true }) };
}

export function partitionRowsPath(root, key, hash) {
  return join(root, `${safeFileKey(key)}.${text(hash)}.rows.json.gz`);
}

export function partitionSummaryPath(root, key, hash) {
  return join(root, `${safeFileKey(key)}.${text(hash)}.summary.json.gz`);
}

export function readPartitionIndex(root) {
  return createPartitionCache(root).readIndex();
}

export function readPartitionRows(root, key, hash) {
  return readJsonGz(partitionRowsPath(root, key, hash));
}

export function readPartitionSummary(root, key, hash) {
  const path = partitionSummaryPath(root, key, hash);
  return existsSync(path) ? readJsonGz(path) : null;
}

/**
 * 分区物化主流程。materialize(facts) 必须是逐行独立的纯函数（打包费按整单计算，整单在同一分区内）。
 */
export function materializeWithPartitions({ facts = [], cacheDirectory = "", staticHash = "", exchangeRates = [], materialize, forceFull = false, loadReusedRows = true } = {}) {
  if (typeof materialize !== "function") throw new Error("materializeWithPartitions 缺少 materialize 回调");
  const startedAt = Date.now();
  const cache = createPartitionCache(cacheDirectory);
  const usable = Boolean(cache.root);
  if (usable) cache.ensure();
  const previous = usable && !forceFull ? cache.readIndex() : { schema: PARTITION_SCHEMA_VERSION, partitions: {} };
  const partitions = partitionFacts(facts);
  const rateHashUpTo = buildRateChain(exchangeRates);
  const nextIndex = { schema: PARTITION_SCHEMA_VERSION, staticHash, updatedAt: new Date().toISOString(), partitions: {} };
  const dirty = [];
  const reused = [];
  for (const partition of partitions.values()) {
    const hash = partitionContentHash(partition, { staticHash, rateHashUpTo });
    const before = previous.partitions?.[partition.key];
    if (usable && before?.hash === hash && existsSync(cache.root ? partitionRowsPath(cache.root, partition.key, hash) : "")) {
      try {
        // 查询线程直接读分区文件时，物化线程不必再把未变化的分区读回内存。
        reused.push({ key: partition.key, rows: loadReusedRows ? cache.readRows(partition.key, hash) : [], meta: before });
        nextIndex.partitions[partition.key] = before;
        continue;
      } catch {
        // 缓存文件损坏时按脏分区重算。
      }
    }
    dirty.push({ partition, hash });
  }
  const dirtyFacts = dirty.flatMap(({ partition }) => partition.facts);
  const materializedDirty = dirtyFacts.length ? materialize(dirtyFacts) : [];
  // 物化结果按订单身份归回分区。
  const partitionByOrder = new Map();
  for (const { partition } of dirty) for (const fact of partition.facts) partitionByOrder.set(factOrderIdentity(fact), partition.key);
  const rowsByPartition = new Map(dirty.map(({ partition }) => [partition.key, []]));
  for (const row of materializedDirty) {
    const key = partitionByOrder.get(factOrderIdentity(row)) || factDate(row);
    if (!rowsByPartition.has(key)) rowsByPartition.set(key, []);
    rowsByPartition.get(key).push(row);
  }
  const rebuiltKeys = [];
  for (const { partition, hash } of dirty) {
    const rows = rowsByPartition.get(partition.key) || [];
    const summary = summarizePartitionRows(rows, partition.key);
    nextIndex.partitions[partition.key] = usable
      ? cache.writePartition(partition.key, hash, rows, summary)
      : { hash, rowCount: rows.length, updatedAt: nextIndex.updatedAt };
    rebuiltKeys.push(partition.key);
    reused.push({ key: partition.key, rows, meta: nextIndex.partitions[partition.key], summary });
  }
  const removedKeys = Object.keys(previous.partitions || {}).filter((key) => !partitions.has(key));
  if (usable) {
    cache.writeIndex(nextIndex);
    cache.cleanupOrphans(nextIndex, previous);
  }
  reused.sort((left, right) => left.key.localeCompare(right.key));
  return {
    rows: reused.flatMap((entry) => entry.rows),
    index: nextIndex,
    stats: {
      partitionCount: partitions.size,
      rebuiltPartitionCount: rebuiltKeys.length,
      reusedPartitionCount: partitions.size - rebuiltKeys.length,
      removedPartitionCount: removedKeys.length,
      rebuiltFactCount: dirtyFacts.length,
      totalFactCount: facts.length,
      totalRowCount: Object.values(nextIndex.partitions).reduce((sum, meta) => sum + number(meta?.rowCount), 0),
      rebuiltKeys: rebuiltKeys.slice(0, 120),
      durationMs: Date.now() - startedAt,
    },
    rebuiltKeys,
    removedKeys,
  };
}

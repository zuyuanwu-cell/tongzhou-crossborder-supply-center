// 经营日汇总存储。
//
// 物化 Worker 每个分区都会写出「店铺 × 日」「SKU × 日」两级汇总文件。本模块把变化的分区同步到
// PostgreSQL（配置 ANALYTICS_DATABASE_URL 时），未配置时保存在内存。汇总接口按需 GROUP BY，
// 不再扫描全部订单事实。

import { normalizedCountryKey } from "./performance-analytics.js";
import { readPartitionIndex, readPartitionSummary } from "./performance-partitions.js";

function text(value) {
  return String(value ?? "").trim();
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
  return number(denominator) > 0 ? round(number(numerator) / number(denominator), 4) : 0;
}

export const SUMMARY_METRIC_COLUMNS = Object.freeze([
  ["orderCount", "order_count"],
  ["orderLines", "order_lines"],
  ["quantity", "quantity"],
  ["salesCny", "sales_cny"],
  ["productCostCny", "product_cost_cny"],
  ["packagingFeeCny", "packaging_fee_cny"],
  ["cogsCny", "cogs_cny"],
  ["profitSalesCny", "profit_sales_cny"],
  ["profitCogsCny", "profit_cogs_cny"],
  ["estimatedProfitCny", "estimated_profit_cny"],
  ["commissionFeeCny", "commission_fee_cny"],
  ["logisticsFeeCny", "logistics_fee_cny"],
  ["contributionSalesCny", "contribution_sales_cny"],
  ["contributionProfitCny", "contribution_profit_cny"],
  ["revenueCoveredLines", "revenue_covered_lines"],
  ["costCoveredLines", "cost_covered_lines"],
  ["profitCoveredLines", "profit_covered_lines"],
  ["contributionCoveredLines", "contribution_covered_lines"],
]);

const SHOP_DIMENSIONS = Object.freeze([
  ["partitionKey", "partition_key"],
  ["date", "metric_date"],
  ["shopKey", "shop_key"],
  ["shopName", "shop_name"],
  ["warehouseId", "warehouse_id"],
  ["warehouseName", "warehouse_name"],
  ["country", "country"],
  ["countryKey", "country_key"],
  ["platform", "platform"],
  ["projectGroup", "project_group"],
  ["revenueSource", "revenue_source"],
]);

const SKU_DIMENSIONS = Object.freeze([
  ["partitionKey", "partition_key"],
  ["date", "metric_date"],
  ["shopKey", "shop_key"],
  ["warehouseId", "warehouse_id"],
  ["country", "country"],
  ["countryKey", "country_key"],
  ["platform", "platform"],
  ["projectGroup", "project_group"],
  ["revenueSource", "revenue_source"],
  ["sku", "sku"],
  ["productName", "product_name"],
  ["brand", "brand"],
]);

export const SUMMARY_GROUPS = Object.freeze({
  total: { table: "shop", fields: [] },
  day: { table: "shop", fields: ["date"] },
  shop: { table: "shop", fields: ["shopKey", "shopName", "platform", "country", "projectGroup"] },
  warehouse: { table: "shop", fields: ["warehouseId", "warehouseName"] },
  country: { table: "shop", fields: ["countryKey", "country"] },
  platform: { table: "shop", fields: ["platform"] },
  projectGroup: { table: "shop", fields: ["projectGroup"] },
  source: { table: "shop", fields: ["revenueSource"] },
  shopDay: { table: "shop", fields: ["date", "shopKey", "shopName", "platform", "country", "projectGroup"] },
  sku: { table: "sku", fields: ["sku", "productName", "brand"] },
  brand: { table: "sku", fields: ["brand"] },
});

const DDL = `
CREATE TABLE IF NOT EXISTS analytics_partitions (
  partition_key TEXT PRIMARY KEY,
  partition_hash TEXT NOT NULL,
  shop_rows INTEGER NOT NULL DEFAULT 0,
  sku_rows INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analytics_shop_daily (
  partition_key TEXT NOT NULL,
  metric_date DATE,
  shop_key TEXT NOT NULL,
  shop_name TEXT,
  warehouse_id TEXT NOT NULL DEFAULT '',
  warehouse_name TEXT,
  country TEXT,
  country_key TEXT,
  platform TEXT,
  project_group TEXT,
  revenue_source TEXT NOT NULL DEFAULT 'wms',
  order_count INTEGER NOT NULL DEFAULT 0,
  order_lines INTEGER NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  sales_cny NUMERIC NOT NULL DEFAULT 0,
  product_cost_cny NUMERIC NOT NULL DEFAULT 0,
  packaging_fee_cny NUMERIC NOT NULL DEFAULT 0,
  cogs_cny NUMERIC NOT NULL DEFAULT 0,
  profit_sales_cny NUMERIC NOT NULL DEFAULT 0,
  profit_cogs_cny NUMERIC NOT NULL DEFAULT 0,
  estimated_profit_cny NUMERIC NOT NULL DEFAULT 0,
  commission_fee_cny NUMERIC NOT NULL DEFAULT 0,
  logistics_fee_cny NUMERIC NOT NULL DEFAULT 0,
  contribution_sales_cny NUMERIC NOT NULL DEFAULT 0,
  contribution_profit_cny NUMERIC NOT NULL DEFAULT 0,
  revenue_covered_lines INTEGER NOT NULL DEFAULT 0,
  cost_covered_lines INTEGER NOT NULL DEFAULT 0,
  profit_covered_lines INTEGER NOT NULL DEFAULT 0,
  contribution_covered_lines INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_analytics_shop_daily_partition ON analytics_shop_daily (partition_key);
CREATE INDEX IF NOT EXISTS idx_analytics_shop_daily_date ON analytics_shop_daily (metric_date, shop_key);
CREATE INDEX IF NOT EXISTS idx_analytics_shop_daily_scope ON analytics_shop_daily (country_key, warehouse_id, platform, project_group);
CREATE TABLE IF NOT EXISTS analytics_sku_daily (
  partition_key TEXT NOT NULL,
  metric_date DATE,
  shop_key TEXT NOT NULL,
  warehouse_id TEXT NOT NULL DEFAULT '',
  country TEXT,
  country_key TEXT,
  platform TEXT,
  project_group TEXT,
  revenue_source TEXT NOT NULL DEFAULT 'wms',
  sku TEXT NOT NULL,
  product_name TEXT,
  brand TEXT,
  order_count INTEGER NOT NULL DEFAULT 0,
  order_lines INTEGER NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 0,
  sales_cny NUMERIC NOT NULL DEFAULT 0,
  product_cost_cny NUMERIC NOT NULL DEFAULT 0,
  packaging_fee_cny NUMERIC NOT NULL DEFAULT 0,
  cogs_cny NUMERIC NOT NULL DEFAULT 0,
  profit_sales_cny NUMERIC NOT NULL DEFAULT 0,
  profit_cogs_cny NUMERIC NOT NULL DEFAULT 0,
  estimated_profit_cny NUMERIC NOT NULL DEFAULT 0,
  commission_fee_cny NUMERIC NOT NULL DEFAULT 0,
  logistics_fee_cny NUMERIC NOT NULL DEFAULT 0,
  contribution_sales_cny NUMERIC NOT NULL DEFAULT 0,
  contribution_profit_cny NUMERIC NOT NULL DEFAULT 0,
  revenue_covered_lines INTEGER NOT NULL DEFAULT 0,
  cost_covered_lines INTEGER NOT NULL DEFAULT 0,
  profit_covered_lines INTEGER NOT NULL DEFAULT 0,
  contribution_covered_lines INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_analytics_sku_daily_partition ON analytics_sku_daily (partition_key);
CREATE INDEX IF NOT EXISTS idx_analytics_sku_daily_date ON analytics_sku_daily (metric_date, sku);
CREATE INDEX IF NOT EXISTS idx_analytics_sku_daily_brand ON analytics_sku_daily (brand, metric_date);
`;

function withCountryKey(row) {
  return { ...row, countryKey: normalizedCountryKey(row.country) };
}

function readPartitionSummaryRows(partitionDir, key, hash) {
  const summary = readPartitionSummary(partitionDir, key, hash);
  if (!summary) return null;
  return {
    shopDay: (summary.shopDay || []).map(withCountryKey),
    skuDay: (summary.skuDay || []).map(withCountryKey),
  };
}

function rowValues(row, dimensions) {
  return [
    ...dimensions.map(([field]) => (field === "date" ? (/^\d{4}-\d{2}-\d{2}$/.test(text(row.date)) ? row.date : null) : text(row[field]))),
    ...SUMMARY_METRIC_COLUMNS.map(([field]) => number(row[field])),
  ];
}

async function insertRows(client, table, dimensions, rows) {
  if (!rows.length) return;
  const columns = [...dimensions.map(([, column]) => column), ...SUMMARY_METRIC_COLUMNS.map(([, column]) => column)];
  const batchSize = Math.max(1, Math.floor(60000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((row, rowIndex) => {
      values.push(...rowValues(row, dimensions));
      return `(${columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`;
    });
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`, values);
  }
}

function matchesFilters(row, filters = {}, scopes = {}) {
  if (filters.dateFrom && text(row.date) < filters.dateFrom) return false;
  if (filters.dateTo && text(row.date) > filters.dateTo) return false;
  if (filters.country && row.countryKey !== normalizedCountryKey(filters.country)) return false;
  if (filters.warehouseId && text(row.warehouseId) !== filters.warehouseId) return false;
  if (filters.platform && text(row.platform) !== filters.platform) return false;
  if (filters.shopKey && text(row.shopKey) !== filters.shopKey) return false;
  if (filters.projectGroup && text(row.projectGroup) !== filters.projectGroup) return false;
  if (filters.revenueSource && text(row.revenueSource) !== filters.revenueSource) return false;
  if (filters.brand && row.brand !== undefined && text(row.brand) !== filters.brand) return false;
  if (Array.isArray(scopes.warehouseIds) && scopes.warehouseIds.length && !scopes.warehouseIds.includes(text(row.warehouseId))) return false;
  if (Array.isArray(scopes.countries) && scopes.countries.length && !scopes.countries.includes(text(row.country))) return false;
  if (Array.isArray(scopes.skus) && scopes.skus.length && row.sku !== undefined && !scopes.skus.includes(text(row.sku).toUpperCase())) return false;
  return true;
}

function publicGroup(row) {
  const result = { ...row };
  for (const [field] of SUMMARY_METRIC_COLUMNS) {
    result[field] = field.endsWith("Lines") || field === "orderCount" ? Math.round(number(row[field])) : round(row[field], field === "quantity" ? 4 : 2);
  }
  result.revenueCoverageRate = ratio(row.revenueCoveredLines, row.orderLines);
  result.costCoverageRate = ratio(row.costCoveredLines, row.orderLines);
  result.profitCoverageRate = ratio(row.profitCoveredLines, row.orderLines);
  result.profitMargin = ratio(row.estimatedProfitCny, row.profitSalesCny);
  return result;
}

function aggregateInMemory(rows, fields) {
  const groups = new Map();
  for (const row of rows) {
    const key = fields.map((field) => text(row[field])).join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = Object.fromEntries([...fields.map((field) => [field, row[field]]), ...SUMMARY_METRIC_COLUMNS.map(([field]) => [field, 0])]);
      groups.set(key, group);
    }
    for (const [field] of SUMMARY_METRIC_COLUMNS) group[field] += number(row[field]);
  }
  return [...groups.values()];
}

/**
 * @param {object} options
 * @param {string} options.databaseUrl  为空时使用内存
 * @param {string} options.partitionDir 物化分区目录
 * @param {Function} [options.createPool] 测试注入
 */
export function createAnalyticsSummaryStore({ databaseUrl = "", partitionDir = "", createPool = null, logger = console } = {}) {
  const usePostgres = Boolean(text(databaseUrl));
  let pool = null;
  let schemaReady = null;
  const memory = new Map();
  const memoryHashes = new Map();
  let syncing = null;
  let pendingSync = false;
  const state = {
    backend: usePostgres ? "postgres" : "memory",
    lastSyncAt: "",
    lastSyncDurationMs: 0,
    lastSyncedPartitions: 0,
    lastRemovedPartitions: 0,
    lastError: "",
    partitionCount: 0,
  };

  async function getPool() {
    if (!usePostgres) return null;
    if (!pool) {
      if (createPool) pool = await createPool(databaseUrl);
      else {
        const { default: pg } = await import("pg");
        pool = new pg.Pool({ connectionString: databaseUrl, max: 4, idleTimeoutMillis: 30000, application_name: "tongzhou-analytics" });
        pool.on("error", (error) => logger.error?.("[analytics-summary] postgres pool error", error));
      }
    }
    if (!schemaReady) schemaReady = pool.query(DDL).catch((error) => { schemaReady = null; throw error; });
    await schemaReady;
    return pool;
  }

  async function syncOnce() {
    const startedAt = Date.now();
    const index = readPartitionIndex(partitionDir);
    const wanted = new Map(Object.entries(index.partitions || {}).map(([key, value]) => [key, text(value?.hash)]));
    let synced = 0;
    let removed = 0;
    if (usePostgres) {
      const db = await getPool();
      const existing = new Map((await db.query("SELECT partition_key, partition_hash FROM analytics_partitions")).rows.map((row) => [row.partition_key, row.partition_hash]));
      const changed = [...wanted.entries()].filter(([key, hash]) => existing.get(key) !== hash);
      const stale = [...existing.keys()].filter((key) => !wanted.has(key));
      for (const [key, hash] of changed) {
        const summary = readPartitionSummaryRows(partitionDir, key, hash);
        if (!summary) continue;
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM analytics_shop_daily WHERE partition_key = $1", [key]);
          await client.query("DELETE FROM analytics_sku_daily WHERE partition_key = $1", [key]);
          await insertRows(client, "analytics_shop_daily", SHOP_DIMENSIONS, summary.shopDay.map((row) => ({ ...row, partitionKey: key })));
          await insertRows(client, "analytics_sku_daily", SKU_DIMENSIONS, summary.skuDay.map((row) => ({ ...row, partitionKey: key })));
          await client.query(
            `INSERT INTO analytics_partitions (partition_key, partition_hash, shop_rows, sku_rows, synced_at) VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (partition_key) DO UPDATE SET partition_hash = EXCLUDED.partition_hash, shop_rows = EXCLUDED.shop_rows, sku_rows = EXCLUDED.sku_rows, synced_at = now()`,
            [key, hash, summary.shopDay.length, summary.skuDay.length],
          );
          await client.query("COMMIT");
          synced += 1;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
      if (stale.length) {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          await client.query("DELETE FROM analytics_shop_daily WHERE partition_key = ANY($1)", [stale]);
          await client.query("DELETE FROM analytics_sku_daily WHERE partition_key = ANY($1)", [stale]);
          await client.query("DELETE FROM analytics_partitions WHERE partition_key = ANY($1)", [stale]);
          await client.query("COMMIT");
          removed = stale.length;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
    } else {
      for (const [key, hash] of wanted) {
        if (memoryHashes.get(key) === hash) continue;
        const summary = readPartitionSummaryRows(partitionDir, key, hash);
        if (!summary) continue;
        memory.set(key, summary);
        memoryHashes.set(key, hash);
        synced += 1;
      }
      for (const key of [...memory.keys()]) {
        if (wanted.has(key)) continue;
        memory.delete(key);
        memoryHashes.delete(key);
        removed += 1;
      }
    }
    Object.assign(state, {
      lastSyncAt: new Date().toISOString(),
      lastSyncDurationMs: Date.now() - startedAt,
      lastSyncedPartitions: synced,
      lastRemovedPartitions: removed,
      lastError: "",
      partitionCount: wanted.size,
    });
    return { synced, removed };
  }

  // 单飞：同步中又有新的物化结果时，排队再同步一次。
  function sync() {
    if (syncing) {
      pendingSync = true;
      return syncing;
    }
    syncing = syncOnce()
      .catch((error) => {
        state.lastError = error instanceof Error ? error.message : String(error);
        logger.error?.("[analytics-summary] sync failed", error);
        return { synced: 0, removed: 0, error: state.lastError };
      })
      .finally(() => {
        syncing = null;
        if (pendingSync) {
          pendingSync = false;
          void sync();
        }
      });
    return syncing;
  }

  async function query({ groupBy = "total", filters = {}, scopes = {}, limit = 500 } = {}) {
    const group = SUMMARY_GROUPS[groupBy] || SUMMARY_GROUPS.total;
    // 有品牌筛选或 SKU 数据范围时，只能用 SKU 级汇总（订单数为 SKU 维度去重，跨 SKU 求和会偏大）。
    const table = group.table === "sku" || filters.brand || (Array.isArray(scopes.skus) && scopes.skus.length) ? "sku" : "shop";
    const fields = group.fields;
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 500));
    if (usePostgres && !state.lastError) {
      try {
        const db = await getPool();
        const dimensionMap = Object.fromEntries((table === "sku" ? SKU_DIMENSIONS : SHOP_DIMENSIONS).map(([field, column]) => [field, column]));
        const where = [];
        const values = [];
        const add = (sql, value) => {
          values.push(value);
          where.push(sql.replace("?", `$${values.length}`));
        };
        if (filters.dateFrom) add("metric_date >= ?", filters.dateFrom);
        if (filters.dateTo) add("metric_date <= ?", filters.dateTo);
        if (filters.country) add("country_key = ?", normalizedCountryKey(filters.country));
        if (filters.warehouseId) add("warehouse_id = ?", filters.warehouseId);
        if (filters.platform) add("platform = ?", filters.platform);
        if (filters.shopKey) add("shop_key = ?", filters.shopKey);
        if (filters.projectGroup) add("project_group = ?", filters.projectGroup);
        if (filters.revenueSource) add("revenue_source = ?", filters.revenueSource);
        if (filters.brand && table === "sku") add("brand = ?", filters.brand);
        if (Array.isArray(scopes.warehouseIds) && scopes.warehouseIds.length) add("warehouse_id = ANY(?)", scopes.warehouseIds);
        if (Array.isArray(scopes.countries) && scopes.countries.length) add("country = ANY(?)", scopes.countries);
        if (Array.isArray(scopes.skus) && scopes.skus.length && table === "sku") add("upper(sku) = ANY(?)", scopes.skus);
        const selectDimensions = fields.map((field) => (field === "date" ? `to_char(metric_date, 'YYYY-MM-DD') AS "date"` : `${dimensionMap[field]} AS "${field}"`));
        const selectMetrics = SUMMARY_METRIC_COLUMNS.map(([field, column]) => `COALESCE(SUM(${column}), 0)::float8 AS "${field}"`);
        const groupClause = fields.length ? `GROUP BY ${fields.map((field) => (field === "date" ? "metric_date" : dimensionMap[field])).join(", ")}` : "";
        const orderClause = fields.includes("date") ? `ORDER BY ${fields[0] === "date" ? "metric_date" : `"${fields[0]}"`}` : fields.length ? `ORDER BY "salesCny" DESC` : "";
        const sql = `SELECT ${[...selectDimensions, ...selectMetrics].join(", ")} FROM analytics_${table}_daily ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${groupClause} ${orderClause} LIMIT ${safeLimit}`;
        const result = await db.query(sql, values);
        return { backend: "postgres", table, rows: result.rows.map(publicGroup) };
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        logger.error?.("[analytics-summary] query failed, falling back to partition files", error);
      }
    }
    // 内存模式；Postgres 异常时临时从分区文件读取。
    if (usePostgres && !memory.size) {
      const index = readPartitionIndex(partitionDir);
      for (const [key, meta] of Object.entries(index.partitions || {})) {
        const summary = readPartitionSummaryRows(partitionDir, key, meta?.hash);
        if (summary) memory.set(key, summary);
      }
    }
    const source = [...memory.values()].flatMap((summary) => (table === "sku" ? summary.skuDay : summary.shopDay));
    const filtered = source.filter((row) => matchesFilters(row, filters, scopes));
    let rows = aggregateInMemory(filtered, fields);
    if (fields.includes("date")) rows.sort((left, right) => text(left.date).localeCompare(text(right.date)));
    else if (fields.length) rows.sort((left, right) => number(right.salesCny) - number(left.salesCny));
    rows = rows.slice(0, safeLimit);
    return { backend: usePostgres ? "partition-files" : "memory", table, rows: rows.map(publicGroup) };
  }

  async function close() {
    if (pool) await pool.end().catch(() => {});
    pool = null;
    schemaReady = null;
  }

  return {
    sync,
    query,
    close,
    status: () => ({ ...state, configured: usePostgres }),
  };
}

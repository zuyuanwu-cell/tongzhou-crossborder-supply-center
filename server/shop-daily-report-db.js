import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";
import { METRIC_FIELDS, normalizeShopFeeRules } from "./shop-daily-report.js";

function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function first(db, sql, params = []) {
  return all(db, sql, params)[0] || null;
}

function text(value) {
  return String(value ?? "").trim();
}

function nullable(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const COLUMN_BY_FIELD = Object.freeze({
  payAmount: "pay_amount",
  orderCount: "order_count",
  impressions: "impressions",
  visitors: "visitors",
  addToCart: "add_to_cart",
  reviewAmount: "review_amount",
  reviewReceived: "review_received",
  reviewCount: "review_count",
  adOnsite: "ad_onsite",
  adOffsite: "ad_offsite",
  productCostCny: "product_cost_cny",
  operationFeeCny: "operation_fee_cny",
});

function parseFieldSources(value) {
  try {
    const parsed = JSON.parse(text(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metricFromDb(row) {
  const metric = {
    shopKey: text(row.shop_key),
    date: text(row.metric_date),
    shopName: text(row.shop_name),
    country: text(row.country),
    platform: text(row.platform),
    currency: text(row.currency),
    source: text(row.source),
    fieldSources: parseFieldSources(row.field_sources),
    updatedAt: text(row.updated_at),
    updatedBy: text(row.updated_by),
  };
  for (const field of METRIC_FIELDS) metric[field] = nullable(row[COLUMN_BY_FIELD[field]]);
  return metric;
}

function reviewFromDb(row) {
  return {
    id: text(row.id),
    shopKey: text(row.shop_key),
    shopName: text(row.shop_name),
    date: text(row.order_date),
    orderNo: text(row.order_no),
    amount: nullable(row.amount),
    receivedAmount: nullable(row.received_amount),
    quantity: Number(row.quantity) || 1,
    note: text(row.note),
    createdAt: text(row.created_at),
    createdBy: text(row.created_by),
    updatedAt: text(row.updated_at),
  };
}

export async function initShopDailyReportStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    CREATE TABLE IF NOT EXISTS shop_daily_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_daily_metrics (
      shop_key TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      shop_name TEXT,
      country TEXT,
      platform TEXT,
      currency TEXT,
      pay_amount REAL,
      order_count REAL,
      impressions REAL,
      visitors REAL,
      add_to_cart REAL,
      review_amount REAL,
      review_received REAL,
      review_count REAL,
      ad_onsite REAL,
      ad_offsite REAL,
      product_cost_cny REAL,
      operation_fee_cny REAL,
      source TEXT,
      field_sources TEXT,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (shop_key, metric_date)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_daily_metrics_date ON shop_daily_metrics (metric_date);
    CREATE TABLE IF NOT EXISTS shop_review_orders (
      id TEXT PRIMARY KEY,
      shop_key TEXT NOT NULL,
      shop_name TEXT,
      order_date TEXT NOT NULL,
      order_no TEXT,
      amount REAL,
      received_amount REAL,
      quantity REAL NOT NULL DEFAULT 1,
      note TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_review_orders_date ON shop_review_orders (order_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_review_orders_no ON shop_review_orders (shop_key, order_no) WHERE order_no IS NOT NULL AND order_no <> '';
    CREATE TABLE IF NOT EXISTS shop_daily_import_log (
      id TEXT PRIMARY KEY,
      source TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      date_from TEXT,
      date_to TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT
    );
  `);
  const metricColumns = new Set(all(db, "PRAGMA table_info(shop_daily_metrics)").map((row) => text(row.name)));
  if (!metricColumns.has("field_sources")) db.run("ALTER TABLE shop_daily_metrics ADD COLUMN field_sources TEXT");
  db.run("PRAGMA user_version = 2");

  function persist() {
    const temporaryPath = `${dbPath}.tmp`;
    writeFileSync(temporaryPath, Buffer.from(db.export()));
    renameSync(temporaryPath, dbPath);
  }

  function getMeta(key) {
    return text(first(db, "SELECT value FROM shop_daily_meta WHERE key = ?", [key])?.value);
  }

  function setMeta(key, value) {
    db.run("INSERT OR REPLACE INTO shop_daily_meta (key, value) VALUES (?, ?)", [key, text(value)]);
  }

  function getFeeRules() {
    const raw = getMeta("feeRules");
    if (!raw) return normalizeShopFeeRules();
    try {
      return normalizeShopFeeRules(JSON.parse(raw));
    } catch {
      return normalizeShopFeeRules();
    }
  }

  function setFeeRules(rules, updatedBy = "") {
    const now = new Date().toISOString();
    const normalized = normalizeShopFeeRules((Array.isArray(rules) ? rules : []).map((rule) => ({ ...rule, updatedAt: now, updatedBy })));
    setMeta("feeRules", JSON.stringify(normalized));
    persist();
    return normalized;
  }

  function listMetrics({ dateFrom = "", dateTo = "" } = {}) {
    return all(
      db,
      "SELECT * FROM shop_daily_metrics WHERE (? = '' OR metric_date >= ?) AND (? = '' OR metric_date <= ?) ORDER BY metric_date DESC, shop_key",
      [dateFrom, dateFrom, dateTo, dateTo],
    ).map(metricFromDb);
  }

  /**
   * 合并写入：只覆盖本次提供的字段，未提供的字段保留原值。
   * 这样流量（紫鸟）和推广费（人工）可以分别写入同一店铺同一天。
   */
  function upsertMetrics(rows = [], { source = "import", updatedBy = "" } = {}) {
    const now = new Date().toISOString();
    let written = 0;
    let dateFrom = "";
    let dateTo = "";
    db.run("BEGIN");
    try {
      for (const row of Array.isArray(rows) ? rows : []) {
        const shopKey = text(row.shopKey);
        const date = text(row.date);
        if (!shopKey || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const existing = first(db, "SELECT * FROM shop_daily_metrics WHERE shop_key = ? AND metric_date = ?", [shopKey, date]);
        const next = existing ? metricFromDb(existing) : { shopKey, date, fieldSources: {} };
        // 记录每个字段最后由谁写入：同一行的流量可能来自紫鸟，推广费来自人工导入。
        const fieldSources = { ...(next.fieldSources || {}) };
        for (const field of METRIC_FIELDS) {
          const value = nullable(row.values?.[field]);
          if (value !== null) {
            next[field] = value;
            fieldSources[field] = source;
          }
        }
        db.run(
          `INSERT OR REPLACE INTO shop_daily_metrics (
            shop_key, metric_date, shop_name, country, platform, currency,
            pay_amount, order_count, impressions, visitors, add_to_cart,
            review_amount, review_received, review_count, ad_onsite, ad_offsite,
            product_cost_cny, operation_fee_cny, source, field_sources, updated_at, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shopKey,
            date,
            text(row.shopName) || text(next.shopName),
            text(row.country) || text(next.country),
            text(row.platform) || text(next.platform),
            text(row.currency).toUpperCase() || text(next.currency),
            ...METRIC_FIELDS.map((field) => nullable(next[field])),
            source,
            JSON.stringify(fieldSources),
            now,
            updatedBy,
          ],
        );
        written += 1;
        if (!dateFrom || date < dateFrom) dateFrom = date;
        if (!dateTo || date > dateTo) dateTo = date;
      }
      if (written) {
        db.run(
          "INSERT INTO shop_daily_import_log (id, source, row_count, date_from, date_to, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [randomUUID(), source, written, dateFrom, dateTo, now, updatedBy],
        );
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    if (written) persist();
    return { written, dateFrom, dateTo };
  }

  function deleteMetric(shopKey, date) {
    db.run("DELETE FROM shop_daily_metrics WHERE shop_key = ? AND metric_date = ?", [text(shopKey), text(date)]);
    const changed = db.getRowsModified();
    if (changed) persist();
    return changed;
  }

  function listImportLog(limit = 20) {
    return all(db, "SELECT * FROM shop_daily_import_log ORDER BY created_at DESC LIMIT ?", [Math.max(1, Math.min(200, Number(limit) || 20))])
      .map((row) => ({
        id: text(row.id),
        source: text(row.source),
        rowCount: Number(row.row_count) || 0,
        dateFrom: text(row.date_from),
        dateTo: text(row.date_to),
        createdAt: text(row.created_at),
        createdBy: text(row.created_by),
      }));
  }

  function listReviewOrders({ dateFrom = "", dateTo = "" } = {}) {
    return all(
      db,
      "SELECT * FROM shop_review_orders WHERE (? = '' OR order_date >= ?) AND (? = '' OR order_date <= ?) ORDER BY order_date DESC, created_at DESC",
      [dateFrom, dateFrom, dateTo, dateTo],
    ).map(reviewFromDb);
  }

  function saveReviewOrders(rows = [], createdBy = "") {
    const now = new Date().toISOString();
    const saved = [];
    db.run("BEGIN");
    try {
      for (const row of Array.isArray(rows) ? rows : []) {
        const shopKey = text(row.shopKey);
        const date = text(row.date);
        if (!shopKey || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const orderNo = text(row.orderNo);
        const existing = text(row.id)
          ? first(db, "SELECT * FROM shop_review_orders WHERE id = ?", [text(row.id)])
          : orderNo ? first(db, "SELECT * FROM shop_review_orders WHERE shop_key = ? AND order_no = ?", [shopKey, orderNo]) : null;
        const id = text(existing?.id) || randomUUID();
        db.run(
          `INSERT OR REPLACE INTO shop_review_orders (
            id, shop_key, shop_name, order_date, order_no, amount, received_amount, quantity, note, created_at, created_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            shopKey,
            text(row.shopName),
            date,
            orderNo || null,
            nullable(row.amount),
            nullable(row.receivedAmount),
            Math.max(1, Number(row.quantity) || 1),
            text(row.note),
            text(existing?.created_at) || now,
            text(existing?.created_by) || createdBy,
            now,
          ],
        );
        saved.push(id);
      }
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    if (saved.length) persist();
    return saved.map((id) => reviewFromDb(first(db, "SELECT * FROM shop_review_orders WHERE id = ?", [id])));
  }

  function deleteReviewOrder(id) {
    db.run("DELETE FROM shop_review_orders WHERE id = ?", [text(id)]);
    const changed = db.getRowsModified();
    if (changed) persist();
    return changed;
  }

  function metadata() {
    return {
      metricCount: Number(first(db, "SELECT COUNT(*) AS count FROM shop_daily_metrics")?.count) || 0,
      reviewOrderCount: Number(first(db, "SELECT COUNT(*) AS count FROM shop_review_orders")?.count) || 0,
      latestMetricDate: text(first(db, "SELECT MAX(metric_date) AS value FROM shop_daily_metrics")?.value),
      lastImport: listImportLog(1)[0] || null,
    };
  }

  return {
    getFeeRules,
    setFeeRules,
    listMetrics,
    upsertMetrics,
    deleteMetric,
    listImportLog,
    listReviewOrders,
    saveReviewOrders,
    deleteReviewOrder,
    metadata,
    close: () => db.close(),
  };
}

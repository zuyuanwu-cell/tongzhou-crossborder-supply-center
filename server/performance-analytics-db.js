import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

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

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function legacyCorrectedOrders(orders = []) {
  const rows = (Array.isArray(orders) ? orders : []).map((order) => ({ ...order }));
  const yunGroups = new Map();
  for (const row of rows) {
    if (text(row.providerId) !== "yunwms_ru" || text(row.salesAmountScope)) continue;
    const groupKey = [row.providerId, row.warehouseId, row.orderId || row.orderNo].map(text).join("|");
    if (!groupKey.replaceAll("|", "")) continue;
    const group = yunGroups.get(groupKey) || [];
    group.push(row);
    yunGroups.set(groupKey, group);
  }
  for (const group of yunGroups.values()) {
    if (group.length <= 1) continue;
    const amounts = group.map((row) => number(row.salesAmount));
    const duplicatedOrderTotal = amounts.every((value) => Math.abs(value - amounts[0]) < 0.000001);
    if (!duplicatedOrderTotal || amounts[0] <= 0) continue;
    const quantityTotal = group.reduce((sum, row) => sum + Math.max(0, number(row.quantity)), 0);
    let allocated = 0;
    group.forEach((row, index) => {
      const next = index === group.length - 1
        ? round(amounts[0] - allocated)
        : round(amounts[0] * (quantityTotal > 0 ? Math.max(0, number(row.quantity)) / quantityTotal : 1 / group.length));
      row.salesAmount = next;
      row.salesAmountScope = "legacy_order_allocated";
      allocated = round(allocated + next);
    });
  }
  return rows;
}

function factIdFor(order, occurrence) {
  const identity = [
    text(order.providerId || order.rawProvider || "wms"),
    text(order.warehouseId),
    text(order.orderId || order.orderNo),
    text(order.lineId || order.goodsSkuId || order.sku),
    occurrence,
  ].join("|");
  return createHash("sha1").update(identity).digest("hex");
}

function factFromDb(row) {
  return {
    id: text(row.id),
    sourceSystem: text(row.source_system),
    sourceOrderId: text(row.source_order_id),
    sourceLineId: text(row.source_line_id),
    orderNo: text(row.order_no),
    orderDate: text(row.order_date),
    shippedAt: text(row.shipped_at),
    createdAt: text(row.created_at),
    warehouseId: text(row.warehouse_id),
    warehouseName: text(row.warehouse_name),
    country: text(row.country),
    status: text(row.status),
    platform: text(row.platform),
    shopName: text(row.shop_name),
    shopCode: text(row.shop_code),
    projectGroup: text(row.project_group),
    sku: text(row.sku),
    productName: text(row.product_name),
    quantity: number(row.quantity),
    salesAmount: number(row.sales_amount),
    currency: text(row.currency).toUpperCase(),
    salesAmountScope: text(row.sales_amount_scope),
  };
}

export async function initPerformanceAnalyticsStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS performance_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS performance_sales_facts (
      id TEXT PRIMARY KEY,
      source_system TEXT NOT NULL,
      source_order_id TEXT,
      source_line_id TEXT,
      order_no TEXT,
      order_date TEXT,
      shipped_at TEXT,
      created_at TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      country TEXT,
      status TEXT,
      platform TEXT,
      shop_name TEXT,
      shop_code TEXT,
      project_group TEXT,
      sku TEXT,
      product_name TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      sales_amount REAL NOT NULL DEFAULT 0,
      currency TEXT,
      sales_amount_scope TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_performance_fact_date ON performance_sales_facts (order_date);
    CREATE INDEX IF NOT EXISTS idx_performance_fact_sku ON performance_sales_facts (sku);
    CREATE INDEX IF NOT EXISTS idx_performance_fact_scope ON performance_sales_facts (country, warehouse_id, platform, shop_name);
    CREATE TABLE IF NOT EXISTS performance_exchange_rates (
      currency TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      rate_to_cny REAL NOT NULL,
      source TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (currency, effective_date)
    );
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function setMeta(key, value) {
    db.run("INSERT OR REPLACE INTO performance_meta (key, value) VALUES (?, ?)", [key, text(value)]);
  }

  function getMeta(key) {
    return text(first(db, "SELECT value FROM performance_meta WHERE key = ?", [key])?.value);
  }

  function getMetadata() {
    return {
      sourceSyncedAt: getMeta("sourceSyncedAt"),
      rebuiltAt: getMeta("rebuiltAt"),
      rowCount: number(first(db, "SELECT COUNT(*) AS count FROM performance_sales_facts")?.count),
      dbPath,
    };
  }

  function replaceSalesFacts(orders = [], sourceSyncedAt = "", { force = false } = {}) {
    const input = Array.isArray(orders) ? orders : [];
    const metadata = getMetadata();
    if (!force && metadata.sourceSyncedAt === text(sourceSyncedAt) && metadata.rowCount === input.length) return metadata;
    const corrected = legacyCorrectedOrders(input);
    const occurrenceByIdentity = new Map();
    const now = new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      db.run("DELETE FROM performance_sales_facts");
      const stmt = db.prepare(`
        INSERT INTO performance_sales_facts (
          id, source_system, source_order_id, source_line_id, order_no, order_date, shipped_at, created_at,
          warehouse_id, warehouse_name, country, status, platform, shop_name, shop_code, project_group,
          sku, product_name, quantity, sales_amount, currency, sales_amount_scope, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      try {
        for (const order of corrected) {
          const sourceSystem = text(order.providerId || order.rawProvider || "wms");
          const sourceOrderId = text(order.orderId || order.orderNo);
          const sourceLineId = text(order.lineId || order.goodsSkuId || order.sku);
          const occurrenceKey = [sourceSystem, order.warehouseId, sourceOrderId, sourceLineId].map(text).join("|");
          const occurrence = occurrenceByIdentity.get(occurrenceKey) || 0;
          occurrenceByIdentity.set(occurrenceKey, occurrence + 1);
          stmt.run([
            factIdFor(order, occurrence),
            sourceSystem,
            sourceOrderId,
            sourceLineId,
            text(order.orderNo),
            dateKey(order.shippedAt || order.createdAt),
            text(order.shippedAt),
            text(order.createdAt),
            text(order.warehouseId),
            text(order.warehouseName),
            text(order.country),
            text(order.status),
            text(order.platform),
            text(order.shopName),
            text(order.shopCode),
            text(order.projectGroup),
            text(order.sku),
            text(order.productName),
            number(order.quantity),
            number(order.salesAmount),
            text(order.currency).toUpperCase(),
            text(order.salesAmountScope),
            now,
          ]);
        }
      } finally {
        stmt.free();
      }
      setMeta("sourceSyncedAt", sourceSyncedAt);
      setMeta("rebuiltAt", now);
      db.run("COMMIT");
      persist();
      return getMetadata();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function listSalesFacts(filters = {}) {
    const clauses = [];
    const params = [];
    const equalFilters = [
      ["country", filters.country],
      ["warehouse_id", filters.warehouseId],
      ["platform", filters.platform],
      ["shop_name", filters.shopName],
      ["project_group", filters.projectGroup],
    ];
    if (filters.dateFrom) {
      clauses.push("order_date >= ?");
      params.push(dateKey(filters.dateFrom));
    }
    if (filters.dateTo) {
      clauses.push("order_date <= ?");
      params.push(dateKey(filters.dateTo));
    }
    for (const [column, value] of equalFilters) {
      if (!text(value)) continue;
      clauses.push(`${column} = ?`);
      params.push(text(value));
    }
    if (text(filters.keyword)) {
      const keyword = `%${text(filters.keyword).toLowerCase()}%`;
      clauses.push("(LOWER(order_no) LIKE ? OR LOWER(source_order_id) LIKE ? OR LOWER(sku) LIKE ? OR LOWER(product_name) LIKE ? OR LOWER(shop_name) LIKE ?)");
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return all(db, `SELECT * FROM performance_sales_facts ${where} ORDER BY order_date DESC, id ASC`, params).map(factFromDb);
  }

  function upsertExchangeRates(rates = [], source = "manual", { preserveOverrides = false } = {}) {
    const now = new Date().toISOString();
    const normalized = (Array.isArray(rates) ? rates : []).map((rate) => ({
      currency: text(rate.currency).toUpperCase(),
      effectiveDate: dateKey(rate.effectiveDate) || now.slice(0, 10),
      rateToCny: number(rate.rateToCny),
      source: text(rate.source || source),
    })).filter((rate) => /^[A-Z]{3}$/.test(rate.currency) && rate.rateToCny > 0);
    if (!normalized.length) return listExchangeRates();
    db.run("BEGIN TRANSACTION");
    try {
      for (const rate of normalized) {
        const existing = preserveOverrides
          ? first(db, "SELECT source FROM performance_exchange_rates WHERE currency = ? AND effective_date = ?", [rate.currency, rate.effectiveDate])
          : null;
        if (existing && /^(manual(?::|$)|environment$)/i.test(text(existing.source))) continue;
        db.run(
          `INSERT OR REPLACE INTO performance_exchange_rates
            (currency, effective_date, rate_to_cny, source, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [rate.currency, rate.effectiveDate, rate.rateToCny, rate.source, now],
        );
      }
      db.run("COMMIT");
      persist();
      return listExchangeRates();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function listExchangeRates() {
    return all(db, "SELECT * FROM performance_exchange_rates ORDER BY currency ASC, effective_date DESC").map((row) => ({
      currency: text(row.currency),
      effectiveDate: text(row.effective_date),
      rateToCny: number(row.rate_to_cny),
      source: text(row.source),
      updatedAt: text(row.updated_at),
    }));
  }

  function listSalesCurrencies() {
    return all(db, "SELECT DISTINCT UPPER(currency) AS currency FROM performance_sales_facts WHERE currency IS NOT NULL AND currency != '' ORDER BY currency ASC")
      .map((row) => text(row.currency).toUpperCase())
      .filter(Boolean);
  }

  function getExchangeRateSyncState() {
    try {
      return JSON.parse(getMeta("exchangeRateSyncState") || "{}");
    } catch {
      return {};
    }
  }

  function setExchangeRateSyncState(state = {}) {
    setMeta("exchangeRateSyncState", JSON.stringify(state));
    persist();
    return getExchangeRateSyncState();
  }

  upsertExchangeRates([
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1, source: "system" },
    { currency: "RMB", effectiveDate: "2000-01-01", rateToCny: 1, source: "system" },
  ], "system");
  persist();

  return {
    dbPath,
    getMetadata,
    getExchangeRateSyncState,
    listExchangeRates,
    listSalesCurrencies,
    listSalesFacts,
    persist,
    replaceSalesFacts,
    setExchangeRateSyncState,
    upsertExchangeRates,
  };
}

export { legacyCorrectedOrders };

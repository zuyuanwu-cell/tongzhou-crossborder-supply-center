import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function jsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

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

function snapshotRowFromDb(row) {
  return {
    sku: row.sku || "",
    countrySku: row.country_sku || "",
    productName: row.product_name || "",
    brand: row.brand || "",
    category: row.category || "",
    country: row.country || "",
    warehouseId: row.warehouse_id || "",
    warehouseName: row.warehouse_name || "",
    availableQty: Number(row.available_qty || 0),
    lockedQty: Number(row.locked_qty || 0),
    inTransitQty: Number(row.in_transit_qty || 0),
    totalQty: Number(row.total_qty || 0),
    sales3: Number(row.sales3 || 0),
    sales7: Number(row.sales7 || 0),
    sales15: Number(row.sales15 || 0),
    sales30: Number(row.sales30 || 0),
    sales60: Number(row.sales60 || 0),
    sales90: Number(row.sales90 || 0),
    avgDaily3: Number(row.avg_daily3 || 0),
    avgDaily7: Number(row.avg_daily7 || 0),
    avgDaily30: Number(row.avg_daily30 || 0),
    avgDaily90: Number(row.avg_daily90 || 0),
    dailyWeighted: Number(row.daily_weighted || 0),
    daysCover: row.days_cover === null || row.days_cover === undefined ? null : Number(row.days_cover),
    leadDays: Number(row.lead_days || 0),
    targetCoverDays: Number(row.target_cover_days || 0),
    replenishQty: Number(row.replenish_qty || 0),
    status: row.status || "",
    suggestion: row.suggestion || "",
    source: row.source || "",
    dataGap: row.data_gap || "",
  };
}

function buildWhere({ date = "", from = "", to = "", timezone = "" } = {}) {
  const clauses = [];
  const params = [];
  if (timezone) {
    clauses.push("timezone = ?");
    params.push(timezone);
  }
  if (date) {
    clauses.push("date = ?");
    params.push(date);
  } else {
    if (from) {
      clauses.push("date >= ?");
      params.push(from);
    }
    if (to) {
      clauses.push("date <= ?");
      params.push(to);
    }
  }
  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export async function initMovementHistoryStore(dbPath, legacyPayload = {}) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();

  db.run(`
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS movement_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS movement_snapshots (
      date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      order_synced_at TEXT,
      inventory_synced_at TEXT,
      reason TEXT,
      totals_json TEXT NOT NULL,
      PRIMARY KEY (date, timezone)
    );
    CREATE TABLE IF NOT EXISTS movement_snapshot_rows (
      date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      sku TEXT,
      country_sku TEXT,
      product_name TEXT,
      brand TEXT,
      category TEXT,
      country TEXT,
      warehouse_id TEXT,
      warehouse_name TEXT,
      available_qty REAL,
      locked_qty REAL,
      in_transit_qty REAL,
      total_qty REAL,
      sales3 REAL,
      sales7 REAL,
      sales15 REAL,
      sales30 REAL,
      sales60 REAL,
      sales90 REAL,
      avg_daily3 REAL,
      avg_daily7 REAL,
      avg_daily30 REAL,
      avg_daily90 REAL,
      daily_weighted REAL,
      days_cover REAL,
      lead_days REAL,
      target_cover_days REAL,
      replenish_qty REAL,
      status TEXT,
      suggestion TEXT,
      source TEXT,
      data_gap TEXT,
      PRIMARY KEY (date, timezone, row_index)
    );
    CREATE INDEX IF NOT EXISTS idx_movement_rows_sku ON movement_snapshot_rows (sku);
    CREATE INDEX IF NOT EXISTS idx_movement_rows_warehouse ON movement_snapshot_rows (warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_movement_rows_date_tz ON movement_snapshot_rows (date, timezone);
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function setMeta(key, value) {
    db.run("INSERT OR REPLACE INTO movement_meta (key, value) VALUES (?, ?)", [key, String(value || "")]);
  }

  function getMeta(key) {
    return first(db, "SELECT value FROM movement_meta WHERE key = ?", [key])?.value || "";
  }

  function getMetadata() {
    return {
      updatedAt: getMeta("updatedAt"),
      lastSnapshotAt: getMeta("lastSnapshotAt"),
      dbPath,
    };
  }

  function hasSnapshots() {
    return Number(first(db, "SELECT COUNT(*) AS count FROM movement_snapshots")?.count || 0) > 0;
  }

  function upsertSnapshot(snapshot, { persist: shouldPersist = true } = {}) {
    const date = String(snapshot?.date || "").trim();
    const timezone = String(snapshot?.timezone || "").trim();
    if (!date || !timezone) throw new Error("Movement snapshot requires date and timezone.");
    const capturedAt = snapshot.capturedAt || new Date().toISOString();
    const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    db.run("BEGIN TRANSACTION");
    try {
      db.run(
        `INSERT OR REPLACE INTO movement_snapshots
          (date, timezone, captured_at, order_synced_at, inventory_synced_at, reason, totals_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          date,
          timezone,
          capturedAt,
          snapshot.orderSyncedAt || "",
          snapshot.inventorySyncedAt || "",
          snapshot.reason || "",
          JSON.stringify(snapshot.totals || {}),
        ],
      );
      db.run("DELETE FROM movement_snapshot_rows WHERE date = ? AND timezone = ?", [date, timezone]);
      const stmt = db.prepare(`
        INSERT INTO movement_snapshot_rows (
          date, timezone, row_index, sku, country_sku, product_name, brand, category, country,
          warehouse_id, warehouse_name, available_qty, locked_qty, in_transit_qty, total_qty,
          sales3, sales7, sales15, sales30, sales60, sales90,
          avg_daily3, avg_daily7, avg_daily30, avg_daily90, daily_weighted,
          days_cover, lead_days, target_cover_days, replenish_qty, status, suggestion, source, data_gap
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);
      try {
        rows.forEach((row, index) => {
          stmt.run([
            date,
            timezone,
            index,
            row.sku || "",
            row.countrySku || "",
            row.productName || "",
            row.brand || "",
            row.category || "",
            row.country || "",
            row.warehouseId || "",
            row.warehouseName || "",
            Number(row.availableQty || 0),
            Number(row.lockedQty || 0),
            Number(row.inTransitQty || 0),
            Number(row.totalQty || 0),
            Number(row.sales3 || 0),
            Number(row.sales7 || 0),
            Number(row.sales15 || 0),
            Number(row.sales30 || 0),
            Number(row.sales60 || 0),
            Number(row.sales90 || 0),
            Number(row.avgDaily3 || 0),
            Number(row.avgDaily7 || 0),
            Number(row.avgDaily30 || 0),
            Number(row.avgDaily90 || 0),
            Number(row.dailyWeighted || 0),
            valueOrNull(row.daysCover),
            Number(row.leadDays || 0),
            Number(row.targetCoverDays || 0),
            Number(row.replenishQty || 0),
            row.status || "",
            row.suggestion || "",
            row.source || "",
            row.dataGap || "",
          ]);
        });
      } finally {
        stmt.free();
      }
      const now = new Date().toISOString();
      setMeta("updatedAt", now);
      setMeta("lastSnapshotAt", capturedAt);
      db.run("COMMIT");
      if (shouldPersist) persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function snapshotRows(date, timezone) {
    return all(
      db,
      "SELECT * FROM movement_snapshot_rows WHERE date = ? AND timezone = ? ORDER BY row_index ASC",
      [date, timezone],
    ).map(snapshotRowFromDb);
  }

  function snapshotFromDb(row, includeRows = true) {
    const snapshot = {
      date: row.date || "",
      timezone: row.timezone || "",
      capturedAt: row.captured_at || "",
      orderSyncedAt: row.order_synced_at || "",
      inventorySyncedAt: row.inventory_synced_at || "",
      reason: row.reason || "",
      totals: jsonParse(row.totals_json, {}),
      rows: [],
    };
    if (includeRows) snapshot.rows = snapshotRows(snapshot.date, snapshot.timezone);
    return snapshot;
  }

  function getSnapshots(params = {}, { includeRows = true } = {}) {
    const { where, params: whereParams } = buildWhere(params);
    return all(
      db,
      `SELECT * FROM movement_snapshots ${where} ORDER BY date DESC, timezone ASC`,
      whereParams,
    ).map((row) => snapshotFromDb(row, includeRows));
  }

  function listDates(timezone = "") {
    const params = timezone ? [timezone] : [];
    const where = timezone ? "WHERE timezone = ?" : "";
    return all(
      db,
      `SELECT date, timezone, captured_at, totals_json FROM movement_snapshots ${where} ORDER BY date DESC, timezone ASC`,
      params,
    ).map((row) => {
      const totals = jsonParse(row.totals_json, {});
      return {
        date: row.date || "",
        timezone: row.timezone || "",
        capturedAt: row.captured_at || "",
        rowCount: totals.rowCount || 0,
        warehouseCount: totals.warehouseCount || 0,
        skuCount: totals.skuCount || 0,
        sales30: totals.sales30 || 0,
        sales90: totals.sales90 || 0,
      };
    });
  }

  if (!hasSnapshots() && Array.isArray(legacyPayload.snapshots) && legacyPayload.snapshots.length) {
    for (const snapshot of legacyPayload.snapshots) upsertSnapshot(snapshot, { persist: false });
    persist();
  } else {
    persist();
  }

  return {
    dbPath,
    getMetadata,
    getSnapshots,
    hasSnapshots,
    listDates,
    persist,
    upsertSnapshot,
  };
}

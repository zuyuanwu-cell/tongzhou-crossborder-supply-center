import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function rows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const output = [];
    while (statement.step()) output.push(statement.getAsObject());
    return output;
  } finally {
    statement.free();
  }
}

export async function initDomesticInventoryStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS domestic_warehouses (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '中国',
      province TEXT,
      city TEXT,
      address TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_warehouses_status ON domestic_warehouses(status, updated_at);

    CREATE TABLE IF NOT EXISTS domestic_inventory_balances (
      warehouse_id TEXT NOT NULL,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      image_url TEXT,
      specification TEXT,
      unit TEXT NOT NULL,
      on_hand_qty REAL NOT NULL DEFAULT 0,
      reserved_qty REAL NOT NULL DEFAULT 0,
      safety_stock_qty REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (warehouse_id, sku),
      FOREIGN KEY(warehouse_id) REFERENCES domestic_warehouses(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_balances_sku ON domestic_inventory_balances(sku, updated_at);

    CREATE TABLE IF NOT EXISTS domestic_inventory_movements (
      id TEXT PRIMARY KEY,
      movement_no TEXT NOT NULL UNIQUE,
      warehouse_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      reference_no TEXT,
      occurred_at TEXT NOT NULL,
      note TEXT,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(warehouse_id) REFERENCES domestic_warehouses(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_movements_warehouse ON domestic_inventory_movements(warehouse_id, occurred_at);

    CREATE TABLE IF NOT EXISTS domestic_inventory_movement_lines (
      id TEXT PRIMARY KEY,
      movement_id TEXT NOT NULL,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      image_url TEXT,
      specification TEXT,
      unit TEXT NOT NULL,
      quantity REAL NOT NULL,
      signed_qty REAL NOT NULL,
      before_qty REAL NOT NULL,
      after_qty REAL NOT NULL,
      unit_cost_cny REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(movement_id) REFERENCES domestic_inventory_movements(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_movement_lines_sku ON domestic_inventory_movement_lines(sku, movement_id);

    CREATE TABLE IF NOT EXISTS domestic_inventory_idempotency (
      key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (key, user_id)
    );
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  function all(sql, params = []) {
    return rows(db, sql, params);
  }

  function first(sql, params = []) {
    return rows(db, sql, params)[0] || null;
  }

  function transaction(fn) {
    db.run("BEGIN TRANSACTION");
    try {
      const value = fn();
      db.run("COMMIT");
      persist();
      return value;
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  persist();
  return { all, dbPath, first, persist, run, transaction };
}

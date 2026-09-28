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

function lotMovementLineIsUnique(db) {
  return rows(db, "PRAGMA index_list('domestic_inventory_lots')").some((index) => {
    if (!Number(index.unique)) return false;
    const columns = rows(db, `PRAGMA index_info('${String(index.name).replaceAll("'", "''")}')`).map((item) => String(item.name));
    return columns.length === 1 && columns[0] === "movement_line_id";
  });
}

function migrateLotSplittingSchema(db) {
  if (!lotMovementLineIsUnique(db)) return;
  db.run("PRAGMA foreign_keys = OFF");
  db.run("BEGIN TRANSACTION");
  try {
    db.run("ALTER TABLE domestic_inventory_lot_allocations RENAME TO domestic_inventory_lot_allocations_legacy");
    db.run("ALTER TABLE domestic_inventory_lots RENAME TO domestic_inventory_lots_legacy");
    db.run(`
      CREATE TABLE domestic_inventory_lots (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL,
        movement_line_id TEXT NOT NULL,
        product_id TEXT,
        sku TEXT NOT NULL,
        product_name TEXT NOT NULL,
        lot_no TEXT,
        barcode TEXT,
        production_date TEXT,
        expiry_date TEXT,
        packaging_mode TEXT NOT NULL DEFAULT 'piece',
        carton_count REAL NOT NULL DEFAULT 0,
        units_per_carton REAL NOT NULL DEFAULT 0,
        loose_quantity REAL NOT NULL DEFAULT 0,
        carton_length_cm REAL NOT NULL DEFAULT 0,
        carton_width_cm REAL NOT NULL DEFAULT 0,
        carton_height_cm REAL NOT NULL DEFAULT 0,
        carton_weight_kg REAL NOT NULL DEFAULT 0,
        received_qty REAL NOT NULL,
        remaining_qty REAL NOT NULL,
        unit_cost_cny REAL NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(warehouse_id) REFERENCES domestic_warehouses(id),
        FOREIGN KEY(movement_line_id) REFERENCES domestic_inventory_movement_lines(id)
      );
      INSERT INTO domestic_inventory_lots SELECT * FROM domestic_inventory_lots_legacy;
      CREATE TABLE domestic_inventory_lot_allocations (
        id TEXT PRIMARY KEY,
        movement_line_id TEXT NOT NULL,
        lot_id TEXT,
        quantity REAL NOT NULL,
        allocation_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(movement_line_id) REFERENCES domestic_inventory_movement_lines(id),
        FOREIGN KEY(lot_id) REFERENCES domestic_inventory_lots(id)
      );
      INSERT INTO domestic_inventory_lot_allocations SELECT * FROM domestic_inventory_lot_allocations_legacy;
      DROP TABLE domestic_inventory_lot_allocations_legacy;
      DROP TABLE domestic_inventory_lots_legacy;
      CREATE INDEX idx_domestic_lots_available ON domestic_inventory_lots(warehouse_id, sku, remaining_qty, received_at);
      CREATE INDEX idx_domestic_lots_barcode ON domestic_inventory_lots(barcode, warehouse_id);
      CREATE INDEX idx_domestic_lots_lot_no ON domestic_inventory_lots(lot_no, warehouse_id);
      CREATE INDEX idx_domestic_lots_line ON domestic_inventory_lots(movement_line_id);
      CREATE INDEX idx_domestic_lot_allocations_line ON domestic_inventory_lot_allocations(movement_line_id);
      CREATE INDEX idx_domestic_lot_allocations_lot ON domestic_inventory_lot_allocations(lot_id);
    `);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
  const foreignKeyErrors = rows(db, "PRAGMA foreign_key_check");
  if (foreignKeyErrors.length) throw new Error("国内库存批次拆分结构迁移后外键校验失败。");
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

    CREATE TABLE IF NOT EXISTS domestic_inventory_lots (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      movement_line_id TEXT NOT NULL,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      lot_no TEXT,
      barcode TEXT,
      production_date TEXT,
      expiry_date TEXT,
      packaging_mode TEXT NOT NULL DEFAULT 'piece',
      carton_count REAL NOT NULL DEFAULT 0,
      units_per_carton REAL NOT NULL DEFAULT 0,
      loose_quantity REAL NOT NULL DEFAULT 0,
      carton_length_cm REAL NOT NULL DEFAULT 0,
      carton_width_cm REAL NOT NULL DEFAULT 0,
      carton_height_cm REAL NOT NULL DEFAULT 0,
      carton_weight_kg REAL NOT NULL DEFAULT 0,
      received_qty REAL NOT NULL,
      remaining_qty REAL NOT NULL,
      unit_cost_cny REAL NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(warehouse_id) REFERENCES domestic_warehouses(id),
      FOREIGN KEY(movement_line_id) REFERENCES domestic_inventory_movement_lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_lots_available ON domestic_inventory_lots(warehouse_id, sku, remaining_qty, received_at);
    CREATE INDEX IF NOT EXISTS idx_domestic_lots_barcode ON domestic_inventory_lots(barcode, warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_domestic_lots_lot_no ON domestic_inventory_lots(lot_no, warehouse_id);
    CREATE INDEX IF NOT EXISTS idx_domestic_lots_line ON domestic_inventory_lots(movement_line_id);

    CREATE TABLE IF NOT EXISTS domestic_inventory_lot_allocations (
      id TEXT PRIMARY KEY,
      movement_line_id TEXT NOT NULL,
      lot_id TEXT,
      quantity REAL NOT NULL,
      allocation_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(movement_line_id) REFERENCES domestic_inventory_movement_lines(id),
      FOREIGN KEY(lot_id) REFERENCES domestic_inventory_lots(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_lot_allocations_line ON domestic_inventory_lot_allocations(movement_line_id);
    CREATE INDEX IF NOT EXISTS idx_domestic_lot_allocations_lot ON domestic_inventory_lot_allocations(lot_id);

    CREATE TABLE IF NOT EXISTS domestic_inventory_idempotency (
      key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (key, user_id)
    );

    CREATE TABLE IF NOT EXISTS domestic_inventory_transfers (
      id TEXT PRIMARY KEY,
      transfer_no TEXT NOT NULL UNIQUE,
      source_warehouse_id TEXT NOT NULL,
      target_warehouse_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_transit',
      note TEXT,
      outbound_movement_id TEXT NOT NULL,
      inbound_movement_id TEXT,
      cancel_movement_id TEXT,
      shipped_at TEXT NOT NULL,
      received_at TEXT,
      cancelled_at TEXT,
      created_by_id TEXT NOT NULL,
      created_by_name TEXT NOT NULL,
      received_by_id TEXT,
      received_by_name TEXT,
      cancelled_by_id TEXT,
      cancelled_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(source_warehouse_id) REFERENCES domestic_warehouses(id),
      FOREIGN KEY(target_warehouse_id) REFERENCES domestic_warehouses(id),
      FOREIGN KEY(outbound_movement_id) REFERENCES domestic_inventory_movements(id),
      FOREIGN KEY(inbound_movement_id) REFERENCES domestic_inventory_movements(id),
      FOREIGN KEY(cancel_movement_id) REFERENCES domestic_inventory_movements(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_transfers_source ON domestic_inventory_transfers(source_warehouse_id, status, shipped_at);
    CREATE INDEX IF NOT EXISTS idx_domestic_transfers_target ON domestic_inventory_transfers(target_warehouse_id, status, shipped_at);

    CREATE TABLE IF NOT EXISTS domestic_inventory_transfer_lines (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      source_movement_line_id TEXT NOT NULL,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      image_url TEXT,
      specification TEXT,
      unit TEXT NOT NULL DEFAULT '件',
      quantity REAL NOT NULL,
      unit_cost_cny REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(transfer_id) REFERENCES domestic_inventory_transfers(id),
      FOREIGN KEY(source_movement_line_id) REFERENCES domestic_inventory_movement_lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_domestic_transfer_lines_transfer ON domestic_inventory_transfer_lines(transfer_id, sku);
  `);
  migrateLotSplittingSchema(db);

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

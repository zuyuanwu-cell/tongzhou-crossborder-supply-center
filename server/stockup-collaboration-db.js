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
export async function initStockupCollaborationStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS stockup_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL,
      destination_country TEXT NOT NULL,
      destination_warehouse_id TEXT,
      destination_warehouse_name TEXT NOT NULL,
      expected_arrival_at TEXT NOT NULL,
      priority TEXT NOT NULL,
      reason TEXT NOT NULL,
      platform TEXT,
      note TEXT,
      status TEXT NOT NULL,
      requester_id TEXT NOT NULL,
      requester_name TEXT NOT NULL,
      assignee_id TEXT,
      assignee_name TEXT,
      exception_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_requests_status ON stockup_requests(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_stockup_requests_requester ON stockup_requests(requester_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_stockup_requests_destination ON stockup_requests(destination_warehouse_id, expected_arrival_at);

    CREATE TABLE IF NOT EXISTS stockup_request_lines (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      product_id TEXT,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      image_url TEXT,
      specification TEXT,
      method TEXT NOT NULL,
      requested_qty REAL NOT NULL,
      unit TEXT NOT NULL,
      target_unit_cost_cny REAL,
      expected_arrival_at TEXT,
      note TEXT,
      status TEXT NOT NULL,
      fulfilled_qty REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(request_id) REFERENCES stockup_requests(id)
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_lines_request ON stockup_request_lines(request_id);
    CREATE INDEX IF NOT EXISTS idx_stockup_lines_sku ON stockup_request_lines(sku, status);

    CREATE TABLE IF NOT EXISTS stockup_execution_tasks (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      task_no TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      assignee_id TEXT,
      assignee_name TEXT,
      supplier_name TEXT,
      planned_qty REAL NOT NULL,
      ordered_qty REAL NOT NULL DEFAULT 0,
      completed_qty REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      expected_order_at TEXT,
      expected_completed_at TEXT,
      actual_ordered_at TEXT,
      actual_completed_at TEXT,
      exception_type TEXT,
      exception_note TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(request_id) REFERENCES stockup_requests(id),
      FOREIGN KEY(line_id) REFERENCES stockup_request_lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_tasks_status ON stockup_execution_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_stockup_tasks_request ON stockup_execution_tasks(request_id, line_id);

    CREATE TABLE IF NOT EXISTS stockup_progress_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      line_id TEXT,
      task_id TEXT,
      shipment_id TEXT,
      receipt_id TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      visibility TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_events_request ON stockup_progress_events(request_id, occurred_at);

    CREATE TABLE IF NOT EXISTS stockup_shipments (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      shipment_no TEXT NOT NULL UNIQUE,
      origin_warehouse TEXT,
      destination_warehouse_id TEXT,
      destination_warehouse_name TEXT NOT NULL,
      destination_country TEXT NOT NULL,
      carrier TEXT,
      transport_mode TEXT,
      tracking_no TEXT,
      etd TEXT,
      eta TEXT,
      actual_shipped_at TEXT,
      status TEXT NOT NULL,
      packages REAL NOT NULL DEFAULT 0,
      total_weight_kg REAL NOT NULL DEFAULT 0,
      total_volume_m3 REAL NOT NULL DEFAULT 0,
      chargeable_weight_kg REAL NOT NULL DEFAULT 0,
      note TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_shipments_status ON stockup_shipments(status, eta);
    CREATE TABLE IF NOT EXISTS stockup_shipment_lines (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      shipped_qty REAL NOT NULL,
      unit TEXT NOT NULL,
      base_unit_cost_cny REAL NOT NULL DEFAULT 0,
      weight_kg REAL NOT NULL DEFAULT 0,
      volume_m3 REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stockup_receipts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      shipment_id TEXT NOT NULL,
      receipt_no TEXT NOT NULL UNIQUE,
      warehouse_id TEXT,
      warehouse_name TEXT NOT NULL,
      wms_inbound_no TEXT,
      arrived_at TEXT NOT NULL,
      shelved_at TEXT,
      status TEXT NOT NULL,
      note TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_receipts_arrival ON stockup_receipts(arrived_at, warehouse_id);
    CREATE TABLE IF NOT EXISTS stockup_receipt_lines (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      shipment_line_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      expected_qty REAL NOT NULL,
      received_qty REAL NOT NULL,
      good_qty REAL NOT NULL,
      damaged_qty REAL NOT NULL,
      shortage_qty REAL NOT NULL,
      pending_qty REAL NOT NULL,
      shelved_qty REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      exception_note TEXT
    );

    CREATE TABLE IF NOT EXISTS stockup_cost_items (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      shipment_id TEXT,
      receipt_id TEXT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      stage TEXT NOT NULL,
      vendor TEXT,
      invoice_no TEXT,
      occurred_at TEXT NOT NULL,
      original_amount REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL NOT NULL,
      amount_cny REAL NOT NULL,
      included INTEGER NOT NULL,
      allocation_method TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_cost_items_receipt ON stockup_cost_items(receipt_id, status);
    CREATE TABLE IF NOT EXISTS stockup_cost_allocations (
      id TEXT PRIMARY KEY,
      cost_item_id TEXT NOT NULL,
      receipt_line_id TEXT NOT NULL,
      allocated_amount_cny REAL NOT NULL,
      allocation_basis REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stockup_cost_versions (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      version_type TEXT NOT NULL,
      status TEXT NOT NULL,
      costing_qty REAL NOT NULL,
      goods_cost_cny REAL NOT NULL,
      allocated_cost_cny REAL NOT NULL,
      total_cost_cny REAL NOT NULL,
      unit_cost_cny REAL NOT NULL,
      snapshot_json TEXT NOT NULL,
      note TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      UNIQUE(receipt_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_cost_versions_locked ON stockup_cost_versions(status, locked_at);

    CREATE TABLE IF NOT EXISTS stockup_notifications (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stockup_notifications_recipient ON stockup_notifications(recipient_id, read_at, created_at);
    CREATE TABLE IF NOT EXISTS stockup_idempotency (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function all(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function firstText(...values) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(value) {
  return firstText(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function orderKey(order, index = 0) {
  return [
    firstText(order?.warehouseId, order?.warehouseName),
    firstText(order?.orderId, order?.orderNo, order?.externalOrderNo),
    firstText(order?.lineId, order?.orderItemId, index),
    firstText(order?.sku, order?.countrySku).toUpperCase(),
    firstText(order?.shippedAt, order?.createdAt),
  ].join("::");
}

function orderFromDb(row) {
  try {
    return JSON.parse(row.payload_json || "{}");
  } catch {
    return {};
  }
}

function ledgerFromDb(row) {
  return {
    bizDate: row.biz_date || "",
    timezone: row.timezone || "",
    warehouseId: row.warehouse_id || "",
    warehouseName: row.warehouse_name || "",
    sku: row.sku || "",
    productName: row.product_name || "",
    openingQty: number(row.opening_qty),
    inboundQty: number(row.inbound_qty),
    returnRestockQty: number(row.return_restock_qty),
    transferInQty: number(row.transfer_in_qty),
    transferOutQty: number(row.transfer_out_qty),
    orderOutboundQty: number(row.order_outbound_qty),
    otherOutboundQty: number(row.other_outbound_qty),
    adjustQty: number(row.adjust_qty),
    closingQty: number(row.closing_qty),
    faultyQty: number(row.faulty_qty),
    temporaryQty: number(row.temporary_qty),
    inTransitQty: number(row.in_transit_qty),
    varianceQty: number(row.variance_qty),
    unitCostCny: row.unit_cost_cny === null ? null : number(row.unit_cost_cny),
    inventoryValueCny: number(row.inventory_value_cny),
    costBasis: row.cost_basis || "",
    costEffectiveDate: row.cost_effective_date || "",
    rateEffectiveDate: row.rate_effective_date || "",
    dataFlags: (() => { try { return JSON.parse(row.data_flags_json || "[]"); } catch { return []; } })(),
    updatedAt: row.updated_at || "",
  };
}

export async function initInventoryLedgerStore(dbPath, legacyOrderPayload = {}) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();

  db.run(`
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS inventory_ledger_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS warehouse_orders (
      order_key TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      quantity REAL NOT NULL,
      order_no TEXT,
      line_id TEXT,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_warehouse_orders_range ON warehouse_orders (warehouse_id, sku, ship_date);
    CREATE INDEX IF NOT EXISTS idx_warehouse_orders_date ON warehouse_orders (ship_date, warehouse_id);
    CREATE TABLE IF NOT EXISTS inventory_daily_ledger (
      biz_date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      warehouse_name TEXT,
      sku TEXT NOT NULL,
      product_name TEXT,
      opening_qty REAL NOT NULL DEFAULT 0,
      inbound_qty REAL NOT NULL DEFAULT 0,
      return_restock_qty REAL NOT NULL DEFAULT 0,
      transfer_in_qty REAL NOT NULL DEFAULT 0,
      transfer_out_qty REAL NOT NULL DEFAULT 0,
      order_outbound_qty REAL NOT NULL DEFAULT 0,
      other_outbound_qty REAL NOT NULL DEFAULT 0,
      adjust_qty REAL NOT NULL DEFAULT 0,
      closing_qty REAL NOT NULL DEFAULT 0,
      faulty_qty REAL NOT NULL DEFAULT 0,
      temporary_qty REAL NOT NULL DEFAULT 0,
      in_transit_qty REAL NOT NULL DEFAULT 0,
      variance_qty REAL NOT NULL DEFAULT 0,
      unit_cost_cny REAL,
      inventory_value_cny REAL NOT NULL DEFAULT 0,
      cost_basis TEXT,
      cost_effective_date TEXT,
      rate_effective_date TEXT,
      data_flags_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (biz_date, timezone, warehouse_id, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_daily_ledger_range ON inventory_daily_ledger (biz_date, warehouse_id, sku);
    CREATE INDEX IF NOT EXISTS idx_inventory_daily_ledger_warehouse_date ON inventory_daily_ledger (warehouse_id, biz_date);
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function setMeta(key, value) {
    db.run("INSERT OR REPLACE INTO inventory_ledger_meta (key, value) VALUES (?, ?)", [key, typeof value === "string" ? value : JSON.stringify(value)]);
  }

  function getMeta(key) {
    return all(db, "SELECT value FROM inventory_ledger_meta WHERE key = ?", [key])[0]?.value || "";
  }

  function insertOrderRows(rows, updatedAt = new Date().toISOString()) {
    const statement = db.prepare(`INSERT OR REPLACE INTO warehouse_orders
      (order_key, warehouse_id, sku, ship_date, quantity, order_no, line_id, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    try {
      rows.forEach((order, index) => statement.run([
        orderKey(order, index),
        firstText(order?.warehouseId, order?.warehouseName),
        firstText(order?.sku, order?.countrySku).toUpperCase(),
        dateKey(order?.shippedAt || order?.createdAt),
        number(order?.quantity || order?.shippedQty),
        firstText(order?.orderNo, order?.orderId, order?.externalOrderNo),
        firstText(order?.lineId, order?.orderItemId, index),
        JSON.stringify(order || {}),
        updatedAt,
      ]));
    } finally {
      statement.free();
    }
  }

  function upsertOrders(orders, { persist: shouldPersist = true } = {}) {
    const rows = Array.isArray(orders) ? orders : [];
    const updatedAt = new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      insertOrderRows(rows, updatedAt);
      setMeta("ordersUpdatedAt", updatedAt);
      db.run("COMMIT");
      if (shouldPersist) persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
    return rows.length;
  }

  function replaceAllOrders(orders, metadata = {}, { persist: shouldPersist = true } = {}) {
    const rows = Array.isArray(orders) ? orders : [];
    const updatedAt = new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      db.run("DELETE FROM warehouse_orders");
      insertOrderRows(rows, updatedAt);
      setMeta("ordersUpdatedAt", updatedAt);
      setMeta("orderSyncMetadata", metadata);
      db.run("COMMIT");
      if (shouldPersist) persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function replaceWarehouseOrders(warehouseIds, orders, { persist: shouldPersist = true } = {}) {
    const ids = [...new Set((Array.isArray(warehouseIds) ? warehouseIds : []).map((value) => firstText(value)).filter(Boolean))];
    db.run("BEGIN TRANSACTION");
    try {
      for (const warehouseId of ids) db.run("DELETE FROM warehouse_orders WHERE warehouse_id = ?", [warehouseId]);
      insertOrderRows(Array.isArray(orders) ? orders : []);
      db.run("COMMIT");
      if (shouldPersist) persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function listOrders({ warehouseIds = [], warehouseId = "", sku = "", from = "", to = "", fromExclusive = "" } = {}) {
    const clauses = [];
    const params = [];
    const ids = [...new Set([warehouseId, ...(Array.isArray(warehouseIds) ? warehouseIds : [])].map((value) => firstText(value)).filter(Boolean))];
    if (ids.length) {
      clauses.push(`warehouse_id IN (${ids.map(() => "?").join(", ")})`);
      params.push(...ids);
    }
    if (sku) {
      clauses.push("sku = ?");
      params.push(firstText(sku).toUpperCase());
    }
    if (fromExclusive) {
      clauses.push("ship_date > ?");
      params.push(dateKey(fromExclusive));
    } else if (from) {
      clauses.push("ship_date >= ?");
      params.push(dateKey(from));
    }
    if (to) {
      clauses.push("ship_date <= ?");
      params.push(dateKey(to));
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return all(db, `SELECT payload_json FROM warehouse_orders ${where} ORDER BY ship_date ASC, warehouse_id ASC, order_key ASC`, params).map(orderFromDb);
  }

  function upsertDailyLedger(rows, { persist: shouldPersist = true } = {}) {
    const statement = db.prepare(`INSERT OR REPLACE INTO inventory_daily_ledger (
      biz_date, timezone, warehouse_id, warehouse_name, sku, product_name,
      opening_qty, inbound_qty, return_restock_qty, transfer_in_qty, transfer_out_qty,
      order_outbound_qty, other_outbound_qty, adjust_qty, closing_qty, faulty_qty,
      temporary_qty, in_transit_qty, variance_qty, unit_cost_cny, inventory_value_cny,
      cost_basis, cost_effective_date, rate_effective_date, data_flags_json, updated_at
    ) VALUES (${Array.from({ length: 26 }, () => "?").join(", ")})`);
    const updatedAt = new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      for (const row of Array.isArray(rows) ? rows : []) statement.run([
        row.bizDate, row.timezone || "Asia/Shanghai", row.warehouseId, row.warehouseName || "", firstText(row.sku).toUpperCase(), row.productName || "",
        number(row.openingQty), number(row.inboundQty), number(row.returnRestockQty), number(row.transferInQty), number(row.transferOutQty),
        number(row.orderOutboundQty), number(row.otherOutboundQty), number(row.adjustQty), number(row.closingQty), number(row.faultyQty),
        number(row.temporaryQty), number(row.inTransitQty), number(row.varianceQty), row.unitCostCny === null || row.unitCostCny === undefined ? null : number(row.unitCostCny), number(row.inventoryValueCny),
        row.costBasis || "", row.costEffectiveDate || "", row.rateEffectiveDate || "", JSON.stringify(row.dataFlags || []), updatedAt,
      ]);
      setMeta("ledgerUpdatedAt", updatedAt);
      db.run("COMMIT");
      if (shouldPersist) persist();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    } finally {
      statement.free();
    }
  }

  function listDailyLedger({ from = "", to = "", warehouseId = "", sku = "", timezone = "" } = {}) {
    const clauses = [];
    const params = [];
    for (const [column, value] of [["biz_date >=", from], ["biz_date <=", to], ["warehouse_id =", warehouseId], ["sku =", sku ? firstText(sku).toUpperCase() : ""], ["timezone =", timezone]]) {
      if (!value) continue;
      clauses.push(`${column} ?`);
      params.push(value);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return all(db, `SELECT * FROM inventory_daily_ledger ${where} ORDER BY biz_date ASC, warehouse_id ASC, sku ASC`, params).map(ledgerFromDb);
  }

  function getDailyLedgerCoverage({ warehouseIds = [], skus = [], timezone = "" } = {}) {
    const clauses = [];
    const params = [];
    const scopedWarehouseIds = [...new Set((Array.isArray(warehouseIds) ? warehouseIds : []).map((warehouseId) => firstText(warehouseId)).filter(Boolean))];
    const scopedSkus = [...new Set((Array.isArray(skus) ? skus : []).map((sku) => firstText(sku).toUpperCase()).filter(Boolean))];
    if (timezone) {
      clauses.push("timezone = ?");
      params.push(timezone);
    }
    if (scopedWarehouseIds.length) {
      clauses.push(`warehouse_id IN (${scopedWarehouseIds.map(() => "?").join(", ")})`);
      params.push(...scopedWarehouseIds);
    }
    if (scopedSkus.length) {
      clauses.push(`sku IN (${scopedSkus.map(() => "?").join(", ")})`);
      params.push(...scopedSkus);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = all(db, `SELECT MIN(biz_date) AS from_date, MAX(biz_date) AS to_date, COUNT(*) AS row_count FROM inventory_daily_ledger ${where}`, params)[0] || {};
    return { from: row.from_date || "", to: row.to_date || "", rowCount: number(row.row_count) };
  }

  function aggregateDailyLedger(filters = {}) {
    const rows = listDailyLedger(filters);
    const fields = ["openingQty", "inboundQty", "returnRestockQty", "transferInQty", "transferOutQty", "orderOutboundQty", "otherOutboundQty", "adjustQty", "closingQty", "faultyQty", "temporaryQty", "inTransitQty", "varianceQty", "inventoryValueCny"];
    return fields.reduce((summary, field) => ({ ...summary, [field]: rows.reduce((sum, row) => sum + number(row[field]), 0) }), { rowCount: rows.length });
  }

  function listIndexes() {
    return all(db, "SELECT name, tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC");
  }

  const existingOrderCount = number(all(db, "SELECT COUNT(*) AS count FROM warehouse_orders")[0]?.count);
  if (!existingOrderCount && Array.isArray(legacyOrderPayload?.orders) && legacyOrderPayload.orders.length) {
    upsertOrders(legacyOrderPayload.orders, { persist: false });
    setMeta("orderSyncMetadata", { ...legacyOrderPayload, orders: undefined });
  }
  persist();

  return {
    dbPath,
    aggregateDailyLedger,
    getDailyLedgerCoverage,
    getMeta,
    listDailyLedger,
    listIndexes,
    listOrders,
    persist,
    replaceAllOrders,
    replaceWarehouseOrders,
    upsertDailyLedger,
    upsertOrders,
  };
}

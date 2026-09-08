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
    salesAmountSource: text(row.sales_amount_source),
    salesAmountOrderTotal: number(row.sales_amount_order_total),
    salesAmountAllocationResidual: number(row.sales_amount_allocation_residual),
    salesAmountValid: number(row.sales_amount_valid) === 1,
  };
}

function miaoshouOrderFromDb(row) {
  return {
    identity: text(row.identity),
    opOrderId: text(row.op_order_id),
    platform: text(row.platform),
    shopId: text(row.shop_id),
    platformOrderSn: text(row.platform_order_sn),
    site: text(row.site),
    currency: text(row.currency).toUpperCase(),
    productAmount: number(row.product_amount),
    orderAmount: number(row.order_amount),
    payAmount: number(row.pay_amount),
    estimatedShippingFee: number(row.estimated_shipping_fee),
    actualShippingCost: number(row.actual_shipping_cost),
    commissionFee: number(row.commission_fee),
    escrowAmount: number(row.escrow_amount),
    discountAmount: number(row.discount_amount),
    exchangeRate: number(row.exchange_rate),
    paymentMethod: text(row.payment_method),
    platformOrderStatus: text(row.platform_order_status),
    appOrderStatus: text(row.app_order_status),
    appOrderStatusText: text(row.app_order_status_text),
    orderStartedAt: text(row.order_started_at),
    orderModifiedAt: text(row.order_modified_at),
    paidAt: text(row.paid_at),
    deliveredAt: text(row.delivered_at),
    refundedAt: text(row.refunded_at),
    settledAt: text(row.settled_at),
    finishedAt: text(row.finished_at),
  };
}

function miaoshouItemFromDb(row) {
  return {
    identity: text(row.identity),
    orderIdentity: text(row.order_identity),
    opOrderItemId: text(row.op_order_item_id),
    opOrderPackageItemId: text(row.op_order_package_item_id),
    platformSkuId: text(row.platform_sku_id),
    platformOuterSkuId: text(row.platform_outer_sku_id),
    quantity: number(row.quantity),
    originalPrice: number(row.original_price),
    discountedPrice: number(row.discounted_price),
    gift: number(row.gift) === 1,
  };
}

function miaoshouReturnFromDb(row) {
  return {
    identity: text(row.identity),
    orderIdentity: text(row.order_identity),
    opOrderId: text(row.op_order_id),
    platform: text(row.platform),
    shopId: text(row.shop_id),
    platformOrderSn: text(row.platform_order_sn),
    platformReturnSn: text(row.platform_return_sn),
    currency: text(row.currency).toUpperCase(),
    refundAmount: number(row.refund_amount),
    status: text(row.status),
    platformReturnStatus: text(row.platform_return_status),
    appReturnStatus: text(row.app_return_status),
    appReturnStatusText: text(row.app_return_status_text),
    reverseType: text(row.reverse_type),
    createdAt: text(row.created_at),
    modifiedAt: text(row.modified_at),
    finishedAt: text(row.finished_at),
    finalized: number(row.finalized) === 1,
  };
}

function miaoshouCancellationFromDb(row) {
  return {
    identity: text(row.identity),
    orderIdentity: text(row.order_identity),
    opOrderId: text(row.op_order_id),
    platform: text(row.platform),
    shopId: text(row.shop_id),
    platformOrderSn: text(row.platform_order_sn),
    status: text(row.status),
    appCancelStatus: text(row.app_cancel_status),
    appCancelStatusText: text(row.app_cancel_status_text),
    reason: text(row.reason),
    createdAt: text(row.created_at),
    modifiedAt: text(row.modified_at),
    finalized: number(row.finalized) === 1,
  };
}

export async function initPerformanceAnalyticsStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
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
      sales_amount_source TEXT,
      sales_amount_order_total REAL NOT NULL DEFAULT 0,
      sales_amount_allocation_residual REAL NOT NULL DEFAULT 0,
      sales_amount_valid INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS performance_supplemental_costs (
      sku TEXT NOT NULL,
      country_key TEXT NOT NULL,
      country_name TEXT NOT NULL,
      product_name TEXT,
      unit_cost_cny REAL NOT NULL,
      effective_date TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT,
      PRIMARY KEY (sku, country_key, effective_date)
    );
    CREATE INDEX IF NOT EXISTS idx_performance_supplemental_cost_lookup
      ON performance_supplemental_costs (sku, country_key, enabled, effective_date);
    CREATE TABLE IF NOT EXISTS miaoshou_performance_orders (
      identity TEXT PRIMARY KEY,
      op_order_id TEXT,
      platform TEXT,
      shop_id TEXT,
      platform_order_sn TEXT,
      site TEXT,
      currency TEXT,
      product_amount REAL NOT NULL DEFAULT 0,
      order_amount REAL NOT NULL DEFAULT 0,
      pay_amount REAL NOT NULL DEFAULT 0,
      estimated_shipping_fee REAL NOT NULL DEFAULT 0,
      actual_shipping_cost REAL NOT NULL DEFAULT 0,
      commission_fee REAL NOT NULL DEFAULT 0,
      escrow_amount REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      exchange_rate REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      platform_order_status TEXT,
      app_order_status TEXT,
      app_order_status_text TEXT,
      order_started_at TEXT,
      order_modified_at TEXT,
      paid_at TEXT,
      delivered_at TEXT,
      refunded_at TEXT,
      settled_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_miaoshou_performance_order_no
      ON miaoshou_performance_orders (platform, shop_id, platform_order_sn);
    CREATE INDEX IF NOT EXISTS idx_miaoshou_performance_platform_order_sn
      ON miaoshou_performance_orders (platform_order_sn);
    CREATE INDEX IF NOT EXISTS idx_miaoshou_performance_order_date
      ON miaoshou_performance_orders (order_started_at, order_modified_at);
    CREATE TABLE IF NOT EXISTS miaoshou_performance_items (
      identity TEXT PRIMARY KEY,
      order_identity TEXT NOT NULL,
      op_order_item_id TEXT,
      op_order_package_item_id TEXT,
      platform_sku_id TEXT,
      platform_outer_sku_id TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      original_price REAL NOT NULL DEFAULT 0,
      discounted_price REAL NOT NULL DEFAULT 0,
      gift INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miaoshou_performance_item_order
      ON miaoshou_performance_items (order_identity);
    CREATE TABLE IF NOT EXISTS miaoshou_performance_returns (
      identity TEXT PRIMARY KEY,
      order_identity TEXT NOT NULL,
      op_order_id TEXT,
      platform TEXT,
      shop_id TEXT,
      platform_order_sn TEXT,
      platform_return_sn TEXT,
      currency TEXT,
      refund_amount REAL NOT NULL DEFAULT 0,
      status TEXT,
      platform_return_status TEXT,
      app_return_status TEXT,
      app_return_status_text TEXT,
      reverse_type TEXT,
      created_at TEXT,
      modified_at TEXT,
      finished_at TEXT,
      finalized INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miaoshou_performance_return_order
      ON miaoshou_performance_returns (order_identity);
    CREATE TABLE IF NOT EXISTS miaoshou_performance_cancellations (
      identity TEXT PRIMARY KEY,
      order_identity TEXT NOT NULL,
      op_order_id TEXT,
      platform TEXT,
      shop_id TEXT,
      platform_order_sn TEXT,
      status TEXT,
      app_cancel_status TEXT,
      app_cancel_status_text TEXT,
      reason TEXT,
      created_at TEXT,
      modified_at TEXT,
      finalized INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miaoshou_performance_cancel_order
      ON miaoshou_performance_cancellations (order_identity);
  `);
  const factColumns = new Set(all(db, "PRAGMA table_info(performance_sales_facts)").map((row) => text(row.name)));
  const factMigrations = [
    ["sales_amount_source", "TEXT"],
    ["sales_amount_order_total", "REAL NOT NULL DEFAULT 0"],
    ["sales_amount_allocation_residual", "REAL NOT NULL DEFAULT 0"],
    ["sales_amount_valid", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [column, definition] of factMigrations) {
    if (!factColumns.has(column)) db.run(`ALTER TABLE performance_sales_facts ADD COLUMN ${column} ${definition}`);
  }
  db.run("PRAGMA user_version = 4");

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
      miaoshouOrderCount: number(first(db, "SELECT COUNT(*) AS count FROM miaoshou_performance_orders")?.count),
      miaoshouItemCount: number(first(db, "SELECT COUNT(*) AS count FROM miaoshou_performance_items")?.count),
      miaoshouReturnCount: number(first(db, "SELECT COUNT(*) AS count FROM miaoshou_performance_returns")?.count),
      supplementalCostCount: number(first(db, "SELECT COUNT(*) AS count FROM performance_supplemental_costs")?.count),
      enabledSupplementalCostCount: number(first(db, "SELECT COUNT(*) AS count FROM performance_supplemental_costs WHERE enabled = 1")?.count),
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
          sku, product_name, quantity, sales_amount, currency, sales_amount_scope, sales_amount_source,
          sales_amount_order_total, sales_amount_allocation_residual, sales_amount_valid, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            text(order.salesAmountSource),
            number(order.salesAmountOrderTotal),
            number(order.salesAmountAllocationResidual),
            order.salesAmountValid === true ? 1 : 0,
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

  function getMiaoshouPerformanceSyncState() {
    try {
      const value = JSON.parse(getMeta("miaoshouPerformanceSyncState") || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function setMiaoshouPerformanceSyncState(state = {}) {
    setMeta("miaoshouPerformanceSyncState", JSON.stringify(state && typeof state === "object" ? state : {}));
    persist();
    return getMiaoshouPerformanceSyncState();
  }

  function upsertMiaoshouPerformance({ orders = [], items = [], returns = [], cancellations = [] } = {}, syncState = null) {
    const now = new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      const orderStatement = db.prepare(`INSERT OR REPLACE INTO miaoshou_performance_orders (
        identity, op_order_id, platform, shop_id, platform_order_sn, site, currency,
        product_amount, order_amount, pay_amount, estimated_shipping_fee, actual_shipping_cost,
        commission_fee, escrow_amount, discount_amount, exchange_rate, payment_method,
        platform_order_status, app_order_status, app_order_status_text, order_started_at,
        order_modified_at, paid_at, delivered_at, refunded_at, settled_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        for (const row of Array.isArray(orders) ? orders : []) orderStatement.run([
          text(row.identity), text(row.opOrderId), text(row.platform), text(row.shopId), text(row.platformOrderSn),
          text(row.site), text(row.currency).toUpperCase(), number(row.productAmount), number(row.orderAmount),
          number(row.payAmount), number(row.estimatedShippingFee), number(row.actualShippingCost), number(row.commissionFee),
          number(row.escrowAmount), number(row.discountAmount), number(row.exchangeRate), text(row.paymentMethod),
          text(row.platformOrderStatus), text(row.appOrderStatus), text(row.appOrderStatusText), text(row.orderStartedAt),
          text(row.orderModifiedAt), text(row.paidAt), text(row.deliveredAt), text(row.refundedAt), text(row.settledAt),
          text(row.finishedAt), now,
        ]);
      } finally {
        orderStatement.free();
      }
      // Package composition can change after split/merge. Replace the complete
      // item set for every order seen in this sync so stale package items do not
      // remain in the transaction snapshot.
      for (const identity of new Set((Array.isArray(orders) ? orders : []).map((row) => text(row.identity)).filter(Boolean))) {
        db.run("DELETE FROM miaoshou_performance_items WHERE order_identity = ?", [identity]);
      }
      const itemStatement = db.prepare(`INSERT OR REPLACE INTO miaoshou_performance_items (
        identity, order_identity, op_order_item_id, op_order_package_item_id, platform_sku_id,
        platform_outer_sku_id, quantity, original_price, discounted_price, gift, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        for (const row of Array.isArray(items) ? items : []) itemStatement.run([
          text(row.identity), text(row.orderIdentity), text(row.opOrderItemId), text(row.opOrderPackageItemId),
          text(row.platformSkuId), text(row.platformOuterSkuId), number(row.quantity), number(row.originalPrice),
          number(row.discountedPrice), row.gift === true ? 1 : 0, now,
        ]);
      } finally {
        itemStatement.free();
      }
      const returnStatement = db.prepare(`INSERT OR REPLACE INTO miaoshou_performance_returns (
        identity, order_identity, op_order_id, platform, shop_id, platform_order_sn, platform_return_sn,
        currency, refund_amount, status, platform_return_status, app_return_status, app_return_status_text,
        reverse_type, created_at, modified_at, finished_at, finalized, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        for (const row of Array.isArray(returns) ? returns : []) returnStatement.run([
          text(row.identity), text(row.orderIdentity), text(row.opOrderId), text(row.platform), text(row.shopId),
          text(row.platformOrderSn), text(row.platformReturnSn), text(row.currency).toUpperCase(), number(row.refundAmount),
          text(row.status), text(row.platformReturnStatus), text(row.appReturnStatus), text(row.appReturnStatusText),
          text(row.reverseType), text(row.createdAt), text(row.modifiedAt), text(row.finishedAt), row.finalized === true ? 1 : 0, now,
        ]);
      } finally {
        returnStatement.free();
      }
      const cancellationStatement = db.prepare(`INSERT OR REPLACE INTO miaoshou_performance_cancellations (
        identity, order_identity, op_order_id, platform, shop_id, platform_order_sn, status,
        app_cancel_status, app_cancel_status_text, reason, created_at, modified_at, finalized, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        for (const row of Array.isArray(cancellations) ? cancellations : []) cancellationStatement.run([
          text(row.identity), text(row.orderIdentity), text(row.opOrderId), text(row.platform), text(row.shopId),
          text(row.platformOrderSn), text(row.status), text(row.appCancelStatus), text(row.appCancelStatusText),
          text(row.reason), text(row.createdAt), text(row.modifiedAt), row.finalized === true ? 1 : 0, now,
        ]);
      } finally {
        cancellationStatement.free();
      }
      if (syncState) setMeta("miaoshouPerformanceSyncState", JSON.stringify(syncState));
      db.run("COMMIT");
      persist();
      return getMetadata();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function listMiaoshouPerformance() {
    return {
      orders: all(db, "SELECT * FROM miaoshou_performance_orders ORDER BY order_started_at DESC, identity ASC").map(miaoshouOrderFromDb),
      items: all(db, "SELECT * FROM miaoshou_performance_items ORDER BY order_identity ASC, identity ASC").map(miaoshouItemFromDb),
      returns: all(db, "SELECT * FROM miaoshou_performance_returns ORDER BY created_at DESC, identity ASC").map(miaoshouReturnFromDb),
      cancellations: all(db, "SELECT * FROM miaoshou_performance_cancellations ORDER BY created_at DESC, identity ASC").map(miaoshouCancellationFromDb),
    };
  }

  function findMiaoshouOrdersByPlatformOrderSns(orderNumbers = []) {
    const normalized = [...new Set((Array.isArray(orderNumbers) ? orderNumbers : [])
      .map((value) => text(value))
      .filter(Boolean))];
    const rows = [];
    for (let index = 0; index < normalized.length; index += 300) {
      const batch = normalized.slice(index, index + 300);
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(...all(
        db,
        `SELECT * FROM miaoshou_performance_orders WHERE platform_order_sn IN (${placeholders}) ORDER BY order_started_at DESC, identity ASC`,
        batch,
      ));
    }
    return rows.map(miaoshouOrderFromDb);
  }

  function findMiaoshouOrderBundlesByPlatformOrderSns(orderNumbers = []) {
    const orders = findMiaoshouOrdersByPlatformOrderSns(orderNumbers);
    const identities = [...new Set(orders.map((order) => text(order.identity)).filter(Boolean))];
    const items = [];
    for (let index = 0; index < identities.length; index += 300) {
      const batch = identities.slice(index, index + 300);
      const placeholders = batch.map(() => "?").join(", ");
      items.push(...all(
        db,
        `SELECT * FROM miaoshou_performance_items WHERE order_identity IN (${placeholders}) ORDER BY order_identity ASC, identity ASC`,
        batch,
      ));
    }
    return { orders, items: items.map(miaoshouItemFromDb) };
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

  function listSupplementalProductCosts() {
    return all(db, `SELECT * FROM performance_supplemental_costs
      ORDER BY sku ASC, country_key ASC, effective_date DESC`).map((row) => ({
      sku: text(row.sku),
      countryKey: text(row.country_key),
      countryName: text(row.country_name),
      productName: text(row.product_name),
      unitCostCny: number(row.unit_cost_cny),
      effectiveDate: text(row.effective_date),
      enabled: number(row.enabled) === 1,
      note: text(row.note),
      source: text(row.source),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      updatedBy: text(row.updated_by),
    }));
  }

  function upsertSupplementalProductCosts(rows = [], actor = "管理员") {
    const now = new Date().toISOString();
    db.run("BEGIN");
    try {
      for (const row of rows) {
        db.run(
          `INSERT INTO performance_supplemental_costs
            (sku, country_key, country_name, product_name, unit_cost_cny, effective_date, enabled, note, source, created_at, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(sku, country_key, effective_date) DO UPDATE SET
             country_name = excluded.country_name,
             product_name = excluded.product_name,
             unit_cost_cny = excluded.unit_cost_cny,
             enabled = excluded.enabled,
             note = excluded.note,
             source = excluded.source,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`,
          [
            text(row.sku).toUpperCase(),
            text(row.countryKey).toUpperCase(),
            text(row.countryName || row.countryKey),
            text(row.productName),
            number(row.unitCostCny),
            dateKey(row.effectiveDate),
            row.enabled === false ? 0 : 1,
            text(row.note),
            text(row.source || "csv_manual"),
            now,
            now,
            text(actor),
          ],
        );
      }
      db.run("COMMIT");
      persist();
      return listSupplementalProductCosts();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
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

  function getPerformanceSettings() {
    try {
      const value = JSON.parse(getMeta("performanceSettings") || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function setPerformanceSettings(settings = {}) {
    const current = getPerformanceSettings();
    const next = {
      ...current,
      ...(settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {}),
      updatedAt: new Date().toISOString(),
    };
    setMeta("performanceSettings", JSON.stringify(next));
    persist();
    return getPerformanceSettings();
  }

  upsertExchangeRates([
    { currency: "CNY", effectiveDate: "2000-01-01", rateToCny: 1, source: "system" },
    { currency: "RMB", effectiveDate: "2000-01-01", rateToCny: 1, source: "system" },
  ], "system");
  persist();

  return {
    dbPath,
    getMiaoshouPerformanceSyncState,
    getPerformanceSettings,
    getMetadata,
    getExchangeRateSyncState,
    findMiaoshouOrderBundlesByPlatformOrderSns,
    findMiaoshouOrdersByPlatformOrderSns,
    listExchangeRates,
    listSalesCurrencies,
    listSalesFacts,
    listSupplementalProductCosts,
    listMiaoshouPerformance,
    persist,
    replaceSalesFacts,
    setExchangeRateSyncState,
    setMiaoshouPerformanceSyncState,
    setPerformanceSettings,
    upsertExchangeRates,
    upsertSupplementalProductCosts,
    upsertMiaoshouPerformance,
  };
}

export { legacyCorrectedOrders };

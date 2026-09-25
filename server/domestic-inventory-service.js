import { randomUUID } from "node:crypto";

function text(value) {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const output = Number(value);
  return Number.isFinite(output) ? output : fallback;
}

function skuKey(value) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function businessNo(type) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const prefix = { opening: "QC", inbound: "RK", outbound: "CK", adjustment: "TZ" }[type] || "KC";
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function fail(message, statusCode = 400, code = "domestic_inventory_error") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function required(value, label) {
  const output = text(value);
  if (!output) fail(`请填写${label}。`);
  return output;
}

function userOf(context = {}) {
  return {
    id: text(context.auth?.user?.id) || "system",
    name: text(context.auth?.user?.displayName || context.auth?.user?.username) || "系统",
  };
}

function warehouseFromRow(row) {
  if (!row) return null;
  return {
    id: text(row.id), code: text(row.code), name: text(row.name), country: text(row.country), province: text(row.province), city: text(row.city),
    address: text(row.address), contactName: text(row.contact_name), contactPhone: text(row.contact_phone), status: text(row.status), note: text(row.note),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function balanceFromRow(row) {
  const onHandQty = number(row.on_hand_qty);
  const reservedQty = number(row.reserved_qty);
  const safetyStockQty = number(row.safety_stock_qty);
  const availableQty = onHandQty - reservedQty;
  return {
    warehouseId: text(row.warehouse_id), warehouseName: text(row.warehouse_name), productId: text(row.product_id), sku: text(row.sku),
    productName: text(row.product_name), imageUrl: text(row.image_url), specification: text(row.specification), unit: text(row.unit) || "件",
    onHandQty, reservedQty, availableQty, safetyStockQty, lowStock: safetyStockQty > 0 && availableQty <= safetyStockQty, updatedAt: text(row.updated_at),
  };
}

function movementFromRow(row) {
  return {
    id: text(row.id), movementNo: text(row.movement_no), warehouseId: text(row.warehouse_id), warehouseName: text(row.warehouse_name),
    type: text(row.movement_type), referenceNo: text(row.reference_no), occurredAt: text(row.occurred_at), note: text(row.note),
    createdById: text(row.created_by_id), createdByName: text(row.created_by_name), createdAt: text(row.created_at), lines: [],
  };
}

function chinaAllowed(context) {
  const countries = Array.isArray(context.countries) ? context.countries.map((value) => text(value).toLowerCase()) : [];
  return !countries.length || countries.some((value) => ["中国", "china", "cn", "中国大陆"].includes(value));
}

export function createDomesticInventoryService(store) {
  function ensureWarehouse(warehouseId, context, options = {}) {
    if (!chinaAllowed(context)) fail("当前账号没有国内仓数据权限。", 403, "forbidden");
    const warehouse = warehouseFromRow(store.first("SELECT * FROM domestic_warehouses WHERE id=?", [text(warehouseId)]));
    if (!warehouse) fail("国内仓库不存在。", 404, "not_found");
    if (context.warehouseIds?.length && !context.warehouseIds.includes(warehouse.id)) fail("该仓库不在当前账号的数据范围内。", 403, "forbidden");
    if (options.active && warehouse.status !== "active") fail("该仓库已停用，不能登记库存流水。", 409, "warehouse_inactive");
    return warehouse;
  }

  function list(filters = {}, context = {}) {
    if (!chinaAllowed(context)) return { ok: true, updatedAt: nowIso(), summary: { warehouses: 0, skuCount: 0, onHandQty: 0, availableQty: 0, lowStockSkuCount: 0 }, warehouses: [], balances: [] };
    const warehouseWhere = [];
    const warehouseParams = [];
    if (context.warehouseIds?.length) {
      warehouseWhere.push(`id IN (${context.warehouseIds.map(() => "?").join(",")})`);
      warehouseParams.push(...context.warehouseIds);
    }
    const warehouses = store.all(`SELECT * FROM domestic_warehouses ${warehouseWhere.length ? `WHERE ${warehouseWhere.join(" AND ")}` : ""} ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,name`, warehouseParams).map(warehouseFromRow);
    const where = [];
    const params = [];
    if (filters.warehouseId) { where.push("b.warehouse_id=?"); params.push(text(filters.warehouseId)); }
    if (context.warehouseIds?.length) { where.push(`b.warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.skus?.length) { where.push(`UPPER(b.sku) IN (${context.skus.map(() => "?").join(",")})`); params.push(...context.skus); }
    if (filters.keyword) {
      where.push("(b.sku LIKE ? OR b.product_name LIKE ? OR w.name LIKE ?)");
      const keyword = `%${text(filters.keyword)}%`;
      params.push(keyword, keyword, keyword);
    }
    if (String(filters.lowStock || "") === "1") where.push("b.safety_stock_qty>0 AND (b.on_hand_qty-b.reserved_qty)<=b.safety_stock_qty");
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const balances = store.all(`SELECT b.*,w.name AS warehouse_name FROM domestic_inventory_balances b JOIN domestic_warehouses w ON w.id=b.warehouse_id ${clause} ORDER BY w.name,b.sku LIMIT 1000`, params).map(balanceFromRow);
    const warehouseTotals = new Map();
    balances.forEach((item) => {
      const current = warehouseTotals.get(item.warehouseId) || { skuCount: 0, onHandQty: 0, lowStockSkuCount: 0 };
      current.skuCount += 1;
      current.onHandQty += item.onHandQty;
      current.lowStockSkuCount += item.lowStock ? 1 : 0;
      warehouseTotals.set(item.warehouseId, current);
    });
    return {
      ok: true,
      updatedAt: balances.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""),
      summary: {
        warehouses: warehouses.filter((item) => item.status === "active").length,
        skuCount: balances.length,
        onHandQty: balances.reduce((sum, item) => sum + item.onHandQty, 0),
        availableQty: balances.reduce((sum, item) => sum + item.availableQty, 0),
        lowStockSkuCount: balances.filter((item) => item.lowStock).length,
      },
      warehouses: warehouses.map((warehouse) => ({ ...warehouse, ...(warehouseTotals.get(warehouse.id) || { skuCount: 0, onHandQty: 0, lowStockSkuCount: 0 }) })),
      balances,
    };
  }

  function createWarehouse(input, context) {
    if (!chinaAllowed(context)) fail("当前账号没有国内仓数据权限。", 403, "forbidden");
    if (context.warehouseIds?.length) fail("受限仓库账号不能创建新的仓库档案，请联系管理员。", 403, "forbidden");
    const code = required(input.code, "仓库编码").toUpperCase();
    if (store.first("SELECT 1 AS found FROM domestic_warehouses WHERE UPPER(code)=?", [code])) fail("仓库编码已存在。", 409, "duplicate_warehouse_code");
    const now = nowIso();
    const warehouse = {
      id: id("dwh"), code, name: required(input.name, "仓库名称"), country: "中国", province: text(input.province), city: text(input.city),
      address: text(input.address), contactName: text(input.contactName), contactPhone: text(input.contactPhone), status: input.status === "inactive" ? "inactive" : "active", note: text(input.note),
    };
    store.transaction(() => {
      store.run(`INSERT INTO domestic_warehouses (id,code,name,country,province,city,address,contact_name,contact_phone,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [warehouse.id, warehouse.code, warehouse.name, warehouse.country, warehouse.province, warehouse.city, warehouse.address, warehouse.contactName, warehouse.contactPhone, warehouse.status, warehouse.note, now, now]);
    });
    return { ok: true, warehouse: ensureWarehouse(warehouse.id, { ...context, warehouseIds: [] }) };
  }

  function updateWarehouse(warehouseId, input, context) {
    const warehouse = ensureWarehouse(warehouseId, context);
    const now = nowIso();
    const next = {
      name: required(input.name ?? warehouse.name, "仓库名称"), province: text(input.province ?? warehouse.province), city: text(input.city ?? warehouse.city),
      address: text(input.address ?? warehouse.address), contactName: text(input.contactName ?? warehouse.contactName), contactPhone: text(input.contactPhone ?? warehouse.contactPhone),
      status: input.status === "inactive" ? "inactive" : "active", note: text(input.note ?? warehouse.note),
    };
    store.transaction(() => store.run("UPDATE domestic_warehouses SET name=?,province=?,city=?,address=?,contact_name=?,contact_phone=?,status=?,note=?,updated_at=? WHERE id=?",
      [next.name, next.province, next.city, next.address, next.contactName, next.contactPhone, next.status, next.note, now, warehouse.id]));
    return { ok: true, warehouse: ensureWarehouse(warehouse.id, context) };
  }

  function createMovement(input, context, idempotencyKey = "") {
    const actor = userOf(context);
    if (idempotencyKey) {
      const existing = store.first("SELECT response_json FROM domestic_inventory_idempotency WHERE key=? AND user_id=?", [idempotencyKey, actor.id]);
      if (existing) return JSON.parse(existing.response_json);
    }
    const warehouse = ensureWarehouse(input.warehouseId, context, { active: true });
    const type = ["opening", "inbound", "outbound", "adjustment"].includes(input.type) ? input.type : fail("库存流水类型无效。");
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!rawLines.length) fail("请至少添加一个产品。", 400, "empty_lines");
    if (type === "adjustment" && !text(input.note)) fail("库存调整必须填写原因。", 400, "adjustment_reason_required");
    const normalized = rawLines.map((line) => {
      const sku = skuKey(line.sku);
      const quantity = type === "adjustment" ? number(line.deltaQty ?? line.quantity) : number(line.quantity);
      if (!sku) fail("请填写产品 SKU。");
      if ((type === "adjustment" && quantity === 0) || (type !== "adjustment" && quantity <= 0)) fail(`${sku} 的数量无效。`);
      if (context.skus?.length && !context.skus.includes(sku)) fail(`${sku} 不在当前账号的数据范围内。`, 403, "forbidden");
      return {
        productId: text(line.productId), sku, productName: required(line.productName, `${sku} 产品名称`), imageUrl: text(line.imageUrl), specification: text(line.specification),
        unit: text(line.unit) || "件", quantity: Math.abs(quantity), signedQty: type === "outbound" ? -quantity : quantity, unitCostCny: Math.max(0, number(line.unitCostCny)),
        safetyStockQty: line.safetyStockQty === undefined || line.safetyStockQty === null || line.safetyStockQty === "" ? null : number(line.safetyStockQty),
      };
    });
    if (normalized.some((line) => line.safetyStockQty !== null && line.safetyStockQty < 0)) fail("安全库存不能小于 0。");
    if (new Set(normalized.map((line) => line.sku)).size !== normalized.length) fail("同一个 SKU 不能在一张库存单中重复。", 400, "duplicate_sku");
    const movement = { id: id("dim"), movementNo: businessNo(type), occurredAt: text(input.occurredAt) || nowIso(), createdAt: nowIso() };
    const response = store.transaction(() => {
      store.run(`INSERT INTO domestic_inventory_movements (id,movement_no,warehouse_id,movement_type,reference_no,occurred_at,note,created_by_id,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [movement.id, movement.movementNo, warehouse.id, type, text(input.referenceNo), movement.occurredAt, text(input.note), actor.id, actor.name, movement.createdAt]);
      for (const line of normalized) {
        const current = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [warehouse.id, line.sku]);
        const beforeQty = number(current?.on_hand_qty);
        if (type === "opening" && current) fail(`${line.sku} 已建立库存台账，不能重复导入期初库存。`, 409, "opening_balance_exists");
        const afterQty = beforeQty + line.signedQty;
        if (afterQty < 0) fail(`${line.sku} 库存不足：当前 ${beforeQty} ${line.unit}，本次需出库 ${line.quantity} ${line.unit}。`, 409, "insufficient_stock");
        store.run(`INSERT INTO domestic_inventory_balances (warehouse_id,product_id,sku,product_name,image_url,specification,unit,on_hand_qty,reserved_qty,safety_stock_qty,updated_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,?)
          ON CONFLICT(warehouse_id,sku) DO UPDATE SET product_id=excluded.product_id,product_name=excluded.product_name,image_url=excluded.image_url,specification=excluded.specification,unit=excluded.unit,on_hand_qty=excluded.on_hand_qty,safety_stock_qty=excluded.safety_stock_qty,updated_at=excluded.updated_at`,
          [warehouse.id, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.unit, afterQty, line.safetyStockQty === null ? number(current?.safety_stock_qty) : line.safetyStockQty, movement.createdAt]);
        store.run(`INSERT INTO domestic_inventory_movement_lines (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id("dml"), movement.id, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.unit, line.quantity, line.signedQty, beforeQty, afterQty, line.unitCostCny]);
      }
      const result = { ok: true, movementId: movement.id, movementNo: movement.movementNo, type, warehouseId: warehouse.id };
      if (idempotencyKey) store.run("INSERT INTO domestic_inventory_idempotency (key,user_id,response_json,created_at) VALUES (?,?,?,?)", [idempotencyKey, actor.id, JSON.stringify(result), movement.createdAt]);
      return result;
    });
    return response;
  }

  function importOpeningBalances(input, context, idempotencyKey = "") {
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (lines.length > 2000) fail("单次期初库存导入不能超过 2000 个 SKU。", 400, "too_many_lines");
    return createMovement({
      warehouseId: input.warehouseId,
      type: "opening",
      referenceNo: text(input.referenceNo) || `期初-${new Date().toISOString().slice(0, 10)}`,
      occurredAt: input.occurredAt,
      note: text(input.note) || "期初库存批量导入",
      lines,
    }, context, idempotencyKey);
  }

  function listMovements(filters = {}, context = {}) {
    if (!chinaAllowed(context)) return { ok: true, movements: [] };
    const where = [];
    const params = [];
    if (filters.warehouseId) { where.push("m.warehouse_id=?"); params.push(text(filters.warehouseId)); }
    if (filters.type) { where.push("m.movement_type=?"); params.push(text(filters.type)); }
    if (context.warehouseIds?.length) { where.push(`m.warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.skus?.length) { where.push(`m.id IN (SELECT movement_id FROM domestic_inventory_movement_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`); params.push(...context.skus); }
    if (filters.keyword) {
      where.push("(m.movement_no LIKE ? OR m.reference_no LIKE ? OR m.id IN (SELECT movement_id FROM domestic_inventory_movement_lines WHERE sku LIKE ? OR product_name LIKE ?))");
      const keyword = `%${text(filters.keyword)}%`;
      params.push(keyword, keyword, keyword, keyword);
    }
    const movements = store.all(`SELECT m.*,w.name AS warehouse_name FROM domestic_inventory_movements m JOIN domestic_warehouses w ON w.id=m.warehouse_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY m.occurred_at DESC,m.created_at DESC LIMIT 300`, params).map(movementFromRow);
    for (const movement of movements) {
      movement.lines = store.all("SELECT * FROM domestic_inventory_movement_lines WHERE movement_id=? ORDER BY sku", [movement.id])
        .filter((line) => !context.skus?.length || context.skus.includes(skuKey(line.sku)))
        .map((line) => ({ id: text(line.id), sku: text(line.sku), productName: text(line.product_name), imageUrl: text(line.image_url), unit: text(line.unit), quantity: number(line.quantity), signedQty: number(line.signed_qty), beforeQty: number(line.before_qty), afterQty: number(line.after_qty), unitCostCny: number(line.unit_cost_cny) }));
    }
    return { ok: true, movements };
  }

  function updateSafetyStock(warehouseId, sku, input, context) {
    const warehouse = ensureWarehouse(warehouseId, context);
    const normalizedSku = skuKey(sku);
    if (context.skus?.length && !context.skus.includes(normalizedSku)) fail("该产品不在当前账号的数据范围内。", 403, "forbidden");
    const current = store.first("SELECT 1 AS found FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [warehouse.id, normalizedSku]);
    if (!current) fail("库存产品不存在。", 404, "not_found");
    const safetyStockQty = number(input.safetyStockQty);
    if (safetyStockQty < 0) fail("安全库存不能小于 0。");
    store.transaction(() => store.run("UPDATE domestic_inventory_balances SET safety_stock_qty=?,updated_at=? WHERE warehouse_id=? AND sku=?", [safetyStockQty, nowIso(), warehouse.id, normalizedSku]));
    return { ok: true, warehouseId: warehouse.id, sku: normalizedSku, safetyStockQty };
  }

  return { createMovement, createWarehouse, importOpeningBalances, list, listMovements, updateSafetyStock, updateWarehouse };
}

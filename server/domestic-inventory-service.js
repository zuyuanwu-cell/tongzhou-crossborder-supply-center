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

function optionalDate(value, label) {
  const output = text(value);
  if (!output) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(output) || Number.isNaN(new Date(`${output}T00:00:00Z`).getTime())) fail(`${label}格式应为 YYYY-MM-DD。`, 400, "invalid_date");
  return output;
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

function lotFromRow(row) {
  if (!row) return null;
  return {
    id: text(row.id), warehouseId: text(row.warehouse_id), warehouseName: text(row.warehouse_name), movementLineId: text(row.movement_line_id),
    movementId: text(row.movement_id), movementNo: text(row.movement_no), productId: text(row.product_id), sku: text(row.sku), productName: text(row.product_name),
    lotNo: text(row.lot_no), barcode: text(row.barcode), productionDate: text(row.production_date), expiryDate: text(row.expiry_date),
    packagingMode: text(row.packaging_mode) || "piece", cartonCount: number(row.carton_count), unitsPerCarton: number(row.units_per_carton),
    looseQuantity: number(row.loose_quantity), cartonLengthCm: number(row.carton_length_cm), cartonWidthCm: number(row.carton_width_cm),
    cartonHeightCm: number(row.carton_height_cm), cartonWeightKg: number(row.carton_weight_kg), receivedQty: number(row.received_qty),
    remainingQty: number(row.remaining_qty), unitCostCny: number(row.unit_cost_cny), sourceType: text(row.source_type), receivedAt: text(row.received_at),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
}

function normalizePackaging(line, quantity) {
  const packagingMode = line.packagingMode === "carton" ? "carton" : "piece";
  const productionDate = optionalDate(line.productionDate, "生产日期");
  const expiryDate = optionalDate(line.expiryDate, "有效期");
  if (productionDate && expiryDate && expiryDate < productionDate) fail("有效期不能早于生产日期。", 400, "invalid_expiry_date");
  const packaging = {
    packagingMode,
    lotNo: text(line.lotNo),
    barcode: text(line.barcode),
    productionDate,
    expiryDate,
    cartonCount: 0,
    unitsPerCarton: 0,
    looseQuantity: 0,
    cartonLengthCm: 0,
    cartonWidthCm: 0,
    cartonHeightCm: 0,
    cartonWeightKg: 0,
  };
  if (packagingMode === "piece") return packaging;
  packaging.cartonCount = number(line.cartonCount, -1);
  packaging.unitsPerCarton = number(line.unitsPerCarton, -1);
  packaging.looseQuantity = number(line.looseQuantity);
  packaging.cartonLengthCm = number(line.cartonLengthCm, -1);
  packaging.cartonWidthCm = number(line.cartonWidthCm, -1);
  packaging.cartonHeightCm = number(line.cartonHeightCm, -1);
  packaging.cartonWeightKg = number(line.cartonWeightKg, -1);
  if (!Number.isInteger(packaging.cartonCount) || packaging.cartonCount <= 0) fail("整箱入库的箱数必须是大于 0 的整数。", 400, "invalid_carton_count");
  if (!Number.isInteger(packaging.unitsPerCarton) || packaging.unitsPerCarton <= 0) fail("箱规必须是大于 0 的整数。", 400, "invalid_units_per_carton");
  if (!Number.isInteger(packaging.looseQuantity) || packaging.looseQuantity < 0) fail("零散数量必须是大于或等于 0 的整数。", 400, "invalid_loose_quantity");
  if ([packaging.cartonLengthCm, packaging.cartonWidthCm, packaging.cartonHeightCm, packaging.cartonWeightKg].some((value) => value <= 0)) {
    fail("整箱入库必须填写大于 0 的箱子长、宽、高和单箱重量。", 400, "invalid_carton_dimensions");
  }
  const packageQuantity = packaging.cartonCount * packaging.unitsPerCarton + packaging.looseQuantity;
  if (Math.abs(packageQuantity - quantity) > 0.000001) fail(`箱规计算数量为 ${packageQuantity}，与入库数量 ${quantity} 不一致。`, 400, "packaging_quantity_mismatch");
  return packaging;
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
      const packageQuantity = line.packagingMode === "carton"
        ? number(line.cartonCount) * number(line.unitsPerCarton) + number(line.looseQuantity)
        : 0;
      const quantity = type === "adjustment" ? number(line.deltaQty ?? line.quantity) : number(line.quantity, packageQuantity);
      if (!sku) fail("请填写产品 SKU。");
      if ((type === "adjustment" && quantity === 0) || (type !== "adjustment" && quantity <= 0)) fail(`${sku} 的数量无效。`);
      if (context.skus?.length && !context.skus.includes(sku)) fail(`${sku} 不在当前账号的数据范围内。`, 403, "forbidden");
      const signedQty = type === "outbound" ? -Math.abs(quantity) : quantity;
      return {
        productId: text(line.productId), sku, productName: required(line.productName, `${sku} 产品名称`), imageUrl: text(line.imageUrl), specification: text(line.specification),
        unit: text(line.unit) || "件", quantity: Math.abs(quantity), signedQty, unitCostCny: Math.max(0, number(line.unitCostCny)),
        safetyStockQty: line.safetyStockQty === undefined || line.safetyStockQty === null || line.safetyStockQty === "" ? null : number(line.safetyStockQty),
        packaging: signedQty > 0 ? normalizePackaging(line, Math.abs(quantity)) : null,
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
        const movementLineId = id("dml");
        store.run(`INSERT INTO domestic_inventory_movement_lines (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [movementLineId, movement.id, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.unit, line.quantity, line.signedQty, beforeQty, afterQty, line.unitCostCny]);
        if (line.signedQty > 0) {
          const packaging = line.packaging;
          const lotId = id("dlot");
          store.run(`INSERT INTO domestic_inventory_lots
            (id,warehouse_id,movement_line_id,product_id,sku,product_name,lot_no,barcode,production_date,expiry_date,packaging_mode,carton_count,units_per_carton,loose_quantity,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,received_qty,remaining_qty,unit_cost_cny,source_type,received_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [lotId, warehouse.id, movementLineId, line.productId, line.sku, line.productName, packaging.lotNo, packaging.barcode, packaging.productionDate, packaging.expiryDate,
              packaging.packagingMode, packaging.cartonCount, packaging.unitsPerCarton, packaging.looseQuantity, packaging.cartonLengthCm, packaging.cartonWidthCm,
              packaging.cartonHeightCm, packaging.cartonWeightKg, line.signedQty, line.signedQty, line.unitCostCny, type, movement.occurredAt, movement.createdAt, movement.createdAt]);
        } else {
          let remainingToAllocate = Math.abs(line.signedQty);
          const lots = store.all("SELECT id,remaining_qty FROM domestic_inventory_lots WHERE warehouse_id=? AND sku=? AND remaining_qty>0 ORDER BY received_at,created_at,id", [warehouse.id, line.sku]);
          for (const lot of lots) {
            if (remainingToAllocate <= 0) break;
            const allocated = Math.min(remainingToAllocate, number(lot.remaining_qty));
            if (allocated <= 0) continue;
            store.run("UPDATE domestic_inventory_lots SET remaining_qty=remaining_qty-?,updated_at=? WHERE id=?", [allocated, movement.createdAt, text(lot.id)]);
            store.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)",
              [id("dla"), movementLineId, text(lot.id), allocated, "fifo", movement.createdAt]);
            remainingToAllocate -= allocated;
          }
          if (remainingToAllocate > 0) {
            store.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)",
              [id("dla"), movementLineId, null, remainingToAllocate, "legacy_untracked", movement.createdAt]);
          }
        }
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
        .map((line) => {
          const lot = lotFromRow(store.first("SELECT * FROM domestic_inventory_lots WHERE movement_line_id=?", [text(line.id)]));
          const allocations = store.all(`SELECT a.*,l.lot_no,l.barcode FROM domestic_inventory_lot_allocations a LEFT JOIN domestic_inventory_lots l ON l.id=a.lot_id WHERE a.movement_line_id=? ORDER BY a.created_at,a.id`, [text(line.id)])
            .map((allocation) => ({ id: text(allocation.id), lotId: text(allocation.lot_id), lotNo: text(allocation.lot_no), barcode: text(allocation.barcode), quantity: number(allocation.quantity), type: text(allocation.allocation_type) }));
          return { id: text(line.id), sku: text(line.sku), productName: text(line.product_name), imageUrl: text(line.image_url), unit: text(line.unit), quantity: number(line.quantity), signedQty: number(line.signed_qty), beforeQty: number(line.before_qty), afterQty: number(line.after_qty), unitCostCny: number(line.unit_cost_cny), lot, allocations };
        });
    }
    return { ok: true, movements };
  }

  function listWarehouses(context = {}) {
    if (!chinaAllowed(context)) return { ok: true, warehouses: [] };
    const where = [];
    const params = [];
    if (context.warehouseIds?.length) {
      where.push(`id IN (${context.warehouseIds.map(() => "?").join(",")})`);
      params.push(...context.warehouseIds);
    }
    const warehouses = store.all(`SELECT * FROM domestic_warehouses ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,name`, params).map(warehouseFromRow);
    return { ok: true, warehouses };
  }

  function getMovement(movementId, context = {}) {
    const row = store.first("SELECT m.*,w.name AS warehouse_name FROM domestic_inventory_movements m JOIN domestic_warehouses w ON w.id=m.warehouse_id WHERE m.id=?", [text(movementId)]);
    if (!row) fail("库存单据不存在。", 404, "not_found");
    ensureWarehouse(row.warehouse_id, context);
    const result = listMovements({ warehouseId: row.warehouse_id }, context).movements.find((item) => item.id === text(movementId));
    if (!result || !result.lines.length) fail("库存单据不存在或不在当前账号的数据范围内。", 404, "not_found");
    return { ok: true, movement: result };
  }

  function listLots(filters = {}, context = {}) {
    if (!chinaAllowed(context)) return { ok: true, total: 0, limit: 100, offset: 0, lots: [] };
    const where = [];
    const params = [];
    if (filters.warehouseId) {
      ensureWarehouse(filters.warehouseId, context);
      where.push("l.warehouse_id=?");
      params.push(text(filters.warehouseId));
    }
    if (filters.sku) { where.push("UPPER(l.sku)=?"); params.push(skuKey(filters.sku)); }
    if (filters.barcode) { where.push("l.barcode=?"); params.push(text(filters.barcode)); }
    if (filters.lotNo) { where.push("l.lot_no=?"); params.push(text(filters.lotNo)); }
    if (String(filters.availableOnly || "") === "1") where.push("l.remaining_qty>0");
    if (filters.keyword) {
      const keyword = `%${text(filters.keyword)}%`;
      where.push("(l.sku LIKE ? OR l.product_name LIKE ? OR l.barcode LIKE ? OR l.lot_no LIKE ? OR m.movement_no LIKE ?)");
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    if (context.warehouseIds?.length) { where.push(`l.warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.skus?.length) { where.push(`UPPER(l.sku) IN (${context.skus.map(() => "?").join(",")})`); params.push(...context.skus); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(300, Math.floor(number(filters.limit, 100))));
    const offset = Math.max(0, Math.floor(number(filters.offset)));
    const total = number(store.first(`SELECT COUNT(*) AS total FROM domestic_inventory_lots l JOIN domestic_inventory_movements m ON m.id=(SELECT movement_id FROM domestic_inventory_movement_lines WHERE id=l.movement_line_id) ${clause}`, params)?.total);
    const lots = store.all(`SELECT l.*,w.name AS warehouse_name,ml.movement_id,m.movement_no FROM domestic_inventory_lots l JOIN domestic_warehouses w ON w.id=l.warehouse_id JOIN domestic_inventory_movement_lines ml ON ml.id=l.movement_line_id JOIN domestic_inventory_movements m ON m.id=ml.movement_id ${clause} ORDER BY l.received_at DESC,l.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]).map(lotFromRow);
    return { ok: true, total, limit, offset, lots };
  }

  function updateLot(lotId, input, context = {}) {
    const currentRow = store.first("SELECT * FROM domestic_inventory_lots WHERE id=?", [text(lotId)]);
    if (!currentRow) fail("库存批次不存在。", 404, "not_found");
    ensureWarehouse(currentRow.warehouse_id, context);
    const sku = skuKey(currentRow.sku);
    if (context.skus?.length && !context.skus.includes(sku)) fail("该产品不在当前账号的数据范围内。", 403, "forbidden");
    const productionDate = optionalDate(input.productionDate ?? currentRow.production_date, "生产日期");
    const expiryDate = optionalDate(input.expiryDate ?? currentRow.expiry_date, "有效期");
    if (productionDate && expiryDate && expiryDate < productionDate) fail("有效期不能早于生产日期。", 400, "invalid_expiry_date");
    const now = nowIso();
    store.transaction(() => store.run("UPDATE domestic_inventory_lots SET lot_no=?,barcode=?,production_date=?,expiry_date=?,updated_at=? WHERE id=?",
      [text(input.lotNo ?? currentRow.lot_no), text(input.barcode ?? currentRow.barcode), productionDate, expiryDate, now, text(lotId)]));
    const row = store.first("SELECT l.*,w.name AS warehouse_name,ml.movement_id,m.movement_no FROM domestic_inventory_lots l JOIN domestic_warehouses w ON w.id=l.warehouse_id JOIN domestic_inventory_movement_lines ml ON ml.id=l.movement_line_id JOIN domestic_inventory_movements m ON m.id=ml.movement_id WHERE l.id=?", [text(lotId)]);
    return { ok: true, lot: lotFromRow(row) };
  }

  function stockupAvailability(filters = {}, context = {}) {
    const warehouse = ensureWarehouse(required(filters.warehouseId, "仓库"), context, { active: true });
    const requested = [...new Set(String(filters.skus || filters.sku || "").split(",").map(skuKey).filter(Boolean))];
    if (!requested.length) fail("请至少提供一个 SKU。", 400, "sku_required");
    if (requested.length > 100) fail("单次最多查询 100 个 SKU。", 400, "too_many_skus");
    requested.forEach((sku) => {
      if (context.skus?.length && !context.skus.includes(sku)) fail(`${sku} 不在当前账号的数据范围内。`, 403, "forbidden");
    });
    const items = requested.map((sku) => {
      const balance = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [warehouse.id, sku]);
      const availableQty = Math.max(0, number(balance?.on_hand_qty) - number(balance?.reserved_qty));
      const lots = store.all("SELECT * FROM domestic_inventory_lots WHERE warehouse_id=? AND sku=? AND remaining_qty>0 ORDER BY received_at,created_at,id", [warehouse.id, sku]).map(lotFromRow);
      const knownLotQty = lots.reduce((sum, lot) => sum + lot.remainingQty, 0);
      const profileMap = new Map();
      lots.filter((lot) => lot.packagingMode === "carton" && lot.unitsPerCarton > 0).forEach((lot) => {
        const key = [lot.unitsPerCarton, lot.cartonLengthCm, lot.cartonWidthCm, lot.cartonHeightCm, lot.cartonWeightKg].join("|");
        const current = profileMap.get(key) || { unitsPerCarton: lot.unitsPerCarton, cartonLengthCm: lot.cartonLengthCm, cartonWidthCm: lot.cartonWidthCm, cartonHeightCm: lot.cartonHeightCm, cartonWeightKg: lot.cartonWeightKg, availableQty: 0 };
        current.availableQty += lot.remainingQty;
        profileMap.set(key, current);
      });
      const cartonProfiles = [...profileMap.values()].map((profile) => ({ ...profile, fullCartons: Math.floor(profile.availableQty / profile.unitsPerCarton), looseUnits: profile.availableQty % profile.unitsPerCarton }));
      return {
        warehouseId: warehouse.id, warehouseName: warehouse.name, sku, productId: text(balance?.product_id), productName: text(balance?.product_name), imageUrl: text(balance?.image_url),
        unit: text(balance?.unit) || "件", onHandQty: number(balance?.on_hand_qty), reservedQty: number(balance?.reserved_qty), availableQty,
        knownLotQty, untrackedQty: Math.max(0, availableQty - knownLotQty), lotCount: lots.length, cartonProfiles, lots,
      };
    });
    return { ok: true, warehouse, queriedAt: nowIso(), items };
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

  return { createMovement, createWarehouse, getMovement, importOpeningBalances, list, listLots, listMovements, listWarehouses, stockupAvailability, updateLot, updateSafetyStock, updateWarehouse };
}

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
  const prefix = { opening: "QC", inbound: "RK", outbound: "CK", adjustment: "TZ", transfer: "DB", transfer_out: "DBCK", transfer_in: "DBRK", transfer_cancel: "DBHX" }[type] || "KC";
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

function transferFromRow(row) {
  if (!row) return null;
  return {
    id: text(row.id), transferNo: text(row.transfer_no), sourceWarehouseId: text(row.source_warehouse_id), sourceWarehouseName: text(row.source_warehouse_name),
    targetWarehouseId: text(row.target_warehouse_id), targetWarehouseName: text(row.target_warehouse_name), status: text(row.status), note: text(row.note),
    outboundMovementId: text(row.outbound_movement_id), inboundMovementId: text(row.inbound_movement_id), cancelMovementId: text(row.cancel_movement_id),
    shippedAt: text(row.shipped_at), receivedAt: text(row.received_at), cancelledAt: text(row.cancelled_at), createdById: text(row.created_by_id),
    createdByName: text(row.created_by_name), receivedById: text(row.received_by_id), receivedByName: text(row.received_by_name),
    cancelledById: text(row.cancelled_by_id), cancelledByName: text(row.cancelled_by_name), createdAt: text(row.created_at), updatedAt: text(row.updated_at), lines: [],
  };
}

function lotFromRow(row) {
  if (!row) return null;
  const lot = {
    id: text(row.id), warehouseId: text(row.warehouse_id), warehouseName: text(row.warehouse_name), movementLineId: text(row.movement_line_id),
    movementId: text(row.movement_id), movementNo: text(row.movement_no), productId: text(row.product_id), sku: text(row.sku), productName: text(row.product_name),
    lotNo: text(row.lot_no), barcode: text(row.barcode), productionDate: text(row.production_date), expiryDate: text(row.expiry_date),
    packagingMode: text(row.packaging_mode) || "piece", cartonCount: number(row.carton_count), unitsPerCarton: number(row.units_per_carton),
    looseQuantity: number(row.loose_quantity), cartonLengthCm: number(row.carton_length_cm), cartonWidthCm: number(row.carton_width_cm),
    cartonHeightCm: number(row.carton_height_cm), cartonWeightKg: number(row.carton_weight_kg), receivedQty: number(row.received_qty),
    remainingQty: number(row.remaining_qty), unitCostCny: number(row.unit_cost_cny), sourceType: text(row.source_type), receivedAt: text(row.received_at),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at),
  };
  lot.missingFields = [
    !lot.lotNo ? "批次号" : "",
    lot.packagingMode !== "carton" || lot.unitsPerCarton <= 0 ? "箱规" : "",
  ].filter(Boolean);
  lot.needsSupplement = lot.missingFields.length > 0;
  return lot;
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

function normalizedSupplementFields(input = {}, currentRow = {}, quantity) {
  const productionDate = optionalDate(input.productionDate ?? currentRow.production_date, "生产日期");
  const expiryDate = optionalDate(input.expiryDate ?? currentRow.expiry_date, "有效期");
  if (productionDate && expiryDate && expiryDate < productionDate) fail("有效期不能早于生产日期。", 400, "invalid_expiry_date");
  const packagingMode = (input.packagingMode ?? currentRow.packaging_mode) === "carton" ? "carton" : "piece";
  const fields = {
    lotNo: text(input.lotNo ?? currentRow.lot_no),
    barcode: text(input.barcode ?? currentRow.barcode),
    productionDate,
    expiryDate,
    packagingMode,
    cartonCount: 0,
    unitsPerCarton: 0,
    looseQuantity: 0,
    cartonLengthCm: 0,
    cartonWidthCm: 0,
    cartonHeightCm: 0,
    cartonWeightKg: 0,
  };
  if (packagingMode === "piece") return fields;
  if (!Number.isInteger(quantity) || quantity <= 0) fail("按箱补录仅支持大于 0 的整数库存数量。", 400, "invalid_carton_quantity");
  fields.unitsPerCarton = number(input.unitsPerCarton ?? currentRow.units_per_carton, -1);
  if (!Number.isInteger(fields.unitsPerCarton) || fields.unitsPerCarton <= 0) fail("箱规必须是大于 0 的整数。", 400, "invalid_units_per_carton");
  const computedCartons = Math.floor(quantity / fields.unitsPerCarton);
  const computedLoose = quantity - computedCartons * fields.unitsPerCarton;
  fields.cartonCount = input.cartonCount === undefined || input.cartonCount === "" ? computedCartons : number(input.cartonCount, -1);
  fields.looseQuantity = input.looseQuantity === undefined || input.looseQuantity === "" ? computedLoose : number(input.looseQuantity, -1);
  if (!Number.isInteger(fields.cartonCount) || fields.cartonCount < 0) fail("整箱数必须是大于或等于 0 的整数。", 400, "invalid_carton_count");
  if (!Number.isInteger(fields.looseQuantity) || fields.looseQuantity < 0 || fields.looseQuantity >= fields.unitsPerCarton) fail("零散数量必须小于箱规且不能为负数。", 400, "invalid_loose_quantity");
  if (fields.cartonCount * fields.unitsPerCarton + fields.looseQuantity !== quantity) fail("整箱数、箱规和零散数量之和必须等于原入库数量。", 400, "packaging_quantity_mismatch");
  fields.cartonLengthCm = number(input.cartonLengthCm ?? currentRow.carton_length_cm, -1);
  fields.cartonWidthCm = number(input.cartonWidthCm ?? currentRow.carton_width_cm, -1);
  fields.cartonHeightCm = number(input.cartonHeightCm ?? currentRow.carton_height_cm, -1);
  fields.cartonWeightKg = number(input.cartonWeightKg ?? currentRow.carton_weight_kg, -1);
  if ([fields.cartonLengthCm, fields.cartonWidthCm, fields.cartonHeightCm, fields.cartonWeightKg].some((value) => value <= 0)) {
    fail("按箱补录必须填写大于 0 的箱子长、宽、高和单箱重量。", 400, "invalid_carton_dimensions");
  }
  return fields;
}

function chinaAllowed(context) {
  const countries = Array.isArray(context.countries) ? context.countries.map((value) => text(value).toLowerCase()) : [];
  return !countries.length || countries.some((value) => ["中国", "china", "cn", "中国大陆"].includes(value));
}

export function createDomesticInventoryService(store) {
  function warehouseById(warehouseId, options = {}) {
    const warehouse = warehouseFromRow(store.first("SELECT * FROM domestic_warehouses WHERE id=?", [text(warehouseId)]));
    if (!warehouse) fail("国内仓库不存在。", 404, "not_found");
    if (options.active && warehouse.status !== "active") fail("该仓库已停用，不能进行库存操作。", 409, "warehouse_inactive");
    return warehouse;
  }

  function ensureWarehouse(warehouseId, context, options = {}) {
    if (!chinaAllowed(context)) fail("当前账号没有国内仓数据权限。", 403, "forbidden");
    const warehouse = warehouseById(warehouseId, options);
    if (context.warehouseIds?.length && !context.warehouseIds.includes(warehouse.id)) fail("该仓库不在当前账号的数据范围内。", 403, "forbidden");
    return warehouse;
  }

  function listTransferTargets(sourceWarehouseId, context = {}) {
    const source = ensureWarehouse(sourceWarehouseId, context, { active: true });
    // 调出仓人员需要知道可以发往哪个启用仓，但不应借此读取目标仓地址、联系人等档案信息。
    const warehouses = store.all("SELECT id,code,name,country,status FROM domestic_warehouses WHERE status='active' AND id<>? ORDER BY name", [source.id]).map((row) => ({
      id: text(row.id), code: text(row.code), name: text(row.name), country: text(row.country) || "CN", status: text(row.status) || "active",
    }));
    return { ok: true, sourceWarehouseId: source.id, warehouses };
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

  function normalizeMovement(input, context) {
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
    return { warehouse, type, lines: normalized };
  }

  function previewMovement(input, context) {
    const normalized = normalizeMovement(input, context);
    return {
      ok: true,
      dryRun: true,
      type: normalized.type,
      warehouse: normalized.warehouse,
      lines: normalized.lines.map((line) => ({
        sku: line.sku,
        productName: line.productName,
        quantity: line.quantity,
        unit: line.unit,
        unitCostCny: line.unitCostCny,
        packagingMode: line.packaging?.packagingMode || "piece",
      })),
    };
  }

  function createMovement(input, context, idempotencyKey = "") {
    const actor = userOf(context);
    if (idempotencyKey) {
      const existing = store.first("SELECT response_json FROM domestic_inventory_idempotency WHERE key=? AND user_id=?", [idempotencyKey, actor.id]);
      if (existing) return { ...JSON.parse(existing.response_json), idempotentReplay: true };
    }
    const { warehouse, type, lines: normalized } = normalizeMovement(input, context);
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

  function normalizeTransfer(input, context = {}) {
    const sourceWarehouse = ensureWarehouse(input.sourceWarehouseId, context, { active: true });
    const targetWarehouse = warehouseById(input.targetWarehouseId, { active: true });
    if (sourceWarehouse.id === targetWarehouse.id) fail("调出仓和调入仓不能相同。", 400, "same_transfer_warehouse");
    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!rawLines.length) fail("请至少选择一个调拨产品。", 400, "empty_lines");
    const lines = rawLines.map((line) => {
      const sku = skuKey(line.sku);
      const quantity = number(line.quantity, -1);
      if (!sku) fail("请填写产品 SKU。", 400, "sku_required");
      if (quantity <= 0) fail(`${sku} 的调拨数量必须大于 0。`, 400, "invalid_transfer_quantity");
      if (context.skus?.length && !context.skus.includes(sku)) fail(`${sku} 不在当前账号的数据范围内。`, 403, "forbidden");
      const current = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [sourceWarehouse.id, sku]);
      if (!current) fail(`${sku} 在调出仓没有库存。`, 409, "transfer_stock_not_found");
      const availableQty = number(current.on_hand_qty) - number(current.reserved_qty);
      if (quantity > availableQty) fail(`${sku} 可调拨 ${availableQty} ${text(current.unit) || "件"}，本次申请 ${quantity}。`, 409, "insufficient_stock");
      return {
        productId: text(current.product_id), sku, productName: text(current.product_name), imageUrl: text(current.image_url), specification: text(current.specification),
        unit: text(current.unit) || "件", quantity, unitCostCny: Math.max(0, number(line.unitCostCny)), current,
      };
    });
    if (new Set(lines.map((line) => line.sku)).size !== lines.length) fail("同一 SKU 不能在一张调拨单中重复。", 400, "duplicate_sku");
    return { sourceWarehouse, targetWarehouse, lines };
  }

  function transferVisible(row, context = {}) {
    if (!chinaAllowed(context)) return false;
    if (!context.warehouseIds?.length) return true;
    return context.warehouseIds.includes(text(row.source_warehouse_id)) || context.warehouseIds.includes(text(row.target_warehouse_id));
  }

  function hydrateTransfer(row, context = {}) {
    if (!row || !transferVisible(row, context)) return null;
    const transfer = transferFromRow(row);
    const rawLines = store.all("SELECT * FROM domestic_inventory_transfer_lines WHERE transfer_id=? ORDER BY sku,id", [transfer.id]);
    transfer.lines = rawLines
      .filter((line) => !context.skus?.length || context.skus.includes(skuKey(line.sku)))
      .map((line) => {
        const allocations = store.all(`SELECT a.*,l.lot_no,l.barcode,l.production_date,l.expiry_date,l.packaging_mode,l.units_per_carton,l.carton_length_cm,l.carton_width_cm,l.carton_height_cm,l.carton_weight_kg,l.unit_cost_cny
          FROM domestic_inventory_lot_allocations a LEFT JOIN domestic_inventory_lots l ON l.id=a.lot_id WHERE a.movement_line_id=? ORDER BY a.created_at,a.id`, [text(line.source_movement_line_id)])
          .map((allocation) => ({
            id: text(allocation.id), lotId: text(allocation.lot_id), lotNo: text(allocation.lot_no), barcode: text(allocation.barcode), productionDate: text(allocation.production_date),
            expiryDate: text(allocation.expiry_date), packagingMode: text(allocation.packaging_mode) || "piece", unitsPerCarton: number(allocation.units_per_carton),
            cartonLengthCm: number(allocation.carton_length_cm), cartonWidthCm: number(allocation.carton_width_cm), cartonHeightCm: number(allocation.carton_height_cm),
            cartonWeightKg: number(allocation.carton_weight_kg), unitCostCny: number(allocation.unit_cost_cny, number(line.unit_cost_cny)), quantity: number(allocation.quantity), type: text(allocation.allocation_type),
          }));
        return {
          id: text(line.id), sourceMovementLineId: text(line.source_movement_line_id), productId: text(line.product_id), sku: text(line.sku), productName: text(line.product_name),
          imageUrl: text(line.image_url), specification: text(line.specification), unit: text(line.unit) || "件", quantity: number(line.quantity), unitCostCny: number(line.unit_cost_cny), allocations,
        };
      });
    if (context.skus?.length && !transfer.lines.length) return null;
    transfer.totalQuantity = transfer.lines.reduce((sum, line) => sum + line.quantity, 0);
    transfer.skuCount = transfer.lines.length;
    return transfer;
  }

  function transferRow(transferId) {
    return store.first(`SELECT t.*,sw.name AS source_warehouse_name,tw.name AS target_warehouse_name
      FROM domestic_inventory_transfers t JOIN domestic_warehouses sw ON sw.id=t.source_warehouse_id JOIN domestic_warehouses tw ON tw.id=t.target_warehouse_id WHERE t.id=?`, [text(transferId)]);
  }

  function getTransfer(transferId, context = {}) {
    const transfer = hydrateTransfer(transferRow(transferId), context);
    if (!transfer) fail("调拨单不存在或不在当前账号的数据范围内。", 404, "not_found");
    return { ok: true, transfer };
  }

  function listTransfers(filters = {}, context = {}) {
    if (!chinaAllowed(context)) return { ok: true, summary: { inTransit: 0, received: 0, cancelled: 0 }, transfers: [] };
    const where = [];
    const params = [];
    if (context.warehouseIds?.length) {
      const placeholders = context.warehouseIds.map(() => "?").join(",");
      where.push(`(t.source_warehouse_id IN (${placeholders}) OR t.target_warehouse_id IN (${placeholders}))`);
      params.push(...context.warehouseIds, ...context.warehouseIds);
    }
    if (filters.status) { where.push("t.status=?"); params.push(text(filters.status)); }
    if (filters.warehouseId) { where.push("(t.source_warehouse_id=? OR t.target_warehouse_id=?)"); params.push(text(filters.warehouseId), text(filters.warehouseId)); }
    if (filters.keyword) {
      const keyword = `%${text(filters.keyword)}%`;
      where.push("(t.transfer_no LIKE ? OR sw.name LIKE ? OR tw.name LIKE ? OR t.id IN (SELECT transfer_id FROM domestic_inventory_transfer_lines WHERE sku LIKE ? OR product_name LIKE ?))");
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const rows = store.all(`SELECT t.*,sw.name AS source_warehouse_name,tw.name AS target_warehouse_name
      FROM domestic_inventory_transfers t JOIN domestic_warehouses sw ON sw.id=t.source_warehouse_id JOIN domestic_warehouses tw ON tw.id=t.target_warehouse_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.shipped_at DESC,t.created_at DESC LIMIT 200`, params);
    const transfers = rows.map((row) => hydrateTransfer(row, context)).filter(Boolean);
    return {
      ok: true,
      summary: {
        inTransit: transfers.filter((item) => item.status === "in_transit").length,
        received: transfers.filter((item) => item.status === "received").length,
        cancelled: transfers.filter((item) => item.status === "cancelled").length,
      },
      transfers,
    };
  }

  function createTransfer(input, context = {}, idempotencyKey = "") {
    const actor = userOf(context);
    const storedKey = idempotencyKey ? `transfer:create:${idempotencyKey}` : "";
    if (storedKey) {
      const existing = store.first("SELECT response_json FROM domestic_inventory_idempotency WHERE key=? AND user_id=?", [storedKey, actor.id]);
      if (existing) return { ...JSON.parse(existing.response_json), idempotentReplay: true };
    }
    const { sourceWarehouse, targetWarehouse, lines } = normalizeTransfer(input, context);
    const now = nowIso();
    const transferId = id("dtr");
    const transferNo = businessNo("transfer");
    const movementId = id("dim");
    const movementNo = businessNo("transfer_out");
    const response = store.transaction(() => {
      store.run(`INSERT INTO domestic_inventory_movements (id,movement_no,warehouse_id,movement_type,reference_no,occurred_at,note,created_by_id,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [movementId, movementNo, sourceWarehouse.id, "transfer_out", transferNo, now, text(input.note) || `调拨至${targetWarehouse.name}`, actor.id, actor.name, now]);
      store.run(`INSERT INTO domestic_inventory_transfers (id,transfer_no,source_warehouse_id,target_warehouse_id,status,note,outbound_movement_id,shipped_at,created_by_id,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [transferId, transferNo, sourceWarehouse.id, targetWarehouse.id, "in_transit", text(input.note), movementId, now, actor.id, actor.name, now, now]);
      for (const line of lines) {
        const current = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [sourceWarehouse.id, line.sku]);
        const beforeQty = number(current.on_hand_qty);
        const afterQty = beforeQty - line.quantity;
        if (afterQty < number(current.reserved_qty)) fail(`${line.sku} 可调拨库存不足。`, 409, "insufficient_stock");
        store.run("UPDATE domestic_inventory_balances SET on_hand_qty=?,updated_at=? WHERE warehouse_id=? AND sku=?", [afterQty, now, sourceWarehouse.id, line.sku]);
        const movementLineId = id("dml");
        store.run(`INSERT INTO domestic_inventory_movement_lines (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [movementLineId, movementId, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.unit, line.quantity, -line.quantity, beforeQty, afterQty, line.unitCostCny]);
        store.run(`INSERT INTO domestic_inventory_transfer_lines (id,transfer_id,source_movement_line_id,product_id,sku,product_name,image_url,specification,unit,quantity,unit_cost_cny,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id("dtl"), transferId, movementLineId, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.unit, line.quantity, line.unitCostCny, now]);
        let remainingToAllocate = line.quantity;
        const lots = store.all("SELECT * FROM domestic_inventory_lots WHERE warehouse_id=? AND sku=? AND remaining_qty>0 ORDER BY received_at,created_at,id", [sourceWarehouse.id, line.sku]);
        for (const lot of lots) {
          if (remainingToAllocate <= 0) break;
          const allocated = Math.min(remainingToAllocate, number(lot.remaining_qty));
          if (allocated <= 0) continue;
          store.run("UPDATE domestic_inventory_lots SET remaining_qty=remaining_qty-?,updated_at=? WHERE id=?", [allocated, now, text(lot.id)]);
          store.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)",
            [id("dla"), movementLineId, text(lot.id), allocated, "transfer_fifo", now]);
          remainingToAllocate -= allocated;
        }
        if (remainingToAllocate > 0) {
          store.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)",
            [id("dla"), movementLineId, null, remainingToAllocate, "transfer_legacy_untracked", now]);
        }
      }
      const result = { ok: true, transferId, transferNo, status: "in_transit", sourceWarehouseId: sourceWarehouse.id, targetWarehouseId: targetWarehouse.id };
      if (storedKey) store.run("INSERT INTO domestic_inventory_idempotency (key,user_id,response_json,created_at) VALUES (?,?,?,?)", [storedKey, actor.id, JSON.stringify(result), now]);
      return result;
    });
    return { ...response, transfer: getTransfer(transferId, context).transfer };
  }

  function receiveTransfer(transferId, context = {}) {
    const row = transferRow(transferId);
    if (!row) fail("调拨单不存在。", 404, "not_found");
    const targetWarehouse = ensureWarehouse(row.target_warehouse_id, context, { active: true });
    if (text(row.status) === "received") return { ok: true, idempotentReplay: true, transfer: getTransfer(transferId, context).transfer };
    if (text(row.status) !== "in_transit") fail("只有在途调拨单可以确认收货。", 409, "transfer_not_receivable");
    const actor = userOf(context);
    const now = nowIso();
    const movementId = id("dim");
    const movementNo = businessNo("transfer_in");
    store.transaction(() => {
      const fresh = store.first("SELECT status FROM domestic_inventory_transfers WHERE id=?", [text(transferId)]);
      if (text(fresh?.status) !== "in_transit") fail("调拨状态已变化，请刷新后重试。", 409, "transfer_state_changed");
      store.run(`INSERT INTO domestic_inventory_movements (id,movement_no,warehouse_id,movement_type,reference_no,occurred_at,note,created_by_id,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [movementId, movementNo, targetWarehouse.id, "transfer_in", text(row.transfer_no), now, `调拨收货：${text(row.source_warehouse_name)} → ${targetWarehouse.name}`, actor.id, actor.name, now]);
      const transferLines = store.all("SELECT * FROM domestic_inventory_transfer_lines WHERE transfer_id=? ORDER BY sku,id", [text(transferId)]);
      for (const line of transferLines) {
        const allocations = store.all(`SELECT a.*,l.* FROM domestic_inventory_lot_allocations a LEFT JOIN domestic_inventory_lots l ON l.id=a.lot_id WHERE a.movement_line_id=? ORDER BY a.created_at,a.id`, [text(line.source_movement_line_id)]);
        const parts = allocations.length ? allocations : [{ quantity: line.quantity }];
        for (const allocation of parts) {
          const quantity = number(allocation.quantity);
          if (quantity <= 0) continue;
          const current = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [targetWarehouse.id, text(line.sku)]);
          const beforeQty = number(current?.on_hand_qty);
          const afterQty = beforeQty + quantity;
          store.run(`INSERT INTO domestic_inventory_balances (warehouse_id,product_id,sku,product_name,image_url,specification,unit,on_hand_qty,reserved_qty,safety_stock_qty,updated_at)
            VALUES (?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(warehouse_id,sku) DO UPDATE SET product_id=excluded.product_id,product_name=excluded.product_name,image_url=excluded.image_url,specification=excluded.specification,unit=excluded.unit,on_hand_qty=excluded.on_hand_qty,updated_at=excluded.updated_at`,
            [targetWarehouse.id, text(line.product_id), text(line.sku), text(line.product_name), text(line.image_url), text(line.specification), text(line.unit) || "件", afterQty, number(current?.safety_stock_qty), now]);
          const movementLineId = id("dml");
          const unitCostCny = number(allocation.unit_cost_cny, number(line.unit_cost_cny));
          store.run(`INSERT INTO domestic_inventory_movement_lines (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [movementLineId, movementId, text(line.product_id), text(line.sku), text(line.product_name), text(line.image_url), text(line.specification), text(line.unit) || "件", quantity, quantity, beforeQty, afterQty, unitCostCny]);
          const unitsPerCarton = number(allocation.units_per_carton);
          const cartonMode = text(allocation.packaging_mode) === "carton" && Number.isInteger(quantity) && Number.isInteger(unitsPerCarton) && unitsPerCarton > 0;
          const cartonCount = cartonMode ? Math.floor(quantity / unitsPerCarton) : 0;
          const looseQuantity = cartonMode ? quantity - cartonCount * unitsPerCarton : 0;
          store.run(`INSERT INTO domestic_inventory_lots
            (id,warehouse_id,movement_line_id,product_id,sku,product_name,lot_no,barcode,production_date,expiry_date,packaging_mode,carton_count,units_per_carton,loose_quantity,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,received_qty,remaining_qty,unit_cost_cny,source_type,received_at,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id("dlot"), targetWarehouse.id, movementLineId, text(line.product_id), text(line.sku), text(line.product_name), text(allocation.lot_no), text(allocation.barcode),
              text(allocation.production_date), text(allocation.expiry_date), cartonMode ? "carton" : "piece", cartonCount, cartonMode ? unitsPerCarton : 0, looseQuantity,
              cartonMode ? number(allocation.carton_length_cm) : 0, cartonMode ? number(allocation.carton_width_cm) : 0, cartonMode ? number(allocation.carton_height_cm) : 0,
              cartonMode ? number(allocation.carton_weight_kg) : 0, quantity, quantity, unitCostCny, "transfer_in", now, now, now]);
        }
      }
      store.run(`UPDATE domestic_inventory_transfers SET status='received',inbound_movement_id=?,received_at=?,received_by_id=?,received_by_name=?,updated_at=? WHERE id=?`,
        [movementId, now, actor.id, actor.name, now, text(transferId)]);
    });
    return { ok: true, movementId, movementNo, transfer: getTransfer(transferId, context).transfer };
  }

  function cancelTransfer(transferId, context = {}) {
    const row = transferRow(transferId);
    if (!row) fail("调拨单不存在。", 404, "not_found");
    const sourceWarehouse = ensureWarehouse(row.source_warehouse_id, context, { active: true });
    if (text(row.status) === "cancelled") return { ok: true, idempotentReplay: true, transfer: getTransfer(transferId, context).transfer };
    if (text(row.status) !== "in_transit") fail("只有在途调拨单可以取消。", 409, "transfer_not_cancellable");
    const actor = userOf(context);
    const now = nowIso();
    const movementId = id("dim");
    const movementNo = businessNo("transfer_cancel");
    store.transaction(() => {
      const fresh = store.first("SELECT status FROM domestic_inventory_transfers WHERE id=?", [text(transferId)]);
      if (text(fresh?.status) !== "in_transit") fail("调拨状态已变化，请刷新后重试。", 409, "transfer_state_changed");
      store.run(`INSERT INTO domestic_inventory_movements (id,movement_no,warehouse_id,movement_type,reference_no,occurred_at,note,created_by_id,created_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [movementId, movementNo, sourceWarehouse.id, "transfer_cancel", text(row.transfer_no), now, "取消调拨并恢复原批次库存", actor.id, actor.name, now]);
      const transferLines = store.all("SELECT * FROM domestic_inventory_transfer_lines WHERE transfer_id=? ORDER BY sku,id", [text(transferId)]);
      for (const line of transferLines) {
        const current = store.first("SELECT * FROM domestic_inventory_balances WHERE warehouse_id=? AND sku=?", [sourceWarehouse.id, text(line.sku)]);
        const beforeQty = number(current?.on_hand_qty);
        const afterQty = beforeQty + number(line.quantity);
        store.run("UPDATE domestic_inventory_balances SET on_hand_qty=?,updated_at=? WHERE warehouse_id=? AND sku=?", [afterQty, now, sourceWarehouse.id, text(line.sku)]);
        const movementLineId = id("dml");
        store.run(`INSERT INTO domestic_inventory_movement_lines (id,movement_id,product_id,sku,product_name,image_url,specification,unit,quantity,signed_qty,before_qty,after_qty,unit_cost_cny) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [movementLineId, movementId, text(line.product_id), text(line.sku), text(line.product_name), text(line.image_url), text(line.specification), text(line.unit) || "件", number(line.quantity), number(line.quantity), beforeQty, afterQty, number(line.unit_cost_cny)]);
        const allocations = store.all("SELECT * FROM domestic_inventory_lot_allocations WHERE movement_line_id=? ORDER BY created_at,id", [text(line.source_movement_line_id)]);
        for (const allocation of allocations) {
          if (allocation.lot_id) store.run("UPDATE domestic_inventory_lots SET remaining_qty=remaining_qty+?,updated_at=? WHERE id=?", [number(allocation.quantity), now, text(allocation.lot_id)]);
          store.run("INSERT INTO domestic_inventory_lot_allocations (id,movement_line_id,lot_id,quantity,allocation_type,created_at) VALUES (?,?,?,?,?,?)",
            [id("dla"), movementLineId, allocation.lot_id ? text(allocation.lot_id) : null, number(allocation.quantity), "transfer_cancel_restore", now]);
        }
      }
      store.run(`UPDATE domestic_inventory_transfers SET status='cancelled',cancel_movement_id=?,cancelled_at=?,cancelled_by_id=?,cancelled_by_name=?,updated_at=? WHERE id=?`,
        [movementId, now, actor.id, actor.name, now, text(transferId)]);
    });
    return { ok: true, movementId, movementNo, transfer: getTransfer(transferId, context).transfer };
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
          const lots = store.all("SELECT * FROM domestic_inventory_lots WHERE movement_line_id=? ORDER BY created_at,id", [text(line.id)]).map(lotFromRow);
          const allocations = store.all(`SELECT a.*,l.lot_no,l.barcode FROM domestic_inventory_lot_allocations a LEFT JOIN domestic_inventory_lots l ON l.id=a.lot_id WHERE a.movement_line_id=? ORDER BY a.created_at,a.id`, [text(line.id)])
            .map((allocation) => ({ id: text(allocation.id), lotId: text(allocation.lot_id), lotNo: text(allocation.lot_no), barcode: text(allocation.barcode), quantity: number(allocation.quantity), type: text(allocation.allocation_type) }));
          return { id: text(line.id), sku: text(line.sku), productName: text(line.product_name), imageUrl: text(line.image_url), unit: text(line.unit), quantity: number(line.quantity), signedQty: number(line.signed_qty), beforeQty: number(line.before_qty), afterQty: number(line.after_qty), unitCostCny: number(line.unit_cost_cny), lot: lots[0] || null, lots, allocations };
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
    if (String(filters.incompleteOnly || "") === "1") where.push("(COALESCE(l.lot_no,'')='' OR l.packaging_mode<>'carton' OR l.units_per_carton<=0)");
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
    const fields = normalizedSupplementFields(input, currentRow, number(currentRow.received_qty));
    const now = nowIso();
    store.transaction(() => store.run(`UPDATE domestic_inventory_lots SET lot_no=?,barcode=?,production_date=?,expiry_date=?,packaging_mode=?,carton_count=?,units_per_carton=?,loose_quantity=?,carton_length_cm=?,carton_width_cm=?,carton_height_cm=?,carton_weight_kg=?,updated_at=? WHERE id=?`,
      [fields.lotNo, fields.barcode, fields.productionDate, fields.expiryDate, fields.packagingMode, fields.cartonCount, fields.unitsPerCarton, fields.looseQuantity,
        fields.cartonLengthCm, fields.cartonWidthCm, fields.cartonHeightCm, fields.cartonWeightKg, now, text(lotId)]));
    const row = store.first("SELECT l.*,w.name AS warehouse_name,ml.movement_id,m.movement_no FROM domestic_inventory_lots l JOIN domestic_warehouses w ON w.id=l.warehouse_id JOIN domestic_inventory_movement_lines ml ON ml.id=l.movement_line_id JOIN domestic_inventory_movements m ON m.id=ml.movement_id WHERE l.id=?", [text(lotId)]);
    return { ok: true, lot: lotFromRow(row) };
  }

  function splitLot(lotId, input, context = {}) {
    const currentRow = store.first("SELECT * FROM domestic_inventory_lots WHERE id=?", [text(lotId)]);
    if (!currentRow) fail("库存批次不存在。", 404, "not_found");
    ensureWarehouse(currentRow.warehouse_id, context);
    const sku = skuKey(currentRow.sku);
    if (context.skus?.length && !context.skus.includes(sku)) fail("该产品不在当前账号的数据范围内。", 403, "forbidden");
    const receivedQty = number(currentRow.received_qty);
    const remainingQty = number(currentRow.remaining_qty);
    if (Math.abs(receivedQty - remainingQty) > 0.000001) fail("该批次已发生出库，无法安全拆分；可直接补录现有批次资料。", 409, "lot_already_allocated");
    const rawSplits = Array.isArray(input.splits) ? input.splits : [];
    if (rawSplits.length < 2 || rawSplits.length > 50) fail("拆分批次应包含 2 至 50 条明细。", 400, "invalid_split_count");
    const normalized = rawSplits.map((item, index) => {
      const quantity = number(item.quantity, -1);
      if (!Number.isInteger(quantity) || quantity <= 0) fail(`第 ${index + 1} 个批次的数量必须是大于 0 的整数。`, 400, "invalid_split_quantity");
      const fields = normalizedSupplementFields(item, {}, quantity);
      if (!fields.lotNo) fail(`第 ${index + 1} 个批次必须填写批次号。`, 400, "split_lot_no_required");
      return { quantity, fields };
    });
    const total = normalized.reduce((sum, item) => sum + item.quantity, 0);
    if (Math.abs(total - receivedQty) > 0.000001) fail(`拆分数量合计 ${total}，必须等于原批次数量 ${receivedQty}。`, 400, "split_quantity_mismatch");
    const uniqueLotNos = new Set(normalized.map((item) => item.fields.lotNo.toUpperCase()));
    if (uniqueLotNos.size !== normalized.length) fail("拆分后的批次号不能重复。", 400, "duplicate_split_lot_no");
    const now = nowIso();
    store.transaction(() => {
      normalized.forEach((item, index) => {
        const values = [item.fields.lotNo, item.fields.barcode, item.fields.productionDate, item.fields.expiryDate, item.fields.packagingMode, item.fields.cartonCount,
          item.fields.unitsPerCarton, item.fields.looseQuantity, item.fields.cartonLengthCm, item.fields.cartonWidthCm, item.fields.cartonHeightCm, item.fields.cartonWeightKg,
          item.quantity, item.quantity, now];
        if (index === 0) {
          store.run(`UPDATE domestic_inventory_lots SET lot_no=?,barcode=?,production_date=?,expiry_date=?,packaging_mode=?,carton_count=?,units_per_carton=?,loose_quantity=?,carton_length_cm=?,carton_width_cm=?,carton_height_cm=?,carton_weight_kg=?,received_qty=?,remaining_qty=?,updated_at=? WHERE id=?`, [...values, text(lotId)]);
          return;
        }
        store.run(`INSERT INTO domestic_inventory_lots
          (id,warehouse_id,movement_line_id,product_id,sku,product_name,lot_no,barcode,production_date,expiry_date,packaging_mode,carton_count,units_per_carton,loose_quantity,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,received_qty,remaining_qty,unit_cost_cny,source_type,received_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id("dlot"), currentRow.warehouse_id, currentRow.movement_line_id, currentRow.product_id, currentRow.sku, currentRow.product_name,
          item.fields.lotNo, item.fields.barcode, item.fields.productionDate, item.fields.expiryDate, item.fields.packagingMode, item.fields.cartonCount, item.fields.unitsPerCarton,
          item.fields.looseQuantity, item.fields.cartonLengthCm, item.fields.cartonWidthCm, item.fields.cartonHeightCm, item.fields.cartonWeightKg, item.quantity, item.quantity,
          currentRow.unit_cost_cny, currentRow.source_type, currentRow.received_at, now, now]);
      });
    });
    const lots = store.all("SELECT l.*,w.name AS warehouse_name,ml.movement_id,m.movement_no FROM domestic_inventory_lots l JOIN domestic_warehouses w ON w.id=l.warehouse_id JOIN domestic_inventory_movement_lines ml ON ml.id=l.movement_line_id JOIN domestic_inventory_movements m ON m.id=ml.movement_id WHERE l.movement_line_id=? ORDER BY l.created_at,l.id", [text(currentRow.movement_line_id)]).map(lotFromRow);
    return { ok: true, originalLotId: text(lotId), warehouseId: text(currentRow.warehouse_id), sku, lots };
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

  return {
    cancelTransfer, createMovement, createTransfer, createWarehouse, getMovement, getTransfer, importOpeningBalances, list, listLots, listMovements,
    listTransfers, listTransferTargets, listWarehouses, previewMovement, receiveTransfer, splitLot, stockupAvailability, updateLot, updateSafetyStock, updateWarehouse,
  };
}

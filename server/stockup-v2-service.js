import { randomUUID } from "node:crypto";
import { allocatePurchaseOrder, temporarySku, validateInspectionLine } from "./stockup-v2-domain.js";

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function money(value) { return Math.round((number(value) + Number.EPSILON) * 100) / 100; }
function text(value) { return String(value ?? "").trim(); }
function optionalTrackingNumber(value) {
  const trackingNumber = text(value);
  return ["-", "--", "—", "暂无", "待补", "待填写", "n/a", "na", "null", "undefined"].includes(trackingNumber.toLowerCase()) ? "" : trackingNumber;
}
function json(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function userOf(context = {}) { return { id: text(context.auth?.user?.id) || "system", name: text(context.auth?.user?.displayName || context.auth?.user?.username) || "系统" }; }
function fail(message, code = "stockup_v2_error", statusCode = 400) { throw Object.assign(new Error(message), { code, statusCode }); }
function required(value, label) { const result = text(value); if (!result) fail(`请填写${label}。`, "required"); return result; }
function businessNo(prefix) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function normalizeShipmentPackaging(input, quantity, sku) {
  const rawGroups = Array.isArray(input?.packagingGroups) && input.packagingGroups.length
    ? input.packagingGroups
    : [{
      kind: "standard", cartonCount: input?.cartonCount, unitsPerCarton: input?.unitsPerCarton,
      cartonLengthCm: input?.cartonLengthCm, cartonWidthCm: input?.cartonWidthCm, cartonHeightCm: input?.cartonHeightCm, cartonWeightKg: input?.cartonWeightKg,
    }];
  const groups = rawGroups.map((group, index) => ({
    id: text(group?.id) || `package-${index + 1}`,
    kind: group?.kind === "remainder" ? "remainder" : "standard",
    cartonCount: number(group?.cartonCount), unitsPerCarton: number(group?.unitsPerCarton),
    cartonLengthCm: number(group?.cartonLengthCm), cartonWidthCm: number(group?.cartonWidthCm), cartonHeightCm: number(group?.cartonHeightCm), cartonWeightKg: number(group?.cartonWeightKg),
  }));
  if (!groups.length) fail(`${sku} 至少需要一种装箱规格。`, "shipment_packaging_required");
  for (const [index, group] of groups.entries()) {
    const label = group.kind === "remainder" ? `尾数箱 ${index + 1}` : "标准箱";
    if (!Number.isInteger(group.cartonCount) || group.cartonCount <= 0) fail(`${sku} 的${label}箱数必须是大于 0 的整数。`, "shipment_carton_count_invalid");
    if (!Number.isInteger(group.unitsPerCarton) || group.unitsPerCarton <= 0) fail(`${sku} 的${label}件/箱必须是大于 0 的整数。`, "shipment_units_per_carton_invalid");
    if ([group.cartonLengthCm, group.cartonWidthCm, group.cartonHeightCm, group.cartonWeightKg].some((value) => value <= 0)) fail(`${sku} 的${label}请补齐外箱长宽高和单箱毛重。`, "shipment_packaging_dimensions_invalid");
  }
  const packedQuantity = groups.reduce((sum, group) => sum + group.cartonCount * group.unitsPerCarton, 0);
  if (packedQuantity !== quantity) fail(`${sku} 的标准箱与尾数箱合计 ${packedQuantity}，但本次发运数量为 ${quantity}。`, "shipment_packaging_quantity_mismatch");
  const representative = groups.find((group) => group.kind === "standard") || groups[0];
  return {
    groups,
    cartonCount: groups.reduce((sum, group) => sum + group.cartonCount, 0),
    unitsPerCarton: representative.unitsPerCarton,
    cartonLengthCm: representative.cartonLengthCm,
    cartonWidthCm: representative.cartonWidthCm,
    cartonHeightCm: representative.cartonHeightCm,
    cartonWeightKg: representative.cartonWeightKg,
    weightKg: groups.reduce((sum, group) => sum + group.cartonCount * group.cartonWeightKg, 0),
    volumeM3: groups.reduce((sum, group) => sum + group.cartonCount * group.cartonLengthCm * group.cartonWidthCm * group.cartonHeightCm / 1_000_000, 0),
  };
}

export function createStockupV2Service({ store, inventoryGateway = {}, getRequest, getShipment, addEvent }) {
  function planInventory(lines, context = {}) {
    const skus = [...new Set(lines.map((line) => text(line.sku).replace(/\s+/g, "").toUpperCase()).filter(Boolean))];
    const availability = skus.length && inventoryGateway.getAvailabilitySummary
      ? inventoryGateway.getAvailabilitySummary(skus, context)
      : { queriedAt: nowIso(), items: [] };
    const bySku = new Map((availability?.items || []).map((item) => [text(item.sku).replace(/\s+/g, "").toUpperCase(), item]));
    return lines.map((line) => {
      const inventory = bySku.get(text(line.sku).replace(/\s+/g, "").toUpperCase()) || {};
      const domesticAvailableQty = Math.max(0, number(inventory.availableQty));
      const domesticAllocatedQty = Math.min(number(line.quantity), domesticAvailableQty);
      const procurementRequiredQty = Math.max(0, number(line.quantity) - domesticAllocatedQty);
      const method = domesticAllocatedQty >= number(line.quantity) ? "国内库存" : domesticAllocatedQty > 0 ? "库存优先+采购" : "采购";
      return {
        ...line,
        method,
        domesticAvailableQty,
        domesticAllocatedQty,
        procurementRequiredQty,
        inventoryCheckedAt: text(availability?.queriedAt) || nowIso(),
        inventorySnapshot: {
          sku: text(line.sku),
          onHandQty: number(inventory.onHandQty),
          reservedQty: number(inventory.reservedQty),
          availableQty: domesticAvailableQty,
          warehouses: Array.isArray(inventory.warehouses) ? inventory.warehouses : [],
        },
      };
    });
  }

  function refreshInventoryPlan(requestId, context = {}) {
    const rows = store.all("SELECT * FROM stockup_request_lines WHERE request_id=?", [text(requestId)]);
    const planned = planInventory(rows.map((row) => ({ ...row, quantity: number(row.requested_qty), sku: text(row.sku) })), context);
    const checkedAt = nowIso();
    return store.transaction(() => {
      for (const line of planned) store.run(`UPDATE stockup_request_lines
        SET method=?,domestic_available_qty=?,domestic_allocated_qty=?,procurement_required_qty=?,inventory_snapshot_json=?,inventory_checked_at=?,updated_at=? WHERE id=?`,
        [line.method, line.domesticAvailableQty, line.domesticAllocatedQty, line.procurementRequiredQty, JSON.stringify(line.inventorySnapshot), line.inventoryCheckedAt, checkedAt, line.id]);
      return planned;
    });
  }

  function nextTemporarySku() {
    const date = new Date();
    for (let sequence = 1; sequence <= 9999; sequence += 1) {
      const sku = temporarySku(date, sequence);
      if (!store.first("SELECT 1 AS found FROM stockup_product_refs WHERE temporary_sku=? OR formal_sku=?", [sku, sku])) return sku;
    }
    fail("当天临时商品编码已用完。", "temporary_sku_exhausted", 409);
  }

  function productRefFromRow(row) {
    if (!row) return null;
    return {
      id: text(row.id), temporarySku: text(row.temporary_sku), formalSku: text(row.formal_sku), productId: text(row.product_id), productName: text(row.product_name),
      imageUrl: text(row.image_url), specification: text(row.specification), shelfLifeManaged: Boolean(row.shelf_life_managed), codingStatus: text(row.coding_status),
      defaultSupplyMode: text(row.default_supply_mode) || "待判断",
      codingError: text(row.coding_error), codedAt: text(row.coded_at), codedBy: text(row.coded_by), createdAt: text(row.created_at), updatedAt: text(row.updated_at),
    };
  }

  function ensureProductRef(input, at = nowIso()) {
    const requestedRef = text(input.productRefId);
    if (requestedRef) {
      const existing = store.first("SELECT * FROM stockup_product_refs WHERE id=?", [requestedRef]);
      if (!existing) fail("商品引用不存在。", "product_ref_not_found", 404);
      return productRefFromRow(existing);
    }
    const formalSku = text(input.sku).replace(/\s+/g, "").toUpperCase();
    if (formalSku) {
      const existing = store.first("SELECT * FROM stockup_product_refs WHERE formal_sku=?", [formalSku]);
      if (existing) return productRefFromRow(existing);
    }
    const productRef = {
      id: id("sprf"), temporarySku: nextTemporarySku(), formalSku, productId: text(input.productId), productName: required(input.productName, "产品名称"),
      imageUrl: text(input.imageUrl), specification: text(input.specification), shelfLifeManaged: Boolean(input.shelfLifeManaged),
      codingStatus: formalSku ? "coded" : "temporary", defaultSupplyMode: text(input.defaultSupplyMode) || "待判断",
    };
    store.run(`INSERT INTO stockup_product_refs (id,temporary_sku,formal_sku,product_id,product_name,image_url,specification,shelf_life_managed,coding_status,coding_error,coded_at,coded_by,created_at,updated_at,default_supply_mode)
      VALUES (?,?,?,?,?,?,?,?,?,'',?,?,?,?,?)`, [productRef.id, productRef.temporarySku, productRef.formalSku || null, productRef.productId, productRef.productName, productRef.imageUrl,
      productRef.specification, productRef.shelfLifeManaged ? 1 : 0, productRef.codingStatus, formalSku ? at : "", formalSku ? "system" : "", at, at, productRef.defaultSupplyMode]);
    return productRef;
  }

  function createSpotRequest(payload, context = {}, idempotencyKey = "") {
    const actor = userOf(context);
    const storedKey = idempotencyKey ? `v2-request:${actor.id}:${idempotencyKey}` : "";
    const replay = storedKey ? store.first("SELECT response_json FROM stockup_idempotency WHERE key=?", [storedKey]) : null;
    if (replay) return { ...json(replay.response_json, {}), idempotentReplay: true };
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!rawLines.length) fail("请至少添加一个产品。", "request_lines_required");
    const now = nowIso();
    const requestId = id("spr");
    const requestNo = businessNo("BR");
    const status = payload.submit ? "submitted" : "draft";
    const result = store.transaction(() => {
      let lines = rawLines.map((line, index) => {
        const quantity = number(line.requestedQty);
        if (quantity <= 0) fail(`第 ${index + 1} 行需求数量必须大于 0。`, "invalid_quantity");
        const productRef = ensureProductRef(line, now);
        return { id: id("srl"), ...line, quantity, productRef, sku: productRef.formalSku || productRef.temporarySku };
      });
      const normalizedSkus = lines.map((line) => line.sku.toUpperCase());
      if (new Set(normalizedSkus).size !== normalizedSkus.length) fail("同一商品不能在需求中重复添加。", "duplicate_product_ref");
      lines = planInventory(lines, context);
      store.run(`INSERT INTO stockup_requests
        (id,request_no,project,destination_country,destination_warehouse_id,destination_warehouse_name,expected_arrival_at,priority,reason,platform,note,status,requester_id,requester_name,assignee_id,assignee_name,exception_count,version,created_at,updated_at,workflow_version,source_type,source_ref,source_snapshot_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'','',0,1,?,?,?,?,?,?)`, [requestId, requestNo, required(payload.project, "项目/团队"), required(payload.destinationCountry, "目的国家"), text(payload.destinationWarehouseId),
        required(payload.destinationWarehouseName, "目的仓库"), required(payload.expectedArrivalAt, "期望到仓日期"), text(payload.priority) || "常规", required(payload.reason, "需求原因"),
        text(payload.platform), text(payload.note), status, actor.id, actor.name, now, now, 2, text(payload.sourceType) || "manual", text(payload.sourceRef), JSON.stringify(payload.sourceSnapshot || {})]);
      for (const line of lines) store.run(`INSERT INTO stockup_request_lines
        (id,request_id,product_id,sku,product_name,image_url,specification,method,requested_qty,unit,target_unit_cost_cny,expected_arrival_at,note,status,fulfilled_qty,created_at,updated_at,product_ref_id,procurement_url,shelf_life_managed,domestic_available_qty,domestic_allocated_qty,procurement_required_qty,inventory_snapshot_json,inventory_checked_at,default_supply_mode,effective_supply_mode)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?)`, [line.id, requestId, line.productRef.productId, line.sku, line.productRef.productName, line.productRef.imageUrl, line.productRef.specification,
        line.method, line.quantity, text(line.unit) || "件", line.targetUnitCostCny === "" || line.targetUnitCostCny == null ? null : number(line.targetUnitCostCny), text(line.expectedArrivalAt),
        text(line.note), status, now, now, line.productRef.id, text(line.procurementUrl || line.orderUrl), line.productRef.shelfLifeManaged ? 1 : 0,
        line.domesticAvailableQty, line.domesticAllocatedQty, line.procurementRequiredQty, JSON.stringify(line.inventorySnapshot), line.inventoryCheckedAt,
        line.productRef.defaultSupplyMode || "待判断", text(line.supplyMode) || line.productRef.defaultSupplyMode || "待判断"]);
      addEvent(requestId, status === "draft" ? "draft_saved" : "request_submitted", status === "draft" ? "已保存现货备货草稿" : "现货备货需求已提交", `${lines.length} 个产品，共 ${lines.reduce((sum, line) => sum + line.quantity, 0)} 件`, context, { payload: { workflowVersion: 2, sourceType: text(payload.sourceType) || "manual" } });
      const response = { ok: true, idempotentReplay: false, requestId, requestNo, status, workflowVersion: 2 };
      if (storedKey) store.run("INSERT INTO stockup_idempotency (key,user_id,response_json,created_at) VALUES (?,?,?,?)", [storedKey, actor.id, JSON.stringify(response), now]);
      return response;
    });
    return result;
  }

  function updateSpotRequest(requestId, payload, context = {}) {
    const request = getRequest(text(requestId), context);
    const actor = userOf(context);
    if (request.workflowVersion !== 2) fail("只有 V2 现货备货需求可使用此编辑流程。", "not_spot_request", 409);
    if (request.status !== "draft") fail("只有草稿状态可修改需求内容。", "request_edit_state", 409);
    if (request.requesterId !== actor.id && !context.viewAll) fail("只能修改本人创建的需求。", "request_edit_forbidden", 403);
    if (number(payload.version, request.version) !== request.version) fail("需求已被其他用户更新，请刷新后重试。", "version_conflict", 409);

    const now = nowIso();
    const rawLines = Array.isArray(payload.lines) ? payload.lines : null;
    const currentRows = rawLines ? store.all("SELECT * FROM stockup_request_lines WHERE request_id=?", [request.id]) : [];
    const currentById = new Map(currentRows.map((line) => [text(line.id), line]));

    return store.transaction(() => {
      let nextLines = rawLines?.map((line, index) => {
        const quantity = number(line.requestedQty);
        if (quantity <= 0) fail(`第 ${index + 1} 行需求数量必须大于 0。`, "invalid_quantity");
        const current = currentById.get(text(line.id));
        let productRef = ensureProductRef({ ...line, productRefId: text(line.productRefId || current?.product_ref_id) }, now);
        if (productRef.codingStatus === "temporary") {
          store.run(`UPDATE stockup_product_refs SET product_name=?,image_url=?,specification=?,shelf_life_managed=?,updated_at=? WHERE id=?`, [required(line.productName || productRef.productName, "产品名称"), text(line.imageUrl || productRef.imageUrl), text(line.specification || productRef.specification), line.shelfLifeManaged == null ? (productRef.shelfLifeManaged ? 1 : 0) : (line.shelfLifeManaged ? 1 : 0), now, productRef.id]);
          productRef = productRefFromRow(store.first("SELECT * FROM stockup_product_refs WHERE id=?", [productRef.id]));
        }
        return { id: current?.id || id("srl"), input: line, quantity, productRef, sku: productRef.formalSku || productRef.temporarySku };
      });
      if (nextLines && !nextLines.length) fail("请至少添加一个产品。", "request_lines_required");
      if (nextLines && new Set(nextLines.map((line) => line.productRef.id)).size !== nextLines.length) fail("同一商品不能在需求中重复添加。", "duplicate_product_ref");
      if (nextLines) nextLines = planInventory(nextLines, context);
      store.run(`UPDATE stockup_requests SET project=?,destination_country=?,destination_warehouse_id=?,destination_warehouse_name=?,expected_arrival_at=?,priority=?,reason=?,platform=?,note=?,version=version+1,updated_at=? WHERE id=?`, [required(payload.project ?? request.project, "项目/团队"), required(payload.destinationCountry ?? request.destinationCountry, "目的国家"), text(payload.destinationWarehouseId ?? request.destinationWarehouseId), required(payload.destinationWarehouseName ?? request.destinationWarehouseName, "目的仓库"), required(payload.expectedArrivalAt ?? request.expectedArrivalAt, "期望到仓日期"), text(payload.priority ?? request.priority) || "常规", required(payload.reason ?? request.reason, "需求原因"), text(payload.platform ?? request.platform), text(payload.note ?? request.note), now, request.id]);
      if (nextLines) {
        store.run("DELETE FROM stockup_request_lines WHERE request_id=?", [request.id]);
        for (const line of nextLines) store.run(`INSERT INTO stockup_request_lines
          (id,request_id,product_id,sku,product_name,image_url,specification,method,requested_qty,unit,target_unit_cost_cny,expected_arrival_at,note,status,fulfilled_qty,created_at,updated_at,product_ref_id,procurement_url,shelf_life_managed,domestic_available_qty,domestic_allocated_qty,procurement_required_qty,inventory_snapshot_json,inventory_checked_at,default_supply_mode,effective_supply_mode)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',0,?,?,?,?,?,?,?,?,?,?,?,?)`, [line.id, request.id, line.productRef.productId, line.sku, line.productRef.productName, line.productRef.imageUrl, line.productRef.specification, line.method, line.quantity, text(line.input.unit) || "件", line.input.targetUnitCostCny === "" || line.input.targetUnitCostCny == null ? null : number(line.input.targetUnitCostCny), text(line.input.expectedArrivalAt), text(line.input.note), now, now, line.productRef.id, text(line.input.procurementUrl || line.input.orderUrl), line.productRef.shelfLifeManaged ? 1 : 0, line.domesticAvailableQty, line.domesticAllocatedQty, line.procurementRequiredQty, JSON.stringify(line.inventorySnapshot), line.inventoryCheckedAt, line.productRef.defaultSupplyMode || "待判断", text(line.input.supplyMode) || line.productRef.defaultSupplyMode || "待判断"]);
      }
      addEvent(request.id, "request_updated", "现货备货草稿已修订", text(payload.note) || "已更新基本信息或产品清单", context);
      return { ok: true, request: getRequest(request.id, { ...context, viewAll: true }) };
    });
  }

  function listProductRefs(filters = {}) {
    const where = [];
    const params = [];
    if (filters.codingStatus) { where.push("coding_status=?"); params.push(text(filters.codingStatus)); }
    if (filters.keyword) { where.push("(temporary_sku LIKE ? OR formal_sku LIKE ? OR product_name LIKE ?)"); const value = `%${text(filters.keyword)}%`; params.push(value, value, value); }
    return { ok: true, productRefs: store.all(`SELECT * FROM stockup_product_refs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 300`, params).map(productRefFromRow) };
  }

  function bindFormalSku(productRefId, payload, context = {}) {
    const current = productRefFromRow(store.first("SELECT * FROM stockup_product_refs WHERE id=?", [text(productRefId)]));
    if (!current) fail("商品引用不存在。", "product_ref_not_found", 404);
    const formalSku = required(payload.formalSku, "正式 SKU").replace(/\s+/g, "").toUpperCase();
    const duplicate = store.first("SELECT id FROM stockup_product_refs WHERE formal_sku=? AND id!=?", [formalSku, current.id]);
    if (duplicate) fail("正式 SKU 已绑定到其他商品。", "formal_sku_conflict", 409);
    if (current.formalSku === formalSku && current.codingStatus === "coded") return { ok: true, idempotentReplay: true, productRef: current };
    const warehouseIds = store.all(`SELECT DISTINCT w.domestic_warehouse_id FROM stockup_warehouse_work_orders w JOIN stockup_warehouse_work_order_lines l ON l.work_order_id=w.id WHERE l.product_ref_id=? AND w.status IN ('inventory_ready','completed','ready_to_ship','partially_shipped')`, [current.id]).map((row) => text(row.domestic_warehouse_id)).filter(Boolean);
    try {
      for (const warehouseId of warehouseIds) inventoryGateway.recodeSku?.({ warehouseId, oldSku: current.formalSku || current.temporarySku, newSku: formalSku, productId: text(payload.productId || current.productId), productName: text(payload.productName || current.productName), referenceNo: `product-ref:${current.id}` }, context);
    } catch (error) {
      store.run("UPDATE stockup_product_refs SET coding_status='sync_failed',coding_error=?,updated_at=? WHERE id=?", [text(error?.message || "国内库存重编码失败"), nowIso(), current.id]);
      store.persist();
      throw error;
    }
    const actor = userOf(context);
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_product_refs SET formal_sku=?,product_id=COALESCE(NULLIF(?,''),product_id),product_name=COALESCE(NULLIF(?,''),product_name),coding_status='coded',coding_error='',coded_at=?,coded_by=?,updated_at=? WHERE id=?", [formalSku, text(payload.productId), text(payload.productName), now, actor.name, now, current.id]);
      store.run("UPDATE stockup_request_lines SET sku=?,product_id=COALESCE(NULLIF(?,''),product_id),updated_at=? WHERE product_ref_id=?", [formalSku, text(payload.productId), now, current.id]);
      store.run("UPDATE stockup_warehouse_work_order_lines SET sku=? WHERE product_ref_id=?", [formalSku, current.id]);
      store.run("UPDATE stockup_shipment_lines SET sku=? WHERE product_ref_id=? AND shipment_id IN (SELECT id FROM stockup_shipments WHERE status NOT IN ('handed_over','shipped','arrived'))", [formalSku, current.id]);
      return { ok: true, idempotentReplay: false, productRef: productRefFromRow(store.first("SELECT * FROM stockup_product_refs WHERE id=?", [current.id])) };
    });
  }

  function updateRequestLineProcurement(requestLineId, payload, context = {}) {
    const line = store.first(`SELECT l.*,r.workflow_version,r.status AS request_status,r.version AS request_version
      FROM stockup_request_lines l JOIN stockup_requests r ON r.id=l.request_id WHERE l.id=?`, [text(requestLineId)]);
    if (!line || number(line.workflow_version) !== 2) fail("现货备货商品不存在。", "purchase_request_line_not_found", 404);
    if (payload.requestVersion != null && number(payload.requestVersion) !== number(line.request_version)) fail("备货需求已被其他用户更新，请刷新后重试。", "version_conflict", 409);
    const action = text(payload.action);
    if (!["close", "reopen"].includes(action)) fail("采购处理动作无效。", "procurement_line_action_invalid");
    const request = getRequest(text(line.request_id), { ...context, viewAll: true });
    const currentLine = request.lines.find((item) => item.id === text(line.id));
    if (!currentLine) fail("当前账号无权处理该商品。", "purchase_request_line_forbidden", 403);
    const now = nowIso();
    const actor = userOf(context);

    if (action === "close") {
      if (text(line.status) === "procurement_cancelled") return { ok: true, idempotentReplay: true, request };
      if (!["submitted", "purchasing"].includes(text(line.request_status))) fail("当前备货需求状态不能终止采购。", "procurement_line_state", 409);
      const reason = required(payload.reason, "终止采购原因");
      const activePurchasedQty = number(store.first("SELECT SUM(quantity-cancelled_qty) AS qty FROM stockup_purchase_order_lines WHERE request_line_id=? AND status!='cancelled'", [line.id])?.qty);
      if (activePurchasedQty > 0) fail("该商品已经产生有效采购单，请在采购单明细中登记断货/取消，不能按采购前终止处理。", "procurement_line_has_purchase", 409);
      const hasWarehouseWorkOrder = store.first("SELECT 1 AS found FROM stockup_warehouse_work_order_lines WHERE request_line_id=? LIMIT 1", [line.id]);
      if (hasWarehouseWorkOrder) fail("该商品已经生成国内仓工单，不能按采购前终止处理。", "procurement_line_has_work_order", 409);
      return store.transaction(() => {
        store.run("UPDATE stockup_request_lines SET status='procurement_cancelled',procurement_closed_reason=?,procurement_closed_at=?,procurement_closed_by=?,updated_at=? WHERE id=?", [reason, now, actor.name, now, line.id]);
        const openLineCount = number(store.first("SELECT COUNT(*) AS count FROM stockup_request_lines WHERE request_id=? AND status!='procurement_cancelled'", [line.request_id])?.count);
        const nextRequestStatus = openLineCount === 0 ? "cancelled" : text(line.request_status);
        store.run("UPDATE stockup_requests SET status=?,version=version+1,updated_at=? WHERE id=?", [nextRequestStatus, now, line.request_id]);
        addEvent(text(line.request_id), "procurement_line_closed", "商品已终止采购", `${text(line.sku)} · ${reason}`, context, { lineId: text(line.id), payload: { reason, source: "before_purchase" } });
        return { ok: true, idempotentReplay: false, request: getRequest(text(line.request_id), { ...context, viewAll: true }) };
      });
    }

    if (text(line.status) !== "procurement_cancelled") return { ok: true, idempotentReplay: true, request };
    if (!["cancelled", "submitted", "purchasing"].includes(text(line.request_status))) fail("当前备货需求状态不能恢复采购。", "procurement_line_reopen_state", 409);
    return store.transaction(() => {
      const nextRequestStatus = text(line.request_status) === "cancelled" ? "submitted" : text(line.request_status);
      store.run("UPDATE stockup_request_lines SET status=?,procurement_closed_reason='',procurement_closed_at=NULL,procurement_closed_by='',updated_at=? WHERE id=?", [nextRequestStatus, now, line.id]);
      store.run("UPDATE stockup_requests SET status=?,version=version+1,updated_at=? WHERE id=?", [nextRequestStatus, now, line.request_id]);
      addEvent(text(line.request_id), "procurement_line_reopened", "商品已恢复采购", `${text(line.sku)} · 重新进入待采购清单`, context, { lineId: text(line.id) });
      return { ok: true, idempotentReplay: false, request: getRequest(text(line.request_id), { ...context, viewAll: true }) };
    });
  }

  function purchaseFromRow(row) {
    if (!row) return null;
    const order = { id: text(row.id), purchaseNo: text(row.purchase_no), supplierName: text(row.supplier_name), platform: text(row.platform), externalOrderNo: text(row.external_order_no), orderUrl: text(row.order_url), paidTotalCny: number(row.paid_total_cny), merchandiseTotalCny: number(row.merchandise_total_cny), sharedAmountCny: number(row.shared_amount_cny), allocationMode: text(row.allocation_mode), allocationOverrideReason: text(row.allocation_override_reason), status: text(row.status), orderedAt: text(row.ordered_at), vouchers: json(row.voucher_json, []), note: text(row.note), version: number(row.version, 1), createdBy: text(row.created_by), createdByName: text(row.created_by_name), createdAt: text(row.created_at), updatedAt: text(row.updated_at), lines: [] };
    order.lines = store.all("SELECT * FROM stockup_purchase_order_lines WHERE purchase_order_id=? ORDER BY created_at,id", [order.id]).map((line) => ({
      id: text(line.id), purchaseOrderId: text(line.purchase_order_id), requestId: text(line.request_id), requestLineId: text(line.request_line_id), productRefId: text(line.product_ref_id), sku: text(line.sku_snapshot), productName: text(line.product_name), quantity: number(line.quantity), unit: text(line.unit), merchandiseAmountCny: number(line.merchandise_amount_cny), sharedAllocationCny: number(line.shared_allocation_cny), allocatedAmountCny: number(line.allocated_amount_cny), estimatedUnitCostCny: number(line.estimated_unit_cost_cny), receivedQty: number(line.received_qty), cancelledQty: number(line.cancelled_qty), refundedAmountCny: number(line.refunded_amount_cny), status: text(line.status),
    }));
    return order;
  }

  function createPurchaseOrder(payload, context = {}, idempotencyKey = "") {
    const actor = userOf(context);
    const storedKey = idempotencyKey ? `v2-purchase:${actor.id}:${idempotencyKey}` : "";
    const replay = storedKey ? store.first("SELECT response_json FROM stockup_idempotency WHERE key=?", [storedKey]) : null;
    if (replay) { const parsed = json(replay.response_json, {}); return { ok: true, idempotentReplay: true, purchaseOrder: purchaseFromRow(store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [parsed.purchaseOrderId])) }; }
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    const referencedRequestIds = new Set(rawLines.map((line) => text(store.first(
      "SELECT request_id FROM stockup_request_lines WHERE id=?",
      [text(line.requestLineId)],
    )?.request_id)).filter(Boolean));
    for (const requestId of referencedRequestIds) {
      const request = store.first("SELECT route_plan_version FROM stockup_requests WHERE id=?", [requestId]);
      if (number(request?.route_plan_version) <= 0) refreshInventoryPlan(requestId, context);
    }
    const sources = rawLines.map((line) => {
      const requestLine = store.first("SELECT l.*,r.workflow_version,r.status AS request_status FROM stockup_request_lines l JOIN stockup_requests r ON r.id=l.request_id WHERE l.id=?", [text(line.requestLineId)]);
      if (!requestLine || number(requestLine.workflow_version) !== 2) fail("采购明细必须来自现货备货 V2 需求。", "purchase_request_line_not_found", 404);
      if (!["submitted", "in_progress", "purchasing"].includes(text(requestLine.request_status))) fail("需求当前状态不能建立采购单。", "purchase_request_state", 409);
      const activePlanVersion = number(store.first("SELECT route_plan_version FROM stockup_requests WHERE id=?", [requestLine.request_id])?.route_plan_version);
      const purchaseAllocation = activePlanVersion > 0 ? store.first(`SELECT * FROM stockup_fulfillment_allocations
        WHERE request_line_id=? AND plan_version=? AND source_type='purchase' AND status NOT IN ('cancelled','superseded')
        ORDER BY created_at LIMIT 1`, [requestLine.id, activePlanVersion]) : null;
      const procurementRequiredQty = purchaseAllocation ? number(purchaseAllocation.planned_qty)
        : requestLine.procurement_required_qty == null ? number(requestLine.requested_qty) : number(requestLine.procurement_required_qty);
      const remaining = procurementRequiredQty - number(store.first("SELECT SUM(quantity-cancelled_qty) AS qty FROM stockup_purchase_order_lines WHERE request_line_id=? AND status!='cancelled'", [requestLine.id])?.qty);
      const quantity = number(line.quantity);
      if (quantity <= 0 || quantity > remaining) fail(`${requestLine.sku} 可采购数量为 ${remaining}。`, "purchase_quantity_exceeds_request", 409);
      return { ...line, id: id("spol"), requestLine, purchaseAllocation, quantity, merchandiseAmount: number(line.merchandiseAmount) };
    });
    const requestedOverrides = payload.allocationOverrides && typeof payload.allocationOverrides === "object" ? payload.allocationOverrides : null;
    const allocationOverrides = requestedOverrides ? Object.fromEntries(sources.map((line) => {
      const allocatedAmount = number(requestedOverrides[line.id] ?? requestedOverrides[text(line.requestLine.id)]);
      return [line.id, money(allocatedAmount - line.merchandiseAmount)];
    })) : null;
    const allocation = allocatePurchaseOrder({ paidTotal: payload.paidTotalCny, lines: sources.map((line) => ({ id: line.id, quantity: line.quantity, merchandiseAmount: line.merchandiseAmount })), overrides: allocationOverrides });
    if (payload.allocationOverrides && !text(payload.allocationOverrideReason)) fail("人工调整采购分摊时必须填写原因。", "allocation_reason_required");
    const allocationById = new Map(allocation.lines.map((line) => [line.id, line]));
    const now = nowIso();
    const orderId = id("spo");
    const purchaseNo = businessNo("CG");
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_purchase_orders (id,purchase_no,supplier_name,platform,external_order_no,order_url,paid_total_cny,merchandise_total_cny,shared_amount_cny,allocation_mode,allocation_override_reason,status,ordered_at,voucher_json,note,version,created_by,created_by_name,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`, [orderId, purchaseNo, required(payload.supplierName, "供应商"), text(payload.platform) || "1688", text(payload.externalOrderNo), text(payload.orderUrl), allocation.paidTotal, allocation.merchandiseTotal, allocation.sharedAmount, payload.allocationOverrides ? "manual" : "merchandise_value", text(payload.allocationOverrideReason), "ordered", text(payload.orderedAt) || now, JSON.stringify(payload.vouchers || []), text(payload.note), actor.id, actor.name, now, now]);
      const requestIds = new Set();
      for (const source of sources) {
        const allocated = allocationById.get(source.id);
        requestIds.add(text(source.requestLine.request_id));
        store.run(`INSERT INTO stockup_purchase_order_lines (id,purchase_order_id,request_id,request_line_id,product_ref_id,sku_snapshot,product_name,quantity,unit,merchandise_amount_cny,shared_allocation_cny,allocated_amount_cny,estimated_unit_cost_cny,received_qty,cancelled_qty,refunded_amount_cny,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,'ordered',?,?)`, [source.id, orderId, source.requestLine.request_id, source.requestLine.id, source.requestLine.product_ref_id, source.requestLine.sku, source.requestLine.product_name, source.quantity, source.requestLine.unit, source.merchandiseAmount, allocated.sharedAllocation, allocated.allocatedAmount, allocated.estimatedUnitCost, now, now]);
        if (source.purchaseAllocation) store.run("UPDATE stockup_fulfillment_allocations SET status='ordered',reference_type='purchase_order_line',reference_id=?,reference_no=?,version=version+1,updated_at=? WHERE id=?", [source.id, purchaseNo, now, source.purchaseAllocation.id]);
        store.run(`INSERT INTO stockup_cost_items (id,request_id,shipment_id,receipt_id,category,name,stage,vendor,invoice_no,occurred_at,original_amount,currency,exchange_rate,amount_cny,included,allocation_method,note,status,created_by,created_at,updated_at,purchase_order_id,purchase_order_line_id,loss_treatment)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [`purchase-line:${source.id}`, source.requestLine.request_id, "", "", "purchase", `${purchaseNo} · ${source.requestLine.sku}`, "采购", text(payload.supplierName), text(payload.externalOrderNo), (text(payload.orderedAt) || now).slice(0, 10), allocated.allocatedAmount, "CNY", 1, allocated.allocatedAmount, 1, "purchase_line", text(payload.note), "recorded", actor.id, now, now, orderId, source.id, "pending"]);
      }
      for (const requestId of requestIds) {
        store.run("UPDATE stockup_requests SET status='purchasing',version=version+1,updated_at=? WHERE id=? AND workflow_version=2", [now, requestId]);
        addEvent(requestId, "purchase_order_created", "1688 采购单已登记", `${purchaseNo} · 实付 ¥${allocation.paidTotal}`, context, { payload: { purchaseOrderId: orderId } });
      }
      if (storedKey) store.run("INSERT INTO stockup_idempotency (key,user_id,response_json,created_at) VALUES (?,?,?,?)", [storedKey, actor.id, JSON.stringify({ purchaseOrderId: orderId }), now]);
      return { ok: true, idempotentReplay: false, purchaseOrder: purchaseFromRow(store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [orderId])) };
    });
  }

  function listPurchaseOrders(filters = {}) {
    const where = [];
    const params = [];
    if (filters.status) { where.push("status=?"); params.push(text(filters.status)); }
    if (filters.requestId) { where.push("id IN (SELECT purchase_order_id FROM stockup_purchase_order_lines WHERE request_id=?)"); params.push(text(filters.requestId)); }
    return { ok: true, purchaseOrders: store.all(`SELECT * FROM stockup_purchase_orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 300`, params).map(purchaseFromRow) };
  }

  function updatePurchaseOrder(purchaseOrderId, payload, context = {}) {
    const orderRow = store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [text(purchaseOrderId)]);
    if (!orderRow) fail("采购单不存在。", "purchase_order_not_found", 404);
    const order = purchaseFromRow(orderRow);
    if (number(payload.version, order.version) !== order.version) fail("采购单已被其他用户更新，请刷新后重试。", "version_conflict", 409);
    const hasProgress = order.lines.some((line) => line.receivedQty > 0 || line.cancelledQty > 0 || line.refundedAmountCny > 0 || line.status !== "ordered");
    const lineIds = order.lines.map((line) => line.id);
    const hasWarehouseWorkOrder = lineIds.length && store.first(`SELECT 1 AS found FROM stockup_warehouse_work_order_lines WHERE purchase_order_line_id IN (${lineIds.map(() => "?").join(",")}) LIMIT 1`, lineIds);
    if (hasProgress || hasWarehouseWorkOrder) fail("该采购单已产生到货、退款或国内仓工单，为避免成本账被改写，不能再修改价格分摊。", "purchase_order_edit_locked", 409);

    const inputById = new Map((Array.isArray(payload.lines) ? payload.lines : []).map((line) => [text(line.id || line.purchaseOrderLineId), line]));
    const sources = order.lines.map((line) => {
      const input = inputById.get(line.id) || {};
      return { id: line.id, quantity: line.quantity, merchandiseAmount: number(input.merchandiseAmount ?? input.merchandiseAmountCny ?? line.merchandiseAmountCny), current: line };
    });
    const requestedOverrides = payload.allocationOverrides && typeof payload.allocationOverrides === "object" ? payload.allocationOverrides : null;
    const allocationOverrides = requestedOverrides ? Object.fromEntries(sources.map((line) => {
      const allocatedAmount = number(requestedOverrides[line.id]);
      return [line.id, money(allocatedAmount - line.merchandiseAmount)];
    })) : null;
    const allocation = allocatePurchaseOrder({ paidTotal: payload.paidTotalCny ?? order.paidTotalCny, lines: sources, overrides: allocationOverrides });
    if (requestedOverrides && !text(payload.allocationOverrideReason)) fail("人工调整采购分摊时必须填写原因。", "allocation_reason_required");
    const allocationById = new Map(allocation.lines.map((line) => [line.id, line]));
    const supplierName = required(payload.supplierName ?? order.supplierName, "供应商");
    const externalOrderNo = text(payload.externalOrderNo ?? order.externalOrderNo);
    const orderedAt = text(payload.orderedAt ?? order.orderedAt) || nowIso();
    const note = text(payload.note ?? order.note);
    const now = nowIso();
    const requestIds = [...new Set(order.lines.map((line) => line.requestId).filter(Boolean))];
    return store.transaction(() => {
      store.run(`UPDATE stockup_purchase_orders SET supplier_name=?,external_order_no=?,order_url=?,paid_total_cny=?,merchandise_total_cny=?,shared_amount_cny=?,allocation_mode=?,allocation_override_reason=?,ordered_at=?,note=?,version=version+1,updated_at=? WHERE id=?`,
        [supplierName, externalOrderNo, text(payload.orderUrl ?? order.orderUrl), allocation.paidTotal, allocation.merchandiseTotal, allocation.sharedAmount, requestedOverrides ? "manual" : "merchandise_value", text(payload.allocationOverrideReason), orderedAt, note, now, order.id]);
      for (const source of sources) {
        const allocated = allocationById.get(source.id);
        store.run("UPDATE stockup_purchase_order_lines SET merchandise_amount_cny=?,shared_allocation_cny=?,allocated_amount_cny=?,estimated_unit_cost_cny=?,updated_at=? WHERE id=?", [source.merchandiseAmount, allocated.sharedAllocation, allocated.allocatedAmount, allocated.estimatedUnitCost, now, source.id]);
        store.run("UPDATE stockup_cost_items SET vendor=?,invoice_no=?,occurred_at=?,original_amount=?,amount_cny=?,allocation_method=?,note=?,updated_at=? WHERE id=?", [supplierName, externalOrderNo, orderedAt.slice(0, 10), allocated.allocatedAmount, allocated.allocatedAmount, requestedOverrides ? "manual" : "purchase_line", note, now, `purchase-line:${source.id}`]);
      }
      for (const requestId of requestIds) addEvent(requestId, "purchase_order_updated", "采购单价格与分摊已修订", `${order.purchaseNo} · 实付 ¥${allocation.paidTotal}`, context, { payload: { purchaseOrderId: order.id, previousVersion: order.version } });
      return { ok: true, purchaseOrder: purchaseFromRow(store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [order.id])) };
    });
  }

  function recordPurchaseEvent(purchaseOrderId, payload, context = {}) {
    const order = store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [text(purchaseOrderId)]);
    const line = store.first("SELECT * FROM stockup_purchase_order_lines WHERE id=? AND purchase_order_id=?", [text(payload.lineId), text(purchaseOrderId)]);
    if (!order || !line) fail("采购单或采购明细不存在。", "purchase_line_not_found", 404);
    const action = text(payload.action);
    if (!["receive", "cancel", "refund", "reship"].includes(action)) fail("采购事件类型无效。", "purchase_event_action");
    const quantity = number(payload.quantity);
    const amount = money(payload.amountCny);
    let receivedQty = number(line.received_qty);
    let cancelledQty = number(line.cancelled_qty);
    let refundedAmountCny = number(line.refunded_amount_cny);
    if (action === "receive") {
      if (quantity <= 0 || receivedQty + quantity > number(line.quantity) - cancelledQty) fail("本次到货数量超过采购明细剩余数量。", "purchase_receive_overflow", 409);
      receivedQty = money(receivedQty + quantity);
    } else if (action === "cancel") {
      if (quantity <= 0 || cancelledQty + receivedQty + quantity > number(line.quantity)) fail("断货/取消数量超过未到货数量。", "purchase_cancel_overflow", 409);
      cancelledQty = money(cancelledQty + quantity);
    } else if (action === "refund") {
      if (amount <= 0 || refundedAmountCny + amount > number(line.allocated_amount_cny)) fail("退款金额超过该行已分摊采购金额。", "purchase_refund_overflow", 409);
      refundedAmountCny = money(refundedAmountCny + amount);
      if (quantity > 0) {
        if (cancelledQty + receivedQty + quantity > number(line.quantity)) fail("退款取消数量超过未到货数量。", "purchase_refund_quantity_overflow", 409);
        cancelledQty = money(cancelledQty + quantity);
      }
    }
    const lineStatus = action === "reship" ? "reshipping" : receivedQty >= number(line.quantity) - cancelledQty ? "received" : receivedQty > 0 ? "partially_received" : cancelledQty >= number(line.quantity) ? "cancelled" : "ordered";
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_purchase_order_lines SET received_qty=?,cancelled_qty=?,refunded_amount_cny=?,status=?,updated_at=? WHERE id=?", [receivedQty, cancelledQty, refundedAmountCny, lineStatus, now, line.id]);
      const lineRows = store.all("SELECT status FROM stockup_purchase_order_lines WHERE purchase_order_id=?", [order.id]);
      const orderStatus = lineRows.every((item) => ["received", "cancelled"].includes(text(item.status))) ? "completed" : lineRows.some((item) => ["partially_received", "received", "reshipping"].includes(text(item.status))) ? "partially_received" : "ordered";
      store.run("UPDATE stockup_purchase_orders SET status=?,version=version+1,updated_at=? WHERE id=?", [orderStatus, now, order.id]);
      store.run("UPDATE stockup_cost_items SET original_amount=?,amount_cny=?,note=TRIM(COALESCE(note,'') || ?),updated_at=? WHERE id=?", [money(number(line.allocated_amount_cny) - refundedAmountCny), money(number(line.allocated_amount_cny) - refundedAmountCny), payload.note ? `；${text(payload.note)}` : "", now, `purchase-line:${line.id}`]);
      addEvent(text(line.request_id), `purchase_${action}`, { receive: "采购部分到货", cancel: "采购断货/取消", refund: "采购退款已登记", reship: "采购补发已登记" }[action], `${text(order.purchase_no)} · ${text(line.sku_snapshot)}${quantity ? ` · ${quantity}` : ""}${amount ? ` · ¥${amount}` : ""}`, context, { payload: { purchaseOrderId: order.id, purchaseOrderLineId: line.id, action, quantity, amountCny: amount, note: text(payload.note) } });
      return { ok: true, purchaseOrder: purchaseFromRow(store.first("SELECT * FROM stockup_purchase_orders WHERE id=?", [order.id])) };
    });
  }

  function submitInspection(workOrderId, payload, context = {}) {
    const workOrder = store.first("SELECT * FROM stockup_warehouse_work_orders WHERE id=?", [text(workOrderId)]);
    if (!workOrder || number(workOrder.workflow_version) !== 2) fail("现货验货工单不存在。", "inspection_work_order_not_found", 404);
    if (text(workOrder.status) === "inspection_review") return { ok: true, idempotentReplay: true, workOrderId: workOrder.id, status: "inspection_review", exceptionCount: number(workOrder.exception_count) };
    if (!["waiting_receipt", "inspecting", "warehouse_inspection"].includes(text(workOrder.status))) fail("当前工单状态不能提交验货。", "inspection_state", 409);
    const inputLines = Array.isArray(payload.lines) ? payload.lines : [];
    const currentLines = store.all(`SELECT wl.*,rl.shelf_life_managed FROM stockup_warehouse_work_order_lines wl
      JOIN stockup_request_lines rl ON rl.id=wl.request_line_id WHERE wl.work_order_id=? ORDER BY wl.id`, [workOrder.id]);
    if (inputLines.length !== currentLines.length) fail("请完整提交工单内全部商品的验货结果。", "inspection_incomplete");
    const normalized = inputLines.map((input) => {
      const line = currentLines.find((item) => text(item.id) === text(input.id || input.workOrderLineId));
      if (!line) fail("验货商品不属于当前工单。", "inspection_line_not_found");
      return { line, values: validateInspectionLine({ ...input, expectedQty: number(line.expected_qty), lots: (Array.isArray(input.lots) ? input.lots : []).map((lot) => ({ ...lot, shelfLifeManaged: Boolean(line.shelf_life_managed) })) }) };
    });
    const now = nowIso();
    return store.transaction(() => {
      store.run("DELETE FROM stockup_inspection_evidence WHERE work_order_id=?", [workOrder.id]);
      store.run("DELETE FROM stockup_inspection_lots WHERE work_order_id=?", [workOrder.id]);
      let exceptions = 0;
      for (const { line, values } of normalized) {
        exceptions += (values.damagedQty > 0 ? 1 : 0) + (values.shortageQty > 0 ? 1 : 0) + (values.pendingQty > 0 ? 1 : 0);
        const representative = values.lots[0] || {};
        const source = inputLines.find((item) => text(item.id || item.workOrderLineId) === text(line.id));
        store.run(`UPDATE stockup_warehouse_work_order_lines SET received_qty=?,good_qty=?,damaged_qty=?,shortage_qty=?,pending_qty=?,requires_repack=?,replacement_carton_count=?,lot_no=?,barcode=?,production_date=?,expiry_date=?,carton_count=?,units_per_carton=?,carton_length_cm=?,carton_width_cm=?,carton_height_cm=?,carton_weight_kg=?,inspection_note=?,evidence_json=?,status='inspection_review',updated_at=? WHERE id=?`,
          [values.receivedQty, values.goodQty, values.damagedQty, values.shortageQty, values.pendingQty, source.requiresRepack ? 1 : 0, number(source.replacementCartonCount), text(representative.lotNo), text(representative.barcode), text(representative.productionDate), text(representative.expiryDate), number(representative.cartonCount), number(representative.unitsPerCarton), number(representative.cartonLengthCm), number(representative.cartonWidthCm), number(representative.cartonHeightCm), number(representative.cartonWeightKg), text(source.inspectionNote), JSON.stringify(values.evidence), now, line.id]);
        for (const lot of values.lots) store.run(`INSERT INTO stockup_inspection_lots (id,work_order_id,work_order_line_id,product_ref_id,purchase_order_line_id,quantity,lot_no,barcode,production_date,expiry_date,carton_count,units_per_carton,loose_quantity,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?)`, [id("sil"), workOrder.id, line.id, text(line.product_ref_id), text(line.purchase_order_line_id) || null, number(lot.quantity), required(lot.lotNo, "批次号"), required(lot.barcode, "条码"), required(lot.productionDate, "生产日期"), text(lot.expiryDate), number(lot.cartonCount), number(lot.unitsPerCarton), number(lot.looseQuantity), number(lot.cartonLengthCm), number(lot.cartonWidthCm), number(lot.cartonHeightCm), number(lot.cartonWeightKg), now, now]);
        for (const evidence of values.evidence) store.run("INSERT INTO stockup_inspection_evidence (id,work_order_id,work_order_line_id,kind,attachment_id,file_name,created_at) VALUES (?,?,?,?,?,?,?)", [id("sie"), workOrder.id, line.id, required(evidence.kind, "凭证类型"), required(evidence.attachmentId, "附件"), text(evidence.fileName), now]);
      }
      if (Array.isArray(payload.expenses)) {
        for (const expense of payload.expenses) store.run(`INSERT INTO stockup_warehouse_expenses (id,work_order_id,category,name,amount_cny,occurred_at,vendor,invoice_no,voucher_url,note,review_status,included_in_cost,created_by,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending_review',1,?,?,?,?)`, [id("swwe"), workOrder.id, required(expense.category, "费用类型"), required(expense.name || expense.category, "费用名称"), money(expense.amountCny), text(expense.occurredAt) || now.slice(0, 10), text(expense.vendor), text(expense.invoiceNo), text(expense.voucherUrl), text(expense.note), userOf(context).id, userOf(context).name, now, now]);
      }
      store.run("UPDATE stockup_warehouse_work_orders SET status='inspection_review',inspection_submitted_at=?,exception_count=?,version=version+1,updated_at=? WHERE id=?", [now, exceptions, now, workOrder.id]);
      store.run("UPDATE stockup_requests SET status='inspection_review',version=version+1,updated_at=? WHERE id=? AND workflow_version=2", [now, workOrder.request_id]);
      addEvent(workOrder.request_id, "inspection_submitted", "国内仓已提交验货", `${text(workOrder.work_order_no)} · ${normalized.length} 个商品`, context, { payload: { workOrderId: workOrder.id, exceptions } });
      return { ok: true, workOrderId: workOrder.id, status: "inspection_review", exceptionCount: exceptions };
    });
  }

  function reviewInspection(workOrderId, payload, context = {}) {
    const workOrder = store.first("SELECT * FROM stockup_warehouse_work_orders WHERE id=?", [text(workOrderId)]);
    if (!workOrder || number(workOrder.workflow_version) !== 2) fail("现货验货工单不存在。", "inspection_work_order_not_found", 404);
    if (text(workOrder.status) === "inventory_ready" && text(payload.action) === "approve") return { ok: true, idempotentReplay: true, workOrderId: workOrder.id, status: "inventory_ready", inventoryMovementId: json(workOrder.inventory_movement_ids_json, [])[0] || "" };
    if (text(workOrder.status) !== "inspection_review") fail("只有待审核验货单可以复核。", "inspection_review_state", 409);
    const action = text(payload.action);
    const now = nowIso();
    if (action === "reject") return store.transaction(() => {
      store.run("UPDATE stockup_warehouse_work_orders SET status='warehouse_inspection',inspection_review_note=?,version=version+1,updated_at=? WHERE id=?", [required(payload.note, "退回原因"), now, workOrder.id]);
      store.run("UPDATE stockup_requests SET status='warehouse_inspection',version=version+1,updated_at=? WHERE id=?", [now, workOrder.request_id]);
      addEvent(workOrder.request_id, "inspection_rejected", "验货数据已退回", text(payload.note), context, { payload: { workOrderId: workOrder.id } });
      return { ok: true, workOrderId: workOrder.id, status: "warehouse_inspection" };
    });
    if (action !== "approve") fail("验货复核动作无效。", "inspection_review_action");
    const lots = store.all(`SELECT l.*,wl.sku,wl.product_name,wl.image_url,wl.unit,wl.request_line_id,rl.specification,po.allocated_amount_cny,po.refunded_amount_cny,po.quantity AS purchase_qty,pr.formal_sku,pr.temporary_sku
      FROM stockup_inspection_lots l JOIN stockup_warehouse_work_order_lines wl ON wl.id=l.work_order_line_id JOIN stockup_request_lines rl ON rl.id=wl.request_line_id
      LEFT JOIN stockup_purchase_order_lines po ON po.id=l.purchase_order_line_id LEFT JOIN stockup_product_refs pr ON pr.id=l.product_ref_id WHERE l.work_order_id=? ORDER BY l.created_at,l.id`, [workOrder.id]);
    if (!lots.length) fail("验货单没有可入库的良品批次。", "inspection_lots_required", 409);
    const inbound = inventoryGateway.createInspectionInbound?.({
      warehouseId: text(workOrder.domestic_warehouse_id), referenceNo: text(workOrder.work_order_no), note: `备货验货审核入库：${text(workOrder.work_order_no)}`, lines: lots.map((lot) => ({
        sourceLineId: text(lot.id), productId: "", sku: text(lot.formal_sku || lot.temporary_sku || lot.sku), productName: text(lot.product_name), imageUrl: text(lot.image_url), specification: text(lot.specification), unit: text(lot.unit) || "件", quantity: number(lot.quantity),
        unitCostCny: number(lot.purchase_qty) > 0 ? money((number(lot.allocated_amount_cny) - number(lot.refunded_amount_cny)) / number(lot.purchase_qty)) : 0,
        packagingMode: number(lot.carton_count) > 0 ? "carton" : "piece", lotNo: text(lot.lot_no), barcode: text(lot.barcode), productionDate: text(lot.production_date), expiryDate: text(lot.expiry_date), cartonCount: number(lot.carton_count), unitsPerCarton: number(lot.units_per_carton), looseQuantity: number(lot.loose_quantity), cartonLengthCm: number(lot.carton_length_cm), cartonWidthCm: number(lot.carton_width_cm), cartonHeightCm: number(lot.carton_height_cm), cartonWeightKg: number(lot.carton_weight_kg),
      })),
    }, context);
    if (!inbound?.movementId) fail("国内库存入库服务未返回流水号。", "inspection_inventory_failed", 503);
    const resultBySource = new Map((inbound.lines || []).map((line) => [text(line.sourceLineId), line]));
    const allocationLines = store.all(`SELECT wl.fulfillment_allocation_id,wl.sku,wl.good_qty,a.planned_qty,a.ready_qty
      FROM stockup_warehouse_work_order_lines wl
      LEFT JOIN stockup_fulfillment_allocations a ON a.id=wl.fulfillment_allocation_id
      WHERE wl.work_order_id=? AND COALESCE(wl.fulfillment_allocation_id,'')!=''`, [workOrder.id]);
    const inboundReservations = new Map();
    const reservationErrors = new Map();
    for (const line of allocationLines) {
      const acceptedQty = Math.max(0, Math.min(number(line.good_qty), number(line.planned_qty) - number(line.ready_qty)));
      if (acceptedQty <= 0) continue;
      try {
        const reservation = inventoryGateway.reserveStock?.({
          warehouseId: text(workOrder.domestic_warehouse_id),
          referenceNo: `stockup-inbound:${text(workOrder.work_order_no)}:${text(line.fulfillment_allocation_id)}`,
          note: `备货验收入库后自动锁定：${text(workOrder.work_order_no)}`,
          lines: [{ sku: text(line.sku), quantity: acceptedQty }],
        }, context, `stockup-inbound:${workOrder.id}:${text(line.fulfillment_allocation_id)}`);
        if (!reservation?.reservation?.id) reservationErrors.set(text(line.fulfillment_allocation_id), "验收入库成功，但自动锁定库存未返回预留编号。");
        else inboundReservations.set(text(line.fulfillment_allocation_id), reservation.reservation);
      } catch (error) {
        reservationErrors.set(text(line.fulfillment_allocation_id), error?.message || "验收入库成功，但自动锁定库存失败。");
      }
    }
    const reservationError = [...reservationErrors.values()].join("；");
    return store.transaction(() => {
      for (const lot of lots) {
        const result = resultBySource.get(text(lot.id));
        store.run("UPDATE stockup_inspection_lots SET inventory_lot_id=?,inventory_movement_id=?,status='approved',updated_at=? WHERE id=?", [text(result?.lotId), inbound.movementId, now, lot.id]);
      }
      store.run("UPDATE stockup_warehouse_work_order_lines SET status='approved',updated_at=? WHERE work_order_id=?", [now, workOrder.id]);
      const requestLineIds = [...new Set(store.all("SELECT request_line_id FROM stockup_warehouse_work_order_lines WHERE work_order_id=?", [workOrder.id]).map((line) => text(line.request_line_id)).filter(Boolean))];
      for (const requestLineId of requestLineIds) {
        const approvedGoodQty = number(store.first(`SELECT SUM(wl.good_qty) AS qty
          FROM stockup_warehouse_work_order_lines wl
          JOIN stockup_warehouse_work_orders wo ON wo.id=wl.work_order_id
          WHERE wl.request_line_id=? AND wl.status='approved' AND wo.status!='cancelled'`, [requestLineId])?.qty);
        store.run("UPDATE stockup_request_lines SET fulfilled_qty=?,updated_at=? WHERE id=?", [approvedGoodQty, now, requestLineId]);
      }
      for (const line of allocationLines) {
        const acceptedQty = Math.max(0, Math.min(number(line.good_qty), number(line.planned_qty) - number(line.ready_qty)));
        if (acceptedQty <= 0) continue;
        const lineReservation = inboundReservations.get(text(line.fulfillment_allocation_id));
        const lineReservationError = reservationErrors.get(text(line.fulfillment_allocation_id));
        if (lineReservationError || !lineReservation?.id) {
          store.run("UPDATE stockup_fulfillment_allocations SET received_qty=MIN(planned_qty,received_qty+?),status='reservation_recovery_required',exception_qty=MAX(exception_qty,?),version=version+1,updated_at=? WHERE id=?", [acceptedQty, acceptedQty, now, line.fulfillment_allocation_id]);
        } else {
          store.run(`UPDATE stockup_fulfillment_allocations SET received_qty=MIN(planned_qty,received_qty+?),reserved_qty=MIN(planned_qty,reserved_qty+?),ready_qty=MIN(planned_qty,ready_qty+?),
            status=CASE WHEN ready_qty+?>=planned_qty THEN 'ready' ELSE 'waiting_inbound' END,external_reservation_id=?,version=version+1,updated_at=? WHERE id=?`,
          [acceptedQty, acceptedQty, acceptedQty, acceptedQty, text(lineReservation.id), now, line.fulfillment_allocation_id]);
          store.run(`INSERT INTO stockup_fulfillment_reservations
            (id,allocation_id,external_reservation_id,warehouse_id,sku,quantity,status,shipment_id,reference_no,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'reserved','','',?,?)`, [id("sfr"), line.fulfillment_allocation_id, lineReservation.id, text(workOrder.domestic_warehouse_id), text(line.sku), acceptedQty, now, now]);
        }
      }
      store.run("UPDATE stockup_warehouse_work_orders SET status='inventory_ready',inspection_reviewed_at=?,inspection_reviewed_by=?,inspection_review_note=?,inventory_movement_ids_json=?,version=version+1,updated_at=? WHERE id=?", [now, userOf(context).name, text(payload.note), JSON.stringify([inbound.movementId]), now, workOrder.id]);
      const routeVersion = number(store.first("SELECT route_plan_version FROM stockup_requests WHERE id=?", [workOrder.request_id])?.route_plan_version);
      const allocationBalance = routeVersion > 0 ? store.first(`SELECT COALESCE(SUM(planned_qty),0) AS planned,COALESCE(SUM(ready_qty+shipped_qty),0) AS ready,
        SUM(CASE WHEN status='reservation_recovery_required' THEN 1 ELSE 0 END) AS recovery FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=?`, [workOrder.request_id, routeVersion]) : null;
      if (number(allocationBalance?.recovery) > 0) store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='route_recovery',version=version+1,updated_at=? WHERE id=?", [now, workOrder.request_id]);
      else if (number(allocationBalance?.planned) > 0 && number(allocationBalance?.ready) >= number(allocationBalance?.planned)) store.run("UPDATE stockup_requests SET status='inventory_ready',journey_stage='ready_to_ship',version=version+1,updated_at=? WHERE id=?", [now, workOrder.request_id]);
      else store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='consolidating',version=version+1,updated_at=? WHERE id=?", [now, workOrder.request_id]);
      addEvent(workOrder.request_id, "inspection_approved", "验货审核通过并入国内库存", `${text(workOrder.work_order_no)} · 库存流水 ${inbound.movementNo || inbound.movementId}`, context, { payload: { workOrderId: workOrder.id, inventoryMovementId: inbound.movementId } });
      if (reservationError) addEvent(workOrder.request_id, "route_reservation_recovery_required", "入库完成，库存锁定等待恢复", reservationError, context, { payload: { workOrderId: workOrder.id, inventoryMovementId: inbound.movementId } });
      return { ok: true, workOrderId: workOrder.id, status: reservationError ? "reservation_recovery_required" : "inventory_ready", inventoryMovementId: inbound.movementId, reservationError };
    });
  }

  function createForwarder(payload) {
    const now = nowIso();
    const forwarderId = id("sff");
    return store.transaction(() => {
      store.run("INSERT INTO stockup_forwarders (id,code,name,status,note,version,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)", [forwarderId, required(payload.code, "货代编码").toUpperCase(), required(payload.name, "货代名称"), payload.status === "inactive" ? "inactive" : "active", text(payload.note), now, now]);
      for (const location of Array.isArray(payload.locations) ? payload.locations : []) store.run(`INSERT INTO stockup_forwarder_locations (id,forwarder_id,name,country,province,city,address,contact_name,contact_phone,routing_requirements,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`, [id("sfl"), forwarderId, required(location.name, "收货点名称"), required(location.country, "国家"), text(location.province), text(location.city), required(location.address, "收货地址"), required(location.contactName, "联系人"), required(location.contactPhone, "联系电话"), text(location.routingRequirements), location.status === "inactive" ? "inactive" : "active", now, now]);
      return { ok: true, forwarderId };
    });
  }

  function listForwarders() {
    const items = store.all("SELECT * FROM stockup_forwarders ORDER BY name").map((row) => ({ id: text(row.id), code: text(row.code), name: text(row.name), status: text(row.status), note: text(row.note), version: number(row.version), locations: store.all("SELECT * FROM stockup_forwarder_locations WHERE forwarder_id=? ORDER BY name", [row.id]).map((location) => ({ id: text(location.id), forwarderId: text(location.forwarder_id), name: text(location.name), country: text(location.country), province: text(location.province), city: text(location.city), address: text(location.address), contactName: text(location.contact_name), contactPhone: text(location.contact_phone), routingRequirements: text(location.routing_requirements), status: text(location.status), version: number(location.version) })) }));
    return { ok: true, forwarders: items };
  }

  function createReservedShipment(payload, context = {}) {
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!rawLines.length) fail("请至少选择一个已审核批次。", "shipment_lots_required");
    const location = store.first(`SELECT l.*,f.name AS forwarder_name,f.code AS forwarder_code FROM stockup_forwarder_locations l JOIN stockup_forwarders f ON f.id=l.forwarder_id WHERE l.id=? AND l.status='active' AND f.status='active'`, [text(payload.forwarderLocationId)]);
    if (!location) fail("请选择有效的货代收货点。", "forwarder_location_required");
    const lots = rawLines.map((input) => {
      const lot = store.first(`SELECT il.*,wl.sku,wl.product_name,wl.image_url,wl.unit,wl.request_line_id,wo.request_id,wo.domestic_warehouse_id,wo.domestic_warehouse_name,r.destination_warehouse_id,r.destination_warehouse_name,r.destination_country,r.status AS request_status,pr.formal_sku,pr.temporary_sku,po.estimated_unit_cost_cny
        FROM stockup_inspection_lots il JOIN stockup_warehouse_work_order_lines wl ON wl.id=il.work_order_line_id JOIN stockup_warehouse_work_orders wo ON wo.id=il.work_order_id JOIN stockup_requests r ON r.id=wo.request_id LEFT JOIN stockup_product_refs pr ON pr.id=il.product_ref_id LEFT JOIN stockup_purchase_order_lines po ON po.id=il.purchase_order_line_id WHERE il.id=? AND il.status='approved'`, [text(input.inspectionLotId)]);
      if (!lot) fail("出运批次包含未审核或不存在的库存批次。", "shipment_inspection_lot_not_found", 404);
      // A committed reservation has already left the domestic warehouse and must
      // remain unavailable. Counting only active reservations allowed the same
      // inspection lot to become selectable again after handover.
      const reserved = number(store.first(`SELECT SUM(rl.quantity) AS qty FROM stockup_inventory_reservation_lines rl JOIN stockup_inventory_reservations r ON r.id=rl.reservation_id WHERE rl.inspection_lot_id=? AND r.status IN ('reserved','committed')`, [lot.id])?.qty);
      const quantity = number(input.quantity);
      if (quantity <= 0 || quantity > number(lot.quantity) - reserved) fail(`${text(lot.sku)} 可锁定数量不足。`, "inspection_lot_over_reserved", 409);
      const shipmentCartonCount = input.cartonCount === undefined ? number(lot.carton_count) : number(input.cartonCount);
      const shipmentUnitsPerCarton = input.unitsPerCarton === undefined ? number(lot.units_per_carton) : number(input.unitsPerCarton);
      if (!Number.isInteger(shipmentCartonCount) || shipmentCartonCount <= 0) fail(`${text(lot.sku)} 的发运箱数必须是大于 0 的整数。`, "shipment_carton_count_invalid");
      if (!Number.isInteger(shipmentUnitsPerCarton) || shipmentUnitsPerCarton <= 0) fail(`${text(lot.sku)} 的每箱数量必须是大于 0 的整数。`, "shipment_units_per_carton_invalid");
      if (shipmentCartonCount * shipmentUnitsPerCarton !== quantity) fail(`${text(lot.sku)} 的装箱数据不一致：${shipmentCartonCount} 箱 × ${shipmentUnitsPerCarton} 件/箱 = ${shipmentCartonCount * shipmentUnitsPerCarton} 件，但本次发运数量为 ${quantity} 件。`, "shipment_packaging_quantity_mismatch");
      return { ...lot, quantity, shipment_carton_count: shipmentCartonCount, shipment_units_per_carton: shipmentUnitsPerCarton };
    });
    const first = lots[0];
    if (lots.some((lot) => text(lot.destination_warehouse_id) !== text(first.destination_warehouse_id) || text(lot.domestic_warehouse_id) !== text(first.domestic_warehouse_id))) fail("合并出运必须来自同一国内仓并发往同一海外仓。", "mixed_destination", 409);
    const transportMode = required(payload.transportMode, "运输方式");
    const billingMethod = ["volume", "weight", "flat"].includes(text(payload.billingMethod)) ? text(payload.billingMethod) : "weight";
    const carrierPackages = Math.max(0, number(payload.carrierPackages));
    const carrierActualWeightKg = Math.max(0, number(payload.carrierActualWeightKg));
    const chargeableWeightKg = Math.max(0, number(payload.chargeableWeightKg));
    const chargeableVolumeM3 = Math.max(0, number(payload.chargeableVolumeM3));
    const billingUnitPriceCny = Math.max(0, money(payload.billingUnitPriceCny));
    const billingExtraFeeCny = Math.max(0, money(payload.billingExtraFeeCny));
    const billingBasis = billingMethod === "volume" ? chargeableVolumeM3 : billingMethod === "weight" ? chargeableWeightKg : 1;
    const quotedFreightCny = money(billingBasis * billingUnitPriceCny + billingExtraFeeCny);
    const shipmentId = id("sps");
    const shipmentNo = businessNo("FY");
    const reservationInput = { warehouseId: text(first.domestic_warehouse_id), referenceNo: shipmentNo, note: `备货出运锁库：${shipmentNo}`, lines: lots.map((lot) => ({ sku: text(lot.formal_sku || lot.temporary_sku || lot.sku), quantity: lot.quantity, lotId: text(lot.inventory_lot_id), unitCostCny: number(lot.estimated_unit_cost_cny) })) };
    const external = inventoryGateway.reserveStock?.(reservationInput, context);
    if (!external?.reservation?.id) fail("国内库存锁定失败。", "inventory_reservation_failed", 503);
    const now = nowIso();
    const snapshot = { forwarderId: text(location.forwarder_id), forwarderName: text(location.forwarder_name), forwarderCode: text(location.forwarder_code), locationId: text(location.id), locationName: text(location.name), country: text(location.country), province: text(location.province), city: text(location.city), address: text(location.address), contactName: text(location.contact_name), contactPhone: text(location.contact_phone), routingRequirements: text(location.routing_requirements) };
    try {
      return store.transaction(() => {
        store.run(`INSERT INTO stockup_shipments (id,request_id,shipment_no,origin_warehouse,origin_warehouse_id,origin_address,destination_warehouse_id,destination_warehouse_name,destination_country,destination_address,destination_contact_name,destination_contact_phone,carrier,transport_mode,tracking_no,etd,eta,actual_shipped_at,status,packages,total_weight_kg,total_volume_m3,chargeable_weight_kg,billing_method,carrier_packages,carrier_actual_weight_kg,chargeable_volume_m3,billing_unit_price_cny,billing_extra_fee_cny,quoted_freight_cny,note,box_mark,inventory_movement_id,wms_provider_id,wms_document_type,wms_push_status,wms_order_no,wms_push_error,wms_push_attempts,wms_pushed_at,wms_pushed_by,version,created_at,updated_at,workflow_version,forwarder_location_id,forwarder_snapshot_json,reservation_id,instruction_published_at,instruction_published_by,handed_over_at,document_version)
          VALUES (${Array(52).fill("?").join(",")})`, [
          shipmentId, first.request_id, shipmentNo, text(first.domestic_warehouse_name), text(first.domestic_warehouse_id), "", text(first.destination_warehouse_id), text(first.destination_warehouse_name), text(first.destination_country), "", "", "",
          text(payload.carrier), transportMode, optionalTrackingNumber(payload.trackingNo), text(payload.etd), text(payload.eta), "", "inventory_reserved", lots.reduce((sum, lot) => sum + number(lot.shipment_carton_count), 0),
          lots.reduce((sum, lot) => sum + number(lot.shipment_carton_count) * number(lot.carton_weight_kg), 0), lots.reduce((sum, lot) => sum + number(lot.shipment_carton_count) * number(lot.carton_length_cm) * number(lot.carton_width_cm) * number(lot.carton_height_cm) / 1_000_000, 0),
          chargeableWeightKg, billingMethod, carrierPackages, carrierActualWeightKg, chargeableVolumeM3, billingUnitPriceCny, billingExtraFeeCny, quotedFreightCny,
          text(payload.note), text(payload.boxMark), "", "", "", "not_created", "", "", 0, "", "", 1, now, now, 2, text(location.id), JSON.stringify(snapshot), external.reservation.id, "", "", "", 0,
        ]);
        const reservationId = id("sir");
        store.run("INSERT INTO stockup_inventory_reservations (id,shipment_id,external_reservation_id,domestic_warehouse_id,status,reserved_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [reservationId, shipmentId, external.reservation.id, text(first.domestic_warehouse_id), "reserved", now, userOf(context).id, now, now]);
        const externalLines = [...(external.reservation.lines || [])];
        for (const lot of lots) {
          const shipmentLineId = id("spl");
          const sku = text(lot.formal_sku || lot.temporary_sku || lot.sku);
          store.run(`INSERT INTO stockup_shipment_lines (id,shipment_id,request_id,task_id,line_id,sku,product_name,image_url,shipped_qty,unit,base_unit_cost_cny,weight_kg,volume_m3,carton_count,units_per_carton,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,product_ref_id,purchase_order_line_id,inspection_lot_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [shipmentLineId, shipmentId, lot.request_id, "", lot.request_line_id, sku, text(lot.product_name), text(lot.image_url), lot.quantity, text(lot.unit) || "件", number(lot.estimated_unit_cost_cny), number(lot.shipment_carton_count) * number(lot.carton_weight_kg), number(lot.shipment_carton_count) * number(lot.carton_length_cm) * number(lot.carton_width_cm) * number(lot.carton_height_cm) / 1_000_000, number(lot.shipment_carton_count), number(lot.shipment_units_per_carton), number(lot.carton_length_cm), number(lot.carton_width_cm), number(lot.carton_height_cm), number(lot.carton_weight_kg), text(lot.product_ref_id), text(lot.purchase_order_line_id), text(lot.id)]);
          const matched = externalLines.find((line) => text(line.lotId) === text(lot.inventory_lot_id) && text(line.sku) === sku && number(line.quantity) >= lot.quantity);
          store.run("INSERT INTO stockup_inventory_reservation_lines (id,reservation_id,shipment_line_id,inspection_lot_id,product_ref_id,sku,quantity,domestic_lot_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [id("sirl"), reservationId, shipmentLineId, lot.id, lot.product_ref_id, sku, lot.quantity, text(matched?.lotId || lot.inventory_lot_id), now]);
          store.run("INSERT OR IGNORE INTO stockup_shipment_request_links (shipment_id,request_id,created_at) VALUES (?,?,?)", [shipmentId, lot.request_id, now]);
        }
        const requestIds = [...new Set(lots.map((lot) => text(lot.request_id)))];
        for (const requestId of requestIds) {
          store.run("UPDATE stockup_requests SET status='inventory_reserved',version=version+1,updated_at=? WHERE id=?", [now, requestId]);
          addEvent(requestId, "inventory_reserved", "出运批次已创建并锁定库存", `${shipmentNo} · ${text(first.destination_warehouse_name)}`, context, { shipmentId });
        }
        return { ok: true, shipment: getShipment(shipmentId, { ...context, viewAll: true }) };
      });
    } catch (error) {
      try { inventoryGateway.releaseReservation?.(external.reservation.id, context); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function createRouteShipment(payload, context = {}) {
    const request = getRequest(required(payload.requestId, "备货需求"), { ...context, viewAll: true });
    if (number(request.routePlanVersion) <= 0) fail("请先确认多来源履约方案。", "route_plan_required", 409);
    const location = store.first(`SELECT l.*,f.name AS forwarder_name,f.code AS forwarder_code FROM stockup_forwarder_locations l JOIN stockup_forwarders f ON f.id=l.forwarder_id WHERE l.id=? AND l.status='active' AND f.status='active'`, [text(payload.forwarderLocationId)]);
    if (!location) fail("请选择有效的货代收货点。", "forwarder_location_required");
    const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!rawLines.length) fail("请至少选择一个已齐套履约分配。", "route_shipment_lines_required");
    const allocations = rawLines.map((input) => {
      const row = store.first(`SELECT a.*,rl.sku,rl.product_name,rl.image_url,rl.unit,rl.product_ref_id,rl.target_unit_cost_cny,r.destination_warehouse_id,r.destination_warehouse_name,r.destination_country
        FROM stockup_fulfillment_allocations a JOIN stockup_request_lines rl ON rl.id=a.request_line_id JOIN stockup_requests r ON r.id=a.request_id
        WHERE a.id=? AND a.request_id=? AND a.plan_version=?`, [text(input.allocationId), request.id, request.routePlanVersion]);
      if (!row) fail("履约分配不存在或已被新版本替换。", "route_allocation_not_found", 404);
      const remaining = Math.max(0, number(row.ready_qty) - number(row.shipped_qty));
      const quantity = number(input.quantity, remaining);
      if (quantity <= 0 || quantity !== remaining) fail(`${text(row.sku)} 当前必须按该履约分配的完整可发数量 ${remaining} 发运；需要拆量时请先重算履约方案。`, "route_allocation_partial_not_supported", 409);
      if (!text(row.target_warehouse_id) || text(row.target_warehouse_id) !== text(request.consolidationWarehouseId)) fail(`${text(row.sku)} 尚未到达目标集货仓。`, "route_allocation_wrong_warehouse", 409);
      if (!["ready", "waiting_inbound"].includes(text(row.status)) || remaining <= 0) fail(`${text(row.sku)} 尚未齐套。`, "route_allocation_not_ready", 409);
      const reservationRows = store.all("SELECT * FROM stockup_fulfillment_reservations WHERE allocation_id=? AND status='reserved' AND COALESCE(shipment_id,'')='' ORDER BY created_at,id", [row.id]);
      const reservationQty = reservationRows.reduce((sum, item) => sum + number(item.quantity), 0);
      if (!reservationRows.length || reservationQty < quantity) fail(`${text(row.sku)} 的库存预留不完整，请先恢复锁库。`, "route_reservation_missing", 409);
      const packaging = normalizeShipmentPackaging(input, quantity, text(row.sku));
      return {
        ...row,
        quantity,
        ...packaging,
        reservationRows,
      };
    });
    const allCurrent = store.all("SELECT * FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=? AND status NOT IN ('cancelled','superseded')", [request.id, request.routePlanVersion]);
    const totalRemaining = allCurrent.reduce((sum, item) => sum + Math.max(0, number(item.planned_qty) - number(item.shipped_qty)), 0);
    const selectedQty = allocations.reduce((sum, item) => sum + item.quantity, 0);
    const isSplit = selectedQty < totalRemaining;
    if (isSplit && !payload.allowSplitShipment) fail("当前需求尚未全部齐套；如需分批发运，请使用受控分批发运并填写原因。", "split_shipment_permission_required", 409);
    const splitReason = isSplit ? required(payload.splitReason, "分批发运原因") : "";
    const transportMode = required(payload.transportMode, "运输方式");
    const billingMethod = ["volume", "weight", "flat"].includes(text(payload.billingMethod)) ? text(payload.billingMethod) : "weight";
    const carrierPackages = Math.max(0, number(payload.carrierPackages));
    const carrierActualWeightKg = Math.max(0, number(payload.carrierActualWeightKg));
    const chargeableWeightKg = Math.max(0, number(payload.chargeableWeightKg));
    const chargeableVolumeM3 = Math.max(0, number(payload.chargeableVolumeM3));
    const billingUnitPriceCny = Math.max(0, money(payload.billingUnitPriceCny));
    const billingExtraFeeCny = Math.max(0, money(payload.billingExtraFeeCny));
    const billingBasis = billingMethod === "volume" ? chargeableVolumeM3 : billingMethod === "weight" ? chargeableWeightKg : 1;
    const quotedFreightCny = money(billingBasis * billingUnitPriceCny + billingExtraFeeCny);
    const shipmentId = id("sps");
    const shipmentNo = businessNo("FY");
    const now = nowIso();
    const reservationIds = [...new Set(allocations.flatMap((item) => item.reservationRows.map((row) => text(row.external_reservation_id))).filter(Boolean))];
    const snapshot = { forwarderId: text(location.forwarder_id), forwarderName: text(location.forwarder_name), forwarderCode: text(location.forwarder_code), locationId: text(location.id), locationName: text(location.name), country: text(location.country), province: text(location.province), city: text(location.city), address: text(location.address), contactName: text(location.contact_name), contactPhone: text(location.contact_phone), routingRequirements: text(location.routing_requirements) };
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_shipments (id,request_id,shipment_no,origin_warehouse,origin_warehouse_id,origin_address,destination_warehouse_id,destination_warehouse_name,destination_country,destination_address,destination_contact_name,destination_contact_phone,carrier,transport_mode,tracking_no,etd,eta,actual_shipped_at,status,packages,total_weight_kg,total_volume_m3,chargeable_weight_kg,billing_method,carrier_packages,carrier_actual_weight_kg,chargeable_volume_m3,billing_unit_price_cny,billing_extra_fee_cny,quoted_freight_cny,note,box_mark,inventory_movement_id,wms_provider_id,wms_document_type,wms_push_status,wms_order_no,wms_push_error,wms_push_attempts,wms_pushed_at,wms_pushed_by,version,created_at,updated_at,workflow_version,forwarder_location_id,forwarder_snapshot_json,reservation_id,instruction_published_at,instruction_published_by,handed_over_at,document_version)
        VALUES (${Array(52).fill("?").join(",")})`, [
        shipmentId, request.id, shipmentNo, request.consolidationWarehouseName, request.consolidationWarehouseId, "", request.destinationWarehouseId, request.destinationWarehouseName, request.destinationCountry, "", "", "",
        text(payload.carrier), transportMode, optionalTrackingNumber(payload.trackingNo), text(payload.etd), text(payload.eta), "", "inventory_reserved", allocations.reduce((sum, item) => sum + item.cartonCount, 0),
        allocations.reduce((sum, item) => sum + item.weightKg, 0), allocations.reduce((sum, item) => sum + item.volumeM3, 0),
        chargeableWeightKg, billingMethod, carrierPackages, carrierActualWeightKg, chargeableVolumeM3, billingUnitPriceCny, billingExtraFeeCny, quotedFreightCny,
        text(payload.note) || splitReason, text(payload.boxMark), "", "", "", "not_created", "", "", 0, "", "", 1, now, now, 2, text(location.id), JSON.stringify(snapshot), JSON.stringify(reservationIds), "", "", "", 0,
      ]);
      const internalReservationId = id("sir");
      store.run("INSERT INTO stockup_inventory_reservations (id,shipment_id,external_reservation_id,domestic_warehouse_id,status,reserved_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [internalReservationId, shipmentId, JSON.stringify(reservationIds), request.consolidationWarehouseId, "reserved", now, userOf(context).id, now, now]);
      for (const allocation of allocations) {
        const shipmentLineId = id("spl");
        store.run(`INSERT INTO stockup_shipment_lines (id,shipment_id,request_id,task_id,line_id,sku,product_name,image_url,shipped_qty,unit,base_unit_cost_cny,weight_kg,volume_m3,carton_count,units_per_carton,carton_length_cm,carton_width_cm,carton_height_cm,carton_weight_kg,packaging_groups_json,product_ref_id,purchase_order_line_id,inspection_lot_id,fulfillment_allocation_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [shipmentLineId, shipmentId, request.id, "", allocation.request_line_id, allocation.sku, allocation.product_name, allocation.image_url, allocation.quantity, allocation.unit || "件", number(allocation.target_unit_cost_cny), allocation.weightKg, allocation.volumeM3, allocation.cartonCount, allocation.unitsPerCarton, allocation.cartonLengthCm, allocation.cartonWidthCm, allocation.cartonHeightCm, allocation.cartonWeightKg, JSON.stringify(allocation.groups), text(allocation.product_ref_id), "", "", allocation.id]);
        store.run("UPDATE stockup_fulfillment_allocations SET status='shipment_reserved',version=version+1,updated_at=? WHERE id=?", [now, allocation.id]);
        for (const reservation of allocation.reservationRows) store.run("UPDATE stockup_fulfillment_reservations SET shipment_id=?,updated_at=? WHERE id=?", [shipmentId, now, reservation.id]);
      }
      store.run("INSERT OR IGNORE INTO stockup_shipment_request_links (shipment_id,request_id,created_at) VALUES (?,?,?)", [shipmentId, request.id, now]);
      store.run("UPDATE stockup_requests SET status='inventory_reserved',journey_stage='shipment_planning',allow_split_shipment=?,split_shipment_reason=?,version=version+1,updated_at=? WHERE id=?", [isSplit ? 1 : number(request.allowSplitShipment), splitReason || text(request.splitShipmentReason), now, request.id]);
      addEvent(request.id, "route_shipment_created", isSplit ? "已创建分批发运计划" : "已创建发运计划", `${shipmentNo} · ${selectedQty} ${allocations[0]?.unit || "件"}`, context, { shipmentId, payload: { allocationIds: allocations.map((item) => item.id), reservationIds, splitReason } });
      return { ok: true, shipment: getShipment(shipmentId, { ...context, viewAll: true }) };
    });
  }

  function recordDispatchDocuments(shipmentId, documents, context = {}) {
    const shipment = getShipment(shipmentId, context);
    if (number(shipment.workflowVersion) !== 2 || shipment.wmsPushStatus !== "pushed") fail("只有已创建海外仓单的 V2 出运批次可以生成交接文件。", "dispatch_document_state", 409);
    const types = new Set((documents || []).map((document) => text(document.documentType)));
    if (!types.has("packing_list") || !types.has("carton_marks")) fail("必须同时生成装箱单与箱唛 PDF。", "dispatch_documents_incomplete");
    const version = number(store.first("SELECT MAX(version) AS version FROM stockup_dispatch_documents WHERE shipment_id=?", [shipment.id])?.version) + 1;
    const now = nowIso();
    return store.transaction(() => {
      for (const document of documents) store.run("INSERT INTO stockup_dispatch_documents (id,shipment_id,version,document_type,file_name,file_path,mime_type,sha256,snapshot_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id("sdd"), shipment.id, version, required(document.documentType, "文件类型"), required(document.fileName, "文件名"), required(document.filePath, "文件路径"), "application/pdf", required(document.sha256, "文件校验值"), JSON.stringify(document.snapshot || {}), userOf(context).id, now]);
      store.run("UPDATE stockup_shipments SET document_version=?,status=CASE WHEN status='inventory_reserved' THEN 'wms_created' ELSE status END,version=version+1,updated_at=? WHERE id=?", [version, now, shipment.id]);
      return { ok: true, shipmentId: shipment.id, version, documents: store.all("SELECT * FROM stockup_dispatch_documents WHERE shipment_id=? AND version=? ORDER BY document_type", [shipment.id, version]) };
    });
  }

  function dispatchDocumentFromRow(row) {
    if (!row) return null;
    return { id: text(row.id), shipmentId: text(row.shipment_id), version: number(row.version), documentType: text(row.document_type), fileName: text(row.file_name), filePath: text(row.file_path), mimeType: text(row.mime_type) || "application/pdf", sha256: text(row.sha256), snapshot: json(row.snapshot_json, {}), createdBy: text(row.created_by), createdAt: text(row.created_at) };
  }

  function listDispatchDocuments(shipmentId, context = {}) {
    const shipment = getShipment(shipmentId, context);
    return { ok: true, shipmentId: shipment.id, currentVersion: shipment.documentVersion, documents: store.all("SELECT * FROM stockup_dispatch_documents WHERE shipment_id=? ORDER BY version DESC,document_type", [shipment.id]).map(dispatchDocumentFromRow).map(({ filePath: _filePath, ...document }) => document) };
  }

  function getDispatchDocument(documentId, context = {}) {
    const document = dispatchDocumentFromRow(store.first("SELECT * FROM stockup_dispatch_documents WHERE id=?", [text(documentId)]));
    if (!document) fail("发运文件不存在。", "dispatch_document_not_found", 404);
    getShipment(document.shipmentId, context);
    return document;
  }

  function issueDispatchInstruction(shipmentId, payload, context = {}) {
    const shipment = getShipment(shipmentId, context);
    if (shipment.status !== "wms_created" || number(shipment.documentVersion) <= 0) fail("请先完成 WMS 建单并生成交接 PDF。", "dispatch_instruction_state", 409);
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_shipments SET status='instruction_issued',instruction_published_at=?,instruction_published_by=?,version=version+1,updated_at=? WHERE id=?", [now, userOf(context).name, now, shipment.id]);
      for (const requestId of shipment.requestIds || [shipment.requestId]) { store.run("UPDATE stockup_requests SET status='instruction_issued',version=version+1,updated_at=? WHERE id=?", [now, requestId]); addEvent(requestId, "dispatch_instruction_issued", "国内仓发货任务已下发", `${shipment.shipmentNo} · PDF V${shipment.documentVersion}`, context, { shipmentId: shipment.id, payload }); }
      return { ok: true, shipment: getShipment(shipment.id, context) };
    });
  }

  function handoverShipment(shipmentId, payload, context = {}) {
    const shipment = getShipment(shipmentId, context);
    if (shipment.status === "handed_over") return { ok: true, idempotentReplay: true, shipment };
    if (shipment.status !== "instruction_issued") fail("只有已下发发货任务的批次可以确认货代交接。", "shipment_handover_state", 409);
    const reservation = store.first("SELECT * FROM stockup_inventory_reservations WHERE shipment_id=?", [shipment.id]);
    if (!reservation || text(reservation.status) !== "reserved") fail("发运批次没有有效库存预约。", "shipment_reservation_missing", 409);
    const routeReservations = store.all("SELECT * FROM stockup_fulfillment_reservations WHERE shipment_id=? AND status='reserved' ORDER BY created_at,id", [shipment.id]);
    const externalReservationIds = routeReservations.length
      ? [...new Set(routeReservations.map((row) => text(row.external_reservation_id)).filter(Boolean))]
      : [text(reservation.external_reservation_id)].filter(Boolean);
    const committed = [];
    try {
      for (const reservationId of externalReservationIds) {
        const result = inventoryGateway.commitReservation?.(reservationId, { occurredAt: payload.handedOverAt, note: `交货货代：${shipment.shipmentNo}` }, context);
        if (!result?.movementId) fail("国内库存出库失败。", "shipment_inventory_commit_failed", 503);
        committed.push({ reservationId, movementId: result.movementId });
      }
    } catch (error) {
      if (committed.length && routeReservations.length) {
        const recoveryAt = nowIso();
        store.transaction(() => {
          for (const item of committed) {
            const completedRows = routeReservations.filter((row) => text(row.external_reservation_id) === item.reservationId);
            store.run("UPDATE stockup_fulfillment_reservations SET status='committed',updated_at=? WHERE external_reservation_id=?", [recoveryAt, item.reservationId]);
            for (const row of completedRows) store.run("UPDATE stockup_fulfillment_allocations SET shipped_qty=MIN(planned_qty,shipped_qty+?),status='handover_recovery_required',version=version+1,updated_at=? WHERE id=?", [number(row.quantity), recoveryAt, row.allocation_id]);
          }
          store.run("UPDATE stockup_inventory_reservations SET status='handover_recovery_required',updated_at=? WHERE id=?", [recoveryAt, reservation.id]);
          store.run("UPDATE stockup_shipments SET status='handover_recovery_required',inventory_movement_id=?,wms_push_error=?,version=version+1,updated_at=? WHERE id=?", [JSON.stringify(committed.map((item) => item.movementId)), text(error?.message), recoveryAt, shipment.id]);
          store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='route_recovery',version=version+1,updated_at=? WHERE id=?", [recoveryAt, shipment.requestId]);
          addEvent(shipment.requestId, "shipment_handover_recovery_required", "交货扣库存部分成功，需要人工恢复", text(error?.message), context, { shipmentId: shipment.id, payload: { committed } });
        });
      }
      throw error;
    }
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_inventory_reservations SET status='committed',committed_at=?,updated_at=? WHERE id=?", [now, now, reservation.id]);
      if (routeReservations.length) {
        store.run("UPDATE stockup_fulfillment_reservations SET status='committed',updated_at=? WHERE shipment_id=? AND status='reserved'", [now, shipment.id]);
        const byAllocation = new Map();
        for (const row of routeReservations) byAllocation.set(text(row.allocation_id), number(byAllocation.get(text(row.allocation_id))) + number(row.quantity));
        for (const [allocationId, quantity] of byAllocation) store.run("UPDATE stockup_fulfillment_allocations SET shipped_qty=MIN(planned_qty,shipped_qty+?),status=CASE WHEN shipped_qty+?>=planned_qty THEN 'shipped' ELSE 'ready' END,version=version+1,updated_at=? WHERE id=?", [quantity, quantity, now, allocationId]);
      }
      store.run("UPDATE stockup_shipments SET status='handed_over',carrier=?,tracking_no=?,actual_shipped_at=?,handed_over_at=?,inventory_movement_id=?,version=version+1,updated_at=? WHERE id=?", [required(payload.carrier || shipment.carrier, "承运商"), required(payload.trackingNo, "物流单号"), text(payload.handedOverAt) || now, text(payload.handedOverAt) || now, JSON.stringify(committed.map((item) => item.movementId)), now, shipment.id]);
      if (number(payload.actualFreightCny) > 0) store.run(`INSERT INTO stockup_cost_items
        (id,request_id,shipment_id,receipt_id,category,name,stage,vendor,invoice_no,occurred_at,original_amount,currency,exchange_rate,amount_cny,included,allocation_method,note,status,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET original_amount=excluded.original_amount,amount_cny=excluded.amount_cny,vendor=excluded.vendor,invoice_no=excluded.invoice_no,note=excluded.note,included=1,status='recorded',updated_at=excluded.updated_at`,
      [`handover-freight:${shipment.id}`, shipment.requestId, shipment.id, "", "first_mile_freight", "头程物流实际运费", "头程物流", text(payload.carrier || shipment.carrier), text(payload.invoiceNo), (text(payload.handedOverAt) || now).slice(0, 10), money(payload.actualFreightCny), "CNY", 1, money(payload.actualFreightCny), 1, shipment.billingMethod === "volume" ? "volume" : shipment.billingMethod === "flat" ? "quantity" : "weight", text(payload.costNote), "recorded", userOf(context).id, now, now]);
      for (const requestId of shipment.requestIds || [shipment.requestId]) {
        const balance = store.first("SELECT COALESCE(SUM(planned_qty),0) planned,COALESCE(SUM(shipped_qty),0) shipped FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=(SELECT route_plan_version FROM stockup_requests WHERE id=?)", [requestId, requestId]);
        const routeBased = number(balance?.planned) > 0;
        const complete = routeBased && number(balance?.shipped) >= number(balance?.planned);
        store.run("UPDATE stockup_requests SET status=?,journey_stage=?,version=version+1,updated_at=? WHERE id=?", [routeBased ? (complete ? "handed_over" : "in_progress") : "handed_over", routeBased ? (complete ? "in_transit" : "ready_to_ship") : "in_transit", now, requestId]);
        addEvent(requestId, "shipment_handed_over", "货物已交接货代并扣减库存", `${shipment.shipmentNo} · ${payload.trackingNo}`, context, { shipmentId: shipment.id, payload: { inventoryMovementIds: committed.map((item) => item.movementId), partial: routeBased && !complete } });
      }
      return { ok: true, idempotentReplay: false, shipment: getShipment(shipment.id, context) };
    });
  }

  function cancelReservedShipment(shipmentId, payload, context = {}) {
    const shipment = getShipment(shipmentId, context);
    if (shipment.status === "handed_over") fail("已交接货代的批次只能走冲正流程。", "shipment_requires_reversal", 409);
    if (shipment.wmsOrderNo && shipment.wmsPushStatus !== "voided") fail("请先作废海外仓备货单，再取消出运批次。", "wms_order_must_be_voided", 409);
    const reservation = store.first("SELECT * FROM stockup_inventory_reservations WHERE shipment_id=?", [shipment.id]);
    const routeReservations = store.all("SELECT * FROM stockup_fulfillment_reservations WHERE shipment_id=? AND status='reserved'", [shipment.id]);
    if (!routeReservations.length && reservation && text(reservation.status) === "reserved") inventoryGateway.releaseReservation?.(text(reservation.external_reservation_id), context);
    const now = nowIso();
    return store.transaction(() => {
      if (reservation) store.run("UPDATE stockup_inventory_reservations SET status='released',released_at=?,updated_at=? WHERE id=?", [now, now, reservation.id]);
      if (routeReservations.length) {
        store.run("UPDATE stockup_fulfillment_reservations SET shipment_id='',updated_at=? WHERE shipment_id=? AND status='reserved'", [now, shipment.id]);
        for (const allocationId of [...new Set(routeReservations.map((row) => text(row.allocation_id)))]) store.run("UPDATE stockup_fulfillment_allocations SET status='ready',version=version+1,updated_at=? WHERE id=?", [now, allocationId]);
      }
      store.run("UPDATE stockup_shipments SET status='voided',note=?,version=version+1,updated_at=? WHERE id=?", [text(payload.reason) || "出运计划已取消", now, shipment.id]);
      for (const requestId of shipment.requestIds || [shipment.requestId]) { store.run("UPDATE stockup_requests SET status='inventory_ready',journey_stage='ready_to_ship',version=version+1,updated_at=? WHERE id=?", [now, requestId]); addEvent(requestId, "shipment_cancelled", routeReservations.length ? "出运批次已取消，履约库存仍保持锁定" : "出运批次已取消并释放库存", text(payload.reason), context, { shipmentId: shipment.id }); }
      return { ok: true, shipment: getShipment(shipment.id, context) };
    });
  }

  function createCustomProcessingHandoff(payload, context = {}) {
    const actor = userOf(context);
    const now = nowIso();
    const handoffId = id("scph");
    store.transaction(() => store.run(`INSERT INTO stockup_custom_processing_handoffs (id,source_type,source_ref,source_snapshot_json,product_name,sku,quantity,unit,expected_at,note,status,created_by,created_by_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending_custom_planning',?,?,?,?)`, [handoffId, text(payload.sourceType) || "manual", text(payload.sourceRef), JSON.stringify(payload.sourceSnapshot || {}), required(payload.productName, "产品名称"), text(payload.sku), number(payload.quantity), text(payload.unit) || "件", text(payload.expectedAt), text(payload.note), actor.id, actor.name, now, now]));
    return { ok: true, handoffId, status: "pending_custom_planning" };
  }

  function listCustomProcessingHandoffs() {
    return { ok: true, handoffs: store.all("SELECT * FROM stockup_custom_processing_handoffs ORDER BY updated_at DESC LIMIT 300").map((row) => ({ id: text(row.id), sourceType: text(row.source_type), sourceRef: text(row.source_ref), sourceSnapshot: json(row.source_snapshot_json, {}), productName: text(row.product_name), sku: text(row.sku), quantity: number(row.quantity), unit: text(row.unit), expectedAt: text(row.expected_at), note: text(row.note), status: text(row.status), createdBy: text(row.created_by), createdByName: text(row.created_by_name), createdAt: text(row.created_at), updatedAt: text(row.updated_at) })) };
  }

  return {
    bindFormalSku,
    cancelReservedShipment,
    createCustomProcessingHandoff,
    createForwarder,
    createPurchaseOrder,
    createReservedShipment,
    createRouteShipment,
    createSpotRequest,
    updateSpotRequest,
    refreshInventoryPlan,
    issueDispatchInstruction,
    handoverShipment,
    listCustomProcessingHandoffs,
    getDispatchDocument,
    listForwarders,
    listDispatchDocuments,
    listProductRefs,
    listPurchaseOrders,
    updatePurchaseOrder,
    updateRequestLineProcurement,
    recordPurchaseEvent,
    recordDispatchDocuments,
    reviewInspection,
    submitInspection,
  };
}

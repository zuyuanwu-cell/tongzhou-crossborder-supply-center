import { randomUUID } from "node:crypto";

const ACTIVE_ALLOCATION_STATUSES = new Set([
  "reserved",
  "ready",
  "transfer_suggested",
  "transfer_in_progress",
  "pending_purchase",
  "ordered",
  "pending_outsourcing",
  "outsourcing_linked",
  "production_completed_waiting_inbound",
  "waiting_inbound",
  "shipment_reserved",
  "shipped",
  "handover_recovery_required",
  "reservation_recovery_required",
]);

function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function text(value) { return String(value ?? "").trim(); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function normalizedSku(value) { return text(value).replace(/\s+/g, "").toUpperCase(); }
function json(value, fallback = {}) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function userOf(context = {}) { return { id: text(context.auth?.user?.id) || "system", name: text(context.auth?.user?.displayName || context.auth?.user?.username) || "系统" }; }
function fail(message, code = "stockup_v3_error", statusCode = 400, details = undefined) {
  throw Object.assign(new Error(message), { code, statusCode, ...(details ? { details } : {}) });
}
function modeToSource(mode) {
  if (["委外生产", "委外加工", "outsourced_production"].includes(text(mode))) return "outsourced_production";
  if (["外采成品", "采购", "purchase"].includes(text(mode))) return "purchase";
  // “自有成品库存”只能描述已有库存的优先来源，不能把实际不存在的
  // 数量伪装成现货。库存不足的部分必须由负责人重新选择采购/委外，
  // 或等待真实入库后再重算。
  return "unresolved";
}

function allocationFromRow(row) {
  if (!row) return null;
  return {
    id: text(row.id),
    requestId: text(row.request_id),
    requestLineId: text(row.request_line_id),
    planVersion: number(row.plan_version),
    sourceType: text(row.source_type),
    sourceWarehouseId: text(row.source_warehouse_id),
    sourceWarehouseName: text(row.source_warehouse_name),
    targetWarehouseId: text(row.target_warehouse_id),
    targetWarehouseName: text(row.target_warehouse_name),
    plannedQty: number(row.planned_qty),
    reservedQty: number(row.reserved_qty),
    receivedQty: number(row.received_qty),
    readyQty: number(row.ready_qty),
    shippedQty: number(row.shipped_qty),
    exceptionQty: number(row.exception_qty),
    status: text(row.status),
    externalReservationId: text(row.external_reservation_id),
    referenceType: text(row.reference_type),
    referenceId: text(row.reference_id),
    referenceNo: text(row.reference_no),
    expectedReadyAt: text(row.expected_ready_at),
    version: number(row.version, 1),
    createdBy: text(row.created_by),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function routeSummary(allocations) {
  const summary = { domesticStock: 0, transfer: 0, purchase: 0, outsourcedProduction: 0, unresolved: 0, planned: 0, reserved: 0, ready: 0, shipped: 0, exception: 0 };
  for (const allocation of allocations) {
    summary.planned += allocation.plannedQty;
    summary.reserved += allocation.reservedQty;
    summary.ready += allocation.readyQty;
    summary.shipped += allocation.shippedQty;
    summary.exception += allocation.exceptionQty;
    if (allocation.sourceType === "domestic_stock") summary.domesticStock += allocation.plannedQty;
    else if (allocation.sourceType === "transfer") summary.transfer += allocation.plannedQty;
    else if (allocation.sourceType === "purchase") summary.purchase += allocation.plannedQty;
    else if (allocation.sourceType === "outsourced_production") summary.outsourcedProduction += allocation.plannedQty;
    else summary.unresolved += allocation.plannedQty;
  }
  return summary;
}

function deriveJourney(allocations, request) {
  if (["cancelled", "rejected"].includes(text(request.status))) {
    return { journeyStage: "cancelled", ownerRole: "supply_chain", blockers: [], nextAction: null };
  }
  if (["completed", "cost_locked"].includes(text(request.status))) {
    return { journeyStage: "completed", ownerRole: "finance", blockers: [], nextAction: null };
  }
  if (text(request.status) === "overseas_received") {
    return { journeyStage: "cost_pending", ownerRole: "finance", blockers: [], nextAction: { key: "settle_cost", label: "核算到仓成本", target: "costs", objectId: request.id, enabled: true, reason: "" } };
  }
  const active = allocations.filter((item) => ACTIVE_ALLOCATION_STATUSES.has(item.status));
  if (!active.length) {
    const legacyProgressed = {
      purchasing: { journeyStage: "sourcing", ownerRole: "supply_chain", nextAction: { key: "review_legacy_execution", label: "查看供应执行", target: "supply_execution", objectId: request.id, enabled: true, reason: "" } },
      in_progress: { journeyStage: text(request.journeyStage) || "sourcing", ownerRole: "supply_chain", nextAction: { key: "review_legacy_execution", label: "查看供应执行", target: "supply_execution", objectId: request.id, enabled: true, reason: "" } },
      warehouse_inspection: { journeyStage: "consolidating", ownerRole: "domestic_warehouse", nextAction: { key: "review_warehouse_work", label: "查看国内仓作业", target: "warehouse", objectId: request.id, enabled: true, reason: "" } },
      inspection_review: { journeyStage: "consolidating", ownerRole: "domestic_warehouse", nextAction: { key: "review_inspection", label: "审核仓库验收", target: "warehouse", objectId: request.id, enabled: true, reason: "" } },
      inventory_ready: { journeyStage: "ready_to_ship", ownerRole: "logistics", nextAction: { key: "create_shipment", label: "创建发运计划", target: "logistics", objectId: request.id, enabled: true, reason: "" } },
      inventory_reserved: { journeyStage: "shipment_planning", ownerRole: "logistics", nextAction: { key: "continue_shipment", label: "继续处理发运批次", target: "logistics", objectId: request.id, enabled: true, reason: "" } },
      wms_created: { journeyStage: "shipment_planning", ownerRole: "logistics", nextAction: { key: "continue_shipment", label: "继续处理发运批次", target: "logistics", objectId: request.id, enabled: true, reason: "" } },
      instruction_issued: { journeyStage: "shipment_planning", ownerRole: "logistics", nextAction: { key: "continue_shipment", label: "继续处理发运批次", target: "logistics", objectId: request.id, enabled: true, reason: "" } },
      handed_over: { journeyStage: "in_transit", ownerRole: "logistics", nextAction: { key: "track_shipment", label: "查看物流进度", target: "logistics", objectId: request.id, enabled: true, reason: "" } },
    }[text(request.status)];
    if (legacyProgressed) return { ...legacyProgressed, blockers: [] };
    return {
      journeyStage: request.status === "draft" ? "draft" : "route_planning",
      ownerRole: "supply_chain",
      blockers: [{ code: "route_not_confirmed", message: "尚未确认逐 SKU 履约方案。" }],
      nextAction: { key: "confirm_route", label: "确认执行方案", target: "route_confirmation", objectId: request.id, enabled: true, reason: "" },
    };
  }
  const summary = routeSummary(active);
  const unresolved = active.filter((item) => item.sourceType === "unresolved");
  const transfers = active.filter((item) => item.sourceType === "transfer" && item.readyQty < item.plannedQty);
  const transferSuggestions = transfers.filter((item) => item.status === "transfer_suggested");
  const transfersInProgress = transfers.filter((item) => item.status === "transfer_in_progress");
  const purchases = active.filter((item) => item.sourceType === "purchase" && item.readyQty < item.plannedQty);
  const outsourcing = active.filter((item) => item.sourceType === "outsourced_production" && item.readyQty < item.plannedQty);
  const outsourcingUnlinked = outsourcing.filter((item) => item.status === "pending_outsourcing" || !item.referenceId);
  const recovery = active.filter((item) => item.status === "reservation_recovery_required");
  const blockers = [];
  const now = Date.now();
  const agedReservations = active.map((item) => ({ item, ageDays: item.createdAt ? Math.floor((now - new Date(item.createdAt).getTime()) / 86400000) : 0 }))
    .filter(({ item, ageDays }) => ageDays >= 7 && item.reservedQty > item.shippedQty && ["domestic_stock", "transfer"].includes(item.sourceType));
  const severelyAged = agedReservations.filter(({ ageDays }) => ageDays >= 14);
  if (severelyAged.length) blockers.push({ code: "inventory_reservation_aged_14d", message: `${severelyAged.length} 段国内库存已锁定超过 14 天，请确认继续保留或调整方案。` });
  else if (agedReservations.length) blockers.push({ code: "inventory_reservation_aged_7d", message: `${agedReservations.length} 段国内库存已锁定超过 7 天，请关注齐套与发运进度。` });
  if (unresolved.length) blockers.push({ code: "supply_mode_required", message: `${unresolved.length} 个产品缺口需要选择采购或委外生产。` });
  if (transfers.length) blockers.push({ code: "transfer_pending", message: `${transfers.length} 段跨仓库存等待调拨到集货仓。` });
  if (purchases.length) blockers.push({ code: "purchase_pending", message: `${purchases.length} 段采购缺口尚未完成国内仓入库。` });
  if (outsourcing.length) blockers.push({ code: "outsourcing_pending", message: `${outsourcing.length} 段委外生产缺口尚未完成国内仓入库。` });
  if (recovery.length) blockers.push({ code: "reservation_recovery_required", message: `${recovery.length} 段货物已入库，但库存锁定需要恢复。` });
  const allReady = summary.planned > 0 && summary.ready + summary.shipped >= summary.planned;
  const hasShipped = summary.shipped > 0;
  if (hasShipped && summary.shipped >= summary.planned) return { journeyStage: "in_transit", ownerRole: "logistics", blockers: [], nextAction: { key: "track_shipment", label: "查看物流进度", target: "logistics", objectId: request.id, enabled: true, reason: "" } };
  if (["inventory_reserved", "wms_created", "instruction_issued"].includes(text(request.status))) return { journeyStage: "shipment_planning", ownerRole: "logistics", blockers: [], nextAction: { key: "continue_shipment", label: "继续处理发运批次", target: "logistics", objectId: request.id, enabled: true, reason: "" } };
  if (allReady) return { journeyStage: "ready_to_ship", ownerRole: "logistics", blockers, nextAction: { key: "create_shipment", label: "创建发运计划", target: "logistics", objectId: request.id, enabled: true, reason: "" } };
  if (unresolved.length) return { journeyStage: "sourcing", ownerRole: "supply_chain", blockers, nextAction: { key: "resolve_supply_mode", label: "补充供应方式", target: "route_confirmation", objectId: request.id, enabled: true, reason: "" } };
  if (recovery.length) return { journeyStage: "route_recovery", ownerRole: "supply_chain", blockers, nextAction: { key: "recover_reservation", label: "恢复库存锁定", target: "reservation_recovery", objectId: request.id, enabled: true, reason: "" } };
  if (transferSuggestions.length) return { journeyStage: "consolidating", ownerRole: "domestic_warehouse", blockers, nextAction: { key: "confirm_transfer", label: "确认跨仓调拨", target: "transfer", objectId: request.id, enabled: true, reason: "" } };
  if (transfersInProgress.length) return { journeyStage: "consolidating", ownerRole: "domestic_warehouse", blockers, nextAction: { key: "sync_transfer", label: "同步调拨到仓状态", target: "transfer", objectId: request.id, enabled: true, reason: "" } };
  if (purchases.length) return { journeyStage: "sourcing", ownerRole: "procurement", blockers, nextAction: { key: "register_purchase", label: "登记采购缺口", target: "procurement", objectId: request.id, enabled: true, reason: "" } };
  if (outsourcing.length) return { journeyStage: "sourcing", ownerRole: "production_followup", blockers, nextAction: { key: outsourcingUnlinked.length ? "link_outsourcing" : "track_outsourcing", label: outsourcingUnlinked.length ? "关联委外加工单" : "跟进委外生产与入库", target: "outsourcing", objectId: request.id, enabled: true, reason: "" } };
  return { journeyStage: "consolidating", ownerRole: "supply_chain", blockers, nextAction: { key: "recalculate_route", label: "重新计算履约方案", target: "route_confirmation", objectId: request.id, enabled: true, reason: "" } };
}

export function createStockupV3Service({
  store,
  inventoryGateway = {},
  getRequest,
  addEvent,
  enabled = true,
  pilotRequestRefs = [],
  adminOnly = false,
}) {
  const pilotRefs = new Set((Array.isArray(pilotRequestRefs) ? pilotRequestRefs : [])
    .map((value) => text(value))
    .filter(Boolean));

  function ensureEnabled() {
    if (!enabled) fail("备货协同 V3 尚未对当前环境开放。", "fulfillment_v3_disabled", 404);
  }

  function isEnabledForRequest(request, context = {}) {
    if (!enabled || !request || number(request.workflowVersion) !== 2) return false;
    if (adminOnly && text(context.auth?.role) !== "admin") return false;
    if (!pilotRefs.size) return true;
    return pilotRefs.has(text(request.id)) || pilotRefs.has(text(request.requestNo));
  }

  function ensureRequestEnabled(request, context = {}) {
    ensureEnabled();
    if (!isEnabledForRequest(request, context)) {
      fail("该备货需求尚未进入 V3 试点范围。", "fulfillment_v3_not_in_pilot", 404);
    }
  }
  function enrichProductOptions(payload = {}) {
    const products = Array.isArray(payload.products) ? payload.products : [];
    if (!products.length) return payload;
    const refs = store.all("SELECT id,formal_sku,temporary_sku,default_supply_mode FROM stockup_product_refs");
    const bySku = new Map();
    for (const ref of refs) {
      if (text(ref.formal_sku)) bySku.set(normalizedSku(ref.formal_sku), ref);
      if (text(ref.temporary_sku)) bySku.set(normalizedSku(ref.temporary_sku), ref);
    }
    return { ...payload, products: products.map((product) => {
      const ref = bySku.get(normalizedSku(product.sku || product.skuNo));
      return { ...product, productRefId: text(ref?.id), defaultSupplyMode: text(ref?.default_supply_mode) || "待判断" };
    }) };
  }
  function currentAllocations(requestId) {
    return store.all(`SELECT a.* FROM stockup_fulfillment_allocations a
      JOIN stockup_requests r ON r.id=a.request_id
      WHERE a.request_id=? AND a.plan_version=r.route_plan_version
      ORDER BY a.request_line_id,a.source_type,a.created_at`, [text(requestId)]).map(allocationFromRow);
  }

  function activeShipmentForRequest(requestId) {
    return store.first(`SELECT DISTINCT s.id,s.shipment_no,s.status
      FROM stockup_shipments s
      LEFT JOIN stockup_shipment_request_links l ON l.shipment_id=s.id
      WHERE (s.request_id=? OR l.request_id=?)
        AND s.status NOT IN ('voided','cancelled')
      ORDER BY s.created_at DESC LIMIT 1`, [text(requestId), text(requestId)]);
  }

  function ensureRouteCanClose(request, allocations, operation) {
    const shipment = activeShipmentForRequest(request.id);
    if (shipment) {
      fail(`需求已创建活动发运批次 ${text(shipment.shipment_no)}，请先在“物流与到仓”取消出运计划，再${operation}。`, "route_close_has_active_shipment", 409, {
        shipmentId: text(shipment.id), shipmentNo: text(shipment.shipment_no), shipmentStatus: text(shipment.status),
      });
    }
    if (allocations.some((allocation) => allocation.shippedQty > 0)) {
      fail(`已有数量交接货代，不能直接${operation}整张需求，请走冲正流程。`, "route_close_has_handover", 409);
    }
    if (allocations.some((allocation) => allocation.referenceType === "domestic_transfer" && allocation.status === "transfer_in_progress")) {
      fail(`存在在途跨仓调拨，请先在国内库存中取消调拨或确认到仓并同步状态，再${operation}。`, "route_close_has_transfer", 409);
    }
  }

  function releasePlanReservationsOrMarkRecovery(request, allocations, context, operation) {
    const tracked = store.all(`SELECT fr.* FROM stockup_fulfillment_reservations fr
      JOIN stockup_fulfillment_allocations fa ON fa.id=fr.allocation_id
      WHERE fa.request_id=? AND fa.plan_version=? AND fr.status='reserved'`, [request.id, request.routePlanVersion]);
    const trackedIds = new Set(tracked.map((item) => text(item.external_reservation_id)).filter(Boolean));
    const fallback = allocations
      .filter((allocation) => allocation.externalReservationId && !trackedIds.has(allocation.externalReservationId))
      .map((allocation) => ({
        allocation_id: allocation.id,
        external_reservation_id: allocation.externalReservationId,
        quantity: Math.max(0, allocation.reservedQty - allocation.shippedQty),
      }));
    const byExternalId = new Map();
    for (const reservation of [...tracked, ...fallback]) {
      const reservationId = text(reservation.external_reservation_id);
      if (reservationId && !byExternalId.has(reservationId)) byExternalId.set(reservationId, reservation);
    }
    const reservations = [...byExternalId.values()];
    if (reservations.length && !inventoryGateway.releaseReservation) {
      fail("国内库存释放服务尚未配置。", "inventory_reservation_release_unavailable", 503);
    }

    const released = [];
    for (const reservation of reservations) {
      const reservationId = text(reservation.external_reservation_id);
      try {
        inventoryGateway.releaseReservation(reservationId, context);
        released.push(reservation);
      } catch (error) {
        // A remote timeout can happen after the inventory service has applied the
        // release. Verify the authoritative reservation state before deciding
        // whether this segment needs recovery.
        try {
          const current = inventoryGateway.getReservation?.(reservationId, context)?.reservation;
          if (text(current?.status) === "released") released.push(reservation);
        } catch { /* keep the original release error */ }

        if (released.length) {
          const now = nowIso();
          const releasedByAllocation = new Map();
          for (const item of released) {
            const allocationId = text(item.allocation_id);
            releasedByAllocation.set(allocationId, number(releasedByAllocation.get(allocationId)) + number(item.quantity));
          }
          store.transaction(() => {
            for (const item of released) {
              store.run("UPDATE stockup_fulfillment_reservations SET status='released',updated_at=? WHERE external_reservation_id=? AND status='reserved'", [now, text(item.external_reservation_id)]);
            }
            for (const [allocationId, releasedQty] of releasedByAllocation) {
              const remaining = store.first("SELECT external_reservation_id FROM stockup_fulfillment_reservations WHERE allocation_id=? AND status='reserved' ORDER BY created_at,id LIMIT 1", [allocationId]);
              store.run(`UPDATE stockup_fulfillment_allocations
                SET status='reservation_recovery_required',reserved_qty=MAX(0,reserved_qty-?),ready_qty=MAX(0,ready_qty-?),exception_qty=exception_qty+?,external_reservation_id=?,version=version+1,updated_at=?
                WHERE id=?`, [releasedQty, releasedQty, releasedQty, text(remaining?.external_reservation_id), now, allocationId]);
            }
            store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='route_recovery',version=version+1,updated_at=? WHERE id=?", [now, request.id]);
            addEvent(request.id, "route_reservation_release_partial", "库存锁部分释放，等待恢复", `${operation}过程中仅释放 ${released.length}/${reservations.length} 个库存锁；已阻止后续执行。`, context, {
              payload: { operation, releasedReservationIds: released.map((item) => text(item.external_reservation_id)), failedReservationId: reservationId, error: text(error?.message) },
            });
          });
          throw Object.assign(new Error("库存锁只释放成功一部分，系统已暂停方案，请先恢复库存锁后重试。"), {
            code: "reservation_release_partial_failure",
            statusCode: 503,
            cause: error,
          });
        }
        throw error;
      }
    }
    return reservations;
  }

  function routeReconciliation(requestId, context = {}) {
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    const allocations = store.all("SELECT * FROM stockup_fulfillment_allocations WHERE request_id=? ORDER BY plan_version,created_at,id", [request.id]).map(allocationFromRow);
    const purchaseLines = store.all(`SELECT l.id,l.request_line_id,l.sku_snapshot AS sku,l.quantity,l.received_qty,l.cancelled_qty,l.status,
      o.id AS purchase_order_id,o.purchase_no,o.status AS purchase_order_status
      FROM stockup_purchase_order_lines l JOIN stockup_purchase_orders o ON o.id=l.purchase_order_id
      WHERE l.request_id=? ORDER BY l.created_at,l.id`, [request.id]).map((row) => ({
      id: text(row.id), requestLineId: text(row.request_line_id), sku: text(row.sku), quantity: number(row.quantity), receivedQty: number(row.received_qty), cancelledQty: number(row.cancelled_qty), status: text(row.status), purchaseOrderId: text(row.purchase_order_id), purchaseNo: text(row.purchase_no), purchaseOrderStatus: text(row.purchase_order_status),
    }));
    const warehouseLines = store.all(`SELECT l.id,l.request_line_id,l.sku,l.expected_qty,l.received_qty,l.good_qty,l.status,l.purchase_order_line_id,l.fulfillment_allocation_id,
      w.id AS work_order_id,w.work_order_no,w.status AS work_order_status,w.domestic_warehouse_id,w.domestic_warehouse_name
      FROM stockup_warehouse_work_order_lines l JOIN stockup_warehouse_work_orders w ON w.id=l.work_order_id
      WHERE w.request_id=? AND w.status!='cancelled' ORDER BY w.created_at,l.id`, [request.id]).map((row) => ({
      id: text(row.id), requestLineId: text(row.request_line_id), sku: text(row.sku), expectedQty: number(row.expected_qty), receivedQty: number(row.received_qty), goodQty: number(row.good_qty), status: text(row.status), purchaseOrderLineId: text(row.purchase_order_line_id), fulfillmentAllocationId: text(row.fulfillment_allocation_id), workOrderId: text(row.work_order_id), workOrderNo: text(row.work_order_no), workOrderStatus: text(row.work_order_status), domesticWarehouseId: text(row.domestic_warehouse_id), domesticWarehouseName: text(row.domestic_warehouse_name),
    }));
    const shipmentLines = store.all(`SELECT l.id,l.line_id AS request_line_id,l.sku,l.shipped_qty,l.fulfillment_allocation_id,
      s.id AS shipment_id,s.shipment_no,s.status AS shipment_status,s.handed_over_at
      FROM stockup_shipment_lines l JOIN stockup_shipments s ON s.id=l.shipment_id
      WHERE (s.request_id=? OR s.id IN (SELECT shipment_id FROM stockup_shipment_request_links WHERE request_id=?)) AND s.status!='cancelled'
      ORDER BY s.created_at,l.id`, [request.id, request.id]).map((row) => ({
      id: text(row.id), requestLineId: text(row.request_line_id), sku: text(row.sku), shippedQty: number(row.shipped_qty), fulfillmentAllocationId: text(row.fulfillment_allocation_id), shipmentId: text(row.shipment_id), shipmentNo: text(row.shipment_no), shipmentStatus: text(row.shipment_status), handedOverAt: text(row.handed_over_at),
    }));
    const reservations = store.all(`SELECT r.* FROM stockup_fulfillment_reservations r JOIN stockup_fulfillment_allocations a ON a.id=r.allocation_id WHERE a.request_id=? ORDER BY r.created_at,r.id`, [request.id]).map((row) => ({ id: text(row.id), allocationId: text(row.allocation_id), externalReservationId: text(row.external_reservation_id), warehouseId: text(row.warehouse_id), sku: text(row.sku), quantity: number(row.quantity), status: text(row.status), shipmentId: text(row.shipment_id) }));
    const warnings = [];
    const current = allocations.filter((item) => item.planVersion === number(request.routePlanVersion) && !["cancelled", "superseded"].includes(item.status));
    if (!current.length && purchaseLines.length) warnings.push({ code: "legacy_purchase_unmapped", level: "warning", message: `${purchaseLines.length} 条历史采购明细尚未映射到履约分配，迁移时不得重复采购。` });
    if (warehouseLines.some((line) => !line.fulfillmentAllocationId)) warnings.push({ code: "legacy_warehouse_unmapped", level: "warning", message: "存在尚未映射履约分配的国内仓工单，需先核对到货与入库数量。" });
    if (shipmentLines.some((line) => !line.fulfillmentAllocationId)) warnings.push({ code: "legacy_shipment_unmapped", level: "danger", message: "存在旧流程发运数量，不能自动生成新库存锁定；需管理员逐单迁移。" });
    const requestedQty = request.lines.reduce((sum, line) => sum + number(line.requestedQty), 0);
    const currentPlannedQty = current.reduce((sum, item) => sum + item.plannedQty, 0);
    if (current.length && currentPlannedQty !== requestedQty) warnings.push({ code: "allocation_quantity_mismatch", level: "danger", message: `当前履约分配 ${currentPlannedQty} 与需求 ${requestedQty} 不一致。` });
    const hasLegacyExecution = purchaseLines.length > 0 || warehouseLines.length > 0 || shipmentLines.length > 0;
    return {
      ok: true,
      requestId: request.id,
      requestNo: request.requestNo,
      routePlanVersion: number(request.routePlanVersion),
      summary: { requestedQty, currentPlannedQty, allocationCount: allocations.length, purchaseLineCount: purchaseLines.length, warehouseLineCount: warehouseLines.length, shipmentLineCount: shipmentLines.length, reservationCount: reservations.length },
      allocations,
      purchaseLines,
      warehouseLines,
      shipmentLines,
      reservations,
      warnings,
      requiresAdminReview: !current.length && hasLegacyExecution,
      canCreateFreshPlan: !hasLegacyExecution && !current.length,
      generatedAt: nowIso(),
    };
  }

  function availabilityFor(lines, context) {
    const skus = [...new Set(lines.map((line) => normalizedSku(line.sku)).filter(Boolean))];
    const payload = skus.length && inventoryGateway.getAvailabilitySummary
      ? inventoryGateway.getAvailabilitySummary(skus, context)
      : { queriedAt: nowIso(), items: [] };
    return { queriedAt: text(payload?.queriedAt) || nowIso(), bySku: new Map((payload?.items || []).map((item) => [normalizedSku(item.sku), item])) };
  }

  function supplyModeFor(line, overrides = {}) {
    const override = text(overrides[line.id] || overrides[normalizedSku(line.sku)]);
    return override || text(line.effectiveSupplyMode) || text(line.defaultSupplyMode) || "待判断";
  }

  function recommendWarehouse(lines, availability) {
    const scores = new Map();
    for (const line of lines) {
      const item = availability.bySku.get(normalizedSku(line.sku));
      for (const warehouse of item?.warehouses || []) {
        const warehouseId = text(warehouse.warehouseId || warehouse.id);
        if (!warehouseId) continue;
        const current = scores.get(warehouseId) || { id: warehouseId, name: text(warehouse.warehouseName || warehouse.name), coverageQty: 0, skuCount: 0 };
        const availableQty = Math.max(0, number(warehouse.availableQty));
        current.coverageQty += Math.min(number(line.requestedQty), availableQty);
        if (availableQty > 0) current.skuCount += 1;
        scores.set(warehouseId, current);
      }
    }
    return [...scores.values()].sort((left, right) => right.coverageQty - left.coverageQty || right.skuCount - left.skuCount || left.name.localeCompare(right.name, "zh-CN"))[0] || { id: "", name: "", coverageQty: 0, skuCount: 0 };
  }

  function previewRoute(requestId, payload = {}, context = {}) {
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    if (request.workflowVersion !== 2) fail("只有现货备货 V2/V3 需求可以计算多来源履约方案。", "route_request_version", 409);
    if (["cancelled", "completed", "cost_locked"].includes(request.status)) fail("当前需求状态不能重新计算履约方案。", "route_request_state", 409);
    const availability = availabilityFor(request.lines, context);
    const recommended = recommendWarehouse(request.lines, availability);
    const targetId = text(payload.consolidationWarehouseId) || recommended.id;
    const allWarehouses = new Map();
    for (const item of availability.bySku.values()) for (const warehouse of item?.warehouses || []) allWarehouses.set(text(warehouse.warehouseId || warehouse.id), text(warehouse.warehouseName || warehouse.name));
    const targetName = text(payload.consolidationWarehouseName) || allWarehouses.get(targetId) || recommended.name;
    const allocations = [];
    const overrides = payload.supplyModeOverrides && typeof payload.supplyModeOverrides === "object" ? payload.supplyModeOverrides : {};
    const quantityOverrides = payload.quantityOverrides && typeof payload.quantityOverrides === "object" ? payload.quantityOverrides : {};
    for (const line of request.lines) {
      const requestedQty = Object.prototype.hasOwnProperty.call(quantityOverrides, line.id) ? number(quantityOverrides[line.id]) : number(line.requestedQty);
      if (requestedQty <= 0) fail(`${line.sku} 的调整后需求数量必须大于 0。`, "invalid_route_quantity", 400);
      const item = availability.bySku.get(normalizedSku(line.sku)) || {};
      const warehouses = (item.warehouses || []).map((warehouse) => ({
        id: text(warehouse.warehouseId || warehouse.id),
        name: text(warehouse.warehouseName || warehouse.name),
        availableQty: Math.max(0, number(warehouse.availableQty)),
      })).filter((warehouse) => warehouse.id && warehouse.availableQty > 0);
      warehouses.sort((left, right) => (left.id === targetId ? -1 : right.id === targetId ? 1 : right.availableQty - left.availableQty));
      let remaining = requestedQty;
      for (const warehouse of warehouses) {
        if (remaining <= 0) break;
        const quantity = Math.min(remaining, warehouse.availableQty);
        if (quantity <= 0) continue;
        allocations.push({
          id: id("sfa"), requestId: request.id, requestLineId: line.id,
          sourceType: warehouse.id === targetId ? "domestic_stock" : "transfer",
          sourceWarehouseId: warehouse.id, sourceWarehouseName: warehouse.name,
          targetWarehouseId: targetId, targetWarehouseName: targetName,
          plannedQty: quantity, reservedQty: 0, receivedQty: 0, readyQty: 0, shippedQty: 0, exceptionQty: 0,
          status: warehouse.id === targetId ? "preview_ready" : "preview_transfer", expectedReadyAt: "",
        });
        remaining -= quantity;
      }
      if (remaining > 0) {
        const supplyMode = supplyModeFor(line, overrides);
        allocations.push({
          id: id("sfa"), requestId: request.id, requestLineId: line.id, sourceType: modeToSource(supplyMode),
          sourceWarehouseId: "", sourceWarehouseName: "", targetWarehouseId: targetId, targetWarehouseName: targetName,
          plannedQty: remaining, reservedQty: 0, receivedQty: 0, readyQty: 0, shippedQty: 0, exceptionQty: 0,
          status: "preview_shortage", expectedReadyAt: "", supplyMode,
        });
      }
    }
    const blockers = [];
    if (!targetId) blockers.push({ code: "consolidation_warehouse_required", message: "没有可推荐的国内集货仓，请手动选择。" });
    const unresolved = allocations.filter((allocation) => allocation.sourceType === "unresolved");
    if (unresolved.length) blockers.push({ code: "supply_mode_required", message: `${unresolved.length} 个缺口尚未选择采购或委外生产。` });
    return {
      ok: true,
      requestId: request.id,
      requestNo: request.requestNo,
      expectedRequestVersion: request.version,
      nextPlanVersion: number(request.routePlanVersion) + 1,
      queriedAt: availability.queriedAt,
      recommendedConsolidationWarehouse: recommended,
      consolidationWarehouse: { id: targetId, name: targetName },
      allocations,
      routingSummary: routeSummary(allocations),
      blockers,
      canConfirm: blockers.length === 0,
    };
  }

  function confirmRoute(requestId, payload = {}, context = {}, idempotencyKey = "") {
    const actor = userOf(context);
    const key = text(idempotencyKey);
    if (!key) fail("确认执行方案必须提供 Idempotency-Key。", "idempotency_key_required", 400);
    const replay = store.first("SELECT response_json FROM stockup_route_command_receipts WHERE idempotency_key=?", [key]);
    if (replay) return { ...json(replay.response_json, {}), idempotentReplay: true };
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    if (number(payload.expectedVersion, request.version) !== request.version) fail("需求已被其他人更新，请刷新后重新确认。", "version_conflict", 409, { latestVersion: request.version });
    const existing = currentAllocations(request.id).filter((allocation) => ACTIVE_ALLOCATION_STATUSES.has(allocation.status));
    if (existing.length) fail("当前需求已有生效中的履约方案，请使用重新计算并替换方案。", "active_route_exists", 409);
    const reconciliation = routeReconciliation(request.id, context);
    if (reconciliation.requiresAdminReview) fail("检测到旧流程采购、仓库或发运单据，必须先完成管理员逐单对账，不能直接创建新库存锁定。", "historical_reconciliation_required", 409, { reconciliation });
    const preview = previewRoute(request.id, payload, context);
    if (!preview.canConfirm) fail("履约方案仍有阻塞项，暂时不能确认。", "route_blocked", 409, { blockers: preview.blockers });
    const quantityOverrides = payload.quantityOverrides && typeof payload.quantityOverrides === "object" ? payload.quantityOverrides : {};
    const quantityChanges = request.lines.filter((line) => Object.prototype.hasOwnProperty.call(quantityOverrides, line.id) && number(quantityOverrides[line.id]) !== number(line.requestedQty));
    const hasSupplyChanges = request.lines.some((line) => text(payload.supplyModeOverrides?.[line.id]) && text(payload.supplyModeOverrides?.[line.id]) !== text(line.defaultSupplyMode));
    if ((quantityChanges.length || hasSupplyChanges) && !text(payload.overrideReason)) fail("调整需求数量或默认供应方式时必须填写原因。", "route_override_reason_required", 400);
    const planVersion = preview.nextPlanVersion;
    const inventoryAllocations = preview.allocations.filter((item) => ["domestic_stock", "transfer"].includes(item.sourceType));
    const reservations = [];
    try {
      // Reserve each allocation independently. Besides making the source of every
      // quantity auditable, this allows a later shipment to commit only the
      // allocations that are actually handed to the forwarder.
      for (const allocation of inventoryAllocations) {
        const line = request.lines.find((item) => item.id === allocation.requestLineId);
        const referenceNo = `stockup-route:${request.requestNo}:v${planVersion}:${allocation.id}`;
        const result = inventoryGateway.reserveStock?.({
          warehouseId: allocation.sourceWarehouseId,
          referenceNo,
          note: `备货履约锁库：${request.requestNo} / V${planVersion}`,
          lines: [{ sku: line?.sku, quantity: allocation.plannedQty, unitCostCny: number(line?.targetUnitCostCny) }],
        }, context, `stockup-route:${request.id}:${planVersion}:${allocation.id}`);
        if (!result?.reservation?.id) fail(`仓库 ${allocation.sourceWarehouseName || allocation.sourceWarehouseId} 库存锁定失败。`, "inventory_reservation_failed", 503);
        reservations.push({ allocation, line, reservation: result.reservation, referenceNo });
      }
      const now = nowIso();
      const response = store.transaction(() => {
        const reservationByAllocation = new Map(reservations.map((item) => [item.allocation.id, item]));
        for (const allocation of preview.allocations) {
          const reservation = reservationByAllocation.get(allocation.id);
          const isInventory = ["domestic_stock", "transfer"].includes(allocation.sourceType);
          const ready = allocation.sourceType === "domestic_stock" ? allocation.plannedQty : 0;
          const status = allocation.sourceType === "domestic_stock" ? "ready"
            : allocation.sourceType === "transfer" ? "transfer_suggested"
              : allocation.sourceType === "purchase" ? "pending_purchase"
                : allocation.sourceType === "outsourced_production" ? "pending_outsourcing" : "unresolved";
          store.run(`INSERT INTO stockup_fulfillment_allocations
            (id,request_id,request_line_id,plan_version,source_type,source_warehouse_id,source_warehouse_name,target_warehouse_id,target_warehouse_name,planned_qty,reserved_qty,received_qty,ready_qty,shipped_qty,exception_qty,status,external_reservation_id,reference_type,reference_id,reference_no,expected_ready_at,version,created_by,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, [allocation.id, request.id, allocation.requestLineId, planVersion, allocation.sourceType, allocation.sourceWarehouseId, allocation.sourceWarehouseName,
            preview.consolidationWarehouse.id, preview.consolidationWarehouse.name, allocation.plannedQty, isInventory ? allocation.plannedQty : 0, 0, ready, 0, 0, status,
            text(reservation?.reservation?.id), isInventory ? "inventory_reservation" : "", text(reservation?.reservation?.id), text(reservation?.referenceNo), text(allocation.expectedReadyAt), actor.id, now, now]);
          if (reservation?.reservation?.id) store.run(`INSERT INTO stockup_fulfillment_reservations
            (id,allocation_id,external_reservation_id,warehouse_id,sku,quantity,status,shipment_id,reference_no,created_at,updated_at)
            VALUES (?,?,?,?,?,?,'reserved','',?,?,?)`, [id("sfr"), allocation.id, reservation.reservation.id, allocation.sourceWarehouseId, text(reservation.line?.sku), allocation.plannedQty, reservation.referenceNo, now, now]);
        }
        store.run(`INSERT INTO stockup_route_plan_versions
          (id,request_id,plan_version,plan_status,consolidation_warehouse_id,consolidation_warehouse_name,snapshot_json,reason,created_by,created_by_name,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id("srpv"), request.id, planVersion, "confirmed", preview.consolidationWarehouse.id, preview.consolidationWarehouse.name, JSON.stringify(preview), text(payload.reason), actor.id, actor.name, now]);
        const allocations = preview.allocations;
        const allReady = allocations.length > 0 && allocations.every((allocation) => allocation.sourceType === "domestic_stock");
        const journeyStage = allReady ? "ready_to_ship" : "sourcing";
        const status = allReady ? "inventory_ready" : "in_progress";
        store.run(`UPDATE stockup_requests SET status=?,journey_stage=?,consolidation_warehouse_id=?,consolidation_warehouse_name=?,route_plan_version=?,version=version+1,updated_at=? WHERE id=?`,
          [status, journeyStage, preview.consolidationWarehouse.id, preview.consolidationWarehouse.name, planVersion, now, request.id]);
        for (const line of request.lines) {
          const lineAllocations = allocations.filter((allocation) => allocation.requestLineId === line.id);
          const requestedQty = Object.prototype.hasOwnProperty.call(quantityOverrides, line.id) ? number(quantityOverrides[line.id]) : number(line.requestedQty);
          const stockQty = lineAllocations.filter((allocation) => ["domestic_stock", "transfer"].includes(allocation.sourceType)).reduce((sum, allocation) => sum + allocation.plannedQty, 0);
          const purchaseQty = lineAllocations.filter((allocation) => allocation.sourceType === "purchase").reduce((sum, allocation) => sum + allocation.plannedQty, 0);
          const effectiveMode = text(payload.supplyModeOverrides?.[line.id]) || text(line.effectiveSupplyMode) || text(line.defaultSupplyMode) || "待判断";
          const overrideReason = text(payload.supplyModeOverrides?.[line.id]) && text(payload.supplyModeOverrides?.[line.id]) !== text(line.defaultSupplyMode) ? text(payload.overrideReason) : "";
          const lineOverrideReason = overrideReason || (requestedQty !== number(line.requestedQty) ? text(payload.overrideReason) : "");
          store.run(`UPDATE stockup_request_lines SET requested_qty=?,method=?,domestic_allocated_qty=?,procurement_required_qty=?,effective_supply_mode=?,supply_override_reason=?,supply_override_by=?,supply_override_at=?,status=?,updated_at=? WHERE id=?`,
            [requestedQty, lineAllocations.map((allocation) => allocation.sourceType).join("+"), stockQty, purchaseQty, effectiveMode, lineOverrideReason, lineOverrideReason ? actor.name : "", lineOverrideReason ? now : "", status, now, line.id]);
        }
        addEvent(request.id, "route_confirmed", "履约方案已确认", `V${planVersion} · ${preview.consolidationWarehouse.name} · 现货 ${preview.routingSummary.domesticStock} / 调拨 ${preview.routingSummary.transfer} / 采购 ${preview.routingSummary.purchase} / 委外 ${preview.routingSummary.outsourcedProduction}`, context, { payload: { planVersion, routingSummary: preview.routingSummary, quantityChanges: quantityChanges.map((line) => ({ lineId: line.id, sku: line.sku, from: line.requestedQty, to: number(quantityOverrides[line.id]) })), reason: text(payload.overrideReason) } });
        const hydrated = decorateRequest(getRequest(request.id, { ...context, viewAll: true }), context);
        const result = { ok: true, idempotentReplay: false, request: hydrated, planVersion, allocations: hydrated.allocations, routingSummary: hydrated.routingSummary };
        store.run("INSERT INTO stockup_route_command_receipts (idempotency_key,request_id,command_type,response_json,created_at) VALUES (?,?,?,?,?)", [key, request.id, "confirm", JSON.stringify(result), now]);
        return result;
      });
      return response;
    } catch (error) {
      for (const item of reservations.reverse()) {
        try { inventoryGateway.releaseReservation?.(item.reservation.id, context); } catch { /* preserve primary error */ }
      }
      throw error;
    }
  }

  function replaceRoute(requestId, payload = {}, context = {}, idempotencyKey = "") {
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    const active = currentAllocations(request.id);
    if (active.some((allocation) => allocation.shippedQty > 0 || ["purchase_order_line", "outsourcing_order", "domestic_transfer"].includes(allocation.referenceType))) {
      fail("已有发运或外部单据关联，不能直接替换方案；请先处理对应分支异常。", "route_replace_has_execution", 409);
    }
    releasePlanReservationsOrMarkRecovery(request, active, context, "重新计算履约方案");
    const now = nowIso();
    store.transaction(() => {
      store.run("UPDATE stockup_fulfillment_allocations SET status='superseded',version=version+1,updated_at=? WHERE request_id=? AND plan_version=?", [now, request.id, request.routePlanVersion]);
      store.run(`UPDATE stockup_fulfillment_reservations SET status='released',updated_at=? WHERE allocation_id IN
        (SELECT id FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=?) AND status='reserved'`, [now, request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_route_plan_versions SET plan_status='superseded' WHERE request_id=? AND plan_version=?", [request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_requests SET journey_stage='route_planning',status='submitted',version=version+1,updated_at=? WHERE id=?", [now, request.id]);
    });
    const fresh = getRequest(request.id, { ...context, viewAll: true });
    return confirmRoute(request.id, { ...payload, expectedVersion: fresh.version }, context, idempotencyKey);
  }

  function confirmTransfer(allocationId, payload = {}, context = {}, idempotencyKey = "") {
    ensureEnabled();
    if (!inventoryGateway.createTransfer || !inventoryGateway.releaseReservation || !inventoryGateway.reserveStock) {
      fail("国内库存调拨服务尚未配置。", "transfer_gateway_unavailable", 503);
    }
    const row = store.first(`SELECT a.*,rl.sku,rl.product_name,rl.unit,rl.target_unit_cost_cny,r.request_no
      FROM stockup_fulfillment_allocations a JOIN stockup_request_lines rl ON rl.id=a.request_line_id
      JOIN stockup_requests r ON r.id=a.request_id WHERE a.id=?`, [text(allocationId)]);
    const allocation = allocationFromRow(row);
    if (!allocation || allocation.sourceType !== "transfer") fail("跨仓调拨分配不存在。", "transfer_allocation_not_found", 404);
    ensureRequestEnabled(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
    if (allocation.status === "transfer_in_progress" && allocation.referenceId) {
      return { ok: true, idempotentReplay: true, transfer: inventoryGateway.getTransfer?.(allocation.referenceId, context)?.transfer || null, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
    }
    if (allocation.status !== "transfer_suggested") fail("当前分配状态不能创建调拨单。", "transfer_allocation_state", 409);
    const reservations = store.all("SELECT * FROM stockup_fulfillment_reservations WHERE allocation_id=? AND status='reserved' AND COALESCE(shipment_id,'')='' ORDER BY created_at,id", [allocation.id]);
    if (reservations.reduce((sum, item) => sum + number(item.quantity), 0) < allocation.plannedQty) fail("源仓库存预留不完整，请先恢复锁库。", "transfer_source_reservation_missing", 409);
    const released = [];
    try {
      for (const reservation of reservations) {
        inventoryGateway.releaseReservation(text(reservation.external_reservation_id), context);
        released.push(reservation);
      }
      const created = inventoryGateway.createTransfer({
        sourceWarehouseId: allocation.sourceWarehouseId,
        targetWarehouseId: allocation.targetWarehouseId,
        note: text(payload.note) || `备货需求 ${text(row.request_no)} 履约调拨`,
        lines: [{ sku: text(row.sku), quantity: allocation.plannedQty, unitCostCny: number(row.target_unit_cost_cny) }],
      }, context, text(idempotencyKey) || `stockup-transfer:${allocation.id}`);
      if (!created?.transferId) fail("国内仓调拨单创建失败。", "transfer_create_failed", 503);
      const now = nowIso();
      return store.transaction(() => {
        store.run("UPDATE stockup_fulfillment_reservations SET status='transferred_source',updated_at=? WHERE allocation_id=? AND status='reserved'", [now, allocation.id]);
        store.run("UPDATE stockup_fulfillment_allocations SET status='transfer_in_progress',reserved_qty=0,external_reservation_id='',reference_type='domestic_transfer',reference_id=?,reference_no=?,expected_ready_at=?,version=version+1,updated_at=? WHERE id=?", [created.transferId, text(created.transferNo), text(payload.expectedReadyAt), now, allocation.id]);
        store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='consolidating',version=version+1,updated_at=? WHERE id=?", [now, allocation.requestId]);
        addEvent(allocation.requestId, "transfer_created", "跨仓调拨单已创建", `${text(created.transferNo)} · ${allocation.sourceWarehouseName} → ${allocation.targetWarehouseName} · ${allocation.plannedQty}`, context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id, transferId: created.transferId } });
        return { ok: true, idempotentReplay: Boolean(created.idempotentReplay), transfer: created.transfer || null, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
      });
    } catch (error) {
      if (released.length) {
        try {
          const restored = inventoryGateway.reserveStock({
            warehouseId: allocation.sourceWarehouseId,
            referenceNo: `stockup-transfer-rollback:${allocation.id}`,
            note: `调拨创建失败，恢复备货锁库 ${text(row.request_no)}`,
            lines: [{ sku: text(row.sku), quantity: allocation.plannedQty, unitCostCny: number(row.target_unit_cost_cny) }],
          }, context, `stockup-transfer-rollback:${allocation.id}`);
          const now = nowIso();
          store.transaction(() => {
            store.run("UPDATE stockup_fulfillment_reservations SET external_reservation_id=?,status='reserved',updated_at=? WHERE id=?", [text(restored?.reservation?.id), now, released[0].id]);
            for (const duplicate of released.slice(1)) store.run("UPDATE stockup_fulfillment_reservations SET status='released',updated_at=? WHERE id=?", [now, duplicate.id]);
            store.run("UPDATE stockup_fulfillment_allocations SET external_reservation_id=?,reserved_qty=?,status='transfer_suggested',version=version+1,updated_at=? WHERE id=?", [text(restored?.reservation?.id), allocation.plannedQty, now, allocation.id]);
          });
        } catch (restoreError) {
          const now = nowIso();
          store.run("UPDATE stockup_fulfillment_allocations SET status='reservation_recovery_required',reserved_qty=0,exception_qty=?,version=version+1,updated_at=? WHERE id=?", [allocation.plannedQty, now, allocation.id]);
          store.persist();
          addEvent(allocation.requestId, "transfer_reservation_recovery_required", "调拨创建失败且源仓锁库恢复失败", text(restoreError?.message), context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id } });
        }
      }
      throw error;
    }
  }

  function syncTransfer(allocationId, context = {}) {
    ensureEnabled();
    if (!inventoryGateway.getTransfer || !inventoryGateway.reserveStock) fail("国内库存调拨服务尚未配置。", "transfer_gateway_unavailable", 503);
    const row = store.first(`SELECT a.*,rl.sku,rl.product_name,rl.unit,rl.target_unit_cost_cny,r.request_no
      FROM stockup_fulfillment_allocations a JOIN stockup_request_lines rl ON rl.id=a.request_line_id
      JOIN stockup_requests r ON r.id=a.request_id WHERE a.id=?`, [text(allocationId)]);
    const allocation = allocationFromRow(row);
    if (!allocation || allocation.sourceType !== "transfer" || allocation.referenceType !== "domestic_transfer" || !allocation.referenceId) fail("尚未创建可同步的跨仓调拨单。", "transfer_reference_missing", 409);
    ensureRequestEnabled(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
    if (allocation.status === "ready") return { ok: true, idempotentReplay: true, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
    const transfer = inventoryGateway.getTransfer(allocation.referenceId, context)?.transfer;
    if (!transfer) fail("国内仓调拨单不存在。", "transfer_not_found", 404);
    if (transfer.status === "in_transit") return { ok: true, idempotentReplay: true, transfer, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
    if (transfer.status === "cancelled") {
      const restored = inventoryGateway.reserveStock({
        warehouseId: allocation.sourceWarehouseId,
        referenceNo: `stockup-transfer-cancelled:${allocation.id}`,
        note: `调拨取消，恢复备货锁库 ${text(row.request_no)}`,
        lines: [{ sku: text(row.sku), quantity: allocation.plannedQty, unitCostCny: number(row.target_unit_cost_cny) }],
      }, context, `stockup-transfer-cancelled:${allocation.id}`);
      const now = nowIso();
      return store.transaction(() => {
        store.run("INSERT INTO stockup_fulfillment_reservations (id,allocation_id,external_reservation_id,warehouse_id,sku,quantity,status,shipment_id,reference_no,created_at,updated_at) VALUES (?,?,?,?,?,?,'reserved','',?,?,?)", [id("sfr"), allocation.id, text(restored?.reservation?.id), allocation.sourceWarehouseId, text(row.sku), allocation.plannedQty, `stockup-transfer-cancelled:${allocation.id}`, now, now]);
        store.run("UPDATE stockup_fulfillment_allocations SET status='transfer_suggested',reserved_qty=?,external_reservation_id=?,reference_type='',reference_id='',reference_no='',exception_qty=0,version=version+1,updated_at=? WHERE id=?", [allocation.plannedQty, text(restored?.reservation?.id), now, allocation.id]);
        addEvent(allocation.requestId, "transfer_cancelled", "跨仓调拨已取消，源仓库存重新锁定", `${text(transfer.transferNo)} · ${allocation.plannedQty}`, context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id } });
        return { ok: true, transfer, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
      });
    }
    if (transfer.status !== "received") fail("跨仓调拨状态暂不能同步。", "transfer_state_unknown", 409);
    let targetReservation;
    try {
      targetReservation = inventoryGateway.reserveStock({
        warehouseId: allocation.targetWarehouseId,
        referenceNo: `stockup-transfer-received:${allocation.id}`,
        note: `调拨到仓后锁定给备货需求 ${text(row.request_no)}`,
        lines: [{ sku: text(row.sku), quantity: allocation.plannedQty, unitCostCny: number(row.target_unit_cost_cny) }],
      }, context, `stockup-transfer-received:${allocation.id}`)?.reservation;
      if (!targetReservation?.id) fail("调拨已到仓，但目标仓锁库失败。", "transfer_target_reservation_failed", 503);
    } catch (error) {
      const now = nowIso();
      store.run("UPDATE stockup_fulfillment_allocations SET status='reservation_recovery_required',received_qty=?,reserved_qty=0,exception_qty=?,version=version+1,updated_at=? WHERE id=?", [allocation.plannedQty, allocation.plannedQty, now, allocation.id]);
      store.run("UPDATE stockup_requests SET status='in_progress',journey_stage='route_recovery',version=version+1,updated_at=? WHERE id=?", [now, allocation.requestId]);
      store.persist();
      addEvent(allocation.requestId, "transfer_target_reservation_recovery_required", "调拨已到仓但目标仓锁库失败", text(error?.message), context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id, transferId: allocation.referenceId } });
      throw error;
    }
    const now = nowIso();
    return store.transaction(() => {
      store.run("INSERT INTO stockup_fulfillment_reservations (id,allocation_id,external_reservation_id,warehouse_id,sku,quantity,status,shipment_id,reference_no,created_at,updated_at) VALUES (?,?,?,?,?,?,'reserved','',?,?,?)", [id("sfr"), allocation.id, targetReservation.id, allocation.targetWarehouseId, text(row.sku), allocation.plannedQty, `stockup-transfer-received:${allocation.id}`, now, now]);
      store.run("UPDATE stockup_fulfillment_allocations SET status='ready',received_qty=?,reserved_qty=?,ready_qty=?,external_reservation_id=?,exception_qty=0,version=version+1,updated_at=? WHERE id=?", [allocation.plannedQty, allocation.plannedQty, allocation.plannedQty, targetReservation.id, now, allocation.id]);
      const balance = store.first("SELECT COALESCE(SUM(planned_qty),0) AS planned,COALESCE(SUM(ready_qty+shipped_qty),0) AS ready FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=(SELECT route_plan_version FROM stockup_requests WHERE id=?)", [allocation.requestId, allocation.requestId]);
      const allReady = number(balance?.planned) > 0 && number(balance?.ready) >= number(balance?.planned);
      store.run("UPDATE stockup_requests SET status=?,journey_stage=?,version=version+1,updated_at=? WHERE id=?", [allReady ? "inventory_ready" : "in_progress", allReady ? "ready_to_ship" : "consolidating", now, allocation.requestId]);
      addEvent(allocation.requestId, "transfer_received", "跨仓调拨已到集货仓并锁定", `${text(transfer.transferNo)} · ${allocation.targetWarehouseName} · ${allocation.plannedQty}`, context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id, transferId: allocation.referenceId, reservationId: targetReservation.id } });
      return { ok: true, transfer, request: decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context) };
    });
  }

  function syncTransferByReference(transferId, context = {}) {
    ensureEnabled();
    const allocation = store.first(`SELECT id FROM stockup_fulfillment_allocations
      WHERE source_type='transfer' AND reference_type='domestic_transfer' AND reference_id=?
        AND status NOT IN ('cancelled','superseded')
      ORDER BY updated_at DESC,id DESC LIMIT 1`, [text(transferId)]);
    if (!allocation) return { ok: true, skipped: true, reason: "stockup_allocation_not_found" };
    return syncTransfer(text(allocation.id), context);
  }

  function linkOutsourcing(allocationId, payload = {}, context = {}) {
    ensureEnabled();
    const allocation = allocationFromRow(store.first("SELECT * FROM stockup_fulfillment_allocations WHERE id=?", [text(allocationId)]));
    if (!allocation || allocation.sourceType !== "outsourced_production") fail("委外履约分配不存在。", "outsourcing_allocation_not_found", 404);
    ensureRequestEnabled(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
    if (!["pending_outsourcing", "outsourcing_linked"].includes(allocation.status)) fail("当前委外分配状态不能关联加工单。", "outsourcing_allocation_state", 409);
    const referenceId = text(payload.orderId || payload.referenceId);
    const referenceNo = text(payload.orderNo || payload.referenceNo);
    if (!referenceId && !referenceNo) fail("请选择要关联的简道云委外加工单。", "outsourcing_reference_required");
    const duplicate = store.first("SELECT id FROM stockup_fulfillment_allocations WHERE id!=? AND source_type='outsourced_production' AND reference_type='outsourcing_order' AND reference_id=? AND status NOT IN ('cancelled','superseded')", [allocation.id, referenceId]);
    if (duplicate) fail("该委外加工单已关联其他备货履约分配。", "outsourcing_reference_conflict", 409);
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_fulfillment_allocations SET status='outsourcing_linked',reference_type='outsourcing_order',reference_id=?,reference_no=?,expected_ready_at=?,version=version+1,updated_at=? WHERE id=?", [referenceId, referenceNo, text(payload.expectedReadyAt), now, allocation.id]);
      addEvent(allocation.requestId, "outsourcing_linked", "已关联委外加工单", `${referenceNo || referenceId} · ${allocation.plannedQty}`, context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id, referenceId, referenceNo } });
      const request = decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
      return { ok: true, allocation: request.allocations.find((item) => item.id === allocation.id), request };
    });
  }

  function recoverReservation(allocationId, context = {}) {
    ensureEnabled();
    if (!inventoryGateway.reserveStock) fail("国内库存锁定服务尚未配置。", "inventory_reservation_gateway_unavailable", 503);
    const row = store.first(`SELECT a.*,rl.sku,rl.target_unit_cost_cny,r.request_no
      FROM stockup_fulfillment_allocations a JOIN stockup_request_lines rl ON rl.id=a.request_line_id
      JOIN stockup_requests r ON r.id=a.request_id WHERE a.id=?`, [text(allocationId)]);
    const allocation = allocationFromRow(row);
    if (!allocation) fail("履约分配不存在。", "fulfillment_allocation_not_found", 404);
    ensureRequestEnabled(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
    if (allocation.status !== "reservation_recovery_required") fail("当前履约分配不需要恢复库存锁定。", "reservation_recovery_not_required", 409);
    const atTargetWarehouse = allocation.sourceType === "domestic_stock" || allocation.receivedQty > 0;
    const warehouseId = atTargetWarehouse ? allocation.targetWarehouseId : allocation.sourceWarehouseId;
    if (!warehouseId) fail("履约分配缺少可恢复锁库的国内仓。", "reservation_recovery_warehouse_missing", 409);
    const recoverableBaseQty = allocation.sourceType === "domestic_stock"
      ? allocation.plannedQty
      : atTargetWarehouse ? Math.min(allocation.plannedQty, allocation.receivedQty) : allocation.plannedQty;
    const recoverableQty = atTargetWarehouse
      ? Math.max(0, recoverableBaseQty - allocation.reservedQty - allocation.shippedQty)
      : Math.max(0, allocation.plannedQty - allocation.reservedQty - allocation.shippedQty);
    if (recoverableQty <= 0) fail("没有需要恢复锁定的数量。", "reservation_recovery_quantity_empty", 409);
    const referenceNo = `stockup-recovery:${allocation.id}:${allocation.version}`;
    const result = inventoryGateway.reserveStock({
      warehouseId,
      referenceNo,
      note: `备货履约异常恢复：${text(row.request_no)}`,
      lines: [{ sku: text(row.sku), quantity: recoverableQty, unitCostCny: number(row.target_unit_cost_cny) }],
    }, context, referenceNo);
    if (!result?.reservation?.id) fail("库存锁定仍未恢复，请稍后重试。", "inventory_reservation_failed", 503);
    const now = nowIso();
    try {
      return store.transaction(() => {
        const nextReservedQty = Math.min(allocation.plannedQty, allocation.reservedQty + recoverableQty);
        const nextReadyQty = atTargetWarehouse ? Math.min(allocation.plannedQty, allocation.readyQty + recoverableQty) : allocation.readyQty;
        const nextStatus = atTargetWarehouse
          ? (nextReadyQty >= allocation.plannedQty ? "ready" : "waiting_inbound")
          : allocation.sourceType === "transfer" ? "transfer_suggested" : "reserved";
        store.run(`INSERT INTO stockup_fulfillment_reservations
          (id,allocation_id,external_reservation_id,warehouse_id,sku,quantity,status,shipment_id,reference_no,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'reserved','',?,?,?)`, [id("sfr"), allocation.id, result.reservation.id, warehouseId, text(row.sku), recoverableQty, referenceNo, now, now]);
        store.run(`UPDATE stockup_fulfillment_allocations SET reserved_qty=?,ready_qty=?,status=?,external_reservation_id=?,exception_qty=MAX(0,exception_qty-?),version=version+1,updated_at=? WHERE id=?`,
          [nextReservedQty, nextReadyQty, nextStatus, result.reservation.id, recoverableQty, now, allocation.id]);
        const balance = store.first(`SELECT COALESCE(SUM(planned_qty),0) AS planned,COALESCE(SUM(ready_qty+shipped_qty),0) AS ready,
          SUM(CASE WHEN status='reservation_recovery_required' THEN 1 ELSE 0 END) AS recovery
          FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=(SELECT route_plan_version FROM stockup_requests WHERE id=?)`, [allocation.requestId, allocation.requestId]);
        const allReady = number(balance?.planned) > 0 && number(balance?.ready) >= number(balance?.planned);
        const stillRecovering = number(balance?.recovery) > 0;
        store.run("UPDATE stockup_requests SET status=?,journey_stage=?,version=version+1,updated_at=? WHERE id=?", [allReady ? "inventory_ready" : "in_progress", allReady ? "ready_to_ship" : stillRecovering ? "route_recovery" : "consolidating", now, allocation.requestId]);
        addEvent(allocation.requestId, "route_reservation_recovered", "库存锁定已恢复", `${text(row.sku)} · ${recoverableQty}`, context, { lineId: allocation.requestLineId, payload: { allocationId: allocation.id, reservationId: result.reservation.id, warehouseId } });
        const request = decorateRequest(getRequest(allocation.requestId, { ...context, viewAll: true }), context);
        return { ok: true, allocation: request.allocations.find((item) => item.id === allocation.id), request };
      });
    } catch (error) {
      try { inventoryGateway.releaseReservation?.(result.reservation.id, context); } catch {}
      throw error;
    }
  }

  function updateProductSupplyMode(productRefId, payload = {}, context = {}) {
    ensureEnabled();
    const allowed = new Set(["外采成品", "委外生产", "自有成品库存", "待判断"]);
    const mode = text(payload.defaultSupplyMode);
    if (!allowed.has(mode)) fail("默认供应方式无效。", "invalid_supply_mode");
    const current = store.first("SELECT * FROM stockup_product_refs WHERE id=?", [text(productRefId)]);
    if (!current) fail("产品履约档案不存在。", "product_ref_not_found", 404);
    const now = nowIso();
    store.transaction(() => store.run("UPDATE stockup_product_refs SET default_supply_mode=?,updated_at=? WHERE id=?", [mode, now, current.id]));
    return { ok: true, productRefId: text(current.id), defaultSupplyMode: mode, updatedAt: now };
  }

  function decorateRequest(request, context = {}) {
    const routingEnabled = isEnabledForRequest(request, context);
    request.fulfillmentRoutingEnabled = routingEnabled;
    if (!routingEnabled) return request;
    const allocations = currentAllocations(request.id);
    const journey = deriveJourney(allocations, request);
    const byLine = new Map();
    for (const allocation of allocations) {
      const values = byLine.get(allocation.requestLineId) || [];
      values.push(allocation);
      byLine.set(allocation.requestLineId, values);
    }
    request.lines = (request.lines || []).map((line) => ({ ...line, allocations: byLine.get(line.id) || [] }));
    request.allocations = allocations;
    request.routingSummary = routeSummary(allocations);
    request.journeyStage = journey.journeyStage;
    request.ownerRole = journey.ownerRole;
    request.nextAction = journey.nextAction;
    request.blockers = journey.blockers;
    return request;
  }

  function cancelRoute(requestId, payload = {}, context = {}) {
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    const reason = text(payload.reason);
    if (!reason) fail("请填写作废原因。", "route_cancel_reason_required", 400);
    const allocations = currentAllocations(request.id);
    ensureRouteCanClose(request, allocations, "作废");
    const reservations = releasePlanReservationsOrMarkRecovery(request, allocations, context, "取消履约方案");
    const reservationIds = reservations.map((item) => text(item.external_reservation_id));
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_fulfillment_allocations SET status='cancelled',version=version+1,updated_at=? WHERE request_id=? AND plan_version=?", [now, request.id, request.routePlanVersion]);
      store.run(`UPDATE stockup_fulfillment_reservations SET status='released',updated_at=? WHERE allocation_id IN
        (SELECT id FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=?) AND status='reserved'`, [now, request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_route_plan_versions SET plan_status='cancelled' WHERE request_id=? AND plan_version=?", [request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_requests SET status='cancelled',journey_stage='cancelled',version=version+1,updated_at=? WHERE id=?", [now, request.id]);
      addEvent(request.id, "route_cancelled", "履约方案已取消并释放库存", reason, context, { payload: { reservationIds } });
      return { ok: true, request: decorateRequest(getRequest(request.id, { ...context, viewAll: true }), context) };
    });
  }

  function rollbackRoute(requestId, payload = {}, context = {}) {
    const request = getRequest(text(requestId), { ...context, viewAll: true });
    ensureRequestEnabled(request, context);
    const reason = text(payload.reason);
    if (!reason) fail("请填写回退原因。", "route_rollback_reason_required", 400);
    if (["cancelled", "handed_over", "overseas_received", "cost_locked", "completed"].includes(text(request.status))) {
      fail("当前需求已进入不可直接回退的阶段。", "route_rollback_state", 409);
    }
    const allocations = currentAllocations(request.id);
    ensureRouteCanClose(request, allocations, "回退");
    const linkedExecution = allocations.find((allocation) => ["purchase_order_line", "outsourcing_order"].includes(allocation.referenceType));
    if (linkedExecution) {
      fail(`履约分支已关联${linkedExecution.referenceType === "purchase_order_line" ? "采购单" : "委外加工单"} ${linkedExecution.referenceNo || linkedExecution.referenceId || ""}，请先取消或关闭对应下游单据，再回退执行方案。`, "route_rollback_has_external_execution", 409, {
        allocationId: linkedExecution.id, referenceType: linkedExecution.referenceType, referenceId: linkedExecution.referenceId, referenceNo: linkedExecution.referenceNo,
      });
    }
    const reservations = releasePlanReservationsOrMarkRecovery(request, allocations, context, "回退履约方案");
    const reservationIds = reservations.map((item) => text(item.external_reservation_id));
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_fulfillment_allocations SET status='superseded',version=version+1,updated_at=? WHERE request_id=? AND plan_version=?", [now, request.id, request.routePlanVersion]);
      store.run(`UPDATE stockup_fulfillment_reservations SET status='released',updated_at=? WHERE allocation_id IN
        (SELECT id FROM stockup_fulfillment_allocations WHERE request_id=? AND plan_version=?) AND status='reserved'`, [now, request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_route_plan_versions SET plan_status='rolled_back',reason=? WHERE request_id=? AND plan_version=?", [reason, request.id, request.routePlanVersion]);
      store.run("UPDATE stockup_requests SET status='submitted',journey_stage='route_planning',version=version+1,updated_at=? WHERE id=?", [now, request.id]);
      store.run("UPDATE stockup_request_lines SET status='submitted',updated_at=? WHERE request_id=?", [now, request.id]);
      addEvent(request.id, "route_rolled_back", "履约方案已退回重新规划", reason, context, { payload: { planVersion: request.routePlanVersion, reservationIds } });
      return { ok: true, request: decorateRequest(getRequest(request.id, { ...context, viewAll: true }), context) };
    });
  }

  return { cancelRoute, confirmRoute, confirmTransfer, currentAllocations, decorateRequest, enrichProductOptions, linkOutsourcing, previewRoute, recoverReservation, replaceRoute, rollbackRoute, routeReconciliation, syncTransfer, syncTransferByReference, updateProductSupplyMode };
}

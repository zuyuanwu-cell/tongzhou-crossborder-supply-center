import { randomUUID } from "node:crypto";
import { assertReceiptQuantities, assertRequestTransition, deriveRequestStatus, requestProgress } from "./stockup-status-machine.js";

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function businessNo(prefix) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function number(value, fallback = 0) {
  const output = Number(value);
  return Number.isFinite(output) ? output : fallback;
}

function required(value, label) {
  const output = String(value ?? "").trim();
  if (!output) {
    const error = new Error(`请填写${label}。`);
    error.code = "required";
    error.statusCode = 400;
    throw error;
  }
  return output;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function userOf(context = {}) {
  return {
    id: String(context.auth?.user?.id || "system"),
    name: String(context.auth?.user?.displayName || context.auth?.user?.username || "系统"),
  };
}

function money(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeLine(line, now) {
  const qty = number(line.requestedQty);
  if (qty <= 0) {
    const error = new Error(`${line.sku || line.productName || "产品"}的需求数量必须大于 0。`);
    error.code = "invalid_quantity";
    error.statusCode = 400;
    throw error;
  }
  return {
    id: id("srl"),
    productId: String(line.productId || ""),
    sku: required(line.sku, "产品 SKU"),
    productName: required(line.productName, "产品名称"),
    imageUrl: String(line.imageUrl || ""),
    specification: String(line.specification || ""),
    method: required(line.method || "采购", "执行方式"),
    requestedQty: qty,
    unit: String(line.unit || "件").trim() || "件",
    targetUnitCostCny: line.targetUnitCostCny === "" || line.targetUnitCostCny == null ? null : number(line.targetUnitCostCny),
    expectedArrivalAt: String(line.expectedArrivalAt || ""),
    note: String(line.note || ""),
    status: "pending_acceptance",
    createdAt: now,
    updatedAt: now,
  };
}

function requestFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    requestNo: String(row.request_no),
    project: String(row.project),
    destinationCountry: String(row.destination_country),
    destinationWarehouseId: String(row.destination_warehouse_id || ""),
    destinationWarehouseName: String(row.destination_warehouse_name),
    expectedArrivalAt: String(row.expected_arrival_at),
    priority: String(row.priority),
    reason: String(row.reason),
    platform: String(row.platform || ""),
    note: String(row.note || ""),
    status: String(row.status),
    progress: requestProgress(String(row.status)),
    requesterId: String(row.requester_id),
    requesterName: String(row.requester_name),
    assigneeId: String(row.assignee_id || ""),
    assigneeName: String(row.assignee_name || ""),
    exceptionCount: number(row.exception_count),
    version: number(row.version, 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function lineFromRow(row) {
  return {
    id: String(row.id), requestId: String(row.request_id), productId: String(row.product_id || ""), sku: String(row.sku),
    productName: String(row.product_name), imageUrl: String(row.image_url || ""), specification: String(row.specification || ""),
    method: String(row.method), requestedQty: number(row.requested_qty), unit: String(row.unit),
    targetUnitCostCny: row.target_unit_cost_cny == null ? null : number(row.target_unit_cost_cny),
    expectedArrivalAt: String(row.expected_arrival_at || ""), note: String(row.note || ""), status: String(row.status),
    fulfilledQty: number(row.fulfilled_qty), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function taskFromRow(row, revealSupplier = false) {
  return {
    id: String(row.id), requestId: String(row.request_id), lineId: String(row.line_id), taskNo: String(row.task_no), method: String(row.method),
    assigneeId: String(row.assignee_id || ""), assigneeName: String(row.assignee_name || ""),
    supplierName: revealSupplier ? String(row.supplier_name || "") : (row.supplier_name ? "供应方（已脱敏）" : ""),
    plannedQty: number(row.planned_qty), orderedQty: number(row.ordered_qty), completedQty: number(row.completed_qty), status: String(row.status),
    expectedOrderAt: String(row.expected_order_at || ""), expectedCompletedAt: String(row.expected_completed_at || ""),
    actualOrderedAt: String(row.actual_ordered_at || ""), actualCompletedAt: String(row.actual_completed_at || ""),
    exceptionType: String(row.exception_type || ""), exceptionNote: String(row.exception_note || ""), version: number(row.version, 1),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function shipmentFromRow(row) {
  return {
    id: String(row.id), requestId: String(row.request_id), shipmentNo: String(row.shipment_no), originWarehouse: String(row.origin_warehouse || ""),
    destinationWarehouseId: String(row.destination_warehouse_id || ""), destinationWarehouseName: String(row.destination_warehouse_name),
    destinationCountry: String(row.destination_country), carrier: String(row.carrier || ""), transportMode: String(row.transport_mode || ""),
    trackingNo: String(row.tracking_no || ""), etd: String(row.etd || ""), eta: String(row.eta || ""), actualShippedAt: String(row.actual_shipped_at || ""),
    status: String(row.status), packages: number(row.packages), totalWeightKg: number(row.total_weight_kg), totalVolumeM3: number(row.total_volume_m3),
    chargeableWeightKg: number(row.chargeable_weight_kg), note: String(row.note || ""), version: number(row.version, 1),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function receiptFromRow(row) {
  return {
    id: String(row.id), requestId: String(row.request_id), shipmentId: String(row.shipment_id), receiptNo: String(row.receipt_no),
    warehouseId: String(row.warehouse_id || ""), warehouseName: String(row.warehouse_name), wmsInboundNo: String(row.wms_inbound_no || ""),
    arrivedAt: String(row.arrived_at), shelvedAt: String(row.shelved_at || ""), status: String(row.status), note: String(row.note || ""),
    version: number(row.version, 1), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function eventFromRow(row) {
  return {
    id: String(row.id), requestId: String(row.request_id), lineId: String(row.line_id || ""), taskId: String(row.task_id || ""),
    shipmentId: String(row.shipment_id || ""), receiptId: String(row.receipt_id || ""), eventType: String(row.event_type),
    title: String(row.title), description: String(row.description || ""), visibility: String(row.visibility), actorId: String(row.actor_id),
    actorName: String(row.actor_name), payload: parseJson(row.payload_json, {}), occurredAt: String(row.occurred_at),
  };
}

function costItemFromRow(row) {
  return {
    id: String(row.id), requestId: String(row.request_id), shipmentId: String(row.shipment_id || ""), receiptId: String(row.receipt_id || ""),
    category: String(row.category), name: String(row.name), stage: String(row.stage), vendor: String(row.vendor || ""), invoiceNo: String(row.invoice_no || ""),
    occurredAt: String(row.occurred_at), originalAmount: number(row.original_amount), currency: String(row.currency), exchangeRate: number(row.exchange_rate, 1),
    amountCny: number(row.amount_cny), included: Boolean(row.included), allocationMethod: String(row.allocation_method), note: String(row.note || ""),
    status: String(row.status), createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function createStockupCollaborationService(store) {
  function ensureVisible(request, context) {
    if (!request) {
      const error = new Error("未找到备货需求。");
      error.statusCode = 404;
      throw error;
    }
    const warehouseAllowed = !context.warehouseIds?.length || context.warehouseIds.includes(request.destinationWarehouseId);
    const countryAllowed = !context.countries?.length || context.countries.includes(request.destinationCountry);
    const skuAllowed = !context.skus?.length || Boolean(store.first(`SELECT 1 AS found FROM stockup_request_lines WHERE request_id=? AND UPPER(sku) IN (${context.skus.map(() => "?").join(",")}) LIMIT 1`, [request.id, ...context.skus]));
    if (warehouseAllowed && countryAllowed && skuAllowed && (context.viewAll || request.requesterId === userOf(context).id)) return request;
    const error = new Error("该备货需求不在当前账号的数据范围内。");
    error.statusCode = 403;
    throw error;
  }

  function ensureLineVisible(lineId, context) {
    if (!context.skus?.length) return;
    const row = store.first("SELECT sku FROM stockup_request_lines WHERE id=?", [String(lineId || "")]);
    if (row && context.skus.includes(String(row.sku || "").toUpperCase())) return;
    throw Object.assign(new Error("该产品不在当前账号的数据范围内。"), { statusCode: 403 });
  }

  function ensureShipmentVisible(shipmentId, context) {
    const shipment = shipmentFromRow(store.first("SELECT * FROM stockup_shipments WHERE id=?", [String(shipmentId || "")]));
    if (!shipment) throw Object.assign(new Error("发运批次不存在。"), { statusCode: 404 });
    ensureVisible(requestFromRow(store.first("SELECT * FROM stockup_requests WHERE id=?", [shipment.requestId])), context);
    if (context.skus?.length) {
      const unauthorized = store.first(`SELECT 1 AS found FROM stockup_shipment_lines WHERE shipment_id=? AND UPPER(sku) NOT IN (${context.skus.map(() => "?").join(",")}) LIMIT 1`, [shipment.id, ...context.skus]);
      if (unauthorized) throw Object.assign(new Error("该发运批次包含当前账号无权处理的产品。"), { statusCode: 403 });
    }
    return shipment;
  }

  function addEvent(requestId, eventType, title, description, context, options = {}) {
    const actor = userOf(context);
    const event = {
      id: id("spe"),
      requestId,
      lineId: String(options.lineId || ""),
      taskId: String(options.taskId || ""),
      shipmentId: String(options.shipmentId || ""),
      receiptId: String(options.receiptId || ""),
      eventType,
      title,
      description: String(description || ""),
      visibility: String(options.visibility || "all"),
      actorId: actor.id,
      actorName: actor.name,
      payload: options.payload || {},
      occurredAt: nowIso(),
    };
    store.run(`INSERT INTO stockup_progress_events
      (id,request_id,line_id,task_id,shipment_id,receipt_id,event_type,title,description,visibility,actor_id,actor_name,payload_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [event.id, requestId, event.lineId, event.taskId, event.shipmentId, event.receiptId, eventType, title, event.description, event.visibility, actor.id, actor.name, JSON.stringify(event.payload), event.occurredAt]);
    const request = requestFromRow(store.first("SELECT * FROM stockup_requests WHERE id = ?", [requestId]));
    if (request?.requesterId && request.requesterId !== actor.id && event.visibility === "all") {
      store.run(`INSERT INTO stockup_notifications (id,recipient_id,request_id,event_id,title,message,created_at,read_at) VALUES (?,?,?,?,?,?,?,NULL)`,
        [id("spn"), request.requesterId, requestId, event.id, title, event.description, event.occurredAt]);
    }
    return event;
  }

  function getRequest(idValue, context, { includeDetails = true } = {}) {
    const request = ensureVisible(requestFromRow(store.first("SELECT * FROM stockup_requests WHERE id = ?", [String(idValue || "")])), context);
    if (!includeDetails) return request;
    const scopedSkus = context.skus?.length ? new Set(context.skus.map((sku) => String(sku).trim().toUpperCase())) : null;
    request.lines = store.all("SELECT * FROM stockup_request_lines WHERE request_id = ? ORDER BY created_at", [request.id])
      .map(lineFromRow)
      .filter((line) => !scopedSkus || scopedSkus.has(line.sku.toUpperCase()));
    const scopedLineIds = scopedSkus ? new Set(request.lines.map((line) => line.id)) : null;
    request.tasks = store.all("SELECT * FROM stockup_execution_tasks WHERE request_id = ? ORDER BY created_at", [request.id])
      .map((row) => taskFromRow(row, context.revealSupplier))
      .filter((task) => !scopedLineIds || scopedLineIds.has(task.lineId));
    request.shipments = store.all("SELECT * FROM stockup_shipments WHERE request_id = ? ORDER BY created_at", [request.id]).map((row) => {
      const shipment = shipmentFromRow(row);
      shipment.lines = store.all("SELECT * FROM stockup_shipment_lines WHERE shipment_id = ? ORDER BY sku", [shipment.id]).map((line) => ({
        id: String(line.id), shipmentId: String(line.shipment_id), taskId: String(line.task_id), lineId: String(line.line_id), sku: String(line.sku), productName: String(line.product_name),
        shippedQty: number(line.shipped_qty), unit: String(line.unit), baseUnitCostCny: number(line.base_unit_cost_cny), weightKg: number(line.weight_kg), volumeM3: number(line.volume_m3),
      })).filter((line) => !scopedSkus || scopedSkus.has(line.sku.toUpperCase()));
      return shipment;
    });
    request.receipts = store.all("SELECT * FROM stockup_receipts WHERE request_id = ? ORDER BY arrived_at DESC", [request.id]).map((row) => {
      const receipt = receiptFromRow(row);
      receipt.lines = store.all("SELECT * FROM stockup_receipt_lines WHERE receipt_id = ? ORDER BY sku", [receipt.id]).map((line) => ({
        id: String(line.id), receiptId: String(line.receipt_id), shipmentLineId: String(line.shipment_line_id), lineId: String(line.line_id), sku: String(line.sku), productName: String(line.product_name),
        expectedQty: number(line.expected_qty), receivedQty: number(line.received_qty), goodQty: number(line.good_qty), damagedQty: number(line.damaged_qty), shortageQty: number(line.shortage_qty),
        pendingQty: number(line.pending_qty), shelvedQty: number(line.shelved_qty), unit: String(line.unit), exceptionNote: String(line.exception_note || ""),
      })).filter((line) => !scopedSkus || scopedSkus.has(line.sku.toUpperCase()));
      return receipt;
    });
    request.costItems = context.viewCost && !scopedSkus ? store.all("SELECT * FROM stockup_cost_items WHERE request_id = ? ORDER BY occurred_at DESC", [request.id]).map(costItemFromRow) : [];
    request.costVersions = context.viewCost && !scopedSkus ? store.all("SELECT * FROM stockup_cost_versions WHERE receipt_id IN (SELECT id FROM stockup_receipts WHERE request_id = ?) ORDER BY created_at DESC", [request.id]).map((row) => ({
      id: String(row.id), receiptId: String(row.receipt_id), version: number(row.version), versionType: String(row.version_type), status: String(row.status),
      costingQty: number(row.costing_qty), goodsCostCny: number(row.goods_cost_cny), allocatedCostCny: number(row.allocated_cost_cny), totalCostCny: number(row.total_cost_cny),
      unitCostCny: number(row.unit_cost_cny), snapshot: parseJson(row.snapshot_json, {}), note: String(row.note || ""), createdBy: String(row.created_by), createdAt: String(row.created_at),
      lockedBy: String(row.locked_by || ""), lockedAt: String(row.locked_at || ""),
    })) : [];
    request.events = store.all("SELECT * FROM stockup_progress_events WHERE request_id = ? AND visibility != 'cost_only' ORDER BY occurred_at DESC", [request.id])
      .map(eventFromRow)
      .filter((event) => !scopedLineIds || !event.lineId || scopedLineIds.has(event.lineId));
    return request;
  }

  function listRequests(filters = {}, context = {}) {
    const page = Math.max(1, number(filters.page, 1));
    const pageSize = Math.max(1, Math.min(100, number(filters.pageSize, 20)));
    const where = [];
    const params = [];
    if (!context.viewAll) {
      where.push("requester_id = ?");
      params.push(userOf(context).id);
    }
    if (context.warehouseIds?.length) {
      where.push(`destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`);
      params.push(...context.warehouseIds);
    }
    if (context.countries?.length) {
      where.push(`destination_country IN (${context.countries.map(() => "?").join(",")})`);
      params.push(...context.countries);
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(String(filters.status));
    }
    if (context.skus?.length) {
      where.push(`id IN (SELECT request_id FROM stockup_request_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`);
      params.push(...context.skus);
    }
    if (filters.keyword) {
      where.push("(request_no LIKE ? OR project LIKE ? OR destination_warehouse_name LIKE ? OR id IN (SELECT request_id FROM stockup_request_lines WHERE sku LIKE ? OR product_name LIKE ?))");
      const keyword = `%${String(filters.keyword).trim()}%`;
      params.push(keyword, keyword, keyword, keyword, keyword);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = number(store.first(`SELECT COUNT(*) AS count FROM stockup_requests ${clause}`, params)?.count);
    const listRows = store.all(`SELECT * FROM stockup_requests ${clause} ORDER BY
      CASE priority WHEN '紧急' THEN 0 WHEN '加急' THEN 1 ELSE 2 END,
      CASE WHEN expected_arrival_at < date('now') AND status NOT IN ('completed','cancelled','rejected') THEN 0 ELSE 1 END,
      updated_at DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    const items = listRows.map(requestFromRow).map((request) => {
      const scopedSkus = context.skus?.length ? new Set(context.skus.map((sku) => String(sku).trim().toUpperCase())) : null;
      request.lines = store.all("SELECT * FROM stockup_request_lines WHERE request_id = ? ORDER BY created_at", [request.id])
        .map(lineFromRow)
        .filter((line) => !scopedSkus || scopedSkus.has(line.sku.toUpperCase()));
      request.latestEvent = eventFromRow(store.first("SELECT * FROM stockup_progress_events WHERE request_id = ? AND visibility = 'all' ORDER BY occurred_at DESC LIMIT 1", [request.id]) || {});
      request.isOverdue = !["completed", "cancelled", "rejected"].includes(request.status) && request.expectedArrivalAt && request.expectedArrivalAt < new Date().toISOString().slice(0, 10);
      return request;
    });
    const visibilityParts = context.viewAll ? ["1=1"] : ["requester_id = ?"];
    const visibilityParams = context.viewAll ? [] : [userOf(context).id];
    if (context.warehouseIds?.length) {
      visibilityParts.push(`destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`);
      visibilityParams.push(...context.warehouseIds);
    }
    if (context.countries?.length) {
      visibilityParts.push(`destination_country IN (${context.countries.map(() => "?").join(",")})`);
      visibilityParams.push(...context.countries);
    }
    if (context.skus?.length) {
      visibilityParts.push(`id IN (SELECT request_id FROM stockup_request_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`);
      visibilityParams.push(...context.skus);
    }
    const visibility = visibilityParts.join(" AND ");
    const grouped = Object.fromEntries(store.all(`SELECT status, COUNT(*) AS count FROM stockup_requests WHERE ${visibility} GROUP BY status`, visibilityParams).map((row) => [String(row.status), number(row.count)]));
    const dueSoon = number(store.first(`SELECT COUNT(*) AS count FROM stockup_requests WHERE ${visibility} AND expected_arrival_at BETWEEN date('now') AND date('now','+7 day') AND status NOT IN ('completed','cancelled','rejected')`, visibilityParams)?.count);
    const overdue = number(store.first(`SELECT COUNT(*) AS count FROM stockup_requests WHERE ${visibility} AND expected_arrival_at < date('now') AND status NOT IN ('completed','cancelled','rejected')`, visibilityParams)?.count);
    return {
      ok: true, page, pageSize, total, items,
      counts: {
        drafts: grouped.draft || 0,
        pendingAcceptance: grouped.pending_acceptance || 0,
        inProgress: ["accepted", "in_progress", "waiting_shipment", "shipped", "partially_arrived", "arrived", "costing"].reduce((sum, key) => sum + (grouped[key] || 0), 0),
        dueSoon,
        exceptions: overdue + number(store.first(`SELECT SUM(exception_count) AS count FROM stockup_requests WHERE ${visibility}`, visibilityParams)?.count),
        completed: grouped.completed || 0,
      },
    };
  }

  function createRequest(payload, context, idempotencyKey = "") {
    const user = userOf(context);
    if (idempotencyKey) {
      const existing = store.first("SELECT response_json FROM stockup_idempotency WHERE key = ? AND user_id = ?", [idempotencyKey, user.id]);
      if (existing) return parseJson(existing.response_json, {});
    }
    const now = nowIso();
    const lines = Array.isArray(payload.lines) ? payload.lines.map((line) => normalizeLine(line, now)) : [];
    if (!lines.length) {
      const error = new Error("请至少添加一个产品。" );
      error.statusCode = 400;
      throw error;
    }
    const duplicates = new Set();
    for (const line of lines) {
      const key = `${line.sku.toUpperCase()}::${line.method}`;
      if (duplicates.has(key)) {
        const error = new Error(`产品 ${line.sku} 的“${line.method}”需求重复，请合并数量。`);
        error.statusCode = 400;
        throw error;
      }
      duplicates.add(key);
    }
    const request = {
      id: id("spr"), requestNo: businessNo("BR"), project: required(payload.project, "项目/团队"),
      destinationCountry: required(payload.destinationCountry, "目的国家"), destinationWarehouseId: String(payload.destinationWarehouseId || ""),
      destinationWarehouseName: required(payload.destinationWarehouseName, "目的仓库"), expectedArrivalAt: required(payload.expectedArrivalAt, "期望到仓日期"),
      priority: String(payload.priority || "常规"), reason: required(payload.reason, "需求原因"), platform: String(payload.platform || ""), note: String(payload.note || ""),
      status: payload.submit ? "pending_acceptance" : "draft", requesterId: user.id, requesterName: user.name, createdAt: now, updatedAt: now,
    };
    const response = store.transaction(() => {
      store.run(`INSERT INTO stockup_requests
        (id,request_no,project,destination_country,destination_warehouse_id,destination_warehouse_name,expected_arrival_at,priority,reason,platform,note,status,requester_id,requester_name,assignee_id,assignee_name,exception_count,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, '', '',0,1,?,?)`, [request.id, request.requestNo, request.project, request.destinationCountry, request.destinationWarehouseId, request.destinationWarehouseName, request.expectedArrivalAt, request.priority, request.reason, request.platform, request.note, request.status, request.requesterId, request.requesterName, now, now]);
      for (const line of lines) {
        line.status = request.status === "draft" ? "draft" : "pending_acceptance";
        store.run(`INSERT INTO stockup_request_lines
          (id,request_id,product_id,sku,product_name,image_url,specification,method,requested_qty,unit,target_unit_cost_cny,expected_arrival_at,note,status,fulfilled_qty,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`, [line.id, request.id, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.method, line.requestedQty, line.unit, line.targetUnitCostCny, line.expectedArrivalAt, line.note, line.status, now, now]);
      }
      addEvent(request.id, request.status === "draft" ? "draft_saved" : "request_submitted", request.status === "draft" ? "已保存备货草稿" : "备货需求已提交", `${lines.length} 个产品，共 ${lines.reduce((sum, line) => sum + line.requestedQty, 0)} 件`, context);
      const result = { ok: true, requestId: request.id, requestNo: request.requestNo, status: request.status };
      if (idempotencyKey) store.run("INSERT INTO stockup_idempotency (key,user_id,response_json,created_at) VALUES (?,?,?,?)", [idempotencyKey, user.id, JSON.stringify(result), now]);
      return result;
    });
    return response;
  }

  function updateRequest(requestId, payload, context) {
    const request = getRequest(requestId, context);
    const user = userOf(context);
    if (request.requesterId !== user.id && !context.viewAll) throw Object.assign(new Error("只能修改本人创建的需求。"), { statusCode: 403 });
    if (!["draft", "needs_changes", "rejected"].includes(request.status)) throw Object.assign(new Error("当前状态不能修改需求内容。"), { statusCode: 409 });
    if (number(payload.version, request.version) !== request.version) throw Object.assign(new Error("需求已被其他用户更新，请刷新后重试。"), { statusCode: 409, code: "version_conflict", latest: request });
    const nextLines = Array.isArray(payload.lines) ? payload.lines.map((line) => normalizeLine(line, nowIso())) : request.lines;
    const now = nowIso();
    return store.transaction(() => {
      store.run(`UPDATE stockup_requests SET project=?,destination_country=?,destination_warehouse_id=?,destination_warehouse_name=?,expected_arrival_at=?,priority=?,reason=?,platform=?,note=?,version=version+1,updated_at=? WHERE id=?`,
        [required(payload.project ?? request.project, "项目/团队"), required(payload.destinationCountry ?? request.destinationCountry, "目的国家"), String(payload.destinationWarehouseId ?? request.destinationWarehouseId), required(payload.destinationWarehouseName ?? request.destinationWarehouseName, "目的仓库"), required(payload.expectedArrivalAt ?? request.expectedArrivalAt, "期望到仓日期"), String(payload.priority ?? request.priority), required(payload.reason ?? request.reason, "需求原因"), String(payload.platform ?? request.platform), String(payload.note ?? request.note), now, requestId]);
      if (Array.isArray(payload.lines)) {
        store.run("DELETE FROM stockup_request_lines WHERE request_id = ?", [requestId]);
        for (const line of nextLines) store.run(`INSERT INTO stockup_request_lines
          (id,request_id,product_id,sku,product_name,image_url,specification,method,requested_qty,unit,target_unit_cost_cny,expected_arrival_at,note,status,fulfilled_qty,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`, [line.id, requestId, line.productId, line.sku, line.productName, line.imageUrl, line.specification, line.method, line.requestedQty, line.unit, line.targetUnitCostCny, line.expectedArrivalAt, line.note, request.status, now, now]);
      }
      addEvent(requestId, "request_updated", "需求内容已更新", payload.note || "已更新基本信息或产品清单", context);
      return { ok: true, request: getRequest(requestId, context) };
    });
  }

  function setRequestStatus(requestId, targetStatus, payload, context) {
    const request = getRequest(requestId, context);
    assertRequestTransition(request.status, targetStatus);
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_requests SET status=?,assignee_id=?,assignee_name=?,version=version+1,updated_at=? WHERE id=?", [targetStatus, payload.assigneeId || request.assigneeId || userOf(context).id, payload.assigneeName || request.assigneeName || userOf(context).name, now, requestId]);
      store.run("UPDATE stockup_request_lines SET status=?,updated_at=? WHERE request_id=?", [targetStatus, now, requestId]);
      const titles = { pending_acceptance: "备货需求已重新提交", accepted: "供应链已受理", needs_changes: "需求需要补充资料", rejected: "需求已驳回", cancelled: "需求已取消", draft: "需求已恢复为草稿" };
      addEvent(requestId, `request_${targetStatus}`, titles[targetStatus] || "需求状态已更新", payload.note || payload.reason || "", context);
      return { ok: true, request: getRequest(requestId, { ...context, viewAll: true }) };
    });
  }

  function createTask(payload, context) {
    const request = getRequest(payload.requestId, { ...context, viewAll: true });
    const line = request.lines.find((item) => item.id === String(payload.lineId));
    if (!line) throw Object.assign(new Error("需求产品行不存在。"), { statusCode: 404 });
    const plannedQty = number(payload.plannedQty);
    if (plannedQty <= 0) throw Object.assign(new Error("计划数量必须大于 0。"), { statusCode: 400 });
    const existingQty = request.tasks.filter((task) => task.lineId === line.id && task.status !== "terminated").reduce((sum, task) => sum + task.plannedQty, 0);
    if (existingQty + plannedQty > line.requestedQty) throw Object.assign(new Error("拆分任务的计划数量不能超过需求数量。"), { statusCode: 400 });
    const actor = userOf(context);
    const task = { id: id("spt"), taskNo: businessNo("ZX"), status: "pending_order", createdAt: nowIso() };
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_execution_tasks
        (id,request_id,line_id,task_no,method,assignee_id,assignee_name,supplier_name,planned_qty,ordered_qty,completed_qty,status,expected_order_at,expected_completed_at,actual_ordered_at,actual_completed_at,exception_type,exception_note,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,'','',1,?,?)`, [task.id, request.id, line.id, task.taskNo, payload.method || line.method, payload.assigneeId || actor.id, payload.assigneeName || actor.name, String(payload.supplierName || ""), plannedQty, task.status, String(payload.expectedOrderAt || ""), String(payload.expectedCompletedAt || ""), "", "", task.createdAt, task.createdAt]);
      store.run("UPDATE stockup_requests SET status='in_progress',version=version+1,updated_at=? WHERE id=?", [task.createdAt, request.id]);
      store.run("UPDATE stockup_request_lines SET status='in_progress',updated_at=? WHERE id=?", [task.createdAt, line.id]);
      addEvent(request.id, "task_created", "已创建采购/生产任务", `${line.sku} · ${plannedQty} ${line.unit}`, context, { lineId: line.id, taskId: task.id });
      return { ok: true, task: taskFromRow(store.first("SELECT * FROM stockup_execution_tasks WHERE id=?", [task.id]), context.revealSupplier) };
    });
  }

  function updateTask(taskId, payload, context) {
    const raw = store.first("SELECT * FROM stockup_execution_tasks WHERE id=?", [String(taskId)]);
    if (!raw) throw Object.assign(new Error("执行任务不存在。"), { statusCode: 404 });
    const task = taskFromRow(raw, true);
    ensureVisible(requestFromRow(store.first("SELECT * FROM stockup_requests WHERE id=?", [task.requestId])), context);
    ensureLineVisible(task.lineId, context);
    if (number(payload.version, task.version) !== task.version) throw Object.assign(new Error("任务已被其他用户更新，请刷新后重试。"), { statusCode: 409, code: "version_conflict" });
    const orderedQty = payload.orderedQty == null ? task.orderedQty : number(payload.orderedQty);
    const completedQty = payload.completedQty == null ? task.completedQty : number(payload.completedQty);
    if (orderedQty < 0 || completedQty < 0 || orderedQty > task.plannedQty || completedQty > task.plannedQty) throw Object.assign(new Error("下单或完成数量不能为负数，也不能超过计划数量。"), { statusCode: 400 });
    const status = String(payload.status || task.status);
    const now = nowIso();
    return store.transaction(() => {
      store.run(`UPDATE stockup_execution_tasks SET ordered_qty=?,completed_qty=?,status=?,assignee_id=?,assignee_name=?,supplier_name=?,expected_order_at=?,expected_completed_at=?,actual_ordered_at=?,actual_completed_at=?,exception_type=?,exception_note=?,version=version+1,updated_at=? WHERE id=?`,
        [orderedQty, completedQty, status, String(payload.assigneeId ?? task.assigneeId), String(payload.assigneeName ?? task.assigneeName), String(payload.supplierName ?? task.supplierName), String(payload.expectedOrderAt ?? task.expectedOrderAt), String(payload.expectedCompletedAt ?? task.expectedCompletedAt), String(payload.actualOrderedAt ?? task.actualOrderedAt), String(payload.actualCompletedAt ?? task.actualCompletedAt), String(payload.exceptionType ?? task.exceptionType), String(payload.exceptionNote ?? task.exceptionNote), now, taskId]);
      if (payload.exceptionType) store.run("UPDATE stockup_requests SET exception_count=exception_count+1,updated_at=? WHERE id=?", [now, task.requestId]);
      addEvent(task.requestId, "task_progress", `执行进度更新：${status}`, payload.note || `${orderedQty} 已下单，${completedQty} 已完成`, context, { lineId: task.lineId, taskId });
      refreshRequestStatus(task.requestId);
      return { ok: true, task: taskFromRow(store.first("SELECT * FROM stockup_execution_tasks WHERE id=?", [taskId]), context.revealSupplier) };
    });
  }

  function refreshRequestStatus(requestId) {
    const row = store.first("SELECT * FROM stockup_requests WHERE id=?", [requestId]);
    if (!row) return;
    const tasks = store.all("SELECT status FROM stockup_execution_tasks WHERE request_id=? AND status!='terminated'", [requestId]);
    const requestedQty = number(store.first("SELECT SUM(requested_qty) AS value FROM stockup_request_lines WHERE request_id=?", [requestId])?.value);
    const shippedQty = number(store.first("SELECT SUM(shipped_qty) AS value FROM stockup_shipment_lines WHERE shipment_id IN (SELECT id FROM stockup_shipments WHERE request_id=? AND status!='voided')", [requestId])?.value);
    const received = store.first("SELECT SUM(received_qty) AS received,SUM(good_qty) AS good FROM stockup_receipt_lines WHERE receipt_id IN (SELECT id FROM stockup_receipts WHERE request_id=? AND status!='voided')", [requestId]) || {};
    const totalReceipts = number(store.first("SELECT COUNT(*) AS count FROM stockup_receipts WHERE request_id=?", [requestId])?.count);
    const lockedReceipts = number(store.first("SELECT COUNT(DISTINCT receipt_id) AS count FROM stockup_cost_versions WHERE status='locked' AND receipt_id IN (SELECT id FROM stockup_receipts WHERE request_id=?)", [requestId])?.count);
    const next = deriveRequestStatus({ currentStatus: String(row.status), taskStatuses: tasks.map((item) => String(item.status)), requestedQty, shippedQty, receivedQty: number(received.received), goodQty: number(received.good), costsLocked: totalReceipts > 0 && lockedReceipts === totalReceipts });
    if (next !== row.status) store.run("UPDATE stockup_requests SET status=?,version=version+1,updated_at=? WHERE id=?", [next, nowIso(), requestId]);
  }

  function listTasks(filters = {}, context = {}) {
    const where = [];
    const params = [];
    if (filters.status) { where.push("t.status=?"); params.push(String(filters.status)); }
    if (!context.viewAll) { where.push("r.requester_id=?"); params.push(userOf(context).id); }
    if (context.warehouseIds?.length) { where.push(`r.destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.countries?.length) { where.push(`r.destination_country IN (${context.countries.map(() => "?").join(",")})`); params.push(...context.countries); }
    if (context.skus?.length) { where.push(`t.line_id IN (SELECT id FROM stockup_request_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`); params.push(...context.skus); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { ok: true, tasks: store.all(`SELECT t.* FROM stockup_execution_tasks t JOIN stockup_requests r ON r.id=t.request_id ${clause} ORDER BY t.updated_at DESC LIMIT 200`, params).map((row) => taskFromRow(row, context.revealSupplier)) };
  }

  function createShipment(payload, context) {
    const request = getRequest(payload.requestId, { ...context, viewAll: true });
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!lines.length) throw Object.assign(new Error("请至少选择一个发运产品。"), { statusCode: 400 });
    const shipmentId = id("sps");
    const now = nowIso();
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_shipments
        (id,request_id,shipment_no,origin_warehouse,destination_warehouse_id,destination_warehouse_name,destination_country,carrier,transport_mode,tracking_no,etd,eta,actual_shipped_at,status,packages,total_weight_kg,total_volume_m3,chargeable_weight_kg,note,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,1,?,?)`, [shipmentId, request.id, businessNo("FY"), String(payload.originWarehouse || ""), request.destinationWarehouseId, request.destinationWarehouseName, request.destinationCountry, String(payload.carrier || ""), String(payload.transportMode || "海运"), String(payload.trackingNo || ""), String(payload.etd || ""), String(payload.eta || ""), "", number(payload.packages), number(payload.totalWeightKg), number(payload.totalVolumeM3), number(payload.chargeableWeightKg), String(payload.note || ""), now, now]);
      for (const input of lines) {
        const task = request.tasks.find((item) => item.id === String(input.taskId));
        const line = request.lines.find((item) => item.id === task?.lineId);
        const qty = number(input.shippedQty);
        if (!task || !line || qty <= 0) throw Object.assign(new Error("发运产品或数量无效。"), { statusCode: 400 });
        const previouslyShipped = number(store.first("SELECT SUM(shipped_qty) AS value FROM stockup_shipment_lines WHERE task_id=? AND shipment_id IN (SELECT id FROM stockup_shipments WHERE status!='voided')", [task.id])?.value);
        if (previouslyShipped + qty > task.completedQty) throw Object.assign(new Error(`${line.sku} 发运数量超过已完成数量。`), { statusCode: 400 });
        store.run(`INSERT INTO stockup_shipment_lines (id,shipment_id,task_id,line_id,sku,product_name,shipped_qty,unit,base_unit_cost_cny,weight_kg,volume_m3) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [id("spl"), shipmentId, task.id, line.id, line.sku, line.productName, qty, line.unit, number(input.baseUnitCostCny ?? line.targetUnitCostCny), number(input.weightKg), number(input.volumeM3)]);
      }
      addEvent(request.id, "shipment_created", "已创建发运批次", `目的仓：${request.destinationWarehouseName}`, context, { shipmentId });
      return { ok: true, shipment: shipmentFromRow(store.first("SELECT * FROM stockup_shipments WHERE id=?", [shipmentId])) };
    });
  }

  function dispatchShipment(shipmentId, payload, context) {
    const shipment = ensureShipmentVisible(shipmentId, context);
    const now = nowIso();
    return store.transaction(() => {
      store.run("UPDATE stockup_shipments SET carrier=?,transport_mode=?,tracking_no=?,etd=?,eta=?,actual_shipped_at=?,status='shipped',version=version+1,updated_at=? WHERE id=?", [required(payload.carrier ?? shipment.carrier, "承运商"), String(payload.transportMode ?? shipment.transportMode), required(payload.trackingNo ?? shipment.trackingNo, "物流单号"), String(payload.etd ?? shipment.etd), required(payload.eta ?? shipment.eta, "预计到仓时间"), String(payload.actualShippedAt || now), now, shipmentId]);
      store.run("UPDATE stockup_execution_tasks SET status='shipped',version=version+1,updated_at=? WHERE id IN (SELECT task_id FROM stockup_shipment_lines WHERE shipment_id=?)", [now, shipmentId]);
      addEvent(shipment.requestId, "shipment_dispatched", "货物已发运", `${payload.transportMode || shipment.transportMode} · ${payload.trackingNo || shipment.trackingNo} · 预计 ${payload.eta || shipment.eta} 到仓`, context, { shipmentId });
      refreshRequestStatus(shipment.requestId);
      return { ok: true, shipment: shipmentFromRow(store.first("SELECT * FROM stockup_shipments WHERE id=?", [shipmentId])) };
    });
  }

  function listShipments(filters = {}, context = {}) {
    const where = [];
    const params = [];
    if (filters.status) { where.push("s.status=?"); params.push(String(filters.status)); }
    if (!context.viewAll) { where.push("r.requester_id=?"); params.push(userOf(context).id); }
    if (context.warehouseIds?.length) { where.push(`r.destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.countries?.length) { where.push(`r.destination_country IN (${context.countries.map(() => "?").join(",")})`); params.push(...context.countries); }
    if (context.skus?.length) { where.push(`s.id IN (SELECT shipment_id FROM stockup_shipment_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`); params.push(...context.skus); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const shipments = store.all(`SELECT s.* FROM stockup_shipments s JOIN stockup_requests r ON r.id=s.request_id ${clause} ORDER BY s.updated_at DESC LIMIT 200`, params).map(shipmentFromRow);
    return { ok: true, shipments };
  }

  function confirmReceipt(payload, context) {
    const shipment = ensureShipmentVisible(payload.shipmentId, context);
    if (shipment.status !== "shipped") throw Object.assign(new Error("只有已发运批次可以确认到仓。"), { statusCode: 409 });
    const shipmentLines = store.all("SELECT * FROM stockup_shipment_lines WHERE shipment_id=?", [shipment.id]);
    const inputLines = Array.isArray(payload.lines) ? payload.lines : [];
    const receiptId = id("src");
    const now = nowIso();
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_receipts (id,request_id,shipment_id,receipt_no,warehouse_id,warehouse_name,wms_inbound_no,arrived_at,shelved_at,status,note,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,'received',?,1,?,?)`, [receiptId, shipment.requestId, shipment.id, businessNo("SH"), shipment.destinationWarehouseId, shipment.destinationWarehouseName, String(payload.wmsInboundNo || ""), required(payload.arrivedAt, "实际到仓时间"), String(payload.shelvedAt || ""), String(payload.note || ""), now, now]);
      let hasDifference = false;
      for (const input of inputLines) {
        const source = shipmentLines.find((item) => String(item.id) === String(input.shipmentLineId));
        if (!source) throw Object.assign(new Error("收货明细与发运明细不匹配。"), { statusCode: 400 });
        const expectedQty = number(input.expectedQty, number(source.shipped_qty));
        const values = { expectedQty, receivedQty: number(input.receivedQty), goodQty: number(input.goodQty), damagedQty: number(input.damagedQty), shortageQty: number(input.shortageQty), pendingQty: number(input.pendingQty) };
        assertReceiptQuantities(values);
        hasDifference ||= values.damagedQty > 0 || values.shortageQty > 0 || values.pendingQty > 0;
        store.run(`INSERT INTO stockup_receipt_lines (id,receipt_id,shipment_line_id,line_id,sku,product_name,expected_qty,received_qty,good_qty,damaged_qty,shortage_qty,pending_qty,shelved_qty,unit,exception_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id("srlc"), receiptId, source.id, source.line_id, source.sku, source.product_name, values.expectedQty, values.receivedQty, values.goodQty, values.damagedQty, values.shortageQty, values.pendingQty, number(input.shelvedQty), source.unit, String(input.exceptionNote || "")]);
        store.run("UPDATE stockup_request_lines SET fulfilled_qty=fulfilled_qty+?,updated_at=? WHERE id=?", [values.goodQty, now, source.line_id]);
      }
      store.run("UPDATE stockup_shipments SET status='arrived',version=version+1,updated_at=? WHERE id=?", [now, shipment.id]);
      if (hasDifference) store.run("UPDATE stockup_requests SET exception_count=exception_count+1,updated_at=? WHERE id=?", [now, shipment.requestId]);
      addEvent(shipment.requestId, "receipt_confirmed", hasDifference ? "货物已到仓，存在收货差异" : "货物已到仓", `${shipment.destinationWarehouseName} · ${payload.arrivedAt}`, context, { shipmentId: shipment.id, receiptId });
      refreshRequestStatus(shipment.requestId);
      return { ok: true, receipt: receiptFromRow(store.first("SELECT * FROM stockup_receipts WHERE id=?", [receiptId])), hasDifference };
    });
  }

  function listReceipts(filters = {}, context = {}) {
    const where = [];
    const params = [];
    if (filters.status) { where.push("rc.status=?"); params.push(String(filters.status)); }
    if (!context.viewAll) { where.push("r.requester_id=?"); params.push(userOf(context).id); }
    if (context.warehouseIds?.length) { where.push(`r.destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); params.push(...context.warehouseIds); }
    if (context.countries?.length) { where.push(`r.destination_country IN (${context.countries.map(() => "?").join(",")})`); params.push(...context.countries); }
    if (context.skus?.length) { where.push(`rc.id IN (SELECT receipt_id FROM stockup_receipt_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`); params.push(...context.skus); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { ok: true, receipts: store.all(`SELECT rc.* FROM stockup_receipts rc JOIN stockup_requests r ON r.id=rc.request_id ${clause} ORDER BY rc.arrived_at DESC LIMIT 200`, params).map(receiptFromRow) };
  }

  function addCostItem(payload, context) {
    const receipt = receiptFromRow(store.first("SELECT * FROM stockup_receipts WHERE id=?", [String(payload.receiptId)]));
    if (!receipt) throw Object.assign(new Error("收货批次不存在。"), { statusCode: 404 });
    ensureShipmentVisible(receipt.shipmentId, context);
    const originalAmount = number(payload.originalAmount);
    const exchangeRate = number(payload.exchangeRate, 1);
    if (!exchangeRate || originalAmount < 0) throw Object.assign(new Error("费用金额或汇率无效。"), { statusCode: 400 });
    const now = nowIso();
    const itemId = id("sci");
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_cost_items (id,request_id,shipment_id,receipt_id,category,name,stage,vendor,invoice_no,occurred_at,original_amount,currency,exchange_rate,amount_cny,included,allocation_method,note,status,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'recorded',?,?,?)`, [itemId, receipt.requestId, receipt.shipmentId, receipt.id, required(payload.category, "费用分类"), required(payload.name || payload.category, "费用名称"), String(payload.stage || "实际"), String(payload.vendor || ""), String(payload.invoiceNo || ""), String(payload.occurredAt || now.slice(0, 10)), originalAmount, String(payload.currency || "CNY"), exchangeRate, money(originalAmount * exchangeRate), payload.included === false ? 0 : 1, String(payload.allocationMethod || "quantity"), String(payload.note || ""), userOf(context).id, now, now]);
      addEvent(receipt.requestId, "cost_item_added", "已登记费用", `${payload.category} · ¥${money(originalAmount * exchangeRate).toFixed(2)}`, context, { receiptId: receipt.id, visibility: "cost_only" });
      return { ok: true, costItem: costItemFromRow(store.first("SELECT * FROM stockup_cost_items WHERE id=?", [itemId])) };
    });
  }

  function costPreview(receiptId, context) {
    const receipt = receiptFromRow(store.first("SELECT * FROM stockup_receipts WHERE id=?", [String(receiptId)]));
    if (!receipt) throw Object.assign(new Error("收货批次不存在。"), { statusCode: 404 });
    ensureShipmentVisible(receipt.shipmentId, { ...context, viewAll: context.viewAll || context.viewCost });
    const allLines = store.all(`SELECT rl.*,sl.base_unit_cost_cny,sl.weight_kg,sl.volume_m3 FROM stockup_receipt_lines rl JOIN stockup_shipment_lines sl ON sl.id=rl.shipment_line_id WHERE rl.receipt_id=? ORDER BY rl.sku`, [receipt.id]).map((row) => ({
      receiptLineId: String(row.id), sku: String(row.sku), productName: String(row.product_name), goodQty: number(row.good_qty), baseUnitCostCny: number(row.base_unit_cost_cny),
      weightKg: number(row.weight_kg), volumeM3: number(row.volume_m3), goodsCostCny: money(number(row.good_qty) * number(row.base_unit_cost_cny)), allocatedCostCny: 0,
    }));
    const items = store.all("SELECT * FROM stockup_cost_items WHERE receipt_id=? AND included=1", [receipt.id]).map(costItemFromRow);
    for (const item of items) {
      const bases = allLines.map((line) => item.allocationMethod === "weight" ? line.weightKg : item.allocationMethod === "volume" ? line.volumeM3 : item.allocationMethod === "value" ? line.goodsCostCny : line.goodQty);
      const totalBasis = bases.reduce((sum, value) => sum + value, 0);
      let allocated = 0;
      allLines.forEach((line, index) => {
        const isLast = index === allLines.length - 1;
        const share = isLast ? money(item.amountCny - allocated) : money(item.amountCny * (totalBasis > 0 ? bases[index] / totalBasis : 1 / Math.max(1, allLines.length)));
        line.allocatedCostCny = money(line.allocatedCostCny + share);
        allocated = money(allocated + share);
      });
    }
    const lines = context.skus?.length
      ? allLines.filter((line) => context.skus.includes(line.sku.toUpperCase()))
      : allLines;
    const resultLines = lines.map((line) => ({ ...line, totalCostCny: money(line.goodsCostCny + line.allocatedCostCny), unitCostCny: line.goodQty > 0 ? money((line.goodsCostCny + line.allocatedCostCny) / line.goodQty) : 0 }));
    const totals = resultLines.reduce((acc, line) => ({ costingQty: acc.costingQty + line.goodQty, goodsCostCny: money(acc.goodsCostCny + line.goodsCostCny), allocatedCostCny: money(acc.allocatedCostCny + line.allocatedCostCny), totalCostCny: money(acc.totalCostCny + line.totalCostCny) }), { costingQty: 0, goodsCostCny: 0, allocatedCostCny: 0, totalCostCny: 0 });
    return { ok: true, receipt, items: context.skus?.length ? [] : items, lines: resultLines, totals: { ...totals, unitCostCny: totals.costingQty > 0 ? money(totals.totalCostCny / totals.costingQty) : 0 }, canLock: resultLines.length > 0 && resultLines.every((line) => line.goodQty > 0 && line.baseUnitCostCny > 0) };
  }

  function saveCostVersion(receiptId, payload, context, lock = false) {
    const preview = costPreview(receiptId, { ...context, viewAll: true, viewCost: true });
    if (lock && !preview.canLock) throw Object.assign(new Error("存在良品数量或货品成本缺失，不能锁定正式成本。"), { statusCode: 409 });
    const latest = number(store.first("SELECT MAX(version) AS value FROM stockup_cost_versions WHERE receipt_id=?", [receiptId])?.value);
    const version = latest + 1;
    const now = nowIso();
    const versionId = id("scv");
    return store.transaction(() => {
      store.run(`INSERT INTO stockup_cost_versions (id,receipt_id,version,version_type,status,costing_qty,goods_cost_cny,allocated_cost_cny,total_cost_cny,unit_cost_cny,snapshot_json,note,created_by,created_at,locked_by,locked_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [versionId, receiptId, version, String(payload.versionType || (latest ? "adjustment" : "formal")), lock ? "locked" : "review", preview.totals.costingQty, preview.totals.goodsCostCny, preview.totals.allocatedCostCny, preview.totals.totalCostCny, preview.totals.unitCostCny, JSON.stringify(preview), String(payload.note || ""), userOf(context).id, now, lock ? userOf(context).id : "", lock ? now : ""]);
      if (lock) {
        store.run("UPDATE stockup_receipts SET status='costed',version=version+1,updated_at=? WHERE id=?", [now, receiptId]);
        addEvent(preview.receipt.requestId, "cost_locked", "到仓成本已锁定", `版本 ${version} · ¥${preview.totals.unitCostCny.toFixed(2)}/件`, context, { receiptId });
        refreshRequestStatus(preview.receipt.requestId);
      }
      return { ok: true, version, status: lock ? "locked" : "review", preview };
    });
  }

  function monthlyCostReport(filters = {}, context = {}) {
    const month = String(filters.month || new Date().toISOString().slice(0, 7));
    const reportWhere = ["cv.status='locked'", "substr(rc.arrived_at,1,7)=?"];
    const reportParams = [month];
    if (context.warehouseIds?.length) { reportWhere.push(`r.destination_warehouse_id IN (${context.warehouseIds.map(() => "?").join(",")})`); reportParams.push(...context.warehouseIds); }
    if (context.countries?.length) { reportWhere.push(`r.destination_country IN (${context.countries.map(() => "?").join(",")})`); reportParams.push(...context.countries); }
    if (context.skus?.length) { reportWhere.push(`rc.id IN (SELECT receipt_id FROM stockup_receipt_lines WHERE UPPER(sku) IN (${context.skus.map(() => "?").join(",")}))`); reportParams.push(...context.skus); }
    const versions = store.all(`SELECT cv.*,rc.arrived_at,rc.warehouse_id,rc.warehouse_name,r.destination_country
      FROM stockup_cost_versions cv JOIN stockup_receipts rc ON rc.id=cv.receipt_id JOIN stockup_requests r ON r.id=rc.request_id
      WHERE ${reportWhere.join(" AND ")} AND cv.version=(SELECT MAX(v2.version) FROM stockup_cost_versions v2 WHERE v2.receipt_id=cv.receipt_id AND v2.status='locked')`, reportParams);
    const groups = new Map();
    for (const row of versions) {
      const snapshot = parseJson(row.snapshot_json, {});
      for (const line of snapshot.lines || []) {
        if (context.skus?.length && !context.skus.includes(String(line.sku || "").toUpperCase())) continue;
        const key = `${row.destination_country}::${row.warehouse_name}::${line.sku}`;
        const group = groups.get(key) || { month, country: String(row.destination_country), warehouseId: String(row.warehouse_id || ""), warehouseName: String(row.warehouse_name), sku: line.sku, productName: line.productName, receivedQty: 0, batchCount: 0, goodsCostCny: 0, allocatedCostCny: 0, totalCostCny: 0 };
        group.receivedQty += number(line.goodQty);
        group.batchCount += 1;
        group.goodsCostCny = money(group.goodsCostCny + number(line.goodsCostCny));
        group.allocatedCostCny = money(group.allocatedCostCny + number(line.allocatedCostCny));
        group.totalCostCny = money(group.totalCostCny + number(line.totalCostCny));
        groups.set(key, group);
      }
    }
    const items = [...groups.values()].map((group) => ({ ...group, goodsUnitCostCny: group.receivedQty ? money(group.goodsCostCny / group.receivedQty) : 0, allocatedUnitCostCny: group.receivedQty ? money(group.allocatedCostCny / group.receivedQty) : 0, weightedUnitCostCny: group.receivedQty ? money(group.totalCostCny / group.receivedQty) : 0 }));
    return { ok: true, month, generatedAt: nowIso(), items: items.filter((item) => (!filters.country || item.country === filters.country) && (!filters.warehouseId || item.warehouseId === filters.warehouseId) && (!filters.keyword || `${item.sku} ${item.productName}`.toLowerCase().includes(String(filters.keyword).toLowerCase()))), totals: { skuCount: items.length, receivedQty: items.reduce((sum, item) => sum + item.receivedQty, 0), totalCostCny: money(items.reduce((sum, item) => sum + item.totalCostCny, 0)) } };
  }

  function listNotifications(context) {
    const recipientId = userOf(context).id;
    const items = store.all("SELECT * FROM stockup_notifications WHERE recipient_id=? ORDER BY created_at DESC LIMIT 100", [recipientId]).map((row) => ({ id: String(row.id), requestId: String(row.request_id), title: String(row.title), message: String(row.message), createdAt: String(row.created_at), readAt: String(row.read_at || "") }));
    return { ok: true, unread: items.filter((item) => !item.readAt).length, items };
  }

  function markNotificationRead(notificationId, context) {
    store.run("UPDATE stockup_notifications SET read_at=? WHERE id=? AND recipient_id=?", [nowIso(), String(notificationId), userOf(context).id]);
    store.persist();
    return { ok: true };
  }

  return {
    addCostItem, confirmReceipt, costPreview, createRequest, createShipment, createTask, dispatchShipment, getRequest,
    listNotifications, listReceipts, listRequests, listShipments, listTasks, markNotificationRead, monthlyCostReport,
    saveCostVersion, setRequestStatus, updateRequest, updateTask,
  };
}

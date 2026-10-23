import { hasPermission } from "./access-control.js";
import { readFileSync } from "node:fs";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) reject(Object.assign(new Error("请求内容不能超过 5MB。"), { statusCode: 413 }));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(Object.assign(new Error("请求 JSON 格式不正确。"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function hasAny(auth, keys) {
  return auth?.role === "admin" || keys.some((key) => hasPermission(auth, key));
}

function contextFor(auth) {
  const dataScopes = auth?.user?.dataScopes || {};
  return {
    auth,
    viewAll: hasAny(auth, ["stockup_request_view_all", "stockup_request_accept", "stockup_execution_update", "stockup_shipment_update", "stockup_receipt_confirm", "stockup_cost_edit", "stockup_cost_review", "stockup_cost_lock", "stockup_workflow_manage", "stockup_execution_manage"]),
    viewCost: hasAny(auth, ["stockup_cost_edit", "stockup_cost_review", "stockup_cost_lock", "stockup_cost_report_view", "stockup_workflow_manage"]),
    revealSupplier: hasAny(auth, ["stockup_supplier_view", "stockup_execution_update", "stockup_execution_manage"]),
    countries: Array.isArray(dataScopes.countries) ? dataScopes.countries.map(String).filter(Boolean) : [],
    warehouseIds: Array.isArray(dataScopes.warehouseIds) ? dataScopes.warehouseIds.map(String).filter(Boolean) : [],
    skus: Array.isArray(dataScopes.skus) ? dataScopes.skus.map((value) => String(value).toUpperCase()).filter(Boolean) : [],
  };
}

function requireAny(auth, keys, message) {
  if (hasAny(auth, keys)) return;
  throw Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

export function collaborationIsoDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let candidate = raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) candidate = `${raw}T23:59:59+08:00`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) candidate = `${raw}:00+08:00`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) candidate = `${raw}+08:00`;
  const timestamp = Date.parse(candidate);
  if (!Number.isFinite(timestamp)) throw Object.assign(new Error("预计到仓时间格式不正确，请重新选择日期和时间。"), { statusCode: 400, code: "invalid_expected_arrival_at" });
  return new Date(timestamp).toISOString();
}

export function createStockupCollaborationApi({ service, getAuth, appendActionLog = () => {}, notifyRequestSubmitted = async () => ({ status: "skipped", message: "未配置企业微信通知服务" }), listWarehouses = () => [], listProjectTeams = () => [], listProducts = () => ({ ok: true, total: 0, products: [] }), listDomesticWarehouses = () => ({ ok: true, warehouses: [] }), getDomesticAvailability = () => ({ ok: true, items: [] }), createDomesticOutbound = () => null, publishWarehouseTask = async () => { throw Object.assign(new Error("伙伴协同桥接尚未配置。"), { statusCode: 503 }); }, generateDispatchDocuments = async () => { throw Object.assign(new Error("发运 PDF 服务尚未配置。"), { statusCode: 503 }); }, previewWarehouseDocument = async () => { throw Object.assign(new Error("仓库建单预览服务尚未配置。"), { statusCode: 503 }); }, createWarehouseDocument = async () => { throw Object.assign(new Error("仓库建单服务尚未配置。"), { statusCode: 503 }); }, cancelWarehouseDocument = async () => { throw Object.assign(new Error("仓库单据作废服务尚未配置。"), { statusCode: 503 }); } }) {
  async function publishStockupWorkOrder(workOrder, context, auth, idempotencyKey, { revision = false } = {}) {
    const dueAt = collaborationIsoDateTime(workOrder.expectedArrivalAt);
    const request = service.getRequest(workOrder.requestId, context);
    return publishWarehouseTask({
      organizationCode: workOrder.organizationCode,
      warehouseRef: workOrder.domesticWarehouseId,
      itemType: "warehouse_stockup",
      coreRefType: "stockup_warehouse_work_order",
      coreRefId: workOrder.id,
      referenceNo: workOrder.workOrderNo,
      title: `${workOrder.workOrderNo} · ${revision ? "验货数据待修订" : "待签收验货"}`,
      description: revision ? `审核退回：${workOrder.inspectionReviewNote || "请修订验货数据后重新提交。"}` : workOrder.instructions,
      priority: workOrder.priority === "urgent" ? "urgent" : "normal",
      dueAt,
      lines: workOrder.lines.map((line) => ({ sourceLineId: line.id, sku: line.sku, plannedQuantity: line.expectedQty, unit: line.unit })),
      workOrder: {
        workOrderId: workOrder.id,
        workflowVersion: workOrder.workflowVersion,
        requestNo: workOrder.requestNo,
        expectedArrivalAt: dueAt,
        senderName: workOrder.senderName,
        senderContact: workOrder.senderContact,
        inboundCarrier: workOrder.inboundCarrier,
        inboundTrackingNo: workOrder.inboundTrackingNo,
        instructions: revision ? `请按退回原因修订并重新提交：${workOrder.inspectionReviewNote || "验货数据需修订"}` : workOrder.instructions,
        destinationCountry: workOrder.destinationCountry,
        destinationWarehouseName: workOrder.destinationWarehouseName,
        lineRequirements: Object.fromEntries(workOrder.lines.map((line) => [line.id, { shelfLifeManaged: Boolean(request.lines.find((requestLine) => requestLine.id === line.requestLineId)?.shelfLifeManaged) }])),
        expenseCategories: ["换箱费", "贴标费", "装卸费", "包装耗材", "仓储费", "货拉拉费", "其他"],
      },
    }, {
      idempotencyKey,
      actorName: String(auth?.user?.displayName || auth?.user?.username || "供应链中台"),
      warehouseIds: context.warehouseIds,
      skus: context.skus,
    });
  }

  return async function handleStockupCollaborationApi(req, res, url) {
    if (!url.pathname.startsWith("/api/stockup/collaboration")) return false;
    const auth = getAuth(req);
    const context = contextFor(auth);
    try {
      requireAny(auth, ["stockup_request_view_own", "stockup_request_view_all", "stockup_workflow_view", "stockup_execution_view", "stockup_cost_report_view", "stockup_request_create", "stockup_request_accept", "stockup_execution_update", "stockup_shipment_update", "stockup_receipt_confirm", "stockup_cost_edit", "stockup_cost_review", "stockup_cost_lock"], "当前账号没有备货协同查看权限。");
      const suffix = url.pathname.replace("/api/stockup/collaboration", "") || "/";
      let match;

      if (suffix === "/products" && req.method === "GET") {
        sendJson(res, 200, listProducts(context, queryObject(url), auth));
        return true;
      }

      if (suffix === "/domestic-warehouses" && req.method === "GET") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有国内仓发运权限。");
        sendJson(res, 200, listDomesticWarehouses(context, auth));
        return true;
      }

      if (suffix === "/domestic-availability" && req.method === "GET") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有国内库存查看权限。");
        sendJson(res, 200, getDomesticAvailability(queryObject(url), context, auth));
        return true;
      }

      if (suffix === "/warehouses" && req.method === "GET") {
        const warehouses = listWarehouses(context).filter((warehouse) => {
          const warehouseId = String(warehouse.id || "");
          const country = String(warehouse.country || "");
          return (!context.warehouseIds.length || context.warehouseIds.includes(warehouseId))
            && (!context.countries.length || context.countries.includes(country));
        });
        const projectTeams = listProjectTeams(context)
          .filter((team) => team?.enabled !== false && team?.id && team?.name)
          .map((team) => ({ id: String(team.id), name: String(team.name) }));
        const defaultTeamId = projectTeams.some((team) => team.id === auth?.user?.notificationTeamId)
          ? String(auth.user.notificationTeamId)
          : "";
        sendJson(res, 200, { ok: true, warehouses, projectTeams, defaultTeamId });
        return true;
      }

      if (suffix === "/product-refs" && req.method === "GET") {
        sendJson(res, 200, service.listProductRefs(queryObject(url)));
        return true;
      }
      if ((match = suffix.match(/^\/product-refs\/([^/]+)\/bind-sku$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有绑定正式 SKU 的权限。");
        const result = service.bindFormalSku(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "绑定正式 SKU", "stockup_product_ref", match[1], { sku: result.productRef.formalSku });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/request-lines\/([^/]+)\/procurement$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有终止或恢复商品采购的权限。");
        const payload = await readBody(req);
        const result = service.updateRequestLineProcurement(decodeURIComponent(match[1]), payload, context);
        appendActionLog(auth, payload.action === "reopen" ? "恢复商品采购" : "采购前终止商品", "stockup_request_line", match[1], { requestId: result.request.id, reason: payload.reason || "" });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/purchase-orders" && req.method === "GET") {
        requireAny(auth, ["stockup_execution_view", "stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有查看采购单的权限。");
        sendJson(res, 200, service.listPurchaseOrders(queryObject(url)));
        return true;
      }
      if (suffix === "/purchase-orders" && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有登记采购单的权限。");
        const result = service.createPurchaseOrder(await readBody(req), context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, "登记 1688 采购单", "stockup_purchase_order", result.purchaseOrder.purchaseNo, { paidTotalCny: result.purchaseOrder.paidTotalCny });
        sendJson(res, result.idempotentReplay ? 200 : 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/purchase-orders\/([^/]+)$/)) && req.method === "PATCH") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有修改采购单的权限。");
        const result = service.updatePurchaseOrder(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "修改采购单价格分摊", "stockup_purchase_order", result.purchaseOrder.purchaseNo, { paidTotalCny: result.purchaseOrder.paidTotalCny, version: result.purchaseOrder.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/purchase-orders\/([^/]+)\/events$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有登记采购到货、退款或补发的权限。");
        const result = service.recordPurchaseEvent(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "登记采购事件", "stockup_purchase_order", result.purchaseOrder.purchaseNo, { status: result.purchaseOrder.status });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/forwarders" && req.method === "GET") {
        sendJson(res, 200, service.listForwarders());
        return true;
      }
      if (suffix === "/forwarders" && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有管理货代档案的权限。");
        const result = service.createForwarder(await readBody(req), context);
        appendActionLog(auth, "创建货代档案", "stockup_forwarder", result.forwarderId, {});
        sendJson(res, 201, result);
        return true;
      }

      if (suffix === "/custom-processing-handoffs" && req.method === "GET") {
        sendJson(res, 200, service.listCustomProcessingHandoffs());
        return true;
      }
      if (suffix === "/custom-processing-handoffs" && req.method === "POST") {
        requireAny(auth, ["stockup_request_create", "stockup_workflow_manage"], "当前账号没有创建定制加工待规划记录的权限。");
        const result = service.createCustomProcessingHandoff(await readBody(req), context);
        sendJson(res, 201, result);
        return true;
      }

      if (suffix === "/warehouse-work-orders/dashboard" && req.method === "GET") {
        requireAny(auth, ["stockup_execution_view", "stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有查看国内仓作业看板的权限。");
        sendJson(res, 200, service.warehouseWorkOrderDashboard(queryObject(url), context));
        return true;
      }
      if (suffix === "/warehouse-work-orders" && req.method === "GET") {
        requireAny(auth, ["stockup_execution_view", "stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有查看国内仓工单的权限。");
        sendJson(res, 200, service.listWarehouseWorkOrders(queryObject(url), context));
        return true;
      }
      if (suffix === "/warehouse-work-orders" && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有创建国内仓工单的权限。");
        const result = service.createWarehouseWorkOrder(await readBody(req), context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, "创建国内仓备货工单", "stockup_warehouse_work_order", result.workOrder.workOrderNo, { requestId: result.workOrder.requestId, warehouseId: result.workOrder.domesticWarehouseId });
        sendJson(res, result.idempotentReplay ? 200 : 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/warehouse-work-orders\/([^/]+)\/publish$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage", "collaboration_task_publish"], "当前账号没有推送国内仓工单的权限。");
        const workOrder = service.getWarehouseWorkOrder(decodeURIComponent(match[1]), context);
        const result = await publishStockupWorkOrder(workOrder, context, auth, String(req.headers["idempotency-key"] || `stockup-work-order:${workOrder.id}`));
        const marked = service.markWarehouseWorkOrderPublished(workOrder.id, { ...result, deliveryMessage: result.delivery?.failed ? "任务已进入重试队列" : "伙伴门户已收到任务" }, context);
        appendActionLog(auth, "推送国内仓备货工单", "stockup_warehouse_work_order", workOrder.workOrderNo, { organizationCode: workOrder.organizationCode, eventId: result.eventId });
        sendJson(res, 200, { ok: true, workOrder: marked.workOrder, collaboration: result });
        return true;
      }
      if ((match = suffix.match(/^\/warehouse-work-orders\/([^/]+)\/actions$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage", "stockup_cost_edit", "stockup_cost_review"], "当前账号没有更新国内仓工单的权限。");
        const payload = await readBody(req);
        const result = service.applyWarehouseWorkOrderAction(decodeURIComponent(match[1]), payload, context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, `国内仓工单：${payload.action || "update"}`, "stockup_warehouse_work_order", result.workOrder.workOrderNo, { status: result.workOrder.status });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/warehouse-work-orders\/([^/]+)\/inspection$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有提交验货结果的权限。");
        const result = service.submitInspection(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "提交国内仓验货", "stockup_warehouse_work_order", match[1], { status: result.status });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/warehouse-work-orders\/([^/]+)\/inspection-review$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有审核验货结果的权限。");
        const payload = await readBody(req);
        const workOrderId = decodeURIComponent(match[1]);
        const result = service.reviewInspection(workOrderId, payload, context);
        if (payload.action === "reject" && !result.idempotentReplay) {
          const revisedWorkOrder = service.getWarehouseWorkOrder(workOrderId, context);
          const revisionKey = `stockup-work-order-revision:${workOrderId}:${revisedWorkOrder.version}`;
          const collaboration = await publishStockupWorkOrder(revisedWorkOrder, context, auth, revisionKey, { revision: true });
          service.markWarehouseWorkOrderPublished(workOrderId, { ...collaboration, deliveryMessage: collaboration.delivery?.failed ? "修订任务已进入重试队列" : "仓库已收到验货修订任务" }, context);
          result.collaboration = collaboration;
        }
        appendActionLog(auth, "审核国内仓验货", "stockup_warehouse_work_order", match[1], { status: result.status });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/warehouse-work-orders\/([^/]+)$/)) && req.method === "GET") {
        requireAny(auth, ["stockup_execution_view", "stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有查看国内仓工单的权限。");
        sendJson(res, 200, { ok: true, workOrder: service.getWarehouseWorkOrder(decodeURIComponent(match[1]), context) });
        return true;
      }

      if (suffix === "/requests" && req.method === "GET") {
        sendJson(res, 200, service.listRequests(queryObject(url), context));
        return true;
      }
      if (suffix === "/requests" && req.method === "POST") {
        requireAny(auth, ["stockup_request_create", "stockup_workflow_manage"], "当前账号没有新建备货需求权限。");
        const payload = await readBody(req);
        const result = Number(payload.workflowVersion || 2) === 2
          ? service.createSpotRequest(payload, context, String(req.headers["idempotency-key"] || ""))
          : service.createRequest(payload, context, String(req.headers["idempotency-key"] || ""));
        if (payload.submit && !result.idempotentReplay) {
          const request = service.getRequest(result.requestId, { ...context, viewAll: true });
          try {
            result.notification = await notifyRequestSubmitted({ request, payload, auth, req });
          } catch (error) {
            result.notification = { status: "failed", message: error?.message || "企业微信通知发送失败" };
          }
        }
        appendActionLog(auth, payload.submit ? "提交备货协同需求" : "保存备货协同草稿", "stockup_collaboration_request", result.requestNo, { requestId: result.requestId, notificationStatus: result.notification?.status || "not_requested" });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/requests\/([^/]+)$/)) && req.method === "GET") {
        sendJson(res, 200, { ok: true, request: service.getRequest(decodeURIComponent(match[1]), context) });
        return true;
      }
      if ((match = suffix.match(/^\/requests\/([^/]+)$/)) && req.method === "PATCH") {
        requireAny(auth, ["stockup_request_create", "stockup_workflow_manage"], "当前账号没有编辑备货需求权限。");
        const result = service.updateRequest(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "更新备货协同需求", "stockup_collaboration_request", match[1], {});
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/requests\/([^/]+)\/(submit|accept|request-changes|reject|cancel|restore)$/)) && req.method === "POST") {
        const action = match[2];
        if (["accept", "request-changes", "reject"].includes(action)) requireAny(auth, ["stockup_request_accept", "stockup_execution_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有受理备货需求权限。");
        else requireAny(auth, ["stockup_request_create", "stockup_workflow_manage"], "当前账号没有变更备货需求权限。");
        const statusByAction = { submit: "pending_acceptance", accept: "accepted", "request-changes": "needs_changes", reject: "rejected", cancel: "cancelled", restore: "draft" };
        const payload = await readBody(req);
        const result = service.setRequestStatus(decodeURIComponent(match[1]), statusByAction[action], payload, context);
        appendActionLog(auth, `备货需求：${action}`, "stockup_collaboration_request", result.request.requestNo, { status: result.request.status });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/tasks" && req.method === "GET") {
        sendJson(res, 200, service.listTasks(queryObject(url), context));
        return true;
      }
      if (suffix === "/tasks" && req.method === "POST") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage"], "当前账号没有创建执行任务权限。");
        const result = service.createTask(await readBody(req), context);
        appendActionLog(auth, "创建备货执行任务", "stockup_collaboration_task", result.task.taskNo, {});
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/tasks\/([^/]+)$/)) && req.method === "PATCH") {
        requireAny(auth, ["stockup_execution_update", "stockup_execution_manage"], "当前账号没有更新执行任务权限。");
        const result = service.updateTask(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "更新备货执行进度", "stockup_collaboration_task", result.task.taskNo, { status: result.task.status });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/shipments" && req.method === "GET") {
        sendJson(res, 200, service.listShipments(queryObject(url), context));
        return true;
      }
      if (suffix === "/shipments" && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有登记发运权限。");
        const result = service.createShipment(await readBody(req), context);
        appendActionLog(auth, "创建备货发运批次", "stockup_collaboration_shipment", result.shipment.shipmentNo, {});
        sendJson(res, 201, result);
        return true;
      }
      if (suffix === "/shipments/reserve" && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有创建锁库出运计划的权限。");
        const result = service.createReservedShipment(await readBody(req), context);
        appendActionLog(auth, "创建出运计划并锁定库存", "stockup_collaboration_shipment", result.shipment.shipmentNo, {});
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)$/)) && req.method === "PATCH") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有编辑发运批次权限。");
        const result = service.updateShipment(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "编辑备货发运批次", "stockup_collaboration_shipment", result.shipment.shipmentNo, {});
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/wms-order-preview$/)) && req.method === "GET") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有预览仓库单据权限。");
        sendJson(res, 200, await previewWarehouseDocument(decodeURIComponent(match[1]), context, auth));
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/wms-order$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有创建仓库单据权限。");
        const options = await readBody(req);
        const result = await createWarehouseDocument(decodeURIComponent(match[1]), options, context, auth);
        appendActionLog(auth, `${options?.verify ? "提交并审核" : "创建"}${result.documentLabel || "仓库单据"}`, "stockup_collaboration_shipment", result.shipment?.shipmentNo || match[1], { orderNo: result.shipment?.wmsOrderNo || "", alreadyCreated: Boolean(result.alreadyCreated), verify: Boolean(options?.verify) });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/wms-order$/)) && req.method === "DELETE") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有作废仓库单据权限。");
        const result = await cancelWarehouseDocument(decodeURIComponent(match[1]), context, auth);
        appendActionLog(auth, `作废${result.documentLabel || "仓库单据"}`, "stockup_collaboration_shipment", result.shipment?.shipmentNo || match[1], { orderNo: result.shipment?.wmsOrderNo || "", alreadyCancelled: Boolean(result.alreadyCancelled) });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/reconcile-wms-deletion$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有登记 WMS 外部删除的权限。");
        const result = service.reconcileDeletedShipmentWmsOrder(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "登记外部 WMS 单已删除", "stockup_collaboration_shipment", result.shipment?.shipmentNo || match[1], { orderNo: result.shipment?.wmsOrderNo || "", preservedStatus: result.preservedStatus || "" });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/documents$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有生成发运文件的权限。");
        const shipmentId = decodeURIComponent(match[1]);
        const generated = await generateDispatchDocuments(service.getShipment(shipmentId, context), auth);
        const result = service.recordDispatchDocuments(shipmentId, generated.documents, context);
        appendActionLog(auth, "生成装箱单与箱唛 PDF", "stockup_collaboration_shipment", shipmentId, { version: result.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/documents$/)) && req.method === "GET") {
        sendJson(res, 200, service.listDispatchDocuments(decodeURIComponent(match[1]), context));
        return true;
      }
      if ((match = suffix.match(/^\/dispatch-documents\/([^/]+)\/download$/)) && req.method === "GET") {
        const document = service.getDispatchDocument(decodeURIComponent(match[1]), context);
        const file = readFileSync(document.filePath);
        res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`, "Content-Length": file.length, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" });
        res.end(file);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/issue-instruction$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage", "collaboration_task_publish"], "当前账号没有下发发货任务的权限。");
        const result = service.issueDispatchInstruction(decodeURIComponent(match[1]), await readBody(req), context);
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/handover$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有确认货代交接的权限。");
        const result = service.handoverShipment(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "确认交接货代并扣减国内库存", "stockup_collaboration_shipment", result.shipment.shipmentNo, { trackingNo: result.shipment.trackingNo });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/cancel-reservation$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage", "stockup_workflow_manage"], "当前账号没有取消出运计划的权限。");
        const shipmentId = decodeURIComponent(match[1]);
        const current = service.getShipment(shipmentId, context);
        if (current.wmsOrderNo && current.wmsPushStatus !== "voided") await cancelWarehouseDocument(shipmentId, context, auth);
        const result = service.cancelReservedShipment(shipmentId, await readBody(req), context);
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/dispatch$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有确认发运权限。");
        const shipmentId = decodeURIComponent(match[1]);
        const payload = await readBody(req);
        const shipment = service.getShipment(shipmentId, context);
        if (shipment.originWarehouseId && !shipment.inventoryMovementId) {
          const outbound = createDomesticOutbound(shipment, auth);
          payload.inventoryMovementId = outbound?.movementId || "";
        }
        const result = service.dispatchShipment(shipmentId, payload, context);
        appendActionLog(auth, "确认备货发运", "stockup_collaboration_shipment", result.shipment.shipmentNo, { trackingNo: result.shipment.trackingNo });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/receipts" && req.method === "GET") {
        sendJson(res, 200, service.listReceipts(queryObject(url), context));
        return true;
      }
      if (suffix === "/receipts" && req.method === "POST") {
        requireAny(auth, ["stockup_receipt_confirm", "stockup_execution_manage"], "当前账号没有到仓确认权限。");
        const result = service.confirmReceipt(await readBody(req), context);
        appendActionLog(auth, "确认备货到仓", "stockup_collaboration_receipt", result.receipt.receiptNo, { hasDifference: result.hasDifference });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/receipts\/([^/]+)\/(archive|activate|delete|restore)$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_cost_lock", "stockup_workflow_manage"], "当前账号没有归档成本批次的权限。");
        const action = match[2];
        const result = service.updateReceiptLifecycle(decodeURIComponent(match[1]), action, context);
        appendActionLog(auth, `成本批次：${action}`, "stockup_collaboration_receipt", result.receipt.receiptNo, { lifecycleStatus: result.receipt.lifecycleStatus });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/cost-items" && req.method === "POST") {
        requireAny(auth, ["stockup_cost_edit", "stockup_workflow_manage"], "当前账号没有费用录入权限。");
        const result = service.addCostItem(await readBody(req), context);
        appendActionLog(auth, "登记备货费用", "stockup_collaboration_cost", result.costItem.id, { amountCny: result.costItem.amountCny });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/costs\/([^/]+)\/preview$/)) && req.method === "GET") {
        requireAny(auth, ["stockup_cost_edit", "stockup_cost_review", "stockup_cost_lock", "stockup_cost_report_view", "stockup_workflow_manage"], "当前账号没有成本查看权限。");
        sendJson(res, 200, service.costPreview(decodeURIComponent(match[1]), context));
        return true;
      }
      if ((match = suffix.match(/^\/costs\/([^/]+)\/(submit-review|lock|adjust)$/)) && req.method === "POST") {
        const action = match[2];
        requireAny(auth, action === "lock" ? ["stockup_cost_lock", "stockup_workflow_manage"] : ["stockup_cost_edit", "stockup_cost_review", "stockup_workflow_manage"], "当前账号没有成本复核或锁定权限。");
        const payload = await readBody(req);
        if (action === "adjust") payload.versionType = "adjustment";
        const result = service.saveCostVersion(decodeURIComponent(match[1]), payload, context, action === "lock");
        appendActionLog(auth, action === "lock" ? "锁定备货到仓成本" : "提交备货成本复核", "stockup_collaboration_cost_version", match[1], { version: result.version });
        sendJson(res, 200, result);
        return true;
      }

      if (suffix === "/reports/monthly-cost" && req.method === "GET") {
        requireAny(auth, ["stockup_cost_report_view", "stockup_workflow_manage"], "当前账号没有月度成本报表权限。");
        sendJson(res, 200, service.monthlyCostReport(queryObject(url), context));
        return true;
      }
      if (suffix === "/reports/monthly-cost-periods" && req.method === "GET") {
        requireAny(auth, ["stockup_cost_report_view", "stockup_workflow_manage"], "当前账号没有月度成本报表权限。");
        sendJson(res, 200, service.listMonthlyCostPeriods(queryObject(url), context));
        return true;
      }
      if ((match = suffix.match(/^\/reports\/monthly-cost-periods\/([^/]+)\/(archive|activate|delete|restore)$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_cost_lock", "stockup_workflow_manage"], "当前账号没有管理月度成本归档的权限。");
        const month = decodeURIComponent(match[1]);
        const action = match[2];
        const result = service.updateMonthlyCostPeriod(month, action, context);
        appendActionLog(auth, `月度成本：${action}`, "stockup_monthly_cost_period", month, { status: result.period.status });
        sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/notifications" && req.method === "GET") {
        sendJson(res, 200, service.listNotifications(context));
        return true;
      }
      if ((match = suffix.match(/^\/notifications\/([^/]+)\/read$/)) && req.method === "POST") {
        sendJson(res, 200, service.markNotificationRead(decodeURIComponent(match[1]), context));
        return true;
      }

      sendJson(res, 404, { ok: false, code: "not_found", message: "备货协同接口不存在。" });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), { ok: false, code: error?.code || "stockup_collaboration_error", message: error?.message || "备货协同操作失败。", ...(error?.latest ? { latest: error.latest } : {}) });
      return true;
    }
  };
}

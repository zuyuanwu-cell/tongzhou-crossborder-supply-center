import { hasPermission } from "./access-control.js";

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

export function createStockupCollaborationApi({ service, getAuth, appendActionLog = () => {}, listWarehouses = () => [], listProjectTeams = () => [] }) {
  return async function handleStockupCollaborationApi(req, res, url) {
    if (!url.pathname.startsWith("/api/stockup/collaboration")) return false;
    const auth = getAuth(req);
    const context = contextFor(auth);
    try {
      requireAny(auth, ["stockup_request_view_own", "stockup_request_view_all", "stockup_workflow_view", "stockup_execution_view", "stockup_cost_report_view", "stockup_request_create", "stockup_request_accept", "stockup_execution_update", "stockup_shipment_update", "stockup_receipt_confirm", "stockup_cost_edit", "stockup_cost_review", "stockup_cost_lock"], "当前账号没有备货协同查看权限。");
      const suffix = url.pathname.replace("/api/stockup/collaboration", "") || "/";
      let match;

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

      if (suffix === "/requests" && req.method === "GET") {
        sendJson(res, 200, service.listRequests(queryObject(url), context));
        return true;
      }
      if (suffix === "/requests" && req.method === "POST") {
        requireAny(auth, ["stockup_request_create", "stockup_workflow_manage"], "当前账号没有新建备货需求权限。");
        const payload = await readBody(req);
        const result = service.createRequest(payload, context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, payload.submit ? "提交备货协同需求" : "保存备货协同草稿", "stockup_collaboration_request", result.requestNo, { requestId: result.requestId });
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
        if (["accept", "request-changes", "reject"].includes(action)) requireAny(auth, ["stockup_request_accept", "stockup_workflow_manage"], "当前账号没有受理备货需求权限。");
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
      if ((match = suffix.match(/^\/shipments\/([^/]+)\/dispatch$/)) && req.method === "POST") {
        requireAny(auth, ["stockup_shipment_update", "stockup_execution_manage"], "当前账号没有确认发运权限。");
        const result = service.dispatchShipment(decodeURIComponent(match[1]), await readBody(req), context);
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

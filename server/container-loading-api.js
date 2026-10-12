import { hasPermission } from "./access-control.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) reject(Object.assign(new Error("装柜方案请求不能超过 10MB。"), { statusCode: 413 }));
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

function hasAny(auth, permissions) {
  return auth?.role === "admin" || permissions.some((permission) => hasPermission(auth, permission));
}

function requireAny(auth, permissions, message) {
  if (hasAny(auth, permissions)) return;
  throw Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

function contextFor(auth) {
  const scopes = auth?.user?.dataScopes || {};
  return {
    auth,
    viewAll: hasAny(auth, ["container_loading_manage", "container_loading_confirm", "stockup_request_view_all", "stockup_execution_manage"]),
    countries: Array.isArray(scopes.countries) ? scopes.countries.map(String).filter(Boolean) : [],
    warehouseIds: Array.isArray(scopes.warehouseIds) ? scopes.warehouseIds.map(String).filter(Boolean) : [],
    skus: Array.isArray(scopes.skus) ? scopes.skus.map((value) => String(value).toUpperCase()).filter(Boolean) : [],
  };
}

export function createContainerLoadingApi({ service, getAuth, appendActionLog = () => {} }) {
  return async function handleContainerLoadingApi(req, res, url) {
    if (!url.pathname.startsWith("/api/container-loading")) return false;
    const auth = getAuth(req);
    const context = contextFor(auth);
    try {
      requireAny(auth, ["container_loading_view", "container_loading_manage", "container_loading_confirm"], "当前账号没有智能装柜查看权限。");
      const suffix = url.pathname.replace("/api/container-loading", "") || "/";
      let match;

      if (suffix === "/bootstrap" && req.method === "GET") {
        sendJson(res, 200, service.bootstrap(context));
        return true;
      }
      if (suffix === "/plans" && req.method === "GET") {
        sendJson(res, 200, service.listPlans(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if (suffix === "/plans" && req.method === "POST") {
        requireAny(auth, ["container_loading_manage"], "当前账号没有创建装柜方案权限。");
        const result = await service.createPlan(await readBody(req), context);
        appendActionLog(auth, "生成智能装柜方案", "container_loading_plan", result.plan.planNo, { sourceShipmentNo: result.plan.sourceShipmentNo, containerType: result.plan.containerType });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)$/)) && req.method === "GET") {
        sendJson(res, 200, service.getPlan(decodeURIComponent(match[1]), context));
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/versions$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_manage"], "当前账号没有调整装柜方案权限。");
        const result = service.saveVersion(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "保存装柜调整版本", "container_loading_plan", result.plan.planNo, { version: result.plan.version, strategy: result.plan.selectedStrategy });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/recalculate$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_manage"], "当前账号没有重新计算装柜方案权限。");
        const result = await service.recalculate(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "重新计算智能装柜方案", "container_loading_plan", result.plan.planNo, { version: result.plan.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/confirm$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_confirm"], "当前账号没有确认装柜方案权限。");
        const result = service.confirmPlan(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "确认智能装柜方案", "container_loading_plan", result.plan.planNo, { version: result.plan.version, strategy: result.plan.selectedStrategy });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/void$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_confirm"], "当前账号没有作废装柜方案权限。");
        const result = service.voidPlan(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "作废智能装柜方案", "container_loading_plan", result.plan.planNo, { version: result.plan.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/archive$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_confirm"], "当前账号没有归档装柜方案权限。");
        const result = service.archivePlan(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "归档已作废装柜方案", "container_loading_plan", result.plan.planNo, { version: result.plan.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)\/restore$/)) && req.method === "POST") {
        requireAny(auth, ["container_loading_confirm"], "当前账号没有恢复装柜方案权限。");
        const result = service.restorePlan(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "恢复已归档装柜方案", "container_loading_plan", result.plan.planNo, { version: result.plan.version });
        sendJson(res, 200, result);
        return true;
      }
      if ((match = suffix.match(/^\/plans\/([^/]+)$/)) && req.method === "DELETE") {
        requireAny(auth, ["container_loading_confirm"], "当前账号没有删除装柜方案权限。");
        const result = service.deletePlan(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "永久删除已作废装柜方案", "container_loading_plan", result.deletedPlan.planNo, {});
        sendJson(res, 200, result);
        return true;
      }

      sendJson(res, 404, { ok: false, code: "not_found", message: "智能装柜接口不存在。" });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), {
        ok: false,
        code: error?.code || "container_loading_error",
        message: error?.message || "智能装柜操作失败。",
        ...(error?.latest ? { latest: error.latest } : {}),
      });
      return true;
    }
  };
}

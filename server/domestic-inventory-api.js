import { hasPermission } from "./access-control.js";

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) reject(Object.assign(new Error("请求内容不能超过 2MB。"), { statusCode: 413 }));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error("请求 JSON 格式不正确。"), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

function contextFor(auth) {
  const scopes = auth?.user?.dataScopes || {};
  return {
    auth,
    warehouseIds: Array.isArray(scopes.warehouseIds) ? scopes.warehouseIds.map(String).filter(Boolean) : [],
    countries: Array.isArray(scopes.countries) ? scopes.countries.map(String).filter(Boolean) : [],
    skus: Array.isArray(scopes.skus) ? scopes.skus.map((value) => String(value).replace(/\s+/g, "").toUpperCase()).filter(Boolean) : [],
  };
}

export function createDomesticInventoryApi({ service, getAuth, appendActionLog = () => {} }) {
  return async function handleDomesticInventoryApi(req, res, url) {
    if (!url.pathname.startsWith("/api/domestic-inventory")) return false;
    const auth = getAuth(req);
    try {
      if (!hasPermission(auth, "domestic_inventory_view")) throw Object.assign(new Error("当前账号没有国内仓库存查看权限。"), { statusCode: 403, code: "forbidden" });
      const context = contextFor(auth);
      const suffix = url.pathname.replace("/api/domestic-inventory", "") || "/";
      let match;
      if (suffix === "/" && req.method === "GET") {
        sendJson(res, 200, service.list(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if (suffix === "/movements" && req.method === "GET") {
        sendJson(res, 200, service.listMovements(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if (suffix === "/warehouses" && req.method === "POST") {
        if (!hasPermission(auth, "domestic_inventory_manage")) throw Object.assign(new Error("当前账号没有仓库档案维护权限。"), { statusCode: 403 });
        const result = service.createWarehouse(await readBody(req), context);
        appendActionLog(auth, "新增国内仓库", "domestic_inventory_warehouse", result.warehouse.name, { warehouseId: result.warehouse.id });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/warehouses\/([^/]+)$/)) && req.method === "PATCH") {
        if (!hasPermission(auth, "domestic_inventory_manage")) throw Object.assign(new Error("当前账号没有仓库档案维护权限。"), { statusCode: 403 });
        const result = service.updateWarehouse(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "更新国内仓库", "domestic_inventory_warehouse", result.warehouse.name, { warehouseId: result.warehouse.id });
        sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/movements" && req.method === "POST") {
        if (!hasPermission(auth, "domestic_inventory_manage")) throw Object.assign(new Error("当前账号没有库存流水登记权限。"), { statusCode: 403 });
        const result = service.createMovement(await readBody(req), context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, "登记国内仓库存流水", "domestic_inventory_movement", result.movementNo, { movementId: result.movementId, type: result.type, warehouseId: result.warehouseId });
        sendJson(res, 201, result);
        return true;
      }
      if ((match = suffix.match(/^\/balances\/([^/]+)\/([^/]+)$/)) && req.method === "PATCH") {
        if (!hasPermission(auth, "domestic_inventory_manage")) throw Object.assign(new Error("当前账号没有库存参数维护权限。"), { statusCode: 403 });
        const result = service.updateSafetyStock(decodeURIComponent(match[1]), decodeURIComponent(match[2]), await readBody(req), context);
        appendActionLog(auth, "更新国内仓安全库存", "domestic_inventory_balance", result.sku, { warehouseId: result.warehouseId, safetyStockQty: result.safetyStockQty });
        sendJson(res, 200, result);
        return true;
      }
      sendJson(res, 404, { ok: false, code: "not_found", message: "国内仓库存接口不存在。" });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), { ok: false, code: error?.code || "domestic_inventory_error", message: error?.message || "国内仓库存操作失败。" });
      return true;
    }
  };
}

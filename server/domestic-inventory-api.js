import { hasPermission } from "./access-control.js";

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
  });
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

export function domesticInventoryContextForAuth(auth) {
  const scopes = auth?.user?.dataScopes || {};
  return {
    auth,
    warehouseIds: Array.isArray(scopes.warehouseIds) ? scopes.warehouseIds.map(String).filter(Boolean) : [],
    countries: Array.isArray(scopes.countries) ? scopes.countries.map(String).filter(Boolean) : [],
    skus: Array.isArray(scopes.skus) ? scopes.skus.map((value) => String(value).replace(/\s+/g, "").toUpperCase()).filter(Boolean) : [],
  };
}

function requireAnyPermission(auth, permissions, message) {
  if (!permissions.some((permission) => hasPermission(auth, permission))) throw Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

export function domesticInventoryOpenApi() {
  const json = { type: "object", additionalProperties: true };
  const response = (description) => ({ description, content: { "application/json": { schema: json } } });
  return {
    openapi: "3.1.0",
    info: { title: "同舟国内仓进销存 API", version: "1.0.0", description: "登录会话下的国内仓库存、批次、箱规和备货可用量接口。所有接口继续应用角色权限、仓库范围和 SKU 范围。" },
    servers: [{ url: "/", description: "当前同舟供应链服务" }],
    security: [{ sessionBearer: [] }],
    tags: [{ name: "Inventory", description: "库存汇总与仓库" }, { name: "Movements", description: "入库、出库和调整" }, { name: "Lots", description: "批次、条码、生产日期和箱规" }, { name: "Stockup", description: "供海外仓备货调用的国内库存可用量" }],
    paths: {
      "/api/domestic-inventory": { get: { tags: ["Inventory"], operationId: "listDomesticInventory", responses: { 200: response("库存汇总") } } },
      "/api/domestic-inventory/warehouses": {
        get: { tags: ["Inventory"], operationId: "listDomesticWarehouses", responses: { 200: response("仓库列表") } },
        post: { tags: ["Inventory"], operationId: "createDomesticWarehouse", responses: { 201: response("已创建仓库"), 403: response("无档案管理权限") } },
      },
      "/api/domestic-inventory/warehouses/{id}": { patch: { tags: ["Inventory"], operationId: "updateDomesticWarehouse", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("已更新仓库"), 403: response("无档案管理权限") } } },
      "/api/domestic-inventory/movements": {
        get: { tags: ["Movements"], operationId: "listDomesticInventoryMovements", responses: { 200: response("库存流水") } },
        post: { tags: ["Movements"], operationId: "createDomesticInventoryMovement", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MovementInput" } } } }, responses: { 201: response("已创建库存单据"), 409: response("库存不足或幂等冲突") } },
      },
      "/api/domestic-inventory/movements/{id}": { get: { tags: ["Movements"], operationId: "getDomesticInventoryMovement", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("库存单据详情"), 404: response("不存在或不可见") } } },
      "/api/domestic-inventory/lots": { get: { tags: ["Lots"], operationId: "listDomesticInventoryLots", parameters: ["warehouseId", "sku", "barcode", "lotNo", "keyword"].map((name) => ({ name, in: "query", schema: { type: "string" } })), responses: { 200: response("批次列表") } } },
      "/api/domestic-inventory/lots/{id}": { patch: { tags: ["Lots"], operationId: "updateDomesticInventoryLot", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("已更新批次追溯字段"), 403: response("无入库维护权限") } } },
      "/api/domestic-inventory/stockup-availability": { get: { tags: ["Stockup"], operationId: "getDomesticStockupAvailability", parameters: [{ name: "warehouseId", in: "query", required: true, schema: { type: "string" } }, { name: "skus", in: "query", required: true, schema: { type: "string", description: "逗号分隔，最多 100 个" } }], responses: { 200: response("SKU 可用量、批次和可用整箱数") } } },
      "/api/domestic-inventory/opening-import": { post: { tags: ["Movements"], operationId: "importDomesticOpeningInventory", parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string" } }], responses: { 201: response("期初库存已导入"), 403: response("无档案管理权限") } } },
      "/api/domestic-inventory/balances/{warehouseId}/{sku}": { patch: { tags: ["Inventory"], operationId: "updateDomesticSafetyStock", parameters: [{ name: "warehouseId", in: "path", required: true, schema: { type: "string" } }, { name: "sku", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("已更新安全库存"), 403: response("无档案管理权限") } } },
    },
    components: {
      securitySchemes: { sessionBearer: { type: "http", scheme: "bearer", bearerFormat: "同舟登录令牌" } },
      schemas: {
        MovementInput: { type: "object", required: ["warehouseId", "type", "lines"], properties: { warehouseId: { type: "string" }, type: { type: "string", enum: ["inbound", "outbound", "adjustment"] }, referenceNo: { type: "string" }, occurredAt: { type: "string", format: "date-time" }, note: { type: "string" }, lines: { type: "array", items: { $ref: "#/components/schemas/MovementLineInput" } } } },
        MovementLineInput: { type: "object", required: ["sku", "productName"], properties: { sku: { type: "string" }, productName: { type: "string" }, quantity: { type: "number" }, deltaQty: { type: "number" }, unitCostCny: { type: "number" }, packagingMode: { type: "string", enum: ["piece", "carton"] }, cartonCount: { type: "integer" }, unitsPerCarton: { type: "integer" }, looseQuantity: { type: "integer" }, cartonLengthCm: { type: "number" }, cartonWidthCm: { type: "number" }, cartonHeightCm: { type: "number" }, cartonWeightKg: { type: "number" }, lotNo: { type: "string" }, barcode: { type: "string" }, productionDate: { type: "string", format: "date" }, expiryDate: { type: "string", format: "date" } } },
      },
    },
  };
}

export function createDomesticInventoryApi({ service, getAuth, appendActionLog = () => {} }) {
  return async function handleDomesticInventoryApi(req, res, url) {
    if (url.pathname !== "/api/domestic-inventory" && !url.pathname.startsWith("/api/domestic-inventory/")) return false;
    const auth = getAuth(req);
    try {
      if (!hasPermission(auth, "domestic_inventory_view")) throw Object.assign(new Error("当前账号没有国内仓库存查看权限。"), { statusCode: 403, code: "forbidden" });
      const context = domesticInventoryContextForAuth(auth);
      const suffix = url.pathname.replace("/api/domestic-inventory", "") || "/";
      let match;
      if (suffix === "/openapi.json" && req.method === "GET") {
        sendJson(res, 200, domesticInventoryOpenApi());
        return true;
      }
      if (suffix === "/" && req.method === "GET") {
        sendJson(res, 200, service.list(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if (suffix === "/movements" && req.method === "GET") {
        sendJson(res, 200, service.listMovements(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if ((match = suffix.match(/^\/movements\/([^/]+)$/)) && req.method === "GET") {
        sendJson(res, 200, service.getMovement(decodeURIComponent(match[1]), context));
        return true;
      }
      if (suffix === "/warehouses" && req.method === "GET") {
        sendJson(res, 200, service.listWarehouses(context));
        return true;
      }
      if (suffix === "/lots" && req.method === "GET") {
        sendJson(res, 200, service.listLots(Object.fromEntries(url.searchParams.entries()), context));
        return true;
      }
      if ((match = suffix.match(/^\/lots\/([^/]+)$/)) && req.method === "PATCH") {
        requireAnyPermission(auth, ["domestic_inventory_receive", "domestic_inventory_manage"], "当前账号没有入库批次维护权限。");
        const result = service.updateLot(decodeURIComponent(match[1]), await readBody(req), context);
        appendActionLog(auth, "更新国内仓库存批次", "domestic_inventory_lot", result.lot.sku, { lotId: result.lot.id, warehouseId: result.lot.warehouseId });
        sendJson(res, 200, result);
        return true;
      }
      if (suffix === "/stockup-availability" && req.method === "GET") {
        sendJson(res, 200, service.stockupAvailability(Object.fromEntries(url.searchParams.entries()), context));
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
        const body = await readBody(req);
        const requiredPermission = body.type === "inbound" ? "domestic_inventory_receive" : body.type === "outbound" ? "domestic_inventory_issue" : "domestic_inventory_adjust";
        requireAnyPermission(auth, [requiredPermission, "domestic_inventory_manage"], "当前账号没有对应的库存流水登记权限。");
        const result = service.createMovement(body, context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, "登记国内仓库存流水", "domestic_inventory_movement", result.movementNo, { movementId: result.movementId, type: result.type, warehouseId: result.warehouseId });
        sendJson(res, 201, result);
        return true;
      }
      if (suffix === "/opening-import" && req.method === "POST") {
        if (!hasPermission(auth, "domestic_inventory_manage")) throw Object.assign(new Error("当前账号没有期初库存导入权限。"), { statusCode: 403 });
        const result = service.importOpeningBalances(await readBody(req), context, String(req.headers["idempotency-key"] || ""));
        appendActionLog(auth, "导入国内仓期初库存", "domestic_inventory_movement", result.movementNo, { movementId: result.movementId, warehouseId: result.warehouseId });
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

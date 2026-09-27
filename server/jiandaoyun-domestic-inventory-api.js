import { createHash, timingSafeEqual } from "node:crypto";

const ENDPOINT = "/api/integrations/jiandaoyun/domestic-inventory/inbound";
const ACTOR_ID = "jiandaoyun-domestic-inventory-plugin";

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function skuKey(value) {
  return text(value, 120).replace(/\s+/g, "").toUpperCase();
}

function fail(message, statusCode = 400, code = "jiandaoyun_inventory_error") {
  throw Object.assign(new Error(message), { statusCode, code });
}

function required(value, label, maxLength = 500) {
  const output = text(value, maxLength);
  if (!output) fail(`请填写${label}。`, 400, "missing_parameter");
  return output;
}

function finiteNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const output = Number(value);
  return Number.isFinite(output) ? output : undefined;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "是", "开启", "校验"].includes(text(value, 20).toLowerCase());
}

function safeTokenEqual(received, configured) {
  const receivedHash = createHash("sha256").update(String(received || "")).digest();
  const configuredHash = createHash("sha256").update(String(configured || "")).digest();
  return timingSafeEqual(receivedHash, configuredHash);
}

function bearerToken(req) {
  return text(req.headers.authorization, 4096).replace(/^Bearer\s+/i, "");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 256 * 1024) {
        settled = true;
        reject(Object.assign(new Error("请求内容不能超过 256KB。"), { statusCode: 413, code: "payload_too_large" }));
      }
    });
    req.on("end", () => {
      if (settled) return;
      try {
        settled = true;
        resolve(body ? JSON.parse(body) : {});
      } catch {
        settled = true;
        reject(Object.assign(new Error("请求 JSON 格式不正确。"), { statusCode: 400, code: "invalid_json" }));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function exactWarehouse(service, selector, context) {
  const target = required(selector, "国内仓库（编码、名称或 ID）", 160);
  const normalized = target.toUpperCase();
  const warehouses = service.listWarehouses(context).warehouses.filter((item) => item.status === "active");
  const matches = warehouses.filter((item) => (
    text(item.id, 160) === target
    || text(item.code, 160).toUpperCase() === normalized
    || text(item.name, 160) === target
  ));
  if (!matches.length) fail("未找到对应的启用国内仓库，请检查仓库编码或名称。", 404, "warehouse_not_found");
  if (matches.length > 1) fail("仓库名称不唯一，请改用仓库编码。", 409, "warehouse_ambiguous");
  return matches[0];
}

function occurredAt(value) {
  const raw = text(value, 100);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) fail("入库时间格式不正确。", 400, "invalid_occurred_at");
  return date.toISOString();
}

function buildMovement(body, warehouse) {
  const sourceRecordId = required(body.sourceRecordId, "简道云数据 ID", 200);
  const sourceType = text(body.sourceType, 100) || "简道云入库";
  const receiptBatch = text(body.receiptBatch, 100);
  const sourceLineId = text(body.sourceLineId, 200);
  const sku = skuKey(body.sku);
  if (!sku) fail("请填写同舟 SKU。", 400, "missing_sku");
  const quantity = finiteNumber(body.quantity);
  if (!(quantity > 0)) fail("入库数量必须大于 0。", 400, "invalid_quantity");

  const line = {
    productId: text(body.productId, 200),
    sku,
    productName: required(body.productName, "产品名称", 300),
    imageUrl: text(body.imageUrl, 2000),
    specification: text(body.specification, 300),
    unit: text(body.unit, 40) || "件",
    quantity,
    unitCostCny: finiteNumber(body.unitCostCny),
    packagingMode: text(body.packagingMode, 30).toLowerCase() === "carton" || text(body.packagingMode, 30) === "按箱" ? "carton" : "piece",
    cartonCount: finiteNumber(body.cartonCount),
    unitsPerCarton: finiteNumber(body.unitsPerCarton),
    looseQuantity: finiteNumber(body.looseQuantity),
    cartonLengthCm: finiteNumber(body.cartonLengthCm),
    cartonWidthCm: finiteNumber(body.cartonWidthCm),
    cartonHeightCm: finiteNumber(body.cartonHeightCm),
    cartonWeightKg: finiteNumber(body.cartonWeightKg),
    lotNo: text(body.lotNo, 160),
    barcode: text(body.barcode, 160),
    productionDate: text(body.productionDate, 30),
    expiryDate: text(body.expiryDate, 30),
  };

  const referenceNo = text(body.referenceNo, 200) || `JDY-${sourceRecordId}`;
  const noteParts = [
    `${sourceType}自动入库`,
    receiptBatch ? `批次：${receiptBatch}` : "",
    text(body.operatorName, 100) ? `经办人：${text(body.operatorName, 100)}` : "",
    text(body.note, 500),
  ].filter(Boolean);
  const identity = [sourceType, sourceRecordId, sourceLineId || sku, receiptBatch, warehouse.id, sku].join("|");
  const idempotencyKey = `jdy-inbound-${createHash("sha256").update(identity).digest("hex")}`;

  return {
    sourceRecordId,
    idempotencyKey,
    movement: {
      warehouseId: warehouse.id,
      type: "inbound",
      referenceNo,
      occurredAt: occurredAt(body.occurredAt),
      note: noteParts.join("；"),
      lines: [line],
    },
  };
}

export function createJiandaoyunDomesticInventoryApi({
  service,
  token,
  appendActionLog = () => {},
}) {
  const configuredToken = text(token, 4096);
  const auth = {
    role: "integration",
    user: {
      id: ACTOR_ID,
      username: ACTOR_ID,
      displayName: "简道云入库插件",
      role: "integration",
      dataScopes: {},
    },
  };
  const context = { auth, countries: ["中国"], warehouseIds: [], skus: [] };

  return async function handleJiandaoyunDomesticInventoryApi(req, res, url) {
    if (url.pathname !== ENDPOINT) return false;
    try {
      if (req.method !== "POST") fail("仅支持 POST 请求。", 405, "method_not_allowed");
      if (!configuredToken) fail("中台尚未配置简道云入库插件令牌。", 503, "integration_not_configured");
      const receivedToken = bearerToken(req);
      if (!receivedToken || !safeTokenEqual(receivedToken, configuredToken)) fail("插件令牌无效。", 401, "unauthorized");

      const body = await readBody(req);
      const warehouse = exactWarehouse(service, body.warehouse, context);
      const { sourceRecordId, idempotencyKey, movement } = buildMovement(body, warehouse);
      const dryRun = booleanValue(body.dryRun);
      if (dryRun) {
        const preview = service.previewMovement(movement, context);
        sendJson(res, 200, {
          ok: true,
          dryRun: true,
          message: "校验通过，未写入库存。",
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          sku: preview.lines[0].sku,
          quantity: preview.lines[0].quantity,
          idempotencyKey,
        });
        return true;
      }

      const result = service.createMovement(movement, context, idempotencyKey);
      appendActionLog(auth, result.idempotentReplay ? "简道云重复触发入库（已拦截）" : "简道云插件登记国内入库", "domestic_inventory_movement", result.movementNo, {
        sourceRecordId,
        warehouseId: warehouse.id,
        sku: movement.lines[0].sku,
        quantity: movement.lines[0].quantity,
        idempotentReplay: Boolean(result.idempotentReplay),
      });
      sendJson(res, result.idempotentReplay ? 200 : 201, {
        ...result,
        message: result.idempotentReplay ? "该记录已经入库，本次未重复增加库存。" : "国内库存入库成功。",
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        sku: movement.lines[0].sku,
        quantity: movement.lines[0].quantity,
        idempotencyKey,
      });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), {
        ok: false,
        code: error?.code || "jiandaoyun_inventory_error",
        message: error?.message || "简道云入库失败。",
      });
      return true;
    }
  };
}

export const jiandaoyunDomesticInventoryEndpoint = ENDPOINT;

import { createHash, timingSafeEqual } from "node:crypto";

const ENDPOINT = "/api/integrations/jiandaoyun/domestic-inventory/outbound";
const ACTOR_ID = "jiandaoyun-domestic-inventory-outbound-plugin";

function text(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function skuKey(value) {
  return text(value, 120).replace(/\s+/g, "").toUpperCase();
}

function fail(message, statusCode = 400, code = "jiandaoyun_inventory_outbound_error") {
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
  if (Number.isNaN(date.getTime())) fail("出库时间格式不正确。", 400, "invalid_occurred_at");
  return date.toISOString();
}

function currentBalance(service, warehouseId, sku, context) {
  return service.list({ warehouseId, keyword: sku }, context).balances.find((item) => skuKey(item.sku) === sku) || null;
}

function validateDryRunStock(service, warehouse, line, balance, context) {
  if (!balance) fail(`${line.sku} 在${warehouse.name}没有可出库库存。`, 404, "stock_not_found");
  if (line.quantity > balance.availableQty) {
    fail(`${line.sku} 可用库存不足：当前可用 ${balance.availableQty} ${balance.unit}，本次需出库 ${line.quantity} ${balance.unit}。`, 409, "insufficient_stock");
  }
  if (!line.lotId && !line.lotNo && !line.barcode) return;
  const lotResult = service.listLots({
    warehouseId: warehouse.id,
    sku: line.sku,
    lotNo: line.lotNo,
    barcode: line.barcode,
    availableOnly: "1",
    limit: 300,
  }, context);
  const matching = line.lotId ? lotResult.lots.filter((lot) => lot.id === line.lotId) : lotResult.lots;
  const batchAvailable = matching.reduce((sum, lot) => sum + Number(lot.remainingQty || 0), 0);
  if (line.quantity > batchAvailable) {
    fail(`${line.sku} 指定批次库存不足：批次可用 ${batchAvailable} ${balance.unit}，本次需出库 ${line.quantity} ${balance.unit}。`, 409, "insufficient_lot_stock");
  }
}

function buildMovement(body, warehouse, balance) {
  const sourceRecordId = required(body.sourceRecordId, "简道云数据 ID", 200);
  const sourceType = text(body.sourceType, 100) || "简道云出库单";
  const dispatchBatch = text(body.dispatchBatch, 100);
  const sourceLineId = text(body.sourceLineId, 200);
  const sku = skuKey(body.sku);
  if (!sku) fail("请填写同舟 SKU。", 400, "missing_sku");
  const quantity = finiteNumber(body.quantity);
  if (!(quantity > 0)) fail("出库数量必须大于 0。", 400, "invalid_quantity");

  const line = {
    productId: text(balance?.productId || body.productId, 200),
    sku,
    productName: text(balance?.productName || body.productName, 300) || sku,
    imageUrl: text(balance?.imageUrl || body.imageUrl, 2000),
    specification: text(balance?.specification || body.specification, 300),
    unit: text(balance?.unit || body.unit, 40) || "件",
    quantity,
    lotId: text(body.lotId, 200),
    lotNo: text(body.lotNo, 160),
    barcode: text(body.barcode, 160),
  };
  const referenceNo = text(body.referenceNo, 200) || `JDY-CK-${sourceRecordId}`;
  const noteParts = [
    `${sourceType}自动出库`,
    dispatchBatch ? `出库批次：${dispatchBatch}` : "",
    text(body.operatorName, 100) ? `经办人：${text(body.operatorName, 100)}` : "",
    text(body.note, 500),
  ].filter(Boolean);
  const identity = [sourceType, sourceRecordId, sourceLineId || sku, dispatchBatch, warehouse.id, sku].join("|");
  const idempotencyKey = `jdy-outbound-${createHash("sha256").update(identity).digest("hex")}`;

  return {
    sourceRecordId,
    idempotencyKey,
    line,
    movement: {
      warehouseId: warehouse.id,
      type: "outbound",
      referenceNo,
      occurredAt: occurredAt(body.occurredAt),
      note: noteParts.join("；"),
      lines: [line],
    },
  };
}

function movementResult(service, result, context, fallbackLine) {
  const movement = result.movementId ? service.getMovement(result.movementId, context).movement : null;
  const line = movement?.lines?.find((item) => skuKey(item.sku) === fallbackLine.sku) || {};
  return {
    quantity: Number(line.quantity ?? fallbackLine.quantity),
    beforeQty: Number(line.beforeQty ?? 0),
    afterQty: Number(line.afterQty ?? 0),
    productName: text(line.productName || fallbackLine.productName),
    unit: text(line.unit || fallbackLine.unit) || "件",
  };
}

export function createJiandaoyunDomesticInventoryOutboundApi({
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
      displayName: "简道云国内仓出库插件",
      role: "integration",
      dataScopes: {},
    },
  };
  const context = { auth, countries: ["中国"], warehouseIds: [], skus: [] };

  return async function handleJiandaoyunDomesticInventoryOutboundApi(req, res, url) {
    if (url.pathname !== ENDPOINT) return false;
    try {
      if (req.method !== "POST") fail("仅支持 POST 请求。", 405, "method_not_allowed");
      if (!configuredToken) fail("中台尚未配置简道云出库插件令牌。", 503, "integration_not_configured");
      const receivedToken = bearerToken(req);
      if (!receivedToken || !safeTokenEqual(receivedToken, configuredToken)) fail("插件令牌无效。", 401, "unauthorized");

      const body = await readBody(req);
      const warehouse = exactWarehouse(service, body.warehouse, context);
      const sku = skuKey(body.sku);
      const balance = sku ? currentBalance(service, warehouse.id, sku, context) : null;
      const { sourceRecordId, idempotencyKey, line, movement } = buildMovement(body, warehouse, balance);
      const dryRun = booleanValue(body.dryRun);
      if (dryRun) {
        validateDryRunStock(service, warehouse, line, balance, context);
        service.previewMovement(movement, context);
        sendJson(res, 200, {
          ok: true,
          dryRun: true,
          message: "校验通过，未扣减库存。",
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          sku: line.sku,
          productName: line.productName,
          unit: line.unit,
          quantity: line.quantity,
          beforeQty: balance.onHandQty,
          afterQty: balance.onHandQty - line.quantity,
          idempotencyKey,
        });
        return true;
      }

      const result = service.createMovement(movement, context, idempotencyKey);
      const quantities = movementResult(service, result, context, line);
      appendActionLog(auth, result.idempotentReplay ? "简道云重复触发出库（已拦截）" : "简道云插件登记国内出库", "domestic_inventory_movement", result.movementNo, {
        sourceRecordId,
        warehouseId: warehouse.id,
        sku: line.sku,
        quantity: line.quantity,
        idempotentReplay: Boolean(result.idempotentReplay),
      });
      sendJson(res, result.idempotentReplay ? 200 : 201, {
        ...result,
        message: result.idempotentReplay ? "该记录已经出库，本次未重复扣减库存。" : "国内仓库存出库成功。",
        warehouseCode: warehouse.code,
        warehouseName: warehouse.name,
        sku: line.sku,
        quantity: line.quantity,
        idempotencyKey,
        ...quantities,
      });
      return true;
    } catch (error) {
      sendJson(res, Number(error?.statusCode || 400), {
        ok: false,
        code: error?.code || "jiandaoyun_inventory_outbound_error",
        message: error?.message || "简道云出库失败。",
      });
      return true;
    }
  };
}

export const jiandaoyunDomesticInventoryOutboundEndpoint = ENDPOINT;

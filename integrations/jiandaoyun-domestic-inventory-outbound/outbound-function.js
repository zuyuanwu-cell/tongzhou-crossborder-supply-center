// 简道云私有插件后端函数（Node.js 20）。
// 通用参数：apiBaseUrl、accessToken；请求参数见同目录 README.md。

const axios = require("axios");

const firstValue = (value) => {
  let current = value;
  if (typeof current === "string") {
    const trimmed = current.trim();
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try { current = JSON.parse(trimmed); } catch (_) { current = trimmed; }
    } else {
      current = trimmed;
    }
  }
  if (Array.isArray(current)) current = current[0];
  if (current && typeof current === "object") {
    if (current.value !== undefined) return current.value;
    if (current.name !== undefined) return current.name;
  }
  return current;
};

const stringValue = (value) => String(firstValue(value) ?? "").trim();
const numberValue = (value) => {
  const raw = stringValue(value).replace(/,/g, "");
  if (!raw) return undefined;
  const output = Number(raw);
  return Number.isFinite(output) ? output : undefined;
};
const yesValue = (value) => ["1", "true", "yes", "y", "是", "开启", "校验"].includes(stringValue(value).toLowerCase());

const apiBaseUrl = stringValue(agentConf.apiBaseUrl || "https://gyl.tongzhoukuajing.com").replace(/\/+$/, "");
const accessToken = stringValue(agentConf.accessToken);
if (!accessToken) throw new Error("请先在插件通用参数中配置中台出库令牌");

const sourceRecordId = stringValue(triggerConf.sourceRecordId);
const warehouse = stringValue(triggerConf.warehouse);
const sku = stringValue(triggerConf.sku).replace(/\s+/g, "").toUpperCase();
const quantity = numberValue(triggerConf.quantity);
if (!sourceRecordId) throw new Error("缺少简道云数据 ID，无法防止重复出库");
if (!warehouse) throw new Error("请选择或填写启用中的国内仓库编码");
if (!sku) throw new Error("缺少同舟 SKU");
if (!(quantity > 0)) throw new Error("出库数量必须大于 0");

const payload = {
  warehouse,
  sourceRecordId,
  sourceLineId: stringValue(triggerConf.sourceLineId),
  sourceType: stringValue(triggerConf.sourceType) || "简道云出库单",
  dispatchBatch: stringValue(triggerConf.dispatchBatch),
  referenceNo: stringValue(triggerConf.referenceNo),
  occurredAt: stringValue(triggerConf.occurredAt),
  operatorName: stringValue(triggerConf.operatorName),
  note: stringValue(triggerConf.note),
  productId: stringValue(triggerConf.productId),
  sku,
  productName: stringValue(triggerConf.productName),
  imageUrl: stringValue(triggerConf.imageUrl),
  specification: stringValue(triggerConf.specification),
  unit: stringValue(triggerConf.unit) || "件",
  quantity,
  lotId: stringValue(triggerConf.lotId),
  lotNo: stringValue(triggerConf.lotNo),
  barcode: stringValue(triggerConf.barcode),
  dryRun: yesValue(triggerConf.dryRun),
};

try {
  const response = await axios({
    method: "post",
    url: `${apiBaseUrl}/api/integrations/jiandaoyun/domestic-inventory/outbound`,
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    data: payload,
  });
  const data = response.data || {};
  return {
    success: Boolean(data.ok),
    message: String(data.message || "出库完成"),
    dryRun: Boolean(data.dryRun),
    movementId: String(data.movementId || ""),
    movementNo: String(data.movementNo || ""),
    warehouseId: String(data.warehouseId || ""),
    warehouseCode: String(data.warehouseCode || ""),
    warehouseName: String(data.warehouseName || ""),
    sku: String(data.sku || sku),
    productName: String(data.productName || payload.productName),
    unit: String(data.unit || payload.unit),
    quantity: Number(data.quantity || quantity),
    beforeQty: Number(data.beforeQty || 0),
    afterQty: Number(data.afterQty || 0),
    idempotentReplay: Boolean(data.idempotentReplay),
  };
} catch (error) {
  const body = error && error.response && error.response.data ? error.response.data : {};
  const code = String(body.code || (error && error.code) || "request_failed");
  const message = String(body.message || (error && error.message) || "未知错误");
  throw new Error(`中台出库失败（${code}）：${message}`);
}


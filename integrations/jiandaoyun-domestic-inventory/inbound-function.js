// 简道云私有插件后端函数（Node.js 20）函数体。
// 通用参数：apiBaseUrl、accessToken
// 请求参数：见同目录 README.md。代码会按 sourceRecordId + SKU + 仓库生成幂等键。

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
if (!accessToken) throw new Error("请先在插件通用参数中配置中台入库令牌");

const sourceRecordId = stringValue(triggerConf.sourceRecordId);
const warehouse = stringValue(triggerConf.warehouse);
const sku = stringValue(triggerConf.sku).replace(/\s+/g, "").toUpperCase();
const productName = stringValue(triggerConf.productName);
const quantity = numberValue(triggerConf.quantity);
if (!sourceRecordId) throw new Error("缺少简道云数据 ID，无法防止重复入库");
if (!warehouse) throw new Error("请选择或填写国内仓库编码");
if (!sku) throw new Error("缺少同舟 SKU");
if (!productName) throw new Error("缺少产品名称");
if (!(quantity > 0)) throw new Error("入库数量必须大于 0");

const payload = {
  warehouse,
  sourceRecordId,
  sourceLineId: stringValue(triggerConf.sourceLineId),
  sourceType: stringValue(triggerConf.sourceType) || "简道云委外入库",
  receiptBatch: stringValue(triggerConf.receiptBatch),
  referenceNo: stringValue(triggerConf.referenceNo),
  occurredAt: stringValue(triggerConf.occurredAt),
  operatorName: stringValue(triggerConf.operatorName),
  note: stringValue(triggerConf.note),
  productId: stringValue(triggerConf.productId),
  sku,
  productName,
  imageUrl: stringValue(triggerConf.imageUrl),
  specification: stringValue(triggerConf.specification),
  unit: stringValue(triggerConf.unit) || "件",
  quantity,
  unitCostCny: numberValue(triggerConf.unitCostCny),
  packagingMode: ["按箱", "carton"].includes(stringValue(triggerConf.packagingMode).toLowerCase()) ? "carton" : "piece",
  cartonCount: numberValue(triggerConf.cartonCount),
  unitsPerCarton: numberValue(triggerConf.unitsPerCarton),
  looseQuantity: numberValue(triggerConf.looseQuantity),
  cartonLengthCm: numberValue(triggerConf.cartonLengthCm),
  cartonWidthCm: numberValue(triggerConf.cartonWidthCm),
  cartonHeightCm: numberValue(triggerConf.cartonHeightCm),
  cartonWeightKg: numberValue(triggerConf.cartonWeightKg),
  lotNo: stringValue(triggerConf.lotNo),
  barcode: stringValue(triggerConf.barcode),
  productionDate: stringValue(triggerConf.productionDate).slice(0, 10),
  expiryDate: stringValue(triggerConf.expiryDate).slice(0, 10),
  dryRun: yesValue(triggerConf.dryRun),
};

try {
  const response = await axios({
    method: "post",
    url: `${apiBaseUrl}/api/integrations/jiandaoyun/domestic-inventory/inbound`,
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
    message: String(data.message || "入库完成"),
    dryRun: Boolean(data.dryRun),
    movementId: String(data.movementId || ""),
    movementNo: String(data.movementNo || ""),
    warehouseId: String(data.warehouseId || ""),
    warehouseCode: String(data.warehouseCode || ""),
    warehouseName: String(data.warehouseName || ""),
    sku: String(data.sku || sku),
    quantity: Number(data.quantity || quantity),
    idempotentReplay: Boolean(data.idempotentReplay),
  };
} catch (error) {
  const body = error && error.response && error.response.data ? error.response.data : {};
  const code = String(body.code || (error && error.code) || "request_failed");
  const message = String(body.message || (error && error.message) || "未知错误");
  throw new Error(`中台入库失败（${code}）：${message}`);
}

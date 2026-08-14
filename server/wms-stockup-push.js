import { createHash } from "node:crypto";

const ACTIVE_TASK_STATUSES = new Set(["pending_confirmation", "pushing", "failed"]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || String(fallback ?? "").trim();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function compactMatchKey(value) {
  return text(value).toLowerCase().replace(/[\s|/\\()（）·_\-]+/g, "");
}

function warehouseInfoMatch(connection, records = []) {
  const nameKey = compactMatchKey(connection.name);
  const codeKeys = [connection.warehouseCode, connection.warehouseId, connection.resolvedWarehouseId]
    .map(compactMatchKey)
    .filter(Boolean);
  const countryKey = compactMatchKey(connection.country);
  const scored = records.map((record) => {
    const recordName = compactMatchKey(record.warehouseName);
    const recordCode = compactMatchKey(record.warehouseCode);
    const recordCountry = compactMatchKey(record.countryRegion);
    let score = 0;
    if (nameKey && recordName === nameKey) score += 100;
    else if (nameKey && recordName && (nameKey.includes(recordName) || recordName.includes(nameKey))) score += 60;
    if (codeKeys.some((key) => recordCode && (recordCode.includes(key) || key.includes(recordCode)))) score += 80;
    if (countryKey && recordCountry === countryKey) score += 20;
    return { record, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 60 ? scored[0].record : null;
}

export function buildWmsWarehouseOptions(connections = [], warehouseInfo = [], capabilityResolver = () => ({})) {
  return connections.map((connection) => {
    const matched = warehouseInfoMatch(connection, warehouseInfo);
    const capability = capabilityResolver(connection) || {};
    return {
      connectionId: text(connection.id),
      warehouseRecordId: text(matched?.id),
      warehouseName: text(matched?.warehouseName, connection.name) || text(connection.name),
      connectionName: text(connection.name),
      warehouseCode: text(connection.warehouseCode || connection.warehouseId || connection.resolvedWarehouseId),
      warehouseId: text(connection.warehouseId || connection.resolvedWarehouseId),
      country: text(matched?.countryRegion || connection.country),
      providerId: text(connection.providerId),
      providerName: text(connection.providerName),
      receivingAddress: text(matched?.firstMileReceivingAddress),
      createSupported: capability.supported === true,
      createConfigured: capability.configured === true,
      createMode: text(capability.createMode),
      createMessage: text(capability.message),
    };
  });
}

export function normalizeWmsPushStore(value) {
  const tasks = Array.isArray(value?.tasks) ? value.tasks : [];
  return {
    updatedAt: text(value?.updatedAt),
    tasks: tasks.filter((task) => task && task.id && task.shipmentRecordId).slice(0, 500),
  };
}

export function recoverInterruptedWmsPushes(store) {
  const normalized = normalizeWmsPushStore(store);
  for (const task of normalized.tasks) {
    if (task.status !== "pushing") continue;
    task.status = "needs_manual_check";
    task.lastError = task.lastError || "服务在 WMS 请求期间重启，结果可能已生效；请按外部参考号到 WMS 核实。";
  }
  return normalized;
}

export function buildWmsPushTask({ shipmentRecordId, shipmentNo, stockupOrderRecordId, warehouseOption, carrier, trackingNo, lines, createdBy }) {
  if (!shipmentRecordId) throw new Error("缺少发货记录 ID，无法建立 WMS 待推送任务。");
  if (!warehouseOption?.connectionId) throw new Error("请选择已经建档的目的仓。");
  const normalizedLines = (Array.isArray(lines) ? lines : []).map((line, index) => ({
    sku: text(line.sku || line.temporaryProductNo),
    productName: text(line.productName),
    quantity: number(line.quantity ?? line.shippedQty),
    purchasePrice: number(line.purchasePrice ?? line.baseUnitCostCny),
    purchasePriceCurrency: text(line.purchasePriceCurrency || line.currency || "CNY") || "CNY",
    boxSequence: Math.max(1, Math.floor(number(line.boxSequence) || index + 1)),
  }));
  if (!normalizedLines.length || normalizedLines.some((line) => !line.sku || line.quantity <= 0)) {
    throw new Error("发货 SKU 或数量不完整，无法建立 WMS 待推送任务。");
  }
  const externalReferenceNo = text(shipmentNo || `TZ-${shipmentRecordId}`).slice(0, 50);
  const id = `wms-push-${createHash("sha256").update(`${shipmentRecordId}:${warehouseOption.connectionId}`).digest("hex").slice(0, 20)}`;
  const now = new Date().toISOString();
  return {
    id,
    shipmentRecordId: text(shipmentRecordId),
    shipmentNo: text(shipmentNo),
    stockupOrderRecordId: text(stockupOrderRecordId),
    warehouseConnectionId: text(warehouseOption.connectionId),
    warehouseRecordId: text(warehouseOption.warehouseRecordId),
    warehouseName: text(warehouseOption.warehouseName || warehouseOption.connectionName),
    warehouseCode: text(warehouseOption.warehouseCode),
    country: text(warehouseOption.country),
    providerId: text(warehouseOption.providerId),
    providerName: text(warehouseOption.providerName),
    externalReferenceNo,
    status: "pending_confirmation",
    attempts: 0,
    lastError: "",
    wmsOrderNo: "",
    createdAt: now,
    createdBy: text(createdBy),
    confirmedAt: "",
    pushedAt: "",
    payloadSnapshot: {
      referenceNo: externalReferenceNo,
      carrier: text(carrier),
      trackingNo: text(trackingNo),
      customerNote: `同舟中台发货单 ${text(shipmentNo || shipmentRecordId)}`.slice(0, 200),
      lines: normalizedLines,
    },
  };
}

export function upsertWmsPushTask(store, task) {
  const normalized = normalizeWmsPushStore(store);
  const existing = normalized.tasks.find((item) => item.id === task.id || (
    item.shipmentRecordId === task.shipmentRecordId && item.warehouseConnectionId === task.warehouseConnectionId
  ));
  if (existing) return { store: normalized, task: existing, created: false };
  normalized.updatedAt = new Date().toISOString();
  normalized.tasks = [task, ...normalized.tasks].slice(0, 500);
  return { store: normalized, task, created: true };
}

export function publicWmsPushTask(task, warehouseOption) {
  return {
    id: task.id,
    shipmentRecordId: task.shipmentRecordId,
    shipmentNo: task.shipmentNo,
    stockupOrderRecordId: task.stockupOrderRecordId,
    warehouseConnectionId: task.warehouseConnectionId,
    warehouseName: task.warehouseName,
    warehouseCode: task.warehouseCode,
    country: task.country,
    providerId: task.providerId,
    providerName: task.providerName,
    externalReferenceNo: task.externalReferenceNo,
    status: task.status,
    attempts: number(task.attempts),
    lastError: text(task.lastError),
    wmsOrderNo: text(task.wmsOrderNo),
    createdAt: task.createdAt,
    confirmedAt: text(task.confirmedAt),
    pushedAt: text(task.pushedAt),
    lineCount: Array.isArray(task.payloadSnapshot?.lines) ? task.payloadSnapshot.lines.length : 0,
    canPush: ACTIVE_TASK_STATUSES.has(task.status) && task.status !== "pushing" && warehouseOption?.createConfigured === true,
    createMode: text(warehouseOption?.createMode),
    createMessage: text(warehouseOption?.createMessage),
  };
}

export function publicWmsPushTasks(store, warehouseOptions = []) {
  const optionById = new Map(warehouseOptions.map((option) => [option.connectionId, option]));
  return normalizeWmsPushStore(store).tasks.map((task) => publicWmsPushTask(task, optionById.get(task.warehouseConnectionId)));
}

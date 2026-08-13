import { JIANYUN_FORMS } from "./field-mapping.js";
import { createJdyData, fetchJdyDataList, updateJdyData } from "./jiandaoyun-client.js";

export const LANDED_COST_FORMULA_VERSION = "landed-cost-v1";

const FEE_BUCKETS = {
  domesticFreight: ["国内运费"],
  firstMileFreight: ["头程运费", "国际运费", "海运费", "空运费"],
  pickupFee: ["提货费"],
  customsTaxes: ["报关费", "清关费", "关税", "报关清关关税"],
  insuranceFee: ["保险费"],
  warehouseFee: ["上架费", "仓库操作费", "仓储操作费"],
  laborPackagingFee: ["人工费", "标签费", "包装材料费", "包装费"],
  inspectionFee: ["检测/备案摊销", "检测费", "备案费"],
};

const ALLOCATION_METHOD_LABELS = {
  weight: "按重量",
  volume: "按体积",
  quantity: "按数量",
  value: "按货值",
  manual: "手工分摊",
};

function rawValue(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
  return field;
}

function textValue(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean).join(",");
  if (typeof value === "object") {
    return textValue(value.name || value.label || value.title || value.username || value.value || value.data_id, fallback);
  }
  return String(value).trim() || fallback;
}

function numberValue(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function dateValue(value) {
  const raw = textValue(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function recordId(record) {
  return String(record?.data_id || record?._id || record?.id || "");
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function truthyChoice(value, fallback = true) {
  const normalized = textValue(value).toLowerCase();
  if (!normalized) return fallback;
  if (["否", "no", "false", "0", "不计入"].includes(normalized)) return false;
  return true;
}

function subformRows(record, fieldId) {
  const raw = rawValue(record, fieldId);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function readText(record, fieldId, fallback = "") {
  return textValue(rawValue(record, fieldId), fallback);
}

function readNumber(record, fieldId, fallback = 0) {
  return numberValue(rawValue(record, fieldId), fallback);
}

function readDate(record, fieldId) {
  return dateValue(rawValue(record, fieldId));
}

function normalizeAllocationMethod(value) {
  const normalized = textValue(value).toLowerCase();
  if (/体积|volume/.test(normalized)) return "volume";
  if (/数量|quantity|qty/.test(normalized)) return "quantity";
  if (/货值|value|金额/.test(normalized)) return "value";
  if (/手工|指定|manual/.test(normalized)) return "manual";
  return "weight";
}

function normalizeFeeBucket(value) {
  const name = textValue(value, "其他");
  for (const [bucket, aliases] of Object.entries(FEE_BUCKETS)) {
    if (aliases.some((alias) => name.includes(alias))) return bucket;
  }
  return "otherFee";
}

function jdyField(value) {
  return { value };
}

function compactJdyData(data) {
  return Object.fromEntries(Object.entries(data).filter(([fieldId, field]) => fieldId && field?.value !== undefined));
}

function createdDataId(result) {
  return String(result?.data?._id || result?.data?.data_id || result?.data_id || result?._id || result?.id || "");
}

function businessNo(prefix) {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${prefix}-${parts.join("")}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function normalizeDemand(record) {
  const fields = JIANYUN_FORMS.stockupDemands.fields;
  return {
    id: recordId(record),
    demandBatchNo: readText(record, fields.demandBatchNo),
    demandLineNo: readText(record, fields.demandLineNo),
    productSourceType: readText(record, fields.productSourceType),
    productRecordId: readText(record, fields.productRecordId),
    temporaryProductNo: readText(record, fields.temporaryProductNo),
    skuCodingStatus: readText(record, fields.skuCodingStatus),
    sku: readText(record, fields.officialSku, readText(record, fields.legacySku)),
    productName: readText(record, fields.productName),
    project: readText(record, fields.project),
    platform: readText(record, fields.platform),
    destinationCountry: readText(record, fields.destinationCountry),
    destinationWarehouseRecordId: readText(record, fields.destinationWarehouseRecordId),
    destinationWarehouseName: readText(record, fields.destinationWarehouseName),
    stockupMethod: readText(record, fields.stockupMethod),
    demandSource: readText(record, fields.demandSource),
    priority: readText(record, fields.priority),
    businessStatus: readText(record, fields.businessStatus),
    supplyOwner: readText(record, fields.supplyOwner),
    requestedQty: readNumber(record, fields.requestedQty),
    plannedQty: readNumber(record, fields.plannedQty),
    shippedQty: readNumber(record, fields.shippedQty),
    receivedQty: readNumber(record, fields.receivedQty),
    submittedAt: readDate(record, fields.submittedAt),
    expectedArrivalAt: readDate(record, fields.expectedArrivalAt),
    reason: readText(record, fields.reason),
    cancellationReason: readText(record, fields.cancellationReason),
  };
}

function normalizeStockupOrder(record) {
  const fields = JIANYUN_FORMS.stockupOrders.fields;
  return {
    id: recordId(record),
    orderNo: readText(record, fields.orderNo, readText(record, fields.serialNo)),
    demandBatchNo: readText(record, fields.demandBatchNo),
    demandRecordIds: readText(record, fields.demandRecordIds).split(/[,，\s]+/).filter(Boolean),
    executionMode: readText(record, fields.executionMode),
    destinationCountry: readText(record, fields.destinationCountry),
    destinationWarehouseRecordId: readText(record, fields.destinationWarehouseRecordId),
    destinationWarehouseName: readText(record, fields.destinationWarehouseName),
    project: readText(record, fields.project),
    status: readText(record, fields.status),
    plannedQty: readNumber(record, fields.plannedQtyTotal),
    orderedQty: readNumber(record, fields.orderedQtyTotal),
    completedQty: readNumber(record, fields.completedQtyTotal),
    shippedQty: readNumber(record, fields.shippedQtyTotal),
    receivedQty: readNumber(record, fields.receivedQtyTotal),
    stockupDate: readDate(record, fields.stockupDate),
    expectedCompletedAt: readDate(record, fields.expectedCompletedAt),
    actualCompletedAt: readDate(record, fields.actualCompletedAt),
    dataVersion: readNumber(record, fields.dataVersion),
  };
}

function normalizeStockupLine(record) {
  const fields = JIANYUN_FORMS.stockupOrderLines.fields;
  return {
    id: recordId(record),
    legacyOrderNo: readText(record, fields.legacyOrderNo),
    orderRecordId: readText(record, fields.orderRecordId),
    demandRecordId: readText(record, fields.demandRecordId),
    productRecordId: readText(record, fields.productRecordId),
    temporaryProductNo: readText(record, fields.temporaryProductNo),
    sku: readText(record, fields.officialSku, readText(record, fields.legacySku)),
    productName: readText(record, fields.productName),
    supplyMode: readText(record, fields.supplyMode),
    plannedQty: readNumber(record, fields.plannedQty, readNumber(record, fields.legacyPlannedQty)),
    orderedQty: readNumber(record, fields.orderedQty),
    completedQty: readNumber(record, fields.completedQty, readNumber(record, fields.legacyCompletedQty)),
    qualifiedQty: readNumber(record, fields.qualifiedQty),
    shippedQty: readNumber(record, fields.shippedQty, readNumber(record, fields.legacyShippedQty)),
    receivedQty: readNumber(record, fields.receivedQty),
    cancelledQty: readNumber(record, fields.cancelledQty),
    baseCurrency: readText(record, fields.baseCurrency, "CNY"),
    baseExchangeRate: readNumber(record, fields.baseExchangeRate, 1),
    actualBaseUnitCost: readNumber(record, fields.actualBaseUnitCost, readNumber(record, fields.legacyUnitCost)),
    expectedReadyAt: readDate(record, fields.expectedReadyAt),
    actualReadyAt: readDate(record, fields.actualReadyAt),
    status: readText(record, fields.status),
    exceptionReason: readText(record, fields.exceptionReason),
  };
}

function normalizeShipmentLine(row, shipmentId, index) {
  const fields = JIANYUN_FORMS.shipments.lineFields;
  const fallbackLineId = `${shipmentId}:${index + 1}`;
  const shippedQty = readNumber(row, fields.shippedQty, readNumber(row, fields.boxPackQty));
  const baseUnitCostCny = readNumber(row, fields.baseUnitCostCny, readNumber(row, fields.unitCost));
  return {
    id: readText(row, fields.shipmentLineId, recordId(row) || fallbackLineId),
    stockupLineRecordId: readText(row, fields.stockupLineRecordId),
    demandRecordId: readText(row, fields.demandRecordId),
    productRecordId: readText(row, fields.productRecordId),
    temporaryProductNo: readText(row, fields.temporaryProductNo),
    sku: readText(row, fields.sku),
    productName: readText(row, fields.productName),
    shippedQty,
    receivedQty: readNumber(row, fields.receivedQty),
    damagedQty: readNumber(row, fields.damagedQty),
    totalWeightKg: readNumber(row, fields.totalWeightKg, readNumber(row, fields.boxWeightKg)),
    totalVolumeM3: readNumber(row, fields.totalVolumeM3, readNumber(row, fields.volumeM3)),
    baseUnitCostCny,
    baseCostTotalCny: readNumber(row, fields.baseCostTotalCny, round(baseUnitCostCny * shippedQty, 4)),
    receiptWriteoffStatus: readText(row, fields.receiptWriteoffStatus),
  };
}

function aggregateShipmentLines(lines, shipmentId) {
  const grouped = new Map();
  for (const line of lines) {
    const key = line.productRecordId || line.sku || line.temporaryProductNo || line.id;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...line, sourceLineIds: [line.id] });
      continue;
    }
    current.sourceLineIds.push(line.id);
    current.shippedQty = round(current.shippedQty + line.shippedQty, 4);
    current.receivedQty = round(current.receivedQty + line.receivedQty, 4);
    current.damagedQty = round(current.damagedQty + line.damagedQty, 4);
    current.totalWeightKg = round(current.totalWeightKg + line.totalWeightKg, 8);
    current.totalVolumeM3 = round(current.totalVolumeM3 + line.totalVolumeM3, 8);
    current.baseCostTotalCny = round(current.baseCostTotalCny + line.baseCostTotalCny, 4);
    current.baseUnitCostCny = current.shippedQty > 0 ? round(current.baseCostTotalCny / current.shippedQty, 8) : current.baseUnitCostCny;
    current.id = `${shipmentId}:${key}`;
  }
  return [...grouped.values()];
}

function normalizeShipment(record) {
  const fields = JIANYUN_FORMS.shipments.fields;
  const id = recordId(record);
  const rawLines = subformRows(record, fields.shipmentLines).map((row, index) => normalizeShipmentLine(row, id, index));
  const lines = aggregateShipmentLines(rawLines, id);
  return {
    id,
    legacyOrderNo: readText(record, fields.legacyOrderNo),
    shipmentNo: readText(record, fields.shipmentBatchNo, readText(record, fields.legacyOrderNo, id)),
    stockupOrderRecordId: readText(record, fields.stockupOrderRecordId),
    demandRecordIds: readText(record, fields.demandRecordIds).split(/[,，\s]+/).filter(Boolean),
    project: readText(record, fields.project),
    carrier: readText(record, fields.carrier, readText(record, fields.firstMileCarrier)),
    trackingNo: readText(record, fields.firstMileTrackingNo),
    transportMode: readText(record, fields.transportMode),
    destinationCountry: readText(record, fields.destinationCountry),
    destinationWarehouseRecordId: readText(record, fields.destinationWarehouseRecordId),
    destinationWarehouseName: readText(record, fields.destinationWarehouseName, readText(record, fields.warehouse)),
    status: readText(record, fields.status),
    actualWeightKg: readNumber(record, fields.actualWeightKg, readNumber(record, fields.legacyTotalWeight)),
    chargeableWeightKg: readNumber(record, fields.chargeableWeightKg),
    actualVolumeM3: readNumber(record, fields.actualVolumeM3, readNumber(record, fields.legacyTotalVolume)),
    defaultAllocationMethod: normalizeAllocationMethod(readText(record, fields.defaultAllocationMethod)),
    feeConfirmationStatus: readText(record, fields.feeConfirmationStatus),
    costingStatus: readText(record, fields.costingStatus),
    currentCostVersion: readNumber(record, fields.currentCostVersion),
    dataVersion: readNumber(record, fields.dataVersion),
    wmsInboundNo: readText(record, fields.wmsInboundNo),
    shippedAt: readDate(record, fields.shippedAt),
    lines,
  };
}

function normalizeFeeAllocation(row) {
  const fields = JIANYUN_FORMS.shipmentFees.allocationFields;
  return {
    shipmentLineId: readText(row, fields.shipmentLineId),
    costBatchRecordId: readText(row, fields.costBatchRecordId),
    productRecordId: readText(row, fields.productRecordId),
    sku: readText(row, fields.sku),
    productName: readText(row, fields.productName),
    basis: readNumber(row, fields.basis),
    totalBasis: readNumber(row, fields.totalBasis),
    ratio: readNumber(row, fields.ratio),
    theoreticalAmount: readNumber(row, fields.theoreticalAmount),
    roundingAdjustment: readNumber(row, fields.roundingAdjustment),
    finalAmount: readNumber(row, fields.finalAmount),
    costingQty: readNumber(row, fields.costingQty),
    unitAllocationAmount: readNumber(row, fields.unitAllocationAmount),
    exceptionReason: readText(row, fields.exceptionReason),
  };
}

function normalizeShipmentFee(record) {
  const fields = JIANYUN_FORMS.shipmentFees.fields;
  const originalAmount = readNumber(record, fields.originalAmount);
  const exchangeRate = readNumber(record, fields.exchangeRate, 1);
  return {
    id: recordId(record),
    feeNo: readText(record, fields.serialNo, recordId(record)),
    shipmentRecordId: readText(record, fields.shipmentRecordId),
    shipmentNo: readText(record, fields.shipmentNo),
    feeStage: readText(record, fields.feeStage),
    feeType: readText(record, fields.feeType),
    feeName: readText(record, fields.feeName),
    vendor: readText(record, fields.vendor),
    invoiceNo: readText(record, fields.invoiceNo),
    occurredAt: readDate(record, fields.occurredAt),
    originalAmount,
    currency: readText(record, fields.currency, "CNY"),
    exchangeRate,
    amountCny: readNumber(record, fields.amountCny, round(originalAmount * exchangeRate, 2)),
    includedInLandedCost: truthyChoice(rawValue(record, fields.includedInLandedCost)),
    allocationMethod: normalizeAllocationMethod(readText(record, fields.allocationMethod)),
    allocationStatus: readText(record, fields.allocationStatus),
    costVersion: readNumber(record, fields.costVersion),
    dataSource: readText(record, fields.dataSource),
    description: readText(record, fields.description),
    allocations: subformRows(record, fields.allocations).map(normalizeFeeAllocation),
  };
}

function normalizeCostBatch(record) {
  const fields = JIANYUN_FORMS.shipmentCostBatches.fields;
  return {
    id: recordId(record),
    costBatchNo: readText(record, fields.serialNo, recordId(record)),
    uniqueKey: readText(record, fields.uniqueKey),
    costType: readText(record, fields.costType),
    version: readNumber(record, fields.version),
    formulaVersion: readText(record, fields.formulaVersion),
    shipmentRecordId: readText(record, fields.shipmentRecordId),
    shipmentNo: readText(record, fields.shipmentNo),
    shipmentLineId: readText(record, fields.shipmentLineId),
    productRecordId: readText(record, fields.productRecordId),
    temporaryProductNo: readText(record, fields.temporaryProductNo),
    sku: readText(record, fields.sku),
    productName: readText(record, fields.productName),
    costingQty: readNumber(record, fields.costingQty),
    baseCostTotalCny: readNumber(record, fields.baseCostTotalCny),
    includedFeeTotal: readNumber(record, fields.includedFeeTotal),
    excludedFeeTotal: readNumber(record, fields.excludedFeeTotal),
    actualCostTotalCny: readNumber(record, fields.actualCostTotalCny),
    unitLogisticsCostCny: readNumber(record, fields.unitLogisticsCostCny),
    landedUnitCostCny: readNumber(record, fields.landedUnitCostCny),
    status: readText(record, fields.status),
    isCurrent: truthyChoice(rawValue(record, fields.isCurrent), false),
    exceptionCode: readNumber(record, fields.exceptionCode),
    exceptionReason: readText(record, fields.exceptionReason),
    calculatedAt: readDate(record, fields.calculatedAt),
    lockedAt: readDate(record, fields.lockedAt),
  };
}

function normalizeCodingProduct(record) {
  const fields = JIANYUN_FORMS.productBase.fields;
  const temporaryProductNo = readText(record, fields.temporaryProductNo);
  const officialSku = readText(record, fields.officialSku, readText(record, fields.sku));
  const skuCodingStatus = readText(record, fields.skuCodingStatus);
  return {
    id: recordId(record),
    temporaryProductNo,
    officialSku,
    skuCodingStatus,
    archiveStatus: readText(record, fields.archiveStatus),
    productName: readText(record, fields.productName),
    sourceDemandRecordId: readText(record, fields.sourceDemandRecordId),
    sourceDemandBatchNo: readText(record, fields.sourceDemandBatchNo),
    codingAppliedAt: readDate(record, fields.codingAppliedAt),
    codingCompletedAt: readDate(record, fields.codingCompletedAt),
  };
}

async function safeFetch(name, form, warnings) {
  try {
    return await fetchJdyDataList(form);
  } catch (error) {
    warnings.push(`${name}读取失败：${error.message || String(error)}`);
    return [];
  }
}

export async function fetchStockupWorkflowRecords() {
  const warnings = [];
  const [demandRecords, orderRecords, lineRecords, shipmentRecords, feeRecords, costRecords, productRecords] = await Promise.all([
    safeFetch("备货需求", JIANYUN_FORMS.stockupDemands, warnings),
    safeFetch("备货单", JIANYUN_FORMS.stockupOrders, warnings),
    safeFetch("备货单明细", JIANYUN_FORMS.stockupOrderLines, warnings),
    safeFetch("发货单", JIANYUN_FORMS.shipments, warnings),
    safeFetch("发货费用", JIANYUN_FORMS.shipmentFees, warnings),
    safeFetch("成本批次", JIANYUN_FORMS.shipmentCostBatches, warnings),
    safeFetch("产品档案", JIANYUN_FORMS.productBase, warnings),
  ]);
  return { demandRecords, orderRecords, lineRecords, shipmentRecords, feeRecords, costRecords, productRecords, warnings };
}

export function buildStockupWorkflowPayload(records, source = "jiandaoyun") {
  const demands = (records.demandRecords || []).map(normalizeDemand);
  const orders = (records.orderRecords || []).map(normalizeStockupOrder);
  const orderLines = (records.lineRecords || []).map(normalizeStockupLine);
  const shipments = (records.shipmentRecords || []).map(normalizeShipment);
  const fees = (records.feeRecords || []).map(normalizeShipmentFee);
  const costBatches = (records.costRecords || []).map(normalizeCostBatch);
  const products = (records.productRecords || []).map(normalizeCodingProduct);
  const orderByNo = new Map(orders.filter((item) => item.orderNo).map((item) => [item.orderNo, item]));
  for (const line of orderLines) {
    if (!line.orderRecordId && line.legacyOrderNo) line.orderRecordId = orderByNo.get(line.legacyOrderNo)?.id || "";
  }
  for (const shipment of shipments) {
    if (!shipment.stockupOrderRecordId && shipment.legacyOrderNo) shipment.stockupOrderRecordId = orderByNo.get(shipment.legacyOrderNo)?.id || "";
  }
  const productBySku = new Map(products.filter((item) => item.officialSku).map((item) => [item.officialSku, item]));
  for (const shipment of shipments) {
    for (const line of shipment.lines) {
      if (line.productRecordId || !line.sku) continue;
      line.productRecordId = productBySku.get(line.sku)?.id || "";
    }
  }
  const productCodingQueue = products.filter((product) => (
    product.temporaryProductNo || (!product.officialSku && /待|编码|临时/.test(product.skuCodingStatus || product.archiveStatus))
  ) && !product.codingCompletedAt);

  for (const demand of demands) {
    if (demand.sku || /已完成|已取消|关闭/.test(demand.businessStatus)) continue;
    if (productCodingQueue.some((item) => item.sourceDemandRecordId === demand.id || item.temporaryProductNo === demand.temporaryProductNo)) continue;
    productCodingQueue.push({
      id: `demand:${demand.id}`,
      temporaryProductNo: demand.temporaryProductNo || `历史需求-${demand.id.slice(-8)}`,
      officialSku: "",
      skuCodingStatus: demand.skuCodingStatus || "待编码",
      archiveStatus: "",
      productName: demand.productName,
      sourceDemandRecordId: demand.id,
      sourceDemandBatchNo: demand.demandBatchNo,
      codingAppliedAt: demand.submittedAt,
      codingCompletedAt: "",
    });
  }

  const warnings = records.warnings || [];
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    warnings,
    counts: {
      demands: demands.length,
      pendingDemands: demands.filter((item) => !/已完成|已取消|关闭/.test(item.businessStatus)).length,
      stockupOrders: orders.length,
      stockupLines: orderLines.length,
      shipments: shipments.length,
      shipmentLines: shipments.reduce((sum, item) => sum + item.lines.length, 0),
      fees: fees.length,
      feeAmountCny: round(fees.reduce((sum, item) => sum + item.amountCny, 0), 2),
      costBatches: costBatches.length,
      lockedCostBatches: costBatches.filter((item) => /已锁定/.test(item.status)).length,
      codingQueue: productCodingQueue.length,
    },
    demands,
    stockupOrders: orders,
    stockupLines: orderLines,
    shipments,
    fees,
    costBatches,
    productCodingQueue,
    productOptions: products.filter((item) => item.officialSku).map((item) => ({ id: item.id, sku: item.officialSku, productName: item.productName })),
  };
}

export async function loadStockupWorkflow() {
  return buildStockupWorkflowPayload(await fetchStockupWorkflowRecords());
}

function allocationBasis(line, method) {
  if (method === "volume") return numberValue(line.totalVolumeM3);
  if (method === "quantity") return numberValue(line.shippedQty);
  if (method === "value") return numberValue(line.baseCostTotalCny, numberValue(line.baseUnitCostCny) * numberValue(line.shippedQty));
  return numberValue(line.totalWeightKg);
}

function moneyAllocation(totalAmount, bases) {
  const totalCents = Math.round(numberValue(totalAmount) * 100);
  const totalBasis = bases.reduce((sum, value) => sum + Math.max(0, numberValue(value)), 0);
  if (!totalBasis) return { totalBasis: 0, cents: bases.map(() => 0), theoretical: bases.map(() => 0) };

  const exact = bases.map((basis) => totalCents * Math.max(0, numberValue(basis)) / totalBasis);
  const cents = exact.map((value) => totalCents >= 0 ? Math.floor(value) : Math.ceil(value));
  let remaining = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const ranked = exact
    .map((value, index) => ({ index, fraction: Math.abs(value - cents[index]) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let cursor = 0;
  while (remaining !== 0 && ranked.length) {
    cents[ranked[cursor % ranked.length].index] += remaining > 0 ? 1 : -1;
    remaining += remaining > 0 ? -1 : 1;
    cursor += 1;
  }
  return { totalBasis, cents, theoretical: exact.map((value) => value / 100) };
}

function manualAllocation(totalAmount, lines, manualAllocations = {}) {
  const byLineId = manualAllocations && typeof manualAllocations === "object" ? manualAllocations : {};
  const cents = lines.map((line) => Math.round(numberValue(byLineId[line.id]) * 100));
  const totalCents = Math.round(numberValue(totalAmount) * 100);
  const difference = totalCents - cents.reduce((sum, value) => sum + value, 0);
  if (difference && cents.length) cents[cents.length - 1] += difference;
  return { totalBasis: totalCents / 100, cents, theoretical: cents.map((value) => value / 100) };
}

function costingQuantity(line, costType) {
  if (/正式/.test(costType)) return numberValue(line.receivedQty) > 0 ? numberValue(line.receivedQty) : numberValue(line.shippedQty);
  return numberValue(line.shippedQty);
}

function exceptionForLine(line, costType) {
  if (!line.sku) return { code: 101, reason: "缺少正式 SKU" };
  if (costingQuantity(line, costType) <= 0) return { code: 102, reason: "成本核算数量为 0" };
  return { code: 0, reason: "" };
}

export function calculateShipmentCosts({ shipment, fees = [], costType = "预估", version = 1, riskRate = 0 }) {
  if (!shipment?.id) throw new Error("请选择有效的发货单。");
  const lines = Array.isArray(shipment.lines) ? shipment.lines : [];
  if (!lines.length) throw new Error("发货单没有可计算的发货明细。");

  const normalizedRiskRate = Math.max(0, numberValue(riskRate));
  const feeResults = [];
  const errors = [];
  const bucketsByLine = new Map(lines.map((line) => [line.id, {
    domesticFreight: 0,
    firstMileFreight: 0,
    pickupFee: 0,
    customsTaxes: 0,
    insuranceFee: 0,
    warehouseFee: 0,
    laborPackagingFee: 0,
    inspectionFee: 0,
    otherFee: 0,
    includedFeeTotal: 0,
    excludedFeeTotal: 0,
  }]));

  for (const inputFee of fees) {
    const fee = {
      ...inputFee,
      id: inputFee.id || `draft-${feeResults.length + 1}`,
      originalAmount: numberValue(inputFee.originalAmount),
      exchangeRate: numberValue(inputFee.exchangeRate, 1),
      includedInLandedCost: inputFee.includedInLandedCost !== false,
      allocationMethod: normalizeAllocationMethod(inputFee.allocationMethod),
    };
    fee.amountCny = round(Number.isFinite(Number(inputFee.amountCny)) ? Number(inputFee.amountCny) : fee.originalAmount * fee.exchangeRate, 2);
    const bases = lines.map((line) => allocationBasis(line, fee.allocationMethod));
    const distributed = fee.allocationMethod === "manual"
      ? manualAllocation(fee.amountCny, lines, fee.manualAllocations)
      : moneyAllocation(fee.amountCny, bases);
    if (!distributed.totalBasis && fee.amountCny) {
      const basisName = ALLOCATION_METHOD_LABELS[fee.allocationMethod];
      errors.push(`${fee.feeType || "费用"}无法${basisName}：本单对应基数合计为 0。`);
    }
    const bucket = normalizeFeeBucket(fee.feeType);
    const allocations = lines.map((line, index) => {
      const finalAmount = distributed.cents[index] / 100;
      const costingQty = costingQuantity(line, costType);
      const theoreticalAmount = round(distributed.theoretical[index], 8);
      const basis = fee.allocationMethod === "manual" ? finalAmount : bases[index];
      const ratio = distributed.totalBasis ? basis / distributed.totalBasis : 0;
      const exceptionReason = !distributed.totalBasis && fee.amountCny ? "分摊基数合计为 0" : (!line.sku ? "缺少正式 SKU" : "");
      const target = bucketsByLine.get(line.id);
      if (fee.includedInLandedCost) {
        target[bucket] = round(target[bucket] + finalAmount, 2);
        target.includedFeeTotal = round(target.includedFeeTotal + finalAmount, 2);
      } else {
        target.excludedFeeTotal = round(target.excludedFeeTotal + finalAmount, 2);
      }
      return {
        shipmentLineId: line.id,
        productRecordId: line.productRecordId,
        sku: line.sku,
        productName: line.productName,
        basis: round(basis, 8),
        totalBasis: round(distributed.totalBasis, 8),
        ratio: round(ratio, 8),
        theoreticalAmount,
        roundingAdjustment: round(finalAmount - theoreticalAmount, 8),
        finalAmount: round(finalAmount, 2),
        costingQty,
        unitAllocationAmount: costingQty > 0 ? round(finalAmount / costingQty, 8) : 0,
        exceptionReason,
      };
    });
    feeResults.push({
      ...fee,
      allocationMethodLabel: ALLOCATION_METHOD_LABELS[fee.allocationMethod],
      bucket,
      allocations,
      allocationDifferenceCny: round(fee.amountCny - allocations.reduce((sum, item) => sum + item.finalAmount, 0), 2),
    });
  }

  const costBatches = lines.map((line) => {
    const bucket = bucketsByLine.get(line.id);
    const quantity = costingQuantity(line, costType);
    const baseUnitCostCny = numberValue(line.baseUnitCostCny);
    const baseCostTotalCny = round(baseUnitCostCny * quantity, 2);
    const actualCostTotalCny = round(baseCostTotalCny + bucket.includedFeeTotal, 2);
    const unitLogisticsCostCny = quantity > 0 ? round(bucket.includedFeeTotal / quantity, 8) : 0;
    const landedUnitCostCny = quantity > 0 ? round(actualCostTotalCny / quantity, 8) : 0;
    const exception = exceptionForLine(line, costType);
    if (exception.reason) errors.push(`${line.sku || line.temporaryProductNo || line.id}：${exception.reason}`);
    return {
      uniqueKey: `${shipment.id}:${line.id}:${costType}:${version}`,
      costType,
      version,
      formulaVersion: LANDED_COST_FORMULA_VERSION,
      shipmentRecordId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      shipmentLineId: line.id,
      stockupOrderRecordId: shipment.stockupOrderRecordId,
      stockupLineRecordId: line.stockupLineRecordId,
      demandRecordId: line.demandRecordId,
      productRecordId: line.productRecordId,
      temporaryProductNo: line.temporaryProductNo,
      sku: line.sku,
      productName: line.productName,
      project: shipment.project,
      destinationCountry: shipment.destinationCountry,
      destinationWarehouseRecordId: shipment.destinationWarehouseRecordId,
      destinationWarehouseName: shipment.destinationWarehouseName,
      shippedQty: numberValue(line.shippedQty),
      receivedQty: numberValue(line.receivedQty),
      damagedQty: numberValue(line.damagedQty),
      cancelledQty: 0,
      costingQty: quantity,
      totalWeightKg: numberValue(line.totalWeightKg),
      totalVolumeM3: numberValue(line.totalVolumeM3),
      goodsValueCny: baseCostTotalCny,
      baseCostSource: "发货明细",
      baseCurrency: "CNY",
      baseExchangeRate: 1,
      baseOriginalUnitCost: baseUnitCostCny,
      baseUnitCostCny,
      baseCostTotalCny,
      ...bucket,
      actualCostTotalCny,
      unitLogisticsCostCny,
      landedUnitCostCny,
      riskRate: normalizedRiskRate,
      landedUnitCostWithRiskCny: round(landedUnitCostCny * (1 + normalizedRiskRate), 8),
      status: exception.code || errors.some((message) => message.includes("基数合计为 0")) ? "计算异常" : "待确认",
      isCurrent: false,
      allocationDifferenceCny: round(feeResults.reduce((sum, fee) => sum + fee.allocationDifferenceCny, 0), 2),
      quantityDifference: round(numberValue(line.shippedQty) - numberValue(line.receivedQty) - numberValue(line.damagedQty), 4),
      exceptionCode: exception.code,
      exceptionReason: exception.reason,
    };
  });

  const uniqueErrors = [...new Set(errors)];
  return {
    ok: uniqueErrors.length === 0,
    formulaVersion: LANDED_COST_FORMULA_VERSION,
    shipment: { ...shipment, lines },
    costType,
    version,
    riskRate: normalizedRiskRate,
    totals: {
      baseCostCny: round(costBatches.reduce((sum, item) => sum + item.baseCostTotalCny, 0), 2),
      includedFeesCny: round(costBatches.reduce((sum, item) => sum + item.includedFeeTotal, 0), 2),
      excludedFeesCny: round(costBatches.reduce((sum, item) => sum + item.excludedFeeTotal, 0), 2),
      landedCostCny: round(costBatches.reduce((sum, item) => sum + item.actualCostTotalCny, 0), 2),
      allocationDifferenceCny: round(feeResults.reduce((sum, item) => sum + item.allocationDifferenceCny, 0), 2),
    },
    errors: uniqueErrors,
    feeResults,
    costBatches,
  };
}

export function shipmentFeeJdyData(input, previewFee) {
  const fields = JIANYUN_FORMS.shipmentFees.fields;
  const allocationFields = JIANYUN_FORMS.shipmentFees.allocationFields;
  const amountCny = round(numberValue(input.originalAmount) * numberValue(input.exchangeRate, 1), 2);
  return compactJdyData({
    [fields.shipmentRecordId]: jdyField(input.shipmentRecordId),
    [fields.shipmentNo]: jdyField(input.shipmentNo),
    [fields.feeStage]: jdyField(input.feeStage || "实际"),
    [fields.feeType]: jdyField(input.feeType),
    [fields.feeName]: jdyField(input.feeName || ""),
    [fields.vendor]: jdyField(input.vendor || ""),
    [fields.invoiceNo]: jdyField(input.invoiceNo || ""),
    [fields.occurredAt]: jdyField(input.occurredAt || new Date().toISOString()),
    [fields.originalAmount]: jdyField(numberValue(input.originalAmount)),
    [fields.currency]: jdyField(input.currency || "CNY"),
    [fields.exchangeRate]: jdyField(numberValue(input.exchangeRate, 1)),
    [fields.amountCny]: jdyField(amountCny),
    [fields.includedInLandedCost]: jdyField(input.includedInLandedCost === false ? "否" : "是"),
    [fields.allocationMethod]: jdyField(ALLOCATION_METHOD_LABELS[normalizeAllocationMethod(input.allocationMethod)]),
    [fields.allocationStatus]: jdyField(previewFee?.allocationDifferenceCny === 0 ? "已分摊" : "分摊异常"),
    [fields.costVersion]: jdyField(numberValue(input.costVersion, 0)),
    [fields.dataSource]: jdyField("中台录入"),
    [fields.description]: jdyField(input.description || ""),
    [fields.allocations]: jdyField((previewFee?.allocations || []).map((item) => compactJdyData({
      [allocationFields.shipmentLineId]: jdyField(item.shipmentLineId),
      [allocationFields.productRecordId]: jdyField(item.productRecordId || ""),
      [allocationFields.sku]: jdyField(item.sku || ""),
      [allocationFields.productName]: jdyField(item.productName || ""),
      [allocationFields.basis]: jdyField(item.basis),
      [allocationFields.totalBasis]: jdyField(item.totalBasis),
      [allocationFields.ratio]: jdyField(item.ratio),
      [allocationFields.theoreticalAmount]: jdyField(item.theoreticalAmount),
      [allocationFields.roundingAdjustment]: jdyField(item.roundingAdjustment),
      [allocationFields.finalAmount]: jdyField(item.finalAmount),
      [allocationFields.costingQty]: jdyField(item.costingQty),
      [allocationFields.unitAllocationAmount]: jdyField(item.unitAllocationAmount),
      [allocationFields.exceptionReason]: jdyField(item.exceptionReason || ""),
    }))),
  });
}

export function costBatchJdyData(item, note = "") {
  const fields = JIANYUN_FORMS.shipmentCostBatches.fields;
  const now = new Date().toISOString();
  const mapping = {
    uniqueKey: fields.uniqueKey,
    costType: fields.costType,
    version: fields.version,
    formulaVersion: fields.formulaVersion,
    shipmentRecordId: fields.shipmentRecordId,
    shipmentNo: fields.shipmentNo,
    shipmentLineId: fields.shipmentLineId,
    stockupOrderRecordId: fields.stockupOrderRecordId,
    stockupLineRecordId: fields.stockupLineRecordId,
    demandRecordId: fields.demandRecordId,
    productRecordId: fields.productRecordId,
    temporaryProductNo: fields.temporaryProductNo,
    sku: fields.sku,
    productName: fields.productName,
    project: fields.project,
    destinationCountry: fields.destinationCountry,
    destinationWarehouseRecordId: fields.destinationWarehouseRecordId,
    destinationWarehouseName: fields.destinationWarehouseName,
    shippedQty: fields.shippedQty,
    receivedQty: fields.receivedQty,
    damagedQty: fields.damagedQty,
    cancelledQty: fields.cancelledQty,
    costingQty: fields.costingQty,
    totalWeightKg: fields.totalWeightKg,
    totalVolumeM3: fields.totalVolumeM3,
    goodsValueCny: fields.goodsValueCny,
    baseCostSource: fields.baseCostSource,
    baseCurrency: fields.baseCurrency,
    baseExchangeRate: fields.baseExchangeRate,
    baseOriginalUnitCost: fields.baseOriginalUnitCost,
    baseUnitCostCny: fields.baseUnitCostCny,
    baseCostTotalCny: fields.baseCostTotalCny,
    domesticFreight: fields.domesticFreight,
    firstMileFreight: fields.firstMileFreight,
    pickupFee: fields.pickupFee,
    customsTaxes: fields.customsTaxes,
    insuranceFee: fields.insuranceFee,
    warehouseFee: fields.warehouseFee,
    laborPackagingFee: fields.laborPackagingFee,
    inspectionFee: fields.inspectionFee,
    otherFee: fields.otherFee,
    includedFeeTotal: fields.includedFeeTotal,
    excludedFeeTotal: fields.excludedFeeTotal,
    actualCostTotalCny: fields.actualCostTotalCny,
    unitLogisticsCostCny: fields.unitLogisticsCostCny,
    landedUnitCostCny: fields.landedUnitCostCny,
    riskRate: fields.riskRate,
    landedUnitCostWithRiskCny: fields.landedUnitCostWithRiskCny,
    status: fields.status,
    allocationDifferenceCny: fields.allocationDifferenceCny,
    quantityDifference: fields.quantityDifference,
    exceptionCode: fields.exceptionCode,
    exceptionReason: fields.exceptionReason,
  };
  return compactJdyData({
    ...Object.fromEntries(Object.entries(mapping).map(([key, fieldId]) => [fieldId, jdyField(item[key])])),
    [fields.isCurrent]: jdyField("否"),
    [fields.calculatedAt]: jdyField(now),
    [fields.note]: jdyField(note),
  });
}

export async function createShipmentFee(input, workflow) {
  const shipment = workflow.shipments.find((item) => item.id === input.shipmentRecordId);
  if (!shipment) throw new Error("未找到发货单，请刷新数据后重试。");
  if (!input.feeType) throw new Error("请选择费用类型。");
  if (numberValue(input.originalAmount) <= 0) throw new Error("原币金额必须大于 0。");
  if (numberValue(input.exchangeRate, 1) <= 0) throw new Error("汇率必须大于 0。");
  const preview = calculateShipmentCosts({ shipment, fees: [{ ...input, shipmentNo: shipment.shipmentNo }], costType: "预估", version: shipment.currentCostVersion + 1 });
  const previewFee = preview.feeResults[0];
  if (preview.errors.some((message) => message.includes("基数合计为 0"))) throw new Error(preview.errors.join("；"));
  const data = shipmentFeeJdyData({ ...input, shipmentNo: shipment.shipmentNo }, previewFee);
  if (input.dryRun) return { ok: true, dryRun: true, data, preview };
  const result = await createJdyData(JIANYUN_FORMS.shipmentFees, data);
  return {
    ok: true,
    dryRun: false,
    dataId: result?.data?._id || result?.data?.data_id || result?.data_id || result?._id || result?.id || "",
    preview,
  };
}

export async function persistShipmentCostBatches(input, workflow) {
  const shipment = workflow.shipments.find((item) => item.id === input.shipmentRecordId);
  if (!shipment) throw new Error("未找到发货单，请刷新数据后重试。");
  const shipmentFees = workflow.fees.filter((fee) => fee.shipmentRecordId === shipment.id && !/已作废/.test(fee.allocationStatus));
  if (!shipmentFees.length) throw new Error("该发货单还没有可用于成本计算的费用明细。");
  const previousVersions = workflow.costBatches.filter((item) => item.shipmentRecordId === shipment.id).map((item) => item.version);
  const version = Math.max(shipment.currentCostVersion || 0, ...previousVersions, 0) + 1;
  const preview = calculateShipmentCosts({
    shipment,
    fees: shipmentFees,
    costType: input.costType || "预估",
    version,
    riskRate: input.riskRate,
  });
  if (!preview.ok) throw new Error(`成本计算存在异常：${preview.errors.join("；")}`);
  const duplicateKeys = new Set(workflow.costBatches.map((item) => item.uniqueKey));
  const duplicate = preview.costBatches.find((item) => duplicateKeys.has(item.uniqueKey));
  if (duplicate) throw new Error(`成本批次已存在：${duplicate.uniqueKey}`);
  const records = preview.costBatches.map((item) => costBatchJdyData(item, input.note || "由中台计算生成，待确认后锁定。"));
  if (input.dryRun) return { ok: true, dryRun: true, version, records, preview };

  const created = [];
  for (let index = 0; index < records.length; index += 1) {
    const result = await createJdyData(JIANYUN_FORMS.shipmentCostBatches, records[index]);
    created.push({
      shipmentLineId: preview.costBatches[index].shipmentLineId,
      dataId: result?.data?._id || result?.data?.data_id || result?.data_id || result?._id || result?.id || "",
    });
  }

  const costBatchIdByLine = new Map(created.map((item) => [item.shipmentLineId, item.dataId]));
  const feeFields = JIANYUN_FORMS.shipmentFees.fields;
  const allocationFields = JIANYUN_FORMS.shipmentFees.allocationFields;
  for (const fee of preview.feeResults) {
    if (!fee.id) continue;
    const allocationRows = fee.allocations.map((item) => compactJdyData({
      [allocationFields.shipmentLineId]: jdyField(item.shipmentLineId),
      [allocationFields.costBatchRecordId]: jdyField(costBatchIdByLine.get(item.shipmentLineId) || ""),
      [allocationFields.productRecordId]: jdyField(item.productRecordId || ""),
      [allocationFields.sku]: jdyField(item.sku || ""),
      [allocationFields.productName]: jdyField(item.productName || ""),
      [allocationFields.basis]: jdyField(item.basis),
      [allocationFields.totalBasis]: jdyField(item.totalBasis),
      [allocationFields.ratio]: jdyField(item.ratio),
      [allocationFields.theoreticalAmount]: jdyField(item.theoreticalAmount),
      [allocationFields.roundingAdjustment]: jdyField(item.roundingAdjustment),
      [allocationFields.finalAmount]: jdyField(item.finalAmount),
      [allocationFields.costingQty]: jdyField(item.costingQty),
      [allocationFields.unitAllocationAmount]: jdyField(item.unitAllocationAmount),
      [allocationFields.exceptionReason]: jdyField(item.exceptionReason || ""),
    }));
    await updateJdyData(JIANYUN_FORMS.shipmentFees, fee.id, compactJdyData({
      [feeFields.allocations]: jdyField(allocationRows),
      [feeFields.allocationStatus]: jdyField("已分摊"),
      [feeFields.costVersion]: jdyField(version),
    }));
  }

  const shipmentFields = JIANYUN_FORMS.shipments.fields;
  await updateJdyData(JIANYUN_FORMS.shipments, shipment.id, {
    [shipmentFields.costingStatus]: jdyField("待确认"),
    [shipmentFields.currentCostVersion]: jdyField(version),
    [shipmentFields.lastSyncedAt]: jdyField(new Date().toISOString()),
    [shipmentFields.dataVersion]: jdyField(numberValue(shipment.dataVersion) + 1),
  });
  return { ok: true, dryRun: false, version, created, preview };
}

export async function lockShipmentCostVersion(input, workflow) {
  const shipment = workflow.shipments.find((item) => item.id === input.shipmentRecordId);
  if (!shipment) throw new Error("未找到发货单，请刷新数据后重试。");
  const version = numberValue(input.version);
  if (!Number.isInteger(version) || version <= 0) throw new Error("请选择有效的成本版本。");
  const targetBatches = workflow.costBatches.filter((item) => item.shipmentRecordId === shipment.id && item.version === version);
  if (!targetBatches.length) throw new Error("该版本没有可锁定的成本批次。");
  if (targetBatches.some((item) => item.exceptionCode || item.exceptionReason || /异常/.test(item.status))) {
    throw new Error("该版本仍存在成本异常，不能锁定。");
  }
  if (targetBatches.some((item) => !item.sku || item.costingQty <= 0)) {
    throw new Error("该版本存在缺少 SKU 或核算数量为 0 的记录，不能锁定。");
  }

  const now = new Date().toISOString();
  const costFields = JIANYUN_FORMS.shipmentCostBatches.fields;
  const feeFields = JIANYUN_FORMS.shipmentFees.fields;
  const shipmentFields = JIANYUN_FORMS.shipments.fields;
  const productFields = JIANYUN_FORMS.productBase.fields;
  const operations = {
    lockCostBatchIds: targetBatches.map((item) => item.id),
    supersedeCostBatchIds: workflow.costBatches
      .filter((item) => item.shipmentRecordId === shipment.id && item.version !== version && item.isCurrent)
      .map((item) => item.id),
    feeIds: workflow.fees.filter((item) => item.shipmentRecordId === shipment.id && !/已作废/.test(item.allocationStatus)).map((item) => item.id),
    productIds: targetBatches.map((item) => item.productRecordId).filter(Boolean),
  };
  if (input.dryRun) return { ok: true, dryRun: true, shipmentRecordId: shipment.id, version, operations };

  for (const batch of targetBatches) {
    await updateJdyData(JIANYUN_FORMS.shipmentCostBatches, batch.id, compactJdyData({
      [costFields.status]: jdyField("已锁定"),
      [costFields.isCurrent]: jdyField("是"),
      [costFields.confirmedAt]: jdyField(now),
      [costFields.lockedAt]: jdyField(now),
    }));
  }
  for (const oldBatchId of operations.supersedeCostBatchIds) {
    await updateJdyData(JIANYUN_FORMS.shipmentCostBatches, oldBatchId, compactJdyData({
      [costFields.isCurrent]: jdyField("否"),
    }));
  }
  for (const feeId of operations.feeIds) {
    await updateJdyData(JIANYUN_FORMS.shipmentFees, feeId, compactJdyData({
      [feeFields.allocationStatus]: jdyField("已锁定"),
      [feeFields.costVersion]: jdyField(version),
      [feeFields.lockedAt]: jdyField(now),
    }));
  }
  await updateJdyData(JIANYUN_FORMS.shipments, shipment.id, compactJdyData({
    [shipmentFields.feeConfirmationStatus]: jdyField("已确认"),
    [shipmentFields.costingStatus]: jdyField("已锁定"),
    [shipmentFields.currentCostVersion]: jdyField(version),
    [shipmentFields.costLockedAt]: jdyField(now),
    [shipmentFields.lastSyncedAt]: jdyField(now),
  }));
  for (const batch of targetBatches) {
    if (!batch.productRecordId) continue;
    await updateJdyData(JIANYUN_FORMS.productBase, batch.productRecordId, compactJdyData({
      [productFields.latestCostBatchId]: jdyField(batch.id),
      [productFields.latestLandedUnitCostCny]: jdyField(batch.landedUnitCostCny),
      [productFields.latestCostEffectiveAt]: jdyField(now),
    }));
  }
  return { ok: true, dryRun: false, shipmentRecordId: shipment.id, version, lockedCount: targetBatches.length };
}

export function stockupDemandJdyData(input) {
  const fields = JIANYUN_FORMS.stockupDemands.fields;
  const isNewProduct = input.productSourceType === "外采新品";
  const demandBatchNo = input.demandBatchNo || businessNo("XQ");
  const temporaryProductNo = isNewProduct ? (input.temporaryProductNo || businessNo("TMP")) : "";
  return {
    demandBatchNo,
    temporaryProductNo,
    data: compactJdyData({
      [fields.productName]: jdyField(input.productName),
      [fields.requestedQty]: jdyField(numberValue(input.requestedQty)),
      [fields.submittedAt]: jdyField(input.submittedAt || new Date().toISOString()),
      [fields.expectedArrivalAt]: jdyField(input.expectedArrivalAt || ""),
      [fields.destinationCountry]: jdyField(input.destinationCountry || ""),
      [fields.reason]: jdyField(input.reason || ""),
      [fields.demandBatchNo]: jdyField(demandBatchNo),
      [fields.demandLineNo]: jdyField(input.demandLineNo || "001"),
      [fields.productSourceType]: jdyField(input.productSourceType || "已有产品"),
      [fields.productRecordId]: jdyField(input.productRecordId || ""),
      [fields.temporaryProductNo]: jdyField(temporaryProductNo),
      [fields.skuCodingStatus]: jdyField(isNewProduct ? "待编码" : "已编码"),
      [fields.officialSku]: jdyField(input.sku || ""),
      [fields.project]: jdyField(input.project || ""),
      [fields.platform]: jdyField(input.platform || "SHOPEE"),
      [fields.destinationWarehouseRecordId]: jdyField(input.destinationWarehouseRecordId || ""),
      [fields.destinationWarehouseName]: jdyField(input.destinationWarehouseName || ""),
      [fields.stockupMethod]: jdyField(input.stockupMethod || (isNewProduct ? "外采成品" : "待判断")),
      [fields.demandSource]: jdyField(input.demandSource || "运营手工"),
      [fields.priority]: jdyField(input.priority || "普通"),
      [fields.businessStatus]: jdyField(isNewProduct ? "待编码" : "待受理"),
      [fields.plannedQty]: jdyField(0),
      [fields.shippedQty]: jdyField(0),
      [fields.receivedQty]: jdyField(0),
    }),
  };
}

export async function createStockupDemand(input) {
  if (!input.productName) throw new Error("请填写产品名称。");
  if (numberValue(input.requestedQty) <= 0) throw new Error("备货数量必须大于 0。");
  if (!input.destinationCountry && !input.destinationWarehouseName) throw new Error("请填写目的国或目的仓。");
  if (input.productSourceType !== "外采新品" && (!input.productRecordId || !input.sku)) {
    throw new Error("已有产品需求必须选择正式 SKU。");
  }
  const prepared = stockupDemandJdyData(input);
  if (input.dryRun) return { ok: true, dryRun: true, ...prepared };
  const result = await createJdyData(JIANYUN_FORMS.stockupDemands, prepared.data);
  const demandRecordId = createdDataId(result);
  let productRecordId = input.productRecordId || "";
  let warning = "";
  if (input.productSourceType === "外采新品") {
    const fields = JIANYUN_FORMS.productBase.fields;
    const productData = compactJdyData({
      [fields.productName]: jdyField(input.productName),
      [fields.unit]: jdyField(input.unit || "件"),
      [fields.project]: jdyField(input.project || ""),
      [fields.temporaryProductNo]: jdyField(prepared.temporaryProductNo),
      [fields.archiveStatus]: jdyField("临时档案"),
      [fields.skuCodingStatus]: jdyField("待编码"),
      [fields.sourceDemandRecordId]: jdyField(demandRecordId),
      [fields.sourceDemandBatchNo]: jdyField(prepared.demandBatchNo),
      [fields.codingAppliedAt]: jdyField(new Date().toISOString()),
      [fields.duplicateCheckKey]: jdyField(`${input.productName}|${input.specification || ""}`.toLowerCase()),
    });
    try {
      productRecordId = createdDataId(await createJdyData(JIANYUN_FORMS.productBase, productData));
      if (productRecordId) {
        const demandFields = JIANYUN_FORMS.stockupDemands.fields;
        await updateJdyData(JIANYUN_FORMS.stockupDemands, demandRecordId, {
          [demandFields.productRecordId]: jdyField(productRecordId),
        });
      }
    } catch (error) {
      warning = `需求已创建，但临时产品档案创建失败：${error.message || String(error)}。编码队列仍会根据需求显示。`;
    }
  }
  return { ok: true, dryRun: false, demandRecordId, productRecordId, demandBatchNo: prepared.demandBatchNo, temporaryProductNo: prepared.temporaryProductNo, warning };
}

export function stockupExecutionJdyData(input, demand) {
  const orderFields = JIANYUN_FORMS.stockupOrders.fields;
  const lineFields = JIANYUN_FORMS.stockupOrderLines.fields;
  const orderNo = input.orderNo || businessNo("BHD");
  const plannedQty = numberValue(input.plannedQty, demand.requestedQty - demand.plannedQty);
  const now = new Date().toISOString();
  return {
    orderNo,
    plannedQty,
    orderData: compactJdyData({
      [orderFields.stockupDate]: jdyField(now),
      [orderFields.orderNo]: jdyField(orderNo),
      [orderFields.project]: jdyField(demand.project || ""),
      [orderFields.status]: jdyField("执行中"),
      [orderFields.demandBatchNo]: jdyField(demand.demandBatchNo || ""),
      [orderFields.demandRecordIds]: jdyField(demand.id),
      [orderFields.executionMode]: jdyField(input.executionMode || demand.stockupMethod || "外采成品"),
      [orderFields.destinationCountry]: jdyField(demand.destinationCountry || ""),
      [orderFields.destinationWarehouseRecordId]: jdyField(demand.destinationWarehouseRecordId || ""),
      [orderFields.destinationWarehouseName]: jdyField(demand.destinationWarehouseName || ""),
      [orderFields.plannedQtyTotal]: jdyField(plannedQty),
      [orderFields.orderedQtyTotal]: jdyField(0),
      [orderFields.completedQtyTotal]: jdyField(0),
      [orderFields.shippedQtyTotal]: jdyField(0),
      [orderFields.receivedQtyTotal]: jdyField(0),
      [orderFields.expectedCompletedAt]: jdyField(input.expectedCompletedAt || ""),
      [orderFields.dataVersion]: jdyField(1),
      [orderFields.lastSyncedAt]: jdyField(now),
    }),
    lineData: compactJdyData({
      [lineFields.legacyOrderNo]: jdyField(orderNo),
      [lineFields.stockupDate]: jdyField(now),
      [lineFields.legacySku]: jdyField(demand.sku || demand.temporaryProductNo || ""),
      [lineFields.productName]: jdyField(demand.productName || ""),
      [lineFields.legacyPlannedQty]: jdyField(plannedQty),
      [lineFields.legacyUnitCost]: jdyField(numberValue(input.baseUnitCost)),
      [lineFields.legacyCostTotal]: jdyField(round(numberValue(input.baseUnitCost) * plannedQty, 2)),
      [lineFields.demandRecordId]: jdyField(demand.id),
      [lineFields.productRecordId]: jdyField(demand.productRecordId || ""),
      [lineFields.temporaryProductNo]: jdyField(demand.temporaryProductNo || ""),
      [lineFields.officialSku]: jdyField(demand.sku || ""),
      [lineFields.supplyMode]: jdyField(input.supplyMode || input.executionMode || "外采成品"),
      [lineFields.plannedQty]: jdyField(plannedQty),
      [lineFields.orderedQty]: jdyField(0),
      [lineFields.completedQty]: jdyField(0),
      [lineFields.qualifiedQty]: jdyField(0),
      [lineFields.shippedQty]: jdyField(0),
      [lineFields.receivedQty]: jdyField(0),
      [lineFields.cancelledQty]: jdyField(0),
      [lineFields.baseCurrency]: jdyField(input.baseCurrency || "CNY"),
      [lineFields.baseExchangeRate]: jdyField(numberValue(input.baseExchangeRate, 1)),
      [lineFields.actualBaseUnitCost]: jdyField(numberValue(input.baseUnitCost)),
      [lineFields.expectedReadyAt]: jdyField(input.expectedCompletedAt || ""),
      [lineFields.status]: jdyField("待下单"),
    }),
  };
}

export async function createStockupExecution(input, workflow) {
  const demand = workflow.demands.find((item) => item.id === input.demandRecordId);
  if (!demand) throw new Error("未找到备货需求，请刷新后重试。");
  const prepared = stockupExecutionJdyData(input, demand);
  if (prepared.plannedQty <= 0) throw new Error("计划数量必须大于 0。");
  const remainingQty = Math.max(0, demand.requestedQty - demand.plannedQty);
  if (prepared.plannedQty > remainingQty + 0.0001) throw new Error(`计划数量不能超过需求剩余数量 ${remainingQty}。`);
  if (input.dryRun) return { ok: true, dryRun: true, ...prepared };
  const orderRecordId = createdDataId(await createJdyData(JIANYUN_FORMS.stockupOrders, prepared.orderData));
  const lineFields = JIANYUN_FORMS.stockupOrderLines.fields;
  const lineData = { ...prepared.lineData, [lineFields.orderRecordId]: jdyField(orderRecordId) };
  const lineRecordId = createdDataId(await createJdyData(JIANYUN_FORMS.stockupOrderLines, lineData));
  const demandFields = JIANYUN_FORMS.stockupDemands.fields;
  await updateJdyData(JIANYUN_FORMS.stockupDemands, demand.id, {
    [demandFields.plannedQty]: jdyField(round(demand.plannedQty + prepared.plannedQty, 4)),
    [demandFields.businessStatus]: jdyField("已转执行"),
  });
  return { ok: true, dryRun: false, orderNo: prepared.orderNo, orderRecordId, lineRecordId };
}

export async function updateStockupExecutionLine(input, workflow) {
  const line = workflow.stockupLines.find((item) => item.id === input.stockupLineRecordId);
  if (!line) throw new Error("未找到备货 SKU 明细，请刷新后重试。");
  const order = workflow.stockupOrders.find((item) => item.id === line.orderRecordId);
  if (!order) throw new Error("未找到该明细所属的备货执行单。");

  const orderedQty = numberValue(input.orderedQty, line.orderedQty);
  const completedQty = numberValue(input.completedQty, line.completedQty);
  const qualifiedQty = numberValue(input.qualifiedQty, line.qualifiedQty);
  const actualBaseUnitCost = numberValue(input.actualBaseUnitCost, line.actualBaseUnitCost);
  if ([orderedQty, completedQty, qualifiedQty, actualBaseUnitCost].some((value) => value < 0)) {
    throw new Error("下单、完工、合格数量和基础成本不能小于 0。");
  }
  if (completedQty > orderedQty + 0.0001 && orderedQty > 0) throw new Error("完工数量不能大于下单数量。");
  if (qualifiedQty > completedQty + 0.0001) throw new Error("合格数量不能大于完工数量。");
  if (qualifiedQty + 0.0001 < line.shippedQty) throw new Error(`合格数量不能小于已发数量 ${line.shippedQty}。`);

  const inferredStatus = qualifiedQty >= line.plannedQty && line.plannedQty > 0
    ? "已备妥"
    : qualifiedQty > 0
      ? "部分合格"
      : completedQty > 0
        ? "部分完工"
        : orderedQty > 0
          ? "已下单"
          : "待下单";
  const status = textValue(input.status, inferredStatus);
  const actualReadyAt = textValue(input.actualReadyAt, qualifiedQty > 0 ? new Date().toISOString() : line.actualReadyAt || "");
  const lineFields = JIANYUN_FORMS.stockupOrderLines.fields;
  const lineData = compactJdyData({
    [lineFields.orderedQty]: jdyField(orderedQty),
    [lineFields.completedQty]: jdyField(completedQty),
    [lineFields.qualifiedQty]: jdyField(qualifiedQty),
    [lineFields.actualBaseUnitCost]: jdyField(actualBaseUnitCost),
    [lineFields.actualReadyAt]: jdyField(actualReadyAt),
    [lineFields.status]: jdyField(status),
    [lineFields.exceptionReason]: jdyField(input.exceptionReason || ""),
  });

  const patchedLines = workflow.stockupLines
    .filter((item) => item.orderRecordId === order.id)
    .map((item) => item.id === line.id ? { ...item, orderedQty, completedQty, qualifiedQty, actualBaseUnitCost, status } : item);
  const totals = patchedLines.reduce((result, item) => ({
    orderedQty: result.orderedQty + item.orderedQty,
    completedQty: result.completedQty + item.completedQty,
    shippedQty: result.shippedQty + item.shippedQty,
    receivedQty: result.receivedQty + item.receivedQty,
    allReady: result.allReady && item.plannedQty > 0 && item.qualifiedQty >= item.plannedQty,
  }), { orderedQty: 0, completedQty: 0, shippedQty: 0, receivedQty: 0, allReady: true });
  const orderStatus = totals.receivedQty > 0
    ? "到仓中"
    : totals.shippedQty > 0
      ? "已发货"
      : totals.allReady
        ? "已备妥"
        : totals.orderedQty > 0 || totals.completedQty > 0
          ? "执行中"
          : "待执行";
  const orderFields = JIANYUN_FORMS.stockupOrders.fields;
  const orderData = compactJdyData({
    [orderFields.orderedQtyTotal]: jdyField(round(totals.orderedQty, 4)),
    [orderFields.completedQtyTotal]: jdyField(round(totals.completedQty, 4)),
    [orderFields.shippedQtyTotal]: jdyField(round(totals.shippedQty, 4)),
    [orderFields.receivedQtyTotal]: jdyField(round(totals.receivedQty, 4)),
    [orderFields.status]: jdyField(orderStatus),
    [orderFields.actualCompletedAt]: jdyField(totals.allReady ? new Date().toISOString() : order.actualCompletedAt || ""),
    [orderFields.dataVersion]: jdyField(numberValue(order.dataVersion) + 1),
    [orderFields.lastSyncedAt]: jdyField(new Date().toISOString()),
  });

  if (input.dryRun) return { ok: true, dryRun: true, lineData, orderData, status, orderStatus, totals };
  await updateJdyData(JIANYUN_FORMS.stockupOrderLines, line.id, lineData);
  await updateJdyData(JIANYUN_FORMS.stockupOrders, order.id, orderData);
  return { ok: true, dryRun: false, stockupLineRecordId: line.id, stockupOrderRecordId: order.id, status, orderStatus, totals };
}

export function workflowShipmentJdyData(input, workflow) {
  const order = workflow.stockupOrders.find((item) => item.id === input.stockupOrderRecordId);
  if (!order) throw new Error("未找到备货执行单，请刷新后重试。");
  const requestedLines = Array.isArray(input.lines) ? input.lines : [];
  const orderLines = new Map(workflow.stockupLines.filter((item) => item.orderRecordId === order.id).map((item) => [item.id, item]));
  const lineFields = JIANYUN_FORMS.shipments.lineFields;
  const normalizedLines = requestedLines.map((item) => {
    const source = orderLines.get(item.stockupLineRecordId);
    if (!source) throw new Error("发货明细不属于所选备货单。");
    const shippedQty = numberValue(item.shippedQty);
    if (shippedQty <= 0) throw new Error(`${source.sku || source.temporaryProductNo || source.productName} 的发货数量必须大于 0。`);
    const availableQty = Math.max(0, source.qualifiedQty - source.shippedQty);
    if (shippedQty > availableQty + 0.0001) throw new Error(`${source.sku || source.temporaryProductNo || source.productName} 的发货数量不能超过合格可发数量 ${availableQty}。`);
    const lineId = businessNo("FHMX");
    const baseUnitCostCny = numberValue(item.baseUnitCostCny, source.actualBaseUnitCost * source.baseExchangeRate);
    const row = compactJdyData({
      [lineFields.sku]: jdyField(source.sku || source.temporaryProductNo || ""),
      [lineFields.productName]: jdyField(source.productName || ""),
      [lineFields.boxPackQty]: jdyField(shippedQty),
      [lineFields.boxWeightKg]: jdyField(numberValue(item.totalWeightKg)),
      [lineFields.unitCost]: jdyField(baseUnitCostCny),
      [lineFields.volumeM3]: jdyField(numberValue(item.totalVolumeM3)),
      [lineFields.shipmentLineId]: jdyField(lineId),
      [lineFields.stockupLineRecordId]: jdyField(source.id),
      [lineFields.demandRecordId]: jdyField(source.demandRecordId || ""),
      [lineFields.productRecordId]: jdyField(source.productRecordId || ""),
      [lineFields.temporaryProductNo]: jdyField(source.temporaryProductNo || ""),
      [lineFields.shippedQty]: jdyField(shippedQty),
      [lineFields.totalWeightKg]: jdyField(numberValue(item.totalWeightKg)),
      [lineFields.totalVolumeM3]: jdyField(numberValue(item.totalVolumeM3)),
      [lineFields.baseUnitCostCny]: jdyField(baseUnitCostCny),
      [lineFields.baseCostTotalCny]: jdyField(round(baseUnitCostCny * shippedQty, 2)),
      [lineFields.receivedQty]: jdyField(0),
      [lineFields.damagedQty]: jdyField(0),
      [lineFields.receiptWriteoffStatus]: jdyField("待到仓"),
    });
    return { source, shippedQty, totalWeightKg: numberValue(item.totalWeightKg), totalVolumeM3: numberValue(item.totalVolumeM3), row };
  });
  if (!normalizedLines.length) throw new Error("请至少选择一条发货明细。");
  const fields = JIANYUN_FORMS.shipments.fields;
  const now = new Date().toISOString();
  return {
    order,
    normalizedLines,
    data: compactJdyData({
      [fields.legacyOrderNo]: jdyField(order.orderNo || ""),
      [fields.stockupDate]: jdyField(now),
      [fields.project]: jdyField(order.project || ""),
      [fields.warehouse]: jdyField(input.destinationWarehouseName || order.destinationWarehouseName || ""),
      [fields.firstMileCarrier]: jdyField(input.carrier || ""),
      [fields.firstMileTrackingNo]: jdyField(input.trackingNo || ""),
      [fields.shippedAt]: jdyField(input.shippedAt || now),
      [fields.legacyTotalWeight]: jdyField(round(normalizedLines.reduce((sum, item) => sum + item.totalWeightKg, 0), 8)),
      [fields.legacyTotalVolume]: jdyField(round(normalizedLines.reduce((sum, item) => sum + item.totalVolumeM3, 0), 8)),
      [fields.shipmentLines]: jdyField(normalizedLines.map((item) => item.row)),
      [fields.stockupOrderRecordId]: jdyField(order.id),
      [fields.demandRecordIds]: jdyField([...new Set(normalizedLines.map((item) => item.source.demandRecordId).filter(Boolean))].join(",")),
      [fields.carrier]: jdyField(input.carrier || ""),
      [fields.transportMode]: jdyField(input.transportMode || "海运"),
      [fields.destinationCountry]: jdyField(order.destinationCountry || ""),
      [fields.destinationWarehouseRecordId]: jdyField(order.destinationWarehouseRecordId || ""),
      [fields.destinationWarehouseName]: jdyField(input.destinationWarehouseName || order.destinationWarehouseName || ""),
      [fields.status]: jdyField("已发货"),
      [fields.actualWeightKg]: jdyField(round(normalizedLines.reduce((sum, item) => sum + item.totalWeightKg, 0), 8)),
      [fields.actualVolumeM3]: jdyField(round(normalizedLines.reduce((sum, item) => sum + item.totalVolumeM3, 0), 8)),
      [fields.defaultAllocationMethod]: jdyField(ALLOCATION_METHOD_LABELS[normalizeAllocationMethod(input.defaultAllocationMethod)]),
      [fields.feeConfirmationStatus]: jdyField("待录入"),
      [fields.costingStatus]: jdyField("待计算"),
      [fields.currentCostVersion]: jdyField(0),
      [fields.dataVersion]: jdyField(1),
      [fields.lastSyncedAt]: jdyField(now),
    }),
  };
}

export async function createWorkflowShipment(input, workflow) {
  const prepared = workflowShipmentJdyData(input, workflow);
  if (prepared.normalizedLines.some((item) => item.totalWeightKg <= 0 && item.totalVolumeM3 <= 0)) {
    throw new Error("每条发货明细至少要填写总重量或总体积，才能进行后续费用分摊。");
  }
  if (input.dryRun) return { ok: true, dryRun: true, data: prepared.data };
  const shipmentRecordId = createdDataId(await createJdyData(JIANYUN_FORMS.shipments, prepared.data));
  const lineFields = JIANYUN_FORMS.stockupOrderLines.fields;
  for (const item of prepared.normalizedLines) {
    await updateJdyData(JIANYUN_FORMS.stockupOrderLines, item.source.id, {
      [lineFields.shippedQty]: jdyField(round(item.source.shippedQty + item.shippedQty, 4)),
      [lineFields.status]: jdyField("已发货"),
    });
  }
  const orderFields = JIANYUN_FORMS.stockupOrders.fields;
  const shippedTotal = round(prepared.order.shippedQty + prepared.normalizedLines.reduce((sum, item) => sum + item.shippedQty, 0), 4);
  await updateJdyData(JIANYUN_FORMS.stockupOrders, prepared.order.id, {
    [orderFields.shippedQtyTotal]: jdyField(shippedTotal),
    [orderFields.status]: jdyField("已发货"),
    [orderFields.shippedAt]: jdyField(input.shippedAt || new Date().toISOString()),
    [orderFields.lastSyncedAt]: jdyField(new Date().toISOString()),
  });
  const shippedByDemand = new Map();
  for (const item of prepared.normalizedLines) {
    if (!item.source.demandRecordId) continue;
    shippedByDemand.set(item.source.demandRecordId, round((shippedByDemand.get(item.source.demandRecordId) || 0) + item.shippedQty, 4));
  }
  const demandFields = JIANYUN_FORMS.stockupDemands.fields;
  for (const [demandRecordId, shippedQty] of shippedByDemand) {
    const demand = workflow.demands.find((item) => item.id === demandRecordId);
    if (!demand) continue;
    const nextShippedQty = round(demand.shippedQty + shippedQty, 4);
    await updateJdyData(JIANYUN_FORMS.stockupDemands, demand.id, {
      [demandFields.shippedQty]: jdyField(nextShippedQty),
      [demandFields.businessStatus]: jdyField(nextShippedQty >= demand.requestedQty ? "已发货" : "部分发货"),
    });
  }
  return { ok: true, dryRun: false, shipmentRecordId, lineCount: prepared.normalizedLines.length };
}

export async function completeProductCoding(input, workflow) {
  const product = workflow.productCodingQueue.find((item) => item.id === input.productRecordId);
  if (!product) throw new Error("未找到待编码新品，请刷新后重试。");
  const sku = textValue(input.sku).toUpperCase();
  if (!sku) throw new Error("请输入正式 SKU。");
  const duplicate = workflow.productOptions?.find((item) => item.sku.toUpperCase() === sku && item.id !== product.id);
  if (duplicate) throw new Error(`SKU ${sku} 已被 ${duplicate.productName || duplicate.id} 使用。`);
  const productFields = JIANYUN_FORMS.productBase.fields;
  const sourceDemand = workflow.demands.find((item) => item.id === product.sourceDemandRecordId || `demand:${item.id}` === product.id);
  const temporaryProductNo = product.temporaryProductNo && !product.temporaryProductNo.startsWith("历史需求-") ? product.temporaryProductNo : businessNo("TMP");
  const productData = compactJdyData({
    [productFields.sku]: jdyField(sku),
    [productFields.officialSku]: jdyField(sku),
    [productFields.productName]: jdyField(product.productName || sourceDemand?.productName || ""),
    [productFields.unit]: jdyField("件"),
    [productFields.project]: jdyField(sourceDemand?.project || ""),
    [productFields.temporaryProductNo]: jdyField(temporaryProductNo),
    [productFields.skuCodingStatus]: jdyField("已编码"),
    [productFields.archiveStatus]: jdyField("正式档案"),
    [productFields.sourceDemandRecordId]: jdyField(sourceDemand?.id || product.sourceDemandRecordId || ""),
    [productFields.sourceDemandBatchNo]: jdyField(sourceDemand?.demandBatchNo || product.sourceDemandBatchNo || ""),
    [productFields.codingAppliedAt]: jdyField(product.codingAppliedAt || new Date().toISOString()),
    [productFields.codingCompletedAt]: jdyField(new Date().toISOString()),
  });
  const demandFields = JIANYUN_FORMS.stockupDemands.fields;
  const demandData = compactJdyData({
    [demandFields.productRecordId]: jdyField(product.id.startsWith("demand:") ? "" : product.id),
    [demandFields.temporaryProductNo]: jdyField(temporaryProductNo),
    [demandFields.officialSku]: jdyField(sku),
    [demandFields.skuCodingStatus]: jdyField("已编码"),
    [demandFields.businessStatus]: jdyField("待受理"),
  });
  if (input.dryRun) return { ok: true, dryRun: true, productData, demandData };
  let productRecordId = product.id;
  if (product.id.startsWith("demand:")) {
    productRecordId = createdDataId(await createJdyData(JIANYUN_FORMS.productBase, productData));
    demandData[demandFields.productRecordId] = jdyField(productRecordId);
  } else {
    await updateJdyData(JIANYUN_FORMS.productBase, product.id, productData);
  }
  const demandRecordId = sourceDemand?.id || product.sourceDemandRecordId;
  if (demandRecordId) await updateJdyData(JIANYUN_FORMS.stockupDemands, demandRecordId, demandData);
  return { ok: true, dryRun: false, productRecordId, demandRecordId, sku };
}

import { JIANYUN_FORMS } from "./field-mapping.js";
import { buildSupplierRedactionEntries, redactSupplierText, supplierAlias } from "./supplier-privacy.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(",");
  if (typeof value === "object") return text(value.name || value.value || value.title, fallback);
  return String(value).trim() || fallback;
}

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}

function recordDate(record, keys) {
  for (const key of keys) {
    const value = normalizeDate(record?.[key]);
    if (value) return value;
  }
  return "";
}

export function normalizeOutsourcingOrderRecords(records) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  return records
    .map((record) => {
      const tongzhouSku = text(valueOf(record, fields.tongzhouSku));
      const productSku = text(valueOf(record, fields.productSku));
      const plannedQty = number(valueOf(record, fields.plannedQty));
      const producedQty = number(valueOf(record, fields.producedQty));
      const directInProductionQty = number(valueOf(record, fields.inProductionQty), plannedQty);
      const status = text(valueOf(record, fields.status), "未配置");
      const isInProduction = /进行中|生产中|加工中|排产中/.test(status);
      const productionRegion = text(valueOf(record, fields.productionRegion));
      const productionType = text(valueOf(record, fields.productionType));
      const maskedSupplier = supplierAlias(
        valueOf(record, fields.factoryId),
        valueOf(record, fields.factoryFullName) || valueOf(record, fields.supplier),
      );

      return {
        id: record.data_id || record._id || record.id || `${tongzhouSku || productSku}-${text(valueOf(record, fields.orderNo))}`,
        tongzhouSku,
        productSku,
        orderNo: text(valueOf(record, fields.orderNo)),
        productName: text(valueOf(record, fields.productName)),
        supplier: maskedSupplier,
        supplierAlias: maskedSupplier,
        status,
        isInProduction,
        productionRegion,
        productionType,
        isDomesticCustomization: /国内/.test(productionRegion) && /定制/.test(productionType),
        deliveryStatus: text(valueOf(record, fields.deliveryStatus)),
        progressSummary: text(valueOf(record, fields.progressSummary)),
        unit: text(valueOf(record, fields.unit), "件"),
        plannedQty,
        producedQty,
        inProductionQty: isInProduction ? Math.max(0, directInProductionQty) : 0,
        createdAt: normalizeDate(valueOf(record, fields.createdAt)) || recordDate(record, ["createTime", "create_time", "createdAt", "created_at"]),
        updatedAt: recordDate(record, ["updateTime", "update_time", "updatedAt", "updated_at"]),
        expectedFinishedAt: normalizeDate(valueOf(record, fields.expectedFinishedAt)),
        packagingExpectedAt: normalizeDate(valueOf(record, fields.packagingExpectedAt)),
        factoryExpectedFinishedAt: normalizeDate(valueOf(record, fields.factoryExpectedFinishedAt)),
        actualMaterialReadyAt: normalizeDate(valueOf(record, fields.actualMaterialReadyAt)),
        finishedShippedAt: normalizeDate(valueOf(record, fields.finishedShippedAt)),
        inboundCompletedAt: normalizeDate(valueOf(record, fields.inboundCompletedAt)),
        lastFollowedAt: normalizeDate(valueOf(record, fields.lastFollowedAt)),
        materialReady: text(valueOf(record, fields.materialReady)),
        filingPassed: text(valueOf(record, fields.filingPassed)),
        testingPassed: text(valueOf(record, fields.testingPassed)),
        innerPackTest: text(valueOf(record, fields.innerPackTest)),
        outerPackTest: text(valueOf(record, fields.outerPackTest)),
        preProductionSampleConfirmed: text(valueOf(record, fields.preProductionSampleConfirmed)),
        remark: text(valueOf(record, fields.remark)),
      };
    });
}

function sanitizeCachedOrder(order, materialProgressByOrderNo = {}) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  const detailFields = JIANYUN_FORMS.outsourcingOrders.detailFields;
  const raw = order?.raw;
  const currentSupplier = text(order?.supplierAlias || order?.supplier);
  const maskedSupplier = /^供应商\s+[A-Z0-9]{4}$/.test(currentSupplier)
    ? currentSupplier
    : supplierAlias(
      valueOf(raw, fields.factoryId),
      valueOf(raw, fields.factoryFullName) || valueOf(raw, fields.supplier) || currentSupplier,
    );
  const { raw: _discardedRaw, ...safeOrder } = order || {};
  const rawDetails = valueOf(raw, fields.details);
  const cachedRedactionEntries = raw ? buildSupplierRedactionEntries([
    { id: valueOf(raw, fields.factoryId), name: valueOf(raw, fields.factoryFullName) || valueOf(raw, fields.supplier) },
    ...(Array.isArray(rawDetails) ? rawDetails.map((detail) => ({
      id: valueOf(detail, detailFields.supplierId),
      name: valueOf(detail, detailFields.supplier),
    })) : []),
  ], [safeOrder.deliveryStatus, safeOrder.progressSummary, safeOrder.remark]) : [];
  return {
    ...safeOrder,
    supplier: maskedSupplier,
    supplierAlias: maskedSupplier,
    deliveryStatus: redactSupplierText(safeOrder.deliveryStatus, cachedRedactionEntries),
    progressSummary: redactSupplierText(safeOrder.progressSummary, cachedRedactionEntries),
    remark: redactSupplierText(safeOrder.remark, cachedRedactionEntries),
    ...(materialProgressByOrderNo[safeOrder.orderNo]
      ? { materialProgress: materialProgressByOrderNo[safeOrder.orderNo] }
      : safeOrder.materialProgress ? { materialProgress: safeOrder.materialProgress } : {}),
  };
}

export function attachProductionMaterialProgress(payload, materialPayload = {}) {
  const materialProgressByOrderNo = materialPayload?.byOrderNo || {};
  const orders = (payload?.orders || []).map((order) => sanitizeCachedOrder(order, materialProgressByOrderNo));
  const domesticCustomizationOrders = (payload?.domesticCustomizationOrders || [])
    .map((order) => sanitizeCachedOrder(order, materialProgressByOrderNo));
  const uniqueProductionOrders = new Map();
  for (const order of [...orders, ...domesticCustomizationOrders]) {
    if (order.isInProduction && order.orderNo) uniqueProductionOrders.set(order.orderNo, order);
  }
  const materialProgresses = [...uniqueProductionOrders.values()]
    .map((order) => order.materialProgress)
    .filter(Boolean);
  return {
    ...payload,
    counts: {
      ...(payload?.counts || {}),
      materialReadyOrders: materialProgresses.filter((item) => item.status === "ready").length,
      materialPartialOrders: materialProgresses.filter((item) => item.status === "partial").length,
      materialPendingOrders: materialProgresses.filter((item) => item.status === "pending").length,
      materialReviewOrders: materialProgresses.filter((item) => item.status === "review").length,
    },
    materialSyncedAt: materialPayload?.syncedAt || payload?.materialSyncedAt || "",
    orders,
    domesticCustomizationOrders,
  };
}

export function redactOutsourcingSupplierMentions(payload, redactionEntries = []) {
  const sanitizeOrder = (order) => ({
    ...order,
    deliveryStatus: redactSupplierText(order.deliveryStatus, redactionEntries),
    progressSummary: redactSupplierText(order.progressSummary, redactionEntries),
    remark: redactSupplierText(order.remark, redactionEntries),
  });
  return {
    ...payload,
    orders: (payload?.orders || []).map(sanitizeOrder),
    domesticCustomizationOrders: (payload?.domesticCustomizationOrders || []).map(sanitizeOrder),
  };
}

export function normalizeOutsourcingOrders(records) {
  return normalizeOutsourcingOrderRecords(records).filter((item) => item.tongzhouSku);
}

export function buildOutsourcingOrderPayload(records, source) {
  const allOrders = normalizeOutsourcingOrderRecords(records);
  const orders = allOrders.filter((item) => item.tongzhouSku);
  const domesticCustomizationOrders = allOrders.filter((item) => item.isInProduction && item.isDomesticCustomization);
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      orders: orders.length,
      inProductionQty: orders.reduce((sum, item) => sum + item.inProductionQty, 0),
      plannedQty: orders.reduce((sum, item) => sum + item.plannedQty, 0),
      domesticCustomizationOrders: domesticCustomizationOrders.length,
      domesticCustomizationInProductionQty: domesticCustomizationOrders.reduce((sum, item) => sum + item.inProductionQty, 0),
    },
    orders,
    domesticCustomizationOrders,
  };
}

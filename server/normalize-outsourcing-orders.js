import { JIANYUN_FORMS } from "./field-mapping.js";

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

      return {
        id: record.data_id || record._id || record.id || `${tongzhouSku || productSku}-${text(valueOf(record, fields.orderNo))}`,
        tongzhouSku,
        productSku,
        orderNo: text(valueOf(record, fields.orderNo)),
        productName: text(valueOf(record, fields.productName)),
        supplier: text(valueOf(record, fields.supplier)),
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
        raw: record,
      };
    });
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

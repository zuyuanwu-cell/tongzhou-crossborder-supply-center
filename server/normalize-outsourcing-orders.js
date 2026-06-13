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

export function normalizeOutsourcingOrders(records) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  return records
    .map((record) => {
      const tongzhouSku = text(valueOf(record, fields.tongzhouSku));
      const plannedQty = number(valueOf(record, fields.plannedQty));
      const producedQty = number(valueOf(record, fields.producedQty));
      const directInProductionQty = number(valueOf(record, fields.inProductionQty), plannedQty);
      const status = text(valueOf(record, fields.status), "未配置");
      const isInProduction = /进行中|生产中|加工中|排产中/.test(status);

      return {
        id: record.data_id || record._id || record.id || `${tongzhouSku}-${text(valueOf(record, fields.orderNo))}`,
        tongzhouSku,
        orderNo: text(valueOf(record, fields.orderNo)),
        productName: text(valueOf(record, fields.productName)),
        supplier: text(valueOf(record, fields.supplier)),
        status,
        unit: text(valueOf(record, fields.unit), "件"),
        plannedQty,
        producedQty,
        inProductionQty: isInProduction ? Math.max(0, directInProductionQty) : 0,
        createdAt: normalizeDate(valueOf(record, fields.createdAt)),
        expectedFinishedAt: normalizeDate(valueOf(record, fields.expectedFinishedAt)),
        remark: text(valueOf(record, fields.remark)),
        raw: record,
      };
    })
    .filter((item) => item.tongzhouSku);
}

export function buildOutsourcingOrderPayload(records, source) {
  const orders = normalizeOutsourcingOrders(records);
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      orders: orders.length,
      inProductionQty: orders.reduce((sum, item) => sum + item.inProductionQty, 0),
      plannedQty: orders.reduce((sum, item) => sum + item.plannedQty, 0),
    },
    orders,
  };
}

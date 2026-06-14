import { JIANYUN_FORMS } from "./field-mapping.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return text(value.name || value.filename || value.fileName || value.title || value.value, fallback);
  }
  return String(value).trim() || fallback;
}

function detail(label, value) {
  return { label, value: text(value, "未配置") };
}

export function normalizeWarehouseInfo(records) {
  const fields = JIANYUN_FORMS.warehouseInfo.fields;
  return records.map((record) => {
    const serialNo = text(valueOf(record, fields.serialNo));
    const sku = text(valueOf(record, fields.sku));
    const productName = text(valueOf(record, fields.productName), sku || serialNo || "未命名产品");
    const warehouseName = text(valueOf(record, fields.warehouseName), "未配置仓库");
    const warehouseSku = text(valueOf(record, fields.warehouseSku));
    const location = text(valueOf(record, fields.location));
    const packageInfo = text(valueOf(record, fields.packageInfo));
    const storageInfo = text(valueOf(record, fields.storageInfo));
    const shippingInfo = text(valueOf(record, fields.shippingInfo));
    const contactInfo = text(valueOf(record, fields.contactInfo));
    const remark = text(valueOf(record, fields.remark));

    return {
      id: record.data_id || record._id || record.id || `${sku}-${warehouseName}-${warehouseSku}`,
      serialNo,
      sku,
      productName,
      warehouseName,
      warehouseSku,
      location,
      packageInfo,
      storageInfo,
      shippingInfo,
      contactInfo,
      remark,
      details: [
        detail("产品流水号", serialNo),
        detail("同舟 SKU", sku),
        detail("产品名称", productName),
        detail("仓库/国家", warehouseName),
        detail("仓库 SKU", warehouseSku),
        detail("库位/仓位", location),
        detail("包装/箱规", packageInfo),
        detail("仓储要求", storageInfo),
        detail("发货要求", shippingInfo),
        detail("联系人/跟进人", contactInfo),
        detail("备注", remark),
      ],
      raw: record,
    };
  });
}

export function buildWarehouseInfoPayload(records, source) {
  const warehouseInfo = normalizeWarehouseInfo(records);
  const warehouseNames = new Set(warehouseInfo.map((item) => item.warehouseName).filter(Boolean));
  const skus = new Set(warehouseInfo.map((item) => item.sku).filter(Boolean));
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      records: warehouseInfo.length,
      warehouses: warehouseNames.size,
      skus: skus.size,
    },
    warehouseInfo,
  };
}

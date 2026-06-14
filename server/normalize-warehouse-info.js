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
    return text(value.name || value.nickname || value.username || value.title || value.value, fallback);
  }
  return String(value).trim() || fallback;
}

function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString();
}

function detail(label, value) {
  return { label, value: text(value, "未配置") };
}

export function normalizeWarehouseInfo(records) {
  const fields = JIANYUN_FORMS.warehouseInfo.fields;
  return records.map((record) => {
    const tongzhouSerialNo = text(valueOf(record, fields.tongzhouSerialNo));
    const warehouseName = text(valueOf(record, fields.warehouseName), "未配置仓库");
    const countryRegion = text(valueOf(record, fields.countryRegion));
    const warehouseCode = text(valueOf(record, fields.warehouseCode));
    const shopShippingAddress = text(valueOf(record, fields.shopShippingAddress));
    const shopReturnAddress = text(valueOf(record, fields.shopReturnAddress));
    const firstMileReceivingAddress = text(valueOf(record, fields.firstMileReceivingAddress));
    const timezone = text(valueOf(record, fields.timezone));
    const workStartTime = text(valueOf(record, fields.workStartTime));
    const workEndTime = text(valueOf(record, fields.workEndTime));
    const remark = text(valueOf(record, fields.remark));
    const creator = text(valueOf(record, fields.creator));
    const createTime = normalizeDate(valueOf(record, fields.createTime));
    const updateTime = normalizeDate(valueOf(record, fields.updateTime));

    return {
      id: record.data_id || record._id || record.id || `${tongzhouSerialNo}-${warehouseCode}-${warehouseName}`,
      tongzhouSerialNo,
      warehouseName,
      countryRegion,
      warehouseCode,
      shopShippingAddress,
      shopReturnAddress,
      firstMileReceivingAddress,
      timezone,
      workStartTime,
      workEndTime,
      remark,
      creator,
      createTime,
      updateTime,
      details: [
        detail("同舟流水号", tongzhouSerialNo),
        detail("仓库名称", warehouseName),
        detail("国家/地区", countryRegion),
        detail("仓库代码", warehouseCode),
        detail("店铺绑定发货地址", shopShippingAddress),
        detail("店铺绑定退货地址", shopReturnAddress),
        detail("头程收货地址", firstMileReceivingAddress),
        detail("时区", timezone),
        detail("上班时间", workStartTime),
        detail("下班时间", workEndTime),
        detail("备注信息", remark),
        detail("提交人", creator),
        detail("提交时间", createTime),
        detail("更新时间", updateTime),
      ],
      raw: record,
    };
  });
}

export function buildWarehouseInfoPayload(records, source) {
  const warehouseInfo = normalizeWarehouseInfo(records);
  const warehouseNames = new Set(warehouseInfo.map((item) => item.warehouseName).filter(Boolean));
  const countries = new Set(warehouseInfo.map((item) => item.countryRegion).filter(Boolean));
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      records: warehouseInfo.length,
      warehouses: warehouseNames.size,
      countries: countries.size,
    },
    warehouseInfo,
  };
}

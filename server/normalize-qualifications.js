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
  if (typeof value === "object") {
    return text(value.name || value.filename || value.fileName || value.title || value.value, fallback);
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

function normalizeFile(item, index) {
  if (!item) return null;
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      return {
        id: trimmed,
        name: `资质附件 ${index + 1}`,
        url: trimmed,
        fileId: "",
      };
    }
    return {
      id: trimmed,
      name: `资质附件 ${index + 1}`,
      url: "",
      fileId: trimmed,
    };
  }

  if (typeof item === "object") {
    const candidateUrl = item.url || item.downloadUrl || item.fileUrl || item.previewUrl || item.thumbnailUrl;
    const fileId = item.fileId || item.file_id || item.id || item._id || item.uuid || "";
    return {
      id: String(fileId || candidateUrl || index),
      name: text(item.name || item.filename || item.fileName || item.title, `资质附件 ${index + 1}`),
      url: typeof candidateUrl === "string" && /^https?:\/\//i.test(candidateUrl) ? candidateUrl : "",
      fileId: text(fileId),
    };
  }

  return null;
}

function normalizeFiles(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map(normalizeFile).filter(Boolean);
}

export function normalizeQualifications(records) {
  const fields = JIANYUN_FORMS.qualifications.fields;
  return records.map((record) => {
    const sku = text(valueOf(record, fields.sku));
    const files = normalizeFiles(valueOf(record, fields.files));
    const productName = text(valueOf(record, fields.productName));
    const qualificationCategory = text(valueOf(record, fields.qualificationCategory), "未分类");
    const qualificationName = [productName, qualificationCategory].filter(Boolean).join(" ");
    return {
      id: record.data_id || record._id || record.id || `${sku}-${qualificationName}`,
      productRecordId: text(valueOf(record, fields.productRecordId)),
      sku,
      productName,
      qualificationCategory,
      market: text(valueOf(record, fields.market), "未配置市场"),
      qualificationName: qualificationName || "未命名资质",
      issuer: text(valueOf(record, fields.issuer)),
      effectiveDate: normalizeDate(valueOf(record, fields.effectiveDate)),
      expiryDate: normalizeDate(valueOf(record, fields.expiryDate)),
      files,
      remark: text(valueOf(record, fields.remark)),
      raw: record,
    };
  });
}

export function buildQualificationPayload(records, source) {
  const qualifications = normalizeQualifications(records);
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      qualifications: qualifications.length,
      withFiles: qualifications.filter((item) => item.files.length > 0).length,
      expired: qualifications.filter((item) => item.expiryDate && new Date(item.expiryDate).getTime() < Date.now()).length,
    },
    qualifications,
  };
}

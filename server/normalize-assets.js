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

function normalizeFile(item, index, prefix) {
  if (!item) return null;
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      return {
        id: trimmed,
        name: `${prefix} ${index + 1}`,
        url: trimmed,
        fileId: "",
      };
    }
    return {
      id: trimmed,
      name: `${prefix} ${index + 1}`,
      url: "",
      fileId: trimmed,
    };
  }

  if (typeof item === "object") {
    const candidateUrl = item.url || item.downloadUrl || item.fileUrl || item.previewUrl || item.thumbnailUrl;
    const fileId = item.fileId || item.file_id || item.id || item._id || item.uuid || "";
    return {
      id: String(fileId || candidateUrl || index),
      name: text(item.name || item.filename || item.fileName || item.title, `${prefix} ${index + 1}`),
      url: typeof candidateUrl === "string" && /^https?:\/\//i.test(candidateUrl) ? candidateUrl : "",
      fileId: text(fileId),
    };
  }

  return null;
}

function normalizeFiles(value, prefix) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item, index) => normalizeFile(item, index, prefix)).filter(Boolean);
}

export function normalizeAssets(records) {
  const fields = JIANYUN_FORMS.assets.fields;
  return records.map((record) => {
    const productRecordId = text(valueOf(record, fields.productRecordId));
    const productName = text(valueOf(record, fields.productName));
    const assetName = text(valueOf(record, fields.assetName), productName || "未命名素材");
    const imageFiles = normalizeFiles(valueOf(record, fields.imageFiles), "素材图片");
    const sourceFiles = normalizeFiles(valueOf(record, fields.sourceFiles), "素材文件");

    return {
      id: record.data_id || record._id || record.id || `${productRecordId}-${assetName}`,
      productRecordId,
      sku: text(valueOf(record, fields.sku)),
      productName,
      productNameEn: text(valueOf(record, fields.productNameEn)),
      category: text(valueOf(record, fields.category), "未分类"),
      assetType: text(valueOf(record, fields.assetType), "未分类"),
      assetName,
      imageFiles,
      sourceFiles,
      files: [...imageFiles, ...sourceFiles],
      remark: text(valueOf(record, fields.remark)),
      raw: record,
    };
  });
}

export function buildAssetPayload(records, source) {
  const assets = normalizeAssets(records);
  return {
    ok: true,
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      assets: assets.length,
      withFiles: assets.filter((item) => item.files.length > 0).length,
    },
    assets,
  };
}

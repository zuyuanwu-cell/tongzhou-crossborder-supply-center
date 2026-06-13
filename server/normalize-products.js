import { CHANNEL_ALIASES, JIANYUN_FORMS } from "./field-mapping.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  if (field && typeof field === "object" && "value" in field) return field.value;
  return field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.join(",");
  return String(value).trim() || fallback;
}

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function firstImageUrl(value) {
  if (!value) return "";
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (typeof item === "string" && /^https?:\/\//i.test(item)) return item;
    if (item && typeof item === "object") {
      const candidate = item.url || item.downloadUrl || item.fileUrl || item.previewUrl || item.thumbnailUrl;
      if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
    }
  }
  return "";
}

function normalizeChannel(value) {
  const raw = text(value, "分销");
  if (CHANNEL_ALIASES.direct.includes(raw)) return "直营";
  if (CHANNEL_ALIASES.distribution.includes(raw)) return "分销";
  return raw.includes("直") ? "直营" : "分销";
}

function inferVisualTone(category) {
  if (/食|饼|饮|茶|糖|咖/i.test(category)) return "food";
  if (/护|美|个|健康/i.test(category)) return "care";
  if (/家|厨|居|收纳/i.test(category)) return "home";
  if (/婴|童|母|宝宝/i.test(category)) return "baby";
  return "home";
}

function statusToAlert(status, stockQty) {
  const statusText = text(status);
  if (/断|缺|预警|不足|低/i.test(statusText)) return "断货";
  if (/滞|清/i.test(statusText)) return "滞销";
  if (stockQty <= 0) return "断货";
  if (stockQty < 500) return "补货";
  return "健康";
}

export function normalizeProductBase(records) {
  const fields = JIANYUN_FORMS.productBase.fields;
  return records.map((record) => ({
    id: record.data_id || record._id || text(valueOf(record, fields.skuNo)),
    skuNo: text(valueOf(record, fields.skuNo)),
    sku: text(valueOf(record, fields.sku)),
    name: text(valueOf(record, fields.productName)),
    nameEn: text(valueOf(record, fields.productNameEn)),
    unit: text(valueOf(record, fields.unit), "件"),
    category: text(valueOf(record, fields.category), "未分类"),
    functionCategory: text(valueOf(record, fields.functionCategory)),
    productType: text(valueOf(record, fields.productType)),
    skuAttribute: text(valueOf(record, fields.skuAttribute)),
    brand: text(valueOf(record, fields.brand), "同舟"),
    supplier: text(valueOf(record, fields.supplier)),
    launchDate: text(valueOf(record, fields.launchDate)),
    imageUrl: firstImageUrl(valueOf(record, fields.imageFiles)),
    imageSource: firstImageUrl(valueOf(record, fields.imageFiles)) ? "jiandaoyun" : "",
    qualificationImageUrl: firstImageUrl(valueOf(record, fields.qualificationImages)),
    barcode: text(valueOf(record, fields.barcode)),
    specification: text(valueOf(record, fields.specification)),
    weight: text(valueOf(record, fields.weight)),
    length: text(valueOf(record, fields.length)),
    width: text(valueOf(record, fields.width)),
    height: text(valueOf(record, fields.height)),
    project: text(valueOf(record, fields.project)),
    publicDescription: text(valueOf(record, fields.publicDescription)),
    sellingPoints: text(valueOf(record, fields.sellingPoints)),
    sellingPointsEn: text(valueOf(record, fields.sellingPointsEn)),
    raw: record,
  }));
}

export function normalizeCatalog(records, baseProducts = []) {
  const fields = JIANYUN_FORMS.productCatalog.fields;
  const baseBySkuNo = new Map(baseProducts.map((product) => [product.skuNo, product]));
  const baseBySku = new Map(baseProducts.map((product) => [product.sku, product]));

  return records.map((record) => {
    const skuNo = text(valueOf(record, fields.skuNo));
    const sku = text(valueOf(record, fields.sku), skuNo);
    const base = baseBySkuNo.get(skuNo) || baseBySku.get(sku);
    const category = text(valueOf(record, fields.category), base?.category || "未分类");
    const channel = "分销";
    const directCostPrice = number(valueOf(record, fields.directPrice));
    const distributionCostPrice = number(valueOf(record, fields.distributionCost));
    const salesPrice = number(valueOf(record, fields.salesPrice));
    const stockQty = 0;
    const country = text(valueOf(record, fields.country), "未配置国家");
    const name = text(valueOf(record, fields.productNameCn), text(valueOf(record, fields.productName), base?.name || sku));
    const imageUrl = firstImageUrl(valueOf(record, fields.publicImages)) || base?.imageUrl || "";

    return {
      id: record.data_id || record._id || `${skuNo}-${channel}-${country}`,
      skuNo,
      sku,
      name,
      nameEn: text(valueOf(record, fields.productNameEn), base?.nameEn || ""),
      country,
      channel,
      category,
      unit: text(valueOf(record, fields.unit), base?.unit || "件"),
      brand: base?.brand || "同舟",
      distributionPrice: distributionCostPrice,
      distributionCurrency: text(valueOf(record, fields.distributionCurrency), "USD"),
      directPrice: directCostPrice,
      directCurrency: text(valueOf(record, fields.directCurrency), "USD"),
      directCostPrice,
      directCostCurrency: text(valueOf(record, fields.directCurrency), "USD"),
      distributionCost: distributionCostPrice,
      distributionCostPrice,
      distributionCostCurrency: text(valueOf(record, fields.distributionCurrency), "USD"),
      salesPrice,
      salesCurrency: text(valueOf(record, fields.salesCurrency), text(valueOf(record, fields.distributionCurrency), "USD")),
      countrySku: text(valueOf(record, fields.countrySku)),
      imageUrl,
      imageSource: imageUrl ? (firstImageUrl(valueOf(record, fields.publicImages)) ? "jiandaoyun" : "product_base") : "",
      functionCategory: base?.functionCategory || "",
      productType: base?.productType || "",
      skuAttribute: base?.skuAttribute || "",
      barcode: base?.barcode || "",
      specification: base?.specification || text(valueOf(record, fields.specification)),
      weight: base?.weight || "",
      length: base?.length || "",
      width: base?.width || "",
      height: base?.height || "",
      project: base?.project || "",
      publicDescription: base?.publicDescription || text(valueOf(record, fields.publicDescription)),
      sellingPoints: base?.sellingPoints || text(valueOf(record, fields.sellingPoints)),
      sellingPointsEn: base?.sellingPointsEn || "",
      qualificationImageUrl: base?.qualificationImageUrl || "",
      stockQty,
      status: "待库存同步",
      alert: "健康",
      visualTone: inferVisualTone(category),
      raw: record,
    };
  });
}

export function buildProductPayload(baseRecords, catalogRecords, source) {
  const productBase = normalizeProductBase(baseRecords);
  const catalog = normalizeCatalog(catalogRecords, productBase);
  return {
    source,
    syncedAt: new Date().toISOString(),
    counts: {
      productBase: productBase.length,
      catalog: catalog.length,
      directCatalog: catalog.filter((product) => product.directPrice > 0).length,
      distributionCatalog: catalog.filter((product) => product.distributionPrice > 0).length,
    },
    productBase,
    catalog,
  };
}

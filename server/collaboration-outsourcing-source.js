import { createHash } from "node:crypto";
import { JIANYUN_FORMS } from "./field-mapping.js";

function valueOf(record, fieldId) {
  if (!fieldId) return undefined;
  const field = record?.[fieldId];
  return field && typeof field === "object" && "value" in field ? field.value : field;
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(",");
  if (typeof value === "object") return text(value.name || value.title || value.value || value.id, fallback);
  return String(value).trim() || fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function date(value) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function dateOnly(value) {
  return date(value).slice(0, 10);
}

function compact(value) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function exactKey(value) {
  return text(value).normalize("NFKC").replace(/[\s\-_—·・,，。()（）/\\]+/g, "").toLowerCase();
}

function safeFirstArticleImage(value, category, label) {
  const url = text(value?.url || value?.download_url || value?.downloadUrl || value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !(parsed.hostname === "jiandaoyun.com" || parsed.hostname.endsWith(".jiandaoyun.com")) || parsed.href.length > 2_000) return null;
    return {
      category,
      label,
      name: text(value?.name || value?.filename, label).slice(0, 240),
      url: parsed.href,
      mime: text(value?.mime || value?.type, "image/jpeg").slice(0, 100),
      size: number(value?.size),
    };
  } catch {
    return null;
  }
}

function normalizeFirstArticle(record, matchedBy) {
  const config = JIANYUN_FORMS.firstArticleRecords;
  const fields = config.fields;
  const bomFields = config.bomFields;
  const rawBom = valueOf(record, fields.bom);
  const imageGroups = [
    [fields.packagingImages, "packaging", "产品包装六面图"],
    [fields.innerPackImages, "inner_pack", "内托与内包"],
    [fields.codingImages, "coding", "打码位置"],
    [fields.finishedImages, "finished", "成品效果"],
    [fields.cartonImages, "carton", "外箱与装箱"],
  ];
  const images = imageGroups.flatMap(([fieldId, category, label]) => {
    const files = valueOf(record, fieldId);
    return (Array.isArray(files) ? files : files ? [files] : [])
      .map((file) => safeFirstArticleImage(file, category, label))
      .filter(Boolean);
  }).slice(0, 40);
  return {
    matchedBy,
    documentNo: text(valueOf(record, fields.documentNo)).slice(0, 120),
    version: text(valueOf(record, fields.version)).slice(0, 80),
    productSku: text(valueOf(record, fields.productSku)).slice(0, 120),
    productName: text(valueOf(record, fields.productName)).slice(0, 300),
    specification: text(valueOf(record, fields.specification)).slice(0, 1_000),
    brandName: text(valueOf(record, fields.brandName)).slice(0, 120),
    unit: text(valueOf(record, fields.unit)).slice(0, 20),
    barcode: text(valueOf(record, fields.barcode)).slice(0, 120),
    filingName: text(valueOf(record, fields.filingName)).slice(0, 300),
    bpom: text(valueOf(record, fields.bpom)).slice(0, 300),
    productionProcess: text(valueOf(record, fields.productionProcess)).slice(0, 2_000),
    cartonSpecification: text(valueOf(record, fields.cartonSpecification)).slice(0, 1_000),
    updatedAt: date(record?.updateTime || record?.update_time || record?.updatedAt || record?.updated_at),
    bom: (Array.isArray(rawBom) ? rawBom : []).slice(0, 100).map((item) => ({
      category: text(valueOf(item, bomFields.category)).slice(0, 120),
      name: text(valueOf(item, bomFields.name)).slice(0, 300),
      materialCode: text(valueOf(item, bomFields.materialCode)).slice(0, 120),
      netContent: text(valueOf(item, bomFields.netContent)).slice(0, 120),
      unit: text(valueOf(item, bomFields.unit)).slice(0, 20),
      composition: text(valueOf(item, bomFields.composition)).slice(0, 120),
    })).filter((item) => item.name || item.materialCode),
    images,
  };
}

export function matchOutsourcingFirstArticle(orderRecord, firstArticleRecords = []) {
  const orderFields = JIANYUN_FORMS.outsourcingOrders.fields;
  const articleFields = JIANYUN_FORMS.firstArticleRecords.fields;
  const orderBarcode = exactKey(valueOf(orderRecord, orderFields.barcode));
  const orderSkus = new Set([
    exactKey(valueOf(orderRecord, orderFields.tongzhouSku)),
    exactKey(valueOf(orderRecord, orderFields.productSku)),
  ].filter(Boolean));
  const orderProductName = exactKey(valueOf(orderRecord, orderFields.productName));
  const orderFactoryNames = new Set([
    exactKey(valueOf(orderRecord, orderFields.supplier)),
    exactKey(valueOf(orderRecord, orderFields.factoryFullName)),
  ].filter(Boolean));
  const matches = firstArticleRecords.map((record) => {
    const articleBarcode = exactKey(valueOf(record, articleFields.barcode));
    const articleSku = exactKey(valueOf(record, articleFields.productSku));
    const articleProductName = exactKey(valueOf(record, articleFields.productName));
    const articleFactoryName = exactKey(valueOf(record, articleFields.factoryName));
    const matchedBy = orderBarcode && articleBarcode === orderBarcode
      ? "barcode"
      : articleSku && orderSkus.has(articleSku)
        ? "sku"
        : orderProductName && articleProductName === orderProductName
          ? "product_name"
          : "";
    if (!matchedBy) return null;
    const baseScore = matchedBy === "barcode" ? 300 : matchedBy === "sku" ? 200 : 100;
    const factoryScore = articleFactoryName && orderFactoryNames.has(articleFactoryName) ? 10 : 0;
    const updatedAt = Date.parse(record?.updateTime || record?.update_time || record?.updatedAt || record?.updated_at || "") || 0;
    return { record, matchedBy, score: baseScore + factoryScore, updatedAt };
  }).filter(Boolean).sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt);
  return matches[0] ? normalizeFirstArticle(matches[0].record, matches[0].matchedBy) : null;
}

function safeLineRef(orderNo, type, sku, index) {
  const readable = `${orderNo}-${type}-${sku || "line"}-${index + 1}`.replace(/\s+/g, "-");
  if (readable.length <= 120) return readable;
  return `${orderNo}-${type}-${createHash("sha256").update(readable).digest("hex").slice(0, 16)}`.slice(0, 120);
}

export function isActiveOutsourcingStatus(status) {
  return /进行中|生产中|加工中|排产中|部分入库/.test(text(status));
}

function projectedStatus(sourceStatus, currentStatus = "") {
  const source = text(sourceStatus);
  if (/作废|取消|已取消/.test(source)) return "cancelled";
  if (/已完成|已完结|全部入库/.test(source)) return "completed";
  if (isActiveOutsourcingStatus(source)) {
    return ["pending", "accepted", "in_progress", "pending_approval", "pending_sync"].includes(currentStatus)
      ? currentStatus
      : "pending";
  }
  return currentStatus || "pending";
}

function milestoneStatus(value) {
  const current = text(value);
  if (/异常|失败|不合格/.test(current)) return "blocked";
  if (/是|通过|合格|到齐|完成/.test(current)) return "completed";
  return "pending";
}

function isPackagingMaterial(category, name) {
  return /包材|瓶|盖|盒|箱|袋|膜|标|贴|卡|内托|卷膜|泵头|喷头/.test(`${text(category)} ${text(name)}`);
}

export function outsourcingFactoryOptions(records = []) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  const factories = new Map();
  for (const record of records) {
    const factoryId = text(valueOf(record, fields.factoryId));
    if (!factoryId) continue;
    const factoryName = text(valueOf(record, fields.supplier));
    const factoryFullName = text(valueOf(record, fields.factoryFullName));
    const current = factories.get(factoryId) || { factoryId, factoryName: "", factoryFullName: "", activeOrderCount: 0 };
    if (factoryName) current.factoryName = factoryName;
    if (factoryFullName) current.factoryFullName = factoryFullName;
    if (isActiveOutsourcingStatus(valueOf(record, fields.status))) current.activeOrderCount += 1;
    factories.set(factoryId, current);
  }
  return [...factories.values()]
    .filter((item) => item.activeOrderCount > 0)
    .sort((left, right) => right.activeOrderCount - left.activeOrderCount || left.factoryName.localeCompare(right.factoryName, "zh-CN"));
}

export function inferOutsourcingFactoryBinding(organizationName, options = []) {
  const target = compact(organizationName);
  if (!target) return null;
  const matches = options.filter((item) => [item.factoryName, item.factoryFullName].some((candidate) => compact(candidate) === target));
  const uniqueIds = new Set(matches.map((item) => item.factoryId));
  return uniqueIds.size === 1 ? matches[0] : null;
}

export function outsourcingOrderIdentity(record) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  return {
    recordId: text(record?.data_id || record?._id || record?.id),
    factoryId: text(valueOf(record, fields.factoryId)),
    factoryName: text(valueOf(record, fields.supplier)),
    factoryFullName: text(valueOf(record, fields.factoryFullName)),
    orderNo: text(valueOf(record, fields.orderNo)),
    status: text(valueOf(record, fields.status)),
    updatedAt: date(record?.updateTime || record?.update_time || record?.updatedAt || record?.updated_at),
  };
}

export function outsourcingProjectionFromRecord(record, {
  organizationCode,
  version,
  currentStatus = "",
  imageUrl = "",
  firstArticleRecords = [],
  eventId,
} = {}) {
  const fields = JIANYUN_FORMS.outsourcingOrders.fields;
  const detailFields = JIANYUN_FORMS.outsourcingOrders.detailFields;
  const identity = outsourcingOrderIdentity(record);
  if (!identity.factoryId || !identity.orderNo) return null;
  const sku = text(valueOf(record, fields.tongzhouSku)) || text(valueOf(record, fields.productSku)) || identity.orderNo;
  const productName = text(valueOf(record, fields.productName), sku);
  const productSpec = text(valueOf(record, fields.productSpec));
  const barcode = text(valueOf(record, fields.barcode));
  const firstArticle = matchOutsourcingFirstArticle(record, firstArticleRecords);
  const productionProcess = text(valueOf(record, fields.productionProcess)) || firstArticle?.productionProcess || "";
  const cartonType = text(valueOf(record, fields.cartonType));
  const piecesPerCarton = number(valueOf(record, fields.piecesPerCarton));
  const quantity = number(valueOf(record, fields.plannedQty));
  const unit = text(valueOf(record, fields.unit), "件");
  const rawDetails = valueOf(record, fields.details);
  const details = Array.isArray(rawDetails) ? rawDetails : [];
  const factoryMaterials = details.filter((item) => {
    const supplierId = text(valueOf(item, detailFields.supplierId));
    const supplierName = compact(valueOf(item, detailFields.supplier));
    return supplierId === identity.factoryId || Boolean(supplierName && [identity.factoryName, identity.factoryFullName].some((name) => compact(name) === supplierName));
  });
  const allAssignedMaterials = details.filter((item) => text(valueOf(item, detailFields.supplierId)));
  const fulfillmentMode = allAssignedMaterials.length > 0 && factoryMaterials.length === allAssignedMaterials.length ? "turnkey" : "labor_only";
  const lines = [{
    lineRef: safeLineRef(identity.orderNo, "finished", sku, 0),
    lineType: "finished_product",
    sku: sku.slice(0, 100),
    productName: productName.slice(0, 300),
    specification: productSpec.slice(0, 1_000),
    imageUrl,
    plannedQuantity: quantity,
    unit: unit.slice(0, 20),
    requiredDate: dateOnly(valueOf(record, fields.expectedFinishedAt)),
    responsibility: "factory",
  }];
  factoryMaterials.forEach((item, index) => {
    const materialSku = text(valueOf(item, detailFields.sku)) || `${sku}-M${index + 1}`;
    const materialName = text(valueOf(item, detailFields.name), materialSku);
    lines.push({
      lineRef: safeLineRef(identity.orderNo, "material", materialSku, index),
      lineType: isPackagingMaterial(valueOf(item, detailFields.category), materialName) ? "packaging" : "raw_material",
      sku: materialSku.slice(0, 100),
      productName: materialName.slice(0, 300),
      specification: text(valueOf(item, detailFields.category)).slice(0, 1_000),
      imageUrl: "",
      plannedQuantity: number(valueOf(item, detailFields.requiredQty)),
      unit: text(valueOf(item, detailFields.unit), "件").slice(0, 20),
      requiredDate: dateOnly(valueOf(item, detailFields.plannedArrivalAt)),
      responsibility: "factory",
    });
  });
  const dueAt = date(valueOf(record, fields.expectedFinishedAt));
  const factoryExpectedDeliveryDate = dateOnly(valueOf(record, fields.factoryExpectedFinishedAt));
  const dueSoon = dueAt && new Date(dueAt).getTime() - Date.now() <= 3 * 24 * 60 * 60 * 1000;
  const executionNotes = [
    productSpec ? `规格：${productSpec}` : "",
    productionProcess ? `生产工序：${productionProcess}` : "",
    cartonType ? `外箱：${cartonType}${piecesPerCarton ? `，${piecesPerCarton} ${unit}/箱` : ""}` : piecesPerCarton ? `装箱：${piecesPerCarton} ${unit}/箱` : "",
  ].filter(Boolean).join("；");
  return {
    eventId,
    organizationCode,
    coreRefType: "jiandaoyun_outsourcing_order",
    coreRefId: identity.orderNo,
    orderType: "production",
    itemType: "production_order",
    title: `委外加工单 ${identity.orderNo} · ${productName}`.slice(0, 240),
    description: "数据来源：千顷 ERP 委外加工单。请在伙伴端反馈排期、物料与包材到齐测试、生产、质检、异常和发货进度。",
    priority: dueSoon ? "urgent" : "normal",
    status: projectedStatus(identity.status, currentStatus),
    dueAt,
    version,
    publicPayload: {
      orderNo: identity.orderNo,
      projectCode: "",
      productName,
      productSpec,
      barcode,
      fulfillmentMode,
      requirements: fulfillmentMode === "turnkey"
        ? `本单由工厂负责供料；请逐项反馈物料/包材到齐及测试结果，异常须及时上报。${executionNotes ? ` ${executionNotes}` : ""}`
        : `请按千顷 ERP 委外加工单执行，并反馈工厂负责物料、生产与交付进度。${executionNotes ? ` ${executionNotes}` : ""}`,
      productionProcess,
      cartonType,
      piecesPerCarton,
      factoryExpectedDeliveryDate,
      quantity,
      unit,
      deliveryDate: dueAt.slice(0, 10),
      deliveryAddress: "",
      paymentTerms: "",
      currency: "CNY",
      ...(firstArticle ? { firstArticle } : {}),
    },
    lines,
    milestones: [
      { milestoneType: "material_ready", title: "物料到齐", plannedAt: date(valueOf(record, fields.packagingExpectedAt)), status: milestoneStatus(valueOf(record, fields.materialReady)), publicPayload: { note: "" } },
      { milestoneType: "inner_pack_test", title: "内包测试", plannedAt: "", status: milestoneStatus(valueOf(record, fields.innerPackTest)), publicPayload: { note: "" } },
      { milestoneType: "outer_pack_test", title: "外包测试", plannedAt: "", status: milestoneStatus(valueOf(record, fields.outerPackTest)), publicPayload: { note: "" } },
      { milestoneType: "preproduction_sample", title: "产前样确认", plannedAt: "", status: milestoneStatus(valueOf(record, fields.preProductionSampleConfirmed)), publicPayload: { note: "" } },
    ],
  };
}

export function outsourcingProjectionFingerprint(projection) {
  const { eventId: _eventId, version: _version, ...sourceFields } = projection;
  return createHash("sha256").update(JSON.stringify(sourceFields)).digest("hex");
}

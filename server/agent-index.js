import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, relative, resolve } from "node:path";

const INDEX_VERSION = "1.0";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const MAX_TOMBSTONES = 5000;

const STANDARD_FIELDS = {
  id: "Agent 层稳定主键；同一源记录跨同步保持不变。",
  type: "Manifest 中声明的资源类型。",
  title: "面向用户和检索结果展示的标题。",
  display_name: "title 的兼容别名。",
  body: "由允许索引的业务字段拼接得到的正文。",
  searchable_text: "用于关键词检索的规范化文本。",
  url: "业务对象自身的公开或受控 URL；没有时为空。",
  source_path: "可回溯到当前系统的 API 或仓库路径。",
  created_at: "源记录创建时间；源端缺失时使用首次可观测时间。",
  updated_at: "源记录更新时间或最近可靠观测时间。",
  owner: "源记录的创建人、负责人或所有者。",
  permissions: "允许读取该记录的当前系统角色。",
  acl: "结构化访问控制信息。",
  visibility: "public、partner 或 admin。",
  source_system: "记录来源，例如 jiandaoyun、wms、local、derived。",
  source_id: "来源系统中的稳定业务主键。",
  checksum: "对允许索引的规范化内容计算的 SHA-256。",
  version: "checksum 的短版本标识。",
  status: "业务状态；没有状态时为空。",
  attachments: "附件元数据、MIME 推断和正文提取状态。",
  data: "经过字段白名单和秘密字段过滤后的完整业务数据。",
  metadata: "索引观测时间、源更新时间和时间戳依据。",
};

const REQUIRED_RECORD_FIELDS = Object.keys(STANDARD_FIELDS);

const REQUIRED_NONEMPTY_RECORD_FIELDS = [
  "id",
  "type",
  "title",
  "searchable_text",
  "source_path",
  "created_at",
  "updated_at",
  "permissions",
  "acl",
  "visibility",
  "source_system",
  "source_id",
  "checksum",
  "version",
];

const STANDARD_FIELD_TYPES = {
  permissions: "array",
  acl: "object",
  attachments: "array",
  data: "object",
  metadata: "object",
};

const TYPE_DEFINITIONS = {
  page: {
    label: "页面",
    access: "public",
    sourceSystem: "frontend",
    fields: ["route", "description"],
    sourcePath: "/",
  },
  repo_document: {
    label: "内部文档",
    access: "admin",
    sourceSystem: "repository",
    fields: ["path", "content"],
    sourcePath: "/docs",
  },
  static_asset: {
    label: "站点静态媒体",
    access: "public",
    sourceSystem: "repository",
    fields: ["path", "name", "mimeType", "size", "createdAt", "updatedAt"],
    sourcePath: "/public",
  },
  product_base: {
    label: "产品基础档案",
    access: "partner",
    sourceSystem: "jiandaoyun",
    fields: ["skuNo", "sku", "name", "nameEn", "brand", "category", "specification", "publicDescription", "sellingPoints"],
    sourcePath: "/api/products?mode=detail",
  },
  product_catalog: {
    label: "国家产品目录",
    access: "public",
    sourceSystem: "jiandaoyun",
    fields: ["skuNo", "sku", "name", "country", "channel", "category", "status", "stockQty", "prices"],
    sourcePath: "/api/products?mode=detail",
  },
  qualification: {
    label: "产品资质",
    access: "partner",
    sourceSystem: "jiandaoyun",
    fields: ["sku", "productName", "qualificationCategory", "market", "issuer", "effectiveDate", "expiryDate", "files"],
    sourcePath: "/api/qualifications",
  },
  asset: {
    label: "产品素材",
    access: "partner",
    sourceSystem: "jiandaoyun",
    fields: ["sku", "productName", "category", "assetType", "assetName", "files", "remark"],
    sourcePath: "/api/assets",
  },
  warehouse_info: {
    label: "仓库信息",
    access: "partner",
    sourceSystem: "jiandaoyun",
    fields: ["warehouseName", "countryRegion", "warehouseCode", "addresses", "timezone", "workTime", "remark"],
    sourcePath: "/api/warehouse-info",
  },
  wms_product: {
    label: "WMS 商品",
    access: "admin",
    sourceSystem: "wms",
    fields: ["warehouseId", "goodsSkuId", "sku", "countrySku", "name", "imageUrl"],
    sourcePath: "/api/warehouses",
  },
  inventory_position: {
    label: "实时库存",
    access: "admin",
    sourceSystem: "wms",
    fields: ["warehouseId", "sku", "availableQty", "lockedQty", "inTransitQty", "totalQty", "syncedAt"],
    sourcePath: "/api/warehouses",
  },
  order_line: {
    label: "出库订单行",
    access: "admin",
    sourceSystem: "wms",
    fields: ["orderId", "orderNo", "warehouseId", "sku", "productName", "quantity", "salesAmount", "status", "shippedAt"],
    sourcePath: "/api/order-analysis",
  },
  inventory_snapshot: {
    label: "库存快照",
    access: "admin",
    sourceSystem: "local",
    fields: ["date", "capturedAt", "sourceSyncedAt", "totals", "rows"],
    sourcePath: "/api/inventory-snapshots",
  },
  movement_snapshot: {
    label: "动销历史快照",
    access: "admin",
    sourceSystem: "sqlite",
    fields: ["date", "timezone", "capturedAt", "orderSyncedAt", "inventorySyncedAt", "totals", "rows"],
    sourcePath: "/api/movement-history",
  },
  movement_item: {
    label: "当前动销指标",
    access: "admin",
    sourceSystem: "derived",
    fields: ["sku", "country", "availableQty", "sales7", "sales30", "sales90", "daysCover", "replenishQty", "status"],
    sourcePath: "/api/movement",
  },
  stockup_recommendation: {
    label: "备货建议",
    access: "admin",
    sourceSystem: "derived",
    fields: ["recommendationKey", "sku", "country", "replenishQty", "netReplenishQty", "decisionStatus", "suggestion"],
    sourcePath: "/api/stockup",
  },
  stockup_plan: {
    label: "备货计划",
    access: "admin",
    sourceSystem: "local",
    fields: ["recommendationKey", "sku", "country", "quantity", "planType", "owner", "expectedArrivalAt", "status"],
    sourcePath: "/api/stockup",
  },
  stockup_decision: {
    label: "备货决策",
    access: "admin",
    sourceSystem: "local",
    fields: ["recommendationKey", "sku", "country", "status", "note", "updatedAt"],
    sourcePath: "/api/stockup",
  },
  stockup_order: {
    label: "WMS 备货入库单",
    access: "admin",
    sourceSystem: "wms",
    fields: ["orderNo", "warehouseId", "sku", "productName", "quantity", "status", "expectedArrivalAt"],
    sourcePath: "/api/stockup",
  },
  outsourcing_order: {
    label: "委外加工单",
    access: "admin",
    sourceSystem: "jiandaoyun",
    fields: ["tongzhouSku", "orderNo", "productName", "supplier", "status", "plannedQty", "producedQty", "expectedFinishedAt"],
    sourcePath: "/api/outsourcing-orders",
  },
  user: {
    label: "用户",
    access: "admin",
    sourceSystem: "local",
    fields: ["username", "displayName", "role", "status", "createdAt", "updatedAt"],
    sourcePath: "/api/users",
  },
  distributor_application: {
    label: "分销账号申请",
    access: "admin",
    sourceSystem: "local",
    fields: ["companyName", "contactName", "market", "sourceSku", "status", "createdAt", "updatedAt"],
    sourcePath: "/api/distributor-applications",
  },
  warehouse_connection: {
    label: "仓库连接",
    access: "admin",
    sourceSystem: "local",
    fields: ["name", "country", "providerId", "warehouseCode", "status", "lastSyncedAt", "syncScope"],
    sourcePath: "/api/warehouses",
  },
  quick_nav_category: {
    label: "快捷导航分类",
    access: "public",
    sourceSystem: "local",
    fields: ["name", "description", "sortOrder", "createdAt", "updatedAt"],
    sourcePath: "/api/quick-nav",
  },
  quick_nav_link: {
    label: "快捷导航链接",
    access: "public",
    sourceSystem: "local",
    fields: ["categoryId", "title", "url", "description", "sortOrder", "createdAt", "updatedAt"],
    sourcePath: "/api/quick-nav",
  },
  action_log: {
    label: "操作日志",
    access: "admin",
    sourceSystem: "local",
    fields: ["action", "targetType", "targetName", "actorId", "actorName", "actorRole", "createdAt", "details"],
    sourcePath: "/api/action-log",
  },
  order_sync_job: {
    label: "订单同步任务",
    access: "admin",
    sourceSystem: "local",
    fields: ["status", "days", "warehouseIds", "createdAt", "startedAt", "completedAt", "progress", "results"],
    sourcePath: "/api/orders/sync-jobs/latest",
  },
  notification_robot: {
    label: "企业微信机器人",
    access: "admin",
    sourceSystem: "local",
    fields: ["name", "enabled", "createdAt", "updatedAt", "lastSentAt", "lastError"],
    sourcePath: "/api/wecom-notifications",
  },
  notification_schedule: {
    label: "企业微信通知计划",
    access: "admin",
    sourceSystem: "local",
    fields: ["name", "enabled", "mode", "time", "intervalMinutes", "createdAt", "updatedAt", "lastSentAt"],
    sourcePath: "/api/wecom-notifications",
  },
};

const PAGE_DEFINITIONS = [
  ["dashboard", "经营总览", "经营指标、同步状态和风险摘要。", ["admin"]],
  ["inventory", "库存同步", "WMS 库存同步和 SKU 治理。", ["admin"]],
  ["inventory-snapshots", "库存快照", "按日期查看库存快照。", ["admin"]],
  ["order-analysis", "订单分析", "订单趋势、店铺、平台和产品分析。", ["admin"]],
  ["movement", "动销监控", "当前 SKU 动销和仓库诊断。", ["admin"]],
  ["movement-analysis", "动销分析", "历史动销快照和趋势。", ["admin"]],
  ["stockup", "备货中心", "备货建议、决策和计划。", ["admin"]],
  ["products", "产品库", "按当前用户权限展示产品目录。", ["guest", "distributor", "direct", "admin"]],
  ["qualifications", "资质库", "产品资质和附件。", ["distributor", "direct", "admin"]],
  ["assets", "素材库", "产品图片和源文件。", ["distributor", "direct", "admin"]],
  ["warehouse-info", "仓库信息", "仓库地址、时区和营业信息。", ["distributor", "direct", "admin"]],
  ["quick-nav", "快捷导航", "内部常用网页工具。", ["guest", "distributor", "direct", "admin"]],
  ["tongzhou-ai", "同舟AI", "文本、图片和视频 AI 工具。", ["guest", "distributor", "direct", "admin"]],
  ["api-access", "API 接入", "Agent API 文档、个人密钥和同步示例。", ["distributor", "direct", "admin"]],
  ["warehouses", "仓库授权", "WMS 仓库连接和授权。", ["admin"]],
  ["users", "用户管理", "账号、角色和状态管理。", ["admin"]],
  ["wecom-notifications", "企业微信通知", "机器人、计划和业务场景通知。", ["admin"]],
  ["action-log", "操作日志", "关键管理操作审计记录。", ["admin"]],
];

const BLOCKED_KEY = /password|passwordhash|secret|token|webhook|credential|authorization|api[-_]?key|app[-_]?key|access[-_]?key|clientsecret|client_secret/i;

class AgentIndexError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) return text(value.value, fallback);
    return text(value.name || value.title || value.username || value.nickname, fallback);
  }
  return String(value).trim() || fallback;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value, fallback = "") {
  const raw = text(value);
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function rawValue(record, key) {
  return record?.[key] ?? record?.raw?.[key];
}

function recordCreatedAt(record, fallback) {
  return iso(
    record?.created_at ||
    record?.createdAt ||
    record?.createTime ||
    rawValue(record, "createTime") ||
    rawValue(record, "created_at") ||
    rawValue(record, "_created_at"),
    fallback,
  );
}

function recordUpdatedAt(record, fallback) {
  return iso(
    record?.updated_at ||
    record?.updatedAt ||
    record?.updateTime ||
    record?.syncedAt ||
    record?.capturedAt ||
    rawValue(record, "updateTime") ||
    rawValue(record, "updated_at") ||
    rawValue(record, "_updated_at"),
    fallback,
  );
}

function recordOwner(record) {
  return text(
    record?.owner ||
    record?.creator ||
    record?.actorName ||
    record?.displayName ||
    rawValue(record, "creator") ||
    rawValue(record, "updater"),
  );
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stableObject(value));
}

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function sanitizeForAgent(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeForAgent(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "raw" && !BLOCKED_KEY.test(key))
      .map(([key, entry]) => [key, sanitizeForAgent(entry, depth + 1)])
      .filter(([, entry]) => entry !== undefined),
  );
}

function accessRoles(access) {
  if (access === "admin") return ["admin"];
  if (access === "partner") return ["distributor", "direct", "admin"];
  return ["guest", "distributor", "direct", "admin"];
}

function canAccess(definition, auth) {
  return accessRoles(definition.access).includes(auth?.role || "guest");
}

function scopeForAuth(auth) {
  const role = auth?.role || "guest";
  const visibleTypes = Object.entries(TYPE_DEFINITIONS)
    .filter(([, definition]) => canAccess(definition, auth))
    .map(([type]) => type)
    .sort();
  const value = {
    role,
    user_id: auth?.user?.id || "",
    visible_types: visibleTypes,
  };
  return {
    ...value,
    checksum: hash(value),
  };
}

function makeId(type, sourceSystem, nativeId) {
  const safeNativeId = text(nativeId) || hash({ type, sourceSystem }).slice(0, 24);
  return `${type}:${sourceSystem}:${encodeURIComponent(safeNativeId)}`;
}

function mimeFromFile(file = {}) {
  const explicit = text(file.mimeType || file.contentType);
  if (explicit) return explicit;
  const extension = extname(text(file.name || file.url || file.fileId)).toLowerCase();
  const types = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".csv": "text/csv",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".zip": "application/zip",
    ".rar": "application/vnd.rar",
  };
  return types[extension] || "application/octet-stream";
}

function attachmentStatus(mimeType) {
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "metadata_only";
  if (mimeType === "application/pdf" || mimeType.startsWith("image/")) return "not_extracted";
  if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) return "unsupported";
  if (mimeType === "application/zip" || mimeType === "application/vnd.rar") return "unsupported";
  return "metadata_only";
}

function normalizeAttachment(file, parentId, index) {
  if (!file) return null;
  const value = typeof file === "string" ? { url: file, name: basename(file) } : file;
  const name = text(value.name || value.filename || value.fileName, `附件 ${index + 1}`);
  const url = text(value.url || value.downloadUrl || value.fileUrl || value.previewUrl);
  const fileId = text(value.fileId || value.file_id || value.id || value._id);
  const mimeType = mimeFromFile({ ...value, name, url, fileId });
  const identity = fileId || (url ? hash(url) : `${parentId}:${index}:${name}`);
  return {
    id: `attachment:${encodeURIComponent(identity)}`,
    name,
    url,
    file_id: fileId,
    mime_type: mimeType,
    size: number(value.size, 0),
    checksum: text(value.checksum),
    extraction_status: attachmentStatus(mimeType),
    searchable_text: name,
    extracted_text: "",
    extraction_error: "",
    // TODO(agent-index): plug a local PDF text/OCR worker into this stable shape.
  };
}

function filesForRecord(type, record) {
  const files = [];
  if (type === "static_asset") files.push(record);
  if (type === "qualification" || type === "asset") files.push(...(record.files || []));
  if (["product_base", "product_catalog", "wms_product", "movement_item"].includes(type)) {
    if (record.imageUrl) files.push({ name: `${text(record.name || record.sku, "产品")} 图片`, url: record.imageUrl });
    if (record.qualificationImageUrl) files.push({ name: `${text(record.name || record.sku, "产品")} 资质图`, url: record.qualificationImageUrl });
  }
  return files;
}

function nativeIdentity(type, record, index) {
  return nativeIdentityInfo(type, record, index).value;
}

function nativeIdentityInfo(type, record, index) {
  const id = text(record?.id);
  if (["product_base", "product_catalog", "qualification", "asset", "warehouse_info", "outsourcing_order"].includes(type)) {
    const value = id || text(record?.sku || record?.orderNo);
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "wms_product" || type === "inventory_position") {
    const value = [record.warehouseId, record.goodsSkuId || record.sku, record.providerWarehouseCode].filter(Boolean).join("::");
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "order_line") {
    const lineIdentity = [
      record.providerId,
      record.warehouseId,
      record.orderId || record.orderNo,
      record.lineId || record.itemId || record.goodsSkuId || record.sku,
    ].filter((entry) => entry !== undefined && entry !== "").join("::");
    return lineIdentity
      ? { value: hash(lineIdentity), fallback: false }
      : { value: `line-${index}-${hash(sanitizeForAgent(record)).slice(0, 16)}`, fallback: true };
  }
  if (type === "inventory_snapshot" || type === "movement_snapshot") {
    const value = text(record.date)
      ? [record.date, record.timezone || "default"].join("::")
      : "";
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "movement_item") {
    const value = id || [record.country, record.sku || record.countrySku].filter(Boolean).join("::");
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "stockup_recommendation") {
    const value = text(record.recommendationKey) || [record.country, record.sku || record.countrySku].filter(Boolean).join("::");
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "stockup_decision") {
    const value = text(record.recommendationKey || record.key) || id;
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "repo_document") {
    const value = text(record.path);
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "static_asset") {
    const value = text(record.path);
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  if (type === "page") {
    const value = text(record.route);
    return value
      ? { value, fallback: false }
      : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
  }
  const stableValue = id || text(record.recommendationKey || record.orderNo || record.username);
  return stableValue
    ? { value: stableValue, fallback: false }
    : { value: hash(sanitizeForAgent(record)).slice(0, 24), fallback: true };
}

function titleFor(type, record) {
  const valuesByType = {
    page: [record.title],
    repo_document: [record.title, record.path],
    static_asset: [record.name, record.path],
    product_base: [record.name, record.sku],
    product_catalog: [record.name, record.sku],
    qualification: [record.qualificationName, record.productName, record.sku],
    asset: [record.assetName, record.productName, record.sku],
    warehouse_info: [record.warehouseName, record.warehouseCode],
    wms_product: [record.name, record.sku],
    inventory_position: [record.sku, record.countrySku],
    order_line: [record.orderNo, record.orderId],
    inventory_snapshot: [`库存快照 ${text(record.date)}`],
    movement_snapshot: [`动销快照 ${text(record.date)} ${text(record.timezone)}`],
    movement_item: [record.name, record.sku],
    stockup_recommendation: [record.name, record.sku],
    stockup_plan: [record.name, record.sku],
    stockup_decision: [record.name, record.sku, record.recommendationKey],
    stockup_order: [record.orderNo, record.sku],
    outsourcing_order: [record.orderNo, record.productName, record.tongzhouSku],
    user: [record.displayName, record.username],
    distributor_application: [record.companyName, record.contactName],
    warehouse_connection: [record.name, record.id],
    quick_nav_category: [record.name],
    quick_nav_link: [record.title],
    action_log: [record.action, record.targetName],
    order_sync_job: [record.id, record.status],
    notification_robot: [record.name],
    notification_schedule: [record.name],
  };
  return (valuesByType[type] || [record.title, record.name, record.id]).map(text).find(Boolean) || TYPE_DEFINITIONS[type].label;
}

function bodyValues(type, record) {
  const ignored = new Set(["id", "raw", "passwordHash", "credentials"]);
  const preferred = TYPE_DEFINITIONS[type].fields || [];
  const values = [];
  for (const key of preferred) {
    if (key === "content") values.push(record.content);
    else if (key === "prices") values.push(record.distributionPrice, record.salesPrice, record.directPrice);
    else if (key === "addresses") values.push(record.shopShippingAddress, record.shopReturnAddress, record.firstMileReceivingAddress);
    else if (key === "workTime") values.push(record.workStartTime, record.workEndTime);
    else values.push(record[key]);
  }
  if (!values.some((value) => text(value))) {
    for (const [key, value] of Object.entries(record || {})) {
      if (!ignored.has(key) && !BLOCKED_KEY.test(key) && typeof value !== "object") values.push(value);
    }
  }
  return values.map((value) => text(value)).filter(Boolean);
}

function statusFor(record) {
  return text(record.status || record.decisionStatus || record.lastTestStatus);
}

function recordUrl(type, record) {
  if (type === "quick_nav_link") return text(record.url);
  if (type === "static_asset") return text(record.url);
  if (type === "repo_document") return "";
  return text(record.publicUrl);
}

function buildEnvelope(type, record, source, index) {
  const definition = TYPE_DEFINITIONS[type];
  const sourceSystem = text(source.sourceSystem, definition.sourceSystem);
  const nativeId = nativeIdentity(type, record, index);
  const id = makeId(type, sourceSystem, nativeId);
  const safeData = sanitizeForAgent(record);
  const sourceUpdatedAt = iso(source.updatedAt);
  const updatedAt = recordUpdatedAt(record, sourceUpdatedAt || source.observedAt);
  const createdAt = recordCreatedAt(record, updatedAt || source.observedAt);
  const title = titleFor(type, safeData);
  const body = bodyValues(type, safeData).join("\n");
  const attachments = filesForRecord(type, safeData)
    .map((file, fileIndex) => normalizeAttachment(file, id, fileIndex))
    .filter(Boolean);
  const declaredPermissions = Array.isArray(safeData.allowedRoles)
    ? safeData.allowedRoles.filter((role) => ["guest", "distributor", "direct", "admin"].includes(role))
    : [];
  const permissions = declaredPermissions.length ? declaredPermissions : accessRoles(definition.access);
  const visibility = permissions.includes("guest")
    ? "public"
    : permissions.length === 1 && permissions[0] === "admin"
      ? "admin"
      : "partner";
  const sourcePath = ["repo_document", "static_asset"].includes(type) ? safeData.path : definition.sourcePath;
  const checksum = hash({
    type,
    nativeId,
    title,
    body,
    sourcePath,
    createdAt,
    updatedAt,
    owner: recordOwner(safeData),
    status: statusFor(safeData),
    data: safeData,
    attachments,
    permissions,
  });
  return {
    id,
    type,
    title,
    display_name: title,
    body,
    searchable_text: [title, body, nativeId, attachments.map((item) => item.searchable_text).join(" ")].filter(Boolean).join("\n"),
    url: recordUrl(type, safeData),
    source_path: sourcePath,
    created_at: createdAt,
    updated_at: updatedAt,
    owner: recordOwner(safeData),
    permissions,
    acl: {
      visibility,
      allowed_roles: permissions,
      policy_version: "1",
    },
    visibility,
    source_system: sourceSystem,
    source_id: nativeId,
    checksum,
    version: checksum.slice(0, 16),
    status: statusFor(safeData),
    attachments,
    data: safeData,
    metadata: {
      observed_at: source.observedAt,
      source_updated_at: recordUpdatedAt(record, ""),
      source_collection_updated_at: sourceUpdatedAt,
      timestamp_basis: recordUpdatedAt(record, "") ? "source" : "observed",
    },
  };
}

function pagination(searchParams) {
  const page = Math.max(1, Math.floor(number(searchParams.get("page"), 1)));
  const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(number(searchParams.get("limit"), DEFAULT_PAGE_SIZE))));
  return { page, limit };
}

function timeValue(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function filterRecords(records, searchParams, { forceUpdatedSince = "" } = {}) {
  const query = text(searchParams.get("q")).toLowerCase();
  const status = text(searchParams.get("status")).toLowerCase();
  const owner = text(searchParams.get("owner")).toLowerCase();
  const updatedSince = timeValue(forceUpdatedSince || searchParams.get("updated_since") || searchParams.get("since"));
  const updatedBefore = timeValue(searchParams.get("updated_before"));
  const createdSince = timeValue(searchParams.get("created_since"));
  const createdBefore = timeValue(searchParams.get("created_before"));
  return records.filter((record) => {
    if (query && !`${record.searchable_text}\n${stableJson(record.data)}`.toLowerCase().includes(query)) return false;
    if (status && text(record.status).toLowerCase() !== status) return false;
    if (owner && !text(record.owner).toLowerCase().includes(owner)) return false;
    const updatedAt = timeValue(record.updated_at);
    const createdAt = timeValue(record.created_at);
    if (updatedSince !== null && (updatedAt === null || updatedAt <= updatedSince)) return false;
    if (updatedBefore !== null && (updatedAt === null || updatedAt >= updatedBefore)) return false;
    if (createdSince !== null && (createdAt === null || createdAt <= createdSince)) return false;
    if (createdBefore !== null && (createdAt === null || createdAt >= createdBefore)) return false;
    return true;
  });
}

function pagePayload(records, searchParams) {
  const { page, limit } = pagination(searchParams);
  const total = records.length;
  const start = (page - 1) * limit;
  const items = records.slice(start, start + limit);
  return {
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    has_more: start + items.length < total,
    items,
  };
}

function typeListFromQuery(searchParams, auth) {
  const requested = text(searchParams.get("types") || searchParams.get("type"));
  const candidates = requested
    ? requested.split(",").map((item) => item.trim()).filter(Boolean)
    : Object.keys(TYPE_DEFINITIONS);
  return [...new Set(candidates)].filter((type) => TYPE_DEFINITIONS[type] && canAccess(TYPE_DEFINITIONS[type], auth));
}

function sourceDigest(records) {
  return hash(records.map((record) => `${record.id}:${record.checksum}`).sort().join("\n"));
}

function requiredFieldMissing(record) {
  return REQUIRED_NONEMPTY_RECORD_FIELDS
    .filter((key) => {
      const value = record[key];
      return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
    });
}

function canonicalRecordSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: REQUIRED_RECORD_FIELDS,
    properties: Object.fromEntries(
      Object.entries(STANDARD_FIELDS).map(([field, description]) => [
        field,
        {
          type: STANDARD_FIELD_TYPES[field] || "string",
          description,
          ...(field === "permissions" ? { items: { type: "string" } } : {}),
          ...(field === "attachments" ? { items: { type: "object" } } : {}),
        },
      ]),
    ),
  };
}

function openApiDocument() {
  const typeEnum = Object.keys(TYPE_DEFINITIONS);
  const paginationProperties = {
    page: { type: "integer", minimum: 1 },
    limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE },
    total: { type: "integer", minimum: 0 },
    total_pages: { type: "integer", minimum: 1 },
    has_more: { type: "boolean" },
    items: {
      type: "array",
      items: { $ref: "#/components/schemas/AgentRecord" },
    },
  };
  const listParameters = [
    { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE } },
    { name: "q", in: "query", schema: { type: "string" } },
    { name: "status", in: "query", schema: { type: "string" } },
    { name: "owner", in: "query", schema: { type: "string" } },
    { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } },
    { name: "updated_before", in: "query", schema: { type: "string", format: "date-time" } },
    { name: "created_since", in: "query", schema: { type: "string", format: "date-time" } },
    { name: "created_before", in: "query", schema: { type: "string", format: "date-time" } },
  ];
  const pagedResponse = {
    description: "分页结果",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            ...paginationProperties,
          },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "同舟供应链 Agent Index API",
      version: INDEX_VERSION,
      description: "权限感知的只读内部数据索引 API。使用登录用户创建的 Agent API Key，不会绕过当前角色和账号状态。",
    },
    servers: [{ url: "/", description: "当前同舟供应链服务" }],
    security: [{ agentBearer: [] }],
    tags: [
      { name: "Discovery", description: "资源发现与 Schema" },
      { name: "Resources", description: "按类型读取业务记录" },
      { name: "Sync", description: "全量、增量和删除同步" },
    ],
    paths: {
      "/.well-known/agent-index.json": {
        get: {
          tags: ["Discovery"],
          operationId: "discoverAgentIndex",
          security: [],
          responses: { 200: { description: "Agent 索引 manifest" } },
        },
      },
      "/api/agent/manifest": {
        get: {
          tags: ["Discovery"],
          operationId: "getAgentManifest",
          responses: { 200: { description: "当前身份可访问的资源 manifest" } },
        },
      },
      "/api/agent/resources/{type}": {
        get: {
          tags: ["Resources"],
          operationId: "listAgentResources",
          parameters: [
            { name: "type", in: "path", required: true, schema: { type: "string", enum: typeEnum } },
            ...listParameters,
          ],
          responses: { 200: pagedResponse, 401: { description: "当前身份无权访问该资源" } },
        },
      },
      "/api/agent/resources/{type}/{id}": {
        get: {
          tags: ["Resources"],
          operationId: "getAgentResourceById",
          parameters: [
            { name: "type", in: "path", required: true, schema: { type: "string", enum: typeEnum } },
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            200: {
              description: "完整记录",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      item: { $ref: "#/components/schemas/AgentRecord" },
                    },
                  },
                },
              },
            },
            404: { description: "记录不存在或当前用户不可见" },
          },
        },
      },
      "/api/agent/search": {
        get: {
          tags: ["Resources"],
          operationId: "searchAgentResources",
          parameters: [
            { name: "types", in: "query", schema: { type: "string", description: "逗号分隔的资源类型" } },
            ...listParameters,
          ],
          responses: { 200: pagedResponse },
        },
      },
      "/api/agent/updated_since": {
        get: {
          tags: ["Sync"],
          operationId: "getUpdatedAgentResources",
          parameters: [
            { name: "since", in: "query", required: true, schema: { type: "string", format: "date-time" } },
            { name: "types", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE } },
          ],
          responses: { 200: pagedResponse },
        },
      },
      "/api/agent/deleted_since": {
        get: {
          tags: ["Sync"],
          operationId: "getDeletedAgentResources",
          parameters: [
            { name: "since", in: "query", required: true, schema: { type: "string", format: "date-time" } },
            { name: "types", in: "query", schema: { type: "string" } },
            { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE } },
          ],
          responses: { 200: { ...pagedResponse, description: "本地删除 tombstone 分页结果" } },
        },
      },
      "/api/agent/coverage": {
        get: {
          tags: ["Sync"],
          operationId: "getAgentCoverage",
          parameters: [{ name: "types", in: "query", schema: { type: "string" } }],
          responses: { 200: { description: "源记录与可枚举记录覆盖率" } },
        },
      },
    },
    components: {
      securitySchemes: {
        agentBearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Tongzhou Agent API Key",
          description: "在站内“API 接入”页面创建，以 tzai_ 开头。",
        },
      },
      schemas: {
        AgentRecord: canonicalRecordSchema(),
      },
    },
  };
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, payload) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
  renameSync(temporaryPath, path);
}

function recursiveFiles(directory, accepts) {
  if (!existsSync(directory)) return [];
  const results = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && accepts(path)) results.push(path);
    }
  }
  return results.sort();
}

function repositoryDocuments(rootDir) {
  const candidates = new Set(
    ["README.md", "部署更新说明.md"]
      .map((path) => resolve(rootDir, path))
      .filter(existsSync),
  );
  for (const path of recursiveFiles(resolve(rootDir, "docs"), (entry) => entry.toLowerCase().endsWith(".md"))) {
    candidates.add(path);
  }
  return [...candidates].map((path) => {
    const stats = statSync(path);
    const relativePath = relative(rootDir, path).replaceAll("\\", "/");
    const content = readFileSync(path, "utf8");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return {
      path: relativePath,
      title: heading || basename(path),
      content,
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
      owner: "repository",
    };
  });
}

function repositoryStaticAssets(rootDir) {
  const publicDir = resolve(rootDir, "public");
  const supportedExtensions = new Set([
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".mp4",
    ".webm",
  ]);
  return recursiveFiles(publicDir, (path) => supportedExtensions.has(extname(path).toLowerCase()))
    .map((path) => {
      const stats = statSync(path);
      const relativePath = relative(rootDir, path).replaceAll("\\", "/");
      const publicPath = `/${relative(publicDir, path).replaceAll("\\", "/")}`;
      return {
        id: relativePath,
        path: relativePath,
        name: basename(path),
        url: publicPath,
        mimeType: mimeFromFile({ name: path }),
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        owner: "repository",
      };
    });
}

function builtInSource(type, auth, rootDir, observedAt) {
  if (type === "page") {
    const appSourcePath = resolve(rootDir, "src", "App.tsx");
    const sourceStats = existsSync(appSourcePath) ? statSync(appSourcePath) : null;
    const createdAt = sourceStats?.birthtime.toISOString() || observedAt;
    const updatedAt = sourceStats?.mtime.toISOString() || observedAt;
    return {
      records: PAGE_DEFINITIONS
        .filter(([, , , roles]) => roles.includes(auth?.role || "guest"))
        .map(([route, title, description, roles]) => ({
          route: `#${route}`,
          title,
          description,
          allowedRoles: roles,
          createdAt,
          updatedAt,
        })),
      updatedAt,
      observedAt,
      sourceSystem: "frontend",
    };
  }
  if (type === "repo_document") {
    return {
      records: repositoryDocuments(rootDir),
      updatedAt: observedAt,
      observedAt,
      sourceSystem: "repository",
    };
  }
  if (type === "static_asset") {
    const records = repositoryStaticAssets(rootDir);
    return {
      records,
      updatedAt: records.map((record) => record.updatedAt).sort().at(-1) || observedAt,
      observedAt,
      sourceSystem: "repository",
    };
  }
  return null;
}

export function createAgentIndexLayer({
  cacheDir,
  rootDir = process.cwd(),
  getAuth,
  getSource,
  sendJson,
}) {
  const observedAt = new Date().toISOString();
  const tombstonePath = resolve(cacheDir, "agent-deletions.json");
  let tombstoneStore = readJson(tombstonePath, { version: 1, updated_at: "", deletions: [] });

  function manifest(auth, { discovery = false } = {}) {
    const scope = scopeForAuth(auth);
    return {
      ok: true,
      product: "tongzhou-agent-index",
      version: INDEX_VERSION,
      generated_at: new Date().toISOString(),
      discovery,
      authentication: {
        type: "http",
        scheme: "bearer",
        description: "复用当前系统 Bearer token；资源可见性按当前用户角色实时计算。",
      },
      endpoints: {
        manifest: "/api/agent/manifest",
        openapi: "/api/agent/openapi.json",
        list: "/api/agent/resources/{type}?page=1&limit=100",
        get_by_id: "/api/agent/resources/{type}/{id}",
        search: "/api/agent/search?q={keyword}&types={type1,type2}",
        updated_since: "/api/agent/updated_since?since={iso8601}&types={type1,type2}",
        deleted_since: "/api/agent/deleted_since?since={iso8601}&types={type1,type2}",
        coverage: "/api/agent/coverage",
      },
      incremental: {
        updated_since_field: "updated_at",
        deleted_since_support: "local_mutations_only",
        notes: "简道云/WMS 暂无源端 CDC；当前不会根据不完整同步推断删除。",
      },
      authorization_scope: scope,
      standard_fields: STANDARD_FIELDS,
      record_schema: canonicalRecordSchema(),
      resources: Object.entries(TYPE_DEFINITIONS).map(([type, definition]) => ({
        type,
        label: definition.label,
        indexable: true,
        accessible: canAccess(definition, auth),
        fields: Object.fromEntries(
          definition.fields.map((field) => [
            field,
            {
              type: ["string", "number", "boolean", "array", "object", "null"],
              description: `沿用 ${definition.sourcePath} 的 ${field} 业务字段。`,
            },
          ]),
        ),
        primary_key: "id",
        source_id_field: "source_id",
        updated_at_field: "updated_at",
        permissions_field: "acl",
        visibility: definition.access,
        allowed_roles: accessRoles(definition.access),
        source_system: definition.sourceSystem,
        list_endpoint: `/api/agent/resources/${type}`,
        detail_endpoint: `/api/agent/resources/${type}/{id}`,
        search_endpoint: `/api/agent/search?types=${type}`,
        updated_since_endpoint: `/api/agent/updated_since?types=${type}&since={iso8601}`,
        deleted_since_endpoint: `/api/agent/deleted_since?types=${type}&since={iso8601}`,
      })),
      excluded_secret_types: [
        { type: "user_password", indexable: false, exclusion_reason: "认证秘密" },
        { type: "warehouse_credentials", indexable: false, exclusion_reason: "外部系统认证秘密" },
        { type: "ai_api_key", indexable: false, exclusion_reason: "外部服务认证秘密" },
        { type: "agent_api_key", indexable: false, exclusion_reason: "用户 Agent 认证秘密及其哈希" },
        { type: "notification_webhook", indexable: false, exclusion_reason: "通知通道认证秘密" },
        { type: "session_token", indexable: false, exclusion_reason: "当前登录凭据" },
      ],
    };
  }

  function collectType(type, auth) {
    const definition = TYPE_DEFINITIONS[type];
    if (!definition) throw new AgentIndexError(404, `未知的 Agent 资源类型：${type}`);
    if (!canAccess(definition, auth)) throw new AgentIndexError(401, `当前用户无权访问 ${type}。`);
    const builtIn = builtInSource(type, auth, rootDir, observedAt);
    const source = builtIn || getSource(type, auth) || { records: [] };
    const records = Array.isArray(source.records) ? source.records : [];
    const seen = new Map();
    let duplicateBaseIds = 0;
    let fallbackIds = 0;
    const envelopes = records.map((record, index) => {
      const identity = nativeIdentityInfo(type, record, index);
      if (identity.fallback) fallbackIds += 1;
      const envelope = buildEnvelope(type, record, {
        sourceSystem: source.sourceSystem || definition.sourceSystem,
        updatedAt: source.updatedAt || source.syncedAt || "",
        observedAt: source.observedAt || source.updatedAt || source.syncedAt || observedAt,
      }, index);
      const count = seen.get(envelope.id) || 0;
      seen.set(envelope.id, count + 1);
      if (count > 0) {
        duplicateBaseIds += 1;
        envelope.id = `${envelope.id}:duplicate:${count + 1}`;
        envelope.checksum = hash({ id: envelope.id, checksum: envelope.checksum });
        envelope.version = envelope.checksum.slice(0, 16);
      }
      return envelope;
    }).sort((left, right) => left.id.localeCompare(right.id));
    return {
      records: envelopes,
      stats: {
        source_count: records.length,
        enumerable_count: envelopes.length,
        unique_id_count: new Set(envelopes.map((record) => record.id)).size,
        duplicate_base_id_count: duplicateBaseIds,
        fallback_id_count: fallbackIds,
        source_updated_at: source.updatedAt || source.syncedAt || "",
        source_complete: source.complete !== false,
        source_warning: source.warning || "",
      },
    };
  }

  function collectTypes(types, auth) {
    return types.flatMap((type) => collectType(type, auth).records);
  }

  function deletionsSince(searchParams, auth) {
    const since = timeValue(searchParams.get("since") || searchParams.get("deleted_since"));
    if (since === null) throw new AgentIndexError(400, "deleted_since 需要有效的 since ISO 时间。");
    const types = new Set(typeListFromQuery(searchParams, auth));
    return (tombstoneStore.deletions || [])
      .filter((entry) => types.has(entry.type))
      .filter((entry) => (timeValue(entry.deleted_at) || 0) > since)
      .sort((left, right) => String(left.deleted_at).localeCompare(String(right.deleted_at)));
  }

  function recordDeletion({
    type,
    nativeId,
    sourceSystem = "",
    deletedAt = new Date().toISOString(),
    reason = "deleted",
  }) {
    const definition = TYPE_DEFINITIONS[type];
    if (!definition || !nativeId) return null;
    const id = makeId(type, sourceSystem || definition.sourceSystem, nativeId);
    const tombstone = {
      id,
      type,
      deleted_at: iso(deletedAt, new Date().toISOString()),
      reason,
      source_system: sourceSystem || definition.sourceSystem,
      source_id: text(nativeId),
      visibility: definition.access,
      permissions: accessRoles(definition.access),
      acl: {
        visibility: definition.access,
        allowed_roles: accessRoles(definition.access),
        policy_version: "1",
      },
    };
    tombstoneStore = {
      version: 1,
      updated_at: tombstone.deleted_at,
      deletions: [
        tombstone,
        ...(tombstoneStore.deletions || []).filter((entry) => !(entry.type === type && entry.id === id)),
      ].slice(0, MAX_TOMBSTONES),
    };
    writeJsonAtomic(tombstonePath, tombstoneStore);
    return tombstone;
  }

  function coverage(searchParams, auth) {
    const requestedTypes = typeListFromQuery(searchParams, auth);
    const types = requestedTypes.map((type) => {
      const { records, stats } = collectType(type, auth);
      const missingByField = {};
      for (const record of records) {
        for (const field of requiredFieldMissing(record)) missingByField[field] = (missingByField[field] || 0) + 1;
      }
      const pendingAttachments = records.flatMap((record) => record.attachments || [])
        .filter((attachment) => attachment.extraction_status !== "complete").length;
      const complete =
        stats.source_count === stats.enumerable_count &&
        stats.enumerable_count === stats.unique_id_count &&
        stats.duplicate_base_id_count === 0 &&
        stats.fallback_id_count === 0 &&
        Object.keys(missingByField).length === 0 &&
        stats.source_complete;
      return {
        type,
        ...stats,
        missing_required_fields: missingByField,
        pending_or_unsupported_attachments: pendingAttachments,
        digest: sourceDigest(records),
        complete,
      };
    });
    return {
      ok: types.every((item) => item.complete),
      generated_at: new Date().toISOString(),
      authorization_scope: scopeForAuth(auth),
      types,
      summary: {
        types: types.length,
        source_count: types.reduce((sum, item) => sum + item.source_count, 0),
        enumerable_count: types.reduce((sum, item) => sum + item.enumerable_count, 0),
        incomplete_types: types.filter((item) => !item.complete).map((item) => item.type),
      },
    };
  }

  async function handle(req, res, url) {
    const isDiscovery = url.pathname === "/.well-known/agent-index.json";
    const isAgentApi = url.pathname.startsWith("/api/agent/");
    if (!isDiscovery && !isAgentApi) return false;
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, message: "Agent 索引接口当前仅支持 GET。" });
      return true;
    }
    const auth = getAuth(req);
    try {
      if (url.pathname === "/api/agent/openapi.json") {
        sendJson(res, 200, openApiDocument());
        return true;
      }
      if (isDiscovery || url.pathname === "/api/agent/manifest") {
        sendJson(res, 200, manifest(auth, { discovery: isDiscovery }));
        return true;
      }

      if (url.pathname === "/api/agent/coverage") {
        sendJson(res, 200, coverage(url.searchParams, auth));
        return true;
      }

      if (url.pathname === "/api/agent/search") {
        const types = typeListFromQuery(url.searchParams, auth);
        const records = filterRecords(collectTypes(types, auth), url.searchParams);
        sendJson(res, 200, {
          ok: true,
          mode: "search",
          types,
          authorization_scope: scopeForAuth(auth),
          ...pagePayload(records, url.searchParams),
        });
        return true;
      }

      if (url.pathname === "/api/agent/updated_since") {
        const since = url.searchParams.get("since") || url.searchParams.get("updated_since") || "";
        if (timeValue(since) === null) throw new AgentIndexError(400, "updated_since 需要有效的 since ISO 时间。");
        const types = typeListFromQuery(url.searchParams, auth);
        const records = filterRecords(collectTypes(types, auth), url.searchParams, { forceUpdatedSince: since });
        sendJson(res, 200, {
          ok: true,
          mode: "updated_since",
          since: iso(since),
          types,
          authorization_scope: scopeForAuth(auth),
          ...pagePayload(records, url.searchParams),
        });
        return true;
      }

      if (url.pathname === "/api/agent/deleted_since") {
        const items = deletionsSince(url.searchParams, auth);
        sendJson(res, 200, {
          ok: true,
          mode: "deleted_since",
          since: iso(url.searchParams.get("since") || url.searchParams.get("deleted_since")),
          deletion_support: "local_mutations_only",
          authorization_scope: scopeForAuth(auth),
          ...pagePayload(items, url.searchParams),
        });
        return true;
      }

      const detailMatch = url.pathname.match(/^\/api\/agent\/resources\/([^/]+)\/(.+)$/);
      if (detailMatch) {
        const type = decodeURIComponent(detailMatch[1]);
        const id = decodeURIComponent(detailMatch[2]);
        const record = collectType(type, auth).records.find((item) => item.id === id);
        if (!record) throw new AgentIndexError(404, "Agent 记录不存在或当前用户不可见。");
        sendJson(res, 200, {
          ok: true,
          mode: "get_by_id",
          authorization_scope: scopeForAuth(auth),
          item: record,
        });
        return true;
      }

      const listMatch = url.pathname.match(/^\/api\/agent\/resources\/([^/]+)$/);
      if (listMatch) {
        const type = decodeURIComponent(listMatch[1]);
        const collected = collectType(type, auth);
        const records = filterRecords(collected.records, url.searchParams);
        sendJson(res, 200, {
          ok: true,
          mode: "list",
          type,
          source: collected.stats,
          authorization_scope: scopeForAuth(auth),
          ...pagePayload(records, url.searchParams),
        });
        return true;
      }

      throw new AgentIndexError(404, "Agent 索引接口不存在。");
    } catch (error) {
      const status = error instanceof AgentIndexError ? error.status : 500;
      sendJson(res, status, {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  return {
    handle,
    manifest,
    coverage,
    recordDeletion,
    makeId,
  };
}

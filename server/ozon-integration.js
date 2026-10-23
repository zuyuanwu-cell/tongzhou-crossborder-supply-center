import { randomUUID } from "node:crypto";

const REVIEW_STATUSES = new Set(["awaiting_packaging"]);
const RECONCILIATION_STATUSES = new Set(["awaiting_deliver"]);
const ACTIVE_STATUSES = new Set([...REVIEW_STATUSES, ...RECONCILIATION_STATUSES]);
const MAX_ORDERS = 365000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const SPECIAL_REQUIREMENT_KEYS = ["mandatoryMark", "country", "gtd", "rnpt", "imei", "weight"];

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function uniqueStrings(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean)));
}

function dateIso(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function statusOf(posting) {
  return text(posting?.status || posting?.status_alias || posting?.substatus);
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function actorId(actor) {
  return text(actor?.id || actor?.username);
}

function isAdmin(actor) {
  return actor?.role === "admin";
}

function storeAccessRole(store, actor = {}) {
  if (isAdmin(actor)) return "admin";
  const id = actorId(actor);
  if (id && store.ownerId === id) return "owner";
  if (id && store.collaboratorIds.includes(id)) return "collaborator";
  return "none";
}

function publicStore(store, actor = {}) {
  const accessRole = storeAccessRole(store, actor);
  const canManageCredentials = ["admin", "owner"].includes(accessRole);
  return {
    id: store.id,
    name: store.name,
    clientId: canManageCredentials ? store.clientId : "",
    apiKeyMasked: canManageCredentials && store.apiKey
      ? (store.apiKey.length <= 8 ? "••••••••" : `${store.apiKey.slice(0, 3)}••••${store.apiKey.slice(-3)}`)
      : "",
    hasApiKey: Boolean(store.apiKey),
    enabled: store.enabled !== false,
    ownerId: store.ownerId,
    ownerName: store.ownerName,
    collaboratorIds: canManageCredentials ? [...store.collaboratorIds] : [],
    accessRole,
    canManageCredentials,
    companyName: store.companyName,
    connectedAt: store.connectedAt,
    lastTestedAt: store.lastTestedAt,
    lastSyncedAt: store.lastSyncedAt,
    lastError: store.lastError,
    ozonWarehouses: store.ozonWarehouses || [],
  };
}

function normalizeStore(value = {}) {
  return {
    id: text(value.id) || `ozon-store-${randomUUID()}`,
    name: text(value.name),
    clientId: text(value.clientId),
    apiKey: text(value.apiKey),
    enabled: value.enabled !== false,
    ownerId: text(value.ownerId),
    ownerName: text(value.ownerName),
    collaboratorIds: uniqueStrings(value.collaboratorIds).filter((id) => id !== text(value.ownerId)),
    companyName: text(value.companyName),
    connectedAt: dateIso(value.connectedAt),
    lastTestedAt: dateIso(value.lastTestedAt),
    lastSyncedAt: dateIso(value.lastSyncedAt),
    lastError: text(value.lastError),
    ozonWarehouses: (Array.isArray(value.ozonWarehouses) ? value.ozonWarehouses : []).map((warehouse) => ({
      id: text(warehouse.id || warehouse.warehouseId || warehouse.warehouse_id),
      name: text(warehouse.name || warehouse.warehouseName),
      status: text(warehouse.status),
      isRfbs: Boolean(warehouse.isRfbs ?? warehouse.is_rfbs),
    })).filter((warehouse) => warehouse.id),
  };
}

function normalizeRoute(value = {}) {
  return {
    storeId: text(value.storeId),
    ozonWarehouseId: text(value.ozonWarehouseId),
    ozonWarehouseName: text(value.ozonWarehouseName),
    warehouseConnectionId: text(value.warehouseConnectionId),
    platformShop: text(value.platformShop),
    wmsWarehouseCode: text(value.wmsWarehouseCode),
    shippingMethod: text(value.shippingMethod),
    recipient: {
      countryCode: text(value.recipient?.countryCode || "RU").toUpperCase() || "RU",
      province: text(value.recipient?.province),
      city: text(value.recipient?.city),
      district: text(value.recipient?.district),
      address1: text(value.recipient?.address1),
      address2: text(value.recipient?.address2),
      zipcode: text(value.recipient?.zipcode),
      name: text(value.recipient?.name),
      phone: text(value.recipient?.phone),
      email: text(value.recipient?.email),
    },
    updatedAt: dateIso(value.updatedAt),
    updatedBy: text(value.updatedBy),
  };
}

function normalizeSkuMapping(value = {}) {
  return {
    storeId: text(value.storeId),
    warehouseConnectionId: text(value.warehouseConnectionId),
    offerId: text(value.offerId),
    ozonSku: text(value.ozonSku),
    productName: text(value.productName),
    wmsSku: text(value.wmsSku).toUpperCase(),
    updatedAt: dateIso(value.updatedAt),
    updatedBy: text(value.updatedBy),
  };
}

function normalizeOrder(value = {}) {
  return {
    id: text(value.id || value.postingNumber),
    storeId: text(value.storeId),
    postingNumber: text(value.postingNumber),
    orderId: text(value.orderId),
    orderNumber: text(value.orderNumber),
    status: text(value.status),
    substatus: text(value.substatus),
    deliverySchema: text(value.deliverySchema),
    ozonWarehouseId: text(value.ozonWarehouseId),
    ozonWarehouseName: text(value.ozonWarehouseName),
    shipmentAt: dateIso(value.shipmentAt),
    createdAt: dateIso(value.createdAt),
    syncedAt: dateIso(value.syncedAt),
    trackingNumber: text(value.trackingNumber),
    multiPackage: Boolean(value.multiPackage),
    destinationPlaceName: text(value.destinationPlaceName),
    currency: text(value.currency || "RUB") || "RUB",
    saleAmount: number(value.saleAmount),
    recipient: {
      countryCode: text(value.recipient?.countryCode || "RU").toUpperCase() || "RU",
      province: text(value.recipient?.province),
      city: text(value.recipient?.city),
      district: text(value.recipient?.district),
      address1: text(value.recipient?.address1),
      address2: text(value.recipient?.address2),
      zipcode: text(value.recipient?.zipcode),
      name: text(value.recipient?.name),
      phone: text(value.recipient?.phone),
      email: text(value.recipient?.email),
    },
    products: (Array.isArray(value.products) ? value.products : []).map((product) => ({
      offerId: text(product.offerId),
      ozonSku: text(product.ozonSku),
      productId: text(product.productId || product.ozonSku),
      name: text(product.name),
      quantity: Math.max(0, Math.floor(number(product.quantity))),
      unitPrice: Math.max(0, number(product.unitPrice)),
    })).filter((product) => (product.offerId || product.ozonSku) && product.quantity > 0),
    requirements: {
      mandatoryMark: uniqueStrings(value.requirements?.mandatoryMark),
      country: uniqueStrings(value.requirements?.country),
      gtd: uniqueStrings(value.requirements?.gtd),
      rnpt: uniqueStrings(value.requirements?.rnpt),
      imei: uniqueStrings(value.requirements?.imei),
      weight: uniqueStrings(value.requirements?.weight),
    },
    schedule: value.schedule && typeof value.schedule === "object" ? {
      status: text(value.schedule.status),
      batchId: text(value.schedule.batchId),
      markedAt: dateIso(value.schedule.markedAt),
      markedBy: text(value.schedule.markedBy),
    } : null,
    fulfillment: value.fulfillment && typeof value.fulfillment === "object" ? {
      stage: text(value.fulfillment.stage),
      attempts: Math.max(0, Math.floor(number(value.fulfillment.attempts))),
      nextRetryAt: dateIso(value.fulfillment.nextRetryAt),
      lastError: text(value.fulfillment.lastError),
      errorCode: text(value.fulfillment.errorCode),
      failedStage: text(value.fulfillment.failedStage),
      updatedAt: dateIso(value.fulfillment.updatedAt),
      ozonRequestedAt: dateIso(value.fulfillment.ozonRequestedAt),
      completedAt: dateIso(value.fulfillment.completedAt),
    } : null,
    review: value.review && typeof value.review === "object" ? {
      status: text(value.review.status),
      note: text(value.review.note),
      reviewedAt: dateIso(value.review.reviewedAt),
      reviewedBy: text(value.review.reviewedBy),
    } : null,
    push: value.push && typeof value.push === "object" ? {
      status: text(value.push.status),
      wmsOrderNo: text(value.push.wmsOrderNo),
      duplicate: Boolean(value.push.duplicate),
      pushedAt: dateIso(value.push.pushedAt),
      linkedAt: dateIso(value.push.linkedAt || value.push.pushedAt),
      checkedAt: dateIso(value.push.checkedAt),
      pushedBy: text(value.push.pushedBy),
      lastError: text(value.push.lastError),
      payloadHash: text(value.push.payloadHash),
      wmsStatus: text(value.push.wmsStatus),
      platform: text(value.push.platform),
      platformShop: text(value.push.platformShop),
      warehouseCode: text(value.push.warehouseCode),
      shippingMethod: text(value.push.shippingMethod),
    } : null,
    timeline: (Array.isArray(value.timeline) ? value.timeline : []).slice(-40).map((entry) => ({
      at: dateIso(entry.at),
      action: text(entry.action),
      actor: text(entry.actor),
      note: text(entry.note),
    })),
  };
}

function normalizeScheduleRule(value = {}) {
  const weekdays = Array.from(new Set((Array.isArray(value.weekdays) ? value.weekdays : [])
    .map((item) => Math.floor(number(item))).filter((item) => item >= 1 && item <= 7))).sort((a, b) => a - b);
  const cutoffTimes = uniqueStrings(value.cutoffTimes).filter((item) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)).sort();
  return {
    id: text(value.id) || `ozon-rule-${randomUUID()}`,
    storeId: text(value.storeId),
    ozonWarehouseId: text(value.ozonWarehouseId),
    name: text(value.name),
    timezone: "Asia/Shanghai",
    weekdays: weekdays.length ? weekdays : [1, 2, 3, 4, 5, 6, 7],
    cutoffTimes,
    enabled: value.enabled !== false,
    lastGeneratedAt: dateIso(value.lastGeneratedAt),
    createdAt: dateIso(value.createdAt),
    updatedAt: dateIso(value.updatedAt),
    updatedBy: text(value.updatedBy),
  };
}

function normalizeScheduleBatch(value = {}) {
  return {
    id: text(value.id) || `ozon-batch-${randomUUID()}`,
    ruleId: text(value.ruleId),
    storeId: text(value.storeId),
    ozonWarehouseId: text(value.ozonWarehouseId),
    scheduledFor: text(value.scheduledFor),
    status: text(value.status || "draft") || "draft",
    orderNumbers: uniqueStrings(value.orderNumbers),
    confirmedOrderNumbers: uniqueStrings(value.confirmedOrderNumbers),
    exclusions: (Array.isArray(value.exclusions) ? value.exclusions : []).map((item) => ({
      postingNumber: text(item?.postingNumber),
      reasons: uniqueStrings(item?.reasons),
    })).filter((item) => item.postingNumber),
    createdAt: dateIso(value.createdAt),
    createdBy: text(value.createdBy),
    confirmedAt: dateIso(value.confirmedAt),
    confirmedBy: text(value.confirmedBy),
    updatedAt: dateIso(value.updatedAt),
  };
}

function normalizeTaskEvent(value = {}) {
  return {
    id: text(value.id) || `ozon-event-${randomUUID()}`,
    storeId: text(value.storeId),
    postingNumber: text(value.postingNumber),
    stage: text(value.stage),
    level: ["info", "warning", "error", "success"].includes(value.level) ? value.level : "info",
    code: text(value.code),
    message: text(value.message),
    actor: text(value.actor),
    at: dateIso(value.at),
    updatedAt: dateIso(value.updatedAt || value.at),
  };
}

export function normalizeOzonState(value = {}) {
  return {
    version: 3,
    updatedAt: dateIso(value.updatedAt),
    stores: (Array.isArray(value.stores) ? value.stores : []).map(normalizeStore).filter((store) => store.id),
    routes: (Array.isArray(value.routes) ? value.routes : []).map(normalizeRoute)
      .filter((route) => route.storeId && route.ozonWarehouseId),
    skuMappings: (Array.isArray(value.skuMappings) ? value.skuMappings : []).map(normalizeSkuMapping)
      .filter((mapping) => mapping.storeId && mapping.warehouseConnectionId && (mapping.offerId || mapping.ozonSku)),
    orders: (Array.isArray(value.orders) ? value.orders : []).map(normalizeOrder)
      .filter((order) => order.storeId && order.postingNumber).slice(0, MAX_ORDERS),
    scheduleRules: (Array.isArray(value.scheduleRules) ? value.scheduleRules : []).map(normalizeScheduleRule)
      .filter((rule) => rule.storeId && rule.ozonWarehouseId),
    scheduleBatches: (Array.isArray(value.scheduleBatches) ? value.scheduleBatches : []).map(normalizeScheduleBatch)
      .filter((batch) => batch.storeId && batch.ruleId).slice(0, 10000),
    taskEvents: (Array.isArray(value.taskEvents) ? value.taskEvents : []).map(normalizeTaskEvent)
      .filter((event) => event.storeId).slice(0, 20000),
  };
}

export class OzonApiError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "OzonApiError";
    this.status = status;
    this.code = code;
  }
}

async function ozonRequest(fetchImpl, store, path, body = {}, { timeoutMs = 25000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`https://api-seller.ozon.ru${path}`, {
      method: "POST",
      headers: {
        "Client-Id": store.clientId,
        "Api-Key": store.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new OzonApiError("Ozon 接口请求超时，请稍后重试。", 504, "TIMEOUT");
    throw new OzonApiError(`Ozon 接口连接失败：${error instanceof Error ? error.message : "网络异常"}`, 502, "NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }
  if (!response.ok) {
    const message = text(payload?.message || payload?.error?.message || raw).slice(0, 260);
    if (response.status === 401 || response.status === 403) throw new OzonApiError(`Ozon 授权失败：${message || "请检查 Client-Id、Api-Key 及密钥角色"}`, response.status, text(payload?.code));
    if (response.status === 429) throw new OzonApiError("Ozon 接口请求过于频繁，请稍后重试。", 429, text(payload?.code));
    throw new OzonApiError(`Ozon 接口返回 ${response.status}：${message || "未知错误"}`, response.status, text(payload?.code));
  }
  return payload;
}

function warehousesFromPayload(payload) {
  const rows = Array.isArray(payload?.result) ? payload.result
    : Array.isArray(payload?.warehouses) ? payload.warehouses
      : Array.isArray(payload?.result?.warehouses) ? payload.result.warehouses : [];
  return rows.map((warehouse) => ({
    id: text(warehouse.warehouse_id || warehouse.warehouseId || warehouse.id),
    name: text(warehouse.name || warehouse.warehouse_name),
    status: text(warehouse.status),
    isRfbs: Boolean(warehouse.is_rfbs ?? warehouse.isRfbs),
  })).filter((warehouse) => warehouse.id);
}

async function fetchOzonWarehouses(fetchImpl, store) {
  const warehouses = [];
  let cursor = "";
  for (let page = 0; page < 10; page += 1) {
    const response = await ozonRequest(fetchImpl, store, "/v2/warehouse/list", {
      limit: 200,
      cursor,
    });
    warehouses.push(...warehousesFromPayload(response));
    const nextCursor = text(response?.cursor);
    if (!response?.has_next || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
    if (page === 9) throw new Error("Ozon 仓库数量超过 2000 个，请联系管理员检查店铺配置。");
  }
  return warehouses;
}

function companyNameFromPayload(payload) {
  const company = firstObject(payload?.company, payload?.result?.company, payload?.result);
  return text(company.name || company.company_name || company.companyName || company.legal_name);
}

function postingRows(payload) {
  if (Array.isArray(payload?.postings)) return payload.postings;
  if (Array.isArray(payload?.result?.postings)) return payload.result.postings;
  if (Array.isArray(payload?.result?.result?.postings)) return payload.result.result.postings;
  return [];
}

function postingCursor(payload) {
  return text(payload?.cursor || payload?.result?.cursor || payload?.result?.result?.cursor);
}

function postingHasNext(payload) {
  return Boolean(payload?.has_next ?? payload?.result?.has_next ?? payload?.result?.result?.has_next);
}

function normalizeOzonPosting(posting, storeId) {
  const delivery = firstObject(posting?.delivery_method, posting?.deliveryMethod);
  const analytics = firstObject(posting?.analytics_data, posting?.analyticsData);
  const addressee = firstObject(posting?.addressee, posting?.customer?.addressee);
  const customer = firstObject(posting?.customer);
  const address = firstObject(customer.address, addressee.address, posting?.address);
  const products = Array.isArray(posting?.products) ? posting.products : [];
  const financialProducts = Array.isArray(posting?.financial_data?.products) ? posting.financial_data.products : [];
  const financialByProduct = new Map(financialProducts.map((item) => [text(item.product_id || item.sku), item]));
  const requirement = firstObject(posting?.requirements);
  const postingPackages = Array.isArray(posting?.packages) ? posting.packages : Array.isArray(posting?.package_data) ? posting.package_data : [];
  const normalizedProducts = products.map((product) => {
    const productId = text(product.product_id || product.sku || product.id);
    const financial = financialByProduct.get(productId) || {};
    const unitPrice = number(product.price?.units ?? product.price ?? financial.price ?? financial.customer_price);
    return {
      offerId: text(product.offer_id || product.product_offer_id || product.offerId),
      ozonSku: text(product.sku || product.product_id || product.productId),
      productId,
      name: text(product.name || product.product_name || product.productName),
      quantity: Math.max(0, Math.floor(number(product.quantity || product.number_of_units))),
      unitPrice,
    };
  }).filter((product) => (product.offerId || product.ozonSku) && product.quantity > 0);
  return normalizeOrder({
    id: text(posting?.posting_number || posting?.postingNumber),
    storeId,
    postingNumber: text(posting?.posting_number || posting?.postingNumber),
    orderId: text(posting?.order_id || posting?.orderId),
    orderNumber: text(posting?.order_number || posting?.orderNumber),
    status: statusOf(posting),
    substatus: text(posting?.substatus || posting?.status_transcription),
    deliverySchema: text(posting?.delivery_schema || posting?.deliverySchema),
    ozonWarehouseId: text(delivery.warehouse_id || analytics.warehouse_id || delivery.warehouse || analytics.warehouse),
    ozonWarehouseName: text(delivery.warehouse_name || delivery.warehouse || analytics.warehouse_name || analytics.warehouse),
    shipmentAt: posting?.shipment_date || posting?.cutoff || posting?.shipmentDate,
    createdAt: posting?.in_process_at || posting?.created_at || posting?.createdAt,
    syncedAt: nowIso(),
    trackingNumber: posting?.tracking_number,
    multiPackage: Boolean(posting?.is_multibox || posting?.is_multi_box || number(posting?.multi_box_qty) > 1 || postingPackages.length > 1),
    destinationPlaceName: posting?.destination_place_name,
    currency: products[0]?.price?.currency_code || products[0]?.marketplace_seller_price_currency_code || "RUB",
    saleAmount: normalizedProducts.reduce((sum, product) => sum + product.unitPrice * product.quantity, 0),
    recipient: {
      countryCode: address.country_code || address.countryCode || "RU",
      province: address.region || address.state || address.province || analytics.region,
      city: address.city || analytics.city,
      district: address.district,
      address1: address.address_tail || address.address || address.address1 || customer.address || posting?.destination_place_name,
      address2: address.address2,
      zipcode: address.zip_code || address.zipcode || address.postcode,
      name: addressee.name || customer.name,
      phone: addressee.phone || customer.phone,
      email: addressee.email || customer.email,
    },
    products: normalizedProducts,
    requirements: {
      mandatoryMark: requirement.products_requiring_mandatory_mark,
      country: requirement.products_requiring_country,
      gtd: requirement.products_requiring_gtd,
      rnpt: requirement.products_requiring_rnpt,
      imei: requirement.products_requiring_imei,
      weight: requirement.products_requiring_weight || requirement.products_requiring_weighing,
    },
  });
}

function russianWarehouse(connection) {
  const country = text(connection?.country).toLowerCase();
  const status = text(connection?.status).toLowerCase();
  return connection?.providerId === "yunwms_ru"
    && (country.includes("俄") || country === "ru" || country.includes("russia"))
    && !/停用|禁用|disabled|archived/.test(status);
}

function routeKey(storeId, ozonWarehouseId) {
  return `${text(storeId)}::${text(ozonWarehouseId)}`;
}

function mappingKey(storeId, warehouseConnectionId, offerId, ozonSku) {
  return `${text(storeId)}::${text(warehouseConnectionId)}::${text(offerId) || `sku:${text(ozonSku)}`}`;
}

function actorName(actor) {
  return text(actor?.displayName || actor?.username || actor?.id || actor?.roleLabel || "系统");
}

function mergeRecipient(primary = {}, fallback = {}) {
  const result = {};
  for (const key of ["countryCode", "province", "city", "district", "address1", "address2", "zipcode", "name", "phone", "email"]) {
    result[key] = text(primary[key] || fallback[key]);
  }
  result.countryCode = result.countryCode.toUpperCase() || "RU";
  return result;
}

function availableInventory(inventoryRows, warehouseId) {
  const rows = (Array.isArray(inventoryRows) ? inventoryRows : []).filter((row) => text(row.warehouseId) === text(warehouseId));
  const bySku = new Map();
  for (const row of rows) {
    const sku = text(row.sku).toUpperCase();
    if (!sku) continue;
    bySku.set(sku, (bySku.get(sku) || 0) + Math.max(0, number(row.availableQty)));
  }
  return { bySku, hasSnapshot: rows.length > 0 };
}

function availableWarehouseSkus(inventoryRows, productRows, warehouseId) {
  const rows = [...(Array.isArray(inventoryRows) ? inventoryRows : []), ...(Array.isArray(productRows) ? productRows : [])]
    .filter((row) => text(row.warehouseId) === text(warehouseId));
  const skus = new Set();
  for (const row of rows) {
    const sku = text(row.sku || row.productSku).toUpperCase();
    if (sku) skus.add(sku);
  }
  return { skus, hasCatalog: rows.length > 0 };
}

function isWmsLinked(order) {
  return ["linked", "pushed"].includes(text(order?.push?.status)) && Boolean(text(order?.push?.wmsOrderNo));
}

function skuCandidates(...values) {
  const candidates = [];
  for (const value of values) {
    const normalized = text(value).toUpperCase();
    if (!normalized) continue;
    candidates.push(normalized);
    const withoutPackSuffix = normalized.replace(/\*+\d+$/, "");
    if (withoutPackSuffix && withoutPackSuffix !== normalized) candidates.push(withoutPackSuffix);
  }
  return uniqueStrings(candidates);
}

function orderProjection(state, order, dependencies) {
  const store = state.stores.find((item) => item.id === order.storeId);
  const route = state.routes.find((item) => routeKey(item.storeId, item.ozonWarehouseId) === routeKey(order.storeId, order.ozonWarehouseId));
  const connection = dependencies.warehouseConnections().find((item) => item.id === route?.warehouseConnectionId);
  const inventory = availableInventory(dependencies.inventory(), route?.warehouseConnectionId);
  const mappings = new Map(state.skuMappings.map((mapping) => [mappingKey(mapping.storeId, mapping.warehouseConnectionId, mapping.offerId, mapping.ozonSku), mapping]));
  const routeIssues = [];
  const productIssues = [];
  if (!store || store.enabled === false) routeIssues.push("店铺授权未启用");
  if (!ACTIVE_STATUSES.has(order.status) && !isWmsLinked(order)) routeIssues.push(`Ozon 状态 ${order.status || "未知"} 不在处理中`);
  if (!order.ozonWarehouseId) routeIssues.push("Ozon 订单未返回卖家仓库 ID");
  if (!route?.warehouseConnectionId) routeIssues.push("Ozon 仓尚未绑定俄罗斯仓");
  if (!connection || !russianWarehouse(connection)) routeIssues.push("目标俄罗斯仓不可用");
  const specialRequirements = SPECIAL_REQUIREMENT_KEYS.filter((key) => order.requirements[key]?.length);
  if (REVIEW_STATUSES.has(order.status) && specialRequirements.length) {
    productIssues.push(`订单含首版不支持的特殊商品要求：${specialRequirements.join("、")}`);
  }
  if (REVIEW_STATUSES.has(order.status) && order.multiPackage) productIssues.push("订单为多包发货，首版仅支持整单单包");
  const products = order.products.map((product) => {
    const mapping = mappings.get(mappingKey(order.storeId, route?.warehouseConnectionId, product.offerId, product.ozonSku));
    const wmsSku = text(mapping?.wmsSku).toUpperCase();
    const wmsSkuExists = Boolean(wmsSku && inventory.bySku.has(wmsSku));
    const availableQty = wmsSkuExists ? inventory.bySku.get(wmsSku) || 0 : 0;
    if (!mapping?.wmsSku) productIssues.push(`${product.offerId || product.ozonSku} 未配置目标仓 SKU`);
    else if (inventory.hasSnapshot && !wmsSkuExists) productIssues.push(`${mapping.wmsSku} 不存在于目标仓库存快照`);
    else if (inventory.hasSnapshot && availableQty < product.quantity) productIssues.push(`${mapping.wmsSku} 可用库存不足（${availableQty}/${product.quantity}）`);
    return { ...product, wmsSku, wmsSkuExists, availableQty, mapped: Boolean(wmsSku) };
  });
  const workflowStage = REVIEW_STATUSES.has(order.status) ? "review"
    : RECONCILIATION_STATUSES.has(order.status) ? "reconcile" : "history";
  const issues = Array.from(new Set([...routeIssues, ...productIssues]));
  return {
    ...order,
    storeName: store?.name || "",
    targetWarehouseId: connection?.id || "",
    targetWarehouseName: connection?.name || "",
    platformShop: route?.platformShop || order.push?.platformShop || "",
    wmsWarehouseCode: route?.wmsWarehouseCode || order.push?.warehouseCode || "",
    shippingMethod: route?.shippingMethod || "",
    recipient: mergeRecipient(order.recipient, route?.recipient),
    products,
    issues,
    workflowStage,
    workflowMessage: order.fulfillment?.stage === "completed"
      ? "WMS 已到待发货，Ozon 已回查为待交运。"
      : workflowStage === "reconcile"
        ? "该订单已由外部推进到待交运，中台不会自动补写 WMS。"
        : order.schedule?.status === "confirmed"
          ? "订单已确认排单，后台正在按 WMS → Ozon 顺序处理。"
          : "订单只有进入待确认批次并由运营确认后，才允许写入 WMS。",
    ready: workflowStage === "review" && routeIssues.length === 0 && productIssues.length === 0,
    reconcileReady: ACTIVE_STATUSES.has(order.status) && routeIssues.length === 0,
    linked: isWmsLinked(order),
    inventoryChecked: inventory.hasSnapshot,
  };
}

function scopeAllowsWarehouse(actor, warehouseId) {
  const allowed = Array.isArray(actor?.dataScopes?.warehouseIds) ? actor.dataScopes.warehouseIds.map(text).filter(Boolean) : [];
  return !allowed.length || allowed.includes(text(warehouseId));
}

export function createOzonIntegrationService({
  initialState = {},
  save = () => {},
  fetchImpl = globalThis.fetch,
  warehouseConnections = () => [],
  inventory = () => [],
  warehouseProducts = () => [],
  lookupWmsOrder,
  verifyWmsOrder,
  notifyFailure = () => {},
  autoShipEnabled = false,
  clock = () => new Date(),
} = {}) {
  const dependencies = { warehouseConnections, inventory, warehouseProducts };
  let state = normalizeOzonState(initialState);
  const inFlightPushes = new Map();
  const inFlightVerifications = new Map();
  const inFlightFulfillment = new Map();
  const confirmingBatches = new Set();

  function persist() {
    state.updatedAt = clock().toISOString();
    save(state);
  }

  function accessError(message = "当前账号无权访问该 Ozon 店铺。") {
    return Object.assign(new Error(message), { statusCode: 403, code: "ozon_store_forbidden" });
  }

  function conflictError(message, code = "ozon_state_conflict") {
    return Object.assign(new Error(message), { statusCode: 409, code });
  }

  function validationError(message) {
    return Object.assign(new Error(message), { statusCode: 400, code: "ozon_validation_error" });
  }

  function findStore(storeId, actor = null, minimum = "collaborator") {
    const store = state.stores.find((item) => item.id === text(storeId));
    if (!store) throw new Error("Ozon 店铺不存在。");
    if (actor) {
      const accessRole = storeAccessRole(store, actor);
      if (accessRole === "none") throw accessError();
      if (minimum === "owner" && !["admin", "owner"].includes(accessRole)) {
        throw accessError("只有店主或管理员可以维护店铺授权与协作者。");
      }
    }
    return store;
  }

  function findOrder(postingNumber) {
    const order = state.orders.find((item) => item.postingNumber === text(postingNumber));
    if (!order) throw new Error("Ozon 发货单不存在，请先同步店铺订单。");
    return order;
  }

  function appendTimeline(order, action, actor, note = "") {
    order.timeline = [...(order.timeline || []), { at: clock().toISOString(), action, actor: actorName(actor), note: text(note) }].slice(-40);
  }

  function appendTaskEvent(order, stage, level, message, actor = {}, code = "") {
    const at = clock().toISOString();
    state.taskEvents.unshift(normalizeTaskEvent({
      id: `ozon-event-${randomUUID()}`,
      storeId: order.storeId,
      postingNumber: order.postingNumber,
      stage,
      level,
      code,
      message,
      actor: actorName(actor),
      at,
      updatedAt: at,
    }));
    state.taskEvents = state.taskEvents.slice(0, 20000);
  }

  function applyAutoMappings({ storeId, warehouseConnectionId }, actor = {}, { requireCatalog = false } = {}) {
    const store = findStore(storeId, actor, "collaborator");
    const connection = warehouseConnections().find((item) => item.id === text(warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const catalog = availableWarehouseSkus(inventory(), warehouseProducts(), connection.id);
    if (!catalog.hasCatalog && requireCatalog) throw new Error("目标仓暂无商品或库存快照，请先在库存同步中更新该仓数据。");

    const products = new Map();
    for (const product of state.orders.filter((order) => order.storeId === store.id).flatMap((order) => order.products)) {
      const key = mappingKey(store.id, connection.id, product.offerId, product.ozonSku);
      if (!products.has(key)) products.set(key, product);
    }

    let mapped = 0;
    let existing = 0;
    let unmatched = 0;
    const now = clock().toISOString();
    for (const [key, product] of products) {
      if (state.skuMappings.some((mapping) => mappingKey(mapping.storeId, mapping.warehouseConnectionId, mapping.offerId, mapping.ozonSku) === key)) {
        existing += 1;
        continue;
      }
      const wmsSku = skuCandidates(product.offerId, product.ozonSku).find((candidate) => catalog.skus.has(candidate));
      if (!wmsSku) {
        unmatched += 1;
        continue;
      }
      state.skuMappings.push(normalizeSkuMapping({
        storeId: store.id,
        warehouseConnectionId: connection.id,
        offerId: product.offerId,
        ozonSku: product.ozonSku,
        productName: product.name,
        wmsSku,
        updatedAt: now,
        updatedBy: `${actorName(actor)}（自动匹配）`,
      }));
      mapped += 1;
    }
    return { mapped, existing, unmatched, total: products.size };
  }

  function assertConfirmedSchedule(order) {
    if (order.schedule?.status !== "confirmed" || !order.schedule?.batchId) {
      throw conflictError("订单尚未由排单批次确认，禁止写入俄罗斯仓库系统。", "ozon_schedule_required");
    }
  }

  function payload(actor = {}) {
    const visibleStores = state.stores.filter((store) => storeAccessRole(store, actor) !== "none");
    const visibleStoreIds = new Set(visibleStores.map((store) => store.id));
    const connections = warehouseConnections().filter(russianWarehouse).filter((connection) => scopeAllowsWarehouse(actor, connection.id));
    const allowedWarehouseIds = new Set(connections.map((connection) => connection.id));
    const warehouseScope = Array.isArray(actor?.dataScopes?.warehouseIds)
      ? actor.dataScopes.warehouseIds.map(text).filter(Boolean)
      : [];
    const orders = state.orders.filter((order) => visibleStoreIds.has(order.storeId)).map((order) => orderProjection(state, order, dependencies))
      .filter((order) => warehouseScope.length
        ? Boolean(order.targetWarehouseId && allowedWarehouseIds.has(order.targetWarehouseId))
        : !order.targetWarehouseId || allowedWarehouseIds.has(order.targetWarehouseId));
    const products = new Map();
    for (const order of orders) {
      for (const product of order.products) {
        const key = `${order.storeId}::${product.offerId || product.ozonSku}`;
        const current = products.get(key) || {
          key,
          storeId: order.storeId,
          storeName: order.storeName,
          offerId: product.offerId,
          ozonSku: product.ozonSku,
          productName: product.name,
          orderCount: 0,
        };
        current.orderCount += 1;
        products.set(key, current);
      }
    }
    return {
      ok: true,
      updatedAt: state.updatedAt,
      automation: { autoShipEnabled, timezone: "Asia/Shanghai", maxConcurrency: 3 },
      stores: visibleStores.map((store) => publicStore(store, actor)),
      routes: state.routes.filter((route) => visibleStoreIds.has(route.storeId) && (!route.warehouseConnectionId || allowedWarehouseIds.has(route.warehouseConnectionId))),
      skuMappings: state.skuMappings.filter((mapping) => visibleStoreIds.has(mapping.storeId) && (!mapping.warehouseConnectionId || allowedWarehouseIds.has(mapping.warehouseConnectionId))),
      scheduleRules: state.scheduleRules.filter((rule) => visibleStoreIds.has(rule.storeId)),
      scheduleBatches: state.scheduleBatches.filter((batch) => visibleStoreIds.has(batch.storeId)).slice(0, 500),
      taskEvents: state.taskEvents.filter((event) => visibleStoreIds.has(event.storeId)).slice(0, 500),
      warehouses: connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        warehouseCode: text(connection.warehouseCode || connection.resolvedWarehouseId),
        status: text(connection.status),
      })),
      products: Array.from(products.values()),
      orders,
      summary: {
        stores: visibleStores.filter((store) => store.enabled !== false).length,
        pending: orders.filter((order) => !order.linked).length,
        ready: orders.filter((order) => order.ready && order.review?.status !== "approved" && !order.linked).length,
        approved: orders.filter((order) => order.review?.status === "approved" && !order.linked).length,
        pushed: orders.filter((order) => order.linked).length,
        blocked: orders.filter((order) => order.workflowStage === "review" && !order.ready && !order.linked).length,
        draftBatches: state.scheduleBatches.filter((batch) => visibleStoreIds.has(batch.storeId) && batch.status === "draft").length,
        processing: orders.filter((order) => order.schedule?.status === "confirmed" && order.fulfillment?.stage !== "completed").length,
        completed: orders.filter((order) => order.fulfillment?.stage === "completed").length,
        exceptions: orders.filter((order) => order.fulfillment?.stage === "error" || order.issues.length).length,
      },
    };
  }

  function upsertStore(input, actor = {}) {
    const requestedName = text(input?.name);
    const requestedClientId = text(input?.clientId);
    const requestedApiKey = text(input?.apiKey);
    if (requestedName.length > 120) throw validationError("店铺名称不能超过 120 个字符。");
    if (requestedClientId.length > 160) throw validationError("Ozon Client-Id 长度异常。");
    if (requestedApiKey.length > 4096) throw validationError("Ozon Api-Key 长度异常。");
    const id = text(input?.id);
    const existing = id ? state.stores.find((item) => item.id === id) : null;
    if (existing) findStore(existing.id, actor, "owner");
    const next = normalizeStore({
      ...existing,
      ...input,
      id: existing?.id || id || `ozon-store-${randomUUID()}`,
      apiKey: text(input?.apiKey) || existing?.apiKey || "",
      ownerId: existing?.ownerId || actorId(actor),
      ownerName: existing?.ownerName || actorName(actor),
      collaboratorIds: existing?.collaboratorIds || [],
      connectedAt: existing?.connectedAt || "",
      lastTestedAt: existing?.lastTestedAt || "",
      lastSyncedAt: existing?.lastSyncedAt || "",
      ozonWarehouses: existing?.ozonWarehouses || [],
    });
    if (!next.name) throw new Error("请填写店铺名称。");
    if (!next.clientId) throw new Error("请填写 Ozon Client-Id。");
    if (!next.apiKey) throw new Error("请填写 Ozon Api-Key。");
    if (existing) Object.assign(existing, next);
    else state.stores.unshift(next);
    persist();
    return publicStore(next, actor);
  }

  function saveStoreCollaborators(storeId, collaboratorIds, actor = {}) {
    const store = findStore(storeId, actor, "owner");
    const nextCollaboratorIds = uniqueStrings(collaboratorIds).filter((id) => id !== store.ownerId);
    if (nextCollaboratorIds.length > 100 || nextCollaboratorIds.some((id) => id.length > 128)) {
      throw validationError("协作者列表超过允许范围。");
    }
    store.collaboratorIds = nextCollaboratorIds;
    persist();
    return publicStore(store, actor);
  }

  function assignStoreOwner(storeId, owner, actor = {}) {
    if (!isAdmin(actor)) throw accessError("只有管理员可以转移 Ozon 店铺归属。");
    const store = findStore(storeId);
    store.ownerId = text(owner?.id);
    store.ownerName = text(owner?.displayName || owner?.username);
    store.collaboratorIds = store.collaboratorIds.filter((id) => id !== store.ownerId);
    persist();
    return publicStore(store, actor);
  }

  function deleteStore(storeId, actor = {}) {
    findStore(storeId, actor, "owner");
    state.stores = state.stores.filter((store) => store.id !== text(storeId));
    state.routes = state.routes.filter((route) => route.storeId !== text(storeId));
    state.skuMappings = state.skuMappings.filter((mapping) => mapping.storeId !== text(storeId));
    state.orders = state.orders.filter((order) => order.storeId !== text(storeId));
    state.scheduleRules = state.scheduleRules.filter((rule) => rule.storeId !== text(storeId));
    state.scheduleBatches = state.scheduleBatches.filter((batch) => batch.storeId !== text(storeId));
    state.taskEvents = state.taskEvents.filter((event) => event.storeId !== text(storeId));
    persist();
  }

  async function testStore(storeId, actor = null) {
    const store = findStore(storeId, actor, "owner");
    const [seller, warehouses] = await Promise.all([
      ozonRequest(fetchImpl, store, "/v1/seller/info", {}),
      fetchOzonWarehouses(fetchImpl, store),
    ]);
    store.companyName = companyNameFromPayload(seller) || store.companyName;
    store.ozonWarehouses = warehouses;
    store.lastTestedAt = clock().toISOString();
    store.connectedAt = store.connectedAt || store.lastTestedAt;
    store.lastError = "";
    persist();
    return publicStore(store, actor || { role: "admin" });
  }

  async function syncStore(storeId, actor = null) {
    const store = findStore(storeId, actor, "collaborator");
    if (store.enabled === false) throw new Error("该 Ozon 店铺已停用。");
    const end = new Date(clock().getTime() + 24 * 60 * 60 * 1000).toISOString();
    const start = new Date(clock().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let cursor = "";
    const rows = [];
    try {
      for (let page = 0; page < 20; page += 1) {
        const response = await ozonRequest(fetchImpl, store, "/v4/posting/fbs/list", {
          sort_dir: "asc",
          filter: {
            since: start,
            to: end,
            statuses: Array.from(ACTIVE_STATUSES),
          },
          limit: 100,
          cursor,
          translit: false,
          with: {
            analytics_data: true,
            barcodes: true,
            financial_data: true,
            legal_info: false,
            translit: false,
          },
        });
        rows.push(...postingRows(response));
        const nextCursor = postingCursor(response);
        if (!postingHasNext(response) || !nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
        if (page === 19) throw new Error("Ozon 待处理订单超过 2000 单，请缩小店铺范围后再同步。");
      }
      const previousByPosting = new Map(state.orders.filter((order) => order.storeId === store.id).map((order) => [order.postingNumber, order]));
      const synced = rows.map((row) => {
        const normalized = normalizeOzonPosting(row, store.id);
        const previous = previousByPosting.get(normalized.postingNumber);
        return normalizeOrder({
          ...normalized,
          review: previous?.review,
          push: previous?.push,
          schedule: previous?.schedule,
          fulfillment: previous?.fulfillment || (normalized.status === "awaiting_deliver" ? {
            stage: "external_awaiting_deliver",
            attempts: 0,
            nextRetryAt: "",
            lastError: "",
            errorCode: "",
            updatedAt: normalized.syncedAt,
          } : null),
          timeline: previous?.timeline,
        });
      }).filter((order) => order.postingNumber && ACTIVE_STATUSES.has(order.status));
      const syncedNumbers = new Set(synced.map((order) => order.postingNumber));
      const retainedHistory = state.orders.filter((order) => order.storeId === store.id && !syncedNumbers.has(order.postingNumber));
      state.orders = [
        ...state.orders.filter((order) => order.storeId !== store.id),
        ...synced,
        ...retainedHistory,
      ].sort((a, b) => text(b.createdAt || b.syncedAt).localeCompare(text(a.createdAt || a.syncedAt))).slice(0, MAX_ORDERS);
      store.ozonWarehouses = await fetchOzonWarehouses(fetchImpl, store);
      store.lastSyncedAt = clock().toISOString();
      store.lastError = "";
      const mappingResult = state.routes
        .filter((route) => route.storeId === store.id && route.warehouseConnectionId)
        .reduce((summary, route) => {
          const result = applyAutoMappings({ storeId: store.id, warehouseConnectionId: route.warehouseConnectionId }, actor || { role: "admin" });
          summary.mapped += result.mapped;
          summary.existing += result.existing;
          summary.unmatched += result.unmatched;
          summary.total += result.total;
          return summary;
        }, { mapped: 0, existing: 0, unmatched: 0, total: 0 });
      persist();
      return { store: publicStore(store, actor || { role: "admin" }), count: synced.length, autoMapped: mappingResult.mapped, mapping: mappingResult };
    } catch (error) {
      store.lastError = error instanceof Error ? error.message : "Ozon 同步失败";
      persist();
      if ([401, 403].includes(number(error?.status || error?.statusCode))) {
        void Promise.resolve(notifyFailure({
          store,
          order: { postingNumber: "店铺授权", fulfillment: null },
          stage: "store_authorization",
          error: store.lastError,
          code: text(error?.code),
        })).catch(() => {});
      }
      throw error;
    }
  }

  function saveRoute(input, actor = {}) {
    const store = findStore(input?.storeId, actor, "collaborator");
    const ozonWarehouseId = text(input?.ozonWarehouseId);
    if (!ozonWarehouseId) throw new Error("请选择 Ozon 卖家仓。");
    const connection = warehouseConnections().find((item) => item.id === text(input?.warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const next = normalizeRoute({ ...input, storeId: store.id, updatedAt: clock().toISOString(), updatedBy: actorName(actor) });
    const index = state.routes.findIndex((route) => routeKey(route.storeId, route.ozonWarehouseId) === routeKey(next.storeId, next.ozonWarehouseId));
    if (index >= 0) state.routes[index] = next;
    else state.routes.push(next);
    applyAutoMappings({ storeId: store.id, warehouseConnectionId: connection.id }, actor);
    persist();
    return next;
  }

  function saveSkuMapping(input, actor = {}) {
    const store = findStore(input?.storeId, actor, "collaborator");
    const connection = warehouseConnections().find((item) => item.id === text(input?.warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const next = normalizeSkuMapping({ ...input, storeId: store.id, updatedAt: clock().toISOString(), updatedBy: actorName(actor) });
    if (!next.offerId && !next.ozonSku) throw new Error("缺少 Ozon 商品标识。");
    if (!next.wmsSku) throw new Error("请填写目标仓 SKU。");
    if ([next.offerId, next.ozonSku, next.wmsSku].some((value) => text(value).length > 256)) {
      throw validationError("SKU 或商品标识长度不能超过 256 个字符。");
    }
    const key = mappingKey(next.storeId, next.warehouseConnectionId, next.offerId, next.ozonSku);
    const index = state.skuMappings.findIndex((mapping) => mappingKey(mapping.storeId, mapping.warehouseConnectionId, mapping.offerId, mapping.ozonSku) === key);
    if (index >= 0) state.skuMappings[index] = next;
    else state.skuMappings.push(next);
    persist();
    return next;
  }

  function autoMap({ storeId, warehouseConnectionId }, actor = {}) {
    const result = applyAutoMappings({ storeId, warehouseConnectionId }, actor, { requireCatalog: true });
    if (result.mapped) persist();
    return result;
  }

  function saveScheduleRule(input, actor = {}) {
    const store = findStore(input?.storeId, actor, "collaborator");
    const existing = text(input?.id) ? state.scheduleRules.find((item) => item.id === text(input.id)) : null;
    if (existing && existing.storeId !== store.id) throw accessError();
    const next = normalizeScheduleRule({
      ...existing,
      ...input,
      id: existing?.id || text(input?.id) || `ozon-rule-${randomUUID()}`,
      storeId: store.id,
      createdAt: existing?.createdAt || clock().toISOString(),
      updatedAt: clock().toISOString(),
      updatedBy: actorName(actor),
    });
    if (!store.ozonWarehouses.some((warehouse) => warehouse.id === next.ozonWarehouseId)) {
      throw new Error("排单规则选择的 Ozon 卖家仓不属于该店铺。");
    }
    if (next.name.length > 120) throw validationError("排单规则名称不能超过 120 个字符。");
    if (next.cutoffTimes.length > 12) throw validationError("每条规则最多配置 12 个截单点。");
    if (!next.cutoffTimes.length) throw new Error("请至少配置一个北京时间截单点。");
    const index = state.scheduleRules.findIndex((item) => item.id === next.id);
    if (index >= 0) state.scheduleRules[index] = next;
    else state.scheduleRules.unshift(next);
    persist();
    return next;
  }

  function deleteScheduleRule(ruleId, actor = {}) {
    const rule = state.scheduleRules.find((item) => item.id === text(ruleId));
    if (!rule) throw new Error("排单规则不存在。");
    findStore(rule.storeId, actor, "collaborator");
    if (state.scheduleBatches.some((batch) => batch.ruleId === rule.id && batch.status === "draft")) {
      throw conflictError("该规则仍有待确认批次，请先确认或等待处理后再删除。", "ozon_rule_has_draft");
    }
    state.scheduleRules = state.scheduleRules.filter((item) => item.id !== rule.id);
    persist();
  }

  function shanghaiParts(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    const day = new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() || 7;
    return { dateKey, day, time: `${parts.hour}:${parts.minute}` };
  }

  function buildScheduleBatch(rule, scheduledFor, actor = {}) {
    const existing = state.scheduleBatches.find((batch) => batch.ruleId === rule.id && batch.scheduledFor === scheduledFor);
    if (existing) return { batch: existing, created: false };
    const candidates = state.orders.filter((order) => order.storeId === rule.storeId
      && order.ozonWarehouseId === rule.ozonWarehouseId
      && order.status === "awaiting_packaging"
      && order.schedule?.status !== "confirmed"
      && order.fulfillment?.stage !== "completed");
    const orderNumbers = [];
    const exclusions = [];
    for (const order of candidates) {
      const projected = orderProjection(state, order, dependencies);
      if (projected.ready) orderNumbers.push(order.postingNumber);
      else exclusions.push({ postingNumber: order.postingNumber, reasons: projected.issues });
    }
    const now = clock().toISOString();
    const batch = normalizeScheduleBatch({
      id: `ozon-batch-${randomUUID()}`,
      ruleId: rule.id,
      storeId: rule.storeId,
      ozonWarehouseId: rule.ozonWarehouseId,
      scheduledFor,
      status: "draft",
      orderNumbers,
      exclusions,
      createdAt: now,
      createdBy: actorName(actor),
      updatedAt: now,
    });
    state.scheduleBatches.unshift(batch);
    rule.lastGeneratedAt = now;
    rule.updatedAt = now;
    return { batch, created: true };
  }

  function evaluateScheduleRules({ ruleId = "", force = false, at = null } = {}, actor = { role: "admin", id: "ozon-scheduler", displayName: "Ozon 排单任务" }) {
    const date = at ? new Date(at) : clock();
    if (Number.isNaN(date.getTime())) throw new Error("排单时间无效。");
    const local = shanghaiParts(date);
    const rules = state.scheduleRules.filter((rule) => (!ruleId || rule.id === text(ruleId)) && (force || rule.enabled));
    const results = [];
    let changed = false;
    let created = 0;
    for (const rule of rules) {
      findStore(rule.storeId, actor, "collaborator");
      if (!force && (!rule.weekdays.includes(local.day) || !rule.cutoffTimes.includes(local.time))) continue;
      const scheduledFor = force ? `manual:${date.toISOString()}` : `${local.dateKey}T${local.time}+08:00`;
      const result = buildScheduleBatch(rule, scheduledFor, actor);
      results.push(result.batch);
      changed ||= result.created;
      if (result.created) created += 1;
    }
    if (changed) persist();
    return { created, batches: results };
  }

  async function confirmScheduleBatch(batchId, input = {}, actor = {}) {
    const batch = state.scheduleBatches.find((item) => item.id === text(batchId));
    if (!batch) throw new Error("排单批次不存在。");
    const store = findStore(batch.storeId, actor, "collaborator");
    if (batch.status !== "draft") throw conflictError("排单批次已经确认，不能重复提交。", "ozon_batch_already_confirmed");
    if (confirmingBatches.has(batch.id)) throw conflictError("该批次正在复核 Ozon 最新状态，请勿重复提交。", "ozon_batch_confirming");
    const requested = uniqueStrings(input.orderNumbers);
    const selected = requested.length ? batch.orderNumbers.filter((postingNumber) => requested.includes(postingNumber)) : [...batch.orderNumbers];
    const confirmedOrderNumbers = [];
    const newExclusions = [];
    const validatedOrders = [];
    confirmingBatches.add(batch.id);
    try {
      for (const postingNumber of selected) {
        const order = findOrder(postingNumber);
        const projected = orderProjection(state, order, dependencies);
        if (order.status !== "awaiting_packaging" || !projected.ready || order.schedule?.status === "confirmed") {
          newExclusions.push({ postingNumber, reasons: projected.issues.length ? projected.issues : ["订单状态已变化或已被其他批次排单"] });
          continue;
        }
        try {
          const detail = await fetchPostingDetail(store, postingNumber);
          if (detail.status !== "awaiting_packaging") {
            newExclusions.push({ postingNumber, reasons: [`Ozon 最新状态为 ${detail.status || "未知"}，已停止排单`] });
            continue;
          }
          validateShipDetail(order, detail);
          validatedOrders.push({ order, detail });
        } catch (error) {
          newExclusions.push({ postingNumber, reasons: [error instanceof Error ? error.message : "Ozon 最新状态复核失败"] });
        }
      }
      if (!validatedOrders.length) throw conflictError("所选订单均已失效或被阻塞，没有订单进入排单队列。", "ozon_batch_empty");
      const now = clock().toISOString();
      for (const { order, detail } of validatedOrders) {
        order.status = detail.status;
        order.substatus = detail.substatus;
        order.syncedAt = detail.syncedAt || now;
        order.schedule = { status: "confirmed", batchId: batch.id, markedAt: now, markedBy: actorName(actor) };
        order.fulfillment = {
          stage: "queued_wms",
          attempts: 0,
          nextRetryAt: "",
          lastError: "",
          errorCode: "",
          failedStage: "",
          updatedAt: now,
          ozonRequestedAt: "",
          completedAt: "",
        };
        appendTimeline(order, "schedule_confirmed", actor, `排单批次 ${batch.id}`);
        appendTaskEvent(order, "confirmed", "success", "运营已确认排单，订单进入 WMS 处理队列。", actor);
        confirmedOrderNumbers.push(order.postingNumber);
      }
      batch.status = "confirmed";
      batch.confirmedOrderNumbers = confirmedOrderNumbers;
      batch.exclusions = [...batch.exclusions, ...newExclusions];
      batch.confirmedAt = now;
      batch.confirmedBy = actorName(actor);
      batch.updatedAt = now;
      persist();
      return batch;
    } finally {
      confirmingBatches.delete(batch.id);
    }
  }

  function reviewOrder(postingNumber, input = {}, actor = {}) {
    void input;
    void actor;
    findOrder(postingNumber);
    throw conflictError("单订单审核入口已停用，请通过待确认排单批次统一确认。", "ozon_batch_confirmation_required");
  }

  async function pushOrder(postingNumber, actor = {}) {
    const normalizedPosting = text(postingNumber);
    if (inFlightPushes.has(normalizedPosting)) return inFlightPushes.get(normalizedPosting);
    const job = (async () => {
      const order = findOrder(normalizedPosting);
      findStore(order.storeId, actor, "collaborator");
      assertConfirmedSchedule(order);
      if (isWmsLinked(order)) return orderProjection(state, order, dependencies);
      const projected = orderProjection(state, order, dependencies);
      if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权查询该仓订单。");
      if (!projected.reconcileReady) throw new Error(`订单当前不满足 WMS 查询条件：${projected.issues.join("；")}`);
      if (typeof lookupWmsOrder !== "function") throw new Error("俄罗斯仓订单查询能力尚未配置。");
      const connection = warehouseConnections().find((item) => item.id === projected.targetWarehouseId);
      order.push = {
        ...(order.push || {}),
        status: "checking",
        wmsOrderNo: "",
        duplicate: true,
        pushedAt: "",
        linkedAt: "",
        checkedAt: clock().toISOString(),
        pushedBy: actorName(actor),
        lastError: "",
      };
      appendTimeline(order, "wms_lookup_started", actor, `${projected.targetWarehouseName} · ${projected.postingNumber}`);
      persist();
      try {
        const result = await lookupWmsOrder(connection, projected.postingNumber);
        if (!result?.found || !text(result.orderNo)) {
          order.push = {
            ...order.push,
            status: "waiting_sync",
            checkedAt: clock().toISOString(),
            lastError: "",
          };
          order.fulfillment = { ...order.fulfillment, stage: "wms_pending", nextRetryAt: new Date(clock().getTime() + 60_000).toISOString(), updatedAt: clock().toISOString() };
          appendTimeline(order, "wms_waiting_sync", actor, "WMS 暂未返回该单，等待已绑定的 Ozon 店铺自动同步");
          persist();
          return orderProjection(state, order, dependencies);
        }
        const route = state.routes.find((item) => routeKey(item.storeId, item.ozonWarehouseId) === routeKey(order.storeId, order.ozonWarehouseId));
        if (text(result.platform) && text(result.platform).toUpperCase() !== "OZON") {
          throw new Error(`WMS 返回的平台为 ${text(result.platform)}，与 Ozon 不一致，已停止关联。`);
        }
        if (text(route?.platformShop) && text(result.platformShop) && text(route.platformShop) !== text(result.platformShop)) {
          throw new Error(`WMS 店铺 ${text(result.platformShop)} 与当前路由绑定的店铺不一致，已停止关联。`);
        }
        if (text(route?.wmsWarehouseCode) && text(result.warehouseCode) && text(route.wmsWarehouseCode) !== text(result.warehouseCode)) {
          throw new Error(`WMS 仓库 ${text(result.warehouseCode)} 与当前路由绑定的仓库不一致，已停止关联。`);
        }
        const expectedLines = new Map(projected.products.filter((product) => product.wmsSku).map((product) => [product.wmsSku, product.quantity]));
        const actualLines = new Map((Array.isArray(result.items) ? result.items : []).map((item) => [text(item.sku).toUpperCase(), number(item.quantity)]).filter(([sku]) => sku));
        const wmsStatus = text(result.status).toUpperCase();
        const released = ["W", "D"].includes(wmsStatus);
        if (expectedLines.size === projected.products.length && actualLines.size) {
          const mismatched = Array.from(expectedLines).filter(([sku, quantity]) => actualLines.get(sku) !== quantity);
          if (released && (mismatched.length || expectedLines.size !== actualLines.size)) {
            throw new Error("WMS 订单商品明细与中台审核的 SKU / 数量不一致，已停止关联，请人工核对。");
          }
        }
        order.push = {
          ...order.push,
          status: released ? "linked" : "ready_for_verification",
          wmsOrderNo: text(result.orderNo),
          duplicate: true,
          linkedAt: released ? clock().toISOString() : "",
          checkedAt: clock().toISOString(),
          lastError: "",
          wmsStatus,
          platform: text(result.platform),
          platformShop: text(result.platformShop),
          warehouseCode: text(result.warehouseCode),
          shippingMethod: text(result.shippingMethod),
        };
        order.fulfillment = {
          ...order.fulfillment,
          stage: released ? "wms_ready" : "wms_verifying",
          nextRetryAt: released ? "" : new Date(clock().getTime() + 60_000).toISOString(),
          lastError: "",
          errorCode: "",
          updatedAt: clock().toISOString(),
        };
        if (route) {
          route.platformShop = route.platformShop || text(result.platformShop);
          route.wmsWarehouseCode = route.wmsWarehouseCode || text(result.warehouseCode);
          route.shippingMethod = route.shippingMethod || text(result.shippingMethod);
        }
        appendTimeline(order, released ? "wms_linked" : "wms_ready_for_verification", actor, released
          ? `${projected.targetWarehouseName} · ${result.orderNo}`
          : `${projected.targetWarehouseName} · ${result.orderNo} · 等待设定 SKU 并审单`);
        persist();
        return orderProjection(state, order, dependencies);
      } catch (error) {
        order.push = { ...order.push, status: "failed", checkedAt: clock().toISOString(), lastError: error instanceof Error ? error.message : "WMS 订单查询失败" };
        appendTimeline(order, "wms_lookup_failed", actor, order.push.lastError);
        persist();
        throw error;
      }
    })().finally(() => inFlightPushes.delete(normalizedPosting));
    inFlightPushes.set(normalizedPosting, job);
    return job;
  }

  async function verifyOrderInWms(postingNumber, actor = {}) {
    const normalizedPosting = text(postingNumber);
    if (inFlightVerifications.has(normalizedPosting)) return inFlightVerifications.get(normalizedPosting);
    const job = (async () => {
      const order = findOrder(normalizedPosting);
      findStore(order.storeId, actor, "collaborator");
      assertConfirmedSchedule(order);
      if (isWmsLinked(order)) return orderProjection(state, order, dependencies);
      const projected = orderProjection(state, order, dependencies);
      if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权审单到该仓库。");
      if (!ACTIVE_STATUSES.has(order.status)) throw new Error(`Ozon 状态 ${order.status || "未知"} 不允许审单。`);
      if (projected.issues.length || projected.products.some((product) => !product.wmsSku)) {
        throw new Error(`订单尚未通过 WMS 审单校验：${projected.issues.join("；") || "存在未映射 SKU"}`);
      }
      if (typeof verifyWmsOrder !== "function") throw new Error("俄罗斯仓修改与审单能力尚未配置。");
      const connection = warehouseConnections().find((item) => item.id === projected.targetWarehouseId);
      if (!connection) throw new Error("目标俄罗斯仓连接不存在，已停止审单。");
      const route = state.routes.find((item) => routeKey(item.storeId, item.ozonWarehouseId) === routeKey(order.storeId, order.ozonWarehouseId));
      order.push = {
        ...(order.push || {}),
        status: "configuring",
        checkedAt: clock().toISOString(),
        pushedBy: actorName(actor),
        lastError: "",
      };
      order.fulfillment = { ...order.fulfillment, stage: "wms_verifying", nextRetryAt: "", updatedAt: clock().toISOString() };
      appendTimeline(order, "wms_verification_started", actor, `${projected.targetWarehouseName} · ${projected.postingNumber}`);
      persist();
      try {
        const result = await verifyWmsOrder(connection, {
          referenceNo: projected.postingNumber,
          orderNumber: projected.orderNumber,
          platformShop: route?.platformShop || projected.platformShop,
          warehouseCode: route?.wmsWarehouseCode || projected.wmsWarehouseCode,
          shippingMethod: route?.shippingMethod || projected.shippingMethod,
          recipient: projected.recipient,
          description: `Ozon ${projected.postingNumber}`,
          remark: `同舟中台由 ${actorName(actor)} 设定 SKU 并审单`,
          lines: projected.products.map((product) => ({
            sku: product.wmsSku,
            quantity: product.quantity,
            productName: product.name,
            offerId: product.offerId,
            unitPrice: product.unitPrice,
          })),
        });
        if (!result?.found || !text(result.orderNo)) {
          const generationRequested = result?.generationRequested === true;
          const platformPending = result?.platformPending === true;
          if (route) {
            route.platformShop = route.platformShop || text(result?.platformShop);
            route.wmsWarehouseCode = route.wmsWarehouseCode || text(result?.warehouseCode);
            route.shippingMethod = route.shippingMethod || text(result?.shippingMethod);
            route.updatedAt = clock().toISOString();
            route.updatedBy = actorName(actor);
          }
          order.push = {
            ...order.push,
            status: generationRequested ? "generation_pending" : platformPending ? "platform_pending" : "waiting_sync",
            wmsOrderNo: "",
            checkedAt: clock().toISOString(),
            lastError: "",
          };
          order.fulfillment = {
            ...order.fulfillment,
            stage: "wms_pending",
            nextRetryAt: new Date(clock().getTime() + 60_000).toISOString(),
            updatedAt: clock().toISOString(),
          };
          appendTimeline(order, generationRequested ? "wms_generation_pending" : platformPending ? "wms_platform_pending" : "wms_waiting_sync", actor,
            generationRequested
              ? "WMS 已接收正式出库单生成请求，等待开放接口返回结果"
              : platformPending
                ? "WMS 已拉取平台订单，当前处于待生成订单"
                : "WMS 尚未返回该 Ozon 订单，本次没有执行任何写入");
          persist();
          return orderProjection(state, order, dependencies);
        }
        if (text(result.platform) && text(result.platform).toUpperCase() !== "OZON") {
          throw new Error(`WMS 返回的平台为 ${text(result.platform)}，与 Ozon 不一致，已停止审单。`);
        }
        if (text(route?.platformShop) && text(result.platformShop) && text(route.platformShop) !== text(result.platformShop)) {
          throw new Error(`WMS 店铺 ${text(result.platformShop)} 与当前路由店铺不一致，已停止审单。`);
        }
        if (text(route?.wmsWarehouseCode) && text(result.warehouseCode) && text(route.wmsWarehouseCode) !== text(result.warehouseCode)) {
          throw new Error(`WMS 仓库 ${text(result.warehouseCode)} 与当前路由仓库不一致，已停止审单。`);
        }
        const expectedLines = new Map(projected.products.map((product) => [text(product.wmsSku).toUpperCase(), number(product.quantity)]));
        const actualLines = new Map((Array.isArray(result.items) ? result.items : []).map((item) => [text(item.sku).toUpperCase(), number(item.quantity)]).filter(([sku]) => sku));
        const mismatched = Array.from(expectedLines).filter(([sku, quantity]) => actualLines.get(sku) !== quantity);
        if (result.pendingConfirmation !== true && (mismatched.length || expectedLines.size !== actualLines.size)) {
          throw new Error("WMS 回查的 SKU / 数量与中台不一致，请勿重复点击并联系管理员核对。");
        }
        const verified = ["W", "D"].includes(text(result.status).toUpperCase()) && result.pendingConfirmation !== true;
        if (route) {
          route.platformShop = route.platformShop || text(result.platformShop);
          route.wmsWarehouseCode = route.wmsWarehouseCode || text(result.warehouseCode);
          route.shippingMethod = route.shippingMethod || text(result.shippingMethod);
          route.updatedAt = clock().toISOString();
          route.updatedBy = actorName(actor);
        }
        order.push = {
          ...order.push,
          status: verified ? "linked" : "verification_pending",
          wmsOrderNo: text(result.orderNo),
          duplicate: true,
          pushedAt: result.updated ? clock().toISOString() : order.push?.pushedAt || "",
          linkedAt: verified ? clock().toISOString() : "",
          checkedAt: clock().toISOString(),
          lastError: "",
          wmsStatus: text(result.status).toUpperCase(),
          platform: text(result.platform),
          platformShop: text(result.platformShop),
          warehouseCode: text(result.warehouseCode),
          shippingMethod: text(result.shippingMethod),
        };
        order.fulfillment = {
          ...order.fulfillment,
          stage: verified ? "wms_ready" : "wms_verifying",
          nextRetryAt: verified ? "" : new Date(clock().getTime() + 60_000).toISOString(),
          lastError: "",
          errorCode: "",
          updatedAt: clock().toISOString(),
        };
        appendTimeline(order, verified ? "wms_verified" : "wms_verification_pending", actor, verified
          ? `${projected.targetWarehouseName} · ${result.orderNo} · 已到待发货`
          : `${projected.targetWarehouseName} · ${result.orderNo} · WMS 已接收，等待状态确认`);
        persist();
        return orderProjection(state, order, dependencies);
      } catch (error) {
        order.push = {
          ...order.push,
          status: "failed",
          checkedAt: clock().toISOString(),
          lastError: error instanceof Error ? error.message : "WMS 设定 SKU 并审单失败",
        };
        appendTimeline(order, "wms_verification_failed", actor, order.push.lastError);
        persist();
        throw error;
      }
    })().finally(() => inFlightVerifications.delete(normalizedPosting));
    inFlightVerifications.set(normalizedPosting, job);
    return job;
  }

  async function fetchPostingDetail(store, postingNumber) {
    const payload = await ozonRequest(fetchImpl, store, "/v3/posting/fbs/get", {
      posting_number: text(postingNumber),
      translit: false,
      with: { analytics_data: true, financial_data: true, legal_info: false },
    });
    const posting = firstObject(payload?.result?.posting, payload?.result, payload?.posting, payload);
    return normalizeOzonPosting(posting, store.id);
  }

  function validateShipDetail(order, detail) {
    const specialRequirements = SPECIAL_REQUIREMENT_KEYS.filter((key) => detail.requirements[key]?.length);
    if (specialRequirements.length) {
      throw conflictError(`订单包含首版不支持的特殊商品要求：${specialRequirements.join("、")}`, "ozon_special_requirements");
    }
    if (detail.multiPackage) throw conflictError("Ozon 最新订单为多包发货，首版仅支持整单单包。", "ozon_multi_package");
    const expected = new Map(order.products.map((product) => [text(product.productId), product.quantity]));
    const actual = new Map(detail.products.map((product) => [text(product.productId), product.quantity]));
    if (!expected.size || expected.size !== actual.size || Array.from(expected).some(([id, quantity]) => actual.get(id) !== quantity)) {
      throw conflictError("Ozon 最新商品 ID / 数量与排单快照不一致，已停止自动发运。", "ozon_products_changed");
    }
  }

  function completeOzonShipment(order, detail, actor) {
    const now = clock().toISOString();
    order.status = detail.status || "awaiting_deliver";
    order.substatus = detail.substatus;
    order.syncedAt = detail.syncedAt || now;
    order.fulfillment = {
      ...order.fulfillment,
      stage: "completed",
      nextRetryAt: "",
      lastError: "",
      errorCode: "",
      updatedAt: now,
      completedAt: now,
    };
    appendTimeline(order, "ozon_awaiting_deliver", actor, "Ozon 已回查为 awaiting_deliver");
    appendTaskEvent(order, "completed", "success", "WMS 已到待发货，Ozon 已进入待交运。", actor);
    persist();
    return orderProjection(state, order, dependencies);
  }

  async function shipOzonOrder(postingNumber, actor = {}) {
    const order = findOrder(postingNumber);
    const store = findStore(order.storeId, actor, "collaborator");
    assertConfirmedSchedule(order);
    if (!isWmsLinked(order) || !["W", "D"].includes(text(order.push?.wmsStatus).toUpperCase())) {
      throw conflictError("WMS 尚未审核到待发货，禁止推进 Ozon 发运。", "ozon_wms_not_ready");
    }
    let detail = await fetchPostingDetail(store, order.postingNumber);
    if (detail.status === "awaiting_deliver") return completeOzonShipment(order, detail, actor);
    if (detail.substatus === "ship_failed") {
      throw conflictError("Ozon 返回 ship_failed，已停止自动重复提交。", "ozon_ship_failed");
    }
    if (detail.status !== "awaiting_packaging") {
      throw conflictError(`Ozon 当前状态 ${detail.status || "未知"} 不允许自动发运。`, "ozon_status_changed");
    }
    validateShipDetail(order, detail);
    const requestedAt = new Date(order.fulfillment?.ozonRequestedAt || 0).getTime();
    const requestStillPending = requestedAt > 0 && clock().getTime() - requestedAt < 2 * 60_000 && detail.substatus !== "ship_failed";
    if (!requestStillPending) {
      const now = clock().toISOString();
      order.fulfillment = { ...order.fulfillment, stage: "ozon_shipping", ozonRequestedAt: now, updatedAt: now, nextRetryAt: "" };
      appendTimeline(order, "ozon_ship_started", actor, "整单单包提交 /v4/posting/fbs/ship");
      persist();
      try {
        await ozonRequest(fetchImpl, store, "/v4/posting/fbs/ship", {
          posting_number: order.postingNumber,
          packages: [{
            products: detail.products.map((product) => {
              const productId = Number(product.productId);
              if (!Number.isSafeInteger(productId) || productId <= 0) {
                throw conflictError(`Ozon 商品 ID ${product.productId || "为空"} 无法安全提交发运。`, "ozon_product_id_invalid");
              }
              return { product_id: productId, quantity: product.quantity };
            }),
          }],
          with: { additional_data: true },
        });
      } catch (error) {
        const alreadyShipped = /ALREADY_SHIPPED/i.test(text(error?.code)) || /already.*ship|已.*发运/i.test(text(error?.message));
        if (!alreadyShipped) throw error;
      }
    }
    detail = await fetchPostingDetail(store, order.postingNumber);
    if (detail.status === "awaiting_deliver") return completeOzonShipment(order, detail, actor);
    if (detail.substatus === "ship_failed") {
      throw Object.assign(new Error("Ozon 返回 ship_failed，已停止自动重复提交。"), { code: "ozon_ship_failed", statusCode: 409 });
    }
    order.fulfillment = {
      ...order.fulfillment,
      stage: "ozon_shipping",
      nextRetryAt: new Date(clock().getTime() + 60_000).toISOString(),
      updatedAt: clock().toISOString(),
    };
    persist();
    return orderProjection(state, order, dependencies);
  }

  function retryableFailure(error) {
    const status = number(error?.status || error?.statusCode);
    const code = text(error?.code).toUpperCase();
    return status === 429 || status >= 500 || ["TIMEOUT", "NETWORK_ERROR"].includes(code)
      || /timeout|network|temporar|no\s*data|超时|网络|稍后|频繁|待生成订单.*查询|尚未返回|同步延迟/i.test(text(error?.message));
  }

  function isRecoverableWmsSyncError(order) {
    return order.fulfillment?.stage === "error"
      && text(order.fulfillment?.failedStage) === "wms_verifying"
      && /no\s*data|待生成订单.*查询|尚未返回|同步延迟/i.test(text(order.fulfillment?.lastError));
  }

  function recordFulfillmentFailure(order, error, actor = {}) {
    const failedStage = text(order.fulfillment?.stage || "queued_wms");
    const notificationDuplicate = state.taskEvents.some((event) => event.storeId === order.storeId
      && event.postingNumber === order.postingNumber
      && event.stage === failedStage
      && event.level === "error"
      && clock().getTime() - new Date(event.at || 0).getTime() < 24 * 60 * 60 * 1000);
    const attempts = Math.max(0, number(order.fulfillment?.attempts)) + 1;
    const retryable = retryableFailure(error) && attempts <= RETRY_DELAYS_MS.length;
    const now = clock().toISOString();
    order.fulfillment = {
      ...order.fulfillment,
      stage: "error",
      attempts,
      nextRetryAt: retryable ? new Date(clock().getTime() + RETRY_DELAYS_MS[attempts - 1]).toISOString() : "",
      lastError: error instanceof Error ? error.message : "Ozon 自动履约失败",
      errorCode: text(error?.code),
      failedStage,
      updatedAt: now,
    };
    appendTimeline(order, "fulfillment_failed", actor, order.fulfillment.lastError);
    appendTaskEvent(order, failedStage, "error", order.fulfillment.lastError, actor, order.fulfillment.errorCode);
    persist();
    const store = state.stores.find((item) => item.id === order.storeId);
    if (!notificationDuplicate) {
      void Promise.resolve(notifyFailure({ store, order: orderProjection(state, order, dependencies), stage: failedStage, error: order.fulfillment.lastError, code: order.fulfillment.errorCode }))
        .catch(() => {});
    }
  }

  async function processFulfillmentOrder(order, actor) {
    if (inFlightFulfillment.has(order.postingNumber)) return inFlightFulfillment.get(order.postingNumber);
    const job = (async () => {
      assertConfirmedSchedule(order);
      if (!isWmsLinked(order)) {
        const projected = await verifyOrderInWms(order.postingNumber, actor);
        if (!projected.linked) return projected;
      }
      order.fulfillment = { ...order.fulfillment, stage: "wms_ready", nextRetryAt: "", updatedAt: clock().toISOString() };
      persist();
      if (!autoShipEnabled) return orderProjection(state, order, dependencies);
      return shipOzonOrder(order.postingNumber, actor);
    })().catch((error) => {
      recordFulfillmentFailure(order, error, actor);
      throw error;
    }).finally(() => inFlightFulfillment.delete(order.postingNumber));
    inFlightFulfillment.set(order.postingNumber, job);
    return job;
  }

  async function processFulfillmentQueue({ limit = 3 } = {}, actor = { role: "admin", id: "ozon-worker", displayName: "Ozon 自动履约" }) {
    const now = clock().getTime();
    const storeIds = new Set();
    const candidates = [];
    for (const order of state.orders) {
      if (candidates.length >= Math.max(1, Math.min(3, Number(limit) || 3))) break;
      if (order.schedule?.status !== "confirmed" || order.fulfillment?.stage === "completed") continue;
      // In safe mode a WMS-ready order is intentionally waiting for a human to
      // complete the Ozon shipment. It must not keep occupying the one-order-
      // per-store queue slot and starve later confirmed orders forever.
      if (!autoShipEnabled && order.fulfillment?.stage === "wms_ready") continue;
      const nextRetry = new Date(order.fulfillment?.nextRetryAt || 0).getTime();
      if (order.fulfillment?.stage === "error" && !nextRetry && !isRecoverableWmsSyncError(order)) continue;
      if (nextRetry && nextRetry > now) continue;
      if (storeIds.has(order.storeId)) continue;
      storeIds.add(order.storeId);
      candidates.push(order);
    }
    const results = await Promise.all(candidates.map(async (order) => {
      try {
        const projected = await processFulfillmentOrder(order, actor);
        return { postingNumber: order.postingNumber, ok: true, stage: projected.fulfillment?.stage || "" };
      } catch (error) {
        return { postingNumber: order.postingNumber, ok: false, message: error instanceof Error ? error.message : "自动履约失败" };
      }
    }));
    return { checked: candidates.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
  }

  function retryOrder(postingNumber, input = {}, actor = {}) {
    const order = findOrder(postingNumber);
    findStore(order.storeId, actor, "collaborator");
    if (order.fulfillment?.stage === "completed") return orderProjection(state, order, dependencies);
    if (order.fulfillment?.stage === "external_awaiting_deliver" && order.schedule?.status !== "confirmed") {
      if (input.recoverExternal !== true) {
        throw conflictError("该订单已由外部推进到待交运；如需补写 WMS，必须显式选择恢复中台处理。", "ozon_external_recovery_required");
      }
      const now = clock().toISOString();
      const batch = normalizeScheduleBatch({
        id: `ozon-batch-${randomUUID()}`,
        ruleId: "manual-external-recovery",
        storeId: order.storeId,
        ozonWarehouseId: order.ozonWarehouseId,
        scheduledFor: `recovery:${now}`,
        status: "confirmed",
        orderNumbers: [order.postingNumber],
        confirmedOrderNumbers: [order.postingNumber],
        exclusions: [],
        createdAt: now,
        createdBy: actorName(actor),
        confirmedAt: now,
        confirmedBy: actorName(actor),
        updatedAt: now,
      });
      state.scheduleBatches.unshift(batch);
      order.schedule = { status: "confirmed", batchId: batch.id, markedAt: now, markedBy: actorName(actor) };
      order.fulfillment = { ...order.fulfillment, stage: "queued_wms", attempts: 0, nextRetryAt: "", lastError: "", errorCode: "", failedStage: "", updatedAt: now };
      appendTimeline(order, "external_recovery_confirmed", actor, `显式恢复批次 ${batch.id}`);
      appendTaskEvent(order, "confirmed", "warning", "运营已显式恢复外部发运订单，中台将补写并核验 WMS。", actor);
      persist();
      return orderProjection(state, order, dependencies);
    }
    assertConfirmedSchedule(order);
    order.fulfillment = {
      ...order.fulfillment,
      stage: isWmsLinked(order) ? "wms_ready" : "queued_wms",
      attempts: 0,
      nextRetryAt: "",
      lastError: "",
      errorCode: "",
      updatedAt: clock().toISOString(),
    };
    appendTaskEvent(order, "retry", "info", "运营已手动重新加入自动履约队列。", actor);
    persist();
    return orderProjection(state, order, dependencies);
  }

  async function reconcileWaitingOrders({ storeId = "", limit = 50 } = {}, actor = { role: "admin", id: "ozon-scheduler", displayName: "Ozon 自动关联" }) {
    const candidates = state.orders.filter((order) => {
      if (storeId && order.storeId !== text(storeId)) return false;
      return order.schedule?.status === "confirmed"
        && ["waiting_sync", "verification_pending", "failed"].includes(text(order.push?.status));
    }).slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
    const result = { checked: 0, linked: 0, waiting: 0, failed: 0 };
    for (const order of candidates) {
      result.checked += 1;
      try {
        const projected = await pushOrder(order.postingNumber, actor);
        if (projected.linked) result.linked += 1;
        else result.waiting += 1;
      } catch {
        result.failed += 1;
      }
    }
    return result;
  }

  return {
    payload,
    upsertStore,
    saveStoreCollaborators,
    assignStoreOwner,
    deleteStore,
    testStore,
    syncStore,
    saveRoute,
    saveSkuMapping,
    autoMap,
    saveScheduleRule,
    deleteScheduleRule,
    evaluateScheduleRules,
    confirmScheduleBatch,
    reviewOrder,
    pushOrder,
    verifyOrderInWms,
    shipOzonOrder,
    processFulfillmentQueue,
    retryOrder,
    reconcileWaitingOrders,
    rawState: () => state,
  };
}

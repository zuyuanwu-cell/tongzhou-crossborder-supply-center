import { randomUUID } from "node:crypto";

const REVIEW_STATUSES = new Set(["awaiting_packaging"]);
const RECONCILIATION_STATUSES = new Set(["awaiting_deliver"]);
const ACTIVE_STATUSES = new Set([...REVIEW_STATUSES, ...RECONCILIATION_STATUSES]);
const MAX_ORDERS = 1500;

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

function publicStore(store) {
  return {
    id: store.id,
    name: store.name,
    clientId: store.clientId,
    apiKeyMasked: store.apiKey ? `${store.apiKey.slice(0, 3)}••••${store.apiKey.slice(-3)}` : "",
    hasApiKey: Boolean(store.apiKey),
    enabled: store.enabled !== false,
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
    },
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

export function normalizeOzonState(value = {}) {
  return {
    version: 2,
    updatedAt: dateIso(value.updatedAt),
    stores: (Array.isArray(value.stores) ? value.stores : []).map(normalizeStore).filter((store) => store.id),
    routes: (Array.isArray(value.routes) ? value.routes : []).map(normalizeRoute)
      .filter((route) => route.storeId && route.ozonWarehouseId),
    skuMappings: (Array.isArray(value.skuMappings) ? value.skuMappings : []).map(normalizeSkuMapping)
      .filter((mapping) => mapping.storeId && mapping.warehouseConnectionId && (mapping.offerId || mapping.ozonSku)),
    orders: (Array.isArray(value.orders) ? value.orders : []).map(normalizeOrder)
      .filter((order) => order.storeId && order.postingNumber).slice(0, MAX_ORDERS),
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
  if (REVIEW_STATUSES.has(order.status) && (order.requirements.mandatoryMark.length || order.requirements.imei.length)) {
    productIssues.push("订单含强制标识商品，需先在 Ozon 完成标识信息");
  }
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
    workflowMessage: workflowStage === "reconcile"
      ? "该订单已进入待交运阶段；中台只处理 WMS 已有订单，可设定 SKU 并审单，绝不重复创建。"
      : "审核通过后，中台会等待 WMS 按已绑定的 Ozon 店铺自动拉单，再由用户确认设定 SKU 并审单。",
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
  lookupWmsOrder,
  verifyWmsOrder,
  clock = () => new Date(),
} = {}) {
  const dependencies = { warehouseConnections, inventory };
  let state = normalizeOzonState(initialState);
  const inFlightPushes = new Map();
  const inFlightVerifications = new Map();

  function persist() {
    state.updatedAt = clock().toISOString();
    save(state);
  }

  function findStore(storeId) {
    const store = state.stores.find((item) => item.id === text(storeId));
    if (!store) throw new Error("Ozon 店铺不存在。");
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

  function payload(actor = {}) {
    const connections = warehouseConnections().filter(russianWarehouse).filter((connection) => scopeAllowsWarehouse(actor, connection.id));
    const allowedWarehouseIds = new Set(connections.map((connection) => connection.id));
    const warehouseScope = Array.isArray(actor?.dataScopes?.warehouseIds)
      ? actor.dataScopes.warehouseIds.map(text).filter(Boolean)
      : [];
    const orders = state.orders.map((order) => orderProjection(state, order, dependencies))
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
      stores: state.stores.map(publicStore),
      routes: state.routes.filter((route) => !route.warehouseConnectionId || allowedWarehouseIds.has(route.warehouseConnectionId)),
      skuMappings: state.skuMappings.filter((mapping) => !mapping.warehouseConnectionId || allowedWarehouseIds.has(mapping.warehouseConnectionId)),
      warehouses: connections.map((connection) => ({
        id: connection.id,
        name: connection.name,
        warehouseCode: text(connection.warehouseCode || connection.resolvedWarehouseId),
        status: text(connection.status),
      })),
      products: Array.from(products.values()),
      orders,
      summary: {
        stores: state.stores.filter((store) => store.enabled !== false).length,
        pending: orders.filter((order) => !order.linked).length,
        ready: orders.filter((order) => order.ready && order.review?.status !== "approved" && !order.linked).length,
        approved: orders.filter((order) => order.review?.status === "approved" && !order.linked).length,
        pushed: orders.filter((order) => order.linked).length,
        blocked: orders.filter((order) => order.workflowStage === "review" && !order.ready && !order.linked).length,
      },
    };
  }

  function upsertStore(input, actor = {}) {
    const id = text(input?.id);
    const existing = id ? state.stores.find((item) => item.id === id) : null;
    const next = normalizeStore({
      ...existing,
      ...input,
      id: existing?.id || id || `ozon-store-${randomUUID()}`,
      apiKey: text(input?.apiKey) || existing?.apiKey || "",
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
    return publicStore(next);
  }

  function deleteStore(storeId) {
    findStore(storeId);
    state.stores = state.stores.filter((store) => store.id !== text(storeId));
    state.routes = state.routes.filter((route) => route.storeId !== text(storeId));
    state.skuMappings = state.skuMappings.filter((mapping) => mapping.storeId !== text(storeId));
    state.orders = state.orders.filter((order) => order.storeId !== text(storeId));
    persist();
  }

  async function testStore(storeId) {
    const store = findStore(storeId);
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
    return publicStore(store);
  }

  async function syncStore(storeId) {
    const store = findStore(storeId);
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
        return normalizeOrder({ ...normalized, review: previous?.review, push: previous?.push, timeline: previous?.timeline });
      }).filter((order) => order.postingNumber && ACTIVE_STATUSES.has(order.status));
      state.orders = [
        ...state.orders.filter((order) => order.storeId !== store.id),
        ...synced,
      ].sort((a, b) => text(b.createdAt || b.syncedAt).localeCompare(text(a.createdAt || a.syncedAt))).slice(0, MAX_ORDERS);
      store.ozonWarehouses = await fetchOzonWarehouses(fetchImpl, store);
      store.lastSyncedAt = clock().toISOString();
      store.lastError = "";
      persist();
      return { store: publicStore(store), count: synced.length };
    } catch (error) {
      store.lastError = error instanceof Error ? error.message : "Ozon 同步失败";
      persist();
      throw error;
    }
  }

  function saveRoute(input, actor = {}) {
    const store = findStore(input?.storeId);
    const ozonWarehouseId = text(input?.ozonWarehouseId);
    if (!ozonWarehouseId) throw new Error("请选择 Ozon 卖家仓。");
    const connection = warehouseConnections().find((item) => item.id === text(input?.warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const next = normalizeRoute({ ...input, storeId: store.id, updatedAt: clock().toISOString(), updatedBy: actorName(actor) });
    const index = state.routes.findIndex((route) => routeKey(route.storeId, route.ozonWarehouseId) === routeKey(next.storeId, next.ozonWarehouseId));
    if (index >= 0) state.routes[index] = next;
    else state.routes.push(next);
    persist();
    return next;
  }

  function saveSkuMapping(input, actor = {}) {
    const store = findStore(input?.storeId);
    const connection = warehouseConnections().find((item) => item.id === text(input?.warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const next = normalizeSkuMapping({ ...input, storeId: store.id, updatedAt: clock().toISOString(), updatedBy: actorName(actor) });
    if (!next.offerId && !next.ozonSku) throw new Error("缺少 Ozon 商品标识。");
    if (!next.wmsSku) throw new Error("请填写目标仓 SKU。");
    const key = mappingKey(next.storeId, next.warehouseConnectionId, next.offerId, next.ozonSku);
    const index = state.skuMappings.findIndex((mapping) => mappingKey(mapping.storeId, mapping.warehouseConnectionId, mapping.offerId, mapping.ozonSku) === key);
    if (index >= 0) state.skuMappings[index] = next;
    else state.skuMappings.push(next);
    persist();
    return next;
  }

  function autoMap({ storeId, warehouseConnectionId }, actor = {}) {
    const store = findStore(storeId);
    const connection = warehouseConnections().find((item) => item.id === text(warehouseConnectionId));
    if (!connection || !russianWarehouse(connection)) throw new Error("请选择已启用的俄罗斯 YunWMS 仓库。");
    const snapshot = availableInventory(inventory(), connection.id);
    if (!snapshot.hasSnapshot) throw new Error("目标仓暂无库存快照，请先在库存同步中更新该仓数据。");
    let mapped = 0;
    const products = state.orders.filter((order) => order.storeId === store.id).flatMap((order) => order.products);
    for (const product of products) {
      const candidates = skuCandidates(product.offerId, product.ozonSku);
      const wmsSku = candidates.find((candidate) => snapshot.bySku.has(candidate));
      if (!wmsSku) continue;
      saveSkuMapping({ storeId: store.id, warehouseConnectionId: connection.id, offerId: product.offerId, ozonSku: product.ozonSku, productName: product.name, wmsSku }, actor);
      mapped += 1;
    }
    return { mapped };
  }

  function reviewOrder(postingNumber, input = {}, actor = {}) {
    const order = findOrder(postingNumber);
    const projected = orderProjection(state, order, dependencies);
    if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权审核该仓订单。");
    if (projected.workflowStage !== "review") throw new Error("该订单已进入待交运阶段，请直接查询并关联 WMS 订单，无需重复审核。");
    if (!projected.ready) throw new Error(`订单尚未通过推单校验：${projected.issues.join("；")}`);
    order.review = {
      status: "approved",
      note: text(input.note),
      reviewedAt: clock().toISOString(),
      reviewedBy: actorName(actor),
    };
    appendTimeline(order, "review_approved", actor, input.note || "SKU、仓库路由与库存校验通过，等待 WMS 自动拉单");
    persist();
    return orderProjection(state, order, dependencies);
  }

  async function pushOrder(postingNumber, actor = {}) {
    const normalizedPosting = text(postingNumber);
    if (inFlightPushes.has(normalizedPosting)) return inFlightPushes.get(normalizedPosting);
    const job = (async () => {
      const order = findOrder(normalizedPosting);
      if (isWmsLinked(order)) return orderProjection(state, order, dependencies);
      const projected = orderProjection(state, order, dependencies);
      if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权查询该仓订单。");
      if (projected.workflowStage === "review" && order.review?.status !== "approved") throw new Error("请先审核订单，再查询 WMS 自动拉单结果。");
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
      if (isWmsLinked(order)) return orderProjection(state, order, dependencies);
      const projected = orderProjection(state, order, dependencies);
      if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权审单到该仓库。");
      if (projected.workflowStage === "review" && order.review?.status !== "approved") {
        throw new Error("请先完成中台审核，再设定 WMS SKU 并审单。");
      }
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
          order.push = {
            ...order.push,
            status: "waiting_sync",
            wmsOrderNo: "",
            checkedAt: clock().toISOString(),
            lastError: "",
          };
          appendTimeline(order, "wms_waiting_sync", actor, "WMS 暂未拉取该 Ozon 订单，本次没有执行任何写入");
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

  async function reconcileWaitingOrders({ storeId = "", limit = 50 } = {}, actor = { id: "ozon-scheduler", displayName: "Ozon 自动关联" }) {
    const candidates = state.orders.filter((order) => {
      if (storeId && order.storeId !== text(storeId)) return false;
      return ["waiting_sync", "verification_pending", "failed"].includes(text(order.push?.status))
        && (order.review?.status === "approved" || RECONCILIATION_STATUSES.has(order.status));
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
    deleteStore,
    testStore,
    syncStore,
    saveRoute,
    saveSkuMapping,
    autoMap,
    reviewOrder,
    pushOrder,
    verifyOrderInWms,
    reconcileWaitingOrders,
    rawState: () => state,
  };
}

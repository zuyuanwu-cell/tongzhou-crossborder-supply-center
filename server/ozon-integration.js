import { createHash, randomUUID } from "node:crypto";

const ACTIVE_STATUSES = new Set(["awaiting_packaging", "awaiting_deliver"]);
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
      pushedBy: text(value.push.pushedBy),
      lastError: text(value.push.lastError),
      payloadHash: text(value.push.payloadHash),
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
    version: 1,
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

function orderProjection(state, order, dependencies) {
  const store = state.stores.find((item) => item.id === order.storeId);
  const route = state.routes.find((item) => routeKey(item.storeId, item.ozonWarehouseId) === routeKey(order.storeId, order.ozonWarehouseId));
  const connection = dependencies.warehouseConnections().find((item) => item.id === route?.warehouseConnectionId);
  const inventory = availableInventory(dependencies.inventory(), route?.warehouseConnectionId);
  const mappings = new Map(state.skuMappings.map((mapping) => [mappingKey(mapping.storeId, mapping.warehouseConnectionId, mapping.offerId, mapping.ozonSku), mapping]));
  const issues = [];
  if (!store || store.enabled === false) issues.push("店铺授权未启用");
  if (!ACTIVE_STATUSES.has(order.status) && order.push?.status !== "pushed") issues.push(`Ozon 状态 ${order.status || "未知"} 不允许新推单`);
  if (!order.ozonWarehouseId) issues.push("Ozon 订单未返回卖家仓库 ID");
  if (!route?.warehouseConnectionId) issues.push("Ozon 仓尚未绑定俄罗斯仓");
  if (!connection || !russianWarehouse(connection)) issues.push("目标俄罗斯仓不可用");
  if (!route?.shippingMethod) issues.push("尚未配置 YunWMS 物流方式代码");
  const recipient = mergeRecipient(order.recipient, route?.recipient);
  for (const [key, label] of [["address1", "详细地址"], ["zipcode", "邮编"], ["name", "收件人"], ["phone", "联系电话"]]) {
    if (!recipient[key]) issues.push(`缺少${label}`);
  }
  if (order.requirements.mandatoryMark.length || order.requirements.imei.length) issues.push("订单含强制标识商品，需先在 Ozon 完成标识信息");
  const products = order.products.map((product) => {
    const mapping = mappings.get(mappingKey(order.storeId, route?.warehouseConnectionId, product.offerId, product.ozonSku));
    const wmsSku = text(mapping?.wmsSku).toUpperCase();
    const wmsSkuExists = Boolean(wmsSku && inventory.bySku.has(wmsSku));
    const availableQty = wmsSkuExists ? inventory.bySku.get(wmsSku) || 0 : 0;
    if (!mapping?.wmsSku) issues.push(`${product.offerId || product.ozonSku} 未配置目标仓 SKU`);
    else if (inventory.hasSnapshot && !wmsSkuExists) issues.push(`${mapping.wmsSku} 不存在于目标仓库存快照`);
    else if (inventory.hasSnapshot && availableQty < product.quantity) issues.push(`${mapping.wmsSku} 可用库存不足（${availableQty}/${product.quantity}）`);
    return { ...product, wmsSku, wmsSkuExists, availableQty, mapped: Boolean(wmsSku) };
  });
  return {
    ...order,
    storeName: store?.name || "",
    targetWarehouseId: connection?.id || "",
    targetWarehouseName: connection?.name || "",
    shippingMethod: route?.shippingMethod || "",
    recipient,
    products,
    issues: Array.from(new Set(issues)),
    ready: issues.length === 0,
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
  createWmsOrder,
  clock = () => new Date(),
} = {}) {
  const dependencies = { warehouseConnections, inventory };
  let state = normalizeOzonState(initialState);
  const inFlightPushes = new Map();

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
        pending: orders.filter((order) => !order.push || order.push.status !== "pushed").length,
        ready: orders.filter((order) => order.ready && order.review?.status !== "approved" && order.push?.status !== "pushed").length,
        approved: orders.filter((order) => order.review?.status === "approved" && order.push?.status !== "pushed").length,
        pushed: orders.filter((order) => order.push?.status === "pushed").length,
        blocked: orders.filter((order) => !order.ready && order.push?.status !== "pushed").length,
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
      ozonRequest(fetchImpl, store, "/v1/warehouse/list", {}),
    ]);
    store.companyName = companyNameFromPayload(seller) || store.companyName;
    store.ozonWarehouses = warehousesFromPayload(warehouses);
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
            status: Array.from(ACTIVE_STATUSES),
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
      }).filter((order) => order.postingNumber);
      const retainedHistory = state.orders.filter((order) => order.storeId === store.id && order.push?.status === "pushed" && !synced.some((item) => item.postingNumber === order.postingNumber));
      state.orders = [
        ...state.orders.filter((order) => order.storeId !== store.id),
        ...synced,
        ...retainedHistory,
      ].sort((a, b) => text(b.createdAt || b.syncedAt).localeCompare(text(a.createdAt || a.syncedAt))).slice(0, MAX_ORDERS);
      const warehouseResponse = await ozonRequest(fetchImpl, store, "/v1/warehouse/list", {});
      store.ozonWarehouses = warehousesFromPayload(warehouseResponse);
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
      const candidates = uniqueStrings([product.offerId, product.ozonSku]).map((item) => item.toUpperCase());
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
    if (!projected.ready) throw new Error(`订单尚未通过推单校验：${projected.issues.join("；")}`);
    order.review = {
      status: "approved",
      note: text(input.note),
      reviewedAt: clock().toISOString(),
      reviewedBy: actorName(actor),
    };
    appendTimeline(order, "review_approved", actor, input.note || "SKU、仓库路由与库存校验通过");
    persist();
    return orderProjection(state, order, dependencies);
  }

  async function pushOrder(postingNumber, actor = {}) {
    const normalizedPosting = text(postingNumber);
    if (inFlightPushes.has(normalizedPosting)) return inFlightPushes.get(normalizedPosting);
    const job = (async () => {
      const order = findOrder(normalizedPosting);
      if (order.push?.status === "pushed" && order.push.wmsOrderNo) return orderProjection(state, order, dependencies);
      const projected = orderProjection(state, order, dependencies);
      if (!scopeAllowsWarehouse(actor, projected.targetWarehouseId)) throw new Error("当前账号无权推送该仓订单。");
      if (order.review?.status !== "approved") throw new Error("请先审核订单，再推送至俄罗斯仓。");
      if (!projected.ready) throw new Error(`订单当前不满足推单条件：${projected.issues.join("；")}`);
      if (typeof createWmsOrder !== "function") throw new Error("俄罗斯仓推单能力尚未配置。");
      const connection = warehouseConnections().find((item) => item.id === projected.targetWarehouseId);
      const input = {
        referenceNo: projected.postingNumber,
        orderNumber: projected.orderNumber,
        shopName: projected.storeName,
        shippingMethod: projected.shippingMethod,
        recipient: projected.recipient,
        saleAmount: projected.saleAmount,
        currency: projected.currency,
        description: `Ozon ${projected.postingNumber} / ${projected.deliverySchema || "FBS"}`,
        verify: true,
        lines: projected.products.map((product) => ({
          sku: product.wmsSku,
          quantity: product.quantity,
          productName: product.name,
          offerId: product.offerId,
          unitPrice: product.unitPrice,
        })),
      };
      const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      order.push = { status: "pushing", wmsOrderNo: "", duplicate: false, pushedAt: "", pushedBy: actorName(actor), lastError: "", payloadHash };
      appendTimeline(order, "push_started", actor, projected.targetWarehouseName);
      persist();
      try {
        const result = await createWmsOrder(connection, input);
        order.push = {
          ...order.push,
          status: "pushed",
          wmsOrderNo: text(result.orderNo),
          duplicate: Boolean(result.duplicate),
          pushedAt: clock().toISOString(),
          lastError: "",
        };
        appendTimeline(order, result.duplicate ? "push_idempotent" : "push_succeeded", actor, `${projected.targetWarehouseName} · ${result.orderNo}`);
        persist();
        return orderProjection(state, order, dependencies);
      } catch (error) {
        order.push = { ...order.push, status: "failed", lastError: error instanceof Error ? error.message : "WMS 推单失败" };
        appendTimeline(order, "push_failed", actor, order.push.lastError);
        persist();
        throw error;
      }
    })().finally(() => inFlightPushes.delete(normalizedPosting));
    inFlightPushes.set(normalizedPosting, job);
    return job;
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
    rawState: () => state,
  };
}

import crypto from "node:crypto";

function md5(input) {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

function compactObject(value) {
  return JSON.stringify(value ?? {});
}

function getEnv(name) {
  return process.env[name] || "";
}

function wmsTimeoutMs() {
  const value = Number(process.env.WMS_REQUEST_TIMEOUT_MS || 25000);
  return Number.isFinite(value) && value > 1000 ? value : 25000;
}

function wmsOrderMaxPages() {
  const value = Number(process.env.WMS_ORDER_MAX_PAGES || 12);
  return Number.isFinite(value) && value > 0 ? Math.min(200, Math.floor(value)) : 12;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/$/, "");
}

function normalizeYunEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/\/default\/svc\/wsdl$/i.test(normalized)) return normalized.replace(/\/wsdl$/i, "/web-service");
  if (/\/default\/svc\/web-service$/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (!url.pathname || url.pathname === "/" || /^\/api-doc(?:\/index\.php)?\/?$/i.test(url.pathname)) {
      return `${url.origin}/default/svc/web-service`;
    }
  } catch {
    // Keep the configured value when it is not a full URL; the request layer will surface the real error.
  }
  return normalized;
}

async function postJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wmsTimeoutMs());
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: compactObject(body),
    signal: controller.signal,
  });
  let text = "";
  try {
    text = await response.text();
  } finally {
    clearTimeout(timer);
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`WMS request failed ${response.status}: ${text.slice(0, 180)}`);
  }
  return payload;
}

async function postText(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wmsTimeoutMs());
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: controller.signal,
  });
  let text = "";
  try {
    text = await response.text();
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`WMS request failed ${response.status}: ${text.slice(0, 180)}`);
  }
  return text;
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.result?.list)) return payload.result.list;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function isSuccessfulPayload(payload) {
  const result = String(payload?.result || "").toLowerCase();
  const code = String(payload?.code || "").toLowerCase();
  return !result || result === "success" || code === "success";
}

function payloadMessage(payload) {
  return firstText(payload?.message, payload?.reason, payload?.msg, payload?.error) || "WMS returned an unsuccessful response";
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function firstNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDateTimeForWms(date) {
  return `${date} 00:00:00`;
}

function skuSuffix(sku) {
  const value = firstText(sku);
  const match = value.match(/^[A-Z]{2,5}-(.+)$/i);
  return match ? match[1] : value;
}

function normalizeCountryName(country) {
  const value = firstText(country);
  if (value === "俄罗斯") return "俄罗斯联邦";
  if (value === "印尼") return "印度尼西亚";
  return value;
}

function seaHeaders(body, appKey, appSecret) {
  const bodyMd5 = md5(compactObject(body));
  return {
    AppKey: appKey,
    Signature: md5(`${bodyMd5}${appSecret}`),
  };
}

function seaBody(body = {}) {
  return {
    requestTimestamp: Math.floor(Date.now() / 1000),
    ...body,
  };
}

function seaCredentials(connection) {
  const prefix = `WMS_${connection.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return {
    baseUrl: normalizeBaseUrl(getEnv(`${prefix}_BASE_URL`) || connection.baseUrl),
    appKey: getEnv(`${prefix}_APP_KEY`) || connection.credentials?.appKey || connection.credentials?.clientId || getEnv("WMS_SEA_APP_KEY"),
    appSecret: getEnv(`${prefix}_APP_SECRET`) || connection.credentials?.appSecret || connection.credentials?.clientSecret || getEnv("WMS_SEA_APP_SECRET"),
    warehouseCode: getEnv(`${prefix}_WAREHOUSE_CODE`) || connection.warehouseCode,
    warehouseId: getEnv(`${prefix}_WAREHOUSE_ID`) || connection.warehouseId || connection.warehouseCode,
  };
}

function hasSeaCredentials(credentials) {
  return Boolean(credentials.baseUrl && credentials.appKey && credentials.appSecret);
}

function yunCredentials(connection) {
  const prefix = `WMS_${connection.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return {
    baseUrl: normalizeYunEndpoint(getEnv(`${prefix}_BASE_URL`) || connection.baseUrl),
    appKey: getEnv(`${prefix}_APP_KEY`) || connection.credentials?.appKey || connection.credentials?.clientId,
    appToken: getEnv(`${prefix}_APP_TOKEN`) || connection.credentials?.token || connection.credentials?.appSecret || connection.credentials?.clientSecret,
    warehouseCode: getEnv(`${prefix}_WAREHOUSE_CODE`) || connection.warehouseCode,
  };
}

function hasYunCredentials(credentials) {
  return Boolean(credentials.baseUrl && credentials.appKey && credentials.appToken);
}

function yunEnvelope(credentials, service, params = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://www.example.org/Ec/">
  <SOAP-ENV:Body>
    <ns1:callService>
      <paramsJson>${xmlEscape(JSON.stringify(params))}</paramsJson>
      <appToken>${xmlEscape(credentials.appToken)}</appToken>
      <appKey>${xmlEscape(credentials.appKey)}</appKey>
      <service>${xmlEscape(service)}</service>
      <language>zh_CN</language>
    </ns1:callService>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

async function postYun(credentials, service, params = {}) {
  const xml = await postText(credentials.baseUrl, yunEnvelope(credentials, service, params), {
    "Content-Type": "text/xml; charset=utf-8",
    SOAPAction: "callService",
  });
  const match = xml.match(/<response[^>]*>([\s\S]*?)<\/response>/i);
  if (!match) throw new Error(`YunWMS ${service} 响应缺少 response 节点`);
  const responseText = xmlUnescape(match[1]).trim();
  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(`YunWMS ${service} response 不是 JSON：${responseText.slice(0, 180)}`);
  }
}

async function fetchYunPageList(credentials, service, params = {}, pageSize = 200, maxPages = 20) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await postYun(credentials, service, { pageSize, page, ...params });
    if (String(payload.ask || "").toLowerCase() !== "success") {
      throw new Error(`YunWMS ${service} 返回异常：${payload.message || "Unknown error"}`);
    }
    items.push(...(Array.isArray(payload.data) ? payload.data : []));
    if (String(payload.nextPage || "").toLowerCase() !== "true") break;
  }
  return items;
}

function normalizeSeaProduct(item, connection) {
  const sku = firstText(item.goodsSkuOuterId, item.sku, item.skuCode, item.goodsSkuCode, item.goodsCode, item.customSku);
  return {
    warehouseId: connection.id,
    goodsSkuId: firstText(item.goodsSkuId, item.id),
    country: connection.country,
    sku,
    countrySku: firstText(item.customCode, item.countrySku, `${connection.country}-${sku}`),
    name: firstText(item.goodsName, item.skuName, item.productName, item.name),
    imageUrl: firstText(item.logoUrl, item.imageUrl, item.picUrl, item.pictureUrl, item.mainImageUrl),
    imageSource: "wms",
    rawProvider: connection.providerId,
  };
}

function normalizeSeaInventory(item, connection) {
  const sku = firstText(item.goodsSkuOuterId, item.sku, item.skuCode, item.goodsSkuCode, item.goodsCode, item.customSku);
  const availableQty = firstNumber(item.availableStockNum, item.availableQty, item.available, item.canSaleQty);
  const lockedQty = firstNumber(item.lockedStockNum, item.lockedQty, item.locked);
  const waitInQty = firstNumber(item.waitInStorageNum, item.waitInQty);
  const inTransitQty = firstNumber(item.onWayNum, item.inTransitQty, item.inTransit);
  const faultyQty = firstNumber(item.faultyStockNum, item.faultyQty);
  const temporaryQty = firstNumber(item.temporaryStockNum, item.temporaryQty);
  const explicitTotalQty = firstNumber(item.stockNum, item.totalQty, item.totalStock, item.qty);
  return {
    warehouseId: connection.id,
    goodsSkuId: firstText(item.goodsSkuId, item.id),
    warehouseName: connection.name,
    country: connection.country,
    sku,
    countrySku: firstText(item.customCode, item.countrySku, `${connection.country}-${sku}`),
    availableQty,
    lockedQty,
    waitInQty,
    inTransitQty,
    faultyQty,
    temporaryQty,
    totalQty: explicitTotalQty || availableQty + lockedQty + waitInQty + inTransitQty + faultyQty + temporaryQty,
    syncedAt: new Date().toISOString(),
  };
}

async function postSea(credentials, endpoint, body) {
  const requestBody = seaBody(body);
  return postJson(
    `${credentials.baseUrl}${endpoint}`,
    requestBody,
    seaHeaders(requestBody, credentials.appKey, credentials.appSecret),
  );
}

async function fetchSeaPageList(credentials, endpoint, body, maxPages = 20) {
  const items = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await postSea(credentials, endpoint, cursor ? { ...body, cursor } : body);
    if (!isSuccessfulPayload(payload)) {
      throw new Error(`SEA WMS 接口返回异常：${payloadMessage(payload)}`);
    }
    items.push(...listFromPayload(payload));
    const nextCursor = firstText(payload?.data?.cursor);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return items;
}

async function resolveSeaWarehouseId(credentials, connection) {
  if (connection.warehouseId && connection.warehouseId !== connection.warehouseCode) return connection.warehouseId;

  const payload = await postSea(credentials, "/warehouse/get_list", {});
  if (!isSuccessfulPayload(payload)) return credentials.warehouseId;

  const warehouses = listFromPayload(payload);
  const matched = warehouses.find((warehouse) => {
    const code = firstText(warehouse.warehouseCode, warehouse.code);
    const id = firstText(warehouse.warehouseId, warehouse.id);
    const name = firstText(warehouse.warehouseName, warehouse.name);
    return (
      code === connection.warehouseCode ||
      id === connection.warehouseCode ||
      name === connection.name ||
      id === connection.warehouseId
    );
  });

  return firstText(matched?.warehouseId, matched?.id, credentials.warehouseId);
}

function alignInventorySkuWithProducts(inventory, products, connection) {
  const productByGoodsSkuId = new Map(products.filter((item) => item.goodsSkuId).map((item) => [item.goodsSkuId, item]));
  const productBySuffix = new Map(products.filter((item) => item.sku).map((item) => [skuSuffix(item.sku), item]));
  return inventory.map((item) => {
    const product = productByGoodsSkuId.get(item.goodsSkuId) || productBySuffix.get(skuSuffix(item.sku));
    if (!product) return item;
    return {
      ...item,
      sku: product.sku || item.sku,
      countrySku: product.countrySku || `${connection.country}-${product.sku || item.sku}`,
    };
  });
}

function normalizeSeaOrderRows(order, connection, productByGoodsSkuId = new Map()) {
  const status = firstText(order.stage, order.status);
  const shippedAt = firstText(order.gmtOutStorage);
  if (!shippedAt && status !== "has_out_storage") return [];
  const createdAt = firstText(order.gmtSubmit, order.gmtCreate, order.gmtOrderStart);
  const orderNo = firstText(order.platformOrderSn, order.appPackageNo, order.orderId);
  const rawItems = Array.isArray(order.items) ? order.items : [];

  return rawItems
    .map((item) => {
      const productSku = productByGoodsSkuId.get(firstText(item.goodsSkuId));
      const sku = firstText(item.goodsSkuOuterId, productSku, item.sku, item.goodsSkuCode);
      const quantity = firstNumber(item.quantity, item.qty);
      return {
        orderId: firstText(order.orderId, orderNo),
        orderNo,
        providerId: connection.providerId,
        warehouseId: connection.id,
        warehouseName: connection.name,
        country: connection.country,
        status,
        shippedAt,
        createdAt,
        sku,
        quantity,
        salesAmount: firstNumber(item.discountedPrice) * quantity,
        currency: firstText(order.currency),
        rawProvider: connection.providerId,
      };
    })
    .filter((item) => item.sku && item.quantity > 0);
}

function normalizeSeaStockupRows(order, connection, productByGoodsSkuId = new Map()) {
  const orderNo = firstText(order.warehouseStockOrderNo, order.stockOrderNo, order.orderNo, order.warehouseStockOrderId, order.id);
  const status = firstText(order.status, order.stage, order.orderStatus);
  const expectedArrivalAt = firstText(order.gmtEstimatedArrival, order.estimatedArrivalAt, order.expectedArrivalAt);
  const createdAt = firstText(order.gmtCreate, order.createdAt);
  const updatedAt = firstText(order.gmtModified, order.updatedAt);
  const rawItems = Array.isArray(order.goodsSkuList)
    ? order.goodsSkuList
    : Array.isArray(order.items)
      ? order.items
      : Array.isArray(order.skuList)
        ? order.skuList
        : [];

  return rawItems
    .map((item, index) => {
      const goodsSkuId = firstText(item.goodsSkuId, item.id);
      const productSku = productByGoodsSkuId.get(goodsSkuId);
      const sku = firstText(item.goodsSkuOuterId, item.sku, item.goodsSkuCode, productSku);
      const quantity = firstNumber(item.quantity, item.planQuantity, item.signQuantity, item.inStorageQuantity, item.waitInStorageNum);
      return {
        id: firstText(item.id, `${connection.id}-${orderNo}-${sku}-${index}`),
        orderNo,
        providerId: connection.providerId,
        warehouseId: connection.id,
        warehouseName: connection.name,
        country: connection.country,
        sku,
        productName: firstText(item.goodsName, item.skuName, item.productName, sku),
        quantity,
        status,
        expectedArrivalAt,
        createdAt,
        updatedAt,
        rawProvider: connection.providerId,
      };
    })
    .filter((item) => item.sku && item.quantity > 0);
}

async function resolveYunWarehouseCode(credentials, connection) {
  if (credentials.warehouseCode) return credentials.warehouseCode;
  const warehouses = await fetchYunPageList(credentials, "getWarehouse", {}, 200);
  const matched = warehouses.find((warehouse) => {
    const code = firstText(warehouse.warehouse_code, warehouse.warehouseCode);
    const name = firstText(warehouse.warehouse_name, warehouse.warehouse_desc, warehouse.name);
    const targetCode = firstText(connection.warehouseCode);
    const targetName = firstText(connection.name);
    return (
      (targetCode && code === targetCode) ||
      (name && targetName && (name === targetName || name.includes(targetName) || targetName.includes(name)))
    );
  });
  return firstText(matched?.warehouse_code, matched?.warehouseCode);
}

function normalizeYunProduct(item, connection) {
  const sku = firstText(item.product_sku, item.reference_no, item.product_barcode);
  const imageUrl = firstText(item.product_img, Array.isArray(item.product_img_list) ? item.product_img_list[0] : "");
  return {
    warehouseId: connection.id,
    goodsSkuId: firstText(item.product_id),
    country: connection.country,
    sku,
    countrySku: `${connection.country}-${sku}`,
    name: firstText(item.product_title, item.product_title_en, sku),
    imageUrl,
    imageSource: imageUrl ? "wms" : "",
    rawProvider: connection.providerId,
  };
}

function normalizeYunInventory(item, connection) {
  const sku = firstText(item.product_sku, item.reference_no, item.product_barcode);
  const availableQty = firstNumber(item.sellable);
  const lockedQty = firstNumber(item.reserved);
  const waitInQty = firstNumber(item.pending);
  const inTransitQty = firstNumber(item.onway);
  const faultyQty = firstNumber(item.unsellable);
  const warehouseCode = firstText(item.warehouse_code, item.warehouseCode);
  const rawWarehouseName = firstText(item.warehouse_desc, item.warehouse_name);
  return {
    warehouseId: connection.id,
    warehouseName: firstText(connection.name, rawWarehouseName, warehouseCode),
    providerWarehouseCode: warehouseCode,
    providerWarehouseName: rawWarehouseName,
    country: connection.country,
    sku,
    countrySku: `${connection.country}-${sku}`,
    availableQty,
    lockedQty,
    waitInQty,
    inTransitQty,
    faultyQty,
    temporaryQty: 0,
    totalQty: availableQty + lockedQty + waitInQty + inTransitQty + faultyQty,
    syncedAt: new Date().toISOString(),
  };
}

function normalizeYunOrderRows(order, connection) {
  const shippedAt = firstText(order.date_shipping, order.ship_date, order.shipping_date, order.date_release, order.date_create);
  const status = firstText(order.order_status, order.status);
  const orderNo = firstText(order.order_code, order.reference_no, order.order_id);
  const rawItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : Array.isArray(order.order_pack_box)
      ? order.order_pack_box.flatMap((box) => Array.isArray(box.product_details) ? box.product_details : [])
      : [];

  return rawItems
    .map((item) => ({
      orderId: firstText(order.order_id, orderNo),
      orderNo,
      providerId: connection.providerId,
      warehouseId: connection.id,
      warehouseName: firstText(order.warehouse_desc, order.warehouse_name, connection.name),
      country: connection.country,
      status,
      shippedAt,
      createdAt: firstText(order.date_create, order.created_at),
      sku: firstText(item.product_sku, item.sku, item.product_barcode),
      quantity: firstNumber(item.quantity, item.qty, item.product_quantity),
      rawProvider: connection.providerId,
    }))
    .filter((item) => item.sku && item.quantity > 0);
}

export async function syncYunWmsOrders(connection, days = 90) {
  const credentials = yunCredentials(connection);
  if (!hasYunCredentials(credentials)) {
    return {
      warehouseId: connection.id,
      ok: false,
      skipped: true,
      message: "缺少 YunWMS baseUrl / appKey / appToken，已跳过订单同步。",
      orders: [],
    };
  }

  const warehouseCode = await resolveYunWarehouseCode(credentials, connection);
  const today = new Date().toISOString().slice(0, 10);
  const start = isoDateDaysAgo(days);
  const params = {
    ship_date_from: formatDateTimeForWms(start),
    ship_date_to: `${today} 23:59:59`,
    ...(warehouseCode ? { warehouse_code: warehouseCode } : {}),
  };
  const rows = await fetchYunPageList(credentials, "getOrderList", params, 500, wmsOrderMaxPages());
  const orders = rows.flatMap((order) => normalizeYunOrderRows(order, connection));

  return {
    warehouseId: connection.id,
    ok: true,
    skipped: false,
    message: orders.length === 0 ? "YunWMS 订单接口成功但没有返回近 90 天已发货 SKU 明细。" : "",
    resolvedWarehouseId: warehouseCode,
    orders,
  };
}

export async function syncSeaOrders(connection) {
  return {
    warehouseId: connection.id,
    ok: false,
    skipped: true,
    message: "SEA WMS 出库单列表字段待确认，暂未同步订单。请补充出库单列表 OpenAPI 后即可接入。",
    orders: [],
  };
}

async function syncSeaOrdersFromApi(connection, days = 90) {
  const credentials = seaCredentials(connection);
  if (!hasSeaCredentials(credentials)) {
    return {
      warehouseId: connection.id,
      ok: false,
      skipped: true,
      message: "缺少 SEA WMS baseUrl / AppKey / AppSecret，已跳过订单同步。",
      orders: [],
    };
  }

  const resolvedWarehouseId = await resolveSeaWarehouseId(credentials, connection);
  const today = new Date().toISOString().slice(0, 10);
  const start = isoDateDaysAgo(days);
  const productRows = await fetchSeaPageList(credentials, "/goods/search_goods_sku_page", { pageSize: 100 });
  const productByGoodsSkuId = new Map(
    productRows
      .map((item) => [
        firstText(item.goodsSkuId, item.id),
        firstText(item.goodsSkuOuterId, item.sku, item.skuCode, item.goodsSkuCode, item.goodsCode, item.customSku),
      ])
      .filter(([goodsSkuId, sku]) => goodsSkuId && sku),
  );

  const orderRows = await fetchSeaPageList(credentials, "/order/search_order_page", {
    pageSize: 100,
    warehouseId: resolvedWarehouseId,
    gmtModifiedFrom: formatDateTimeForWms(start),
    gmtModifiedTo: `${today} 23:59:59`,
  }, wmsOrderMaxPages());
  const orders = orderRows.flatMap((order) => normalizeSeaOrderRows(order, connection, productByGoodsSkuId));

  return {
    warehouseId: connection.id,
    ok: true,
    skipped: false,
    message: orders.length === 0 ? "SEA WMS 出库单接口成功但没有返回 SKU 明细。" : "",
    resolvedWarehouseId,
    orders,
  };
}

async function syncSeaStockupOrdersFromApi(connection) {
  const credentials = seaCredentials(connection);
  if (!hasSeaCredentials(credentials)) {
    return {
      warehouseId: connection.id,
      warehouseName: connection.name,
      providerId: connection.providerId,
      ok: false,
      skipped: true,
      message: "缺少 SEA WMS baseUrl / AppKey / AppSecret，已跳过备货单同步。",
      docUrl: "https://s.apifox.cn/422721aa-3e4e-48b3-89dd-eae8192f22ac/api-218738345",
      orders: [],
    };
  }

  const resolvedWarehouseId = await resolveSeaWarehouseId(credentials, connection);
  const productRows = await fetchSeaPageList(credentials, "/goods/search_goods_sku_page", { pageSize: 100 });
  const productByGoodsSkuId = new Map(
    productRows
      .map((item) => [
        firstText(item.goodsSkuId, item.id),
        firstText(item.goodsSkuOuterId, item.sku, item.skuCode, item.goodsSkuCode, item.goodsCode, item.customSku),
      ])
      .filter(([goodsSkuId, sku]) => goodsSkuId && sku),
  );

  const rows = await fetchSeaPageList(credentials, "/warehouse_stock_order/search_page", {
    pageSize: 100,
    warehouseId: resolvedWarehouseId,
  });
  const orders = rows.flatMap((order) => normalizeSeaStockupRows(order, connection, productByGoodsSkuId));

  return {
    warehouseId: connection.id,
    warehouseName: connection.name,
    providerId: connection.providerId,
    ok: true,
    skipped: false,
    message: orders.length === 0 ? "SEA WMS 备货单接口同步成功，但没有返回 SKU 明细。" : "",
    docUrl: "https://s.apifox.cn/422721aa-3e4e-48b3-89dd-eae8192f22ac/api-218738345",
    resolvedWarehouseId,
    orders,
  };
}

export async function syncSeaWarehouse(connection) {
  const credentials = seaCredentials(connection);
  if (!hasSeaCredentials(credentials)) {
    return {
      warehouseId: connection.id,
      ok: false,
      skipped: true,
      message: "缺少 SEA WMS baseUrl / AppKey / AppSecret，已跳过真实同步。",
      products: [],
      inventory: [],
    };
  }

  const resolvedWarehouseId = await resolveSeaWarehouseId(credentials, connection);
  const productRows = await fetchSeaPageList(credentials, "/goods/search_goods_sku_page", { pageSize: 100 });
  const inventoryRows = await fetchSeaPageList(credentials, "/goods_sku_warehouse/search_page", {
    pageSize: 100,
    warehouseId: resolvedWarehouseId,
    isShowAllStock: 1,
  });

  const products = productRows.map((item) => normalizeSeaProduct(item, connection)).filter((item) => item.sku);
  const rawInventory = inventoryRows.map((item) => normalizeSeaInventory(item, connection)).filter((item) => item.sku);
  const inventory = alignInventorySkuWithProducts(rawInventory, products, connection);

  return {
    warehouseId: connection.id,
    ok: true,
    skipped: false,
    message: inventory.length === 0 ? `库存接口成功但返回 0 条；请确认 ${resolvedWarehouseId} 是否为库存接口 warehouseId。` : "",
    resolvedWarehouseId,
    products,
    inventory,
  };
}

export async function syncYunWmsWarehouse(connection) {
  const credentials = yunCredentials(connection);
  if (!hasYunCredentials(credentials)) {
    return {
      warehouseId: connection.id,
      ok: false,
      skipped: true,
      message: "缺少 YunWMS baseUrl / appKey / appToken，已跳过真实同步。",
      products: [],
      inventory: [],
    };
  }

  const warehouseCode = await resolveYunWarehouseCode(credentials, connection);
  const products = (await fetchYunPageList(credentials, "getProductList", {}, 200))
    .map((item) => normalizeYunProduct(item, connection))
    .filter((item) => item.sku);
  const inventoryParams = warehouseCode ? { warehouse_code: warehouseCode } : {};
  const inventory = (await fetchYunPageList(credentials, "getProductInventory", inventoryParams, 200))
    .map((item) => normalizeYunInventory(item, connection))
    .filter((item) => item.sku);

  return {
    warehouseId: connection.id,
    ok: true,
    skipped: false,
    message: inventory.length === 0 ? `YunWMS 库存接口成功但返回 0 条；请确认仓库代码 ${warehouseCode || "(空)"}。` : "",
    resolvedWarehouseId: warehouseCode,
    products,
    inventory,
  };
}

export async function syncWarehouseConnection(connection) {
  if (connection.providerId === "sea_wms") return syncSeaWarehouse(connection);
  if (connection.providerId === "yunwms_ru") return syncYunWmsWarehouse(connection);
  return {
    warehouseId: connection.id,
    ok: false,
    skipped: true,
    message: `未知 WMS provider: ${connection.providerId}`,
    products: [],
    inventory: [],
  };
}

export async function syncWarehouseOrders(connection, days = 90) {
  if (connection.providerId === "yunwms_ru") return syncYunWmsOrders(connection, days);
  if (connection.providerId === "sea_wms") return syncSeaOrdersFromApi(connection, days);
  return {
    warehouseId: connection.id,
    ok: false,
    skipped: true,
    message: `未知 WMS provider: ${connection.providerId}`,
    orders: [],
  };
}

export async function syncWarehouseStockupOrders(connection) {
  if (connection.providerId === "sea_wms") return syncSeaStockupOrdersFromApi(connection);

  const docUrl = connection.providerId === "yunwms_ru"
    ? "https://fsdd.yunwms.com/api-doc/index.php"
    : "https://s.apifox.cn/422721aa-3e4e-48b3-89dd-eae8192f22ac/api-218738345";

  return {
    warehouseId: connection.id,
    warehouseName: connection.name,
    providerId: connection.providerId,
    ok: false,
    skipped: true,
    message: connection.providerId === "yunwms_ru"
      ? "俄罗斯 YunWMS 入库单模块已预留，请确认具体 service 名称和返回字段后启用真实同步。"
      : "备货单 / 入库单明细接口已预留，请补充该 WMS 的鉴权参数、请求路径和字段映射后启用真实同步。",
    docUrl,
    orders: [],
  };
}

export function mergeWarehouseDataIntoProducts(productPayload, warehousePayload) {
  const imageBySku = new Map();
  const inventoryBySku = new Map();

  for (const item of warehousePayload.products || []) {
    if (item.sku && item.imageUrl && !imageBySku.has(item.sku)) imageBySku.set(item.sku, item);
    if (item.countrySku && item.imageUrl && !imageBySku.has(item.countrySku)) imageBySku.set(item.countrySku, item);
  }

  const productKeys = new Set();
  for (const product of productPayload.catalog || []) {
    const country = normalizeCountryName(product.country);
    const sku = firstText(product.sku);
    const countrySku = firstText(product.countrySku, country && sku ? `${country}-${sku}` : "");
    [countrySku, country && sku ? `${country}-${sku}` : "", country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : ""]
      .filter(Boolean)
      .forEach((key) => productKeys.add(key));
  }

  const warehouseOnlyInventory = [];

  for (const item of warehousePayload.inventory || []) {
    const country = normalizeCountryName(item.country);
    const sku = firstText(item.sku);
    const countrySku = firstText(item.countrySku);
    const normalizedCountrySku = countrySku.includes("-") ? `${country}-${countrySku.split("-").slice(1).join("-")}` : "";
    const aliasSku = country && sku && !sku.startsWith("TZKJ-") ? `${country}-TZKJ-${skuSuffix(sku)}` : "";
    const keys = [...new Set([
      normalizedCountrySku || (country && sku ? `${country}-${sku}` : ""),
      country && sku ? `${country}-${sku}` : "",
      aliasSku,
      !country ? sku : "",
    ].filter(Boolean))];

    if (!keys.some((key) => productKeys.has(key))) {
      warehouseOnlyInventory.push({
        ...item,
        country,
        countrySku: normalizedCountrySku || item.countrySku,
      });
    }

    for (const key of keys) {
      const detail = {
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        availableQty: item.availableQty,
        lockedQty: item.lockedQty,
        inTransitQty: item.inTransitQty,
        totalQty: item.totalQty,
      };
      const existing = inventoryBySku.get(key) || { ...item, country, availableQty: 0, lockedQty: 0, inTransitQty: 0, totalQty: 0, warehouseBreakdown: [] };
      const warehouseBreakdown = [...(existing.warehouseBreakdown || [])];
      const detailIndex = warehouseBreakdown.findIndex((row) => row.warehouseId === detail.warehouseId && row.warehouseName === detail.warehouseName);
      if (detailIndex >= 0) {
        warehouseBreakdown[detailIndex] = {
          ...warehouseBreakdown[detailIndex],
          availableQty: warehouseBreakdown[detailIndex].availableQty + detail.availableQty,
          lockedQty: warehouseBreakdown[detailIndex].lockedQty + detail.lockedQty,
          inTransitQty: warehouseBreakdown[detailIndex].inTransitQty + detail.inTransitQty,
          totalQty: warehouseBreakdown[detailIndex].totalQty + detail.totalQty,
        };
      } else {
        warehouseBreakdown.push(detail);
      }
      inventoryBySku.set(key, {
        ...existing,
        availableQty: existing.availableQty + item.availableQty,
        lockedQty: existing.lockedQty + item.lockedQty,
        inTransitQty: existing.inTransitQty + item.inTransitQty,
        totalQty: existing.totalQty + item.totalQty,
        warehouseBreakdown,
        syncedAt: item.syncedAt,
      });
    }
  }

  const catalog = productPayload.catalog.map((product) => {
    const country = normalizeCountryName(product.country);
    const sku = firstText(product.sku);
    const countrySku = firstText(product.countrySku, country && sku ? `${country}-${sku}` : "");
    const imageFallback = imageBySku.get(product.countrySku) || imageBySku.get(product.sku);
    const inventory = inventoryBySku.get(countrySku) || inventoryBySku.get(country && sku ? `${country}-${sku}` : "") || inventoryBySku.get(country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : "");
    return {
      ...product,
      imageUrl: product.imageUrl || imageFallback?.imageUrl || "",
      imageSource: product.imageUrl ? product.imageSource : imageFallback?.imageSource || product.imageSource || "",
      stockQty: inventory ? inventory.availableQty : product.stockQty,
      lockedQty: inventory ? inventory.lockedQty : product.lockedQty || 0,
      inTransitQty: inventory ? inventory.inTransitQty : product.inTransitQty || 0,
      warehouseTotalQty: inventory ? inventory.totalQty : product.warehouseTotalQty || product.stockQty || 0,
      warehouseBreakdown: inventory?.warehouseBreakdown || product.warehouseBreakdown || [],
      dataGap: inventory ? "" : "warehouse_missing",
      warehouseSyncedAt: inventory?.syncedAt || product.warehouseSyncedAt || "",
      status: inventory ? "库存已同步" : product.status,
    };
  });

  return {
    ...productPayload,
    catalog,
    counts: {
      ...productPayload.counts,
      warehouseImages: catalog.filter((product) => product.imageSource === "wms").length,
      stockSynced: catalog.filter((product) => product.warehouseSyncedAt).length,
      warehouseOnlyInventory: warehouseOnlyInventory.length,
      productMissingWarehouse: catalog.filter((product) => product.dataGap === "warehouse_missing").length,
    },
    warehouseOnlyInventory,
  };
}

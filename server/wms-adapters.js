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
  const value = Number(process.env.WMS_ORDER_MAX_PAGES || 200);
  return Number.isFinite(value) && value > 0 ? Math.min(200, Math.floor(value)) : 200;
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

function firstPositiveNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function roundMoney(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function allocateOrderSalesAmount(items = [], orderAmount = 0) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return [];
  const total = Math.max(0, Number(orderAmount) || 0);
  const explicitWeights = safeItems.map((item) => {
    const explicitLineTotal = firstPositiveNumber(
      item.order_sale_amount,
      item.line_sale_amount,
      item.line_amount,
      item.product_total_amount,
      item.total_price,
      item.sale_amount,
    );
    if (explicitLineTotal > 0) return explicitLineTotal;
    const quantity = firstNumber(item.quantity, item.qty, item.product_quantity);
    const unitPrice = firstPositiveNumber(item.unit_price, item.product_price, item.sale_price, item.price);
    return quantity > 0 && unitPrice > 0 ? quantity * unitPrice : 0;
  });
  const explicitTotal = explicitWeights.reduce((sum, value) => sum + value, 0);
  const quantityWeights = safeItems.map((item) => Math.max(0, firstNumber(item.quantity, item.qty, item.product_quantity)));
  const quantityTotal = quantityWeights.reduce((sum, value) => sum + value, 0);
  const weights = explicitTotal > 0 ? explicitWeights : quantityWeights;
  const weightTotal = explicitTotal > 0 ? explicitTotal : quantityTotal;

  // A missing order total must never fall back to item/unit prices. Several WMS
  // payloads expose catalogue or declared prices on the item, which are not the
  // amount actually paid by the customer. Keep those values as weights only.
  if (total <= 0) return safeItems.map(() => 0);
  if (weightTotal <= 0) {
    const evenShare = total / safeItems.length;
    return safeItems.map((_, index) => index === safeItems.length - 1
      ? roundMoney(total - roundMoney(evenShare) * (safeItems.length - 1))
      : roundMoney(evenShare));
  }

  let allocated = 0;
  return weights.map((weight, index) => {
    if (index === safeItems.length - 1) return roundMoney(total - allocated);
    const value = roundMoney(total * (weight / weightTotal));
    allocated = roundMoney(allocated + value);
    return value;
  });
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function formatDateTimeForWms(date) {
  return `${date} 00:00:00`;
}

function normalizeDateOnly(date) {
  if (!date) return new Date().toISOString().slice(0, 10);
  if (date instanceof Date) return date.toISOString().slice(0, 10);
  return String(date).slice(0, 10);
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
    warehouseCode: getEnv(`${prefix}_WAREHOUSE_CODE`) || connection.warehouseCode || connection.warehouseId || connection.resolvedWarehouseId,
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
    warehouseCode: getEnv(`${prefix}_WAREHOUSE_CODE`) || connection.warehouseCode || connection.warehouseId || connection.resolvedWarehouseId,
  };
}

function hasYunCredentials(credentials) {
  return Boolean(credentials.baseUrl && credentials.appKey && credentials.appToken);
}

function configuredText(value) {
  const normalized = firstText(value);
  return normalized && !/^(待配置|待授权|未配置|undefined|null)$/i.test(normalized) ? normalized : "";
}

export function warehouseStockupCreateCapability(connection) {
  if (connection?.providerId === "sea_wms") {
    const credentials = seaCredentials(connection);
    const configured = hasSeaCredentials(credentials) && Boolean(configuredText(credentials.warehouseId || credentials.warehouseCode));
    return {
      supported: true,
      configured,
      createMode: "草稿备货单",
      message: configured ? "确认后将在 SEA WMS 创建草稿备货单。" : "需要先配置 SEA WMS 授权及仓库 ID。",
    };
  }
  if (connection?.providerId === "yunwms_ru") {
    const credentials = yunCredentials(connection);
    const configured = hasYunCredentials(credentials);
    return {
      supported: true,
      configured,
      createMode: "未审核入库单",
      message: configured ? "确认后将在 YunWMS 创建未审核入库单。" : "需要先配置 YunWMS 授权。",
    };
  }
  return {
    supported: false,
    configured: false,
    createMode: "",
    message: `当前 WMS 类型 ${connection?.providerId || "未知"} 尚未接入创建接口。`,
  };
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

function yunWebOrigin(credentials) {
  try {
    return new URL(credentials.baseUrl).origin;
  } catch {
    throw new Error("YunWMS 地址无效，不能连接平台订单模块。");
  }
}

function splitSetCookieHeader(value) {
  return String(value || "")
    .split(/,(?=\s*[^;,=\s]+=[^;,]*)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function responseSetCookies(headers) {
  if (typeof headers?.getSetCookie === "function") return headers.getSetCookie();
  return splitSetCookieHeader(headers?.get?.("set-cookie"));
}

function absorbCookies(jar, headers) {
  for (const header of responseSetCookies(headers)) {
    const pair = header.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function requestYunWeb(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), wmsTimeoutMs());
  try {
    const response = await fetch(url, { redirect: "manual", ...options, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("YunWMS 平台订单请求超时，请稍后重试。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function nestedYunData(payload) {
  return payload?.data?.data && typeof payload.data.data === "object" ? payload.data.data
    : payload?.data && typeof payload.data === "object" ? payload.data : {};
}

async function createYunWebSession(credentials) {
  const account = await postYun(credentials, "getAccount", {});
  const companyCode = firstText(account?.data?.company_code, account?.data?.companyCode);
  if (!companyCode) throw new Error("YunWMS 未返回公司代码，不能进入平台订单模块。");

  const sso = await postYun(credentials, "getSsoToken", { company_code: companyCode });
  const ssoData = nestedYunData(sso);
  const userCode = firstText(ssoData.userCode, ssoData.user_code);
  const token = firstText(ssoData.token);
  if (!userCode || !token) throw new Error("YunWMS 未返回一次性登录凭证，不能处理待生成订单。");

  const origin = yunWebOrigin(credentials);
  const jar = new Map();
  let target = new URL("/default/index/quick-login", origin);
  target.searchParams.set("userCode", userCode);
  target.searchParams.set("token", token);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (target.origin !== origin) throw new Error("YunWMS 登录跳转到了其他域名，已停止处理。");
    const { response } = await requestYunWeb(target, {
      headers: cookieHeader(jar) ? { Cookie: cookieHeader(jar) } : {},
    });
    absorbCookies(jar, response.headers);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.ok) throw new Error(`YunWMS 一次性登录失败（HTTP ${response.status}）。`);
      break;
    }
    const location = response.headers.get("location");
    if (!location) throw new Error("YunWMS 一次性登录缺少跳转地址。");
    target = new URL(location, target);
  }
  if (!jar.size) throw new Error("YunWMS 一次性登录未建立会话，请检查接口授权范围。");
  return { origin, cookies: cookieHeader(jar) };
}

function parseYunWebJson(text, label) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`YunWMS ${label}返回了非 JSON 内容，请稍后重试。`);
  }
}

async function postYunWeb(session, pathname, params = {}) {
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(name, String(item ?? "")));
    else body.append(name, String(value ?? ""));
  }
  const url = new URL(pathname, session.origin);
  if (url.origin !== session.origin) throw new Error("YunWMS 请求地址越界，已停止处理。");
  const { response, text } = await requestYunWeb(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${session.origin}/platform/order/list`,
      Cookie: session.cookies,
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`YunWMS 平台订单接口失败（HTTP ${response.status}）。`);
  return parseYunWebJson(text, "平台订单接口");
}

function yunPlatformRows(payload) {
  if (!payload?.data || typeof payload.data !== "object" || Array.isArray(payload.data)) return [];
  const ids = Array.isArray(payload.orderIdArr) ? payload.orderIdArr.map(String) : Object.keys(payload.data);
  return ids.map((id) => payload.data[id]).filter((row) => row && typeof row === "object");
}

function normalizeYunPlatformReference(row = {}) {
  return firstText(row.refrence_no, row.reference_no, row.refrence_no_platform, row.third_part_order_no);
}

function comparableWmsShop(value) {
  return firstText(value).replace(/[\s-]+/g, "_").toUpperCase();
}

async function findYunPendingPlatformOrder(session, referenceNo, expectedShop = "") {
  const payload = await postYunWeb(session, "/platform/order/list/page/1/pageSize/20", {
    status: "2",
    refrenceNo: referenceNo,
  });
  if (Number(payload?.state) !== 1) {
    throw new Error(`YunWMS 待生成订单查询失败：${firstText(payload?.message) || "未知错误"}`);
  }
  const matches = yunPlatformRows(payload).filter((row) => normalizeYunPlatformReference(row) === referenceNo);
  if (!matches.length) return { found: false, payload };
  if (matches.length > 1) throw new Error("YunWMS 返回多张相同参考号的待生成订单，已停止自动处理，请联系管理员核对。");
  const row = matches[0];
  if (firstText(row.platform).toUpperCase() !== "OZON") {
    throw new Error(`YunWMS 待生成订单的平台为 ${firstText(row.platform) || "未知"}，与 Ozon 不一致。`);
  }
  const actualShop = firstText(row.user_account, row.platform_user_name);
  if (expectedShop && actualShop && comparableWmsShop(actualShop) !== comparableWmsShop(expectedShop)) {
    throw new Error(`YunWMS 待生成订单店铺 ${actualShop} 与路由店铺 ${expectedShop} 不一致，已停止处理。`);
  }
  return { found: true, row, payload };
}

function htmlAttribute(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return firstText(match?.[1]);
}

function decodeHtmlLabel(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function yunWarehouseOptionsFromHtml(html) {
  const select = String(html || "").match(/<select[^>]*name=["']order_allot\[warehouse_id\]["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!select) return [];
  return Array.from(select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)).map((match) => ({
    value: htmlAttribute(match[1], "value"),
    label: decodeHtmlLabel(match[2]),
    selected: /\bselected(?:\s*=|\s|$)/i.test(match[1]),
    raw: match[1],
  })).filter((option) => option.value && option.value !== "0");
}

async function resolveYunWebWarehouseId(session, input = {}) {
  const explicit = firstText(input.webWarehouseId, input.connection?.webWarehouseId, input.connection?.credentials?.webWarehouseId);
  if (explicit) return explicit;
  const { response, text } = await requestYunWeb(new URL("/platform/order/list", session.origin), {
    headers: { Cookie: session.cookies },
  });
  if (!response.ok) throw new Error(`YunWMS 仓库选项读取失败（HTTP ${response.status}）。`);
  const options = yunWarehouseOptionsFromHtml(text);
  const warehouseCode = firstText(input.warehouseCode).toUpperCase();
  const warehouseName = firstText(input.connection?.name).toUpperCase();
  const exact = options.find((option) => warehouseCode && `${option.raw} ${option.label}`.toUpperCase().includes(warehouseCode))
    || options.find((option) => warehouseName && option.label.toUpperCase().includes(warehouseName));
  if (exact) return exact.value;
  const selected = options.filter((option) => option.selected);
  if (selected.length === 1) return selected[0].value;
  if (options.length === 1) return options[0].value;
  throw new Error("YunWMS 有多个可用仓库，无法自动确定平台订单的处理仓库；请先完善仓库路由代码。");
}

function yunVerifyFailureMessage(payload) {
  const failures = Array.isArray(payload?.failArr) ? payload.failArr : [];
  return failures.map((item) => firstText(item?.message, item?.msg, item?.rs?.message)).filter(Boolean).join("；")
    || firstText(payload?.message, payload?.msg) || "未知错误";
}

async function generateYunPendingPlatformOrder(connection, credentials, input = {}) {
  const referenceNo = firstText(input.referenceNo);
  const session = await createYunWebSession(credentials);
  const pending = await findYunPendingPlatformOrder(session, referenceNo, firstText(input.platformShop));
  if (!pending.found) return { found: false, platformPending: false, generationRequested: false };
  const shippingMethod = firstText(input.shippingMethod);
  if (!shippingMethod) throw new Error("未配置 WMS 物流方式代码，不能生成待审核出库单。");
  const warehouseId = await resolveYunWebWarehouseId(session, {
    connection,
    warehouseCode: firstText(input.warehouseCode, connection?.warehouseCode, connection?.resolvedWarehouseId),
    webWarehouseId: input.webWarehouseId,
  });
  // YunWMS renders this exact value into the selected row's `ref_id`
  // attribute. The endpoint does not accept the Ozon posting/reference
  // number here; sending it produces the misleading "current OMS data"
  // authorization error even though the order belongs to this account.
  const platformReferenceId = firstText(pending.row?.refrence_no_platform);
  if (!platformReferenceId) throw new Error("YunWMS 待生成订单缺少平台单号，已停止自动审单。请在 WMS 核对订单数据。");
  const payload = await postYunWeb(session, "/platform/order-op/verify?type=D&order_type=0", {
    "order_allot[warehouse_id]": warehouseId,
    "order_allot[shipping_method]": shippingMethod,
    "order_allot[tail_method]": "",
    "ref_id[]": platformReferenceId,
  });
  const successCount = firstNumber(payload?.success_count, payload?.successCount);
  const failCount = firstNumber(payload?.fail_count, payload?.failCount);
  if (successCount !== 1 || failCount > 0) {
    throw new Error(`YunWMS 生成正式出库单失败：${yunVerifyFailureMessage(payload)}`);
  }
  return {
    found: true,
    platformPending: true,
    generationRequested: true,
    platformOrderId: firstText(pending.row?.order_id),
    platformReferenceId,
    platformShop: firstText(pending.row?.user_account, pending.row?.platform_user_name),
    warehouseId,
  };
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
  return (await fetchSeaPageListWithMeta(credentials, endpoint, body, maxPages)).items;
}

async function fetchSeaPageListWithMeta(credentials, endpoint, body, maxPages = 20) {
  const items = [];
  let cursor = "";
  let pagesRead = 0;
  let apiTotal = 0;
  let pageSize = firstNumber(body?.pageSize);
  let reachedPageLimit = false;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = await postSea(credentials, endpoint, cursor ? { ...body, cursor } : body);
    if (!isSuccessfulPayload(payload)) {
      throw new Error(`SEA WMS 接口返回异常：${payloadMessage(payload)}`);
    }
    const rows = listFromPayload(payload);
    items.push(...rows);
    pagesRead = page + 1;
    apiTotal = Math.max(apiTotal, firstNumber(payload?.data?.total, payload?.data?.totalCount, payload?.total));
    pageSize = firstNumber(payload?.data?.pageSize, payload?.pageSize, pageSize);
    const nextCursor = firstText(payload?.data?.cursor);
    if (!nextCursor || nextCursor === cursor || !rows.length) break;
    if (page === maxPages - 1) {
      reachedPageLimit = true;
      cursor = nextCursor;
      break;
    }
    cursor = nextCursor;
  }
  return {
    items,
    apiTotal,
    pageSize,
    pagesRead,
    pageLimit: maxPages,
    reachedPageLimit,
    cursor,
  };
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

export function normalizeSeaOrderRows(order, connection, productByGoodsSkuId = new Map()) {
  const status = firstText(order.stage, order.status);
  const shippedAt = firstText(order.gmtOutStorage);
  if (!shippedAt && status !== "has_out_storage") return [];
  const createdAt = firstText(order.gmtSubmit, order.gmtCreate, order.gmtOrderStart);
  const orderNo = firstText(order.platformOrderSn, order.appPackageNo, order.orderId);
  const platform = firstText(order.platform, order.platformCode, order.platformName);
  const shopName = firstText(order.shopName, order.storeName, order.platformShop, order.platform_shop, order.shopCode, order.shopId);
  const projectGroup = /^TZ/i.test(firstText(shopName, orderNo)) ? "同舟跨境项目" : "深六项目";
  const rawItems = Array.isArray(order.items) ? order.items : [];
  const orderSalesAmount = firstPositiveNumber(
    order.orderAmount,
    order.actualPayAmount,
    order.paidAmount,
    order.paymentAmount,
    order.totalAmount,
  );
  const allocatedSalesAmounts = allocateOrderSalesAmount(
    rawItems.map((item) => ({
      ...item,
      // SEA WMS discountedPrice is a reported line amount for affected stores;
      // multiplying it by quantity was the source of the overstatement.
      line_sale_amount: firstPositiveNumber(
        item.lineAmount,
        item.lineTotal,
        item.totalPrice,
        item.discountedPrice,
      ),
    })),
    orderSalesAmount,
  );
  const allocatedTotal = allocatedSalesAmounts.reduce((sum, value) => sum + value, 0);
  const allocationResidual = roundMoney(orderSalesAmount - allocatedTotal);
  const currency = firstText(order.currency);
  const salesAmountValid = orderSalesAmount > 0 && Boolean(currency) && Math.abs(allocationResidual) <= 0.01;

  return rawItems
    .map((item, index) => {
      const productSku = productByGoodsSkuId.get(firstText(item.goodsSkuId));
      const sku = firstText(item.goodsSkuOuterId, productSku, item.sku, item.goodsSkuCode);
      const quantity = firstNumber(item.quantity, item.qty);
      return {
        orderId: firstText(order.orderId, orderNo),
        orderNo,
        lineId: firstText(item.id, item.orderItemId, item.goodsSkuId, `${orderNo}-${sku}-${index}`),
        goodsSkuId: firstText(item.goodsSkuId),
        providerId: connection.providerId,
        warehouseId: connection.id,
        warehouseName: connection.name,
        country: connection.country,
        status,
        shippedAt,
        createdAt,
        platform,
        shopName,
        shopCode: shopName,
        projectGroup,
        sku,
        productName: firstText(item.goodsName, item.skuName, item.productName, sku),
        quantity,
        salesAmount: salesAmountValid ? allocatedSalesAmounts[index] || 0 : 0,
        salesAmountScope: salesAmountValid ? "order_allocated" : "missing_order_amount",
        salesAmountSource: salesAmountValid ? "order.orderAmount" : "",
        salesAmountOrderTotal: orderSalesAmount,
        salesAmountAllocationResidual: allocationResidual,
        salesAmountValid,
        currency: salesAmountValid ? currency : "",
        rawProvider: connection.providerId,
      };
    })
    .filter((item) => item.quantity > 0);
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

function validateCreateLines(input) {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (!lines.length) throw new Error("WMS 建单至少需要一条 SKU 明细。");
  return lines.map((line, index) => {
    const sku = firstText(line.sku);
    const quantity = firstNumber(line.quantity);
    if (!sku) throw new Error(`WMS 建单第 ${index + 1} 行缺少 SKU。`);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`${sku} 的 WMS 入库数量必须是大于 0 的整数。`);
    return {
      sku,
      quantity,
      productName: firstText(line.productName),
      offerId: firstText(line.offerId),
      unitPrice: Math.max(0, firstNumber(line.unitPrice)),
      purchasePrice: Math.max(0, firstNumber(line.purchasePrice)),
      purchasePriceCurrency: firstText(line.purchasePriceCurrency, "CNY") || "CNY",
      boxSequence: Math.max(1, Math.floor(firstNumber(line.boxSequence, index + 1))),
    };
  });
}

async function createSeaStockupOrder(connection, input) {
  const credentials = seaCredentials(connection);
  if (!hasSeaCredentials(credentials)) throw new Error("缺少 SEA WMS baseUrl / AppKey / AppSecret，不能创建备货单。");
  const warehouseId = await resolveSeaWarehouseId(credentials, connection);
  if (!configuredText(warehouseId)) throw new Error("未解析到 SEA WMS 仓库 ID，不能创建备货单。");
  const lines = validateCreateLines(input);
  const carrier = firstText(input.carrier);
  const trackingNo = firstText(input.trackingNo);
  const payload = await postSea(credentials, "/warehouse_stock_order/add", {
    warehouseId,
    isDraft: 1,
    thirdOrderSn: firstText(input.referenceNo).slice(0, 50),
    customerNote: firstText(input.customerNote).slice(0, 200),
    ...(carrier && trackingNo ? { logisticsCompany: carrier, trackingNo } : {}),
    goodsSkuList: lines.map((line) => ({
      goodsSkuOuterId: line.sku,
      boxSn: line.boxSequence,
      quantity: line.quantity,
      purchasePrice: line.purchasePrice,
      purchasePriceCurrency: line.purchasePriceCurrency,
    })),
  });
  if (!isSuccessfulPayload(payload) || payload?.success === false) {
    throw new Error(`SEA WMS 创建草稿备货单失败：${payloadMessage(payload)}`);
  }
  const orderNo = firstText(
    payload?.data?.warehouseStockOrderNo,
    payload?.data?.warehouseStockOrderId,
    payload?.warehouseStockOrderNo,
    payload?.warehouseStockOrderId,
  );
  if (!orderNo) throw new Error("SEA WMS 返回成功但缺少备货单 ID，请在 WMS 核实后再重试，避免重复建单。");
  return {
    ok: true,
    providerId: connection.providerId,
    createMode: "draft",
    warehouseId,
    orderNo,
    raw: payload,
  };
}

async function createYunAsn(connection, input) {
  const credentials = yunCredentials(connection);
  if (!hasYunCredentials(credentials)) throw new Error("缺少 YunWMS baseUrl / appKey / appToken，不能创建入库单。");
  const warehouseCode = await resolveYunWarehouseCode(credentials, connection);
  if (!configuredText(warehouseCode)) throw new Error("未解析到 YunWMS 仓库编码，不能创建入库单。");
  const lines = validateCreateLines(input);
  const payload = await postYun(credentials, "createAsn", {
    reference_no: firstText(input.referenceNo).slice(0, 50),
    warehouse_code: warehouseCode,
    verify: 0,
    income_type: 0,
    receiving_type: "D",
    ...(firstText(input.trackingNo) ? { tracking_number: firstText(input.trackingNo) } : {}),
    ...(firstText(input.carrier) ? { shipping_method: firstText(input.carrier) } : {}),
    ...(firstText(input.customerNote) ? { receiving_desc: firstText(input.customerNote).slice(0, 200) } : {}),
    items: lines.map((line) => ({
      product_sku: line.sku,
      quantity: line.quantity,
      box_no: String(line.boxSequence),
      product_price: line.purchasePrice,
      currency_code: line.purchasePriceCurrency,
    })),
  });
  if (String(payload?.ask || "").toLowerCase() !== "success") {
    throw new Error(`YunWMS 创建未审核入库单失败：${firstText(payload?.message, payload?.error) || "未知错误"}`);
  }
  const orderNo = firstText(payload?.data?.receiving_code, payload?.data?.receivingCode, payload?.receiving_code);
  if (!orderNo) throw new Error("YunWMS 返回成功但缺少入库单号，请在 WMS 核实后再重试，避免重复建单。");
  return {
    ok: true,
    providerId: connection.providerId,
    createMode: "unverified",
    warehouseId: warehouseCode,
    orderNo,
    raw: payload,
  };
}

export async function createWarehouseStockupOrder(connection, input) {
  const capability = warehouseStockupCreateCapability(connection);
  if (!capability.supported) throw new Error(capability.message);
  if (!capability.configured) throw new Error(capability.message);
  if (!firstText(input?.referenceNo)) throw new Error("缺少外部参考号，不能安全创建 WMS 单据。");
  if (connection.providerId === "sea_wms") return createSeaStockupOrder(connection, input);
  if (connection.providerId === "yunwms_ru") return createYunAsn(connection, input);
  throw new Error(capability.message);
}

export function warehouseOutboundCreateCapability(connection) {
  if (connection?.providerId !== "yunwms_ru") {
    return {
      supported: false,
      configured: false,
      message: "当前仅俄罗斯 YunWMS 支持平台订单推单。",
    };
  }
  const credentials = yunCredentials(connection);
  const configured = hasYunCredentials(credentials) && Boolean(configuredText(credentials.warehouseCode));
  return {
    supported: true,
    configured,
    message: configured ? "可创建并审核俄罗斯 YunWMS 出库单。" : "请先完成俄罗斯 YunWMS 授权及仓库代码配置。",
  };
}

function normalizeYunOutboundOrder(payload, connection, normalizedReferenceNo) {
  const order = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const orderNo = firstText(order.order_code, payload?.order_code);
  const message = firstText(payload?.message, payload?.Error?.errMessage, payload?.error);
  const success = String(payload?.ask || "").toLowerCase() === "success";
  const clearlyNotFound = /not\s*found|does\s*not\s*exist|no\s*data|不存在|未找到|查询不到|无此/i.test(message);
  if (!success && !orderNo && !clearlyNotFound) {
    throw new Error(`YunWMS 查询订单失败：${message || "未知错误"}`);
  }
  const items = Array.isArray(order.items) ? order.items
    : Array.isArray(order.item) ? order.item
      : Array.isArray(order.products) ? order.products : [];
  return {
    summary: {
      ok: true,
      found: Boolean(orderNo),
      providerId: connection.providerId,
      referenceNo: normalizedReferenceNo,
      orderNo,
      status: firstText(order.order_status, order.status).toUpperCase(),
      platform: firstText(order.platform),
      platformShop: firstText(order.platform_shop, order.platformShop),
      warehouseCode: firstText(order.warehouse_code, order.warehouseCode),
      shippingMethod: firstText(order.shipping_method, order.shippingMethod),
      createdAt: firstText(order.date_create, order.created_at),
      releasedAt: firstText(order.date_release, order.released_at),
      shippedAt: firstText(order.date_shipping, order.shipped_at),
      items: items.map((item) => ({
        sku: firstText(item.product_sku, item.sku, item.reference_no).toUpperCase(),
        quantity: Math.max(0, firstNumber(item.quantity, item.qty, item.product_quantity)),
      })).filter((item) => item.sku),
    },
    order,
  };
}

async function queryYunOutboundOrder(connection, referenceNo) {
  if (connection?.providerId !== "yunwms_ru") {
    throw new Error("当前仅俄罗斯 YunWMS 支持 Ozon 订单查询。");
  }
  const credentials = yunCredentials(connection);
  if (!hasYunCredentials(credentials)) {
    throw new Error("缺少 YunWMS baseUrl / appKey / appToken，不能查询 Ozon 订单。");
  }
  const normalizedReferenceNo = firstText(referenceNo);
  if (!normalizedReferenceNo) throw new Error("缺少 Ozon 发货单号，不能查询 WMS。");

  const payload = await postYun(credentials, "getOrderByRefCode", { reference_no: normalizedReferenceNo });
  return { credentials, ...normalizeYunOutboundOrder(payload, connection, normalizedReferenceNo) };
}

export async function findWarehouseOutboundOrder(connection, referenceNo) {
  const result = await queryYunOutboundOrder(connection, referenceNo);
  return result.summary;
}

function outboundLineMap(items = []) {
  const result = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const sku = firstText(item?.sku, item?.product_sku).toUpperCase();
    const quantity = Math.max(0, firstNumber(item?.quantity, item?.qty, item?.product_quantity));
    if (!sku || quantity <= 0) continue;
    result.set(sku, (result.get(sku) || 0) + quantity);
  }
  return result;
}

function outboundLinesMatch(actualItems, expectedItems) {
  const actual = outboundLineMap(actualItems);
  const expected = outboundLineMap(expectedItems);
  if (!actual.size || actual.size !== expected.size) return false;
  return Array.from(expected).every(([sku, quantity]) => actual.get(sku) === quantity);
}

function yunOrderRecipient(order = {}, fallback = {}) {
  return {
    countryCode: firstText(order.country_code, order.consignee_country_code, fallback.countryCode, "RU").toUpperCase(),
    province: firstText(order.province, order.consignee_state, fallback.province),
    city: firstText(order.city, order.consignee_city, fallback.city),
    district: firstText(order.district, order.consignee_district, fallback.district),
    address1: firstText(order.address1, order.consignee_address1, fallback.address1),
    address2: firstText(order.address2, order.consignee_address2, fallback.address2),
    address3: firstText(order.address3, order.consignee_address3, fallback.address3),
    zipcode: firstText(order.zipcode, order.consigne_zipcode, order.consignee_zipcode, fallback.zipcode),
    doorplate: firstText(order.doorplate, order.consignee_doorplate, fallback.doorplate),
    company: firstText(order.company, order.consignee_company, fallback.company),
    name: firstText(order.name, order.consignee_name, fallback.name),
    phone: firstText(order.phone, order.consignee_phone, fallback.phone),
    cellPhone: firstText(order.cell_phone, order.consignee_cell_phone),
    phoneExtension: firstText(order.phone_extension),
    email: firstText(order.email, order.consignee_email, fallback.email),
  };
}

/**
 * Replaces the line items of an existing, unverified YunWMS order and submits
 * it for warehouse fulfillment. This intentionally never creates a new order:
 * the Ozon store integration remains the single source of WMS order creation.
 */
export async function updateAndVerifyWarehouseOutboundOrder(connection, input = {}) {
  const referenceNo = firstText(input.referenceNo);
  if (!referenceNo) throw new Error("缺少 Ozon 发货单号，不能设定 SKU 并审单。");
  const lines = validateCreateLines(input);
  let queried = await queryYunOutboundOrder(connection, referenceNo);
  let current = queried.summary;
  let generatedFromPlatformOrder = false;
  if (!current.found || !current.orderNo) {
    const generated = await generateYunPendingPlatformOrder(connection, queried.credentials, input);
    if (!generated.found) {
      return {
        ...current,
        platformPending: false,
        generationRequested: false,
        updated: false,
        verified: false,
      };
    }
    generatedFromPlatformOrder = true;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      queried = await queryYunOutboundOrder(connection, referenceNo);
      current = queried.summary;
      if (current.found && current.orderNo) break;
    }
    if (!current.found || !current.orderNo) {
      return {
        ...current,
        platformPending: true,
        generationRequested: true,
        pendingConfirmation: true,
        updated: false,
        verified: false,
      };
    }
  }

  const platform = firstText(current.platform).toUpperCase();
  if (platform && platform !== "OZON") {
    throw new Error(`WMS 返回的平台为 ${current.platform}，与 Ozon 不一致，已停止审单。`);
  }
  const expectedShop = firstText(input.platformShop);
  if (expectedShop && current.platformShop && expectedShop !== current.platformShop) {
    throw new Error(`WMS 店铺 ${current.platformShop} 与路由店铺 ${expectedShop} 不一致，已停止审单。`);
  }
  const expectedWarehouseCode = firstText(input.warehouseCode, connection?.warehouseCode, connection?.resolvedWarehouseId);
  if (expectedWarehouseCode && current.warehouseCode && expectedWarehouseCode !== current.warehouseCode) {
    throw new Error(`WMS 仓库 ${current.warehouseCode} 与路由仓库 ${expectedWarehouseCode} 不一致，已停止审单。`);
  }

  const status = firstText(current.status).toUpperCase();
  const alreadyReleased = ["W", "D"].includes(status);
  if (alreadyReleased) {
    if (!outboundLinesMatch(current.items, lines)) {
      throw new Error(`WMS 订单已${status === "D" ? "发货" : "审核到待发货"}，但 SKU / 数量与中台不一致，不能再自动修改。`);
    }
    return { ...current, updated: false, verified: true, alreadyVerified: true, generatedFromPlatformOrder };
  }
  if (status !== "C") {
    const label = { H: "暂存", N: "异常订单", P: "问题件", X: "已作废" }[status] || status || "未知";
    throw new Error(`WMS 订单当前状态为“${label}”，仅“待审核”订单允许自动设定 SKU 并审单。`);
  }

  const recipient = yunOrderRecipient(queried.order, input.recipient);
  const missing = [
    [recipient.countryCode, "国家"],
    [recipient.address1, "详细地址"],
    [recipient.zipcode, "邮编"],
    [recipient.name, "收件人"],
  ].filter(([value]) => !value).map(([, label]) => label);
  if (missing.length) {
    throw new Error(`WMS 原订单缺少${missing.join("、")}，无法安全覆盖商品明细，请先检查店铺自动拉单数据。`);
  }
  const shippingMethod = firstText(input.shippingMethod, current.shippingMethod);
  if (!expectedWarehouseCode) throw new Error("未识别俄罗斯仓库代码，已停止审单。");
  if (!shippingMethod) throw new Error("未配置 WMS 物流方式代码，已停止审单。");

  const payload = await postYun(queried.credentials, "modifyOrder", {
    order_code: current.orderNo,
    reference_no: referenceNo,
    platform: firstText(current.platform, "OZON"),
    warehouse_code: expectedWarehouseCode,
    shipping_method: shippingMethod,
    country_code: recipient.countryCode,
    province: recipient.province,
    city: recipient.city,
    district: recipient.district,
    address1: recipient.address1,
    address2: recipient.address2,
    address3: recipient.address3,
    zipcode: recipient.zipcode,
    doorplate: recipient.doorplate,
    company: recipient.company,
    name: recipient.name,
    phone: recipient.phone,
    cell_phone: recipient.cellPhone,
    phone_extension: recipient.phoneExtension,
    email: recipient.email,
    platform_shop: firstText(current.platformShop, expectedShop),
    order_desc: firstText(queried.order.order_desc, input.description, `Ozon ${referenceNo}`).slice(0, 500),
    remark: firstText(queried.order.remark, input.remark, "同舟中台设定 SKU 并审单").slice(0, 500),
    verify: 1,
    forceVerify: 0,
    async: 0,
    items: lines.map((line) => ({
      product_sku: line.sku,
      quantity: line.quantity,
      product_name: firstText(line.productName),
      product_name_en: firstText(line.productName),
      product_declared_value: firstNumber(line.unitPrice),
      reference_no: firstText(line.offerId),
    })),
  });
  if (String(payload?.ask || "").toLowerCase() !== "success") {
    throw new Error(`YunWMS 设定 SKU 并审单失败：${firstText(payload?.message, payload?.Error?.errMessage, payload?.error) || "未知错误"}`);
  }

  let confirmed = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    const next = await queryYunOutboundOrder(connection, referenceNo);
    confirmed = next.summary;
    if (["W", "D"].includes(firstText(confirmed.status).toUpperCase())) break;
  }
  if (!confirmed?.found || confirmed.orderNo !== current.orderNo) {
    throw new Error("WMS 已接收审单请求，但回查未找到同一张订单；系统已停止继续操作，请勿重复点击。");
  }
  const linesConfirmed = outboundLinesMatch(confirmed.items, lines);
  const verified = ["W", "D"].includes(firstText(confirmed.status).toUpperCase());
  if (verified && !linesConfirmed) {
    throw new Error("WMS 已完成审单，但回查的 SKU / 数量与中台不一致，请勿重复点击并联系管理员核对。");
  }
  return {
    ...confirmed,
    updated: true,
    verified: verified && linesConfirmed,
    pendingConfirmation: !verified || !linesConfirmed,
    generatedFromPlatformOrder,
  };
}

function normalizeOutboundRecipient(value = {}) {
  return {
    countryCode: firstText(value.countryCode, "RU").toUpperCase(),
    province: firstText(value.province),
    city: firstText(value.city),
    district: firstText(value.district),
    address1: firstText(value.address1),
    address2: firstText(value.address2),
    address3: firstText(value.address3),
    zipcode: firstText(value.zipcode),
    doorplate: firstText(value.doorplate),
    company: firstText(value.company),
    name: firstText(value.name),
    phone: firstText(value.phone),
    email: firstText(value.email),
  };
}

export async function createWarehouseOutboundOrder(connection, input) {
  const capability = warehouseOutboundCreateCapability(connection);
  if (!capability.supported || !capability.configured) throw new Error(capability.message);

  const referenceNo = firstText(input?.referenceNo);
  const shippingMethod = firstText(input?.shippingMethod);
  if (!referenceNo) throw new Error("缺少平台发货单号，不能安全推单。");
  if (!shippingMethod) throw new Error("请先配置该 Ozon 仓对应的 YunWMS 物流方式代码。");

  const lines = validateCreateLines(input);
  const recipient = normalizeOutboundRecipient(input?.recipient);
  const requiredRecipient = [
    [recipient.address1, "详细地址"],
    [recipient.zipcode, "邮编"],
    [recipient.name, "收件人"],
    [recipient.phone, "联系电话"],
  ].filter(([value]) => !value).map(([, label]) => label);
  if (requiredRecipient.length) throw new Error(`推单缺少${requiredRecipient.join("、")}；请补充 Ozon 仓路由的默认收件信息。`);

  const credentials = yunCredentials(connection);
  const warehouseCode = await resolveYunWarehouseCode(credentials, connection);
  if (!warehouseCode) throw new Error("未能识别俄罗斯 YunWMS 仓库代码，已停止推单。");

  // YunWMS reference_no is our idempotency key. Querying first prevents a retry
  // after a network timeout from creating a second outbound order.
  const existing = await postYun(credentials, "getOrderByRefCode", { reference_no: referenceNo });
  const existingOrderNo = firstText(existing?.data?.order_code, existing?.order_code);
  if (String(existing?.ask || "").toLowerCase() === "success" && existingOrderNo) {
    return {
      ok: true,
      duplicate: true,
      providerId: connection.providerId,
      warehouseId: warehouseCode,
      orderNo: existingOrderNo,
      referenceNo,
    };
  }

  const payload = await postYun(credentials, "createOrder", {
    platform: "OTHER",
    warehouse_code: warehouseCode,
    shipping_method: shippingMethod,
    reference_no: referenceNo,
    ...(firstText(input?.orderNumber) ? { aliexpress_order_no: firstText(input.orderNumber) } : {}),
    country_code: recipient.countryCode || "RU",
    province: recipient.province,
    city: recipient.city,
    district: recipient.district,
    address1: recipient.address1,
    address2: recipient.address2,
    address3: recipient.address3,
    zipcode: recipient.zipcode,
    doorplate: recipient.doorplate,
    company: recipient.company,
    name: recipient.name,
    phone: recipient.phone,
    email: recipient.email,
    platform_shop: firstText(input?.shopName),
    order_desc: firstText(input?.description, `Ozon ${referenceNo}`).slice(0, 500),
    remark: firstText(input?.remark, "同舟中台审核推单").slice(0, 500),
    order_sale_amount: firstNumber(input?.saleAmount),
    order_sale_currency: firstText(input?.currency, "RUB"),
    verify: input?.verify === false ? 0 : 1,
    forceVerify: 0,
    async: 0,
    items: lines.map((line) => ({
      product_sku: line.sku,
      quantity: line.quantity,
      product_name: firstText(line.productName),
      product_name_en: firstText(line.productName),
      product_declared_value: firstNumber(line.unitPrice),
      reference_no: firstText(line.offerId),
    })),
  });
  if (String(payload?.ask || "").toLowerCase() !== "success") {
    throw new Error(`YunWMS 创建订单失败：${firstText(payload?.message, payload?.Error?.errMessage, payload?.error) || "未知错误"}`);
  }
  const orderNo = firstText(payload?.order_code, payload?.data?.order_code);
  if (!orderNo) throw new Error("YunWMS 返回成功但缺少订单号；请先在 WMS 核对，避免重复推单。");
  return {
    ok: true,
    duplicate: false,
    providerId: connection.providerId,
    warehouseId: warehouseCode,
    orderNo,
    referenceNo,
  };
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

export function normalizeYunOrderRows(order, connection) {
  const shippedAt = firstText(order.date_shipping, order.ship_date, order.shipping_date, order.date_release, order.date_create);
  const status = firstText(order.order_status, order.status);
  const orderNo = firstText(order.order_code, order.reference_no, order.order_id);
  const platform = firstText(order.platform);
  const shopName = firstText(order.platform_shop, order.shop_name, order.store_name);
  const sourceAccount = firstText(order.sw_order_number);
  const externalOrderNo = firstText(order.reference_no);
  const salesAmount = firstNumber(order.order_sale_amount);
  const currency = firstText(order.order_sale_currency, order.currency);
  const projectGroup = /^TZ/i.test(firstText(shopName, sourceAccount, orderNo, externalOrderNo)) ? "同舟跨境项目" : "深六项目";
  const rawItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : Array.isArray(order.order_pack_box)
      ? order.order_pack_box.flatMap((box) => Array.isArray(box.product_details) ? box.product_details : [])
      : [];
  const allocatedSalesAmounts = allocateOrderSalesAmount(rawItems, salesAmount);
  const allocatedTotal = allocatedSalesAmounts.reduce((sum, value) => sum + value, 0);
  const allocationResidual = roundMoney(salesAmount - allocatedTotal);
  const salesAmountValid = salesAmount > 0 && Boolean(currency) && Math.abs(allocationResidual) <= 0.01;

  return rawItems
    .map((item, index) => ({
      orderId: firstText(order.order_id, orderNo),
      orderNo,
      lineId: firstText(item.order_item_id, item.product_id, item.product_sku, `${orderNo}-${index}`),
      providerId: connection.providerId,
      warehouseId: connection.id,
      warehouseName: firstText(order.warehouse_desc, order.warehouse_name, connection.name),
      country: connection.country,
      status,
      shippedAt,
      createdAt: firstText(order.date_create, order.created_at),
      platform,
      shopName,
      shopCode: shopName,
      sourceAccount,
      externalOrderNo,
      projectGroup,
      sku: firstText(item.product_sku, item.sku, item.product_barcode),
      productName: firstText(item.product_title, item.product_name, item.name, item.product_sku, item.sku, item.product_barcode),
      quantity: firstNumber(item.quantity, item.qty, item.product_quantity),
      salesAmount: salesAmountValid ? allocatedSalesAmounts[index] || 0 : 0,
      salesAmountScope: salesAmountValid ? "order_allocated" : "missing_order_amount",
      salesAmountSource: salesAmountValid ? "order.order_sale_amount" : "",
      salesAmountOrderTotal: salesAmount,
      salesAmountAllocationResidual: allocationResidual,
      salesAmountValid,
      currency: salesAmountValid ? currency : "",
      rawProvider: connection.providerId,
    }))
    .filter((item) => item.quantity > 0);
}

export async function syncYunWmsOrdersRange(connection, dateFrom, dateTo) {
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
  const start = normalizeDateOnly(dateFrom);
  const end = normalizeDateOnly(dateTo);
  const params = {
    ship_date_from: formatDateTimeForWms(start),
    ship_date_to: `${end} 23:59:59`,
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

export async function syncYunWmsOrders(connection, days = 90) {
  return syncYunWmsOrdersRange(connection, isoDateDaysAgo(days), new Date().toISOString().slice(0, 10));
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

async function syncSeaOrdersFromApiRange(connection, dateFrom, dateTo) {
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
  const start = normalizeDateOnly(dateFrom);
  const end = normalizeDateOnly(dateTo);
  const productRows = await fetchSeaPageList(credentials, "/goods/search_goods_sku_page", { pageSize: 100 });
  const productByGoodsSkuId = new Map(
    productRows
      .map((item) => [
        firstText(item.goodsSkuId, item.id),
        firstText(item.goodsSkuOuterId, item.sku, item.skuCode, item.goodsSkuCode, item.goodsCode, item.customSku),
      ])
      .filter(([goodsSkuId, sku]) => goodsSkuId && sku),
  );

  const orderPage = await fetchSeaPageListWithMeta(credentials, "/order/search_order_page", {
    pageSize: 100,
    warehouseId: resolvedWarehouseId,
    stage: "has_out_storage",
    gmtModifiedFrom: formatDateTimeForWms(start),
    gmtModifiedTo: `${end} 23:59:59`,
  }, wmsOrderMaxPages());
  const orderRows = orderPage.items;
  const orders = orderRows.flatMap((order) => normalizeSeaOrderRows(order, connection, productByGoodsSkuId));
  const orderApiComplete = !orderPage.reachedPageLimit
    && (orderPage.apiTotal <= 0 || orderRows.length >= orderPage.apiTotal);
  const paginationMessage = `SEA WMS 已出库订单读取：接口 total=${orderPage.apiTotal || "未知"}，已读包裹=${orderRows.length}，SKU行=${orders.length}，页数=${orderPage.pagesRead}/${orderPage.pageLimit}${orderPage.reachedPageLimit ? "，已达到页数上限，可能仍有未读取订单" : ""}`;

  return {
    warehouseId: connection.id,
    ok: true,
    skipped: false,
    message: orders.length === 0 ? `SEA WMS 出库单接口成功但没有返回 SKU 明细。${paginationMessage}` : paginationMessage,
    resolvedWarehouseId,
    orderApiTotal: orderPage.apiTotal,
    orderApiReadRows: orderRows.length,
    orderApiReadSkuRows: orders.length,
    orderApiPagesRead: orderPage.pagesRead,
    orderApiPageLimit: orderPage.pageLimit,
    orderApiReachedPageLimit: orderPage.reachedPageLimit,
    orderApiComplete,
    orders,
  };
}

async function syncSeaOrdersFromApi(connection, days = 90) {
  return syncSeaOrdersFromApiRange(connection, isoDateDaysAgo(days), new Date().toISOString().slice(0, 10));
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

export async function syncWarehouseOrdersRange(connection, dateFrom, dateTo) {
  if (connection.providerId === "yunwms_ru") return syncYunWmsOrdersRange(connection, dateFrom, dateTo);
  if (connection.providerId === "sea_wms") return syncSeaOrdersFromApiRange(connection, dateFrom, dateTo);
  return {
    warehouseId: connection.id,
    ok: false,
    skipped: true,
    message: `鏈煡 WMS provider: ${connection.providerId}`,
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

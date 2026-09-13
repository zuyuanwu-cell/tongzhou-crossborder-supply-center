import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_PAGE_LIMIT = 20;
const PAGE_SIZE = 100;

export class WarehouseReturnQueryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WarehouseReturnQueryError";
    this.code = code;
    this.details = details;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  return values.map(text).find(Boolean) || "";
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

export function normalizeReturnIdentifier(value) {
  return text(value).replace(/[\s\u200B-\u200D\uFEFF]+/g, "").toUpperCase();
}

function dateOnlyTimestamp(value) {
  const matched = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matched) return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  const parsed = Date.parse(text(value));
  if (!Number.isFinite(parsed)) return Number.NaN;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isoDateFromTimestamp(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function automaticPlatformReturnDateRange(values = [], now = new Date()) {
  const today = dateOnlyTimestamp(now instanceof Date ? now.toISOString() : now);
  const validDates = (Array.isArray(values) ? values : [])
    .map(dateOnlyTimestamp)
    .filter((value) => Number.isFinite(value) && value <= today);
  const anchor = validDates.length ? Math.max(...validDates) : today - 89 * 24 * 60 * 60 * 1000;
  const end = Math.min(today, anchor + 89 * 24 * 60 * 60 * 1000);
  return {
    dateFrom: isoDateFromTimestamp(anchor),
    dateTo: isoDateFromTimestamp(end),
  };
}

function identifierEquals(left, right) {
  const normalizedLeft = normalizeReturnIdentifier(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalizeReturnIdentifier(right);
}

function identifierMatches(row, queryType, query) {
  const candidates = queryType === "return_order"
    ? [row.returnSn, row.return_code, row.spo_code, row.warehouseReturnOrderId, row.code]
    : queryType === "tracking"
      ? [row.trackingNo, row.tracking_no, row.track]
      : [row.platformOrderSn, row.refrence_no_platform, row.order_reference_no, row.reference_no, row.order_code, row.thirdOrderSn, row.refrence_no_warehouse];
  return candidates.some((candidate) => identifierEquals(candidate, query));
}

function rowMatchesInput(row, input) {
  const identifiers = input.queryType === "platform_order"
    ? unique([input.query, ...(input.lookupAliases || [])])
    : [input.query];
  return identifiers.some((identifier) => identifierMatches(row, input.queryType, identifier));
}

function providerLabel(connection) {
  return firstText(connection?.providerName, connection?.providerId === "sea_wms" ? "SEA WMS" : "YunWMS");
}

function statusMeta(status) {
  const labels = {
    in_transit: "在途中",
    received_pending: "已到仓待处理",
    processing: "处理中",
    restocked: "已重新上架",
    scrapped: "已报废",
    mixed: "混合处理",
    exception: "异常",
    cancelled: "已取消",
  };
  return { status, statusLabel: labels[status] || "处理中" };
}

function deriveDispositionStatus(providerStatus, items) {
  if (["cancelled", "exception", "in_transit"].includes(providerStatus)) return providerStatus;
  const received = items.reduce((sum, item) => sum + item.receivedQty, 0);
  const restocked = items.reduce((sum, item) => sum + item.restockedQty, 0);
  const scrapped = items.reduce((sum, item) => sum + item.scrappedQty, 0);
  const bad = items.reduce((sum, item) => sum + item.badQty, 0);
  const pending = items.reduce((sum, item) => sum + item.pendingQty, 0);
  if (restocked > 0 && (scrapped > 0 || bad > 0)) return "mixed";
  if (restocked > 0 && scrapped === 0 && bad === 0 && pending === 0) return "restocked";
  if (scrapped > 0 && restocked === 0 && pending === 0) return "scrapped";
  if (received > 0 && (bad > 0 || pending > 0 || providerStatus === "received_pending")) return "received_pending";
  return providerStatus === "received_pending" ? "received_pending" : "processing";
}

function baseReturnOrder(row, connection) {
  return {
    id: `${connection.providerId}:${connection.id}:${firstText(row.warehouseReturnOrderId, row.returnSn, row.return_code, row.spo_code, row.code)}`,
    providerId: text(connection.providerId),
    providerName: providerLabel(connection),
    warehouseId: text(connection.id),
    warehouseName: text(connection.name),
    country: text(connection.country),
    returnOrderNumber: firstText(row.returnSn, row.return_code, row.spo_code, row.code),
    originalOrderNumber: firstText(row.platformOrderSn, row.refrence_no_platform, row.order_reference_no, row.reference_no, row.order_code, row.thirdOrderSn, row.refrence_no_warehouse),
    trackingNumber: firstText(row.trackingNo, row.tracking_no, row.track),
    logisticsCompany: firstText(row.logisticsCompany, row.transport_name, row.transport_code),
    createdAt: firstText(row.gmtCreate, row.spo_add_time),
    submittedAt: firstText(row.gmtSubmit, row.spo_confirm_time),
    signedAt: firstText(row.gmtSign),
    completedAt: firstText(row.gmtFinish, row.spo_complete_time),
    updatedAt: firstText(row.gmtModified, row.spo_update_time, row.gmtFinish, row.spo_complete_time),
  };
}

export function normalizeSeaReturnOrder(row, connection) {
  const items = (Array.isArray(row?.goodsSkuList) ? row.goodsSkuList : []).map((item, index) => ({
    id: firstText(item.goodsSkuId, `${firstText(item.goodsSkuOuterId, "sku")}-${index}`),
    sku: firstText(item.goodsSkuOuterId, item.sku, item.goodsSkuId),
    productName: firstText(item.goodsName, item.productName),
    imageUrl: firstText(item.imageUrl, item.logoUrl, item.picUrl),
    expectedQty: firstNumber(item.quantity, item.returnQuantity),
    receivedQty: firstNumber(item.signQuantity, item.receivedQuantity),
    restockedQty: firstNumber(item.inStorageQuantity),
    scrappedQty: firstNumber(item.discardQuantity),
    goodQty: firstNumber(item.inStorageGoodQuantity),
    badQty: firstNumber(item.inStorageBadQuantity),
    pendingQty: firstNumber(item.inStorageTemporaryQuantity),
    handlingMethod: firstText(item.expectReturnDealMethod),
  }));
  const tab = text(row?.tab).toLowerCase();
  const providerStatus = tab === "canceled" ? "cancelled"
    : tab === "problem" ? "exception"
      : ["draft", "on_way"].includes(tab) ? "in_transit"
        : tab === "sign" ? "received_pending"
          : "processing";
  const normalizedStatus = deriveDispositionStatus(providerStatus, items);
  return { ...baseReturnOrder(row, connection), ...statusMeta(normalizedStatus), providerStatus: tab, items };
}

function yunHandlingCode(item) {
  const parsed = Number(item?.exception_process_instruction);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeYunReturnOrder(row, connection) {
  const sourceItems = Array.isArray(row?.items) ? row.items : Array.isArray(row?.detail) ? row.detail : [];
  const items = sourceItems.map((item, index) => {
    const handlingMethod = firstText(item.exception_process_instruction_text, item.process_type_title);
    const handlingCode = yunHandlingCode(item);
    const receivedQty = firstNumber(item.received_qty, item.sop_received_qty);
    const goodQty = firstNumber(item.ok_qty);
    const badQty = firstNumber(item.sop_unsellable_qty);
    const explicitRestock = handlingCode === 1 || /重新上架|重新销售/.test(handlingMethod);
    const explicitScrap = [4, 9].includes(handlingCode) || /销毁|报废|丢弃/.test(handlingMethod);
    return {
      id: firstText(item.product_barcode, `${firstText(item.product_sku, "sku")}-${index}`),
      sku: firstText(item.product_sku, item.product_barcode),
      productName: firstText(item.product_title, item.product_name),
      imageUrl: firstText(item.image_url, item.imageUrl),
      expectedQty: firstNumber(item.back_quantity, item.sop_quantity, item.quantity),
      receivedQty,
      restockedQty: explicitRestock ? firstPositiveNumber(goodQty, receivedQty) : 0,
      scrappedQty: explicitScrap ? firstPositiveNumber(badQty, receivedQty) : 0,
      goodQty,
      badQty,
      pendingQty: Math.max(number(item.wait_putaway), number(item.sop_unconfirmed_qty)),
      handlingMethod,
    };
  });
  const rawStatus = firstText(row?.return_status, row?.spo_status).toUpperCase();
  const providerStatus = ["Q", "0"].includes(rawStatus) ? "cancelled"
    : ["E", "A", "G", "4"].includes(rawStatus) ? "exception"
      : ["W", "1", "2"].includes(rawStatus) ? "in_transit"
        : ["D", "3"].includes(rawStatus) ? "received_pending"
          : "processing";
  const normalizedStatus = deriveDispositionStatus(providerStatus, items);
  return { ...baseReturnOrder(row, connection), ...statusMeta(normalizedStatus), providerStatus: rawStatus, items };
}

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

function md5(value) {
  return crypto.createHash("md5").update(value, "utf8").digest("hex");
}

function normalizeBaseUrl(value) {
  return text(value).replace(/\/$/, "");
}

function normalizeYunEndpoint(value) {
  const normalized = normalizeBaseUrl(value);
  if (/\/default\/svc\/wsdl$/i.test(normalized)) return normalized.replace(/\/wsdl$/i, "/web-service");
  if (/\/default\/svc\/web-service$/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (!url.pathname || url.pathname === "/" || /^\/api-doc(?:\/index\.php)?\/?$/i.test(url.pathname)) {
      return `${url.origin}/default/svc/web-service`;
    }
  } catch {
    return normalized;
  }
  return normalized;
}

function envPrefix(connection) {
  return `WMS_${text(connection?.id).toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function seaCredentials(connection) {
  const prefix = envPrefix(connection);
  return {
    baseUrl: normalizeBaseUrl(process.env[`${prefix}_BASE_URL`] || connection.baseUrl),
    appKey: process.env[`${prefix}_APP_KEY`] || connection.credentials?.appKey || connection.credentials?.clientId || process.env.WMS_SEA_APP_KEY || "",
    appSecret: process.env[`${prefix}_APP_SECRET`] || connection.credentials?.appSecret || connection.credentials?.clientSecret || process.env.WMS_SEA_APP_SECRET || "",
    warehouseId: process.env[`${prefix}_WAREHOUSE_ID`] || connection.warehouseId || connection.warehouseCode || connection.resolvedWarehouseId || "",
  };
}

function yunCredentials(connection) {
  const prefix = envPrefix(connection);
  return {
    baseUrl: normalizeYunEndpoint(process.env[`${prefix}_BASE_URL`] || connection.baseUrl),
    appKey: process.env[`${prefix}_APP_KEY`] || connection.credentials?.appKey || connection.credentials?.clientId || "",
    appToken: process.env[`${prefix}_APP_TOKEN`] || connection.credentials?.token || connection.credentials?.appSecret || connection.credentials?.clientSecret || "",
    warehouseCode: process.env[`${prefix}_WAREHOUSE_CODE`] || connection.warehouseCode || connection.warehouseId || connection.resolvedWarehouseId || "",
  };
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

async function fetchWithTimeout(fetchImpl, url, init, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new WarehouseReturnQueryError("timeout", `WMS 查询超过 ${Math.round(timeoutMs / 1000)} 秒，请稍后重试。`);
    if (signal?.aborted || error?.name === "AbortError") throw new WarehouseReturnQueryError("cancelled", "本次查询已被新的查询替代。");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function postSea(fetchImpl, credentials, endpoint, body, options) {
  const requestBody = { requestTimestamp: Math.floor(Date.now() / 1000), ...body };
  const compactBody = compactJson(requestBody);
  const response = await fetchWithTimeout(fetchImpl, `${credentials.baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      AppKey: credentials.appKey,
      Signature: md5(`${md5(compactBody)}${credentials.appSecret}`),
    },
    body: compactBody,
  }, options);
  const responseText = await response.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new WarehouseReturnQueryError("invalid_response", "SEA WMS 返回了无法识别的数据。");
  }
  if (!response.ok) throw new WarehouseReturnQueryError("provider_error", `SEA WMS 查询失败（HTTP ${response.status}）。`);
  const result = text(payload?.result).toLowerCase();
  const code = text(payload?.code).toLowerCase();
  if ((result && result !== "success") || (!result && code && !["success", "200", "0"].includes(code))) {
    throw new WarehouseReturnQueryError("provider_error", firstText(payload?.message, payload?.reason, payload?.msg) || "SEA WMS 返回查询失败。");
  }
  return payload;
}

function seaRows(payload) {
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data?.records)) return payload.data.records;
  if (Array.isArray(payload?.data?.rows)) return payload.data.rows;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result?.list)) return payload.result.list;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

async function resolveSeaWarehouseId(fetchImpl, credentials, connection, options) {
  if (text(connection.warehouseId) && text(connection.warehouseId) !== text(connection.warehouseCode)) return text(connection.warehouseId);
  if (text(connection.resolvedWarehouseId)) return text(connection.resolvedWarehouseId);
  const payload = await postSea(fetchImpl, credentials, "/warehouse/get_list", {}, options);
  const rows = seaRows(payload);
  const matched = rows.find((item) => [item.warehouseId, item.id, item.warehouseCode, item.code, item.warehouseName, item.name]
    .some((value) => identifierEquals(value, connection.warehouseCode) || identifierEquals(value, connection.name)));
  return firstText(matched?.warehouseId, matched?.id, credentials.warehouseId);
}

function validateCredentials(connection, credentials) {
  if (!credentials.baseUrl || !credentials.appKey || (connection.providerId === "sea_wms" ? !credentials.appSecret : !credentials.appToken)) {
    throw new WarehouseReturnQueryError("unconfigured", `${providerLabel(connection)} 尚未完成授权配置。`);
  }
}

function dateTimeStart(value) {
  return value ? `${value} 00:00:00` : "";
}

function dateTimeEnd(value) {
  return value ? `${value} 23:59:59` : "";
}

async function querySeaReturns(connection, input, options) {
  const credentials = seaCredentials(connection);
  validateCredentials(connection, credentials);
  const warehouseId = await resolveSeaWarehouseId(options.fetchImpl, credentials, connection, options);
  if (!warehouseId) throw new WarehouseReturnQueryError("unconfigured", `${connection.name} 缺少WMS仓库ID。`);

  const aliases = unique([input.query, ...(input.lookupAliases || [])]);
  let targetedBody = null;
  if (input.queryType === "platform_order" && aliases.length) {
    // SEA WMS names this filter thirdOrderSns, but it searches the WMS
    // reference number (for example TH...), not platformOrderSn. Trying known
    // aliases first is cheap; a miss must fall back to the bounded return list.
    targetedBody = { warehouseId, pageSize: PAGE_SIZE, thirdOrderSns: aliases };
  } else if (input.queryType === "return_order" && /^\d+$/.test(input.query)) {
    targetedBody = { warehouseId, pageSize: PAGE_SIZE, warehouseReturnOrderIds: [input.query] };
  }

  async function searchPages(body) {
    let cursor = "";
    let pagesRead = 0;
    let reachedPageLimit = false;
    const matches = [];
    for (let page = 0; page < options.maxPages; page += 1) {
      const payload = await postSea(options.fetchImpl, credentials, "/warehouse_return_order/search_page", cursor ? { ...body, cursor } : body, options);
      const rows = seaRows(payload);
      pagesRead = page + 1;
      matches.push(...rows.filter((row) => rowMatchesInput(row, input)).map((row) => normalizeSeaReturnOrder(row, connection)));
      if (matches.length) break;
      const nextCursor = firstText(payload?.data?.cursor);
      if (!nextCursor || nextCursor === cursor || !rows.length) break;
      cursor = nextCursor;
      if (page === options.maxPages - 1) reachedPageLimit = true;
    }
    return { matches, pagesRead, reachedPageLimit };
  }

  let targetedPagesRead = 0;
  if (targetedBody) {
    const targetedResult = await searchPages(targetedBody);
    targetedPagesRead = targetedResult.pagesRead;
    if (targetedResult.matches.length) {
      return {
        orders: targetedResult.matches,
        complete: !targetedResult.reachedPageLimit,
        needsDateRange: false,
        pagesRead: targetedPagesRead,
        method: "targeted",
      };
    }
  }

  if (!input.dateFrom || !input.dateTo) {
    return { orders: [], complete: false, needsDateRange: true, pagesRead: targetedPagesRead, method: targetedBody ? "targeted" : "needs_date_range" };
  }

  const boundedResult = await searchPages({
    warehouseId,
    pageSize: PAGE_SIZE,
    searchTimeField: "create",
    searchTimeFrom: dateTimeStart(input.dateFrom),
    searchTimeTo: dateTimeEnd(input.dateTo),
  });
  return {
    orders: boundedResult.matches,
    complete: !boundedResult.reachedPageLimit,
    needsDateRange: false,
    pagesRead: targetedPagesRead + boundedResult.pagesRead,
    method: targetedBody ? "targeted_then_bounded_scan" : "bounded_scan",
  };
}

function yunEnvelope(credentials, service, params) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://www.example.org/Ec/">
  <SOAP-ENV:Body><ns1:callService>
    <paramsJson>${xmlEscape(JSON.stringify(params))}</paramsJson>
    <appToken>${xmlEscape(credentials.appToken)}</appToken>
    <appKey>${xmlEscape(credentials.appKey)}</appKey>
    <service>${xmlEscape(service)}</service><language>zh_CN</language>
  </ns1:callService></SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

async function postYun(fetchImpl, credentials, service, params, options) {
  const response = await fetchWithTimeout(fetchImpl, credentials.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "callService" },
    body: yunEnvelope(credentials, service, params),
  }, options);
  const responseText = await response.text();
  if (!response.ok) throw new WarehouseReturnQueryError("provider_error", `YunWMS 查询失败（HTTP ${response.status}）。`);
  const matched = responseText.match(/<response[^>]*>([\s\S]*?)<\/response>/i);
  if (!matched) throw new WarehouseReturnQueryError("invalid_response", "YunWMS 响应缺少有效数据节点。");
  let payload;
  try {
    payload = JSON.parse(xmlUnescape(matched[1]).trim());
  } catch {
    throw new WarehouseReturnQueryError("invalid_response", "YunWMS 返回了无法识别的数据。");
  }
  if (text(payload?.ask).toLowerCase() !== "success") {
    throw new WarehouseReturnQueryError("provider_error", firstText(payload?.message) || "YunWMS 返回查询失败。");
  }
  return payload;
}

async function queryYunReturns(connection, input, options) {
  const credentials = yunCredentials(connection);
  validateCredentials(connection, credentials);
  const targeted = input.queryType === "return_order";
  if (!targeted && (!input.dateFrom || !input.dateTo)) {
    return { orders: [], complete: false, needsDateRange: true, pagesRead: 0, method: "needs_date_range" };
  }
  const baseParams = {
    ...(credentials.warehouseCode ? { warehouse_code: credentials.warehouseCode } : {}),
    ...(targeted ? { searchType: "searchCode", code: input.query } : {
      spo_update_time_from: dateTimeStart(input.dateFrom),
      spo_update_time_to: dateTimeEnd(input.dateTo),
    }),
  };
  let pagesRead = 0;
  let reachedPageLimit = false;
  let matchedRows = [];
  for (let page = 1; page <= options.maxPages; page += 1) {
    const payload = await postYun(options.fetchImpl, credentials, "getSpecialOrdersList", { pageSize: PAGE_SIZE, page, ...baseParams }, options);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    pagesRead = page;
    matchedRows = rows.filter((row) => rowMatchesInput(row, input));
    if (matchedRows.length) break;
    if (text(payload?.nextPage).toLowerCase() !== "true" || !rows.length) break;
    if (page === options.maxPages) reachedPageLimit = true;
  }
  if (!matchedRows.length) return { orders: [], complete: !reachedPageLimit, needsDateRange: false, pagesRead, method: targeted ? "targeted" : "bounded_scan" };

  let detailComplete = true;
  const orders = [];
  for (const matchedRow of matchedRows) {
    let detail = matchedRow;
    const returnCode = firstText(matchedRow.return_code, matchedRow.spo_code, matchedRow.code);
    if (returnCode) {
      try {
        const detailPayload = await postYun(options.fetchImpl, credentials, "getReturnBill", { return_code: returnCode }, options);
        const detailData = Array.isArray(detailPayload?.data) ? detailPayload.data[0] : detailPayload?.data;
        if (detailData && typeof detailData === "object") detail = { ...matchedRow, ...detailData };
      } catch (error) {
        if (error?.code === "cancelled" || error?.code === "timeout") throw error;
        detailComplete = false;
      }
    }
    orders.push(normalizeYunReturnOrder(detail, connection));
  }
  return { orders, complete: detailComplete, needsDateRange: false, pagesRead, method: targeted ? "targeted" : "bounded_scan" };
}

export async function queryWarehouseReturns(connection, input, {
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPages = DEFAULT_PAGE_LIMIT,
} = {}) {
  const safeInput = {
    query: text(input?.query),
    queryType: ["platform_order", "return_order", "tracking"].includes(input?.queryType) ? input.queryType : "platform_order",
    warehouseId: text(input?.warehouseId),
    dateFrom: text(input?.dateFrom),
    dateTo: text(input?.dateTo),
    lookupAliases: unique(input?.lookupAliases),
  };
  if (!safeInput.query) throw new WarehouseReturnQueryError("invalid_input", "请输入需要查询的订单号或物流单号。");
  const options = {
    fetchImpl,
    signal,
    timeoutMs: Math.max(3_000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
    maxPages: Math.max(1, Math.min(50, Number(maxPages) || DEFAULT_PAGE_LIMIT)),
  };
  if (connection?.providerId === "sea_wms") return querySeaReturns(connection, safeInput, options);
  if (connection?.providerId === "yunwms_ru") return queryYunReturns(connection, safeInput, options);
  throw new WarehouseReturnQueryError("unsupported", `${providerLabel(connection) || "当前WMS"}暂不支持退货查询。`);
}

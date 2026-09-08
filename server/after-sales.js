import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { calculatePackagingFeeCny, normalizedCountryKey, normalizePackagingFeeRules } from "./performance-analytics.js";
import { normalizeMiaoshouPackages } from "./miaoshou-performance.js";

export const AFTER_SALES_PRIMARY_REASONS = Object.freeze([
  "仓库错发",
  "仓库漏发少发",
  "产品质量问题",
  "快递丢失",
  "运输破损",
  "SKU匹配错误",
]);

export const AFTER_SALES_SECONDARY_REASONS = Object.freeze([
  "补发且留错品",
  "仓库发错货，客户差评不退货",
  "客户补差价留错品",
  "客户退全款且退货",
]);

export const AFTER_SALES_STATUSES = Object.freeze([
  "pending_warehouse",
  "processing",
  "awaiting_reshipment",
  "shipped",
  "completed",
  "cancelled",
]);

const RESPONSIBILITY = Object.freeze({
  warehouse: { party: "warehouse", label: "仓库", ruleCode: "warehouse_fulfillment" },
  quality: { party: "supplier_quality", label: "产品 / 供应链", ruleCode: "product_quality" },
  logistics: { party: "logistics", label: "物流承运方", ruleCode: "logistics" },
  operations: { party: "operations", label: "运营 / 系统", ruleCode: "sku_mapping" },
  pending: { party: "pending_review", label: "待复核", ruleCode: "manual_review" },
});

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round((Math.max(0, number(value)) + Number.EPSILON) * 100) / 100;
}

function quantity(value) {
  return Math.max(0, Math.floor(number(value)));
}

function normalizedSku(value) {
  const raw = text(value).toUpperCase();
  return raw.match(/(TZKJ-[A-Z0-9-]+)$/i)?.[1]?.toUpperCase() || raw;
}

function nowIso() {
  return new Date().toISOString();
}

function actorName(actor) {
  return text(actor?.displayName || actor?.username || actor?.id || "系统");
}

function event(type, label, actor, note = "") {
  return {
    id: randomUUID(),
    type,
    label,
    note: text(note),
    actor: actorName(actor),
    actorId: text(actor?.id),
    createdAt: nowIso(),
  };
}

export function resolveAfterSalesResponsibility(primaryReason, secondaryReason, override = null) {
  const primary = text(primaryReason);
  const secondary = text(secondaryReason);
  let resolved = RESPONSIBILITY.pending;
  if (["仓库错发", "仓库漏发少发"].includes(primary)) resolved = RESPONSIBILITY.warehouse;
  else if (primary === "产品质量问题") resolved = RESPONSIBILITY.quality;
  else if (["快递丢失", "运输破损"].includes(primary)) resolved = RESPONSIBILITY.logistics;
  else if (primary === "SKU匹配错误") resolved = RESPONSIBILITY.operations;
  if (secondary === "仓库发错货，客户差评不退货") resolved = RESPONSIBILITY.warehouse;

  const overrideParty = text(override?.party);
  const overrideReason = text(override?.reason);
  const allowedParties = new Set(["warehouse", "supplier_quality", "logistics", "operations", "pending_review"]);
  if (overrideParty && allowedParties.has(overrideParty) && overrideReason) {
    const label = text(override?.label) || Object.values(RESPONSIBILITY).find((item) => item.party === overrideParty)?.label || "人工指定";
    return { party: overrideParty, label, ruleCode: "manual_override", overridden: true, overrideReason };
  }
  return { ...resolved, overridden: false, overrideReason: "" };
}

export function calculateAfterSalesLiability(input = {}) {
  const responsibility = input.responsibility || resolveAfterSalesResponsibility(input.primaryReason, input.secondaryReason);
  const affectedItems = Array.isArray(input.affectedItems) ? input.affectedItems : [];
  const productCostCny = responsibility.party === "warehouse"
    ? money(affectedItems.reduce((sum, item) => sum + quantity(item.affectedQty) * money(item.unitCostCny), 0))
    : 0;
  const packagingFeeWaiverCny = responsibility.party === "warehouse" ? money(input.packagingFeeCny) : 0;
  const additionalLiabilityCny = money(input.additionalLiabilityCny);
  const customerRecoveryCny = money(input.customerRecoveryCny);
  return {
    productCostCny,
    packagingFeeWaiverCny,
    additionalLiabilityCny,
    customerRecoveryCny,
    totalWarehouseLiabilityCny: money(productCostCny + packagingFeeWaiverCny + additionalLiabilityCny - customerRecoveryCny),
    currency: "CNY",
    missingCostSkus: responsibility.party === "warehouse"
      ? affectedItems.filter((item) => quantity(item.affectedQty) > 0 && money(item.unitCostCny) <= 0).map((item) => text(item.sku)).filter(Boolean)
      : [],
  };
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createStore(cachePath) {
  let state = loadJson(cachePath, { version: 1, updatedAt: "", sequenceDate: "", sequence: 0, tickets: [], uploads: [] });
  state.tickets = Array.isArray(state.tickets) ? state.tickets : [];
  state.uploads = Array.isArray(state.uploads) ? state.uploads : [];

  function persist() {
    mkdirSync(resolve(cachePath, ".."), { recursive: true });
    state.updatedAt = nowIso();
    const temporaryPath = `${cachePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    renameSync(temporaryPath, cachePath);
  }

  function nextId() {
    const date = nowIso().slice(0, 10).replaceAll("-", "");
    if (state.sequenceDate !== date) {
      state.sequenceDate = date;
      state.sequence = 0;
    }
    state.sequence += 1;
    return `AS-${date}-${String(state.sequence).padStart(4, "0")}`;
  }

  return {
    list() { return state.tickets; },
    get(id) { return state.tickets.find((ticket) => ticket.id === id) || null; },
    byOrder(orderNumber) { return state.tickets.filter((ticket) => ticket.originalOrderNumber === orderNumber); },
    create(ticket) {
      const created = { ...ticket, id: nextId() };
      state.tickets.unshift(created);
      persist();
      return created;
    },
    update(id, updater) {
      const index = state.tickets.findIndex((ticket) => ticket.id === id);
      if (index < 0) return null;
      state.tickets[index] = updater({ ...state.tickets[index] });
      persist();
      return state.tickets[index];
    },
    addUpload(upload) {
      state.uploads.unshift(upload);
      if (state.uploads.length > 5000) state.uploads.length = 5000;
      persist();
      return upload;
    },
    getUpload(id) { return state.uploads.find((upload) => upload.id === id) || null; },
  };
}

function arraysAtKnownKeys(value, keys, output = [], visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);
  if (!Array.isArray(value)) {
    for (const key of keys) if (Array.isArray(value[key])) output.push(...value[key]);
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    if (entry && typeof entry === "object") arraysAtKnownKeys(entry, keys, output, visited);
  }
  return output;
}

function packageRows(payload) {
  return arraysAtKnownKeys(payload?.data ?? payload, ["orderPackageList", "packageList"]);
}

function valueAt(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && text(value)) return text(value);
  }
  return "";
}

function customerFromPackageRows(rows, orderNumber) {
  const matching = rows.filter((row) => {
    const info = row?.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : row;
    return text(info?.platformOrderSn ?? row?.platformOrderSn) === orderNumber;
  });
  const candidates = matching.flatMap((row) => [
    row,
    row?.orderInfo,
    row?.recipientInfo,
    row?.receiverInfo,
    row?.shippingAddress,
    row?.addressInfo,
    row?.buyerInfo,
  ]).filter((value) => value && typeof value === "object");
  const pick = (keys) => candidates.map((candidate) => valueAt(candidate, keys)).find(Boolean) || "";
  return {
    name: pick(["recipientName", "receiverName", "consigneeName", "buyerName", "fullName", "name"]),
    phone: pick(["recipientPhone", "receiverPhone", "consigneePhone", "buyerPhone", "phone", "mobile", "mobilePhone"]),
    country: pick(["recipientCountry", "receiverCountry", "country", "countryName"]),
    province: pick(["recipientProvince", "receiverProvince", "province", "state", "region"]),
    city: pick(["recipientCity", "receiverCity", "city"]),
    district: pick(["recipientDistrict", "receiverDistrict", "district", "area"]),
    address: pick(["recipientAddress", "receiverAddress", "shippingAddress", "detailAddress", "address", "addressLine1"]),
    postalCode: pick(["recipientPostalCode", "receiverPostalCode", "postalCode", "zipCode", "postcode"]),
  };
}

function productLookup(products = {}) {
  const map = new Map();
  const add = (product) => {
    const keys = [product?.sku, product?.skuNo, product?.countrySku].map(normalizedSku).filter(Boolean);
    for (const key of keys) {
      const list = map.get(key) || [];
      list.push(product);
      map.set(key, list);
    }
  };
  for (const product of products.catalog || []) add(product);
  for (const product of products.productBase || []) add(product);
  return map;
}

function exchangeRateFor(rates, currency, date) {
  const code = text(currency).toUpperCase();
  if (["CNY", "RMB"].includes(code)) return { rateToCny: 1, source: "system", effectiveDate: "2000-01-01" };
  const candidates = (rates || [])
    .filter((row) => text(row.currency).toUpperCase() === code && number(row.rateToCny) > 0)
    .sort((left, right) => text(left.effectiveDate).localeCompare(text(right.effectiveDate)));
  return candidates.filter((row) => !date || text(row.effectiveDate) <= date).at(-1) || null;
}

function supplementalCostFor(rows, sku, countryKey, date) {
  return (rows || [])
    .filter((row) => row.enabled !== false && normalizedSku(row.sku) === normalizedSku(sku) && normalizedCountryKey(row.countryKey || row.countryName) === countryKey)
    .filter((row) => !date || !row.effectiveDate || text(row.effectiveDate) <= date)
    .sort((left, right) => text(left.effectiveDate).localeCompare(text(right.effectiveDate)))
    .at(-1) || null;
}

function resolveItemProduct(sku, country, products, rates, supplementalCosts, orderDate) {
  const countryKey = normalizedCountryKey(country);
  const candidates = productLookup(products).get(normalizedSku(sku)) || [];
  const exact = candidates.filter((item) => normalizedCountryKey(item.country) === countryKey);
  const product = exact.find((item) => number(item.directCostPrice) > 0)
    || exact[0]
    || candidates.find((item) => number(item.directCostPrice) > 0)
    || candidates[0]
    || null;
  const directCost = number(product?.directCostPrice);
  const currency = text(product?.directCostCurrency).toUpperCase();
  if (directCost > 0 && currency) {
    const rate = exchangeRateFor(rates, currency, orderDate);
    if (rate) {
      return {
        productName: text(product?.name || product?.nameEn || sku),
        imageUrl: text(product?.imageUrl),
        unitCostCny: money(directCost * number(rate.rateToCny)),
        costSource: `产品库直营成本 · ${currency} ${directCost} × ${number(rate.rateToCny)}`,
        costMissing: false,
      };
    }
  }
  const supplemental = supplementalCostFor(supplementalCosts, sku, countryKey, orderDate);
  if (supplemental) {
    return {
      productName: text(product?.name || product?.nameEn || supplemental.productName || sku),
      imageUrl: text(product?.imageUrl),
      unitCostCny: money(supplemental.unitCostCny),
      costSource: "经营分析补充成本",
      costMissing: false,
    };
  }
  return {
    productName: text(product?.name || product?.nameEn || sku),
    imageUrl: text(product?.imageUrl),
    unitCostCny: 0,
    costSource: "待人工维护",
    costMissing: true,
  };
}

function aggregateOrderItems(items, orderIdentity) {
  const result = new Map();
  for (const row of items.filter((item) => item.orderIdentity === orderIdentity)) {
    const sku = normalizedSku(row.platformOuterSkuId || row.platformSkuId);
    if (!sku) continue;
    const previous = result.get(sku) || { sku, orderedQty: 0 };
    previous.orderedQty += quantity(row.quantity);
    result.set(sku, previous);
  }
  return [...result.values()];
}

function publicListTicket(ticket) {
  return {
    ...ticket,
    customer: undefined,
    customerSummary: {
      configured: Boolean(ticket.customer?.name || ticket.customer?.phone || ticket.customer?.address),
      country: text(ticket.customer?.country),
    },
  };
}

export function isAfterSalesTicketWithinScope(ticket, dataScopes = {}) {
  const scopedCountries = new Set((Array.isArray(dataScopes?.countries) ? dataScopes.countries : [])
    .map(normalizedCountryKey)
    .filter(Boolean));
  const scopedSkus = new Set((Array.isArray(dataScopes?.skus) ? dataScopes.skus : [])
    .map(normalizedSku)
    .filter(Boolean));
  if (scopedCountries.size) {
    const ticketCountries = [ticket?.site, ticket?.customer?.country]
      .map(normalizedCountryKey)
      .filter(Boolean);
    if (!ticketCountries.some((country) => scopedCountries.has(country))) return false;
  }
  if (scopedSkus.size) {
    const affectedItems = (ticket?.originalItems || []).filter((item) => number(item?.affectedQty ?? item?.orderedQty) > 0);
    const ticketSkus = [...affectedItems, ...(ticket?.reissueItems || [])]
      .map((item) => normalizedSku(item?.sku))
      .filter(Boolean);
    if (!ticketSkus.length || !ticketSkus.every((sku) => scopedSkus.has(sku))) return false;
  }
  return true;
}

function summaryFor(tickets) {
  return tickets.reduce((summary, ticket) => {
    summary.total += 1;
    if (ticket.status === "pending_warehouse") summary.pendingWarehouse += 1;
    if (["processing", "awaiting_reshipment"].includes(ticket.status)) summary.processing += 1;
    if (ticket.status === "awaiting_reshipment") summary.awaitingReshipment += 1;
    if (!['completed', 'cancelled'].includes(ticket.status)) summary.open += 1;
    if (ticket.status !== "cancelled") summary.warehouseLiabilityCny = money(summary.warehouseLiabilityCny + number(ticket.money?.totalWarehouseLiabilityCny));
    return summary;
  }, { total: 0, open: 0, pendingWarehouse: 0, processing: 0, awaitingReshipment: 0, warehouseLiabilityCny: 0 });
}

export function createAfterSalesService({ cachePath, uploadDir, performanceStore, connector, getProducts }) {
  const store = createStore(cachePath);

  function settings() {
    return performanceStore?.getPerformanceSettings?.() || {};
  }

  function list(filters = {}) {
    const keyword = text(filters.keyword).toLowerCase();
    const status = text(filters.status);
    const visibleTickets = store.list().filter((ticket) => isAfterSalesTicketWithinScope(ticket, filters.dataScopes));
    const tickets = visibleTickets.filter((ticket) => {
      if (status && status !== "all" && ticket.status !== status) return false;
      if (!keyword) return true;
      return [ticket.id, ticket.originalOrderNumber, ticket.shopAlias, ticket.primaryReason, ticket.secondaryReason]
        .some((value) => text(value).toLowerCase().includes(keyword));
    });
    return { ok: true, updatedAt: nowIso(), summary: summaryFor(visibleTickets), tickets: tickets.map(publicListTicket) };
  }

  async function syncOrder(orderNumberInput) {
    const orderNumber = text(orderNumberInput);
    if (!orderNumber || orderNumber.length > 160 || /[\r\n,]/.test(orderNumber)) throw new Error("请输入有效的平台后台订单号。");
    const cached = performanceStore?.findMiaoshouOrderBundlesByPlatformOrderSns?.([orderNumber]) || { orders: [], items: [] };
    const context = connector?.performanceContext?.() || { hasCredentials: false, shops: [] };
    let orders = cached.orders || [];
    let items = cached.items || [];
    let rawRows = [];
    let liveWarning = "";
    if (context.hasCredentials) {
      const shopsByPlatform = new Map();
      for (const shop of context.shops || []) {
        const platform = text(shop.platform);
        const shopId = text(shop.shopId);
        if (!platform || !shopId) continue;
        const ids = shopsByPlatform.get(platform) || [];
        ids.push(shopId);
        shopsByPlatform.set(platform, ids);
      }
      for (const [platform, shopIds] of shopsByPlatform) {
        try {
          const payload = await connector.searchPerformancePackages({
            page: 1,
            pageSize: 50,
            platform,
            shopIds: [...new Set(shopIds)].slice(0, 100),
            platformOrderSns: orderNumber,
          });
          rawRows.push(...packageRows(payload));
          const normalized = normalizeMiaoshouPackages(payload);
          const liveOrders = normalized.orders.filter((order) => text(order.platformOrderSn) === orderNumber);
          const identities = new Set(liveOrders.map((order) => order.identity));
          const liveItems = normalized.items.filter((item) => identities.has(item.orderIdentity));
          if (liveOrders.length) {
            performanceStore?.upsertMiaoshouPerformance?.({ orders: liveOrders, items: liveItems });
            orders = [...orders, ...liveOrders];
            items = [...items, ...liveItems];
          }
        } catch (error) {
          liveWarning = text(error?.message) || "妙手实时查询失败，已使用本地缓存。";
        }
      }
    }
    const exactOrders = [...new Map(orders.filter((order) => text(order.platformOrderSn) === orderNumber).map((order) => [order.identity, order])).values()];
    const shopIds = [...new Set(exactOrders.map((order) => text(order.shopId)).filter(Boolean))];
    if (!exactOrders.length) throw new Error(liveWarning || "妙手未查询到该平台订单号，请核对后重试。");
    if (shopIds.length !== 1) throw new Error(`该订单号命中 ${shopIds.length} 家店铺，为避免串单已停止同步，请核对订单号。`);
    const order = exactOrders.find((row) => text(row.shopId) === shopIds[0]) || exactOrders[0];
    const shop = (context.shops || []).find((row) => text(row.shopId) === shopIds[0]) || {};
    const uniqueItems = [...new Map(items.map((item) => [text(item.identity), item])).values()];
    const rawItems = aggregateOrderItems(uniqueItems, order.identity);
    if (!rawItems.length) throw new Error("已找到订单，但妙手未返回商品明细，请稍后重试或检查订单状态。");
    const products = getProducts?.() || {};
    const rates = performanceStore?.listExchangeRates?.() || [];
    const supplementalCosts = performanceStore?.listSupplementalProductCosts?.() || [];
    const orderDate = text(order.orderStartedAt).slice(0, 10);
    const country = text(order.site || shop.site).toUpperCase();
    const enrichedItems = rawItems.map((item) => ({
      ...item,
      ...resolveItemProduct(item.sku, country, products, rates, supplementalCosts, orderDate),
      affectedQty: item.orderedQty,
    }));
    const packagingRules = normalizePackagingFeeRules(settings().packagingFeeRules);
    const packagingFeeCny = money(calculatePackagingFeeCny(country, rawItems.reduce((sum, item) => sum + item.orderedQty, 0), packagingRules));
    return {
      ok: true,
      source: rawRows.length ? "miaoshou_live" : "local_cache",
      warning: liveWarning,
      order: {
        orderNumber,
        orderIdentity: order.identity,
        platform: text(order.platform || shop.platform),
        site: country,
        shopId: shopIds[0],
        shopAlias: text(shop.shopNick) || "未配置别名",
        platformShopName: text(shop.platformShopName),
        orderStartedAt: text(order.orderStartedAt),
        customer: customerFromPackageRows(rawRows, orderNumber),
        items: enrichedItems,
        packagingFeeCny,
        existingTickets: store.byOrder(orderNumber).map(publicListTicket),
      },
    };
  }

  function saveUpload(input, actor, requestOrigin) {
    const dataUrl = text(input.dataUrl);
    const kind = input.kind === "label" ? "label" : "evidence";
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif)|application\/pdf);base64,(.+)$/i);
    if (!match) throw new Error("请上传 PNG、JPG、WEBP、GIF 或 PDF 文件。");
    const mimeType = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length) throw new Error("文件内容为空。");
    if (bytes.length > 8 * 1024 * 1024) throw new Error("单个文件不能超过 8MB。");
    const suffix = mimeType === "application/pdf" ? "pdf" : mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    const id = `as-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${suffix}`;
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(resolve(uploadDir, id), bytes);
    const upload = {
      id,
      kind,
      fileName: text(input.fileName) || id,
      mimeType,
      size: bytes.length,
      url: `${text(requestOrigin)}/api/after-sales/uploads/${encodeURIComponent(id)}`,
      uploadedAt: nowIso(),
      uploadedBy: actorName(actor),
      uploadedById: text(actor?.id),
    };
    return store.addUpload(upload);
  }

  function uploadPath(fileName) {
    const safeName = text(fileName);
    if (!/^as-[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|pdf)$/i.test(safeName)) return null;
    const upload = store.getUpload(safeName);
    const path = resolve(uploadDir, safeName);
    return upload && existsSync(path) ? { path, upload } : null;
  }

  function attachments(ids, kind) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(text).filter(Boolean))];
    return unique.map((id) => store.getUpload(id)).filter((upload) => upload && upload.kind === kind);
  }

  function create(input, actor) {
    const order = input.order && typeof input.order === "object" ? input.order : {};
    const originalOrderNumber = text(order.orderNumber || input.originalOrderNumber);
    if (!originalOrderNumber) throw new Error("请先同步原订单。");
    const primaryReason = text(input.primaryReason);
    const secondaryReason = text(input.secondaryReason);
    if (!AFTER_SALES_PRIMARY_REASONS.includes(primaryReason)) throw new Error("请选择售后一级分类。");
    if (!AFTER_SALES_SECONDARY_REASONS.includes(secondaryReason)) throw new Error("请选择售后二级分类。");
    const responsibility = resolveAfterSalesResponsibility(primaryReason, secondaryReason, input.responsibilityOverride);
    const originalItems = (Array.isArray(input.originalItems) ? input.originalItems : order.items || []).map((item) => ({
      sku: normalizedSku(item.sku),
      productName: text(item.productName || item.name || item.sku),
      imageUrl: text(item.imageUrl),
      orderedQty: quantity(item.orderedQty),
      affectedQty: Math.min(quantity(item.orderedQty), quantity(item.affectedQty)),
      unitCostCny: money(item.unitCostCny),
      costSource: text(item.costSource || (number(item.unitCostCny) > 0 ? "人工成本" : "待人工维护")),
      costMissing: number(item.unitCostCny) <= 0,
    })).filter((item) => item.sku && item.orderedQty > 0);
    if (!originalItems.length) throw new Error("原订单没有可用的商品明细。");
    if (!originalItems.some((item) => item.affectedQty > 0)) throw new Error("请填写至少一个受影响商品数量。");
    const needsReissue = secondaryReason === "补发且留错品" || input.needsReissue === true;
    const reissueItems = (Array.isArray(input.reissueItems) ? input.reissueItems : []).map((item) => ({
      sku: normalizedSku(item.sku),
      productName: text(item.productName || item.sku),
      imageUrl: text(item.imageUrl),
      quantity: quantity(item.quantity),
    })).filter((item) => item.sku && item.quantity > 0);
    if (needsReissue && !reissueItems.length) throw new Error("该处理方式需要补发，请选择补发商品和数量。");
    const packagingFeeCny = money(order.packagingFeeCny ?? input.packagingFeeCny);
    if ((number(input.additionalLiabilityCny) > 0 || number(input.customerRecoveryCny) > 0) && !text(input.adjustmentReason)) {
      throw new Error("有额外承担或客户补回金额时，请填写金额调整说明。");
    }
    const moneyBreakdown = calculateAfterSalesLiability({
      responsibility,
      primaryReason,
      secondaryReason,
      affectedItems: originalItems,
      packagingFeeCny,
      additionalLiabilityCny: input.additionalLiabilityCny,
      customerRecoveryCny: input.customerRecoveryCny,
    });
    if (moneyBreakdown.missingCostSkus.length) throw new Error(`请先维护受影响商品成本：${moneyBreakdown.missingCostSkus.join("、")}`);
    const customer = {
      name: text(input.customer?.name || order.customer?.name),
      phone: text(input.customer?.phone || order.customer?.phone),
      country: text(input.customer?.country || order.customer?.country || order.site),
      province: text(input.customer?.province || order.customer?.province),
      city: text(input.customer?.city || order.customer?.city),
      district: text(input.customer?.district || order.customer?.district),
      address: text(input.customer?.address || order.customer?.address),
      postalCode: text(input.customer?.postalCode || order.customer?.postalCode),
    };
    const now = nowIso();
    const ticket = store.create({
      originalOrderNumber,
      orderIdentity: text(order.orderIdentity),
      platform: text(order.platform),
      site: text(order.site).toUpperCase(),
      shopId: text(order.shopId),
      shopAlias: text(order.shopAlias),
      platformShopName: text(order.platformShopName),
      orderStartedAt: text(order.orderStartedAt),
      orderSyncedAt: now,
      customer,
      originalItems,
      reissueItems,
      primaryReason,
      secondaryReason,
      responsibility,
      needsReissue,
      evidence: attachments(input.evidenceIds, "evidence"),
      labelUploads: [],
      operatorRemark: text(input.operatorRemark),
      warehouseRemark: "",
      adjustmentReason: text(input.adjustmentReason),
      packagingFeeCny,
      money: moneyBreakdown,
      status: "pending_warehouse",
      createdAt: now,
      createdBy: actorName(actor),
      createdById: text(actor?.id),
      updatedAt: now,
      completedAt: "",
      timeline: [event("created", "运营提交售后单", actor, `${primaryReason} / ${secondaryReason}`)],
    });
    return { ok: true, ticket, summary: summaryFor(store.list()) };
  }

  function updateWarehouse(id, input, actor) {
    const action = text(input.action);
    const transitions = {
      accept: { from: ["pending_warehouse"], to: "processing", label: "仓库已接单" },
      await_reshipment: { from: ["pending_warehouse", "processing"], to: "awaiting_reshipment", label: "进入待补发" },
      shipped: { from: ["processing", "awaiting_reshipment"], to: "shipped", label: "补发已发出" },
      complete: { from: ["processing", "shipped"], to: "completed", label: "售后已完结" },
      reopen: { from: ["completed", "cancelled"], to: "processing", label: "售后已重新打开" },
      cancel: { from: AFTER_SALES_STATUSES.filter((status) => !["completed", "cancelled"].includes(status)), to: "cancelled", label: "售后已作废" },
    };
    const transition = transitions[action];
    if (!transition) throw new Error("不支持的售后处理动作。");
    const updated = store.update(id, (ticket) => {
      if (!transition.from.includes(ticket.status)) throw new Error("当前状态不能执行该操作，请刷新后重试。");
      const newLabels = attachments(input.labelUploadIds, "label");
      const allLabels = [...(ticket.labelUploads || []), ...newLabels];
      const labelIds = new Set();
      ticket.labelUploads = allLabels.filter((upload) => !labelIds.has(upload.id) && labelIds.add(upload.id));
      if (action === "shipped" && ticket.needsReissue && !ticket.labelUploads.length) throw new Error("请先上传补发面单再标记已发出。");
      if (action === "complete" && ticket.needsReissue && ticket.status !== "shipped") throw new Error("需要补发的售后单请先上传面单并标记已发出。");
      ticket.status = transition.to;
      ticket.warehouseRemark = text(input.warehouseRemark || ticket.warehouseRemark);
      ticket.updatedAt = nowIso();
      ticket.completedAt = transition.to === "completed" ? ticket.updatedAt : "";
      ticket.timeline = [...(ticket.timeline || []), event(action, transition.label, actor, input.note || input.warehouseRemark)];
      return ticket;
    });
    if (!updated) throw new Error("售后单不存在。");
    return { ok: true, ticket: updated, summary: summaryFor(store.list()) };
  }

  return {
    list,
    get(id, dataScopes = {}) {
      const ticket = store.get(id);
      return ticket && isAfterSalesTicketWithinScope(ticket, dataScopes) ? ticket : null;
    },
    inScope(ticket, dataScopes = {}) { return isAfterSalesTicketWithinScope(ticket, dataScopes); },
    canAccessUpload(id, dataScopes = {}, actorId = "") {
      const upload = store.getUpload(id);
      if (!upload) return false;
      const relatedTickets = store.list().filter((ticket) => {
        const uploadIds = [...(ticket.evidence || []), ...(ticket.labelUploads || [])].map((item) => text(item?.id));
        return uploadIds.includes(text(id));
      });
      if (relatedTickets.length) return relatedTickets.some((ticket) => isAfterSalesTicketWithinScope(ticket, dataScopes));
      return Boolean(text(actorId) && text(upload.uploadedById) === text(actorId));
    },
    syncOrder,
    saveUpload,
    uploadPath,
    create,
    updateWarehouse,
  };
}

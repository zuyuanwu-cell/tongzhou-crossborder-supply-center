import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, resolve } from "node:path";
import { calculatePackagingFeeCny, normalizedCountryKey, normalizePackagingFeeRules } from "./performance-analytics.js";
import { normalizeMiaoshouPackages } from "./miaoshou-performance.js";
import { normalizeNotificationRouteSnapshot } from "./wecom-project-routing.js";

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

export const AFTER_SALES_PRIMARY_REASON_CODES = Object.freeze({
  warehouse_wrong_item: "仓库错发",
  warehouse_short_shipment: "仓库漏发少发",
  product_quality: "产品质量问题",
  parcel_lost: "快递丢失",
  transport_damage: "运输破损",
  sku_mapping_error: "SKU匹配错误",
});

export const AFTER_SALES_SECONDARY_REASON_CODES = Object.freeze({
  reship_keep_wrong_item: "补发且留错品",
  wrong_item_bad_review_no_return: "仓库发错货，客户差评不退货",
  customer_pays_difference_keep_wrong_item: "客户补差价留错品",
  full_refund_and_return: "客户退全款且退货",
});

export const AFTER_SALES_STATUSES = Object.freeze([
  "pending_warehouse",
  "processing",
  "awaiting_reshipment",
  "rejected",
  "shipped",
  "completed",
  "cancelled",
]);

const REMINDER_COOLDOWN_MS = 30 * 60 * 1000;
export const AFTER_SALES_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const AFTER_SALES_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const AFTER_SALES_UPLOAD_TYPES = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
});

const AFTER_SALES_EXTENSION_TYPES = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
});

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

function afterSalesUploadMimeType(input = {}) {
  const explicit = text(input.mimeType).toLowerCase().split(";")[0].replace("image/jpg", "image/jpeg");
  if (AFTER_SALES_UPLOAD_TYPES[explicit]) return explicit;
  return AFTER_SALES_EXTENSION_TYPES[extname(text(input.fileName)).toLowerCase()] || "";
}

function normalizedReasonKey(value) {
  return text(value).toLowerCase().replace(/[\s,，、;；。/]+/g, "");
}

function normalizeAfterSalesReason(value, code, reasonCodes, aliases = {}) {
  const normalizedCode = text(code || value).toLowerCase();
  if (reasonCodes[normalizedCode]) return reasonCodes[normalizedCode];
  const normalizedValue = normalizedReasonKey(value);
  const matched = Object.values(reasonCodes).find((label) => normalizedReasonKey(label) === normalizedValue);
  if (matched) return matched;
  return aliases[normalizedValue] || text(value);
}

function normalizeAfterSalesReasons(input = {}) {
  return {
    primaryReason: normalizeAfterSalesReason(
      input.primaryReason,
      input.primaryReasonCode,
      AFTER_SALES_PRIMARY_REASON_CODES,
      {
        [normalizedReasonKey("仓库发错货")]: "仓库错发",
        [normalizedReasonKey("仓库漏发/少发")]: "仓库漏发少发",
      },
    ),
    secondaryReason: normalizeAfterSalesReason(
      input.secondaryReason,
      input.secondaryReasonCode,
      AFTER_SALES_SECONDARY_REASON_CODES,
    ),
  };
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

export function formatAfterSalesRecipientInfo(customer = {}) {
  const address = [customer.country, customer.province, customer.city, customer.district, customer.address]
    .map(text)
    .filter(Boolean)
    .join(" ");
  return [
    text(customer.name) ? `收件人：${text(customer.name)}` : "",
    text(customer.phone) ? `电话：${text(customer.phone)}` : "",
    address ? `地址：${address}` : "",
    text(customer.postalCode) ? `邮编：${text(customer.postalCode)}` : "",
  ].filter(Boolean).join("\n");
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
  let state = loadJson(cachePath, {
    version: 2,
    updatedAt: "",
    sequenceDate: "",
    sequence: 0,
    settlementSequenceDate: "",
    settlementSequence: 0,
    tickets: [],
    drafts: [],
    uploads: [],
    settlementBatches: [],
    settlementReversals: [],
  });
  state.tickets = Array.isArray(state.tickets) ? state.tickets : [];
  state.drafts = Array.isArray(state.drafts) ? state.drafts : [];
  state.uploads = Array.isArray(state.uploads) ? state.uploads : [];
  state.settlementBatches = Array.isArray(state.settlementBatches) ? state.settlementBatches : [];
  state.settlementReversals = Array.isArray(state.settlementReversals) ? state.settlementReversals : [];
  state.version = Math.max(2, number(state.version));

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

  function nextSettlementId() {
    const date = nowIso().slice(0, 10).replaceAll("-", "");
    if (state.settlementSequenceDate !== date) {
      state.settlementSequenceDate = date;
      state.settlementSequence = 0;
    }
    state.settlementSequence += 1;
    return `WHC-${date}-${String(state.settlementSequence).padStart(4, "0")}`;
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
    listDrafts() { return state.drafts; },
    getDraft(id) { return state.drafts.find((draft) => draft.id === id) || null; },
    saveDraft(draft) {
      const index = state.drafts.findIndex((item) => item.id === draft.id);
      if (index >= 0) state.drafts[index] = draft;
      else state.drafts.unshift(draft);
      persist();
      return draft;
    },
    deleteDraft(id) {
      const index = state.drafts.findIndex((draft) => draft.id === id);
      if (index < 0) return null;
      const [removed] = state.drafts.splice(index, 1);
      persist();
      return removed;
    },
    addUpload(upload) {
      state.uploads.unshift(upload);
      if (state.uploads.length > 5000) state.uploads.length = 5000;
      persist();
      return upload;
    },
    getUpload(id) { return state.uploads.find((upload) => upload.id === id) || null; },
    listSettlementBatches() { return state.settlementBatches; },
    getSettlementBatch(id) { return state.settlementBatches.find((batch) => batch.id === id) || null; },
    findSettlementBatchByIdempotencyKey(idempotencyKey) {
      return state.settlementBatches.find((batch) => batch.idempotencyKey && batch.idempotencyKey === idempotencyKey) || null;
    },
    createSettlementBatch(batch) {
      const created = { ...batch, id: nextSettlementId() };
      state.settlementBatches.unshift(created);
      persist();
      return created;
    },
    updateSettlementBatch(id, updater) {
      const index = state.settlementBatches.findIndex((batch) => batch.id === id);
      if (index < 0) return null;
      state.settlementBatches[index] = updater({ ...state.settlementBatches[index] });
      persist();
      return state.settlementBatches[index];
    },
    listSettlementReversals() { return state.settlementReversals; },
    addSettlementReversal(reversal) {
      state.settlementReversals.unshift(reversal);
      persist();
      return reversal;
    },
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
  const customer = {
    name: pick(["recipientName", "receiverName", "consigneeName", "buyerName", "fullName", "name"]),
    phone: pick(["recipientPhone", "receiverPhone", "consigneePhone", "buyerPhone", "phone", "mobile", "mobilePhone"]),
    country: pick(["recipientCountry", "receiverCountry", "country", "countryName"]),
    province: pick(["recipientProvince", "receiverProvince", "province", "state", "region"]),
    city: pick(["recipientCity", "receiverCity", "city"]),
    district: pick(["recipientDistrict", "receiverDistrict", "district", "area"]),
    address: pick(["recipientAddress", "receiverAddress", "shippingAddress", "detailAddress", "address", "addressLine1"]),
    postalCode: pick(["recipientPostalCode", "receiverPostalCode", "postalCode", "zipCode", "postcode"]),
  };
  return { ...customer, recipientInfo: formatAfterSalesRecipientInfo(customer) };
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
  // 未同步原订单时 country 为空，不能把“无国家”的产品主档误当作国家精确匹配，
  // 否则会遮住产品目录中已经维护好的直营成本。
  const exact = countryKey
    ? candidates.filter((item) => normalizedCountryKey(item.country) === countryKey)
    : [];
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
  const landedProduct = candidates.find((item) => number(item?.latestLandedUnitCostCny) > 0) || product;
  const landedCost = number(landedProduct?.latestLandedUnitCostCny);
  if (landedCost > 0) {
    return {
      productName: text(product?.name || product?.nameEn || landedProduct?.name || landedProduct?.nameEn || sku),
      imageUrl: text(product?.imageUrl || landedProduct?.imageUrl),
      unitCostCny: money(landedCost),
      costSource: "产品库最新到仓成本",
      costMissing: false,
    };
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
      configured: Boolean(ticket.customer?.recipientInfo || ticket.customer?.name || ticket.customer?.phone || ticket.customer?.address),
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
  const scopedWarehouseIds = new Set((Array.isArray(dataScopes?.warehouseIds) ? dataScopes.warehouseIds : [])
    .map(text)
    .filter(Boolean));
  if (scopedWarehouseIds.size && !scopedWarehouseIds.has(text(ticket?.warehouseId))) return false;
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

export function isAfterSalesOrderWithinScope(order, dataScopes = {}) {
  // A freshly synchronized source order has not been assigned to a processing
  // warehouse yet. Warehouse scope is enforced through the selectable
  // warehouse list and again when the ticket is submitted; applying it here
  // would reject every scoped operator because order.warehouseId is empty.
  return isAfterSalesTicketWithinScope(order, { ...dataScopes, warehouseIds: [] });
}

const WAREHOUSE_LIABILITY_SETTLEMENT_METHODS = Object.freeze([
  "monthly_statement_offset",
  "accounts_payable_offset",
  "deposit_deduction",
  "warehouse_transfer",
  "other",
]);

const WAREHOUSE_LIABILITY_SETTLEMENT_METHOD_LABELS = Object.freeze({
  monthly_statement_offset: "月结账单冲抵",
  accounts_payable_offset: "应付账款冲抵",
  deposit_deduction: "保证金扣除",
  warehouse_transfer: "仓库转账赔付",
  other: "其他",
});

function effectiveSettlementBatches(batches = [], reversals = []) {
  const reversedBatchIds = new Set(reversals.map((item) => text(item.batchId)).filter(Boolean));
  return batches.filter((batch) => batch.status === "posted" && !reversedBatchIds.has(batch.id));
}

function warehouseLiabilityItems(tickets = [], batches = [], reversals = []) {
  const writtenOffBySource = new Map();
  for (const batch of effectiveSettlementBatches(batches, reversals)) {
    for (const line of batch.lines || []) {
      const sourceId = text(line.sourceId);
      writtenOffBySource.set(sourceId, money(number(writtenOffBySource.get(sourceId)) + number(line.amountCny)));
    }
  }
  return tickets.flatMap((ticket) => {
    const originalAmountCny = money(ticket.money?.totalWarehouseLiabilityCny);
    const warehouseResponsibility = ticket.responsibility?.party === "warehouse";
    const writtenOffCny = money(writtenOffBySource.get(ticket.id));
    if ((!warehouseResponsibility || originalAmountCny <= 0) && writtenOffCny <= 0) return [];
    const outstandingCny = ticket.status === "cancelled" ? 0 : money(originalAmountCny - writtenOffCny);
    let settlementStatus = "pending_writeoff";
    if (ticket.status === "cancelled") settlementStatus = "source_voided";
    else if (ticket.status === "rejected") settlementStatus = "disputed";
    else if (outstandingCny <= 0) settlementStatus = "written_off";
    else if (writtenOffCny > 0) settlementStatus = "partially_written_off";
    return [{
      id: `after_sales:${ticket.id}`,
      sourceType: "after_sales",
      sourceId: ticket.id,
      sourceNo: ticket.id,
      sourceStatus: ticket.status,
      warehouseId: text(ticket.warehouseId),
      warehouseName: text(ticket.warehouseName) || "未命名仓库",
      occurredAt: text(ticket.completedAt || ticket.createdAt),
      originalOrderNumber: text(ticket.originalOrderNumber),
      reason: [text(ticket.primaryReason), text(ticket.secondaryReason)].filter(Boolean).join(" / "),
      skuSummary: (ticket.originalItems || []).filter((item) => number(item.affectedQty) > 0).map((item) => `${text(item.sku)}×${quantity(item.affectedQty)}`).join("、"),
      currency: "CNY",
      originalAmountCny,
      writtenOffCny,
      outstandingCny,
      settlementStatus,
      createdBy: text(ticket.createdBy),
    }];
  });
}

function liabilitySummary(items = [], batches = [], reversals = []) {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const overdueBefore = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const effectiveBatches = effectiveSettlementBatches(batches, reversals);
  const writtenOffThisMonthCny = effectiveBatches
    .filter((batch) => text(batch.settlementDate || batch.postedAt).slice(0, 7) === currentMonth)
    .reduce((sum, batch) => sum + (batch.lines || []).reduce((lineSum, line) => lineSum + number(line.amountCny), 0), 0);
  return items.reduce((summary, item) => {
    summary.totalOriginalCny = money(summary.totalOriginalCny + item.originalAmountCny);
    summary.writtenOffCny = money(summary.writtenOffCny + item.writtenOffCny);
    if (item.settlementStatus === "disputed") summary.disputedCny = money(summary.disputedCny + item.outstandingCny);
    else if (!["written_off", "source_voided"].includes(item.settlementStatus)) {
      summary.pendingWriteoffCny = money(summary.pendingWriteoffCny + item.outstandingCny);
      summary.pendingCount += 1;
      const occurredAt = Date.parse(item.occurredAt);
      if (Number.isFinite(occurredAt) && occurredAt < overdueBefore) summary.overdueCny = money(summary.overdueCny + item.outstandingCny);
    }
    if (item.settlementStatus === "written_off") summary.writtenOffCount += 1;
    return summary;
  }, {
    totalOriginalCny: 0,
    pendingWriteoffCny: 0,
    writtenOffCny: 0,
    writtenOffThisMonthCny: money(writtenOffThisMonthCny),
    disputedCny: 0,
    overdueCny: 0,
    pendingCount: 0,
    writtenOffCount: 0,
  });
}

function csvCell(value) {
  const source = String(value ?? "");
  return /[",\r\n]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
}

function summaryFor(tickets, batches = [], reversals = []) {
  const liability = liabilitySummary(warehouseLiabilityItems(tickets, batches, reversals), batches, reversals);
  return tickets.reduce((summary, ticket) => {
    summary.total += 1;
    if (ticket.status === "pending_warehouse") summary.pendingWarehouse += 1;
    if (["processing", "awaiting_reshipment"].includes(ticket.status)) summary.processing += 1;
    if (ticket.status === "awaiting_reshipment") summary.awaitingReshipment += 1;
    if (ticket.status === "rejected") summary.rejected += 1;
    if (!['completed', 'cancelled'].includes(ticket.status)) summary.open += 1;
    return summary;
  }, {
    total: 0,
    open: 0,
    pendingWarehouse: 0,
    processing: 0,
    awaitingReshipment: 0,
    rejected: 0,
    warehouseLiabilityCny: money(liability.pendingWriteoffCny + liability.disputedCny),
    pendingWriteoffCny: liability.pendingWriteoffCny,
    writtenOffCny: liability.writtenOffCny,
    writtenOffThisMonthCny: liability.writtenOffThisMonthCny,
    disputedCny: liability.disputedCny,
  });
}

export function createAfterSalesService({ cachePath, uploadDir, performanceStore, connector, getProducts }) {
  const store = createStore(cachePath);

  function currentSummary(tickets = store.list()) {
    return summaryFor(tickets, store.listSettlementBatches(), store.listSettlementReversals());
  }

  function settings() {
    return performanceStore?.getPerformanceSettings?.() || {};
  }

  function list(filters = {}) {
    const keyword = text(filters.keyword).toLowerCase();
    const status = text(filters.status);
    const createdById = text(filters.createdById);
    const visibleTickets = store.list().filter((ticket) => (
      isAfterSalesTicketWithinScope(ticket, filters.dataScopes)
      && (!createdById || text(ticket.createdById) === createdById)
    ));
    const tickets = visibleTickets.filter((ticket) => {
      if (status && status !== "all" && ticket.status !== status) return false;
      if (!keyword) return true;
      return [ticket.id, ticket.originalOrderNumber, ticket.shopAlias, ticket.primaryReason, ticket.secondaryReason]
        .some((value) => text(value).toLowerCase().includes(keyword));
    });
    return { ok: true, updatedAt: nowIso(), summary: currentSummary(visibleTickets), tickets: tickets.map(publicListTicket) };
  }

  function settlementUpload(id) {
    const upload = store.getUpload(text(id));
    if (!upload) return null;
    return {
      ...upload,
      url: `/api/warehouse-liabilities/uploads/${encodeURIComponent(upload.id)}`,
    };
  }

  function settlementReversalFor(batchId) {
    return store.listSettlementReversals().find((item) => item.batchId === batchId) || null;
  }

  function publicSettlementBatch(batch) {
    const reversal = settlementReversalFor(batch.id);
    return {
      ...batch,
      status: reversal ? "reversed" : batch.status,
      reversal,
      voucherAttachments: (batch.voucherAttachmentIds || []).map(settlementUpload).filter(Boolean),
    };
  }

  function settlementBatchWithinScope(batch, dataScopes = {}) {
    return (batch.lines || []).some((line) => {
      const ticket = store.get(text(line.sourceId));
      return ticket && isAfterSalesTicketWithinScope(ticket, dataScopes);
    });
  }

  function settlements(filters = {}) {
    const visibleTickets = store.list().filter((ticket) => isAfterSalesTicketWithinScope(ticket, filters.dataScopes));
    const allItems = warehouseLiabilityItems(visibleTickets, store.listSettlementBatches(), store.listSettlementReversals());
    const keyword = text(filters.keyword).toLowerCase();
    const warehouseId = text(filters.warehouseId);
    const status = text(filters.status);
    const dateFrom = text(filters.dateFrom);
    const dateTo = text(filters.dateTo);
    const items = allItems.filter((item) => {
      if (warehouseId && item.warehouseId !== warehouseId) return false;
      if (status && status !== "all" && item.settlementStatus !== status) return false;
      const dateKey = text(item.occurredAt).slice(0, 10);
      if (dateFrom && dateKey && dateKey < dateFrom) return false;
      if (dateTo && dateKey && dateKey > dateTo) return false;
      if (!keyword) return true;
      return [item.sourceNo, item.originalOrderNumber, item.warehouseName, item.reason, item.skuSummary]
        .some((value) => text(value).toLowerCase().includes(keyword));
    });
    const batches = store.listSettlementBatches()
      .filter((batch) => settlementBatchWithinScope(batch, filters.dataScopes))
      .map(publicSettlementBatch);
    const warehouses = [...new Map(allItems.filter((item) => item.warehouseId).map((item) => [item.warehouseId, {
      id: item.warehouseId,
      name: item.warehouseName,
    }])).values()];
    return {
      ok: true,
      updatedAt: nowIso(),
      summary: liabilitySummary(allItems, store.listSettlementBatches(), store.listSettlementReversals()),
      items,
      batches,
      warehouses,
      settlementMethods: WAREHOUSE_LIABILITY_SETTLEMENT_METHODS.map((value) => ({ value, label: WAREHOUSE_LIABILITY_SETTLEMENT_METHOD_LABELS[value] })),
    };
  }

  function validateSettlementVoucherAttachmentIds(ids = []) {
    return [...new Set((Array.isArray(ids) ? ids : []).map(text).filter(Boolean))].map((id) => {
      const upload = store.getUpload(id);
      if (!upload) throw new Error(`核销凭证不存在：${id}`);
      if (text(upload.mimeType).startsWith("video/")) throw new Error("核销凭证仅支持图片或 PDF。");
      return id;
    });
  }

  function createSettlementBatch(input = {}, actor, dataScopes = {}) {
    const idempotencyKey = text(input.idempotencyKey).slice(0, 128);
    if (idempotencyKey) {
      const existing = store.findSettlementBatchByIdempotencyKey(idempotencyKey);
      if (existing) return { ok: true, idempotentReplay: true, batch: publicSettlementBatch(existing), summary: settlements({ dataScopes }).summary };
    }
    const requestedLines = Array.isArray(input.lines) ? input.lines : [];
    if (!requestedLines.length) throw new Error("请至少选择一笔待核销责任费用。");
    if (requestedLines.length > 200) throw new Error("单个核销批次最多包含 200 笔责任费用。");
    const duplicateSourceIds = requestedLines.map((line) => text(line.sourceId)).filter((sourceId, index, values) => values.indexOf(sourceId) !== index);
    if (duplicateSourceIds.length) throw new Error("同一责任费用不能在一个批次中重复添加。");
    const availableItems = new Map(settlements({ dataScopes }).items.map((item) => [item.sourceId, item]));
    const lines = requestedLines.map((requested) => {
      const item = availableItems.get(text(requested.sourceId));
      if (!item) throw new Error(`责任费用不存在或不在当前数据范围：${text(requested.sourceId)}`);
      if (["disputed", "written_off", "source_voided"].includes(item.settlementStatus)) throw new Error(`${item.sourceNo} 当前状态不能核销。`);
      const amountCny = money(requested.amountCny ?? item.outstandingCny);
      if (amountCny <= 0) throw new Error(`${item.sourceNo} 的本次核销金额必须大于 0。`);
      if (amountCny > item.outstandingCny) throw new Error(`${item.sourceNo} 的本次核销金额不能超过待核销余额。`);
      return {
        id: randomUUID(),
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        sourceNo: item.sourceNo,
        originalOrderNumber: item.originalOrderNumber,
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        occurredAt: item.occurredAt,
        reason: item.reason,
        skuSummary: item.skuSummary,
        originalAmountCny: item.originalAmountCny,
        previouslyWrittenOffCny: item.writtenOffCny,
        outstandingBeforeCny: item.outstandingCny,
        amountCny,
      };
    });
    const warehouseIds = [...new Set(lines.map((line) => line.warehouseId))];
    if (warehouseIds.length !== 1 || !warehouseIds[0]) throw new Error("一个核销批次只能包含同一家已配置仓库的责任费用。");
    const method = text(input.method) || "monthly_statement_offset";
    if (!WAREHOUSE_LIABILITY_SETTLEMENT_METHODS.includes(method)) throw new Error("请选择有效的核销方式。");
    const settlementDate = text(input.settlementDate) || nowIso().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw new Error("核销日期格式不正确。");
    const createdAt = nowIso();
    const batch = store.createSettlementBatch({
      status: "draft",
      idempotencyKey,
      warehouseId: warehouseIds[0],
      warehouseName: lines[0].warehouseName,
      currency: "CNY",
      totalAmountCny: money(lines.reduce((sum, line) => sum + line.amountCny, 0)),
      settlementDate,
      method,
      methodLabel: WAREHOUSE_LIABILITY_SETTLEMENT_METHOD_LABELS[method],
      voucherNo: text(input.voucherNo),
      voucherAttachmentIds: validateSettlementVoucherAttachmentIds(input.voucherAttachmentIds),
      note: text(input.note),
      lines,
      createdAt,
      createdBy: actorName(actor),
      createdById: text(actor?.id),
      postedAt: "",
      postedBy: "",
      postedById: "",
    });
    return { ok: true, batch: publicSettlementBatch(batch), summary: settlements({ dataScopes }).summary };
  }

  function postSettlementBatch(id, input = {}, actor, dataScopes = {}) {
    const batch = store.getSettlementBatch(text(id));
    if (!batch || !settlementBatchWithinScope(batch, dataScopes)) throw new Error("核销批次不存在或不在当前数据范围内。");
    if (settlementReversalFor(batch.id)) throw new Error("该核销批次已经冲销，不能再次确认。");
    if (batch.status === "posted") return { ok: true, idempotentReplay: true, batch: publicSettlementBatch(batch), summary: settlements({ dataScopes }).summary };
    if (batch.status !== "draft") throw new Error("当前批次状态不能确认核销。");
    const method = text(input.method || batch.method);
    if (!WAREHOUSE_LIABILITY_SETTLEMENT_METHODS.includes(method)) throw new Error("请选择有效的核销方式。");
    const settlementDate = text(input.settlementDate || batch.settlementDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw new Error("核销日期格式不正确。");
    const voucherAttachmentIds = validateSettlementVoucherAttachmentIds(input.voucherAttachmentIds ?? batch.voucherAttachmentIds);
    const voucherNo = text(input.voucherNo ?? batch.voucherNo);
    if (!voucherNo && !voucherAttachmentIds.length) throw new Error("确认核销前，请填写财务凭证号或上传核销凭证。");
    const currentItems = new Map(warehouseLiabilityItems(store.list(), store.listSettlementBatches(), store.listSettlementReversals()).map((item) => [item.sourceId, item]));
    for (const line of batch.lines || []) {
      const item = currentItems.get(text(line.sourceId));
      if (!item || ["disputed", "source_voided"].includes(item.settlementStatus)) throw new Error(`${line.sourceNo} 已作废、处于争议中或不存在，不能核销。`);
      if (number(line.amountCny) > number(item.outstandingCny)) throw new Error(`${line.sourceNo} 的待核销余额已变化，请重新生成核销批次。`);
    }
    const postedAt = nowIso();
    const updated = store.updateSettlementBatch(batch.id, (current) => ({
      ...current,
      status: "posted",
      settlementDate,
      method,
      methodLabel: WAREHOUSE_LIABILITY_SETTLEMENT_METHOD_LABELS[method],
      voucherNo,
      voucherAttachmentIds,
      note: text(input.note ?? current.note),
      postedAt,
      postedBy: actorName(actor),
      postedById: text(actor?.id),
    }));
    return { ok: true, batch: publicSettlementBatch(updated), summary: settlements({ dataScopes }).summary };
  }

  function reverseSettlementBatch(id, input = {}, actor, dataScopes = {}) {
    const batch = store.getSettlementBatch(text(id));
    if (!batch || !settlementBatchWithinScope(batch, dataScopes)) throw new Error("核销批次不存在或不在当前数据范围内。");
    if (batch.status !== "posted") throw new Error("只有已确认核销的批次可以冲销。");
    const existing = settlementReversalFor(batch.id);
    if (existing) return { ok: true, idempotentReplay: true, batch: publicSettlementBatch(batch), reversal: existing, summary: settlements({ dataScopes }).summary };
    const reason = text(input.reason);
    if (!reason) throw new Error("冲销时必须填写原因。");
    const reversedAt = nowIso();
    const reversal = store.addSettlementReversal({
      id: `WHR-${reversedAt.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      batchId: batch.id,
      amountCny: batch.totalAmountCny,
      reason,
      reversedAt,
      reversedBy: actorName(actor),
      reversedById: text(actor?.id),
    });
    return { ok: true, batch: publicSettlementBatch(batch), reversal, summary: settlements({ dataScopes }).summary };
  }

  function exportSettlementBatch(id, dataScopes = {}) {
    const batch = store.getSettlementBatch(text(id));
    if (!batch || !settlementBatchWithinScope(batch, dataScopes)) throw new Error("核销批次不存在或不在当前数据范围内。");
    const publicBatch = publicSettlementBatch(batch);
    const rows = [
      ["核销批次号", publicBatch.id],
      ["仓库", publicBatch.warehouseName],
      ["批次状态", publicBatch.status === "draft" ? "待确认" : publicBatch.status === "posted" ? "已核销" : "已冲销"],
      ["核销方式", publicBatch.methodLabel],
      ["核销日期", publicBatch.settlementDate],
      ["财务凭证号", publicBatch.voucherNo],
      ["批次金额(CNY)", publicBatch.totalAmountCny],
      ["经办人", publicBatch.postedBy || publicBatch.createdBy],
      ["备注", publicBatch.note],
      [],
      ["责任单号", "来源类型", "原订单号", "仓库", "费用发生日期", "责任原因", "SKU明细", "原责任金额(CNY)", "批次前已核销(CNY)", "本次核销(CNY)", "核销后余额(CNY)"],
      ...(publicBatch.lines || []).map((line) => [
        line.sourceNo,
        line.sourceType === "after_sales" ? "售后单" : line.sourceType,
        line.originalOrderNumber,
        line.warehouseName,
        text(line.occurredAt).slice(0, 10),
        line.reason,
        line.skuSummary,
        line.originalAmountCny,
        line.previouslyWrittenOffCny,
        line.amountCny,
        money(number(line.outstandingBeforeCny) - number(line.amountCny)),
      ]),
    ];
    return {
      fileName: `海外仓责任费用核销-${publicBatch.id}.csv`,
      content: `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`,
    };
  }

  function searchProducts(input = {}) {
    const products = getProducts?.() || {};
    const country = text(input.country);
    const countryKey = normalizedCountryKey(country);
    const keyword = text(input.keyword).toLowerCase();
    const limit = Math.max(1, Math.min(100, Math.floor(number(input.limit) || 30)));
    const scopedCountries = new Set((Array.isArray(input.dataScopes?.countries) ? input.dataScopes.countries : []).map(normalizedCountryKey).filter(Boolean));
    const scopedSkus = new Set((Array.isArray(input.dataScopes?.skus) ? input.dataScopes.skus : []).map(normalizedSku).filter(Boolean));
    if (countryKey && scopedCountries.size && !scopedCountries.has(countryKey)) {
      return { ok: true, country, products: [] };
    }
    const candidates = [...(products.catalog || []), ...(products.productBase || [])]
      .filter((product) => {
        const sku = normalizedSku(product?.sku || product?.skuNo || product?.countrySku);
        if (!sku || (scopedSkus.size && !scopedSkus.has(sku))) return false;
        const productCountry = normalizedCountryKey(product?.country);
        if (scopedCountries.size && productCountry && !scopedCountries.has(productCountry)) return false;
        return !keyword || [sku, product?.name, product?.nameEn, product?.brand, product?.category]
          .some((value) => text(value).toLowerCase().includes(keyword));
      })
      .sort((left, right) => {
        const leftExact = countryKey && normalizedCountryKey(left?.country) === countryKey ? 1 : 0;
        const rightExact = countryKey && normalizedCountryKey(right?.country) === countryKey ? 1 : 0;
        return rightExact - leftExact || normalizedSku(left?.sku || left?.skuNo).localeCompare(normalizedSku(right?.sku || right?.skuNo));
      });
    const uniqueProducts = [];
    const seen = new Set();
    const rates = performanceStore?.listExchangeRates?.() || [];
    const supplementalCosts = performanceStore?.listSupplementalProductCosts?.() || [];
    const effectiveDate = text(input.effectiveDate).slice(0, 10) || nowIso().slice(0, 10);
    for (const product of candidates) {
      const sku = normalizedSku(product?.sku || product?.skuNo || product?.countrySku);
      if (!sku || seen.has(sku)) continue;
      seen.add(sku);
      const resolved = resolveItemProduct(sku, country, products, rates, supplementalCosts, effectiveDate);
      uniqueProducts.push({
        sku,
        productName: resolved.productName,
        imageUrl: resolved.imageUrl,
        unitCostCny: resolved.unitCostCny,
        costSource: resolved.costSource,
        costMissing: resolved.costMissing,
        brand: text(product?.brand),
        category: text(product?.category),
        country: text(product?.country),
      });
      if (uniqueProducts.length >= limit) break;
    }
    return { ok: true, country, products: uniqueProducts };
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

  function saveUploadBytes(input, actor, requestOrigin) {
    const kind = input.kind === "label" ? "label" : "evidence";
    const mimeType = afterSalesUploadMimeType(input);
    if (!mimeType) throw new Error("请上传 PNG、JPG、WEBP、GIF、PDF、MP4、MOV 或 WebM 文件。");
    if (kind === "label" && mimeType.startsWith("video/")) throw new Error("补发面单仅支持图片或 PDF，视频请上传到售后问题凭证。");
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || []);
    if (!bytes.length) throw new Error("文件内容为空。");
    const maxBytes = mimeType.startsWith("video/") ? AFTER_SALES_VIDEO_MAX_BYTES : AFTER_SALES_DOCUMENT_MAX_BYTES;
    if (bytes.length > maxBytes) throw new Error(mimeType.startsWith("video/") ? "单个视频不能超过 50MB。" : "单个图片或 PDF 不能超过 8MB。");
    const suffix = AFTER_SALES_UPLOAD_TYPES[mimeType];
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

  function saveUpload(input, actor, requestOrigin) {
    const dataUrl = text(input.dataUrl);
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw new Error("附件内容格式不正确。");
    return saveUploadBytes({
      ...input,
      mimeType: match[1],
      bytes: Buffer.from(match[2], "base64"),
    }, actor, requestOrigin);
  }

  function saveSettlementUploadBytes(input, actor, requestOrigin) {
    const upload = saveUploadBytes({ ...input, kind: "evidence" }, actor, requestOrigin);
    return settlementUpload(upload.id);
  }

  function uploadPath(fileName) {
    const safeName = text(fileName);
    if (!/^as-[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|pdf|mp4|mov|webm)$/i.test(safeName)) return null;
    const upload = store.getUpload(safeName);
    const path = resolve(uploadDir, safeName);
    return upload && existsSync(path) ? { path, upload } : null;
  }

  function attachments(ids, kind) {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(text).filter(Boolean))];
    return unique.map((id) => store.getUpload(id)).filter((upload) => upload && upload.kind === kind);
  }

  function listDrafts(actor) {
    const actorId = text(actor?.id);
    return store.listDrafts()
      .filter((draft) => actorId && draft.createdById === actorId)
      .sort((left, right) => text(right.updatedAt).localeCompare(text(left.updatedAt)));
  }

  function saveDraft(input, actor) {
    const actorId = text(actor?.id);
    if (!actorId) throw new Error("当前账号无法保存草稿。");
    const requestedId = text(input.id || input.draftId);
    const existing = requestedId ? store.getDraft(requestedId) : null;
    if (requestedId && (!existing || existing.createdById !== actorId)) throw new Error("售后草稿不存在或不属于当前账号。");
    const now = nowIso();
    const order = input.order && typeof input.order === "object" ? input.order : null;
    const normalizedReasons = normalizeAfterSalesReasons(input);
    const draft = {
      id: existing?.id || `ASD-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      createdById: actorId,
      createdBy: existing?.createdBy || actorName(actor),
      orderNumber: text(input.orderNumber || order?.orderNumber),
      order,
      customer: input.customer && typeof input.customer === "object" ? input.customer : {},
      warehouseId: text(input.warehouseId || order?.warehouseId),
      warehouseName: text(input.warehouseName || order?.warehouseName),
      notificationTeamId: text(input.notificationTeamId),
      originalItems: Array.isArray(input.originalItems) ? input.originalItems : [],
      reissueItems: Array.isArray(input.reissueItems) ? input.reissueItems : [],
      primaryReason: AFTER_SALES_PRIMARY_REASONS.includes(normalizedReasons.primaryReason) ? normalizedReasons.primaryReason : text(input.primaryReason),
      secondaryReason: AFTER_SALES_SECONDARY_REASONS.includes(normalizedReasons.secondaryReason) ? normalizedReasons.secondaryReason : text(input.secondaryReason),
      needsReissue: input.needsReissue === true,
      evidence: attachments(input.evidenceIds, "evidence"),
      operatorRemark: text(input.operatorRemark),
      additionalLiabilityCny: money(input.additionalLiabilityCny),
      customerRecoveryCny: money(input.customerRecoveryCny),
      adjustmentReason: text(input.adjustmentReason),
    };
    return store.saveDraft(draft);
  }

  function deleteDraft(id, actor) {
    const draft = store.getDraft(text(id));
    if (!draft || draft.createdById !== text(actor?.id)) throw new Error("售后草稿不存在或不属于当前账号。");
    return store.deleteDraft(draft.id);
  }

  function create(input, actor) {
    const order = input.order && typeof input.order === "object" ? input.order : {};
    const originalOrderNumber = text(order.orderNumber || input.originalOrderNumber);
    if (!originalOrderNumber) throw new Error("请先同步原订单。");
    const { primaryReason, secondaryReason } = normalizeAfterSalesReasons(input);
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
      unitCostCny: money(item.unitCostCny),
      costSource: text(item.costSource || (number(item.unitCostCny) > 0 ? "人工成本" : "待人工维护")),
      costMissing: number(item.unitCostCny) <= 0,
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
      recipientInfo: text(input.customer?.recipientInfo || order.customer?.recipientInfo),
    };
    if (!customer.recipientInfo) customer.recipientInfo = formatAfterSalesRecipientInfo(customer);
    if (needsReissue && !customer.recipientInfo) throw new Error("需要补发时，请填写完整收件信息（收件人、电话和详细地址）。");
    const now = nowIso();
    const ticket = store.create({
      originalOrderNumber,
      orderIdentity: text(order.orderIdentity),
      platform: text(order.platform),
      site: text(order.site).toUpperCase(),
      shopId: text(order.shopId),
      shopAlias: text(order.shopAlias),
      platformShopName: text(order.platformShopName),
      warehouseId: text(input.warehouseId || order.warehouseId),
      warehouseName: text(input.warehouseName || order.warehouseName),
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
      notificationRoute: normalizeNotificationRouteSnapshot(input.notificationRoute),
      updatedAt: now,
      completedAt: "",
      timeline: [event("created", "运营提交售后单", actor, `${primaryReason} / ${secondaryReason}`)],
      notifications: [],
      rejectionHistory: [],
    });
    return { ok: true, ticket, summary: currentSummary() };
  }

  function updateWarehouse(id, input, actor) {
    const action = text(input.action);
    const transitions = {
      accept: { from: ["pending_warehouse"], to: "processing", label: "仓库已接单" },
      await_reshipment: { from: ["pending_warehouse", "processing"], to: "awaiting_reshipment", label: "进入待补发" },
      shipped: { from: ["processing", "awaiting_reshipment"], to: "shipped", label: "补发已发出" },
      complete: { from: ["processing", "shipped"], to: "completed", label: "售后已完结" },
      reject: { from: ["pending_warehouse", "processing", "awaiting_reshipment"], to: "rejected", label: "仓库已驳回，待运营修改" },
      reopen: { from: ["completed"], to: "processing", label: "售后已重新打开" },
      activate: { from: ["cancelled"], to: "pending_warehouse", label: "售后已激活" },
      cancel: { from: AFTER_SALES_STATUSES.filter((status) => !["completed", "cancelled"].includes(status)), to: "cancelled", label: "售后已作废" },
    };
    const transition = transitions[action];
    if (!transition) throw new Error("不支持的售后处理动作。");
    if (action === "cancel") {
      const liability = warehouseLiabilityItems(store.list(), store.listSettlementBatches(), store.listSettlementReversals())
        .find((item) => item.sourceId === text(id));
      if (number(liability?.writtenOffCny) > 0) throw new Error("该售后责任费用已经核销，请先在费用核销中冲销对应批次，再作废售后单。");
    }
    const updated = store.update(id, (ticket) => {
      if (!transition.from.includes(ticket.status)) throw new Error("当前状态不能执行该操作，请刷新后重试。");
      const newLabels = attachments(input.labelUploadIds, "label");
      const allLabels = [...(ticket.labelUploads || []), ...newLabels];
      const labelIds = new Set();
      ticket.labelUploads = allLabels.filter((upload) => !labelIds.has(upload.id) && labelIds.add(upload.id));
      if (action === "shipped" && ticket.needsReissue && !ticket.labelUploads.length) throw new Error("请先上传补发面单再标记已发出。");
      if (action === "complete" && ticket.needsReissue && ticket.status !== "shipped") throw new Error("需要补发的售后单请先上传面单并标记已发出。");
      const rejectionReason = text(input.rejectionReason || input.note || input.warehouseRemark);
      if (action === "reject" && !rejectionReason) throw new Error("驳回售后单前，请填写具体原因和需要运营修改的内容。");
      const previousStatus = ticket.status;
      const restorableStatuses = new Set(["pending_warehouse", "processing", "awaiting_reshipment", "rejected", "shipped"]);
      const nextStatus = action === "activate" && restorableStatuses.has(text(ticket.cancelledFromStatus))
        ? text(ticket.cancelledFromStatus)
        : transition.to;
      ticket.status = nextStatus;
      ticket.warehouseRemark = text(input.warehouseRemark || ticket.warehouseRemark);
      ticket.updatedAt = nowIso();
      ticket.completedAt = nextStatus === "completed" ? ticket.updatedAt : "";
      if (action === "cancel") {
        ticket.cancelledFromStatus = previousStatus;
        ticket.cancelledAt = ticket.updatedAt;
        ticket.cancelledBy = actorName(actor);
      }
      if (action === "activate") {
        ticket.activatedAt = ticket.updatedAt;
        ticket.activatedBy = actorName(actor);
      }
      if (action === "reject") {
        ticket.rejectionReason = rejectionReason;
        ticket.rejectedAt = ticket.updatedAt;
        ticket.rejectedBy = actorName(actor);
        ticket.rejectionHistory = [...(ticket.rejectionHistory || []), {
          reason: rejectionReason,
          rejectedAt: ticket.updatedAt,
          rejectedBy: actorName(actor),
        }];
      }
      const statusLabels = {
        pending_warehouse: "待仓库接单",
        processing: "仓库已受理",
        awaiting_reshipment: "待补发",
        rejected: "仓库已驳回，待运营修改",
        shipped: "补发已发出",
      };
      const timelineLabel = action === "activate"
        ? `售后已激活，恢复为${statusLabels[nextStatus] || "待仓库接单"}`
        : transition.label;
      ticket.timeline = [...(ticket.timeline || []), event(action, timelineLabel, actor, input.note || input.warehouseRemark)];
      return ticket;
    });
    if (!updated) throw new Error("售后单不存在。");
    return { ok: true, ticket: updated, summary: currentSummary() };
  }

  function attachLabels(id, labelUploadIds, actor, note = "") {
    const newLabels = attachments(labelUploadIds, "label");
    if (!newLabels.length) throw new Error("请选择需要归档的补发面单。");
    const updated = store.update(id, (ticket) => {
      if (["completed", "cancelled", "rejected"].includes(ticket.status)) throw new Error("当前状态不能上传补发面单，请刷新后重试。");
      const labelIds = new Set();
      const labelUploads = [...(ticket.labelUploads || []), ...newLabels]
        .filter((upload) => !labelIds.has(upload.id) && labelIds.add(upload.id));
      const addedCount = Math.max(0, labelUploads.length - (ticket.labelUploads || []).length);
      if (!addedCount) return ticket;
      return {
        ...ticket,
        labelUploads,
        updatedAt: nowIso(),
        timeline: [...(ticket.timeline || []), event("label_uploaded", `仓库上传 ${addedCount} 张补发面单`, actor, note)],
      };
    });
    if (!updated) throw new Error("售后单不存在。");
    return { ok: true, ticket: updated, summary: currentSummary() };
  }

  function resubmit(id, input, actor) {
    const updated = store.update(id, (ticket) => {
      if (ticket.status !== "rejected") throw new Error("只有仓库已驳回的售后单可以修改后重新提交。");
      const { primaryReason, secondaryReason } = normalizeAfterSalesReasons({
        primaryReason: input.primaryReason || ticket.primaryReason,
        primaryReasonCode: input.primaryReasonCode,
        secondaryReason: input.secondaryReason || ticket.secondaryReason,
        secondaryReasonCode: input.secondaryReasonCode,
      });
      if (!AFTER_SALES_PRIMARY_REASONS.includes(primaryReason)) throw new Error("请选择售后一级分类。");
      if (!AFTER_SALES_SECONDARY_REASONS.includes(secondaryReason)) throw new Error("请选择售后二级分类。");
      const correctionNote = text(input.correctionNote);
      if (!correctionNote) throw new Error("请填写本次修改说明，方便仓库重新核查。");
      const originalItems = (Array.isArray(input.originalItems) ? input.originalItems : ticket.originalItems).map((item) => ({
        ...item,
        sku: normalizedSku(item.sku),
        orderedQty: quantity(item.orderedQty),
        affectedQty: Math.min(quantity(item.orderedQty), quantity(item.affectedQty)),
        unitCostCny: money(item.unitCostCny),
        costMissing: number(item.unitCostCny) <= 0,
      })).filter((item) => item.sku && item.orderedQty > 0);
      if (!originalItems.some((item) => item.affectedQty > 0)) throw new Error("请填写至少一个受影响商品数量。");
      const needsReissue = secondaryReason === "补发且留错品" || input.needsReissue === true;
      const reissueItems = (Array.isArray(input.reissueItems) ? input.reissueItems : ticket.reissueItems).map((item) => ({
        ...item,
        sku: normalizedSku(item.sku),
        quantity: quantity(item.quantity),
        unitCostCny: money(item.unitCostCny),
        costSource: text(item.costSource || (number(item.unitCostCny) > 0 ? "人工成本" : "待人工维护")),
        costMissing: number(item.unitCostCny) <= 0,
      })).filter((item) => item.sku && item.quantity > 0);
      if (needsReissue && !reissueItems.length) throw new Error("该处理方式需要补发，请选择补发商品和数量。");
      const responsibility = resolveAfterSalesResponsibility(primaryReason, secondaryReason, input.responsibilityOverride);
      const moneyBreakdown = calculateAfterSalesLiability({
        responsibility,
        affectedItems: originalItems,
        packagingFeeCny: ticket.packagingFeeCny,
        additionalLiabilityCny: input.additionalLiabilityCny ?? ticket.money?.additionalLiabilityCny,
        customerRecoveryCny: input.customerRecoveryCny ?? ticket.money?.customerRecoveryCny,
      });
      if (moneyBreakdown.missingCostSkus.length) throw new Error(`请先维护受影响商品成本：${moneyBreakdown.missingCostSkus.join("、")}`);
      const nextCustomer = { ...(ticket.customer || {}), ...(input.customer || {}) };
      if (needsReissue && !text(nextCustomer.recipientInfo)) throw new Error("需要补发时，请填写完整收件信息。");
      const now = nowIso();
      return {
        ...ticket,
        primaryReason,
        secondaryReason,
        responsibility,
        originalItems,
        reissueItems,
        needsReissue,
        customer: nextCustomer,
        operatorRemark: text(input.operatorRemark ?? ticket.operatorRemark),
        adjustmentReason: text(input.adjustmentReason ?? ticket.adjustmentReason),
        money: moneyBreakdown,
        status: "pending_warehouse",
        updatedAt: now,
        warehouseRemark: "",
        rejectionReason: "",
        timeline: [...(ticket.timeline || []), event("resubmit", "运营修改并重新提交", actor, correctionNote)],
      };
    });
    if (!updated) throw new Error("售后单不存在。");
    return { ok: true, ticket: updated, summary: currentSummary() };
  }

  function remind(id, actor) {
    const updated = store.update(id, (ticket) => {
      const statusLabels = {
        rejected: "仓库已驳回，正在等待运营修改",
        completed: "已完结",
        cancelled: "已作废",
      };
      if (!["pending_warehouse", "processing", "awaiting_reshipment", "shipped"].includes(ticket.status)) {
        throw new Error(`${statusLabels[ticket.status] || "当前状态"}的售后单不能催办仓库。`);
      }
      const lastReminder = [...(ticket.timeline || [])].reverse().find((item) => item.type === "reminder_sent");
      const lastReminderAt = Date.parse(lastReminder?.createdAt || "");
      const remainingMs = Number.isFinite(lastReminderAt) ? REMINDER_COOLDOWN_MS - (Date.now() - lastReminderAt) : 0;
      if (remainingMs > 0) {
        const error = new Error(`该售后单 30 分钟内已催办过，请 ${Math.max(1, Math.ceil(remainingMs / 60_000))} 分钟后再试。`);
        error.code = "reminder_cooldown";
        error.retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        throw error;
      }
      const reminderEvent = event("reminder_sent", "运营催办仓库", actor, "请仓库尽快查看并更新处理进度。");
      return {
        ...ticket,
        updatedAt: reminderEvent.createdAt,
        timeline: [...(ticket.timeline || []), reminderEvent],
      };
    });
    if (!updated) throw new Error("售后单不存在。");
    const reminderAt = updated.timeline?.at(-1)?.createdAt || nowIso();
    return {
      ok: true,
      ticket: updated,
      summary: currentSummary(),
      nextReminderAt: new Date(Date.parse(reminderAt) + REMINDER_COOLDOWN_MS).toISOString(),
    };
  }

  function recordNotification(id, input = {}) {
    return store.update(id, (ticket) => {
      const entry = {
        id: randomUUID(),
        eventType: text(input.eventType),
        target: text(input.target),
        status: input.status === "sent" ? "sent" : input.status === "failed" ? "failed" : "skipped",
        robotCount: quantity(input.robotCount),
        failedCount: quantity(input.failedCount),
        message: text(input.message),
        routeLabel: text(input.routeLabel),
        teamId: text(input.teamId),
        fallback: Boolean(input.fallback),
        mentionedCount: quantity(input.mentionedCount),
        createdAt: nowIso(),
      };
      ticket.notifications = [...(Array.isArray(ticket.notifications) ? ticket.notifications : []), entry].slice(-30);
      return ticket;
    });
  }

  function assignWarehouse(id, warehouse = {}) {
    return store.update(id, (ticket) => ({
      ...ticket,
      warehouseId: text(warehouse.id || warehouse.warehouseId),
      warehouseName: text(warehouse.name || warehouse.warehouseName),
    }));
  }

  return {
    list,
    searchProducts,
    get(id, dataScopes = {}, createdById = "") {
      const ticket = store.get(id);
      return ticket
        && isAfterSalesTicketWithinScope(ticket, dataScopes)
        && (!text(createdById) || text(ticket.createdById) === text(createdById))
        ? ticket
        : null;
    },
    inScope(ticket, dataScopes = {}) { return isAfterSalesTicketWithinScope(ticket, dataScopes); },
    orderInScope(order, dataScopes = {}) { return isAfterSalesOrderWithinScope(order, dataScopes); },
    canAccessUpload(id, dataScopes = {}, actorId = "", createdById = "") {
      const upload = store.getUpload(id);
      if (!upload) return false;
      const relatedTickets = store.list().filter((ticket) => {
        const uploadIds = [...(ticket.evidence || []), ...(ticket.labelUploads || [])].map((item) => text(item?.id));
        return uploadIds.includes(text(id));
      });
      if (relatedTickets.length) return relatedTickets.some((ticket) => (
        isAfterSalesTicketWithinScope(ticket, dataScopes)
        && (!text(createdById) || text(ticket.createdById) === text(createdById))
      ));
      return Boolean(text(actorId) && text(upload.uploadedById) === text(actorId));
    },
    canAccessSettlementUpload(id, actorId = "", dataScopes = {}) {
      const upload = store.getUpload(id);
      if (!upload) return false;
      if (text(actorId) && text(upload.uploadedById) === text(actorId)) return true;
      return store.listSettlementBatches().some((batch) => (
        (batch.voucherAttachmentIds || []).includes(text(id))
        && settlementBatchWithinScope(batch, dataScopes)
      ));
    },
    listDrafts,
    saveDraft,
    deleteDraft,
    syncOrder,
    saveUpload,
    saveUploadBytes,
    saveSettlementUploadBytes,
    uploadPath,
    create,
    updateWarehouse,
    attachLabels,
    resubmit,
    remind,
    recordNotification,
    assignWarehouse,
    settlements,
    createSettlementBatch,
    postSettlementBatch,
    reverseSettlementBatch,
    exportSettlementBatch,
  };
}

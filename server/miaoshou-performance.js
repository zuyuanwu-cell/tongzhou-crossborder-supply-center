function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

// 妙手开放平台返回的时间不带时区（如 "2026-08-01 10:00:00"），按北京时间给出。
// 显式补上偏移量，避免服务器或容器时区变化时整体错位。
function miaoshouTimeOffset() {
  const configured = text(process.env.MIAOSHOU_API_TIME_OFFSET);
  return /^[+-]\d{2}:\d{2}$/.test(configured) ? configured : "+08:00";
}

function dateTime(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{10,13}$/.test(raw)) {
    const epoch = Number(raw.length === 10 ? `${raw}000` : raw);
    return Number.isFinite(epoch) ? new Date(epoch).toISOString() : raw;
  }
  const naive = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
  const parsed = naive
    ? Date.parse(`${naive[1]}T${naive[2].length === 5 ? `${naive[2]}:00` : naive[2]}${miaoshouTimeOffset()}`)
    : Date.parse(raw.replace(" ", "T"));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function normalizedPlatform(value) {
  const token = text(value).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
  if (token.includes("tiktok")) return "tiktok";
  if (token.includes("shopee")) return "shopee";
  if (token.includes("ozon")) return "ozon";
  if (token.includes("lazada")) return "lazada";
  return token;
}

function normalizedSku(value) {
  const raw = text(value).normalize("NFKC").toUpperCase();
  const suffix = raw.match(/(TZKJ-[A-Z0-9-]+)$/)?.[1];
  return suffix || raw;
}

function orderKey(input = {}) {
  const platform = normalizedPlatform(input.platform);
  const shopId = text(input.shopId);
  const platformOrderSn = text(input.platformOrderSn || input.orderNo);
  if (!shopId || !platformOrderSn) return "";
  return `${platform}|${shopId}|${platformOrderSn}`;
}

function arraysAtKnownKeys(value, keys, output = [], visited = new Set()) {
  if (!value || typeof value !== "object" || visited.has(value)) return output;
  visited.add(value);
  if (!Array.isArray(value)) {
    for (const key of keys) {
      if (Array.isArray(value[key])) output.push(...value[key]);
    }
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    if (entry && typeof entry === "object") arraysAtKnownKeys(entry, keys, output, visited);
  }
  return output;
}

function packageRows(payload) {
  const rows = arraysAtKnownKeys(payload?.data ?? payload, ["orderPackageList", "packageList"]);
  if (rows.length) return rows;
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data : [];
}

function mergeMeaningful(current, candidate) {
  if (candidate === undefined || candidate === null || candidate === "") return current;
  if (current === undefined || current === null || current === "") return candidate;
  if (typeof candidate === "number" && candidate !== 0) return candidate;
  return current;
}

function rawOrderInfo(row = {}) {
  return row.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : row;
}

export function normalizeMiaoshouPackages(payload) {
  const sourceRows = packageRows(payload);
  const orders = new Map();
  const items = new Map();
  let packageCount = 0;
  for (const packageRow of sourceRows) {
    if (!packageRow || typeof packageRow !== "object") continue;
    const info = rawOrderInfo(packageRow);
    const identity = orderKey({
      platform: info.platform ?? packageRow.platform,
      shopId: info.shopId ?? packageRow.shopId,
      platformOrderSn: info.platformOrderSn ?? packageRow.platformOrderSn,
    });
    if (!identity) continue;
    packageCount += 1;
    const previous = orders.get(identity) || {};
    const candidate = {
      identity,
      opOrderId: text(info.opOrderId ?? packageRow.opOrderId),
      platform: text(info.platform ?? packageRow.platform),
      shopId: text(info.shopId ?? packageRow.shopId),
      platformOrderSn: text(info.platformOrderSn ?? packageRow.platformOrderSn),
      site: text(info.site ?? packageRow.site).toUpperCase(),
      currency: text(info.currency).toUpperCase(),
      productAmount: number(info.productAmount),
      orderAmount: number(info.orderAmount),
      payAmount: number(info.payAmount),
      estimatedShippingFee: number(info.estimatedShippingFee),
      actualShippingCost: number(info.actualShippingCost),
      commissionFee: number(info.commissionFee),
      escrowAmount: number(info.escrowAmount),
      discountAmount: number(info.discountAmount),
      exchangeRate: number(info.exchangeRate),
      paymentMethod: text(info.paymentMethod),
      platformOrderStatus: text(info.platformOrderStatus),
      appOrderStatus: text(info.appOrderStatus),
      appOrderStatusText: text(info.appOrderStatusText),
      orderStartedAt: dateTime(info.gmtOrderStart),
      orderModifiedAt: dateTime(info.gmtOrderModified),
      paidAt: dateTime(info.gmtPay),
      deliveredAt: dateTime(info.gmtDelivery),
      refundedAt: dateTime(info.gmtRefund),
      settledAt: dateTime(info.gmtSettlement),
      finishedAt: dateTime(info.gmtFinish),
    };
    orders.set(identity, Object.fromEntries(Object.keys(candidate).map((key) => [key, mergeMeaningful(previous[key], candidate[key])])));

    const sourceItems = [
      ...(Array.isArray(packageRow.items) ? packageRow.items.map((item) => ({ item, gift: false })) : []),
      ...(Array.isArray(packageRow.giftItems) ? packageRow.giftItems.map((item) => ({ item, gift: true })) : []),
    ];
    sourceItems.forEach(({ item, gift }, index) => {
      if (!item || typeof item !== "object") return;
      const sku = text(item.platformOuterSkuId || item.sellerSku || item.sku || item.productSku || item.platformSkuId);
      const stableId = text(item.opOrderPackageItemId || item.opOrderPackageGiftId || item.id || item.opOrderItemId || item.orderItemId)
        || `${normalizedSku(sku)}|${index}|${gift ? "gift" : "sale"}`;
      const itemIdentity = `${identity}|${stableId}`;
      const previousItem = items.get(itemIdentity) || {};
      const quantity = Math.max(0, number(item.quantity ?? item.qty));
      const normalized = {
        identity: itemIdentity,
        orderIdentity: identity,
        opOrderItemId: text(item.opOrderItemId || item.orderItemId),
        opOrderPackageItemId: text(item.opOrderPackageItemId || item.id),
        platformSkuId: text(item.platformSkuId),
        platformOuterSkuId: sku,
        quantity,
        originalPrice: number(item.originalPrice),
        discountedPrice: number(item.discountedPrice),
        gift,
      };
      // A package item is the physical fulfillment unit. Distinct package-item
      // IDs are summed later (real split fulfillment), while the same package
      // item repeated by pagination/retry keeps its largest observed quantity.
      normalized.quantity = Math.max(quantity, number(previousItem.quantity));
      items.set(itemIdentity, { ...previousItem, ...normalized });
    });
  }
  return { orders: [...orders.values()], items: [...items.values()], packageCount, sourceRowCount: sourceRows.length };
}

function afterSalesRows(payload, keys) {
  const rows = arraysAtKnownKeys(payload?.data ?? payload, keys);
  if (rows.length) return rows;
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data : [];
}

export function miaoshouAfterSalesRowCount(payload, kind) {
  const keys = kind === "return"
    ? ["orderReturnList", "returnList", "orderReturns"]
    : ["orderCancelList", "cancelList", "orderCancellations"];
  return afterSalesRows(payload, keys).length;
}

// 售后状态分三类：明确的「处理中」、明确的「驳回/撤销」、明确的「已完成」。
// 只有已完成才算终态；仅仅包含 refund / cancel 字样（如 REFUND_REQUESTED、IN_CANCEL）不算。
const PENDING_STATUS = /(request|pending|process|applying|apply|waiting|wait[_\s-]|review|judg|dispute|negotiat|arbitrat|in[_\s-]?(?:cancel|refund|return|progress)|refunding|cancell?ing|returning|to[_\s-]?be|unpaid|待|申请|处理中|审核|进行中|协商|仲裁|争议|退款中|取消中)/i;
const REJECTED_STATUS = /(reject|denied|deny|fail|withdraw|revok|abort|close[_\s-]*no|驳回|拒绝|撤销|撤回|失败|关闭|未通过)/i;
const REFUND_DONE_STATUS = /(refunded|refund[_\s-]*(?:success|succeeded|paid|completed?|done|finish(?:ed)?)|^(?:success|succeeded|completed?|done|finished|paid)$|退款成功|已退款|退款完成|已完成|已打款)/i;
const CANCEL_DONE_STATUS = /(cancell?ed|cancel[_\s-]*(?:success|succeeded|completed?|done|finish(?:ed)?)|^(?:success|succeeded|completed?|done|finished)$|取消成功|已取消|取消完成|已完成)/i;

function statusTokens(values) {
  return values.map(text).filter(Boolean);
}

export function classifyMiaoshouAfterSalesStatus(kind, row = {}) {
  const statuses = kind === "return"
    ? statusTokens([row.appReturnStatus, row.appReturnStatusText, row.platformReturnStatus, row.status])
    : statusTokens([row.appCancelStatus, row.appCancelStatusText, row.platformCancelStatus, row.appReturnStatusText, row.reverseTypeText, row.status]);
  const finishedAt = kind === "return"
    ? text(row.gmtFinish || row.gmtRefundFinish || row.gmtCompleted)
    : text(row.gmtFinish || row.gmtCancel || row.gmtCompleted);
  if (statuses.some((value) => REJECTED_STATUS.test(value))) return "rejected";
  const done = kind === "return" ? REFUND_DONE_STATUS : CANCEL_DONE_STATUS;
  if (statuses.some((value) => done.test(value))) return "finalized";
  if (statuses.some((value) => PENDING_STATUS.test(value))) return "pending";
  // 状态字段缺失或无法识别时，只有明确的完成时间才视为终态。
  return finishedAt ? "finalized" : statuses.length ? "unknown" : "pending";
}

function finalizedRefund(row) {
  return classifyMiaoshouAfterSalesStatus("return", row) === "finalized";
}

export function normalizeMiaoshouReturns(payload) {
  return afterSalesRows(payload, ["orderReturnList", "returnList", "orderReturns"]).map((row, index) => {
    const info = row.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : row;
    const fallbackOrderIdentity = orderKey({
      platform: row.platform ?? info.platform,
      shopId: row.shopId ?? info.shopId,
      platformOrderSn: row.platformOrderSn ?? info.platformOrderSn,
    });
    // 没有退款单号时，用订单 + 创建时间 + 金额生成稳定标识；不能用序号，否则分页、分店铺的记录会互相覆盖。
    const identity = text(row.opOrderReturnId || row.platformReturnSn || row.returnId)
      || (fallbackOrderIdentity
        ? `${fallbackOrderIdentity}|return|${text(row.gmtCreateTime || row.gmtCreate) || "na"}|${Math.max(0, number(row.refundAmount))}`
        : `return-unidentified-${index}`);
    const normalized = {
      identity,
      orderIdentity: orderKey({
        platform: row.platform ?? info.platform,
        shopId: row.shopId ?? info.shopId,
        platformOrderSn: row.platformOrderSn ?? info.platformOrderSn,
      }),
      opOrderId: text(row.opOrderId ?? info.opOrderId),
      platform: text(row.platform ?? info.platform),
      shopId: text(row.shopId ?? info.shopId),
      platformOrderSn: text(row.platformOrderSn ?? info.platformOrderSn),
      platformReturnSn: text(row.platformReturnSn),
      currency: text(row.currency ?? info.currency).toUpperCase(),
      refundAmount: Math.max(0, number(row.refundAmount)),
      status: text(row.status),
      platformReturnStatus: text(row.platformReturnStatus),
      appReturnStatus: text(row.appReturnStatus),
      appReturnStatusText: text(row.appReturnStatusText),
      reverseType: text(row.reverseType),
      createdAt: dateTime(row.gmtCreateTime || row.gmtCreate),
      modifiedAt: dateTime(row.gmtModifiedTime || row.gmtModified),
      finishedAt: dateTime(row.gmtFinish || row.gmtRefund || row.gmtCompleted),
      statusClass: classifyMiaoshouAfterSalesStatus("return", row),
      finalized: false,
    };
    normalized.finalized = normalized.statusClass === "finalized";
    return normalized;
  }).filter((row) => row.orderIdentity && row.identity);
}

export function normalizeMiaoshouCancellations(payload) {
  return afterSalesRows(payload, ["orderCancelList", "cancelList", "orderCancellations"]).map((row, index) => {
    const info = row.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : row;
    const orderIdentity = orderKey({
      platform: row.platform ?? info.platform,
      shopId: row.shopId ?? info.shopId,
      platformOrderSn: row.platformOrderSn ?? info.platformOrderSn,
    });
    // Miaoshou's cancellation-list response does not expose a cancellation ID.
    // Use the stable platform/shop/order identity so rows from different shops or
    // date chunks cannot overwrite one another as `cancel-0`, `cancel-1`, etc.
    const identity = text(row.opOrderCancelId || row.platformCancelSn || row.cancelId)
      || (orderIdentity ? `${orderIdentity}|cancel` : `cancel-${index}`);
    return {
      identity,
      orderIdentity,
      opOrderId: text(row.opOrderId ?? info.opOrderId),
      platform: text(row.platform ?? info.platform),
      shopId: text(row.shopId ?? info.shopId),
      platformOrderSn: text(row.platformOrderSn ?? info.platformOrderSn),
      status: text(row.status),
      appCancelStatus: text(row.appCancelStatus),
      appCancelStatusText: text(row.appCancelStatusText || row.appReturnStatusText),
      reason: text(row.cancelReason || row.reason || row.textReasonCn || row.textReason),
      createdAt: dateTime(row.gmtCreateTime || row.gmtCreate),
      modifiedAt: dateTime(row.gmtModifiedTime || row.gmtModified),
      statusClass: classifyMiaoshouAfterSalesStatus("cancellation", row),
      finalized: classifyMiaoshouAfterSalesStatus("cancellation", row) === "finalized",
    };
  }).filter((row) => row.orderIdentity && row.identity);
}

// 金额口径（默认 payAmount，与历史行为一致）：
// - payAmount     买家实付（含运费、扣除平台券）
// - orderAmount   订单金额
// - productAmount 商品金额（接近平台后台「销售额」）
// - escrowAmount  平台结算到账
// 对账结果会同时给出每种口径与 WMS 金额的差异率，管理员据此选择与平台后台一致的口径。
export const MIAOSHOU_REVENUE_BASES = Object.freeze(["payAmount", "orderAmount", "productAmount", "escrowAmount"]);

export function normalizeMiaoshouRevenueBasis(value) {
  return MIAOSHOU_REVENUE_BASES.includes(text(value)) ? text(value) : "payAmount";
}

function transactionAmount(order, basis = "payAmount") {
  const preferred = number(order?.[normalizeMiaoshouRevenueBasis(basis)]);
  if (preferred > 0) return preferred;
  return Math.max(0, number(order.payAmount || order.orderAmount || order.productAmount));
}

function lineWeights(group, orderItems) {
  const itemValueBySku = new Map();
  for (const item of orderItems) {
    const sku = normalizedSku(item.platformOuterSkuId || item.platformSkuId);
    if (!sku) continue;
    const value = Math.max(0, number(item.discountedPrice || item.originalPrice)) * Math.max(0, number(item.quantity));
    const weight = value > 0 ? value : Math.max(0, number(item.quantity));
    itemValueBySku.set(sku, (itemValueBySku.get(sku) || 0) + weight);
  }
  const wmsQtyBySku = new Map();
  for (const fact of group) {
    const sku = normalizedSku(fact.sku);
    wmsQtyBySku.set(sku, (wmsQtyBySku.get(sku) || 0) + Math.max(0, number(fact.quantity)));
  }
  const weights = group.map((fact) => {
    const sku = normalizedSku(fact.sku);
    const skuValue = itemValueBySku.get(sku) || 0;
    const skuQty = wmsQtyBySku.get(sku) || 0;
    return skuValue > 0 && skuQty > 0
      ? skuValue * Math.max(0, number(fact.quantity)) / skuQty
      : Math.max(0, number(fact.quantity));
  });
  if (weights.some((value) => value > 0)) return weights;
  return group.map(() => 1);
}

function allocate(total, weights) {
  const safeTotal = Math.max(0, number(total));
  const denominator = weights.reduce((sum, value) => sum + Math.max(0, number(value)), 0);
  let allocated = 0;
  return weights.map((weight, index) => {
    const value = index === weights.length - 1
      ? round(safeTotal - allocated)
      : round(safeTotal * (denominator > 0 ? Math.max(0, number(weight)) / denominator : 1 / weights.length));
    allocated = round(allocated + value);
    return value;
  });
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 6) : 0;
}

function statusDictionary(rows, kind) {
  const counts = new Map();
  for (const row of rows) {
    const label = [row.appReturnStatus || row.appCancelStatus, row.appReturnStatusText || row.appCancelStatusText, row.platformReturnStatus, row.status]
      .map(text).filter(Boolean).join(" / ") || "（无状态）";
    const key = `${label}\u0000${row.statusClass || (row.finalized ? "finalized" : "pending")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [status, statusClass] = key.split("\u0000");
      return { kind, status, statusClass, count };
    })
    .sort((left, right) => right.count - left.count)
    .slice(0, 40);
}

export function reconcileMiaoshouPerformance({ facts = [], orders = [], items = [], returns = [], cancellations = [], requestedSource = "shadow", syncState = {}, revenueBasis = "payAmount" } = {}) {
  const basis = normalizeMiaoshouRevenueBasis(revenueBasis);
  const orderByKey = new Map(orders.map((order) => [order.identity || orderKey(order), order]).filter(([key]) => key));
  const itemsByOrder = new Map();
  for (const item of items) {
    const list = itemsByOrder.get(item.orderIdentity) || [];
    list.push(item);
    itemsByOrder.set(item.orderIdentity, list);
  }
  const returnsByOrder = new Map();
  for (const row of returns) {
    const list = returnsByOrder.get(row.orderIdentity) || [];
    list.push(row);
    returnsByOrder.set(row.orderIdentity, list);
  }
  const cancelledOrders = new Set(cancellations.filter((row) => row.finalized).map((row) => row.orderIdentity));
  const groups = new Map();
  const output = facts.map((fact) => ({ ...fact }));
  output.forEach((fact, index) => {
    const identity = orderKey({ platform: fact.platform, shopId: fact.miaoshouShopId, orderNo: fact.orderNo });
    if (!identity) return;
    const group = groups.get(identity) || [];
    group.push({ fact, index });
    groups.set(identity, group);
  });

  let eligibleOrderCount = 0;
  let matchedOrderCount = 0;
  let matchedLineCount = 0;
  let wmsQuantity = 0;
  let miaoshouQuantity = 0;
  let comparableAmountOrders = 0;
  let amountDelta = 0;
  let miaoshouComparableAmount = 0;
  let finalizedRefundCount = 0;
  let totalRefundCount = 0;
  let cancelledOutboundOrders = 0;
  const basisComparison = new Map();

  for (const [identity, entries] of groups) {
    eligibleOrderCount += 1;
    const order = orderByKey.get(identity);
    if (!order) continue;
    matchedOrderCount += 1;
    matchedLineCount += entries.length;
    const groupFacts = entries.map(({ fact }) => fact);
    const orderItems = itemsByOrder.get(identity) || [];
    const wmsQty = groupFacts.reduce((sum, fact) => sum + Math.max(0, number(fact.quantity)), 0);
    const msQty = orderItems.reduce((sum, item) => sum + Math.max(0, number(item.quantity)), 0);
    wmsQuantity += wmsQty;
    miaoshouQuantity += msQty;
    const orderReturns = returnsByOrder.get(identity) || [];
    totalRefundCount += orderReturns.length;
    finalizedRefundCount += orderReturns.filter((row) => row.finalized).length;
    const currency = text(order.currency).toUpperCase();
    const grossAmount = transactionAmount(order, basis);
    const comparisonAmount = grossAmount;
    const refundAmount = Math.min(grossAmount, orderReturns
      .filter((row) => row.finalized && (!row.currency || row.currency === currency))
      .reduce((sum, row) => sum + Math.max(0, number(row.refundAmount)), 0));
    const cancelled = cancelledOrders.has(identity);
    if (cancelled) cancelledOutboundOrders += 1;
    const netAmount = cancelled ? 0 : Math.max(0, round(grossAmount - refundAmount));
    const weights = lineWeights(groupFacts, orderItems);
    const grossAllocations = allocate(grossAmount, weights);
    const refundAllocations = allocate(refundAmount, weights);
    const netAllocations = allocate(netAmount, weights);
    const commissionAllocations = allocate(order.commissionFee, weights);
    const logisticsAllocations = allocate(order.actualShippingCost || order.estimatedShippingFee, weights);
    const wmsAmount = groupFacts.every((fact) => fact.salesAmountValid && text(fact.currency).toUpperCase() === currency)
      ? groupFacts.reduce((sum, fact) => sum + Math.max(0, number(fact.salesAmount)), 0)
      : 0;
    if (comparisonAmount > 0 && wmsAmount > 0) {
      comparableAmountOrders += 1;
      // WMS exposes the order amount captured at fulfillment time; refunds are
      // a separate after-sales fact. Compare gross-to-gross here, otherwise any
      // legitimate refund would incorrectly fail the source activation gate.
      amountDelta += Math.abs(comparisonAmount - wmsAmount);
      miaoshouComparableAmount += comparisonAmount;
    }
    if (wmsAmount > 0) {
      for (const candidate of MIAOSHOU_REVENUE_BASES) {
        const value = number(order[candidate]);
        if (value <= 0) continue;
        const current = basisComparison.get(candidate) || { orders: 0, delta: 0, amount: 0 };
        current.orders += 1;
        current.delta += Math.abs(value - wmsAmount);
        current.amount += value;
        basisComparison.set(candidate, current);
      }
    }
    const settlementAllocations = allocate(order.escrowAmount, weights);
    entries.forEach(({ index }, lineIndex) => {
      output[index] = {
        ...output[index],
        transactionMatchStatus: "matched",
        miaoshouOrderIdentity: identity,
        miaoshouGrossAmount: grossAllocations[lineIndex],
        miaoshouRefundAmount: refundAllocations[lineIndex],
        miaoshouNetAmount: netAllocations[lineIndex],
        miaoshouCommissionAmount: commissionAllocations[lineIndex],
        miaoshouLogisticsAmount: logisticsAllocations[lineIndex],
        miaoshouSettlementAmount: settlementAllocations[lineIndex],
        miaoshouCurrency: currency,
        miaoshouCancelled: cancelled,
      };
    });
  }

  const orderMatchRate = ratio(matchedOrderCount, eligibleOrderCount);
  const quantityVarianceRate = ratio(Math.abs(wmsQuantity - miaoshouQuantity), Math.max(wmsQuantity, miaoshouQuantity));
  const amountVarianceRate = ratio(amountDelta, miaoshouComparableAmount);
  const refundFinalizationRate = totalRefundCount ? ratio(finalizedRefundCount, totalRefundCount) : 1;
  // 订单部分同步成功即视为健康；售后缺口单独作为阻断项，补齐后自动解除。
  const syncHealthy = ["success", "partial"].includes(text(syncState.status)) && Boolean(syncState.lastSuccessAt) && !text(syncState.lastError);
  const afterSalesGaps = Array.isArray(syncState.afterSalesGaps) ? syncState.afterSalesGaps : [];
  const thresholds = { orderMatchRate: 0.98, quantityVarianceRate: 0.005, amountVarianceRate: 0.01, refundFinalizationRate: 0.99 };
  const blockers = [];
  if (!syncHealthy) blockers.push("妙手交易同步尚未完整成功");
  if (afterSalesGaps.length) blockers.push(`妙手售后同步还有 ${afterSalesGaps.length} 个时间段待补齐`);
  if (orderMatchRate < thresholds.orderMatchRate) blockers.push(`订单匹配率 ${round(orderMatchRate * 100, 2)}% 低于 98%`);
  if (quantityVarianceRate > thresholds.quantityVarianceRate) blockers.push(`数量差异率 ${round(quantityVarianceRate * 100, 2)}% 高于 0.5%`);
  if (comparableAmountOrders > 0 && amountVarianceRate > thresholds.amountVarianceRate) blockers.push(`金额差异率 ${round(amountVarianceRate * 100, 2)}% 高于 1%`);
  if (refundFinalizationRate < thresholds.refundFinalizationRate) blockers.push(`退款终态识别率 ${round(refundFinalizationRate * 100, 2)}% 低于 99%`);
  if (cancelledOutboundOrders > 0) blockers.push(`发现 ${cancelledOutboundOrders} 个已取消但 WMS 已出库订单`);
  const activationEligible = blockers.length === 0 && matchedOrderCount > 0;
  const effectiveSource = requestedSource === "miaoshou" && activationEligible ? "miaoshou" : "wms";

  if (effectiveSource === "miaoshou") {
    output.forEach((fact, index) => {
      if (fact.transactionMatchStatus !== "matched") return;
      output[index] = {
        ...fact,
        salesAmount: fact.miaoshouNetAmount,
        currency: fact.miaoshouCurrency,
        salesAmountValid: !fact.miaoshouCancelled && fact.miaoshouNetAmount > 0,
        salesAmountScope: "miaoshou_order_allocated",
        salesAmountSource: `miaoshou.${basis}-refundAmount`,
      };
    });
  }

  return {
    facts: output,
    reconciliation: {
      requestedSource,
      effectiveSource,
      activationEligible,
      blockers,
      thresholds,
      eligibleOrderCount,
      matchedOrderCount,
      unmatchedOrderCount: Math.max(0, eligibleOrderCount - matchedOrderCount),
      matchedLineCount,
      orderMatchRate,
      wmsQuantity: round(wmsQuantity, 4),
      miaoshouQuantity: round(miaoshouQuantity, 4),
      quantityVarianceRate,
      comparableAmountOrders,
      amountVarianceRate,
      refundCount: totalRefundCount,
      finalizedRefundCount,
      refundFinalizationRate,
      cancelledOutboundOrders,
      revenueBasis: basis,
      // 每种金额口径与 WMS 订单金额的差异率，越接近 0 说明该口径与 WMS 一致。
      basisComparison: MIAOSHOU_REVENUE_BASES.map((candidate) => {
        const row = basisComparison.get(candidate) || { orders: 0, delta: 0, amount: 0 };
        return { basis: candidate, comparableOrders: row.orders, amountVarianceRate: ratio(row.delta, row.amount) };
      }),
      pendingRefundCount: returns.filter((row) => (row.statusClass || "") === "pending").length,
      pendingCancellationCount: cancellations.filter((row) => (row.statusClass || "") === "pending").length,
      afterSalesGapCount: afterSalesGaps.length,
      statusDictionary: [...statusDictionary(returns, "return"), ...statusDictionary(cancellations, "cancellation")],
    },
  };
}

export { orderKey as miaoshouOrderKey, normalizedSku as normalizedMiaoshouSku };

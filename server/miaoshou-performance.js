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

function dateTime(value) {
  const raw = text(value);
  if (!raw) return "";
  const parsed = Date.parse(raw.replace(" ", "T"));
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

function finalizedRefund(row) {
  const status = [row.appReturnStatus, row.appReturnStatusText, row.platformReturnStatus, row.status]
    .map(text).join(" ").toLowerCase();
  if (/reject|cancel|close[_\s-]*no|failed|驳回|拒绝|取消/.test(status)) return false;
  if (text(row.gmtFinish || row.gmtRefund || row.gmtCompleted)) return true;
  return /refund(ed)?|success|complete|completed|done|退款成功|已退款|已完成/.test(status);
}

export function normalizeMiaoshouReturns(payload) {
  return afterSalesRows(payload, ["orderReturnList", "returnList", "orderReturns"]).map((row, index) => {
    const info = row.orderInfo && typeof row.orderInfo === "object" ? row.orderInfo : row;
    const identity = text(row.opOrderReturnId || row.platformReturnSn || row.returnId) || `return-${index}`;
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
      finalized: false,
    };
    normalized.finalized = finalizedRefund(row);
    return normalized;
  }).filter((row) => row.orderIdentity && row.identity);
}

function finalizedCancellation(row) {
  const status = [
    row.appCancelStatus,
    row.appCancelStatusText,
    row.platformCancelStatus,
    row.appReturnStatusText,
    row.appOrderStatus,
    row.reverseTypeText,
    row.status,
  ]
    .map(text).join(" ").toLowerCase();
  if (/reject|failed|驳回|拒绝/.test(status)) return false;
  if (text(row.gmtFinish || row.gmtCancel || row.gmtCompleted)) return true;
  return /cancel(l?ed)?|success|complete|completed|done|取消成功|已取消|已完成/.test(status);
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
      finalized: finalizedCancellation(row),
    };
  }).filter((row) => row.orderIdentity && row.identity);
}

function transactionAmount(order) {
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

export function reconcileMiaoshouPerformance({ facts = [], orders = [], items = [], returns = [], cancellations = [], requestedSource = "shadow", syncState = {} } = {}) {
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
    const grossAmount = transactionAmount(order);
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
    if (grossAmount > 0 && wmsAmount > 0) {
      comparableAmountOrders += 1;
      // WMS exposes the order amount captured at fulfillment time; refunds are
      // a separate after-sales fact. Compare gross-to-gross here, otherwise any
      // legitimate refund would incorrectly fail the source activation gate.
      amountDelta += Math.abs(grossAmount - wmsAmount);
      miaoshouComparableAmount += grossAmount;
    }
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
        miaoshouCurrency: currency,
        miaoshouCancelled: cancelled,
      };
    });
  }

  const orderMatchRate = ratio(matchedOrderCount, eligibleOrderCount);
  const quantityVarianceRate = ratio(Math.abs(wmsQuantity - miaoshouQuantity), Math.max(wmsQuantity, miaoshouQuantity));
  const amountVarianceRate = ratio(amountDelta, miaoshouComparableAmount);
  const refundFinalizationRate = totalRefundCount ? ratio(finalizedRefundCount, totalRefundCount) : 1;
  const syncHealthy = syncState.status === "success" && Boolean(syncState.lastSuccessAt);
  const thresholds = { orderMatchRate: 0.98, quantityVarianceRate: 0.005, amountVarianceRate: 0.01, refundFinalizationRate: 0.99 };
  const blockers = [];
  if (!syncHealthy) blockers.push("妙手交易同步尚未完整成功");
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
        salesAmountSource: "miaoshou.payAmount-refundAmount",
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
    },
  };
}

export { orderKey as miaoshouOrderKey, normalizedSku as normalizedMiaoshouSku };

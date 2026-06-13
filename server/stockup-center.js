function firstNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function shouldRecommend(item) {
  return firstNumber(item.replenishQty) > 0 || ["缺货", "补货预警"].includes(item.status);
}

function normalizeSkuKey(value) {
  return String(value || "").trim().toLowerCase();
}

function buildProductBaseBySku(productPayload = {}) {
  const bySku = new Map();
  for (const product of productPayload.productBase || []) {
    for (const key of [product.sku, product.skuNo].map(normalizeSkuKey).filter(Boolean)) {
      if (!bySku.has(key)) bySku.set(key, product);
    }
  }
  return bySku;
}

function buildOutsourcingBySku(payload = {}) {
  const bySku = new Map();
  for (const order of payload.orders || []) {
    const key = normalizeSkuKey(order.tongzhouSku);
    if (!key) continue;
    const quantity = firstNumber(order.inProductionQty);
    if (quantity <= 0) continue;
    const current = bySku.get(key) || { qty: 0, orders: [] };
    current.qty += quantity;
    current.orders.push(order);
    bySku.set(key, current);
  }
  return bySku;
}

function newestOrder(orders) {
  return [...orders].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || {};
}

function buildOutsourcingQueue(outsourcingBySku, recommendationKeys, productBaseBySku) {
  return [...outsourcingBySku.entries()]
    .map(([key, match]) => {
      const firstOrder = newestOrder(match.orders);
      const base = productBaseBySku.get(normalizeSkuKey(firstOrder.tongzhouSku || key));
      const inRecommendation = recommendationKeys.has(key);
      const remarks = match.orders.map((order) => firstText(order.remark)).filter(Boolean);
      return {
        id: key,
        sku: firstText(firstOrder.tongzhouSku, key),
        name: firstText(base?.name, firstOrder.productName, firstOrder.tongzhouSku, key),
        unit: firstText(base?.unit, firstOrder.unit, "件"),
        imageUrl: firstText(base?.imageUrl),
        createdAt: firstText(firstOrder.createdAt),
        remark: remarks[0] || "",
        remarks,
        inProductionQty: match.qty,
        orderCount: match.orders.length,
        inRecommendation,
        note: inRecommendation ? "已在备货建议中，净建议数量已扣减委外在产。" : "不在当前备货建议中，但已经有委外加工单在排产。",
        orders: match.orders,
      };
    })
    .filter((item) => item.inProductionQty > 0)
    .sort((a, b) => {
      if (a.inRecommendation !== b.inRecommendation) return a.inRecommendation ? -1 : 1;
      return b.inProductionQty - a.inProductionQty;
    });
}

export function buildStockupPayload(movementPayload, stockupSync = {}, outsourcingPayload = {}, productPayload = {}) {
  const outsourcingBySku = buildOutsourcingBySku(outsourcingPayload);
  const productBaseBySku = buildProductBaseBySku(productPayload);
  const recommendations = (movementPayload.items || [])
    .filter(shouldRecommend)
    .map((item) => {
      const skuKeys = [item.sku, item.countrySku, item.id].map(normalizeSkuKey).filter(Boolean);
      const outsourcingMatches = skuKeys.map((key) => outsourcingBySku.get(key)).filter(Boolean);
      const outsourcingInProductionQty = outsourcingMatches.reduce((sum, match) => sum + match.qty, 0);
      const outsourcingOrders = outsourcingMatches.flatMap((match) => match.orders);
      const replenishQty = firstNumber(item.replenishQty);
      return {
        id: item.id,
        sku: item.sku,
        countrySku: item.countrySku || "",
        name: item.name,
        country: item.country,
        unit: item.unit,
        imageUrl: item.imageUrl || "",
        status: item.status,
        availableQty: firstNumber(item.availableQty),
        inTransitQty: firstNumber(item.inTransitQty),
        sales7: firstNumber(item.sales7),
        sales30: firstNumber(item.sales30),
        sales90: firstNumber(item.sales90),
        avgDaily7: firstNumber(item.avgDaily7),
        avgDaily30: firstNumber(item.avgDaily30),
        avgDaily90: firstNumber(item.avgDaily90),
        daysCover: item.daysCover,
        leadDays: firstNumber(item.leadDays),
        targetCoverDays: firstNumber(item.targetCoverDays),
        replenishQty,
        outsourcingInProductionQty,
        netReplenishQty: Math.max(0, replenishQty - outsourcingInProductionQty),
        outsourcingOrders,
        suggestion: item.suggestion || "",
        warehouseBreakdown: Array.isArray(item.warehouseBreakdown) ? item.warehouseBreakdown : [],
      };
    })
    .sort((a, b) => {
      const statusRank = { 缺货: 0, 补货预警: 1 };
      const aRank = statusRank[a.status] ?? 2;
      const bRank = statusRank[b.status] ?? 2;
      if (aRank !== bRank) return aRank - bRank;
      return b.replenishQty - a.replenishQty;
    });

  const recommendationKeys = new Set();
  for (const item of recommendations) {
    [item.sku, item.countrySku, item.id].map(normalizeSkuKey).filter(Boolean).forEach((key) => recommendationKeys.add(key));
  }
  const outsourcingQueue = buildOutsourcingQueue(outsourcingBySku, recommendationKeys, productBaseBySku);

  const inboundOrders = Array.isArray(stockupSync.orders) ? stockupSync.orders : [];
  const results = Array.isArray(stockupSync.results) ? stockupSync.results : [];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    movementGeneratedAt: movementPayload.generatedAt || "",
    stockupSyncedAt: stockupSync.syncedAt || "",
    counts: {
      recommendations: recommendations.length,
      recommendedQty: recommendations.reduce((sum, item) => sum + item.replenishQty, 0),
      outsourcingOrders: outsourcingPayload.counts?.orders || 0,
      outsourcingInProductionQty: outsourcingQueue.reduce((sum, item) => sum + item.inProductionQty, 0),
      outsourcingInRecommendationQty: recommendations.reduce((sum, item) => sum + item.outsourcingInProductionQty, 0),
      outsourcingOutsideRecommendationQty: outsourcingQueue.filter((item) => !item.inRecommendation).reduce((sum, item) => sum + item.inProductionQty, 0),
      outsourcingActiveSku: outsourcingQueue.length,
      netRecommendedQty: recommendations.reduce((sum, item) => sum + item.netReplenishQty, 0),
      inboundOrders: inboundOrders.length,
      pendingInboundQty: inboundOrders.reduce((sum, order) => sum + firstNumber(order.quantity), 0),
    },
    recommendations,
    outsourcingQueue,
    outsourcingSyncedAt: outsourcingPayload.syncedAt || "",
    inboundOrders,
    syncResults: results,
  };
}

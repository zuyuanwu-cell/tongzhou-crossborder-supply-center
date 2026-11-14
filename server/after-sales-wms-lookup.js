function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedOrderNumber(value) {
  return text(value).toUpperCase();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function connectionMatchesScope(connection, warehouseIds) {
  if (!warehouseIds.length) return true;
  const aliases = unique([connection?.id, connection?.warehouseId, connection?.resolvedWarehouseId]);
  return aliases.some((alias) => warehouseIds.includes(alias));
}

function rowBelongsToConnection(row, connection) {
  const warehouseId = text(row?.warehouseId);
  if (!warehouseId) return false;
  return unique([connection?.id, connection?.warehouseId, connection?.resolvedWarehouseId]).includes(warehouseId);
}

function cachedRowMatches(row, orderNumber) {
  const expected = normalizedOrderNumber(orderNumber);
  return [row?.orderNo, row?.orderId, row?.externalOrderNo]
    .some((candidate) => normalizedOrderNumber(candidate) === expected);
}

function aggregateItems(rows = []) {
  const items = new Map();
  for (const row of rows) {
    const sku = text(row?.sku).toUpperCase();
    const quantity = Math.max(0, Number(row?.quantity) || 0);
    if (!sku || quantity <= 0) continue;
    const current = items.get(sku) || { sku, orderedQty: 0, productName: "" };
    current.orderedQty += quantity;
    current.productName ||= text(row?.productName);
    items.set(sku, current);
  }
  return [...items.values()];
}

function publicOrderFromCached(orderNumber, connection, rows) {
  const first = rows[0] || {};
  return {
    orderNumber,
    orderIdentity: `wms:${text(connection?.id)}:${text(first.orderId || first.orderNo || orderNumber)}`,
    platform: text(first.platform) || "WMS",
    site: text(connection?.country || first.country),
    shopId: text(first.shopCode || first.shopName),
    shopAlias: text(first.shopName || first.shopCode) || "WMS 店铺",
    platformShopName: text(first.shopName),
    orderStartedAt: text(first.createdAt || first.shippedAt),
    warehouseId: text(connection?.id),
    warehouseName: text(connection?.name || first.warehouseName || connection?.id),
    customer: {},
    rawItems: aggregateItems(rows),
  };
}

function publicOrderFromLive(orderNumber, connection, result) {
  return {
    orderNumber,
    orderIdentity: `wms:${text(connection?.id)}:${text(result?.orderNo || orderNumber)}`,
    platform: text(result?.platform) || "WMS",
    site: text(connection?.country),
    shopId: text(result?.platformShop),
    shopAlias: text(result?.platformShop) || "WMS 店铺",
    platformShopName: text(result?.platformShop),
    orderStartedAt: text(result?.createdAt || result?.shippedAt || result?.releasedAt),
    warehouseId: text(connection?.id),
    warehouseName: text(connection?.name || connection?.id),
    customer: {},
    rawItems: (Array.isArray(result?.items) ? result.items : []).map((item) => ({
      sku: text(item?.sku).toUpperCase(),
      orderedQty: Math.max(0, Number(item?.quantity) || 0),
      productName: "",
    })).filter((item) => item.sku && item.orderedQty > 0),
  };
}

function ambiguousWarehouseError(matches) {
  const names = unique(matches.map((match) => match.connection?.name || match.connection?.id));
  return new Error(`该订单号同时命中多个授权仓库（${names.join("、")}），为避免串单已停止同步，请先缩小账号仓库范围。`);
}

/**
 * Exact, scope-bound WMS fallback for after-sales order registration.
 * It never performs a broad order search and never queries warehouses outside
 * the authenticated user's warehouseIds.
 */
export async function lookupAfterSalesWmsOrder({
  orderNumber,
  dataScopes = {},
  connections = [],
  cachedOrders = [],
  findOutboundOrder,
  prepareConnection = (connection) => connection,
}) {
  const normalized = text(orderNumber);
  const warehouseIds = unique(dataScopes?.warehouseIds);
  const allowedConnections = (Array.isArray(connections) ? connections : [])
    .filter((connection) => text(connection?.providerId) === "yunwms_ru")
    .filter((connection) => connectionMatchesScope(connection, warehouseIds));
  if (!allowedConnections.length) {
    return { found: false, source: "", warning: "当前账号没有已授权的俄罗斯 YunWMS 仓库。" };
  }

  const cachedMatches = allowedConnections.map((connection) => ({
    connection,
    rows: (Array.isArray(cachedOrders) ? cachedOrders : []).filter((row) => (
      rowBelongsToConnection(row, connection)
      && cachedRowMatches(row, normalized)
    )),
  })).filter((match) => match.rows.length);
  if (cachedMatches.length > 1) throw ambiguousWarehouseError(cachedMatches);
  if (cachedMatches.length === 1) {
    const match = cachedMatches[0];
    const order = publicOrderFromCached(normalized, match.connection, match.rows);
    if (order.rawItems.length) return { found: true, source: "warehouse_wms_cache", warning: "", order };
  }

  if (typeof findOutboundOrder !== "function") {
    return { found: false, source: "", warning: "俄罗斯 YunWMS 实时查单服务未启用。" };
  }
  const settled = await Promise.all(allowedConnections.map(async (connection) => {
    try {
      const result = await findOutboundOrder(prepareConnection(connection), normalized);
      return { connection, result, error: "" };
    } catch (error) {
      return { connection, result: null, error: text(error?.message) || "WMS 查询失败" };
    }
  }));
  const liveMatches = settled.filter((entry) => entry.result?.found);
  if (liveMatches.length > 1) throw ambiguousWarehouseError(liveMatches);
  if (liveMatches.length === 1) {
    const match = liveMatches[0];
    const order = publicOrderFromLive(normalized, match.connection, match.result);
    if (!order.rawItems.length) {
      throw new Error(`${order.warehouseName}已找到订单，但 WMS 未返回商品明细，请检查订单状态后重试。`);
    }
    return { found: true, source: "warehouse_wms_live", warning: "", order };
  }
  const errors = unique(settled.map((entry) => entry.error));
  return {
    found: false,
    source: "",
    warning: errors.length ? `俄罗斯 YunWMS 查询失败：${errors.join("；")}` : "授权仓 WMS 未查询到该订单号。",
  };
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function orderDateKey(order) {
  return String(order?.shippedAt || order?.createdAt || order?.orderedAt || "").slice(0, 10);
}

function orderIdentity(order) {
  return [
    order?.providerId || order?.rawProvider,
    order?.warehouseId,
    order?.orderId || order?.orderNo,
    order?.lineId || order?.goodsSkuId || `${order?.sku || ""}|${order?.shippedAt || order?.createdAt || ""}|${order?.quantity ?? ""}`,
  ].map((value) => String(value ?? "").trim()).join("|");
}

function deduplicateOrders(orders) {
  const unique = new Map();
  for (const order of rows(orders)) unique.set(orderIdentity(order), order);
  return [...unique.values()];
}

export function mergeWarehouseOrderWindow(cachedWarehouseOrders = [], incomingOrders = [], { dateFrom = "", dateTo = "" } = {}) {
  const start = String(dateFrom || "").slice(0, 10);
  const end = String(dateTo || "").slice(0, 10);
  if (!start || !end || start > end) return deduplicateOrders(incomingOrders);
  const incoming = deduplicateOrders(incomingOrders);
  const incomingIds = new Set(incoming.map(orderIdentity));
  const retained = rows(cachedWarehouseOrders).filter((order) => {
    if (incomingIds.has(orderIdentity(order))) return false;
    const date = orderDateKey(order);
    return !date || date < start || date > end;
  });
  return deduplicateOrders([...retained, ...incoming]);
}

export function selectWarehouseOrderSnapshot({
  result = {},
  cachedWarehouseOrders = [],
  publishable = false,
  mergeWindow = null,
} = {}) {
  const cached = rows(cachedWarehouseOrders);
  const incoming = rows(result?.orders);
  const published = Boolean(publishable);
  const selected = published
    ? (mergeWindow ? mergeWarehouseOrderWindow(cached, incoming, mergeWindow) : incoming)
    : cached;

  return {
    orders: selected,
    orderCount: selected.length,
    liveOrderCount: incoming.length,
    published,
    usingPreviousSuccessfulData: !published && cached.length > 0,
  };
}

export function replaceWarehouseOrderRows(allOrders = [], warehouseIds = [], warehouseOrders = []) {
  const ids = new Set(rows(warehouseIds).map((value) => String(value || "").trim()).filter(Boolean));
  return [
    ...rows(allOrders).filter((order) => !ids.has(String(order?.warehouseId || "").trim())),
    ...rows(warehouseOrders),
  ];
}

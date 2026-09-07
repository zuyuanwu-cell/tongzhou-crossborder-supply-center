function rows(value) {
  return Array.isArray(value) ? value : [];
}

export function selectWarehouseOrderSnapshot({
  result = {},
  cachedWarehouseOrders = [],
  publishable = false,
} = {}) {
  const cached = rows(cachedWarehouseOrders);
  const incoming = rows(result?.orders);
  const published = Boolean(publishable);
  const selected = published ? incoming : cached;

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

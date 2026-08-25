import { hasPermission, isWithinDataScope, normalizeDataScopes } from "./access-control.js";

function matchesWarehouseScope(record, scopes) {
  if (!scopes.warehouseIds.length) return true;
  return scopes.warehouseIds.includes(String(record?.warehouseId || record?.id || "").trim());
}

function matchesMovementScope(record, scopes) {
  return matchesWarehouseScope(record, scopes) && isWithinDataScope(record, scopes);
}

export function scopeMovementSources({ products, warehouse, orders, connections }, user) {
  const scopes = normalizeDataScopes(user?.dataScopes);
  const catalog = (products?.catalog || []).filter((item) => isWithinDataScope(item, scopes));
  const visibleSkus = new Set(catalog.flatMap((item) => [item.sku, item.skuNo, item.countrySku])
    .map((value) => String(value || "").toUpperCase())
    .filter(Boolean));
  const productBase = (products?.productBase || []).filter((item) => {
    if (!scopes.countries.length && !scopes.skus.length) return true;
    return [item.sku, item.skuNo].some((value) => visibleSkus.has(String(value || "").toUpperCase()));
  });
  const countryScope = { countries: scopes.countries, warehouseIds: [], skus: [] };
  const scopedConnections = (connections || []).filter((item) => matchesWarehouseScope(item, scopes) && isWithinDataScope(item, countryScope));
  const visibleWarehouseIds = new Set(scopedConnections.map((item) => item.id));
  const filterWarehouseRecord = (item) => {
    if (!matchesMovementScope(item, scopes)) return false;
    if (!scopes.warehouseIds.length) return true;
    return visibleWarehouseIds.has(item.warehouseId);
  };
  const filterWarehouseResult = (item) => {
    if (!matchesWarehouseScope(item, scopes)) return false;
    if (!scopes.warehouseIds.length && !scopes.countries.length) return true;
    return visibleWarehouseIds.has(String(item?.warehouseId || ""));
  };

  return {
    scopes,
    products: { ...products, catalog, productBase },
    warehouse: {
      ...warehouse,
      products: (warehouse?.products || []).filter(filterWarehouseRecord),
      inventory: (warehouse?.inventory || []).filter(filterWarehouseRecord),
      results: (warehouse?.results || []).filter(filterWarehouseResult),
    },
    orders: {
      ...orders,
      orders: (orders?.orders || []).filter(filterWarehouseRecord),
      results: (orders?.results || []).filter(filterWarehouseResult),
    },
    connections: scopedConnections,
  };
}

function omit(value, fields) {
  const projected = { ...value };
  for (const field of fields) delete projected[field];
  return projected;
}

function movementCounts(items, inventoryVisible) {
  const statuses = items.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  return {
    sku: items.length,
    ...(inventoryVisible ? {
      stockout: statuses["缺货"] || 0,
      replenish: statuses["补货预警"] || 0,
      slow: statuses["慢销"] || 0,
      stagnant: statuses["滞销"] || 0,
      warehouseOnly: items.filter((item) => item.source === "warehouse_only").length,
    } : {}),
    noSalesData: statuses["无动销数据"] || 0,
  };
}

export function projectMovementPayload(payload, user) {
  const inventoryVisible = hasPermission(user, "movement_inventory");
  const warehouseVisible = hasPermission(user, "movement_warehouse");
  const syncVisible = hasPermission(user, "movement_sync");
  const inventoryFields = [
    "availableQty",
    "lockedQty",
    "inTransitQty",
    "totalQty",
    "daysCover",
    "leadDays",
    "targetCoverDays",
    "replenishQty",
    "dataGap",
    "source",
  ];
  const items = (payload?.items || []).map((item) => {
    let projected = { ...item };
    if (!warehouseVisible) projected = omit(projected, ["warehouseBreakdown", "salesWarehouseBreakdown"]);
    if (!inventoryVisible) {
      projected = omit(projected, [...inventoryFields, "warehouseBreakdown"]);
      projected.status = Number(projected.sales90 || 0) > 0 ? "有动销" : "无动销数据";
      projected.suggestion = Number(projected.sales90 || 0) > 0 ? "该账号仅查看销量趋势。" : "近 90 天暂无动销数据。";
    }
    return projected;
  });
  let projectedPayload = {
    ...payload,
    items,
    counts: movementCounts(items, inventoryVisible),
  };
  if (!syncVisible) {
    projectedPayload = omit(projectedPayload, ["orderSyncResults", "orderSyncJob", "warehouseFreshness", "warehouseDiagnostics", "syncState"]);
  }
  return projectedPayload;
}

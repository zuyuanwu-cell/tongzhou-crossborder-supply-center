function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function firstNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function skuSuffix(sku) {
  const value = firstText(sku);
  const match = value.match(/^[A-Z]{2,5}-(.+)$/i);
  return match ? match[1] : value;
}

function normalizeCountryName(country) {
  const value = firstText(country);
  if (value === "俄罗斯") return "俄罗斯联邦";
  if (value === "印尼") return "印度尼西亚";
  return value;
}

function dateKey(value) {
  const literalDate = firstText(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (literalDate) return literalDate[1];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function leadTimeDays(country) {
  const normalized = normalizeCountryName(country);
  if (/俄罗斯/.test(normalized)) return 55;
  if (/印度尼西亚/.test(normalized)) return 35;
  if (/马来西亚|越南/.test(normalized)) return 30;
  return 35;
}

function statusFor({ availableQty, sales7, sales30, sales90, dailyWeighted, daysCover, leadDays }) {
  if (availableQty <= 0 && (sales7 > 0 || sales30 > 0 || sales90 > 0)) return "缺货";
  if (dailyWeighted > 0 && daysCover <= leadDays + 10) return "补货预警";
  if (availableQty > 0 && sales30 === 0) return "滞销";
  if (availableQty > 0 && sales90 <= 2) return "滞销";
  if (dailyWeighted > 0 && daysCover > 90) return "慢销";
  if (sales90 === 0 && availableQty <= 0) return "无动销数据";
  return "健康";
}

function suggestionFor(status, item) {
  if (status === "缺货") return "立即核查库存，确认是否有在途或可调拨库存。";
  if (status === "补货预警") return `建议按 ${item.targetCoverDays} 天覆盖量安排补货，参考补货量 ${item.replenishQty}。`;
  if (status === "慢销") return "库存覆盖过高，建议暂停补货并评估促销或调价。";
  if (status === "滞销") return "近 30 天动销不足，建议检查渠道曝光、价格和是否清仓。";
  if (status === "无动销数据") return "暂无订单出库数据，先确认订单接口或 SKU 映射。";
  return "库存和销量处于可控区间。";
}

function buildProductKeys(product) {
  const country = normalizeCountryName(product.country);
  const sku = firstText(product.sku);
  const countrySku = firstText(product.countrySku, country && sku ? `${country}-${sku}` : "");
  return [
    countrySku,
    country && sku ? `${country}-${sku}` : "",
    country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : "",
    !country ? sku : "",
  ].filter(Boolean);
}

function inventoryKeys(item) {
  const country = normalizeCountryName(item.country);
  const sku = firstText(item.sku);
  const countrySku = firstText(item.countrySku);
  const normalizedCountrySku = countrySku.includes("-") ? `${country}-${countrySku.split("-").slice(1).join("-")}` : "";
  return [
    normalizedCountrySku || (country && sku ? `${country}-${sku}` : ""),
    country && sku ? `${country}-${sku}` : "",
    country && sku && !sku.startsWith("TZKJ-") ? `${country}-TZKJ-${skuSuffix(sku)}` : "",
    sku,
  ].filter(Boolean);
}

function imageKeys(item) {
  const country = normalizeCountryName(item.country);
  const sku = firstText(item.sku);
  const countrySku = firstText(item.countrySku, country && sku ? `${country}-${sku}` : "");
  return [
    countrySku,
    country && sku ? `${country}-${sku}` : "",
    country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : "",
    sku,
  ].filter(Boolean);
}

function buildImageMap(warehousePayload, productBase = []) {
  const imageByKey = new Map();
  for (const product of productBase || []) {
    const imageUrl = firstText(product.imageUrl);
    if (!imageUrl) continue;
    for (const key of imageKeys(product)) {
      if (!imageByKey.has(key)) imageByKey.set(key, imageUrl);
    }
  }
  for (const product of warehousePayload.products || []) {
    const imageUrl = firstText(product.imageUrl);
    if (!imageUrl) continue;
    for (const key of imageKeys(product)) {
      if (!imageByKey.has(key)) imageByKey.set(key, imageUrl);
    }
  }
  return imageByKey;
}

function buildProductBaseMap(productBase = []) {
  const baseByKey = new Map();
  for (const product of productBase || []) {
    for (const key of imageKeys(product)) {
      if (!baseByKey.has(key)) baseByKey.set(key, product);
    }
  }
  return baseByKey;
}

function addInventory(target, item) {
  const availableQty = firstNumber(item.availableQty);
  const lockedQty = firstNumber(item.lockedQty);
  const inTransitQty = firstNumber(item.inTransitQty);
  const totalQty = firstNumber(item.totalQty, availableQty + lockedQty + inTransitQty);
  target.availableQty += availableQty;
  target.lockedQty += lockedQty;
  target.inTransitQty += inTransitQty;
  target.totalQty += totalQty;

  const warehouseName = firstText(item.warehouseName, item.warehouseId);
  const index = target.warehouseBreakdown.findIndex((row) => row.warehouseId === item.warehouseId && row.warehouseName === warehouseName);
  if (index >= 0) {
    target.warehouseBreakdown[index].availableQty += availableQty;
    target.warehouseBreakdown[index].lockedQty += lockedQty;
    target.warehouseBreakdown[index].inTransitQty += inTransitQty;
    target.warehouseBreakdown[index].totalQty += totalQty;
  } else {
    target.warehouseBreakdown.push({
      warehouseId: firstText(item.warehouseId),
      warehouseName,
      availableQty,
      lockedQty,
      inTransitQty,
      totalQty,
    });
  }
}

function addWarehouseSale(target, order) {
  const quantity = firstNumber(order.quantity);
  const warehouseId = firstText(order.warehouseId);
  const warehouseName = firstText(order.warehouseName, order.warehouseId);
  if (!quantity || !warehouseName) return;

  const index = target.salesWarehouseBreakdown.findIndex((row) => row.warehouseId === warehouseId && row.warehouseName === warehouseName);
  if (index >= 0) {
    target.salesWarehouseBreakdown[index].sales90 += quantity;
  } else {
    target.salesWarehouseBreakdown.push({
      warehouseId,
      warehouseName,
      sales90: quantity,
    });
  }
}

function salesWindows(dailySales, todayKey) {
  const windows = { sales3: 0, sales7: 0, sales15: 0, sales30: 0, sales60: 0, sales90: 0 };
  for (const [day, quantity] of Object.entries(dailySales)) {
    const age = daysBetween(day, todayKey);
    if (age < 0 || age >= 90) continue;
    if (age < 3) windows.sales3 += quantity;
    if (age < 7) windows.sales7 += quantity;
    if (age < 15) windows.sales15 += quantity;
    if (age < 30) windows.sales30 += quantity;
    if (age < 60) windows.sales60 += quantity;
    windows.sales90 += quantity;
  }
  return windows;
}

function sparklineFromDaily(dailySales, todayKey) {
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(`${todayKey}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (29 - index));
    const key = date.toISOString().slice(0, 10);
    return dailySales[key] || 0;
  });
}

export function buildMovementPayload(productPayload, warehousePayload, ordersPayload = {}) {
  const todayKey = localDateKey();
  const itemsByKey = new Map();
  const imageByKey = buildImageMap(warehousePayload, productPayload.productBase);
  const baseByKey = buildProductBaseMap(productPayload.productBase);
  const baseItems = [];

  for (const product of productPayload.catalog || []) {
    const item = {
      id: product.id,
      sku: firstText(product.sku),
      countrySku: firstText(product.countrySku),
      name: firstText(product.name, product.nameEn, product.sku),
      brand: firstText(product.brand),
      category: firstText(product.category),
      country: normalizeCountryName(product.country),
      unit: firstText(product.unit, "件"),
      imageUrl: firstText(product.imageUrl),
      availableQty: firstNumber(product.stockQty),
      lockedQty: firstNumber(product.lockedQty),
      inTransitQty: firstNumber(product.inTransitQty),
      totalQty: firstNumber(product.warehouseTotalQty, product.stockQty),
      warehouseBreakdown: Array.isArray(product.warehouseBreakdown) ? [...product.warehouseBreakdown] : [],
      salesWarehouseBreakdown: [],
      dailySales: {},
      source: "product",
      dataGap: product.dataGap || "",
    };
    baseItems.push(item);
    for (const key of buildProductKeys(product)) itemsByKey.set(key, item);
  }

  for (const inventory of warehousePayload.inventory || []) {
    const keys = inventoryKeys(inventory);
    let item = keys.map((key) => itemsByKey.get(key)).find(Boolean);
    if (!item) {
      const base = keys.map((key) => baseByKey.get(key)).find(Boolean);
      const imageUrl = firstText(base?.imageUrl) || keys.map((key) => imageByKey.get(key)).find(Boolean) || "";
      item = {
        id: `warehouse-${firstText(inventory.countrySku, inventory.sku)}`,
        sku: firstText(inventory.sku),
        countrySku: firstText(inventory.countrySku),
        name: firstText(base?.name, base?.nameEn, inventory.sku),
        brand: "未建档",
        category: "仓库 SKU",
        country: normalizeCountryName(inventory.country),
        unit: "件",
        imageUrl,
        availableQty: 0,
        lockedQty: 0,
        inTransitQty: 0,
        totalQty: 0,
        warehouseBreakdown: [],
        salesWarehouseBreakdown: [],
        dailySales: {},
        source: "warehouse_only",
        dataGap: "warehouse_only",
      };
      baseItems.push(item);
      for (const key of keys) itemsByKey.set(key, item);
    }
    if (item.source === "warehouse_only") addInventory(item, inventory);
  }

  for (const order of ordersPayload.orders || []) {
    const sku = firstText(order.sku);
    const country = normalizeCountryName(order.country);
    const day = dateKey(order.shippedAt || order.createdAt);
    if (!sku || !day) continue;
    const keys = [
      country && sku ? `${country}-${sku}` : "",
      country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : "",
      !country ? sku : "",
    ].filter(Boolean);
    const item = keys.map((key) => itemsByKey.get(key)).find(Boolean);
    if (!item) continue;
    item.dailySales[day] = (item.dailySales[day] || 0) + firstNumber(order.quantity);
    const age = daysBetween(day, todayKey);
    if (age >= 0 && age < 90) addWarehouseSale(item, order);
  }

  const items = baseItems.map((item) => {
    const windows = salesWindows(item.dailySales, todayKey);
    const avgDaily3 = windows.sales3 / 3;
    const avgDaily7 = windows.sales7 / 7;
    const avgDaily30 = windows.sales30 / 30;
    const avgDaily90 = windows.sales90 / 90;
    const dailyWeighted = avgDaily7 * 0.5 + avgDaily30 * 0.3 + avgDaily90 * 0.2;
    const daysCover = dailyWeighted > 0 ? Math.round((item.availableQty / dailyWeighted) * 10) / 10 : null;
    const leadDays = leadTimeDays(item.country);
    const targetCoverDays = leadDays + 20;
    const replenishQty = Math.max(0, Math.ceil(dailyWeighted * targetCoverDays - item.availableQty - item.inTransitQty));
    const status = statusFor({ ...windows, availableQty: item.availableQty, dailyWeighted, daysCover: daysCover ?? 9999, leadDays });
    return {
      ...item,
      ...windows,
      avgDaily3,
      avgDaily7,
      avgDaily30,
      avgDaily90,
      dailyWeighted,
      daysCover,
      leadDays,
      targetCoverDays,
      replenishQty,
      status,
      suggestion: suggestionFor(status, { ...item, targetCoverDays, replenishQty }),
      trend30: sparklineFromDaily(item.dailySales, todayKey),
      salesWarehouseBreakdown: item.salesWarehouseBreakdown.sort((a, b) => b.sales90 - a.sales90),
      dailySales: undefined,
    };
  });

  const statusCounts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    orderSyncedAt: ordersPayload.syncedAt || "",
    inventorySyncedAt: warehousePayload.syncedAt || "",
    windows: [3, 7, 15, 30, 60, 90],
    counts: {
      sku: items.length,
      stockout: statusCounts["缺货"] || 0,
      replenish: statusCounts["补货预警"] || 0,
      slow: statusCounts["慢销"] || 0,
      stagnant: statusCounts["滞销"] || 0,
      noSalesData: statusCounts["无动销数据"] || 0,
      warehouseOnly: items.filter((item) => item.source === "warehouse_only").length,
    },
    items: items.sort((a, b) => {
      const rank = { 缺货: 0, 补货预警: 1, 滞销: 2, 慢销: 3, 无动销数据: 4, 健康: 5 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.sales30 - a.sales30;
    }),
    orderSyncResults: ordersPayload.results || [],
  };
}

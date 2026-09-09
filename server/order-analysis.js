function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function number(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function orderIdentity(row = {}) {
  return text(row.orderIdentity)
    || [row.sourceSystem, row.warehouseId, row.sourceOrderId || row.orderId || row.orderNo || row.id]
      .map((value) => text(value))
      .join("|");
}

function optionRows(values) {
  return [...values]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((value) => ({ value, label: value }));
}

function aggregate(rows, keyFor) {
  const result = new Map();
  for (const row of rows) {
    const key = text(keyFor(row), "未识别");
    const current = result.get(key) || {
      key,
      orderIds: new Set(),
      orderLines: 0,
      quantity: 0,
      salesAmount: 0,
      skuSet: new Set(),
    };
    current.orderIds.add(orderIdentity(row));
    current.orderLines += 1;
    current.quantity += number(row.quantity);
    current.salesAmount += number(row.salesAmount);
    if (text(row.sku)) current.skuSet.add(text(row.sku));
    result.set(key, current);
  }
  return [...result.values()]
    .map((row) => ({
      key: row.key,
      orderCount: row.orderIds.size,
      orderLines: row.orderLines,
      quantity: row.quantity,
      salesAmount: row.salesAmount,
      skuCount: row.skuSet.size,
    }))
    .sort((left, right) => right.orderCount - left.orderCount || right.quantity - left.quantity);
}

function matchesKeyword(row, keyword) {
  if (!keyword) return true;
  return [
    row.orderNo,
    row.externalOrderNo,
    row.sourceOrderId,
    row.sku,
    row.productName,
    row.shopName,
    row.rawShopName,
    row.shopAlias,
    row.projectGroup,
    row.platform,
    row.warehouseName,
  ].some((value) => text(value).toLowerCase().includes(keyword));
}

function isRussian(row) {
  return text(row.providerId) === "yunwms_ru" || ["俄罗斯", "俄罗斯联邦", "RU"].includes(text(row.country).toUpperCase());
}

export function buildOrderAnalysisFromFacts({ facts = [], filters = {}, onlyRussia = true, recentLimit = 200 } = {}) {
  const sourceRows = (Array.isArray(facts) ? facts : []).filter((row) => !onlyRussia || isRussian(row));
  const keyword = text(filters.keyword).toLowerCase();
  const dateFrom = text(filters.dateFrom);
  const dateTo = text(filters.dateTo);
  const options = {
    countries: optionRows(new Set(sourceRows.map((row) => text(row.country)))),
    warehouses: [...new Map(sourceRows.map((row) => [text(row.warehouseId), {
      warehouseId: text(row.warehouseId),
      warehouseName: text(row.warehouseName, text(row.warehouseId)),
      country: text(row.country),
    }])).values()].filter((row) => row.warehouseId).sort((left, right) => left.warehouseName.localeCompare(right.warehouseName, "zh-CN")),
    platforms: optionRows(new Set(sourceRows.map((row) => text(row.platform, "未识别平台")))),
    shops: [...new Map(sourceRows.map((row) => {
      const rawName = text(row.rawShopName || row.shopName, "未识别店铺");
      return [rawName, {
        value: rawName,
        label: text(row.shopName, rawName),
        alias: text(row.shopAlias),
        rawName,
      }];
    })).values()].sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
    projectGroups: optionRows(new Set(sourceRows.map((row) => text(row.projectGroup)))),
  };

  const rows = sourceRows.filter((row) => {
    const date = text(row.orderDate || row.date || row.shippedAt || row.createdAt).slice(0, 10);
    if (!date || (dateFrom && date < dateFrom) || (dateTo && date > dateTo)) return false;
    if (text(filters.country) && text(row.country) !== text(filters.country)) return false;
    if (text(filters.warehouseId) && text(row.warehouseId) !== text(filters.warehouseId)) return false;
    if (text(filters.platform) && text(row.platform, "未识别平台") !== text(filters.platform)) return false;
    if (text(filters.shopName) && text(row.rawShopName || row.shopName, "未识别店铺") !== text(filters.shopName)) return false;
    if (text(filters.projectGroup) && text(row.projectGroup) !== text(filters.projectGroup)) return false;
    if (text(filters.providerId) && text(row.providerId) !== text(filters.providerId)) return false;
    return matchesKeyword(row, keyword);
  });

  const orderIds = new Set(rows.map(orderIdentity).filter(Boolean));
  const skuSet = new Set(rows.map((row) => text(row.sku)).filter(Boolean));
  const byProductMap = new Map();
  for (const row of rows) {
    const key = text(row.sku || row.productName, "未识别产品");
    const current = byProductMap.get(key) || {
      key,
      sku: text(row.sku),
      productName: text(row.productName || row.sku, "未识别产品"),
      imageUrl: text(row.imageUrl),
      orderIds: new Set(),
      orderLines: 0,
      quantity: 0,
      salesAmount: 0,
      shops: new Set(),
      platforms: new Set(),
    };
    current.orderIds.add(orderIdentity(row));
    current.orderLines += 1;
    current.quantity += number(row.quantity);
    current.salesAmount += number(row.salesAmount);
    if (text(row.shopName)) current.shops.add(text(row.shopName));
    if (text(row.platform)) current.platforms.add(text(row.platform));
    if (!current.imageUrl && text(row.imageUrl)) current.imageUrl = text(row.imageUrl);
    byProductMap.set(key, current);
  }
  const byProduct = [...byProductMap.values()].map((row) => ({
    key: row.key,
    sku: row.sku,
    productName: row.productName,
    imageUrl: row.imageUrl,
    orderCount: row.orderIds.size,
    orderLines: row.orderLines,
    quantity: row.quantity,
    salesAmount: row.salesAmount,
    shopCount: row.shops.size,
    platformCount: row.platforms.size,
  })).sort((left, right) => right.quantity - left.quantity || right.orderCount - left.orderCount);

  const recentOrders = rows.slice().sort((left, right) => (
    text(right.shippedAt || right.createdAt || right.orderDate).localeCompare(text(left.shippedAt || left.createdAt || left.orderDate))
  )).slice(0, Math.max(1, Number(recentLimit) || 200)).map((row) => ({
    orderId: text(row.orderId || row.sourceOrderId),
    orderNo: text(row.orderNo),
    externalOrderNo: text(row.externalOrderNo),
    date: text(row.orderDate || row.date).slice(0, 10),
    shippedAt: text(row.shippedAt),
    createdAt: text(row.createdAt),
    country: text(row.country),
    warehouseId: text(row.warehouseId),
    warehouseName: text(row.warehouseName),
    platform: text(row.platform, "未识别平台"),
    shopName: text(row.shopName, "未识别店铺"),
    rawShopName: text(row.rawShopName),
    shopAlias: text(row.shopAlias),
    projectGroup: text(row.projectGroup, "未识别项目组"),
    sku: text(row.sku),
    productName: text(row.productName),
    productDisplayName: text(row.productName || row.sku),
    imageUrl: text(row.imageUrl),
    quantity: number(row.quantity),
    salesAmount: number(row.salesAmount),
    currency: text(row.currency),
    status: text(row.status),
  }));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: onlyRussia ? "russia" : "all",
    filters: {
      dateFrom,
      dateTo,
      country: text(filters.country),
      warehouseId: text(filters.warehouseId),
      platform: text(filters.platform),
      shopName: text(filters.shopName),
      projectGroup: text(filters.projectGroup),
      providerId: text(filters.providerId),
      keyword: text(filters.keyword),
    },
    counts: {
      orderCount: orderIds.size,
      orderLines: rows.length,
      quantity: rows.reduce((sum, row) => sum + number(row.quantity), 0),
      skuCount: skuSet.size,
      salesAmount: rows.reduce((sum, row) => sum + number(row.salesAmount), 0),
      shopCount: new Set(rows.map((row) => text(row.shopName)).filter(Boolean)).size,
      projectGroupCount: new Set(rows.map((row) => text(row.projectGroup)).filter(Boolean)).size,
      platformCount: new Set(rows.map((row) => text(row.platform)).filter(Boolean)).size,
      unrecognizedShopRows: rows.filter((row) => !text(row.shopName)).length,
    },
    options,
    daily: aggregate(rows, (row) => text(row.orderDate || row.date).slice(0, 10)).sort((left, right) => left.key.localeCompare(right.key)),
    byShop: aggregate(rows, (row) => text(row.shopName, "未识别店铺")),
    byProduct,
    byProjectGroup: aggregate(rows, (row) => text(row.projectGroup, "未识别项目组")),
    byPlatform: aggregate(rows, (row) => text(row.platform, "未识别平台")),
    byWarehouse: aggregate(rows, (row) => text(row.warehouseName || row.warehouseId, "未识别仓库")),
    byCountry: aggregate(rows, (row) => text(row.country, "未识别国家")),
    recentOrders,
  };
}

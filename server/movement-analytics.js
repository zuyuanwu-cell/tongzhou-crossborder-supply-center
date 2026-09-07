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

function dateAfterDays(dateText, days) {
  if (!dateText || !Number.isFinite(Number(days))) return "";
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.ceil(Number(days))));
  return date.toISOString().slice(0, 10);
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

function addWarehouseSale(target, order, day) {
  const quantity = firstNumber(order.quantity);
  const warehouseId = firstText(order.warehouseId);
  const warehouseName = firstText(order.warehouseName, order.warehouseId);
  if (!quantity || !warehouseName) return;

  const index = target.salesWarehouseBreakdown.findIndex((row) => row.warehouseId === warehouseId && row.warehouseName === warehouseName);
  if (index >= 0) {
    target.salesWarehouseBreakdown[index].sales90 += quantity;
    if (day) target.salesWarehouseBreakdown[index].dailySales[day] = (target.salesWarehouseBreakdown[index].dailySales[day] || 0) + quantity;
  } else {
    target.salesWarehouseBreakdown.push({
      warehouseId,
      warehouseName,
      sales90: quantity,
      dailySales: day ? { [day]: quantity } : {},
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
  const itemsBySku = new Map();
  const imageByKey = buildImageMap(warehousePayload, productPayload.productBase);
  const baseByKey = buildProductBaseMap(productPayload.productBase);
  const baseItems = [];
  const addSkuCandidate = (sku, item, identity = "") => {
    const key = firstText(sku).toLowerCase();
    if (!key) return;
    const candidateKey = identity || `${normalizeCountryName(item.country)}-${firstText(item.sku, item.countrySku)}`;
    const candidates = itemsBySku.get(key) || new Map();
    if (!candidates.has(candidateKey)) candidates.set(candidateKey, item);
    itemsBySku.set(key, candidates);
  };
  const uniqueSkuCandidate = (sku) => {
    const candidates = itemsBySku.get(firstText(sku).toLowerCase());
    if (!candidates || candidates.size !== 1) return null;
    return Array.from(candidates.values())[0];
  };

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
    const identity = `${item.country}-${item.sku || item.countrySku}`;
    addSkuCandidate(product.sku, item, identity);
    addSkuCandidate(product.countrySku, item, identity);
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
      addSkuCandidate(inventory.sku, item);
      addSkuCandidate(inventory.countrySku, item);
    }
    const identity = `${normalizeCountryName(inventory.country) || item.country}-${firstText(inventory.sku, inventory.countrySku)}`;
    addSkuCandidate(inventory.sku, item, identity);
    addSkuCandidate(inventory.countrySku, item, identity);
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
    const item = keys.map((key) => itemsByKey.get(key)).find(Boolean) || uniqueSkuCandidate(sku);
    if (!item) continue;
    item.dailySales[day] = (item.dailySales[day] || 0) + firstNumber(order.quantity);
    const age = daysBetween(day, todayKey);
    if (age >= 0 && age < 90) addWarehouseSale(item, order, day);
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
    const relatedWarehouseIds = new Set([
      ...(item.warehouseBreakdown || []).map((row) => firstText(row.warehouseId, row.warehouseName)),
      ...(item.salesWarehouseBreakdown || []).map((row) => firstText(row.warehouseId, row.warehouseName)),
    ].filter(Boolean));
    const relatedResults = (ordersPayload.results || []).filter((result) => relatedWarehouseIds.has(firstText(result.warehouseId)));
    const partialOrders = relatedResults.some((result) => (
      result.orderApiReachedPageLimit
      || (firstNumber(result.orderApiTotal) > 0 && firstNumber(result.orderApiReadRows, result.orderApiReadSkuRows) < firstNumber(result.orderApiTotal))
      || (!result.ok && !result.backgroundRunning && !result.skipped)
    ));
    const dataCompleteness = item.dataGap
      ? "incomplete"
      : !ordersPayload.syncedAt
        ? "waiting"
        : partialOrders
          ? "partial"
          : "complete";
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
      identityScope: "SKU×国家",
      dataCompleteness,
      estimatedStockoutDate: dailyWeighted > 0 && item.availableQty > 0 ? dateAfterDays(todayKey, daysCover) : "",
      calculation: {
        ruleVersion: "movement-v2",
        window: "3/7/30/90天",
        dailySalesBasis: dailyWeighted,
        formula: "7日均销×50% + 30日均销×30% + 90日均销×20%",
        includesInTransit: false,
      },
      trend30: sparklineFromDaily(item.dailySales, todayKey),
      salesWarehouseBreakdown: item.salesWarehouseBreakdown
        .map((row) => {
          const warehouseWindows = salesWindows(row.dailySales || {}, todayKey);
          const warehouseAvgDaily3 = warehouseWindows.sales3 / 3;
          const warehouseAvgDaily7 = warehouseWindows.sales7 / 7;
          const warehouseAvgDaily30 = warehouseWindows.sales30 / 30;
          const warehouseAvgDaily90 = warehouseWindows.sales90 / 90;
          const warehouseDailyWeighted = warehouseAvgDaily7 * 0.5 + warehouseAvgDaily30 * 0.3 + warehouseAvgDaily90 * 0.2;
          return {
            warehouseId: row.warehouseId,
            warehouseName: row.warehouseName,
            ...warehouseWindows,
            avgDaily3: warehouseAvgDaily3,
            avgDaily7: warehouseAvgDaily7,
            avgDaily30: warehouseAvgDaily30,
            avgDaily90: warehouseAvgDaily90,
            dailyWeighted: warehouseDailyWeighted,
            trend30: sparklineFromDaily(row.dailySales || {}, todayKey),
          };
        })
        .sort((a, b) => b.sales90 - a.sales90),
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

function movementDiagnosticGuidance(row) {
  if (!row.hasCredentials) {
    return {
      severity: "danger",
      actionTitle: "补充仓库授权",
      actionItems: ["到仓库授权页配置 WMS 凭据", "点击检测连接确认库存和订单接口都可访问", "授权成功后重新同步订单"],
    };
  }
  if (row.running) {
    return {
      severity: "warning",
      actionTitle: "等待同步完成",
      actionItems: ["保持当前订单同步任务运行", "同步完成后刷新动销监控", "如果长时间停留在同步中，检查后台任务日志"],
    };
  }
  if (row.failed) {
    return {
      severity: "danger",
      actionTitle: "修复订单同步失败",
      actionItems: ["查看仓库同步结果里的错误消息", "优先检查 WMS 地址、仓库编码、Token 或 AppSecret", "修复后重新发起订单同步"],
    };
  }
  if (!row.inventoryRows) {
    return {
      severity: "danger",
      actionTitle: "先同步库存快照",
      actionItems: ["到仓库授权页执行库存同步", "确认该仓库有库存行返回", "库存同步成功后再同步订单并查看动销"],
    };
  }
  if (!row.orderRows) {
    return {
      severity: "warning",
      actionTitle: "检查订单同步范围",
      actionItems: ["确认该仓库是否有出库订单", "重新同步最近 90 天订单", "如果 WMS 有订单但系统为 0，检查订单接口权限和仓库编码映射"],
    };
  }
  if (row.missingSkuOrderRows) {
    return {
      severity: "danger",
      actionTitle: "补齐订单明细 SKU",
      actionItems: [`当前有 ${row.missingSkuOrderRows || 0} 条订单缺少 SKU`, "导出缺 SKU 订单清单发给仓库或 WMS 同事", "补齐商品编码后重新同步订单"],
    };
  }
  if (!row.recentOrderRows) {
    return {
      severity: "warning",
      actionTitle: "确认是否超出 90 天窗口",
      actionItems: [`当前有 ${row.outOfWindowOrderRows || 0} 条窗口外订单`, "如果业务需要更长周期，应调整动销统计窗口", "如果 WMS 近期有订单，重新同步最近 90 天订单"],
    };
  }
  if (!row.matchedOrderRows) {
    return {
      severity: "danger",
      actionTitle: "核对 SKU 映射",
      actionItems: ["检查订单 SKU 是否与产品库 SKU 或国家 SKU 一致", "优先处理未匹配样例里的 SKU", "补齐产品档案或国家 SKU 映射后重新同步"],
    };
  }
  if (row.orderApiReachedPageLimit && row.orderApiTotal > row.orderApiReadRows) {
    return {
      severity: "warning",
      actionTitle: "扩大订单分页重同步",
      actionItems: [
        `接口返回约 ${row.orderApiTotal} 条，当前只读取 ${row.orderApiReadRows} 条`,
        "提高 WMS_ORDER_MAX_PAGES 或缩短订单同步分片",
        "重同步该仓库订单后再核对动销",
      ],
    };
  }
  if (row.skuFallbackMatchedRows) {
    return {
      severity: "warning",
      actionTitle: "补齐国家 SKU 映射",
      actionItems: [`已有 ${row.skuFallbackMatchedRows} 单依赖 SKU 唯一兜底匹配`, "建议补齐产品国家、国家 SKU 或仓库 SKU 映射", "避免同 SKU 跨国家/跨仓库时误匹配"],
    };
  }
  return {
    severity: "good",
    actionTitle: "保持同步巡检",
    actionItems: ["该仓库库存和近 90 天订单已匹配", "继续关注同步时间和低动销 SKU", "如业务反馈不一致，可下载诊断清单对账"],
  };
}

export function buildMovementDiagnostics(productPayload, warehousePayload, ordersPayload = {}, warehouses = []) {
  const todayKey = localDateKey();
  const itemsByKey = new Set();
  const skuCandidates = new Map();
  const registerSku = (sku, identity) => {
    const key = firstText(sku).toLowerCase();
    if (!key) return;
    const set = skuCandidates.get(key) || new Set();
    set.add(identity);
    skuCandidates.set(key, set);
  };

  for (const product of productPayload.catalog || []) {
    const identity = `${normalizeCountryName(product.country)}-${firstText(product.sku) || firstText(product.countrySku)}`;
    for (const key of buildProductKeys(product)) itemsByKey.add(key);
    registerSku(product.sku, identity);
    registerSku(product.countrySku, identity);
  }
  for (const inventory of warehousePayload.inventory || []) {
    const identity = `${inventory.warehouseId || ""}-${firstText(inventory.sku, inventory.countrySku)}`;
    for (const key of inventoryKeys(inventory)) itemsByKey.add(key);
    registerSku(inventory.sku, identity);
    registerSku(inventory.countrySku, identity);
  }

  const rows = new Map();
  const ensureRow = (warehouseId, fallback = {}) => {
    const id = firstText(warehouseId, fallback.id, fallback.warehouseId, "unknown");
    if (!rows.has(id)) {
      rows.set(id, {
        warehouseId: id,
        warehouseName: firstText(fallback.name, fallback.warehouseName, id),
        country: normalizeCountryName(fallback.country),
        providerId: firstText(fallback.providerId),
        hasCredentials: Boolean(fallback.hasCredentials),
        inventoryRows: 0,
        inventorySku: 0,
        orderRows: 0,
        recentOrderRows: 0,
        matchedOrderRows: 0,
        skuFallbackMatchedRows: 0,
        unmatchedOrderRows: 0,
        outOfWindowOrderRows: 0,
        missingSkuOrderRows: 0,
        orderSku: 0,
        unmatchedSamples: [],
        missingSkuOrders: [],
        unmatchedSkus: [],
        outOfWindowSkus: [],
        orderApiTotal: 0,
        orderApiReadRows: 0,
        orderApiReadSkuRows: 0,
        orderApiPagesRead: 0,
        orderApiPageLimit: 0,
        orderApiReachedPageLimit: false,
        ok: false,
        running: false,
        failed: false,
        skipped: false,
        message: "",
        reason: "no_orders",
        reasonLabel: "暂无订单",
      });
    }
    return rows.get(id);
  };

  for (const warehouse of warehouses || []) {
    ensureRow(warehouse.id, warehouse);
  }

  const inventorySkuByWarehouse = new Map();
  for (const inventory of warehousePayload.inventory || []) {
    const row = ensureRow(inventory.warehouseId, inventory);
    row.inventoryRows += 1;
    if (inventory.warehouseName && row.warehouseName === row.warehouseId) row.warehouseName = inventory.warehouseName;
    if (inventory.country && !row.country) row.country = normalizeCountryName(inventory.country);
    const skuSet = inventorySkuByWarehouse.get(row.warehouseId) || new Set();
    const sku = firstText(inventory.sku, inventory.countrySku);
    if (sku) skuSet.add(sku.toLowerCase());
    inventorySkuByWarehouse.set(row.warehouseId, skuSet);
  }
  for (const [warehouseId, skuSet] of inventorySkuByWarehouse.entries()) {
    ensureRow(warehouseId).inventorySku = skuSet.size;
  }

  const orderSkuByWarehouse = new Map();
  const unmatchedSkuByWarehouse = new Map();
  const outOfWindowSkuByWarehouse = new Map();
  const recordSkuWindowRow = (store, row, order, sku, day, age) => {
    const warehouseId = row.warehouseId;
    const country = normalizeCountryName(order.country);
    const key = `${firstText(sku).toLowerCase()}|${country}`;
    const skuMap = store.get(warehouseId) || new Map();
    const current = skuMap.get(key) || {
      sku,
      country,
      orderRows: 0,
      quantity: 0,
      firstShippedAt: day || "",
      lastShippedAt: day || "",
      sampleShippedAt: firstText(order.shippedAt, order.createdAt),
      minAgeDays: Number.isFinite(age) ? age : null,
      maxAgeDays: Number.isFinite(age) ? age : null,
    };
    current.orderRows += 1;
    current.quantity += firstNumber(order.quantity);
    if (day && (!current.firstShippedAt || day < current.firstShippedAt)) current.firstShippedAt = day;
    if (day && (!current.lastShippedAt || day > current.lastShippedAt)) current.lastShippedAt = day;
    if (Number.isFinite(age)) {
      current.minAgeDays = current.minAgeDays === null ? age : Math.min(current.minAgeDays, age);
      current.maxAgeDays = current.maxAgeDays === null ? age : Math.max(current.maxAgeDays, age);
    }
    skuMap.set(key, current);
    store.set(warehouseId, skuMap);
  };
  const recordUnmatchedSku = (row, order, sku, day) => {
    recordSkuWindowRow(unmatchedSkuByWarehouse, row, order, sku, day, null);
  };

  for (const order of ordersPayload.orders || []) {
    const row = ensureRow(order.warehouseId, order);
    row.orderRows += 1;
    if (order.warehouseName && row.warehouseName === row.warehouseId) row.warehouseName = order.warehouseName;
    if (order.country && !row.country) row.country = normalizeCountryName(order.country);
    const sku = firstText(order.sku);
    if (!sku) {
      row.missingSkuOrderRows += 1;
      if (row.missingSkuOrders.length < 100) {
        row.missingSkuOrders.push({
          orderId: firstText(order.orderId),
          orderNo: firstText(order.orderNo),
          country: firstText(order.country),
          productName: firstText(order.productName, order.name),
          goodsSkuId: firstText(order.goodsSkuId),
          quantity: firstNumber(order.quantity),
          shippedAt: firstText(order.shippedAt),
          createdAt: firstText(order.createdAt),
          status: firstText(order.status),
        });
      }
      continue;
    }

    const skuSet = orderSkuByWarehouse.get(row.warehouseId) || new Set();
    skuSet.add(sku.toLowerCase());
    orderSkuByWarehouse.set(row.warehouseId, skuSet);

    const day = dateKey(order.shippedAt || order.createdAt);
    const age = day ? daysBetween(day, todayKey) : Number.POSITIVE_INFINITY;
    if (!day || age < 0 || age >= 90) {
      row.outOfWindowOrderRows += 1;
      recordSkuWindowRow(outOfWindowSkuByWarehouse, row, order, sku, day, age);
      continue;
    }

    row.recentOrderRows += 1;
    const country = normalizeCountryName(order.country);
    const keys = [
      country && sku ? `${country}-${sku}` : "",
      country && sku ? `${country}-TZKJ-${skuSuffix(sku)}` : "",
      !country ? sku : "",
    ].filter(Boolean);
    const directMatched = keys.some((key) => itemsByKey.has(key));
    const fallbackMatched = !directMatched && (skuCandidates.get(sku.toLowerCase())?.size === 1);
    if (directMatched || fallbackMatched) {
      row.matchedOrderRows += 1;
      if (fallbackMatched) row.skuFallbackMatchedRows += 1;
    } else {
      row.unmatchedOrderRows += 1;
      recordUnmatchedSku(row, order, sku, day);
      if (row.unmatchedSamples.length < 5) {
        row.unmatchedSamples.push({ sku, country: order.country || "", shippedAt: order.shippedAt || order.createdAt || "" });
      }
    }
  }
  for (const [warehouseId, skuSet] of orderSkuByWarehouse.entries()) {
    ensureRow(warehouseId).orderSku = skuSet.size;
  }
  for (const [warehouseId, skuMap] of unmatchedSkuByWarehouse.entries()) {
    ensureRow(warehouseId).unmatchedSkus = Array.from(skuMap.values())
      .sort((a, b) => (b.orderRows - a.orderRows) || String(b.lastShippedAt).localeCompare(String(a.lastShippedAt)))
      .slice(0, 100);
  }
  for (const [warehouseId, skuMap] of outOfWindowSkuByWarehouse.entries()) {
    ensureRow(warehouseId).outOfWindowSkus = Array.from(skuMap.values())
      .sort((a, b) => String(b.lastShippedAt).localeCompare(String(a.lastShippedAt)) || (b.orderRows - a.orderRows))
      .slice(0, 100);
  }

  const resultsByWarehouse = new Map((ordersPayload.results || []).map((result) => [result.warehouseId, result]));
  for (const row of rows.values()) {
    const result = resultsByWarehouse.get(row.warehouseId);
    row.ok = Boolean(result?.ok);
    row.running = Boolean(result?.backgroundRunning);
    row.failed = Boolean(result && !result.ok && !result.skipped && !result.backgroundRunning);
    row.skipped = Boolean(result?.skipped);
    row.message = firstText(result?.message);
    row.orderApiTotal = firstNumber(result?.orderApiTotal);
    row.orderApiReadRows = firstNumber(result?.orderApiReadRows);
    row.orderApiReadSkuRows = firstNumber(result?.orderApiReadSkuRows);
    row.orderApiPagesRead = firstNumber(result?.orderApiPagesRead);
    row.orderApiPageLimit = firstNumber(result?.orderApiPageLimit);
    row.orderApiReachedPageLimit = Boolean(result?.orderApiReachedPageLimit);
    if (!row.hasCredentials && result && "hasCredentials" in result) row.hasCredentials = Boolean(result.hasCredentials);

    if (!row.hasCredentials) {
      row.reason = "no_credentials";
      row.reasonLabel = "未授权";
    } else if (row.running) {
      row.reason = "running";
      row.reasonLabel = "同步中";
    } else if (row.failed) {
      row.reason = "sync_failed";
      row.reasonLabel = "同步失败";
    } else if (!row.inventoryRows) {
      row.reason = "no_inventory";
      row.reasonLabel = "无库存快照";
    } else if (!row.orderRows) {
      row.reason = "no_orders";
      row.reasonLabel = "无订单";
    } else if (row.missingSkuOrderRows) {
      row.reason = "missing_sku";
      row.reasonLabel = "订单缺SKU";
    } else if (!row.recentOrderRows) {
      row.reason = "out_of_window";
      row.reasonLabel = "近90天无订单";
    } else if (!row.matchedOrderRows) {
      row.reason = "sku_mismatch";
      row.reasonLabel = "SKU未匹配";
    } else if (row.orderApiReachedPageLimit && (!row.orderApiTotal || row.orderApiTotal > row.orderApiReadRows)) {
      row.reason = "order_page_truncated";
      row.reasonLabel = "订单分页可能截断";
    } else {
      row.reason = row.skuFallbackMatchedRows ? "ok_with_sku_fallback" : "ok";
      row.reasonLabel = row.skuFallbackMatchedRows ? "已匹配(含SKU兜底)" : "正常";
    }
  }

  for (const row of rows.values()) {
    Object.assign(row, movementDiagnosticGuidance(row));
  }

  return Array.from(rows.values()).sort((a, b) => a.warehouseName.localeCompare(b.warehouseName, "zh-CN"));
}

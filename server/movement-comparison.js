const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VARIANCE_QTY = 5;
const DEFAULT_VARIANCE_RATE = 0.05;
const SUPPORTED_PERIODS = new Set(["week", "month", "quarter", "year", "custom"]);

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDateKey(value) {
  const key = firstText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== key) return null;
  return parsed;
}

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = parseDateKey(dateKey);
  if (!date) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

function inclusiveDays(from, to) {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (!start || !end || start > end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function calendarRange(period, anchorDate) {
  const anchor = parseDateKey(anchorDate);
  if (!anchor) throw new Error("对比日期格式无效，请使用 YYYY-MM-DD。");
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  if (period === "week") {
    const day = anchor.getUTCDay() || 7;
    const from = new Date(anchor);
    from.setUTCDate(from.getUTCDate() - day + 1);
    return { from: formatDateKey(from), to: addDays(formatDateKey(from), 6) };
  }
  if (period === "month") {
    return {
      from: formatDateKey(new Date(Date.UTC(year, month, 1))),
      to: formatDateKey(new Date(Date.UTC(year, month + 1, 0))),
    };
  }
  if (period === "quarter") {
    const quarterMonth = Math.floor(month / 3) * 3;
    return {
      from: formatDateKey(new Date(Date.UTC(year, quarterMonth, 1))),
      to: formatDateKey(new Date(Date.UTC(year, quarterMonth + 3, 0))),
    };
  }
  if (period === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  throw new Error(`不支持的对比周期：${period}`);
}

function previousCalendarRange(period, currentRange) {
  return calendarRange(period, addDays(currentRange.from, -1));
}

function rangeLabel(period, range) {
  const from = parseDateKey(range.from);
  if (!from) return `${range.from} 至 ${range.to}`;
  if (period === "week" || period === "custom") return `${range.from} 至 ${range.to}`;
  if (period === "month") return `${from.getUTCFullYear()}年${from.getUTCMonth() + 1}月`;
  if (period === "quarter") return `${from.getUTCFullYear()}年第${Math.floor(from.getUTCMonth() / 3) + 1}季度`;
  return `${from.getUTCFullYear()}年`;
}

export function resolveMovementComparisonRanges({
  period = "month",
  anchorDate = "",
  from = "",
  to = "",
  compareFrom = "",
  compareTo = "",
} = {}) {
  const resolvedPeriod = SUPPORTED_PERIODS.has(period) ? period : "month";
  let current;
  if (resolvedPeriod === "custom") {
    if (!parseDateKey(from) || !parseDateKey(to) || from > to) {
      throw new Error("自定义对比需要有效的开始日期和结束日期。");
    }
    current = { from, to };
  } else {
    current = calendarRange(resolvedPeriod, anchorDate);
  }
  let previous;
  if (compareFrom || compareTo) {
    if (!parseDateKey(compareFrom) || !parseDateKey(compareTo) || compareFrom > compareTo) {
      throw new Error("自定义基期需要同时提供有效的开始日期和结束日期。");
    }
    previous = { from: compareFrom, to: compareTo };
  } else if (resolvedPeriod === "custom") {
    const days = inclusiveDays(current.from, current.to);
    previous = { from: addDays(current.from, -days), to: addDays(current.from, -1) };
  } else {
    previous = previousCalendarRange(resolvedPeriod, current);
  }
  return {
    period: resolvedPeriod,
    anchorDate: resolvedPeriod === "custom" ? current.to : anchorDate,
    current: { ...current, label: rangeLabel(resolvedPeriod, current) },
    previous: { ...previous, label: rangeLabel(resolvedPeriod, previous) },
  };
}

function latestSnapshotInRange(snapshots, range) {
  return (snapshots || [])
    .filter((snapshot) => snapshot?.date >= range.from && snapshot?.date <= range.to)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.capturedAt || "").localeCompare(String(b.capturedAt || "")))
    .at(-1) || null;
}

function normalizeSku(value) {
  return firstText(value).toLowerCase();
}

function comparisonRowKey(row) {
  return `${firstText(row?.warehouseId, row?.warehouseName)}::${normalizeSku(firstText(row?.sku, row?.countrySku))}`;
}

function rowAliases(row) {
  return Array.from(new Set([normalizeSku(row?.sku), normalizeSku(row?.countrySku)].filter(Boolean)));
}

function filterRows(rows, { warehouseId = "", sku = "" } = {}) {
  const keyword = firstText(sku).toLowerCase();
  return (rows || []).filter((row) => {
    if (warehouseId && row.warehouseId !== warehouseId) return false;
    if (!keyword) return true;
    return [row.sku, row.countrySku, row.productName, row.brand, row.category]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });
}

function rowsByKey(rows) {
  return new Map((rows || []).map((row) => [comparisonRowKey(row), row]));
}

function movementClass(status) {
  if (status === "慢销") return "慢销";
  if (status === "滞销") return "滞销";
  if (status === "健康") return "正常";
  if (status === "缺货" || status === "补货预警") return "供货风险";
  if (status === "无动销数据") return "无数据";
  return status ? "其他" : "无记录";
}

function statusChange(previous, current) {
  if (!previous && current) return { statusChanged: false, changeType: "added", changeLabel: "本期新增" };
  if (previous && !current) return { statusChanged: false, changeType: "removed", changeLabel: "本期无记录" };
  if (!previous || !current) return { statusChanged: false, changeType: "unavailable", changeLabel: "无法比较" };
  if (previous.status === current.status) return { statusChanged: false, changeType: "unchanged", changeLabel: "无变化" };
  const rank = { 正常: 0, 慢销: 1, 滞销: 2 };
  const previousClass = movementClass(previous.status);
  const currentClass = movementClass(current.status);
  if (rank[previousClass] !== undefined && rank[currentClass] !== undefined) {
    if (rank[currentClass] > rank[previousClass]) return { statusChanged: true, changeType: "worsened", changeLabel: "动销恶化" };
    return { statusChanged: true, changeType: "improved", changeLabel: "动销改善" };
  }
  return { statusChanged: true, changeType: "changed", changeLabel: "状态变化" };
}

function orderDateKey(order) {
  const value = firstText(order?.shippedAt, order?.createdAt);
  const literal = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (literal) return literal[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function buildOrderAliasIndex(rows) {
  const candidates = new Map();
  for (const row of rows || []) {
    const warehouseId = firstText(row.warehouseId, row.warehouseName);
    const rowKey = comparisonRowKey(row);
    for (const alias of rowAliases(row)) {
      const aliasKey = `${warehouseId}::${alias}`;
      const values = candidates.get(aliasKey) || new Set();
      values.add(rowKey);
      candidates.set(aliasKey, values);
    }
  }
  return new Map(Array.from(candidates.entries()).filter(([, values]) => values.size === 1).map(([key, values]) => [key, Array.from(values)[0]]));
}

function aggregateOutbound(orders, rows, fromExclusive, toInclusive, warehouseId = "") {
  const aliasIndex = buildOrderAliasIndex(rows);
  const quantityByRow = new Map();
  let matchedOrderRows = 0;
  let unmatchedOrderRows = 0;
  let unmatchedOutboundQty = 0;
  for (const order of orders || []) {
    if (warehouseId && order.warehouseId !== warehouseId) continue;
    const day = orderDateKey(order);
    if (!day || day <= fromExclusive || day > toInclusive) continue;
    const aliasKey = `${firstText(order.warehouseId, order.warehouseName)}::${normalizeSku(order.sku)}`;
    const rowKey = aliasIndex.get(aliasKey);
    const quantity = numberOrZero(order.quantity);
    if (!rowKey) {
      unmatchedOrderRows += 1;
      unmatchedOutboundQty += quantity;
      continue;
    }
    matchedOrderRows += 1;
    quantityByRow.set(rowKey, (quantityByRow.get(rowKey) || 0) + quantity);
  }
  return { quantityByRow, matchedOrderRows, unmatchedOrderRows, unmatchedOutboundQty };
}

function coverageForWarehouse({ warehouseId, previousDate, currentDate, ordersSyncedAt, orderCoverageDaysByWarehouse = {} }) {
  const syncedDate = firstText(ordersSyncedAt).slice(0, 10);
  const coverageDays = Math.max(1, numberOrZero(orderCoverageDaysByWarehouse[warehouseId]) || 90);
  const coverageFrom = parseDateKey(syncedDate) ? addDays(syncedDate, -(coverageDays - 1)) : "";
  const requestedFrom = addDays(previousDate, 1);
  const complete = Boolean(coverageFrom && requestedFrom && coverageFrom <= requestedFrom && syncedDate >= currentDate);
  return { complete, coverageDays, coverageFrom, coverageTo: syncedDate, requestedFrom, requestedTo: currentDate };
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(numberOrZero(value) * factor) / factor;
}

function inventoryComparison({ previous, current, outboundQty, coverage, varianceThresholdQty, varianceThresholdRate }) {
  if (!previous || !current) {
    return {
      openingOnHandQty: previous ? numberOrZero(previous.availableQty) + numberOrZero(previous.lockedQty) : null,
      closingOnHandQty: current ? numberOrZero(current.availableQty) + numberOrZero(current.lockedQty) : null,
      outboundQty: round(outboundQty),
      expectedClosingQty: null,
      inventoryVarianceQty: null,
      inventoryVarianceRate: null,
      inventoryAnomaly: false,
      inventorySeverity: "unavailable",
      inventoryReliable: false,
      inventoryExplanation: "缺少本期或基期快照，无法进行库存消耗对账。",
    };
  }
  const openingOnHandQty = numberOrZero(previous.availableQty) + numberOrZero(previous.lockedQty);
  const closingOnHandQty = numberOrZero(current.availableQty) + numberOrZero(current.lockedQty);
  const expectedClosingQty = openingOnHandQty - outboundQty;
  const variance = closingOnHandQty - expectedClosingQty;
  const denominator = Math.max(1, Math.abs(openingOnHandQty), Math.abs(closingOnHandQty), Math.abs(outboundQty));
  const rate = Math.abs(variance) / denominator;
  const anomaly = Math.abs(variance) >= varianceThresholdQty && rate >= varianceThresholdRate;
  let explanation = "实际期末在库与按出库量推算的理论库存一致。";
  if (variance > 0) explanation = "实际库存高于理论库存，可能存在入库、退货、盘盈或正向库存调整。";
  if (variance < 0) explanation = "实际库存低于理论库存，可能存在未同步出库、盘亏、报损或负向库存调整。";
  if (!coverage.complete) explanation = `订单缓存未完整覆盖 ${coverage.requestedFrom} 至 ${coverage.requestedTo}，当前差异仅供排查参考。`;
  const severe = anomaly && Math.abs(variance) >= Math.max(20, varianceThresholdQty * 4) && rate >= Math.max(0.2, varianceThresholdRate * 2);
  return {
    openingOnHandQty: round(openingOnHandQty),
    closingOnHandQty: round(closingOnHandQty),
    outboundQty: round(outboundQty),
    expectedClosingQty: round(expectedClosingQty),
    inventoryVarianceQty: round(variance),
    inventoryVarianceRate: round(rate),
    inventoryAnomaly: anomaly,
    inventorySeverity: !coverage.complete ? "uncertain" : severe ? "danger" : anomaly ? "warning" : "normal",
    inventoryReliable: coverage.complete,
    inventoryExplanation: explanation,
  };
}

function snapshotDigest(snapshot) {
  if (!snapshot) return null;
  return {
    date: snapshot.date || "",
    timezone: snapshot.timezone || "",
    capturedAt: snapshot.capturedAt || "",
    orderSyncedAt: snapshot.orderSyncedAt || "",
    inventorySyncedAt: snapshot.inventorySyncedAt || "",
  };
}

export function buildMovementComparison({
  snapshots = [],
  orders = [],
  ranges,
  warehouseId = "",
  sku = "",
  ordersSyncedAt = "",
  orderCoverageDaysByWarehouse = {},
  varianceThresholdQty = DEFAULT_VARIANCE_QTY,
  varianceThresholdRate = DEFAULT_VARIANCE_RATE,
} = {}) {
  if (!ranges?.current || !ranges?.previous) throw new Error("缺少动销对比区间。");
  const currentSnapshot = latestSnapshotInRange(snapshots, ranges.current);
  const previousSnapshot = latestSnapshotInRange(snapshots, ranges.previous);
  const currentRows = filterRows(currentSnapshot?.rows || [], { warehouseId, sku });
  const previousRows = filterRows(previousSnapshot?.rows || [], { warehouseId, sku });
  const currentByKey = rowsByKey(currentRows);
  const previousByKey = rowsByKey(previousRows);
  const unionRows = Array.from(new Map([...previousRows, ...currentRows].map((row) => [comparisonRowKey(row), row])).values());
  const outbound = previousSnapshot && currentSnapshot
    ? aggregateOutbound(orders, unionRows, previousSnapshot.date, currentSnapshot.date, warehouseId)
    : { quantityByRow: new Map(), matchedOrderRows: 0, unmatchedOrderRows: 0, unmatchedOutboundQty: 0 };
  const coverageCache = new Map();
  const getCoverage = (row) => {
    const resolvedWarehouseId = firstText(row?.warehouseId, row?.warehouseName);
    if (!coverageCache.has(resolvedWarehouseId)) {
      coverageCache.set(resolvedWarehouseId, previousSnapshot && currentSnapshot
        ? coverageForWarehouse({
            warehouseId: resolvedWarehouseId,
            previousDate: previousSnapshot.date,
            currentDate: currentSnapshot.date,
            ordersSyncedAt,
            orderCoverageDaysByWarehouse,
          })
        : { complete: false, coverageDays: 0, coverageFrom: "", coverageTo: "", requestedFrom: "", requestedTo: "" });
    }
    return coverageCache.get(resolvedWarehouseId);
  };

  const rows = Array.from(new Set([...previousByKey.keys(), ...currentByKey.keys()])).map((key) => {
    const previous = previousByKey.get(key) || null;
    const current = currentByKey.get(key) || null;
    const identity = current || previous || {};
    const change = statusChange(previous, current);
    const coverage = getCoverage(identity);
    const reconciliation = inventoryComparison({
      previous,
      current,
      outboundQty: outbound.quantityByRow.get(key) || 0,
      coverage,
      varianceThresholdQty,
      varianceThresholdRate,
    });
    return {
      id: key,
      sku: identity.sku || "",
      countrySku: identity.countrySku || "",
      productName: identity.productName || identity.sku || "",
      brand: identity.brand || "",
      category: identity.category || "",
      country: identity.country || "",
      warehouseId: identity.warehouseId || "",
      warehouseName: identity.warehouseName || identity.warehouseId || "未分仓",
      previousStatus: previous?.status || "无记录",
      currentStatus: current?.status || "无记录",
      previousMovementClass: movementClass(previous?.status),
      currentMovementClass: movementClass(current?.status),
      previousAvailableQty: previous ? round(previous.availableQty) : null,
      currentAvailableQty: current ? round(current.availableQty) : null,
      previousSales30: previous ? round(previous.sales30) : null,
      currentSales30: current ? round(current.sales30) : null,
      previousDaysCover: previous?.daysCover ?? null,
      currentDaysCover: current?.daysCover ?? null,
      previousSnapshotDate: previousSnapshot?.date || "",
      currentSnapshotDate: currentSnapshot?.date || "",
      ...change,
      ...reconciliation,
      orderCoverage: coverage,
    };
  }).sort((a, b) => {
    const severity = { danger: 0, warning: 1, uncertain: 2, normal: 3, unavailable: 4 };
    const changeRank = { worsened: 0, changed: 1, improved: 2, added: 3, removed: 4, unchanged: 5 };
    return (severity[a.inventorySeverity] ?? 9) - (severity[b.inventorySeverity] ?? 9)
      || (changeRank[a.changeType] ?? 9) - (changeRank[b.changeType] ?? 9)
      || a.warehouseName.localeCompare(b.warehouseName, "zh-CN")
      || a.sku.localeCompare(b.sku);
  });

  const currentClassCounts = currentRows.reduce((acc, row) => {
    const key = movementClass(row.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const comparableInventoryRows = rows.filter((row) => row.inventoryVarianceQty !== null);
  const coverages = Array.from(coverageCache.values());
  return {
    ok: true,
    ranges,
    filters: { warehouseId, sku },
    thresholds: { quantity: varianceThresholdQty, rate: varianceThresholdRate },
    currentSnapshot: snapshotDigest(currentSnapshot),
    previousSnapshot: snapshotDigest(previousSnapshot),
    comparisonAvailable: Boolean(currentSnapshot),
    baselineAvailable: Boolean(previousSnapshot),
    summary: {
      currentSku: currentRows.length,
      previousSku: previousRows.length,
      normal: currentClassCounts["正常"] || 0,
      slow: currentClassCounts["慢销"] || 0,
      stagnant: currentClassCounts["滞销"] || 0,
      supplyRisk: currentClassCounts["供货风险"] || 0,
      noData: currentClassCounts["无数据"] || 0,
      changed: rows.filter((row) => row.statusChanged).length,
      unchanged: rows.filter((row) => row.changeType === "unchanged").length,
      improved: rows.filter((row) => row.changeType === "improved").length,
      worsened: rows.filter((row) => row.changeType === "worsened").length,
      added: rows.filter((row) => row.changeType === "added").length,
      removed: rows.filter((row) => row.changeType === "removed").length,
      inventoryAnomaly: rows.filter((row) => row.inventoryAnomaly).length,
      inventoryUncertain: rows.filter((row) => row.inventorySeverity === "uncertain").length,
    },
    inventorySummary: {
      openingOnHandQty: round(comparableInventoryRows.reduce((sum, row) => sum + numberOrZero(row.openingOnHandQty), 0)),
      closingOnHandQty: round(comparableInventoryRows.reduce((sum, row) => sum + numberOrZero(row.closingOnHandQty), 0)),
      outboundQty: round(comparableInventoryRows.reduce((sum, row) => sum + numberOrZero(row.outboundQty), 0)),
      expectedClosingQty: round(comparableInventoryRows.reduce((sum, row) => sum + numberOrZero(row.expectedClosingQty), 0)),
      varianceQty: round(comparableInventoryRows.reduce((sum, row) => sum + numberOrZero(row.inventoryVarianceQty), 0)),
      matchedOrderRows: outbound.matchedOrderRows,
      unmatchedOrderRows: outbound.unmatchedOrderRows,
      unmatchedOutboundQty: round(outbound.unmatchedOutboundQty),
      orderCoverageComplete: Boolean(coverages.length) && coverages.every((item) => item.complete),
      ordersSyncedAt,
    },
    rows,
  };
}

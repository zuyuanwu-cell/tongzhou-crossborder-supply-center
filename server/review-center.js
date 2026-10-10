import { applyShopDirectoryProfile } from "./shop-directory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const RESPONSE_SLA_HOURS = 24;
const CLOSE_SLA_HOURS = 72;

export function canAccessReviewCenter(auth) {
  return auth?.role === "admin";
}

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function dateKey(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function shanghaiClock(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return null;
  const shifted = new Date(timestamp + SHANGHAI_OFFSET_MS);
  return { weekday: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}

function hoursBetween(start, end) {
  const startAt = Date.parse(start || "");
  const endAt = Date.parse(end || "");
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt) return null;
  return round((endAt - startAt) / 3_600_000);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : 0;
}

function median(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const middle = Math.floor(valid.length / 2);
  return round(valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2);
}

function percentage(part, total) {
  return total ? round((number(part) / number(total)) * 100) : 0;
}

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = text(keyOf(item)) || "未分类";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: percentage(count, items.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"));
}

function rangeDates(from, to) {
  const result = [];
  const startAt = Date.parse(`${from}T00:00:00+08:00`);
  const endAt = Date.parse(`${to}T00:00:00+08:00`);
  for (let current = startAt; current <= endAt; current += DAY_MS) {
    result.push(new Date(current + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10));
  }
  return result;
}

function normalizeDate(value) {
  const candidate = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && Number.isFinite(Date.parse(`${candidate}T00:00:00+08:00`))
    ? candidate
    : "";
}

export function resolveReviewRange(input = {}, now = new Date()) {
  const today = new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  let to = normalizeDate(input.to) || today;
  let from = normalizeDate(input.from) || new Date(Date.parse(`${to}T00:00:00+08:00`) - 29 * DAY_MS + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  if (from > to) [from, to] = [to, from];
  const maxFrom = new Date(Date.parse(`${to}T00:00:00+08:00`) - 365 * DAY_MS + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  if (from < maxFrom) from = maxFrom;
  return {
    from,
    to,
    startAt: Date.parse(`${from}T00:00:00+08:00`),
    endAt: Date.parse(`${to}T23:59:59.999+08:00`),
    days: rangeDates(from, to),
  };
}

function inRange(value, range) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp >= range.startAt && timestamp <= range.endAt;
}

function collaborationGroup(targetType) {
  const source = text(targetType).toLowerCase();
  if (source.includes("after_sales")) return "售后协同";
  if (source.includes("warehouse_ticket")) return "仓库工单";
  if (source.includes("warehouse_liability")) return "费用核销";
  if (source.includes("stockup")) return "备货协同";
  if (source.includes("collaboration")) return "伙伴协同";
  if (source.includes("wms") || source.includes("warehouse_return")) return "海外仓执行";
  return "其他操作";
}

function firstResponseAt(ticket, type) {
  if (ticket.acceptedAt) return ticket.acceptedAt;
  const acceptedTypes = type === "after_sales"
    ? new Set(["accept", "await_reshipment", "shipped", "complete", "reject"])
    : new Set(["accept", "reply", "resolve"]);
  return (ticket.timeline || []).find((event) => acceptedTypes.has(text(event.type)))?.createdAt || "";
}

function closedAt(ticket, type) {
  if (type === "after_sales") return ticket.completedAt || (ticket.status === "cancelled" ? ticket.updatedAt : "");
  return ticket.resolvedAt || (ticket.status === "cancelled" ? ticket.updatedAt : "");
}

function ticketSubject(ticket, type) {
  if (type === "after_sales") return text(ticket.originalOrderNumber || ticket.secondaryReason || ticket.primaryReason || ticket.id);
  return text(ticket.title || ticket.relatedOrderNumber || ticket.category || ticket.id);
}

function ticketReason(ticket, type) {
  return type === "after_sales"
    ? text(ticket.primaryReason || ticket.secondaryReason)
    : text(ticket.category);
}

function ticketRow(ticket, type, nowIso) {
  const responseAt = firstResponseAt(ticket, type);
  const completionAt = closedAt(ticket, type);
  const responseHours = hoursBetween(ticket.createdAt, responseAt);
  const closeHours = hoursBetween(ticket.createdAt, completionAt);
  const open = !completionAt && !["cancelled"].includes(text(ticket.status));
  const ageHours = hoursBetween(ticket.createdAt, nowIso);
  return {
    id: text(ticket.id),
    type,
    typeLabel: type === "after_sales" ? "售后" : "仓库工单",
    createdAt: text(ticket.createdAt),
    updatedAt: text(ticket.updatedAt),
    warehouseId: text(ticket.warehouseId),
    warehouseName: text(ticket.warehouseName) || "未绑定仓库",
    status: text(ticket.status),
    priority: text(ticket.priority || "normal"),
    subject: ticketSubject(ticket, type),
    reason: ticketReason(ticket, type),
    responsibility: text(ticket.responsibility?.label || ticket.responsibility?.party || "未归因"),
    createdBy: text(ticket.createdBy) || "未知用户",
    responseHours,
    closeHours,
    open,
    overdue: open && number(ageHours) > RESPONSE_SLA_HOURS,
    reminderCount: (ticket.timeline || []).filter((event) => event.type === "reminder_sent").length,
    rejectionCount: Array.isArray(ticket.rejectionHistory) ? ticket.rejectionHistory.length : 0,
    liabilityCny: round(ticket.money?.totalWarehouseLiabilityCny || ticket.money?.warehouseLiabilityCny || ticket.money?.netWarehouseLiabilityCny || 0, 2),
  };
}

function statusLabel(status) {
  return ({
    pending_warehouse: "待接单",
    processing: "处理中",
    awaiting_reshipment: "待补发",
    shipped: "已发出",
    rejected: "已驳回",
    completed: "已完结",
    resolved: "已解决",
    cancelled: "已作废",
  })[status] || status || "未知";
}

function statusTone(status) {
  if (["completed", "resolved"].includes(status)) return "done";
  if (["cancelled", "rejected"].includes(status)) return "exception";
  if (["processing", "awaiting_reshipment", "shipped"].includes(status)) return "active";
  return "waiting";
}

function responseBand(hours) {
  if (!Number.isFinite(hours)) return "未响应";
  if (hours <= 4) return "≤4h";
  if (hours <= 12) return "4–12h";
  if (hours <= 24) return "12–24h";
  if (hours <= 48) return "24–48h";
  return ">48h";
}

function rangeFromTimestamps(startAt, endAt) {
  const from = new Date(startAt + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  const to = new Date(endAt + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  return {
    from,
    to,
    startAt: Date.parse(`${from}T00:00:00+08:00`),
    endAt: Date.parse(`${to}T23:59:59.999+08:00`),
    days: rangeDates(from, to),
  };
}

export function resolvePreviousReviewRange(range) {
  const previousEndAt = range.startAt - DAY_MS;
  const previousStartAt = previousEndAt - Math.max(0, range.days.length - 1) * DAY_MS;
  return rangeFromTimestamps(previousStartAt, previousEndAt);
}

function comparison(current, previous) {
  const currentValue = number(current);
  const previousValue = number(previous);
  const change = round(currentValue - previousValue, 2);
  return {
    previous: round(previousValue, 2),
    change,
    changeRate: previousValue ? round(change / previousValue * 100) : currentValue ? null : 0,
    direction: previousValue === 0 && currentValue > 0 ? "new" : change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

function comparedCounts(currentItems, previousItems, keyOf) {
  const currentMap = new Map(countBy(currentItems, keyOf).map((row) => [row.label, row]));
  const previousMap = new Map(countBy(previousItems, keyOf).map((row) => [row.label, row]));
  return [...new Set([...currentMap.keys(), ...previousMap.keys()])]
    .map((label) => {
      const current = currentMap.get(label) || { count: 0, share: 0 };
      const prior = previousMap.get(label) || { count: 0 };
      return { label, count: current.count, share: current.share, previousCount: prior.count, ...comparison(current.count, prior.count) };
    })
    .sort((a, b) => b.count - a.count || b.previousCount - a.previousCount || a.label.localeCompare(b.label, "zh-CN"));
}

function actorRows(currentLogs, previousLogs) {
  function aggregate(logs) {
    const result = new Map();
    for (const entry of logs) {
      const actorKey = text(entry.actorId || entry.actorName) || "unknown";
      const actor = result.get(actorKey) || {
        id: actorKey,
        name: text(entry.actorName) || "未知用户",
        role: text(entry.actorRole) || "未标角色",
        count: 0,
        loginCount: 0,
        collaborationCount: 0,
        dates: new Set(),
        lastAt: "",
      };
      actor.count += 1;
      actor.loginCount += entry.action === "登录系统" ? 1 : 0;
      actor.collaborationCount += collaborationGroup(entry.targetType) === "其他操作" ? 0 : 1;
      actor.dates.add(dateKey(entry.createdAt));
      if (!actor.lastAt || Date.parse(entry.createdAt) > Date.parse(actor.lastAt)) actor.lastAt = entry.createdAt;
      result.set(actorKey, actor);
    }
    return result;
  }
  const currentMap = aggregate(currentLogs);
  const previousMap = aggregate(previousLogs);
  return [...new Set([...currentMap.keys(), ...previousMap.keys()])]
    .map((id) => {
      const current = currentMap.get(id);
      const prior = previousMap.get(id);
      const count = current?.count || 0;
      const previousCount = prior?.count || 0;
      return {
        id,
        name: current?.name || prior?.name || "未知用户",
        role: current?.role || prior?.role || "未标角色",
        count,
        previousCount,
        ...comparison(count, previousCount),
        loginCount: current?.loginCount || 0,
        collaborationCount: current?.collaborationCount || 0,
        activeDays: current?.dates.size || 0,
        lastAt: current?.lastAt || "",
      };
    })
    .sort((a, b) => b.count - a.count || b.previousCount - a.previousCount || a.name.localeCompare(b.name, "zh-CN"));
}

function dailyRows(range, previousRange, logs, previousLogs) {
  function aggregate(days, source) {
    const map = new Map(days.map((date) => [date, { date, operations: 0, users: new Set(), collaboration: 0, afterSales: 0 }]));
    for (const entry of source) {
      const day = map.get(dateKey(entry.createdAt));
      if (!day) continue;
      day.operations += 1;
      day.users.add(text(entry.actorId || entry.actorName) || "unknown");
      if (collaborationGroup(entry.targetType) !== "其他操作") day.collaboration += 1;
      if (text(entry.targetType).includes("after_sales")) day.afterSales += 1;
    }
    return [...map.values()].map((day) => ({ ...day, users: day.users.size }));
  }
  const current = aggregate(range.days, logs);
  const previous = aggregate(previousRange.days, previousLogs);
  return current.map((day, index) => ({
    ...day,
    previousDate: previous[index]?.date || "",
    previousOperations: previous[index]?.operations || 0,
    previousUsers: previous[index]?.users || 0,
    previousCollaboration: previous[index]?.collaboration || 0,
    previousAfterSales: previous[index]?.afterSales || 0,
  }));
}

function summarizeTickets(rows) {
  const responseHours = rows.map((ticket) => ticket.responseHours).filter(Number.isFinite);
  const closeHours = rows.map((ticket) => ticket.closeHours).filter(Number.isFinite);
  const responseEligible = rows.filter((ticket) => Number.isFinite(ticket.responseHours) || ticket.overdue);
  const responseMet = responseEligible.filter((ticket) => Number.isFinite(ticket.responseHours) && ticket.responseHours <= RESPONSE_SLA_HOURS).length;
  const completed = rows.filter((ticket) => Number.isFinite(ticket.closeHours));
  const closeMet = completed.filter((ticket) => ticket.closeHours <= CLOSE_SLA_HOURS).length;
  return {
    total: rows.length,
    open: rows.filter((ticket) => ticket.open).length,
    completed: completed.length,
    completionRate: percentage(completed.length, rows.length),
    responseSlaRate: percentage(responseMet, responseEligible.length),
    medianResponseHours: median(responseHours),
    medianCloseHours: median(closeHours),
    overdue: rows.filter((ticket) => ticket.overdue).length,
    closeSlaRate: percentage(closeMet, completed.length),
  };
}

function warehouseRows(currentTickets, previousTickets) {
  function aggregate(rows) {
    const map = new Map();
    for (const ticket of rows) {
      const key = ticket.warehouseId || ticket.warehouseName;
      const row = map.get(key) || { id: key, name: ticket.warehouseName, tickets: [] };
      row.tickets.push(ticket);
      map.set(key, row);
    }
    return map;
  }
  const currentMap = aggregate(currentTickets);
  const previousMap = aggregate(previousTickets);
  return [...new Set([...currentMap.keys(), ...previousMap.keys()])].map((id) => {
    const current = currentMap.get(id);
    const prior = previousMap.get(id);
    const summary = summarizeTickets(current?.tickets || []);
    const previousSummary = summarizeTickets(prior?.tickets || []);
    const currentResponses = (current?.tickets || []).map((ticket) => ticket.responseHours).filter(Number.isFinite);
    const currentCloses = (current?.tickets || []).map((ticket) => ticket.closeHours).filter(Number.isFinite);
    return {
      id,
      name: current?.name || prior?.name || "未绑定仓库",
      total: summary.total,
      previousTotal: previousSummary.total,
      ...comparison(summary.total, previousSummary.total),
      open: summary.open,
      completed: summary.completed,
      overdue: summary.overdue,
      completionRate: summary.completionRate,
      previousCompletionRate: previousSummary.completionRate,
      responseSlaRate: summary.responseSlaRate,
      previousResponseSlaRate: previousSummary.responseSlaRate,
      avgResponseHours: average(currentResponses),
      avgCloseHours: average(currentCloses),
    };
  }).sort((a, b) => b.total - a.total || b.previousTotal - a.previousTotal || a.name.localeCompare(b.name, "zh-CN"));
}

function businessDateKey(value) {
  const candidate = text(value);
  const direct = candidate.match(/^(\d{4}-\d{2}-\d{2})/);
  return direct?.[1] || dateKey(candidate);
}

function orderDate(order) {
  return order?.shippedAt || order?.orderDate || order?.date || order?.createdAt || order?.orderedAt || "";
}

function attributionKey(...values) {
  return values.map((value) => text(value).toLowerCase()).filter(Boolean).join("::");
}

function productAttributionRows(currentRow, previousRow, productChangeQty) {
  const currentWarehouses = currentRow?.warehouses || new Map();
  const previousWarehouses = previousRow?.warehouses || new Map();
  const warehouseKeys = [...new Set([...currentWarehouses.keys(), ...previousWarehouses.keys()])];

  function metricRow(currentMetric, previousMetric, currentTotal, previousTotal) {
    const currentQty = round(currentMetric?.quantity || 0, 2);
    const previousQty = round(previousMetric?.quantity || 0, 2);
    const delta = comparison(currentQty, previousQty);
    return {
      currentQty,
      previousQty,
      changeQty: delta.change,
      changeRate: delta.changeRate,
      direction: delta.direction,
      currentOrders: currentMetric?.orders.size || 0,
      previousOrders: previousMetric?.orders.size || 0,
      currentShare: percentage(currentQty, currentTotal),
      previousShare: percentage(previousQty, previousTotal),
      changeContribution: productChangeQty ? round((delta.change / productChangeQty) * 100) : null,
    };
  }

  function impactSort(left, right) {
    if (productChangeQty < 0) return left.changeQty - right.changeQty || right.previousQty - left.previousQty;
    if (productChangeQty > 0) return right.changeQty - left.changeQty || right.currentQty - left.currentQty;
    return right.currentQty - left.currentQty || right.previousQty - left.previousQty;
  }

  return warehouseKeys.map((warehouseKey) => {
    const currentWarehouse = currentWarehouses.get(warehouseKey);
    const previousWarehouse = previousWarehouses.get(warehouseKey);
    const warehouseMetric = metricRow(currentWarehouse, previousWarehouse, currentRow?.quantity || 0, previousRow?.quantity || 0);
    const currentShops = currentWarehouse?.shops || new Map();
    const previousShops = previousWarehouse?.shops || new Map();
    const shopKeys = [...new Set([...currentShops.keys(), ...previousShops.keys()])];
    const shops = shopKeys.map((shopKey) => {
      const currentShop = currentShops.get(shopKey);
      const previousShop = previousShops.get(shopKey);
      return {
        id: shopKey,
        shopCode: text(currentShop?.shopCode || previousShop?.shopCode),
        shopName: text(currentShop?.shopName || previousShop?.shopName) || "未识别店铺",
        shopAlias: text(currentShop?.shopAlias || previousShop?.shopAlias),
        rawShopName: text(currentShop?.rawShopName || previousShop?.rawShopName),
        platform: text(currentShop?.platform || previousShop?.platform) || "未知平台",
        ...metricRow(currentShop, previousShop, currentRow?.quantity || 0, previousRow?.quantity || 0),
      };
    }).sort(impactSort);
    return {
      id: warehouseKey,
      warehouseId: text(currentWarehouse?.warehouseId || previousWarehouse?.warehouseId),
      warehouseName: text(currentWarehouse?.warehouseName || previousWarehouse?.warehouseName) || "未识别仓库",
      ...warehouseMetric,
      shops,
    };
  }).sort(impactSort);
}

function buildProductReview(orders, products, range, previousRange) {
  const metadata = new Map();
  for (const product of products) {
    const sku = text(product?.sku || product?.skuNo).toUpperCase();
    if (!sku) continue;
    const existing = metadata.get(sku) || {};
    metadata.set(sku, {
      name: existing.name || text(product?.name || product?.productName),
      imageUrl: existing.imageUrl || text(product?.imageUrl || product?.image),
    });
  }

  function aggregate(from, to) {
    const rows = new Map();
    const orderIds = new Set();
    for (const order of orders) {
      const date = businessDateKey(orderDate(order));
      if (!date || date < from || date > to) continue;
      const sku = text(order?.sku || order?.skuNo || order?.goodsSku).toUpperCase();
      const quantity = Math.max(0, number(order?.quantity || order?.qty || order?.outboundQty));
      if (!sku || quantity <= 0) continue;
      const orderId = text(order?.orderId || order?.orderNo || order?.externalOrderNo) || `${sku}:${date}:${rows.size}`;
      const row = rows.get(sku) || { sku, quantity: 0, orders: new Set(), name: "", warehouses: new Map() };
      row.quantity += quantity;
      row.orders.add(orderId);
      row.name ||= text(order?.productName || order?.name);

      const warehouseId = text(order?.warehouseId || order?.warehouseCode);
      const warehouseName = text(order?.warehouseName);
      const warehouseKey = attributionKey(warehouseId || warehouseName || "未识别仓库");
      const warehouse = row.warehouses.get(warehouseKey) || {
        warehouseId,
        warehouseName,
        quantity: 0,
        orders: new Set(),
        shops: new Map(),
      };
      warehouse.warehouseId ||= warehouseId;
      warehouse.warehouseName ||= warehouseName;
      warehouse.quantity += quantity;
      warehouse.orders.add(orderId);

      const platform = text(order?.platform || order?.salesPlatform);
      const shopCode = text(order?.shopCode || order?.storeCode || order?.shopId || order?.storeId);
      const shopName = text(order?.shopName || order?.storeName);
      const shopAlias = text(order?.shopAlias);
      const rawShopName = text(order?.rawShopName || order?.storeName || order?.shopName);
      const shopKey = attributionKey(platform || "未知平台", shopCode || rawShopName || shopName || "未识别店铺");
      const shop = warehouse.shops.get(shopKey) || { shopCode, shopName, shopAlias, rawShopName, platform, quantity: 0, orders: new Set() };
      shop.shopCode ||= shopCode;
      shop.shopName ||= shopName;
      shop.shopAlias ||= shopAlias;
      shop.rawShopName ||= rawShopName;
      shop.platform ||= platform;
      shop.quantity += quantity;
      shop.orders.add(orderId);
      warehouse.shops.set(shopKey, shop);
      row.warehouses.set(warehouseKey, warehouse);
      rows.set(sku, row);
      orderIds.add(orderId);
    }
    return { rows, orderCount: orderIds.size };
  }

  const current = aggregate(range.from, range.to);
  const previous = aggregate(previousRange.from, previousRange.to);
  const outboundQty = [...current.rows.values()].reduce((sum, row) => sum + row.quantity, 0);
  const previousOutboundQty = [...previous.rows.values()].reduce((sum, row) => sum + row.quantity, 0);
  const rows = [...new Set([...current.rows.keys(), ...previous.rows.keys()])].map((sku) => {
    const currentRow = current.rows.get(sku);
    const previousRow = previous.rows.get(sku);
    const currentQty = round(currentRow?.quantity || 0, 2);
    const previousQty = round(previousRow?.quantity || 0, 2);
    const delta = comparison(currentQty, previousQty);
    const meta = metadata.get(sku) || {};
    const trend = previousQty === 0 && currentQty > 0
      ? "new"
      : currentQty === 0 && previousQty > 0
        ? "dormant"
        : (delta.changeRate || 0) >= 20
          ? "growing"
          : (delta.changeRate || 0) <= -20
            ? "declining"
            : "stable";
    return {
      sku,
      productName: meta.name || currentRow?.name || previousRow?.name || sku,
      imageUrl: meta.imageUrl || "",
      currentQty,
      previousQty,
      changeQty: delta.change,
      changeRate: delta.changeRate,
      direction: delta.direction,
      currentOrders: currentRow?.orders.size || 0,
      previousOrders: previousRow?.orders.size || 0,
      share: percentage(currentQty, outboundQty),
      trend,
      warehouses: productAttributionRows(currentRow, previousRow, delta.change),
    };
  });
  const head = rows.filter((row) => row.currentQty > 0).sort((a, b) => b.currentQty - a.currentQty || a.sku.localeCompare(b.sku)).slice(0, 12).map((row, index) => ({ ...row, rank: index + 1 }));
  const growth = rows.filter((row) => row.changeQty > 0).sort((a, b) => b.changeQty - a.changeQty || b.currentQty - a.currentQty).slice(0, 12).map((row, index) => ({ ...row, rank: index + 1 }));
  const decline = rows.filter((row) => row.changeQty < 0).sort((a, b) => a.changeQty - b.changeQty || b.previousQty - a.previousQty).slice(0, 12).map((row, index) => ({ ...row, rank: index + 1 }));
  const tail = rows.filter((row) => row.previousQty > 0 || row.currentQty > 0).sort((a, b) => {
    const aDormant = a.currentQty === 0 && a.previousQty > 0 ? 0 : 1;
    const bDormant = b.currentQty === 0 && b.previousQty > 0 ? 0 : 1;
    return aDormant - bDormant || a.currentQty - b.currentQty || b.previousQty - a.previousQty;
  }).slice(0, 12).map((row, index) => ({ ...row, rank: index + 1 }));
  const headQty = head.slice(0, 10).reduce((sum, row) => sum + row.currentQty, 0);
  const previousHeadQty = [...previous.rows.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10).reduce((sum, row) => sum + row.quantity, 0);
  const headShare = percentage(headQty, outboundQty);
  const previousHeadShare = percentage(previousHeadQty, previousOutboundQty);
  return {
    source: "WMS 已出库订单",
    summary: {
      outboundQty,
      outboundComparison: comparison(outboundQty, previousOutboundQty),
      activeSku: current.rows.size,
      activeSkuComparison: comparison(current.rows.size, previous.rows.size),
      orderCount: current.orderCount,
      orderCountComparison: comparison(current.orderCount, previous.orderCount),
      headShare,
      headShareComparison: comparison(headShare, previousHeadShare),
      newSkuCount: rows.filter((row) => row.trend === "new").length,
      dormantSkuCount: rows.filter((row) => row.trend === "dormant").length,
    },
    head,
    growth,
    decline,
    tail,
  };
}

export function buildReviewCenterPayload(input = {}) {
  const range = resolveReviewRange(input.range || input, input.now instanceof Date ? input.now : new Date(input.now || Date.now()));
  const previousRange = resolvePreviousReviewRange(range);
  const nowIso = input.now instanceof Date ? input.now.toISOString() : new Date(input.now || Date.now()).toISOString();
  const allLogs = Array.isArray(input.actionLogs) ? input.actionLogs : [];
  const logs = allLogs.filter((entry) => inRange(entry.createdAt, range));
  const previousLogs = allLogs.filter((entry) => inRange(entry.createdAt, previousRange));
  const afterSales = (Array.isArray(input.afterSalesTickets) ? input.afterSalesTickets : []).filter((ticket) => inRange(ticket.createdAt, range));
  const previousAfterSales = (Array.isArray(input.afterSalesTickets) ? input.afterSalesTickets : []).filter((ticket) => inRange(ticket.createdAt, previousRange));
  const warehouseTickets = (Array.isArray(input.warehouseTickets) ? input.warehouseTickets : []).filter((ticket) => inRange(ticket.createdAt, range));
  const previousWarehouseTickets = (Array.isArray(input.warehouseTickets) ? input.warehouseTickets : []).filter((ticket) => inRange(ticket.createdAt, previousRange));
  const ticketRows = [
    ...afterSales.map((ticket) => ticketRow(ticket, "after_sales", nowIso)),
    ...warehouseTickets.map((ticket) => ticketRow(ticket, "warehouse_ticket", nowIso)),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const previousTicketRows = [
    ...previousAfterSales.map((ticket) => ticketRow(ticket, "after_sales", nowIso)),
    ...previousWarehouseTickets.map((ticket) => ticketRow(ticket, "warehouse_ticket", nowIso)),
  ];
  const actors = actorRows(logs, previousLogs);
  const daily = dailyRows(range, previousRange, logs, previousLogs);

  const heatmap = Array.from({ length: 7 }, (_, weekday) => ({ weekday, hours: Array(24).fill(0) }));
  for (const entry of logs) {
    const clock = shanghaiClock(entry.createdAt);
    if (clock) heatmap[clock.weekday].hours[clock.hour] += 1;
  }

  const ticketSummary = summarizeTickets(ticketRows);
  const previousTicketSummary = summarizeTickets(previousTicketRows);
  const warehouses = warehouseRows(ticketRows, previousTicketRows);

  const statusCounts = comparedCounts(ticketRows, previousTicketRows, (ticket) => statusLabel(ticket.status)).map((row) => {
    const source = ticketRows.find((ticket) => statusLabel(ticket.status) === row.label);
    const previousSource = previousTicketRows.find((ticket) => statusLabel(ticket.status) === row.label);
    return { ...row, status: source?.status || previousSource?.status || "", tone: statusTone(source?.status || previousSource?.status || "") };
  });
  const reasonCounts = comparedCounts(afterSales, previousAfterSales, (ticket) => ticket.primaryReason);
  const secondaryReasons = comparedCounts(afterSales, previousAfterSales, (ticket) => ticket.secondaryReason);
  const responsibility = comparedCounts(afterSales, previousAfterSales, (ticket) => ticket.responsibility?.label || ticket.responsibility?.party || "未归因");
  const responseBands = ["≤4h", "4–12h", "12–24h", "24–48h", ">48h", "未响应"].map((label) => ({
    label,
    count: ticketRows.filter((ticket) => responseBand(ticket.responseHours) === label).length,
    previousCount: previousTicketRows.filter((ticket) => responseBand(ticket.responseHours) === label).length,
  })).map((row) => ({
    ...row,
    ...comparison(row.count, row.previousCount),
  }));

  const overview = {
    activeUsers: actors.filter((actor) => actor.count > 0).length,
    operations: logs.length,
    operationsPerUser: actors.filter((actor) => actor.count > 0).length ? round(logs.length / actors.filter((actor) => actor.count > 0).length) : 0,
    collaborationTasks: ticketSummary.total,
    openTasks: ticketSummary.open,
    completionRate: ticketSummary.completionRate,
    responseSlaRate: ticketSummary.responseSlaRate,
    medianResponseHours: ticketSummary.medianResponseHours,
    medianCloseHours: ticketSummary.medianCloseHours,
    overdueTasks: ticketSummary.overdue,
    afterSalesTickets: afterSales.length,
    warehouseTickets: warehouseTickets.length,
    closeSlaRate: ticketSummary.closeSlaRate,
  };
  const previousOverview = {
    activeUsers: actors.filter((actor) => actor.previousCount > 0).length,
    operations: previousLogs.length,
    operationsPerUser: actors.filter((actor) => actor.previousCount > 0).length ? round(previousLogs.length / actors.filter((actor) => actor.previousCount > 0).length) : 0,
    collaborationTasks: previousTicketSummary.total,
    openTasks: previousTicketSummary.open,
    completionRate: previousTicketSummary.completionRate,
    responseSlaRate: previousTicketSummary.responseSlaRate,
    medianResponseHours: previousTicketSummary.medianResponseHours,
    medianCloseHours: previousTicketSummary.medianCloseHours,
    overdueTasks: previousTicketSummary.overdue,
    afterSalesTickets: previousAfterSales.length,
    warehouseTickets: previousWarehouseTickets.length,
    closeSlaRate: previousTicketSummary.closeSlaRate,
  };
  const overviewComparison = Object.fromEntries(Object.keys(overview).map((key) => [key, comparison(overview[key], previousOverview[key])]));
  const productRows = Array.isArray(input.products) ? input.products : [];
  const outboundOrders = Array.isArray(input.outboundOrders) ? input.outboundOrders : [];
  const reviewOrders = input.shopDirectory?.byKey instanceof Map
    ? outboundOrders.map((order) => text(order?.providerId).toLowerCase() === "sea_wms"
      ? applyShopDirectoryProfile(order, input.shopDirectory)
      : order)
    : outboundOrders;
  const products = buildProductReview(reviewOrders, productRows, range, previousRange);

  return {
    ok: true,
    generatedAt: nowIso,
    range: { from: range.from, to: range.to, days: range.days.length, timeZone: "Asia/Shanghai" },
    comparison: {
      previousRange: { from: previousRange.from, to: previousRange.to, days: previousRange.days.length },
      overview: overviewComparison,
    },
    thresholds: { responseSlaHours: RESPONSE_SLA_HOURS, closeSlaHours: CLOSE_SLA_HOURS },
    coverage: {
      actionLogStored: allLogs.length,
      actionLogFrom: allLogs.length ? allLogs.reduce((oldest, entry) => !oldest || Date.parse(entry.createdAt) < Date.parse(oldest) ? entry.createdAt : oldest, "") : "",
      actionLogTo: allLogs.length ? allLogs.reduce((latest, entry) => !latest || Date.parse(entry.createdAt) > Date.parse(latest) ? entry.createdAt : latest, "") : "",
      actionLogAtCapacity: allLogs.length >= number(input.actionLogLimit || 5000),
    },
    overview,
    usage: {
      daily,
      actors,
      actions: comparedCounts(logs, previousLogs, (entry) => entry.action),
      modules: comparedCounts(logs, previousLogs, (entry) => collaborationGroup(entry.targetType)),
      heatmap,
      entries: logs.slice(0, 240).map((entry) => ({
        id: text(entry.id),
        createdAt: text(entry.createdAt),
        actorId: text(entry.actorId || entry.actorName),
        actorName: text(entry.actorName) || "未知用户",
        actorRole: text(entry.actorRole),
        action: text(entry.action),
        targetType: text(entry.targetType),
        targetName: text(entry.targetName),
        module: collaborationGroup(entry.targetType),
      })),
    },
    collaboration: {
      statuses: statusCounts,
      warehouses,
      responseBands,
      tickets: ticketRows.slice(0, 240),
    },
    afterSales: {
      total: afterSales.length,
      reasons: reasonCounts,
      secondaryReasons,
      responsibility,
      rejectionCount: afterSales.reduce((sum, ticket) => sum + (Array.isArray(ticket.rejectionHistory) ? ticket.rejectionHistory.length : 0), 0),
      reminderCount: afterSales.reduce((sum, ticket) => sum + (ticket.timeline || []).filter((event) => event.type === "reminder_sent").length, 0),
      liabilityCny: round(ticketRows.filter((ticket) => ticket.type === "after_sales").reduce((sum, ticket) => sum + ticket.liabilityCny, 0), 2),
    },
    products,
  };
}

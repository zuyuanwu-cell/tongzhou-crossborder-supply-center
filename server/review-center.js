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

export function buildReviewCenterPayload(input = {}) {
  const range = resolveReviewRange(input.range || input, input.now instanceof Date ? input.now : new Date(input.now || Date.now()));
  const nowIso = input.now instanceof Date ? input.now.toISOString() : new Date(input.now || Date.now()).toISOString();
  const allLogs = Array.isArray(input.actionLogs) ? input.actionLogs : [];
  const logs = allLogs.filter((entry) => inRange(entry.createdAt, range));
  const afterSales = (Array.isArray(input.afterSalesTickets) ? input.afterSalesTickets : []).filter((ticket) => inRange(ticket.createdAt, range));
  const warehouseTickets = (Array.isArray(input.warehouseTickets) ? input.warehouseTickets : []).filter((ticket) => inRange(ticket.createdAt, range));
  const ticketRows = [
    ...afterSales.map((ticket) => ticketRow(ticket, "after_sales", nowIso)),
    ...warehouseTickets.map((ticket) => ticketRow(ticket, "warehouse_ticket", nowIso)),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const actorMap = new Map();
  for (const entry of logs) {
    const actorKey = text(entry.actorId || entry.actorName) || "unknown";
    const actor = actorMap.get(actorKey) || {
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
    actorMap.set(actorKey, actor);
  }
  const actors = [...actorMap.values()]
    .map((actor) => ({ ...actor, activeDays: actor.dates.size, dates: undefined }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));

  const dailyMap = new Map(range.days.map((date) => [date, { date, operations: 0, users: new Set(), collaboration: 0, afterSales: 0 }]));
  for (const entry of logs) {
    const day = dailyMap.get(dateKey(entry.createdAt));
    if (!day) continue;
    day.operations += 1;
    day.users.add(text(entry.actorId || entry.actorName) || "unknown");
    if (collaborationGroup(entry.targetType) !== "其他操作") day.collaboration += 1;
    if (text(entry.targetType).includes("after_sales")) day.afterSales += 1;
  }
  const daily = [...dailyMap.values()].map((day) => ({ ...day, users: day.users.size }));

  const heatmap = Array.from({ length: 7 }, (_, weekday) => ({ weekday, hours: Array(24).fill(0) }));
  for (const entry of logs) {
    const clock = shanghaiClock(entry.createdAt);
    if (clock) heatmap[clock.weekday].hours[clock.hour] += 1;
  }

  const responseHours = ticketRows.map((ticket) => ticket.responseHours).filter(Number.isFinite);
  const closeHours = ticketRows.map((ticket) => ticket.closeHours).filter(Number.isFinite);
  const responseEligible = ticketRows.filter((ticket) => Number.isFinite(ticket.responseHours) || ticket.overdue);
  const responseMet = responseEligible.filter((ticket) => Number.isFinite(ticket.responseHours) && ticket.responseHours <= RESPONSE_SLA_HOURS).length;
  const completedRows = ticketRows.filter((ticket) => Number.isFinite(ticket.closeHours));
  const closeMet = completedRows.filter((ticket) => ticket.closeHours <= CLOSE_SLA_HOURS).length;

  const warehouseMap = new Map();
  for (const ticket of ticketRows) {
    const key = ticket.warehouseId || ticket.warehouseName;
    const row = warehouseMap.get(key) || {
      id: key,
      name: ticket.warehouseName,
      total: 0,
      open: 0,
      completed: 0,
      overdue: 0,
      responseHours: [],
      closeHours: [],
    };
    row.total += 1;
    row.open += ticket.open ? 1 : 0;
    row.completed += Number.isFinite(ticket.closeHours) ? 1 : 0;
    row.overdue += ticket.overdue ? 1 : 0;
    if (Number.isFinite(ticket.responseHours)) row.responseHours.push(ticket.responseHours);
    if (Number.isFinite(ticket.closeHours)) row.closeHours.push(ticket.closeHours);
    warehouseMap.set(key, row);
  }
  const warehouses = [...warehouseMap.values()]
    .map((warehouse) => ({
      id: warehouse.id,
      name: warehouse.name,
      total: warehouse.total,
      open: warehouse.open,
      completed: warehouse.completed,
      overdue: warehouse.overdue,
      completionRate: percentage(warehouse.completed, warehouse.total),
      responseSlaRate: percentage(warehouse.responseHours.filter((hours) => hours <= RESPONSE_SLA_HOURS).length, warehouse.responseHours.length),
      avgResponseHours: average(warehouse.responseHours),
      avgCloseHours: average(warehouse.closeHours),
    }))
    .sort((a, b) => b.total - a.total || b.overdue - a.overdue || a.name.localeCompare(b.name, "zh-CN"));

  const statusCounts = countBy(ticketRows, (ticket) => statusLabel(ticket.status)).map((row) => {
    const source = ticketRows.find((ticket) => statusLabel(ticket.status) === row.label);
    return { ...row, status: source?.status || "", tone: statusTone(source?.status || "") };
  });
  const reasonCounts = countBy(afterSales, (ticket) => ticket.primaryReason);
  const secondaryReasons = countBy(afterSales, (ticket) => ticket.secondaryReason);
  const responsibility = countBy(afterSales, (ticket) => ticket.responsibility?.label || ticket.responsibility?.party || "未归因");
  const responseBands = ["≤4h", "4–12h", "12–24h", "24–48h", ">48h", "未响应"].map((label) => ({
    label,
    count: ticketRows.filter((ticket) => responseBand(ticket.responseHours) === label).length,
  }));

  return {
    ok: true,
    generatedAt: nowIso,
    range: { from: range.from, to: range.to, days: range.days.length, timeZone: "Asia/Shanghai" },
    thresholds: { responseSlaHours: RESPONSE_SLA_HOURS, closeSlaHours: CLOSE_SLA_HOURS },
    coverage: {
      actionLogStored: allLogs.length,
      actionLogFrom: allLogs.length ? allLogs.reduce((oldest, entry) => !oldest || Date.parse(entry.createdAt) < Date.parse(oldest) ? entry.createdAt : oldest, "") : "",
      actionLogTo: allLogs.length ? allLogs.reduce((latest, entry) => !latest || Date.parse(entry.createdAt) > Date.parse(latest) ? entry.createdAt : latest, "") : "",
      actionLogAtCapacity: allLogs.length >= number(input.actionLogLimit || 5000),
    },
    overview: {
      activeUsers: actors.length,
      operations: logs.length,
      operationsPerUser: actors.length ? round(logs.length / actors.length) : 0,
      collaborationTasks: ticketRows.length,
      openTasks: ticketRows.filter((ticket) => ticket.open).length,
      completionRate: percentage(completedRows.length, ticketRows.length),
      responseSlaRate: percentage(responseMet, responseEligible.length),
      medianResponseHours: median(responseHours),
      medianCloseHours: median(closeHours),
      overdueTasks: ticketRows.filter((ticket) => ticket.overdue).length,
      afterSalesTickets: afterSales.length,
      warehouseTickets: warehouseTickets.length,
      closeSlaRate: percentage(closeMet, completedRows.length),
    },
    usage: {
      daily,
      actors,
      actions: countBy(logs, (entry) => entry.action),
      modules: countBy(logs, (entry) => collaborationGroup(entry.targetType)),
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
  };
}

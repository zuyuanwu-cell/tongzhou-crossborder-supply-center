const TERMINAL_STATUSES = new Set(["completed", "cancelled", "rejected"]);

function pad(value) { return String(value).padStart(2, "0"); }

function dayStart(value) {
  const source = value instanceof Date ? value : new Date(value || Date.now());
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dueDate(item) {
  const raw = item?.dueAt || (typeof item?.publicPayload?.deliveryDate === "string" ? item.publicPayload.deliveryDate : "");
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function deadlineMeta(item, referenceDate) {
  const due = dueDate(item);
  if (!due) return { key: "unscheduled", label: "待补交期", days: null, dateKey: "" };
  const today = dayStart(referenceDate);
  const deadline = dayStart(due);
  const days = Math.round((deadline.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { key: "overdue", label: `已逾期 ${Math.max(1, Math.abs(days))} 天`, days, dateKey: dateKey(deadline) };
  if (days === 0) return { key: "dueSoon", label: "今天到期", days, dateKey: dateKey(deadline) };
  if (days <= 7) return { key: "dueSoon", label: `${days} 天后到期`, days, dateKey: dateKey(deadline) };
  return { key: "scheduled", label: `交期 ${pad(due.getMonth() + 1)}/${pad(due.getDate())}`, days, dateKey: dateKey(deadline) };
}

function activeOrders(items) {
  return (items || []).filter((item) => ["production_order", "purchase_order"].includes(item.itemType) && !TERMINAL_STATUSES.has(item.status));
}

function activeDeliveryItems(items) {
  return (items || []).filter((item) => !TERMINAL_STATUSES.has(item.status));
}

function priorityRank(item, referenceDate) {
  const deadline = deadlineMeta(item, referenceDate);
  if (deadline.key === "overdue") return 0;
  if (deadline.key === "dueSoon") return 1;
  if (item.priority === "urgent") return 2;
  if (deadline.key === "unscheduled") return 4;
  return 3;
}

function sortOrders(items, referenceDate) {
  return [...(items || [])].sort((left, right) => {
    const rank = priorityRank(left, referenceDate) - priorityRank(right, referenceDate);
    if (rank) return rank;
    const leftDue = dueDate(left)?.getTime() || Number.MAX_SAFE_INTEGER;
    const rightDue = dueDate(right)?.getTime() || Number.MAX_SAFE_INTEGER;
    return leftDue - rightDue || new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
}

function focusOrders(items, focus, referenceDate) {
  return sortOrders(items.filter((item) => {
    const deadline = deadlineMeta(item, referenceDate);
    if (!focus || focus === "all") return true;
    if (focus === "normal") return item.priority === "normal" && deadline.key !== "overdue";
    if (focus === "urgent") return item.priority === "urgent" && deadline.key !== "overdue";
    if (["overdue", "dueSoon", "unscheduled"].includes(focus)) return deadline.key === focus;
    if (focus.startsWith("day:")) return deadline.dateKey === focus.slice(4);
    return true;
  }), referenceDate);
}

function buildDeliveryOverview(items, dashboard, focus, referenceDate, mode) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
  const orders = activeDeliveryItems(items);
  const overdue = orders.filter((item) => deadlineMeta(item, now).key === "overdue");
  const dueSoon = orders.filter((item) => deadlineMeta(item, now).key === "dueSoon");
  const unscheduled = orders.filter((item) => deadlineMeta(item, now).key === "unscheduled");
  const urgent = orders.filter((item) => item.priority === "urgent" && deadlineMeta(item, now).key !== "overdue");
  const normal = orders.filter((item) => item.priority !== "urgent" && deadlineMeta(item, now).key !== "overdue");
  const baseDay = dayStart(now);
  const rawDays = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(baseDay);
    date.setDate(baseDay.getDate() + index);
    const key = dateKey(date);
    const matches = orders.filter((item) => deadlineMeta(item, now).dateKey === key);
    return {
      key,
      focus: `day:${key}`,
      day: date.getDate(),
      weekday: index === 0 ? "今天" : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()],
      count: matches.length,
      urgent: matches.filter((item) => item.priority === "urgent").length,
    };
  });
  const maxCount = Math.max(1, ...rawDays.map((item) => item.count));
  const days = rawDays.map((item) => Object.assign({}, item, { barHeight: Math.max(item.count ? 18 : 4, Math.round(item.count / maxCount * 100)) }));
  const selectedFocus = focus || (urgent.length ? "urgent" : dueSoon.length ? "dueSoon" : overdue.length ? "overdue" : "all");
  const selected = focusOrders(orders, selectedFocus, now).slice(0, 4).map((item) => Object.assign({}, item, { deadline: deadlineMeta(item, now) }));
  return {
    focus: selectedFocus,
    metrics: mode === "production" ? [
      { key: "production", icon: "产", label: "在产加工单", value: dashboard?.productionOrders ?? orders.filter((item) => item.itemType === "production_order").length, note: "仅本组织订单", tone: "navy" },
      { key: "purchase", icon: "采", label: "物料采购单", value: dashboard?.purchaseOrders ?? orders.filter((item) => item.itemType === "purchase_order").length, note: "兼任供应商订单", tone: "green" },
      { key: "dueSoon", icon: "期", label: "临期订单", value: dueSoon.length, note: "7 天内到期", tone: "orange" },
      { key: "exception", icon: "异", label: "异常记录", value: dashboard?.exceptionReports ?? 0, note: "需持续跟进", tone: "violet" },
    ] : [
      { key: "purchase", icon: "采", label: "采购单", value: dashboard?.purchaseOrders ?? orders.filter((item) => item.itemType === "purchase_order").length, note: "仅本组织订单", tone: "navy" },
      { key: "dueSoon", icon: "期", label: "临期交付", value: dueSoon.length, note: "7 天内到期", tone: "orange" },
      { key: "exception", icon: "异", label: "异常记录", value: dashboard?.exceptionReports ?? 0, note: "需持续跟进", tone: "violet" },
      { key: "waiting", icon: "审", label: "等待中台", value: dashboard?.waitingTasks ?? 0, note: "提交后自动同步", tone: "green" },
    ],
    priority: [
      { key: "all", label: "进行中", value: orders.length },
      { key: "overdue", label: "已逾期", value: overdue.length },
      { key: "urgent", label: "紧急", value: urgent.length },
      { key: "normal", label: "常规", value: normal.length },
    ],
    alerts: [
      { key: "overdue", label: "逾期订单", value: overdue.length, tone: "danger" },
      { key: "dueSoon", label: "7 天内到期", value: dueSoon.length, tone: "warning" },
      { key: "unscheduled", label: "待补交期", value: unscheduled.length, tone: "neutral" },
    ],
    days,
    selected,
    selectedCount: focusOrders(orders, selectedFocus, now).length,
  };
}

function buildProductionOverview(items, dashboard, focus, referenceDate) {
  return buildDeliveryOverview(items, dashboard, focus, referenceDate, "production");
}

function productionSteps(processText, reports) {
  const steps = String(processText || "").split(/[、,，;；>→\n]+/).map((item) => item.trim()).filter(Boolean);
  const fallback = ["排产准备", "物料准备", "生产加工", "质检", "待发货"];
  const list = steps.length ? steps : fallback;
  const progress = [...(reports || [])].find((item) => item.reportType === "production_progress") || {};
  const exception = [...(reports || [])].find((item) => item.reportType === "exception") || {};
  const percent = Math.max(0, Math.min(100, Number(progress.progressPercent || 0)));
  const stageWords = {
    planning: ["排产", "准备"], material_preparation: ["物料", "备料"],
    filling: ["灌装", "生产", "加工"], packaging: ["包装", "装盒", "装箱", "贴标", "打码"],
    quality_check: ["质检", "检验", "测试"], ready_to_ship: ["发货", "出库"],
  };
  const matchedIndex = list.findIndex((step) => (stageWords[progress.stage] || []).some((word) => step.includes(word)));
  const current = percent >= 100 ? list.length : matchedIndex >= 0 ? matchedIndex : Math.min(list.length - 1, Math.floor(percent / Math.max(1, 100 / list.length)));
  const blocked = Boolean(exception.createdAt && (!progress.createdAt || Date.parse(exception.createdAt) > Date.parse(progress.createdAt)) && percent < 100);
  return list.map((label, index) => ({
    number: index + 1,
    label,
    state: percent >= 100 || index < current ? "completed" : index === current ? blocked ? "blocked" : "current" : "pending",
    note: index === current ? (blocked ? exception.note || exception.title || "存在待处理异常" : progress.note || "等待工厂更新") : "",
  }));
}

module.exports = { TERMINAL_STATUSES, dateKey, dueDate, deadlineMeta, activeOrders, activeDeliveryItems, sortOrders, buildDeliveryOverview, buildProductionOverview, productionSteps };

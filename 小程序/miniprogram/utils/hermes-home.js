const { decorateTask } = require("./format");
const { deadlineMeta, sortOrders } = require("./production");

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "rejected"]);

const TYPE_PRESENTATION = Object.freeze({
  production_order: { badge: "加工", tone: "cyan", actionLabel: "汇报进度" },
  purchase_order: { badge: "采购", tone: "violet", actionLabel: "更新交付" },
  sampling_task: { badge: "打样", tone: "orange", actionLabel: "更新打样" },
  packaging_quote: { badge: "报价", tone: "green", actionLabel: "提交报价" },
});

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function progressValue(item) {
  const payload = item?.publicPayload || {};
  const value = payload.progressPercent ?? payload.fulfillmentPercent ?? item?.progressPercent;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : null;
}

function quantityText(item) {
  const payload = item?.publicPayload || {};
  const quantity = payload.quantity ?? payload.plannedQuantity ?? payload.orderQuantity;
  if (quantity == null || quantity === "") return "";
  return `${quantity}${payload.unit || "件"}`;
}

function decorateHomeTask(item, referenceDate) {
  const decorated = decorateTask(item);
  const presentation = TYPE_PRESENTATION[item.itemType] || { badge: decorated.typeLabel, tone: "blue", actionLabel: "查看任务" };
  const deadline = deadlineMeta(item, referenceDate);
  const payload = item.publicPayload || {};
  const progress = progressValue(item);
  return Object.assign({}, decorated, presentation, {
    productName: payload.productName || payload.productTitle || item.title || "协同任务",
    quantityText: quantityText(item),
    progress,
    progressText: progress == null ? decorated.statusLabel : `${progress}%`,
    deadlineTone: deadline.key === "overdue" ? "danger" : deadline.key === "dueSoon" ? "warning" : "neutral",
    deadlineLabel: deadline.label,
    reportPrompt: `${payload.productName || payload.productTitle || item.title || "这个产品"}现在进度是`,
    // Hermes V2 design: single-character tile coloured by business line.
    tileIcon: decorated.typeIcon || String(presentation.badge || "单").slice(0, 1),
    tileTone: ({ production_order: "orange", purchase_order: "green", sampling_task: "violet" })[item.itemType] || "cyan",
    statusNote: progress == null ? decorated.statusLabel : `进度 ${progress}%`,
  });
}

function buildPartnerHome(items, dashboard, mode, referenceDate, preferences = {}) {
  const now = referenceDate instanceof Date ? referenceDate : new Date(referenceDate || Date.now());
  const active = (items || []).filter((item) => !TERMINAL_STATUSES.has(item.status));
  const ordered = preferences.dueReminder === false ? active : sortOrders(active, now);
  const dueSoon = active.filter((item) => {
    const meta = deadlineMeta(item, now);
    return meta.key === "overdue" || meta.key === "dueSoon";
  });
  const production = active.filter((item) => item.itemType === "production_order");
  const purchase = active.filter((item) => item.itemType === "purchase_order");
  const sampling = active.filter((item) => item.itemType === "sampling_task");
  const todayTasks = ordered.slice(0, 3).map((item) => decorateHomeTask(item, now));
  if (mode === "warehouse") {
    // Warehouse partners work on inbound/outbound/stockup tasks; Hermes quick reports
    // (production milestones) do not apply, so show warehouse-relevant counts only.
    const pending = active.filter((item) => item.status === "pending");
    const working = active.filter((item) => ["accepted", "in_progress"].includes(item.status));
    const waiting = active.filter((item) => ["pending_approval", "pending_sync"].includes(item.status));
    return {
      metrics: [
        { key: "pending", label: "待接单", value: pending.length, tone: "orange" },
        { key: "working", label: "处理中", value: working.length, tone: "cyan" },
        { key: "due", label: "7 天到期", value: dueSoon.length, tone: "orange" },
        { key: "waiting", label: "等中台确认", value: waiting.length, tone: "violet" },
      ],
      todayTasks,
      suggestions: [],
      activeCount: active.length,
      dueSoonCount: dueSoon.length,
    };
  }
  const productionMode = mode === "production";
  const metrics = productionMode ? [
    { key: "production", label: "在产加工", value: production.length, tone: "cyan" },
    { key: "purchase", label: "物料采购", value: purchase.length, tone: "violet" },
    { key: "due", label: "7 天到期", value: dueSoon.length, tone: "orange" },
    { key: "exception", label: "异常", value: numberValue(dashboard?.exceptionReports), tone: "red" },
  ] : [
    { key: "purchase", label: "履约订单", value: purchase.length, tone: "cyan" },
    { key: "sampling", label: "打样任务", value: sampling.length, tone: "violet" },
    { key: "due", label: "7 天到期", value: dueSoon.length, tone: "orange" },
    { key: "exception", label: "异常", value: numberValue(dashboard?.exceptionReports), tone: "red" },
  ];
  const suggestions = productionMode ? [
    { label: `${String(todayTasks[0]?.referenceNo || "941").replace(/\D/g, "").slice(-3) || "941"} 灌装完成了`, action: "quick_report", prompt: `${todayTasks[0]?.productName || "这个产品"}灌装完成了` },
    { label: "拍照上报异常", action: "photo_report" },
    { label: "填发货单号", action: "tasks", itemType: "production_order" },
    { label: "这周哪些单要交货？", action: "tasks" },
  ] : [
    { label: "汇报一个订单的交付进度", action: "tasks", itemType: "purchase_order" },
    { label: "上报到货异常", action: "tasks", itemType: "purchase_order" },
    { label: "查看临期订单", action: "tasks" },
  ];
  return { metrics, todayTasks, suggestions, activeCount: active.length, dueSoonCount: dueSoon.length };
}

module.exports = { decorateHomeTask, buildPartnerHome };

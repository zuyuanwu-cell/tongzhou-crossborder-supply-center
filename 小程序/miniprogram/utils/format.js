const { deadlineMeta } = require("./production");

const STATUS_META = {
  pending: { label: "待接单", tone: "amber", step: 0 },
  accepted: { label: "已接单", tone: "blue", step: 1 },
  in_progress: { label: "处理中", tone: "blue", step: 1 },
  pending_approval: { label: "待审批", tone: "violet", step: 2 },
  pending_sync: { label: "待同步", tone: "violet", step: 2 },
  completed: { label: "已完成", tone: "green", step: 3 },
  rejected: { label: "已驳回", tone: "red", step: 2 },
  cancelled: { label: "已取消", tone: "gray", step: 2 },
};

const TYPE_META = {
  warehouse_inbound: { label: "入库", icon: "入" },
  warehouse_outbound: { label: "出库", icon: "出" },
  warehouse_transfer: { label: "调拨", icon: "调" },
  warehouse_stockup: { label: "备货", icon: "备" },
  warehouse_exception: { label: "异常", icon: "异" },
  filing_task: { label: "备案", icon: "备" },
  sampling_task: { label: "打样", icon: "样" },
  packaging_quote: { label: "包装报价", icon: "价" },
  production_order: { label: "加工单", icon: "产" },
  purchase_order: { label: "采购单", icon: "采" },
};

const TYPE_STATUS_LABELS = {
  packaging_quote: { pending: "待报价", accepted: "报价准备", in_progress: "报价准备", pending_sync: "报价已提交", completed: "已定标", rejected: "未中标" },
  filing_task: { pending: "待受理", accepted: "已受理", in_progress: "办理中", pending_sync: "结果已提交" },
  sampling_task: { pending: "待接样", accepted: "已接样", in_progress: "打样中", pending_sync: "结果已提交" },
  production_order: { pending: "待接单", accepted: "已接单", in_progress: "生产中", pending_sync: "进度已提交" },
  purchase_order: { pending: "待确认", accepted: "履约中", in_progress: "履约中", pending_sync: "反馈已提交", completed: "已交付" },
};

function pad(value) { return String(value).padStart(2, "0"); }

function formatDate(value, withTime) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const base = `${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
  return withTime === false ? base : `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatFullDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relativeTime(value) {
  if (!value) return "刚刚";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return formatDate(value, false);
}

function decorateTask(item) {
  const status = STATUS_META[item.status] || STATUS_META.pending;
  const type = TYPE_META[item.itemType] || { label: "任务", icon: "单" };
  const payload = item.publicPayload || {};
  const isWarehouse = String(item.itemType || "").startsWith("warehouse_");
  const isPartnerOrder = ["production_order", "purchase_order"].includes(item.itemType);
  const deadline = deadlineMeta(item);
  return Object.assign({}, item, {
    statusLabel: TYPE_STATUS_LABELS[item.itemType]?.[item.status] || status.label,
    statusTone: status.tone,
    progressStep: status.step,
    typeLabel: type.label,
    typeIcon: type.icon,
    referenceNo: payload.orderNo || payload.referenceNo || payload.projectCode || `V${item.version || 1}`,
    sourceName: isWarehouse ? (payload.sourceWarehouseName || payload.warehouseName || "供应链中台") : "同舟供应链中心",
    destinationName: isWarehouse ? (payload.destinationWarehouseName || payload.productName || payload.warehouseName || "本组织") : (payload.productName || "本组织项目"),
    sourceLabel: isWarehouse ? "来源" : "协同方",
    destinationLabel: isWarehouse ? "去向" : "项目",
    isWarehouse,
    isPartnerOrder,
    dueText: formatDate(item.dueAt),
    deadlineKey: deadline.key,
    deadlineText: deadline.label,
    updatedText: relativeTime(item.updatedAt),
    isUrgent: item.priority === "urgent",
  });
}

function roleLabel(role) {
  return ({ organization_admin: "组织管理员", manager: "业务经理", operator: "作业员", finance: "财务", viewer: "查看员" })[role] || "协同成员";
}

module.exports = { STATUS_META, TYPE_META, formatDate, formatFullDate, relativeTime, decorateTask, roleLabel };

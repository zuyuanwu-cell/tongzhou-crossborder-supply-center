const { formatDate, formatFullDate, relativeTime, STATUS_META, TYPE_META } = require("./format");

const ORGANIZATION_TYPES = {
  warehouse: { label: "仓库", symbol: "仓" },
  filing_service: { label: "备案服务", symbol: "备" },
  sampling_factory: { label: "打样工厂", symbol: "样" },
  packaging_factory: { label: "包装供应", symbol: "包" },
  material_supplier: { label: "物料供应", symbol: "供" },
  production_factory: { label: "委外生产", symbol: "产" },
  internal: { label: "内部组织", symbol: "内" },
};

const COMMAND_LABELS = {
  accept: "伙伴接单",
  progress: "进度反馈",
  complete: "申请完成",
  report_exception: "异常反馈",
  inbound_confirm: "入库确认",
  outbound_confirm: "出库确认",
  transfer_receive: "调拨收货",
  inventory_adjustment: "库存调整",
  stockup_process: "备货处理",
  quote_submit: "供应商报价",
  artifact_submit: "资料结果提交",
  milestone_update: "里程碑更新",
  partner_order_report: "订单履约反馈",
};

function decorateAdminTask(item) {
  const status = STATUS_META[item.status] || STATUS_META.pending;
  const type = TYPE_META[item.itemType] || { label: "协同任务", icon: "单" };
  const payload = item.publicPayload || {};
  const dueTime = Date.parse(item.dueAt || "");
  const overdue = Number.isFinite(dueTime) && dueTime < Date.now() && !["completed", "cancelled", "rejected"].includes(item.status);
  return Object.assign({}, item, {
    organizationLabel: item.organizationName || item.organizationCode || "未标组织",
    referenceNo: payload.orderNo || payload.referenceNo || payload.projectCode || item.coreRefId || "—",
    statusLabel: status.label,
    statusTone: status.tone,
    typeLabel: type.label,
    typeIcon: type.icon,
    dueText: formatDate(item.dueAt),
    updatedText: relativeTime(item.updatedAt),
    isUrgent: item.priority === "urgent",
    isOverdue: overdue,
    deadlineLabel: overdue ? "已逾期" : item.dueAt ? `截止 ${formatDate(item.dueAt, false)}` : "未排期",
  });
}

function payloadSummary(payload) {
  const source = payload || {};
  if (Array.isArray(source.lines) && source.lines.length) return `${source.lines.length} 条明细待确认`;
  return String(source.note || source.reason || source.action || source.stage || "伙伴提交了一项待审核操作").slice(0, 80);
}

function decorateApproval(item) {
  return Object.assign({}, item, {
    commandLabel: COMMAND_LABELS[item.commandType] || item.commandType || "协同操作",
    submittedText: formatFullDate(item.submittedAt),
    payloadText: payloadSummary(item.payload),
    organizationLabel: item.organizationCode || "未标组织",
    riskLabel: item.riskLevel === "high" ? "高风险" : "需复核",
  });
}

function decorateOrganization(item) {
  const meta = ORGANIZATION_TYPES[item.organizationType] || { label: "协同伙伴", symbol: "协" };
  return Object.assign({}, item, {
    typeLabel: meta.label,
    symbol: meta.symbol,
    statusLabel: item.status === "active" ? "正常协同" : item.status === "suspended" ? "已暂停" : "已归档",
    statusTone: item.status === "active" ? "green" : item.status === "suspended" ? "amber" : "gray",
    lastLoginText: item.lastLoginAt ? relativeTime(item.lastLoginAt) : "暂无登录",
  });
}

function taskFacts(item) {
  const payload = item?.publicPayload || {};
  const definitions = [
    ["orderNo", "订单号"], ["referenceNo", "业务单号"], ["projectCode", "项目编号"],
    ["productName", "产品"], ["productSpec", "规格"], ["quantity", "数量"],
    ["unit", "单位"], ["deliveryDate", "交付日期"], ["warehouseName", "协同仓"],
    ["destinationWarehouseName", "目标仓"], ["stage", "当前阶段"], ["fulfillmentMode", "履约方式"],
  ];
  return definitions.flatMap(([key, label]) => payload[key] === undefined || payload[key] === "" ? [] : [{ key, label, value: String(payload[key]) }]);
}

module.exports = {
  COMMAND_LABELS,
  ORGANIZATION_TYPES,
  decorateAdminTask,
  decorateApproval,
  decorateOrganization,
  taskFacts,
};

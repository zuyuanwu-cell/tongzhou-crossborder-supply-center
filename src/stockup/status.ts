export const stockupRequestStatusLabels: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  purchasing: "采购中",
  warehouse_inspection: "仓库验货",
  inspection_review: "验货待审核",
  inventory_ready: "国内库存就绪",
  inventory_reserved: "库存已锁定",
  wms_created: "待生成/下发发运文件",
  instruction_issued: "待交货代",
  handed_over: "在途中",
  overseas_received: "海外仓已收货",
  cost_locked: "到仓成本已锁定",
  pending_acceptance: "待受理",
  needs_changes: "待补充",
  accepted: "已受理",
  in_progress: "采购/生产中",
  waiting_shipment: "待发运",
  shipped: "已发运",
  partially_arrived: "部分到仓",
  arrived: "已到仓",
  costing: "成本核算中",
  completed: "已完成",
  rejected: "已驳回",
  cancelled: "已取消",
};

export const stockupTaskStatusLabels: Record<string, string> = {
  pending_assignment: "待分派",
  pending_order: "待下单",
  ordered: "已下单",
  in_progress: "采购/生产中",
  completed: "已完工",
  waiting_consolidation: "待集货",
  consolidated: "已到集货仓",
  packing: "打包中",
  waiting_shipment: "待发运",
  shipped: "已发运",
  customs: "清关中",
  waiting_receipt: "待收货",
  partially_received: "部分收货",
  received: "已收货",
  shelved: "已上架",
  terminated: "已终止",
};

export function statusTone(status: string) {
  if (["completed", "arrived", "received", "shelved", "inventory_ready", "handed_over", "overseas_received", "cost_locked"].includes(status)) return "success";
  if (["needs_changes", "rejected", "cancelled", "terminated"].includes(status)) return "danger";
  if (["submitted", "pending_acceptance", "pending_order", "waiting_shipment", "shipped", "partially_arrived", "inspection_review", "inventory_reserved", "wms_created", "instruction_issued"].includes(status)) return "warning";
  return "active";
}
export function formatStockupDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: value.includes("T") ? "2-digit" : undefined, minute: value.includes("T") ? "2-digit" : undefined }).format(date);
}

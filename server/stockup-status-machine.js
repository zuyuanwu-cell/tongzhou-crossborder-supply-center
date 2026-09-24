const REQUEST_TRANSITIONS = {
  draft: new Set(["pending_acceptance", "cancelled"]),
  pending_acceptance: new Set(["accepted", "needs_changes", "rejected", "cancelled"]),
  needs_changes: new Set(["pending_acceptance", "cancelled"]),
  accepted: new Set(["in_progress", "cancelled"]),
  in_progress: new Set(["waiting_shipment", "partially_arrived", "arrived", "cancelled"]),
  waiting_shipment: new Set(["shipped", "partially_arrived", "cancelled"]),
  shipped: new Set(["partially_arrived", "arrived", "cancelled"]),
  partially_arrived: new Set(["arrived", "costing", "cancelled"]),
  arrived: new Set(["costing", "completed"]),
  costing: new Set(["completed"]),
  completed: new Set(),
  rejected: new Set(["draft"]),
  cancelled: new Set(),
};

export const REQUEST_STATUS_LABELS = {
  draft: "草稿",
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

export const TASK_STATUS_LABELS = {
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

export function assertRequestTransition(from, to) {
  const allowed = REQUEST_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    const error = new Error(`需求状态不能从“${REQUEST_STATUS_LABELS[from] || from}”变更为“${REQUEST_STATUS_LABELS[to] || to}”。`);
    error.code = "invalid_transition";
    error.statusCode = 409;
    throw error;
  }
}
export function assertReceiptQuantities({ expectedQty = 0, receivedQty = 0, goodQty = 0, damagedQty = 0, shortageQty = 0, pendingQty = 0 }) {
  const values = { expectedQty, receivedQty, goodQty, damagedQty, shortageQty, pendingQty };
  for (const [key, raw] of Object.entries(values)) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      const error = new Error(`${key} 必须是大于或等于 0 的数字。`);
      error.code = "invalid_quantity";
      error.statusCode = 400;
      throw error;
    }
  }
  if (Math.abs(Number(receivedQty) - Number(goodQty) - Number(damagedQty) - Number(pendingQty)) > 0.000001) {
    const error = new Error("实收数量必须等于良品、破损和待处理数量之和。");
    error.code = "quantity_mismatch";
    error.statusCode = 400;
    throw error;
  }
  if (Math.abs(Number(expectedQty) - Number(receivedQty) - Number(shortageQty)) > 0.000001) {
    const error = new Error("应到数量必须等于实收数量与短少数量之和。");
    error.code = "quantity_mismatch";
    error.statusCode = 400;
    throw error;
  }
}

export function deriveRequestStatus({ currentStatus, taskStatuses = [], shippedQty = 0, requestedQty = 0, receivedQty = 0, goodQty = 0, costsLocked = false }) {
  if (["draft", "pending_acceptance", "needs_changes", "rejected", "cancelled"].includes(currentStatus)) return currentStatus;
  const requested = Number(requestedQty || 0);
  const shipped = Number(shippedQty || 0);
  const received = Number(receivedQty || 0);
  const good = Number(goodQty || 0);
  if (costsLocked && requested > 0 && good >= requested) return "completed";
  if (received > 0 && received < Math.max(requested, shipped)) return "partially_arrived";
  if (received > 0 && received >= Math.max(1, shipped || requested)) return costsLocked ? "completed" : "arrived";
  if (shipped > 0) return "shipped";
  if (taskStatuses.some((status) => ["completed", "waiting_consolidation", "consolidated", "packing", "waiting_shipment"].includes(status))) return "waiting_shipment";
  if (taskStatuses.length) return "in_progress";
  return currentStatus === "accepted" ? "accepted" : "in_progress";
}

export function requestProgress(status) {
  return {
    draft: 4,
    pending_acceptance: 10,
    needs_changes: 8,
    accepted: 20,
    in_progress: 42,
    waiting_shipment: 58,
    shipped: 72,
    partially_arrived: 82,
    arrived: 90,
    costing: 95,
    completed: 100,
    rejected: 0,
    cancelled: 0,
  }[status] ?? 0;
}

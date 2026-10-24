function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const STOCKUP_PROGRESS_NODES = Object.freeze([
  { key: "accepted", label: "需求已受理" },
  { key: "route_confirmed", label: "履约方案已确认" },
  { key: "execution_progress", label: "采购/生产进度变化" },
  { key: "warehouse_received", label: "国内仓验收入库" },
  { key: "shipment_created", label: "发运计划已创建" },
  { key: "shipment_handover", label: "已交接货代" },
  { key: "shipment_dispatched", label: "货物已发运" },
  { key: "overseas_received", label: "海外仓已收货" },
  { key: "cost_locked", label: "成本已锁定" },
  { key: "exception", label: "异常/退回" },
]);

const STOCKUP_PROGRESS_NODE_KEYS = new Set(STOCKUP_PROGRESS_NODES.map((item) => item.key));

export function normalizeStockupProgressNodes(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item))
    .filter((item) => STOCKUP_PROGRESS_NODE_KEYS.has(item)))];
}

export function resolveStockupSceneDelivery(scene = {}, node = "") {
  if (!scene?.enabled) return { shouldSend: false, reason: "disabled", robotIds: [] };
  const robotIds = [...new Set((Array.isArray(scene.robotIds) ? scene.robotIds : []).map(text).filter(Boolean))];
  if (!robotIds.length) return { shouldSend: false, reason: "recipients_missing", robotIds };
  const normalizedNode = text(node);
  if (normalizedNode && !normalizeStockupProgressNodes(scene.progressNodes).includes(normalizedNode)) {
    return { shouldSend: false, reason: "node_disabled", robotIds };
  }
  return { shouldSend: true, reason: "ready", robotIds };
}

function absoluteStockupLink(linkUrl, requestOrigin, requestId) {
  const configured = text(linkUrl);
  if (/^https?:\/\//i.test(configured)) return configured;
  const origin = text(requestOrigin).replace(/\/$/, "");
  const query = requestId ? `?stockupRequest=${encodeURIComponent(requestId)}` : "";
  const hash = configured.startsWith("#") ? configured : "#stockup-execution";
  return origin ? `${origin}/${query}${hash}` : `${query}${hash}`;
}

export function buildStockupRequestSubmittedMarkdown(request = {}, options = {}) {
  const lines = Array.isArray(request.lines) ? request.lines : [];
  const quantity = lines.reduce((sum, line) => sum + number(line?.requestedQty), 0);
  const units = [...new Set(lines.map((line) => text(line?.unit)).filter(Boolean))];
  const quantityLabel = units.length === 1 ? `${quantity.toLocaleString("zh-CN")} ${units[0]}` : `${quantity.toLocaleString("zh-CN")} 件`;
  const link = absoluteStockupLink(options.linkUrl, options.requestOrigin, request.id);
  return [
    "### 新备货需求待接单",
    `> 备货单：**${text(request.requestNo) || "-"}**`,
    `> 项目团队：${text(request.project) || "-"}`,
    `> 目的仓：${text(request.destinationCountry) || "-"} · ${text(request.destinationWarehouseName) || "-"}`,
    `> 期望到仓：${text(request.expectedArrivalAt).slice(0, 10) || "-"}`,
    `> 产品数量：${lines.length} 个产品 · ${quantityLabel}`,
    `> 优先级：${text(request.priority) || "常规"}`,
    `> 提交人：${text(request.requesterName) || "-"}`,
    "",
    "**下一步：**供应链负责人请进入执行台认领，并确认国内现货、跨仓调拨、采购或委外生产的履约方案。",
    text(options.extraText),
    link ? `[进入供应链执行台](${link})` : "",
  ].filter(Boolean).join("\n");
}

export function buildStockupRequestProgressMarkdown(request = {}, event = {}, options = {}) {
  const node = text(event.node);
  const nodeLabel = STOCKUP_PROGRESS_NODES.find((item) => item.key === node)?.label || text(event.title) || "进度已更新";
  const link = absoluteStockupLink(options.linkUrl, options.requestOrigin, request.id);
  return [
    `### 备货需求进度：${nodeLabel}`,
    `> 备货单：**${text(request.requestNo) || "-"}**`,
    `> 目的仓：${text(request.destinationCountry) || "-"} · ${text(request.destinationWarehouseName) || "-"}`,
    `> 当前阶段：${text(event.stage || request.journeyStage || request.status) || "-"}`,
    text(event.detail) ? `> 进度说明：${text(event.detail)}` : "",
    text(event.actorName) ? `> 更新人：${text(event.actorName)}` : "",
    text(options.extraText),
    link ? `[查看备货需求详情](${link})` : "",
  ].filter(Boolean).join("\n");
}

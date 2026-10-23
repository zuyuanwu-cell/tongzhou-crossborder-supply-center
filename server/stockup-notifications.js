function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function absoluteStockupLink(linkUrl, requestOrigin, requestId) {
  const configured = text(linkUrl);
  if (/^https?:\/\//i.test(configured)) return configured;
  const origin = text(requestOrigin).replace(/\/$/, "");
  const query = requestId ? `?stockupRequest=${encodeURIComponent(requestId)}` : "";
  return `${origin}/${query}#stockup-execution`;
}

export function buildStockupRequestSubmittedMarkdown(request = {}, options = {}) {
  const lines = Array.isArray(request.lines) ? request.lines : [];
  const quantity = lines.reduce((sum, line) => sum + number(line?.requestedQty), 0);
  const units = [...new Set(lines.map((line) => text(line?.unit)).filter(Boolean))];
  const quantityLabel = units.length === 1 ? `${quantity.toLocaleString("zh-CN")} ${units[0]}` : `${quantity.toLocaleString("zh-CN")} 件`;
  const link = absoluteStockupLink(options.linkUrl, options.requestOrigin, request.id);
  return [
    "### 新备货需求待认领",
    `> 备货单：**${text(request.requestNo) || "-"}**`,
    `> 项目团队：${text(request.project) || "-"}`,
    `> 目的仓：${text(request.destinationCountry) || "-"} · ${text(request.destinationWarehouseName) || "-"}`,
    `> 期望到仓：${text(request.expectedArrivalAt).slice(0, 10) || "-"}`,
    `> 产品数量：${lines.length} 个产品 · ${quantityLabel}`,
    `> 优先级：${text(request.priority) || "常规"}`,
    `> 提交人：${text(request.requesterName) || "-"}`,
    "",
    "**下一步：**供应链负责人请进入执行台认领，再登记采购单并持续更新到货进度。",
    link ? `[进入供应链执行台](${link})` : "",
  ].filter(Boolean).join("\n");
}

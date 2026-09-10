import { normalizedCountryKey } from "./performance-analytics.js";

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

export function afterSalesWarehouseOptions(order = {}, warehouses = [], dataScopes = {}) {
  const allowedWarehouseIds = new Set(unique(dataScopes?.warehouseIds));
  const allowed = (Array.isArray(warehouses) ? warehouses : []).filter((warehouse) => (
    !allowedWarehouseIds.size || allowedWarehouseIds.has(text(warehouse?.id))
  ));
  const countryKey = normalizedCountryKey(order?.site || order?.customer?.country);
  const countryMatches = allowed.filter((warehouse) => normalizedCountryKey(warehouse?.country) === countryKey);
  const candidates = countryMatches.length ? countryMatches : allowed;
  return candidates.map((warehouse) => ({
    id: text(warehouse?.id),
    name: text(warehouse?.name || warehouse?.id),
    country: text(warehouse?.country),
  })).filter((warehouse) => warehouse.id && warehouse.name);
}

export function notificationRobotIds(scene = {}, warehouseId = "") {
  const warehouseIds = unique(scene?.warehouseRobotIds?.[text(warehouseId)]);
  return warehouseIds.length ? warehouseIds : unique(scene?.robotIds);
}

export function afterSalesNotificationLink(linkUrl, requestOrigin = "", params = {}) {
  const link = text(linkUrl) || "#after-sales";
  const origin = text(requestOrigin).replace(/\/$/, "");
  const absolute = /^https?:\/\//i.test(link)
    ? link
    : origin
      ? (link.startsWith("#") ? `${origin}/${link}` : `${origin}/${link.replace(/^\//, "")}`)
      : link;
  const queryEntries = Object.entries(params)
    .map(([key, value]) => [text(key), text(value)])
    .filter(([key, value]) => key && value);
  if (!queryEntries.length) return absolute;
  const hashIndex = absolute.indexOf("#");
  const base = hashIndex >= 0 ? absolute.slice(0, hashIndex) : absolute;
  const hash = hashIndex >= 0 ? absolute.slice(hashIndex + 1) : "after-sales";
  const [route = "after-sales", rawQuery = ""] = hash.split("?", 2);
  const query = new URLSearchParams(rawQuery);
  for (const [key, value] of queryEntries) query.set(key, value);
  return `${base}#${route || "after-sales"}?${query.toString()}`;
}

export function buildAfterSalesCreatedMarkdown(ticket = {}, options = {}) {
  const reissueQuantity = (ticket.reissueItems || []).reduce((sum, item) => sum + number(item?.quantity), 0);
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin, {
    module: "after_sales",
    view: "warehouse",
    ticket: ticket.id,
  });
  return [
    "### 新售后单待处理",
    `> 售后单：**${text(ticket.id) || "-"}**`,
    `> 处理仓库：${text(ticket.warehouseName) || "待分配"}`,
    `> 原订单：${text(ticket.originalOrderNumber) || "-"}`,
    `> 店铺：${text(ticket.shopAlias || ticket.platformShopName) || "未配置"}`,
    `> 问题：${text(ticket.primaryReason) || "-"} / ${text(ticket.secondaryReason) || "-"}`,
    `> 补发：${ticket.needsReissue ? `${reissueQuantity} 件` : "无需补发"}`,
    `> 仓库承担：¥${number(ticket.money?.totalWarehouseLiabilityCny).toFixed(2)}`,
    text(options.extraText),
    linkUrl ? `[进入仓库协同中心](${linkUrl})` : "",
  ].filter(Boolean).join("\n");
}

export function buildWarehouseTicketCreatedMarkdown(ticket = {}, options = {}) {
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin, {
    module: "tickets",
    view: "warehouse",
    ticket: ticket.id,
  });
  return [
    `### ${ticket.priority === "urgent" ? "紧急" : "新"}仓库工单待处理`,
    `> 工单：**${text(ticket.id) || "-"}**`,
    `> 处理仓库：${text(ticket.warehouseName) || "待分配"}`,
    `> 类型：${text(ticket.category) || "-"}`,
    text(ticket.relatedOrderNumber) ? `> 关联订单：${text(ticket.relatedOrderNumber)}` : "",
    `> 主题：${text(ticket.title) || "-"}`,
    text(options.extraText),
    linkUrl ? `[进入仓库协同中心](${linkUrl})` : "",
  ].filter(Boolean).join("\n");
}

export function buildWarehouseTicketProgressMarkdown(ticket = {}, options = {}) {
  const latest = Array.isArray(ticket.timeline) ? ticket.timeline.at(-1) : null;
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin, {
    module: "tickets",
    view: "mine",
    ticket: ticket.id,
  });
  return [
    `### 仓库工单更新：${text(latest?.label || options.statusLabel) || "状态已更新"}`,
    `> 工单：**${text(ticket.id) || "-"}**`,
    `> 处理仓库：${text(ticket.warehouseName) || "待分配"}`,
    `> 主题：${text(ticket.title) || "-"}`,
    `> 当前状态：${text(options.statusLabel) || text(ticket.status) || "-"}`,
    text(latest?.note) ? `> 处理说明：${text(latest.note)}` : "",
    text(options.extraText),
    linkUrl ? `[查看仓库工单](${linkUrl})` : "",
  ].filter(Boolean).join("\n");
}

export function buildAfterSalesProgressMarkdown(ticket = {}, options = {}) {
  const latest = Array.isArray(ticket.timeline) ? ticket.timeline.at(-1) : null;
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin, {
    module: "after_sales",
    view: "mine",
    ticket: ticket.id,
  });
  return [
    `### 售后进度更新：${text(latest?.label || options.statusLabel) || "状态已更新"}`,
    `> 售后单：**${text(ticket.id) || "-"}**`,
    `> 原订单：${text(ticket.originalOrderNumber) || "-"}`,
    `> 处理仓库：${text(ticket.warehouseName) || "待分配"}`,
    `> 当前状态：${text(options.statusLabel) || text(ticket.status) || "-"}`,
    `> 更新人：${text(latest?.actor) || "系统"}`,
    ticket.labelUploads?.length ? `> 补发面单：已上传 ${ticket.labelUploads.length} 张` : "",
    text(latest?.note) ? `> 处理说明：${text(latest.note)}` : "",
    text(options.extraText),
    linkUrl ? `[查看售后进度](${linkUrl})` : "",
  ].filter(Boolean).join("\n");
}

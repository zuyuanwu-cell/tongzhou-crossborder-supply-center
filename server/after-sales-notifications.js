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

export function afterSalesNotificationLink(linkUrl, requestOrigin = "") {
  const link = text(linkUrl) || "#after-sales";
  if (/^https?:\/\//i.test(link)) return link;
  const origin = text(requestOrigin).replace(/\/$/, "");
  if (!origin) return link;
  return link.startsWith("#") ? `${origin}/${link}` : `${origin}/${link.replace(/^\//, "")}`;
}

export function buildAfterSalesCreatedMarkdown(ticket = {}, options = {}) {
  const reissueQuantity = (ticket.reissueItems || []).reduce((sum, item) => sum + number(item?.quantity), 0);
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin);
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
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin);
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
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin);
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
  const linkUrl = afterSalesNotificationLink(options.linkUrl, options.requestOrigin);
  return [
    `### 售后进度更新：${text(latest?.label || options.statusLabel) || "状态已更新"}`,
    `> 售后单：**${text(ticket.id) || "-"}**`,
    `> 原订单：${text(ticket.originalOrderNumber) || "-"}`,
    `> 处理仓库：${text(ticket.warehouseName) || "待分配"}`,
    `> 当前状态：${text(options.statusLabel) || text(ticket.status) || "-"}`,
    `> 更新人：${text(latest?.actor) || "系统"}`,
    text(latest?.note) ? `> 处理说明：${text(latest.note)}` : "",
    text(options.extraText),
    linkUrl ? `[查看售后进度](${linkUrl})` : "",
  ].filter(Boolean).join("\n");
}

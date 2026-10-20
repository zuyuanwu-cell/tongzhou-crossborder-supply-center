const CORE_SYNC_EVENT_TYPES = Object.freeze(["core.projection", "core.oem_projection"]);
const CORE_SYNC_NOTIFICATION_TITLES = Object.freeze([
  "协同任务已更新",
  "OEM 协同任务已更新",
  "订单内容已由中台更新",
  "库存同步完成",
]);

function text(value) {
  return String(value || "").trim();
}

function isCoreSyncEvent(event) {
  const item = event || {};
  if (!CORE_SYNC_EVENT_TYPES.includes(text(item.eventType))) return false;
  const metadata = item.metadata || {};
  const version = Number(metadata.version || 0);
  if (metadata.initial === true || version === 1) return false;
  if (version > 1) return true;
  return /(?:订单|任务|数据|库存).*?(?:由中台更新|同步更新|已发布或更新)/.test(text(item.body));
}

function isCoreSyncNotification(notification) {
  const item = notification || {};
  const title = text(item.title);
  const body = text(item.body);
  if (CORE_SYNC_NOTIFICATION_TITLES.includes(title)) return true;
  return /(?:订单|任务|数据|库存).*?(?:由中台更新|同步完成|同步更新)/.test(`${title} ${body}`);
}

function visibleWorkItemEvents(events) {
  return (Array.isArray(events) ? events : []).filter((item) => !isCoreSyncEvent(item));
}

function visibleNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((item) => !isCoreSyncNotification(item));
}

module.exports = {
  CORE_SYNC_EVENT_TYPES,
  CORE_SYNC_NOTIFICATION_TITLES,
  isCoreSyncEvent,
  isCoreSyncNotification,
  visibleWorkItemEvents,
  visibleNotifications,
};

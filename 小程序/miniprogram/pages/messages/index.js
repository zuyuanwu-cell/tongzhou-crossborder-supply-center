const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { relativeTime } = require("../../utils/format");

Page({
  data: { items: [], loading: true, error: "", unread: 0 },
  onShow() { if (requireSession("partner")) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.fetchNotifications();
      const items = result.items.map((item) => {
        const category = item.category || "任务通知";
        return Object.assign({}, item, { timeText: relativeTime(item.createdAt), unread: !item.readAt, category, categoryInitial: category.slice(0, 1) });
      });
      this.setData({ items, unread: items.filter((item) => item.unread).length });
    } catch (error) { this.setData({ error: error.message || "消息读取失败。" }); }
    finally { this.setData({ loading: false }); }
  },
  async openMessage(event) {
    const item = this.data.items[event.currentTarget.dataset.index];
    if (!item) return;
    if (item.unread) {
      try { await api.markNotificationRead(item.id); } catch (_) { /* 保留跳转能力 */ }
      this.setData({ [`items[${event.currentTarget.dataset.index}].unread`]: false, unread: Math.max(0, this.data.unread - 1) });
    }
    if (item.workItemId) wx.navigateTo({ url: `/pages/task-detail/index?id=${item.workItemId}` });
  },
  async markAllRead() {
    const unread = this.data.items.filter((item) => item.unread);
    if (!unread.length) return;
    wx.showLoading({ title: "正在处理" });
    // hideLoading also closes any toast, so it must run before the result toast is shown.
    const results = await Promise.all(unread.map((item) => api.markNotificationRead(item.id).then(() => item.id, () => null)));
    wx.hideLoading();
    const done = new Set(results.filter(Boolean));
    const items = this.data.items.map((item) => (done.has(item.id) ? Object.assign({}, item, { unread: false }) : item));
    this.setData({ items, unread: items.filter((item) => item.unread).length });
    if (done.size === unread.length) wx.showToast({ title: "已全部标记为已读" });
    else wx.showToast({ title: `${unread.length - done.size} 条没标记成功，请稍后再试`, icon: "none" });
  }
});

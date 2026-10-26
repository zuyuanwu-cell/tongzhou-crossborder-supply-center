const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { decorateTask, formatDate } = require("../../utils/format");
const { getWorkspace, quickActions } = require("../../utils/workspace");
const { buildDeliveryOverview } = require("../../utils/production");
const { buildPartnerHome } = require("../../utils/hermes-home");
const { preferenceStorageKey, normalizePreferences } = require("../../utils/partner-preferences");

function timeText(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

Page({
  data: {
    session: null,
    dashboard: null,
    tasks: [],
    loading: true,
    error: "",
    greeting: "早上好",
    today: "",
    syncText: "同步中",
    unread: 0,
    workspace: null,
    profile: null,
    quickActions: [],
    fourthMetric: null,
    showScan: false,
    isProduction: false,
    isDeliveryMode: false,
    deliveryMode: "procurement",
    deliveryItems: [],
    deliveryOverview: null,
    partnerAi: null,
    clockText: "",
    hermesHome: null,
    todayReportTasks: [],
    homeMetrics: [],
    hermesSuggestions: [],
    assistantPreferences: { voiceFirst: true, dueReminder: true },
  },

  onLoad() {
    const hour = new Date().getHours();
    const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    const date = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    this.setData({ greeting, today: `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`, clockText: timeText(date) });
    this._clockTimer = setInterval(() => this.setData({ clockText: timeText() }), 60_000);
  },

  onUnload() { if (this._clockTimer) clearInterval(this._clockTimer); },

  onShow() {
    const session = requireSession("partner");
    if (!session) return;
    const workspace = getWorkspace(session);
    let storedPreferences = null;
    try { storedPreferences = wx.getStorageSync(preferenceStorageKey(session.user.id)); } catch (_) {}
    const isDeliveryMode = workspace.taskTypes.some((type) => ["production_order", "purchase_order"].includes(type));
    this.setData({
      session,
      workspace,
      profile: workspace.profile,
      quickActions: quickActions(workspace),
      showScan: workspace.kind === "warehouse" && workspace.modules.includes("inventory"),
      isProduction: workspace.kind === "production_factory",
      isDeliveryMode,
      deliveryMode: workspace.kind === "production_factory" ? "production" : "procurement",
      assistantPreferences: normalizePreferences(storedPreferences),
    });
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [summary, work] = await Promise.all([api.fetchDashboard(), api.fetchWorkItems({ limit: 100 })]);
      const workspace = this.data.workspace;
      const fourthMetric = workspace.kind === "warehouse" && workspace.modules.includes("inventory")
        ? { icon: "库", label: "可见 SKU", value: summary.dashboard.inventorySkuCount || 0, note: "仅限授权仓库", action: "inventory", tone: "green" }
        : { icon: "信", label: "未读消息", value: summary.dashboard.unreadNotifications || 0, note: "本组织待查看", action: "messages", tone: "green" };
      const latestUpdatedAt = work.items[0]?.updatedAt || "";
      const deliveryItems = this.data.isDeliveryMode ? work.items : [];
      const deliveryOverview = this.data.isDeliveryMode
        ? buildDeliveryOverview(deliveryItems, summary.dashboard, "", undefined, this.data.deliveryMode)
        : null;
      if (deliveryOverview) deliveryOverview.selected = deliveryOverview.selected.map(decorateTask);
      const hermesHome = this.data.isDeliveryMode
        ? buildPartnerHome(deliveryItems, summary.dashboard, this.data.deliveryMode, undefined, this.data.assistantPreferences)
        : buildPartnerHome(work.items, summary.dashboard, "general", undefined, this.data.assistantPreferences);
      this.setData({
        dashboard: summary.dashboard,
        tasks: this.data.isDeliveryMode ? [] : work.items.filter((item) => !["completed", "cancelled"].includes(item.status)).slice(0, 3).map(decorateTask),
        deliveryItems,
        deliveryOverview,
        partnerAi: summary.dashboard.partnerAi || null,
        unread: summary.dashboard.unreadNotifications || 0,
        syncText: formatDate(workspace.kind === "warehouse" ? summary.dashboard.inventorySyncedAt : latestUpdatedAt),
        fourthMetric,
        hermesHome,
        todayReportTasks: hermesHome.todayTasks,
        homeMetrics: hermesHome.metrics,
        hermesSuggestions: hermesHome.suggestions,
      });
    } catch (error) {
      this.setData({ error: error.message || "工作台加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectDeliveryFocus(event) {
    const focus = event.currentTarget.dataset.focus || "all";
    const overview = buildDeliveryOverview(this.data.deliveryItems, this.data.dashboard, focus, undefined, this.data.deliveryMode);
    overview.selected = overview.selected.map(decorateTask);
    this.setData({ deliveryOverview: overview });
  },

  openProductionType(event) {
    const itemType = event.currentTarget.dataset.type;
    if (!itemType) return;
    wx.redirectTo({ url: `/pages/tasks/index?itemType=${encodeURIComponent(itemType)}` });
  },

  openTasks() { wx.redirectTo({ url: "/pages/tasks/index" }); },
  openTask(event) { wx.navigateTo({ url: `/pages/task-detail/index?id=${event.currentTarget.dataset.id}` }); },
  openOperation(event) { wx.navigateTo({ url: `/pages/operation/index?type=${event.currentTarget.dataset.type}` }); },
  openInventory() { wx.redirectTo({ url: "/pages/inventory/index" }); },
  openHermesProgress() { wx.navigateTo({ url: "/pages/ai-progress/index" }); },

  openHermesWithPrompt(prompt) {
    const query = prompt ? `?prompt=${encodeURIComponent(prompt)}` : "";
    wx.navigateTo({ url: `/pages/ai-progress/index${query}` });
  },

  openTodayTask(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/task-detail/index?id=${encodeURIComponent(id)}` });
  },

  runHermesSuggestion(event) {
    const suggestion = this.data.hermesSuggestions[Number(event.currentTarget.dataset.index)];
    if (!suggestion) return;
    if (suggestion.action === "quick_report" && this.data.partnerAi?.quickReportEnabled) return this.openHermesWithPrompt(suggestion.prompt);
    const query = suggestion.itemType ? `?itemType=${encodeURIComponent(suggestion.itemType)}` : "";
    wx.redirectTo({ url: `/pages/tasks/index${query}` });
  },

  openShortcut(event) {
    const action = this.data.quickActions[Number(event.currentTarget.dataset.index)];
    if (!action) return;
    if (action.key === "scan") return this.scan();
    if (action.key === "inventory") return this.openInventory();
    if (action.key === "operation") return wx.navigateTo({ url: `/pages/operation/index?type=${action.operationType}` });
    if (action.key === "messages") return wx.redirectTo({ url: "/pages/messages/index" });
    if (action.key === "profile") return wx.redirectTo({ url: "/pages/profile/index" });
    const query = [];
    if (action.itemType) query.push(`itemType=${encodeURIComponent(action.itemType)}`);
    if (action.sampleCategory) query.push(`sampleCategory=${encodeURIComponent(action.sampleCategory)}`);
    if (action.status) query.push(`status=${encodeURIComponent(action.status)}`);
    wx.redirectTo({ url: `/pages/tasks/index${query.length ? `?${query.join("&")}` : ""}` });
  },

  openFourthMetric() {
    if (this.data.fourthMetric?.action === "inventory") this.openInventory();
    else wx.redirectTo({ url: "/pages/messages/index" });
  },

  scan() {
    wx.scanCode({
      scanType: ["barCode", "qrCode"],
      success: (result) => wx.redirectTo({ url: `/pages/inventory/index?keyword=${encodeURIComponent(result.result || "")}` }),
      fail: (error) => { if (!String(error.errMsg || "").includes("cancel")) wx.showToast({ title: "扫码失败，请重试", icon: "none" }); },
    });
  }
});

const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { decorateTask, formatDate } = require("../../utils/format");
const { getWorkspace, quickActions } = require("../../utils/workspace");
const { buildDeliveryOverview } = require("../../utils/production");
const { buildPartnerHome } = require("../../utils/hermes-home");
const { preferenceStorageKey, normalizePreferences } = require("../../utils/partner-preferences");
const { navMetrics } = require("../../utils/nav");

// Hermes quick reports currently build production milestone drafts, so they are only
// offered to partners that actually receive production orders.
function hermesAvailability(partnerAi, workspace, organizationName) {
  const handlesProduction = Boolean(workspace?.taskTypes?.includes("production_order"));
  const enabled = Boolean(partnerAi?.quickReportEnabled);
  const ready = enabled && handlesProduction;
  const name = organizationName || "你们公司";
  if (ready) {
    return {
      ready: true,
      voiceReady: Boolean(partnerAi?.quickReportVoiceEnabled),
      needsActivation: false,
      statusText: `在线 · ${organizationName || "同舟供应链中心"}`,
      welcomeCopy: "说一句、或拍张照，小助理帮你整理成反馈，你确认后才会提交。",
      placeholder: "说说订单进展，或发张照片…",
      unavailableTitle: "",
      unavailableText: "",
      cardText: "",
    };
  }
  const unavailableText = handlesProduction
    ? `小助理快捷填报还没有为“${name}”开通。请联系同舟对接人开通；现在可以先在“任务”里手动填写。`
    : "小助理快捷填报目前只用于委外生产加工单。你的任务请在“任务”里直接处理。";
  return {
    ready: false,
    voiceReady: false,
    needsActivation: handlesProduction,
    statusText: handlesProduction ? "快捷填报未开通" : "任务助手",
    welcomeCopy: handlesProduction ? "快捷填报暂未开通，任务可以先手动填写。" : "今天要处理的任务都在下面。",
    placeholder: handlesProduction ? "快捷填报未开通，点这里了解" : "快捷填报仅用于生产加工单",
    unavailableTitle: handlesProduction ? "小助理还没开通" : "暂不支持快捷填报",
    unavailableText,
    cardText: "请联系同舟对接人开通，现在可先在任务里手动填写。",
  };
}

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
    statusBarHeight: 20,
    navHeight: 44,
    capsuleSpace: 96,
    composerText: "",
    hermes: hermesAvailability(null, null, ""),
    isWarehouse: false,
    homeActionLabel: "去填报",
  },

  onLoad() {
    const hour = new Date().getHours();
    const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
    const date = new Date();
    const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    let windowInfo = {};
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
    this.setData(Object.assign({ greeting, today: `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`, clockText: timeText(date), statusBarHeight: Number(windowInfo.statusBarHeight || 20) }, navMetrics(windowInfo)));
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
      isWarehouse: workspace.kind === "warehouse",
      homeActionLabel: workspace.kind === "warehouse" ? "去处理" : "去填报",
      assistantPreferences: normalizePreferences(storedPreferences),
    });
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  refresh() {
    if (this.data.loading) return;
    this.load();
  },

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
        : buildPartnerHome(work.items, summary.dashboard, workspace.kind === "warehouse" ? "warehouse" : "general", undefined, this.data.assistantPreferences);
      const hermes = hermesAvailability(summary.dashboard.partnerAi, workspace, this.data.session?.organization?.name);
      // Without Hermes, only keep suggestions that are plain navigation shortcuts.
      const suggestions = hermes.ready
        ? hermesHome.suggestions
        : hermesHome.suggestions.filter((item) => !["quick_report", "photo_report"].includes(item.action));
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
        hermesSuggestions: suggestions,
        hermes,
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

  openHermesWithPrompt(prompt) {
    const query = prompt ? `?prompt=${encodeURIComponent(prompt)}` : "";
    wx.navigateTo({ url: `/pages/ai-progress/index${query}` });
  },

  explainHermesUnavailable() {
    const hermes = this.data.hermes || {};
    wx.showModal({
      title: hermes.unavailableTitle || "小助理暂不可用",
      content: hermes.unavailableText || "请先在“任务”里手动填写。",
      confirmText: "去任务",
      cancelText: "知道了",
      success: (result) => { if (result.confirm) this.openTasks(); },
    });
  },

  openTodayTask(event) {
    const task = this.data.todayReportTasks[Number(event.currentTarget.dataset.index)];
    if (!task) return;
    if (task.itemType === "production_order" && this.data.hermes?.ready) return this.openHermesWithPrompt(task.reportPrompt);
    wx.navigateTo({ url: `/pages/task-detail/index?id=${encodeURIComponent(task.id)}` });
  },

  runHermesSuggestion(event) {
    const suggestion = this.data.hermesSuggestions[Number(event.currentTarget.dataset.index)];
    if (!suggestion) return;
    if (suggestion.action === "quick_report") return this.data.hermes?.ready ? this.openHermesWithPrompt(suggestion.prompt) : this.explainHermesUnavailable();
    if (suggestion.action === "photo_report") return this.choosePhoto();
    const query = suggestion.itemType ? `?itemType=${encodeURIComponent(suggestion.itemType)}` : "";
    wx.redirectTo({ url: `/pages/tasks/index${query}` });
  },

  updateComposer(event) { this.setData({ composerText: event.detail.value }); },

  tapComposer() {
    if (!this.data.hermes?.ready) this.explainHermesUnavailable();
  },

  sendComposer() {
    if (!this.data.hermes?.ready) return this.explainHermesUnavailable();
    const text = String(this.data.composerText || "").trim();
    this.setData({ composerText: "" });
    this.openHermesWithPrompt(text);
  },

  startVoiceReport() {
    if (!this.data.hermes?.ready) return this.explainHermesUnavailable();
    if (!this.data.hermes.voiceReady) {
      wx.showToast({ title: "语音暂未开通，请打字描述", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/ai-progress/index?voice=1" });
  },

  choosePhoto() {
    if (!this.data.hermes?.ready) return this.explainHermesUnavailable();
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      const media = result.tempFiles?.[0];
      if (!media?.tempFilePath) return;
      try { wx.setStorageSync("hermes_pending_media", { tempFilePath: media.tempFilePath, size: media.size || 0, type: media.fileType || "image", createdAt: Date.now() }); } catch (_) {}
      wx.navigateTo({ url: "/pages/ai-progress/index?mode=photo" });
    } });
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

const api = require("../../utils/api");
const adminApi = require("../../utils/admin-api");
const { requireSession, sessionMode } = require("../../utils/auth");
const { roleLabel } = require("../../utils/format");
const { getWorkspace } = require("../../utils/workspace");
const { preferenceStorageKey, normalizePreferences, accessScopes } = require("../../utils/partner-preferences");
const { windowNavMetrics } = require("../../utils/nav");

Page({
  data: {
    session: null,
    mode: "partner",
    isAdmin: false,
    roleName: "协同成员",
    initial: "舟",
    unread: 0,
    demoMode: api.config.demoMode,
    workspace: null,
    profile: null,
    resources: [],
    adminCapabilities: [],
    assistantPreferences: { voiceFirst: true, dueReminder: true },
    accessScopes: [],
    statusBarHeight: 20,
    navHeight: 44,
    avatarUrl: "",
  },

  onShow() {
    const session = requireSession();
    if (!session) return;
    const nav = windowNavMetrics();
    this.setData({ statusBarHeight: nav.statusBarHeight, navHeight: nav.navHeight });
    const mode = sessionMode(session);
    this.loadAvatar(session, mode);
    if (mode === "admin") return this.showAdmin(session, true);
    const workspace = getWorkspace(session);
    const resources = workspace.resources.length ? workspace.resources : [{ name: session.organization.name, ref: session.organization.code, permissions: workspace.capabilities }];
    let storedPreferences = null;
    try { storedPreferences = wx.getStorageSync(preferenceStorageKey(session.user.id)); } catch (_) {}
    this.setData({
      mode, isAdmin: false, session, workspace, profile: workspace.profile, resources,
      roleName: roleLabel(session.membership.role), initial: String(session.user.displayName || "伙").slice(0, 1),
      assistantPreferences: normalizePreferences(storedPreferences),
      accessScopes: accessScopes(workspace),
    });
    api.fetchDashboard().then((result) => this.setData({ unread: result.dashboard.unreadNotifications || 0 })).catch(() => {});
  },

  showAdmin(session, refreshSession) {
    const capabilities = session.capabilities || {};
    const adminCapabilities = [
      { key: "tasks", label: "跨组织任务", enabled: Boolean(capabilities.viewTasks), note: "查看全部获授权协同任务" },
      { key: "approvals", label: "协同审批", enabled: Boolean(capabilities.reviewCommands), note: "批准或驳回高风险伙伴操作" },
      { key: "organizations", label: "伙伴目录", enabled: Boolean(capabilities.viewOrganizations), note: "查看组织和成员状态" },
      { key: "impersonation", label: "代伙伴操作", enabled: false, note: "第一版明确关闭" },
    ];
    this.setData({ mode: "admin", isAdmin: true, session, roleName: session.user.roleLabel || "中台管理员", initial: String(session.user.displayName || "管").slice(0, 1), adminCapabilities, unread: 0 });
    if (!refreshSession) return;
    adminApi.fetchSession().then((result) => {
      if (!result.session) return;
      getApp().setSession(result.session);
      this.showAdmin(result.session, false);
    }).catch(() => {});
  },

  menuTap(event) {
    const key = event.currentTarget.dataset.key;
    if (this.data.isAdmin && key === "organizations") return wx.redirectTo({ url: "/pages/admin-organizations/index" });
    const messages = {
      organization: "组织资料由同舟供应链中心统一维护。",
      members: "成员管理沿用伙伴门户的安全策略。",
      security: this.data.isAdmin ? "中台移动会话最长 12 小时，接口会再次校验账号状态与权限。" : "账号密码与会话安全沿用伙伴门户策略。",
      help: "如需帮助，请联系同舟供应链管理员。",
      feedback: "意见反馈入口正在接入企业微信。",
      audit: "小助理代填、人工修改与正式提交都会进入协同审计记录。",
    };
    wx.showModal({ title: event.currentTarget.dataset.title, content: messages[key] || "功能正在完善。", showCancel: false });
  },

  // The avatar is a per-phone personal touch: it is saved in the mini program's local file
  // storage only and is never uploaded to the collaboration server.
  avatarStorageKey(session, mode) {
    return `profile_avatar:${mode || "partner"}:${session?.user?.id || "anonymous"}`;
  },

  loadAvatar(session, mode) {
    let avatarUrl = "";
    try {
      avatarUrl = wx.getStorageSync(this.avatarStorageKey(session, mode)) || "";
      if (avatarUrl && wx.getFileSystemManager) wx.getFileSystemManager().accessSync(avatarUrl);
    } catch (_) { avatarUrl = ""; }
    this.setData({ avatarUrl });
  },

  chooseAvatar() {
    const session = this.data.session;
    if (!session) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const tempFilePath = result.tempFiles?.[0]?.tempFilePath;
        if (!tempFilePath) return;
        const previous = this.data.avatarUrl;
        const finish = (path) => {
          try { wx.setStorageSync(this.avatarStorageKey(session, this.data.mode), path); } catch (_) {}
          this.setData({ avatarUrl: path });
          if (previous && previous !== path) this.removeSavedAvatar(previous);
          wx.showToast({ title: "头像已更新", icon: "success" });
        };
        const fs = wx.getFileSystemManager ? wx.getFileSystemManager() : null;
        if (!fs) return finish(tempFilePath);
        fs.saveFile({ tempFilePath, success: (saved) => finish(saved.savedFilePath), fail: () => wx.showToast({ title: "头像保存失败，请重试", icon: "none" }) });
      },
    });
  },

  resetAvatar() {
    const previous = this.data.avatarUrl;
    try { wx.removeStorageSync(this.avatarStorageKey(this.data.session, this.data.mode)); } catch (_) {}
    this.setData({ avatarUrl: "" });
    if (previous) this.removeSavedAvatar(previous);
  },

  removeSavedAvatar(path) {
    try { wx.getFileSystemManager().removeSavedFile({ filePath: path, fail() {} }); } catch (_) {}
  },

  goHome() { wx.redirectTo({ url: this.data.isAdmin ? "/pages/admin/index" : "/pages/index/index" }); },

  togglePreference(event) {
    if (this.data.isAdmin) return;
    const key = event.currentTarget.dataset.key;
    if (!['voiceFirst', 'dueReminder'].includes(key)) return;
    // Works for both the native switch (detail.value) and the design's tap-to-toggle control.
    const next = typeof event.detail?.value === "boolean" ? event.detail.value : !this.data.assistantPreferences[key];
    const assistantPreferences = Object.assign({}, this.data.assistantPreferences, { [key]: next });
    this.setData({ assistantPreferences });
    try { wx.setStorageSync(preferenceStorageKey(this.data.session?.user?.id), assistantPreferences); } catch (_) {}
  },

  switchMode() {
    const nextMode = this.data.isAdmin ? "partner" : "admin";
    wx.showModal({
      title: this.data.isAdmin ? "切换到伙伴登录" : "切换到中台登录",
      content: "切换身份域需要退出当前会话并重新验证账号。",
      confirmText: "退出并切换",
      confirmColor: "#116F63",
      success: async (result) => {
        if (!result.confirm) return;
        wx.showLoading({ title: "正在切换" });
        try { if (this.data.isAdmin) await adminApi.logout(); else await api.logout(); }
        catch (_) { if (this.data.isAdmin) adminApi.clearAuth(); else api.clearAuth(); }
        getApp().setSession(null);
        wx.hideLoading();
        wx.reLaunch({ url: `/pages/login/index?mode=${nextMode}` });
      },
    });
  },

  logout() {
    wx.showModal({ title: "退出登录", content: "退出后需要重新输入当前模式的账号和密码。", confirmColor: "#B42318", success: async (result) => {
      if (!result.confirm) return;
      wx.showLoading({ title: "正在退出" });
      try { if (this.data.isAdmin) await adminApi.logout(); else await api.logout(); }
      catch (_) { if (this.data.isAdmin) adminApi.clearAuth(); else api.clearAuth(); }
      getApp().setSession(null);
      wx.hideLoading();
      wx.reLaunch({ url: `/pages/login/index?mode=${this.data.mode}` });
    } });
  },
});

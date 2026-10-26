const api = require("../../utils/api");
const adminApi = require("../../utils/admin-api");
const { requireSession, sessionMode } = require("../../utils/auth");
const { roleLabel } = require("../../utils/format");
const { getWorkspace } = require("../../utils/workspace");
const { preferenceStorageKey, normalizePreferences, accessScopes } = require("../../utils/partner-preferences");

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
  },

  onShow() {
    const session = requireSession();
    if (!session) return;
    let windowInfo = {};
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
    this.setData({ statusBarHeight: Number(windowInfo.statusBarHeight || 20) });
    const mode = sessionMode(session);
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
      audit: "Hermes 代填、人工修改与正式提交都会进入协同审计记录。",
    };
    wx.showModal({ title: event.currentTarget.dataset.title, content: messages[key] || "功能正在完善。", showCancel: false });
  },

  goHome() { wx.redirectTo({ url: this.data.isAdmin ? "/pages/admin/index" : "/pages/index/index" }); },

  togglePreference(event) {
    if (this.data.isAdmin) return;
    const key = event.currentTarget.dataset.key;
    if (!['voiceFirst', 'dueReminder'].includes(key)) return;
    const assistantPreferences = Object.assign({}, this.data.assistantPreferences, { [key]: Boolean(event.detail.value) });
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

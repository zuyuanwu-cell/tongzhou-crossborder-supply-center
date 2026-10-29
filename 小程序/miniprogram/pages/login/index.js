const api = require("../../utils/api");
const adminApi = require("../../utils/admin-api");
const { homeRoute } = require("../../utils/auth");
const { windowNavMetrics } = require("../../utils/nav");

// Remembered login per mode. The password is kept only when the user ticks "记住密码",
// and only in this phone's mini program storage.
const REMEMBER_KEY = (mode) => `tz_login_remember:${mode}`;
const BIND_PROMPT_SNOOZE_KEY = "tz_wechat_bind_prompt_until";

function readRemembered(mode) {
  try {
    const saved = wx.getStorageSync(REMEMBER_KEY(mode)) || {};
    return { username: String(saved.username || ""), password: saved.rememberPassword ? String(saved.password || "") : "", rememberPassword: Boolean(saved.rememberPassword) };
  } catch (_) {
    return { username: "", password: "", rememberPassword: false };
  }
}

function writeRemembered(mode, username, password, rememberPassword) {
  try {
    wx.setStorageSync(REMEMBER_KEY(mode), rememberPassword
      ? { username, password, rememberPassword: true }
      : { username, rememberPassword: false });
  } catch (_) {}
}

Page({
  data: {
    loginMode: "partner",
    adminCredentialType: "account_password",
    form: api.config.demoMode
      ? { username: "warehouse.admin", password: "demo123456" }
      : { username: "", password: "" },
    loading: false,
    wechatLoading: false,
    rememberPassword: false,
    showPassword: false,
    demoMode: api.config.demoMode,
    demoAccounts: [
      { username: "warehouse.admin", label: "仓库", symbol: "仓" },
      { username: "packaging.operator", label: "包装厂", symbol: "包" },
      { username: "material.operator", label: "物料商", symbol: "供" },
      { username: "production.manager", label: "生产厂", symbol: "产" },
      { username: "filing.operator", label: "备案", symbol: "备" },
      { username: "sampling.operator", label: "打样", symbol: "样" },
    ],
    statusBarHeight: 20,
    navHeight: 44,
  },

  onLoad(options) {
    const nav = windowNavMetrics();
    const input = { statusBarHeight: nav.statusBarHeight, navHeight: nav.navHeight };
    if (options?.mode === "admin") Object.assign(input, { loginMode: "admin", form: { username: "", password: "" } });
    this.setData(input);
    this.applyRemembered(this.data.loginMode);
    this._autoLoginTried = false;
  },

  applyRemembered(mode) {
    if (api.config.demoMode && mode === "partner") return;
    const saved = readRemembered(mode);
    this.setData({ form: { username: saved.username, password: saved.password }, rememberPassword: saved.rememberPassword });
  },

  onShow() {
    const session = getApp().globalData.session;
    if (session) { wx.redirectTo({ url: homeRoute(session) }); return; }
    // Set by the API layer when a session expires, so the user knows why they are back here.
    let notice = "";
    try { notice = wx.getStorageSync("tz_login_notice") || ""; wx.removeStorageSync("tz_login_notice"); } catch (_) {}
    if (notice) wx.showToast({ title: notice, icon: "none", duration: 2500 });
    // A WeChat bound on this phone signs in by itself (skipped after a manual logout).
    if (!this._autoLoginTried && this.data.loginMode === "partner" && api.wechatQuickLoginReady()) {
      this._autoLoginTried = true;
      this.wechatLogin({ silent: true });
    }
  },

  async wechatLogin(event) {
    const silent = Boolean(event && event.silent);
    if (this.data.loading || this.data.wechatLoading) return;
    this.setData({ wechatLoading: true });
    try {
      adminApi.clearAuth();
      const result = await api.wechatLogin();
      getApp().setSession(result.session);
      wx.showToast({ title: "微信登录成功", icon: "success" });
      setTimeout(() => wx.reLaunch({ url: homeRoute(result.session) }), 350);
    } catch (error) {
      if (silent) {
        wx.showToast({ title: "微信自动登录没成功，请用账号密码登录", icon: "none", duration: 2500 });
      } else if (error.code === "wechat_not_bound") {
        wx.showModal({ title: "这个微信还没绑定", content: "请先用账号密码登录一次，登录后点“绑定微信”，以后就能一键登录。", showCancel: false, confirmText: "知道了" });
      } else {
        wx.showModal({ title: "微信登录失败", content: error.message || "请稍后再试，或先用账号密码登录。", showCancel: false });
      }
    } finally {
      this.setData({ wechatLoading: false });
    }
  },

  toggleRememberPassword() { this.setData({ rememberPassword: !this.data.rememberPassword }); },

  // After a password login: offer to bind WeChat so next time no password is needed.
  offerWechatBinding(wechat) {
    return new Promise((resolve) => {
      if (!wechat || !wechat.configured || wechat.bound) {
        try { if (wechat && wechat.bound) wx.setStorageSync("tz_wechat_bound", true); } catch (_) {}
        resolve(false);
        return;
      }
      let snoozedUntil = 0;
      try { snoozedUntil = Number(wx.getStorageSync(BIND_PROMPT_SNOOZE_KEY) || 0); } catch (_) {}
      if (snoozedUntil > Date.now()) { resolve(false); return; }
      wx.showModal({
        title: "绑定微信，下次免密登录",
        content: "绑定后，用这个微信打开小程序就会自动登录，不用再输账号密码。可以随时在“我的”里解除。",
        confirmText: "绑定微信",
        cancelText: "以后再说",
        success: async (choice) => {
          if (!choice.confirm) {
            try { wx.setStorageSync(BIND_PROMPT_SNOOZE_KEY, Date.now() + 7 * 24 * 60 * 60 * 1000); } catch (_) {}
            resolve(false);
            return;
          }
          wx.showLoading({ title: "正在绑定…", mask: true });
          try {
            await api.bindWechat();
            wx.hideLoading();
            wx.showToast({ title: "已绑定微信", icon: "success" });
            resolve(true);
          } catch (error) {
            wx.hideLoading();
            wx.showModal({ title: "绑定没成功", content: error.message || "请稍后在“我的”页面再试。", showCancel: false, success: () => resolve(false) });
          }
        },
        fail: () => resolve(false),
      });
    });
  },

  switchMode(event) {
    const loginMode = event.currentTarget.dataset.mode;
    if (!loginMode || loginMode === this.data.loginMode || this.data.loading) return;
    this.setData({
      loginMode,
      form: loginMode === "partner" && api.config.demoMode
        ? { username: "warehouse.admin", password: "demo123456" }
        : { username: "", password: "" },
      showPassword: false,
      rememberPassword: false,
    });
    this.applyRemembered(loginMode);
  },

  switchAdminCredential(event) {
    const adminCredentialType = event.currentTarget.dataset.type;
    if (!['account_password', 'access_code'].includes(adminCredentialType) || this.data.loading) return;
    this.setData({ adminCredentialType, form: { username: "", password: "" }, showPassword: false });
    if (adminCredentialType === "account_password") this.applyRemembered("admin");
  },

  updateField(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  togglePassword() { this.setData({ showPassword: !this.data.showPassword }); },

  chooseDemo(event) {
    this.setData({ "form.username": event.currentTarget.dataset.username, "form.password": "demo123456" });
  },

  async submit() {
    if (this.data.loading) return;
    const form = this.data.form;
    const usesAccessCode = this.data.loginMode === "admin" && this.data.adminCredentialType === "access_code";
    if ((!usesAccessCode && !form.username.trim()) || !form.password) {
      wx.showToast({ title: usesAccessCode ? "请输入中台访问码" : "请输入账号和密码", icon: "none" });
      return;
    }
    this.setData({ loading: true });
    try {
      let result;
      if (this.data.loginMode === "admin") {
        api.clearAuth();
        result = await adminApi.login(usesAccessCode
          ? { credentialType: "access_code", accessCode: form.password }
          : { credentialType: "account_password", username: form.username.trim(), password: form.password });
      } else {
        adminApi.clearAuth();
        result = await api.login({ username: form.username.trim(), password: form.password });
      }
      getApp().setSession(result.session);
      if (!usesAccessCode) writeRemembered(this.data.loginMode, form.username.trim(), form.password, this.data.rememberPassword);
      wx.showToast({ title: "登录成功", icon: "success" });
      if (this.data.loginMode === "partner") {
        try { wx.removeStorageSync("tz_wechat_autologin_off"); } catch (_) {}
        await new Promise((resolve) => setTimeout(resolve, 600));
        await this.offerWechatBinding(result.wechat);
      }
      setTimeout(() => wx.reLaunch({ url: homeRoute(result.session) }), 350);
    } catch (error) {
      wx.showModal({ title: "登录失败", content: error.message || "请检查账号和网络后重试。", showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
});

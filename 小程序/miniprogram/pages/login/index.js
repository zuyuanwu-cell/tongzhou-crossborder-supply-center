const api = require("../../utils/api");
const adminApi = require("../../utils/admin-api");
const { homeRoute } = require("../../utils/auth");

Page({
  data: {
    loginMode: "partner",
    adminCredentialType: "account_password",
    form: api.config.demoMode
      ? { username: "warehouse.admin", password: "demo123456" }
      : { username: "", password: "" },
    loading: false,
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
  },

  onLoad(options) {
    if (options?.mode === "admin") this.setData({ loginMode: "admin", form: { username: "", password: "" } });
  },

  onShow() {
    const session = getApp().globalData.session;
    if (session) wx.redirectTo({ url: homeRoute(session) });
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
    });
  },

  switchAdminCredential(event) {
    const adminCredentialType = event.currentTarget.dataset.type;
    if (!['account_password', 'access_code'].includes(adminCredentialType) || this.data.loading) return;
    this.setData({ adminCredentialType, form: { username: "", password: "" }, showPassword: false });
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
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => wx.reLaunch({ url: homeRoute(result.session) }), 350);
    } catch (error) {
      wx.showModal({ title: "登录失败", content: error.message || "请检查账号和网络后重试。", showCancel: false });
    } finally {
      this.setData({ loading: false });
    }
  },
});

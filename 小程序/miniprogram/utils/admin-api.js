const config = require("../config");

const TOKEN_KEY = "tz_mobile_admin_token";

function getToken() { return wx.getStorageSync(TOKEN_KEY) || ""; }

function clearAuth() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync("tz_collab_session_profile");
  const app = getApp();
  if (app) app.globalData.session = null;
}

function request(path, options) {
  const opts = options || {};
  if (!config.adminApiBaseUrl) return Promise.reject(new Error("尚未配置中台移动 API 地址。"));
  const token = getToken();
  const headers = Object.assign({ "content-type": "application/json" }, token ? { Authorization: `Bearer ${token}` } : {}, opts.header || {});
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.adminApiBaseUrl.replace(/\/$/, "")}${path}`,
      method: opts.method || "GET",
      data: opts.data,
      header: headers,
      timeout: config.requestTimeout,
      success(response) {
        const payload = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(payload);
        if (response.statusCode === 401 && !opts.skipAuthRedirect) {
          clearAuth();
          setTimeout(() => wx.reLaunch({ url: "/pages/login/index?mode=admin" }), 0);
        }
        const error = new Error(payload.message || `请求失败（${response.statusCode}）`);
        error.status = response.statusCode;
        error.code = payload.code || "request_failed";
        reject(error);
      },
      fail(error) { reject(new Error(error.errMsg || "中台网络连接失败，请稍后重试。")); },
    });
  });
}

async function login(input) {
  const result = await request("/api/mobile-admin/v1/auth/login", { method: "POST", data: input, skipAuthRedirect: true });
  if (!result.token || !result.session) throw new Error("中台登录响应不完整，请联系管理员。" );
  wx.setStorageSync(TOKEN_KEY, result.token);
  return Object.assign({}, result, { session: Object.assign({ mode: "admin" }, result.session) });
}

function fetchSession() { return request("/api/mobile-admin/v1/session"); }
function fetchOverview() { return request("/api/mobile-admin/v1/overview"); }

function fetchTasks(filters) {
  const query = [];
  Object.keys(filters || {}).forEach((key) => {
    const value = filters[key];
    if (value !== undefined && String(value).trim()) query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return request(`/api/mobile-admin/v1/tasks${query.length ? `?${query.join("&")}` : ""}`);
}

function fetchTask(id) { return request(`/api/mobile-admin/v1/tasks/${encodeURIComponent(id)}`); }
function fetchApprovals() { return request("/api/mobile-admin/v1/approvals"); }
function reviewApproval(commandId, decision, note) {
  return request(`/api/mobile-admin/v1/approvals/${encodeURIComponent(commandId)}/review`, { method: "POST", data: { decision, note } });
}
function fetchOrganizations(filters) {
  const query = [];
  Object.keys(filters || {}).forEach((key) => {
    const value = filters[key];
    if (value !== undefined && String(value).trim()) query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return request(`/api/mobile-admin/v1/organizations${query.length ? `?${query.join("&")}` : ""}`);
}
function fetchOrganization(code) { return request(`/api/mobile-admin/v1/organizations/${encodeURIComponent(code)}`); }
function fetchBusinessModule(moduleKey, filters) {
  const query = [];
  Object.keys(filters || {}).forEach((key) => {
    const value = filters[key];
    if (value !== undefined && String(value).trim()) query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return request(`/api/mobile-admin/v1/business/${encodeURIComponent(moduleKey)}${query.length ? `?${query.join("&")}` : ""}`);
}
function fetchBusinessDetail(moduleKey, id) {
  return request(`/api/mobile-admin/v1/business/${encodeURIComponent(moduleKey)}/${encodeURIComponent(id)}`);
}
function fetchContainerCalculatorBootstrap() {
  return request("/api/mobile-admin/v1/business/container-loading/calculator/bootstrap");
}
function runContainerCalculation(input) {
  return request("/api/mobile-admin/v1/business/container-loading/calculator/run", { method: "POST", data: input });
}
function businessImageUrl(imageKey) {
  return imageKey ? `${config.adminApiBaseUrl.replace(/\/$/, "")}/api/mobile-admin/v1/images/${encodeURIComponent(imageKey)}` : "";
}

async function logout() {
  try { if (getToken()) await request("/api/mobile-admin/v1/auth/logout", { method: "POST" }); }
  finally { clearAuth(); }
  return { ok: true };
}

module.exports = {
  businessImageUrl,
  clearAuth,
  fetchBusinessDetail,
  fetchBusinessModule,
  fetchContainerCalculatorBootstrap,
  fetchApprovals,
  fetchOrganization,
  fetchOrganizations,
  fetchOverview,
  fetchSession,
  fetchTask,
  fetchTasks,
  getToken,
  login,
  logout,
  reviewApproval,
  runContainerCalculation,
};

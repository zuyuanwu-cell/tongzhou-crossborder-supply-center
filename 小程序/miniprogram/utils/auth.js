function sessionMode(session) {
  return session?.mode === "admin" ? "admin" : "partner";
}

function homeRoute(session) {
  return sessionMode(session) === "admin" ? "/pages/admin/index" : "/pages/index/index";
}

function requireSession(expectedMode) {
  const app = getApp();
  const session = app.globalData.session || wx.getStorageSync("tz_collab_session_profile");
  if (!session) {
    wx.reLaunch({ url: "/pages/login/index" });
    return null;
  }
  const normalized = Object.assign({ mode: "partner" }, session);
  app.globalData.session = normalized;
  if (expectedMode && sessionMode(normalized) !== expectedMode) {
    wx.reLaunch({ url: homeRoute(normalized) });
    return null;
  }
  return normalized;
}

module.exports = { homeRoute, requireSession, sessionMode };

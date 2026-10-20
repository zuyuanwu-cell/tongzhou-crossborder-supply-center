const config = require("./config");

App({
  globalData: {
    config,
    session: null,
  },

  onLaunch() {
    this.globalData.session = wx.getStorageSync("tz_collab_session_profile") || null;
    if (config.cloudEnvId && wx.cloud) {
      wx.cloud.init({ env: config.cloudEnvId, traceUser: true });
    }
  },

  setSession(session) {
    const normalized = session ? Object.assign({ mode: "partner" }, session) : null;
    this.globalData.session = normalized;
    if (normalized) wx.setStorageSync("tz_collab_session_profile", normalized);
    else wx.removeStorageSync("tz_collab_session_profile");
  },
});

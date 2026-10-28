// Lines a custom header up with WeChat's capsule button so header buttons never sit under it.
function navMetrics(windowInfo) {
  const info = windowInfo || {};
  const statusBarHeight = Number(info.statusBarHeight || 20);
  let rect = null;
  try { rect = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null; } catch (_) {}
  if (!rect || !rect.height) return { statusBarHeight, navHeight: 44, capsuleSpace: 96 };
  const gap = Math.max(4, rect.top - statusBarHeight);
  const width = Number(info.windowWidth || 375);
  return { statusBarHeight, navHeight: rect.height + gap * 2, capsuleSpace: Math.max(0, width - rect.left) + 8 };
}

function windowNavMetrics() {
  let windowInfo = {};
  try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
  return navMetrics(windowInfo);
}

module.exports = { navMetrics, windowNavMetrics };

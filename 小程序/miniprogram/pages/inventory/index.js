const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { formatDate } = require("../../utils/format");
const { getWorkspace, hasModule } = require("../../utils/workspace");

Page({
  data: { session: null, keyword: "", items: [], loading: true, error: "", syncText: "同步中", unread: 0 },
  onLoad(options) { if (options.keyword) this.setData({ keyword: decodeURIComponent(options.keyword) }); },
  onShow() {
    const session = requireSession("partner");
    if (!session) return;
    if (!hasModule(getWorkspace(session), "inventory")) {
      wx.showModal({ title: "当前工作区无库存模块", content: "库存只对已授权仓库组织开放。", showCancel: false, success: () => wx.reLaunch({ url: "/pages/index/index" }) });
      return;
    }
    this.setData({ session });
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  updateKeyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(); },
  clearKeyword() { this.setData({ keyword: "" }); this.load(); },
  openOperation(event) { const data = event.currentTarget.dataset; wx.navigateTo({ url: `/pages/operation/index?type=${data.type}&sku=${encodeURIComponent(data.sku || "")}` }); },
  scan() {
    wx.scanCode({
      scanType: ["barCode", "qrCode"],
      success: (result) => this.setData({ keyword: result.result || "" }, () => this.load()),
      fail: (error) => { if (!String(error.errMsg || "").includes("cancel")) wx.showToast({ title: "扫码失败", icon: "none" }); },
    });
  },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [result, summary] = await Promise.all([api.fetchInventory(this.data.keyword), api.fetchDashboard()]);
      const items = result.items.map((item) => Object.assign({}, item, {
        initial: String(item.productName || item.sku).slice(0, 1),
        isLow: Number(item.availableQuantity) > 0 && Number(item.availableQuantity) < 50,
        isEmpty: Number(item.availableQuantity) === 0,
      }));
      this.setData({ items, syncText: formatDate(summary.dashboard.inventorySyncedAt), unread: summary.dashboard.unreadNotifications || 0 });
    } catch (error) { this.setData({ error: error.message || "库存读取失败。" }); }
    finally { this.setData({ loading: false }); }
  }
});

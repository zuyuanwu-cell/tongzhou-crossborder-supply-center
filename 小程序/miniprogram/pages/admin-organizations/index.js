const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { decorateOrganization } = require("../../utils/admin-format");

Page({
  data: {
    filters: [{ value: "", label: "全部" }, { value: "active", label: "正常" }, { value: "suspended", label: "暂停" }, { value: "archived", label: "归档" }],
    status: "",
    keyword: "",
    items: [],
    loading: true,
    error: "",
    allowed: true,
  },
  onShow() {
    const session = requireSession("admin");
    if (!session) return;
    const allowed = Boolean(session.capabilities?.viewOrganizations);
    this.setData({ allowed });
    if (allowed) this.load(); else this.setData({ loading: false, error: "当前中台账号没有伙伴组织查看权限。" });
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  updateKeyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(); },
  clearKeyword() { this.setData({ keyword: "" }, () => this.load()); },
  changeStatus(event) { this.setData({ status: event.currentTarget.dataset.value }, () => this.load()); },
  openOrganization(event) { wx.navigateTo({ url: `/pages/admin-organization/index?code=${encodeURIComponent(event.currentTarget.dataset.code)}` }); },
  async load() {
    if (!this.data.allowed) return;
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchOrganizations({ keyword: this.data.keyword.trim(), status: this.data.status });
      this.setData({ items: (result.organizations || []).map(decorateOrganization) });
    } catch (error) { this.setData({ error: error.message || "伙伴组织读取失败。" }); }
    finally { this.setData({ loading: false }); }
  },
});

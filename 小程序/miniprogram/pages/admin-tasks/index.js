const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { decorateAdminTask, decorateOrganization } = require("../../utils/admin-format");

Page({
  data: {
    filters: [
      { value: "", label: "全部" }, { value: "pending", label: "待接单" },
      { value: "in_progress", label: "处理中" }, { value: "pending_approval", label: "待审批" },
      { value: "pending_sync", label: "待入账" }, { value: "completed", label: "已完成" },
    ],
    status: "",
    keyword: "",
    organizationCode: "",
    organizationIndex: 0,
    organizationName: "全部伙伴组织",
    organizationOptions: [{ code: "", name: "全部伙伴组织" }],
    counts: {},
    items: [],
    total: 0,
    loading: true,
    error: "",
  },

  onShow() {
    const session = requireSession("admin");
    if (!session) return;
    if (this.data.organizationOptions.length === 1 && session.capabilities?.viewOrganizations) this.loadOrganizations();
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  updateKeyword(event) { this.setData({ keyword: event.detail.value }); },
  search() { this.load(); },
  clearKeyword() { this.setData({ keyword: "" }, () => this.load()); },
  changeStatus(event) { this.setData({ status: event.currentTarget.dataset.value }, () => this.load()); },
  changeOrganization(event) {
    const organizationIndex = Number(event.detail.value || 0);
    const organizationCode = this.data.organizationOptions[organizationIndex]?.code || "";
    this.setData({ organizationIndex, organizationCode, organizationName: this.data.organizationOptions[organizationIndex]?.name || "全部伙伴组织" }, () => this.load());
  },
  openTask(event) { wx.navigateTo({ url: `/pages/admin-task-detail/index?id=${event.currentTarget.dataset.id}` }); },

  async loadOrganizations() {
    try {
      const result = await adminApi.fetchOrganizations({ status: "active" });
      const organizations = (result.organizations || []).map(decorateOrganization);
      this.setData({ organizationOptions: [{ code: "", name: "全部伙伴组织" }].concat(organizations) });
    } catch (_) {}
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchTasks({
        keyword: this.data.keyword.trim(),
        status: this.data.status,
        organizationCode: this.data.organizationCode,
        limit: 100,
      });
      this.setData({ items: (result.items || []).map(decorateAdminTask), counts: result.counts || {}, total: result.total || 0 });
    } catch (error) {
      this.setData({ error: error.message || "协同任务读取失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
});

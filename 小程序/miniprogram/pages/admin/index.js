const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { formatDate } = require("../../utils/format");
const { decorateAdminTask, decorateApproval, decorateOrganization } = require("../../utils/admin-format");

const BUSINESS_MODULES = [
  { key: "domestic-inventory", capability: "viewDomesticInventory", label: "国内仓库库存", icon: "仓", note: "库存、可用量与低库存" },
  { key: "products", capability: "viewProducts", label: "产品库", icon: "品", note: "SKU、国家与价格信息" },
  { key: "qualifications", capability: "viewQualifications", label: "资质库", icon: "资", note: "覆盖、附件与到期提醒" },
  { key: "stockup-risks", capability: "viewStockupRisks", label: "产品备货风险", icon: "险", note: "缺货与净建议备货量" },
  { key: "container-loading", capability: "viewContainerLoading", label: "智能装柜", icon: "柜", note: "装柜方案与确认状态" },
];

Page({
  data: {
    session: null,
    loading: true,
    error: "",
    metrics: [],
    priorityTasks: [],
    approvals: [],
    organizations: [],
    businessModules: [],
    canReview: false,
    canViewOrganizations: false,
    updatedText: "",
  },

  onShow() {
    const session = requireSession("admin");
    if (!session) return;
    this.setData({
      session,
      canReview: Boolean(session.capabilities?.reviewCommands),
      canViewOrganizations: Boolean(session.capabilities?.viewOrganizations),
    });
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchOverview();
      const overview = result.overview || {};
      const source = overview.metrics || {};
      const capabilities = result.capabilities || this.data.session?.capabilities || {};
      const session = Object.assign({}, this.data.session, {
        capabilities,
        workspace: result.workspace || this.data.session?.workspace,
      });
      getApp().setSession(session);
      this.setData({
        session,
        canReview: Boolean(capabilities.reviewCommands),
        canViewOrganizations: Boolean(capabilities.viewOrganizations),
        businessModules: BUSINESS_MODULES.filter((item) => capabilities[item.capability]),
        metrics: [
          { key: "open", label: "进行中任务", value: source.openTasks || 0, note: "跨全部伙伴组织", tone: "blue" },
          { key: "approval", label: "待审批", value: source.pendingApprovals || 0, note: "需要中台决策", tone: "orange" },
          { key: "overdue", label: "已逾期", value: source.overdueTasks || 0, note: "优先跟进交期", tone: "red" },
          { key: "org", label: "活跃伙伴", value: source.activeOrganizations || 0, note: "当前正常协同", tone: "green" },
        ],
        priorityTasks: (overview.priorityTasks || []).map(decorateAdminTask),
        approvals: (overview.approvals || []).map(decorateApproval),
        organizations: (overview.organizations || []).map(decorateOrganization),
        updatedText: overview.generatedAt ? formatDate(overview.generatedAt) : "刚刚",
      });
    } catch (error) {
      this.setData({ error: error.message || "中台总览加载失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openTasks() { wx.redirectTo({ url: "/pages/admin-tasks/index" }); },
  openTask(event) { wx.navigateTo({ url: `/pages/admin-task-detail/index?id=${event.currentTarget.dataset.id}` }); },
  openApprovals() { wx.redirectTo({ url: "/pages/admin-approvals/index" }); },
  openOrganizations() { wx.redirectTo({ url: "/pages/admin-organizations/index" }); },
  openOrganization(event) { wx.navigateTo({ url: `/pages/admin-organization/index?code=${encodeURIComponent(event.currentTarget.dataset.code)}` }); },
  openBusiness(event) { wx.navigateTo({ url: `/pages/admin-business/index?module=${encodeURIComponent(event.currentTarget.dataset.module)}` }); },
});

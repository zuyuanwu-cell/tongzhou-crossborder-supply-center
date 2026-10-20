const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { decorateTask } = require("../../utils/format");
const { getWorkspace } = require("../../utils/workspace");

Page({
  data: {
    filters: [
      { value: "", label: "全部" }, { value: "pending", label: "待接单" }, { value: "accepted", label: "已接单" },
      { value: "in_progress", label: "处理中" }, { value: "pending_approval", label: "待审批" },
      { value: "pending_sync", label: "待同步" }, { value: "completed", label: "已完成" }
    ],
    status: "",
    keyword: "",
    counts: {},
    items: [],
    loading: true,
    error: "",
    unread: 0,
    itemType: "",
    sampleCategory: "",
    isSamplePage: false,
    pageEyebrow: "WORK ITEMS",
    pageTitle: "协同任务",
    pageSubtitle: "接单、执行、回传凭证，并跟踪中台处理结果",
    profile: null,
    isProduction: false,
    typeFilters: [],
  },

  onLoad(options) { this.setData({ itemType: options.itemType || "", sampleCategory: options.sampleCategory || "", status: options.status || "" }); },
  onShow() {
    const session = requireSession("partner");
    if (!session) return;
    const workspace = getWorkspace(session);
    const labels = {
      packaging_factory: { pending: "待报价", accepted: "报价准备", in_progress: "报价准备" },
      filing_service: { pending: "待受理", accepted: "已受理", in_progress: "办理中" },
      sampling_factory: { pending: "待接样", accepted: "已接样", in_progress: "打样中" },
      production_factory: { in_progress: "生产中" },
      material_supplier: { pending: "待确认", accepted: "履约中", in_progress: "履约中" },
    }[workspace.kind] || {};
    const filters = this.data.filters.map((item) => Object.assign({}, item, { label: labels[item.value] || item.label }));
    const isSamplePage = ["inner_material", "packaging"].includes(this.data.sampleCategory);
    const typeFilters = workspace.kind === "production_factory" && !isSamplePage ? [
      { value: "", label: "全部单据", icon: "单" },
      { value: "production_order", label: "委外加工单", icon: "产" },
      { value: "purchase_order", label: "物料采购单", icon: "采" },
    ] : [];
    const sampleMeta = this.data.sampleCategory === "inner_material"
      ? { eyebrow: "INNER MATERIAL SAMPLE", title: "料体打样", subtitle: "每轮可登记多个独立料体；供应商内部编码必填，平台追踪号自动生成。" }
      : this.data.sampleCategory === "packaging"
        ? { eyebrow: "PACKAGING SAMPLE", title: "包材打样", subtitle: "按材质、工艺、结构、尺寸与文件管理送样，不与料体任务混排。" }
        : { eyebrow: workspace.profile.eyebrow, title: workspace.profile.taskTitle, subtitle: workspace.profile.taskSubtitle };
    this.setData({
      profile: workspace.profile, filters, isProduction: workspace.kind === "production_factory" && !isSamplePage, typeFilters,
      isSamplePage, pageEyebrow: sampleMeta.eyebrow, pageTitle: sampleMeta.title, pageSubtitle: sampleMeta.subtitle,
    });
    wx.setNavigationBarTitle({ title: sampleMeta.title });
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  updateKeyword(event) { this.setData({ keyword: event.detail.value }); },
  clearKeyword() { this.setData({ keyword: "" }); this.load(); },
  search() { this.load(); },
  changeStatus(event) { this.setData({ status: event.currentTarget.dataset.value }, () => this.load()); },
  changeType(event) { this.setData({ itemType: event.currentTarget.dataset.value, status: "" }, () => this.load()); },
  openTask(event) { wx.navigateTo({ url: `/pages/task-detail/index?id=${event.currentTarget.dataset.id}` }); },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const [result, summary] = await Promise.all([
        api.fetchWorkItems({ keyword: this.data.keyword.trim(), limit: 100 }),
        api.fetchDashboard(),
      ]);
      const categoryItems = this.data.isSamplePage
        ? result.items.filter((item) => item.itemType === "sampling_task" && item.publicPayload?.sampleCategory === this.data.sampleCategory)
        : result.items.filter((item) => item.itemType !== "sampling_task");
      const typedItems = this.data.itemType ? categoryItems.filter((item) => item.itemType === this.data.itemType) : categoryItems;
      const counts = typedItems.reduce((resultCounts, item) => {
        resultCounts[item.status] = (resultCounts[item.status] || 0) + 1;
        return resultCounts;
      }, {});
      const visibleItems = this.data.status ? typedItems.filter((item) => item.status === this.data.status) : typedItems;
      const typeFilters = this.data.typeFilters.map((filter) => Object.assign({}, filter, {
        count: filter.value ? categoryItems.filter((item) => item.itemType === filter.value).length : categoryItems.length,
      }));
      this.setData({ items: visibleItems.map(decorateTask), counts, typeFilters, unread: summary.dashboard.unreadNotifications || 0 });
    } catch (error) {
      this.setData({ error: error.message || "任务读取失败。" });
    } finally {
      this.setData({ loading: false });
    }
  }
});

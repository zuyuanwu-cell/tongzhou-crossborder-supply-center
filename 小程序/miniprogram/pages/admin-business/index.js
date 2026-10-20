const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { formatDate } = require("../../utils/format");

const MODULES = {
  "domestic-inventory": {
    title: "国内仓库库存",
    eyebrow: "DOMESTIC INVENTORY",
    subtitle: "查看各国内仓库存、可用量和低库存风险",
    capability: "viewDomesticInventory",
    empty: "当前筛选条件下没有国内仓库存记录",
    filters: [{ key: "", label: "全部库存" }, { key: "low", label: "仅看低库存" }],
    metrics: [["warehouses", "启用仓库"], ["skuCount", "库存 SKU"], ["availableQty", "可用库存"], ["lowStockSkuCount", "低库存"]],
  },
  products: {
    title: "产品库",
    eyebrow: "PRODUCT LIBRARY",
    subtitle: "按国家、SKU 和品牌快速查询产品经营信息",
    capability: "viewProducts",
    empty: "当前筛选条件下没有产品",
    filters: [{ key: "", label: "全部国家" }],
    metrics: [["products", "产品记录"], ["countries", "覆盖国家"], ["inStock", "有库存"], ["alerts", "库存风险"]],
  },
  qualifications: {
    title: "资质库",
    eyebrow: "QUALIFICATIONS",
    subtitle: "关注资质覆盖、附件完整性和临期状态",
    capability: "viewQualifications",
    empty: "当前筛选条件下没有资质记录",
    filters: [{ key: "", label: "全部" }, { key: "valid", label: "有效" }, { key: "expiring", label: "90 天内到期" }, { key: "expired", label: "已过期" }, { key: "undated", label: "未维护日期" }],
    metrics: [["qualifications", "资质记录"], ["withFiles", "含附件"], ["expiring", "即将到期"], ["expired", "已过期"]],
  },
  "stockup-risks": {
    title: "产品备货风险",
    eyebrow: "STOCKUP RISK",
    subtitle: "把缺货、补货建议和委外在产数量放在同一视图",
    capability: "viewStockupRisks",
    empty: "当前没有需要关注的备货风险",
    filters: [{ key: "", label: "全部风险" }, { key: "缺货", label: "缺货" }, { key: "补货预警", label: "补货预警" }],
    metrics: [["recommendations", "风险 SKU"], ["stockout", "缺货"], ["replenish", "补货预警"], ["netRecommendedQty", "净建议量"]],
  },
  "container-loading": {
    title: "智能装柜",
    eyebrow: "SMART LOADING",
    subtitle: "查看装柜方案、来源发运单和确认状态",
    capability: "viewContainerLoading",
    empty: "当前筛选条件下没有装柜方案",
    filters: [{ key: "", label: "全部方案" }, { key: "draft", label: "草稿" }, { key: "confirmed", label: "已确认" }, { key: "voided", label: "已作废" }],
    metrics: [["plans", "装柜方案"], ["draft", "草稿"], ["confirmed", "已确认"], ["shipments", "可选发运"]],
  },
};

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(Math.round(number * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
}

function dateOnly(value) {
  return value ? formatDate(value, false) : "未维护";
}

function decorateItem(moduleKey, item) {
  if (moduleKey === "domestic-inventory") return Object.assign({}, item, {
    thumbnailUrl: adminApi.businessImageUrl(item.imageKey),
    visualText: "库",
    title: item.productName || item.sku,
    meta: `${item.warehouseName || "未分配仓库"} · ${item.sku}`,
    primary: `${formatNumber(item.availableQty)} ${item.unit || "件"}`,
    secondary: `在库 ${formatNumber(item.onHandQty)} · 占用 ${formatNumber(item.reservedQty)}`,
    badge: item.lowStock ? "低库存" : "正常",
    tone: item.lowStock ? "red" : "green",
  });
  if (moduleKey === "products") {
    const prices = [];
    if (item.directPrice) prices.push(`直营 ${item.directCurrency || ""} ${formatNumber(item.directPrice)}`);
    if (item.distributionPrice) prices.push(`分销 ${item.distributionCurrency || ""} ${formatNumber(item.distributionPrice)}`);
    if (item.salesPrice) prices.push(`售价 ${item.salesCurrency || ""} ${formatNumber(item.salesPrice)}`);
    return Object.assign({}, item, {
      thumbnailUrl: adminApi.businessImageUrl(item.imageKey),
      visualText: "产",
      title: item.name || item.sku,
      meta: `${item.country || "未配置国家"} · ${item.brand || "未配置品牌"}`,
      primary: `${item.sku}${item.countrySku ? ` · ${item.countrySku}` : ""}`,
      secondary: prices.join(" · ") || `库存 ${formatNumber(item.stockQty)}`,
      badge: item.alert || item.status || "正常",
      tone: item.alert && item.alert !== "健康" ? "red" : "green",
    });
  }
  if (moduleKey === "qualifications") {
    const labels = { valid: "有效", expiring: "即将到期", expired: "已过期", undated: "未维护日期" };
    const tones = { valid: "green", expiring: "amber", expired: "red", undated: "gray" };
    return Object.assign({}, item, {
      thumbnailUrl: "",
      visualText: "资",
      title: item.qualificationName || item.productName || item.sku,
      meta: `${item.market || "未配置市场"} · ${item.qualificationCategory || "未分类"}`,
      primary: `${item.sku || "无 SKU"} · ${item.fileCount || 0} 个附件`,
      secondary: `有效期至 ${dateOnly(item.expiryDate)}`,
      badge: labels[item.expiryStatus] || "待核对",
      tone: tones[item.expiryStatus] || "gray",
    });
  }
  if (moduleKey === "stockup-risks") return Object.assign({}, item, {
    thumbnailUrl: adminApi.businessImageUrl(item.imageKey),
    visualText: "险",
    title: item.name || item.sku,
    meta: `${item.country || "未配置国家"} · ${item.sku}`,
    primary: `净建议 ${formatNumber(item.netReplenishQty)} ${item.unit || "件"}`,
    secondary: `可用 ${formatNumber(item.availableQty)} · 在产 ${formatNumber(item.outsourcingInProductionQty)} · 覆盖 ${item.daysCover == null ? "—" : formatNumber(item.daysCover)} 天`,
    badge: item.status || "关注",
    tone: item.status === "缺货" ? "red" : "amber",
  });
  const statusLabels = { draft: "草稿", confirmed: "已确认", voided: "已作废" };
  const statusTones = { draft: "amber", confirmed: "green", voided: "gray" };
  const metrics = item.summary?.metrics || {};
  return Object.assign({}, item, {
    thumbnailUrl: "",
    visualText: "柜",
    title: item.name || item.planNo || "未命名方案",
    meta: `${item.containerType || "未选柜型"} · ${item.destinationWarehouseName || "未配置目的仓"}`,
    primary: item.sourceShipmentNo ? `发运单 ${item.sourceShipmentNo}` : "手工装柜方案",
    secondary: metrics.volumeUtilization == null ? `版本 V${item.version || 1}` : `体积利用率 ${formatNumber(metrics.volumeUtilization)}% · V${item.version || 1}`,
    badge: statusLabels[item.status] || item.status || "未知",
    tone: statusTones[item.status] || "gray",
  });
}

Page({
  data: {
    moduleKey: "",
    title: "经营数据",
    eyebrow: "BUSINESS DATA",
    subtitle: "",
    loading: true,
    error: "",
    query: "",
    filterKey: "",
    filters: [],
    warehouseOptions: [{ id: "", label: "全部仓库" }],
    warehouseIndex: 0,
    warehouseId: "",
    warehouseLabel: "全部仓库",
    metrics: [],
    items: [],
    emptyText: "暂无数据",
    updatedText: "",
  },

  onLoad(options) {
    const moduleKey = MODULES[options.module] ? options.module : "products";
    const config = MODULES[moduleKey];
    wx.setNavigationBarTitle({ title: config.title });
    this.setData({ moduleKey, title: config.title, eyebrow: config.eyebrow, subtitle: config.subtitle, filters: config.filters, emptyText: config.empty });
  },

  onShow() {
    const session = requireSession("admin");
    if (!session) return;
    this.session = session;
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  updateQuery(event) { this.setData({ query: event.detail.value }); },
  submitSearch() { this.load(); },
  clearSearch() { this.setData({ query: "" }); this.load(); },
  selectFilter(event) { this.setData({ filterKey: event.currentTarget.dataset.key || "" }); this.load(); },
  selectWarehouse(event) {
    const index = Number(event.detail.value || 0);
    const selected = this.data.warehouseOptions[index] || this.data.warehouseOptions[0];
    this.setData({ warehouseIndex: index, warehouseId: selected.id || "", warehouseLabel: selected.label || "全部仓库" });
    this.load();
  },
  openItem(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin-business-detail/index?module=${encodeURIComponent(this.data.moduleKey)}&id=${encodeURIComponent(id)}` });
  },
  openCalculator() {
    wx.navigateTo({ url: "/pages/admin-container-calculator/index" });
  },

  async load() {
    const moduleKey = this.data.moduleKey;
    const config = MODULES[moduleKey];
    if (!config) return;
    this.setData({ loading: true, error: "" });
    const filters = { keyword: this.data.query, limit: 100 };
    if (moduleKey === "domestic-inventory") {
      if (this.data.filterKey === "low") filters.lowStock = "1";
      if (this.data.warehouseId) filters.warehouseId = this.data.warehouseId;
    }
    if (moduleKey === "products" && this.data.filterKey) filters.country = this.data.filterKey;
    if (["qualifications", "container-loading"].includes(moduleKey) && this.data.filterKey) filters.status = this.data.filterKey;
    if (moduleKey === "stockup-risks" && this.data.filterKey) filters.status = this.data.filterKey;
    try {
      const result = await adminApi.fetchBusinessModule(moduleKey, filters);
      const summary = result.summary || {};
      const metrics = config.metrics.map(([key, label]) => ({ key, label, value: formatNumber(summary[key]), tone: ["lowStockSkuCount", "alerts", "expired", "stockout"].includes(key) && Number(summary[key]) > 0 ? "red" : ["expiring", "replenish", "draft"].includes(key) && Number(summary[key]) > 0 ? "orange" : "blue" }));
      const next = { metrics, items: (result.items || []).map((item) => decorateItem(moduleKey, item)), updatedText: result.updatedAt ? formatDate(result.updatedAt) : "刚刚" };
      if (moduleKey === "products" && !this.data.filterKey) next.filters = [{ key: "", label: "全部国家" }].concat((result.filters?.countries || []).map((country) => ({ key: country, label: country })));
      if (moduleKey === "domestic-inventory") {
        const warehouseOptions = [{ id: "", label: "全部仓库" }].concat((result.warehouses || []).map((warehouse) => ({ id: warehouse.id, label: `${warehouse.name}${warehouse.city ? ` · ${warehouse.city}` : ""}` })));
        const warehouseIndex = Math.max(0, warehouseOptions.findIndex((warehouse) => warehouse.id === this.data.warehouseId));
        next.warehouseOptions = warehouseOptions;
        next.warehouseIndex = warehouseIndex;
        next.warehouseLabel = warehouseOptions[warehouseIndex]?.label || "全部仓库";
      }
      this.setData(next);
    } catch (error) {
      this.setData({ error: error.message || "经营数据加载失败，请稍后重试。" });
    } finally {
      this.setData({ loading: false });
    }
  },
});

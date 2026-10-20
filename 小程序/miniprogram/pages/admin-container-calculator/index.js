const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { colorFor, drawContainerScene, sceneLegend } = require("../../utils/container-scene");

const STRATEGIES = {
  max_load: { label: "最大装载", note: "优先装入更多箱数" },
  balanced: { label: "重量均衡", note: "优先降低重心偏移" },
  sku_complete: { label: "SKU 完整", note: "优先整 SKU 装入" },
};

function emptyItem(index, source) {
  const value = source || {};
  return {
    id: value.id || `mobile-item-${Date.now()}-${index}`,
    sku: value.sku || "",
    productName: value.productName || "",
    cartonCount: value.cartonCount || "",
    unitsPerCarton: value.unitsPerCarton || 1,
    cartonLengthCm: value.cartonLengthCm || "",
    cartonWidthCm: value.cartonWidthCm || "",
    cartonHeightCm: value.cartonHeightCm || "",
    cartonWeightKg: value.cartonWeightKg || "",
    orientation: value.orientation || "upright",
  };
}

function formatNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
}

function candidateView(candidate) {
  const strategy = STRATEGIES[candidate.strategy] || { label: candidate.strategy, note: "" };
  const metrics = candidate.metrics || {};
  return Object.assign({}, candidate, {
    label: strategy.label,
    note: strategy.note,
    summary: `${formatNumber(metrics.loadedCartons)} / ${formatNumber(metrics.totalCartons)} 箱 · ${formatNumber(metrics.volumeUtilization)}%`,
    metricsView: [
      { label: "已装 / 总箱", value: `${formatNumber(metrics.loadedCartons)} / ${formatNumber(metrics.totalCartons)}` },
      { label: "未装箱数", value: formatNumber(metrics.unplacedCartons) },
      { label: "体积利用率", value: `${formatNumber(metrics.volumeUtilization)}%` },
      { label: "载重利用率", value: `${formatNumber(metrics.weightUtilization)}%` },
      { label: "已装重量", value: `${formatNumber(metrics.loadedWeightKg)} kg` },
      { label: "平衡评分", value: formatNumber(metrics.balanceScore) },
    ],
  });
}

Page({
  data: {
    loading: true,
    bootstrapReady: false,
    error: "",
    calculating: false,
    sourceOptions: [{ id: "", label: "手工录入（不关联发运单）" }],
    sourceIndex: 0,
    sourceLabel: "手工录入（不关联发运单）",
    containerTypes: [],
    containerIndex: 0,
    containerLabel: "读取柜型…",
    items: [emptyItem(0)],
    limits: { maxCartons: 2000 },
    hasResult: false,
    resultStrategies: [],
    selectedStrategy: "max_load",
    candidate: { metricsView: [], warnings: [] },
    viewMode: "iso",
    sceneNote: "完成测算后显示装载分布",
    sceneLegend: [],
  },

  onLoad() {
    this.rotation = { yaw: -0.62, pitch: 0.42 };
    wx.setNavigationBarTitle({ title: "临时装柜测算" });
  },

  onShow() {
    if (!requireSession("admin")) return;
    if (!this.bootstrapLoaded) this.loadBootstrap();
  },

  async loadBootstrap() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchContainerCalculatorBootstrap();
      const sourceOptions = [{ id: "", label: "手工录入（不关联发运单）", lines: [] }].concat((result.shipments || []).map((shipment) => ({
        id: shipment.id,
        label: `${shipment.shipmentNo || "未编号发运"} · ${shipment.destinationWarehouseName || shipment.destinationCountry || "未配置目的仓"} · ${shipment.packages || 0} 箱`,
        lines: shipment.lines || [],
      })));
      const containerTypes = result.containerTypes || [];
      const containerIndex = Math.max(0, containerTypes.findIndex((item) => item.code === "40HQ"));
      this.bootstrapLoaded = true;
      this.setData({
        loading: false,
        bootstrapReady: true,
        sourceOptions,
        sourceLabel: sourceOptions[0].label,
        containerTypes,
        containerIndex,
        containerLabel: containerTypes[containerIndex]?.name || "暂无柜型",
        limits: result.limits || { maxCartons: 2000 },
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "临时测算初始化失败，请稍后重试。" });
    }
  },

  selectSource(event) {
    const sourceIndex = Number(event.detail.value || 0);
    const source = this.data.sourceOptions[sourceIndex] || this.data.sourceOptions[0];
    const items = source.id && source.lines.length ? source.lines.map((item, index) => emptyItem(index, item)) : [emptyItem(0)];
    this.setData({ sourceIndex, sourceLabel: source.label, items, hasResult: false });
  },

  selectContainer(event) {
    const containerIndex = Number(event.detail.value || 0);
    const container = this.data.containerTypes[containerIndex] || {};
    this.setData({ containerIndex, containerLabel: container.name || container.code || "暂无柜型", hasResult: false });
  },

  updateItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (!Number.isInteger(index) || !field) return;
    this.setData({ [`items[${index}].${field}`]: event.detail.value, hasResult: false });
  },

  addItem() {
    if (this.data.items.length >= 50) return wx.showToast({ title: "一次最多录入 50 行", icon: "none" });
    this.setData({ items: this.data.items.concat(emptyItem(this.data.items.length)), hasResult: false });
  },

  removeItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (this.data.items.length <= 1) return;
    this.setData({ items: this.data.items.filter((_, itemIndex) => itemIndex !== index), hasResult: false });
  },

  validatedItems() {
    const numericFields = ["cartonCount", "unitsPerCarton", "cartonLengthCm", "cartonWidthCm", "cartonHeightCm", "cartonWeightKg"];
    const labels = { cartonCount: "箱数", unitsPerCarton: "每箱件数", cartonLengthCm: "外箱长度", cartonWidthCm: "外箱宽度", cartonHeightCm: "外箱高度", cartonWeightKg: "单箱重量" };
    const items = this.data.items.map((item, index) => {
      if (!String(item.sku || "").trim()) throw new Error(`第 ${index + 1} 行请填写 SKU。`);
      numericFields.forEach((field) => {
        if (!(Number(item[field]) > 0)) throw new Error(`第 ${index + 1} 行${labels[field]}必须大于 0。`);
      });
      const normalized = Object.assign({}, item, { sku: String(item.sku).trim(), productName: String(item.productName || item.sku).trim() });
      numericFields.forEach((field) => { normalized[field] = Number(item[field]); });
      return normalized;
    });
    const totalCartons = items.reduce((sum, item) => sum + Math.floor(item.cartonCount), 0);
    if (totalCartons > Number(this.data.limits.maxCartons || 2000)) throw new Error(`单次最多测算 ${this.data.limits.maxCartons || 2000} 箱，当前为 ${totalCartons} 箱。`);
    return items;
  },

  async runCalculation() {
    if (this.data.calculating) return;
    let items;
    try { items = this.validatedItems(); }
    catch (error) { return wx.showToast({ title: error.message, icon: "none", duration: 2600 }); }
    const source = this.data.sourceOptions[this.data.sourceIndex] || {};
    const container = this.data.containerTypes[this.data.containerIndex] || {};
    if (!container.code) return wx.showToast({ title: "请先选择柜型", icon: "none" });
    this.setData({ calculating: true, error: "", hasResult: false });
    try {
      const result = await adminApi.runContainerCalculation({
        sourceShipmentId: source.id || "",
        containerType: container.code,
        selectedStrategy: "max_load",
        items,
      });
      this.candidates = (result.candidates || []).map(candidateView);
      this.resultContainer = result.container || container;
      this.resultItems = result.items || items;
      const selectedStrategy = result.selectedStrategy || this.candidates[0]?.strategy || "max_load";
      this.showCandidate(selectedStrategy, false);
      this.setData({
        calculating: false,
        hasResult: true,
        resultStrategies: this.candidates,
        sceneLegend: sceneLegend(this.resultItems),
      }, () => setTimeout(() => this.prepareCanvas(), 30));
    } catch (error) {
      this.setData({ calculating: false, error: error.message || "装柜测算失败，请检查箱规后重试。" });
    }
  },

  selectResultStrategy(event) {
    this.showCandidate(event.currentTarget.dataset.strategy || "max_load", true);
  },

  showCandidate(strategy, redraw) {
    const candidate = (this.candidates || []).find((item) => item.strategy === strategy) || this.candidates?.[0];
    if (!candidate) return;
    this.scene = { container: this.resultContainer || {}, placements: candidate.placements || [] };
    const sceneNote = candidate.renderLimited
      ? `共 ${candidate.totalPlacements} 箱，移动端绘制前 ${candidate.renderedPlacements} 箱；拖动可旋转`
      : `已绘制 ${candidate.renderedPlacements || 0} 箱；拖动可旋转，切换视角查看分布`;
    this.setData({ selectedStrategy: candidate.strategy, candidate, sceneNote }, () => { if (redraw) this.drawScene(); });
  },

  setViewMode(event) {
    this.setData({ viewMode: event.currentTarget.dataset.mode || "iso" }, () => this.drawScene());
  },

  startRotate(event) {
    const touch = event.touches && event.touches[0];
    if (touch) this.lastTouch = { x: touch.clientX, y: touch.clientY };
  },

  rotateScene(event) {
    if (this.data.viewMode !== "iso") return;
    const touch = event.touches && event.touches[0];
    if (!touch || !this.lastTouch) return;
    this.rotation.yaw += (touch.clientX - this.lastTouch.x) * 0.012;
    this.rotation.pitch = Math.max(0.12, Math.min(1.12, this.rotation.pitch + (touch.clientY - this.lastTouch.y) * 0.008));
    this.lastTouch = { x: touch.clientX, y: touch.clientY };
    this.drawScene();
  },

  prepareCanvas() {
    wx.createSelectorQuery().in(this).select("#calculatorScene").fields({ node: true, size: true }).exec((result) => {
      const target = result && result[0];
      if (!target || !target.node) return;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 1;
      this.canvas = target.node;
      this.canvas.width = target.width * dpr;
      this.canvas.height = target.height * dpr;
      this.canvasSize = { width: target.width, height: target.height, dpr };
      this.drawScene();
    });
  },

  drawScene() {
    drawContainerScene({ canvas: this.canvas, size: this.canvasSize, scene: this.scene, mode: this.data.viewMode, rotation: this.rotation, maxBoxes: 600 });
  },
});

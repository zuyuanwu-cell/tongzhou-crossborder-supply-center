const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { formatDate } = require("../../utils/format");
const { drawContainerScene } = require("../../utils/container-scene");

const MODULES = {
  "domestic-inventory": { title: "库存详情", eyebrow: "INVENTORY DETAIL" },
  products: { title: "产品详情", eyebrow: "PRODUCT DETAIL" },
  qualifications: { title: "资质详情", eyebrow: "QUALIFICATION DETAIL" },
  "stockup-risks": { title: "备货风险详情", eyebrow: "STOCKUP RISK" },
  "container-loading": { title: "3D 装柜详情", eyebrow: "SMART LOADING" },
};

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? String(Math.round(parsed * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
}

function date(value) {
  return value ? formatDate(value) : "—";
}

function field(label, value, options) {
  const opts = options || {};
  const empty = value === undefined || value === null || value === "";
  if (empty && !opts.keepEmpty) return null;
  return { label, value: empty ? "—" : String(value), accent: Boolean(opts.accent) };
}

function section(title, fields) {
  return { title, fields: fields.filter(Boolean) };
}

function productImage(item) {
  return adminApi.businessImageUrl(item.imageKey);
}

function decorate(moduleKey, item) {
  if (moduleKey === "domestic-inventory") {
    return {
      hero: { title: item.productName || item.sku, subtitle: `${item.warehouseName || "未分配仓库"} · ${item.sku}`, badge: item.lowStock ? "低库存" : "库存正常", tone: item.lowStock ? "red" : "green", imageUrl: productImage(item), visualText: "库" },
      metrics: [
        { label: "可用库存", value: `${number(item.availableQty)} ${item.unit || "件"}` },
        { label: "在库数量", value: number(item.onHandQty) },
        { label: "占用数量", value: number(item.reservedQty) },
        { label: "安全库存", value: number(item.safetyStockQty) },
      ],
      sections: [
        section("库存归属", [field("仓库", item.warehouseName), field("仓库编号", item.warehouseId), field("SKU", item.sku), field("规格", item.specification), field("条码", item.barcode)]),
        section("库存状态", [field("风险判断", item.lowStock ? "可用库存已到安全库存线" : "可用库存高于安全库存线", { accent: item.lowStock }), field("最后更新", date(item.updatedAt))]),
      ],
      descriptions: [], files: [],
    };
  }
  if (moduleKey === "products") {
    const prices = [
      item.directPrice !== undefined ? `直营 ${item.directCurrency || ""} ${number(item.directPrice)}` : "",
      item.distributionPrice !== undefined ? `分销 ${item.distributionCurrency || ""} ${number(item.distributionPrice)}` : "",
      item.salesPrice !== undefined ? `售价 ${item.salesCurrency || ""} ${number(item.salesPrice)}` : "",
    ].filter(Boolean);
    return {
      hero: { title: item.name || item.sku, subtitle: item.nameEn || `${item.country || "未配置国家"} · ${item.sku}`, badge: item.alert || item.status || "产品档案", tone: item.alert && item.alert !== "健康" ? "red" : "green", imageUrl: productImage(item), visualText: "产" },
      metrics: [
        { label: "当前库存", value: number(item.stockQty || item.warehouseTotalQty) },
        { label: "在途数量", value: number(item.inTransitQty) },
        { label: "国家", value: item.country || "—" },
        { label: "单位", value: item.unit || "件" },
      ],
      sections: [
        section("产品识别", [field("SKU", item.sku), field("SKU 编号", item.skuNo), field("国家 SKU", item.countrySku), field("条码", item.barcode), field("规格", item.specification)]),
        section("经营属性", [field("品牌", item.brand), field("品类", item.category), field("功能分类", item.functionCategory), field("产品类型", item.productType), field("SKU 属性", item.skuAttribute), field("渠道", item.channel), field("价格", prices.join(" · "))]),
        section("包装尺寸", [field("重量", item.weight), field("长", item.length), field("宽", item.width), field("高", item.height), field("所属项目", item.project)]),
      ],
      descriptions: [
        item.publicDescription ? { title: "公开产品说明", body: item.publicDescription } : null,
        item.sellingPoints ? { title: "中文卖点", body: item.sellingPoints } : null,
        item.sellingPointsEn ? { title: "英文卖点", body: item.sellingPointsEn } : null,
      ].filter(Boolean), files: [],
    };
  }
  if (moduleKey === "qualifications") {
    const labels = { valid: "有效", expiring: "即将到期", expired: "已过期", undated: "未维护日期" };
    const tones = { valid: "green", expiring: "amber", expired: "red", undated: "gray" };
    return {
      hero: { title: item.qualificationName || item.productName || item.sku, subtitle: `${item.market || "未配置市场"} · ${item.sku || "无 SKU"}`, badge: labels[item.expiryStatus] || "待核对", tone: tones[item.expiryStatus] || "gray", imageUrl: "", visualText: "资" },
      metrics: [
        { label: "附件", value: `${(item.files || []).length} 个` },
        { label: "距到期", value: item.daysToExpiry == null ? "—" : item.daysToExpiry < 0 ? `逾期 ${Math.abs(item.daysToExpiry)} 天` : `${item.daysToExpiry} 天` },
      ],
      sections: [
        section("资质档案", [field("产品", item.productName), field("SKU", item.sku), field("资质分类", item.qualificationCategory), field("适用市场", item.market), field("证书/签发方", item.issuer)]),
        section("有效期限", [field("生效日期", date(item.effectiveDate)), field("到期日期", date(item.expiryDate)), field("状态", labels[item.expiryStatus] || "待核对", { accent: ["expired", "expiring"].includes(item.expiryStatus) })]),
      ],
      descriptions: item.remark ? [{ title: "备注", body: item.remark }] : [], files: item.files || [],
    };
  }
  if (moduleKey === "stockup-risks") {
    return {
      hero: { title: item.name || item.sku, subtitle: `${item.country || "未配置国家"} · ${item.sku}`, badge: item.status || "关注", tone: item.status === "缺货" ? "red" : "amber", imageUrl: productImage(item), visualText: "险" },
      metrics: [
        { label: "净建议量", value: `${number(item.netReplenishQty)} ${item.unit || "件"}` },
        { label: "可用库存", value: number(item.availableQty) },
        { label: "在途数量", value: number(item.inTransitQty) },
        { label: "委外在产", value: number(item.outsourcingInProductionQty) },
      ],
      sections: [
        section("需求依据", [field("近 30 天销量", number(item.sales30)), field("库存覆盖", item.daysCover == null ? "—" : `${number(item.daysCover)} 天`), field("原始补货建议", `${number(item.replenishQty)} ${item.unit || "件"}`), field("净补货建议", `${number(item.netReplenishQty)} ${item.unit || "件"}`, { accent: true })]),
      ],
      descriptions: item.suggestion ? [{ title: "系统建议", body: item.suggestion }] : [], files: [],
    };
  }
  const candidate = item.candidate || {};
  const metrics = candidate.metrics || {};
  const statusLabels = { draft: "草稿", confirmed: "已确认", voided: "已作废", loaded: "已装柜" };
  const statusTones = { draft: "amber", confirmed: "green", voided: "gray", loaded: "blue" };
  return {
    hero: { title: item.name || item.planNo || "装柜方案", subtitle: `${item.planNo || "无方案号"} · ${item.containerType || "未选柜型"}`, badge: statusLabels[item.status] || item.status || "未知", tone: statusTones[item.status] || "gray", imageUrl: "", visualText: "3D" },
    metrics: [
      { label: "已装 / 总箱", value: `${number(metrics.loadedCartons)} / ${number(metrics.totalCartons)}` },
      { label: "体积利用率", value: `${number(metrics.volumeUtilization)}%` },
      { label: "载重利用率", value: `${number(metrics.weightUtilization)}%` },
      { label: "平衡评分", value: number(metrics.balanceScore) },
    ],
    sections: [
      section("方案信息", [field("来源发运单", item.sourceShipmentNo || "手工方案"), field("目的仓", item.destinationWarehouseName), field("选定策略", item.selectedStrategy), field("版本", `V${item.version || 1}`), field("创建人", item.createdByName), field("最后更新", date(item.updatedAt))]),
      section("柜体参数", [field("柜型", item.container?.name || item.containerType), field("内部尺寸", item.container?.lengthCm ? `${number(item.container.lengthCm)} × ${number(item.container.widthCm)} × ${number(item.container.heightCm)} cm` : "—"), field("最大载重", item.container?.maxPayloadKg ? `${number(item.container.maxPayloadKg)} kg` : "—"), field("已装重量", `${number(metrics.loadedWeightKg)} kg`)]),
    ],
    descriptions: (candidate.warnings || []).map((warning, index) => ({ title: `装载提示 ${index + 1}`, body: warning })),
    files: [],
  };
}

function colorFor(value) {
  let hash = 0;
  for (const character of String(value || "SKU")) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 330}, 58%, 51%)`;
}

function sceneLegend(items) {
  return (items || []).slice(0, 8).map((item) => ({ sku: item.sku, name: item.productName, cartons: item.cartonCount, color: colorFor(item.sku) }));
}

function corners(box) {
  const x0 = Number(box.x || 0); const y0 = Number(box.y || 0); const z0 = Number(box.z || 0);
  const x1 = x0 + Number(box.lengthCm || 0); const y1 = y0 + Number(box.widthCm || 0); const z1 = z0 + Number(box.heightCm || 0);
  return [
    { x: x0, y: y0, z: z0 }, { x: x1, y: y0, z: z0 }, { x: x1, y: y1, z: z0 }, { x: x0, y: y1, z: z0 },
    { x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, { x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 },
  ];
}

Page({
  data: {
    moduleKey: "",
    recordId: "",
    title: "经营详情",
    eyebrow: "BUSINESS DETAIL",
    loading: true,
    error: "",
    detail: { hero: {}, metrics: [], sections: [], descriptions: [], files: [] },
    isContainer: false,
    viewMode: "iso",
    sceneNote: "拖动可旋转，切换视角查看装载分布",
    sceneLegend: [],
    containerItems: [],
  },

  onLoad(options) {
    const moduleKey = MODULES[options.module] ? options.module : "products";
    const config = MODULES[moduleKey];
    let recordId = options.id || "";
    try { recordId = decodeURIComponent(recordId); } catch { recordId = options.id || ""; }
    this.rotation = { yaw: -0.62, pitch: 0.42 };
    this.setData({ moduleKey, recordId, title: config.title, eyebrow: config.eyebrow, isContainer: moduleKey === "container-loading" });
    wx.setNavigationBarTitle({ title: config.title });
  },

  onShow() {
    if (!requireSession("admin")) return;
    if (!this.loaded) this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    if (!this.data.recordId) return this.setData({ loading: false, error: "缺少详情记录编号。" });
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchBusinessDetail(this.data.moduleKey, this.data.recordId);
      const item = result.item || {};
      const next = { detail: decorate(this.data.moduleKey, item), loading: false };
      if (this.data.isContainer) {
        const candidate = item.candidate || {};
        this.scene = { container: item.container || {}, placements: candidate.placements || [] };
        next.sceneLegend = sceneLegend(item.items || []);
        next.containerItems = (item.items || []).map((entry) => ({ ...entry, color: colorFor(entry.sku) }));
        next.sceneNote = candidate.renderLimited
          ? `方案共 ${candidate.totalPlacements} 箱，移动端展示前 ${candidate.renderedPlacements} 箱；拖动可旋转`
          : `已绘制 ${candidate.renderedPlacements || 0} 箱；拖动可旋转，切换视角查看分布`;
      }
      this.loaded = true;
      this.setData(next, () => { if (this.data.isContainer) setTimeout(() => this.prepareCanvas(), 30); });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "详情加载失败，请稍后重试。" });
    }
  },

  setViewMode(event) {
    const mode = event.currentTarget.dataset.mode || "iso";
    this.setData({ viewMode: mode }, () => this.drawScene());
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
    wx.createSelectorQuery().in(this).select("#loadingScene").fields({ node: true, size: true }).exec((result) => {
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

  openFile(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    if (/\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(url)) return wx.previewImage({ urls: [url], current: url });
    wx.showLoading({ title: "读取附件" });
    wx.downloadFile({
      url,
      success: (result) => {
        if (result.statusCode !== 200) return wx.showToast({ title: "附件读取失败", icon: "none" });
        wx.openDocument({ filePath: result.tempFilePath, showMenu: true, fail: () => wx.showToast({ title: "暂不支持此附件格式", icon: "none" }) });
      },
      fail: () => wx.showToast({ title: "附件域名未配置或文件失效", icon: "none" }),
      complete: () => wx.hideLoading(),
    });
  },
});

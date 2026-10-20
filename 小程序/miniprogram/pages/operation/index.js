const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { getWorkspace, canAction } = require("../../utils/workspace");
const { scanReceivedBarcode } = require("../../utils/receiving-barcode");

const typeMeta = {
  inbound: { title: "发起入库申请", verb: "入库", note: "到货入库、采购入库或退件入库" },
  outbound: { title: "发起出库申请", verb: "出库", note: "备货出库、调拨出库或样品寄出" },
  stocktake: { title: "提交盘点差异", verb: "盘点", note: "提交实盘数量，由中台审核差异" },
};

Page({
  data: {
    type: "inbound",
    meta: typeMeta.inbound,
    types: [{ value: "inbound", label: "入库" }, { value: "outbound", label: "出库" }, { value: "stocktake", label: "盘点" }],
    inventory: [], productNames: [], selectedIndex: 0, lines: [],
    form: { referenceNo: "", note: "" },
    loading: true, busy: false,
  },
  onLoad(options) {
    const type = typeMeta[options.type] ? options.type : "inbound";
    this.initialSku = options.sku ? decodeURIComponent(options.sku) : "";
    this.setData({ type, meta: typeMeta[type] });
  },
  onShow() {
    const session = requireSession("partner");
    if (!session) return;
    const requiredAction = { inbound: "inbound_confirm", outbound: "outbound_confirm", stocktake: "inventory_adjustment" }[this.data.type];
    if (getWorkspace(session).kind !== "warehouse" || !canAction(getWorkspace(session), requiredAction)) {
      wx.showModal({ title: "当前岗位无权发起此作业", content: "请返回工作台查看你可以使用的业务模块。", showCancel: false, success: () => wx.reLaunch({ url: "/pages/index/index" }) });
      return;
    }
    if (!this.loaded) this.loadInventory();
  },
  async loadInventory() {
    this.setData({ loading: true });
    try {
      const result = await api.fetchInventory();
      const inventory = result.items;
      const selectedIndex = Math.max(0, inventory.findIndex((item) => item.sku === this.initialSku));
      this.setData({ inventory, productNames: inventory.map((item) => `${item.productName} · ${item.sku}`), selectedIndex });
      if (this.initialSku && inventory[selectedIndex]) this.addLine(inventory[selectedIndex]);
      this.loaded = true;
    } catch (error) { wx.showModal({ title: "库存读取失败", content: error.message || "请稍后重试。", showCancel: false }); }
    finally { this.setData({ loading: false }); }
  },
  changeType(event) { const type = event.currentTarget.dataset.type; this.setData({ type, meta: typeMeta[type], lines: [] }); },
  chooseProduct(event) { this.setData({ selectedIndex: Number(event.detail.value) }); },
  addSelected() { const item = this.data.inventory[this.data.selectedIndex]; if (item) this.addLine(item); },
  scanProduct() {
    wx.scanCode({
      scanType: ["barCode", "qrCode"],
      success: async (result) => {
        const scanned = String(result.result || "").trim();
        if (!scanned) return;
        wx.showLoading({ title: "识别商品", mask: true });
        try {
          const response = await api.fetchInventory(scanned);
          const key = scanned.replace(/\s+/g, "").toUpperCase();
          const exact = response.items.filter((item) => [item.barcode, item.sku].some((value) => String(value || "").replace(/\s+/g, "").toUpperCase() === key));
          const matches = exact.length ? exact : response.items;
          wx.hideLoading();
          if (matches.length !== 1) return wx.showModal({ title: matches.length ? "条码匹配到多个商品" : "未找到商品", content: matches.length ? "请改用完整条码或在商品列表中选择。" : "本仓有库存商品中没有该条码，请核对条码或先同步库存。", showCancel: false });
          this.addLine(matches[0]);
          wx.showToast({ title: "商品已添加", icon: "success" });
        } catch (error) {
          wx.hideLoading();
          wx.showModal({ title: "条码查询失败", content: error.message || "请稍后重试。", showCancel: false });
        }
      },
      fail: (error) => { if (!String(error.errMsg || "").includes("cancel")) wx.showToast({ title: "扫码失败", icon: "none" }); },
    });
  },
  addLine(item) {
    if (this.data.lines.some((line) => line.sku === item.sku)) return wx.showToast({ title: "该商品已添加", icon: "none" });
    const line = Object.assign({}, item, { initial: String(item.productName).slice(0, 1), quantity: 1, countedQuantity: Number(item.availableQuantity) + Number(item.lockedQuantity), lotNo: "", barcode: item.barcode || "", productionDate: "", expiryDate: "" });
    this.setData({ lines: this.data.lines.concat(line) });
  },
  removeLine(event) { const lines = this.data.lines.slice(); lines.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ lines }); },
  updateForm(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  updateLine(event) { this.setData({ [`lines[${event.currentTarget.dataset.index}].${event.currentTarget.dataset.field}`]: event.detail.value }); },
  chooseLineDate(event) { this.setData({ [`lines[${event.currentTarget.dataset.index}].${event.currentTarget.dataset.field}`]: event.detail.value }); },
  scanLine(event) {
    const index = Number(event.currentTarget.dataset.index);
    const line = this.data.lines[index];
    if (!line) return;
    scanReceivedBarcode({
      currentValue: line.barcode,
      onCaptured: (barcode) => this.setData({ [`lines[${index}].barcode`]: barcode }),
    });
  },
  async submit() {
    if (this.data.busy) return;
    const form = this.data.form;
    if (!this.data.lines.length) return wx.showToast({ title: "请至少添加一个商品", icon: "none" });
    if (!form.note.trim()) return wx.showToast({ title: "请填写作业说明", icon: "none" });
    const numberField = this.data.type === "stocktake" ? "countedQuantity" : "quantity";
    if (this.data.lines.some((line) => Number(line[numberField]) < (numberField === "quantity" ? 1 : 0))) return wx.showToast({ title: "请填写正确的数量", icon: "none" });
    if (this.data.type === "outbound") {
      const shortage = this.data.lines.find((line) => Number(line.quantity) > Number(line.availableQuantity));
      if (shortage) return wx.showModal({ title: "可用库存不足", content: `${shortage.sku} 当前可用 ${shortage.availableQuantity} ${shortage.unit}。`, showCancel: false });
    }
    const confirmed = await new Promise((resolve) => wx.showModal({ title: `确认提交${this.data.meta.verb}申请`, content: "提交后将进入中台审批，不会立即改变库存。", confirmText: "提交审批", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirmed) return;
    const payloadLines = this.data.lines.map((line) => this.data.type === "stocktake"
      ? { sku: line.sku, productName: line.productName, imageUrl: line.imageUrl || "", countedQuantity: Number(line.countedQuantity), unit: line.unit }
      : { sku: line.sku, productName: line.productName, imageUrl: line.imageUrl || "", quantity: Number(line.quantity), unit: line.unit, lotNo: line.lotNo || "", barcode: line.barcode || "", productionDate: line.productionDate || "", expiryDate: line.expiryDate || "" });
    this.setData({ busy: true });
    wx.showLoading({ title: "正在提交", mask: true });
    try {
      await api.createWarehouseOperation({ operationType: this.data.type, warehouseRef: this.data.lines[0].warehouseRef, referenceNo: form.referenceNo.trim(), note: form.note.trim(), lines: payloadLines });
      wx.hideLoading();
      wx.showModal({ title: "申请已提交", content: "作业已进入中台审批。审批通过前不会改变库存，请勿重复提交。", showCancel: false, confirmText: "查看任务", confirmColor: "#173D7A", success: () => wx.redirectTo({ url: "/pages/tasks/index" }) });
    } catch (error) { wx.hideLoading(); wx.showModal({ title: "提交失败", content: error.message || "请检查填写内容后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  }
});

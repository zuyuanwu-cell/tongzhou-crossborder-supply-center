const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { decorateTask, formatDate, formatFullDate } = require("../../utils/format");
const { getWorkspace, canAction, canCapability } = require("../../utils/workspace");
const { productionSteps } = require("../../utils/production");
const { createSampleVariant, buildSamplingWorkspace, validateSampleRound, sampleArtifactInput } = require("../../utils/sampling");
const { scanReceivedBarcode } = require("../../utils/receiving-barcode");

const PRODUCTION_STAGES = [
  { value: "planning", label: "排产准备" }, { value: "material_preparation", label: "物料准备" },
  { value: "filling", label: "灌装生产" }, { value: "packaging", label: "包装装箱" },
  { value: "quality_check", label: "质检" }, { value: "ready_to_ship", label: "待发货" },
];
const PURCHASE_STAGES = [
  { value: "confirmed", label: "订单确认" }, { value: "preparing", label: "备货中" },
  { value: "ready_to_ship", label: "待发货" }, { value: "shipped", label: "已发货" },
  { value: "delivered", label: "已交付" },
];
const READINESS_OPTIONS = [
  { value: "not_arrived", label: "未到齐" }, { value: "partial", label: "部分到齐" }, { value: "arrived", label: "已到齐" },
];
const TEST_OPTIONS = [
  { value: "pending", label: "待测试" }, { value: "passed", label: "测试合格" },
  { value: "failed", label: "测试异常" }, { value: "not_required", label: "无需测试" },
];
const EXCEPTION_CATEGORIES = [
  { value: "material_shortage", label: "物料短缺" }, { value: "material_quality", label: "物料质量" },
  { value: "packaging_test", label: "包材测试" }, { value: "production_delay", label: "生产延期" },
  { value: "quality_issue", label: "品质异常" }, { value: "delivery_delay", label: "交付延期" },
  { value: "other", label: "其他" },
];
const SEVERITY_OPTIONS = [
  { value: "notice", label: "提示" }, { value: "warning", label: "警告" }, { value: "critical", label: "严重" },
];
const FIRST_ARTICLE_CATEGORY_LABELS = {
  packaging: "包装六面", inner_pack: "内托内包", coding: "打码位置", finished: "成品效果", carton: "外箱装箱",
};
const AI_FIELD_LABELS = {
  stage: "阶段", progressPercent: "完成百分比", percent: "完成百分比", completedQuantity: "已完成数量",
  expectedCompletionDate: "预计完成日期", expectedDeliveryDate: "预计交付日期", note: "进度说明",
};

function progressLabels(itemType) {
  if (itemType === "packaging_quote") return ["待报价", "报价准备", "已回传", "定标结果"];
  if (itemType === "production_order") return ["待接单", "生产执行", "结果回传", "中台确认"];
  if (itemType === "filing_task") return ["待接单", "资料办理", "结果回传", "中台确认"];
  if (itemType === "sampling_task") return ["待接单", "打样执行", "样品回传", "中台确认"];
  return ["待接单", "处理中", "已回传", "中台确认"];
}

function progressSteps(item, stopped) {
  return progressLabels(item.itemType).map((label, index) => ({ label, number: index + 1, done: index <= item.progressStep, stopped: stopped && index === item.progressStep }));
}

function primaryAction(item, workspace) {
  if (item.itemType === "packaging_quote") return { label: "", action: "" };
  if (item.status === "pending" && canAction(workspace, "accept")) return { label: "确认接单", action: "accept" };
  if (item.isPartnerOrder) return { label: "", action: "" };
  if (item.status === "accepted" && canAction(workspace, "progress")) return { label: "开始处理", action: "progress" };
  if (item.status !== "in_progress") return { label: "", action: "" };
  if (item.itemType === "sampling_task") return { label: "", action: "" };
  const warehouseAction = ({ warehouse_inbound: "inbound_confirm", warehouse_outbound: "outbound_confirm", warehouse_transfer: "transfer_receive" })[item.itemType];
  if (warehouseAction && canAction(workspace, warehouseAction)) return { label: "提交处理结果", action: warehouseAction };
  if (canAction(workspace, "complete")) return { label: "提交完成", action: "complete" };
  return { label: "", action: "" };
}

function oemFacts(payload) {
  return [
    { label: "订单编号", value: payload.orderNo || payload.projectCode || "—" },
    { label: "商品/项目", value: payload.productName || "—" },
    { label: "规格要求", value: payload.productSpec || "—" },
    { label: "交付地址", value: payload.deliveryAddress || "—" },
    { label: "目标数量", value: payload.quantity ? `${payload.quantity} ${payload.unit || "件"}` : "—" },
    { label: "期望交付", value: payload.deliveryDate || "—" },
  ];
}

function today() { return new Date().toISOString().slice(0, 10); }

function reportValue(report, key, fallback) {
  if (report && report[key] !== undefined && report[key] !== null && report[key] !== "") return report[key];
  if (report?.details && report.details[key] !== undefined && report.details[key] !== null && report.details[key] !== "") return report.details[key];
  return fallback;
}

function normalizeReports(reports) {
  const labels = {
    production_progress: "生产进度", material_readiness: "物料与包材", purchase_fulfillment: "履约进度",
    shipment: "发货反馈", exception: "异常上报",
  };
  return (reports || []).map((report) => Object.assign({}, report.details || {}, report, {
    typeLabel: labels[report.reportType] || "协同反馈",
    timeText: formatFullDate(report.createdAt),
  }));
}

function latestReport(reports, reportType, lineId) {
  return (reports || []).find((report) => report.reportType === reportType && (!lineId || report.lineId === lineId)) || {};
}

function firstArticleView(source) {
  if (!source || typeof source !== "object") return null;
  const matchedLabels = { barcode: "条码精确关联", sku: "SKU 精确关联", product_name: "产品名精确关联" };
  return Object.assign({}, source, {
    matchedLabel: matchedLabels[source.matchedBy] || "已关联首件档案",
    updatedText: formatFullDate(source.updatedAt),
    facts: [
      { label: "档案号", value: source.documentNo || "—" },
      { label: "产品 / SKU", value: [source.productName, source.productSku].filter(Boolean).join(" / ") || "—" },
      { label: "规格 / 条码", value: [source.specification, source.barcode].filter(Boolean).join(" / ") || "—" },
      { label: "备案 / BPOM", value: [source.filingName, source.bpom].filter(Boolean).join(" / ") || "—" },
      { label: "装箱规格", value: source.cartonSpecification || "—" },
    ],
    images: (source.images || []).map((image) => Object.assign({}, image, { categoryLabel: FIRST_ARTICLE_CATEGORY_LABELS[image.category] || image.label || "首件图片" })),
    bom: source.bom || [],
  });
}

function formatNumber(value) {
  const normalized = Number(value || 0);
  return Number.isFinite(normalized) ? normalized.toLocaleString("zh-CN") : "0";
}

function formatMoney(value, currency) {
  const normalized = Number(value || 0);
  const prefix = currency === "CNY" || !currency ? "¥" : `${currency} `;
  return `${prefix}${normalized.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function purchaseSettlementView(payload) {
  if (!payload || payload.settlementBasis !== "purchase_inbound") return null;
  const unit = payload.unit || "件";
  const currency = payload.currency || "CNY";
  return {
    linkedProductionOrderNo: payload.linkedProductionOrderNo || payload.projectCode || "未关联",
    orderNo: payload.orderNo || "—",
    orderedAtText: formatFullDate(payload.orderedAt),
    status: payload.settlementStatus || (payload.inboundDocuments?.length ? "待核对" : "未入库"),
    metrics: [
      { label: "采购数量", value: `${formatNumber(payload.quantity)} ${unit}` },
      { label: "累计采购入库", value: `${formatNumber(payload.receivedQuantity)} ${unit}` },
      { label: "待入库", value: `${formatNumber(payload.pendingReceiptQuantity)} ${unit}` },
      { label: "入库应付", value: formatMoney(payload.payableAmount, currency), highlight: true },
    ],
    inboundDocuments: (payload.inboundDocuments || []).map((receipt) => ({
      inboundNo: receipt.inboundNo,
      inboundAtText: formatFullDate(receipt.inboundAt),
      quantityText: `${formatNumber(receipt.receivedQuantity)} ${unit}`,
      amountText: formatMoney(receipt.payableAmount, currency),
      settlementStatus: receipt.settlementStatus || "待核对",
    })),
  };
}

function orderLineView(line) {
  const currency = line.currency || "CNY";
  return Object.assign({}, line, {
    initial: String(line.productName || line.sku || "物").slice(0, 1),
    lineTypeLabel: ({ finished_product: "成品", raw_material: "物料", packaging: "包材" })[line.lineType] || "物料",
    unitPriceText: line.unitPrice === null || line.unitPrice === undefined ? "—" : formatMoney(line.unitPrice, currency),
    amountText: line.unitPrice === null || line.unitPrice === undefined ? "—" : formatMoney(Number(line.unitPrice) * Number(line.plannedQuantity || 0), currency),
  });
}

Page({
  data: {
    id: "", item: null, lines: [], events: [], media: [], note: "", loading: true, error: "", busy: false,
    workspace: null, detailMode: "warehouse", primaryLabel: "", primaryActionName: "", canReport: false, canUpload: false, progress: [],
    canSubmitQuote: false, canSubmitArtifact: false, canUpdateMilestone: false, artifactResultLabel: "待中台确认",
    facts: [], sourceFacts: [], fulfillmentLabel: "", oem: { artifacts: [], quotes: [], milestones: [] },
    isPartnerOrder: false, canReportOrder: false, partnerOrder: { lines: [], reports: [] }, orderLines: [], reports: [],
    orderTabs: [], orderTab: "", processSteps: [], productCover: "", firstArticle: null, firstArticleBomOpen: false, materialLines: [], purchaseSettlement: null,
    productionStages: PRODUCTION_STAGES, purchaseStages: PURCHASE_STAGES, readinessOptions: READINESS_OPTIONS,
    testOptions: TEST_OPTIONS, exceptionCategories: EXCEPTION_CATEGORIES, severityOptions: SEVERITY_OPTIONS,
    progressStageLabel: PRODUCTION_STAGES[0].label, purchaseStageLabel: PURCHASE_STAGES[0].label,
    readinessLabel: READINESS_OPTIONS[0].label, testResultLabel: TEST_OPTIONS[0].label,
    exceptionCategoryLabel: EXCEPTION_CATEGORIES[0].label, severityLabel: SEVERITY_OPTIONS[0].label, materialLineLabel: "请选择物料/包材",
    progressForm: { stage: PRODUCTION_STAGES[0].value, progressPercent: "", completedQuantity: "", expectedCompletionDate: "", note: "" },
    materialForm: { lineId: "", readiness: READINESS_OPTIONS[0].value, arrivedQuantity: "", testResult: TEST_OPTIONS[0].value, testedAt: today(), exceptionDescription: "", note: "" },
    purchaseForm: { stage: PURCHASE_STAGES[0].value, completedQuantity: "", expectedDeliveryDate: "", note: "" },
    shipmentForm: { shippedQuantity: "", shippedAt: today(), carrier: "", trackingNo: "", note: "" },
    exceptionForm: { category: EXCEPTION_CATEGORIES[0].value, severity: SEVERITY_OPTIONS[0].value, title: "", description: "", affectedQuantity: "", expectedResolutionDate: "" },
    quoteForm: { currency: "CNY", amount: "", minimumOrderQuantity: "", leadTimeDays: "", terms: "" },
    artifactForm: { title: "", resultIndex: 0, summary: "" },
    isSampling: false, sampling: null, sampleVariants: [],
    canSubmitSample: false, canSubmitSampleQuote: false,
    sampleForm: { resultIndex: 0, result: "pending", summary: "", supplierConclusion: "", nextPlan: "" },
    artifactResults: [
      { value: "pending", label: "待中台确认" }, { value: "passed", label: "通过" },
      { value: "failed", label: "未通过" }, { value: "revision_required", label: "需要修订" },
    ],
    canAiReport: false, aiTextEnabled: false, aiVoiceEnabled: false, aiExpanded: true, aiText: "", aiTranscriptionId: "", aiDraft: null, aiDraftId: "", aiMissingMap: {}, aiMessage: "", aiError: "",
    aiBusy: false, aiVoiceBusy: false, aiRecording: false, aiProgressPercent: "",
    desiredOrderTab: "",
  },

  onLoad(options) {
    this.setData({ id: options.id || "", desiredOrderTab: options.orderTab || "" });
    try {
      const pending = wx.getStorageSync("hermes_pending_exception");
      if (pending?.workItemId === (options.id || "") && Date.now() - Number(pending.createdAt || 0) < 30 * 60 * 1000) this._pendingHermesException = pending;
      wx.removeStorageSync("hermes_pending_exception");
    } catch (_) {}
    this._recorder = wx.getRecorderManager();
    this._recorder.onStop((recording) => this.handleRecordingStopped(recording));
    this._recorder.onError((error) => {
      this.setData({ aiRecording: false, aiVoiceBusy: false, aiError: error?.errMsg || "录音失败，请改用文字输入。" });
    });
  },
  onUnload() { if (this.data.aiRecording && this._recorder) this._recorder.stop(); },
  onShow() {
    const session = requireSession("partner");
    if (!session || !this.data.id) return;
    this.setData({ workspace: getWorkspace(session) });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const result = await api.fetchWorkItem(this.data.id);
      const item = decorateTask(result.item);
      const lines = (result.lines || []).map((line) => Object.assign({}, line, {
        initial: String(line.productName || line.sku).slice(0, 1),
        actualQuantity: Number(line.completedQuantity) || Number(line.plannedQuantity) || 1,
      }));
      const events = (result.events || []).map((event) => Object.assign({}, event, { timeText: formatFullDate(event.createdAt) }));
      const action = primaryAction(item, this.data.workspace);
      const detailMode = item.isWarehouse ? "warehouse" : item.itemType === "packaging_quote" ? "quote" : item.itemType === "production_order" ? "production" : item.itemType === "purchase_order" ? "purchase" : item.itemType === "sampling_task" ? "sampling" : "artifact";
      const oem = result.oem || { artifacts: [], quotes: [], milestones: [] };
      oem.artifacts = (oem.artifacts || []).map((entry) => Object.assign({}, entry, { timeText: formatDate(entry.updatedAt || entry.createdAt), resultLabel: ({ pending: "待确认", passed: "通过", failed: "未通过", revision_required: "需修订" })[entry.publicPayload?.result] || "已提交" }));
      oem.quotes = (oem.quotes || []).map((entry) => Object.assign({}, entry, { timeText: formatDate(entry.submittedAt) }));
      oem.milestones = (oem.milestones || []).map((entry) => Object.assign({}, entry, { plannedText: formatDate(entry.plannedAt, false), statusLabel: ({ pending: "待开始", in_progress: "进行中", completed: "已完成", blocked: "受阻" })[entry.status] || entry.status }));
      const isPartnerOrder = item.isPartnerOrder;
      const payload = item.publicPayload || {};
      const partnerOrder = result.partnerOrder || { lines: [], reports: [] };
      const orderLines = (partnerOrder.lines || []).map(orderLineView);
      const finishedProductLine = orderLines.find((line) => line.lineType === "finished_product");
      const productCover = item.itemType === "production_order" ? (payload.productImageUrl || finishedProductLine?.imageUrl || "") : "";
      const reports = normalizeReports(partnerOrder.reports).sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
      const materialLines = orderLines.filter((line) => ["raw_material", "packaging"].includes(line.lineType));
      const selectedMaterial = materialLines[0] || orderLines[0] || null;
      const latestProgress = latestReport(reports, "production_progress");
      const latestMaterial = latestReport(reports, "material_readiness", selectedMaterial?.id);
      const latestPurchase = latestReport(reports, "purchase_fulfillment");
      const latestShipment = latestReport(reports, "shipment");
      const latestException = latestReport(reports, "exception");
      const productionStage = reportValue(latestProgress, "stage", PRODUCTION_STAGES[0].value);
      const purchaseStage = reportValue(latestPurchase, "stage", PURCHASE_STAGES[0].value);
      const readiness = reportValue(latestMaterial, "readiness", reportValue(latestMaterial, "stage", READINESS_OPTIONS[0].value));
      const testResult = reportValue(latestMaterial, "testResult", reportValue(latestMaterial, "result", TEST_OPTIONS[0].value));
      const exceptionCategory = reportValue(latestException, "category", EXCEPTION_CATEGORIES[0].value);
      const severity = reportValue(latestException, "severity", SEVERITY_OPTIONS[0].value);
      const orderTabs = (item.itemType === "production_order" ? [
        { value: "production_progress", label: "生产进度", capability: "production.progress.update" },
        ...(payload.fulfillmentMode === "turnkey" ? [{ value: "material_readiness", label: "物料与包材", capability: "production.material.update" }] : []),
        { value: "shipment", label: "发货反馈", capability: "production.shipment.submit" },
        { value: "exception", label: "异常上报", capability: "production.exception.report" },
      ] : item.itemType === "purchase_order" ? [
        { value: "purchase_fulfillment", label: "履约进度", capability: "procurement.fulfillment.update" },
        { value: "shipment", label: "发货反馈", capability: "procurement.fulfillment.update" },
        { value: "exception", label: "异常上报", capability: "procurement.exception.report" },
      ] : []).filter((tab) => canCapability(this.data.workspace, tab.capability));
      const isSampling = item.itemType === "sampling_task";
      const sampling = isSampling ? buildSamplingWorkspace(item, oem) : null;
      const samplingReady = ["accepted", "in_progress"].includes(item.status);
      const partnerAi = result.partnerAi || (api.config.demoMode ? { enabled: true, textEnabled: true, voiceEnabled: true } : {});
      const canAiReport = Boolean(partnerAi.enabled) && ["accepted", "in_progress"].includes(item.status)
        && (isPartnerOrder ? orderTabs.some((tab) => ["production_progress", "purchase_fulfillment"].includes(tab.value)) : canAction(this.data.workspace, "progress"));
      const taskVersionChanged = Boolean(this.data.item?.id === item.id && Number(this.data.item.version) !== Number(item.version));
      const retainedAiDraft = this.data.aiDraft?.workItemVersion === Number(item.version) ? this.data.aiDraft : null;
      const aiVersionChanged = Boolean(this.data.aiDraft && !retainedAiDraft);
      this.setData({
        item, lines, events, detailMode, oem, isPartnerOrder, partnerOrder, orderLines, reports, materialLines, productCover,
        purchaseSettlement: item.itemType === "purchase_order" ? purchaseSettlementView(payload) : null,
        facts: item.isWarehouse ? [] : oemFacts(payload),
        sourceFacts: [
          { label: "外箱与箱规", value: [payload.cartonType, payload.piecesPerCarton ? `${payload.piecesPerCarton} ${payload.unit || "件"}/箱` : ""].filter(Boolean).join(" · ") || "—" },
          { label: "商品条码", value: payload.barcode || "—" },
        ],
        fulfillmentLabel: payload.fulfillmentMode === "turnkey" ? "全包模式 · 生产、物料与包材测试均需反馈" : item.itemType === "production_order" ? "来料加工 · 按节点反馈生产进度" : "采购履约 · 反馈备货、交付与发运结果",
        orderTabs, orderTab: orderTabs.some((tab) => tab.value === this.data.desiredOrderTab) ? this.data.desiredOrderTab : (orderTabs[0]?.value || ""),
        isSampling, sampling,
        sampleVariants: isSampling && !sampling.approved ? [createSampleVariant(item, 0)] : [],
        canSubmitSample: isSampling && !sampling.approved && samplingReady && canAction(this.data.workspace, "artifact_submit"),
        canSubmitSampleQuote: isSampling && Boolean(sampling.approved) && !sampling.latestQuote && samplingReady && canAction(this.data.workspace, "quote_submit"),
        firstArticle: firstArticleView(payload.firstArticle || partnerOrder.firstArticle),
        processSteps: item.itemType === "production_order" ? productionSteps(payload.productionProcess || payload.firstArticle?.productionProcess, reports) : [],
        primaryLabel: action.label, primaryActionName: action.action,
        canReport: !isPartnerOrder && ["accepted", "in_progress"].includes(item.status) && canAction(this.data.workspace, "report_exception"),
        canReportOrder: isPartnerOrder && orderTabs.length > 0 && ["accepted", "in_progress"].includes(item.status) && canAction(this.data.workspace, "partner_order_report"),
        canUpload: canAction(this.data.workspace, "attachment_upload") && !["completed", "cancelled", "rejected"].includes(item.status),
        canSubmitQuote: canAction(this.data.workspace, "quote_submit") && !["pending_sync", "pending_approval", "completed", "cancelled", "rejected"].includes(item.status),
        canSubmitArtifact: !isPartnerOrder && !isSampling && canAction(this.data.workspace, "artifact_submit") && !["pending_sync", "pending_approval", "completed", "cancelled", "rejected"].includes(item.status),
        canUpdateMilestone: !isPartnerOrder && canAction(this.data.workspace, "milestone_update") && !["pending_sync", "pending_approval", "completed", "cancelled", "rejected"].includes(item.status),
        canAiReport, aiTextEnabled: Boolean(partnerAi.textEnabled), aiVoiceEnabled: Boolean(partnerAi.voiceEnabled),
        aiPlaceholder: ({
          production_order: "例如：已经灌装 5000 瓶，完成 60%，预计周五结束。",
          purchase_order: "例如：已备货 8000 套，明天发出，物流单号稍后补。",
          sampling_task: "例如：两个料体样已做好，周三寄出。",
        })[item.itemType] || (item.isWarehouse ? "例如：已到货 240 件，外箱完好，正在核对批次。" : "例如：资料已准备一半，预计周五提交。"),
        aiTranscriptionId: taskVersionChanged ? "" : this.data.aiTranscriptionId,
        aiDraft: retainedAiDraft, aiDraftId: retainedAiDraft ? this.data.aiDraftId : "", aiMissingMap: retainedAiDraft ? this.data.aiMissingMap : {},
        aiMessage: aiVersionChanged || (taskVersionChanged && this.data.aiTranscriptionId) ? "任务内容已更新，旧转写或草稿已失效，请重新生成。" : this.data.aiMessage,
        progress: progressSteps(item, ["rejected", "cancelled"].includes(item.status)),
        progressStageLabel: (PRODUCTION_STAGES.find((entry) => entry.value === productionStage) || PRODUCTION_STAGES[0]).label,
        purchaseStageLabel: (PURCHASE_STAGES.find((entry) => entry.value === purchaseStage) || PURCHASE_STAGES[0]).label,
        readinessLabel: (READINESS_OPTIONS.find((entry) => entry.value === readiness) || READINESS_OPTIONS[0]).label,
        testResultLabel: (TEST_OPTIONS.find((entry) => entry.value === testResult) || TEST_OPTIONS[0]).label,
        exceptionCategoryLabel: (EXCEPTION_CATEGORIES.find((entry) => entry.value === exceptionCategory) || EXCEPTION_CATEGORIES[0]).label,
        severityLabel: (SEVERITY_OPTIONS.find((entry) => entry.value === severity) || SEVERITY_OPTIONS[0]).label,
        materialLineLabel: selectedMaterial ? `${selectedMaterial.productName} · ${selectedMaterial.sku}` : "暂无物料/包材明细",
        progressForm: {
          stage: productionStage,
          progressPercent: String(reportValue(latestProgress, "progressPercent", "")),
          completedQuantity: String(reportValue(latestProgress, "completedQuantity", reportValue(latestProgress, "quantity", ""))),
          expectedCompletionDate: String(reportValue(latestProgress, "expectedCompletionDate", reportValue(latestProgress, "expectedAt", ""))).slice(0, 10),
          note: String(reportValue(latestProgress, "note", "")),
        },
        materialForm: {
          lineId: selectedMaterial?.id || "", readiness,
          arrivedQuantity: String(reportValue(latestMaterial, "arrivedQuantity", reportValue(latestMaterial, "quantity", ""))),
          testResult, testedAt: String(reportValue(latestMaterial, "testedAt", today())).slice(0, 10),
          exceptionDescription: String(reportValue(latestMaterial, "exceptionDescription", "")), note: String(reportValue(latestMaterial, "note", "")),
        },
        purchaseForm: {
          stage: purchaseStage, completedQuantity: String(reportValue(latestPurchase, "completedQuantity", "")),
          expectedDeliveryDate: String(reportValue(latestPurchase, "expectedDeliveryDate", payload.deliveryDate || "")).slice(0, 10), note: String(reportValue(latestPurchase, "note", "")),
        },
        shipmentForm: {
          shippedQuantity: String(reportValue(latestShipment, "shippedQuantity", "")), shippedAt: String(reportValue(latestShipment, "shippedAt", today())).slice(0, 10),
          carrier: String(reportValue(latestShipment, "carrier", "")), trackingNo: String(reportValue(latestShipment, "trackingNo", "")), note: String(reportValue(latestShipment, "note", "")),
        },
        exceptionForm: {
          category: exceptionCategory, severity, title: String(reportValue(latestException, "title", "")), description: "",
          affectedQuantity: String(reportValue(latestException, "affectedQuantity", "")), expectedResolutionDate: String(reportValue(latestException, "expectedResolutionDate", "")).slice(0, 10),
        },
        "quoteForm.currency": item.publicPayload?.quoteCurrency || "CNY",
        "quoteForm.minimumOrderQuantity": String(item.publicPayload?.quantity || ""),
      });
      if (this._pendingHermesException) {
        const pending = this._pendingHermesException;
        this._pendingHermesException = null;
        this.setData({
          media: pending.media?.tempFilePath ? [pending.media] : this.data.media,
          "exceptionForm.title": "现场图片异常",
          "exceptionForm.description": [pending.affected ? `影响数量：${pending.affected}` : "", pending.delay ? `交期影响：${pending.delay}` : ""].filter(Boolean).join("；"),
        });
      }
      wx.setNavigationBarTitle({ title: item.typeLabel });
    } catch (error) { this.setData({ error: error.message || "任务详情读取失败。" }); }
    finally { this.setData({ loading: false }); }
  },

  updateNote(event) { this.setData({ note: event.detail.value }); },
  updateAiProgressPercent(event) { this.setData({ aiProgressPercent: event.detail.value }); },
  toggleAiCard() { this.setData({ aiExpanded: !this.data.aiExpanded }); },
  updateAiText(event) { this.setData({ aiText: event.detail.value, aiDraft: null, aiDraftId: "", aiMissingMap: {}, aiMessage: "", aiError: "" }); },
  startAiRecording() {
    if (!this.data.aiVoiceEnabled || this.data.aiBusy || this.data.aiVoiceBusy || this.data.aiRecording) return;
    this.setData({ aiRecording: true, aiError: "", aiMessage: "正在录音，最多 50 秒。再次点击即可结束。" });
    this._recorder.start({ duration: 50_000, sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 48_000, format: "mp3" });
  },
  toggleAiRecording() { if (this.data.aiRecording) this.stopAiRecording(); else this.startAiRecording(); },
  stopAiRecording() { if (this.data.aiRecording && this._recorder) this._recorder.stop(); },
  async handleRecordingStopped(recording) {
    this.setData({ aiRecording: false });
    if (!recording?.tempFilePath || Number(recording.duration || 0) < 300) return this.setData({ aiError: "录音太短，请重新录制。", aiMessage: "" });
    let fileSize = Number(recording.fileSize || 0);
    if (!fileSize) { try { fileSize = Number(wx.getFileSystemManager().statSync(recording.tempFilePath).size || 0); } catch (_) {} }
    if (!fileSize) return this.setData({ aiError: "无法读取录音文件，请重新录制。", aiMessage: "" });
    if (fileSize > 2_621_440) return this.setData({ aiError: "录音超过 2.5MB，请缩短后重试。", aiMessage: "" });
    this.setData({ aiVoiceBusy: true, aiError: "", aiMessage: "正在转写录音…" });
    try {
      const result = await api.transcribePartnerAudio(this.data.item.id, this.data.item.version, {
        tempFilePath: recording.tempFilePath, durationMs: Math.min(50_000, Number(recording.duration)), sizeBytes: fileSize,
        fileName: `progress-${Date.now()}.mp3`, mimeType: "audio/mpeg",
      });
      this.setData({ aiText: result.transcript || "", aiTranscriptionId: result.transcriptionId || "", aiMessage: "转写完成。请先检查和修改文字，再生成草稿。" });
    } catch (error) { this.setData({ aiError: error.message || "语音转写失败，请改用文字输入。", aiMessage: "" }); }
    finally { this.setData({ aiVoiceBusy: false }); }
  },
  async generateAiDraft() {
    const text = String(this.data.aiText || "").trim();
    if (!text) return wx.showToast({ title: "请先说或输入进度", icon: "none" });
    if (!this.data.aiTextEnabled && !this.data.aiTranscriptionId) return wx.showToast({ title: "当前仅开放语音汇报", icon: "none" });
    if (!this.data.item || this.data.aiBusy) return;
    this.setData({ aiBusy: true, aiError: "", aiMessage: "Hermes 正在整理可编辑草稿…", aiDraft: null, aiDraftId: "", aiMissingMap: {} });
    try {
      const result = await api.createPartnerProgressDraft(this.data.item.id, this.data.item.version, text, this.data.aiTranscriptionId || "");
      const draft = result.draft;
      const evidence = (draft.evidence || []).map((entry) => Object.assign({}, entry, { label: AI_FIELD_LABELS[entry.field] || entry.field }));
      const missingText = (draft.missingFields || []).map((field) => AI_FIELD_LABELS[field] || field).join("、");
      this.setData({ aiDraft: Object.assign({}, draft, { evidence, missingText }), aiMessage: "草稿已生成。确认后填入表单，系统不会自动提交。" });
    } catch (error) { this.setData({ aiError: error.message || "草稿生成失败，请直接使用原表单。", aiMessage: "" }); }
    finally { this.setData({ aiBusy: false }); }
  },
  async applyAiDraft() {
    const draft = this.data.aiDraft;
    const item = this.data.item;
    if (!draft || !item || this.data.aiBusy) return;
    if (Number(draft.workItemVersion) !== Number(item.version)) return this.setData({ aiDraft: null, aiError: "任务已更新，请重新生成草稿。" });
    const fields = draft.fields || {};
    const missingMap = {};
    (draft.missingFields || []).forEach((field) => { missingMap[field] = true; });
    const changes = { aiDraftId: draft.id, aiMissingMap: missingMap, aiMessage: "已填入表单。请补齐高亮字段、检查内容，再点击原提交按钮。", aiError: "" };
    if (draft.type === "production_progress") {
      changes.orderTab = "production_progress";
      Object.keys(fields).forEach((field) => { if (field in this.data.progressForm) changes[`progressForm.${field}`] = String(fields[field]); });
      if (fields.stage) changes.progressStageLabel = (PRODUCTION_STAGES.find((entry) => entry.value === fields.stage) || {}).label || fields.stage;
    } else if (draft.type === "purchase_fulfillment") {
      changes.orderTab = "purchase_fulfillment";
      Object.keys(fields).forEach((field) => { if (field in this.data.purchaseForm) changes[`purchaseForm.${field}`] = String(fields[field]); });
      if (fields.stage) changes.purchaseStageLabel = (PURCHASE_STAGES.find((entry) => entry.value === fields.stage) || {}).label || fields.stage;
    } else {
      changes.note = String(fields.note || "");
      if (fields.percent !== undefined) changes.aiProgressPercent = String(fields.percent);
    }
    this.setData(changes);
    try { await api.markPartnerProgressDraftApplied(item.id, draft.id, item.version); }
    catch (error) { this.setData({ aiDraftId: "", aiError: error.message || "草稿已过期，请重新生成。", aiMessage: "" }); }
  },
  async submitAiGenericProgress() {
    if (!this.data.aiDraftId || this.data.aiDraft?.type !== "work_item_progress" || this.data.busy) return;
    const note = String(this.data.note || "").trim();
    if (!note) return wx.showToast({ title: "请填写进度说明", icon: "none" });
    const percentText = String(this.data.aiProgressPercent || "").trim();
    const body = { action: "progress", note };
    if (percentText) {
      const percent = Number(percentText);
      if (!Number.isInteger(percent) || percent < 0 || percent > 100) return wx.showToast({ title: "进度须为 0-100 整数", icon: "none" });
      body.percent = percent;
    }
    this.setData({ busy: true });
    try {
      await api.submitAction(this.data.item.id, this.data.item.version, body, this.data.aiDraftId);
      wx.showToast({ title: "进度已提交", icon: "success" });
      this.setData({ aiDraft: null, aiDraftId: "", aiText: "", aiProgressPercent: "" });
      this.load();
    } catch (error) { wx.showModal({ title: "提交失败", content: error.message || "请检查后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },
  updateLine(event) { this.setData({ [`lines[${Number(event.currentTarget.dataset.index)}].${event.currentTarget.dataset.field}`]: event.detail.value }); },
  chooseLineDate(event) { this.setData({ [`lines[${Number(event.currentTarget.dataset.index)}].${event.currentTarget.dataset.field}`]: event.detail.value }); },
  scanLine(event) {
    const index = Number(event.currentTarget.dataset.index);
    const line = this.data.lines[index];
    if (!line) return;
    scanReceivedBarcode({
      currentValue: line.barcode,
      onCaptured: (barcode) => this.setData({ [`lines[${index}].barcode`]: barcode }),
    });
  },
  updateQuote(event) { this.setData({ [`quoteForm.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  updateArtifact(event) { this.setData({ [`artifactForm.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  updateSampleForm(event) { this.setData({ [`sampleForm.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  updateSampleVariant(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    this.setData({ [`sampleVariants[${index}].${field}`]: event.detail.value });
  },
  addSampleVariant() {
    this.setData({ sampleVariants: this.data.sampleVariants.concat(createSampleVariant(this.data.item, this.data.sampleVariants.length)) });
  },
  removeSampleVariant(event) {
    if (this.data.sampleVariants.length <= 1) return;
    const variants = this.data.sampleVariants.slice();
    variants.splice(Number(event.currentTarget.dataset.index), 1);
    this.setData({ sampleVariants: variants });
  },
  chooseSampleResult(event) {
    const index = Number(event.detail.value);
    const option = this.data.artifactResults[index];
    if (option) this.setData({ "sampleForm.resultIndex": index, "sampleForm.result": option.value });
  },
  chooseArtifactResult(event) {
    const index = Number(event.detail.value);
    this.setData({ "artifactForm.resultIndex": index, artifactResultLabel: this.data.artifactResults[index].label });
  },
  changeOrderTab(event) { this.setData({ orderTab: event.currentTarget.dataset.value }); },
  updatePartnerForm(event) {
    const form = event.currentTarget.dataset.form;
    const field = event.currentTarget.dataset.field;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },
  choosePartnerDate(event) {
    const form = event.currentTarget.dataset.form;
    const field = event.currentTarget.dataset.field;
    this.setData({ [`${form}.${field}`]: event.detail.value });
  },
  choosePartnerOption(event) {
    const options = this.data[event.currentTarget.dataset.options] || [];
    const selected = options[Number(event.detail.value)];
    if (!selected) return;
    const form = event.currentTarget.dataset.form;
    const field = event.currentTarget.dataset.field;
    const label = event.currentTarget.dataset.label;
    this.setData({ [`${form}.${field}`]: selected.value, [label]: selected.label });
  },
  chooseMaterialLine(event) {
    const selected = this.data.materialLines[Number(event.detail.value)];
    if (!selected) return;
    const report = latestReport(this.data.reports, "material_readiness", selected.id);
    const readiness = reportValue(report, "readiness", reportValue(report, "stage", READINESS_OPTIONS[0].value));
    const testResult = reportValue(report, "testResult", reportValue(report, "result", TEST_OPTIONS[0].value));
    this.setData({
      materialLineLabel: `${selected.productName} · ${selected.sku}`,
      materialForm: {
        lineId: selected.id, readiness,
        arrivedQuantity: String(reportValue(report, "arrivedQuantity", reportValue(report, "quantity", ""))),
        testResult, testedAt: String(reportValue(report, "testedAt", today())).slice(0, 10),
        exceptionDescription: String(reportValue(report, "exceptionDescription", "")), note: String(reportValue(report, "note", "")),
      },
      readinessLabel: (READINESS_OPTIONS.find((entry) => entry.value === readiness) || READINESS_OPTIONS[0]).label,
      testResultLabel: (TEST_OPTIONS.find((entry) => entry.value === testResult) || TEST_OPTIONS[0]).label,
    });
  },
  toggleFirstArticleBom() { this.setData({ firstArticleBomOpen: !this.data.firstArticleBomOpen }); },
  previewFirstArticle(event) {
    const urls = (this.data.firstArticle?.images || []).map((image) => image.url).filter(Boolean);
    if (urls.length) wx.previewImage({ current: event.currentTarget.dataset.src, urls });
  },
  previewProductCover() {
    if (this.data.productCover) wx.previewImage({ current: this.data.productCover, urls: [this.data.productCover] });
  },

  chooseMedia() {
    const remaining = 4 - this.data.media.length;
    if (remaining <= 0) return wx.showToast({ title: "最多上传 4 个凭证", icon: "none" });
    wx.chooseMedia({ count: remaining, mediaType: ["image"], sourceType: ["camera", "album"], sizeType: ["compressed"], success: (result) => {
      const next = result.tempFiles.map((file) => ({ tempFilePath: file.tempFilePath, size: file.size || 0, type: file.fileType || "image" }));
      this.setData({ media: this.data.media.concat(next) });
    } });
  },
  removeMedia(event) { const media = this.data.media.slice(); media.splice(Number(event.currentTarget.dataset.index), 1); this.setData({ media }); },
  previewMedia(event) { wx.previewImage({ current: event.currentTarget.dataset.src, urls: this.data.media.map((item) => item.tempFilePath) }); },

  async uploadMedia() {
    const attachmentIds = [];
    for (const media of this.data.media) {
      const result = await api.uploadAttachment(this.data.item.id, media);
      if (result?.attachmentId) attachmentIds.push(result.attachmentId);
    }
    return attachmentIds;
  },

  async submitPartnerReport() {
    if (!this.data.canReportOrder || this.data.busy) return;
    const tab = this.data.orderTab;
    let body;
    if (tab === "production_progress") {
      const form = this.data.progressForm;
      const percent = Number(form.progressPercent);
      if (String(form.progressPercent).trim() === "" || percent < 0 || percent > 100) return wx.showToast({ title: "请填写 0-100 的进度", icon: "none" });
      if (Number(form.completedQuantity || 0) < 0) return wx.showToast({ title: "已完成数量不能为负数", icon: "none" });
      body = { reportType: tab, stage: form.stage, progressPercent: percent, completedQuantity: Number(form.completedQuantity || 0), expectedCompletionDate: form.expectedCompletionDate, note: form.note.trim() };
    } else if (tab === "material_readiness") {
      const form = this.data.materialForm;
      if (!form.lineId) return wx.showToast({ title: "请选择物料或包材", icon: "none" });
      if (form.testResult === "failed" && !form.exceptionDescription.trim()) return wx.showToast({ title: "请填写测试异常说明", icon: "none" });
      body = { reportType: tab, lineId: form.lineId, readiness: form.readiness, arrivedQuantity: Number(form.arrivedQuantity || 0), testResult: form.testResult, testedAt: form.testedAt, exceptionDescription: form.exceptionDescription.trim(), note: form.note.trim() };
    } else if (tab === "purchase_fulfillment") {
      const form = this.data.purchaseForm;
      if (Number(form.completedQuantity || 0) < 0) return wx.showToast({ title: "完成数量不能为负数", icon: "none" });
      body = { reportType: tab, stage: form.stage, completedQuantity: Number(form.completedQuantity || 0), expectedDeliveryDate: form.expectedDeliveryDate, note: form.note.trim() };
    } else if (tab === "shipment") {
      const form = this.data.shipmentForm;
      if (!form.shippedAt) return wx.showToast({ title: "请选择发货日期", icon: "none" });
      if (Number(form.shippedQuantity || 0) <= 0) return wx.showToast({ title: "请填写发货数量", icon: "none" });
      body = { reportType: tab, shippedQuantity: Number(form.shippedQuantity), shippedAt: form.shippedAt, carrier: form.carrier.trim(), trackingNo: form.trackingNo.trim(), note: form.note.trim() };
    } else if (tab === "exception") {
      const form = this.data.exceptionForm;
      if (!form.title.trim() || !form.description.trim()) return wx.showToast({ title: "请填写异常标题和说明", icon: "none" });
      body = { reportType: tab, category: form.category, severity: form.severity, title: form.title.trim(), description: form.description.trim(), affectedQuantity: Number(form.affectedQuantity || 0), expectedResolutionDate: form.expectedResolutionDate };
    } else return;

    const confirmed = await new Promise((resolve) => wx.showModal({
      title: tab === "exception" ? "确认上报异常" : "确认提交反馈",
      content: "提交后将同步到协同中台并记录当前账号与时间，请确认信息无误。",
      confirmText: "确认提交", confirmColor: tab === "exception" ? "#B42318" : "#F45B0B",
      success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true });
    wx.showLoading({ title: this.data.media.length ? "上传凭证中" : "正在提交", mask: true });
    try {
      await this.uploadMedia();
      await api.submitPartnerOrderReport(this.data.item.id, this.data.item.version, body, ["production_progress", "purchase_fulfillment"].includes(tab) ? this.data.aiDraftId : "");
      wx.hideLoading();
      this.setData({ media: [], aiDraft: null, aiDraftId: "", aiText: "", aiMissingMap: {} });
      wx.showModal({ title: "反馈已提交", content: "中台已收到本次反馈，订单详情会保留完整记录。", showCancel: false, confirmColor: "#173D7A", success: () => this.load() });
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: "提交失败", content: error.message || "请检查网络后重试。", showCancel: false });
    } finally { this.setData({ busy: false }); }
  },

  async primaryAction() {
    const item = this.data.item;
    const action = this.data.primaryActionName;
    if (!item || !action || this.data.busy) return;
    let body;
    if (action === "accept") body = { action, note: this.data.note.trim() };
    else if (action === "progress") body = { action, note: this.data.note.trim() || "已开始执行任务", percent: 10 };
    else if (["inbound_confirm", "outbound_confirm", "transfer_receive"].includes(action)) {
      if (this.data.lines.some((line) => Number(line.actualQuantity) <= 0)) return wx.showToast({ title: "请填写正确的实际数量", icon: "none" });
      body = { action, note: this.data.note.trim(), lines: this.data.lines.map((line) => ({ sku: line.sku, quantity: Number(line.actualQuantity), lotNo: line.lotNo || "", barcode: line.barcode || "", productionDate: line.productionDate || "", expiryDate: line.expiryDate || "" })) };
    } else body = { action, note: this.data.note.trim() };

    const confirmed = await new Promise((resolve) => wx.showModal({
      title: this.data.primaryLabel,
      content: ["inbound_confirm", "outbound_confirm", "transfer_receive", "complete"].includes(action) ? "提交后将进入中台确认，请核对资料和凭证。" : "操作会记录当前账号与时间，是否继续？",
      confirmText: "确认", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true });
    wx.showLoading({ title: this.data.media.length ? "上传凭证中" : "正在提交", mask: true });
    try {
      await this.uploadMedia();
      await api.submitAction(item.id, item.version, body);
      wx.hideLoading();
      wx.showModal({ title: "提交成功", content: action === "accept" ? "任务已接单，可以开始处理。" : action === "progress" ? "任务已进入处理中。" : "结果已提交，正在等待中台确认，请勿重复操作。", showCancel: false, confirmColor: "#173D7A", success: () => this.load() });
    } catch (error) { wx.hideLoading(); wx.showModal({ title: "提交失败", content: error.message || "请检查网络后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },

  async submitQuote() {
    if (this.data.busy || !canAction(this.data.workspace, "quote_submit")) return;
    const form = this.data.quoteForm;
    if (Number(form.amount) < 0 || !String(form.amount).trim()) return wx.showToast({ title: "请填写报价金额", icon: "none" });
    if (Number(form.leadTimeDays) < 0 || !String(form.leadTimeDays).trim()) return wx.showToast({ title: "请填写交期天数", icon: "none" });
    const confirmed = await new Promise((resolve) => wx.showModal({ title: "提交密封报价", content: `${form.currency} ${Number(form.amount).toFixed(2)}，交期 ${Number(form.leadTimeDays)} 天。提交后不可直接修改。`, confirmText: "确认提交", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false) }));
    if (!confirmed) return;
    this.setData({ busy: true });
    try {
      await api.submitSupplierQuote(this.data.item.id, this.data.item.version, { currency: form.currency, amount: Number(form.amount), minimumOrderQuantity: Number(form.minimumOrderQuantity || 0), leadTimeDays: Number(form.leadTimeDays), terms: form.terms.trim() });
      wx.showModal({ title: "报价已提交", content: "报价已密封进入中台评审，其他供应商无法查看。", showCancel: false, success: () => this.load() });
    } catch (error) { wx.showModal({ title: "报价提交失败", content: error.message || "请稍后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },

  async submitSampleRound() {
    if (this.data.busy || !this.data.canSubmitSample) return;
    const validation = validateSampleRound(this.data.item, this.data.sampleVariants, this.data.sampleForm, this.data.media.length);
    if (validation) return wx.showToast({ title: validation, icon: "none" });
    const roundNumber = this.data.sampling.rounds.length + 1;
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: `提交第 ${roundNumber} 轮样品`,
      content: `本轮共 ${this.data.sampleVariants.length} 个${this.data.sampling.category === "packaging" ? "包材方案" : "料体"}，提交后由中台评审且不会覆盖历史。`,
      confirmText: "确认提交", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true });
    wx.showLoading({ title: this.data.media.length ? "上传本轮文件" : "正在提交", mask: true });
    try {
      const attachmentIds = await this.uploadMedia();
      const input = sampleArtifactInput(this.data.item, roundNumber, this.data.sampleVariants, this.data.sampleForm, attachmentIds);
      await api.submitOemArtifact(this.data.item.id, this.data.item.version, input);
      wx.hideLoading();
      this.setData({ media: [] });
      wx.showModal({ title: "本轮样品已提交", content: "平台追踪号已生成，中台评审后会保留结论并决定是否进入下一轮。", showCancel: false, success: () => this.load() });
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: "样品提交失败", content: error.message || "请稍后重试。", showCancel: false });
    } finally { this.setData({ busy: false }); }
  },

  async submitSampleQuote() {
    if (this.data.busy || !this.data.canSubmitSampleQuote || !this.data.sampling?.approved) return;
    const form = this.data.quoteForm;
    if (!String(form.amount).trim() || Number(form.amount) < 0) return wx.showToast({ title: "请填写报价金额", icon: "none" });
    if (!String(form.leadTimeDays).trim() || Number(form.leadTimeDays) < 0) return wx.showToast({ title: "请填写量产交期", icon: "none" });
    const approved = this.data.sampling.approved;
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: "提交最终样报价", content: `报价将永久绑定 ${approved.publicPayload?.approvedVariantCode || approved.roundLabel}，提交后进入中台确认。`,
      confirmText: "确认提交", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true });
    try {
      await api.submitSupplierQuote(this.data.item.id, this.data.item.version, {
        currency: form.currency, amount: Number(form.amount), minimumOrderQuantity: Number(form.minimumOrderQuantity || 0),
        leadTimeDays: Number(form.leadTimeDays), terms: form.terms.trim(), sampleArtifactId: approved.id,
      });
      wx.showModal({ title: "最终样报价已提交", content: "报价已绑定最终样并进入中台确认。", showCancel: false, success: () => this.load() });
    } catch (error) { wx.showModal({ title: "报价提交失败", content: error.message || "请稍后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },

  async submitArtifact() {
    if (this.data.busy || !canAction(this.data.workspace, "artifact_submit")) return;
    const form = this.data.artifactForm;
    if (!form.title.trim()) return wx.showToast({ title: "请填写资料标题", icon: "none" });
    const result = this.data.artifactResults[form.resultIndex];
    const artifactType = ({ filing_task: "filing_document", sampling_task: "sample_result", production_order: "quality_report" })[this.data.item.itemType];
    this.setData({ busy: true });
    wx.showLoading({ title: this.data.media.length ? "上传资料中" : "正在提交", mask: true });
    try {
      await this.uploadMedia();
      await api.submitOemArtifact(this.data.item.id, this.data.item.version, { artifactType, title: form.title.trim(), version: (this.data.oem.artifacts?.length || 0) + 1, publicPayload: { summary: form.summary.trim(), result: result.value } });
      wx.hideLoading();
      wx.showModal({ title: "资料已提交", content: "资料和结果已进入中台同步，请勿重复提交。", showCancel: false, success: () => this.load() });
    } catch (error) { wx.hideLoading(); wx.showModal({ title: "资料提交失败", content: error.message || "请稍后重试。", showCancel: false }); }
    finally { this.setData({ busy: false }); }
  },

  updateMilestone(event) {
    if (this.data.busy || !canAction(this.data.workspace, "milestone_update")) return;
    const id = event.currentTarget.dataset.id;
    const status = event.currentTarget.dataset.status;
    wx.showModal({ title: status === "completed" ? "完成生产节点" : "报告节点受阻", editable: true, placeholderText: "填写当前进度、完成结果或受阻原因", confirmText: "提交更新", confirmColor: status === "completed" ? "#18734C" : "#B42318", success: async (result) => {
      if (!result.confirm) return;
      const note = String(result.content || "").trim();
      if (!note) return wx.showToast({ title: "请填写节点说明", icon: "none" });
      this.setData({ busy: true });
      try {
        await api.updateProductionMilestone(id, this.data.item.version, { status, note });
        wx.showToast({ title: "节点已更新", icon: "success" });
        this.load();
      } catch (error) { wx.showModal({ title: "更新失败", content: error.message || "请稍后重试。", showCancel: false }); }
      finally { this.setData({ busy: false }); }
    } });
  },

  reportException() {
    if (!this.data.item || this.data.busy) return;
    wx.showModal({ title: "报告任务异常", editable: true, placeholderText: "说明异常情况、数量或受阻原因", confirmText: "提交异常", confirmColor: "#B42318", success: async (result) => {
      if (!result.confirm) return;
      const note = String(result.content || "").trim();
      if (!note) return wx.showToast({ title: "请填写异常说明", icon: "none" });
      this.setData({ busy: true });
      try {
        await api.submitAction(this.data.item.id, this.data.item.version, { action: "report_exception", category: "伙伴协同异常", note });
        wx.showToast({ title: "异常已提交" });
        this.load();
      } catch (error) { wx.showModal({ title: "提交失败", content: error.message || "请稍后重试。", showCancel: false }); }
      finally { this.setData({ busy: false }); }
    } });
  },
});

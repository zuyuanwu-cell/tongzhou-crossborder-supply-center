const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { preferenceStorageKey, normalizePreferences } = require("../../utils/partner-preferences");
const { playVoiceStartCue } = require("../../utils/voice-cue");

const STAGES = [
  { value: "", label: "请选择阶段" },
  { value: "planning", label: "计划准备" },
  { value: "material_preparation", label: "物料准备" },
  { value: "filling", label: "灌装" },
  { value: "packaging", label: "包装" },
  { value: "quality_check", label: "质量检查" },
  { value: "ready_to_ship", label: "待发货" },
];
const MATERIAL_STATUSES = [
  { value: "", label: "请选择物料状态" },
  { value: "not_ready", label: "未齐" },
  { value: "partial", label: "部分到齐" },
  { value: "ready", label: "已齐套" },
];
const SAMPLE_STATUSES = [
  { value: "", label: "请选择产前样状态" },
  { value: "not_scheduled", label: "未安排" },
  { value: "scheduled", label: "已计划" },
  { value: "submitted", label: "已提交" },
  { value: "approved", label: "已确认" },
  { value: "not_required", label: "无需产前样" },
];
const PRODUCTION_STATUSES = [
  { value: "", label: "请选择投产状态" },
  { value: "not_scheduled", label: "未排产" },
  { value: "scheduled", label: "已排期" },
  { value: "started", label: "已投产" },
  { value: "completed", label: "已完工" },
];
const STEPS = [
  { key: "identifying_order", label: "识别订单" },
  { key: "confirming_order", label: "确认订单" },
  { key: "collecting_progress", label: "补充进度" },
  { key: "review", label: "核对提交" },
  { key: "submitted", label: "已完成" },
];

function stageIndex(value) {
  const index = STAGES.findIndex((item) => item.value === value);
  return index < 0 ? 0 : index;
}

function dateText(value) {
  return value ? String(value).slice(0, 10) : "";
}

function optionIndex(options, value) {
  const index = options.findIndex((item) => item.value === value);
  return index < 0 ? 0 : index;
}

function decodeRouteText(value) {
  const text = String(value || "");
  if (!text) return "";
  try { return decodeURIComponent(text); } catch (_) { return text; }
}

function labelFor(options, value, fallback = "待补充") {
  return options.find((item) => item.value === value)?.label || fallback;
}

function processSteps(form = {}) {
  return [
    {
      key: "material",
      label: "物料齐套",
      done: form.materialStatus === "ready",
      current: Boolean(form.materialStatus) && form.materialStatus !== "ready",
      status: labelFor(MATERIAL_STATUSES, form.materialStatus),
    },
    {
      key: "sample",
      label: "产前样",
      done: ["approved", "not_required"].includes(form.preproductionSampleStatus),
      current: ["scheduled", "submitted"].includes(form.preproductionSampleStatus),
      status: labelFor(SAMPLE_STATUSES, form.preproductionSampleStatus),
    },
    {
      key: "production",
      label: "正式投产",
      done: form.productionStatus === "completed",
      current: ["scheduled", "started"].includes(form.productionStatus),
      status: labelFor(PRODUCTION_STATUSES, form.productionStatus),
    },
    {
      key: "delivery",
      label: "预计交货",
      done: form.productionStatus === "completed" && Boolean(form.expectedDeliveryDate),
      current: Boolean(form.expectedDeliveryDate),
      status: form.expectedDeliveryDate || "待补充",
    },
  ];
}

Page({
  data: {
    loading: true,
    busy: false,
    error: "",
    sessionId: "",
    session: null,
    steps: STEPS,
    activeStep: 0,
    candidates: [],
    confirmedOrder: null,
    inputText: "",
    messages: [{ role: "assistant", text: "告诉我产品名称、SKU 或加工单号，我会先找到正确订单，再帮你整理反馈。" }],
    voiceEnabled: false,
    recording: false,

    voiceListening: false,

    voiceBusy: false,
    stageOptions: STAGES,
    stageIndex: 0,
    materialStatusOptions: MATERIAL_STATUSES,
    sampleStatusOptions: SAMPLE_STATUSES,
    productionStatusOptions: PRODUCTION_STATUSES,
    materialStatusIndex: 0,
    sampleStatusIndex: 0,
    productionStatusIndex: 0,
    form: {
      stage: "",
      progressPercent: "",
      completedQuantity: "",
      expectedCompletionDate: "",
      materialStatus: "",
      preproductionSampleStatus: "",
      preproductionSampleDate: "",
      productionStatus: "",
      productionStartDate: "",
      expectedDeliveryDate: "",
      note: "",
    },
    versionConflict: false,
    assistantUnavailable: false,
    exceptionSuggested: false,
    submitted: false,
    voicePreferred: true,
    statusBarHeight: 20,
    editMode: false,
    processSteps: [],
    pendingMedia: null,
    photoException: null,
    affectedOptions: ["100件以内", "100–1000件", "1000件以上"],
    delayOptions: ["不影响交期", "可能延期", "确定延期"],
  },

  onLoad(options) {
    const loginSession = requireSession("partner");
    if (!loginSession) return;
    let preferences = null;
    try { preferences = wx.getStorageSync(preferenceStorageKey(loginSession.user.id)); } catch (_) {}
    this._initialPrompt = decodeRouteText(options?.prompt).trim();
    this._autoVoice = options?.voice === "1";
    this._photoMode = options?.mode === "photo";
    let windowInfo = {};
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) {}
    this.setData({ voicePreferred: normalizePreferences(preferences).voiceFirst, statusBarHeight: Number(windowInfo.statusBarHeight || 20) });
    this._recorder = wx.getRecorderManager();
    this._recorder.onStart(() => { this._recorderLive = true; this.setData({ voiceListening: true }); });
    this._recorder.onStop((recording) => { this._recorderLive = false; this.handleRecordingStopped(recording); });
    this._recorder.onError((error) => { this._recorderLive = false; this.setData({ recording: false, voiceListening: false, voiceBusy: false, error: error?.errMsg || "录音失败，请改用文字输入。" }); });
    this.startSession();
  },

  onUnload() {
    this._voiceCueToken = 0;
    if (this.data.recording && this._recorder && this._recorderLive) this._recorder.stop();
  },

  async startSession() {
    this.setData({ loading: true, error: "" });
    try {
      const created = await api.createPartnerAiSession();
      this.setData({ sessionId: created.session.id });
      const result = await api.fetchPartnerAiSession(created.session.id);
      this.applySession(result.session);
      // The server opens with the orders due soonest (or explains why there are none).
      if (result.session?.nextQuestion && !this._initialPrompt) {
        this.setData({ messages: [{ role: "assistant", text: result.session.nextQuestion }] });
      }
      if (this._initialPrompt) {
        const prompt = this._initialPrompt;
        this._initialPrompt = "";
        await this.sendMessage(prompt);
      }
      if (this._photoMode) this.restorePendingMedia();
      if (this._autoVoice && this.data.voiceEnabled) setTimeout(() => this.toggleRecording(), 240);
    } catch (error) {
      this.setData({ error: error.message || "小助理快捷汇报暂时无法使用。" });
    } finally {
      this.setData({ loading: false });
    }
  },

  applySession(session, extra = {}) {
    if (!session) return;
    const fields = session.fields || {};
    const index = Math.max(0, STEPS.findIndex((item) => item.key === session.state));
    const candidates = (session.candidates || this.data.candidates || []).map((item) => ({ ...item, dueDate: dateText(item.dueAt) }));
    const confirmedOrder = session.confirmedOrder || this.data.confirmedOrder || candidates.find((item) => item.id === session.confirmedWorkItemId) || null;
    const form = {
      stage: fields.stage || this.data.form.stage || "",
      progressPercent: fields.progressPercent == null ? this.data.form.progressPercent : String(fields.progressPercent),
      completedQuantity: fields.completedQuantity == null ? this.data.form.completedQuantity : String(fields.completedQuantity),
      expectedCompletionDate: dateText(fields.expectedCompletionDate || this.data.form.expectedCompletionDate),
      materialStatus: fields.materialStatus || this.data.form.materialStatus || "",
      preproductionSampleStatus: fields.preproductionSampleStatus || this.data.form.preproductionSampleStatus || "",
      preproductionSampleDate: dateText(fields.preproductionSampleDate || this.data.form.preproductionSampleDate),
      productionStatus: fields.productionStatus || this.data.form.productionStatus || "",
      productionStartDate: dateText(fields.productionStartDate || this.data.form.productionStartDate),
      expectedDeliveryDate: dateText(fields.expectedDeliveryDate || this.data.form.expectedDeliveryDate),
      note: fields.note || this.data.form.note || "",
    };
    this.setData({
      session,
      activeStep: index,
      candidates,
      confirmedOrder,
      voiceEnabled: Boolean(session.voiceEnabled ?? this.data.voiceEnabled),
      versionConflict: Boolean(session.versionConflict),
      assistantUnavailable: Boolean(extra.assistantUnavailable),
      exceptionSuggested: Boolean(session.exceptionSuggested || (session.warnings || []).includes("exception_report_recommended")),
      submitted: session.state === "submitted",
      stageIndex: stageIndex(form.stage),
      materialStatusIndex: optionIndex(MATERIAL_STATUSES, form.materialStatus),
      sampleStatusIndex: optionIndex(SAMPLE_STATUSES, form.preproductionSampleStatus),
      productionStatusIndex: optionIndex(PRODUCTION_STATUSES, form.productionStatus),
      form,
      processSteps: processSteps(form),
      photoException: confirmedOrder && this.data.pendingMedia && !this.data.photoException ? { affected: "100件以内", delay: "可能延期" } : this.data.photoException,
    });
  },

  updateInput(event) { this.setData({ inputText: event.detail.value }); },
  updateField(event) {
    const key = event.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.form, { [key]: event.detail.value });
    this.setData({ [`form.${key}`]: event.detail.value, processSteps: processSteps(form) });
  },
  chooseStage(event) {
    const index = Number(event.detail.value);
    const stage = STAGES[index] || STAGES[0];
    const form = Object.assign({}, this.data.form, { stage: stage.value });
    this.setData({ stageIndex: index, "form.stage": stage.value, processSteps: processSteps(form) });
  },

  chooseMilestoneStatus(event) {
    const field = event.currentTarget.dataset.field;
    const optionsKey = event.currentTarget.dataset.options;
    const indexKey = event.currentTarget.dataset.indexKey;
    const options = this.data[optionsKey] || [];
    const index = Number(event.detail.value || 0);
    const value = options[index]?.value || "";
    const form = Object.assign({}, this.data.form, { [field]: value });
    this.setData({ [indexKey]: index, [`form.${field}`]: value, processSteps: processSteps(form) });
  },

  async sendText() {
    const text = String(this.data.inputText || "").trim();
    if (!text || this.data.busy) return;
    this.setData({ inputText: "" });
    await this.sendMessage(text);
  },

  async sendMessage(text, transcriptionId = "") {
    this.setData({ busy: true, error: "", messages: this.data.messages.concat({ role: "user", text }) });
    try {
      const result = await api.messagePartnerAiSession(this.data.sessionId, text, transcriptionId);
      this.applySession(result.session, result);
      if (result.session?.nextQuestion) this.setData({ messages: this.data.messages.concat({ role: "assistant", text: result.session.nextQuestion }) });
    } catch (error) {
      this.setData({ error: error.message || "内容处理失败，原话已保留，可进入原表单填写。" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async confirmOrder(event) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "" });
    try {
      const result = await api.confirmPartnerAiSessionOrder(this.data.sessionId, event.currentTarget.dataset.id);
      this.applySession(result.session, result);
      if (result.session?.nextQuestion) this.setData({ messages: this.data.messages.concat({ role: "assistant", text: result.session.nextQuestion }) });
    } catch (error) {
      this.setData({ error: error.message || "加工单确认失败，请刷新后重试。" });
    } finally {
      this.setData({ busy: false });
    }
  },

  async reconfirmOrder() {
    if (!this.data.session?.confirmedWorkItemId) return;
    await this.confirmOrder({ currentTarget: { dataset: { id: this.data.session.confirmedWorkItemId } } });
  },

  async toggleRecording() {
    if (this.data.recording) {
      // Tapped again while the "叮咚" is still playing: just cancel, nothing was recorded yet.
      if (!this._recorderLive) {
        this._voiceCueToken = 0;
        return this.setData({ recording: false, voiceListening: false });
      }
      return this._recorder.stop();
    }
    if (!this.data.voiceEnabled) return wx.showToast({ title: "当前组织未开启语音，请使用文字", icon: "none" });
    if (this.data.busy || this.data.voiceBusy) return;
    const token = Date.now();
    this._voiceCueToken = token;
    this.setData({ recording: true, voiceListening: false, error: "" });
    await playVoiceStartCue();
    if (this._voiceCueToken !== token || !this.data.recording) return;
    this._recorder.start({ duration: 50_000, sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 48_000, format: "mp3" });
  },

  async handleRecordingStopped(recording) {
    this.setData({ recording: false, voiceListening: false });
    if (!recording?.tempFilePath || Number(recording.duration || 0) < 300) return this.setData({ error: "录音太短，请重新录制。" });
    let fileSize = Number(recording.fileSize || 0);
    if (!fileSize) { try { fileSize = Number(wx.getFileSystemManager().statSync(recording.tempFilePath).size || 0); } catch (_) {} }
    if (!fileSize || fileSize > 2_621_440) return this.setData({ error: "录音无效或超过 2.5MB，请缩短后重试。" });
    this.setData({ voiceBusy: true, error: "" });
    try {
      const result = await api.transcribePartnerAiSessionAudio(this.data.sessionId, {
        tempFilePath: recording.tempFilePath,
        durationMs: Math.max(1, Math.min(50_000, Math.round(Number(recording.duration)))),
        sizeBytes: Math.round(fileSize),
        fileName: `quick-progress-${Date.now()}.mp3`,
        mimeType: "audio/mpeg",
      });
      await this.sendMessage(result.transcript || "", result.transcriptionId || "");
    } catch (error) {
      this.setData({ error: error.message || "语音转写失败，请改用文字输入。" });
    } finally {
      this.setData({ voiceBusy: false });
    }
  },

  openManualForm() {
    const workItemId = this.data.session?.confirmedWorkItemId;
    const tab = this.data.exceptionSuggested ? "&orderTab=exception" : "";
    if (workItemId) wx.navigateTo({ url: `/pages/task-detail/index?id=${encodeURIComponent(workItemId)}${tab}` });
    else wx.navigateTo({ url: "/pages/tasks/index?itemType=production_order" });
  },

  goBack() { wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: "/pages/index/index" }) }); },

  toggleEdit() { this.setData({ editMode: !this.data.editMode }); },

  resetConversation() {
    wx.showModal({ title: "重新开始", content: "当前未提交的内容会保留在原始会话记录中，是否开始一次新的汇报？", confirmText: "重新开始", confirmColor: "#F56A22", success: (result) => {
      if (!result.confirm) return;
      this.setData({ messages: [{ role: "assistant", text: "好的，请告诉我产品名称、SKU 或加工单号。" }], candidates: [], confirmedOrder: null, pendingMedia: null, photoException: null, editMode: false });
      this.startSession();
    } });
  },

  restorePendingMedia() {
    let media = null;
    try { media = wx.getStorageSync("hermes_pending_media"); wx.removeStorageSync("hermes_pending_media"); } catch (_) {}
    if (!media?.tempFilePath) return;
    this.setData({ pendingMedia: media, messages: this.data.messages.concat({ role: "user", text: "已上传现场照片", imageUrl: media.tempFilePath }, { role: "assistant", text: "照片已保留。请先告诉我这是哪个产品或加工单，我确认订单后再帮你整理异常。" }) });
  },

  choosePhoto() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["camera", "album"], success: (result) => {
      const media = result.tempFiles?.[0];
      if (!media?.tempFilePath) return;
      const pendingMedia = { tempFilePath: media.tempFilePath, size: media.size || 0, type: media.fileType || "image" };
      this.setData({ pendingMedia, photoException: this.data.confirmedOrder ? { affected: "100件以内", delay: "可能延期" } : null, messages: this.data.messages.concat({ role: "user", text: "已上传现场照片", imageUrl: media.tempFilePath }, { role: "assistant", text: this.data.confirmedOrder ? "已关联当前加工单，请确认异常影响范围。" : "请再告诉我这是哪个产品或加工单。" }) });
    } });
  },

  previewPhoto() { if (this.data.pendingMedia?.tempFilePath) wx.previewImage({ current: this.data.pendingMedia.tempFilePath, urls: [this.data.pendingMedia.tempFilePath] }); },

  chooseExceptionOption(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`photoException.${field}`]: event.currentTarget.dataset.value });
  },

  async openExceptionForm() {
    const workItemId = this.data.session?.confirmedWorkItemId;
    if (!workItemId) return wx.showToast({ title: "请先确认加工单", icon: "none" });
    try { wx.setStorageSync("hermes_pending_exception", { workItemId, media: this.data.pendingMedia, affected: this.data.photoException?.affected || "", delay: this.data.photoException?.delay || "", createdAt: Date.now() }); } catch (_) {}
    wx.navigateTo({ url: `/pages/task-detail/index?id=${encodeURIComponent(workItemId)}&orderTab=exception` });
  },

  async submit() {
    if (this.data.busy || this.data.exceptionSuggested) return;
    const form = this.data.form;
    if (!form.materialStatus) return wx.showToast({ title: "请选择物料齐套状态", icon: "none" });
    if (!form.preproductionSampleStatus) return wx.showToast({ title: "请选择产前样状态", icon: "none" });
    if (["scheduled", "submitted", "approved"].includes(form.preproductionSampleStatus) && !form.preproductionSampleDate) return wx.showToast({ title: "请选择产前样日期", icon: "none" });
    if (!form.productionStatus) return wx.showToast({ title: "请选择正式投产状态", icon: "none" });
    if (["scheduled", "started", "completed"].includes(form.productionStatus) && !form.productionStartDate) return wx.showToast({ title: "请选择投产日期", icon: "none" });
    if (!form.expectedDeliveryDate) return wx.showToast({ title: "请选择预计交货日期", icon: "none" });
    const progressPercent = String(form.progressPercent).trim() === "" ? null : Number(form.progressPercent);
    if (progressPercent !== null && (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100)) return wx.showToast({ title: "辅助进度需为 0-100", icon: "none" });
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: "确认提交里程碑",
      content: `加工单 ${this.data.confirmedOrder?.orderNo || this.data.confirmedOrder?.referenceNo || ""}：${labelFor(MATERIAL_STATUSES, form.materialStatus)}，${labelFor(PRODUCTION_STATUSES, form.productionStatus)}，预计 ${form.expectedDeliveryDate} 交货。`,
      confirmText: "确认提交", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true, error: "" });
    try {
      await api.submitPartnerOrderReport(this.data.session.confirmedWorkItemId, this.data.session.confirmedWorkItemVersion, {
        reportType: "production_progress",
        stage: form.productionStatus === "completed" ? "ready_to_ship" : form.productionStatus === "started" ? (form.stage || "filling") : form.materialStatus === "ready" ? "planning" : "material_preparation",
        ...(progressPercent === null ? {} : { progressPercent }),
        completedQuantity: Number(form.completedQuantity || 0),
        expectedCompletionDate: form.expectedCompletionDate || "",
        materialStatus: form.materialStatus,
        preproductionSampleStatus: form.preproductionSampleStatus,
        preproductionSampleDate: form.preproductionSampleDate || "",
        productionStatus: form.productionStatus,
        productionStartDate: form.productionStartDate || "",
        expectedDeliveryDate: form.expectedDeliveryDate,
        note: String(form.note || "").trim(),
      }, this.data.session.latestDraftId, `partner-session-submit:${this.data.sessionId}`);
      const refreshed = await api.fetchPartnerAiSession(this.data.sessionId);
      this.applySession(refreshed.session);
      wx.showToast({ title: "里程碑已提交", icon: "success" });
    } catch (error) {
      this.setData({ error: error.message || "提交失败，请刷新订单后重试。" });
      if (error.code === "version_conflict") {
        const refreshed = await api.fetchPartnerAiSession(this.data.sessionId).catch(() => null);
        if (refreshed) this.applySession(refreshed.session);
      }
    } finally {
      this.setData({ busy: false });
    }
  },
});

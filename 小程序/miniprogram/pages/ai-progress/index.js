const api = require("../../utils/api");
const { requireSession } = require("../../utils/auth");
const { preferenceStorageKey, normalizePreferences } = require("../../utils/partner-preferences");

const STAGES = [
  { value: "", label: "请选择阶段" },
  { value: "planning", label: "计划准备" },
  { value: "material_preparation", label: "物料准备" },
  { value: "filling", label: "灌装" },
  { value: "packaging", label: "包装" },
  { value: "quality_check", label: "质量检查" },
  { value: "ready_to_ship", label: "待发货" },
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

function decodeRouteText(value) {
  const text = String(value || "");
  if (!text) return "";
  try { return decodeURIComponent(text); } catch (_) { return text; }
}

function processSteps(stage, progressPercent) {
  const visible = STAGES.filter((item) => item.value);
  const current = Math.max(0, visible.findIndex((item) => item.value === stage));
  const progress = Number(progressPercent || 0);
  return visible.map((item, index) => ({
    key: item.value,
    label: item.label,
    done: index < current || (index === current && progress >= 100),
    current: index === current && progress < 100,
    value: index < current ? 100 : index === current ? progress : 0,
  })).slice(0, Math.max(3, current + 1));
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
    voiceBusy: false,
    stageOptions: STAGES,
    stageIndex: 0,
    form: { stage: "", progressPercent: "", completedQuantity: "", expectedCompletionDate: "", note: "" },
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
    this._recorder.onStop((recording) => this.handleRecordingStopped(recording));
    this._recorder.onError((error) => this.setData({ recording: false, voiceBusy: false, error: error?.errMsg || "录音失败，请改用文字输入。" }));
    this.startSession();
  },

  onUnload() {
    if (this.data.recording && this._recorder) this._recorder.stop();
  },

  async startSession() {
    this.setData({ loading: true, error: "" });
    try {
      const created = await api.createPartnerAiSession();
      this.setData({ sessionId: created.session.id });
      const result = await api.fetchPartnerAiSession(created.session.id);
      this.applySession(result.session);
      if (this._initialPrompt) {
        const prompt = this._initialPrompt;
        this._initialPrompt = "";
        await this.sendMessage(prompt);
      }
      if (this._photoMode) this.restorePendingMedia();
      if (this._autoVoice && this.data.voiceEnabled) setTimeout(() => this.toggleRecording(), 240);
    } catch (error) {
      this.setData({ error: error.message || "Hermes 快捷汇报暂时无法使用。" });
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
      stageIndex: stageIndex(fields.stage || this.data.form.stage),
      form: {
        stage: fields.stage || this.data.form.stage || "",
        progressPercent: fields.progressPercent == null ? this.data.form.progressPercent : String(fields.progressPercent),
        completedQuantity: fields.completedQuantity == null ? this.data.form.completedQuantity : String(fields.completedQuantity),
        expectedCompletionDate: dateText(fields.expectedCompletionDate || this.data.form.expectedCompletionDate),
        note: fields.note || this.data.form.note || "",
      },
      processSteps: processSteps(fields.stage || this.data.form.stage, fields.progressPercent ?? this.data.form.progressPercent),
      photoException: confirmedOrder && this.data.pendingMedia && !this.data.photoException ? { affected: "100件以内", delay: "可能延期" } : this.data.photoException,
    });
  },

  updateInput(event) { this.setData({ inputText: event.detail.value }); },
  updateField(event) {
    const key = event.currentTarget.dataset.field;
    const form = Object.assign({}, this.data.form, { [key]: event.detail.value });
    this.setData({ [`form.${key}`]: event.detail.value, processSteps: processSteps(form.stage, form.progressPercent) });
  },
  chooseStage(event) {
    const index = Number(event.detail.value);
    const stage = STAGES[index] || STAGES[0];
    this.setData({ stageIndex: index, "form.stage": stage.value, processSteps: processSteps(stage.value, this.data.form.progressPercent) });
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

  toggleRecording() {
    if (this.data.recording) return this._recorder.stop();
    if (!this.data.voiceEnabled) return wx.showToast({ title: "当前组织未开启语音，请使用文字", icon: "none" });
    if (this.data.busy || this.data.voiceBusy) return;
    this.setData({ recording: true, error: "" });
    this._recorder.start({ duration: 50_000, sampleRate: 16_000, numberOfChannels: 1, encodeBitRate: 48_000, format: "mp3" });
  },

  async handleRecordingStopped(recording) {
    this.setData({ recording: false });
    if (!recording?.tempFilePath || Number(recording.duration || 0) < 300) return this.setData({ error: "录音太短，请重新录制。" });
    let fileSize = Number(recording.fileSize || 0);
    if (!fileSize) { try { fileSize = Number(wx.getFileSystemManager().statSync(recording.tempFilePath).size || 0); } catch (_) {} }
    if (!fileSize || fileSize > 2_621_440) return this.setData({ error: "录音无效或超过 2.5MB，请缩短后重试。" });
    this.setData({ voiceBusy: true, error: "" });
    try {
      const result = await api.transcribePartnerAiSessionAudio(this.data.sessionId, {
        tempFilePath: recording.tempFilePath,
        durationMs: Math.min(50_000, Number(recording.duration)),
        sizeBytes: fileSize,
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
    const progressPercent = Number(form.progressPercent);
    if (!form.stage) return wx.showToast({ title: "请选择生产阶段", icon: "none" });
    if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) return wx.showToast({ title: "请输入 0-100 的整数进度", icon: "none" });
    if (progressPercent < 100 && !form.expectedCompletionDate) return wx.showToast({ title: "请选择预计完成日期", icon: "none" });
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: "确认提交进度",
      content: `将向加工单 ${this.data.confirmedOrder?.orderNo || this.data.confirmedOrder?.referenceNo || ""} 提交 ${progressPercent}% 的进度，是否继续？`,
      confirmText: "确认提交", confirmColor: "#F45B0B", success: (result) => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirmed) return;
    this.setData({ busy: true, error: "" });
    try {
      await api.submitPartnerOrderReport(this.data.session.confirmedWorkItemId, this.data.session.confirmedWorkItemVersion, {
        reportType: "production_progress",
        stage: form.stage,
        progressPercent,
        completedQuantity: Number(form.completedQuantity || 0),
        expectedCompletionDate: form.expectedCompletionDate,
        note: String(form.note || "").trim(),
      }, this.data.session.latestDraftId, `partner-session-submit:${this.data.sessionId}`);
      const refreshed = await api.fetchPartnerAiSession(this.data.sessionId);
      this.applySession(refreshed.session);
      wx.showToast({ title: "进度已提交", icon: "success" });
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

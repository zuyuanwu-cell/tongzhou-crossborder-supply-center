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
    messages: [],
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
  },

  onLoad(options) {
    const loginSession = requireSession("partner");
    if (!loginSession) return;
    let preferences = null;
    try { preferences = wx.getStorageSync(preferenceStorageKey(loginSession.user.id)); } catch (_) {}
    this._initialPrompt = String(options?.prompt || "").trim();
    this.setData({ voicePreferred: normalizePreferences(preferences).voiceFirst });
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
    });
  },

  updateInput(event) { this.setData({ inputText: event.detail.value }); },
  updateField(event) { this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value }); },
  chooseStage(event) {
    const index = Number(event.detail.value);
    const stage = STAGES[index] || STAGES[0];
    this.setData({ stageIndex: index, "form.stage": stage.value });
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
    if (!this.data.voiceEnabled || this.data.busy || this.data.voiceBusy) return;
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

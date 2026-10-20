const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { formatFullDate } = require("../../utils/format");
const { COMMAND_LABELS, decorateAdminTask, taskFacts } = require("../../utils/admin-format");

Page({
  data: { id: "", item: null, facts: [], lines: [], events: [], attachments: [], commands: [], loading: true, error: "" },
  onLoad(options) { this.setData({ id: options.id || "" }); },
  onShow() { if (requireSession("admin")) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    if (!this.data.id) return this.setData({ loading: false, error: "缺少任务编号。" });
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchTask(this.data.id);
      const item = decorateAdminTask(result.item || {});
      wx.setNavigationBarTitle({ title: item.referenceNo || "任务详情" });
      this.setData({
        item,
        facts: taskFacts(result.item),
        lines: (result.lines || []).map((line) => Object.assign({}, line, { quantityText: `${Number(line.completedQuantity || 0).toLocaleString()} / ${Number(line.plannedQuantity || 0).toLocaleString()} ${line.unit || ""}` })),
        events: (result.events || []).map((event) => Object.assign({}, event, { timeText: formatFullDate(event.createdAt), actorLabel: event.actorName || "协同系统" })),
        attachments: (result.attachments || []).map((file) => Object.assign({}, file, { sizeText: `${Math.max(1, Math.ceil(Number(file.sizeBytes || 0) / 1024))} KB` })),
        commands: (result.commands || []).map((command) => Object.assign({}, command, { commandLabel: COMMAND_LABELS[command.commandType] || command.commandType, timeText: formatFullDate(command.submittedAt) })),
      });
    } catch (error) {
      this.setData({ error: error.message || "任务详情读取失败。" });
    } finally {
      this.setData({ loading: false });
    }
  },
});

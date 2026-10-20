const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { decorateApproval } = require("../../utils/admin-format");

Page({
  data: { items: [], loading: true, error: "", busy: "", allowed: true },
  onShow() {
    const session = requireSession("admin");
    if (!session) return;
    const allowed = Boolean(session.capabilities?.reviewCommands);
    this.setData({ allowed });
    if (allowed) this.load();
    else this.setData({ loading: false, error: "当前中台账号没有协同审批权限。" });
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (!this.data.allowed) return;
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchApprovals();
      this.setData({ items: (result.approvals || []).map(decorateApproval) });
    } catch (error) {
      this.setData({ error: error.message || "审批队列读取失败。" });
    } finally { this.setData({ loading: false }); }
  },
  review(event) {
    const commandId = event.currentTarget.dataset.id;
    const decision = event.currentTarget.dataset.decision;
    const item = this.data.items.find((entry) => entry.commandId === commandId);
    if (!item || this.data.busy) return;
    const approving = decision === "approve";
    wx.showModal({
      title: approving ? "批准并入账" : "驳回伙伴操作",
      content: `${item.organizationLabel} · ${item.commandLabel}\n${item.payloadText}`,
      editable: true,
      placeholderText: approving ? "审批备注（可选）" : "请输入驳回原因（必填）",
      confirmText: approving ? "确认批准" : "确认驳回",
      confirmColor: approving ? "#116F63" : "#B42318",
      success: async (result) => {
        if (!result.confirm) return;
        const note = String(result.content || "").trim();
        if (!approving && note.length < 2) return wx.showToast({ title: "请填写驳回原因", icon: "none" });
        this.setData({ busy: commandId });
        try {
          await adminApi.reviewApproval(commandId, decision, note);
          wx.showToast({ title: approving ? "已批准" : "已驳回", icon: "success" });
          await this.load();
        } catch (error) {
          wx.showModal({ title: "审批失败", content: error.message || "请稍后重试。", showCancel: false });
        } finally { this.setData({ busy: "" }); }
      },
    });
  },
});

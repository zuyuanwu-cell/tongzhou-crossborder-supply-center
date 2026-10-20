const adminApi = require("../../utils/admin-api");
const { requireSession } = require("../../utils/auth");
const { formatFullDate } = require("../../utils/format");
const { decorateOrganization } = require("../../utils/admin-format");

const ROLE_LABELS = { organization_admin: "组织管理员", manager: "业务经理", operator: "作业人员", finance: "财务", viewer: "查看员" };

Page({
  data: { code: "", organization: null, members: [], invitations: [], loading: true, error: "" },
  onLoad(options) { this.setData({ code: options.code || "" }); },
  onShow() { if (requireSession("admin")) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (!this.data.code) return this.setData({ loading: false, error: "缺少伙伴组织编码。" });
    this.setData({ loading: true, error: "" });
    try {
      const result = await adminApi.fetchOrganization(this.data.code);
      const organization = decorateOrganization(result.organization || {});
      wx.setNavigationBarTitle({ title: organization.name || "组织详情" });
      this.setData({
        organization,
        members: (result.members || []).map((member) => Object.assign({}, member, { initial: String(member.displayName || member.username || "员").slice(0, 1), roleLabel: ROLE_LABELS[member.role] || member.role || "成员", statusLabel: member.status === "active" && member.userStatus === "active" ? "正常" : "已停用", lastLoginText: member.lastLoginAt ? formatFullDate(member.lastLoginAt) : "暂无登录" })),
        invitations: (result.invitations || []).map((invitation) => Object.assign({}, invitation, { roleLabel: ROLE_LABELS[invitation.role] || invitation.role || "成员", expiresText: formatFullDate(invitation.expiresAt) })),
      });
    } catch (error) { this.setData({ error: error.message || "组织详情读取失败。" }); }
    finally { this.setData({ loading: false }); }
  },
});

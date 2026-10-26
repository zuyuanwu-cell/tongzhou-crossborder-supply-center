Component({
  properties: {
    active: { type: String, value: "index" },
    unread: { type: Number, value: 0 },
    theme: { type: String, value: "light" },
    mode: {
      type: String,
      value: "partner",
      observer(value) { this.syncItems(value); },
    },
  },
  data: {
    items: [
      { key: "index", label: "Hermes", path: "/pages/index/index" },
      { key: "tasks", label: "任务", path: "/pages/tasks/index" },
      { key: "messages", label: "消息", path: "/pages/messages/index" },
      { key: "profile", label: "我的", path: "/pages/profile/index" }
    ],
  },
  lifetimes: { attached() { this.syncItems(this.properties.mode); } },
  methods: {
    syncItems(mode) {
      const items = mode === "admin" ? [
        { key: "admin-index", label: "总览", path: "/pages/admin/index" },
        { key: "admin-tasks", label: "任务", path: "/pages/admin-tasks/index" },
        { key: "admin-approvals", label: "审批", path: "/pages/admin-approvals/index" },
        { key: "admin-organizations", label: "伙伴", path: "/pages/admin-organizations/index" },
        { key: "profile", label: "我的", path: "/pages/profile/index" },
      ] : [
        { key: "index", label: "Hermes", path: "/pages/index/index" },
        { key: "tasks", label: "任务", path: "/pages/tasks/index" },
        { key: "messages", label: "消息", path: "/pages/messages/index" },
        { key: "profile", label: "我的", path: "/pages/profile/index" },
      ];
      this.setData({ items });
    },
    navigate(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || item.key === this.properties.active) return;
      wx.redirectTo({ url: item.path });
    }
  }
});

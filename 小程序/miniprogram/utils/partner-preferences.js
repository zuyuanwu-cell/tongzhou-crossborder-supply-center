const CAPABILITY_LABELS = Object.freeze([
  { capability: "production.order.view", label: "委外加工单", note: "查看与反馈进度" },
  { capability: "procurement.order.view", label: "物料采购单", note: "查看与反馈履约" },
  { capability: "sampling.task.view", label: "打样任务", note: "料体与包材打样" },
  { capability: "production.artifact.submit", label: "首件档案", note: "查看与提交资料" },
  { capability: "warehouse.task.view", label: "仓库任务", note: "签收、验货与出入库" },
  { capability: "warehouse.inventory.view", label: "本仓库存", note: "仅授权仓库" },
]);

const DEFAULT_PREFERENCES = Object.freeze({ voiceFirst: true, dueReminder: true });

function preferenceStorageKey(userId) {
  return `partner_assistant_preferences:${String(userId || "anonymous")}`;
}

function normalizePreferences(value) {
  return {
    voiceFirst: value?.voiceFirst !== false,
    dueReminder: value?.dueReminder !== false,
  };
}

const SCOPE_TONES = ["orange", "green", "cyan", "violet"];

function accessScopes(workspace) {
  const list = workspace?.capabilities || [];
  const capabilities = new Set(list);
  const scopes = CAPABILITY_LABELS.filter((item) => capabilities.has(item.capability)).map((item, index) => {
    const domain = item.capability.split(".")[0];
    return Object.assign({}, item, {
      tone: SCOPE_TONES[index % SCOPE_TONES.length],
      count: list.filter((capability) => String(capability).split(".")[0] === domain).length,
    });
  });
  if (scopes.length) return scopes;
  return (workspace?.resources || []).slice(0, 4).map((resource) => ({
    capability: resource.ref || resource.name,
    label: resource.name || "授权资源",
    note: "只读查看",
    tone: "cyan",
    count: 0,
  }));
}

module.exports = { DEFAULT_PREFERENCES, preferenceStorageKey, normalizePreferences, accessScopes };

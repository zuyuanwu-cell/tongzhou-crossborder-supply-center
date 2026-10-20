const TYPE_PROFILES = Object.freeze({
  warehouse: {
    symbol: "仓", name: "仓库协同", eyebrow: "WAREHOUSE OPERATIONS",
    slogan: ["今天，把每一次交接", "做得清楚、准确、有回音。"],
    syncLabel: "库存最近同步", taskTitle: "仓库任务", taskSubtitle: "接单、执行、回传数量与现场凭证",
    boundaryCopy: "任务、附件与库存仅包含本组织被授权的仓库。",
  },
  filing_service: {
    symbol: "备", name: "备案协同", eyebrow: "REGULATORY FILING",
    slogan: ["资料有版本，", "备案有进度，结果有回音。"],
    syncLabel: "任务最近更新", taskTitle: "备案任务", taskSubtitle: "接收资料要求、回传备案文件与结果",
    boundaryCopy: "仅展示本组织被授权的备案项目、资料和沟通记录。",
  },
  sampling_factory: {
    symbol: "样", name: "打样协同", eyebrow: "SAMPLE WORKFLOW",
    slogan: ["从规格到样品，", "每个节点都清楚可追踪。"],
    syncLabel: "任务最近更新", taskTitle: "打样任务", taskSubtitle: "确认规格、更新进度并提交样品结果",
    boundaryCopy: "仅展示本组织被授权的打样项目、文件和结果。",
  },
  packaging_factory: {
    symbol: "包", name: "包装供应", eyebrow: "PACKAGING SUPPLY",
    slogan: ["订单有要求，", "备货、发运、交付都有回音。"],
    syncLabel: "订单最近更新", taskTitle: "采购协同", taskSubtitle: "确认订单、反馈备货与交付进度并留存发运凭证",
    boundaryCopy: "仅展示本组织获授权的采购订单、交付资料和沟通记录。",
  },
  material_supplier: {
    symbol: "供", name: "物料供应", eyebrow: "MATERIAL SUPPLY",
    slogan: ["交期看得见，", "备货、发运、异常及时反馈。"],
    syncLabel: "订单最近更新", taskTitle: "采购协同", taskSubtitle: "确认订单、反馈备货与交付进度并留存发运凭证",
    boundaryCopy: "仅展示本组织获授权的采购订单、交付资料和沟通记录。",
  },
  production_factory: {
    symbol: "产", name: "委外生产", eyebrow: "PRODUCTION DELIVERY",
    slogan: ["加工、采购与交付，", "每个节点都清楚、有回音。"],
    syncLabel: "订单最近更新", taskTitle: "加工与采购", taskSubtitle: "反馈生产、物料与包材测试、采购履约、异常和发货进度",
    boundaryCopy: "仅展示本组织获授权的加工单、采购单和首件档案。",
  },
  internal: {
    symbol: "协", name: "伙伴协同", eyebrow: "PARTNER WORKSPACE",
    slogan: ["协作有边界，", "任务、资料、结果都可追踪。"],
    syncLabel: "任务最近更新", taskTitle: "协同任务", taskSubtitle: "处理本组织被授权的协同事项",
    boundaryCopy: "仅展示本组织被授权的任务与资料。",
  },
});

const TYPE_CAPABILITIES = Object.freeze({
  warehouse: ["warehouse.inventory.view", "warehouse.task.view", "warehouse.task.handle", "warehouse.exception.report", "warehouse.inbound.confirm", "warehouse.outbound.confirm", "warehouse.transfer.receive", "warehouse.inventory.adjust.request", "warehouse.task.complete", "attachment.upload"],
  filing_service: ["filing.task.view", "filing.task.handle", "filing.artifact.submit", "attachment.upload"],
  sampling_factory: ["sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "sampling.quote.submit", "attachment.upload"],
  packaging_factory: ["procurement.order.view", "procurement.fulfillment.update", "procurement.exception.report", "sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "sampling.quote.submit", "packaging.quote.view", "packaging.quote.submit", "attachment.upload"],
  material_supplier: ["procurement.order.view", "procurement.fulfillment.update", "procurement.exception.report", "sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "sampling.quote.submit", "attachment.upload"],
  production_factory: ["production.order.view", "production.progress.update", "production.material.update", "production.exception.report", "production.shipment.submit", "production.artifact.submit", "procurement.order.view", "procurement.fulfillment.update", "procurement.exception.report", "sampling.task.view", "sampling.task.handle", "sampling.artifact.submit", "sampling.quote.submit", "attachment.upload"],
  internal: [],
});

const TYPE_MODULES = Object.freeze({
  warehouse: ["tasks", "messages", "profile", "inventory", "warehouse_operations"],
  filing_service: ["tasks", "messages", "profile", "filing"],
  sampling_factory: ["tasks", "messages", "profile", "material_sampling"],
  packaging_factory: ["tasks", "messages", "profile", "procurement", "packaging_sampling"],
  material_supplier: ["tasks", "messages", "profile", "procurement", "material_sampling"],
  production_factory: ["tasks", "messages", "profile", "production", "procurement", "material_sampling", "packaging_sampling"],
  internal: ["tasks", "messages", "profile"],
});

const TYPE_TASKS = Object.freeze({
  warehouse: ["warehouse_inbound", "warehouse_outbound", "warehouse_transfer", "warehouse_stockup", "warehouse_exception"],
  filing_service: ["filing_task"], sampling_factory: ["sampling_task"], packaging_factory: ["purchase_order", "sampling_task", "packaging_quote"],
  material_supplier: ["purchase_order", "sampling_task"], production_factory: ["production_order", "purchase_order", "sampling_task"], internal: [],
});

const SAMPLE_CATEGORIES = Object.freeze({
  sampling_factory: ["inner_material"],
  material_supplier: ["inner_material"],
  packaging_factory: ["packaging"],
  production_factory: ["inner_material", "packaging"],
});

const ACTION_ROLES = Object.freeze({
  accept: ["organization_admin", "manager", "operator"],
  progress: ["organization_admin", "manager", "operator"],
  report_exception: ["organization_admin", "manager", "operator"],
  inbound_confirm: ["organization_admin", "manager", "operator"],
  outbound_confirm: ["organization_admin", "manager", "operator"],
  transfer_receive: ["organization_admin", "manager", "operator"],
  inventory_adjustment: ["organization_admin", "manager"],
  stockup_process: ["organization_admin", "manager", "operator"],
  complete: ["organization_admin", "manager"],
  artifact_submit: ["organization_admin", "manager", "operator"],
  quote_submit: ["organization_admin", "manager", "operator"],
  partner_order_report: ["organization_admin", "manager", "operator"],
  attachment_upload: ["organization_admin", "manager", "operator"],
  milestone_update: ["organization_admin", "manager", "operator"],
});

const PERMISSION_ACTIONS = Object.freeze({
  "warehouse.task.handle": ["accept", "progress"],
  "warehouse.exception.report": ["report_exception"],
  "warehouse.inbound.confirm": ["inbound_confirm"],
  "warehouse.outbound.confirm": ["outbound_confirm"],
  "warehouse.transfer.receive": ["transfer_receive"],
  "warehouse.inventory.adjust.request": ["inventory_adjustment"],
  "warehouse.task.complete": ["stockup_process", "complete"],
  "filing.task.handle": ["accept", "progress", "complete"],
  "filing.artifact.submit": ["artifact_submit"],
  "sampling.task.handle": ["accept", "progress", "complete"],
  "sampling.artifact.submit": ["artifact_submit"],
  "sampling.quote.submit": ["quote_submit"],
  "packaging.quote.submit": ["quote_submit"],
  "production.progress.update": ["accept", "progress", "complete", "milestone_update", "partner_order_report"],
  "production.material.update": ["partner_order_report"],
  "production.exception.report": ["partner_order_report"],
  "production.shipment.submit": ["partner_order_report"],
  "production.artifact.submit": ["artifact_submit"],
  "procurement.fulfillment.update": ["accept", "progress", "complete", "partner_order_report"],
  "procurement.exception.report": ["partner_order_report"],
  "attachment.upload": ["attachment_upload"],
});

function roleAllowsAction(role, action) {
  return (ACTION_ROLES[action] || []).includes(role);
}

function actionsFromServer(sourceActions, capabilities, role) {
  const raw = [...new Set([...(sourceActions || []), ...(capabilities || [])])];
  const derived = raw.flatMap((permission) => PERMISSION_ACTIONS[permission] || [permission]);
  return [...new Set(derived)].filter((action) => roleAllowsAction(role, action));
}

function modulesFromServer(sourceModules) {
  const aliases = { notifications: "messages", account: "profile" };
  return [...new Set((sourceModules || []).map((module) => aliases[module] || module))];
}

function roleActions(type, role) {
  if (!["organization_admin", "manager", "operator"].includes(role)) return [];
  const actions = ["accept", "progress"];
  if ((TYPE_CAPABILITIES[type] || []).includes("attachment.upload")) actions.push("attachment_upload");
  if (["warehouse", "production_factory"].includes(type)) actions.push("report_exception");
  if (["organization_admin", "manager"].includes(role)) actions.push("complete");
  if (type === "warehouse") {
    actions.push("inbound_confirm", "outbound_confirm", "transfer_receive", "stockup_process");
    if (["organization_admin", "manager"].includes(role)) actions.push("inventory_adjustment");
  }
  if (type === "filing_service" || SAMPLE_CATEGORIES[type]?.length) actions.push("artifact_submit");
  if (SAMPLE_CATEGORIES[type]?.length) actions.push("quote_submit");
  if (["production_factory", "packaging_factory", "material_supplier"].includes(type)) actions.push("partner_order_report");
  return actions;
}

function fallbackWorkspace(session) {
  const type = session?.organization?.type || session?.membership?.organizationType || "internal";
  const modules = TYPE_MODULES[type] || TYPE_MODULES.internal;
  return {
    kind: type,
    label: (TYPE_PROFILES[type] || TYPE_PROFILES.internal).name,
    modules,
    actions: roleActions(type, session?.membership?.role),
    capabilities: TYPE_CAPABILITIES[type] || [],
    resources: [],
    taskTypes: TYPE_TASKS[type] || [],
    sampleCategories: SAMPLE_CATEGORIES[type] || [],
    featureFlags: { oem: Boolean(session?.oemEnabled) },
  };
}

function getWorkspace(session) {
  const fallback = fallbackWorkspace(session || {});
  const source = session?.workspace || {};
  const hasServerWorkspace = Boolean(session?.workspace && Array.isArray(source.modules)
    && Array.isArray(source.actions) && Array.isArray(source.capabilities) && Array.isArray(source.taskTypes));
  const kind = source.kind || fallback.kind;
  const capabilities = [...new Set(hasServerWorkspace ? source.capabilities : fallback.capabilities || [])];
  const actions = hasServerWorkspace
    ? actionsFromServer(source.actions, capabilities, session?.membership?.role)
    : [...new Set(fallback.actions || [])];
  const taskTypes = [...new Set(hasServerWorkspace ? source.taskTypes : TYPE_TASKS[kind] || [])];
  return Object.assign({}, fallback, source, {
    kind,
    profile: TYPE_PROFILES[kind] || TYPE_PROFILES.internal,
    modules: hasServerWorkspace ? modulesFromServer(source.modules) : [...new Set(fallback.modules || [])],
    actions,
    capabilities,
    resources: Array.isArray(source.resources) ? source.resources : fallback.resources,
    taskTypes,
    sampleCategories: SAMPLE_CATEGORIES[kind] || [],
    featureFlags: Object.assign({}, fallback.featureFlags, source.featureFlags || {}),
  });
}

function hasModule(workspace, module) { return Boolean(workspace?.modules?.includes(module)); }
function canAction(workspace, action) { return Boolean(workspace?.actions?.includes(action)); }
function canCapability(workspace, capability) { return Boolean(workspace?.capabilities?.includes(capability)); }

function quickActions(workspace) {
  const kind = workspace?.kind || "internal";
  if (kind === "warehouse") {
    return [
      hasModule(workspace, "inventory") ? { key: "scan", label: "扫码查库存", icon: "⌗", highlight: true } : null,
      canAction(workspace, "inbound_confirm") ? { key: "operation", operationType: "inbound", label: "发起入库", icon: "↓" } : null,
      canAction(workspace, "outbound_confirm") ? { key: "operation", operationType: "outbound", label: "发起出库", icon: "↑" } : null,
      canAction(workspace, "inventory_adjustment") ? { key: "operation", operationType: "stocktake", label: "盘点差异", icon: "✓" } : null,
      hasModule(workspace, "inventory") ? { key: "inventory", label: "库存查询", icon: "库" } : null,
      { key: "tasks", label: "全部任务", icon: "单" },
    ].filter(Boolean).slice(0, 4);
  }
  const definitions = {
    filing_service: [
      { key: "tasks", itemType: "filing_task", label: "备案任务", icon: "备", highlight: true },
      { key: "tasks", itemType: "filing_task", status: "in_progress", label: "处理中", icon: "进" },
      { key: "messages", label: "结果通知", icon: "信" }, { key: "profile", label: "授权范围", icon: "界" },
    ],
    sampling_factory: [
      { key: "tasks", sampleCategory: "inner_material", label: "料体打样", icon: "料", highlight: true },
      { key: "tasks", sampleCategory: "inner_material", status: "in_progress", label: "送样进度", icon: "进" },
      { key: "messages", label: "结果通知", icon: "信" }, { key: "profile", label: "授权范围", icon: "界" },
    ],
    packaging_factory: [
      { key: "tasks", itemType: "packaging_quote", label: "包装报价", icon: "报", highlight: true },
      { key: "tasks", itemType: "purchase_order", label: "采购订单", icon: "采", highlight: true },
      { key: "tasks", sampleCategory: "packaging", label: "包材打样", icon: "样" },
      { key: "tasks", itemType: "purchase_order", status: "accepted", label: "履约进度", icon: "进" },
      { key: "messages", label: "交付通知", icon: "信" }, { key: "profile", label: "授权范围", icon: "界" },
    ],
    material_supplier: [
      { key: "tasks", itemType: "purchase_order", label: "采购订单", icon: "采", highlight: true },
      { key: "tasks", sampleCategory: "inner_material", label: "料体打样", icon: "样" },
      { key: "tasks", itemType: "purchase_order", status: "accepted", label: "履约进度", icon: "进" },
      { key: "messages", label: "交付通知", icon: "信" }, { key: "profile", label: "授权范围", icon: "界" },
    ],
    production_factory: [
      { key: "tasks", itemType: "production_order", label: "委外加工单", icon: "产", highlight: true },
      { key: "tasks", itemType: "purchase_order", label: "物料采购单", icon: "采" },
      { key: "tasks", sampleCategory: "inner_material", label: "料体打样", icon: "料" },
      { key: "tasks", sampleCategory: "packaging", label: "包材打样", icon: "包" },
    ],
  };
  const actions = definitions[kind] || [{ key: "tasks", label: "协同任务", icon: "单", highlight: true }, { key: "messages", label: "消息", icon: "信" }, { key: "profile", label: "授权范围", icon: "界" }];
  return actions.filter((action) => {
    if (action.itemType && !workspace?.taskTypes?.includes(action.itemType)) return false;
    if (action.sampleCategory && (!workspace?.taskTypes?.includes("sampling_task") || workspace?.featureFlags?.oem === false)) return false;
    if (["messages", "profile"].includes(action.key) && !hasModule(workspace, action.key)) return false;
    return true;
  }).slice(0, 4);
}

module.exports = { TYPE_PROFILES, TYPE_TASKS, SAMPLE_CATEGORIES, fallbackWorkspace, getWorkspace, hasModule, canAction, canCapability, quickActions };

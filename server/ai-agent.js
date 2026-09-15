const MAX_CONTEXT_RECORDS = 36;
const MAX_CHAT_MESSAGES = 12;
const BLOCKED_CONTEXT_KEY = /password|secret|token|webhook|credential|authorization|api[-_]?key|app[-_]?key|access[-_]?key|clientsecret|client_secret/i;

const PAGE_DEFINITIONS = {
  "#dashboard": {
    id: "dashboard",
    title: "经营工作台",
    description: "总览库存、动销、备货、仓库协同和资质风险。",
    resourceTypes: ["inventory_value_summary", "movement_item", "stockup_recommendation", "after_sales_ticket", "warehouse_ticket", "qualification_expiry"],
    prompts: ["今天最需要我关注什么？", "哪些异常会影响发货？", "给我一个处理优先级清单"],
    actions: [{ label: "查看库存风险", href: "#movement" }, { label: "查看仓库协同", href: "#after-sales" }],
  },
  "#products": {
    id: "products",
    title: "产品库",
    description: "理解产品档案、国家 SKU、资料完整度和可上架信息。",
    resourceTypes: ["product_base", "product_catalog", "qualification", "asset"],
    prompts: ["哪些产品资料不完整？", "帮我理解当前产品结构", "如何完善这个产品的上架资料？"],
    actions: [{ label: "查看资质", href: "#qualifications" }, { label: "进入同舟 AI", href: "#tongzhou-ai" }],
  },
  "#qualifications": {
    id: "qualifications",
    title: "资质中心",
    description: "识别即将到期、已过期和资料不完整的产品资质。",
    resourceTypes: ["qualification_expiry", "qualification"],
    prompts: ["哪些证件需要优先续证？", "按紧急程度生成续证清单", "哪些产品存在资质风险？"],
    actions: [{ label: "查看产品库", href: "#products" }],
  },
  "#assets": {
    id: "assets",
    title: "素材库",
    description: "理解产品图片、文档和素材完整度。",
    resourceTypes: ["asset", "product_base"],
    prompts: ["哪些产品缺少素材？", "现有素材适合做什么内容？", "帮我列一个补拍清单"],
    actions: [{ label: "进入同舟 AI", href: "#tongzhou-ai" }],
  },
  "#warehouse-info": {
    id: "warehouse-info",
    title: "仓库信息",
    description: "查询仓库地址、时区、营业时间和协作信息。",
    resourceTypes: ["warehouse_info"],
    prompts: ["当前有哪些可用仓库？", "帮我理解仓库时区和工作时间", "哪些仓库信息需要补齐？"],
    actions: [{ label: "查看仓库协同", href: "#after-sales" }],
  },
  "#inventory": {
    id: "inventory",
    title: "库存同步",
    description: "诊断 WMS 库存同步、SKU 映射和库存异常。",
    resourceTypes: ["inventory_position", "wms_product", "warehouse_connection"],
    prompts: ["库存数据有什么异常？", "哪些 SKU 可能映射失败？", "哪些仓库数据需要刷新？"],
    actions: [{ label: "查看库存风险", href: "#movement" }, { label: "查看仓库授权", href: "#warehouses" }],
  },
  "#warehouses": {
    id: "warehouses",
    title: "仓库授权",
    description: "理解已启用仓库、连接状态和同步范围。",
    resourceTypes: ["warehouse_connection"],
    prompts: ["哪些仓库连接异常？", "当前仓库授权覆盖哪些国家？", "同步范围是否合理？"],
    actions: [{ label: "查看库存同步", href: "#inventory" }],
  },
  "#inventory-snapshots": {
    id: "inventory-snapshots",
    title: "库存快照",
    description: "理解库存快照的时间覆盖和数据完整性。",
    resourceTypes: ["inventory_value_summary"],
    prompts: ["快照是否连续？", "最近库存有什么明显变化？", "哪些数据可能已经过期？"],
    actions: [{ label: "查看仓库货值", href: "#inventory-value" }],
  },
  "#inventory-value": {
    id: "inventory-value",
    title: "仓库货值",
    description: "解释货值变化、成本覆盖率和待补成本。",
    resourceTypes: ["inventory_value_summary"],
    prompts: ["货值变化的主要原因是什么？", "哪些成本缺失最需要处理？", "帮我解释当前货值风险"],
    actions: [{ label: "查看库存快照", href: "#inventory-snapshots" }],
  },
  "#movement": {
    id: "movement",
    title: "库存风险",
    description: "诊断缺货、补货预警、慢销和滞销。",
    resourceTypes: ["movement_item", "inventory_position"],
    prompts: ["哪些 SKU 风险最高？", "缺货和滞销分别怎么处理？", "给我一份今天的补货优先级"],
    actions: [{ label: "查看备货建议", href: "#stockup-recommendations" }],
  },
  "#movement-analysis": {
    id: "movement-analysis",
    title: "动销趋势与对账",
    description: "理解历史动销、库存变化和对账异常。",
    resourceTypes: ["movement_snapshot", "movement_item"],
    prompts: ["近期动销趋势有什么变化？", "哪些库存变化需要核对？", "帮我总结本周期异常"],
    actions: [{ label: "查看库存风险", href: "#movement" }],
  },
  "#order-analysis": {
    id: "order-analysis",
    title: "订单分析",
    description: "理解订单、店铺、平台和仓库履约数据。",
    resourceTypes: ["performance_summary", "order_sync_job"],
    prompts: ["订单数据有什么异常？", "哪些店铺或仓库值得关注？", "同步数据是否完整？"],
    actions: [{ label: "查看经营贡献", href: "#performance" }],
  },
  "#performance": {
    id: "performance",
    title: "经营贡献",
    description: "理解销售、成本覆盖和经营贡献数据。",
    resourceTypes: ["performance_summary"],
    prompts: ["当前经营数据有什么风险？", "哪些成本口径需要完善？", "帮我总结经营贡献变化"],
    actions: [{ label: "查看订单分析", href: "#order-analysis" }],
  },
  "#stockup": {
    id: "stockup",
    title: "备货中心",
    description: "诊断备货建议、执行单和入库进度。",
    resourceTypes: ["stockup_recommendation", "stockup_plan", "stockup_order"],
    prompts: ["哪些备货任务最紧急？", "有哪些已采纳但未执行的建议？", "入库进度有什么异常？"],
    actions: [{ label: "查看备货执行", href: "#stockup-execution" }],
  },
  "#stockup-recommendations": {
    id: "stockup-recommendations",
    title: "备货建议",
    description: "解释补货数量、风险和建议优先级。",
    resourceTypes: ["stockup_recommendation", "movement_item"],
    prompts: ["为什么建议补这些 SKU？", "哪些建议应优先采纳？", "哪些建议需要人工复核？"],
    actions: [{ label: "查看库存风险", href: "#movement" }, { label: "查看备货执行", href: "#stockup-execution" }],
  },
  "#stockup-execution": {
    id: "stockup-execution",
    title: "备货执行",
    description: "理解采购、生产、发货和入库执行状态。",
    resourceTypes: ["stockup_plan", "stockup_order", "stockup_decision"],
    prompts: ["哪些执行单已经超时？", "下一步应该催哪一环？", "帮我整理待处理清单"],
    actions: [{ label: "查看生产中心", href: "#production" }],
  },
  "#production": {
    id: "production",
    title: "生产中心",
    description: "理解生产单、物料齐套和委外进度。",
    resourceTypes: ["outsourcing_order", "stockup_plan"],
    prompts: ["哪些生产单可能延期？", "物料未到齐的主要原因是什么？", "帮我生成生产跟进清单"],
    actions: [{ label: "查看备货执行", href: "#stockup-execution" }],
  },
  "#after-sales": {
    id: "after-sales",
    title: "仓库协同",
    description: "理解售后单、仓库工单、责任和处理进度。",
    resourceTypes: ["after_sales_ticket", "warehouse_ticket"],
    prompts: ["哪些售后单超时未处理？", "仓库当前最需要处理什么？", "帮我总结驳回和待补发问题"],
    actions: [{ label: "查看库存风险", href: "#movement" }],
  },
  "#miaoshou": {
    id: "miaoshou",
    title: "妙手 ERP",
    description: "理解订单别名、自动运单和 AI 上架任务。",
    resourceTypes: ["miaoshou_task", "product_catalog"],
    prompts: ["妙手任务有哪些异常？", "哪些任务需要人工复核？", "帮我解释当前失败原因"],
    actions: [{ label: "查看产品库", href: "#products" }, { label: "进入同舟 AI", href: "#tongzhou-ai" }],
  },
};

const DEFAULT_PAGE = {
  id: "workspace",
  title: "当前工作区",
  description: "理解当前账号可访问的数据与协作事项。",
  resourceTypes: ["page"],
  prompts: ["这个页面可以做什么？", "当前数据有什么风险？", "告诉我下一步该怎么做"],
  actions: [{ label: "返回经营工作台", href: "#dashboard" }],
};

function text(value, maxLength = 1000) {
  const normalized = String(value ?? "").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compactValue(value, depth = 0) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return text(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 2) return Array.isArray(value) ? `[${value.length} 项]` : "[对象]";
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => compactValue(item, depth + 1));
  if (typeof value !== "object") return text(value, 200);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_CONTEXT_KEY.test(key))
    .slice(0, 20)
    .map(([key, item]) => [key, compactValue(item, depth + 1)]));
}

export function normalizeAgentRoute(value) {
  const raw = text(value, 200).split("?", 1)[0].toLowerCase();
  if (!raw) return "#dashboard";
  const route = raw.startsWith("#") ? raw : `#${raw.replace(/^\/+/, "")}`;
  if (["#inventory-sync"].includes(route)) return "#inventory";
  return route;
}

export function agentPageDefinition(route) {
  const normalizedRoute = normalizeAgentRoute(route);
  return { route: normalizedRoute, ...(PAGE_DEFINITIONS[normalizedRoute] || DEFAULT_PAGE) };
}

function recordSummary(record) {
  return {
    id: text(record?.id, 240),
    type: text(record?.type, 80),
    title: text(record?.title || record?.display_name, 180),
    status: text(record?.status, 80),
    body: text(record?.body, 700),
    updatedAt: text(record?.updated_at, 80),
    sourcePath: text(record?.source_path, 240),
    data: compactValue(record?.data),
  };
}

function isIssueStatus(status) {
  return /失败|异常|超时|驳回|拒绝|缺货|滞销|待处理|待仓库|待补发|failed|error|timeout|rejected|pending_warehouse|awaiting_reshipment|stagnant|stockout/i.test(text(status));
}

export function buildAgentContext({
  route,
  configured = false,
  records = [],
  sources = [],
  metrics = [],
  insights = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const page = agentPageDefinition(route);
  const safeRecords = (Array.isArray(records) ? records : []).slice(0, MAX_CONTEXT_RECORDS).map(recordSummary);
  const issueRecords = safeRecords.filter((record) => isIssueStatus(record.status));
  const normalizedSources = (Array.isArray(sources) ? sources : []).map((source) => ({
    type: text(source?.type, 80),
    label: text(source?.label || source?.type, 120),
    count: Math.max(0, Number(source?.count) || 0),
    updatedAt: text(source?.updatedAt, 80),
    complete: source?.complete !== false,
    warning: text(source?.warning, 240),
  }));
  const normalizedInsights = (Array.isArray(insights) ? insights : []).map((item) => ({
    severity: ["critical", "warning", "info", "success"].includes(item?.severity) ? item.severity : "info",
    title: text(item?.title, 120),
    detail: text(item?.detail, 320),
    href: text(item?.href, 160),
  })).filter((item) => item.title);

  if (issueRecords.length) {
    normalizedInsights.unshift({
      severity: "warning",
      title: `发现 ${issueRecords.length} 条异常或待处理记录`,
      detail: issueRecords.slice(0, 3).map((record) => `${record.title}${record.status ? `（${record.status}）` : ""}`).join("、"),
      href: page.route,
    });
  } else if (safeRecords.length) {
    normalizedInsights.unshift({ severity: "success", title: "当前上下文未发现明显状态异常", detail: `已检查 ${safeRecords.length} 条相关记录。`, href: "" });
  } else {
    normalizedInsights.unshift({ severity: "info", title: "当前页面暂无可分析记录", detail: "可能是当前筛选范围没有数据，或数据源尚未形成缓存。", href: "" });
  }

  for (const source of normalizedSources.filter((item) => item.warning || !item.complete)) {
    normalizedInsights.push({
      severity: "warning",
      title: `${source.label}数据可能不完整`,
      detail: source.warning || "数据源本次读取未完整完成，结论应结合最近更新时间复核。",
      href: "",
    });
  }

  return {
    ok: true,
    configured: Boolean(configured),
    generatedAt,
    page: { id: page.id, route: page.route, title: page.title, description: page.description },
    metrics: [
      { label: "可分析记录", value: safeRecords.length, tone: safeRecords.length ? "neutral" : "muted" },
      { label: "待关注状态", value: issueRecords.length, tone: issueRecords.length ? "warning" : "success" },
      ...(Array.isArray(metrics) ? metrics : []),
    ].slice(0, 6),
    insights: normalizedInsights.slice(0, 8),
    sources: normalizedSources,
    records: safeRecords,
    prompts: unique(page.prompts || []).slice(0, 5),
    actions: (page.actions || []).slice(0, 4),
    capabilities: ["页面数据诊断", "业务数据解释", "问题定位与处理建议", "生成操作步骤与工作草案"],
    safety: { readOnly: true, noBackgroundSync: true, dataScopeApplied: true, conversationPersisted: false },
  };
}

export function normalizeAgentChatMessages(messages) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .slice(-MAX_CHAT_MESSAGES)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: text(message?.content, 4000),
    }))
    .filter((message) => message.content);
  if (!normalized.length || normalized.at(-1)?.role !== "user") throw new Error("请输入希望领航员分析的问题。");
  return normalized;
}

export function buildAgentSystemPrompt(context) {
  const modelContext = {
    page: context.page,
    generatedAt: context.generatedAt,
    metrics: context.metrics,
    insights: context.insights,
    sources: context.sources,
    records: context.records,
  };
  return [
    "你是同舟供应链数智化系统中的‘同舟领航员’，服务运营、管理和仓库协作人员。默认使用简洁、自然的中文。",
    "你只能依据系统提供的权限过滤后上下文作答，不得声称看到了上下文之外的数据，不得猜测缺失的数字、订单状态、成本、资质或责任归属。",
    "回答数据问题时先给结论，再列证据、影响和下一步；明确区分事实、推断和建议，并注明数据时间。",
    "当前版本是只读助手。遇到修改、删除、同步、推送、完结、导入、调价或权限调整请求，只能生成操作草案并引导用户前往相应页面确认，不得声称已执行。",
    "不要输出密钥、令牌、Webhook、仓库凭证、密码或其他认证秘密。不要复述与问题无关的个人收件信息。",
    `【本轮权限内上下文】\n${JSON.stringify(modelContext)}`,
  ].join("\n\n");
}

export function publicAgentContext(context) {
  const { records: _records, ...safe } = context;
  return safe;
}

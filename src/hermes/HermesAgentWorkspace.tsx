import React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  FileSearch,
  Filter,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  OctagonX,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  UserRound,
  X,
} from "lucide-react";
import type { AuthUser } from "../api";
import AgentMarkdown from "../AgentMarkdown";
import { consumeHermesHandoff } from "./handoff";
import {
  createHermesConversation,
  decideHermesApproval,
  fetchHermesCases,
  fetchHermesConversations,
  fetchHermesMessages,
  fetchHermesModelConfig,
  fetchHermesPartnerConfig,
  fetchHermesStatus,
  saveHermesModelConfig,
  saveHermesPartnerConfig,
  startHermesRun,
  stopHermesRun,
  streamHermesRunEvents,
  testHermesModelConfig,
  testHermesPartnerAsr,
  type HermesActionPreview,
  type HermesCase,
  type HermesContext,
  type HermesConversation,
  type HermesEvidenceRef,
  type HermesEvent,
  type HermesMessage,
  type HermesModelConfig,
  type HermesPartnerConfig,
  type HermesPartnerOrganization,
  type HermesRun,
  type HermesStatus,
} from "./hermes-api";
import "./hermes-workspace.css";

type Props = { currentUser: AuthUser };
type ToolActivity = { toolCallId: string; tool: string; label: string; status: "running" | "done"; summary?: string; evidence: HermesEvidenceRef[] };
type PendingApproval = { runId: string; toolCallId: string; preview: HermesActionPreview };

const severityLabel = { critical: "严重", high: "高", medium: "中", low: "低" };
const statusLabel: Record<string, string> = { open: "未处理", investigating: "调查中", action_pending: "待动作", resolved: "已解决", dismissed: "已驳回" };

function timeLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

const organizationTypeLabel: Record<string, string> = {
  production_factory: "生产加工厂",
  packaging_factory: "包材厂",
  material_supplier: "原料供应商",
  warehouse: "协同仓库",
  logistics_provider: "物流服务商",
};

function runtimeView(status: HermesStatus | null) {
  if (!status) return { tone: "loading", title: "状态检查中", hint: "", canRetry: false };
  if (status.enabled === false) return { tone: "disabled", title: "运行时未启用", hint: "服务器未开启 Hermes（HERMES_AGENT_ENABLED），请联系系统管理员。", canRetry: true };
  if (status.modelConfigured === false) return { tone: "configuration_required", title: "DeepSeek 未配置", hint: "", canRetry: false };
  if (status.ready) return { tone: "ready", title: "Hermes 就绪", hint: "", canRetry: false };
  if (status.status === "incompatible") return { tone: "unavailable", title: "运行时版本不兼容", hint: `Hermes 容器缺少能力：${(status.missingCapabilities || []).join("、") || "未知"}，请按 integrations/hermes/README.md 更新镜像。`, canRetry: true };
  return { tone: "unavailable", title: "运行时连不上", hint: "同舟服务连不上 Hermes 容器（8642 端口）。请确认容器在运行，修好后点“重新检查”。", canRetry: true };
}

function navigate(href?: string) {
  if (href?.startsWith("#")) window.location.hash = href;
}

function defaultPrompt(context: HermesContext) {
  const labels: Record<string, string> = {
    "#inventory": "检查当前仓库同步状态，找出失败或过期的数据源。",
    "#movement": "分析当前动销与库存风险，按影响程度给出处理建议。",
    "#stockup": "检查当前备货需求异常，并给出优先处理顺序。",
    "#stockup-execution": "核对备货执行进度，找出逾期任务并分析原因。",
    "#production": "核对生产时间线和物料齐套情况，识别交期风险。",
  };
  return labels[context.route] || "请检查当前业务异常，给出证据、影响和下一步建议。";
}

export function HermesAgentWorkspace({ currentUser }: Props) {
  const handoffRef = React.useRef(consumeHermesHandoff());
  const initialContext = handoffRef.current?.context || { route: "#hermes-agent" };
  const [status, setStatus] = React.useState<HermesStatus | null>(null);
  const [conversations, setConversations] = React.useState<HermesConversation[]>([]);
  const [conversationId, setConversationId] = React.useState("");
  const [messages, setMessages] = React.useState<HermesMessage[]>([]);
  const [cases, setCases] = React.useState<HermesCase[]>([]);
  const [selectedCase, setSelectedCase] = React.useState<HermesCase | null>(null);
  const [caseStatus, setCaseStatus] = React.useState("open");
  const [caseSeverity, setCaseSeverity] = React.useState("");
  const [input, setInput] = React.useState(handoffRef.current?.prompt || defaultPrompt(initialContext));
  const [context, setContext] = React.useState<HermesContext>(initialContext);
  const [run, setRun] = React.useState<HermesRun | null>(null);
  const [streamText, setStreamText] = React.useState("");
  const [activities, setActivities] = React.useState<ToolActivity[]>([]);
  const [approvals, setApprovals] = React.useState<PendingApproval[]>([]);
  const [approvalPassword, setApprovalPassword] = React.useState("");
  const [busyApproval, setBusyApproval] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [modelConfig, setModelConfig] = React.useState<HermesModelConfig | null>(null);
  const [showModelConfig, setShowModelConfig] = React.useState(false);
  const [modelDraft, setModelDraft] = React.useState("deepseek-v4-pro");
  const [modelApiKey, setModelApiKey] = React.useState("");
  const [modelBusy, setModelBusy] = React.useState<"test" | "save" | "">("");
  const [modelMessage, setModelMessage] = React.useState("");
  const [modelError, setModelError] = React.useState("");
  const [partnerConfig, setPartnerConfig] = React.useState<HermesPartnerConfig | null>(null);
  const [partnerOrganizations, setPartnerOrganizations] = React.useState<HermesPartnerOrganization[]>([]);
  const [showPartnerConfig, setShowPartnerConfig] = React.useState(false);
  const [partnerDraft, setPartnerDraft] = React.useState<HermesPartnerConfig | null>(null);
  const [partnerSecretId, setPartnerSecretId] = React.useState("");
  const [partnerSecretKey, setPartnerSecretKey] = React.useState("");
  const [partnerBusy, setPartnerBusy] = React.useState<"load" | "test" | "save" | "">("");
  const [partnerMessage, setPartnerMessage] = React.useState("");
  const [partnerError, setPartnerError] = React.useState("");
  const [mobilePanel, setMobilePanel] = React.useState<"cases" | "chat" | "evidence">("chat");
  const [statusChecking, setStatusChecking] = React.useState(false);
  const [partnerQuery, setPartnerQuery] = React.useState("");
  const streamAbortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const activeConversation = conversations.find((item) => item.id === conversationId) || null;
  const approval = approvals[0] || null;
  const running = Boolean(run && ["queued", "running", "waiting_for_approval", "stopping"].includes(run.status));
  const canConfigureModel = currentUser.role === "admin" && currentUser.permissions?.includes("hermes_agent_admin");
  const runtime = runtimeView(status);
  const canSend = Boolean(status?.enabled && status.ready !== false && status.modelConfigured !== false);
  const sendBlockedReason = !status ? "正在检查 Hermes 状态…"
    : status.modelConfigured === false ? "请先配置 DeepSeek API Key"
    : !canSend ? `${runtime.title}，暂时不能发送`
    : "";
  const partnerSummary = React.useMemo(() => {
    const config = partnerConfig;
    if (!config) return null;
    const quick = config.quickReportOrganizationIds.length;
    if (!config.enabled) return { on: false, text: "未开启", detail: "总开关关闭：所有伙伴在小程序上都看不到 Hermes，只能手动填写。" };
    if (!config.textEnabled && !config.voiceEnabled) return { on: false, text: "未开启", detail: "文字和语音助手都关闭了，伙伴端没有可用的 Hermes 功能。" };
    if (!config.textEnabled) return { on: true, text: "仅语音", detail: "文字助手关闭时快捷汇报不会生效，伙伴小程序首页不会出现 Hermes 输入框。" };
    if (!quick) return { on: true, text: "仅任务内", detail: "还没有组织开通“快捷汇报”，伙伴小程序首页不会出现 Hermes 输入框。" };
    return { on: true, text: `${quick} 家开通`, detail: `已对 ${quick} 家组织开通快捷汇报${config.voiceEnabled && !config.asr.configured ? "；语音需要先填写腾讯云密钥" : ""}。` };
  }, [partnerConfig]);
  const evidence = React.useMemo(() => {
    const refs = [...(selectedCase?.evidence || []), ...activities.flatMap((item) => item.evidence || []), ...messages.flatMap((item) => item.evidence || [])];
    const seen = new Set<string>();
    return refs.filter((item) => {
      const key = `${item.type || ""}:${item.id || ""}:${item.href || ""}:${item.label || item.title || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activities, messages, selectedCase]);

  const loadCases = React.useCallback(async (signal?: AbortSignal) => {
    const result = await fetchHermesCases({ status: caseStatus, severity: caseSeverity }, signal);
    setCases(result.cases);
    setSelectedCase((current) => current ? result.cases.find((item) => item.id === current.id) || null : null);
  }, [caseSeverity, caseStatus]);

  const loadMessages = React.useCallback(async (id: string, signal?: AbortSignal) => {
    const result = await fetchHermesMessages(id, signal);
    setMessages(result.messages);
  }, []);

  const loadModelConfig = React.useCallback(async (signal?: AbortSignal) => {
    if (!canConfigureModel) return;
    const result = await fetchHermesModelConfig(signal);
    setModelConfig(result.config);
    setModelDraft(result.config.model);
  }, [canConfigureModel]);

  const loadPartnerConfig = React.useCallback(async (signal?: AbortSignal) => {
    if (!canConfigureModel) return;
    const result = await fetchHermesPartnerConfig(signal);
    setPartnerConfig(result.config);
    setPartnerDraft(result.config);
    setPartnerOrganizations(result.organizations || []);
  }, [canConfigureModel]);

  const loadWorkspace = React.useCallback(async (signal?: AbortSignal) => {
    setError("");
    const [statusResult, conversationResult] = await Promise.all([
      fetchHermesStatus(signal),
      fetchHermesConversations(signal),
    ]);
    setStatus(statusResult);
    setConversations(conversationResult.conversations);
    const activeRun = conversationResult.activeRun || null;
    const preferred = (activeRun ? conversationResult.conversations.find((item) => item.id === activeRun.conversationId) : null)
      || conversationResult.conversations.find((item) => item.context?.route === initialContext.route)
      || conversationResult.conversations[0];
    if (preferred) {
      setConversationId((current) => current || preferred.id);
      if (!conversationId) await loadMessages(preferred.id, signal);
    }
    if (activeRun && !streamAbortRef.current) {
      setRun(activeRun);
      void followRun(activeRun);
    }
  }, [conversationId, initialContext.route, loadMessages]);

  React.useEffect(() => {
    const controller = new AbortController();
    loadWorkspace(controller.signal)
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载工作台失败"); });
    return () => controller.abort();
    // Load conversations and runtime status once; changing case filters must not refetch them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadCases(controller.signal)
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载异常台账失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadCases]);

  React.useEffect(() => {
    if (!canConfigureModel) return;
    const controller = new AbortController();
    void loadModelConfig(controller.signal).catch((caught) => {
      if (!controller.signal.aborted) setModelError(caught instanceof Error ? caught.message : "读取模型配置失败");
    });
    return () => controller.abort();
  }, [canConfigureModel, loadModelConfig]);

  React.useEffect(() => {
    if (!canConfigureModel) return;
    const controller = new AbortController();
    void loadPartnerConfig(controller.signal).catch((caught) => {
      if (!controller.signal.aborted) setPartnerError(caught instanceof Error ? caught.message : "读取伙伴助手配置失败");
    });
    return () => controller.abort();
  }, [canConfigureModel, loadPartnerConfig]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, streamText, activities, approvals]);

  React.useEffect(() => () => {
    const controller = streamAbortRef.current;
    controller?.abort();
    if (streamAbortRef.current === controller) streamAbortRef.current = null;
  }, []);

  async function refreshStatus() {
    if (statusChecking) return;
    setStatusChecking(true);
    try {
      setStatus(await fetchHermesStatus());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "检查 Hermes 状态失败");
    } finally {
      setStatusChecking(false);
    }
  }

  async function selectConversation(id: string) {
    if (running || id === conversationId) return;
    setConversationId(id);
    setActivities([]);
    setStreamText("");
    setApprovals([]);
    setError("");
    try { await loadMessages(id); } catch (caught) { setError(caught instanceof Error ? caught.message : "读取会话失败"); }
  }

  async function newConversation() {
    if (running) return;
    setError("");
    try {
      const result = await createHermesConversation({ title: "新会话", context });
      setConversations((current) => [result.conversation, ...current]);
      setConversationId(result.conversation.id);
      setMessages([]);
      setActivities([]);
      setStreamText("");
      setApprovals([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建会话失败");
    }
  }

  function applyEvent(event: HermesEvent) {
    if (event.type === "assistant.delta") {
      setStreamText((current) => current + event.text);
      return;
    }
    if (event.type === "tool.started") {
      setActivities((current) => [...current.filter((item) => item.toolCallId !== event.toolCallId), { ...event, status: "running", evidence: [] }]);
      return;
    }
    if (event.type === "tool.completed") {
      setActivities((current) => {
        const found = current.some((item) => item.toolCallId === event.toolCallId);
        if (!found) return [...current, { toolCallId: event.toolCallId, tool: "", label: event.summary, status: "done", summary: event.summary, evidence: event.evidence || [] }];
        return current.map((item) => item.toolCallId === event.toolCallId ? { ...item, status: "done", summary: event.summary, evidence: event.evidence || [] } : item);
      });
      return;
    }
    if (event.type === "approval.required") {
      setApprovals((current) => current.some((item) => item.toolCallId === event.toolCallId) ? current : [...current, event]);
      setRun((current) => current ? { ...current, status: "waiting_for_approval" } : current);
      return;
    }
    if (event.type === "run.failed" || event.type === "run.cancelled") {
      setError(event.message);
      setApprovals([]);
      setRun((current) => current ? { ...current, status: event.type === "run.failed" ? "failed" : "cancelled" } : current);
    }
  }

  async function followRun(nextRun: HermesRun) {
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    let after = 0;
    let retries = 0;
    let terminal = false;
    while (!terminal && !controller.signal.aborted) {
      try {
        for await (const frame of streamHermesRunEvents(nextRun.id, { after, signal: controller.signal })) {
          after = Math.max(after, frame.id);
          applyEvent(frame.event);
          if (["run.completed", "run.failed", "run.cancelled"].includes(frame.event.type)) {
            terminal = true;
            if (frame.event.type === "run.completed") {
              await loadMessages(nextRun.conversationId);
              setStreamText("");
              setApprovals([]);
              setRun((current) => current ? { ...current, status: "completed" } : current);
              await loadCases();
            }
            break;
          }
        }
        if (!terminal) throw new Error("事件流意外中断。");
      } catch (caught) {
        if (controller.signal.aborted) {
          if (streamAbortRef.current === controller) streamAbortRef.current = null;
          return;
        }
        retries += 1;
        if (retries > 3) {
          setError(caught instanceof Error ? caught.message : "运行事件连接失败");
          setRun((current) => current ? { ...current, status: "failed" } : current);
          if (streamAbortRef.current === controller) streamAbortRef.current = null;
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500 * retries));
      }
    }
    if (streamAbortRef.current === controller) streamAbortRef.current = null;
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || running || !canSend) return;
    setError("");
    setApprovals([]);
    setActivities([]);
    setStreamText("");
    let optimisticId = "";
    try {
      let id = conversationId;
      if (!id) {
        const created = await createHermesConversation({ title: prompt.slice(0, 36), context });
        id = created.conversation.id;
        setConversationId(id);
        setConversations((current) => [created.conversation, ...current]);
      }
      optimisticId = `local-${Date.now()}`;
      const optimistic: HermesMessage = { id: optimisticId, conversationId: id, role: "user", content: prompt, evidence: [], createdAt: new Date().toISOString() };
      setMessages((current) => [...current, optimistic]);
      setInput("");
      const result = await startHermesRun(id, { input: prompt, context });
      setRun(result.run);
      void followRun(result.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发起智能体运行失败");
      setRun(null);
      // The run never started: give the question back so the user doesn't have to retype it.
      if (optimisticId) setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setInput((current) => current || prompt);
    }
  }

  async function decide(choice: "once" | "deny") {
    if (!approval || busyApproval) return;
    if (choice === "once" && !approvalPassword) {
      setError("批准业务动作前请输入当前账号密码。");
      return;
    }
    setBusyApproval(true);
    setError("");
    try {
      await decideHermesApproval(approval.runId, { toolCallId: approval.toolCallId, choice, reauthPassword: choice === "once" ? approvalPassword : undefined });
      setApprovals((current) => current.filter((item) => item.toolCallId !== approval.toolCallId));
      setApprovalPassword("");
      setRun((current) => current ? { ...current, status: choice === "once" ? "running" : current.status } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交审批失败");
    } finally {
      setBusyApproval(false);
    }
  }

  async function stop() {
    if (!run || !running) return;
    try {
      await stopHermesRun(run.id);
      setRun({ ...run, status: "stopping" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "停止运行失败");
    }
  }

  function openModelSettings() {
    setModelApiKey("");
    setModelMessage("");
    setModelError("");
    setModelDraft(modelConfig?.model || status?.model || "deepseek-v4-pro");
    setShowModelConfig(true);
  }

  async function testModelConnection() {
    if (modelBusy) return;
    setModelBusy("test");
    setModelMessage("");
    setModelError("");
    try {
      const result = await testHermesModelConfig({ model: modelDraft, ...(modelApiKey.trim() ? { apiKey: modelApiKey.trim() } : {}) });
      setModelMessage(result.message);
    } catch (caught) {
      setModelError(caught instanceof Error ? caught.message : "DeepSeek 连接测试失败");
    } finally {
      setModelBusy("");
    }
  }

  async function saveModelSettings() {
    if (modelBusy || running) return;
    setModelBusy("save");
    setModelMessage("");
    setModelError("");
    try {
      const result = await saveHermesModelConfig({ model: modelDraft, ...(modelApiKey.trim() ? { apiKey: modelApiKey.trim() } : {}) });
      setModelConfig(result.config);
      setModelApiKey("");
      setModelMessage("配置已保存并启用，新的对话将使用 DeepSeek。");
      setStatus(await fetchHermesStatus());
    } catch (caught) {
      setModelError(caught instanceof Error ? caught.message : "保存模型配置失败");
    } finally {
      setModelBusy("");
    }
  }

  async function openPartnerSettings() {
    setPartnerSecretId("");
    setPartnerSecretKey("");
    setPartnerMessage("");
    setPartnerError("");
    setShowPartnerConfig(true);
    if (partnerConfig) {
      setPartnerDraft(partnerConfig);
      return;
    }
    setPartnerBusy("load");
    try {
      await loadPartnerConfig();
    } catch (caught) {
      setPartnerError(caught instanceof Error ? caught.message : "读取伙伴助手配置失败");
    } finally {
      setPartnerBusy("");
    }
  }

  function togglePartnerOrganization(organizationId: string, target: "task" | "quick") {
    setPartnerDraft((current) => {
      if (!current) return current;
      const taskIds = new Set(current.organizationIds);
      const quickIds = new Set(current.quickReportOrganizationIds);
      if (target === "task") {
        if (taskIds.has(organizationId)) {
          taskIds.delete(organizationId);
          quickIds.delete(organizationId);
        } else taskIds.add(organizationId);
      } else if (quickIds.has(organizationId)) quickIds.delete(organizationId);
      else {
        quickIds.add(organizationId);
        taskIds.add(organizationId);
      }
      return { ...current, organizationIds: [...taskIds], quickReportOrganizationIds: [...quickIds] };
    });
  }

  async function testPartnerVoice() {
    if (!partnerDraft || partnerBusy) return;
    setPartnerBusy("test");
    setPartnerMessage("");
    setPartnerError("");
    try {
      const result = await testHermesPartnerAsr({ asr: {
        engine: partnerDraft.asr.engine,
        ...(partnerSecretId.trim() ? { secretId: partnerSecretId.trim() } : {}),
        ...(partnerSecretKey.trim() ? { secretKey: partnerSecretKey.trim() } : {}),
      } });
      setPartnerMessage(result.message);
    } catch (caught) {
      setPartnerError(caught instanceof Error ? caught.message : "腾讯云语音连接测试失败");
    } finally {
      setPartnerBusy("");
    }
  }

  async function savePartnerSettings() {
    if (!partnerDraft || partnerBusy) return;
    setPartnerBusy("save");
    setPartnerMessage("");
    setPartnerError("");
    try {
      const result = await saveHermesPartnerConfig({
        enabled: partnerDraft.enabled,
        textEnabled: partnerDraft.textEnabled,
        voiceEnabled: partnerDraft.voiceEnabled,
        organizationIds: partnerDraft.organizationIds,
        quickReportOrganizationIds: partnerDraft.quickReportOrganizationIds,
        userDailyLimit: Math.min(500, Math.max(1, Math.round(Number(partnerDraft.userDailyLimit) || 30))),
        organizationDailyLimit: Math.min(10000, Math.max(1, Math.round(Number(partnerDraft.organizationDailyLimit) || 300))),
        asr: {
          engine: partnerDraft.asr.engine,
          ...(partnerSecretId.trim() ? { secretId: partnerSecretId.trim() } : {}),
          ...(partnerSecretKey.trim() ? { secretKey: partnerSecretKey.trim() } : {}),
        },
      });
      setPartnerConfig(result.config);
      setPartnerDraft(result.config);
      setPartnerSecretId("");
      setPartnerSecretKey("");
      const saved = result.config;
      setPartnerMessage(!saved.enabled
        ? "已保存。总开关是关闭的，伙伴端暂时看不到 Hermes。"
        : saved.quickReportOrganizationIds.length
          ? `已保存。${saved.quickReportOrganizationIds.length} 家组织重新进入小程序首页后即可使用快捷汇报。`
          : "已保存。还没有组织开通快捷汇报，伙伴只能在任务详情里使用助手。");
    } catch (caught) {
      setPartnerError(caught instanceof Error ? caught.message : "保存伙伴助手配置失败");
    } finally {
      setPartnerBusy("");
    }
  }

  function investigateCase(item: HermesCase) {
    setSelectedCase(item);
    setContext({ route: item.href || "#hermes-agent", selectedRefs: [{ type: "exception_case", id: item.id }] });
    setInput(`请调查「${item.title}」（案例 ${item.id}），核对最新证据、分析影响并给出下一步建议。`);
    setMobilePanel("chat");
  }

  return (
    <section className={`hermes-workspace mobile-${mobilePanel}`}>
      <header className="hermes-workspace-hero">
        <div className={`hermes-hero-mark is-${runtime.tone}`}><Bot size={24} /><i /></div>
        <div><span>HERMES BUSINESS AGENT</span><h2>同舟智能体工作台</h2><p>围绕库存、备货和生产异常，由 Hermes 调用业务工具查证、归因并推动闭环。</p></div>
        <div className="hermes-hero-actions">
          <div className={`hermes-runtime-state is-${runtime.tone}`}>
            {runtime.tone === "ready" ? <CheckCircle2 size={16} /> : runtime.tone === "disabled" ? <OctagonX size={16} /> : runtime.tone === "configuration_required" ? <KeyRound size={16} /> : runtime.tone === "unavailable" ? <AlertTriangle size={16} /> : <LoaderCircle size={16} className="spinning" />}
            <span><b>{runtime.title}</b><small>{status?.model || "模型未配置"}</small></span>
            {runtime.canRetry ? <button type="button" onClick={() => void refreshStatus()} disabled={statusChecking} title="重新检查 Hermes 状态"><RefreshCw size={13} className={statusChecking ? "spinning" : ""} />重新检查</button> : null}
          </div>
          {canConfigureModel ? <button className="hermes-model-settings-button" type="button" onClick={openModelSettings}><Settings2 size={15} />模型配置</button> : null}
          {canConfigureModel ? <button className="hermes-model-settings-button" type="button" onClick={() => void openPartnerSettings()} title={partnerSummary?.detail}><MessageSquareText size={15} />伙伴 Hermes{partnerSummary ? <em className={partnerSummary.on ? "is-on" : "is-off"}>{partnerSummary.text}</em> : null}</button> : null}
        </div>
      </header>

      <nav className="hermes-mobile-tabs" aria-label="工作台面板">
        <button className={mobilePanel === "cases" ? "active" : ""} onClick={() => setMobilePanel("cases")}><AlertTriangle size={15} />异常</button>
        <button className={mobilePanel === "chat" ? "active" : ""} onClick={() => setMobilePanel("chat")}><MessageSquareText size={15} />会话</button>
        <button className={mobilePanel === "evidence" ? "active" : ""} onClick={() => setMobilePanel("evidence")}><PanelRight size={15} />证据</button>
      </nav>

      <div className="hermes-grid">
        <aside className="hermes-left-panel">
          <div className="hermes-panel-heading"><div><span>EXCEPTIONS</span><strong>异常台账</strong></div><button onClick={() => void loadCases()} title="刷新异常"><RefreshCw size={15} /></button></div>
          <div className="hermes-case-filters">
            <label><Filter size={14} /><select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)}><option value="open">未处理</option><option value="investigating">调查中</option><option value="action_pending">待动作</option><option value="resolved">已解决</option><option value="">全部状态</option></select></label>
            <select aria-label="严重度" value={caseSeverity} onChange={(event) => setCaseSeverity(event.target.value)}><option value="">全部等级</option><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select>
          </div>
          <div className="hermes-case-list">
            {cases.map((item) => <button key={item.id} className={selectedCase?.id === item.id ? "active" : ""} onClick={() => { setSelectedCase(item); setMobilePanel("evidence"); }}>
              <i className={`severity-${item.severity}`} />
              <span><strong>{item.title}</strong><small>{item.sku || item.project || item.resourceId} · {timeLabel(item.lastSeenAt)}</small></span>
              <em>{severityLabel[item.severity]}</em>
            </button>)}
            {!loading && !cases.length ? <div className="hermes-empty"><CheckCircle2 size={22} /><strong>当前没有匹配的异常</strong><span>巡检会持续检查库存、备货和生产数据。</span></div> : null}
          </div>
          <div className="hermes-conversation-heading"><span>个人会话</span><button onClick={() => void newConversation()} disabled={running}><Plus size={14} />新会话</button></div>
          <div className="hermes-conversation-list">
            {conversations.map((item) => <button key={item.id} className={conversationId === item.id ? "active" : ""} onClick={() => void selectConversation(item.id)} disabled={running && conversationId !== item.id}><MessageSquareText size={14} /><span><strong>{item.title}</strong><small>{timeLabel(item.updatedAt)}</small></span></button>)}
          </div>
        </aside>

        <main className="hermes-chat-panel">
          <header className="hermes-chat-header">
            <div><span>{activeConversation?.title || "新会话"}</span><small><ShieldCheck size={13} />只读查询自动执行，写操作逐次确认</small></div>
            {running ? <button onClick={() => void stop()}><Square size={13} />停止</button> : null}
          </header>
          <div className="hermes-messages" aria-live="polite">
            {status?.modelConfigured === false ? <div className="hermes-model-required"><KeyRound size={18} /><div><strong>需要先配置 DeepSeek</strong><span>{canConfigureModel ? "点击右上角“模型配置”，填写你自己的 DeepSeek API Key 后即可真实对话。" : "请联系系统管理员配置 DeepSeek API Key。"}</span></div>{canConfigureModel ? <button type="button" onClick={openModelSettings}>立即配置</button> : null}</div> : null}
            {!messages.length && !streamText && !running ? <div className="hermes-welcome"><span><FileSearch size={24} /></span><h3>{currentUser.displayName || currentUser.username || "你好"}，今天要处理什么？</h3><p>我会重新读取权限范围内的真实业务数据，给出证据、影响和建议；任何写操作都会在执行前请你确认。</p><div><button onClick={() => setInput("列出当前最严重的库存、备货和生产异常，并按影响排序。")}>查看严重异常</button><button onClick={() => setInput("检查逾期备货和生产任务，说明原因与下一步。")}>检查逾期任务</button></div></div> : null}
            {messages.map((message) => <article key={message.id} className={`hermes-message ${message.role}`}>
              <i>{message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}</i>
              <div>{message.role === "assistant" ? <AgentMarkdown content={message.content} /> : message.content}</div>
            </article>)}
            {running ? activities.map((item) => <article key={item.toolCallId} className={`hermes-tool-activity is-${item.status}`}><i>{item.status === "done" ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className="spinning" />}</i><span><strong>{item.label}</strong><small>{item.summary || (item.status === "running" ? "正在从业务系统读取和核对数据…" : "已完成")}</small></span></article>) : null}
            {streamText ? <article className={`hermes-message assistant${running ? " streaming" : " interrupted"}`}><i><Bot size={16} /></i><div><AgentMarkdown content={streamText} />{running ? <span className="hermes-caret" /> : <small className="hermes-interrupted-note">回答没有完成，可以点“发送”让 Hermes 继续。</small>}</div></article> : null}
            {running && !streamText && !approval && !activities.some((item) => item.status === "running") ? <div className="hermes-thinking"><LoaderCircle size={16} className="spinning" />Hermes 正在分析业务数据…</div> : null}
            {approval ? <section className="hermes-inline-approval"><header><ShieldCheck size={18} /><div><span>业务动作需要确认{approvals.length > 1 ? ` · 另有 ${approvals.length - 1} 项待确认` : ""}</span><strong>{approval.preview.title}</strong></div></header><p>{approval.preview.summary}</p><ul>{approval.preview.effects?.map((item) => <li key={item}>{item}</li>)}</ul><div>{approval.preview.warnings?.map((item) => <small key={item}><AlertTriangle size={13} />{item}</small>)}</div><label className="hermes-reauth"><span>当前账号密码</span><input type="password" autoComplete="current-password" value={approvalPassword} onChange={(event) => setApprovalPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && approvalPassword) { event.preventDefault(); void decide("once"); } }} disabled={busyApproval} placeholder="输入密码后按回车即可批准" /></label><footer><button className="deny" onClick={() => void decide("deny")} disabled={busyApproval}><X size={14} />拒绝</button><button className="approve" onClick={() => void decide("once")} disabled={busyApproval || !approvalPassword}>{busyApproval ? <LoaderCircle size={14} className="spinning" /> : <Play size={14} />}仅本次允许</button></footer></section> : null}
            {error ? <div className="hermes-error"><AlertTriangle size={16} /><span>{error}</span></div> : null}
            <div ref={endRef} />
          </div>
          <form className="hermes-composer" onSubmit={submit}>
            {context.route !== "#hermes-agent" ? <div className="hermes-context-chip"><Database size={13} /><span>来自 {context.route}</span><button type="button" onClick={() => setContext({ route: "#hermes-agent" })}><X size={12} /></button></div> : null}
            {status && !canSend && status.modelConfigured !== false ? <div className="hermes-composer-blocked"><AlertTriangle size={14} /><span><strong>{runtime.title}，消息暂时发不出去</strong>{runtime.hint}</span>{runtime.canRetry ? <button type="button" onClick={() => void refreshStatus()} disabled={statusChecking}><RefreshCw size={13} className={statusChecking ? "spinning" : ""} />重新检查</button> : null}</div> : null}
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} disabled={running || !canSend} rows={3} placeholder={sendBlockedReason || "询问异常、原因、影响或下一步…（回车发送，Shift+回车换行）"} />
            <button type="submit" disabled={!input.trim() || running || !canSend} aria-label="发送" title={sendBlockedReason || "发送"}><Send size={18} /></button>
            <small><ShieldCheck size={12} />所有业务写操作都需要你逐次确认</small>
          </form>
        </main>

        <aside className="hermes-right-panel">
          <div className="hermes-panel-heading"><div><span>EVIDENCE</span><strong>证据与动作</strong></div><Database size={17} /></div>
          {selectedCase ? <section className="hermes-case-detail"><header><span className={`severity severity-${selectedCase.severity}`}>{severityLabel[selectedCase.severity]}</span><em>{statusLabel[selectedCase.status] || selectedCase.status}</em></header><h3>{selectedCase.title}</h3><p>{selectedCase.summary}</p><dl><div><dt>规则</dt><dd>{selectedCase.ruleCode}</dd></div><div><dt>业务对象</dt><dd>{selectedCase.sku || selectedCase.resourceId}</dd></div><div><dt>责任人</dt><dd>{selectedCase.assigneeName || "未分派"}</dd></div><div><dt>来源更新</dt><dd>{timeLabel(selectedCase.sourceUpdatedAt)}</dd></div></dl><footer><button onClick={() => investigateCase(selectedCase)}><Bot size={15} />交给智能体调查</button>{selectedCase.href ? <button onClick={() => navigate(selectedCase.href)}><ArrowUpRight size={15} />打开业务页</button> : null}</footer></section> : <div className="hermes-evidence-placeholder"><CircleDot size={22} /><strong>选择异常或开始会话</strong><span>这里会展示证据、来源更新时间、审批预览和执行结果。</span></div>}
          {approval ? <section className="hermes-side-approval"><span>待审批动作</span><strong>{approval.preview.title}</strong><p>{approval.preview.summary}</p>{approval.preview.target?.href ? <button onClick={() => navigate(approval.preview.target?.href)}>查看目标<ChevronRight size={14} /></button> : null}</section> : null}
          <div className="hermes-evidence-list">
            {evidence.map((item, index) => <button key={`${item.type}-${item.id}-${index}`} disabled={!item.href} onClick={() => navigate(item.href)}><i><Database size={14} /></i><span><strong>{item.label || item.title || item.id || item.type || "业务证据"}</strong><small>{item.type || "业务来源"} · {timeLabel(item.sourceUpdatedAt || item.updatedAt)}</small></span>{item.href ? <ArrowUpRight size={14} /> : null}</button>)}
          </div>
          <section className="hermes-patrol-card"><Clock3 size={17} /><div><strong>确定性异常巡检</strong><span>{status?.patrol?.lastRunAt ? `最近运行 ${timeLabel(status.patrol.lastRunAt)}` : status?.patrol?.enabled ? "等待首次巡检" : "巡检当前未启用"}</span>{status?.patrol?.lastError ? <small>{status.patrol.lastError}</small> : null}</div></section>
          {status?.metrics ? <section className="hermes-metrics-card"><header><span>近 {status.metrics.periodDays} 天成功率</span><strong>{Math.round(status.metrics.runs.successRate * 100)}%</strong></header><dl><div><dt>运行 / 失败</dt><dd>{status.metrics.runs.total} / {status.metrics.runs.failed}</dd></div><div><dt>工具完成</dt><dd>{status.metrics.tools.completed}</dd></div><div><dt>批准 / 拒绝</dt><dd>{status.metrics.approvals.approved} / {status.metrics.approvals.denied}</dd></div><div><dt>活动异常</dt><dd>{status.metrics.cases.active}</dd></div><div><dt>Token</dt><dd>{(status.metrics.usage.inputTokens + status.metrics.usage.outputTokens).toLocaleString()}</dd></div><div><dt>费用</dt><dd>${status.metrics.usage.costUsd.toFixed(3)}</dd></div></dl></section> : null}
        </aside>
      </div>
      {showModelConfig ? <div className="hermes-model-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !modelBusy) setShowModelConfig(false); }}>
        <section className="hermes-model-modal" role="dialog" aria-modal="true" aria-labelledby="hermes-model-title">
          <header><div><span>MODEL RUNTIME</span><h3 id="hermes-model-title">DeepSeek 模型配置</h3><p>直接调用 DeepSeek 官方 API；Key 仅加密保存在同舟服务端。</p></div><button type="button" aria-label="关闭" onClick={() => setShowModelConfig(false)} disabled={Boolean(modelBusy)}><X size={17} /></button></header>
          <div className="hermes-model-provider"><i><KeyRound size={18} /></i><div><strong>{modelConfig?.providerLabel || "DeepSeek 官方 API"}</strong><span>{modelConfig?.baseUrl || "https://api.deepseek.com"}</span></div><em className={modelConfig?.configured ? "configured" : ""}>{modelConfig?.configured ? "已配置" : "未配置"}</em></div>
          <label><span>模型</span><select value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} disabled={Boolean(modelBusy)}>{(modelConfig?.models || [{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "复杂业务分析与多工具任务（推荐）" }, { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "响应更快、成本更低" }]).map((item) => <option value={item.id} key={item.id}>{item.label} · {item.description}</option>)}</select></label>
          <label><span>DeepSeek API Key</span><input type="password" autoComplete="new-password" value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} disabled={Boolean(modelBusy)} placeholder={modelConfig?.configured ? `留空则继续使用 ${modelConfig.apiKeyMasked}` : "sk-..."} /><small>{modelConfig?.configured ? "不修改 Key 时保持为空；填写新 Key 会安全替换旧值。" : "请在 DeepSeek 开放平台创建 API Key 后填入。"}</small></label>
          {modelMessage ? <div className="hermes-model-result success"><CheckCircle2 size={15} />{modelMessage}</div> : null}
          {modelError ? <div className="hermes-model-result error"><AlertTriangle size={15} />{modelError}</div> : null}
          <footer><button type="button" className="secondary" onClick={() => void testModelConnection()} disabled={Boolean(modelBusy) || (!modelApiKey.trim() && !modelConfig?.configured)}>{modelBusy === "test" ? <LoaderCircle size={14} className="spinning" /> : <RefreshCw size={14} />}测试连接</button><button type="button" className="primary" onClick={() => void saveModelSettings()} disabled={Boolean(modelBusy) || running || Boolean(status?.activeRuns) || (!modelApiKey.trim() && !modelConfig?.configured)}>{modelBusy === "save" ? <LoaderCircle size={14} className="spinning" /> : <ShieldCheck size={14} />}保存并启用</button></footer>
          {running || Boolean(status?.activeRuns) ? <small className="hermes-model-running-note">当前有智能体任务运行中，结束后才能切换模型配置。</small> : null}
        </section>
      </div> : null}
      {showPartnerConfig ? <div className="hermes-model-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !partnerBusy) setShowPartnerConfig(false); }}>
        <section className="hermes-model-modal hermes-partner-modal" role="dialog" aria-modal="true" aria-labelledby="hermes-partner-title">
          <header><div><span>PARTNER ASSISTANT</span><h3 id="hermes-partner-title">伙伴 Hermes 配置</h3><p>任务内助手与工作台快捷汇报分别授权；未勾选试点组织时，快捷入口保持隐藏。</p></div><button type="button" aria-label="关闭" onClick={() => setShowPartnerConfig(false)} disabled={Boolean(partnerBusy)}><X size={17} /></button></header>
          {partnerDraft ? <>
            {(() => {
              const quick = partnerDraft.quickReportOrganizationIds.length;
              const tone = !partnerDraft.enabled || (!partnerDraft.textEnabled && !partnerDraft.voiceEnabled) ? "off" : quick && partnerDraft.textEnabled ? "on" : "partial";
              const text = tone === "off" ? "伙伴端现在看不到 Hermes。要让伙伴用上：打开“启用伙伴 Hermes”，再给加工厂勾上“快捷汇报”，最后保存。"
                : !partnerDraft.textEnabled ? "快捷汇报依赖“文字助手”，请把它打开，否则小程序首页不会出现 Hermes 输入框。"
                : tone === "partial" ? "伙伴只能在任务详情里用助手。给加工厂勾上“快捷汇报”，小程序首页才会出现 Hermes 输入框。"
                : `已对 ${quick} 家组织开通快捷汇报，保存后伙伴重新进入小程序首页即可使用。`;
              return <div className={`hermes-partner-readiness is-${tone}`}>{tone === "on" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span>{text}{partnerDraft.voiceEnabled && !partnerDraft.asr.configured && !partnerSecretId.trim() ? " 语音助手还需要填写下方腾讯云密钥。" : ""}</span></div>;
            })()}
            <div className="hermes-partner-switches">
              <label><input type="checkbox" checked={partnerDraft.enabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, enabled: event.target.checked })} /><span><strong>启用伙伴 Hermes</strong><small>总开关；关闭不影响原手工表单</small></span></label>
              <label><input type="checkbox" checked={partnerDraft.textEnabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, textEnabled: event.target.checked })} /><span><strong>文字助手</strong><small>允许文字识别与逐项追问</small></span></label>
              <label><input type="checkbox" checked={partnerDraft.voiceEnabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, voiceEnabled: event.target.checked })} /><span><strong>语音助手</strong><small>需腾讯云 ASR 配置有效</small></span></label>
            </div>
            <section className="hermes-partner-organizations">
              <header><div><strong>组织授权</strong><small>勾“快捷汇报”会自动同时勾上“任务内助手”；快捷汇报只用于生产加工厂</small></div>{partnerOrganizations.length > 6 ? <input className="hermes-partner-search" type="search" value={partnerQuery} onChange={(event) => setPartnerQuery(event.target.value)} placeholder="搜索组织名称或编码" /> : null}<span>{partnerDraft.quickReportOrganizationIds.length} 家试点</span></header>
              <div className="hermes-partner-org-head"><span>协同组织</span><span>任务内助手</span><span>快捷汇报</span></div>
              <div className="hermes-partner-org-list">
                {partnerOrganizations.filter((organization) => { const q = partnerQuery.trim().toLowerCase(); return !q || `${organization.name} ${organization.code}`.toLowerCase().includes(q); }).map((organization) => {
                  const quickChecked = partnerDraft.quickReportOrganizationIds.includes(organization.id);
                  const quickAllowed = organization.organizationType === "production_factory";
                  return <label key={organization.id}><span><strong>{organization.name}</strong><small>{organization.code} · {organizationTypeLabel[organization.organizationType] || organization.organizationType}</small></span><input type="checkbox" aria-label={`${organization.name} 任务内助手`} checked={partnerDraft.organizationIds.includes(organization.id)} onChange={() => togglePartnerOrganization(organization.id, "task")} /><input type="checkbox" aria-label={`${organization.name} 快捷汇报`} title={quickAllowed ? "在小程序首页直接说/拍订单进展" : "快捷汇报只支持生产加工厂"} disabled={!quickAllowed && !quickChecked} checked={quickChecked} onChange={() => togglePartnerOrganization(organization.id, "quick")} /></label>;
                })}
                {!partnerOrganizations.length ? <div className="hermes-partner-empty">没有可授权的活动组织。</div> : null}
              </div>
            </section>
            <div className="hermes-partner-limits">
              <label><span>个人每日上限</span><input type="number" min="1" max="500" value={partnerDraft.userDailyLimit} onChange={(event) => setPartnerDraft({ ...partnerDraft, userDailyLimit: Number(event.target.value) })} /></label>
              <label><span>组织每日上限</span><input type="number" min="1" max="10000" value={partnerDraft.organizationDailyLimit} onChange={(event) => setPartnerDraft({ ...partnerDraft, organizationDailyLimit: Number(event.target.value) })} /></label>
              <label><span>语音模型</span><select value={partnerDraft.asr.engine} onChange={(event) => setPartnerDraft({ ...partnerDraft, asr: { ...partnerDraft.asr, engine: event.target.value as HermesPartnerConfig["asr"]["engine"] } })}><option value="16k_zh">普通话 16k</option><option value="16k_zh-PY">中英粤 16k</option><option value="16k_zh_dialect">方言 16k</option></select></label>
            </div>
            <div className="hermes-partner-secrets">
              <label><span>腾讯云 SecretId</span><input type="password" autoComplete="new-password" value={partnerSecretId} onChange={(event) => setPartnerSecretId(event.target.value)} placeholder={partnerDraft.asr.configured ? `留空继续使用 ${partnerDraft.asr.secretIdMasked}` : "AKID..."} /></label>
              <label><span>腾讯云 SecretKey</span><input type="password" autoComplete="new-password" value={partnerSecretKey} onChange={(event) => setPartnerSecretKey(event.target.value)} placeholder={partnerDraft.asr.configured ? "留空保持现有密钥" : "请输入 SecretKey"} /></label>
            </div>
          </> : <div className="hermes-partner-empty"><LoaderCircle size={16} className={partnerBusy ? "spinning" : ""} />正在读取伙伴助手配置…</div>}
          {partnerMessage ? <div className="hermes-model-result success"><CheckCircle2 size={15} />{partnerMessage}</div> : null}
          {partnerError ? <div className="hermes-model-result error"><AlertTriangle size={15} />{partnerError}</div> : null}
          <footer><button type="button" className="secondary" onClick={() => void testPartnerVoice()} disabled={!partnerDraft || Boolean(partnerBusy) || (!partnerSecretId.trim() && !partnerDraft.asr.configured)}>{partnerBusy === "test" ? <LoaderCircle size={14} className="spinning" /> : <RefreshCw size={14} />}测试语音</button><button type="button" className="primary" onClick={() => void savePartnerSettings()} disabled={!partnerDraft || Boolean(partnerBusy)}>{partnerBusy === "save" ? <LoaderCircle size={14} className="spinning" /> : <ShieldCheck size={14} />}保存配置</button></footer>
        </section>
      </div> : null}
    </section>
  );
}

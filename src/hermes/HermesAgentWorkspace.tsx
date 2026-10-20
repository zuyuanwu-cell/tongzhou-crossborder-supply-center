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
  Mic2,
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
  continueHermesRun,
  decideHermesApproval,
  fetchHermesCases,
  fetchHermesCaseDossier,
  fetchHermesConversations,
  fetchHermesMessages,
  fetchHermesModelConfig,
  fetchHermesStatus,
  fetchHermesTodos,
  fetchPartnerProgressConfig,
  saveHermesModelConfig,
  savePartnerProgressConfig,
  startHermesRun,
  stopHermesRun,
  streamHermesRunEvents,
  testHermesModelConfig,
  testPartnerProgressConfig,
  type HermesActionPreview,
  type HermesCase,
  type HermesContext,
  type HermesConversation,
  type HermesDossier,
  type HermesEvidenceRef,
  type HermesEvent,
  type HermesMessage,
  type HermesModelConfig,
  type HermesRun,
  type HermesStatus,
  type HermesTodo,
  type PartnerProgressConfig,
  type PartnerProgressOrganization,
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

function advanceVisiblePlan(run: HermesRun | null, phase: "tool.started" | "tool.completed" | "completed") {
  if (!run?.plan?.steps) return run;
  const steps = run.plan.steps.map((step) => ({ ...step }));
  const setStatus = (id: string, status: typeof steps[number]["status"]) => {
    const step = steps.find((item) => item.id === id);
    if (step) step.status = status;
  };
  if (phase === "tool.started") setStatus("collect", "in_progress");
  if (phase === "tool.completed") {
    setStatus("collect", "completed");
    setStatus("verify", "in_progress");
  }
  if (phase === "completed") steps.forEach((step) => { step.status = "completed"; });
  return { ...run, plan: { ...run.plan, steps } };
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
  const [todos, setTodos] = React.useState<HermesTodo[]>([]);
  const [dossier, setDossier] = React.useState<HermesDossier | null>(null);
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
  const [partnerConfig, setPartnerConfig] = React.useState<PartnerProgressConfig | null>(null);
  const [partnerOrganizations, setPartnerOrganizations] = React.useState<PartnerProgressOrganization[]>([]);
  const [showPartnerConfig, setShowPartnerConfig] = React.useState(false);
  const [partnerDraft, setPartnerDraft] = React.useState({ enabled: false, textEnabled: true, voiceEnabled: false, organizationIds: [] as string[], userDailyLimit: 30, organizationDailyLimit: 120, engine: "16k_zh", secretId: "", secretKey: "" });
  const [partnerBusy, setPartnerBusy] = React.useState<"load" | "test" | "save" | "">("");
  const [partnerMessage, setPartnerMessage] = React.useState("");
  const [partnerError, setPartnerError] = React.useState("");
  const [mobilePanel, setMobilePanel] = React.useState<"cases" | "chat" | "evidence">("chat");
  const streamAbortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const activeConversation = conversations.find((item) => item.id === conversationId) || null;
  const approval = approvals[0] || null;
  const running = Boolean(run && ["queued", "running", "waiting_for_approval", "stopping"].includes(run.status));
  const canConfigureModel = currentUser.role === "admin" && currentUser.permissions?.includes("hermes_agent_admin");
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
    const [result, todoResult] = await Promise.all([fetchHermesCases({ status: caseStatus, severity: caseSeverity }, signal), fetchHermesTodos(signal)]);
    setCases(result.cases); setTodos(todoResult.todos || []);
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
    const result = await fetchPartnerProgressConfig(signal);
    setPartnerConfig(result.config);
    setPartnerOrganizations(result.organizations || []);
    setPartnerDraft({
      enabled: result.config.enabled, textEnabled: result.config.textEnabled, voiceEnabled: result.config.voiceEnabled,
      organizationIds: result.config.organizationIds || [], userDailyLimit: result.config.userDailyLimit,
      organizationDailyLimit: result.config.organizationDailyLimit, engine: result.config.asr.engine || "16k_zh", secretId: "", secretKey: "",
    });
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
    setLoading(true);
    Promise.all([loadWorkspace(controller.signal), loadCases(controller.signal)])
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载工作台失败"); })
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
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, streamText, activities, approvals]);

  React.useEffect(() => () => {
    const controller = streamAbortRef.current;
    controller?.abort();
    if (streamAbortRef.current === controller) streamAbortRef.current = null;
  }, []);

  async function selectConversation(id: string) {
    if (running || id === conversationId) return;
    setConversationId(id);
    setActivities([]);
    setStreamText("");
    setApprovals([]);
    setRun(null);
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
      setRun((current) => {
        const next = advanceVisiblePlan(current, "tool.started");
        return next ? { ...next, toolCount: Number(next.toolCount || 0) + 1 } : next;
      });
      return;
    }
    if (event.type === "tool.completed") {
      setActivities((current) => {
        const found = current.some((item) => item.toolCallId === event.toolCallId);
        if (!found) return [...current, { toolCallId: event.toolCallId, tool: "", label: event.summary, status: "done", summary: event.summary, evidence: event.evidence || [] }];
        return current.map((item) => item.toolCallId === event.toolCallId ? { ...item, status: "done", summary: event.summary, evidence: event.evidence || [] } : item);
      });
      setRun((current) => advanceVisiblePlan(current, "tool.completed"));
      return;
    }
    if (event.type === "approval.required") {
      setApprovals((current) => current.some((item) => item.toolCallId === event.toolCallId) ? current : [...current, event]);
      setRun((current) => current ? { ...current, status: "waiting_for_approval" } : current);
      return;
    }
    if (event.type === "run.checkpoint") {
      setApprovals([]);
      setRun(null);
      setRun((current) => current ? {
        ...current,
        status: "checkpointed",
        checkpoint: event.checkpoint,
        plan: current.plan ? {
          ...current.plan,
          steps: current.plan.steps.map((step) => step.status === "in_progress" ? { ...step, status: "paused" } : step),
        } : current.plan,
      } : current);
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
          if (["run.completed", "run.failed", "run.cancelled", "run.checkpoint"].includes(frame.event.type)) {
            terminal = true;
            if (frame.event.type === "run.completed") {
              await loadMessages(nextRun.conversationId);
              setStreamText("");
              setApprovals([]);
              setRun((current) => {
                const completed = advanceVisiblePlan(current, "completed");
                return completed ? { ...completed, status: "completed" } : completed;
              });
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
    if (!prompt || running || !status?.enabled || status.ready === false) return;
    setError("");
    setApprovals([]);
    setActivities([]);
    setStreamText("");
    try {
      let id = conversationId;
      if (!id) {
        const created = await createHermesConversation({ title: prompt.slice(0, 36), context });
        id = created.conversation.id;
        setConversationId(id);
        setConversations((current) => [created.conversation, ...current]);
      }
      const optimistic: HermesMessage = { id: `local-${Date.now()}`, conversationId: id, role: "user", content: prompt, evidence: [], createdAt: new Date().toISOString() };
      setMessages((current) => [...current, optimistic]);
      setInput("");
      const result = await startHermesRun(id, { input: prompt, context });
      setRun(result.run);
      void followRun(result.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发起智能体运行失败");
      setRun(null);
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

  async function selectCase(item: HermesCase) {
    setSelectedCase(item); setDossier(null); setMobilePanel("evidence");
    try { setDossier((await fetchHermesCaseDossier(item.id)).dossier); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "异常档案读取失败"); }
  }

  async function continueFromCheckpoint() {
    if (!run?.checkpoint?.canContinue || running) return;
    setError("");
    setActivities([]);
    setStreamText("");
    try {
      const result = await continueHermesRun(run.id);
      setRun(result.run);
      void followRun(result.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "继续任务失败");
    }
  }

  function openModelSettings() {
    setModelApiKey("");
    setModelMessage("");
    setModelError("");
    setModelDraft(modelConfig?.model || status?.model || "deepseek-v4-pro");
    setShowModelConfig(true);
  }

  async function openPartnerSettings() {
    setShowPartnerConfig(true);
    setPartnerMessage("");
    setPartnerError("");
    setPartnerBusy("load");
    try { await loadPartnerConfig(); }
    catch (caught) { setPartnerError(caught instanceof Error ? caught.message : "读取伙伴快捷汇报配置失败"); }
    finally { setPartnerBusy(""); }
  }

  function togglePartnerOrganization(id: string) {
    setPartnerDraft((current) => ({ ...current, organizationIds: current.organizationIds.includes(id) ? current.organizationIds.filter((item) => item !== id) : [...current.organizationIds, id] }));
  }

  async function testPartnerConnection() {
    if (partnerBusy) return;
    setPartnerBusy("test"); setPartnerMessage(""); setPartnerError("");
    try {
      const result = await testPartnerProgressConfig({ asr: { engine: partnerDraft.engine, ...(partnerDraft.secretId.trim() ? { secretId: partnerDraft.secretId.trim() } : {}), ...(partnerDraft.secretKey.trim() ? { secretKey: partnerDraft.secretKey.trim() } : {}) } });
      setPartnerMessage(result.message);
    } catch (caught) { setPartnerError(caught instanceof Error ? caught.message : "腾讯云连接测试失败"); }
    finally { setPartnerBusy(""); }
  }

  async function savePartnerSettings() {
    if (partnerBusy) return;
    setPartnerBusy("save"); setPartnerMessage(""); setPartnerError("");
    try {
      const result = await savePartnerProgressConfig({
        enabled: partnerDraft.enabled, textEnabled: partnerDraft.textEnabled, voiceEnabled: partnerDraft.voiceEnabled,
        organizationIds: partnerDraft.organizationIds, userDailyLimit: Number(partnerDraft.userDailyLimit), organizationDailyLimit: Number(partnerDraft.organizationDailyLimit),
        asr: { engine: partnerDraft.engine, ...(partnerDraft.secretId.trim() ? { secretId: partnerDraft.secretId.trim() } : {}), ...(partnerDraft.secretKey.trim() ? { secretKey: partnerDraft.secretKey.trim() } : {}) },
      });
      setPartnerConfig(result.config);
      setPartnerDraft((current) => ({ ...current, secretId: "", secretKey: "" }));
      setPartnerMessage("伙伴快捷汇报配置已保存，新请求立即生效。");
    } catch (caught) { setPartnerError(caught instanceof Error ? caught.message : "保存伙伴快捷汇报配置失败"); }
    finally { setPartnerBusy(""); }
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

  function investigateCase(item: HermesCase) {
    setSelectedCase(item);
    setContext({ route: item.href || "#hermes-agent", selectedRefs: [{ type: "exception_case", id: item.id }] });
    setInput(`请调查「${item.title}」（案例 ${item.id}），核对最新证据、分析影响并给出下一步建议。`);
    setMobilePanel("chat");
  }

  return (
    <section className={`hermes-workspace mobile-${mobilePanel}`}>
      <header className="hermes-workspace-hero">
        <div className="hermes-hero-mark"><Bot size={24} /><i /></div>
        <div><span>HERMES BUSINESS AGENT</span><h2>同舟智能体工作台</h2><p>围绕库存、备货和生产异常，由 Hermes 调用业务工具查证、归因并推动闭环。</p></div>
        <div className="hermes-hero-actions">
          <div className={`hermes-runtime-state is-${status?.status || "loading"}`}>
            {status?.ready ? <CheckCircle2 size={16} /> : status?.enabled === false ? <OctagonX size={16} /> : status?.modelConfigured === false ? <KeyRound size={16} /> : <LoaderCircle size={16} className={!status ? "spinning" : ""} />}
            <span><b>{status?.enabled === false ? "运行时未启用" : status?.modelConfigured === false ? "DeepSeek 未配置" : status?.ready ? "Hermes 就绪" : status?.status === "unavailable" ? "运行时不可用" : "状态检查中"}</b><small>{status?.model || "模型未配置"}</small></span>
          </div>
          {canConfigureModel ? <><button className="hermes-model-settings-button" type="button" onClick={() => void openPartnerSettings()}><Mic2 size={15} />伙伴汇报</button><button className="hermes-model-settings-button" type="button" onClick={openModelSettings}><Settings2 size={15} />模型配置</button></> : null}
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
          {todos.length ? <section className="hermes-todo-summary"><header><span>MY PRIORITIES</span><strong>今日待办 {todos.length}</strong></header>{todos.slice(0, 3).map((todo) => <button key={todo.id} onClick={() => { const item = cases.find((entry) => entry.id === todo.caseId); if (item) void selectCase(item); }}><i className={`severity-${todo.severity}`} /><span><strong>{todo.reason}</strong><small>{todo.title}</small></span></button>)}</section> : null}
          <div className="hermes-case-filters">
            <label><Filter size={14} /><select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)}><option value="open">未处理</option><option value="investigating">调查中</option><option value="action_pending">待动作</option><option value="resolved">已解决</option><option value="">全部状态</option></select></label>
            <select aria-label="严重度" value={caseSeverity} onChange={(event) => setCaseSeverity(event.target.value)}><option value="">全部等级</option><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select>
          </div>
          <div className="hermes-case-list">
            {cases.map((item) => <button key={item.id} className={selectedCase?.id === item.id ? "active" : ""} onClick={() => void selectCase(item)}>
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
            {run?.plan?.steps?.length ? <section className="hermes-task-plan">
              <header><div><span>TASK PLAN</span><strong>任务执行步骤</strong></div><em>阶段 {run.stageNo || 1} · 工具 {run.toolCount || activities.length}/32</em></header>
              <ol>{run.plan.steps.map((step) => <li key={step.id} className={`is-${step.status}`}>
                <i>{step.status === "completed" ? <CheckCircle2 size={14} /> : step.status === "in_progress" ? <LoaderCircle size={14} className="spinning" /> : <CircleDot size={14} />}</i>
                <span>{step.label}</span>
                <small>{step.status === "completed" ? "已完成" : step.status === "in_progress" ? "进行中" : step.status === "paused" ? "已暂停" : "待处理"}</small>
              </li>)}</ol>
            </section> : null}
            {run?.status === "checkpointed" && run.checkpoint ? <section className="hermes-checkpoint-card">
              <header><AlertTriangle size={17} /><div><strong>任务已保存检查点</strong><span>{run.checkpoint.message}</span></div></header>
              {run.checkpoint.remainingSteps?.length ? <p>剩余：{run.checkpoint.remainingSteps.join("、")}</p> : null}
              <button type="button" onClick={() => void continueFromCheckpoint()}><Play size={14} />继续完成</button>
            </section> : null}
            {!messages.length && !streamText && !running ? <div className="hermes-welcome"><span><FileSearch size={24} /></span><h3>{currentUser.displayName || currentUser.username || "你好"}，今天要处理什么？</h3><p>我会重新读取权限范围内的真实业务数据，给出证据、影响和建议；任何写操作都会在执行前请你确认。</p><div><button onClick={() => setInput("列出当前最严重的库存、备货和生产异常，并按影响排序。")}>查看严重异常</button><button onClick={() => setInput("检查逾期备货和生产任务，说明原因与下一步。")}>检查逾期任务</button></div></div> : null}
            {messages.map((message) => <article key={message.id} className={`hermes-message ${message.role}`}>
              <i>{message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}</i>
              <div>{message.role === "assistant" ? <AgentMarkdown content={message.content} /> : message.content}</div>
            </article>)}
            {activities.map((item) => <article key={item.toolCallId} className={`hermes-tool-activity is-${item.status}`}><i>{item.status === "done" ? <CheckCircle2 size={15} /> : <LoaderCircle size={15} className="spinning" />}</i><span><strong>{item.label}</strong><small>{item.summary || (item.status === "running" ? "正在从业务系统读取和核对数据…" : "已完成")}</small></span></article>)}
            {streamText ? <article className="hermes-message assistant streaming"><i><Bot size={16} /></i><div><AgentMarkdown content={streamText} /><span className="hermes-caret" /></div></article> : null}
            {running && !streamText && !approval && !activities.some((item) => item.status === "running") ? <div className="hermes-thinking"><LoaderCircle size={16} className="spinning" />Hermes 正在分析业务数据…</div> : null}
            {approval ? <section className="hermes-inline-approval"><header><ShieldCheck size={18} /><div><span>业务动作需要确认{approvals.length > 1 ? ` · 另有 ${approvals.length - 1} 项待确认` : ""}</span><strong>{approval.preview.title}</strong></div></header><p>{approval.preview.summary}</p><ul>{approval.preview.effects?.map((item) => <li key={item}>{item}</li>)}</ul><div>{approval.preview.warnings?.map((item) => <small key={item}><AlertTriangle size={13} />{item}</small>)}</div><label className="hermes-reauth"><span>当前账号密码</span><input type="password" autoComplete="current-password" value={approvalPassword} onChange={(event) => setApprovalPassword(event.target.value)} disabled={busyApproval} placeholder="批准前重新鉴权" /></label><footer><button className="deny" onClick={() => void decide("deny")} disabled={busyApproval}><X size={14} />拒绝</button><button className="approve" onClick={() => void decide("once")} disabled={busyApproval || !approvalPassword}>{busyApproval ? <LoaderCircle size={14} className="spinning" /> : <Play size={14} />}仅本次允许</button></footer></section> : null}
            {error ? <div className="hermes-error"><AlertTriangle size={16} /><span>{error}</span></div> : null}
            <div ref={endRef} />
          </div>
          <form className="hermes-composer" onSubmit={submit}>
            {context.route !== "#hermes-agent" ? <div className="hermes-context-chip"><Database size={13} /><span>来自 {context.route}</span><button type="button" onClick={() => setContext({ route: "#hermes-agent" })}><X size={12} /></button></div> : null}
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} disabled={running || status?.enabled === false || status?.modelConfigured === false} rows={3} placeholder={status?.modelConfigured === false ? "请先配置 DeepSeek API Key" : "询问异常、原因、影响或下一步…"} />
            <button type="submit" disabled={!input.trim() || running || !status?.enabled || status.ready === false || status.modelConfigured === false} aria-label="发送"><Send size={18} /></button>
            <small><ShieldCheck size={12} />所有业务写操作都需要你逐次确认</small>
          </form>
        </main>

        <aside className="hermes-right-panel">
          <div className="hermes-panel-heading"><div><span>EVIDENCE</span><strong>证据与动作</strong></div><Database size={17} /></div>
          {selectedCase ? <section className="hermes-case-detail"><header><span className={`severity severity-${selectedCase.severity}`}>{severityLabel[selectedCase.severity]}</span><em>{statusLabel[selectedCase.status] || selectedCase.status}</em></header><h3>{selectedCase.title}</h3><p>{selectedCase.summary}</p>{dossier?.changeSummary ? <div className={`hermes-change-summary ${dossier.changeSummary.changed ? "changed" : ""}`}><RefreshCw size={13} /><span><strong>本次复查变化</strong><small>{dossier.changeSummary.summary}</small></span></div> : null}<dl><div><dt>规则</dt><dd>{selectedCase.ruleCode}</dd></div><div><dt>业务对象</dt><dd>{selectedCase.sku || selectedCase.resourceId}</dd></div><div><dt>责任人</dt><dd>{selectedCase.assigneeName || "未分派"}</dd></div><div><dt>来源更新</dt><dd>{timeLabel(selectedCase.sourceUpdatedAt)}</dd></div>{dossier ? <><div><dt>影响对象</dt><dd>{dossier.affectedOrders.length || "待核对"}</dd></div><div><dt>库存/缺料</dt><dd>{dossier.inventoryGap.length || "未发现"}</dd></div></> : null}</dl>{dossier?.suggestedActions?.length ? <div className="hermes-dossier-actions"><strong>建议动作</strong><ol>{dossier.suggestedActions.map((action) => <li key={action}>{action}</li>)}</ol></div> : null}{dossier?.playbooks?.length ? <div className="hermes-dossier-playbooks"><strong>已审核剧本</strong>{dossier.playbooks.map((playbook) => <span key={playbook.id}>{playbook.title}</span>)}</div> : null}<footer><button onClick={() => investigateCase(selectedCase)}><Bot size={15} />交给智能体调查</button>{selectedCase.href ? <button onClick={() => navigate(selectedCase.href)}><ArrowUpRight size={15} />打开业务页</button> : null}</footer></section> : <div className="hermes-evidence-placeholder"><CircleDot size={22} /><strong>选择异常或开始会话</strong><span>这里会展示证据、来源更新时间、审批预览和执行结果。</span></div>}
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
          <header><div><span>PARTNER QUICK REPORT</span><h3 id="hermes-partner-title">伙伴快捷汇报配置</h3><p>仅生成可编辑草稿；伙伴仍需检查并通过原表单提交。</p></div><button type="button" aria-label="关闭" onClick={() => setShowPartnerConfig(false)} disabled={Boolean(partnerBusy)}><X size={17} /></button></header>
          <div className="hermes-partner-toggles"><label><input type="checkbox" checked={partnerDraft.enabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, enabled: event.target.checked })} />总开关</label><label><input type="checkbox" checked={partnerDraft.textEnabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, textEnabled: event.target.checked })} />文字</label><label><input type="checkbox" checked={partnerDraft.voiceEnabled} onChange={(event) => setPartnerDraft({ ...partnerDraft, voiceEnabled: event.target.checked })} />语音</label></div>
          <label><span>试点伙伴组织</span><div className="hermes-partner-organizations">{partnerOrganizations.length ? partnerOrganizations.map((organization) => <label key={organization.id}><input type="checkbox" checked={partnerDraft.organizationIds.includes(organization.id)} onChange={() => togglePartnerOrganization(organization.id)} /><span><strong>{organization.name}</strong><small>{organization.code} · {organization.organizationType}</small></span></label>) : <small>{partnerBusy === "load" ? "正在读取组织…" : "暂无可选的活动组织"}</small>}</div></label>
          <div className="hermes-partner-limits"><label><span>每用户每日</span><input type="number" min="1" max="500" value={partnerDraft.userDailyLimit} onChange={(event) => setPartnerDraft({ ...partnerDraft, userDailyLimit: Number(event.target.value) })} /></label><label><span>每组织每日</span><input type="number" min="1" max="10000" value={partnerDraft.organizationDailyLimit} onChange={(event) => setPartnerDraft({ ...partnerDraft, organizationDailyLimit: Number(event.target.value) })} /></label></div>
          <label><span>腾讯云识别引擎</span><select value={partnerDraft.engine} onChange={(event) => setPartnerDraft({ ...partnerDraft, engine: event.target.value })}><option value="16k_zh">普通话 16k</option><option value="16k_zh-PY">普通话 + 英文</option><option value="16k_zh_dialect">普通话 + 方言</option></select></label>
          <label><span>腾讯云 SecretId</span><input type="password" autoComplete="new-password" value={partnerDraft.secretId} onChange={(event) => setPartnerDraft({ ...partnerDraft, secretId: event.target.value })} placeholder={partnerConfig?.asr.configured ? `留空继续使用 ${partnerConfig.asr.secretIdMasked}` : "AKID..."} /></label>
          <label><span>腾讯云 SecretKey</span><input type="password" autoComplete="new-password" value={partnerDraft.secretKey} onChange={(event) => setPartnerDraft({ ...partnerDraft, secretKey: event.target.value })} placeholder={partnerConfig?.asr.configured ? "留空则保持现有密钥" : "请输入 SecretKey"} /></label>
          {partnerMessage ? <div className="hermes-model-result success"><CheckCircle2 size={15} />{partnerMessage}</div> : null}{partnerError ? <div className="hermes-model-result error"><AlertTriangle size={15} />{partnerError}</div> : null}
          <footer><button type="button" className="secondary" onClick={() => void testPartnerConnection()} disabled={Boolean(partnerBusy) || (!partnerDraft.secretId.trim() && !partnerConfig?.asr.configured)}>{partnerBusy === "test" ? <LoaderCircle size={14} className="spinning" /> : <RefreshCw size={14} />}测试语音连接</button><button type="button" className="primary" onClick={() => void savePartnerSettings()} disabled={Boolean(partnerBusy)}>{partnerBusy === "save" ? <LoaderCircle size={14} className="spinning" /> : <ShieldCheck size={14} />}保存配置</button></footer>
        </section>
      </div> : null}
    </section>
  );
}

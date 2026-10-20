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
  LoaderCircle,
  MessageSquareText,
  OctagonX,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Send,
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
  fetchHermesStatus,
  startHermesRun,
  stopHermesRun,
  streamHermesRunEvents,
  type HermesActionPreview,
  type HermesCase,
  type HermesContext,
  type HermesConversation,
  type HermesEvidenceRef,
  type HermesEvent,
  type HermesMessage,
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
  const [mobilePanel, setMobilePanel] = React.useState<"cases" | "chat" | "evidence">("chat");
  const streamAbortRef = React.useRef<AbortController | null>(null);
  const endRef = React.useRef<HTMLDivElement | null>(null);

  const activeConversation = conversations.find((item) => item.id === conversationId) || null;
  const approval = approvals[0] || null;
  const running = Boolean(run && ["queued", "running", "waiting_for_approval", "stopping"].includes(run.status));
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
        <div className={`hermes-runtime-state is-${status?.status || "loading"}`}>
          {status?.ready ? <CheckCircle2 size={16} /> : status?.enabled === false ? <OctagonX size={16} /> : <LoaderCircle size={16} className={!status ? "spinning" : ""} />}
          <span><b>{status?.enabled === false ? "运行时未启用" : status?.ready ? "Hermes 就绪" : status?.status === "unavailable" ? "运行时不可用" : "状态检查中"}</b><small>{status?.model || "模型未配置"}</small></span>
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
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} disabled={running || status?.enabled === false} rows={3} placeholder="询问异常、原因、影响或下一步…" />
            <button type="submit" disabled={!input.trim() || running || !status?.enabled || status.ready === false} aria-label="发送"><Send size={18} /></button>
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
    </section>
  );
}

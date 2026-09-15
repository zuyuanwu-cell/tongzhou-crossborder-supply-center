import React from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  Database,
  LoaderCircle,
  MessageSquareText,
  Navigation,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  AiAgentChatMessage,
  AiAgentContextPayload,
  AuthUser,
  fetchAiAgentContext,
  runAiAgentChat,
} from "./api";

type Props = {
  currentUser: AuthUser;
  route: string;
};

function timeLabel(value: string) {
  if (!value) return "等待数据";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function insightIcon(severity: string) {
  if (severity === "success") return <CheckCircle2 size={15} />;
  if (["critical", "warning"].includes(severity)) return <TriangleAlert size={15} />;
  return <Activity size={15} />;
}

function navigate(href: string) {
  if (!href || !href.startsWith("#")) return;
  window.location.hash = href;
}

export function AiAgentWidget({ currentUser, route }: Props) {
  const [open, setOpen] = React.useState(false);
  const [context, setContext] = React.useState<AiAgentContextPayload | null>(null);
  const [messages, setMessages] = React.useState<AiAgentChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loadingContext, setLoadingContext] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  const [error, setError] = React.useState("");
  const [diagnosisOpen, setDiagnosisOpen] = React.useState(true);
  const contextAbortRef = React.useRef<AbortController | null>(null);
  const previousRouteRef = React.useRef(route);
  const messageEndRef = React.useRef<HTMLDivElement | null>(null);

  const hasWarning = Boolean(context?.insights.some((item) => ["critical", "warning"].includes(item.severity)));

  const loadContext = React.useCallback(async () => {
    contextAbortRef.current?.abort();
    const controller = new AbortController();
    contextAbortRef.current = controller;
    setLoadingContext(true);
    setError("");
    try {
      const result = await fetchAiAgentContext(route, controller.signal);
      if (!controller.signal.aborted) setContext(result);
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setError(requestError instanceof Error ? requestError.message : "读取页面诊断失败。");
    } finally {
      if (contextAbortRef.current === controller) {
        contextAbortRef.current = null;
        setLoadingContext(false);
      }
    }
  }, [route]);

  React.useEffect(() => {
    if (!open) return;
    if (previousRouteRef.current !== route) {
      previousRouteRef.current = route;
      setMessages([]);
      setInput("");
    }
    void loadContext();
    return () => contextAbortRef.current?.abort();
  }, [open, route, loadContext]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  React.useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, thinking]);

  async function ask(question: string) {
    const content = question.trim();
    if (!content || thinking || !context?.configured) return;
    const userMessage: AiAgentChatMessage = { role: "user", content };
    const nextMessages: AiAgentChatMessage[] = [...messages, userMessage].slice(-12);
    setMessages(nextMessages);
    setInput("");
    setThinking(true);
    setError("");
    try {
      const result = await runAiAgentChat({ route, messages: nextMessages });
      const assistantMessage: AiAgentChatMessage = { role: "assistant", content: result.answer };
      setMessages((current) => [...current, assistantMessage].slice(-12));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "领航员暂时无法完成分析。");
    } finally {
      setThinking(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  return (
    <div className={`ai-agent-dock ${open ? "open" : ""}`}>
      {open ? (
        <section className="ai-agent-panel" role="dialog" aria-label="同舟领航员">
          <header className="ai-agent-header">
            <div className="ai-agent-mark" aria-hidden="true"><Navigation size={21} /><i /></div>
            <div>
              <span>DATA COPILOT</span>
              <strong>同舟领航员</strong>
              <small>{context?.page.title || "正在识别当前页面"} · 只读分析</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭领航员"><X size={18} /></button>
          </header>

          <div className="ai-agent-body">
            <section className="ai-agent-page-strip">
              <span><Database size={14} /> 当前上下文</span>
              <strong>{context?.page.description || "正在读取权限范围内的数据…"}</strong>
              <button type="button" onClick={() => void loadContext()} disabled={loadingContext} title="重新诊断">
                <RefreshCw size={14} className={loadingContext ? "spin" : ""} />
              </button>
            </section>

            {loadingContext && !context ? (
              <div className="ai-agent-loading"><LoaderCircle className="spin" /><strong>正在扫描本页数据</strong><span>仅使用已有缓存，不触发全量同步</span></div>
            ) : null}

            {context ? (
              <section className="ai-agent-diagnosis">
                <button className="ai-agent-section-title" type="button" onClick={() => setDiagnosisOpen((value) => !value)}>
                  <span><Activity size={15} /> 本页诊断</span>
                  <em>{context.insights.length} 条洞察</em>
                  <ChevronDown size={15} className={diagnosisOpen ? "expanded" : ""} />
                </button>
                {diagnosisOpen ? (
                  <div className="ai-agent-diagnosis-content">
                    <div className="ai-agent-metrics">
                      {context.metrics.slice(0, 4).map((metric) => (
                        <div className={metric.tone} key={`${metric.label}-${metric.value}`}><span>{metric.label}</span><strong>{metric.value}</strong></div>
                      ))}
                    </div>
                    <div className="ai-agent-insights">
                      {context.insights.slice(0, 4).map((item, index) => (
                        <button className={item.severity} type="button" key={`${item.title}-${index}`} onClick={() => navigate(item.href)} disabled={!item.href}>
                          <i>{insightIcon(item.severity)}</i>
                          <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                          {item.href ? <ArrowUpRight size={14} /> : null}
                        </button>
                      ))}
                    </div>
                    <div className="ai-agent-source-line">
                      <ShieldCheck size={13} /> 已应用账号数据权限
                      <span>{timeLabel(context.generatedAt)}</span>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="ai-agent-conversation" aria-live="polite">
              {!messages.length ? (
                <div className="ai-agent-welcome">
                  <span><Sparkles size={17} /></span>
                  <div><strong>{currentUser.displayName || currentUser.username}，需要我看什么？</strong><p>我会结合当前页面的数据给出结论、依据和下一步。</p></div>
                </div>
              ) : null}
              {messages.map((message, index) => (
                <article className={`ai-agent-message ${message.role}`} key={`${message.role}-${index}`}>
                  <i>{message.role === "assistant" ? <Bot size={15} /> : <MessageSquareText size={15} />}</i>
                  <div>{message.content}</div>
                </article>
              ))}
              {thinking ? <article className="ai-agent-message assistant thinking"><i><Bot size={15} /></i><div><span /><span /><span /><em>正在核对数据并组织结论</em></div></article> : null}
              <div ref={messageEndRef} />
            </section>

            {error ? <div className="ai-agent-error"><TriangleAlert size={15} /><span>{error}</span></div> : null}

            {context && !context.configured ? (
              <button className="ai-agent-setup" type="button" onClick={() => navigate("#tongzhou-ai")}>
                <Settings2 size={18} /><span><strong>配置个人 AI 模型</strong><small>规则诊断可用；配置后即可继续提问</small></span><ArrowUpRight size={16} />
              </button>
            ) : null}

            {context?.configured && !messages.length ? (
              <div className="ai-agent-prompts">
                {context.prompts.slice(0, 3).map((prompt) => <button type="button" key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}
              </div>
            ) : null}
          </div>

          <footer className="ai-agent-footer">
            {context?.actions.length ? (
              <div className="ai-agent-actions">
                {context.actions.slice(0, 3).map((action) => <button type="button" key={action.href} onClick={() => navigate(action.href)}>{action.label}<ArrowUpRight size={12} /></button>)}
              </div>
            ) : null}
            <form onSubmit={submit}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (input.trim()) void ask(input);
                  }
                }}
                placeholder={context?.configured ? "问数据、找原因，或让领航员整理处理步骤…" : "请先配置个人 AI 模型"}
                disabled={!context?.configured || thinking}
                rows={2}
              />
              <button type="submit" disabled={!input.trim() || thinking || !context?.configured} aria-label="发送问题"><Send size={17} /></button>
            </form>
            <small><ShieldCheck size={12} /> 只读分析 · 不自动同步 · 不直接修改业务数据</small>
          </footer>
        </section>
      ) : null}

      <button className="ai-agent-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? "收起同舟领航员" : "打开同舟领航员"}>
        <span className="ai-agent-trigger-orbit" aria-hidden="true" />
        <Navigation size={24} />
        <strong>AI</strong>
        {hasWarning ? <i className="warning" /> : context ? <i /> : null}
      </button>
    </div>
  );
}

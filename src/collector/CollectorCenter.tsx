import React from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleOff, Cpu, History, Play, Power, RefreshCw, RotateCcw, Save, ScrollText, Server, Store, Trash2, X } from "lucide-react";
import {
  deleteCollectorNode,
  fetchCollectorLogs,
  fetchCollectorNode,
  fetchCollectorNodes,
  fetchCollectorRuns,
  retryCollectorRun,
  sendCollectorCommand,
  updateCollectorNode,
  type CollectorLogLine,
  type CollectorNodeDetail,
  type CollectorNodeSummary,
  type CollectorRun,
} from "../api";
import "./collector-center.css";

type DetailTab = "schedule" | "runs" | "logs" | "stores";

const RUN_STATUS: Record<string, [string, string]> = {
  ok: ["成功", "good"],
  partial: ["部分成功", "warning"],
  failed: ["失败", "bad"],
  upload_failed: ["写入失败", "bad"],
  cancelled: ["已取消", "muted"],
  running: ["进行中", "info"],
  skipped: ["已跳过", "muted"],
};

const COMMAND_STATUS: Record<string, string> = {
  pending: "等待节点领取",
  delivered: "节点已领取",
  running: "执行中",
  done: "已完成",
  failed: "失败",
  rejected: "被拒绝",
  expired: "已过期",
};

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function relativeTime(value?: string) {
  if (!value) return "从未上报";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "—";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return `${Math.round(diff / 86_400_000)} 天前`;
}

function today(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateList(from: string, to: string) {
  const list: string[] = [];
  if (!from || !to || from > to) return list;
  for (let day = from; day <= to && list.length < 62;) {
    list.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return list;
}

function nodeState(node: CollectorNodeSummary) {
  if (node.disabled) return { label: "已停用", tone: "muted" };
  if (!node.online) return { label: "离线", tone: "bad" };
  if (node.running) return { label: "采集中", tone: "info" };
  return { label: "在线", tone: "good" };
}

function RunTag({ status }: { status: string }) {
  const [label, tone] = RUN_STATUS[status] || [status || "—", "muted"];
  return <span className={`cc-tag ${tone}`}>{label}</span>;
}

export function CollectorCenter({ canEdit = true }: { canEdit?: boolean }) {
  const [nodes, setNodes] = React.useState<CollectorNodeSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selectedId, setSelectedId] = React.useState("");
  const [detail, setDetail] = React.useState<CollectorNodeDetail | null>(null);
  const [tab, setTab] = React.useState<DetailTab>("schedule");
  const [runs, setRuns] = React.useState<CollectorRun[]>([]);
  const [expandedRun, setExpandedRun] = React.useState("");
  const [logs, setLogs] = React.useState<CollectorLogLine[]>([]);
  const [errorsOnly, setErrorsOnly] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [draft, setDraft] = React.useState({ enabled: false, times: "09:30", lookbackDays: 3, name: "" });
  const [range, setRange] = React.useState({ mode: "auto" as "auto" | "custom", from: today(-3), to: today(-1) });
  const logSeq = React.useRef(0);

  const loadNodes = React.useCallback(async () => {
    try {
      const result = await fetchCollectorNodes();
      setNodes(result.nodes);
      setError("");
      setSelectedId((current) => current || result.nodes[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取采集节点失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = React.useCallback(async (nodeId: string, { resetDraft = false } = {}) => {
    if (!nodeId) return;
    try {
      const [{ node }, runResult] = await Promise.all([fetchCollectorNode(nodeId), fetchCollectorRuns(nodeId)]);
      setDetail(node);
      setRuns(runResult.runs);
      if (resetDraft) setDraft({ enabled: node.schedule.enabled, times: node.schedule.times.join(", "), lookbackDays: node.schedule.lookbackDays, name: node.name });
    } catch (loadError) {
      setNotice(loadError instanceof Error ? loadError.message : "读取节点详情失败");
    }
  }, []);

  const loadLogs = React.useCallback(async (nodeId: string, reset = false) => {
    if (!nodeId) return;
    try {
      const after = reset ? 0 : logSeq.current;
      const result = await fetchCollectorLogs(nodeId, after);
      logSeq.current = result.lastSeq;
      setLogs((current) => (reset ? result.lines : [...current, ...result.lines]).slice(-2000));
    } catch {
      /* 日志读取失败不打断页面 */
    }
  }, []);

  React.useEffect(() => {
    loadNodes();
    const timer = window.setInterval(loadNodes, 20_000);
    return () => window.clearInterval(timer);
  }, [loadNodes]);

  React.useEffect(() => {
    if (!selectedId) return;
    logSeq.current = 0;
    setLogs([]);
    setExpandedRun("");
    loadDetail(selectedId, { resetDraft: true });
    loadLogs(selectedId, true);
    const timer = window.setInterval(() => {
      loadDetail(selectedId);
      loadLogs(selectedId);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadDetail, loadLogs]);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
      await Promise.all([loadNodes(), loadDetail(selectedId)]);
    } catch (actError) {
      setNotice(actError instanceof Error ? actError.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  const saveSchedule = () => act("schedule", async () => {
    const times = draft.times.split(/[,，\s]+/).filter(Boolean);
    const invalid = times.filter((time) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time));
    if (invalid.length) throw new Error(`时间格式不对：${invalid.join("、")}（例如 09:30）`);
    const { node } = await updateCollectorNode(selectedId, { name: draft.name, schedule: { enabled: draft.enabled, times, lookbackDays: draft.lookbackDays } });
    setDraft({ enabled: node.schedule.enabled, times: node.schedule.times.join(", "), lookbackDays: node.schedule.lookbackDays, name: node.name });
    return "已保存，节点会在 1 分钟内按新计划执行。";
  });

  const collectNow = () => act("collect", async () => {
    const dates = range.mode === "custom" ? dateList(range.from, range.to) : undefined;
    if (range.mode === "custom" && !dates?.length) throw new Error("请选择正确的日期区间");
    await sendCollectorCommand(selectedId, { type: "collect", dates });
    return detail?.online ? "已下发，节点会在 1 分钟内开始采集。" : "已下发。节点当前离线，上线后会自动执行（24 小时内有效）。";
  });

  const retry = (run: CollectorRun) => act(`retry-${run.id}`, async () => {
    const { command } = await retryCollectorRun(selectedId, run.id);
    return `已下发重试：${command.storeIds?.length || 0} 个店铺，日期 ${run.dates.join("、") || "按节点默认"}。`;
  });

  const toggleDisabled = () => act("disable", async () => {
    if (!detail) return;
    await updateCollectorNode(selectedId, { disabled: !detail.disabled });
    return detail.disabled ? "已启用节点。" : "已停用节点，它的令牌立即失效；重新启用后需要在采集器里重新登录中台。";
  });

  const removeNode = () => act("remove", async () => {
    if (!detail || !window.confirm(`删除节点「${detail.name}」？它的运行记录和日志也会一起删除。`)) return;
    await deleteCollectorNode(selectedId);
    setSelectedId("");
    setDetail(null);
    return "已删除节点。";
  });

  const visibleLogs = errorsOnly ? logs.filter((line) => line.level !== "info") : logs;
  const onlineCount = nodes.filter((node) => node.online && !node.disabled).length;
  // 需处理：离线、紫鸟异常、上次采集有失败店铺或写入中台失败
  const failedNodes = nodes.filter((node) => !node.disabled && (!node.online || node.health?.ziniaoCli === false || Boolean(node.lastRun?.failedStores) || node.lastRun?.status === "failed" || node.lastRun?.status === "upload_failed")).length;

  return (
    <div className="collector-center">
      <header className="cc-head">
        <div>
          <span className="cc-eyebrow">COLLECTOR NODES</span>
          <h3>采集中心</h3>
          <p>部署在各台电脑 / 云电脑上的「同舟智数」采集节点。在这里看在线状态、采集记录和日志，修改每天的采集时间，下发立即采集或重试失败店铺。</p>
        </div>
        <div className="cc-head-stats">
          <div><strong>{nodes.length}</strong><span>节点</span></div>
          <div className="good"><strong>{onlineCount}</strong><span>在线</span></div>
          <div className={failedNodes ? "bad" : ""}><strong>{failedNodes}</strong><span>需处理</span></div>
          <button type="button" className="cc-btn" onClick={() => { loadNodes(); loadDetail(selectedId); loadLogs(selectedId); }}><RefreshCw size={14} />刷新</button>
        </div>
      </header>

      {error ? <div className="cc-notice bad"><AlertTriangle size={15} />{error}</div> : null}

      {!loading && !nodes.length ? (
        <div className="cc-empty">
          <Server size={28} />
          <h4>还没有采集节点</h4>
          <ol>
            <li>在要运行采集的电脑（或云电脑）上解压并打开「同舟智数」，确认紫鸟客户端已登录。</li>
            <li>在同舟智数「总览」用中台账号登录一次（需要店铺日报权限）。</li>
            <li>1 分钟内这台电脑就会出现在这里，之后的采集时间、立即采集、重试都可以在本页操作。</li>
          </ol>
        </div>
      ) : null}

      {nodes.length ? (
        <div className="cc-layout">
          <aside className="cc-node-list">
            {nodes.map((node) => {
              const state = nodeState(node);
              return (
                <button key={node.id} type="button" className={`cc-node ${selectedId === node.id ? "active" : ""}`} onClick={() => { setSelectedId(node.id); setTab("schedule"); }}>
                  <div className="cc-node-top">
                    <strong>{node.name}</strong>
                    <span className={`cc-dot ${state.tone}`}>{state.label}</span>
                  </div>
                  <small>{node.hostname || "—"} · {node.platforms.join(" / ") || "未上报平台"} · v{node.version || "?"}</small>
                  <div className="cc-node-meta">
                    <span><Store size={12} />{node.enabledStoreCount}/{node.storeCount} 店{node.unmatchedStoreCount ? <em> · {node.unmatchedStoreCount} 未对应</em> : null}</span>
                    <span><CalendarClock size={12} />{node.schedule.enabled ? node.schedule.times.join("、") : "未开启定时"}</span>
                  </div>
                  <div className="cc-node-meta">
                    <span>心跳 {relativeTime(node.lastSeenAt)}</span>
                    {node.lastRun ? <span>上次 <RunTag status={node.lastRun.status} /> {formatTime(node.lastRun.startedAt)}</span> : <span>还没有采集记录</span>}
                  </div>
                </button>
              );
            })}
          </aside>

          {detail ? (
            <section className="cc-detail">
              <div className="cc-detail-head">
                <div>
                  <h4>{detail.name} <span className={`cc-dot ${nodeState(detail).tone}`}>{nodeState(detail).label}</span></h4>
                  <p>
                    {detail.hostname || "—"} · 同舟智数 v{detail.version || "?"} · {detail.pairedBy ? `${detail.pairedBy} 于 ${formatTime(detail.pairedAt)} 配对` : ""}
                    {detail.health ? <> · 紫鸟 {detail.health.ziniaoCli ? "正常" : <b className="bad">{detail.health.ziniaoMessage || "异常"}</b>}</> : null}
                  </p>
                  {detail.running && detail.currentRun ? <p className="info">正在采集：{detail.currentRun.progress || "…"}（{formatTime(detail.currentRun.startedAt)} 开始）</p> : null}
                </div>
                {canEdit ? (
                  <div className="cc-actions">
                    <button type="button" className="cc-btn" onClick={toggleDisabled} disabled={busy === "disable"}>{detail.disabled ? <Power size={14} /> : <CircleOff size={14} />}{detail.disabled ? "启用" : "停用"}</button>
                    <button type="button" className="cc-btn danger" onClick={removeNode} disabled={busy === "remove"}><Trash2 size={14} />删除</button>
                  </div>
                ) : null}
              </div>

              {notice ? <div className="cc-notice"><CheckCircle2 size={15} />{notice}<button type="button" onClick={() => setNotice("")}><X size={13} /></button></div> : null}

              <div className="cc-tabs">
                <button type="button" className={tab === "schedule" ? "active" : ""} onClick={() => setTab("schedule")}><CalendarClock size={14} />计划与操作</button>
                <button type="button" className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")}><History size={14} />采集记录 <span>{runs.length}</span></button>
                <button type="button" className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}><ScrollText size={14} />日志</button>
                <button type="button" className={tab === "stores" ? "active" : ""} onClick={() => setTab("stores")}><Store size={14} />店铺 <span>{detail.storeCount}</span></button>
              </div>

              {tab === "schedule" ? (
                <div className="cc-panel-grid">
                  <div className="cc-panel">
                    <h5>每天定时采集</h5>
                    <label className="cc-check"><input type="checkbox" checked={draft.enabled} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />开启</label>
                    <label className="cc-field"><span>采集时间（节点电脑的本地时间，多个用逗号分隔）</span><input value={draft.times} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, times: event.target.value })} placeholder="09:30, 21:30" /></label>
                    <label className="cc-field"><span>每次采集最近几天</span><input type="number" min={1} max={31} value={draft.lookbackDays} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, lookbackDays: Number(event.target.value) || 3 })} /></label>
                    <label className="cc-field"><span>节点名称</span><input value={draft.name} disabled={!canEdit} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                    {canEdit ? <button type="button" className="cc-btn primary" onClick={saveSchedule} disabled={busy === "schedule"}><Save size={14} />保存计划</button> : null}
                    {detail.nextRunAt ? <small className="cc-muted">下次定时采集：{formatTime(detail.nextRunAt)}</small> : null}
                  </div>
                  <div className="cc-panel">
                    <h5>立即采集</h5>
                    <label className="cc-field"><span>日期</span>
                      <select value={range.mode} disabled={!canEdit} onChange={(event) => setRange({ ...range, mode: event.target.value as "auto" | "custom" })}>
                        <option value="auto">最近 {detail.schedule.lookbackDays} 天（按站点时区）</option>
                        <option value="custom">指定日期区间（补采）</option>
                      </select>
                    </label>
                    {range.mode === "custom" ? (
                      <div className="cc-range">
                        <input type="date" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
                        <span>至</span>
                        <input type="date" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
                      </div>
                    ) : null}
                    {canEdit ? <button type="button" className="cc-btn primary" onClick={collectNow} disabled={busy === "collect" || detail.disabled}><Play size={14} />采集全部店铺并写入中台</button> : null}
                    <h5 style={{ marginTop: 16 }}>最近下发的命令</h5>
                    <ul className="cc-commands">
                      {detail.commands.slice(0, 8).map((command) => (
                        <li key={command.id}>
                          <span>{command.fromRunId ? "重试" : command.type === "collect" ? "立即采集" : "刷新店铺"}{command.storeIds ? ` · ${command.storeIds.length} 店` : ""}{command.dates ? ` · ${command.dates[0]}${command.dates.length > 1 ? ` ~ ${command.dates[command.dates.length - 1]}` : ""}` : ""}</span>
                          <small>{command.createdBy} · {formatTime(command.createdAt)} · <b className={command.status}>{COMMAND_STATUS[command.status] || command.status}</b></small>
                        </li>
                      ))}
                      {!detail.commands.length ? <li className="cc-muted">还没有下发过命令</li> : null}
                    </ul>
                  </div>
                </div>
              ) : null}

              {tab === "runs" ? (
                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead><tr><th>开始</th><th>触发</th><th>状态</th><th>日期</th><th className="num">店铺</th><th className="num">行数</th><th>写入中台</th><th /></tr></thead>
                    <tbody>
                      {runs.map((run) => {
                        const failed = run.stores.filter((store) => store.status === "failed" || store.status === "partial");
                        return (
                          <React.Fragment key={run.id}>
                            <tr className={expandedRun === run.id ? "open" : ""} onClick={() => setExpandedRun(expandedRun === run.id ? "" : run.id)}>
                              <td>{formatTime(run.startedAt)}</td>
                              <td>{run.trigger === "schedule" ? "定时" : run.trigger === "command" ? "中台下发" : "本机手动"}</td>
                              <td><RunTag status={run.status} /></td>
                              <td>{run.dates.length ? `${run.dates[0]}${run.dates.length > 1 ? ` ~ ${run.dates[run.dates.length - 1]}` : ""}` : "—"}</td>
                              <td className="num">{run.stores.filter((store) => store.status === "ok" || store.status === "partial").length}/{run.stores.length}</td>
                              <td className="num">{run.rowCount}</td>
                              <td>{run.upload ? (run.upload.ok ? `${run.upload.dryRun ? "试匹配" : "写入"} ${run.upload.dryRun ? run.upload.rowCount : run.upload.written} 行` : <span className="bad">{run.upload.message || "失败"}</span>) : "—"}</td>
                              <td onClick={(event) => event.stopPropagation()}>{canEdit && failed.length && run.finishedAt ? <button type="button" className="cc-btn small" disabled={busy === `retry-${run.id}`} onClick={() => retry(run)}><RotateCcw size={13} />重试 {failed.length} 店</button> : null}</td>
                            </tr>
                            {expandedRun === run.id ? (
                              <tr className="cc-run-detail"><td colSpan={8}>
                                <div className="cc-run-stores">
                                  {run.stores.map((store) => (
                                    <div key={store.storeId}><RunTag status={store.status} /><b>{store.storeName}</b><span>{store.rowCount} 行</span><small>{store.message}</small></div>
                                  ))}
                                </div>
                                {run.issues.length ? (
                                  <ul className="cc-issues">
                                    {run.issues.slice(0, 60).map((issue, index) => <li key={index} className={issue.level}>{issue.storeName}{issue.date ? ` · ${issue.date}` : ""}：{issue.message}</li>)}
                                  </ul>
                                ) : null}
                              </td></tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                      {!runs.length ? <tr><td colSpan={8} className="cc-muted">还没有采集记录</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === "logs" ? (
                <div>
                  <div className="cc-log-tools">
                    <label className="cc-check"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />只看警告和错误</label>
                    <span className="cc-muted">每 15 秒自动刷新，保留最近 3000 行</span>
                  </div>
                  <pre className="cc-log">
                    {visibleLogs.slice().reverse().map((line) => <span key={line.seq} className={line.level}>{formatTime(line.at)} [{line.level}] {line.message}{"\n"}</span>)}
                    {!visibleLogs.length ? "暂无日志" : null}
                  </pre>
                </div>
              ) : null}

              {tab === "stores" ? (
                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead><tr><th>紫鸟店铺</th><th>平台</th><th>站点</th><th>对应中台店铺</th><th>采集</th><th>上次结果</th></tr></thead>
                    <tbody>
                      {detail.stores.map((store) => (
                        <tr key={store.storeId}>
                          <td>{store.storeName}</td>
                          <td>{store.platform}</td>
                          <td>{store.site || "—"}</td>
                          <td>{store.shopName || store.storeName}{store.matched ? null : <em className="cc-warn"> · 未对应，按独立店铺写入</em>}</td>
                          <td>{store.enabled ? "是" : <span className="cc-muted">否</span>}</td>
                          <td>{store.lastStatus ? <RunTag status={store.lastStatus} /> : "—"} <small className="cc-muted">{store.lastMessage}</small></td>
                        </tr>
                      ))}
                      {!detail.stores.length ? <tr><td colSpan={6} className="cc-muted">节点还没有上报店铺</td></tr> : null}
                    </tbody>
                  </table>
                  <p className="cc-muted"><Cpu size={12} /> 店铺的启用、对应中台店铺在节点电脑的同舟智数「店铺」页调整。</p>
                </div>
              ) : null}
            </section>
          ) : <section className="cc-detail cc-muted">选择左侧的节点查看详情</section>}
        </div>
      ) : null}
    </div>
  );
}

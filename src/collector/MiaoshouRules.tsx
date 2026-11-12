import React from "react";
import { AlertTriangle, CheckCircle2, Clock, Power, PowerOff, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import {
  fetchMiaoshouRules,
  overrideMiaoshouRule,
  saveMiaoshouRules,
  type MiaoshouRule,
  type MiaoshouRulePayload,
} from "../api";

type Draft = { managed: boolean; onTime: string; offTime: string };

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 北京时间的 HH:MM，用于「下次变化」。 */
function beijingClock(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$|^24:00$/;

function draftOf(rule: MiaoshouRule): Draft {
  return { managed: rule.managed, onTime: rule.onTime, offTime: rule.offTime };
}

function stateLabel(rule: MiaoshouRule) {
  if (!rule.exists) return { text: "妙手里已不存在", tone: "bad" };
  if (rule.isEnabled === null) return { text: "未知", tone: "muted" };
  return rule.isEnabled ? { text: "已开启", tone: "good" } : { text: "已关闭", tone: "muted" };
}

export function MiaoshouRules({ canEdit = true }: { canEdit?: boolean }) {
  const [data, setData] = React.useState<MiaoshouRulePayload | null>(null);
  const [nodes, setNodes] = React.useState<NonNullable<MiaoshouRulePayload["nodes"]>>([]);
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [nodeDraft, setNodeDraft] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;

  const apply = React.useCallback((result: MiaoshouRulePayload, { resetDraft = false } = {}) => {
    setData(result);
    if (result.nodes) setNodes(result.nodes);
    // 正在编辑时不用后台刷新覆盖用户还没保存的修改。
    if (resetDraft || !dirtyRef.current) {
      setDrafts(Object.fromEntries(result.rules.map((rule) => [rule.ruleId, draftOf(rule)])));
      setNodeDraft(result.nodeId);
      setDirty(false);
    }
  }, []);

  const load = React.useCallback(async () => {
    try {
      apply(await fetchMiaoshouRules());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取妙手排单定时失败");
    }
  }, [apply]);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  function edit(ruleId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [ruleId]: { ...current[ruleId], ...patch } }));
    setDirty(true);
  }

  const invalid = (data?.rules || []).filter((rule) => {
    const draft = drafts[rule.ruleId];
    if (!draft?.managed) return false;
    return !CLOCK.test(draft.onTime) || draft.onTime === "24:00" || !CLOCK.test(draft.offTime) || draft.onTime.padStart(5, "0") === draft.offTime.padStart(5, "0");
  });

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
      setError("");
    } catch (actError) {
      setError(actError instanceof Error ? actError.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  const save = () => act("save", async () => {
    if (!data) return;
    const result = await saveMiaoshouRules({
      nodeId: nodeDraft,
      rules: data.rules.map((rule) => ({ ruleId: rule.ruleId, name: rule.name, ...drafts[rule.ruleId] })),
    });
    apply({ ...result, nodes }, { resetDraft: true });
    return `已保存，执行节点会在 1 分钟内拿到新的时间表。`;
  });

  const override = (rule: MiaoshouRule, state: "on" | "off" | "auto") => act(`${rule.ruleId}:${state}`, async () => {
    const result = await overrideMiaoshouRule(rule.ruleId, state);
    apply({ ...result, nodes });
    if (state === "auto") return `「${rule.name}」已恢复按时间表执行。`;
    const next = result.rules.find((item) => item.ruleId === rule.ruleId);
    return `已下发：「${rule.name}」${state === "on" ? "开启" : "关闭"}，保持到 ${beijingClock(next?.override?.until) || "下一个计划时间点"}；节点会在约 ${Math.round((result.checkSeconds || 120) / 60)} 分钟内执行。`;
  });

  const managedCount = data?.rules.filter((rule) => rule.managed).length || 0;
  const syncedCount = data?.rules.filter((rule) => rule.managed && rule.inSync).length || 0;
  const session = data?.session;

  return (
    <div className="mr">
      <div className="dq-summary mr-summary">
        <div className={`dq-card ${data?.node?.online ? "verified" : data?.nodeId ? "bad" : ""}`}>
          <strong>{data?.node ? (data.node.online ? "在线" : "离线") : "未指定"}</strong>
          <span>执行节点</span>
          <small>{data?.node?.name || "选择一台已登录妙手的同舟智数"}</small>
        </div>
        <div className={`dq-card ${session ? (session.loggedIn ? "verified" : "bad") : ""}`}>
          <strong>{session ? (session.loggedIn ? "已登录" : "已失效") : "—"}</strong>
          <span>妙手登录</span>
          <small>{data?.reportAt ? `${formatTime(data.reportAt)} 上报` : "节点还没有上报"}</small>
        </div>
        <div className={`dq-card ${managedCount && syncedCount === managedCount ? "verified" : managedCount ? "pending" : ""}`}>
          <strong>{syncedCount}/{managedCount}</strong>
          <span>状态一致</span>
          <small>托管规则的实际状态与时间表</small>
        </div>
        <div className={`dq-card ${data?.issues.length ? "bad" : "verified"}`}>
          <strong>{data?.issues.length || 0}</strong>
          <span>需要人工处理</span>
          <small>同时进入 Hermes 异常工作台</small>
        </div>
      </div>

      {error ? <div className="cc-notice bad"><AlertTriangle size={15} />{error}</div> : null}
      {notice ? <div className="cc-notice"><CheckCircle2 size={15} />{notice}<button type="button" onClick={() => setNotice("")}><X size={13} /></button></div> : null}

      {data?.issues.length ? (
        <section className="dq-manual">
          <div className="dq-manual-title"><AlertTriangle size={15} />需要人工处理</div>
          <ul className="mr-issues">
            {data.issues.map((issue) => (
              <li key={`${issue.code}-${issue.ruleId || ""}`}>
                <strong>{issue.title}</strong>
                <span>{issue.action}{issue.message ? `（${issue.message}）` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="cc-panel mr-panel">
        <div className="mr-toolbar">
          <label className="cc-field">
            <span>执行节点</span>
            <select value={nodeDraft} disabled={!canEdit} onChange={(event) => { setNodeDraft(event.target.value); setDirty(true); }}>
              <option value="">未指定</option>
              {nodes.filter((node) => !node.disabled || node.id === nodeDraft).map((node) => (
                <option key={node.id} value={node.id}>{node.name}{node.online ? "" : "（离线）"}</option>
              ))}
            </select>
          </label>
          <p className="cc-muted">
            时间按{data?.timezone || "北京时间"}。关闭时间可以填 24:00；关闭时间早于开启时间表示跨零点。节点每 {Math.round((data?.checkSeconds || 120) / 60)} 分钟比对一次，实际状态和时间表不一致才会操作，离线或掉登录恢复后自动补上。
          </p>
          <div className="mr-toolbar-actions">
            <button type="button" className="cc-btn" onClick={load}><RefreshCw size={14} />刷新</button>
            {canEdit ? <button type="button" className="cc-btn primary" onClick={save} disabled={!dirty || busy === "save" || invalid.length > 0}><Save size={14} />{busy === "save" ? "保存中…" : "保存"}</button> : null}
          </div>
        </div>

        {invalid.length ? <div className="cc-notice bad"><AlertTriangle size={15} />「{invalid[0].name}」的时间不对：请用 HH:MM，开启和关闭不能相同，开启时间不能填 24:00。</div> : null}

        {data && !data.rules.length ? (
          <div className="cc-empty">
            <Clock size={28} />
            <h4>还没有读到妙手的标记规则</h4>
            <ol>
              <li>在一台常开的电脑上把同舟智数升级到 0.5.0 或以上。</li>
              <li>打开同舟智数「妙手排单」页，点「登录妙手」登录一次。</li>
              <li>1 分钟内妙手「自动标记」里的规则会出现在这里，勾选要托管的规则并保存。</li>
            </ol>
          </div>
        ) : null}

        {data?.rules.length ? (
          <div className="cc-table-wrap">
            <table className="cc-table mr-table">
              <thead>
                <tr><th>托管</th><th>妙手规则</th><th>开启</th><th>关闭</th><th>现在应为</th><th>妙手实际</th><th>下次变化</th><th>手动</th></tr>
              </thead>
              <tbody>
                {data.rules.map((rule) => {
                  const draft = drafts[rule.ruleId] || draftOf(rule);
                  const actual = stateLabel(rule);
                  return (
                    <tr key={rule.ruleId} className={draft.managed ? "" : "mr-off"}>
                      <td><input type="checkbox" checked={draft.managed} disabled={!canEdit || !rule.exists && !rule.managed} onChange={(event) => edit(rule.ruleId, { managed: event.target.checked })} aria-label={`托管 ${rule.name}`} /></td>
                      <td><strong>{rule.name}</strong><small>{rule.shopCount ? `${rule.shopCount} 个店铺` : ""}{rule.detail ? ` · ${rule.detail}` : ""}</small></td>
                      <td><input className="mr-time" value={draft.onTime} disabled={!canEdit || !draft.managed} onChange={(event) => edit(rule.ruleId, { onTime: event.target.value.trim() })} placeholder="11:00" inputMode="numeric" aria-label={`${rule.name} 开启时间`} /></td>
                      <td><input className="mr-time" value={draft.offTime} disabled={!canEdit || !draft.managed} onChange={(event) => edit(rule.ruleId, { offTime: event.target.value.trim() })} placeholder="23:00" inputMode="numeric" aria-label={`${rule.name} 关闭时间`} /></td>
                      <td>
                        {rule.managed && rule.desiredOn !== null ? (
                          <>
                            <span className={`cc-tag ${rule.desiredOn ? "good" : "muted"}`}>{rule.desiredOn ? "开启" : "关闭"}</span>
                            {rule.desiredSource === "override" ? <small>手动，到 {beijingClock(rule.override?.until)}</small> : null}
                          </>
                        ) : <span className="cc-muted">不托管</span>}
                      </td>
                      <td>
                        <span className={`cc-tag ${actual.tone}`}>{actual.text}</span>
                        {rule.managed && rule.inSync === false ? <small className="mr-wait">等待节点执行</small> : null}
                      </td>
                      <td>{rule.managed && rule.nextChangeAt ? beijingClock(rule.nextChangeAt) : "—"}</td>
                      <td>
                        {canEdit && rule.managed ? (
                          <div className="mr-actions">
                            <button type="button" className="cc-btn" disabled={Boolean(busy)} onClick={() => override(rule, "on")} title="立即开启，保持到下一个计划时间点"><Power size={13} />开</button>
                            <button type="button" className="cc-btn" disabled={Boolean(busy)} onClick={() => override(rule, "off")} title="立即关闭，保持到下一个计划时间点"><PowerOff size={13} />关</button>
                            {rule.override ? <button type="button" className="cc-btn" disabled={Boolean(busy)} onClick={() => override(rule, "auto")} title="取消手动，恢复按时间表"><RotateCcw size={13} />恢复</button> : null}
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="cc-panel mr-panel">
        <h4>最近开关记录</h4>
        {data?.events.length ? (
          <div className="cc-table-wrap">
            <table className="cc-table">
              <thead><tr><th>时间</th><th>规则</th><th>操作</th><th>来源</th><th>结果</th></tr></thead>
              <tbody>
                {data.events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTime(event.at)}</td>
                    <td>{event.name}</td>
                    <td>{event.action === "on" ? "开启" : "关闭"}</td>
                    <td>{event.trigger === "override" ? "手动" : "定时"}</td>
                    <td><span className={`cc-tag ${event.ok ? "good" : "bad"}`}>{event.ok ? "成功" : "失败"}</span>{event.message ? <small> {event.message}</small> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="cc-muted">还没有记录。规则被托管后，每次开关都会记在这里。</p>}
      </section>
    </div>
  );
}

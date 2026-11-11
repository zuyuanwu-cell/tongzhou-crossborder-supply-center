import React from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Image as ImageIcon, PlayCircle, RefreshCw, RotateCcw, ShieldCheck, Wrench, X } from "lucide-react";
import {
  fetchCollectorEvidence,
  fetchCollectorQuality,
  fetchCollectorScreenshot,
  recollectShopData,
  runCollectorQuality,
  updateCollectorQualitySettings,
  type CollectorEvidence,
  type CollectorQualityPayload,
  type QualityCell,
  type QualityField,
  type QualityRow,
  type QualityStatus,
} from "../api";

// 店铺日报数据质量：每个店铺最近几天的数据是否可信，中台自动补采，处理不了的列为人工事项。

const STATUS: Record<QualityStatus, { label: string; short: string; tone: string; hint: string }> = {
  verified: { label: "已核验", short: "✓", tone: "verified", hint: "与 Shopee 后台页面逐项核对一致" },
  ok: { label: "已采集", short: "●", tone: "ok", hint: "已采集，未做页面核对（较早日期只在当天核对一次）" },
  warning: { label: "需留意", short: "!", tone: "warning", hint: "数据可用，但有需要留意的地方" },
  refresh: { label: "旧口径", short: "旧", tone: "refresh", hint: "访客数是旧口径，会自动按新口径补采" },
  pending: { label: "等出数", short: "…", tone: "pending", hint: "Shopee 还没生成这一天的部分数据，会自动补采" },
  incomplete: { label: "缺字段", short: "缺", tone: "bad", hint: "部分字段没取到，会自动补采" },
  error: { label: "有误", short: "✕", tone: "bad", hint: "与后台页面不一致或数据矛盾，会自动补采" },
  missing: { label: "缺失", short: "—", tone: "bad", hint: "没有这一天的数据，会自动补采" },
};

const FIELDS: { key: QualityField; label: string; money?: boolean }[] = [
  { key: "payAmount", label: "支付金额", money: true },
  { key: "orderCount", label: "订单数" },
  { key: "visitors", label: "访客数" },
  { key: "impressions", label: "曝光" },
  { key: "addToCart", label: "加购" },
  { key: "adOnsite", label: "站内广告费", money: true },
];

function formatNumber(value: number | null | undefined, money = false) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: money ? 2 : 0 });
}

function formatTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function shortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

const ACTION_LABEL: Record<string, string> = {
  backfill: "自动补采",
  manual_backfill: "手动补采",
  backfill_failed: "补采下发失败",
};

type Selected = { row: QualityRow; date: string };

export function DataQuality({ canEdit = true }: { canEdit?: boolean }) {
  const [data, setData] = React.useState<CollectorQualityPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [filter, setFilter] = React.useState<"attention" | "all">("all");
  const [selected, setSelected] = React.useState<Selected | null>(null);

  const load = React.useCallback(async (refresh = false) => {
    try {
      setData(await fetchCollectorQuality(refresh));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取数据质量失败");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    const timer = window.setInterval(() => load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (actError) {
      setNotice(actError instanceof Error ? actError.message : "操作失败");
    } finally {
      setBusy("");
    }
  }

  const runNow = () => act("run", async () => {
    const result = await runCollectorQuality();
    setData(result);
    const created = result.created || [];
    return created.length
      ? `已检查完，给 ${created.length} 个节点下发了补采：${created.map((item) => `${item.nodeName}（${item.storeIds.length} 店，${item.note}）`).join("；")}`
      : "已检查完，目前没有需要自动补采的数据。";
  });

  const toggleAuto = () => act("auto", async () => {
    if (!data) return;
    const { settings } = await updateCollectorQualitySettings({ autoBackfill: !data.settings.autoBackfill });
    setData({ ...data, settings });
    return settings.autoBackfill ? "已开启自动补采。" : "已关闭自动补采（只检查、不下发）。";
  });

  const rows = data?.rows || [];
  const dates = React.useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) for (const date of row.dates) set.add(date);
    return [...set].sort().reverse().slice(0, data?.settings.windowDays || 7);
  }, [rows, data?.settings.windowDays]);
  const attention = (row: QualityRow) => Object.values(row.cells).some((cell) => !["verified", "ok", "refresh", "pending"].includes(cell.status));
  const visibleRows = filter === "attention" ? rows.filter(attention) : rows;
  const yesterday = data?.stats?.yesterday || {};
  const latestTotal = Object.values(yesterday).reduce((sum, value) => sum + (value || 0), 0);
  const needFix = (yesterday.missing || 0) + (yesterday.error || 0) + (yesterday.incomplete || 0);

  return (
    <div className="dq">
      <div className="dq-summary">
        <div className="dq-card verified"><strong>{yesterday.verified || 0}</strong><span>昨天 已核验</span><small>与 Shopee 后台页面一致</small></div>
        <div className="dq-card ok"><strong>{(yesterday.ok || 0) + (yesterday.warning || 0)}</strong><span>昨天 已采集</span><small>未核对或有提示</small></div>
        <div className="dq-card pending"><strong>{(yesterday.pending || 0) + (yesterday.refresh || 0)}</strong><span>自动处理中</span><small>等出数 / 旧口径补采</small></div>
        <div className={`dq-card ${needFix ? "bad" : ""}`}><strong>{needFix}</strong><span>昨天 缺失/有误</span><small>{latestTotal ? `共 ${latestTotal} 个店铺` : "—"}</small></div>
        <div className={`dq-card ${data?.manual.length ? "bad" : "verified"}`}><strong>{data?.manual.length || 0}</strong><span>需要人工处理</span><small>其余由系统自动补采</small></div>
      </div>

      <div className="dq-toolbar">
        <span className="cc-muted">
          最近检查：{formatTime(data?.evaluatedAt)}{data?.lastCycle ? ` · 上次自动巡检 ${formatTime(data.lastCycle.at)}（下发 ${data.lastCycle.actions} 次补采）` : ""} · 每 20 分钟自动检查一次
          {data?.stats?.legacyCells ? ` · 另有 ${data.stats.legacyCells} 天的历史数据是旧口径访客，正在自动重采` : ""}
        </span>
        <div className="dq-toolbar-actions">
          <label className="cc-check"><input type="checkbox" checked={filter === "attention"} onChange={(event) => setFilter(event.target.checked ? "attention" : "all")} />只看有问题的店铺</label>
          {canEdit && data ? (
            <button type="button" className={`cc-btn ${data.settings.autoBackfill ? "" : "danger"}`} onClick={toggleAuto} disabled={busy === "auto"}>
              <ShieldCheck size={14} />自动补采：{data.settings.autoBackfill ? "开" : "关"}
            </button>
          ) : null}
          {canEdit ? <button type="button" className="cc-btn primary" onClick={runNow} disabled={busy === "run"}><PlayCircle size={14} />{busy === "run" ? "检查中…" : "立即检查并补采"}</button> : null}
          <button type="button" className="cc-btn" onClick={() => load(true)}><RefreshCw size={14} />刷新</button>
        </div>
      </div>

      {error ? <div className="cc-notice bad"><AlertTriangle size={15} />{error}</div> : null}
      {notice ? <div className="cc-notice"><CheckCircle2 size={15} />{notice}<button type="button" onClick={() => setNotice("")}><X size={13} /></button></div> : null}

      {data?.manual.length ? (
        <section className="dq-manual">
          <h5><Wrench size={15} />需要人工处理（{data.manual.length}）</h5>
          <ul>
            {data.manual.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                <div className="dq-manual-title">
                  <b>{item.title}</b>
                  <span>{[item.shopName || item.storeName, item.nodeName].filter(Boolean).join(" · ")}{item.dates.length ? ` · ${item.dates.map(shortDate).join("、")}` : ""}</span>
                </div>
                <p>{item.action}</p>
                {item.message ? <small className="cc-muted">{item.message}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : data && !loading ? (
        <div className="dq-allgood"><CheckCircle2 size={16} />没有需要人工处理的事项，缺失和异常的数据会自动补采。</div>
      ) : null}

      <div className="cc-table-wrap">
        <table className="dq-matrix">
          <thead>
            <tr>
              <th>店铺</th>
              <th>采集节点</th>
              {dates.map((date) => <th key={date} className="dq-date">{shortDate(date)}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const owner = row.owners.find((item) => item.online) || row.owners[0];
              return (
                <tr key={row.shopKey}>
                  <td className="dq-shop"><b>{row.shopName}</b><small>{row.site}</small></td>
                  <td className="dq-owner">{owner ? <>{owner.nodeName}<small className={owner.online ? "" : "bad"}>{owner.online ? owner.storeName : "离线"}</small></> : <span className="bad">无</span>}</td>
                  {dates.map((date) => {
                    const cell: QualityCell | undefined = row.cells[date];
                    if (!cell) return <td key={date} className="dq-cell empty" />;
                    const meta = STATUS[cell.status];
                    return (
                      <td key={date} className="dq-cell">
                        <button type="button" className={`dq-chip ${meta.tone}`} title={[meta.hint, ...cell.issues.map((issue) => issue.message)].join("\n")} onClick={() => setSelected({ row, date })}>
                          {meta.short}<span>{meta.label}</span>{cell.hasScreenshot ? <ImageIcon size={10} /> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!visibleRows.length ? <tr><td colSpan={dates.length + 2} className="cc-muted">{loading ? "读取中…" : filter === "attention" ? "所有店铺最近几天的数据都正常。" : "还没有采集数据。在采集电脑上登录同舟智数后会出现在这里。"}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="dq-legend">
        {(Object.keys(STATUS) as QualityStatus[]).reverse().map((status) => <span key={status}><i className={`dq-chip ${STATUS[status].tone}`}>{STATUS[status].short}</i>{STATUS[status].label}</span>)}
      </div>

      {data?.actions.length ? (
        <section className="dq-actions">
          <h5>最近的自动处理</h5>
          <ul>
            {data.actions.slice(0, 12).map((item, index) => (
              <li key={index}>
                <span>{formatTime(item.at)}</span>
                <b className={item.type === "backfill_failed" ? "bad" : ""}>{ACTION_LABEL[item.type] || item.type}</b>
                <span>{item.nodeName}{item.storeIds ? ` · ${item.storeIds.length} 店` : ""}{item.dates?.length ? ` · ${item.dates.length > 1 ? `${shortDate(item.dates[0])}~${shortDate(item.dates[item.dates.length - 1])}` : shortDate(item.dates[0])}` : ""}</span>
                <small className="cc-muted">{item.note}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {selected ? <EvidenceDrawer selected={selected} canEdit={canEdit} onClose={() => setSelected(null)} onRecollected={(message) => { setNotice(message); load(); }} /> : null}
    </div>
  );
}

function EvidenceDrawer({ selected, canEdit, onClose, onRecollected }: { selected: Selected; canEdit: boolean; onClose: () => void; onRecollected: (message: string) => void }) {
  const { row, date } = selected;
  const cell = row.cells[date];
  const meta = STATUS[cell.status];
  const [evidence, setEvidence] = React.useState<CollectorEvidence | null>(null);
  const [evidenceError, setEvidenceError] = React.useState("");
  const [image, setImage] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    let objectUrl = "";
    setEvidence(null);
    setEvidenceError("");
    setImage("");
    if (cell.hasEvidence) {
      fetchCollectorEvidence(row.shopKey, date).then((result) => alive && setEvidence(result)).catch((error) => alive && setEvidenceError(error instanceof Error ? error.message : "读取证据失败"));
    }
    if (cell.hasScreenshot) {
      fetchCollectorScreenshot(row.shopKey, date).then((url) => {
        objectUrl = url;
        if (alive) setImage(url);
        else URL.revokeObjectURL(url);
      }).catch(() => undefined);
    }
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [row.shopKey, date, cell.hasEvidence, cell.hasScreenshot]);

  const recollect = async (dates: string[]) => {
    setBusy(true);
    try {
      const result = await recollectShopData(row.shopKey, dates);
      onRecollected(`已让「${result.nodeName}」补采 ${result.storeName} 的 ${dates.length} 天数据，1 分钟内开始。`);
      onClose();
    } catch (error) {
      onRecollected(error instanceof Error ? error.message : "下发补采失败");
    } finally {
      setBusy(false);
    }
  };

  const page = evidence?.summary.pageCheck || null;
  return (
    <div className="dq-drawer-backdrop" onClick={onClose}>
      <aside className="dq-drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h4>{row.shopName}<span>{date}</span></h4>
            <span className={`dq-chip ${meta.tone}`}>{meta.short}<span>{meta.label}</span></span>
            <small className="cc-muted">{meta.hint}</small>
          </div>
          <button type="button" className="cc-btn" onClick={onClose}><X size={14} /></button>
        </header>

        {cell.issues.length ? (
          <ul className="dq-issues">
            {cell.issues.map((issue, index) => <li key={index} className={issue.level}>{issue.message}</li>)}
          </ul>
        ) : null}

        <table className="cc-table dq-values">
          <thead><tr><th>指标</th><th className="num">日报数值</th><th className="num">Shopee 后台页面</th><th /></tr></thead>
          <tbody>
            {FIELDS.map((field) => {
              const check = page?.fields?.[field.key];
              return (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  <td className="num">{formatNumber(cell.values?.[field.key], field.money)}</td>
                  <td className="num">{check ? check.pageText || formatNumber(check.page, field.money) : <span className="cc-muted">—</span>}</td>
                  <td>{check ? (check.match ? <span className="cc-tag good">一致</span> : <span className="cc-tag bad">不一致</span>) : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {page ? (
          <p className="cc-muted">
            页面核对：{page.message}{page.orderType ? `（订单口径：${page.orderType}）` : ""} · {formatTime(page.at)}{page.carried ? " · 之后的补采数字未变，沿用核对结果" : ""}
          </p>
        ) : cell.hasEvidence ? <p className="cc-muted">这一天没有做页面核对（只核对每个店铺的「昨天」）。</p> : null}

        {canEdit ? (
          <div className="dq-drawer-actions">
            <button type="button" className="cc-btn primary" disabled={busy || !row.owners.length} onClick={() => recollect([date])}><RotateCcw size={14} />立即补采这一天</button>
            <button type="button" className="cc-btn" disabled={busy || !row.owners.length} onClick={() => recollect(row.dates)}><RotateCcw size={14} />补采最近 {row.dates.length} 天</button>
            {!row.owners.length ? <small className="bad">没有采集节点负责这个店铺</small> : null}
          </div>
        ) : null}

        {image ? (
          <figure className="dq-shot">
            <figcaption>采集时的 Shopee 后台截图（昨天 · 已付款订单）<a href={image} target="_blank" rel="noreferrer"><ExternalLink size={12} />打开原图</a></figcaption>
            <img src={image} alt={`${row.shopName} ${date} Shopee 后台截图`} />
          </figure>
        ) : null}

        <section className="dq-evidence">
          <h5>采集证据</h5>
          {!cell.hasEvidence ? <p className="cc-muted">这一天的数据是旧版本采集的，没有留证；补采后会有。</p> : null}
          {evidenceError ? <p className="bad">{evidenceError}</p> : null}
          {evidence ? (
            <>
              <p className="cc-muted">{evidence.summary.storeName} · 采集于 {formatTime(evidence.summary.collectedAt)} · 模板版本 v{evidence.summary.templateVersion}</p>
              {Object.entries(evidence.endpoints).map(([id, endpoint]) => (
                <details key={id}>
                  <summary>{endpoint.label} <span className={endpoint.error ? "bad" : "cc-muted"}>{endpoint.error || `HTTP ${endpoint.status} · ${endpoint.ms}ms`}</span></summary>
                  <pre>{JSON.stringify(endpoint.data, null, 2)}</pre>
                </details>
              ))}
            </>
          ) : null}
        </section>
      </aside>
    </div>
  );
}

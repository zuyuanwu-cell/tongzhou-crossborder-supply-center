import React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  Users,
  Warehouse,
} from "lucide-react";
import { fetchReviewCenter, type ReviewCenterCount, type ReviewCenterPayload } from "./api";
import "./review-center.css";

const statusLabels: Record<string, string> = {
  pending_warehouse: "待接单",
  processing: "处理中",
  awaiting_reshipment: "待补发",
  shipped: "已发出",
  rejected: "已驳回",
  completed: "已完结",
  resolved: "已解决",
  cancelled: "已作废",
};

const chartColors = ["#f45b16", "#0f5fb4", "#16a085", "#f1a21b", "#7656c7", "#d33f62"];

function chinaDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value || 0);
}

function formatTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function chinaDateKey(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3_600_000).toISOString().slice(0, 10) : "";
}

function duration(value: number | null) {
  if (!Number.isFinite(value)) return "未响应";
  if (Number(value) < 1) return `${Math.max(1, Math.round(Number(value) * 60))}m`;
  return `${formatNumber(Number(value))}h`;
}

function EmptyChart({ label = "当前周期暂无数据" }: { label?: string }) {
  return <div className="review-empty"><Activity size={22} /><span>{label}</span></div>;
}

function BarList({
  rows,
  selected,
  onSelect,
  limit = 8,
  suffix = "",
}: {
  rows: ReviewCenterCount[];
  selected?: string;
  onSelect?: (label: string) => void;
  limit?: number;
  suffix?: string;
}) {
  const visible = rows.slice(0, limit);
  const max = Math.max(1, ...visible.map((row) => row.count));
  if (!visible.length) return <EmptyChart />;
  return (
    <div className="review-bars">
      {visible.map((row, index) => (
        <button
          className={selected === row.label ? "is-selected" : ""}
          key={row.label}
          type="button"
          onClick={() => onSelect?.(selected === row.label ? "" : row.label)}
          title={`${row.label}：${row.count}${suffix}`}
        >
          <span className="review-bar-rank">{String(index + 1).padStart(2, "0")}</span>
          <span className="review-bar-label">{row.label}</span>
          <span className="review-bar-track"><i style={{ width: `${Math.max(3, row.count / max * 100)}%` }} /></span>
          <strong>{formatNumber(row.count)}{suffix}</strong>
        </button>
      ))}
    </div>
  );
}

function TrendChart({
  payload,
  selectedDay,
  onSelect,
}: {
  payload: ReviewCenterPayload;
  selectedDay: string;
  onSelect: (date: string) => void;
}) {
  const rows = payload.usage.daily;
  const width = 760;
  const height = 220;
  const pad = { left: 32, right: 18, top: 20, bottom: 32 };
  const max = Math.max(1, ...rows.map((row) => row.operations));
  const x = (index: number) => pad.left + (rows.length <= 1 ? 0 : index / (rows.length - 1) * (width - pad.left - pad.right));
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const points = rows.map((row, index) => `${x(index)},${y(row.operations)}`).join(" ");
  const area = rows.length ? `${pad.left},${height - pad.bottom} ${points} ${x(rows.length - 1)},${height - pad.bottom}` : "";
  if (!rows.length) return <EmptyChart />;
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
  return (
    <div className="review-trend-wrap">
      <svg className="review-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="操作趋势，点击数据点筛选当天明细">
        {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad.left} x2={width - pad.right} y1={y(max * ratio)} y2={y(max * ratio)} className="review-grid-line" />)}
        {area ? <polygon points={area} className="review-area" /> : null}
        <polyline points={points} className="review-line" />
        {rows.map((row, index) => (
          <g
            key={row.date}
            className={`review-point ${selectedDay === row.date ? "is-selected" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(selectedDay === row.date ? "" : row.date)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(selectedDay === row.date ? "" : row.date); }}
          >
            <circle cx={x(index)} cy={y(row.operations)} r={selectedDay === row.date ? 7 : 4.5} />
            <title>{`${row.date} · ${row.operations} 次操作 · ${row.users} 位用户`}</title>
          </g>
        ))}
        {rows.map((row, index) => (index % labelEvery === 0 || index === rows.length - 1) ? (
          <text key={row.date} x={x(index)} y={height - 8} textAnchor="middle">{row.date.slice(5)}</text>
        ) : null)}
      </svg>
      <div className="review-chart-legend"><i className="operations" />操作次数 <span>点选日期联动明细</span></div>
    </div>
  );
}

function Heatmap({ payload }: { payload: ReviewCenterPayload }) {
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const max = Math.max(1, ...payload.usage.heatmap.flatMap((row) => row.hours));
  return (
    <div className="review-heatmap" aria-label="用户活跃时段热力图">
      <div className="review-heat-hours"><span />{[0, 4, 8, 12, 16, 20].map((hour) => <b key={hour} style={{ gridColumn: `${hour + 2} / span 4` }}>{String(hour).padStart(2, "0")}</b>)}</div>
      {payload.usage.heatmap.map((row) => (
        <div className="review-heat-row" key={row.weekday}>
          <strong>{weekdays[row.weekday]}</strong>
          {row.hours.map((count, hour) => (
            <i key={hour} style={{ "--heat": String(count / max) } as React.CSSProperties} title={`周${weekdays[row.weekday]} ${String(hour).padStart(2, "0")}:00 · ${count} 次`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Donut({ rows, selected, onSelect }: { rows: ReviewCenterCount[]; selected: string; onSelect: (label: string) => void }) {
  const visible = rows.slice(0, 6);
  const total = visible.reduce((sum, row) => sum + row.count, 0);
  let cursor = 0;
  const stops = visible.map((row, index) => {
    const start = cursor;
    cursor += total ? row.count / total * 100 : 0;
    return `${chartColors[index]} ${start}% ${cursor}%`;
  }).join(", ");
  if (!visible.length) return <EmptyChart />;
  return (
    <div className="review-donut-layout">
      <div className="review-donut" style={{ background: `conic-gradient(${stops})` }}><span><strong>{total}</strong><small>售后单</small></span></div>
      <div className="review-donut-legend">
        {visible.map((row, index) => (
          <button key={row.label} className={selected === row.label ? "is-selected" : ""} type="button" onClick={() => onSelect(selected === row.label ? "" : row.label)}>
            <i style={{ background: chartColors[index] }} /><span>{row.label}</span><strong>{row.count}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReviewCenter() {
  const [from, setFrom] = React.useState(chinaDate(-29));
  const [to, setTo] = React.useState(chinaDate());
  const [payload, setPayload] = React.useState<ReviewCenterPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [selectedDay, setSelectedDay] = React.useState("");
  const [selectedActor, setSelectedActor] = React.useState("");
  const [selectedAction, setSelectedAction] = React.useState("");
  const [selectedWarehouse, setSelectedWarehouse] = React.useState("");
  const [selectedStatus, setSelectedStatus] = React.useState("");
  const [selectedReason, setSelectedReason] = React.useState("");
  const [detailMode, setDetailMode] = React.useState<"activity" | "tickets">("activity");

  const load = React.useCallback(async (nextFrom = from, nextTo = to) => {
    setLoading(true);
    setError("");
    try {
      setPayload(await fetchReviewCenter({ from: nextFrom, to: nextTo }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "复盘数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  React.useEffect(() => { void load(); }, []);

  function applyPreset(days: number) {
    const nextFrom = chinaDate(-(days - 1));
    const nextTo = chinaDate();
    setFrom(nextFrom);
    setTo(nextTo);
    setSelectedDay("");
    void load(nextFrom, nextTo);
  }

  function clearFilters() {
    setSelectedDay("");
    setSelectedActor("");
    setSelectedAction("");
    setSelectedWarehouse("");
    setSelectedStatus("");
    setSelectedReason("");
  }

  const actorRows = React.useMemo(() => payload?.usage.actors.map((actor) => ({ label: actor.name, count: actor.count, share: 0 })) || [], [payload]);
  const activityRows = React.useMemo(() => (payload?.usage.entries || []).filter((entry) => (
    (!selectedDay || chinaDateKey(entry.createdAt) === selectedDay)
    && (!selectedActor || entry.actorName === selectedActor)
    && (!selectedAction || entry.action === selectedAction)
  )), [payload, selectedDay, selectedActor, selectedAction]);
  const ticketRows = React.useMemo(() => (payload?.collaboration.tickets || []).filter((ticket) => (
    (!selectedDay || chinaDateKey(ticket.createdAt) === selectedDay)
    && (!selectedWarehouse || ticket.warehouseName === selectedWarehouse)
    && (!selectedStatus || ticket.status === selectedStatus)
    && (!selectedReason || ticket.reason === selectedReason)
  )), [payload, selectedDay, selectedWarehouse, selectedStatus, selectedReason]);
  const hasFilters = Boolean(selectedDay || selectedActor || selectedAction || selectedWarehouse || selectedStatus || selectedReason);

  if (!payload && loading) return <main className="review-center-page"><div className="review-loading"><RefreshCw className="spinning" /><span>正在生成复盘视图…</span></div></main>;
  if (!payload) return <main className="review-center-page"><div className="review-fatal"><AlertTriangle /><strong>复盘中心暂时不可用</strong><span>{error}</span><button type="button" onClick={() => void load()}>重新读取</button></div></main>;

  const overview = payload.overview;
  const maxWarehouseTasks = Math.max(1, ...payload.collaboration.warehouses.map((warehouse) => warehouse.total));
  const activePreset = payload.range.days <= 7 ? 7 : payload.range.days <= 30 ? 30 : payload.range.days <= 90 ? 90 : 0;

  return (
    <main className="review-center-page">
      <section className="review-command-bar">
        <div className="review-command-title">
          <span><Activity size={17} /> ADMIN REVIEW</span>
          <h2>复盘中心</h2>
          <p>行为、协同、售后，一屏回看</p>
        </div>
        <div className="review-range-controls">
          <div className="review-presets">{[7, 30, 90].map((days) => <button className={activePreset === days ? "active" : ""} type="button" key={days} onClick={() => applyPreset(days)}>{days}天</button>)}</div>
          <label><CalendarDays size={15} /><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
          <span className="review-range-arrow">→</span>
          <label><input type="date" value={to} min={from} max={chinaDate()} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="review-query" type="button" disabled={loading} onClick={() => { setSelectedDay(""); void load(); }}><RefreshCw size={15} className={loading ? "spinning" : ""} />更新</button>
        </div>
      </section>

      {error ? <div className="review-warning"><AlertTriangle size={16} />{error}，当前保留上一次成功数据。</div> : null}

      <section className="review-kpis">
        <article><span><Users size={17} />活跃用户</span><strong>{overview.activeUsers}</strong><small>{overview.operationsPerUser} 次 / 人</small></article>
        <article><span><MousePointer2 size={17} />有效操作</span><strong>{formatNumber(overview.operations)}</strong><small>{payload.range.days} 天</small></article>
        <article><span><Warehouse size={17} />协同任务</span><strong>{overview.collaborationTasks}</strong><small>{overview.openTasks} 待闭环</small></article>
        <article className={overview.collaborationTasks && overview.responseSlaRate < 80 ? "attention" : "healthy"}><span><Clock3 size={17} />24h 响应</span><strong>{overview.collaborationTasks ? `${overview.responseSlaRate}%` : "—"}</strong><small>中位 {overview.collaborationTasks ? duration(overview.medianResponseHours) : "—"}</small></article>
        <article className={overview.collaborationTasks && overview.completionRate < 70 ? "attention" : "healthy"}><span><CheckCircle2 size={17} />闭环率</span><strong>{overview.collaborationTasks ? `${overview.completionRate}%` : "—"}</strong><small>72h 达标 {overview.collaborationTasks ? `${overview.closeSlaRate}%` : "—"}</small></article>
        <article className={overview.overdueTasks ? "danger" : "healthy"}><span><AlertTriangle size={17} />逾期未响应</span><strong>{overview.overdueTasks}</strong><small>需优先跟进</small></article>
      </section>

      <section className="review-grid review-grid-usage">
        <article className="review-panel review-panel-wide">
          <header><div><span>USAGE PULSE</span><h3>用户使用趋势</h3></div><strong>{formatNumber(overview.operations)}<small>次</small></strong></header>
          <TrendChart payload={payload} selectedDay={selectedDay} onSelect={(day) => { setSelectedDay(day); setDetailMode("activity"); }} />
        </article>
        <article className="review-panel">
          <header><div><span>TOP USERS</span><h3>用户使用排行</h3></div><Users size={20} /></header>
          <BarList rows={actorRows} selected={selectedActor} onSelect={(actor) => { setSelectedActor(actor); setDetailMode("activity"); }} />
        </article>
        <article className="review-panel">
          <header><div><span>TOP ACTIONS</span><h3>高频行为</h3></div><MousePointer2 size={20} /></header>
          <BarList rows={payload.usage.actions} selected={selectedAction} onSelect={(action) => { setSelectedAction(action); setDetailMode("activity"); }} />
        </article>
        <article className="review-panel review-panel-heatmap">
          <header><div><span>ACTIVE HOURS</span><h3>使用时段热力</h3></div><Clock3 size={20} /></header>
          <Heatmap payload={payload} />
        </article>
      </section>

      <section className="review-section-heading"><div><span>OVERSEAS COLLABORATION</span><h2>海外仓协同</h2></div><p>响应 SLA {payload.thresholds.responseSlaHours}h · 闭环 SLA {payload.thresholds.closeSlaHours}h</p></section>
      <section className="review-grid review-grid-collaboration">
        <article className="review-panel">
          <header><div><span>WORKFLOW</span><h3>当前任务状态</h3></div><strong>{overview.openTasks}<small>进行中</small></strong></header>
          <div className="review-status-stack">
            {payload.collaboration.statuses.map((row) => (
              <button className={`${row.tone} ${selectedStatus === row.status ? "is-selected" : ""}`} type="button" key={row.label} onClick={() => { setSelectedStatus(selectedStatus === row.status ? "" : row.status); setDetailMode("tickets"); }}>
                <span>{row.label}</span><strong>{row.count}</strong><i style={{ width: `${Math.max(4, row.share || 0)}%` }} />
              </button>
            ))}
          </div>
        </article>
        <article className="review-panel review-panel-wide">
          <header><div><span>WAREHOUSE SCOREBOARD</span><h3>仓库协同表现</h3></div><Warehouse size={20} /></header>
          {payload.collaboration.warehouses.length ? <div className="review-warehouse-table">
            <div className="review-warehouse-head"><span>仓库</span><span>任务</span><span>响应</span><span>闭环</span><span>逾期</span></div>
            {payload.collaboration.warehouses.slice(0, 8).map((warehouse) => (
              <button type="button" className={selectedWarehouse === warehouse.name ? "is-selected" : ""} key={warehouse.id} onClick={() => { setSelectedWarehouse(selectedWarehouse === warehouse.name ? "" : warehouse.name); setDetailMode("tickets"); }}>
                <span><strong>{warehouse.name}</strong><i><b style={{ width: `${warehouse.total / maxWarehouseTasks * 100}%` }} /></i></span>
                <strong>{warehouse.total}</strong><span>{warehouse.responseSlaRate}%</span><span>{warehouse.completionRate}%</span><em className={warehouse.overdue ? "has-risk" : ""}>{warehouse.overdue}</em>
              </button>
            ))}
          </div> : <EmptyChart label="本周期暂无协同任务" />}
        </article>
        <article className="review-panel">
          <header><div><span>RESPONSE TIME</span><h3>首次响应分布</h3></div><Clock3 size={20} /></header>
          <BarList rows={payload.collaboration.responseBands} suffix="" limit={6} />
        </article>
      </section>

      <section className="review-section-heading"><div><span>AFTER-SALES ATTRIBUTION</span><h2>售后归因</h2></div><p>{payload.afterSales.total} 单 · 催办 {payload.afterSales.reminderCount} · 驳回 {payload.afterSales.rejectionCount}</p></section>
      <section className="review-grid review-grid-after-sales">
        <article className="review-panel review-panel-wide">
          <header><div><span>ROOT CAUSE</span><h3>售后原因构成</h3></div><strong>¥{formatNumber(payload.afterSales.liabilityCny)}<small>仓责金额</small></strong></header>
          <Donut rows={payload.afterSales.reasons} selected={selectedReason} onSelect={(reason) => { setSelectedReason(reason); setDetailMode("tickets"); }} />
        </article>
        <article className="review-panel">
          <header><div><span>HANDLING</span><h3>处理方式</h3></div><ArrowRight size={20} /></header>
          <BarList rows={payload.afterSales.secondaryReasons} limit={6} />
        </article>
        <article className="review-panel">
          <header><div><span>RESPONSIBILITY</span><h3>责任归属</h3></div><AlertTriangle size={20} /></header>
          <BarList rows={payload.afterSales.responsibility} limit={6} />
        </article>
      </section>

      <section className="review-drilldown">
        <header>
          <div><span>DRILL DOWN</span><h2>明细下钻</h2></div>
          <div className="review-detail-tabs">
            <button className={detailMode === "activity" ? "active" : ""} type="button" onClick={() => setDetailMode("activity")}>操作 {activityRows.length}</button>
            <button className={detailMode === "tickets" ? "active" : ""} type="button" onClick={() => setDetailMode("tickets")}>协同 {ticketRows.length}</button>
            {hasFilters ? <button className="review-reset" type="button" onClick={clearFilters}><RotateCcw size={14} />清除筛选</button> : null}
          </div>
        </header>
        {hasFilters ? <div className="review-filter-chips">
          {[selectedDay, selectedActor, selectedAction, selectedWarehouse, selectedStatus ? statusLabels[selectedStatus] || selectedStatus : "", selectedReason].filter(Boolean).map((value) => <span key={value}>{value}</span>)}
        </div> : null}
        {detailMode === "activity" ? (
          <div className="review-detail-list">
            {activityRows.slice(0, 80).map((entry) => <article key={entry.id}><time>{formatTime(entry.createdAt)}</time><strong>{entry.actorName}</strong><span>{entry.action}</span><em>{entry.targetName || entry.module}</em></article>)}
            {!activityRows.length ? <EmptyChart label="没有匹配的操作记录" /> : null}
          </div>
        ) : (
          <div className="review-ticket-list">
            {ticketRows.slice(0, 80).map((ticket) => <article className={ticket.overdue ? "is-overdue" : ""} key={ticket.id}>
              <span className="review-ticket-type">{ticket.typeLabel}</span><div><strong>{ticket.subject}</strong><small>{ticket.id} · {ticket.reason}</small></div><span>{ticket.warehouseName}</span><span className={`review-ticket-status ${ticket.status}`}>{statusLabels[ticket.status] || ticket.status}</span><span>响应 {duration(ticket.responseHours)}</span><time>{formatTime(ticket.createdAt)}</time>
            </article>)}
            {!ticketRows.length ? <EmptyChart label="没有匹配的协同任务" /> : null}
          </div>
        )}
        <footer><span>更新于 {formatTime(payload.generatedAt)}</span><span>日志覆盖 {payload.coverage.actionLogStored} 条{payload.coverage.actionLogAtCapacity ? " · 已达保留上限" : ""}</span></footer>
      </section>
    </main>
  );
}

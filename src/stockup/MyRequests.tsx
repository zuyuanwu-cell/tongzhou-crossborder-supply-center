import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, CheckCircle2, Clock3, FilePenLine, PackageCheck } from "lucide-react";
import type { StockupRequest, StockupRequestListPayload } from "./types";
import { formatStockupDate, statusTone, stockupRequestStatusLabels } from "./status";

type Props = {
  payload: StockupRequestListPayload | null;
  loading: boolean;
  onOpen: (request: StockupRequest) => void;
};

export function MyRequests({ payload, loading, onOpen }: Props) {
  const [filter, setFilter] = useState<"active" | "attention" | "draft" | "completed" | "all">("active");
  const counts = payload?.counts || { drafts: 0, pendingAcceptance: 0, inProgress: 0, dueSoon: 0, exceptions: 0, completed: 0 };
  const metrics = [
    { label: "草稿", value: counts.drafts, detail: "尚未提交", icon: FilePenLine, tone: "slate" },
    { label: "待受理", value: counts.pendingAcceptance, detail: "等待供应链确认", icon: Clock3, tone: "amber" },
    { label: "进行中", value: counts.inProgress, detail: "采购、生产或运输", icon: PackageCheck, tone: "blue" },
    { label: "7天内到仓", value: counts.dueSoon, detail: "建议提前关注", icon: CalendarClock, tone: "green" },
    { label: "异常 / 逾期", value: counts.exceptions, detail: "需要优先处理", icon: AlertTriangle, tone: "red" },
  ];
  const visibleItems = useMemo(() => (payload?.items || []).filter((request) => {
    if (filter === "all") return true;
    if (filter === "draft") return request.status === "draft";
    if (filter === "completed") return request.status === "completed";
    if (filter === "attention") return request.isOverdue || ["needs_changes", "rejected"].includes(request.status);
    return !["draft", "completed", "cancelled", "rejected", "needs_changes"].includes(request.status);
  }), [filter, payload?.items]);
  const filters = [
    { id: "active" as const, label: "进行中", count: counts.pendingAcceptance + counts.inProgress },
    { id: "attention" as const, label: "需处理", count: counts.exceptions },
    { id: "draft" as const, label: "草稿", count: counts.drafts },
    { id: "completed" as const, label: "已完成", count: counts.completed },
    { id: "all" as const, label: "全部", count: payload?.total || 0 },
  ];

  return (
    <>
      <div className="sc-metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return <article className={`sc-metric sc-metric-${metric.tone}`} key={metric.label}><span><Icon size={19} /></span><div><small>{metric.label}</small><strong>{metric.value}</strong><p>{metric.detail}</p></div></article>;
        })}
      </div>

      <section className="sc-panel">
        <div className="sc-panel-head"><div><span className="sc-eyebrow">MY REQUESTS</span><h3>我的备货需求</h3><p>默认展示进行中的需求，也可快速查看草稿、异常和历史完成单。</p></div><div className="sc-request-filters" role="group" aria-label="备货需求状态筛选">{filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "is-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.count}</span></button>)}</div></div>
        {loading && !payload ? <div className="sc-loading"><span />正在读取备货进度…</div> : null}
        {!loading && !visibleItems.length ? <div className="sc-empty"><Boxes size={34} /><h4>{payload?.items.length ? "当前筛选下没有需求" : "还没有备货需求"}</h4><p>{payload?.items.length ? "可切换上方状态查看其他需求。" : "点击右上角“新建需求”，一次可以提交多个产品。"}</p></div> : null}
        <div className="sc-request-list">
          {visibleItems.map((request) => (
            <button className={`sc-request-card ${request.isOverdue ? "is-overdue" : ""}`} key={request.id} onClick={() => onOpen(request)}>
              <div className="sc-request-leading">
                <span className={`sc-status-dot sc-status-${statusTone(request.status)}`} />
                <div><b>{request.requestNo}</b><small>{request.project} · {request.requesterName}</small></div>
              </div>
              <div className="sc-request-products">
                <div className="sc-product-stack">
                  {request.lines.slice(0, 3).map((line) => <span key={line.id}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <Boxes size={16} />}</span>)}
                  {request.lines.length > 3 ? <span>+{request.lines.length - 3}</span> : null}
                </div>
                <div><b>{request.lines.length === 1 ? request.lines[0].productName : `${request.lines.length} 个产品`}</b><small>{request.lines.map((line) => line.sku).slice(0, 2).join("、")}{request.lines.length > 2 ? "…" : ""}</small></div>
              </div>
              <div className="sc-request-route"><small>送往</small><b>{request.destinationWarehouseName}</b><span>{request.destinationCountry}</span></div>
              <div className="sc-request-progress"><div><span style={{ width: `${request.progress}%` }} /></div><b>{stockupRequestStatusLabels[request.status] || request.status}</b><small>{request.latestEvent?.title || "等待下一步进度"}</small></div>
              <div className="sc-request-date"><small>期望到仓</small><b>{formatStockupDate(request.expectedArrivalAt)}</b>{request.isOverdue ? <span><AlertTriangle size={13} />已逾期</span> : <span>更新 {formatStockupDate(request.updatedAt)}</span>}</div>
              <ArrowRight className="sc-card-arrow" size={19} />
            </button>
          ))}
        </div>
        {filter !== "completed" && payload?.counts.completed ? <div className="sc-completed-note"><CheckCircle2 size={16} />已有 {payload.counts.completed} 个需求完成全流程，切换“已完成”即可查看。</div> : null}
      </section>
    </>
  );
}

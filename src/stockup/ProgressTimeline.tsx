import React from "react";
import { CheckCircle2, Clock3, UserRound } from "lucide-react";
import type { StockupProgressEvent } from "./types";
import { formatStockupDate } from "./status";

export function ProgressTimeline({ events = [] }: { events?: StockupProgressEvent[] }) {
  if (!events.length) return <div className="sc-empty-inline"><Clock3 size={24} /><b>暂无进度记录</b><span>每次受理、下单、发运和到仓都会自动记录。</span></div>;
  return <div className="sc-timeline">{events.map((event, index) => (
    <article key={event.id} className={index === 0 ? "is-latest" : ""}>
      <div className="sc-timeline-rail"><span>{index === 0 ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}</span></div>
      <div className="sc-timeline-content"><div><b>{event.title}</b><time>{formatStockupDate(event.occurredAt)}</time></div>{event.description ? <p>{event.description}</p> : null}<small><UserRound size={13} />{event.actorName}</small></div>
    </article>
  ))}</div>;
}

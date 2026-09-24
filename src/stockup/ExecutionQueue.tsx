import React from "react";
import { AlertTriangle, ArrowRight, Factory, PackageCheck } from "lucide-react";
import type { StockupRequest } from "./types";
import { formatStockupDate, statusTone, stockupRequestStatusLabels } from "./status";

export function ExecutionQueue({ requests, loading, onOpen }: { requests: StockupRequest[]; loading: boolean; onOpen: (request: StockupRequest) => void }) {
  const waiting = requests.filter((request) => request.status === "pending_acceptance").length;
  const active = requests.filter((request) => ["accepted", "in_progress"].includes(request.status)).length;
  const ready = requests.filter((request) => request.status === "waiting_shipment").length;
  const exceptions = requests.filter((request) => request.exceptionCount > 0 || request.isOverdue).length;
  return <>
    <div className="sc-queue-summary"><article><span>01</span><div><small>待受理</small><b>{waiting}</b><p>确认需求与执行方式</p></div></article><article><span>02</span><div><small>执行中</small><b>{active}</b><p>采购或生产跟进</p></div></article><article><span>03</span><div><small>待发运</small><b>{ready}</b><p>完成后交给物流</p></div></article><article className="danger"><span><AlertTriangle size={18} /></span><div><small>异常 / 逾期</small><b>{exceptions}</b><p>优先处理风险单</p></div></article></div>
    <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">SUPPLY ACTION QUEUE</span><h3>供应链执行台</h3><p>每张卡片只突出当前最需要做的一件事。</p></div></div>
      {loading ? <div className="sc-loading"><span />正在加载执行队列…</div> : null}
      <div className="sc-execution-grid">{requests.filter((request) => !["draft", "cancelled", "rejected", "completed"].includes(request.status)).map((request) => <button key={request.id} onClick={() => onOpen(request)}><div className="sc-execution-top"><span className={`sc-status-badge sc-status-${statusTone(request.status)}`}>{stockupRequestStatusLabels[request.status]}</span><b>{request.requestNo}</b></div><div className="sc-execution-product"><span><Factory size={22} /></span><div><b>{request.lines.length} 个产品 · {request.lines.reduce((sum, line) => sum + line.requestedQty, 0)} 件</b><small>{request.lines.map((line) => line.sku).slice(0, 3).join("、")}</small></div></div><dl><div><dt>期望到仓</dt><dd>{formatStockupDate(request.expectedArrivalAt)}</dd></div><div><dt>目的仓</dt><dd>{request.destinationWarehouseName}</dd></div></dl><footer><span>{request.status === "pending_acceptance" ? "下一步：受理需求" : request.status === "accepted" ? "下一步：创建执行任务" : "下一步：更新采购/生产进度"}</span><ArrowRight size={18} /></footer></button>)}</div>
      {!loading && !requests.length ? <div className="sc-empty"><PackageCheck size={32} /><h4>当前没有供应链待办</h4><p>运营提交需求后会自动出现在这里。</p></div> : null}
    </section>
  </>;
}

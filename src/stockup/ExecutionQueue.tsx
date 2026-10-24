import React from "react";
import { AlertTriangle, ArrowRight, Factory, PackageCheck } from "lucide-react";
import type { StockupRequest } from "./types";
import { formatStockupDate, statusTone, stockupRequestStatusLabels } from "./status";

function isWaitingForOwner(request: StockupRequest) {
  return request.status === "pending_acceptance" || (request.workflowVersion === 2 && request.status === "submitted" && !request.assigneeId);
}

function isActive(request: StockupRequest) {
  return ["accepted", "in_progress", "purchasing"].includes(request.status)
    || (request.workflowVersion === 2 && request.status === "submitted" && Boolean(request.assigneeId));
}

function legacyNextAction(request: StockupRequest) {
  if (request.workflowVersion === 2 && request.status === "inventory_ready") return "进入物流与到仓，创建出运计划";
  if (request.workflowVersion === 2 && request.status === "inventory_reserved") return "继续创建海外仓单与发货文件";
  if (request.workflowVersion === 2 && request.status === "wms_created") return "生成装箱单、箱唛并发布发货任务";
  if (request.workflowVersion === 2 && request.status === "instruction_issued") return "确认已交货代并登记运单号";
  if (request.workflowVersion === 2 && request.status === "submitted") {
    return request.assigneeId ? "进入现货采购并登记采购单" : "认领需求并进入现货采购";
  }
  if (request.status === "pending_acceptance") return "受理需求";
  if (request.status === "accepted") return "创建执行任务";
  return "更新采购 / 生产进度";
}

export function ExecutionQueue({ requests, loading, onOpen }: { requests: StockupRequest[]; loading: boolean; onOpen: (request: StockupRequest) => void }) {
  const actionable = requests.filter((request) => !["draft", "cancelled", "rejected", "completed", "cost_locked"].includes(request.status));
  const waiting = actionable.filter(isWaitingForOwner).length;
  const active = actionable.filter(isActive).length;
  const ready = actionable.filter((request) => ["waiting_shipment", "inventory_ready", "inventory_reserved", "wms_created", "instruction_issued"].includes(request.status)).length;
  const exceptions = actionable.filter((request) => request.exceptionCount > 0 || request.isOverdue).length;
  return <>
    <div className="sc-queue-summary"><article><span>01</span><div><small>待规划</small><b>{waiting}</b><p>确认逐 SKU 履约来源</p></div></article><article><span>02</span><div><small>执行中</small><b>{active}</b><p>现货、调拨、采购或生产</p></div></article><article><span>03</span><div><small>待发运</small><b>{ready}</b><p>齐套后交给物流</p></div></article><article className="danger"><span><AlertTriangle size={18} /></span><div><small>异常 / 逾期</small><b>{exceptions}</b><p>优先处理风险单</p></div></article></div>
    <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">SUPPLY ACTION QUEUE</span><h3>供应链执行台</h3><p>系统按当前货源直接给出负责人、阻塞原因和唯一下一步。</p></div></div>
      {loading ? <div className="sc-loading"><span />正在加载执行队列…</div> : null}
      <div className="sc-execution-grid">{actionable.map((request) => { const readyToShip = request.workflowVersion === 2 && ["inventory_ready", "inventory_reserved", "wms_created", "instruction_issued"].includes(request.status); const activeLines = request.lines.filter((line) => line.status !== "procurement_cancelled" && (!readyToShip || Number(line.fulfilledQty || 0) > 0 || Number(line.allocations?.reduce((sum, item) => sum + item.readyQty, 0) || 0) > 0)); const stoppedCount = request.lines.length - activeLines.length; const owner = ({ supply_chain: "供应链负责人", procurement: "采购人员", production_followup: "生产跟单", domestic_warehouse: "国内仓", logistics: "物流人员" }[request.ownerRole || ""] || request.assigneeName || "待供应链处理"); return <button className={readyToShip ? "is-next-shipment" : ""} key={request.id} onClick={() => onOpen(request)}><div className="sc-execution-top"><span className={`sc-status-badge sc-status-${statusTone(request.status)}`}>{request.journeyStage === "route_planning" ? "待规划" : (stockupRequestStatusLabels[request.status] || request.status)}</span><b>{request.requestNo}</b></div><div className="sc-execution-product"><span>{readyToShip ? <PackageCheck size={22} /> : <Factory size={22} />}</span><div><b>{activeLines.length} 个{readyToShip ? "已齐套" : "待执行"}产品 · {activeLines.reduce((sum, line) => sum + line.requestedQty, 0)} 件</b><small>{activeLines.map((line) => line.sku).slice(0, 3).join("、")}{stoppedCount ? ` · ${stoppedCount} 个已停止` : ""}</small></div></div><dl><div><dt>当前负责人</dt><dd>{owner}</dd></div><div><dt>期望到仓 / 目的仓</dt><dd>{formatStockupDate(request.expectedArrivalAt)} · {request.destinationWarehouseName}</dd></div></dl>{request.blockers?.[0] ? <p className="sc-execution-blocker">{request.blockers[0].message}</p> : null}<footer><span>下一步：{request.nextAction?.label || legacyNextAction(request)}</span><ArrowRight size={18} /></footer></button>; })}</div>
      {!loading && !actionable.length ? <div className="sc-empty"><PackageCheck size={32} /><h4>当前没有供应链待办</h4><p>运营提交需求后会自动出现在这里。</p></div> : null}
    </section>
  </>;
}

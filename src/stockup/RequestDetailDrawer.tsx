import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CalendarClock, Check, ChevronRight, CircleDollarSign, ClipboardCheck, Factory, PackageCheck, Plus, Route, Send, Truck, X } from "lucide-react";
import { changeStockupCollaborationRequest, createStockupCollaborationTask, updateStockupCollaborationTask } from "../api";
import type { StockupExecutionTask, StockupRequest } from "./types";
import { formatStockupDate, statusTone, stockupRequestStatusLabels, stockupTaskStatusLabels } from "./status";
import { ProgressTimeline } from "./ProgressTimeline";

type Props = {
  request: StockupRequest;
  canAccept: boolean;
  canExecute: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function RequestDetailDrawer({ request, canAccept, canExecute, onClose, onChanged }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [taskLineId, setTaskLineId] = useState("");
  const [taskForm, setTaskForm] = useState({ plannedQty: 0, supplierName: "", expectedOrderAt: "", expectedCompletedAt: "" });
  const [editingTask, setEditingTask] = useState<StockupExecutionTask | null>(null);
  const [progressForm, setProgressForm] = useState({ status: "in_progress", orderedQty: 0, completedQty: 0, expectedCompletedAt: "", exceptionType: "", exceptionNote: "" });

  const taskGroups = useMemo(() => Object.fromEntries((request.lines || []).map((line) => [line.id, (request.tasks || []).filter((task) => task.lineId === line.id)])), [request.lines, request.tasks]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (editingTask) setEditingTask(null);
      else if (taskLineId) setTaskLineId("");
      else if (!busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, editingTask, onClose, taskLineId]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    try { await action(); await onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "操作失败"); }
    finally { setBusy(""); }
  }

  function openTask(lineId: string) {
    const line = request.lines.find((item) => item.id === lineId);
    const planned = (taskGroups[lineId] || []).reduce((sum, task) => sum + task.plannedQty, 0);
    setTaskLineId(lineId);
    setTaskForm({ plannedQty: Math.max(0, Number(line?.requestedQty || 0) - planned), supplierName: "", expectedOrderAt: "", expectedCompletedAt: "" });
  }

  function openProgress(task: StockupExecutionTask) {
    setEditingTask(task);
    setProgressForm({ status: task.status, orderedQty: task.orderedQty, completedQty: task.completedQty, expectedCompletedAt: task.expectedCompletedAt, exceptionType: task.exceptionType, exceptionNote: task.exceptionNote });
  }

  return (
    <div className="sc-drawer-backdrop" role="presentation">
      <aside className="sc-drawer" role="dialog" aria-modal="true" aria-label={`备货需求 ${request.requestNo}`}>
        <header className="sc-drawer-head">
          <div><span className="sc-eyebrow">REQUEST JOURNEY</span><h2>{request.requestNo}</h2><p>{request.project} · {request.destinationWarehouseName}</p></div>
          <button className="sc-icon-button" type="button" aria-label="关闭需求详情" onClick={onClose}><X size={20} /></button>
        </header>
        {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
        <div className="sc-drawer-scroll">
          <section className="sc-journey-hero">
            <div><span className={`sc-status-badge sc-status-${statusTone(request.status)}`}>{stockupRequestStatusLabels[request.status] || request.status}</span><h3>{request.progress}%</h3><p>当前流程进度</p></div>
            <div className="sc-journey-progress"><span style={{ width: `${request.progress}%` }} /></div>
            <dl><div><dt><CalendarClock size={15} />期望到仓</dt><dd>{formatStockupDate(request.expectedArrivalAt)}</dd></div><div><dt><Route size={15} />目的地</dt><dd>{request.destinationCountry} · {request.destinationWarehouseName}</dd></div><div><dt><ClipboardCheck size={15} />负责人</dt><dd>{request.assigneeName || "等待受理"}</dd></div></dl>
          </section>

          {canAccept && request.status === "pending_acceptance" ? <section className="sc-action-strip"><div><b>这张需求正在等待供应链受理</b><span>受理后可按产品创建采购或生产任务。</span></div><div><button className="sc-button sc-button-secondary" disabled={Boolean(busy)} onClick={() => run("changes", () => changeStockupCollaborationRequest(request.id, "request-changes", { note: window.prompt("请填写需要运营补充的内容") || "请补充需求资料" }))}>要求补充</button><button className="sc-button sc-button-primary" disabled={Boolean(busy)} onClick={() => run("accept", () => changeStockupCollaborationRequest(request.id, "accept"))}><Check size={17} />受理需求</button></div></section> : null}

          <section className="sc-detail-section">
            <div className="sc-panel-head compact"><div><span className="sc-eyebrow">PRODUCT LINES</span><h3>产品与执行任务</h3></div><span className="sc-count-chip">{request.lines.length} 个产品</span></div>
            <div className="sc-detail-lines">
              {request.lines.map((line) => (
                <article key={line.id}>
                  <div className="sc-line-summary"><span className="sc-product-thumb large">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <Boxes size={22} />}</span><div><b>{line.sku}</b><span>{line.productName}</span><small>{line.method} · {line.requestedQty} {line.unit}</small></div><div className="sc-line-fulfillment"><b>{line.fulfilledQty}/{line.requestedQty}</b><small>已到仓 / 需求</small></div></div>
                  <div className="sc-task-list">
                    {(taskGroups[line.id] || []).map((task) => <button key={task.id} onClick={() => canExecute && openProgress(task)}><span className={`sc-status-dot sc-status-${statusTone(task.status)}`} /><div><b>{task.taskNo}</b><small>{task.supplierName || "未填写供应方"} · 计划 {task.plannedQty}</small></div><span>{stockupTaskStatusLabels[task.status] || task.status}</span><ChevronRight size={16} /></button>)}
                    {canExecute && ["accepted", "in_progress"].includes(request.status) ? <button className="sc-add-task" onClick={() => openTask(line.id)}><Plus size={16} />拆分采购 / 生产任务</button> : null}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="sc-detail-section">
            <div className="sc-panel-head compact"><div><span className="sc-eyebrow">TRACKING TIMELINE</span><h3>进度时间线</h3><p>像查看快递一样了解每一步。</p></div></div>
            <ProgressTimeline events={request.events} />
          </section>

          <section className="sc-mini-flow">
            {[{ icon: Factory, label: "采购/生产", active: Boolean(request.tasks?.length) }, { icon: PackageCheck, label: "打包", active: request.tasks?.some((task) => ["packing", "waiting_shipment", "shipped"].includes(task.status)) }, { icon: Truck, label: "发运", active: Boolean(request.shipments?.length) }, { icon: Boxes, label: "到仓", active: Boolean(request.receipts?.length) }, { icon: CircleDollarSign, label: "成本", active: Boolean(request.costVersions?.length) }].map(({ icon: Icon, label, active }) => <div className={active ? "is-active" : ""} key={label}><span><Icon size={18} /></span><b>{label}</b></div>)}
          </section>
        </div>
      </aside>

      {taskLineId ? <div className="sc-submodal"><div><header><h3>创建执行任务</h3><button onClick={() => setTaskLineId("")}><X size={18} /></button></header><div className="sc-form-grid"><label>计划数量<input type="number" min="0.01" value={taskForm.plannedQty} onChange={(event) => setTaskForm({ ...taskForm, plannedQty: Number(event.target.value) })} /></label><label>供应商 / 生产方<input value={taskForm.supplierName} onChange={(event) => setTaskForm({ ...taskForm, supplierName: event.target.value })} placeholder="仅有权限人员可见" /></label><label>预计下单日<input type="date" value={taskForm.expectedOrderAt} onChange={(event) => setTaskForm({ ...taskForm, expectedOrderAt: event.target.value })} /></label><label>预计完成日<input type="date" value={taskForm.expectedCompletedAt} onChange={(event) => setTaskForm({ ...taskForm, expectedCompletedAt: event.target.value })} /></label></div><footer><button className="sc-button sc-button-secondary" onClick={() => setTaskLineId("")}>取消</button><button className="sc-button sc-button-primary" disabled={Boolean(busy)} onClick={() => run("task", async () => { await createStockupCollaborationTask({ requestId: request.id, lineId: taskLineId, ...taskForm }); setTaskLineId(""); })}><Plus size={16} />创建任务</button></footer></div></div> : null}

      {editingTask ? <div className="sc-submodal"><div><header><h3>更新执行进度</h3><button onClick={() => setEditingTask(null)}><X size={18} /></button></header><div className="sc-form-grid"><label>当前节点<select value={progressForm.status} onChange={(event) => setProgressForm({ ...progressForm, status: event.target.value })}>{Object.entries(stockupTaskStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>已下单数量<input type="number" value={progressForm.orderedQty} onChange={(event) => setProgressForm({ ...progressForm, orderedQty: Number(event.target.value) })} /></label><label>已完成数量<input type="number" value={progressForm.completedQty} onChange={(event) => setProgressForm({ ...progressForm, completedQty: Number(event.target.value) })} /></label><label>预计完成日<input type="date" value={progressForm.expectedCompletedAt} onChange={(event) => setProgressForm({ ...progressForm, expectedCompletedAt: event.target.value })} /></label><label>异常类型<select value={progressForm.exceptionType} onChange={(event) => setProgressForm({ ...progressForm, exceptionType: event.target.value })}><option value="">无异常</option><option>延期</option><option>数量异常</option><option>质量异常</option></select></label><label>异常说明<input value={progressForm.exceptionNote} onChange={(event) => setProgressForm({ ...progressForm, exceptionNote: event.target.value })} /></label></div><footer><button className="sc-button sc-button-secondary" onClick={() => setEditingTask(null)}>取消</button><button className="sc-button sc-button-primary" disabled={Boolean(busy)} onClick={() => run("progress", async () => { await updateStockupCollaborationTask(editingTask.id, { version: editingTask.version, ...progressForm }); setEditingTask(null); })}><Send size={16} />保存进度</button></footer></div></div> : null}
    </div>
  );
}

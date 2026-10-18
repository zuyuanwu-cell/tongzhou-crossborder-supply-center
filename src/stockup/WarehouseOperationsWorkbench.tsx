import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import {
  createStockupWarehouseWorkOrder,
  fetchStockupWarehouseDashboard,
  fetchStockupWarehouseWorkOrder,
  publishStockupWarehouseWorkOrder,
  reviewStockupWarehouseInspection,
  updateStockupWarehouseWorkOrder,
} from "../api";
import { fetchCollaborationTaskOptions, type CollaborationTaskOptions } from "../warehouse-collaboration-task-api";
import type { StockupRequest, StockupWarehouseDashboard, StockupWarehouseWorkOrder } from "./types";

type Props = {
  requests: StockupRequest[];
  canManage: boolean;
  canCost: boolean;
  onChanged: () => void | Promise<void>;
};

type CreateDraft = {
  requestId: string;
  organizationCode: string;
  warehouseRef: string;
  expectedArrivalAt: string;
  senderName: string;
  senderContact: string;
  inboundCarrier: string;
  inboundTrackingNo: string;
  priority: "normal" | "high" | "urgent";
  instructions: string;
  publishNow: boolean;
  quantities: Record<string, number>;
};

const defaultInstructions = "签收并核对数量；验收货物质量；按要求更换纸箱；登记批号与商品条码；登记箱数、箱规、长宽高和单箱重量；登记仓内费用；按去向安排货拉拉或其他承运商发货。";

const statusLabels: Record<string, string> = {
  draft: "草稿",
  waiting_receipt: "待签收",
  inspecting: "验收处理中",
  warehouse_inspection: "待仓库验货",
  inspection_review: "验货待审核",
  inventory_ready: "已审核入库",
  ready_to_ship: "待发运",
  partially_shipped: "部分发运",
  completed: "已完结",
  cancelled: "已取消",
};

const routeLabels: Record<string, string> = {
  overseas_warehouse: "发海外仓",
  domestic_customer: "发国内客户",
  hold: "留仓待定",
};

const expenseLabels: Record<string, string> = {
  handling: "装卸/操作",
  inspection: "验货",
  repacking: "换箱/包装",
  transport: "国内运输",
  storage: "仓储",
  other: "其他",
};

function fmtQty(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value || 0);
}

function fmtMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value || 0);
}

function fmtDate(value: string) {
  if (!value) return "待确认";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function newDraft(): CreateDraft {
  return {
    requestId: "",
    organizationCode: "",
    warehouseRef: "",
    expectedArrivalAt: "",
    senderName: "",
    senderContact: "",
    inboundCarrier: "",
    inboundTrackingNo: "",
    priority: "normal",
    instructions: defaultInstructions,
    publishNow: true,
    quantities: {},
  };
}

export function WarehouseOperationsWorkbench({ requests, canManage, canCost, onChanged }: Props) {
  const [dashboard, setDashboard] = useState<StockupWarehouseDashboard | null>(null);
  const [options, setOptions] = useState<CollaborationTaskOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(newDraft);
  const [selected, setSelected] = useState<StockupWarehouseWorkOrder | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [dashboardResult, optionResult] = await Promise.allSettled([
        fetchStockupWarehouseDashboard({ status: status === "all" ? "" : status, keyword }),
        fetchCollaborationTaskOptions(),
      ]);
      if (dashboardResult.status === "rejected") throw dashboardResult.reason;
      setDashboard(dashboardResult.value);
      setOptions(optionResult.status === "fulfilled" ? optionResult.value : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "国内仓作业数据读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [keyword, status]);

  useEffect(() => { void load(); }, [load]);

  const selectedRequest = useMemo(() => requests.find((item) => item.id === draft.requestId) || null, [draft.requestId, requests]);
  const selectedOrganization = useMemo(() => options?.organizations.find((item) => item.code === draft.organizationCode) || null, [draft.organizationCode, options]);
  const selectedWarehouse = useMemo(() => selectedOrganization?.warehouses.find((item) => item.resourceRef === draft.warehouseRef) || null, [draft.warehouseRef, selectedOrganization]);
  const workOrders = dashboard?.workOrders || [];
  const routeTotal = Object.values(dashboard?.routeBreakdown || {}).reduce((sum, value) => sum + value, 0);
  const expenseRows = Object.entries(dashboard?.expenseBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const maxExpense = Math.max(1, ...expenseRows.map(([, value]) => value));

  function chooseRequest(requestId: string) {
    const request = requests.find((item) => item.id === requestId);
    setDraft((current) => ({
      ...current,
      requestId,
      expectedArrivalAt: request?.expectedArrivalAt?.slice(0, 16) || current.expectedArrivalAt,
      priority: request?.priority === "加急" || request?.priority === "紧急" ? "urgent" : current.priority,
      quantities: Object.fromEntries((request?.lines || []).map((line) => [line.id, Math.max(0, line.requestedQty - (line.fulfilledQty || 0))])),
    }));
  }

  function chooseOrganization(organizationCode: string) {
    const organization = options?.organizations.find((item) => item.code === organizationCode);
    setDraft((current) => ({ ...current, organizationCode, warehouseRef: organization?.warehouses[0]?.resourceRef || "" }));
  }

  async function createWorkOrder() {
    if (!selectedRequest || !selectedOrganization || !selectedWarehouse) {
      setError("请选择备货单、伙伴组织和国内仓库。");
      return;
    }
    const lines = selectedRequest.lines
      .map((line) => ({ requestLineId: line.id, expectedQty: Number(draft.quantities[line.id] || 0) }))
      .filter((line) => line.expectedQty > 0);
    if (!lines.length) {
      setError("请至少选择一个待国内仓处理的商品并填写数量。");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const created = await createStockupWarehouseWorkOrder({
        requestId: selectedRequest.id,
        organizationCode: selectedOrganization.code,
        domesticWarehouseId: selectedWarehouse.resourceRef,
        domesticWarehouseName: selectedWarehouse.resourceName,
        expectedArrivalAt: draft.expectedArrivalAt,
        senderName: draft.senderName,
        senderContact: draft.senderContact,
        inboundCarrier: draft.inboundCarrier,
        inboundTrackingNo: draft.inboundTrackingNo,
        instructions: draft.instructions,
        priority: draft.priority,
        submit: true,
        lines,
      });
      let finalOrder = created.workOrder;
      if (draft.publishNow) finalOrder = (await publishStockupWarehouseWorkOrder(created.workOrder.id)).workOrder;
      setShowCreate(false);
      setDraft(newDraft());
      setSelected(finalOrder);
      setSuccess(draft.publishNow ? `工单 ${finalOrder.workOrderNo} 已推送给国内仓。` : `工单 ${finalOrder.workOrderNo} 已创建。`);
      await Promise.all([load(true), onChanged()]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "国内仓工单创建失败");
    } finally {
      setSaving(false);
    }
  }

  async function openOrder(workOrderId: string) {
    setError("");
    try { setSelected((await fetchStockupWarehouseWorkOrder(workOrderId)).workOrder); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "工单详情读取失败"); }
  }

  async function publishOrder(workOrder: StockupWarehouseWorkOrder) {
    setSaving(true);
    setError("");
    try {
      const result = await publishStockupWarehouseWorkOrder(workOrder.id);
      setSelected(result.workOrder);
      setSuccess(`工单 ${workOrder.workOrderNo} 已推送给国内仓。`);
      await load(true);
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "工单推送失败");
    } finally { setSaving(false); }
  }

  async function reviewExpense(workOrder: StockupWarehouseWorkOrder, expenseId: string, reviewStatus: "approved" | "rejected") {
    setSaving(true);
    setError("");
    try {
      const result = await updateStockupWarehouseWorkOrder(workOrder.id, {
        action: "review_expense",
        expenseId,
        reviewStatus,
        includedInCost: reviewStatus === "approved",
        expectedVersion: workOrder.version,
      });
      setSelected(result.workOrder);
      setSuccess(reviewStatus === "approved" ? "仓内费用已审核并计入成本。" : "仓内费用已驳回。" );
      await load(true);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "费用审核失败");
    } finally { setSaving(false); }
  }

  async function reviewInspection(workOrder: StockupWarehouseWorkOrder, action: "approve" | "reject") {
    const note = action === "reject" ? window.prompt("请输入退回原因，仓库修改后可重新提交：", "") || "" : "验货数据与凭证审核通过";
    if (action === "reject" && !note.trim()) return;
    setSaving(true); setError("");
    try {
      await reviewStockupWarehouseInspection(workOrder.id, action, note);
      setSuccess(action === "approve" ? "验货已审核通过，合格批次已幂等写入国内库存。" : "验货结果已退回仓库修订。");
      const refreshed = await fetchStockupWarehouseWorkOrder(workOrder.id);
      setSelected(refreshed.workOrder);
      await Promise.all([load(true), onChanged()]);
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : "验货审核失败"); }
    finally { setSaving(false); }
  }

  const funnel = [
    ["waiting_receipt", "待签收", dashboard?.counts.waiting_receipt || 0],
    ["inspecting", "验收中", dashboard?.counts.inspecting || 0],
    ["ready_to_ship", "待发运", (dashboard?.counts.ready_to_ship || 0) + (dashboard?.counts.partially_shipped || 0)],
    ["completed", "已完结", dashboard?.counts.completed || 0],
  ] as const;
  const maxFunnel = Math.max(1, ...funnel.map((item) => item[2]));

  return <section className="sc-warehouse-workbench">
    <header className="sc-warehouse-command">
      <div><span className="sc-eyebrow"><i /> DOMESTIC WAREHOUSE CONTROL</span><h2>国内仓作业工作台</h2><p>从备货单推送验收工单，统一管理换箱、追溯、箱规、发运分流与成本费用。</p></div>
      <div className="sc-warehouse-command-actions">
        <label><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="工单号 / SKU / 仓库" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="waiting_receipt">待签收</option><option value="inspecting">验收中</option><option value="ready_to_ship">待发运</option><option value="partially_shipped">部分发运</option><option value="completed">已完结</option></select>
        <button className="sc-button sc-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""} size={16} />刷新</button>
        {canManage ? <button className="sc-button sc-button-primary" onClick={() => setShowCreate(true)}><Plus size={17} />创建国内仓工单</button> : null}
      </div>
    </header>

    {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
    {success ? <div className="sc-warehouse-success"><CheckCircle2 size={17} />{success}<button onClick={() => setSuccess("")}><X size={14} /></button></div> : null}

    <div className="sc-warehouse-metrics">
      <article><span><Boxes size={20} /></span><div><small>待签收商品</small><strong>{fmtQty(dashboard?.waitingProducts.reduce((sum, item) => sum + Math.max(0, item.expectedQty - item.receivedQty), 0) || 0)}</strong><em>{dashboard?.waitingProducts.length || 0} 个 SKU 行</em></div></article>
      <article><span><PackageCheck size={20} /></span><div><small>验收处理中</small><strong>{dashboard?.counts.inspecting || 0}</strong><em>含换箱与追溯登记</em></div></article>
      <article><span><Route size={20} /></span><div><small>待发运线路</small><strong>{(dashboard?.counts.ready_to_ship || 0) + (dashboard?.counts.partially_shipped || 0)}</strong><em>海外仓 / 国内客户 / 留仓</em></div></article>
      <article className="is-money"><span><CircleDollarSign size={20} /></span><div><small>仓内费用</small><strong>{fmtMoney(dashboard?.totals.expenseCny || 0)}</strong><em>审核后并入备货成本</em></div></article>
    </div>

    <div className="sc-warehouse-analytics">
      <article className="sc-warehouse-panel">
        <header><div><small>PROCESS FUNNEL</small><h3>作业漏斗</h3></div><Clock3 size={20} /></header>
        <div className="sc-warehouse-funnel">{funnel.map(([key, label, value], index) => <div key={key}><span>{index + 1}</span><b>{label}</b><i><em style={{ width: `${Math.max(8, value / maxFunnel * 100)}%` }} /></i><strong>{value}</strong></div>)}</div>
      </article>
      <article className="sc-warehouse-panel">
        <header><div><small>OUTBOUND SPLIT</small><h3>发运去向</h3></div><Truck size={20} /></header>
        <div className="sc-route-split">
          <div className="sc-route-donut" style={{ background: routeTotal ? `conic-gradient(#1467b8 0 ${dashboard!.routeBreakdown.overseas_warehouse / routeTotal * 100}%, #f06a26 0 ${(dashboard!.routeBreakdown.overseas_warehouse + dashboard!.routeBreakdown.domestic_customer) / routeTotal * 100}%, #87a0bb 0)` : undefined }}><span><b>{fmtQty(routeTotal)}</b><small>已分配数量</small></span></div>
          <div>{Object.entries(routeLabels).map(([key, label]) => <p key={key}><i className={`route-${key}`} /><span>{label}</span><b>{fmtQty(dashboard?.routeBreakdown[key as keyof StockupWarehouseDashboard["routeBreakdown"]] || 0)}</b></p>)}</div>
        </div>
      </article>
      <article className="sc-warehouse-panel">
        <header><div><small>COST INPUT</small><h3>仓内费用构成</h3></div><CircleDollarSign size={20} /></header>
        <div className="sc-expense-bars">{expenseRows.length ? expenseRows.map(([key, value]) => <div key={key}><p><span>{expenseLabels[key] || key}</span><b>{fmtMoney(value)}</b></p><i><em style={{ width: `${value / maxExpense * 100}%` }} /></i></div>) : <div className="sc-warehouse-empty">仓库登记费用后在此自动汇总</div>}</div>
      </article>
    </div>

    <article className="sc-warehouse-panel sc-arrival-board">
      <header><div><small>ARRIVAL BOARD</small><h3>待签收验货商品</h3></div><span>{dashboard?.waitingProducts.length || 0} 行待作业</span></header>
      <div className="sc-arrival-table">
        <div className="head"><span>商品</span><span>工单 / 备货单</span><span>国内仓</span><span>预计到仓</span><span>待签收</span><span>状态</span><span /></div>
        {(dashboard?.waitingProducts || []).slice(0, 30).map((item) => <button key={`${item.workOrderId}-${item.sku}`} onClick={() => void openOrder(item.workOrderId)}>
          <span className="product">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <i><Boxes size={16} /></i>}<em><b>{item.sku}</b><small>{item.productName}</small></em></span>
          <span><b>{item.workOrderNo}</b><small>{item.requestNo}</small></span><span>{item.domesticWarehouseName}</span><span>{fmtDate(item.expectedArrivalAt)}</span><span><b>{fmtQty(Math.max(0, item.expectedQty - item.receivedQty))}</b> {item.unit}</span><span><i className={`sc-wo-status is-${item.status}`}>{statusLabels[item.status] || item.status}</i></span><ArrowRight size={15} />
        </button>)}
        {!loading && !dashboard?.waitingProducts.length ? <div className="sc-warehouse-empty"><CheckCircle2 size={22} />当前没有等待签收验货的商品</div> : null}
      </div>
    </article>

    <article className="sc-warehouse-panel sc-workorder-list">
      <header><div><small>WORK ORDERS</small><h3>国内仓工单</h3></div><span>{workOrders.length} 张</span></header>
      <div>{workOrders.map((order) => <button key={order.id} onClick={() => void openOrder(order.id)}>
        <span className="sc-wo-icon"><Warehouse size={20} /></span><span><b>{order.workOrderNo}</b><small>{order.requestNo} · {order.domesticWarehouseName}</small></span><span><small>商品 / 预计</small><b>{order.lines.length} SKU · {fmtQty(order.expectedQty)}</b></span><span><small>良品 / 已分配</small><b>{fmtQty(order.goodQty)} / {fmtQty(order.allocatedQty)}</b></span><span><small>仓内费用</small><b>{fmtMoney(order.expenseTotalCny)}</b></span><i className={`sc-wo-status is-${order.status}`}>{statusLabels[order.status] || order.status}</i><ArrowRight size={16} />
      </button>)}</div>
    </article>

    {showCreate ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal">
      <header className="sc-modal-head"><div><span className="sc-eyebrow"><i /> CREATE & DISPATCH</span><h2>创建国内仓作业工单</h2><p>选择备货商品并交代清楚到货、验收、包装和后续发运要求。</p></div><button className="sc-icon-button" onClick={() => setShowCreate(false)}><X size={19} /></button></header>
      <div className="sc-editor-scroll">
        <section className="sc-form-section"><div className="sc-section-heading"><span>1</span><div><b>备货来源与执行仓</b><small>工单会绑定备货单，并推送到指定伙伴仓库。</small></div></div><div className="sc-form-grid sc-form-grid-4">
          <label className="full">备货单<select value={draft.requestId} onChange={(event) => chooseRequest(event.target.value)}><option value="">请选择待处理备货单</option>{requests.filter((item) => !["cancelled", "completed"].includes(item.status)).map((request) => <option value={request.id} key={request.id}>{request.requestNo} · {request.project || request.destinationCountry} · {request.lines.length} SKU</option>)}</select></label>
          <label>伙伴组织<select value={draft.organizationCode} onChange={(event) => chooseOrganization(event.target.value)}><option value="">请选择伙伴</option>{options?.organizations.map((organization) => <option value={organization.code} key={organization.code}>{organization.name}</option>)}</select></label>
          <label>国内仓库<select value={draft.warehouseRef} onChange={(event) => setDraft((current) => ({ ...current, warehouseRef: event.target.value }))}><option value="">请选择仓库</option>{selectedOrganization?.warehouses.map((warehouse) => <option value={warehouse.resourceRef} key={warehouse.resourceRef}>{warehouse.resourceName}</option>)}</select></label>
          <label>预计到仓<input type="datetime-local" value={draft.expectedArrivalAt} onChange={(event) => setDraft((current) => ({ ...current, expectedArrivalAt: event.target.value }))} /></label>
          <label>优先级<select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as CreateDraft["priority"] }))}><option value="normal">普通</option><option value="high">重要</option><option value="urgent">紧急</option></select></label>
          <label>发货人<input value={draft.senderName} onChange={(event) => setDraft((current) => ({ ...current, senderName: event.target.value }))} placeholder="供应商 / 采购" /></label>
          <label>发货人联系方式<input value={draft.senderContact} onChange={(event) => setDraft((current) => ({ ...current, senderContact: event.target.value }))} /></label>
          <label>入库物流<input value={draft.inboundCarrier} onChange={(event) => setDraft((current) => ({ ...current, inboundCarrier: event.target.value }))} placeholder="顺丰 / 德邦 / 自送" /></label>
          <label>入库单号<input value={draft.inboundTrackingNo} onChange={(event) => setDraft((current) => ({ ...current, inboundTrackingNo: event.target.value }))} /></label>
        </div></section>
        <section className="sc-form-section"><div className="sc-section-heading"><span>2</span><div><b>待签收商品</b><small>数量可拆成多张国内仓工单，但累计不能超过备货数量。</small></div></div><div className="sc-create-lines">
          <div className="head"><span>商品</span><span>备货数量</span><span>本次推送</span></div>
          {selectedRequest?.lines.map((line) => <div key={line.id}><span className="product">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <i><Boxes size={16} /></i>}<em><b>{line.sku}</b><small>{line.productName}</small></em></span><span>{fmtQty(line.requestedQty)} {line.unit}</span><label><input type="number" min="0" max={line.requestedQty} value={draft.quantities[line.id] ?? 0} onChange={(event) => setDraft((current) => ({ ...current, quantities: { ...current.quantities, [line.id]: Number(event.target.value) } }))} /> {line.unit}</label></div>)}
          {!selectedRequest ? <div className="sc-warehouse-empty">请先选择一张备货单</div> : null}
        </div></section>
        <section className="sc-form-section"><div className="sc-section-heading"><span>3</span><div><b>仓库执行要求</b><small>伙伴端将按验收、包装、去向分流和费用登记逐步完成。</small></div></div><div className="sc-operation-checks"><span><Check />验收数量与质量</span><span><Check />换纸箱</span><span><Check />批号与商品条码</span><span><Check />箱规尺寸与重量</span><span><Check />海外仓 / 国内客户分流</span><span><Check />货拉拉等发运安排</span><span><Check />仓内费用登记</span></div><label className="sc-instruction-field">补充指令<textarea rows={4} value={draft.instructions} onChange={(event) => setDraft((current) => ({ ...current, instructions: event.target.value }))} /></label></section>
      </div>
      <footer className="sc-modal-foot"><label className="sc-publish-toggle"><input type="checkbox" checked={draft.publishNow} onChange={(event) => setDraft((current) => ({ ...current, publishNow: event.target.checked }))} /><span><b>创建后立即推送伙伴工作台</b><small>国内仓会马上看到待签收商品和完整操作要求</small></span></label><div><button className="sc-button sc-button-secondary" onClick={() => setShowCreate(false)}>取消</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void createWorkOrder()}>{saving ? <RefreshCw className="spin" size={17} /> : <Send size={17} />}{draft.publishNow ? "创建并推送工单" : "创建工单"}</button></div></footer>
    </section></div> : null}

    {selected ? <div className="sc-drawer-backdrop"><aside className="sc-drawer sc-warehouse-detail-drawer">
      <header className="sc-drawer-head"><div><span className="sc-eyebrow"><i /> {selected.workOrderNo}</span><h2>{selected.domesticWarehouseName}</h2><p>{selected.requestNo} · {selected.project || "备货作业"}</p></div><button className="sc-icon-button" onClick={() => setSelected(null)}><X size={19} /></button></header>
      <div className="sc-drawer-scroll">
        <div className="sc-detail-summary"><article><small>工单状态</small><b><i className={`sc-wo-status is-${selected.status}`}>{statusLabels[selected.status] || selected.status}</i></b></article><article><small>预计 / 良品</small><b>{fmtQty(selected.expectedQty)} / {fmtQty(selected.goodQty)}</b></article><article><small>去向已分配</small><b>{fmtQty(selected.allocatedQty)}</b></article><article><small>仓内费用</small><b>{fmtMoney(selected.expenseTotalCny)}</b></article></div>
        <section className="sc-detail-section"><header><PackageCheck size={18} /><div><b>验收与包装结果</b><small>批号、条码、换箱与箱规均由仓库回填</small></div></header><div className="sc-detail-lines"><div className="head"><span>商品</span><span>数量结果</span><span>追溯信息</span><span>包装信息</span></div>{selected.lines.map((line) => <div key={line.id}><span><b>{line.sku}</b><small>{line.productName}</small></span><span><b>良品 {fmtQty(line.goodQty)}</b><small>破损 {fmtQty(line.damagedQty)} · 短缺 {fmtQty(line.shortageQty)} · 待判 {fmtQty(line.pendingQty)}</small></span><span><b>批号 {line.lotNo || "待登记"}</b><small>条码 {line.barcode || "待登记"}</small></span><span><b>{line.cartonCount ? `${line.cartonCount} 箱 × ${line.unitsPerCarton}` : "待登记箱规"}</b><small>{line.cartonLengthCm ? `${line.cartonLengthCm}×${line.cartonWidthCm}×${line.cartonHeightCm}cm · ${line.cartonWeightKg}kg/箱` : "尺寸重量待登记"}</small></span></div>)}</div></section>
        <section className="sc-detail-section"><header><Route size={18} /><div><b>后续发运去向</b><small>同一批可拆分发海外仓、国内客户或留仓待定</small></div></header><div className="sc-detail-routes">{selected.routes.map((route) => <article key={route.id}><span><MapPin size={16} /></span><div><b>{routeLabels[route.routeType]} · {route.destinationName}</b><small>{route.carrier || "承运商待定"} {route.trackingNo ? `· ${route.trackingNo}` : ""}</small></div><em>{route.lines.reduce((sum, line) => sum + line.quantity, 0)} 件</em><i className={`sc-wo-status is-${route.status}`}>{route.status}</i></article>)}{!selected.routes.length ? <div className="sc-warehouse-empty">仓库尚未登记发运分流</div> : null}</div></section>
        <section className="sc-detail-section"><header><CircleDollarSign size={18} /><div><b>仓内费用与成本归集</b><small>仓库登记、运营审核，批准后计入备货总成本</small></div></header><div className="sc-detail-expenses">{selected.expenses.map((expense) => <article key={expense.id}><span><CircleDollarSign size={17} /></span><div><b>{expenseLabels[expense.category] || expense.name}</b><small>{expense.vendor || "仓内费用"} · {expense.occurredAt || "日期待补"}</small></div><strong>{fmtMoney(expense.amountCny)}</strong><i className={`sc-wo-status is-${expense.reviewStatus}`}>{expense.reviewStatus === "approved" ? "已计成本" : expense.reviewStatus === "rejected" ? "已驳回" : "待审核"}</i>{canCost && expense.reviewStatus === "pending_review" ? <div><button disabled={saving} onClick={() => void reviewExpense(selected, expense.id, "approved")}><ShieldCheck size={14} />审核计入</button><button disabled={saving} onClick={() => void reviewExpense(selected, expense.id, "rejected")}>驳回</button></div> : null}</article>)}{!selected.expenses.length ? <div className="sc-warehouse-empty">仓库尚未登记费用</div> : null}</div></section>
        <section className="sc-detail-section"><header><Clock3 size={18} /><div><b>工单轨迹</b><small>管理端与伙伴端动作统一留痕</small></div></header><div className="sc-detail-timeline">{selected.events.map((event) => <article key={event.id}><i /><div><b>{event.title}</b><p>{event.description}</p><small>{event.actorName} · {fmtDate(event.occurredAt)}</small></div></article>)}</div></section>
      </div>
      <footer className="sc-drawer-foot"><span><Warehouse size={16} />伙伴端任务：{selected.publishedAt ? `已于 ${fmtDate(selected.publishedAt)} 推送` : "尚未推送"}</span><div>{canManage && selected.workflowVersion === 2 && selected.status === "inspection_review" ? <><button className="sc-button sc-button-secondary" disabled={saving} onClick={() => void reviewInspection(selected, "reject")}>退回修订</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void reviewInspection(selected, "approve")}><ShieldCheck size={16} />审核入库</button></> : null}{canManage && !selected.publishedAt ? <button className="sc-button sc-button-primary" disabled={saving} onClick={() => void publishOrder(selected)}><Send size={16} />推送给国内仓</button> : null}</div></footer>
    </aside></div> : null}
  </section>;
}

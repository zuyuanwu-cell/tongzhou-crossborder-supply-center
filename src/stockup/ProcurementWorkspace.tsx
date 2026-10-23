import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, CheckCircle2, CircleDollarSign, PackagePlus, Plus, RefreshCw, RotateCcw, Tag, Truck, X } from "lucide-react";
import {
  bindStockupFormalSku,
  createStockupForwarder,
  createStockupPurchaseOrder,
  fetchStockupForwarders,
  fetchStockupProductRefs,
  fetchStockupPurchaseOrders,
  recordStockupPurchaseEvent,
  updateStockupRequestLineProcurement,
  updateStockupPurchaseOrder,
} from "../api";
import { ProcurementOrderBoard } from "./ProcurementOrderBoard";
import type { StockupForwarder, StockupProductRef, StockupPurchaseOrder, StockupPurchaseOrderLine, StockupRequest } from "./types";
import "./procurement-workspace.css";

type Props = {
  requests: StockupRequest[];
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  onHandoff: (requestId: string) => void;
};

type PurchaseLineDraft = { id?: string; requestLineId: string; quantity: number; merchandiseAmount: number; allocatedAmount: number; selected: boolean };

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });

export function ProcurementWorkspace({ requests, canManage, onChanged, onHandoff }: Props) {
  const [orders, setOrders] = useState<StockupPurchaseOrder[]>([]);
  const [productRefs, setProductRefs] = useState<StockupProductRef[]>([]);
  const [forwarders, setForwarders] = useState<StockupForwarder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modal, setModal] = useState<"purchase" | "forwarder" | "">("");
  const [editingPurchaseOrder, setEditingPurchaseOrder] = useState<StockupPurchaseOrder | null>(null);
  const [order, setOrder] = useState({ supplierName: "", externalOrderNo: "", orderUrl: "", paidTotalCny: 0, orderedAt: new Date().toISOString().slice(0, 10), note: "" });
  const [manualAllocation, setManualAllocation] = useState(false);
  const [allocationReason, setAllocationReason] = useState("");
  const [lineDrafts, setLineDrafts] = useState<Record<string, PurchaseLineDraft>>({});
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({});
  const [selectedPurchaseLines, setSelectedPurchaseLines] = useState<string[]>([]);
  const [forwarder, setForwarder] = useState({ code: "", name: "", locationName: "", country: "中国", province: "", city: "", address: "", contactName: "", contactPhone: "", routingRequirements: "" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [purchaseResult, productResult, forwarderResult] = await Promise.all([
        fetchStockupPurchaseOrders(),
        fetchStockupProductRefs(),
        fetchStockupForwarders(),
      ]);
      setOrders(purchaseResult.purchaseOrders || []);
      setProductRefs(productResult.productRefs || []);
      setForwarders(forwarderResult.forwarders || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "采购协同数据读取失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const purchasedByRequestLine = useMemo(() => orders.flatMap((item) => item.lines).reduce<Record<string, number>>((result, line) => {
    result[line.requestLineId] = (result[line.requestLineId] || 0) + Math.max(0, line.quantity - line.cancelledQty);
    return result;
  }, {}), [orders]);
  const purchasableLines = useMemo(() => requests
    .filter((request) => request.workflowVersion === 2 && ["submitted", "purchasing"].includes(request.status))
    .flatMap((request) => request.lines.filter((line) => line.status !== "procurement_cancelled").map((line) => ({ request, line, remainingQty: Math.max(0, (line.procurementRequiredQty ?? line.requestedQty) - (purchasedByRequestLine[line.id] || 0)) })))
    .filter((item) => item.remainingQty > 0), [purchasedByRequestLine, requests]);
  const closedLines = useMemo(() => requests.flatMap((request) => request.lines
    .filter((line) => line.status === "procurement_cancelled")
    .map((line) => ({ request, line }))), [requests]);
  const temporaryRefs = productRefs.filter((item) => item.codingStatus !== "coded");
  const selectedLines = Object.values(lineDrafts).filter((item) => item.selected);
  const merchandiseTotal = selectedLines.reduce((sum, item) => sum + Number(item.merchandiseAmount || 0), 0);
  const purchaseEditorLines = editingPurchaseOrder
    ? editingPurchaseOrder.lines.map((line) => ({ request: { requestNo: editingPurchaseOrder.purchaseNo }, line: { id: line.requestLineId, sku: line.sku, productName: line.productName, unit: line.unit }, remainingQty: line.quantity }))
    : purchasableLines;

  function canEditPurchase(item: StockupPurchaseOrder) {
    return item.status === "ordered" && item.lines.every((line) => line.receivedQty === 0 && line.cancelledQty === 0 && line.refundedAmountCny === 0 && line.status === "ordered");
  }

  function openPurchase() {
    setError(""); setSuccess("");
    setEditingPurchaseOrder(null);
    setLineDrafts(Object.fromEntries(purchasableLines.map(({ line, remainingQty }) => [line.id, { requestLineId: line.id, quantity: remainingQty, merchandiseAmount: 0, allocatedAmount: 0, selected: false }])));
    setOrder({ supplierName: "", externalOrderNo: "", orderUrl: "", paidTotalCny: 0, orderedAt: new Date().toISOString().slice(0, 10), note: "" });
    setManualAllocation(false); setAllocationReason("");
    setModal("purchase");
  }

  function openEditPurchase(item: StockupPurchaseOrder) {
    setError(""); setSuccess("");
    setEditingPurchaseOrder(item);
    setLineDrafts(Object.fromEntries(item.lines.map((line) => [line.requestLineId, { id: line.id, requestLineId: line.requestLineId, quantity: line.quantity, merchandiseAmount: line.merchandiseAmountCny, allocatedAmount: line.allocatedAmountCny, selected: true }])));
    setOrder({ supplierName: item.supplierName, externalOrderNo: item.externalOrderNo, orderUrl: item.orderUrl, paidTotalCny: item.paidTotalCny, orderedAt: item.orderedAt.slice(0, 10), note: item.note });
    setManualAllocation(item.allocationMode === "manual");
    setAllocationReason(item.allocationOverrideReason || "修正采购金额分摊");
    setModal("purchase");
  }

  async function savePurchase() {
    const lines = selectedLines.map((line) => ({ requestLineId: line.requestLineId, quantity: line.quantity, merchandiseAmount: line.merchandiseAmount }));
    if (!order.supplierName.trim() || !lines.length || order.paidTotalCny <= 0 || lines.some((line) => line.quantity <= 0 || line.merchandiseAmount < 0)) {
      setError("请填写供应商和实付总额，并至少选择一条有效采购明细。"); return;
    }
    const allocationOverrides = manualAllocation ? Object.fromEntries(selectedLines.map((line) => [line.requestLineId, line.allocatedAmount])) : undefined;
    const allocatedTotal = selectedLines.reduce((sum, line) => sum + Number(line.allocatedAmount || 0), 0);
    if (manualAllocation && (!allocationReason.trim() || Math.abs(allocatedTotal - order.paidTotalCny) > 0.005)) {
      setError("人工分摊时，分摊后金额合计必须等于实付总额，并填写调整原因。"); return;
    }
    setSaving(true); setError("");
    try {
      const result = editingPurchaseOrder
        ? await updateStockupPurchaseOrder(editingPurchaseOrder.id, { ...order, version: editingPurchaseOrder.version, lines: selectedLines.map((line) => ({ id: line.id, merchandiseAmount: line.merchandiseAmount })), ...(manualAllocation ? { allocationOverrides: Object.fromEntries(selectedLines.map((line) => [line.id, line.allocatedAmount])), allocationOverrideReason: allocationReason } : {}) })
        : await createStockupPurchaseOrder({ ...order, platform: "1688", lines, ...(manualAllocation ? { allocationOverrides, allocationOverrideReason: allocationReason } : {}) });
      setSuccess(editingPurchaseOrder ? `采购单 ${result.purchaseOrder.purchaseNo} 的价格与分摊已修正。` : `采购单 ${result.purchaseOrder.purchaseNo} 已建立，共享金额已按商品金额自动分摊。`);
      setModal(""); await Promise.all([load(), onChanged()]);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "采购单创建失败"); }
    finally { setSaving(false); }
  }

  async function bindSku(productRef: StockupProductRef) {
    const formalSku = (skuInputs[productRef.id] || "").trim();
    if (!formalSku) { setError("请填写正式 SKU。"); return; }
    setSaving(true); setError("");
    try {
      await bindStockupFormalSku(productRef.id, { formalSku });
      setSuccess(`${productRef.temporarySku} 已绑定为 ${formalSku}，国内库存和未出库批次已同步重编码。`);
      setSkuInputs((current) => ({ ...current, [productRef.id]: "" }));
      await Promise.all([load(), onChanged()]);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "正式 SKU 绑定失败"); }
    finally { setSaving(false); }
  }

  async function saveForwarder() {
    if (!forwarder.code || !forwarder.name || !forwarder.locationName || !forwarder.address || !forwarder.contactName || !forwarder.contactPhone) {
      setError("请补齐货代、收货点、地址、联系人和电话。"); return;
    }
    setSaving(true); setError("");
    try {
      await createStockupForwarder({ code: forwarder.code, name: forwarder.name, locations: [{ name: forwarder.locationName, country: forwarder.country, province: forwarder.province, city: forwarder.city, address: forwarder.address, contactName: forwarder.contactName, contactPhone: forwarder.contactPhone, routingRequirements: forwarder.routingRequirements }] });
      setSuccess("货代及收货地址已保存，可用于创建出运计划。"); setModal(""); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "货代档案保存失败"); }
    finally { setSaving(false); }
  }

  async function recordEvent(purchaseOrder: StockupPurchaseOrder, line: StockupPurchaseOrderLine, action: "receive" | "cancel" | "refund" | "reship", receiveAll = false) {
    const remaining = Math.max(0, line.quantity - line.cancelledQty - line.receivedQty);
    const quantity = receiveAll ? remaining : action === "refund" || action === "reship" ? Number(window.prompt(action === "refund" ? "本次退款同时取消的数量（没有则填 0）：" : "补发数量：", "0") || 0) : Number(window.prompt(action === "receive" ? "本次到货数量：" : "断货/取消数量：", String(remaining || 0)) || 0);
    const amountCny = action === "refund" ? Number(window.prompt("退款金额（元）：", "0") || 0) : 0;
    if ((action !== "refund" && action !== "reship" && quantity <= 0) || (action === "refund" && amountCny <= 0) || (action === "reship" && quantity <= 0)) return;
    const note = receiveAll ? "采购侧登记全部到货，待国内仓实际验收" : window.prompt("备注（可选）：", "") || "";
    setSaving(true); setError("");
    try { await recordStockupPurchaseEvent(purchaseOrder.id, { lineId: line.id, action, quantity, amountCny, note }); setSuccess(action === "receive" ? "采购到货已登记；实际到仓数量仍由国内仓验收确认。" : "采购进度与净采购成本已更新。"); await Promise.all([load(), onChanged()]); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "采购事件登记失败"); }
    finally { setSaving(false); }
  }

  async function batchReceive() {
    const targets = orders.flatMap((purchaseOrder) => purchaseOrder.lines.map((line) => ({ purchaseOrder, line })))
      .filter(({ line }) => selectedPurchaseLines.includes(line.id) && line.quantity - line.cancelledQty - line.receivedQty > 0);
    if (!targets.length) return;
    const total = targets.reduce((sum, { line }) => sum + Math.max(0, line.quantity - line.cancelledQty - line.receivedQty), 0);
    if (!window.confirm(`确认将所选 ${targets.length} 行、共 ${total.toLocaleString("zh-CN")} 件登记为采购侧全部到货？\n\n该动作不会替代国内仓验收；下一步仍需移交仓库核数并整理发运资料。`)) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      for (const { purchaseOrder, line } of targets) {
        await recordStockupPurchaseEvent(purchaseOrder.id, { lineId: line.id, action: "receive", quantity: Math.max(0, line.quantity - line.cancelledQty - line.receivedQty), note: "批量登记采购侧全部到货，待国内仓实际验收" });
      }
      setSelectedPurchaseLines([]);
      setSuccess(`已批量登记 ${targets.length} 行采购到货。请继续移交国内仓验收，仓库确认后才计入需求的“已到仓”。`);
      await Promise.all([load(), onChanged()]);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "批量到货登记失败"); }
    finally { setSaving(false); }
  }

  async function changeLineProcurement(request: { requestNo: string; version?: number }, line: Pick<StockupRequest["lines"][number], "id" | "sku" | "productName">, action: "close" | "reopen") {
    const reason = action === "close" ? (window.prompt("请填写终止采购原因（必填）：", "供应商断货，采购前终止") || "").trim() : "";
    if (action === "close" && !reason) return;
    setSaving(true); setError("");
    try {
      await updateStockupRequestLineProcurement(line.id, { action, reason, requestVersion: request.version });
      if (action === "close") {
        setLineDrafts((current) => { const next = { ...current }; delete next[line.id]; return next; });
        setSuccess(`${line.sku} 已终止采购，不再计入待采购；原因已写入时间线。`);
      } else {
        setSuccess(`${line.sku} 已恢复到待采购清单。`);
      }
      await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "采购状态更新失败"); }
    finally { setSaving(false); }
  }

  return <section className="sc-warehouse-workbench">
    <header className="sc-warehouse-command">
      <div><span className="sc-eyebrow"><i /> SPOT PROCUREMENT</span><h2>现货采购与商品编码</h2><p>登记 1688 实付成本、自动分摊共享金额，并在 WMS 建单前完成正式 SKU 绑定。</p></div>
      <div className="sc-warehouse-command-actions"><button className="sc-button sc-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""} size={16} />刷新</button>{canManage ? <><button className="sc-button sc-button-secondary" onClick={() => setModal("forwarder")}><Truck size={16} />新增货代</button><button className="sc-button sc-button-primary" onClick={openPurchase}><Plus size={17} />登记采购单</button></> : null}</div>
    </header>
    {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
    {success ? <div className="sc-warehouse-success"><CheckCircle2 size={17} />{success}<button onClick={() => setSuccess("")}><X size={14} /></button></div> : null}
    <div className="sc-warehouse-metrics">
      <article><span><PackagePlus size={20} /></span><div><small>采购单</small><strong>{orders.length}</strong><em>{orders.reduce((sum, item) => sum + item.lines.length, 0)} 个采购明细</em></div></article>
      <article className="is-money"><span><CircleDollarSign size={20} /></span><div><small>采购实付</small><strong>{currency.format(orders.reduce((sum, item) => sum + item.paidTotalCny, 0))}</strong><em>含运费、优惠及其他调整</em></div></article>
      <article><span><Tag size={20} /></span><div><small>待编正式 SKU</small><strong>{temporaryRefs.length}</strong><em>绑定失败将阻止 WMS 建单</em></div></article>
      <article><span><Truck size={20} /></span><div><small>货代收货点</small><strong>{forwarders.reduce((sum, item) => sum + item.locations.length, 0)}</strong><em>发布文件使用地址快照</em></div></article>
    </div>
    <ProcurementOrderBoard
      orders={orders}
      requests={requests}
      canManage={canManage}
      saving={saving}
      selectedLineIds={selectedPurchaseLines}
      onSelectionChange={setSelectedPurchaseLines}
      onBatchReceive={() => void batchReceive()}
      onEdit={openEditPurchase}
      canEdit={canEditPurchase}
      onEvent={(purchaseOrder, line, action, receiveAll) => void recordEvent(purchaseOrder, line, action, receiveAll)}
      onHandoff={onHandoff}
    />
    <details className="sc-warehouse-panel sc-procurement-sku-panel" open={temporaryRefs.length > 0}>
      <summary><div><small>SKU CODING</small><h3>临时商品转正式 SKU</h3></div><span><Tag size={18} />{temporaryRefs.length} 个待处理</span></summary>
      <div className="sc-detail-expenses">{temporaryRefs.map((item) => <article key={item.id}><span><Tag size={17} /></span><div><b>{item.temporarySku}</b><small>{item.productName}{item.codingError ? ` · ${item.codingError}` : ""}</small><input value={skuInputs[item.id] || ""} onChange={(event) => setSkuInputs((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="正式 SKU" /></div>{canManage ? <button disabled={saving} onClick={() => void bindSku(item)}>绑定</button> : null}</article>)}{!temporaryRefs.length ? <div className="sc-warehouse-empty"><CheckCircle2 size={20} />所有商品均已有正式 SKU</div> : null}</div>
    </details>

    {modal === "purchase" ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">1688 PURCHASE ORDER</span><h2>{editingPurchaseOrder ? `修正采购单 ${editingPurchaseOrder.purchaseNo}` : "登记采购单与实付成本"}</h2><p>{editingPurchaseOrder ? "可修正实付、商品金额和共享费用分摊；采购数量保持不变，避免影响后续收货。" : "多商品订单逐行填写商品金额，实付差额将自动按金额占比分摊并处理尾差。"}</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={19} /></button></header><div className="sc-editor-scroll">
      <section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4"><label>供应商<input value={order.supplierName} onChange={(event) => setOrder({ ...order, supplierName: event.target.value })} /></label><label>1688 订单号<input value={order.externalOrderNo} onChange={(event) => setOrder({ ...order, externalOrderNo: event.target.value })} /></label><label>订单链接<input value={order.orderUrl} onChange={(event) => setOrder({ ...order, orderUrl: event.target.value })} /></label><label>下单日期<input type="date" value={order.orderedAt} onChange={(event) => setOrder({ ...order, orderedAt: event.target.value })} /></label><label>实付总额<input type="number" min="0" step="0.01" value={order.paidTotalCny} onChange={(event) => setOrder({ ...order, paidTotalCny: Number(event.target.value) })} /></label><label>商品金额合计<input disabled value={merchandiseTotal.toFixed(2)} /></label><label>共享金额<input disabled value={(order.paidTotalCny - merchandiseTotal).toFixed(2)} /></label><label>备注<input value={order.note} onChange={(event) => setOrder({ ...order, note: event.target.value })} /></label><label><span><input type="checkbox" checked={manualAllocation} onChange={(event) => setManualAllocation(event.target.checked)} /> 人工分摊实付金额</span></label>{manualAllocation ? <label className="full">分摊调整原因<input value={allocationReason} onChange={(event) => setAllocationReason(event.target.value)} /></label> : null}</div></section>
      <section className="sc-form-section"><div className="sc-section-heading"><span>02</span><div><b>采购商品明细</b><small>{editingPurchaseOrder ? "已下单数量不可改；请修正商品金额及分摊后金额。" : "可合并多张需求；采购前确认断货的商品可直接终止，不再长期挂单。"}</small></div></div><div className="sc-create-lines sc-procurement-lines"><div className="head"><span>选择 / 商品</span><span>采购数量</span><span>{manualAllocation ? "商品金额 / 分摊后" : "商品金额"}</span></div>{purchaseEditorLines.map(({ request, line, remainingQty }) => { const draft = lineDrafts[line.id]; return <div key={line.id}><span className="product"><input type="checkbox" disabled={Boolean(editingPurchaseOrder)} checked={Boolean(draft?.selected)} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], selected: event.target.checked } }))} /><em><b>{line.sku}</b><small>{line.productName} · {request.requestNo} · {editingPurchaseOrder ? "数量已锁定" : `剩余 ${remainingQty}`}</small></em>{!editingPurchaseOrder && canManage ? <button className="sc-line-stop" type="button" disabled={saving} onClick={() => void changeLineProcurement(request, line, "close")}><Ban size={13} />终止采购</button> : null}</span><label><input type="number" disabled={Boolean(editingPurchaseOrder)} min="0" max={remainingQty} value={draft?.quantity || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], quantity: Number(event.target.value) } }))} /> {line.unit}</label><label><input type="number" min="0" step="0.01" value={draft?.merchandiseAmount || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], merchandiseAmount: Number(event.target.value) } }))} />{manualAllocation ? <input aria-label="分摊后金额" type="number" min="0" step="0.01" value={draft?.allocatedAmount || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], allocatedAmount: Number(event.target.value) } }))} /> : null}</label></div>; })}{!purchaseEditorLines.length ? <div className="sc-warehouse-empty">没有已提交且待采购的 V2 需求</div> : null}</div>{!editingPurchaseOrder && closedLines.length ? <details className="sc-closed-procurement"><summary>已终止采购商品（{closedLines.length}）</summary><div>{closedLines.map(({ request, line }) => <article key={line.id}><div><b>{line.sku} · {line.productName}</b><small>{request.requestNo} · {line.procurementClosedReason || "采购前终止"}</small></div>{canManage ? <button type="button" disabled={saving} onClick={() => void changeLineProcurement(request, line, "reopen")}><RotateCcw size={13} />恢复采购</button> : null}</article>)}</div></details> : null}</section>
    </div><footer className="sc-modal-foot"><span>{editingPurchaseOrder ? "保存后会重新计算各商品预计单价并同步成本明细。" : "预计分摊后单价会写入采购明细，最终到仓成本按合格数量核算。"}</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void savePurchase()}>{editingPurchaseOrder ? "保存修正" : "保存采购单"}</button></div></footer></section></div> : null}

    {modal === "forwarder" ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">FORWARDER DIRECTORY</span><h2>新增货代收货点</h2><p>出运计划会保存不可变地址快照。</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={19} /></button></header><div className="sc-editor-scroll"><section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4">{([['code','货代编码'],['name','货代名称'],['locationName','收货点名称'],['country','国家'],['province','省份'],['city','城市'],['address','详细地址'],['contactName','联系人'],['contactPhone','电话'],['routingRequirements','路由要求']] as const).map(([key, label]) => <label className={key === "address" || key === "routingRequirements" ? "full" : ""} key={key}>{label}<input value={forwarder[key]} onChange={(event) => setForwarder({ ...forwarder, [key]: event.target.value })} /></label>)}</div></section></div><footer className="sc-modal-foot"><span /><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void saveForwarder()}>保存档案</button></div></footer></section></div> : null}
  </section>;
}

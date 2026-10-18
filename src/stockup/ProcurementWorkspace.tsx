import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, CircleDollarSign, Link2, PackagePlus, Plus, RefreshCw, Tag, Truck, X } from "lucide-react";
import {
  bindStockupFormalSku,
  createStockupForwarder,
  createStockupPurchaseOrder,
  fetchStockupForwarders,
  fetchStockupProductRefs,
  fetchStockupPurchaseOrders,
  recordStockupPurchaseEvent,
} from "../api";
import type { StockupForwarder, StockupProductRef, StockupPurchaseOrder, StockupRequest } from "./types";

type Props = {
  requests: StockupRequest[];
  canManage: boolean;
  onChanged: () => void | Promise<void>;
};

type PurchaseLineDraft = { requestLineId: string; quantity: number; merchandiseAmount: number; allocatedAmount: number; selected: boolean };

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });

export function ProcurementWorkspace({ requests, canManage, onChanged }: Props) {
  const [orders, setOrders] = useState<StockupPurchaseOrder[]>([]);
  const [productRefs, setProductRefs] = useState<StockupProductRef[]>([]);
  const [forwarders, setForwarders] = useState<StockupForwarder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modal, setModal] = useState<"purchase" | "forwarder" | "">("");
  const [order, setOrder] = useState({ supplierName: "", externalOrderNo: "", orderUrl: "", paidTotalCny: 0, orderedAt: new Date().toISOString().slice(0, 10), note: "" });
  const [manualAllocation, setManualAllocation] = useState(false);
  const [allocationReason, setAllocationReason] = useState("");
  const [lineDrafts, setLineDrafts] = useState<Record<string, PurchaseLineDraft>>({});
  const [skuInputs, setSkuInputs] = useState<Record<string, string>>({});
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
    .flatMap((request) => request.lines.map((line) => ({ request, line, remainingQty: Math.max(0, line.requestedQty - (purchasedByRequestLine[line.id] || 0)) })))
    .filter((item) => item.remainingQty > 0), [purchasedByRequestLine, requests]);
  const temporaryRefs = productRefs.filter((item) => item.codingStatus !== "coded");
  const selectedLines = Object.values(lineDrafts).filter((item) => item.selected);
  const merchandiseTotal = selectedLines.reduce((sum, item) => sum + Number(item.merchandiseAmount || 0), 0);

  function openPurchase() {
    setError(""); setSuccess("");
    setLineDrafts(Object.fromEntries(purchasableLines.map(({ line, remainingQty }) => [line.id, { requestLineId: line.id, quantity: remainingQty, merchandiseAmount: 0, allocatedAmount: 0, selected: false }])));
    setOrder({ supplierName: "", externalOrderNo: "", orderUrl: "", paidTotalCny: 0, orderedAt: new Date().toISOString().slice(0, 10), note: "" });
    setManualAllocation(false); setAllocationReason("");
    setModal("purchase");
  }

  async function savePurchase() {
    const lines = selectedLines.map(({ selected: _selected, allocatedAmount: _allocatedAmount, ...line }) => line);
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
      const result = await createStockupPurchaseOrder({ ...order, platform: "1688", lines, ...(manualAllocation ? { allocationOverrides, allocationOverrideReason: allocationReason } : {}) });
      setSuccess(`采购单 ${result.purchaseOrder.purchaseNo} 已建立，共享金额已按商品金额自动分摊。`);
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

  async function recordEvent(purchaseOrder: StockupPurchaseOrder, lineId: string, action: "receive" | "cancel" | "refund" | "reship") {
    const quantity = action === "refund" || action === "reship" ? Number(window.prompt(action === "refund" ? "本次退款同时取消的数量（没有则填 0）：" : "补发数量：", "0") || 0) : Number(window.prompt(action === "receive" ? "本次到货数量：" : "断货/取消数量：", "0") || 0);
    const amountCny = action === "refund" ? Number(window.prompt("退款金额（元）：", "0") || 0) : 0;
    if ((action !== "refund" && action !== "reship" && quantity <= 0) || (action === "refund" && amountCny <= 0) || (action === "reship" && quantity <= 0)) return;
    const note = window.prompt("备注（可选）：", "") || "";
    setSaving(true); setError("");
    try { await recordStockupPurchaseEvent(purchaseOrder.id, { lineId, action, quantity, amountCny, note }); setSuccess("采购进度与净采购成本已更新。"); await Promise.all([load(), onChanged()]); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "采购事件登记失败"); }
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
    <div className="sc-warehouse-analytics">
      <article className="sc-warehouse-panel" style={{ gridColumn: "span 2" }}><header><div><small>PURCHASE ORDERS</small><h3>1688 采购单</h3></div><Boxes size={20} /></header><div className="sc-detail-expenses">{orders.flatMap((item) => [<article key={item.id}><span><Link2 size={17} /></span><div><b>{item.purchaseNo} · {item.supplierName}</b><small>{item.externalOrderNo || "未填平台订单号"} · {item.lines.length} 行 · 共享金额 {currency.format(item.sharedAmountCny)}</small></div><strong>{currency.format(item.paidTotalCny)}</strong><i className={`sc-wo-status is-${item.status}`}>{item.status === "ordered" ? "已下单" : item.status}</i></article>, ...item.lines.map((line) => <article key={line.id}><span><PackagePlus size={17} /></span><div><b>{line.sku} · {line.productName}</b><small>采购 {line.quantity} {line.unit} · 已到 {line.receivedQty} · 取消 {line.cancelledQty} · 退款 {currency.format(line.refundedAmountCny)}</small></div><strong>{currency.format(line.estimatedUnitCostCny)}/件</strong>{canManage ? <div><button disabled={saving} onClick={() => void recordEvent(item, line.id, "receive")}>到货</button><button disabled={saving} onClick={() => void recordEvent(item, line.id, "cancel")}>断货</button><button disabled={saving} onClick={() => void recordEvent(item, line.id, "refund")}>退款</button><button disabled={saving} onClick={() => void recordEvent(item, line.id, "reship")}>补发</button></div> : null}</article>)])}{!orders.length ? <div className="sc-warehouse-empty">暂无采购单</div> : null}</div></article>
      <article className="sc-warehouse-panel"><header><div><small>SKU CODING</small><h3>临时商品转正式 SKU</h3></div><Tag size={20} /></header><div className="sc-detail-expenses">{temporaryRefs.map((item) => <article key={item.id}><span><Tag size={17} /></span><div><b>{item.temporarySku}</b><small>{item.productName}{item.codingError ? ` · ${item.codingError}` : ""}</small><input value={skuInputs[item.id] || ""} onChange={(event) => setSkuInputs((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="正式 SKU" /></div>{canManage ? <button disabled={saving} onClick={() => void bindSku(item)}>绑定</button> : null}</article>)}{!temporaryRefs.length ? <div className="sc-warehouse-empty"><CheckCircle2 size={20} />所有商品均已有正式 SKU</div> : null}</div></article>
    </div>

    {modal === "purchase" ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">1688 PURCHASE ORDER</span><h2>登记采购单与实付成本</h2><p>多商品订单逐行填写商品金额，实付差额将自动按金额占比分摊并处理尾差。</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={19} /></button></header><div className="sc-editor-scroll">
      <section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4"><label>供应商<input value={order.supplierName} onChange={(event) => setOrder({ ...order, supplierName: event.target.value })} /></label><label>1688 订单号<input value={order.externalOrderNo} onChange={(event) => setOrder({ ...order, externalOrderNo: event.target.value })} /></label><label>订单链接<input value={order.orderUrl} onChange={(event) => setOrder({ ...order, orderUrl: event.target.value })} /></label><label>下单日期<input type="date" value={order.orderedAt} onChange={(event) => setOrder({ ...order, orderedAt: event.target.value })} /></label><label>实付总额<input type="number" min="0" step="0.01" value={order.paidTotalCny} onChange={(event) => setOrder({ ...order, paidTotalCny: Number(event.target.value) })} /></label><label>商品金额合计<input disabled value={merchandiseTotal.toFixed(2)} /></label><label>共享金额<input disabled value={(order.paidTotalCny - merchandiseTotal).toFixed(2)} /></label><label>备注<input value={order.note} onChange={(event) => setOrder({ ...order, note: event.target.value })} /></label><label><span><input type="checkbox" checked={manualAllocation} onChange={(event) => setManualAllocation(event.target.checked)} /> 人工分摊实付金额</span></label>{manualAllocation ? <label className="full">分摊调整原因<input value={allocationReason} onChange={(event) => setAllocationReason(event.target.value)} /></label> : null}</div></section>
      <section className="sc-form-section"><div className="sc-section-heading"><span>02</span><div><b>采购商品明细</b><small>可合并多张需求，但每行必须填写本次数量和商品金额。</small></div></div><div className="sc-create-lines"><div className="head"><span>选择 / 商品</span><span>采购数量</span><span>{manualAllocation ? "商品金额 / 分摊后" : "商品金额"}</span></div>{purchasableLines.map(({ request, line, remainingQty }) => { const draft = lineDrafts[line.id]; return <div key={line.id}><span className="product"><input type="checkbox" checked={Boolean(draft?.selected)} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], selected: event.target.checked } }))} /><em><b>{line.sku}</b><small>{line.productName} · {request.requestNo} · 剩余 {remainingQty}</small></em></span><label><input type="number" min="0" max={remainingQty} value={draft?.quantity || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], quantity: Number(event.target.value) } }))} /> {line.unit}</label><label><input type="number" min="0" step="0.01" value={draft?.merchandiseAmount || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], merchandiseAmount: Number(event.target.value) } }))} />{manualAllocation ? <input aria-label="分摊后金额" type="number" min="0" step="0.01" value={draft?.allocatedAmount || 0} onChange={(event) => setLineDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], allocatedAmount: Number(event.target.value) } }))} /> : null}</label></div>; })}{!purchasableLines.length ? <div className="sc-warehouse-empty">没有已提交且待采购的 V2 需求</div> : null}</div></section>
    </div><footer className="sc-modal-foot"><span>预计分摊后单价会写入采购明细，最终到仓成本按合格数量核算。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void savePurchase()}>保存采购单</button></div></footer></section></div> : null}

    {modal === "forwarder" ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">FORWARDER DIRECTORY</span><h2>新增货代收货点</h2><p>出运计划会保存不可变地址快照。</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={19} /></button></header><div className="sc-editor-scroll"><section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4">{([['code','货代编码'],['name','货代名称'],['locationName','收货点名称'],['country','国家'],['province','省份'],['city','城市'],['address','详细地址'],['contactName','联系人'],['contactPhone','电话'],['routingRequirements','路由要求']] as const).map(([key, label]) => <label className={key === "address" || key === "routingRequirements" ? "full" : ""} key={key}>{label}<input value={forwarder[key]} onChange={(event) => setForwarder({ ...forwarder, [key]: event.target.value })} /></label>)}</div></section></div><footer className="sc-modal-foot"><span /><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={saving} onClick={() => void saveForwarder()}>保存档案</button></div></footer></section></div> : null}
  </section>;
}


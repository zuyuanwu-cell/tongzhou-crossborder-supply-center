import React, { useEffect, useState } from "react";
import { Calculator, CheckCircle2, CircleDollarSign, FileCheck2, Plus, ReceiptText, ShieldCheck } from "lucide-react";
import { addStockupCollaborationCostItem, previewStockupCollaborationCost, saveStockupCollaborationCostVersion } from "../api";
import type { StockupReceipt, StockupRequest } from "./types";
import { formatStockupDate } from "./status";

type Props = {
  receipts: StockupReceipt[];
  canEdit: boolean;
  canLock: boolean;
  loadRequest: (id: string) => Promise<StockupRequest>;
  onChanged: () => Promise<void>;
};

export function CostSettlementWorkspace({ receipts, canEdit, canLock, loadRequest, onChanged }: Props) {
  const [selected, setSelected] = useState<StockupReceipt | null>(null);
  const [preview, setPreview] = useState<Record<string, any> | null>(null);
  const [form, setForm] = useState({ category: "头程", name: "头程运费", stage: "实际", vendor: "", invoiceNo: "", occurredAt: new Date().toISOString().slice(0, 10), originalAmount: 0, currency: "CNY", exchangeRate: 1, included: true, allocationMethod: "quantity", note: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function chooseReceipt(receipt: StockupReceipt) {
    setError("");
    const detail = await loadRequest(receipt.requestId);
    const full = detail.receipts?.find((item) => item.id === receipt.id) || receipt;
    setSelected(full);
    try { setPreview(await previewStockupCollaborationCost(receipt.id)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "成本试算失败"); }
  }

  async function addFee() {
    if (!selected || form.originalAmount < 0) return;
    setBusy(true); setError("");
    try { await addStockupCollaborationCostItem({ receiptId: selected.id, ...form }); setPreview(await previewStockupCollaborationCost(selected.id)); await onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "费用保存失败"); }
    finally { setBusy(false); }
  }

  async function version(action: "submit-review" | "lock") {
    if (!selected) return;
    setBusy(true); setError("");
    try { await saveStockupCollaborationCostVersion(selected.id, action); setPreview(await previewStockupCollaborationCost(selected.id)); await onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "成本版本保存失败"); }
    finally { setBusy(false); }
  }

  return <div className="sc-cost-layout">
    <section className="sc-panel sc-cost-receipts"><div className="sc-panel-head compact"><div><span className="sc-eyebrow">COST QUEUE</span><h3>到仓批次</h3><p>选择批次后收集费用并核算。</p></div></div><div className="sc-cost-receipt-list">{receipts.map((receipt) => <button className={selected?.id === receipt.id ? "is-active" : ""} key={receipt.id} onClick={() => void chooseReceipt(receipt)}><span><ReceiptText size={18} /></span><div><b>{receipt.receiptNo}</b><small>{receipt.warehouseName} · {formatStockupDate(receipt.arrivedAt)}</small></div><em>{receipt.status === "costed" ? "已锁定" : "待核算"}</em></button>)}{!receipts.length ? <div className="sc-empty-inline"><ReceiptText size={24} /><b>暂无到仓批次</b><span>仓库确认收货后会进入这里。</span></div> : null}</div></section>
    <section className="sc-panel sc-cost-main"><div className="sc-panel-head"><div><span className="sc-eyebrow">LANDED COST</span><h3>{selected ? `${selected.receiptNo} 成本结算` : "选择一个到仓批次"}</h3><p>{selected ? `${selected.warehouseName} · 实际到仓 ${formatStockupDate(selected.arrivedAt)}` : "费用、分摊、复核和锁定集中在一个工作区。"}</p></div>{preview ? <span className={`sc-status-badge ${preview.canLock ? "sc-status-success" : "sc-status-warning"}`}>{preview.canLock ? "可锁定" : "数据待补齐"}</span> : null}</div>
      {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
      {selected && preview ? <>
        <div className="sc-cost-metrics"><article><CircleDollarSign size={20} /><small>货品成本</small><b>¥{Number(preview.totals?.goodsCostCny || 0).toLocaleString()}</b></article><article><Calculator size={20} /><small>分摊费用</small><b>¥{Number(preview.totals?.allocatedCostCny || 0).toLocaleString()}</b></article><article><FileCheck2 size={20} /><small>到仓总成本</small><b>¥{Number(preview.totals?.totalCostCny || 0).toLocaleString()}</b></article><article className="accent"><ShieldCheck size={20} /><small>加权单价</small><b>¥{Number(preview.totals?.unitCostCny || 0).toFixed(2)}</b></article></div>
        {canEdit ? <div className="sc-fee-entry"><div className="sc-form-grid sc-form-grid-4"><label>费用分类<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value, name: event.target.value })}><option>货品</option><option>国内段</option><option>作业</option><option>头程</option><option>清关</option><option>保险</option><option>海外仓</option><option>调整</option></select></label><label>费用名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>金额<input type="number" min="0" step="0.01" value={form.originalAmount} onChange={(event) => setForm({ ...form, originalAmount: Number(event.target.value) })} /></label><label>币种<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>CNY</option><option>USD</option><option>RUB</option><option>MYR</option><option>IDR</option><option>VND</option></select></label><label>汇率<input type="number" min="0.000001" step="0.000001" value={form.exchangeRate} onChange={(event) => setForm({ ...form, exchangeRate: Number(event.target.value) })} /></label><label>分摊方式<select value={form.allocationMethod} onChange={(event) => setForm({ ...form, allocationMethod: event.target.value })}><option value="quantity">按数量</option><option value="weight">按重量</option><option value="volume">按体积</option><option value="value">按货值</option></select></label><label>供应商<input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></label><label>单据号<input value={form.invoiceNo} onChange={(event) => setForm({ ...form, invoiceNo: event.target.value })} /></label></div><button className="sc-button sc-button-secondary" disabled={busy} onClick={addFee}><Plus size={16} />添加费用</button></div> : null}
        <div className="sc-cost-table"><div className="head"><span>SKU / 产品</span><span>良品数量</span><span>货品成本</span><span>分摊费用</span><span>到仓总成本</span><span>到仓单价</span></div>{(preview.lines || []).map((line: Record<string, any>) => <div key={line.receiptLineId}><span><b>{line.sku}</b><small>{line.productName}</small></span><span>{line.goodQty}</span><span>¥{Number(line.goodsCostCny).toFixed(2)}</span><span>¥{Number(line.allocatedCostCny).toFixed(2)}</span><span>¥{Number(line.totalCostCny).toFixed(2)}</span><span><b>¥{Number(line.unitCostCny).toFixed(2)}</b></span></div>)}</div>
        <footer className="sc-cost-actions"><div>{preview.canLock ? <><CheckCircle2 size={16} />货品成本与良品数量已齐，可提交锁定。</> : <>补齐良品数量与货品单位成本后才可锁定。</>}</div><div>{canEdit ? <button className="sc-button sc-button-secondary" disabled={busy} onClick={() => version("submit-review")}>提交复核</button> : null}{canLock ? <button className="sc-button sc-button-primary" disabled={busy || !preview.canLock} onClick={() => version("lock")}><ShieldCheck size={16} />锁定成本</button> : null}</div></footer>
      </> : <div className="sc-empty"><CircleDollarSign size={34} /><h4>选择左侧到仓批次</h4><p>系统会自动试算货品成本与各项费用分摊。</p></div>}
    </section>
  </div>;
}

import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  Download,
  FileCheck2,
  History,
  Info,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Scale,
  ShieldCheck,
  Sigma,
  Trash2,
  Weight,
  X,
} from "lucide-react";
import {
  addStockupCollaborationCostItem,
  changeStockupReceiptLifecycle,
  previewStockupCollaborationCost,
  saveStockupCollaborationCostVersion,
  updateStockupCollaborationCostItem,
  voidStockupCollaborationCostItem,
} from "../api";
import { downloadCostSettlementWorkbook } from "./cost-settlement-export";
import type { StockupReceipt, StockupRequest } from "./types";
import { formatStockupDate } from "./status";

type Props = {
  receipts: StockupReceipt[];
  initialReceiptId?: string;
  canEdit: boolean;
  canLock: boolean;
  loadRequest: (id: string) => Promise<StockupRequest>;
  onChanged: () => Promise<void>;
};

type CostItem = {
  id: string;
  category: string;
  name: string;
  stage: string;
  vendor: string;
  invoiceNo: string;
  occurredAt: string;
  originalAmount: number;
  currency: string;
  exchangeRate: number;
  amountCny: number;
  included: boolean;
  allocationMethod: string;
  note: string;
};

type Explanation = { label?: string; formula?: string; details?: string[] };

type Preview = {
  receipt: StockupReceipt;
  items: CostItem[];
  lines: Array<Record<string, any>>;
  skuSummary: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
  totals: Record<string, number>;
  metricExplanations: Record<string, Explanation>;
  formulaVersion: string;
  calculatedAt: string;
  editable: boolean;
  adjustmentRequired: boolean;
  canLock: boolean;
};

type CostForm = Omit<CostItem, "id" | "amountCny">;

const emptyForm = (): CostForm => ({
  category: "头程",
  name: "头程运费",
  stage: "实际",
  vendor: "",
  invoiceNo: "",
  occurredAt: new Date().toISOString().slice(0, 10),
  originalAmount: 0,
  currency: "CNY",
  exchangeRate: 1,
  included: true,
  allocationMethod: "quantity",
  note: "",
});

const allocationLabels: Record<string, string> = {
  quantity: "按数量",
  weight: "按重量",
  volume: "按体积",
  value: "按货值",
};

const versionLabels: Record<string, string> = {
  review: "待复核",
  locked: "已锁定",
  adjustment_draft: "调整中",
};

function money(value: unknown) {
  return Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberText(value: unknown, digits = 4) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function FormulaPopover({ explanation, lines }: { explanation?: Explanation; lines?: string[] }) {
  const details = lines || explanation?.details || [];
  return (
    <span className="sc-formula-trigger" tabIndex={0} aria-label="查看计算过程">
      <Info size={14} />
      <span className="sc-formula-popover" role="tooltip">
        <b>{explanation?.label || "计算过程"}</b>
        {explanation?.formula ? <code>{explanation.formula}</code> : null}
        {details.length ? <ul>{details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul> : <small>暂无拆分明细</small>}
      </span>
    </span>
  );
}

function MetricCard({ icon, label, value, explanation, accent = false }: { icon: React.ReactNode; label: string; value: string; explanation?: Explanation; accent?: boolean }) {
  return (
    <article className={accent ? "accent" : ""}>
      <div className="sc-cost-metric-label">{icon}<small>{label}</small><FormulaPopover explanation={explanation} /></div>
      <b>{value}</b>
    </article>
  );
}

export function CostSettlementWorkspace({ receipts, initialReceiptId = "", canEdit, canLock, loadRequest, onChanged }: Props) {
  const [selected, setSelected] = useState<StockupReceipt | null>(null);
  const [view, setView] = useState<"pending" | "settled" | "archived" | "deleted">("pending");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState<CostForm>(emptyForm);
  const [editingItemId, setEditingItemId] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const visibleReceipts = useMemo(() => receipts.filter((receipt) => {
    if (view === "pending") return receipt.lifecycleStatus === "active" && receipt.status !== "costed";
    if (view === "settled") return receipt.lifecycleStatus === "active" && receipt.status === "costed";
    return receipt.lifecycleStatus === view;
  }), [receipts, view]);

  async function hydrateReceipt(receiptId: string, requestId?: string) {
    const source = receipts.find((item) => item.id === receiptId);
    const targetRequestId = requestId || source?.requestId || selected?.requestId;
    if (!targetRequestId) return source || null;
    const detail = await loadRequest(targetRequestId);
    return detail.receipts?.find((item) => item.id === receiptId) || source || null;
  }

  async function refreshSelected(receiptId = selected?.id, requestId = selected?.requestId) {
    if (!receiptId) return;
    await onChanged();
    const [freshReceipt, freshPreview] = await Promise.all([
      hydrateReceipt(receiptId, requestId),
      previewStockupCollaborationCost(receiptId) as Promise<Preview>,
    ]);
    if (freshReceipt) setSelected(freshReceipt);
    setPreview(freshPreview);
  }

  async function chooseReceipt(receipt: StockupReceipt) {
    setError("");
    setEditingItemId("");
    try {
      const [full, nextPreview] = await Promise.all([
        hydrateReceipt(receipt.id, receipt.requestId),
        previewStockupCollaborationCost(receipt.id) as Promise<Preview>,
      ]);
      setSelected(full || receipt);
      setPreview(nextPreview);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成本试算失败");
    }
  }

  useEffect(() => {
    if (!initialReceiptId || selected?.id === initialReceiptId) return;
    const receipt = receipts.find((item) => item.id === initialReceiptId);
    if (!receipt) return;
    setView(receipt.lifecycleStatus === "archived" ? "archived" : receipt.lifecycleStatus === "deleted" ? "deleted" : receipt.status === "costed" ? "settled" : "pending");
    void chooseReceipt(receipt);
  }, [initialReceiptId, receipts]);

  function editFee(item: CostItem) {
    setEditingItemId(item.id);
    setForm({
      category: item.category,
      name: item.name,
      stage: item.stage || "实际",
      vendor: item.vendor || "",
      invoiceNo: item.invoiceNo || "",
      occurredAt: item.occurredAt || new Date().toISOString().slice(0, 10),
      originalAmount: Number(item.originalAmount || 0),
      currency: item.currency || "CNY",
      exchangeRate: Number(item.exchangeRate || 1),
      included: Boolean(item.included),
      allocationMethod: item.allocationMethod || "quantity",
      note: item.note || "",
    });
  }

  function cancelEdit() {
    setEditingItemId("");
    setForm(emptyForm());
  }

  async function saveFee() {
    if (!selected || form.originalAmount < 0 || !form.name.trim()) return;
    setBusy(true);
    setError("");
    try {
      if (editingItemId) await updateStockupCollaborationCostItem(editingItemId, form);
      else await addStockupCollaborationCostItem({ receiptId: selected.id, ...form });
      cancelEdit();
      await refreshSelected(selected.id, selected.requestId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "费用保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeFee(item: CostItem) {
    if (!selected || !window.confirm(`确认作废费用“${item.name}”吗？原始记录会保留在审计日志中。`)) return;
    setBusy(true);
    setError("");
    try {
      await voidStockupCollaborationCostItem(item.id);
      if (editingItemId === item.id) cancelEdit();
      await refreshSelected(selected.id, selected.requestId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "费用作废失败");
    } finally {
      setBusy(false);
    }
  }

  async function version(action: "submit-review" | "lock" | "adjust") {
    if (!selected) return;
    if (action === "adjust" && !adjustmentNote.trim()) {
      setError("请先填写调整原因，原锁定版本会继续保留。 ");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveStockupCollaborationCostVersion(selected.id, action, action === "adjust" ? { note: adjustmentNote.trim() } : {});
      setAdjustmentNote("");
      await refreshSelected(selected.id, selected.requestId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "成本版本保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function changeLifecycle(action: "archive" | "activate" | "delete" | "restore") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await changeStockupReceiptLifecycle(selected.id, action);
      setSelected(result.receipt);
      setView(result.receipt.lifecycleStatus === "active" ? "settled" : result.receipt.lifecycleStatus);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "批次状态更新失败");
    } finally {
      setBusy(false);
    }
  }

  const statusText = selected?.lifecycleStatus === "deleted" ? "回收站" : selected?.lifecycleStatus === "archived" ? "已归档" : selected?.status === "costed" ? "已锁定" : selected?.status === "cost_review" ? "待复核" : selected?.status === "cost_adjusting" ? "调整中" : "待核算";
  const canMaintainFees = Boolean(canEdit && selected?.lifecycleStatus === "active" && preview?.editable);

  return (
    <div className="sc-cost-layout">
      <section className="sc-panel sc-cost-receipts">
        <div className="sc-panel-head compact">
          <div><span className="sc-eyebrow">COST QUEUE</span><h3>到仓批次</h3><p>锁定后仍可发起调整版，历史结果不会被覆盖。</p></div>
        </div>
        <div className="sc-lifecycle-tabs">
          {([['pending', '待核算'], ['settled', '已结算'], ['archived', '已归档'], ['deleted', '回收站']] as const).map(([id, label]) => {
            const count = receipts.filter((receipt) => id === "pending" ? receipt.lifecycleStatus === "active" && receipt.status !== "costed" : id === "settled" ? receipt.lifecycleStatus === "active" && receipt.status === "costed" : receipt.lifecycleStatus === id).length;
            return <button className={view === id ? "is-active" : ""} key={id} onClick={() => { setView(id); setSelected(null); setPreview(null); }}>{label}<span>{count}</span></button>;
          })}
        </div>
        <div className="sc-cost-receipt-list">
          {visibleReceipts.map((receipt) => (
            <button className={selected?.id === receipt.id ? "is-active" : ""} key={receipt.id} onClick={() => void chooseReceipt(receipt)}>
              <span><ReceiptText size={18} /></span>
              <div><b>{receipt.receiptNo}</b><small>{receipt.warehouseName} · {formatStockupDate(receipt.arrivedAt)}</small></div>
              <em>{receipt.lifecycleStatus === "deleted" ? "回收站" : receipt.lifecycleStatus === "archived" ? "已归档" : receipt.status === "costed" ? "已锁定" : receipt.status === "cost_review" ? "待复核" : receipt.status === "cost_adjusting" ? "调整中" : "待核算"}</em>
            </button>
          ))}
          {!visibleReceipts.length ? <div className="sc-empty-inline"><ReceiptText size={24} /><b>当前分组暂无批次</b><span>到仓、结算或归档后会自动进入对应分组。</span></div> : null}
        </div>
      </section>

      <section className="sc-panel sc-cost-main">
        <div className="sc-panel-head">
          <div><span className="sc-eyebrow">LANDED COST</span><h3>{selected ? `${selected.receiptNo} 成本结算` : "选择一个到仓批次"}</h3><p>{selected ? `${selected.warehouseName} · 实际到仓 ${formatStockupDate(selected.arrivedAt)}` : "费用、分摊、复核和锁定集中在一个工作区。"}</p></div>
          <div className="sc-cost-head-actions">
            {preview && selected ? <button className="sc-button sc-button-secondary" onClick={() => downloadCostSettlementWorkbook(selected, preview)}><Download size={16} />导出 Excel</button> : null}
            {preview ? <span className={`sc-status-badge ${preview.canLock ? "sc-status-success" : selected?.status === "costed" ? "sc-status-active" : "sc-status-warning"}`}>{statusText}</span> : null}
          </div>
        </div>
        {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}

        {selected && preview ? <>
          <div className="sc-cost-metrics sc-cost-metrics-audit">
            <MetricCard icon={<Sigma size={18} />} label="良品总数量" value={numberText(preview.totals.costingQty, 2)} explanation={preview.metricExplanations.costingQty} />
            <MetricCard icon={<Weight size={18} />} label="总重量" value={`${numberText(preview.totals.totalWeightKg)} kg`} explanation={preview.metricExplanations.totalWeightKg} />
            <MetricCard icon={<Scale size={18} />} label="总体积" value={`${numberText(preview.totals.totalVolumeM3, 6)} m³`} explanation={preview.metricExplanations.totalVolumeM3} />
            <MetricCard icon={<CircleDollarSign size={18} />} label="货品成本" value={`¥${money(preview.totals.goodsCostCny)}`} explanation={preview.metricExplanations.goodsCostCny} />
            <MetricCard icon={<Calculator size={18} />} label="分摊费用" value={`¥${money(preview.totals.allocatedCostCny)}`} explanation={preview.metricExplanations.allocatedCostCny} />
            <MetricCard icon={<FileCheck2 size={18} />} label="到仓总成本" value={`¥${money(preview.totals.totalCostCny)}`} explanation={preview.metricExplanations.totalCostCny} />
            <MetricCard icon={<ShieldCheck size={18} />} label="加权单价" value={`¥${money(preview.totals.unitCostCny)}`} explanation={preview.metricExplanations.unitCostCny} accent />
          </div>

          {selected.status === "costed" && canLock ? (
            <div className="sc-adjustment-box">
              <div><History size={20} /><span><b>成本已经锁定</b><small>发起调整版后才能修改。原锁定版本继续保留，可随时追溯。</small></span></div>
              <input value={adjustmentNote} onChange={(event) => setAdjustmentNote(event.target.value)} placeholder="填写调整原因，例如：头程运费分摊有误" />
              <button className="sc-button sc-button-primary" disabled={busy} onClick={() => void version("adjust")}><Pencil size={16} />发起调整版</button>
            </div>
          ) : null}

          {canMaintainFees ? (
            <div className="sc-fee-entry">
              <div className="sc-fee-entry-head"><div><b>{editingItemId ? "编辑费用" : "录入费用"}</b><span>修改后会自动回到待核算，需重新提交复核。</span></div>{editingItemId ? <button className="sc-icon-button" onClick={cancelEdit} aria-label="取消编辑"><X size={17} /></button> : null}</div>
              <div className="sc-form-grid sc-form-grid-4">
                <label>费用分类<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value, name: editingItemId ? form.name : event.target.value })}><option>货品</option><option>国内段</option><option>作业</option><option>头程</option><option>清关</option><option>保险</option><option>海外仓</option><option>调整</option></select></label>
                <label>费用名称<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                <label>原币金额<input type="number" min="0" step="0.01" value={form.originalAmount} onChange={(event) => setForm({ ...form, originalAmount: Number(event.target.value) })} /></label>
                <label>币种<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option>CNY</option><option>USD</option><option>RUB</option><option>MYR</option><option>IDR</option><option>VND</option></select></label>
                <label>人民币汇率<input type="number" min="0.000001" step="0.000001" value={form.exchangeRate} onChange={(event) => setForm({ ...form, exchangeRate: Number(event.target.value) })} /></label>
                <label>分摊方式<select value={form.allocationMethod} onChange={(event) => setForm({ ...form, allocationMethod: event.target.value })}><option value="quantity">按数量</option><option value="weight">按重量</option><option value="volume">按体积</option><option value="value">按货值</option></select></label>
                <label>供应商<input value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></label>
                <label>单据号<input value={form.invoiceNo} onChange={(event) => setForm({ ...form, invoiceNo: event.target.value })} /></label>
                <label>发生日期<input type="date" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} /></label>
                <label className="full">备注<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="记录报价、调账或票据说明" /></label>
              </div>
              <button className="sc-button sc-button-secondary" disabled={busy || !form.name.trim()} onClick={() => void saveFee()}>{editingItemId ? <Pencil size={16} /> : <Plus size={16} />}{editingItemId ? "保存修改" : "添加费用"}</button>
            </div>
          ) : null}

          <section className="sc-finance-section">
            <div className="sc-finance-section-title"><div><span>01</span><div><b>费用台账</b><small>原币、汇率、人民币金额和分摊口径均保留。</small></div></div><em>{preview.items.length} 项</em></div>
            <div className="sc-fee-ledger">
              <div className="head"><span>费用</span><span>供应商 / 单据</span><span>原币金额</span><span>汇率</span><span>人民币金额</span><span>分摊方式</span><span>操作</span></div>
              {preview.items.map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.category} · {item.occurredAt || "未填日期"}</small></span><span><b>{item.vendor || "—"}</b><small>{item.invoiceNo || item.note || "无单据号"}</small></span><span>{money(item.originalAmount)} {item.currency}</span><span>{numberText(item.exchangeRate, 6)}</span><span><b>¥{money(item.amountCny)}</b></span><span>{item.included ? allocationLabels[item.allocationMethod] || item.allocationMethod : "不参与分摊"}</span><span>{canMaintainFees ? <><button onClick={() => editFee(item)} aria-label="编辑费用"><Pencil size={15} /></button><button onClick={() => void removeFee(item)} aria-label="作废费用"><Trash2 size={15} /></button></> : <small>只读</small>}</span></div>)}
              {!preview.items.length ? <div className="sc-fee-ledger-empty">尚未录入附加费用，当前到仓成本仅含货品成本。</div> : null}
            </div>
          </section>

          <section className="sc-finance-section">
            <div className="sc-finance-section-title"><div><span>02</span><div><b>按 SKU 汇总与计算核对</b><small>同一 SKU 的多批次行已合并；将鼠标放在数字旁的信息图标上查看公式。</small></div></div><em>{preview.skuSummary.length} 个 SKU</em></div>
            <div className="sc-cost-table sc-cost-summary-table">
              <div className="head"><span>SKU / 产品</span><span>良品数量</span><span>重量 kg</span><span>体积 m³</span><span>货品成本</span><span>分摊费用</span><span>到仓总成本</span><span>到仓单价</span></div>
              {preview.skuSummary.map((row) => <div key={row.sku}>
                <span><b>{row.sku}</b><small>{row.productName}{row.sourceLineCount > 1 ? ` · 合并 ${row.sourceLineCount} 行` : ""}</small></span>
                <span className="sc-formula-value">{numberText(row.goodQty, 2)}<FormulaPopover lines={row.calculation?.quantity} /></span>
                <span className="sc-formula-value">{numberText(row.weightKg)}<FormulaPopover lines={row.calculation?.weight} /></span>
                <span className="sc-formula-value">{numberText(row.volumeM3, 6)}<FormulaPopover lines={row.calculation?.volume} /></span>
                <span className="sc-formula-value">¥{money(row.goodsCostCny)}<FormulaPopover lines={row.calculation?.goodsCost} /></span>
                <span className="sc-formula-value">¥{money(row.allocatedCostCny)}<FormulaPopover lines={row.calculation?.allocatedCost} /></span>
                <span className="sc-formula-value">¥{money(row.totalCostCny)}<FormulaPopover lines={row.calculation?.totalCost} /></span>
                <span className="sc-formula-value"><b>¥{money(row.unitCostCny)}</b><FormulaPopover lines={row.calculation?.unitCost} /></span>
              </div>)}
            </div>
          </section>

          <section className="sc-finance-section">
            <div className="sc-finance-section-title"><div><span>03</span><div><b>版本与审计轨迹</b><small>每次提交、锁定和调整都生成独立快照。</small></div></div><em>{preview.versions.length} 个版本</em></div>
            <div className="sc-version-list">
              {preview.versions.map((item) => <article key={item.id || item.version}><span>V{item.version}</span><div><b>{versionLabels[item.status] || item.status}</b><small>{formatStockupDate(item.createdAt)} · {item.createdBy || "系统"}{item.note ? ` · ${item.note}` : ""}</small></div><dl><div><dt>总成本</dt><dd>¥{money(item.totalCostCny)}</dd></div><div><dt>单价</dt><dd>¥{money(item.unitCostCny)}</dd></div></dl></article>)}
              {!preview.versions.length ? <div className="sc-fee-ledger-empty">尚未生成复核版本。</div> : null}
            </div>
          </section>

          <footer className="sc-cost-actions">
            <div>{selected.lifecycleStatus !== "active" ? <>归档与回收站中的记录为只读，恢复后才能继续处理。</> : preview.canLock ? <><CheckCircle2 size={16} />当前数据完整，可提交复核或锁定正式成本。</> : selected.status === "costed" ? <><ShieldCheck size={16} />当前显示已锁定版本；如需修改，请发起调整版。</> : <>补齐良品数量与货品单位成本后才可锁定。</>}</div>
            <div>
              {selected.lifecycleStatus === "active" && selected.status !== "costed" && canEdit ? <button className="sc-button sc-button-secondary" disabled={busy} onClick={() => void version("submit-review")}>{selected.status === "cost_review" ? "重新提交复核" : "提交复核"}</button> : null}
              {selected.lifecycleStatus === "active" && selected.status !== "costed" && canLock ? <button className="sc-button sc-button-primary" disabled={busy || !preview.canLock} onClick={() => void version("lock")}><ShieldCheck size={16} />锁定成本</button> : null}
              {selected.lifecycleStatus === "active" && selected.status === "costed" && canLock ? <button className="sc-button sc-button-secondary" disabled={busy} onClick={() => void changeLifecycle("archive")}><Archive size={16} />归档</button> : null}
              {selected.lifecycleStatus === "archived" && canLock ? <><button className="sc-button sc-button-secondary" disabled={busy} onClick={() => void changeLifecycle("activate")}><RotateCcw size={16} />取消归档</button><button className="sc-button sc-button-danger" disabled={busy} onClick={() => void changeLifecycle("delete")}><Trash2 size={16} />移入回收站</button></> : null}
              {selected.lifecycleStatus === "deleted" && canLock ? <button className="sc-button sc-button-secondary" disabled={busy} onClick={() => void changeLifecycle("restore")}><RotateCcw size={16} />恢复到归档</button> : null}
            </div>
          </footer>
          <div className="sc-formula-version">计算口径：{preview.formulaVersion} · 最近试算：{formatStockupDate(preview.calculatedAt)}</div>
        </> : <div className="sc-empty"><CircleDollarSign size={34} /><h4>选择左侧到仓批次</h4><p>系统会自动试算货品成本、SKU 汇总与各项费用分摊。</p></div>}
      </section>
    </div>
  );
}

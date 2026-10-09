import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  Paperclip,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  AfterSalesAttachment,
  WarehouseLiabilityItem,
  WarehouseLiabilityPayload,
  WarehouseLiabilitySettlementBatch,
  createWarehouseLiabilitySettlementBatch,
  downloadWarehouseLiabilitySettlementBatch,
  fetchWarehouseLiabilities,
  postWarehouseLiabilitySettlementBatch,
  resolveApiUrl,
  reverseWarehouseLiabilitySettlementBatch,
  uploadWarehouseLiabilityVoucher,
} from "./api";

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(Number(value || 0));
}

function dateText(value: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toLocaleDateString("zh-CN");
}

function today() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const statusLabels: Record<string, string> = {
  pending_writeoff: "待核销",
  partially_written_off: "部分核销",
  written_off: "已核销",
  disputed: "争议中",
  source_voided: "来源已作废",
};

const batchStatusLabels: Record<string, string> = {
  draft: "待确认",
  posted: "已核销",
  reversed: "已冲销",
};

type SettlementDialog = {
  mode: "create" | "post";
  batch?: WarehouseLiabilitySettlementBatch;
};

export function WarehouseLiabilitySettlement() {
  const [payload, setPayload] = React.useState<WarehouseLiabilityPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [status, setStatus] = React.useState("pending_writeoff");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [dialog, setDialog] = React.useState<SettlementDialog | null>(null);
  const [amounts, setAmounts] = React.useState<Record<string, number>>({});
  const [settlementDate, setSettlementDate] = React.useState(today());
  const [method, setMethod] = React.useState("monthly_statement_offset");
  const [voucherNo, setVoucherNo] = React.useState("");
  const [note, setNote] = React.useState("");
  const [voucherUploads, setVoucherUploads] = React.useState<AfterSalesAttachment[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchWarehouseLiabilities({ keyword, warehouseId, status });
      setPayload(next);
      setSelectedIds((current) => current.filter((id) => next.items.some((item) => item.sourceId === id && !["written_off", "disputed", "source_voided"].includes(item.settlementStatus))));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取仓库责任费用失败。");
    } finally {
      setLoading(false);
    }
  }, [keyword, status, warehouseId]);

  React.useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedItems = React.useMemo(() => {
    const selected = new Set(selectedIds);
    return (payload?.items || []).filter((item) => selected.has(item.sourceId));
  }, [payload?.items, selectedIds]);

  function toggleItem(item: WarehouseLiabilityItem) {
    setError("");
    setSelectedIds((current) => {
      if (current.includes(item.sourceId)) return current.filter((id) => id !== item.sourceId);
      const selectedWarehouse = (payload?.items || []).find((candidate) => current.includes(candidate.sourceId))?.warehouseId;
      if (selectedWarehouse && selectedWarehouse !== item.warehouseId) {
        setError("一个核销批次只能选择同一家仓库的责任费用。");
        return current;
      }
      return [...current, item.sourceId];
    });
  }

  function openCreateDialog() {
    if (!selectedItems.length) {
      setError("请先勾选需要核销的责任费用。");
      return;
    }
    setAmounts(Object.fromEntries(selectedItems.map((item) => [item.sourceId, item.outstandingCny])));
    setSettlementDate(today());
    setMethod("monthly_statement_offset");
    setVoucherNo("");
    setNote("");
    setVoucherUploads([]);
    setDialog({ mode: "create" });
  }

  function openPostDialog(batch: WarehouseLiabilitySettlementBatch) {
    setSettlementDate(batch.settlementDate || today());
    setMethod(batch.method || "monthly_statement_offset");
    setVoucherNo(batch.voucherNo || "");
    setNote(batch.note || "");
    setVoucherUploads(batch.voucherAttachments || []);
    setDialog({ mode: "post", batch });
  }

  async function uploadVoucher(file?: File) {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const result = await uploadWarehouseLiabilityVoucher(file);
      setVoucherUploads((current) => [...current, result.upload]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传核销凭证失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitDialog() {
    if (!dialog) return;
    setBusy(dialog.mode);
    setError("");
    try {
      if (dialog.mode === "create") {
        const lines = selectedItems.map((item) => ({ sourceId: item.sourceId, amountCny: Number(amounts[item.sourceId] || 0) }));
        const result = await createWarehouseLiabilitySettlementBatch({
          lines,
          settlementDate,
          method,
          voucherNo,
          voucherAttachmentIds: voucherUploads.map((upload) => upload.id),
          note,
        });
        setMessage(`已生成核销批次 ${result.batch.id}。请先导出核对，确认实际扣款后再确认核销。`);
        setSelectedIds([]);
      } else if (dialog.batch) {
        const result = await postWarehouseLiabilitySettlementBatch(dialog.batch.id, {
          settlementDate,
          method,
          voucherNo,
          voucherAttachmentIds: voucherUploads.map((upload) => upload.id),
          note,
        });
        setMessage(`批次 ${result.batch.id} 已确认核销，待核销余额已更新。`);
      }
      setDialog(null);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存核销批次失败。");
    } finally {
      setBusy("");
    }
  }

  async function downloadBatch(batch: WarehouseLiabilitySettlementBatch) {
    setBusy(`download:${batch.id}`);
    setError("");
    try {
      const blob = await downloadWarehouseLiabilitySettlementBatch(batch.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `海外仓责任费用核销-${batch.id}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(`已导出批次 ${batch.id} 的核销明细。`);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "导出核销明细失败。");
    } finally {
      setBusy("");
    }
  }

  async function reverseBatch(batch: WarehouseLiabilitySettlementBatch) {
    const reason = window.prompt(`冲销批次 ${batch.id}\n请输入冲销原因：`, "财务核销信息有误");
    if (!reason?.trim()) return;
    setBusy(`reverse:${batch.id}`);
    setError("");
    try {
      await reverseWarehouseLiabilitySettlementBatch(batch.id, reason.trim());
      setMessage(`批次 ${batch.id} 已冲销，对应金额已恢复为待核销。`);
      await load();
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "冲销核销批次失败。");
    } finally {
      setBusy("");
    }
  }

  const dialogLines = dialog?.mode === "post" ? dialog.batch?.lines || [] : selectedItems.map((item) => ({
    sourceId: item.sourceId,
    sourceNo: item.sourceNo,
    warehouseName: item.warehouseName,
    outstandingBeforeCny: item.outstandingCny,
    amountCny: amounts[item.sourceId] ?? item.outstandingCny,
  }));
  const dialogTotal = dialogLines.reduce((sum, line) => sum + Number(dialog?.mode === "create" ? amounts[line.sourceId] ?? line.amountCny : line.amountCny), 0);

  return <div className="wls-page">
    <section className="wls-heading">
      <div><p>WAREHOUSE LIABILITY LEDGER</p><h2>仓库责任费用核销</h2><span>原始责任金额永久保留；只有财务确认核销后，待核销余额才会减少。</span></div>
      <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spinning" : ""} size={17} />刷新台账</button>
    </section>

    {error ? <div className="wls-notice error"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div> : null}
    {message ? <div className="wls-notice success"><CheckCircle2 size={17} /><span>{message}</span><button onClick={() => setMessage("")}><X size={15} /></button></div> : null}

    <section className="wls-kpis">
      <article className="primary"><WalletCards size={20} /><span>待核销仓库承担</span><strong>{payload ? money(payload.summary.pendingWriteoffCny) : "—"}</strong><small>{payload ? `${payload.summary.pendingCount} 笔；全部核销后归零` : "正在读取"}</small></article>
      <article><ReceiptText size={20} /><span>本月已核销</span><strong>{payload ? money(payload.summary.writtenOffThisMonthCny) : "—"}</strong><small>已实际冲抵或赔付</small></article>
      <article><ShieldCheck size={20} /><span>累计已核销</span><strong>{payload ? money(payload.summary.writtenOffCny) : "—"}</strong><small>{payload ? `${payload.summary.writtenOffCount} 笔已结清` : "正在读取"}</small></article>
      <article className={payload?.summary.disputedCny ? "warning" : ""}><AlertTriangle size={20} /><span>争议中金额</span><strong>{payload ? money(payload.summary.disputedCny) : "—"}</strong><small>争议单不可直接核销</small></article>
    </section>

    <section className="wls-panel">
      <header className="wls-toolbar">
        <div className="wls-search"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder="搜索责任单号、订单、原因或 SKU" /></div>
        <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">全部仓库</option>{(payload?.warehouses || []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="pending_writeoff">待核销</option><option value="partially_written_off">部分核销</option><option value="written_off">已核销</option><option value="disputed">争议中</option></select>
        <button type="button" onClick={() => void load()} disabled={loading}>查询</button>
        <button type="button" className="primary" onClick={openCreateDialog} disabled={!selectedItems.length}><FileSpreadsheet size={16} />生成核销批次{selectedItems.length ? `（${selectedItems.length}）` : ""}</button>
      </header>

      <div className="wls-table-wrap">
        <table className="wls-table">
          <thead><tr><th></th><th>责任来源</th><th>仓库 / 日期</th><th>责任原因与商品</th><th>原责任金额</th><th>已核销</th><th>待核销</th><th>状态</th></tr></thead>
          <tbody>
            {loading && !payload ? <tr><td colSpan={8} className="empty"><LoaderCircle className="spinning" size={22} />正在读取费用台账…</td></tr> : null}
            {!loading && !payload?.items.length ? <tr><td colSpan={8} className="empty"><CheckCircle2 size={24} />当前筛选条件下没有责任费用</td></tr> : null}
            {(payload?.items || []).map((item) => {
              const selectable = !["written_off", "disputed", "source_voided"].includes(item.settlementStatus) && item.outstandingCny > 0;
              return <tr key={item.id} className={selectedIds.includes(item.sourceId) ? "selected" : ""}>
                <td><input type="checkbox" checked={selectedIds.includes(item.sourceId)} disabled={!selectable} onChange={() => toggleItem(item)} aria-label={`选择 ${item.sourceNo}`} /></td>
                <td><strong>{item.sourceNo}</strong><small>售后单 · 原订单 {item.originalOrderNumber || "—"}</small></td>
                <td><strong>{item.warehouseName}</strong><small>{dateText(item.occurredAt)}</small></td>
                <td><strong>{item.reason || "仓库责任"}</strong><small>{item.skuSummary || "无 SKU 明细"}</small></td>
                <td>{money(item.originalAmountCny)}</td><td>{money(item.writtenOffCny)}</td><td className="outstanding">{money(item.outstandingCny)}</td>
                <td><span className={`wls-status ${item.settlementStatus}`}>{statusLabels[item.settlementStatus] || item.settlementStatus}</span></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="wls-panel batches">
      <header><div><p>SETTLEMENT BATCHES</p><h3>核销批次记录</h3><span>导出不会扣减余额；确认核销后才记入已核销，错误记录只能冲销。</span></div></header>
      <div className="wls-batch-list">
        {!(payload?.batches || []).length ? <div className="wls-empty-batches"><ReceiptText size={24} />尚未生成核销批次</div> : null}
        {(payload?.batches || []).map((batch) => <article key={batch.id}>
          <div><span>{batch.id}</span><strong>{batch.warehouseName}</strong><small>{dateText(batch.settlementDate)} · {batch.methodLabel}</small></div>
          <div><span>批次金额</span><strong>{money(batch.totalAmountCny)}</strong><small>{batch.lines.length} 笔责任费用</small></div>
          <div><span>凭证</span><strong>{batch.voucherNo || (batch.voucherAttachments.length ? `${batch.voucherAttachments.length} 个附件` : "待补充")}</strong><small>{batch.postedBy ? `核销人：${batch.postedBy}` : `创建人：${batch.createdBy}`}</small></div>
          <div><span className={`wls-status ${batch.status}`}>{batchStatusLabels[batch.status] || batch.status}</span>{batch.reversal ? <small>冲销：{batch.reversal.reason}</small> : null}</div>
          <div className="actions">
            <button type="button" onClick={() => void downloadBatch(batch)} disabled={Boolean(busy)}><Download size={15} />{busy === `download:${batch.id}` ? "导出中" : "导出明细"}</button>
            {batch.status === "draft" ? <button type="button" className="primary" onClick={() => openPostDialog(batch)} disabled={Boolean(busy)}><CheckCircle2 size={15} />确认核销</button> : null}
            {batch.status === "posted" ? <button type="button" className="danger" onClick={() => void reverseBatch(batch)} disabled={Boolean(busy)}><RotateCcw size={15} />{busy === `reverse:${batch.id}` ? "冲销中" : "冲销"}</button> : null}
          </div>
        </article>)}
      </div>
    </section>

    {dialog ? <div className="wls-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && setDialog(null)}>
      <section className="wls-modal" role="dialog" aria-modal="true" aria-label={dialog.mode === "create" ? "生成核销批次" : "确认核销"}>
        <header><div><p>{dialog.mode === "create" ? "CREATE SETTLEMENT BATCH" : "POST SETTLEMENT"}</p><h3>{dialog.mode === "create" ? "生成核销批次" : `确认核销 ${dialog.batch?.id}`}</h3><span>{dialog.mode === "create" ? "生成后先导出给财务核对，不会立即扣减余额。" : "确认后将立即减少待核销余额，并保留完整操作记录。"}</span></div><button onClick={() => setDialog(null)} disabled={Boolean(busy)}><X size={20} /></button></header>
        <div className="wls-modal-lines">
          {dialogLines.map((line) => <div key={line.sourceId}><span><strong>{line.sourceNo}</strong><small>{line.warehouseName}</small></span><span><small>待核销</small><strong>{money(line.outstandingBeforeCny)}</strong></span>{dialog.mode === "create" ? <label><small>本次核销</small><input type="number" min="0.01" max={line.outstandingBeforeCny} step="0.01" value={amounts[line.sourceId] ?? line.amountCny} onChange={(event) => setAmounts((current) => ({ ...current, [line.sourceId]: Math.max(0, Number(event.target.value)) }))} /></label> : <span><small>本次核销</small><strong>{money(line.amountCny)}</strong></span>}</div>)}
        </div>
        <div className="wls-form-grid">
          <label><span>核销日期</span><input type="date" value={settlementDate} onChange={(event) => setSettlementDate(event.target.value)} /></label>
          <label><span>核销方式</span><select value={method} onChange={(event) => setMethod(event.target.value)}>{(payload?.settlementMethods || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span>财务凭证号</span><input value={voucherNo} onChange={(event) => setVoucherNo(event.target.value)} placeholder="确认核销时凭证号或附件至少填一项" /></label>
          <label className="wide"><span>核销备注</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：2026年10月仓库月结账单冲抵" /></label>
          <label className="wls-upload wide"><Upload size={18} /><span>{busy === "upload" ? "正在上传…" : "上传图片或 PDF 核销凭证"}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" hidden onChange={(event) => { void uploadVoucher(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {voucherUploads.length ? <div className="wls-upload-list wide">{voucherUploads.map((upload) => <span key={upload.id}><Paperclip size={13} /><a href={resolveApiUrl(upload.url)} target="_blank" rel="noreferrer">{upload.fileName}</a><button type="button" onClick={() => setVoucherUploads((current) => current.filter((item) => item.id !== upload.id))}><X size={12} /></button></span>)}</div> : null}
        </div>
        <footer><div><small>本批合计</small><strong>{money(dialogTotal)}</strong></div><button type="button" onClick={() => setDialog(null)} disabled={Boolean(busy)}>取消</button><button type="button" className="primary" onClick={() => void submitDialog()} disabled={Boolean(busy) || dialogTotal <= 0}>{busy === dialog.mode ? <LoaderCircle className="spinning" size={16} /> : dialog.mode === "create" ? <FileSpreadsheet size={16} /> : <ShieldCheck size={16} />}{dialog.mode === "create" ? "生成批次" : "确认并核销"}</button></footer>
      </section>
    </div> : null}
  </div>;
}

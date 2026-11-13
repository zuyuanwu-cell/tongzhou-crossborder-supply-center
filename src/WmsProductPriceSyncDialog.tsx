import React from "react";
import { AlertTriangle, Check, CheckCircle2, CircleDollarSign, LoaderCircle, RefreshCw, ShieldCheck, Warehouse, X } from "lucide-react";
import {
  executeWmsProductPriceSync,
  fetchWmsProductPriceSyncOptions,
  previewWmsProductPriceSync,
  type WmsProductPriceSyncExecution,
  type WmsProductPriceSyncOptions,
  type WmsProductPriceSyncPreview,
  type WmsProductPriceSyncRow,
} from "./api";
import "./wms-product-price-sync.css";

function money(value: number, currency: string) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return `${currency || ""} ${value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}`.trim();
}

function statusLabel(status: WmsProductPriceSyncRow["status"]) {
  return {
    pending: "待同步",
    unchanged: "已一致",
    missing_price: "缺少价格",
    unmatched: "未匹配 WMS 商品",
    conflict: "产品库价格冲突",
    succeeded: "同步成功",
    failed: "同步失败",
  }[status];
}

function idempotencyKey() {
  return `wms-price-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function WmsProductPriceSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [options, setOptions] = React.useState<WmsProductPriceSyncOptions | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState<WmsProductPriceSyncPreview | null>(null);
  const [execution, setExecution] = React.useState<WmsProductPriceSyncExecution | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadOptions = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchWmsProductPriceSyncOptions();
      setOptions(payload);
      setSelected(payload.warehouses.filter((item) => item.capability.supported && item.capability.configured).map((item) => item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取 WMS 价格同步能力失败。" );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setPreview(null);
    setExecution(null);
    void loadOptions();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [loadOptions, open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open]);

  if (!open) return null;

  async function buildPreview() {
    if (!selected.length) {
      setError("请至少选择一个已接入价格写入接口的仓库。" );
      return;
    }
    setLoading(true);
    setError("");
    setExecution(null);
    try {
      setPreview(await previewWmsProductPriceSync(selected));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "生成价格同步预览失败。" );
    } finally {
      setLoading(false);
    }
  }

  async function submitSync() {
    if (!preview?.previewToken || preview.summary.pending <= 0) return;
    setLoading(true);
    setError("");
    try {
      setExecution(await executeWmsProductPriceSync(preview.previewToken, idempotencyKey()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "价格同步失败，请重新生成预览。" );
    } finally {
      setLoading(false);
    }
  }

  const displayedRows = (execution?.rows || preview?.rows || []).filter((row) => (
    execution ? true : row.status !== "unchanged"
  )).slice(0, 120);

  return (
    <div className="wms-price-sync-layer" role="dialog" aria-modal="true" aria-labelledby="wms-price-sync-title">
      <button className="wms-price-sync-backdrop" type="button" aria-label="关闭价格同步" onClick={() => !loading && onClose()} />
      <section className="wms-price-sync-dialog">
        <header>
          <div className="wms-price-sync-icon"><CircleDollarSign size={25} /></div>
          <div>
            <p>WMS PRICE SYNC</p>
            <h2 id="wms-price-sync-title">同步产品价格</h2>
            <span>先比对、再确认；只有有差异且匹配唯一的商品才会写入。</span>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" disabled={loading} onClick={onClose}><X size={19} /></button>
        </header>

        <div className="wms-price-sync-body">
          <div className="wms-price-sync-rule">
            <div><strong>{options?.mapping.sourceField || "直营供货价"}</strong><span>产品库来源</span></div>
            <b>→</b>
            <div><strong>{options?.mapping.targetField || "WMS 采购价"}</strong><span>仓库目标字段</span></div>
            <aside><ShieldCheck size={18} /><span>不会修改申报价、库存、重量、尺寸、箱规或图片</span></aside>
          </div>

          {error ? <div className="wms-price-sync-error"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div> : null}

          {!preview && !execution ? (
            <section className="wms-price-sync-step">
              <div className="wms-price-sync-step-head"><div><small>01</small><span><strong>选择仓库</strong><em>仅支持已确认采购价写入契约的 WMS</em></span></div><button type="button" onClick={() => void loadOptions()} disabled={loading}><RefreshCw size={15} />刷新能力</button></div>
              {loading && !options ? <div className="wms-price-sync-loading"><LoaderCircle className="spin" size={22} />正在读取仓库配置…</div> : (
                <div className="wms-price-sync-warehouses">
                  {(options?.warehouses || []).map((warehouse) => {
                    const available = warehouse.capability.supported && warehouse.capability.configured;
                    const active = selected.includes(warehouse.id);
                    return <button
                      type="button"
                      key={warehouse.id}
                      disabled={!available || loading}
                      className={`${active ? "selected" : ""} ${available ? "available" : "unavailable"}`}
                      onClick={() => setSelected((items) => active ? items.filter((id) => id !== warehouse.id) : [...items, warehouse.id])}
                    >
                      <span className="wms-price-sync-check">{active ? <Check size={15} /> : null}</span>
                      <Warehouse size={20} />
                      <span><strong>{warehouse.name}</strong><em>{warehouse.country} · {warehouse.providerId}</em><small>{warehouse.capability.message}</small></span>
                    </button>;
                  })}
                  {!options?.warehouses?.length && !loading ? <div className="wms-price-sync-empty">当前数据权限范围内没有可用仓库。</div> : null}
                </div>
              )}
            </section>
          ) : null}

          {preview ? (
            <section className="wms-price-sync-step">
              <div className="wms-price-sync-step-head"><div><small>02</small><span><strong>{execution ? "同步结果" : "确认差异"}</strong><em>{execution ? `执行编号 ${execution.executionId}` : `预览有效至 ${new Date(preview.expiresAt).toLocaleTimeString("zh-CN")}`}</em></span></div>{!execution ? <button type="button" onClick={() => { setPreview(null); setExecution(null); }} disabled={loading}>返回选仓</button> : null}</div>
              <div className="wms-price-sync-metrics">
                <article className="orange"><span>待同步</span><strong>{preview.summary.pending}</strong><small>仅这些会写入</small></article>
                <article><span>已一致</span><strong>{preview.summary.unchanged}</strong><small>自动跳过</small></article>
                <article><span>缺价格</span><strong>{preview.summary.missing_price}</strong><small>需先维护产品库</small></article>
                <article><span>匹配异常</span><strong>{preview.summary.unmatched + preview.summary.conflict}</strong><small>不会自动写入</small></article>
                {execution ? <article className={execution.summary.failed ? "red" : "green"}><span>成功 / 失败</span><strong>{execution.summary.succeeded} / {execution.summary.failed}</strong><small>逐条留痕</small></article> : null}
              </div>
              <div className="wms-price-sync-table-wrap">
                <table>
                  <thead><tr><th>仓库 / 商品</th><th>产品库直营供货价</th><th>当前 WMS 采购价</th><th>处理结果</th></tr></thead>
                  <tbody>{displayedRows.map((row) => <tr key={`${row.id}:${row.status}`}>
                    <td><strong>{row.productName}</strong><span>{row.sku} · {row.warehouseName}</span></td>
                    <td><b>{money(row.sourcePrice, row.sourceCurrency)}</b></td>
                    <td>{money(row.currentPrice, row.currentCurrency)}</td>
                    <td><span className={`wms-price-sync-status ${row.status}`}>{statusLabel(row.status)}</span><small>{row.reason}</small></td>
                  </tr>)}</tbody>
                </table>
                {!displayedRows.length ? <div className="wms-price-sync-empty"><CheckCircle2 size={23} />所有可匹配商品价格都已一致，无需同步。</div> : null}
              </div>
            </section>
          ) : null}
        </div>

        <footer>
          <span>{execution ? "同步已结束；失败项未改变 WMS 数据，可修正后重新预览。" : "所有写操作都会记录操作者、仓库、成功数与失败数。"}</span>
          <div>
            <button className="ghost-button" type="button" disabled={loading} onClick={onClose}>{execution ? "完成" : "取消"}</button>
            {!preview ? <button className="sync-button" type="button" disabled={loading || !selected.length} onClick={() => void buildPreview()}>{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}生成同步预览</button> : null}
            {preview && !execution ? <button className="sync-button" type="button" disabled={loading || preview.summary.pending <= 0} onClick={() => void submitSync()}>{loading ? <LoaderCircle className="spin" size={16} /> : <CircleDollarSign size={16} />}确认同步 {preview.summary.pending} 项</button> : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

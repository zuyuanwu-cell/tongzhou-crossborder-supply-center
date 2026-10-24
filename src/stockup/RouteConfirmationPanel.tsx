import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Boxes, Check, Factory, PackageSearch, RefreshCw, ShoppingCart, Warehouse, X } from "lucide-react";
import { confirmStockupFulfillmentRoute, fetchStockupDomesticWarehouses, fetchStockupRouteReconciliation, previewStockupFulfillmentRoute, replanStockupFulfillmentRoute } from "../api";
import type { DomesticWarehouse } from "../api";
import type { StockupFulfillmentAllocation, StockupFulfillmentSourceType, StockupRequest, StockupRoutePreview } from "./types";

type Props = {
  request: StockupRequest;
  onClose: () => void;
  onConfirmed: () => Promise<void>;
};

const SOURCE_META: Record<StockupFulfillmentSourceType, { label: string; help: string; icon: typeof Warehouse }> = {
  domestic_stock: { label: "国内现货", help: "目标集货仓现货，确认后立即锁定", icon: Warehouse },
  transfer: { label: "跨仓调拨", help: "先锁定源仓，待仓库确认调拨", icon: ArrowRightLeft },
  purchase: { label: "现货采购", help: "只采购库存未覆盖的数量", icon: ShoppingCart },
  outsourced_production: { label: "委外生产", help: "关联简道云加工单，入库后才可发运", icon: Factory },
  unresolved: { label: "待判断", help: "需要选择缺口供应方式", icon: AlertTriangle },
};

function quantity(value: number) {
  return Number(value || 0).toLocaleString("zh-CN");
}

export function RouteConfirmationPanel({ request, onClose, onConfirmed }: Props) {
  const [preview, setPreview] = useState<StockupRoutePreview | null>(null);
  const [warehouses, setWarehouses] = useState<DomesticWarehouse[]>([]);
  const [targetWarehouseId, setTargetWarehouseId] = useState(request.consolidationWarehouseId || "");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [quantityOverrides, setQuantityOverrides] = useState<Record<string, number>>(() => Object.fromEntries(request.lines.map((line) => [line.id, line.requestedQty])));
  const [overrideReason, setOverrideReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [reconciliation, setReconciliation] = useState<{ requiresAdminReview: boolean; warnings: Array<{ code: string; level: "warning" | "danger"; message: string }>; summary: { purchaseLineCount: number; warehouseLineCount: number; shipmentLineCount: number } } | null>(null);

  const requestLines = useMemo(() => new Map(request.lines.map((line) => [line.id, line])), [request.lines]);
  const hasSupplyOverride = request.lines.some((line) => overrides[line.id] && overrides[line.id] !== line.defaultSupplyMode);
  const hasQuantityOverride = request.lines.some((line) => Number(quantityOverrides[line.id]) !== Number(line.requestedQty));
  const hasOverride = hasSupplyOverride || hasQuantityOverride;

  async function loadPreview(nextWarehouseId = targetWarehouseId, nextOverrides = overrides, nextQuantities = quantityOverrides) {
    setLoading(true);
    setError("");
    try {
      const warehouse = warehouses.find((item) => item.id === nextWarehouseId);
      const result = await previewStockupFulfillmentRoute(request.id, {
        consolidationWarehouseId: nextWarehouseId,
        consolidationWarehouseName: warehouse?.name || "",
        supplyModeOverrides: nextOverrides,
        quantityOverrides: nextQuantities,
      });
      setPreview(result);
      if (!nextWarehouseId && result.consolidationWarehouse.id) setTargetWarehouseId(result.consolidationWarehouse.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "执行方案计算失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void fetchStockupDomesticWarehouses().then((result) => {
      if (cancelled) return;
      const active = (result.warehouses || []).filter((item) => item.status === "active");
      setWarehouses(active);
      return previewStockupFulfillmentRoute(request.id, {
        consolidationWarehouseId: request.consolidationWarehouseId || "",
        supplyModeOverrides: {},
        quantityOverrides,
      });
    }).then((result) => {
      if (!result || cancelled) return;
      setPreview(result);
      setTargetWarehouseId(result.consolidationWarehouse.id);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "执行方案计算失败。");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [request.consolidationWarehouseId, request.id]);

  useEffect(() => {
    if (request.routePlanVersion > 0) return;
    let cancelled = false;
    void fetchStockupRouteReconciliation(request.id).then((result) => {
      if (!cancelled) setReconciliation(result);
    }).catch(() => {
      // Only workflow administrators can inspect legacy reconciliation. A 403
      // does not prevent normal new-request routing.
    });
    return () => { cancelled = true; };
  }, [request.id, request.routePlanVersion]);

  function changeWarehouse(warehouseId: string) {
    setTargetWarehouseId(warehouseId);
    void loadPreview(warehouseId, overrides, quantityOverrides);
  }

  function changeSupplyMode(lineId: string, mode: string) {
    const next = { ...overrides, [lineId]: mode };
    setOverrides(next);
    void loadPreview(targetWarehouseId, next, quantityOverrides);
  }

  function changeQuantity(lineId: string, value: string) {
    setQuantityOverrides((current) => ({ ...current, [lineId]: Number(value) }));
    setPreview(null);
  }

  async function confirm() {
    if (!preview) return;
    if (hasOverride && !overrideReason.trim()) {
      setError("修改产品默认供应方式时，请填写本次调整原因。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        expectedVersion: preview.expectedRequestVersion,
        consolidationWarehouseId: preview.consolidationWarehouse.id,
        consolidationWarehouseName: preview.consolidationWarehouse.name,
        supplyModeOverrides: overrides,
        quantityOverrides,
        overrideReason: overrideReason.trim(),
      };
      if (request.routePlanVersion > 0) await replanStockupFulfillmentRoute(request.id, payload);
      else await confirmStockupFulfillmentRoute(request.id, payload);
      await onConfirmed();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "确认执行方案失败。");
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const result = new Map<StockupFulfillmentSourceType, StockupFulfillmentAllocation[]>();
    (preview?.allocations || []).forEach((allocation) => {
      const list = result.get(allocation.sourceType) || [];
      list.push(allocation);
      result.set(allocation.sourceType, list);
    });
    return result;
  }, [preview]);

  return (
    <div className="sc-route-backdrop" role="presentation">
      <section className="sc-route-panel" role="dialog" aria-modal="true" aria-label={`确认 ${request.requestNo} 履约方案`}>
        <header className="sc-route-head">
          <div><span className="sc-eyebrow">FULFILLMENT ROUTING V3</span><h2>确认执行方案</h2><p>{request.requestNo} · 系统按 SKU 和数量拆分现货、调拨、采购与委外生产。</p></div>
          <button type="button" className="sc-icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </header>

        <div className="sc-route-toolbar">
          <label>目标国内集货仓
            <select value={targetWarehouseId} onChange={(event) => changeWarehouse(event.target.value)}>
              <option value="">请选择集货仓</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}
            </select>
          </label>
          <div><small>预计齐套依据</small><b>实时国内可用库存 + 产品默认供应方式</b><span>{preview?.queriedAt ? `库存读取 ${new Date(preview.queriedAt).toLocaleString("zh-CN")}` : "正在读取库存"}</span></div>
          <button type="button" className="sc-button sc-button-secondary" disabled={loading} onClick={() => void loadPreview()}><RefreshCw className={loading ? "is-spinning" : ""} size={17} />重新计算</button>
        </div>

        {request.routePlanVersion > 0 ? <div className="sc-route-quantity-editor"><div><b>调整需求数量</b><span>修改后点击“重新计算”，系统会释放旧锁定并按新数量重新分配。</span></div><div>{request.lines.map((line) => <label key={line.id}><span>{line.sku}</span><input type="number" min="1" step="1" value={Number.isFinite(quantityOverrides[line.id]) ? quantityOverrides[line.id] : ""} onChange={(event) => changeQuantity(line.id, event.target.value)} /><small>{line.unit}</small></label>)}</div></div> : null}

        {error ? <div className="sc-alert sc-alert-danger sc-route-alert">{error}</div> : null}
        {reconciliation?.requiresAdminReview ? <div className="sc-route-legacy-warning"><AlertTriangle size={18} /><div><b>检测到旧流程单据，已阻止直接锁库</b><span>采购 {reconciliation.summary.purchaseLineCount} 条 · 国内仓 {reconciliation.summary.warehouseLineCount} 条 · 发运 {reconciliation.summary.shipmentLineCount} 条。请先由管理员逐单对账迁移，避免重复采购或重复占用库存。</span>{reconciliation.warnings.map((item) => <small key={item.code}>{item.message}</small>)}</div></div> : null}
        {preview?.blockers?.length ? <div className="sc-route-blockers">{preview.blockers.map((blocker) => <span key={blocker.code}><AlertTriangle size={15} />{blocker.message}</span>)}</div> : null}

        <div className="sc-route-body">
          <main className="sc-route-paths">
            {loading && !preview ? <div className="sc-loading"><span />正在逐 SKU 计算履约来源…</div> : null}
            {(["domestic_stock", "transfer", "purchase", "outsourced_production", "unresolved"] as StockupFulfillmentSourceType[]).map((sourceType) => {
              const allocations = grouped.get(sourceType) || [];
              if (!allocations.length) return null;
              const meta = SOURCE_META[sourceType];
              const Icon = meta.icon;
              return <section className={`sc-route-path sc-route-${sourceType}`} key={sourceType}>
                <header><span><Icon size={19} /></span><div><h3>{meta.label}</h3><p>{meta.help}</p></div><b>{quantity(allocations.reduce((sum, item) => sum + item.plannedQty, 0))} 件</b></header>
                <div>{allocations.map((allocation) => {
                  const line = requestLines.get(allocation.requestLineId);
                  return <article key={allocation.id}>
                    <span className="sc-product-thumb">{line?.imageUrl ? <img src={line.imageUrl} alt="" /> : <Boxes size={19} />}</span>
                    <div><b>{line?.sku}</b><span>{line?.productName}</span><small>{allocation.sourceWarehouseName ? `${allocation.sourceWarehouseName} → ${allocation.targetWarehouseName}` : `缺口汇入 ${allocation.targetWarehouseName || "待选集货仓"}`}</small></div>
                    <strong>{quantity(allocation.plannedQty)} {line?.unit}</strong>
                    {["purchase", "outsourced_production", "unresolved"].includes(sourceType) ? <label className="sc-route-source-select"><small>缺口供应方式</small><select value={overrides[line?.id || ""] || line?.effectiveSupplyMode || line?.defaultSupplyMode || "待判断"} onChange={(event) => line && changeSupplyMode(line.id, event.target.value)}><option value="待判断">请选择</option><option value="外采成品">外采成品</option><option value="委外生产">委外生产</option></select></label> : null}
                  </article>;
                })}</div>
              </section>;
            })}
          </main>

          <aside className="sc-route-summary">
            <span className="sc-eyebrow">ROUTING SUMMARY</span>
            <h3>本次如何履约</h3>
            <div className="sc-route-donut"><strong>{preview?.routingSummary.planned ? Math.round(((preview.routingSummary.domesticStock + preview.routingSummary.transfer) / preview.routingSummary.planned) * 100) : 0}%</strong><span>库存覆盖</span></div>
            <dl>
              <div><dt>目标集货仓</dt><dd>{preview?.consolidationWarehouse.name || "待选择"}</dd></div>
              <div><dt>国内现货</dt><dd>{quantity(preview?.routingSummary.domesticStock || 0)}</dd></div>
              <div><dt>跨仓调拨</dt><dd>{quantity(preview?.routingSummary.transfer || 0)}</dd></div>
              <div><dt>采购缺口</dt><dd>{quantity(preview?.routingSummary.purchase || 0)}</dd></div>
              <div><dt>委外缺口</dt><dd>{quantity(preview?.routingSummary.outsourcedProduction || 0)}</dd></div>
            </dl>
            {hasOverride ? <label className="sc-route-reason">调整原因<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="说明本次数量或供应方式调整原因" /></label> : null}
            <div className="sc-route-safe"><Check size={16} /><span>确认后立即锁定真实国内库存；采购和委外只处理剩余缺口。</span></div>
          </aside>
        </div>

        <footer className="sc-route-foot">
          <span><PackageSearch size={17} />{reconciliation?.requiresAdminReview ? "历史单据待管理员对账，暂不创建新锁定" : preview?.canConfirm ? "方案校验通过，可以执行" : "请先处理上方阻塞项"}</span>
          <div><button type="button" className="sc-button sc-button-secondary" onClick={onClose}>暂不确认</button><button type="button" className="sc-button sc-button-primary" disabled={saving || loading || reconciliation?.requiresAdminReview || !preview?.canConfirm || (hasOverride && !overrideReason.trim())} onClick={() => void confirm()}><Check size={17} />{saving ? "正在锁定库存…" : "确认执行方案"}</button></div>
        </footer>
      </section>
    </div>
  );
}

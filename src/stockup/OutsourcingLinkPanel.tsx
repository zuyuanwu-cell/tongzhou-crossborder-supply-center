import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Boxes, Check, Factory, PackageCheck, RefreshCw, X } from "lucide-react";
import { fetchOutsourcingOrders, linkStockupOutsourcingAllocation } from "../api";
import type { OutsourcingProductionOrder } from "../api";
import type { StockupFulfillmentAllocation, StockupRequest } from "./types";

type Props = {
  request: StockupRequest;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNavigateWarehouse: () => void;
};

function normalizedSku(value: string | undefined) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function orderSku(order: OutsourcingProductionOrder) {
  return normalizedSku(order.tongzhouSku || order.productSku);
}

function orderReady(order: OutsourcingProductionOrder) {
  return Boolean(order.inboundCompletedAt) || /已入库|入库完成/.test(String(order.deliveryStatus || order.status || ""));
}

function orderProductionCompleted(order: OutsourcingProductionOrder) {
  return orderReady(order)
    || Number(order.producedQty || 0) >= Number(order.plannedQty || 0) && Number(order.plannedQty || 0) > 0
    || /已完成|生产完成|待入库|已发货/.test(String(order.deliveryStatus || order.status || ""));
}

function allocationSku(allocation: StockupFulfillmentAllocation, request: StockupRequest) {
  return request.lines.find((line) => line.id === allocation.requestLineId)?.sku || "";
}

export function OutsourcingLinkPanel({ request, onClose, onChanged, onNavigateWarehouse }: Props) {
  const allocations = useMemo(() => (request.allocations || []).filter((item) => item.sourceType === "outsourced_production" && item.readyQty < item.plannedQty), [request.allocations]);
  const [orders, setOrders] = useState<OutsourcingProductionOrder[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [syncedAt, setSyncedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = await fetchOutsourcingOrders();
      setOrders(result.orders || []);
      setSyncedAt(result.syncedAt || "");
      setSelected((current) => {
        const next = { ...current };
        for (const allocation of allocations) {
          if (allocation.referenceId) next[allocation.id] = allocation.referenceId;
          if (next[allocation.id]) continue;
          const sku = normalizedSku(allocationSku(allocation, request));
          const recommended = (result.orders || []).find((order) => orderSku(order) === sku && !orderReady(order));
          if (recommended) next[allocation.id] = recommended.id;
        }
        return next;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取委外加工单失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function link(allocation: StockupFulfillmentAllocation) {
    const order = orders.find((item) => item.id === selected[allocation.id]);
    if (!order) { setError("请选择要关联的委外加工单。"); return; }
    setBusy(allocation.id);
    setError("");
    try {
      await linkStockupOutsourcingAllocation(allocation.id, {
        referenceId: order.id,
        referenceNo: order.orderNo,
        expectedReadyAt: order.expectedFinishedAt || order.factoryExpectedFinishedAt || "",
      });
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "关联委外加工单失败");
    } finally {
      setBusy("");
    }
  }

  return <div className="sc-route-backdrop">
    <section className="sc-outsourcing-panel" role="dialog" aria-modal="true" aria-label="委外生产履约">
      <header className="sc-route-head">
        <div><span className="sc-eyebrow">OUTSOURCED PRODUCTION</span><h2>委外生产与入库</h2><p>{request.requestNo} · 只关联现有简道云加工单，完成国内仓验收入库后才计入齐套。</p></div>
        <button className="sc-icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      </header>
      <div className="sc-outsourcing-toolbar">
        <div><b>{allocations.length} 段委外缺口待完成</b><span>数据更新 {syncedAt ? new Date(syncedAt).toLocaleString("zh-CN") : "尚未读取"}</span></div>
        <button className="sc-button sc-button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={16} />刷新加工单</button>
      </div>
      {error ? <div className="sc-alert sc-alert-danger sc-route-alert">{error}</div> : null}
      <div className="sc-outsourcing-list">
        {allocations.map((allocation) => {
          const line = request.lines.find((item) => item.id === allocation.requestLineId);
          const candidates = orders.filter((order) => orderSku(order) === normalizedSku(line?.sku));
          const linkedOrder = orders.find((order) => order.id === allocation.referenceId) || candidates.find((order) => order.id === selected[allocation.id]);
          const completed = linkedOrder ? orderProductionCompleted(linkedOrder) : false;
          return <article key={allocation.id} className={allocation.referenceId ? "is-linked" : ""}>
            <div className="sc-outsourcing-product">
              <span className="sc-product-thumb large">{line?.imageUrl ? <img src={line.imageUrl} alt="" /> : <Boxes size={22} />}</span>
              <div><b>{line?.sku || "未识别 SKU"}</b><span>{line?.productName || "委外产品"}</span><small>委外缺口 {allocation.plannedQty} {line?.unit || "件"}</small></div>
            </div>
            <div className="sc-outsourcing-order">
              {allocation.referenceId ? <>
                <span className="sc-outsourcing-linked"><Check size={15} />已关联 {allocation.referenceNo || allocation.referenceId}</span>
                <b>{linkedOrder?.supplierAlias || linkedOrder?.supplier || "委外工厂"}</b>
                <small>{linkedOrder?.progressSummary || linkedOrder?.status || "等待同步生产进度"}</small>
              </> : <label>推荐加工单<select value={selected[allocation.id] || ""} onChange={(event) => setSelected((current) => ({ ...current, [allocation.id]: event.target.value }))}>
                <option value="">{loading ? "正在读取…" : candidates.length ? "请选择加工单" : "没有匹配 SKU 的未完成加工单"}</option>
                {candidates.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.supplierAlias || order.supplier || "未填工厂"} · 计划 {order.plannedQty} / 完成 {order.producedQty}</option>)}
              </select></label>}
            </div>
            <div className="sc-outsourcing-progress">
              <span><Factory size={15} />生产 {linkedOrder?.producedQty || 0}/{linkedOrder?.plannedQty || allocation.plannedQty}</span>
              <span className={completed ? "is-done" : ""}><PackageCheck size={15} />{completed ? "生产完成，待国内仓入库" : "生产跟进中"}</span>
            </div>
            <div className="sc-outsourcing-action">
              {!allocation.referenceId ? <button className="sc-button sc-button-primary" disabled={!selected[allocation.id] || Boolean(busy)} onClick={() => void link(allocation)}>{busy === allocation.id ? "关联中…" : "确认关联"}<ArrowRight size={16} /></button> : <button className="sc-button sc-button-secondary" onClick={onNavigateWarehouse}>{completed ? "移交国内仓验收入库" : "查看国内仓入库任务"}<ArrowRight size={16} /></button>}
            </div>
          </article>;
        })}
        {!allocations.length ? <div className="sc-warehouse-empty"><Check size={22} />当前委外缺口已完成入库或已取消</div> : null}
      </div>
      <footer className="sc-route-foot"><span><Factory size={16} />加工单完工不直接增加库存；必须由目标国内仓签收、验货、审核入库。</span><div><button className="sc-button sc-button-secondary" onClick={onClose}>关闭</button><button className="sc-button sc-button-primary" onClick={onNavigateWarehouse}><PackageCheck size={16} />进入国内仓作业</button></div></footer>
    </section>
  </div>;
}

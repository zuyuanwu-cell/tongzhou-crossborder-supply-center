import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  PackageCheck,
  Pencil,
  Search,
  Send,
  Truck,
  X,
} from "lucide-react";
import type { StockupPurchaseOrder, StockupPurchaseOrderLine, StockupRequest } from "./types";

type Props = {
  orders: StockupPurchaseOrder[];
  requests: StockupRequest[];
  canManage: boolean;
  saving: boolean;
  selectedLineIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onBatchReceive: () => void;
  onEdit: (order: StockupPurchaseOrder) => void;
  canEdit: (order: StockupPurchaseOrder) => boolean;
  onEvent: (order: StockupPurchaseOrder, line: StockupPurchaseOrderLine, action: "receive" | "cancel" | "refund" | "reship", receiveAll?: boolean) => void;
  onHandoff: (requestId: string) => void;
};

const currency = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

const orderStatusLabels: Record<string, string> = {
  ordered: "待到货",
  partially_received: "部分到货",
  completed: "采购已完结",
};

function lineRemaining(line: StockupPurchaseOrderLine) {
  return Math.max(0, line.quantity - line.cancelledQty - line.receivedQty);
}

export function ProcurementOrderBoard({ orders, requests, canManage, saving, selectedLineIds, onSelectionChange, onBatchReceive, onEdit, canEdit, onEvent, onHandoff }: Props) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const requestById = useMemo(() => new Map(requests.map((request) => [request.id, request])), [requests]);
  const requestLineById = useMemo(() => new Map(requests.flatMap((request) => request.lines.map((line) => [line.id, { request, line }] as const))), [requests]);
  const selected = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    if (status === "active" && order.status === "completed") return false;
    if (status === "completed" && order.status !== "completed") return false;
    const query = keyword.trim().toLowerCase();
    if (!query) return true;
    return [order.purchaseNo, order.supplierName, order.externalOrderNo, ...order.lines.flatMap((line) => [line.sku, line.productName, requestById.get(line.requestId)?.requestNo || ""])]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }), [keyword, orders, requestById, status]);

  const visibleReceivable = filteredOrders.flatMap((order) => order.lines).filter((line) => lineRemaining(line) > 0).map((line) => line.id);
  const selectedRemaining = orders.flatMap((order) => order.lines).filter((line) => selected.has(line.id)).reduce((sum, line) => sum + lineRemaining(line), 0);

  function toggleLine(lineId: string) {
    const next = new Set(selected);
    if (next.has(lineId)) next.delete(lineId); else next.add(lineId);
    onSelectionChange([...next]);
  }

  function toggleVisible() {
    const allSelected = visibleReceivable.length > 0 && visibleReceivable.every((id) => selected.has(id));
    const next = new Set(selected);
    visibleReceivable.forEach((id) => allSelected ? next.delete(id) : next.add(id));
    onSelectionChange([...next]);
  }

  return <section className="sc-procurement-board">
    <div className="sc-procurement-route" aria-label="采购到发运流程">
      <article className="is-active"><span><ClipboardCheck size={18} /></span><div><b>1. 登记采购</b><small>供应商、金额和采购数量</small></div><Check size={15} /></article>
      <ArrowRight size={17} />
      <article><span><Truck size={18} /></span><div><b>2. 移交国内仓</b><small>仓库才是实际到货确认方</small></div></article>
      <ArrowRight size={17} />
      <article><span><PackageCheck size={18} /></span><div><b>3. 验收与发运资料</b><small>数量、批次、条码、箱规和照片</small></div></article>
      <ArrowRight size={17} />
      <article><span><FileCheck2 size={18} /></span><div><b>4. 审核后发运</b><small>入库存账并进入物流计划</small></div></article>
    </div>

    <article className="sc-procurement-orders">
      <header className="sc-procurement-toolbar">
        <div><small>PURCHASE RECEIPT CONTROL</small><h3>采购到货与仓库交接</h3><p>采购侧登记供应商进度；实际收货、异常和发运数据由国内仓协同确认。</p></div>
        <div className="sc-procurement-filters">
          <label><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="采购单 / 供应商 / SKU / 备货单" /></label>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">待处理</option><option value="completed">采购已完结</option><option value="all">全部</option></select>
        </div>
      </header>

      {canManage ? <div className={`sc-procurement-batch ${selectedLineIds.length ? "is-visible" : ""}`}>
        <label><input type="checkbox" checked={visibleReceivable.length > 0 && visibleReceivable.every((id) => selected.has(id))} onChange={toggleVisible} /><span>选择当前列表待到货明细</span></label>
        <div><b>{selectedLineIds.length}</b> 行 · 待登记 {quantity.format(selectedRemaining)} 件</div>
        <button type="button" className="sc-button sc-button-secondary" onClick={() => onSelectionChange([])} disabled={!selectedLineIds.length}><X size={15} />清空</button>
        <button type="button" className="sc-button sc-button-primary" onClick={onBatchReceive} disabled={saving || !selectedLineIds.length}><CheckCircle2 size={16} />批量全部到货</button>
      </div> : null}

      <div className="sc-procurement-order-list">
        {filteredOrders.map((order) => {
          const netQty = order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.cancelledQty), 0);
          const receivedQty = order.lines.reduce((sum, line) => sum + line.receivedQty, 0);
          const progress = netQty ? Math.min(100, Math.round(receivedQty / netQty * 100)) : 100;
          const requestIds = [...new Set(order.lines.map((line) => line.requestId).filter(Boolean))];
          const fullyRegistered = order.lines.every((line) => lineRemaining(line) <= 0);
          const hasWarehouseHandoff = order.lines.some((line) => (requestLineById.get(line.requestLineId)?.line.warehouseExpectedQty || 0) > 0);
          const isExpanded = expanded[order.id] ?? order.status !== "completed";
          return <article className="sc-procurement-order" key={order.id}>
            <header>
              <button className="sc-procurement-order-toggle" type="button" onClick={() => setExpanded((current) => ({ ...current, [order.id]: !isExpanded }))}>
                <span className="sc-procurement-order-icon"><Boxes size={19} /></span>
                <span><b>{order.purchaseNo}</b><small>{order.supplierName} · {order.externalOrderNo || "未填平台单号"}</small></span>
              </button>
              <div className="sc-procurement-order-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{quantity.format(receivedQty)} / {quantity.format(netQty)} 已登记到货</small></div>
              <strong>{currency.format(order.paidTotalCny)}</strong>
              <i className={`sc-wo-status is-${order.status}`}>{orderStatusLabels[order.status] || order.status}</i>
              {canManage && canEdit(order) ? <button className="sc-procurement-edit" type="button" onClick={() => onEdit(order)}><Pencil size={14} />编辑</button> : null}
            </header>

            {fullyRegistered && !hasWarehouseHandoff ? <div className="sc-procurement-next-alert"><AlertTriangle size={17} /><div><b>采购侧已全部登记到货，但仓库还没有验收任务</b><span>下一步请选择对应备货单，移交国内仓签收、核数并整理箱规等发运资料。</span></div><div>{requestIds.map((requestId) => <button type="button" key={requestId} onClick={() => onHandoff(requestId)}><Send size={14} />移交 {requestById.get(requestId)?.requestNo || "国内仓"}</button>)}</div></div> : null}
            {fullyRegistered && hasWarehouseHandoff ? <div className="sc-procurement-next-ok"><CheckCircle2 size={16} /><span>已进入国内仓协同，后续实际到货与发运资料以仓库验收结果为准。</span>{requestIds.map((requestId) => <button type="button" key={requestId} onClick={() => onHandoff(requestId)}>查看仓库进度<ArrowRight size={13} /></button>)}</div> : null}

            {isExpanded ? <div className="sc-procurement-line-table">
              <div className="head"><span>选择 / 商品</span><span>来源需求</span><span>采购数量</span><span>采购登记到货</span><span>仓库验收</span><span>采购成本</span><span>操作</span></div>
              {order.lines.map((line) => {
                const source = requestLineById.get(line.requestLineId);
                const remaining = lineRemaining(line);
                const warehouseQty = source?.line.warehouseGoodQty || source?.line.fulfilledQty || 0;
                const warehouseExpected = source?.line.warehouseExpectedQty || 0;
                return <div key={line.id} className={remaining <= 0 ? "is-received" : ""}>
                  <span className="product"><input type="checkbox" disabled={!canManage || remaining <= 0} checked={selected.has(line.id)} onChange={() => toggleLine(line.id)} />{source?.line.imageUrl ? <img src={source.line.imageUrl} alt="" /> : <i><Boxes size={15} /></i>}<em><b>{line.sku}</b><small>{line.productName}</small></em></span>
                  <span><b>{source?.request.requestNo || "-"}</b><small>{source?.request.project || source?.request.destinationWarehouseName || ""}</small></span>
                  <span><b>{quantity.format(line.quantity)} {line.unit}</b><small>{line.cancelledQty ? `已取消 ${quantity.format(line.cancelledQty)}` : "采购下单数量"}</small></span>
                  <span><b>{quantity.format(line.receivedQty)} / {quantity.format(Math.max(0, line.quantity - line.cancelledQty))}</b><small>{remaining > 0 ? `还差 ${quantity.format(remaining)}` : "采购侧已到齐"}</small></span>
                  <span><b>{quantity.format(warehouseQty)} / {quantity.format(source?.line.requestedQty || line.quantity)}</b><small>{warehouseExpected > 0 ? `已移交 ${quantity.format(warehouseExpected)}` : "尚未移交仓库"}</small></span>
                  <span><b>{currency.format(line.estimatedUnitCostCny)}/件</b><small>分摊后成本</small></span>
                  <span className="actions">{canManage && remaining > 0 ? <><button type="button" onClick={() => onEvent(order, line, "receive", true)}>全部到货</button><button type="button" onClick={() => onEvent(order, line, "receive")}>部分到货</button><button type="button" onClick={() => onEvent(order, line, "cancel")}>断货</button></> : <i><Check size={14} />已登记</i>}{canManage ? <details><summary>更多</summary><div><button type="button" onClick={() => onEvent(order, line, "refund")}>退款</button><button type="button" onClick={() => onEvent(order, line, "reship")}>补发</button></div></details> : null}</span>
                </div>;
              })}
            </div> : null}
          </article>;
        })}
        {!filteredOrders.length ? <div className="sc-warehouse-empty"><CheckCircle2 size={22} />当前筛选下没有采购单</div> : null}
      </div>
    </article>
  </section>;
}

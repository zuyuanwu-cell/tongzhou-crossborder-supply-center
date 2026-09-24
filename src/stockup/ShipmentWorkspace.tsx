import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, Check, MapPin, PackageOpen, Plus, Route, Ship, Truck, X } from "lucide-react";
import { confirmStockupCollaborationReceipt, createStockupCollaborationShipment, dispatchStockupCollaborationShipment } from "../api";
import type { StockupRequest, StockupShipment } from "./types";
import { formatStockupDate } from "./status";

type Props = {
  requests: StockupRequest[];
  shipments: StockupShipment[];
  canShip: boolean;
  canReceive: boolean;
  loadRequest: (id: string) => Promise<StockupRequest>;
  onChanged: () => Promise<void>;
};

export function ShipmentWorkspace({ requests, shipments, canShip, canReceive, loadRequest, onChanged }: Props) {
  const [modal, setModal] = useState<"shipment" | "receipt" | "">("");
  const [selectedRequest, setSelectedRequest] = useState<StockupRequest | null>(null);
  const [selectedShipment, setSelectedShipment] = useState<StockupShipment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ requestId: "", originWarehouse: "", carrier: "", transportMode: "海运", trackingNo: "", etd: "", eta: "", packages: 0, totalWeightKg: 0, totalVolumeM3: 0, chargeableWeightKg: 0, note: "" });
  const [shipLines, setShipLines] = useState<Array<{ taskId: string; sku: string; productName: string; shippedQty: number; baseUnitCostCny: number }>>([]);
  const [receipt, setReceipt] = useState({ arrivedAt: new Date().toISOString().slice(0, 10), shelvedAt: "", wmsInboundNo: "", note: "" });
  const [receiptLines, setReceiptLines] = useState<Array<{ shipmentLineId: string; sku: string; productName: string; expectedQty: number; receivedQty: number; goodQty: number; damagedQty: number; shortageQty: number; pendingQty: number; shelvedQty: number; unit: string; exceptionNote: string }>>([]);

  const readyRequests = requests.filter((request) => ["in_progress", "waiting_shipment", "accepted"].includes(request.status));
  const inTransit = shipments.filter((shipment) => shipment.status === "shipped");
  const drafts = shipments.filter((shipment) => shipment.status === "draft");
  const arrived = shipments.filter((shipment) => shipment.status === "arrived");

  async function selectRequest(requestId: string) {
    setForm((current) => ({ ...current, requestId }));
    if (!requestId) { setSelectedRequest(null); setShipLines([]); return; }
    const detail = await loadRequest(requestId);
    setSelectedRequest(detail);
    const lines = (detail.tasks || []).filter((task) => task.completedQty > 0 && !["terminated"].includes(task.status)).map((task) => {
      const product = detail.lines.find((line) => line.id === task.lineId);
      const sent = (detail.shipments || []).flatMap((shipment) => shipment.lines || []).filter((line) => line.taskId === task.id).reduce((sum, line) => sum + line.shippedQty, 0);
      return { taskId: task.id, sku: product?.sku || "", productName: product?.productName || "", shippedQty: Math.max(0, task.completedQty - sent), baseUnitCostCny: Number(product?.targetUnitCostCny || 0) };
    }).filter((line) => line.shippedQty > 0);
    setShipLines(lines);
  }

  async function submitShipment() {
    if (!selectedRequest || !shipLines.some((line) => line.shippedQty > 0)) { setError("请选择有已完成数量的需求。" ); return; }
    if (!form.carrier || !form.trackingNo || !form.eta) { setError("请填写承运商、物流单号和预计到仓时间。" ); return; }
    setBusy(true); setError("");
    try {
      const created = await createStockupCollaborationShipment({ ...form, lines: shipLines.filter((line) => line.shippedQty > 0) });
      await dispatchStockupCollaborationShipment(created.shipment.id, { carrier: form.carrier, transportMode: form.transportMode, trackingNo: form.trackingNo, etd: form.etd, eta: form.eta, actualShippedAt: new Date().toISOString() });
      setModal(""); await onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "登记发运失败"); }
    finally { setBusy(false); }
  }

  async function openReceipt(shipment: StockupShipment) {
    setError("");
    const detail = await loadRequest(shipment.requestId);
    const full = detail.shipments?.find((item) => item.id === shipment.id) || shipment;
    setSelectedShipment(full);
    setReceiptLines((full.lines || []).map((line) => ({ shipmentLineId: line.id, sku: line.sku, productName: line.productName, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: line.shippedQty, damagedQty: 0, shortageQty: 0, pendingQty: 0, shelvedQty: line.shippedQty, unit: line.unit, exceptionNote: "" })));
    setModal("receipt");
  }

  async function submitReceipt() {
    if (!selectedShipment) return;
    setBusy(true); setError("");
    try { await confirmStockupCollaborationReceipt({ shipmentId: selectedShipment.id, ...receipt, lines: receiptLines }); setModal(""); await onChanged(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "确认到仓失败"); }
    finally { setBusy(false); }
  }

  function updateReceiptLine(index: number, field: string, value: number | string) {
    setReceiptLines((current) => current.map((line, itemIndex) => itemIndex === index ? { ...line, [field]: value } : line));
  }

  return <>
    <div className="sc-logistics-summary"><article><Route size={21} /><div><small>待登记发运</small><b>{readyRequests.length}</b></div></article><article><Ship size={21} /><div><small>在途批次</small><b>{inTransit.length}</b></div></article><article><PackageOpen size={21} /><div><small>已到仓批次</small><b>{arrived.length}</b></div></article><article><CalendarClock size={21} /><div><small>7天内预计到仓</small><b>{inTransit.filter((item) => item.eta && item.eta <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length}</b></div></article></div>
    <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">LOGISTICS & RECEIVING</span><h3>物流与到仓</h3><p>物流跟单登记发运，仓库只处理待收货批次。</p></div>{canShip ? <button className="sc-button sc-button-primary" onClick={() => { setModal("shipment"); setSelectedRequest(null); setShipLines([]); }}><Plus size={17} />登记发运</button> : null}</div>
      <div className="sc-shipment-board"><div><h4>待发运 <span>{drafts.length}</span></h4>{drafts.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} />)}{!drafts.length ? <EmptyLane text="暂无待发运批次" /> : null}</div><div><h4>在途中 <span>{inTransit.length}</span></h4>{inTransit.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} action={canReceive ? <button onClick={() => openReceipt(shipment)}><Check size={15} />确认到仓</button> : undefined} />)}{!inTransit.length ? <EmptyLane text="暂无在途批次" /> : null}</div><div><h4>已到仓 <span>{arrived.length}</span></h4>{arrived.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} />)}{!arrived.length ? <EmptyLane text="暂无已到仓批次" /> : null}</div></div>
    </section>

    {modal === "shipment" ? <div className="sc-modal-backdrop"><div className="sc-modal sc-medium-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">NEW SHIPMENT</span><h2>登记发运</h2><p>选择已完工任务，登记物流单号与预计到仓时间。</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={20} /></button></header><div className="sc-editor-scroll">{error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}<div className="sc-form-grid"><label className="full">备货需求<select value={form.requestId} onChange={(event) => void selectRequest(event.target.value)}><option value="">请选择待发运需求</option>{readyRequests.map((request) => <option value={request.id} key={request.id}>{request.requestNo} · {request.destinationWarehouseName}</option>)}</select></label><label>发货仓<input value={form.originWarehouse} onChange={(event) => setForm({ ...form, originWarehouse: event.target.value })} /></label><label>运输方式<select value={form.transportMode} onChange={(event) => setForm({ ...form, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label><label>承运商<input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} /></label><label>物流单号 / 提单号<input value={form.trackingNo} onChange={(event) => setForm({ ...form, trackingNo: event.target.value })} /></label><label>计划发运日 ETD<input type="date" value={form.etd} onChange={(event) => setForm({ ...form, etd: event.target.value })} /></label><label>预计到仓日 ETA<input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} /></label></div><div className="sc-shipment-lines">{shipLines.map((line, index) => <div key={line.taskId}><span>{line.sku}</span><b>{line.productName}</b><label><input type="number" min="0" value={line.shippedQty} onChange={(event) => setShipLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, shippedQty: Number(event.target.value) } : item))} /> 件</label></div>)}</div></div><footer className="sc-modal-foot"><span>确认后会立即进入在途状态并回传运营。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={busy} onClick={submitShipment}><Truck size={17} />确认发运</button></div></footer></div></div> : null}

    {modal === "receipt" && selectedShipment ? <div className="sc-modal-backdrop"><div className="sc-modal sc-wide-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">WAREHOUSE RECEIPT</span><h2>确认到仓</h2><p>{selectedShipment.shipmentNo} · {selectedShipment.destinationWarehouseName}</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={20} /></button></header><div className="sc-editor-scroll">{error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}<div className="sc-form-grid sc-form-grid-4"><label>实际到仓日期<input type="date" value={receipt.arrivedAt} onChange={(event) => setReceipt({ ...receipt, arrivedAt: event.target.value })} /></label><label>上架日期<input type="date" value={receipt.shelvedAt} onChange={(event) => setReceipt({ ...receipt, shelvedAt: event.target.value })} /></label><label>WMS 入库单号<input value={receipt.wmsInboundNo} onChange={(event) => setReceipt({ ...receipt, wmsInboundNo: event.target.value })} /></label><label>备注<input value={receipt.note} onChange={(event) => setReceipt({ ...receipt, note: event.target.value })} /></label></div><div className="sc-receipt-table"><div className="head"><span>产品</span><span>应到</span><span>实收</span><span>良品</span><span>破损</span><span>短少</span><span>待处理</span><span>上架</span></div>{receiptLines.map((line, index) => <div key={line.shipmentLineId}><span><b>{line.sku}</b><small>{line.productName}</small></span>{["expectedQty", "receivedQty", "goodQty", "damagedQty", "shortageQty", "pendingQty", "shelvedQty"].map((field) => <span key={field}><input type="number" min="0" value={Number(line[field as keyof typeof line])} onChange={(event) => updateReceiptLine(index, field, Number(event.target.value))} /></span>)}</div>)}</div></div><footer className="sc-modal-foot"><span>短少、破损或待处理数量会自动创建收货异常。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={busy} onClick={submitReceipt}><Check size={17} />确认收货</button></div></footer></div></div> : null}
  </>;
}

function ShipmentCard({ shipment, action }: { shipment: StockupShipment; action?: React.ReactNode }) {
  return <article className="sc-shipment-card"><div><span className="sc-route-icon">{shipment.transportMode === "海运" ? <Ship size={18} /> : <Truck size={18} />}</span><div><b>{shipment.shipmentNo}</b><small>{shipment.carrier || "待填写承运商"}</small></div></div><dl><div><dt>物流单号</dt><dd>{shipment.trackingNo || "—"}</dd></div><div><dt>预计到仓</dt><dd>{formatStockupDate(shipment.eta)}</dd></div><div><dt>目的仓</dt><dd><MapPin size={13} />{shipment.destinationWarehouseName}</dd></div></dl>{action ? <footer>{action}</footer> : null}</article>;
}

function EmptyLane({ text }: { text: string }) { return <div className="sc-lane-empty"><Route size={23} /><span>{text}</span></div>; }

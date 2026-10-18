import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, FileText, LoaderCircle, LockKeyhole, PackageCheck, Plus, RefreshCw, Send, Ship, Truck, X } from "lucide-react";
import {
  cancelStockupReservedShipment,
  confirmStockupCollaborationReceipt,
  createStockupCollaborationWarehouseOrder,
  createStockupReservedShipment,
  downloadStockupDispatchDocument,
  fetchStockupDispatchDocuments,
  fetchStockupForwarders,
  fetchStockupWarehouseDashboard,
  generateStockupDispatchDocuments,
  handoverStockupShipment,
  issueStockupDispatchInstruction,
  previewStockupCollaborationWarehouseOrder,
} from "../api";
import type { StockupDispatchDocument, StockupForwarder, StockupShipment, StockupWarehouseWorkOrder } from "./types";
import { formatStockupDate, stockupRequestStatusLabels } from "./status";

type Props = {
  shipments: StockupShipment[];
  canShip: boolean;
  canReceive: boolean;
  onStartCosting: (receiptId: string) => void;
  onChanged: () => Promise<void>;
};

type LotChoice = { inspectionLotId: string; quantity: number; selected: boolean; order: StockupWarehouseWorkOrder; line: StockupWarehouseWorkOrder["lines"][number]; lot: NonNullable<StockupWarehouseWorkOrder["lines"][number]["lots"]>[number] };

const shipmentStates = ["inventory_reserved", "wms_created", "instruction_issued", "handed_over", "overseas_received", "cost_locked"];

export function SpotDispatchWorkspace({ shipments, canShip, canReceive, onStartCosting, onChanged }: Props) {
  const [workOrders, setWorkOrders] = useState<StockupWarehouseWorkOrder[]>([]);
  const [forwarders, setForwarders] = useState<StockupForwarder[]>([]);
  const [choices, setChoices] = useState<Record<string, LotChoice>>({});
  const [documents, setDocuments] = useState<Record<string, StockupDispatchDocument[]>>({});
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ forwarderLocationId: "", transportMode: "海运", carrier: "", etd: "", eta: "", chargeableWeightKg: 0, boxMark: "", note: "" });

  const load = useCallback(async () => {
    try {
      const [dashboard, forwarderResult] = await Promise.all([fetchStockupWarehouseDashboard(), fetchStockupForwarders()]);
      setWorkOrders((dashboard.workOrders || []).filter((item) => item.workflowVersion === 2));
      setForwarders(forwarderResult.forwarders || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "出运基础数据读取失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const availableLots = useMemo(() => workOrders.flatMap((order) => order.lines.flatMap((line) => (line.lots || [])
    .filter((lot) => lot.status === "approved")
    .map((lot) => ({ inspectionLotId: lot.id, quantity: lot.quantity, selected: false, order, line, lot })))), [workOrders]);
  const locations = forwarders.flatMap((item) => item.locations.filter((location) => location.status === "active").map((location) => ({ ...location, forwarderName: item.name })));
  const activeShipments = shipments.filter((item) => shipmentStates.includes(item.status));

  function openReservation() {
    setChoices(Object.fromEntries(availableLots.map((item) => [item.inspectionLotId, item])));
    setForm({ forwarderLocationId: locations[0]?.id || "", transportMode: "海运", carrier: "", etd: "", eta: "", chargeableWeightKg: 0, boxMark: "", note: "" });
    setError(""); setModal(true);
  }

  async function reserve() {
    const selected = Object.values(choices).filter((item) => item.selected);
    if (!selected.length || !form.forwarderLocationId || !form.transportMode) { setError("请选择至少一个已审核批次、运输方式和货代收货点。"); return; }
    const first = selected[0];
    if (selected.some((item) => item.order.domesticWarehouseId !== first.order.domesticWarehouseId || item.order.destinationWarehouseId !== first.order.destinationWarehouseId)) {
      setError("一次出运只能合并相同国内仓和海外目的仓的批次。"); return;
    }
    setBusy("reserve"); setError("");
    try {
      const result = await createStockupReservedShipment({ ...form, lines: selected.map((item) => ({ inspectionLotId: item.inspectionLotId, quantity: item.quantity })) });
      setMessage(`${result.shipment.shipmentNo} 已创建并锁定国内库存，尚未扣库。`); setModal(false); await Promise.all([load(), onChanged()]);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "库存锁定失败"); }
    finally { setBusy(""); }
  }

  async function createWms(shipment: StockupShipment) {
    setBusy(shipment.id); setError("");
    try {
      const preview = await previewStockupCollaborationWarehouseOrder(shipment.id);
      if (!window.confirm(`确认创建${preview.documentLabel}？\n${preview.itemCount} 个 SKU，${preview.totalQuantity} 件，${preview.totalBoxes} 箱。`)) return;
      const result = await createStockupCollaborationWarehouseOrder(shipment.id, preview.shipmentVersion, false);
      setMessage(`${result.documentLabel || "海外仓备货单"}已创建：${result.shipment.wmsOrderNo}`); await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "WMS 建单失败"); }
    finally { setBusy(""); }
  }

  async function generateDocuments(shipment: StockupShipment) {
    setBusy(shipment.id); setError("");
    try {
      const result = await generateStockupDispatchDocuments(shipment.id);
      setDocuments((current) => ({ ...current, [shipment.id]: result.documents }));
      setMessage(`装箱单和逐箱箱唛 PDF V${result.version} 已生成并保存校验值。`); await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "发运文件生成失败"); }
    finally { setBusy(""); }
  }

  async function loadDocuments(shipment: StockupShipment) {
    setBusy(shipment.id); setError("");
    try { const result = await fetchStockupDispatchDocuments(shipment.id); setDocuments((current) => ({ ...current, [shipment.id]: result.documents.filter((item) => item.version === result.currentVersion) })); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "发运文件读取失败"); }
    finally { setBusy(""); }
  }

  async function issue(shipment: StockupShipment) {
    setBusy(shipment.id); setError("");
    try { await issueStockupDispatchInstruction(shipment.id, { notifyWarehouse: true }); setMessage("发货任务已下发；通知失败时会进入重试队列，不回滚业务状态。"); await onChanged(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "发货指令下发失败"); }
    finally { setBusy(""); }
  }

  async function handover(shipment: StockupShipment) {
    const trackingNo = window.prompt("请输入交接货代后的运单号：", shipment.trackingNo || "") || "";
    if (!trackingNo.trim()) return;
    const actualFreightCny = Number(window.prompt("实际国内运费（可填 0，后续仍可补录）：", "0") || 0);
    setBusy(shipment.id); setError("");
    try { await handoverStockupShipment(shipment.id, { trackingNo, actualFreightCny, handedOverAt: new Date().toISOString() }); setMessage("已确认货代交接，国内库存已按预约单次扣减。"); await onChanged(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "货代交接确认失败"); }
    finally { setBusy(""); }
  }

  async function receive(shipment: StockupShipment) {
    setBusy(shipment.id); setError("");
    try {
      const result = await confirmStockupCollaborationReceipt({ shipmentId: shipment.id, arrivedAt: new Date().toISOString().slice(0, 10), lines: (shipment.lines || []).map((line) => ({ shipmentLineId: line.id, sku: line.sku, productName: line.productName, expectedQty: line.shippedQty, receivedQty: line.shippedQty, goodQty: line.shippedQty, damagedQty: 0, shortageQty: 0, pendingQty: 0, shelvedQty: line.shippedQty, unit: line.unit, exceptionNote: "" })) });
      setMessage("海外仓收货已确认，可归集费用并锁定到仓成本。"); await onChanged(); onStartCosting(result.receipt.id);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "海外仓收货确认失败"); }
    finally { setBusy(""); }
  }

  async function cancel(shipment: StockupShipment) {
    const reason = window.prompt("请输入取消原因。系统将先撤销 WMS 单（如有）再释放库存：", "") || "";
    if (!reason.trim()) return;
    setBusy(shipment.id); setError("");
    try { await cancelStockupReservedShipment(shipment.id, reason); setMessage("出运计划已取消，WMS 单已撤销且国内库存已释放。"); await onChanged(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "取消出运计划失败"); }
    finally { setBusy(""); }
  }

  return <section className="sc-panel" style={{ marginBottom: 20 }}>
    <div className="sc-panel-head"><div><span className="sc-eyebrow">SPOT STOCK DISPATCH V2</span><h3>现货出运闭环</h3><p>直接引用已审核批次箱规；锁库时不扣库存，仓库交货货代时才扣库。</p></div><div style={{ display: "flex", gap: 8 }}><button className="sc-button sc-button-secondary" onClick={() => void load()}><RefreshCw size={16} />刷新批次</button>{canShip ? <button className="sc-button sc-button-primary" onClick={openReservation}><Plus size={17} />创建锁库出运计划</button> : null}</div></div>
    {error ? <div className="sc-alert sc-alert-danger"><AlertTriangle size={16} />{error}</div> : null}
    {message ? <div className="sc-warehouse-success"><Check size={16} />{message}<button onClick={() => setMessage("")}><X size={14} /></button></div> : null}
    <div className="sc-shipment-board">{activeShipments.map((shipment) => <article className="sc-shipment-card" key={shipment.id}><header><span><Ship size={18} /></span><div><b>{shipment.shipmentNo}</b><small>{shipment.originWarehouse} → {shipment.destinationWarehouseName}</small></div><i className={`sc-status is-${shipment.status}`}>{stockupRequestStatusLabels[shipment.status] || shipment.status}</i></header><div className="sc-shipment-meta"><span><small>批次</small><b>{shipment.lines?.length || 0} 行 / {shipment.packages} 箱</b></span><span><small>运输</small><b>{shipment.transportMode}</b></span><span><small>WMS</small><b>{shipment.wmsOrderNo || "未创建"}</b></span><span><small>文件版本</small><b>{shipment.documentVersion ? `V${shipment.documentVersion}` : "未生成"}</b></span></div><p>{String(shipment.forwarderSnapshot?.forwarderName || "货代待确认")} · {String(shipment.forwarderSnapshot?.locationName || "")} {String(shipment.forwarderSnapshot?.address || "")}</p><footer>
      {busy === shipment.id ? <LoaderCircle className="spin" size={17} /> : null}
      {canShip && shipment.status === "inventory_reserved" ? <button onClick={() => void createWms(shipment)}><PackageCheck size={15} />预览并创建 WMS 单</button> : null}
      {canShip && shipment.status === "wms_created" && !shipment.documentVersion ? <button onClick={() => void generateDocuments(shipment)}><FileText size={15} />生成装箱单与箱唛</button> : null}
      {shipment.documentVersion ? <button onClick={() => void loadDocuments(shipment)}><Download size={15} />查看文件</button> : null}
      {canShip && shipment.status === "wms_created" && shipment.documentVersion ? <button className="is-primary" onClick={() => void issue(shipment)}><Send size={15} />发布发货任务</button> : null}
      {canShip && shipment.status === "instruction_issued" ? <button className="is-primary" onClick={() => void handover(shipment)}><Truck size={15} />确认交货货代</button> : null}
      {canReceive && shipment.status === "handed_over" ? <button className="is-primary" onClick={() => void receive(shipment)}><Check size={15} />确认海外仓收货</button> : null}
      {canShip && ["inventory_reserved", "wms_created", "instruction_issued"].includes(shipment.status) ? <button onClick={() => void cancel(shipment)}><X size={15} />取消并释放库存</button> : null}
      {shipment.status === "overseas_received" ? <span className="sc-status is-overseas_received">已进入收货与成本归集</span> : null}
    </footer>{documents[shipment.id]?.length ? <div className="sc-operation-checks">{documents[shipment.id].map((document) => <button key={document.id} onClick={() => void downloadStockupDispatchDocument(document)}><Download size={14} />{document.documentType === "packing_list" ? "A4 装箱单" : "100×100mm 箱唛"} V{document.version}</button>)}</div> : null}</article>)}{!activeShipments.length ? <div className="sc-empty-inline"><LockKeyhole size={25} /><b>暂无 V2 出运计划</b><span>验货审核入库后，可选择批次锁定库存。</span></div> : null}</div>

    {modal ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">INVENTORY RESERVATION</span><h2>选择已审核库存批次</h2><p>箱规直接来自仓库验货，不重复录入。</p></div><button className="sc-icon-button" onClick={() => setModal(false)}><X size={19} /></button></header><div className="sc-editor-scroll"><section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4"><label>货代收货点<select value={form.forwarderLocationId} onChange={(event) => setForm({ ...form, forwarderLocationId: event.target.value })}><option value="">请选择</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.forwarderName} · {location.name} · {location.city}</option>)}</select></label><label>运输方式<select value={form.transportMode} onChange={(event) => setForm({ ...form, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label><label>承运商<input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} /></label><label>计费重量 kg<input type="number" min="0" value={form.chargeableWeightKg} onChange={(event) => setForm({ ...form, chargeableWeightKg: Number(event.target.value) })} /></label><label>预计发出<input type="date" value={form.etd} onChange={(event) => setForm({ ...form, etd: event.target.value })} /></label><label>预计到仓<input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} /></label><label>箱唛标识<input value={form.boxMark} onChange={(event) => setForm({ ...form, boxMark: event.target.value })} /></label><label>备注<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label></div></section><section className="sc-form-section"><div className="sc-create-lines"><div className="head"><span>批次 / 商品</span><span>可锁定数量</span><span>生产与箱规</span></div>{availableLots.map((item) => <div key={item.inspectionLotId}><span className="product"><input type="checkbox" checked={Boolean(choices[item.inspectionLotId]?.selected)} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], selected: event.target.checked } }))} /><em><b>{item.line.sku} · {item.lot.lotNo}</b><small>{item.line.productName} · {item.order.domesticWarehouseName} → {item.order.destinationWarehouseName}</small></em></span><label><input type="number" min="0.01" max={item.lot.quantity} value={choices[item.inspectionLotId]?.quantity || 0} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], quantity: Number(event.target.value) } }))} /> {item.line.unit}</label><span><b>{formatStockupDate(item.lot.productionDate)}</b><small>{item.lot.cartonCount} 箱 × {item.lot.unitsPerCarton} · {item.lot.cartonLengthCm}×{item.lot.cartonWidthCm}×{item.lot.cartonHeightCm}cm</small></span></div>)}{!availableLots.length ? <div className="sc-warehouse-empty">暂无已审核入库批次</div> : null}</div></section></div><footer className="sc-modal-foot"><span>创建时执行并发锁库，避免超卖。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal(false)}>取消</button><button className="sc-button sc-button-primary" disabled={busy === "reserve"} onClick={() => void reserve()}>{busy === "reserve" ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}锁定库存并建计划</button></div></footer></section></div> : null}
  </section>;
}


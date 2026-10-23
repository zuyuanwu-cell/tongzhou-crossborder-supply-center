import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, Check, Download, FileText, LoaderCircle, LockKeyhole, MapPin, PackageCheck, Plus, RefreshCw, Send, Ship, Truck, X } from "lucide-react";
import {
  cancelStockupReservedShipment,
  confirmStockupCollaborationReceipt,
  createStockupCollaborationWarehouseOrder,
  createStockupForwarder,
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
  initialRequestId?: string;
  handoffToken?: number;
  onHandoffConsumed?: () => void;
  onStartCosting: (receiptId: string) => void;
  onChanged: () => Promise<void>;
};

type LotChoice = {
  inspectionLotId: string;
  quantity: number;
  selected: boolean;
  shipmentCartonCount: number;
  shipmentUnitsPerCarton: number;
  order: StockupWarehouseWorkOrder;
  line: StockupWarehouseWorkOrder["lines"][number];
  lot: NonNullable<StockupWarehouseWorkOrder["lines"][number]["lots"]>[number];
};

type ShipmentBillingMethod = "volume" | "weight" | "flat";

function summarizeWarehouseLots(items: LotChoice[]) {
  return items.reduce((summary, item) => ({
    packages: summary.packages + Number(item.lot.cartonCount || 0),
    weightKg: summary.weightKg + Number(item.lot.cartonCount || 0) * Number(item.lot.cartonWeightKg || 0),
    volumeM3: summary.volumeM3 + Number(item.lot.cartonCount || 0) * Number(item.lot.cartonLengthCm || 0) * Number(item.lot.cartonWidthCm || 0) * Number(item.lot.cartonHeightCm || 0) / 1_000_000,
  }), { packages: 0, weightKg: 0, volumeM3: 0 });
}

function summarizeShipmentLots(items: LotChoice[]) {
  return items.reduce((summary, item) => ({
    packages: summary.packages + Number(item.shipmentCartonCount || 0),
    weightKg: summary.weightKg + Number(item.shipmentCartonCount || 0) * Number(item.lot.cartonWeightKg || 0),
    volumeM3: summary.volumeM3 + Number(item.shipmentCartonCount || 0) * Number(item.lot.cartonLengthCm || 0) * Number(item.lot.cartonWidthCm || 0) * Number(item.lot.cartonHeightCm || 0) / 1_000_000,
  }), { packages: 0, weightKg: 0, volumeM3: 0 });
}

function roundMeasure(value: number, digits = 2) {
  const power = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * power) / power;
}

const shipmentStates = ["inventory_reserved", "wms_created", "instruction_issued", "handed_over", "overseas_received", "cost_locked"];

export function SpotDispatchWorkspace({ shipments, canShip, canReceive, initialRequestId = "", handoffToken = 0, onHandoffConsumed, onStartCosting, onChanged }: Props) {
  const [workOrders, setWorkOrders] = useState<StockupWarehouseWorkOrder[]>([]);
  const [forwarders, setForwarders] = useState<StockupForwarder[]>([]);
  const [choices, setChoices] = useState<Record<string, LotChoice>>({});
  const [documents, setDocuments] = useState<Record<string, StockupDispatchDocument[]>>({});
  const [modal, setModal] = useState(false);
  const [forwarderModal, setForwarderModal] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const openedHandoffToken = useRef(0);
  const [form, setForm] = useState({ forwarderLocationId: "", transportMode: "海运", carrier: "", trackingNo: "", etd: "", eta: "", billingMethod: "volume" as ShipmentBillingMethod, carrierPackages: 0, carrierActualWeightKg: 0, chargeableWeightKg: 0, chargeableVolumeM3: 0, billingUnitPriceCny: 0, billingExtraFeeCny: 0, boxMark: "", note: "" });
  const [forwarder, setForwarder] = useState({ name: "", locationName: "", country: "中国", province: "", city: "", address: "", contactName: "", contactPhone: "", routingRequirements: "" });

  const load = useCallback(async () => {
    try {
      const [dashboard, forwarderResult] = await Promise.all([fetchStockupWarehouseDashboard(), fetchStockupForwarders()]);
      setWorkOrders((dashboard.workOrders || []).filter((item) => item.workflowVersion === 2));
      setForwarders(forwarderResult.forwarders || []);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "出运基础数据读取失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const availableLots = useMemo(() => workOrders.flatMap((order) => order.lines.flatMap((line) => (line.lots || [])
    .filter((lot) => lot.status === "approved" && Number(lot.availableQty ?? lot.quantity) > 0)
    .map((lot) => ({ inspectionLotId: lot.id, quantity: Number(lot.availableQty ?? lot.quantity), selected: false, shipmentCartonCount: Number(lot.cartonCount || 0), shipmentUnitsPerCarton: Number(lot.unitsPerCarton || 0), order, line, lot })))), [workOrders]);
  const locations = forwarders.flatMap((item) => item.locations.filter((location) => location.status === "active").map((location) => ({ ...location, forwarderName: item.name })));
  const activeShipments = shipments.filter((item) => shipmentStates.includes(item.status));
  const modalLots = Object.values(choices);
  const selectedLots = useMemo(() => modalLots.filter((item) => item.selected), [modalLots]);
  const warehouseSummary = useMemo(() => summarizeWarehouseLots(selectedLots), [selectedLots]);
  const shipmentSummary = useMemo(() => summarizeShipmentLots(selectedLots), [selectedLots]);
  const billingBasis = form.billingMethod === "volume" ? form.chargeableVolumeM3 : form.billingMethod === "weight" ? form.chargeableWeightKg : 1;
  const quotedFreightCny = roundMeasure(Math.max(0, billingBasis) * Math.max(0, form.billingUnitPriceCny) + Math.max(0, form.billingExtraFeeCny));
  const readyGroups = useMemo(() => {
    const groups = new Map<string, { requestId: string; requestNo: string; warehouseName: string; destinationName: string; skuSet: Set<string>; lotCount: number; quantity: number; cartonCount: number }>();
    for (const item of availableLots) {
      const current = groups.get(item.order.requestId) || { requestId: item.order.requestId, requestNo: item.order.requestNo, warehouseName: item.order.domesticWarehouseName, destinationName: item.order.destinationWarehouseName, skuSet: new Set<string>(), lotCount: 0, quantity: 0, cartonCount: 0 };
      current.skuSet.add(item.line.sku);
      current.lotCount += 1;
      current.quantity += item.quantity;
      current.cartonCount += Number(item.lot.cartonCount || 0);
      groups.set(item.order.requestId, current);
    }
    return [...groups.values()];
  }, [availableLots]);
  const readyQuantity = availableLots.reduce((sum, item) => sum + item.quantity, 0);
  const readySkuCount = new Set(availableLots.map((item) => item.line.sku)).size;

  function openReservation(requestId = "", activeLocations = locations) {
    const eligibleLots = requestId ? availableLots.filter((item) => item.order.requestId === requestId) : availableLots;
    const nextChoices = Object.fromEntries(eligibleLots.map((item) => [item.inspectionLotId, { ...item, selected: Boolean(requestId) }]));
    const summary = summarizeShipmentLots(Object.values(nextChoices).filter((item) => item.selected));
    setChoices(nextChoices);
    setForm({ forwarderLocationId: activeLocations[0]?.id || "", transportMode: "海运", carrier: "", trackingNo: "", etd: "", eta: "", billingMethod: "volume", carrierPackages: summary.packages, carrierActualWeightKg: roundMeasure(summary.weightKg), chargeableWeightKg: roundMeasure(summary.weightKg), chargeableVolumeM3: roundMeasure(summary.volumeM3, 3), billingUnitPriceCny: 0, billingExtraFeeCny: 0, boxMark: "", note: "" });
    setError(""); setModal(true);
  }

  function fillCarrierMeasuresFromShipment() {
    setForm((current) => ({ ...current, carrierPackages: shipmentSummary.packages, carrierActualWeightKg: roundMeasure(shipmentSummary.weightKg), chargeableWeightKg: roundMeasure(shipmentSummary.weightKg), chargeableVolumeM3: roundMeasure(shipmentSummary.volumeM3, 3) }));
  }

  function beginReservation(requestId = "") {
    if (!availableLots.length) { setError("当前没有可发运的已审核国内库存批次。"); return; }
    if (!locations.length) {
      setPendingRequestId(requestId);
      setError("已审核库存存在，但尚未配置货代收货点。请先在当前页面补充一次，保存后会继续创建出运计划。");
      setForwarderModal(true);
      return;
    }
    openReservation(requestId);
  }

  async function saveForwarder() {
    if (!forwarder.name.trim() || !forwarder.locationName.trim() || !forwarder.address.trim() || !forwarder.contactName.trim() || !forwarder.contactPhone.trim()) {
      setError("请补齐货代名称、收货点、详细地址、联系人和电话。"); return;
    }
    setBusy("forwarder"); setError("");
    try {
      await createStockupForwarder({ code: `FF-${Date.now().toString(36).toUpperCase()}`, name: forwarder.name.trim(), locations: [{ ...forwarder, name: forwarder.locationName.trim() }] });
      const result = await fetchStockupForwarders();
      setForwarders(result.forwarders || []);
      const nextLocations = (result.forwarders || []).flatMap((item) => item.locations.filter((location) => location.status === "active").map((location) => ({ ...location, forwarderName: item.name })));
      setForwarderModal(false);
      setForwarder({ name: "", locationName: "", country: "中国", province: "", city: "", address: "", contactName: "", contactPhone: "", routingRequirements: "" });
      setMessage("货代收货点已保存，继续选择本次发运批次。");
      openReservation(pendingRequestId, nextLocations);
      setPendingRequestId("");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "货代收货点保存失败"); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (!initialRequestId || !handoffToken || openedHandoffToken.current === handoffToken || !workOrders.length) return;
    const matchingLots = availableLots.filter((item) => item.order.requestId === initialRequestId);
    openedHandoffToken.current = handoffToken;
    onHandoffConsumed?.();
    if (!matchingLots.length) {
      setError("该需求暂未找到可发运的已审核批次，请刷新仓库验收状态或检查验货是否已通过审核。");
      return;
    }
    beginReservation(initialRequestId);
  }, [availableLots, handoffToken, initialRequestId, onHandoffConsumed, workOrders.length]);

  async function reserve() {
    const selected = selectedLots;
    if (!selected.length || !form.forwarderLocationId || !form.transportMode) { setError("请选择至少一个已审核批次、运输方式和货代收货点。"); return; }
    if (form.billingMethod === "volume" && form.chargeableVolumeM3 <= 0) { setError("按体积计费时，请填写货代确认的计费方数（CBM）。"); return; }
    if (form.billingMethod === "weight" && form.chargeableWeightKg <= 0) { setError("按重量计费时，请填写货代确认的计费重量（kg）。"); return; }
    const first = selected[0];
    if (selected.some((item) => item.order.domesticWarehouseId !== first.order.domesticWarehouseId || item.order.destinationWarehouseId !== first.order.destinationWarehouseId)) {
      setError("一次出运只能合并相同国内仓和海外目的仓的批次。"); return;
    }
    setBusy("reserve"); setError("");
    try {
      const result = await createStockupReservedShipment({ ...form, lines: selected.map((item) => ({ inspectionLotId: item.inspectionLotId, quantity: item.quantity, cartonCount: item.shipmentCartonCount, unitsPerCarton: item.shipmentUnitsPerCarton })) });
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
    const actualFreightCny = Number(window.prompt(`实际头程物流总费用（含附加费，可填 0 后续补录）：\n当前报价估算 ¥${Number(shipment.quotedFreightCny || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`, String(shipment.quotedFreightCny || 0)) || 0);
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
    <div className="sc-panel-head"><div><span className="sc-eyebrow">LOGISTICS & RECEIVING</span><h3>物流与到仓</h3><p>待生成文件 → 待下发仓库 → 待交货代 → 在途中 → 已到仓；交货代时才正式扣减国内库存。</p></div><div style={{ display: "flex", gap: 8 }}><button className="sc-button sc-button-secondary" onClick={() => void load()}><RefreshCw size={16} />刷新批次</button>{canShip ? <button className="sc-button sc-button-primary" onClick={() => beginReservation()}><Plus size={17} />创建出运计划</button> : null}</div></div>
    {error ? <div className="sc-alert sc-alert-danger"><AlertTriangle size={16} />{error}</div> : null}
    {message ? <div className="sc-warehouse-success"><Check size={16} />{message}<button onClick={() => setMessage("")}><X size={14} /></button></div> : null}
    <div className="sc-dispatch-readiness-metrics">
      <article><span><PackageCheck size={19} /></span><div><small>待建出运需求</small><b>{readyGroups.length}</b><em>国内仓已审核入库</em></div></article>
      <article><span><Boxes size={19} /></span><div><small>可发运 SKU</small><b>{readySkuCount}</b><em>{availableLots.length} 个库存批次</em></div></article>
      <article><span><LockKeyhole size={19} /></span><div><small>当前可锁定</small><b>{readyQuantity.toLocaleString("zh-CN")}</b><em>已扣除锁定及已发数量</em></div></article>
      <article className={!locations.length && readyGroups.length ? "is-warning" : ""}><span><MapPin size={19} /></span><div><small>货代收货点</small><b>{locations.length}</b><em>{locations.length ? "可直接创建计划" : "需补充后继续"}</em></div></article>
    </div>
    {readyGroups.length ? <section className="sc-ready-dispatch-queue"><header><div><b>待创建出运计划</b><span>这些货已在国内库存中，不需要重复入库；选择需求后直接锁库发运。</span></div></header><div>{readyGroups.map((group) => <article key={group.requestId}><span><PackageCheck size={20} /></span><div><b>{group.requestNo}</b><small>{group.warehouseName} → {group.destinationName}</small></div><dl><div><dt>可发 SKU</dt><dd>{group.skuSet.size}</dd></div><div><dt>批次 / 箱数</dt><dd>{group.lotCount} / {group.cartonCount}</dd></div><div><dt>可发数量</dt><dd>{group.quantity.toLocaleString("zh-CN")}</dd></div></dl>{canShip ? <button onClick={() => beginReservation(group.requestId)}>创建该需求出运计划</button> : null}</article>)}</div></section> : null}
    <div className="sc-shipment-board">{activeShipments.map((shipment) => <article className="sc-shipment-card" key={shipment.id}><header><span><Ship size={18} /></span><div><b>{shipment.shipmentNo}</b><small>{shipment.originWarehouse} → {shipment.destinationWarehouseName}</small></div><i className={`sc-status is-${shipment.status}`}>{stockupRequestStatusLabels[shipment.status] || shipment.status}</i></header><div className="sc-shipment-meta"><span><small>发运箱数</small><b>{shipment.lines?.length || 0} 行 / {shipment.packages} 箱</b></span><span><small>货代确认</small><b>{shipment.carrierPackages || "—"} 箱</b></span><span><small>计费方式</small><b>{shipment.billingMethod === "volume" ? `${shipment.chargeableVolumeM3} CBM` : shipment.billingMethod === "flat" ? "按票" : `${shipment.chargeableWeightKg} kg`}</b></span><span><small>物流单号</small><b>{shipment.trackingNo || "待补"}</b></span></div><p>{String(shipment.forwarderSnapshot?.forwarderName || "货代待确认")} · {String(shipment.forwarderSnapshot?.locationName || "")} {String(shipment.forwarderSnapshot?.address || "")}</p><footer>
      {busy === shipment.id ? <LoaderCircle className="spin" size={17} /> : null}
      {canShip && shipment.status === "inventory_reserved" ? <button onClick={() => void createWms(shipment)}><PackageCheck size={15} />预览并创建 WMS 单</button> : null}
      {canShip && shipment.status === "wms_created" && !shipment.documentVersion ? <button onClick={() => void generateDocuments(shipment)}><FileText size={15} />生成装箱单与箱唛</button> : null}
      {shipment.documentVersion ? <button onClick={() => void loadDocuments(shipment)}><Download size={15} />下载/打印文件</button> : null}
      {canShip && shipment.status === "wms_created" && shipment.documentVersion ? <button className="is-primary" onClick={() => void issue(shipment)}><Send size={15} />下发仓库发货任务</button> : null}
      {canShip && shipment.status === "instruction_issued" ? <button className="is-primary" onClick={() => void handover(shipment)}><Truck size={15} />确认交货代并转在途中</button> : null}
      {canReceive && shipment.status === "handed_over" ? <button className="is-primary" onClick={() => void receive(shipment)}><Check size={15} />确认海外仓收货</button> : null}
      {canShip && ["inventory_reserved", "wms_created", "instruction_issued"].includes(shipment.status) ? <button onClick={() => void cancel(shipment)}><X size={15} />取消并释放库存</button> : null}
      {shipment.status === "overseas_received" ? <span className="sc-status is-overseas_received">已进入收货与成本归集</span> : null}
    </footer>{documents[shipment.id]?.length ? <div className="sc-operation-checks">{documents[shipment.id].map((document) => <button key={document.id} onClick={() => void downloadStockupDispatchDocument(document)}><Download size={14} />下载/打印{document.documentType === "packing_list" ? "A4 装箱单" : "100×100mm 箱唛"} V{document.version}</button>)}</div> : null}</article>)}{!activeShipments.length ? <div className="sc-empty-inline"><LockKeyhole size={25} /><b>尚未生成出运计划</b><span>{readyGroups.length ? "上方已有可发运库存，请点击需求右侧按钮继续。" : "验货审核入库后，可选择批次锁定库存。"}</span></div> : null}</div>

    {modal ? <div className="sc-modal-backdrop"><section className="sc-modal sc-warehouse-create-modal sc-dispatch-create-modal">
      <header className="sc-modal-head"><div><span className="sc-eyebrow">INVENTORY RESERVATION</span><h2>选择已审核库存批次</h2><p>仓库装箱数据保留原值；货代回传的箱数、实重和计费方数单独记录，用于核对与成本分摊。</p></div><button className="sc-icon-button" onClick={() => setModal(false)}><X size={19} /></button></header>
      <div className="sc-editor-scroll">
        <section className="sc-form-section">
          <div className="sc-form-grid sc-form-grid-4">
            <label>货代收货点<select value={form.forwarderLocationId} onChange={(event) => setForm({ ...form, forwarderLocationId: event.target.value })}><option value="">请选择</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.forwarderName} · {location.name} · {location.city}</option>)}</select></label>
            <label>运输方式<select value={form.transportMode} onChange={(event) => setForm({ ...form, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label>
            <label>承运商<input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} placeholder="物流公司 / 渠道" /></label>
            <label>箱唛标识<input value={form.boxMark} onChange={(event) => setForm({ ...form, boxMark: event.target.value })} placeholder="例如 WYZ-TZKJ-ID03" /></label>
            <label>物流单号 / 转单号<input value={form.trackingNo} onChange={(event) => setForm({ ...form, trackingNo: event.target.value })} placeholder="例如 H26100659" /></label>
            <label>预计发出<input type="date" value={form.etd} onChange={(event) => setForm({ ...form, etd: event.target.value })} /></label>
            <label>预计到仓<input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} /></label>
            <label className="full">物流备注<input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="可记录报关类型、渠道、保险及特殊包装要求" /></label>
          </div>
        </section>

        <section className="sc-form-section sc-carrier-billing-section">
          <div className="sc-billing-heading"><div><b>货代计费确认</b><span>仓库原录、发运修正和货代实测分别保留，便于核对与审计。</span></div><button type="button" onClick={fillCarrierMeasuresFromShipment}>带入发运明细</button></div>
          <div className="sc-billing-compare sc-billing-compare-4">
            <article><small>仓库原录箱数</small><b>{warehouseSummary.packages.toLocaleString("zh-CN")} 箱</b></article>
            <article><small>发运修正箱数</small><b>{shipmentSummary.packages.toLocaleString("zh-CN")} 箱</b></article>
            <article><small>发运估算毛重</small><b>{roundMeasure(shipmentSummary.weightKg).toLocaleString("zh-CN")} kg</b></article>
            <article><small>发运估算体积</small><b>{roundMeasure(shipmentSummary.volumeM3, 3).toLocaleString("zh-CN")} CBM</b></article>
          </div>
          {shipmentSummary.packages > 0 && warehouseSummary.packages > 0 && shipmentSummary.packages !== warehouseSummary.packages ? <div className="sc-billing-warning"><AlertTriangle size={16} /><span>发运箱规已由仓库原录 {warehouseSummary.packages} 箱修正为 {shipmentSummary.packages} 箱，相差 {Math.abs(shipmentSummary.packages - warehouseSummary.packages)} 箱。原始验货记录不会被覆盖，WMS 与发运文件使用修正后的箱规。</span></div> : null}
          {form.carrierPackages > 0 && shipmentSummary.packages > 0 && form.carrierPackages !== shipmentSummary.packages ? <div className="sc-billing-warning"><AlertTriangle size={16} /><span>货代确认 {form.carrierPackages} 箱，与发运明细 {shipmentSummary.packages} 箱相差 {Math.abs(form.carrierPackages - shipmentSummary.packages)} 箱。可以继续，但请确认是否包含木架、托盘、补箱或其他计费包装。</span></div> : null}
          <div className="sc-form-grid sc-form-grid-4 sc-billing-grid">
            <label>计费方式<select value={form.billingMethod} onChange={(event) => setForm({ ...form, billingMethod: event.target.value as ShipmentBillingMethod })}><option value="volume">按体积（CBM）</option><option value="weight">按重量（kg）</option><option value="flat">按票 / 包干</option></select></label>
            <label>货代确认总箱数<input type="number" min="0" step="1" value={form.carrierPackages} onChange={(event) => setForm({ ...form, carrierPackages: Number(event.target.value) })} /></label>
            <label>货代实重 kg<input type="number" min="0" step="0.01" value={form.carrierActualWeightKg} onChange={(event) => setForm({ ...form, carrierActualWeightKg: Number(event.target.value) })} /></label>
            {form.billingMethod === "volume" ? <label>计费方数 CBM<input type="number" min="0" step="0.001" value={form.chargeableVolumeM3} onChange={(event) => setForm({ ...form, chargeableVolumeM3: Number(event.target.value) })} /></label> : null}
            {form.billingMethod === "weight" ? <label>计费重量 kg<input type="number" min="0" step="0.01" value={form.chargeableWeightKg} onChange={(event) => setForm({ ...form, chargeableWeightKg: Number(event.target.value) })} /></label> : null}
            <label>{form.billingMethod === "volume" ? "运费单价 ¥/CBM" : form.billingMethod === "weight" ? "运费单价 ¥/kg" : "整票报价 ¥"}<input type="number" min="0" step="0.01" value={form.billingUnitPriceCny} onChange={(event) => setForm({ ...form, billingUnitPriceCny: Number(event.target.value) })} /></label>
            <label>附加费总额 ¥<input type="number" min="0" step="0.01" value={form.billingExtraFeeCny} onChange={(event) => setForm({ ...form, billingExtraFeeCny: Number(event.target.value) })} /></label>
            <label className="sc-quote-output">报价运费估算<output>¥{quotedFreightCny.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</output></label>
          </div>
          {form.billingMethod === "volume" && form.chargeableVolumeM3 > 0 ? <p className="sc-billing-hint">例如品牌附加费 ¥200/CBM：本票为 ¥{roundMeasure(form.chargeableVolumeM3 * 200).toLocaleString("zh-CN")}，确认后可填入“附加费总额”。最终交货时再登记实际总费用。</p> : null}
        </section>

        <section className="sc-form-section"><div className="sc-create-lines sc-dispatch-lots"><div className="head"><span>批次 / 商品</span><span>可锁定数量</span><span>仓库原录</span><span>本次发运箱规</span></div>{modalLots.map((item) => <div key={item.inspectionLotId}><span className="product"><input type="checkbox" checked={Boolean(item.selected)} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], selected: event.target.checked } }))} /><em><b>{item.line.sku} · {item.lot.lotNo || "未填批号"}</b><small>{item.line.productName} · {item.order.domesticWarehouseName} → {item.order.destinationWarehouseName}</small></em></span><label><input type="number" min="0.01" max={item.quantity} value={item.quantity || 0} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], quantity: Number(event.target.value) } }))} /> {item.line.unit}</label><span><b>{item.lot.cartonCount} 箱 × {item.lot.unitsPerCarton} / 箱</b><small>外箱 {item.lot.cartonLengthCm}×{item.lot.cartonWidthCm}×{item.lot.cartonHeightCm}cm · {item.lot.cartonWeightKg}kg</small></span><span className="sc-dispatch-pack-edit"><label><small>箱数</small><input type="number" min="1" step="1" value={item.shipmentCartonCount} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], shipmentCartonCount: Number(event.target.value) } }))} /></label><i>×</i><label><small>件/箱</small><input type="number" min="1" step="1" value={item.shipmentUnitsPerCarton} onChange={(event) => setChoices((current) => ({ ...current, [item.inspectionLotId]: { ...current[item.inspectionLotId], shipmentUnitsPerCarton: Number(event.target.value) } }))} /></label><em className={item.shipmentCartonCount * item.shipmentUnitsPerCarton === item.quantity ? "is-valid" : "is-error"}>{item.shipmentCartonCount * item.shipmentUnitsPerCarton === item.quantity ? "数量一致" : `计算 ${item.shipmentCartonCount * item.shipmentUnitsPerCarton}`}</em></span></div>)}{!modalLots.length ? <div className="sc-warehouse-empty">暂无已审核入库批次</div> : null}</div></section>
      </div>
      <footer className="sc-modal-foot"><span>创建时执行并发锁库；货代数据可与仓库数据存在差异，但会明确提示并保留审计依据。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal(false)}>取消</button><button className="sc-button sc-button-primary" disabled={busy === "reserve"} onClick={() => void reserve()}>{busy === "reserve" ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}锁定库存并建计划</button></div></footer>
    </section></div> : null}
    {forwarderModal ? <div className="sc-modal-backdrop"><section className="sc-modal sc-medium-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">QUICK FORWARDER SETUP</span><h2>补充本次货代收货点</h2><p>只填写实际交货需要的信息；系统自动生成档案编码，后续可直接复用。</p></div><button className="sc-icon-button" onClick={() => setForwarderModal(false)}><X size={19} /></button></header><div className="sc-editor-scroll"><section className="sc-form-section"><div className="sc-form-grid"><label>货代名称 *<input value={forwarder.name} onChange={(event) => setForwarder({ ...forwarder, name: event.target.value })} placeholder="例如：某某国际物流" /></label><label>收货点名称 *<input value={forwarder.locationName} onChange={(event) => setForwarder({ ...forwarder, locationName: event.target.value })} placeholder="例如：广州白云收货仓" /></label><label>省份<input value={forwarder.province} onChange={(event) => setForwarder({ ...forwarder, province: event.target.value })} /></label><label>城市<input value={forwarder.city} onChange={(event) => setForwarder({ ...forwarder, city: event.target.value })} /></label><label className="full">详细地址 *<input value={forwarder.address} onChange={(event) => setForwarder({ ...forwarder, address: event.target.value })} /></label><label>联系人 *<input value={forwarder.contactName} onChange={(event) => setForwarder({ ...forwarder, contactName: event.target.value })} /></label><label>联系电话 *<input value={forwarder.contactPhone} onChange={(event) => setForwarder({ ...forwarder, contactPhone: event.target.value })} /></label><label className="full">交货要求<input value={forwarder.routingRequirements} onChange={(event) => setForwarder({ ...forwarder, routingRequirements: event.target.value })} placeholder="预约、唛头或进仓要求（可选）" /></label></div></section></div><footer className="sc-modal-foot"><span>保存后自动回到本次出运计划。</span><div><button className="sc-button sc-button-secondary" onClick={() => setForwarderModal(false)}>取消</button><button className="sc-button sc-button-primary" disabled={busy === "forwarder"} onClick={() => void saveForwarder()}>{busy === "forwarder" ? <LoaderCircle className="spin" size={16} /> : <MapPin size={16} />}保存并继续</button></div></footer></section></div> : null}
  </section>;
}

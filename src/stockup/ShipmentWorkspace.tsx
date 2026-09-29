import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CalendarClock, Check, ClipboardCheck, FilePlus2, LoaderCircle, MapPin, PackageOpen, Pencil, Plus, Printer, RotateCcw, Route, ShieldCheck, Ship, Trash2, Truck, Warehouse, X } from "lucide-react";
import QRCode from "qrcode";
import { cancelStockupCollaborationWarehouseOrder, confirmStockupCollaborationReceipt, createStockupCollaborationShipment, createStockupCollaborationWarehouseOrder, dispatchStockupCollaborationShipment, fetchStockupDomesticAvailability, fetchStockupDomesticWarehouses, previewStockupCollaborationWarehouseOrder, updateStockupCollaborationShipment, type DomesticWarehouse, type StockupWarehouseOrderPreview } from "../api";
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

type ShipmentDraftLine = { id?: string; requestId: string; requestNo: string; taskId: string; sku: string; productName: string; unit: string; shippedQty: number; baseUnitCostCny: number; availableQty: number; cartonCount: number; unitsPerCarton: number; cartonLengthCm: number; cartonWidthCm: number; cartonHeightCm: number; cartonWeightKg: number; weightKg: number; volumeM3: number };

export function ShipmentWorkspace({ requests, shipments, canShip, canReceive, loadRequest, onChanged }: Props) {
  const [modal, setModal] = useState<"shipment" | "receipt" | "wms-preview" | "wms-void" | "">("");
  const [selectedRequests, setSelectedRequests] = useState<StockupRequest[]>([]);
  const [selectedShipment, setSelectedShipment] = useState<StockupShipment | null>(null);
  const [editingShipment, setEditingShipment] = useState<StockupShipment | null>(null);
  const [wmsBusyId, setWmsBusyId] = useState("");
  const [wmsPreview, setWmsPreview] = useState<StockupWarehouseOrderPreview | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ originWarehouseId: "", originWarehouse: "", originAddress: "", carrier: "", transportMode: "海运", trackingNo: "", etd: "", eta: "", packages: 0, totalWeightKg: 0, totalVolumeM3: 0, chargeableWeightKg: 0, boxMark: "", note: "" });
  const [shipLines, setShipLines] = useState<ShipmentDraftLine[]>([]);
  const [domesticWarehouses, setDomesticWarehouses] = useState<DomesticWarehouse[]>([]);
  const [receipt, setReceipt] = useState({ arrivedAt: new Date().toISOString().slice(0, 10), shelvedAt: "", wmsInboundNo: "", note: "" });
  const [receiptLines, setReceiptLines] = useState<Array<{ shipmentLineId: string; sku: string; productName: string; expectedQty: number; receivedQty: number; goodQty: number; damagedQty: number; shortageQty: number; pendingQty: number; shelvedQty: number; unit: string; exceptionNote: string }>>([]);

  const readyRequests = requests.filter((request) => ["in_progress", "waiting_shipment", "accepted"].includes(request.status));
  const inTransit = shipments.filter((shipment) => shipment.status === "shipped");
  const drafts = shipments.filter((shipment) => shipment.status === "draft");
  const arrived = shipments.filter((shipment) => shipment.status === "arrived");

  function linesFor(details: StockupRequest[]) {
    return details.flatMap((detail) => (detail.tasks || []).filter((task) => task.completedQty > 0 && task.status !== "terminated").map((task) => {
      const product = detail.lines.find((line) => line.id === task.lineId);
      const sent = (detail.shipments || []).flatMap((shipment) => shipment.lines || []).filter((line) => line.taskId === task.id).reduce((sum, line) => sum + line.shippedQty, 0);
      return { requestId: detail.id, requestNo: detail.requestNo, taskId: task.id, sku: product?.sku || "", productName: product?.productName || "", unit: product?.unit || "件", shippedQty: Math.max(0, task.completedQty - sent), baseUnitCostCny: Number(product?.targetUnitCostCny || 0), availableQty: 0, cartonCount: 0, unitsPerCarton: 0, cartonLengthCm: 0, cartonWidthCm: 0, cartonHeightCm: 0, cartonWeightKg: 0, weightKg: 0, volumeM3: 0 };
    }).filter((line) => line.shippedQty > 0));
  }

  async function toggleRequest(requestId: string, checked: boolean) {
    setError("");
    if (!checked) {
      const next = selectedRequests.filter((item) => item.id !== requestId);
      const nextLines = linesFor(next);
      setSelectedRequests(next); setShipLines(nextLines);
      if (form.originWarehouseId && nextLines.length) await applyAvailability(form.originWarehouseId, nextLines);
      return;
    }
    const detail = await loadRequest(requestId);
    if (selectedRequests.length && selectedRequests[0].destinationWarehouseId !== detail.destinationWarehouseId) { setError("一次发运只能合并相同目的仓的备货需求。"); return; }
    const next = [...selectedRequests, detail];
    const nextLines = linesFor(next);
    setSelectedRequests(next);
    setShipLines(nextLines);
    if (form.originWarehouseId) await applyAvailability(form.originWarehouseId, nextLines);
  }

  async function applyAvailability(warehouseId: string, sourceLines: ShipmentDraftLine[]) {
    try {
      const result = await fetchStockupDomesticAvailability(warehouseId, [...new Set(sourceLines.map((line) => line.sku))]);
      const availability = new Map(result.items.map((item) => [item.sku.toUpperCase(), item]));
      setShipLines(sourceLines.map((line) => {
        const stock = availability.get(line.sku.toUpperCase());
        const profile = stock?.cartonProfiles?.[0];
        return { ...line, availableQty: stock?.availableQty || 0, unitsPerCarton: profile?.unitsPerCarton || line.unitsPerCarton, cartonLengthCm: profile?.cartonLengthCm || line.cartonLengthCm, cartonWidthCm: profile?.cartonWidthCm || line.cartonWidthCm, cartonHeightCm: profile?.cartonHeightCm || line.cartonHeightCm, cartonWeightKg: profile?.cartonWeightKg || line.cartonWeightKg, cartonCount: profile?.unitsPerCarton ? Math.ceil(line.shippedQty / profile.unitsPerCarton) : line.cartonCount };
      }));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "国内库存读取失败"); }
  }

  async function selectOriginWarehouse(warehouseId: string) {
    const warehouse = domesticWarehouses.find((item) => item.id === warehouseId);
    setForm((current) => ({ ...current, originWarehouseId: warehouse?.id || "", originWarehouse: warehouse?.name || "", originAddress: warehouse ? [warehouse.province, warehouse.city, warehouse.address, warehouse.contactName, warehouse.contactPhone].filter(Boolean).join(" ") : "" }));
    if (warehouse && shipLines.length) await applyAvailability(warehouse.id, shipLines);
  }

  async function submitShipmentEdit(shipment: StockupShipment) {
    if (!form.carrier || !form.trackingNo || !form.eta) { setError("请填写承运商、物流单号和预计到仓时间。" ); return; }
    if (shipLines.some((line) => [line.cartonCount, line.unitsPerCarton, line.cartonLengthCm, line.cartonWidthCm, line.cartonHeightCm, line.cartonWeightKg].some((value) => value <= 0))) { setError("请补齐每个产品的箱数、箱规、外箱长宽高和单箱重量。" ); return; }
    setBusy(true); setError("");
    try {
      const computedLines = shipLines.map((line) => ({ ...line, weightKg: line.cartonCount * line.cartonWeightKg, volumeM3: line.cartonCount * line.cartonLengthCm * line.cartonWidthCm * line.cartonHeightCm / 1_000_000 }));
      const totals = { packages: computedLines.reduce((sum, line) => sum + line.cartonCount, 0), totalWeightKg: computedLines.reduce((sum, line) => sum + line.weightKg, 0), totalVolumeM3: computedLines.reduce((sum, line) => sum + line.volumeM3, 0) };
      await updateStockupCollaborationShipment(shipment.id, { ...form, ...totals, version: shipment.version, lines: computedLines });
      setFeedback({ tone: "success", text: `${shipment.shipmentNo} 已更新。` });
      setModal(""); setEditingShipment(null); await onChanged();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "更新发运批次失败"); }
    finally { setBusy(false); }
  }

  async function submitShipment() {
    if (editingShipment) { await submitShipmentEdit(editingShipment); return; }
    if (!selectedRequests.length || !shipLines.some((line) => line.shippedQty > 0)) { setError("请选择有已完成数量的需求。" ); return; }
    if (!form.originWarehouseId) { setError("请选择国内发货仓，系统会据此校验并扣减库存。" ); return; }
    if (!form.carrier || !form.trackingNo || !form.eta) { setError("请填写承运商、物流单号和预计到仓时间。" ); return; }
    if (shipLines.some((line) => line.shippedQty > 0 && [line.cartonCount, line.unitsPerCarton, line.cartonLengthCm, line.cartonWidthCm, line.cartonHeightCm, line.cartonWeightKg].some((value) => value <= 0))) { setError("请补齐每个发运产品的箱数、箱规、外箱长宽高和单箱重量。" ); return; }
    const requestedBySku = new Map<string, number>();
    shipLines.forEach((line) => requestedBySku.set(line.sku, (requestedBySku.get(line.sku) || 0) + line.shippedQty));
    const insufficient = shipLines.find((line) => (requestedBySku.get(line.sku) || 0) > line.availableQty);
    if (insufficient) { setError(`${insufficient.sku} 国内仓可用库存不足，可用 ${insufficient.availableQty}，本次需发 ${(requestedBySku.get(insufficient.sku) || 0)}。`); return; }
    setBusy(true); setError("");
    try {
      const computedLines = shipLines.filter((line) => line.shippedQty > 0).map((line) => ({ ...line, weightKg: line.cartonCount * line.cartonWeightKg, volumeM3: line.cartonCount * line.cartonLengthCm * line.cartonWidthCm * line.cartonHeightCm / 1_000_000 }));
      const totals = { packages: computedLines.reduce((sum, line) => sum + line.cartonCount, 0), totalWeightKg: computedLines.reduce((sum, line) => sum + line.weightKg, 0), totalVolumeM3: computedLines.reduce((sum, line) => sum + line.volumeM3, 0) };
      const created = await createStockupCollaborationShipment({ ...form, ...totals, requestId: selectedRequests[0].id, requestIds: selectedRequests.map((item) => item.id), lines: computedLines });
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

  async function openWarehouseOrderPreview(shipment: StockupShipment) {
    setWmsBusyId(shipment.id); setFeedback(null); setError("");
    try {
      const preview = await previewStockupCollaborationWarehouseOrder(shipment.id);
      setSelectedShipment(shipment); setWmsPreview(preview); setModal("wms-preview");
    } catch (requestError) {
      setFeedback({ tone: "danger", text: requestError instanceof Error ? requestError.message : "仓库单据预览失败" });
    } finally { setWmsBusyId(""); }
  }

  async function createWarehouseOrder(verify: boolean) {
    if (!selectedShipment) return;
    setWmsBusyId(selectedShipment.id); setFeedback(null); setError("");
    try {
      const result = await createStockupCollaborationWarehouseOrder(selectedShipment.id, wmsPreview?.shipmentVersion ?? selectedShipment.version, verify);
      const label = result.documentLabel || warehouseDocumentLabel(selectedShipment);
      setFeedback({ tone: "success", text: result.alreadyCreated ? `${label}已经存在：${result.shipment.wmsOrderNo}` : `${label}${verify ? "提交并审核" : "提交"}成功：${result.shipment.wmsOrderNo}` });
      setModal(""); setWmsPreview(null); setSelectedShipment(null);
      await onChanged();
    } catch (requestError) {
      setFeedback({ tone: "danger", text: requestError instanceof Error ? requestError.message : "创建仓库单据失败" });
      await onChanged();
    } finally { setWmsBusyId(""); }
  }

  function openWarehouseOrderVoid(shipment: StockupShipment) {
    setSelectedShipment(shipment); setError(""); setModal("wms-void");
  }

  async function voidWarehouseOrder() {
    if (!selectedShipment) return;
    setWmsBusyId(selectedShipment.id); setError("");
    try {
      const result = await cancelStockupCollaborationWarehouseOrder(selectedShipment.id);
      const label = result.documentLabel || warehouseDocumentLabel(selectedShipment);
      setFeedback({ tone: "success", text: `${label}${result.alreadyCancelled ? "已在仓库系统中作废" : "撤回并作废成功"}：${result.shipment.wmsOrderNo}` });
      setModal(""); setSelectedShipment(null); await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "作废仓库单据失败");
      await onChanged();
    } finally { setWmsBusyId(""); }
  }

  async function openShipmentEditor(shipment?: StockupShipment) {
    if (shipment) {
      setError(""); setEditingShipment(shipment); setSelectedRequests([]);
      setForm({ originWarehouseId: shipment.originWarehouseId, originWarehouse: shipment.originWarehouse, originAddress: shipment.originAddress, carrier: shipment.carrier, transportMode: shipment.transportMode, trackingNo: shipment.trackingNo, etd: shipment.etd, eta: shipment.eta, packages: shipment.packages, totalWeightKg: shipment.totalWeightKg, totalVolumeM3: shipment.totalVolumeM3, chargeableWeightKg: shipment.chargeableWeightKg, boxMark: shipment.boxMark, note: shipment.note });
      setShipLines((shipment.lines || []).map((line) => ({ id: line.id, requestId: line.requestId || shipment.requestId, requestNo: shipment.requestNos?.[0] || "", taskId: line.taskId, sku: line.sku, productName: line.productName, unit: line.unit, shippedQty: line.shippedQty, baseUnitCostCny: line.baseUnitCostCny, availableQty: line.shippedQty, cartonCount: line.cartonCount, unitsPerCarton: line.unitsPerCarton, cartonLengthCm: line.cartonLengthCm, cartonWidthCm: line.cartonWidthCm, cartonHeightCm: line.cartonHeightCm, cartonWeightKg: line.cartonWeightKg, weightKg: line.weightKg, volumeM3: line.volumeM3 })));
      setModal("shipment");
      return;
    }
    setEditingShipment(null);
    setError(""); setSelectedRequests([]); setShipLines([]); setModal("shipment");
    try {
      const result = await fetchStockupDomesticWarehouses();
      setDomesticWarehouses((result.warehouses || []).filter((warehouse) => warehouse.status === "active"));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "国内仓列表读取失败"); }
  }

  return <>
    <div className="sc-logistics-summary"><article><Route size={21} /><div><small>待登记发运</small><b>{readyRequests.length}</b></div></article><article><Ship size={21} /><div><small>在途批次</small><b>{inTransit.length}</b></div></article><article><PackageOpen size={21} /><div><small>已到仓批次</small><b>{arrived.length}</b></div></article><article><CalendarClock size={21} /><div><small>7天内预计到仓</small><b>{inTransit.filter((item) => item.eta && item.eta <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)).length}</b></div></article></div>
    <section className="sc-panel"><div className="sc-panel-head"><div><span className="sc-eyebrow">LOGISTICS & RECEIVING</span><h3>物流与到仓</h3><p>可合并多个同目的仓需求，从国内仓库存直接发运。</p></div>{canShip ? <button className="sc-button sc-button-primary" onClick={() => void openShipmentEditor()}><Plus size={17} />登记发运</button> : null}</div>
      {feedback ? <div className={`sc-shipment-feedback is-${feedback.tone}`}>{feedback.tone === "danger" ? <AlertTriangle size={17} /> : <Check size={17} />}<span>{feedback.text}</span><button type="button" onClick={() => setFeedback(null)}><X size={15} /></button></div> : null}
      <div className="sc-shipment-board">
        <ShipmentLane title="待发运" subtitle="已登记，等待国内仓发出" count={drafts.length} icon={<Route size={18} />} tone="draft">
          {drafts.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} onEdit={canShip ? () => void openShipmentEditor(shipment) : undefined} />)}
          {!drafts.length ? <EmptyLane text="暂无待发运批次" /> : null}
        </ShipmentLane>
        <ShipmentLane title="在途中" subtitle="跟踪物流、创建仓库单并确认到仓" count={inTransit.length} icon={<Truck size={18} />} tone="transit">
          {inTransit.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} onEdit={canShip ? () => void openShipmentEditor(shipment) : undefined} onCreateWarehouseOrder={canShip ? () => void openWarehouseOrderPreview(shipment) : undefined} onVoidWarehouseOrder={canShip ? () => openWarehouseOrderVoid(shipment) : undefined} wmsBusy={wmsBusyId === shipment.id} action={canReceive ? <button onClick={() => openReceipt(shipment)}><Check size={15} />确认到仓</button> : undefined} />)}
          {!inTransit.length ? <EmptyLane text="暂无在途批次" /> : null}
        </ShipmentLane>
        <ShipmentLane title="已到仓" subtitle="已完成收货，可继续核对成本" count={arrived.length} icon={<PackageOpen size={18} />} tone="arrived">
          {arrived.map((shipment) => <ShipmentCard key={shipment.id} shipment={shipment} />)}
          {!arrived.length ? <EmptyLane text="暂无已到仓批次" /> : null}
        </ShipmentLane>
      </div>
    </section>

    {modal === "shipment" ? <div className={`sc-modal-backdrop${editingShipment ? " is-editing-shipment" : ""}`}><div className="sc-modal sc-wide-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">DOMESTIC STOCK SHIPMENT</span><h2>{editingShipment ? `编辑发运 ${editingShipment.shipmentNo}` : "从国内仓合并发运"}</h2><p>{editingShipment ? "可修改物流、到仓和装箱信息；已扣减库存的仓库、产品和数量保持锁定。" : "可勾选多个相同目的仓的需求，确认发运时自动生成国内仓出库流水。"}</p></div><button className="sc-icon-button" onClick={() => { setModal(""); setEditingShipment(null); }}><X size={20} /></button></header><div className="sc-editor-scroll">{error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}
      {!editingShipment ? <div className="sc-request-checklist"><b>选择待发运需求</b>{readyRequests.map((request) => { const checked = selectedRequests.some((item) => item.id === request.id); const disabled = !checked && selectedRequests.length > 0 && selectedRequests[0].destinationWarehouseId !== request.destinationWarehouseId; return <label className={disabled ? "is-disabled" : ""} key={request.id}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => void toggleRequest(request.id, event.target.checked)} /><span><strong>{request.requestNo}</strong><small>{request.destinationWarehouseName} · {request.lines.map((line) => line.sku).join("、")}</small></span></label>; })}</div> : <div className="sc-edit-lock-note"><Warehouse size={17} /><span>国内发货仓、SKU 和发货数量已经形成库存流水，编辑时不可变更。</span></div>}
      <div className="sc-form-grid sc-form-grid-4"><label>国内发货仓<select value={form.originWarehouseId} onChange={(event) => void selectOriginWarehouse(event.target.value)}><option value="">请选择有库存的国内仓</option>{domesticWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>运输方式<select value={form.transportMode} onChange={(event) => setForm({ ...form, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label><label>承运商<input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} /></label><label>物流单号 / 提单号<input value={form.trackingNo} onChange={(event) => setForm({ ...form, trackingNo: event.target.value })} /></label><label>计划发运日 ETD<input type="date" value={form.etd} onChange={(event) => setForm({ ...form, etd: event.target.value })} /></label><label>预计到仓日 ETA<input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} /></label><label className="full">发货地址（引用仓库档案）<input value={form.originAddress} readOnly placeholder="选择国内仓后自动带入" /></label><label className="full">箱唛内容<input value={form.boxMark} onChange={(event) => setForm({ ...form, boxMark: event.target.value })} placeholder="例如：项目、目的仓、PO号或客户箱唛要求" /></label></div>
      <div className="sc-pack-table"><div className="head"><span>需求 / 产品</span><span>发货数量 / 库存</span><span>箱数</span><span>箱规</span><span>外箱尺寸 cm</span><span>单箱 kg</span></div>{shipLines.map((line, index) => { const update = (patch: Partial<ShipmentDraftLine>) => setShipLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)); return <div key={line.taskId}><span><b>{line.sku}</b><small>{line.productName}</small><small>{line.requestNo}</small></span><span><input type="number" min="0" value={line.shippedQty} onChange={(event) => update({ shippedQty: Number(event.target.value) })} /><small className={line.availableQty < line.shippedQty ? "danger" : ""}>可用 {line.availableQty}</small></span><span><input type="number" min="0" value={line.cartonCount} onChange={(event) => update({ cartonCount: Number(event.target.value) })} /></span><span><input type="number" min="0" value={line.unitsPerCarton} onChange={(event) => update({ unitsPerCarton: Number(event.target.value) })} /><small>件/箱</small></span><span className="dims"><input type="number" min="0" value={line.cartonLengthCm} onChange={(event) => update({ cartonLengthCm: Number(event.target.value) })} /><i>×</i><input type="number" min="0" value={line.cartonWidthCm} onChange={(event) => update({ cartonWidthCm: Number(event.target.value) })} /><i>×</i><input type="number" min="0" value={line.cartonHeightCm} onChange={(event) => update({ cartonHeightCm: Number(event.target.value) })} /></span><span><input type="number" min="0" step="0.01" value={line.cartonWeightKg} onChange={(event) => update({ cartonWeightKg: Number(event.target.value) })} /></span></div>; })}</div>
    </div><footer className="sc-modal-foot"><span><Warehouse size={16} />{editingShipment ? "保存后更新本批次信息，不会再次扣减库存。" : "确认后扣减国内仓库存、生成出库流水，并进入在途状态。"}</span><div><button className="sc-button sc-button-secondary" onClick={() => { setModal(""); setEditingShipment(null); }}>取消</button><button className="sc-button sc-button-primary" disabled={busy} onClick={submitShipment}>{editingShipment ? <Pencil size={17} /> : <Truck size={17} />}{editingShipment ? "保存修改" : "确认出库并发运"}</button></div></footer></div></div> : null}

    {modal === "receipt" && selectedShipment ? <div className="sc-modal-backdrop"><div className="sc-modal sc-wide-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">WAREHOUSE RECEIPT</span><h2>确认到仓</h2><p>{selectedShipment.shipmentNo} · {selectedShipment.destinationWarehouseName}</p></div><button className="sc-icon-button" onClick={() => setModal("")}><X size={20} /></button></header><div className="sc-editor-scroll">{error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}<div className="sc-form-grid sc-form-grid-4"><label>实际到仓日期<input type="date" value={receipt.arrivedAt} onChange={(event) => setReceipt({ ...receipt, arrivedAt: event.target.value })} /></label><label>上架日期<input type="date" value={receipt.shelvedAt} onChange={(event) => setReceipt({ ...receipt, shelvedAt: event.target.value })} /></label><label>WMS 入库单号<input value={receipt.wmsInboundNo} onChange={(event) => setReceipt({ ...receipt, wmsInboundNo: event.target.value })} /></label><label>备注<input value={receipt.note} onChange={(event) => setReceipt({ ...receipt, note: event.target.value })} /></label></div><div className="sc-receipt-table"><div className="head"><span>产品</span><span>应到</span><span>实收</span><span>良品</span><span>破损</span><span>短少</span><span>待处理</span><span>上架</span></div>{receiptLines.map((line, index) => <div key={line.shipmentLineId}><span><b>{line.sku}</b><small>{line.productName}</small></span>{["expectedQty", "receivedQty", "goodQty", "damagedQty", "shortageQty", "pendingQty", "shelvedQty"].map((field) => <span key={field}><input type="number" min="0" value={Number(line[field as keyof typeof line])} onChange={(event) => updateReceiptLine(index, field, Number(event.target.value))} /></span>)}</div>)}</div></div><footer className="sc-modal-foot"><span>短少、破损或待处理数量会自动创建收货异常。</span><div><button className="sc-button sc-button-secondary" onClick={() => setModal("")}>取消</button><button className="sc-button sc-button-primary" disabled={busy} onClick={submitReceipt}><Check size={17} />确认收货</button></div></footer></div></div> : null}

    {modal === "wms-preview" && selectedShipment && wmsPreview ? <div className="sc-modal-backdrop"><div className="sc-modal sc-wms-preview-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">WMS DOCUMENT PREVIEW</span><h2>{wmsPreview.documentLabel}提交预览</h2><p>{wmsPreview.shipmentNo} · {wmsPreview.warehouseName}</p></div><button className="sc-icon-button" disabled={Boolean(wmsBusyId)} onClick={() => { setModal(""); setWmsPreview(null); }}><X size={20} /></button></header><div className="sc-editor-scroll sc-wms-preview-body"><div className="sc-wms-preview-check"><ShieldCheck size={22} /><div><b>装箱数据校验通过</b><span>实际提交将按 {wmsPreview.totalBoxes} 个独立箱号写入 WMS，不会把总件数合并到一个箱子。</span></div></div><div className="sc-wms-preview-facts"><article><Warehouse size={18} /><small>目的仓</small><b>{wmsPreview.warehouseName}</b><span>{wmsPreview.warehouseCode}</span></article><article><Boxes size={18} /><small>总箱数</small><b>{wmsPreview.totalBoxes} 箱</b><span>{wmsPreview.itemCount} 条逐箱明细</span></article><article><PackageOpen size={18} /><small>总件数</small><b>{wmsPreview.totalQuantity.toLocaleString("zh-CN")}</b><span>与发运数量一致</span></article><article><CalendarClock size={18} /><small>预计到仓</small><b>{formatStockupDate(wmsPreview.eta)}</b><span>{wmsPreview.carrier || "未填写承运商"}</span></article></div><div className="sc-wms-preview-lines"><div className="head"><span>产品 / SKU</span><span>总数量</span><span>箱数</span><span>每箱数量</span><span>校验</span></div>{wmsPreview.lines.map((line) => <div key={line.sku}><span className="product">{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <i><PackageOpen size={18} /></i>}<em><b>{line.sku}</b><small>{line.productName}</small></em></span><span><b>{line.quantity.toLocaleString("zh-CN")}</b></span><span><b>{line.cartonCount}</b> 箱</span><span><b>{line.unitsPerCarton}</b> / 箱</span><span className="valid"><Check size={15} />{line.cartonCount * line.unitsPerCarton === line.quantity ? "一致" : "异常"}</span></div>)}</div><div className="sc-wms-submit-note"><ClipboardCheck size={18} /><div><b>请选择提交方式</b><span>“提交入库单”会保留在新建状态；“提交并审核”将直接进入仓库后续流程，审核后可能无法直接撤回。</span></div></div></div><footer className="sc-modal-foot"><span><ShieldCheck size={16} />提交前最后确认：{wmsPreview.totalBoxes} 箱 × 逐箱明细，共 {wmsPreview.totalQuantity.toLocaleString("zh-CN")} 件。</span><div><button className="sc-button sc-button-secondary" disabled={Boolean(wmsBusyId)} onClick={() => setModal("")}>返回修改</button><button className="sc-button sc-button-secondary sc-submit-draft" disabled={Boolean(wmsBusyId)} onClick={() => void createWarehouseOrder(false)}>{wmsBusyId ? <LoaderCircle className="is-spinning" size={17} /> : <FilePlus2 size={17} />}提交{wmsPreview.documentLabel}</button>{wmsPreview.canVerify ? <button className="sc-button sc-button-primary" disabled={Boolean(wmsBusyId)} onClick={() => void createWarehouseOrder(true)}>{wmsBusyId ? <LoaderCircle className="is-spinning" size={17} /> : <ShieldCheck size={17} />}提交并审核{wmsPreview.documentLabel}</button> : null}</div></footer></div></div> : null}

    {modal === "wms-void" && selectedShipment ? <div className="sc-modal-backdrop"><div className="sc-modal sc-wms-void-modal"><header className="sc-modal-head"><div><span className="sc-eyebrow">VOID WMS DOCUMENT</span><h2>撤回并作废{warehouseDocumentLabel(selectedShipment)}</h2><p>{selectedShipment.shipmentNo} · {selectedShipment.destinationWarehouseName}</p></div><button className="sc-icon-button" disabled={Boolean(wmsBusyId)} onClick={() => setModal("")}><X size={20} /></button></header><div className="sc-editor-scroll sc-wms-void-body">{error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}<div className="sc-wms-void-warning"><Trash2 size={24} /><div><b>将同步作废仓库系统中的原单</b><span>入库单号：{selectedShipment.wmsOrderNo}</span><p>系统会先核对入库单参考号和当前状态；只有仓库系统确认作废后，中台才会更新为“已作废”。作废后可修改装箱资料并重新创建。</p></div></div></div><footer className="sc-modal-foot"><span><AlertTriangle size={16} />已审核并进入后续处理的单据可能无法直接撤回。</span><div><button className="sc-button sc-button-secondary" disabled={Boolean(wmsBusyId)} onClick={() => setModal("")}>暂不作废</button><button className="sc-button sc-button-danger" disabled={Boolean(wmsBusyId)} onClick={() => void voidWarehouseOrder()}>{wmsBusyId ? <LoaderCircle className="is-spinning" size={17} /> : <Trash2 size={17} />}确认撤回并作废</button></div></footer></div></div> : null}
  </>;
}

function ShipmentCard({ shipment, action, onEdit, onCreateWarehouseOrder, onVoidWarehouseOrder, wmsBusy = false }: { shipment: StockupShipment; action?: React.ReactNode; onEdit?: () => void; onCreateWarehouseOrder?: () => void; onVoidWarehouseOrder?: () => void; wmsBusy?: boolean }) {
  const documentLabel = warehouseDocumentLabel(shipment);
  const needsManualCheck = shipment.wmsPushStatus === "needs_manual_check";
  const voided = shipment.wmsPushStatus === "voided";
  const created = !voided && (shipment.wmsPushStatus === "pushed" || Boolean(shipment.wmsOrderNo));
  return <article className="sc-shipment-card">
    <div className="sc-shipment-identity"><span className="sc-route-icon">{shipment.transportMode === "海运" ? <Ship size={18} /> : <Truck size={18} />}</span><div><b>{shipment.shipmentNo}</b><small>{shipment.carrier || "待填写承运商"} · {shipment.transportMode || "运输方式待定"}</small></div></div>
    <dl className="sc-shipment-facts"><div><dt>目的仓</dt><dd><MapPin size={13} />{shipment.destinationWarehouseName}</dd></div><div><dt>预计到仓</dt><dd>{formatStockupDate(shipment.eta)}</dd></div><div><dt>物流单号</dt><dd>{shipment.trackingNo || "—"}</dd></div><div><dt>来源需求</dt><dd title={shipment.requestNos?.join("、")}>{shipment.requestNos?.join("、") || "1 个需求"}</dd></div></dl>
    <div className="sc-shipment-state-column">
      {created ? <div className="sc-wms-state is-success"><Check size={14} /><span>{documentLabel}已创建</span><b>{shipment.wmsOrderNo}</b></div> : voided ? <div className="sc-wms-state is-voided"><RotateCcw size={14} /><span>{documentLabel}已作废</span><b>{shipment.wmsOrderNo}</b></div> : shipment.wmsPushStatus === "failed" ? <div className="sc-wms-state is-danger"><AlertTriangle size={14} /><span>{documentLabel}创建失败</span><small title={shipment.wmsPushError}>{shipment.wmsPushError}</small></div> : needsManualCheck ? <div className="sc-wms-state is-warning"><AlertTriangle size={14} /><span>建单结果待人工核对</span><small title={shipment.wmsPushError}>{shipment.wmsPushError}</small></div> : onCreateWarehouseOrder ? <div className="sc-wms-state is-neutral"><FilePlus2 size={14} /><span>待创建{documentLabel}</span><small>先预览装箱数据，再提交到 WMS</small></div> : <div className="sc-wms-state is-neutral"><Check size={14} /><span>{action ? "等待后续处理" : "当前阶段已完成"}</span></div>}
    </div>
    <footer className="sc-shipment-card-actions"><div className="sc-shipment-secondary-actions">{onEdit ? <button type="button" onClick={onEdit}><Pencil size={14} />编辑</button> : null}<button type="button" onClick={() => void printShipmentDocument(shipment, "packing")}><Printer size={14} />装箱单</button><button type="button" onClick={() => void printShipmentDocument(shipment, "mark")}><Printer size={14} />箱唛</button>{created && documentLabel === "入库单" && onVoidWarehouseOrder ? <button type="button" className="is-void" disabled={wmsBusy} onClick={onVoidWarehouseOrder}><Trash2 size={14} />撤回/作废</button> : null}</div><div className="sc-shipment-primary-actions">{onCreateWarehouseOrder && !created ? <button type="button" className="is-wms" disabled={wmsBusy || needsManualCheck || shipment.wmsPushStatus === "pushing"} onClick={onCreateWarehouseOrder}>{wmsBusy || shipment.wmsPushStatus === "pushing" ? <LoaderCircle className="is-spinning" size={14} /> : voided ? <RotateCcw size={14} /> : <FilePlus2 size={14} />}{wmsBusy || shipment.wmsPushStatus === "pushing" ? "读取中" : voided ? `重新创建${documentLabel}` : `预览并创建${documentLabel}`}</button> : null}{action}</div></footer>
  </article>;
}

function ShipmentLane({ title, subtitle, count, icon, tone, children }: { title: string; subtitle: string; count: number; icon: React.ReactNode; tone: "draft" | "transit" | "arrived"; children: React.ReactNode }) {
  return <section className={`sc-shipment-lane is-${tone}`}><header className="sc-shipment-lane-head"><span>{icon}</span><div><h4>{title}<em>{count}</em></h4><small>{subtitle}</small></div></header><div className="sc-shipment-list">{children}</div></section>;
}

function warehouseDocumentLabel(shipment: StockupShipment) {
  if (shipment.wmsDocumentType === "inbound" || /俄罗斯|Russia|RU/i.test(shipment.destinationCountry)) return "入库单";
  return "备货单";
}

function EmptyLane({ text }: { text: string }) { return <div className="sc-lane-empty"><Route size={23} /><span>{text}</span></div>; }

function html(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character] || character));
}

function printableImageUrl(value: string) {
  if (!value) return "";
  try {
    return new URL(value, window.location.origin).href;
  } catch {
    return "";
  }
}

async function printShipmentDocument(shipment: StockupShipment, kind: "packing" | "mark") {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.opener = null;
  const detailUrl = `${window.location.origin}/?shipment=${encodeURIComponent(shipment.id)}#stockup-logistics`;
  const qrCode = await QRCode.toDataURL(detailUrl, { width: 240, margin: 1, errorCorrectionLevel: "M" });
  const lines = shipment.lines || [];
  const totalCartons = Math.max(1, Math.round(shipment.packages || lines.reduce((sum, line) => sum + line.cartonCount, 0)));
  const tableRows = lines.map((line, index) => {
    const imageUrl = printableImageUrl(line.imageUrl);
    const productImage = imageUrl
      ? `<img class="product-image" src="${html(imageUrl)}" alt="${html(line.productName)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="product-placeholder">无图</span>`
      : `<span class="product-placeholder" style="display:flex">无图</span>`;
    return `<tr><td>${index + 1}</td><td><div class="product-cell"><span class="product-visual">${productImage}</span><span><b>${html(line.sku)}</b><br><small>${html(line.productName)}</small></span></div></td><td>${html(line.shippedQty)} ${html(line.unit)}</td><td>${html(line.cartonCount)}</td><td>${html(line.unitsPerCarton)} ${html(line.unit)}/箱</td><td>${html(line.cartonLengthCm)} × ${html(line.cartonWidthCm)} × ${html(line.cartonHeightCm)} cm</td><td>${html(line.cartonWeightKg)} kg</td><td>${html(line.volumeM3.toFixed(3))} m³</td></tr>`;
  }).join("");
  const packing = `<section class="packing"><header><div><span>TONGZHOU SUPPLY CHAIN</span><h1>装 箱 单 / PACKING LIST</h1><p>${html(shipment.shipmentNo)}</p></div><img src="${qrCode}" alt="二维码"></header><dl><div><dt>发货仓 / 地址</dt><dd>${html(shipment.originWarehouse)}<br>${html(shipment.originAddress)}</dd></div><div><dt>目的仓</dt><dd>${html(shipment.destinationWarehouseName)} · ${html(shipment.destinationCountry)}</dd></div><div><dt>关联需求</dt><dd>${html(shipment.requestNos?.join("、") || shipment.requestId)}</dd></div><div><dt>物流信息</dt><dd>${html(shipment.carrier)} · ${html(shipment.transportMode)} · ${html(shipment.trackingNo)}</dd></div></dl><table><thead><tr><th>#</th><th>图片 / SKU / 产品名称</th><th>数量</th><th>箱数</th><th>箱规</th><th>箱子尺寸</th><th>单箱重量</th><th>体积</th></tr></thead><tbody>${tableRows}</tbody><tfoot><tr><td colspan="3">汇总</td><td>${totalCartons} 箱</td><td colspan="2"></td><td>${html(shipment.totalWeightKg.toFixed(2))} kg</td><td>${html(shipment.totalVolumeM3.toFixed(3))} m³</td></tr></tfoot></table><aside><b>箱唛：</b>${html(shipment.boxMark || "无特殊箱唛要求")}</aside><footer>生成时间：${html(new Date().toLocaleString("zh-CN"))}　扫码可进入同舟中台查看发运数据</footer></section>`;
  const marks = Array.from({ length: totalCartons }, (_, index) => `<section class="mark"><div class="mark-head"><b>TONGZHOU</b><span>${index + 1} / ${totalCartons}</span></div><h1>${html(shipment.boxMark || shipment.destinationWarehouseName)}</h1><dl><div><dt>发运单</dt><dd>${html(shipment.shipmentNo)}</dd></div><div><dt>目的仓</dt><dd>${html(shipment.destinationWarehouseName)}</dd></div><div><dt>SKU</dt><dd>${html([...new Set(lines.map((line) => line.sku))].join(" / "))}</dd></div><div><dt>物流单号</dt><dd>${html(shipment.trackingNo || "待填写")}</dd></div></dl><img src="${qrCode}" alt="二维码"><small>扫描查看发运数据</small></section>`).join("");
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${kind === "packing" ? "装箱单" : "箱唛"}-${html(shipment.shipmentNo)}</title><style>${kind === "mark" ? "@page{size:100mm 100mm;margin:0}" : "@page{size:A4 landscape;margin:10mm}"}*{box-sizing:border-box}body{margin:0;color:#102b4e;font-family:'Microsoft YaHei','Noto Sans SC',Arial,sans-serif}.packing{padding:4mm}.packing header{display:flex;justify-content:space-between;border-bottom:3px solid #0b4e91;padding-bottom:4mm}.packing header span{font-size:10px;letter-spacing:2px;color:#f05a16;font-weight:800}.packing h1{margin:2mm 0;font-size:24px}.packing header p{margin:0}.packing header img{width:25mm;height:25mm}.packing dl{display:grid;grid-template-columns:1fr 1fr;gap:2mm 8mm;margin:5mm 0}.packing dl div{display:grid;grid-template-columns:30mm 1fr}.packing dt{color:#667b95}.packing dd{margin:0;font-weight:700}.packing table{width:100%;border-collapse:collapse;font-size:10px}.packing th,.packing td{border:1px solid #99abc0;padding:2mm;text-align:left;vertical-align:middle}.packing th{background:#e8f1fb}.packing tfoot{font-weight:800;background:#fff3ea}.product-cell{display:flex;align-items:center;gap:2.5mm;min-width:48mm}.product-visual{width:15mm;height:15mm;flex:0 0 15mm}.product-image,.product-placeholder{width:15mm;height:15mm;border:1px solid #d5dfeb;border-radius:2mm;object-fit:contain;background:#fff}.product-placeholder{display:none;align-items:center;justify-content:center;color:#8494a8;font-size:8px}.packing aside{margin-top:4mm;padding:3mm;background:#f4f7fb;border-left:3px solid #f05a16}.packing footer{margin-top:4mm;color:#73849a;font-size:9px}.mark{width:100mm;height:100mm;padding:7mm;page-break-after:always;border:2mm solid #0b3c76;display:flex;flex-direction:column;position:relative}.mark:last-child{page-break-after:auto}.mark-head{display:flex;justify-content:space-between;align-items:center}.mark-head b{font-size:16px;color:#f05a16;letter-spacing:2px}.mark-head span{font-size:20px;font-weight:900}.mark h1{font-size:25px;line-height:1.2;margin:7mm 0 5mm;border-bottom:1px solid #94a9c2;padding-bottom:4mm}.mark dl{margin:0;display:grid;gap:2mm}.mark dl div{display:grid;grid-template-columns:22mm 1fr}.mark dt{font-size:10px;color:#667a94}.mark dd{margin:0;font-size:12px;font-weight:800;word-break:break-all}.mark img{position:absolute;width:26mm;height:26mm;right:6mm;bottom:9mm}.mark small{position:absolute;right:7mm;bottom:5mm;font-size:8px}@media print{button{display:none}}</style></head><body>${kind === "packing" ? packing : marks}<script>window.onload=()=>{let printed=false;const printOnce=()=>{if(!printed){printed=true;window.print()}};const images=[...document.images];Promise.all(images.map((image)=>image.complete?Promise.resolve():new Promise((resolve)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true})}))).then(()=>setTimeout(printOnce,120));setTimeout(printOnce,5000)}<\/script></body></html>`);
  printWindow.document.close();
}

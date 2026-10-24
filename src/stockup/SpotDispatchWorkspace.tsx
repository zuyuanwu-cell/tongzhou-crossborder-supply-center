import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, Check, Download, FileText, LoaderCircle, LockKeyhole, MapPin, PackageCheck, Plus, RefreshCw, Route, Send, Ship, Truck, X } from "lucide-react";
import {
  cancelStockupReservedShipment,
  confirmStockupCollaborationReceipt,
  createStockupCollaborationWarehouseOrder,
  createStockupForwarder,
  createStockupReservedShipment,
  createStockupRouteShipment,
  downloadStockupDispatchDocument,
  fetchStockupDispatchDocuments,
  fetchStockupForwarders,
  fetchStockupWarehouseDashboard,
  generateStockupDispatchDocuments,
  handoverStockupShipment,
  issueStockupDispatchInstruction,
  previewStockupCollaborationWarehouseOrder,
} from "../api";
import type { StockupDispatchDocument, StockupForwarder, StockupRequest, StockupShipment, StockupWarehouseWorkOrder } from "./types";
import { formatStockupDate, stockupRequestStatusLabels } from "./status";

type Props = {
  shipments: StockupShipment[];
  requests: StockupRequest[];
  canShip: boolean;
  canSplit: boolean;
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

export type RoutePackagingGroup = {
  id: string;
  kind: "standard" | "remainder";
  cartonCount: number;
  unitsPerCarton: number;
  cartonLengthCm: number;
  cartonWidthCm: number;
  cartonHeightCm: number;
  cartonWeightKg: number;
};

type RouteChoice = {
  allocationId: string;
  sku: string;
  productName: string;
  imageUrl: string;
  quantity: number;
  unit: string;
  selected: boolean;
  packagingGroups: RoutePackagingGroup[];
};

let routePackagingSequence = 0;

function newRoutePackagingGroup(kind: RoutePackagingGroup["kind"], overrides: Partial<RoutePackagingGroup> = {}): RoutePackagingGroup {
  routePackagingSequence += 1;
  return {
    id: `route-package-${Date.now().toString(36)}-${routePackagingSequence.toString(36)}`,
    kind,
    cartonCount: kind === "remainder" ? 1 : 0,
    unitsPerCarton: 0,
    cartonLengthCm: 0,
    cartonWidthCm: 0,
    cartonHeightCm: 0,
    cartonWeightKg: 0,
    ...overrides,
  };
}

function activeRoutePackagingGroups(groups: RoutePackagingGroup[]) {
  return groups.filter((group) => Number(group.cartonCount) > 0 && Number(group.unitsPerCarton) > 0);
}

function routePackedQuantity(groups: RoutePackagingGroup[]) {
  return activeRoutePackagingGroups(groups).reduce((sum, group) => sum + Number(group.cartonCount) * Number(group.unitsPerCarton), 0);
}

function routePackagingMeasures(groups: RoutePackagingGroup[]) {
  return activeRoutePackagingGroups(groups).reduce((summary, group) => ({
    packages: summary.packages + Number(group.cartonCount),
    weightKg: summary.weightKg + Number(group.cartonCount) * Number(group.cartonWeightKg || 0),
    volumeM3: summary.volumeM3 + Number(group.cartonCount) * Number(group.cartonLengthCm || 0) * Number(group.cartonWidthCm || 0) * Number(group.cartonHeightCm || 0) / 1_000_000,
  }), { packages: 0, weightKg: 0, volumeM3: 0 });
}

function routePackagingIsComplete(item: RouteChoice) {
  const groups = activeRoutePackagingGroups(item.packagingGroups);
  return groups.length > 0
    && routePackedQuantity(groups) === item.quantity
    && groups.every((group) => Number.isInteger(group.cartonCount)
      && Number.isInteger(group.unitsPerCarton)
      && [group.cartonLengthCm, group.cartonWidthCm, group.cartonHeightCm, group.cartonWeightKg].every((value) => Number(value) > 0));
}

function RoutePackagingCard({ item, onChange }: { item: RouteChoice; onChange: (next: RouteChoice) => void }) {
  const packedQty = routePackedQuantity(item.packagingGroups);
  const measures = routePackagingMeasures(item.packagingGroups);
  const complete = routePackagingIsComplete(item);
  const standardGroup = item.packagingGroups.find((group) => group.kind === "standard") || item.packagingGroups[0];

  function updateGroup(groupId: string, patch: Partial<RoutePackagingGroup>) {
    onChange({ ...item, packagingGroups: item.packagingGroups.map((group) => group.id === groupId ? { ...group, ...patch } : group) });
  }

  function splitAutomatically() {
    const units = Math.floor(Number(standardGroup?.unitsPerCarton || 0));
    if (units <= 0) return;
    const fullCartons = Math.floor(item.quantity / units);
    const remainder = item.quantity - fullCartons * units;
    const nextStandard = { ...standardGroup, kind: "standard" as const, cartonCount: fullCartons, unitsPerCarton: units };
    const previousRemainder = item.packagingGroups.find((group) => group.kind === "remainder");
    const nextGroups: RoutePackagingGroup[] = [nextStandard];
    if (remainder > 0) nextGroups.push(newRoutePackagingGroup("remainder", {
      ...(previousRemainder ? {
        cartonLengthCm: previousRemainder.cartonLengthCm,
        cartonWidthCm: previousRemainder.cartonWidthCm,
        cartonHeightCm: previousRemainder.cartonHeightCm,
        cartonWeightKg: previousRemainder.cartonWeightKg,
      } : {}),
      cartonCount: 1,
      unitsPerCarton: remainder,
    }));
    onChange({ ...item, packagingGroups: nextGroups });
  }

  function addRemainderGroup() {
    const remaining = Math.max(0, item.quantity - packedQty);
    onChange({ ...item, packagingGroups: [...item.packagingGroups, newRoutePackagingGroup("remainder", { unitsPerCarton: remaining })] });
  }

  return <article className={`sc-route-packaging-card${item.selected ? " is-selected" : ""}`}>
    <header className="sc-route-packaging-head">
      <label className="sc-route-toggle"><input type="checkbox" checked={item.selected} onChange={(event) => onChange({ ...item, selected: event.target.checked })} /><span /></label>
      <div className="sc-route-product">
        {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="sc-route-product-placeholder"><Boxes size={20} /></span>}
        <div><b>{item.productName}</b><small>{item.sku} · 已锁定 {item.quantity.toLocaleString("zh-CN")} {item.unit}</small></div>
      </div>
      <div className={`sc-route-packaging-result ${complete ? "is-valid" : "is-pending"}`}><small>已装 / 应装</small><b>{packedQty.toLocaleString("zh-CN")} / {item.quantity.toLocaleString("zh-CN")} {item.unit}</b><span>{measures.packages} 箱 · {roundMeasure(measures.volumeM3, 3)} CBM</span></div>
    </header>
    <div className="sc-route-packaging-guide"><div><b>先填标准箱，再处理尾数</b><span>填写“件/箱”后点击自动拆箱；系统会把不足一整箱的数量单独生成尾数箱，尾数箱可填写不同外箱尺寸和重量。</span></div><button type="button" disabled={!item.selected || Number(standardGroup?.unitsPerCarton || 0) <= 0} onClick={splitAutomatically}>自动拆分标准箱 / 尾数箱</button></div>
    <div className="sc-route-packaging-groups">
      {item.packagingGroups.map((group, index) => <section key={group.id} className={group.kind === "remainder" ? "is-remainder" : "is-standard"}>
        <div className="sc-route-package-kind"><i>{group.kind === "standard" ? "标准箱" : `尾数箱 ${item.packagingGroups.slice(0, index + 1).filter((candidate) => candidate.kind === "remainder").length}`}</i><small>{group.kind === "standard" ? "相同箱规批量录入" : "允许与标准箱不同"}</small></div>
        <label><small>箱数</small><input disabled={!item.selected} type="number" min="0" step="1" value={group.cartonCount || ""} onChange={(event) => updateGroup(group.id, { cartonCount: Number(event.target.value) })} /></label>
        <label><small>件 / 箱</small><input disabled={!item.selected} type="number" min="1" step="1" value={group.unitsPerCarton || ""} onChange={(event) => updateGroup(group.id, { unitsPerCarton: Number(event.target.value) })} /></label>
        <output><small>本组数量</small><b>{(Number(group.cartonCount || 0) * Number(group.unitsPerCarton || 0)).toLocaleString("zh-CN")}</b></output>
        <label><small>外箱长 cm</small><input disabled={!item.selected} type="number" min="0" step="0.1" value={group.cartonLengthCm || ""} onChange={(event) => updateGroup(group.id, { cartonLengthCm: Number(event.target.value) })} /></label>
        <label><small>外箱宽 cm</small><input disabled={!item.selected} type="number" min="0" step="0.1" value={group.cartonWidthCm || ""} onChange={(event) => updateGroup(group.id, { cartonWidthCm: Number(event.target.value) })} /></label>
        <label><small>外箱高 cm</small><input disabled={!item.selected} type="number" min="0" step="0.1" value={group.cartonHeightCm || ""} onChange={(event) => updateGroup(group.id, { cartonHeightCm: Number(event.target.value) })} /></label>
        <label><small>单箱毛重 kg</small><input disabled={!item.selected} type="number" min="0" step="0.01" value={group.cartonWeightKg || ""} onChange={(event) => updateGroup(group.id, { cartonWeightKg: Number(event.target.value) })} /></label>
        {group.kind === "remainder" ? <button type="button" className="sc-route-remove-package" disabled={!item.selected} onClick={() => onChange({ ...item, packagingGroups: item.packagingGroups.filter((candidate) => candidate.id !== group.id) })} aria-label="删除尾数箱"><X size={15} /></button> : <span className="sc-route-package-spacer" />}
      </section>)}
    </div>
    <footer className="sc-route-packaging-foot"><button type="button" disabled={!item.selected || packedQty >= item.quantity} onClick={addRemainderGroup}><Plus size={14} />增加另一种尾数箱</button><span className={complete ? "is-valid" : "is-error"}>{complete ? "装箱数量、尺寸和重量已完整" : packedQty < item.quantity ? `还差 ${item.quantity - packedQty} ${item.unit}，请调整标准箱或尾数箱` : packedQty > item.quantity ? `超出 ${packedQty - item.quantity} ${item.unit}，请减少箱数或件/箱` : "数量已对上，请补齐所有外箱尺寸和单箱毛重"}</span></footer>
  </article>;
}

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

export function SpotDispatchWorkspace({ shipments, requests, canShip, canSplit, canReceive, initialRequestId = "", handoffToken = 0, onHandoffConsumed, onStartCosting, onChanged }: Props) {
  const [workOrders, setWorkOrders] = useState<StockupWarehouseWorkOrder[]>([]);
  const [forwarders, setForwarders] = useState<StockupForwarder[]>([]);
  const [choices, setChoices] = useState<Record<string, LotChoice>>({});
  const [documents, setDocuments] = useState<Record<string, StockupDispatchDocument[]>>({});
  const [modal, setModal] = useState(false);
  const [routeModalRequest, setRouteModalRequest] = useState<StockupRequest | null>(null);
  const [routeChoices, setRouteChoices] = useState<Record<string, RouteChoice>>({});
  const [splitReason, setSplitReason] = useState("");
  const [forwarderModal, setForwarderModal] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState("");
  const [pendingRouteRequestId, setPendingRouteRequestId] = useState("");
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
  const routeReadyRequests = useMemo(() => requests.filter((request) => Number(request.routePlanVersion || 0) > 0 && (request.allocations || []).some((allocation) => allocation.status === "ready" && Number(allocation.readyQty || 0) > Number(allocation.shippedQty || 0))), [requests]);
  const modalLots = Object.values(choices);
  const selectedLots = useMemo(() => modalLots.filter((item) => item.selected), [modalLots]);
  const warehouseSummary = useMemo(() => summarizeWarehouseLots(selectedLots), [selectedLots]);
  const shipmentSummary = useMemo(() => summarizeShipmentLots(selectedLots), [selectedLots]);
  const selectedRouteChoices = useMemo(() => Object.values(routeChoices).filter((item) => item.selected), [routeChoices]);
  const routeShipmentSummary = useMemo(() => selectedRouteChoices.reduce((summary, item) => ({
    packages: summary.packages + routePackagingMeasures(item.packagingGroups).packages,
    weightKg: summary.weightKg + routePackagingMeasures(item.packagingGroups).weightKg,
    volumeM3: summary.volumeM3 + routePackagingMeasures(item.packagingGroups).volumeM3,
  }), { packages: 0, weightKg: 0, volumeM3: 0 }), [selectedRouteChoices]);
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

  function openRouteReservation(request: StockupRequest, activeLocations = locations) {
    const choices = Object.fromEntries((request.allocations || []).filter((allocation) => allocation.status === "ready" && Number(allocation.readyQty || 0) > Number(allocation.shippedQty || 0)).map((allocation) => {
      const line = request.lines.find((candidate) => candidate.id === allocation.requestLineId);
      const quantity = Number(allocation.readyQty || 0) - Number(allocation.shippedQty || 0);
      return [allocation.id, { allocationId: allocation.id, sku: line?.sku || "", productName: line?.productName || "", imageUrl: line?.imageUrl || "", quantity, unit: line?.unit || "件", selected: true, packagingGroups: [newRoutePackagingGroup("standard")] } satisfies RouteChoice];
    }));
    setRouteChoices(choices);
    setSplitReason("");
    setForm({ forwarderLocationId: activeLocations[0]?.id || "", transportMode: "海运", carrier: "", trackingNo: "", etd: "", eta: "", billingMethod: "volume", carrierPackages: Object.values(choices).length, carrierActualWeightKg: 0, chargeableWeightKg: 0, chargeableVolumeM3: 0, billingUnitPriceCny: 0, billingExtraFeeCny: 0, boxMark: "", note: "" });
    setError("");
    setRouteModalRequest(request);
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
      const pendingRoute = requests.find((request) => request.id === pendingRouteRequestId);
      if (pendingRoute) openRouteReservation(pendingRoute, nextLocations);
      else openReservation(pendingRequestId, nextLocations);
      setPendingRequestId("");
      setPendingRouteRequestId("");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "货代收货点保存失败"); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (!initialRequestId || !handoffToken || openedHandoffToken.current === handoffToken) return;
    const routeRequest = routeReadyRequests.find((request) => request.id === initialRequestId);
    const matchingLots = availableLots.filter((item) => item.order.requestId === initialRequestId);
    openedHandoffToken.current = handoffToken;
    onHandoffConsumed?.();
    if (routeRequest) {
      if (!locations.length) { setPendingRouteRequestId(routeRequest.id); setError("已齐套库存存在，但尚未配置货代收货点。请补充后继续。"); setForwarderModal(true); return; }
      openRouteReservation(routeRequest);
      return;
    }
    if (!matchingLots.length) {
      setError("该需求暂未找到可发运的已审核批次，请刷新仓库验收状态或检查验货是否已通过审核。");
      return;
    }
    beginReservation(initialRequestId);
  }, [availableLots, handoffToken, initialRequestId, locations.length, onHandoffConsumed, routeReadyRequests]);

  async function reserveRoute() {
    if (!routeModalRequest) return;
    const selected = Object.values(routeChoices).filter((item) => item.selected);
    if (!selected.length || !form.forwarderLocationId || !form.transportMode) { setError("请选择至少一个已齐套产品、运输方式和货代收货点。"); return; }
    const isSplit = selected.length < Object.keys(routeChoices).length;
    if (isSplit && !canSplit) { setError("当前账号没有分批发运权限。"); return; }
    if (isSplit && !splitReason.trim()) { setError("分批发运必须填写原因。"); return; }
    const invalidPackaging = selected.find((item) => !routePackagingIsComplete(item));
    if (invalidPackaging) { setError(`${invalidPackaging.sku || invalidPackaging.productName} 的装箱数据未完成：标准箱与尾数箱合计必须等于发运数量，并补齐各箱型的外箱尺寸和单箱毛重。`); return; }
    if (form.billingMethod === "volume" && form.chargeableVolumeM3 <= 0) { setError("按体积计费时，请填写计费方数（CBM）。"); return; }
    if (form.billingMethod === "weight" && form.chargeableWeightKg <= 0) { setError("按重量计费时，请填写计费重量（kg）。"); return; }
    setBusy("route-reserve"); setError("");
    try {
      const result = await createStockupRouteShipment({ ...form, requestId: routeModalRequest.id, allowSplitShipment: isSplit, splitReason, lines: selected.map(({ allocationId, quantity, packagingGroups }) => ({ allocationId, quantity, packagingGroups: activeRoutePackagingGroups(packagingGroups) })) });
      setMessage(`${result.shipment.shipmentNo} 已从履约方案创建；现有锁库已接续到发运批次，不会重复锁库。`);
      setRouteModalRequest(null);
      await onChanged();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "履约发运计划创建失败"); }
    finally { setBusy(""); }
  }

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
      <article><span><PackageCheck size={19} /></span><div><small>待建出运需求</small><b>{readyGroups.length + routeReadyRequests.length}</b><em>已审核入库或履约齐套</em></div></article>
      <article><span><Boxes size={19} /></span><div><small>可发运 SKU</small><b>{readySkuCount + routeReadyRequests.reduce((sum, request) => sum + new Set((request.allocations || []).filter((item) => item.status === "ready").map((item) => item.requestLineId)).size, 0)}</b><em>按履约分配防止重复占用</em></div></article>
      <article><span><LockKeyhole size={19} /></span><div><small>已锁定待发</small><b>{(readyQuantity + routeReadyRequests.reduce((sum, request) => sum + (request.allocations || []).filter((item) => item.status === "ready").reduce((part, item) => part + Math.max(0, Number(item.readyQty) - Number(item.shippedQty)), 0), 0)).toLocaleString("zh-CN")}</b><em>创建发运不再二次锁库</em></div></article>
      <article className={!locations.length && (readyGroups.length + routeReadyRequests.length) ? "is-warning" : ""}><span><MapPin size={19} /></span><div><small>货代收货点</small><b>{locations.length}</b><em>{locations.length ? "可直接创建计划" : "需补充后继续"}</em></div></article>
    </div>
    {routeReadyRequests.length ? <section className="sc-ready-dispatch-queue sc-route-ready-queue"><header><div><b>V3 履约已齐套</b><span>库存已经在确认履约方案时锁定；这里直接接续发运，不会生成虚拟采购或重复锁库。</span></div></header><div>{routeReadyRequests.map((request) => {
      const ready = (request.allocations || []).filter((allocation) => allocation.status === "ready" && Number(allocation.readyQty) > Number(allocation.shippedQty));
      return <article key={request.id}><span><Route size={20} /></span><div><b>{request.requestNo}</b><small>{request.consolidationWarehouseName} → {request.destinationWarehouseName}</small></div><dl><div><dt>可发分配</dt><dd>{ready.length}</dd></div><div><dt>来源</dt><dd>{new Set(ready.map((item) => item.sourceType)).size}</dd></div><div><dt>已锁定数量</dt><dd>{ready.reduce((sum, item) => sum + Number(item.readyQty) - Number(item.shippedQty), 0).toLocaleString("zh-CN")}</dd></div></dl>{canShip ? <button onClick={() => locations.length ? openRouteReservation(request) : (setPendingRouteRequestId(request.id), setForwarderModal(true))}>创建该需求发运计划</button> : null}</article>;
    })}</div></section> : null}
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
    </footer>{documents[shipment.id]?.length ? <div className="sc-operation-checks">{documents[shipment.id].map((document) => <button key={document.id} onClick={() => void downloadStockupDispatchDocument(document)}><Download size={14} />下载/打印{document.documentType === "packing_list" ? "A4 装箱单" : "100×100mm 箱唛"} V{document.version}</button>)}</div> : null}</article>)}{!activeShipments.length ? <div className="sc-empty-inline"><LockKeyhole size={25} /><b>尚未生成出运计划</b><span>{readyGroups.length + routeReadyRequests.length ? "上方已有可发运库存，请点击需求右侧按钮继续。" : "履约齐套或验货审核入库后，可直接创建发运计划。"}</span></div> : null}</div>

    {routeModalRequest ? <div className="sc-modal-backdrop"><section className="sc-modal sc-route-shipment-modal">
      <header className="sc-modal-head"><div><span className="sc-eyebrow">FULFILLMENT TO SHIPMENT</span><h2>{routeModalRequest.requestNo} · 创建发运计划</h2><p>已确认的履约库存直接接续到发运，不会再次采购或重复锁库；取消发运时仍保留需求锁库。</p></div><button className="sc-icon-button" onClick={() => setRouteModalRequest(null)}><X size={19} /></button></header>
      <div className="sc-editor-scroll">
        <section className="sc-form-section"><div className="sc-form-grid sc-form-grid-4">
          <label>货代收货点<select value={form.forwarderLocationId} onChange={(event) => setForm({ ...form, forwarderLocationId: event.target.value })}><option value="">请选择</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.forwarderName} · {location.name} · {location.city}</option>)}</select></label>
          <label>运输方式<select value={form.transportMode} onChange={(event) => setForm({ ...form, transportMode: event.target.value })}><option>海运</option><option>空运</option><option>陆运</option><option>快递</option></select></label>
          <label>承运商<input value={form.carrier} onChange={(event) => setForm({ ...form, carrier: event.target.value })} placeholder="物流公司 / 渠道" /></label>
          <label>物流单号 / 转单号<input value={form.trackingNo} onChange={(event) => setForm({ ...form, trackingNo: event.target.value })} placeholder="可稍后补充" /></label>
          <label>预计发出<input type="date" value={form.etd} onChange={(event) => setForm({ ...form, etd: event.target.value })} /></label>
          <label>预计到仓<input type="date" value={form.eta} onChange={(event) => setForm({ ...form, eta: event.target.value })} /></label>
          <label>箱唛标识<input value={form.boxMark} onChange={(event) => setForm({ ...form, boxMark: event.target.value })} /></label>
          <label>计费方式<select value={form.billingMethod} onChange={(event) => setForm({ ...form, billingMethod: event.target.value as ShipmentBillingMethod })}><option value="volume">按体积（CBM）</option><option value="weight">按重量（kg）</option><option value="flat">按票 / 包干</option></select></label>
          {form.billingMethod === "volume" ? <label>计费方数 CBM<input type="number" min="0" step="0.001" value={form.chargeableVolumeM3} onChange={(event) => setForm({ ...form, chargeableVolumeM3: Number(event.target.value) })} /></label> : null}
          {form.billingMethod === "weight" ? <label>计费重量 kg<input type="number" min="0" step="0.01" value={form.chargeableWeightKg} onChange={(event) => setForm({ ...form, chargeableWeightKg: Number(event.target.value) })} /></label> : null}
          <label>计费单价 ¥<input type="number" min="0" step="0.01" value={form.billingUnitPriceCny} onChange={(event) => setForm({ ...form, billingUnitPriceCny: Number(event.target.value) })} /></label>
          <label>附加费 ¥<input type="number" min="0" step="0.01" value={form.billingExtraFeeCny} onChange={(event) => setForm({ ...form, billingExtraFeeCny: Number(event.target.value) })} /></label>
        </div></section>
        <section className="sc-route-shipment-summary"><span><small>集货仓</small><b>{routeModalRequest.consolidationWarehouseName}</b></span><span><small>本次产品</small><b>{selectedRouteChoices.length} 项</b></span><span><small>本次箱数</small><b>{routeShipmentSummary.packages} 箱</b></span><span><small>估算体积</small><b>{roundMeasure(routeShipmentSummary.volumeM3, 3)} CBM</b></span><span><small>报价估算</small><b>¥{quotedFreightCny.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</b></span></section>
        <section className="sc-route-shipment-lines"><header><div><b>产品装箱明细</b><span>每个产品可拆成标准箱和一种或多种尾数箱；系统按各箱型汇总箱数、体积和重量。</span></div><em>{selectedRouteChoices.length} 个产品 · {routeShipmentSummary.packages} 箱</em></header>{Object.values(routeChoices).map((item) => <RoutePackagingCard key={item.allocationId} item={item} onChange={(next) => setRouteChoices((current) => ({ ...current, [item.allocationId]: next }))} />)}</section>
        {selectedRouteChoices.length < Object.keys(routeChoices).length ? <section className="sc-split-shipment-reason"><AlertTriangle size={17} /><label><b>受控分批发运</b><span>{canSplit ? "未选择的履约分配继续保留在原需求中。请填写原因。" : "当前账号没有分批发运权限，请选择全部产品。"}</span><textarea disabled={!canSplit} value={splitReason} onChange={(event) => setSplitReason(event.target.value)} placeholder="例如：优先发运即将断货的产品，剩余产品等待调拨到仓" /></label></section> : null}
      </div>
      <footer className="sc-modal-foot"><span>库存已在履约确认时锁定；交货代时才正式扣减。</span><div><button className="sc-button sc-button-secondary" onClick={() => setRouteModalRequest(null)}>取消</button><button className="sc-button sc-button-primary" disabled={busy === "route-reserve"} onClick={() => void reserveRoute()}>{busy === "route-reserve" ? <LoaderCircle className="spin" size={16} /> : <Route size={16} />}创建发运计划</button></div></footer>
    </section></div> : null}

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

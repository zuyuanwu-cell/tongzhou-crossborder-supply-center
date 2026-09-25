import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Calculator, ClipboardList, CircleDollarSign, PackageCheck, Plus, RefreshCw, Route, Sparkles, Truck } from "lucide-react";
import {
  AuthUser,
  CatalogProduct,
  WarehouseConnection,
  createStockupCollaborationRequest,
  fetchStockupCollaborationNotifications,
  fetchStockupCollaborationReceipts,
  fetchStockupCollaborationRequest,
  fetchStockupCollaborationRequests,
  fetchStockupCollaborationShipments,
  fetchStockupCollaborationWarehouses,
} from "../api";
import type { StockupReceipt, StockupRequest, StockupRequestListPayload, StockupShipment } from "./types";
import { CostSettlementWorkspace } from "./CostSettlementWorkspace";
import { ExecutionQueue } from "./ExecutionQueue";
import { MonthlyCostReport } from "./MonthlyCostReport";
import { MyRequests } from "./MyRequests";
import { RequestCreatePanel } from "./RequestCreatePanel";
import { RequestDetailDrawer } from "./RequestDetailDrawer";
import { ShipmentWorkspace } from "./ShipmentWorkspace";
import "./stockup-collaboration.css";

export type StockupCollaborationSection = "requests" | "execution" | "logistics" | "costs" | "report";

type Props = {
  user: AuthUser;
  products: CatalogProduct[];
  warehouses?: WarehouseConnection[];
  initialSection?: StockupCollaborationSection;
};

function allowed(user: AuthUser, permission: string, legacy: string[] = []) {
  if (user.role === "admin") return true;
  return user.permissions?.includes(permission) || legacy.some((key) => user.permissions?.includes(key));
}

export function StockupCollaborationCenter({ user, products, warehouses = [], initialSection = "requests" }: Props) {
  const [section, setSection] = useState<StockupCollaborationSection>(initialSection);
  const [payload, setPayload] = useState<StockupRequestListPayload | null>(null);
  const [shipments, setShipments] = useState<StockupShipment[]>([]);
  const [receipts, setReceipts] = useState<StockupReceipt[]>([]);
  const [selected, setSelected] = useState<StockupRequest | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unread, setUnread] = useState(0);
  const [warehouseOptions, setWarehouseOptions] = useState<Array<Pick<WarehouseConnection, "id" | "name" | "country" | "status">>>(warehouses);
  const [projectTeams, setProjectTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [defaultProjectTeamId, setDefaultProjectTeamId] = useState("");

  const permissions = useMemo(() => ({
    canCreate: allowed(user, "stockup_request_create", ["stockup_workflow_manage"]),
    canAccept: allowed(user, "stockup_request_accept", ["stockup_workflow_manage"]),
    canExecute: allowed(user, "stockup_execution_update", ["stockup_execution_manage"]),
    canShip: allowed(user, "stockup_shipment_update", ["stockup_execution_manage"]),
    canReceive: allowed(user, "stockup_receipt_confirm", ["stockup_execution_manage"]),
    canCost: allowed(user, "stockup_cost_edit", ["stockup_workflow_manage"]),
    canLock: allowed(user, "stockup_cost_lock", ["stockup_workflow_manage"]),
    canReport: allowed(user, "stockup_cost_report_view", ["stockup_workflow_manage"]),
  }), [user]);

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [requestData, shipmentData, receiptData, notificationData, warehouseData] = await Promise.all([
        fetchStockupCollaborationRequests({ pageSize: 100 }),
        fetchStockupCollaborationShipments(),
        fetchStockupCollaborationReceipts(),
        fetchStockupCollaborationNotifications(),
        fetchStockupCollaborationWarehouses(),
      ]);
      setPayload(requestData);
      setShipments(shipmentData.shipments);
      setReceipts(receiptData.receipts);
      setUnread(notificationData.unread);
      setWarehouseOptions(warehouseData.warehouses);
      setProjectTeams(warehouseData.projectTeams || []);
      setDefaultProjectTeamId(warehouseData.defaultTeamId || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "备货协同数据读取失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => { if (warehouses.length) setWarehouseOptions(warehouses); }, [warehouses]);
  useEffect(() => { void loadAll(); }, [loadAll]);

  async function loadDetail(requestId: string) {
    const result = await fetchStockupCollaborationRequest(requestId);
    return result.request;
  }

  async function openDetail(request: StockupRequest) {
    setError("");
    try { setSelected(await loadDetail(request.id)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "需求详情读取失败"); }
  }

  async function reloadSelected() {
    await loadAll(true);
    if (selected) setSelected(await loadDetail(selected.id));
  }

  const sections = [
    { id: "requests" as const, label: "我的需求", detail: "提交与查看进度", icon: ClipboardList, visible: true },
    { id: "execution" as const, label: "供应链执行", detail: "受理、采购与生产", icon: PackageCheck, visible: permissions.canAccept || permissions.canExecute },
    { id: "logistics" as const, label: "物流与到仓", detail: "发运、ETA与收货", icon: Truck, visible: permissions.canShip || permissions.canReceive },
    { id: "costs" as const, label: "成本结算", detail: "费用归集与锁定", icon: CircleDollarSign, visible: permissions.canCost || permissions.canLock },
    { id: "report" as const, label: "月度成本", detail: "SKU加权到仓成本", icon: Calculator, visible: permissions.canReport },
  ].filter((item) => item.visible);

  return <main className="stockup-collaboration-page">
    <section className="sc-hero">
      <div><span className="sc-eyebrow"><i /> STOCKUP COLLABORATION</span><h1>备货协同中心</h1><p>从一张简单需求开始，采购、生产、物流、到仓和成本沿同一条航线协作。</p><div className="sc-hero-route"><span>需求</span><i /><span>执行</span><i /><span>发运</span><i /><span>到仓</span><i /><span>成本</span></div></div>
      <div className="sc-hero-actions"><button className="sc-notification-button" type="button" aria-label={`进度通知，${unread} 条未读`} title="未读进度通知"><BellRing size={18} /><b>进度通知</b><span>{unread}</span></button><button className="sc-button sc-button-secondary" disabled={loading} onClick={() => void loadAll()}><RefreshCw className={loading ? "spin" : ""} size={17} />刷新</button>{permissions.canCreate ? <button className="sc-button sc-button-primary" onClick={() => setShowCreate(true)}><Plus size={18} />新建需求</button> : null}</div>
      <div className="sc-hero-mark"><Route size={46} /><span>同舟协同航线</span></div>
    </section>

    <nav className="sc-tabs">{sections.map(({ id, label, detail, icon: Icon }) => <button className={section === id ? "is-active" : ""} key={id} onClick={() => setSection(id)}><Icon size={18} /><span><b>{label}</b><small>{detail}</small></span></button>)}</nav>
    {error ? <div className="sc-alert sc-alert-danger">{error}</div> : null}

    {section === "requests" ? <MyRequests payload={payload} loading={loading} onOpen={(request) => void openDetail(request)} /> : null}
    {section === "execution" ? <ExecutionQueue requests={payload?.items || []} loading={loading} onOpen={(request) => void openDetail(request)} /> : null}
    {section === "logistics" ? <ShipmentWorkspace requests={payload?.items || []} shipments={shipments} canShip={permissions.canShip} canReceive={permissions.canReceive} loadRequest={loadDetail} onChanged={() => loadAll(true)} /> : null}
    {section === "costs" ? <CostSettlementWorkspace receipts={receipts} canEdit={permissions.canCost} canLock={permissions.canLock} loadRequest={loadDetail} onChanged={() => loadAll(true)} /> : null}
    {section === "report" ? <MonthlyCostReport /> : null}

    <section className="sc-guidance"><Sparkles size={18} /><div><b>无需再记复杂步骤</b><span>系统根据当前角色和单据状态，只展示下一步要处理的动作。</span></div></section>

    {showCreate ? <RequestCreatePanel products={products} warehouses={warehouseOptions} projectTeams={projectTeams} defaultProjectTeamId={defaultProjectTeamId} onClose={() => setShowCreate(false)} onSave={async (data) => { const result = await createStockupCollaborationRequest(data); setShowCreate(false); await loadAll(true); setSelected((await fetchStockupCollaborationRequest(result.requestId)).request); }} /> : null}
    {selected ? <RequestDetailDrawer request={selected} canAccept={permissions.canAccept} canExecute={permissions.canExecute} onClose={() => setSelected(null)} onChanged={reloadSelected} /> : null}
  </main>;
}

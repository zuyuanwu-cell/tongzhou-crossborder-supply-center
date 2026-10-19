import React from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  KeyRound,
  Link2,
  ListChecks,
  LoaderCircle,
  PackageCheck,
  Play,
  RefreshCw,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Trash2,
  Users,
  Warehouse,
  Workflow,
} from "lucide-react";
import {
  AuthUser,
  OzonOrder,
  OzonPayload,
  OzonScheduleBatch,
  OzonScheduleRule,
  OzonStore,
  OzonWarehouseRoute,
  autoMapOzonSkus,
  confirmOzonScheduleBatch,
  deleteOzonScheduleRule,
  deleteOzonStore,
  fetchOzonIntegration,
  fetchOzonOperators,
  generateOzonScheduleBatch,
  retryOzonOrder,
  saveOzonScheduleRule,
  saveOzonSkuMapping,
  saveOzonStore,
  saveOzonStoreCollaborators,
  saveOzonWarehouseRoute,
  syncOzonStore,
  testOzonStore,
} from "./api";

type Workspace = "orders" | "batches" | "mapping" | "rules" | "stores";
type OrderFilter = "all" | "mapping" | "confirm" | "wms" | "ozon" | "exception" | "completed";
type Operator = { id: string; username: string; displayName: string; roleLabel: string };

const weekdayLabels = ["一", "二", "三", "四", "五", "六", "日"];

function hasPermission(user: AuthUser, permission: string) {
  return user.role === "admin" || user.permissions?.includes(permission);
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function statusLabel(status: string) {
  if (status === "awaiting_packaging") return "待配货";
  if (status === "awaiting_deliver") return "待交运";
  if (status === "delivering") return "配送中";
  if (status === "delivered") return "已签收";
  if (status === "cancelled") return "已取消";
  return status || "未知";
}

function fulfillmentStatus(order: OzonOrder) {
  const stage = order.fulfillment?.stage || "";
  if (stage === "completed") return { label: "闭环完成", tone: "success" };
  if (stage === "external_awaiting_deliver") return { label: "非中台发运", tone: "muted" };
  if (stage === "error") return { label: "履约异常", tone: "danger" };
  if (stage === "ozon_shipping") return { label: "Ozon 发运中", tone: "info" };
  if (stage === "wms_ready") return { label: "WMS 待发货", tone: "success" };
  if (["queued_wms", "wms_pending", "wms_verifying"].includes(stage)) return { label: "WMS 处理中", tone: "info" };
  if (order.schedule?.status === "confirmed") return { label: "已确认排单", tone: "info" };
  if (order.ready) return { label: "待确认排单", tone: "warning" };
  return { label: "待补配置", tone: "muted" };
}

function WarehouseRouteEditor({ store, ozonWarehouse, existing, payload, onSaved }: {
  store: OzonStore;
  ozonWarehouse: OzonStore["ozonWarehouses"][number];
  existing?: OzonWarehouseRoute;
  payload: OzonPayload;
  onSaved: (payload: OzonPayload, message: string) => void;
}) {
  const [form, setForm] = React.useState({
    warehouseConnectionId: existing?.warehouseConnectionId || "",
    platformShop: existing?.platformShop || "",
    wmsWarehouseCode: existing?.wmsWarehouseCode || "",
    shippingMethod: existing?.shippingMethod || "",
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setForm({
      warehouseConnectionId: existing?.warehouseConnectionId || "",
      platformShop: existing?.platformShop || "",
      wmsWarehouseCode: existing?.wmsWarehouseCode || "",
      shippingMethod: existing?.shippingMethod || "",
    });
  }, [existing?.updatedAt, existing?.warehouseConnectionId, existing?.platformShop, existing?.wmsWarehouseCode, existing?.shippingMethod]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const result = await saveOzonWarehouseRoute({
        storeId: store.id,
        ozonWarehouseId: ozonWarehouse.id,
        ozonWarehouseName: ozonWarehouse.name,
        warehouseConnectionId: form.warehouseConnectionId,
        platformShop: form.platformShop,
        wmsWarehouseCode: form.wmsWarehouseCode,
        shippingMethod: form.shippingMethod,
      });
      onSaved(result, `${ozonWarehouse.name || ozonWarehouse.id} 已绑定俄罗斯仓。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "仓库路由保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return <article className="ozon-route-card">
    <header><div><strong>{ozonWarehouse.name || `Ozon 仓 ${ozonWarehouse.id}`}</strong><small>ID {ozonWarehouse.id} · {ozonWarehouse.isRfbs ? "rFBS" : "FBS"}</small></div>{existing ? <span className="ozon-badge success"><Check size={13} />已配置</span> : <span className="ozon-badge muted">待配置</span>}</header>
    <div className="ozon-form-grid compact">
      <label><span>目标俄罗斯仓 *</span><select value={form.warehouseConnectionId} onChange={(event) => setForm((current) => ({ ...current, warehouseConnectionId: event.target.value }))}><option value="">请选择俄罗斯仓</option>{payload.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.warehouseCode ? ` · ${warehouse.warehouseCode}` : ""}</option>)}</select></label>
      <label><span>WMS 店铺编码</span><input value={form.platformShop} onChange={(event) => setForm((current) => ({ ...current, platformShop: event.target.value }))} placeholder="首次关联后自动回填" /></label>
      <label><span>WMS 仓库代码</span><input value={form.wmsWarehouseCode} onChange={(event) => setForm((current) => ({ ...current, wmsWarehouseCode: event.target.value }))} placeholder="例如 MX001" /></label>
      <label><span>WMS 物流代码</span><input value={form.shippingMethod} onChange={(event) => setForm((current) => ({ ...current, shippingMethod: event.target.value }))} placeholder="例如 MXZFH" /></label>
    </div>
    {error ? <p className="ozon-inline-error"><AlertTriangle size={14} />{error}</p> : null}
    <footer><small>路由按 Ozon 卖家仓隔离；WMS 编码可以留空，首次成功关联时会自动回填。</small><button onClick={() => void save()} disabled={busy || !form.warehouseConnectionId}>{busy ? <LoaderCircle className="spinning" size={15} /> : <Route size={15} />}保存仓库路由</button></footer>
  </article>;
}

export function OzonOrderCenter({ currentUser }: { currentUser: AuthUser }) {
  const canConfigure = hasPermission(currentUser, "ozon_config");
  const canPush = hasPermission(currentUser, "ozon_order_push");
  const [payload, setPayload] = React.useState<OzonPayload | null>(null);
  const [operators, setOperators] = React.useState<Operator[]>([]);
  const [tab, setTab] = React.useState<Workspace>("orders");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [storeFilter, setStoreFilter] = React.useState("");
  const [orderFilter, setOrderFilter] = React.useState<OrderFilter>("confirm");
  const [batchSelections, setBatchSelections] = React.useState<Record<string, string[]>>({});
  const [mappingStoreId, setMappingStoreId] = React.useState("");
  const [mappingWarehouseId, setMappingWarehouseId] = React.useState("");
  const [mappingDrafts, setMappingDrafts] = React.useState<Record<string, string>>({});
  const [storeForm, setStoreForm] = React.useState({ id: "", name: "", clientId: "", apiKey: "", enabled: true });
  const [ruleForm, setRuleForm] = React.useState({ id: "", storeId: "", ozonWarehouseId: "", name: "", weekdays: [1, 2, 3, 4, 5, 6, 7], cutoffTimes: "16:00", enabled: true });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchOzonIntegration();
      setPayload(result);
      setMappingStoreId((current) => current || result.stores[0]?.id || "");
      setMappingWarehouseId((current) => current || result.warehouses[0]?.id || "");
      setRuleForm((current) => ({ ...current, storeId: current.storeId || result.stores[0]?.id || "" }));
      if (canConfigure) {
        try {
          setOperators((await fetchOzonOperators()).operators);
        } catch {
          setOperators([]);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取 Ozon 订单中心失败。");
    } finally {
      setLoading(false);
    }
  }, [canConfigure]);

  React.useEffect(() => { void load(); }, [load]);

  function accept(next: OzonPayload, successMessage: string) {
    setPayload(next);
    setMessage(successMessage);
    setError("");
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败。");
    } finally {
      setBusy("");
    }
  }

  async function submitStore() {
    await run("save-store", async () => {
      const result = await saveOzonStore(storeForm);
      accept(result.payload, `店铺“${result.store.name}”授权信息已加密保存。`);
      setStoreForm({ id: "", name: "", clientId: "", apiKey: "", enabled: true });
      setMappingStoreId((current) => current || result.store.id);
    });
  }

  async function storeAction(store: OzonStore, action: "test" | "sync" | "delete") {
    if (action === "delete" && !window.confirm(`确认删除“${store.name}”及其本地路由、映射、批次和订单记录？`)) return;
    await run(`${action}:${store.id}`, async () => {
      if (action === "test") {
        const result = await testOzonStore(store.id);
        accept(result.payload, `${store.name} 授权有效，已读取 ${result.result.ozonWarehouses.length} 个卖家仓。`);
      } else if (action === "sync") {
        const result = await syncOzonStore(store.id);
        accept(result.payload, `${store.name} 已同步 ${result.result.count} 个处理中发货单。`);
      } else {
        accept(await deleteOzonStore(store.id), `${store.name} 已删除。`);
      }
    });
  }

  async function saveMembers(store: OzonStore, collaboratorIds: string[], ownerId = store.ownerId) {
    await run(`members:${store.id}`, async () => {
      const result = await saveOzonStoreCollaborators(store.id, { collaboratorIds, ...(currentUser.role === "admin" ? { ownerId } : {}) });
      accept(result.payload, `${store.name} 的店主与协作者已更新。`);
    });
  }

  async function submitRule() {
    await run("save-rule", async () => {
      const cutoffTimes = ruleForm.cutoffTimes.split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean);
      const result = await saveOzonScheduleRule({ ...ruleForm, cutoffTimes });
      accept(result.payload, `排单规则“${result.rule.name || "未命名规则"}”已保存。`);
      setRuleForm((current) => ({ id: "", storeId: current.storeId, ozonWarehouseId: "", name: "", weekdays: [1, 2, 3, 4, 5, 6, 7], cutoffTimes: "16:00", enabled: true }));
    });
  }

  async function ruleAction(rule: OzonScheduleRule, action: "generate" | "delete") {
    if (action === "delete" && !window.confirm(`确认删除排单规则“${rule.name || rule.id}”？`)) return;
    await run(`${action}:${rule.id}`, async () => {
      const next = action === "generate" ? await generateOzonScheduleBatch(rule.id) : await deleteOzonScheduleRule(rule.id);
      accept(next, action === "generate" ? "预排批次已生成，请到“排单批次”检查并确认。" : "排单规则已删除。");
      if (action === "generate") setTab("batches");
    });
  }

  function selectedOrders(batch: OzonScheduleBatch) {
    return batchSelections[batch.id] || batch.orderNumbers;
  }

  function toggleBatchOrder(batch: OzonScheduleBatch, postingNumber: string) {
    const current = selectedOrders(batch);
    setBatchSelections((selections) => ({ ...selections, [batch.id]: current.includes(postingNumber) ? current.filter((item) => item !== postingNumber) : [...current, postingNumber] }));
  }

  async function confirmBatch(batch: OzonScheduleBatch) {
    const selected = selectedOrders(batch);
    if (!selected.length || !window.confirm(`确认将 ${selected.length} 张订单标记为已排单？确认后后台才会写入 WMS，并严格按 WMS 待发货 → Ozon 发运的顺序处理。`)) return;
    await run(`confirm:${batch.id}`, async () => {
      const result = await confirmOzonScheduleBatch(batch.id, selected);
      accept(result.payload, `批次已确认 ${result.batch.confirmedOrderNumbers.length} 张订单，履约任务已入队。`);
    });
  }

  async function retryOrder(order: OzonOrder, recoverExternal = false) {
    if (recoverExternal && !window.confirm(`订单 ${order.postingNumber} 已由外部推进到 Ozon 待交运。确认显式恢复后，中台会补写并核验 WMS，但不会重复提交 Ozon 发运。`)) return;
    await run(`retry:${order.postingNumber}`, async () => {
      const result = await retryOzonOrder(order.postingNumber, recoverExternal);
      accept(result.payload, recoverExternal ? `${order.postingNumber} 已显式恢复中台处理。` : `${order.postingNumber} 已重新加入履约队列。`);
    });
  }

  async function saveMapping(product: OzonPayload["products"][number]) {
    const key = `${product.storeId}:${product.offerId || product.ozonSku}`;
    const wmsSku = (mappingDrafts[key] || "").trim();
    if (!mappingWarehouseId || !wmsSku) return;
    await run(`mapping:${key}`, async () => {
      const result = await saveOzonSkuMapping({ storeId: product.storeId, warehouseConnectionId: mappingWarehouseId, offerId: product.offerId, ozonSku: product.ozonSku, productName: product.productName, wmsSku });
      accept(result, `${product.offerId || product.ozonSku} → ${wmsSku.toUpperCase()} 已保存。`);
    });
  }

  async function autoMap() {
    if (!mappingStoreId || !mappingWarehouseId) return;
    await run("auto-map", async () => {
      const result = await autoMapOzonSkus({ storeId: mappingStoreId, warehouseConnectionId: mappingWarehouseId });
      accept(result.payload, `已按精确 SKU 与明确包装后缀自动匹配 ${result.mapped} 项。`);
    });
  }

  const visibleOrders = (payload?.orders || []).filter((order) => {
    if (storeFilter && order.storeId !== storeFilter) return false;
    if (keyword && ![order.postingNumber, order.orderNumber, order.storeName, ...order.products.flatMap((product) => [product.offerId, product.ozonSku, product.wmsSku, product.name])].some((value) => value.toLowerCase().includes(keyword.toLowerCase()))) return false;
    const stage = order.fulfillment?.stage || "";
    if (orderFilter === "mapping") return order.issues.some((issue) => /SKU|库存|标识|产地|GTD|RNPT|IMEI/i.test(issue));
    if (orderFilter === "confirm") return order.ready && order.schedule?.status !== "confirmed";
    if (orderFilter === "wms") return order.schedule?.status === "confirmed" && ["queued_wms", "wms_pending", "wms_verifying", "wms_ready"].includes(stage);
    if (orderFilter === "ozon") return stage === "ozon_shipping";
    if (orderFilter === "exception") return stage === "error" || stage === "external_awaiting_deliver";
    if (orderFilter === "completed") return stage === "completed";
    return true;
  });
  const mappingProducts = (payload?.products || []).filter((product) => !mappingStoreId || product.storeId === mappingStoreId);
  const ruleStore = payload?.stores.find((store) => store.id === ruleForm.storeId);

  return <div className="ozon-center">
    <section className="ozon-hero">
      <div><p className="eyebrow">OZON FULFILLMENT CONTROL</p><h2>Ozon 排单与履约中心</h2><span>订单只有经运营确认排单，才会进入 WMS；WMS 到待发货后，系统再推进 Ozon 整单单包发运。</span></div>
      <div className="ozon-hero-mark"><span>OZON</span><small>FBS CLOSED LOOP</small></div>
    </section>

    <section className="ozon-summary">
      <article><Store /><span>可见店铺</span><strong>{payload?.summary.stores || 0}</strong></article>
      <article><ListChecks /><span>待确认批次</span><strong>{payload?.summary.draftBatches || 0}</strong></article>
      <article><Workflow /><span>履约处理中</span><strong>{payload?.summary.processing || 0}</strong></article>
      <article><CheckCircle2 /><span>闭环完成</span><strong>{payload?.summary.completed || 0}</strong></article>
    </section>

    <nav className="ozon-tabs">
      <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><PackageCheck size={17} />订单</button>
      <button className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}><ListChecks size={17} />排单批次</button>
      {canConfigure ? <button className={tab === "mapping" ? "active" : ""} onClick={() => setTab("mapping")}><Link2 size={17} />SKU 映射</button> : null}
      {canConfigure ? <button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}><CalendarClock size={17} />排单规则</button> : null}
      {canConfigure ? <button className={tab === "stores" ? "active" : ""} onClick={() => setTab("stores")}><KeyRound size={17} />店铺授权</button> : null}
    </nav>

    {error ? <div className="notice danger"><AlertTriangle size={17} />{error}</div> : null}
    {message ? <div className="notice success"><CheckCircle2 size={17} />{message}</div> : null}
    {!loading && payload && !payload.automation.autoShipEnabled ? <div className="notice warning"><ShieldCheck size={17} /><span><strong>安全联调模式：</strong>确认排单后系统会自动处理 WMS 到待发货，但暂不调用 Ozon 发运；真实单店验收后设置 <code>OZON_AUTO_SHIP_ENABLED=true</code> 启用。</span></div> : null}
    {loading ? <div className="ozon-empty"><LoaderCircle className="spinning" />正在读取 Ozon 履约任务库…</div> : null}

    {!loading && tab === "orders" ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">ORDER PIPELINE</p><h3>订单履约看板</h3><span>这里仅展示处理状态；启动 WMS 的唯一入口是“排单批次 → 确认排单”。</span></div><div className="ozon-sync-actions">{payload?.stores.filter((store) => store.enabled).map((store) => <button key={store.id} onClick={() => void storeAction(store, "sync")} disabled={Boolean(busy)}>{busy === `sync:${store.id}` ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}同步 {store.name}</button>)}</div></header>
      <div className="ozon-toolbar"><label><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索发货单号、订单号或 SKU" /></label><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">全部店铺</option>{payload?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><select value={orderFilter} onChange={(event) => setOrderFilter(event.target.value as OrderFilter)}><option value="confirm">待确认</option><option value="mapping">待映射/阻塞</option><option value="wms">WMS 处理中</option><option value="ozon">Ozon 处理中</option><option value="exception">异常</option><option value="completed">已完成</option><option value="all">全部</option></select></div>
      <div className="ozon-order-list">
        {!visibleOrders.length ? <div className="ozon-empty"><PackageCheck />当前筛选下没有订单。</div> : null}
        {visibleOrders.map((order) => {
          const state = fulfillmentStatus(order);
          return <article className="ozon-order-card" key={order.postingNumber}>
            <header><div><span className={`ozon-badge ${state.tone}`}>{state.label}</span><strong>{order.postingNumber}</strong><small>{order.storeName} · Ozon {statusLabel(order.status)}</small></div><div><small>最晚处理</small><strong>{dateTime(order.shipmentAt)}</strong></div></header>
            <div className="ozon-order-route"><span><Store size={15} />{order.ozonWarehouseName || order.ozonWarehouseId || "未识别 Ozon 仓"}</span><ChevronRight size={16} /><span className={order.targetWarehouseId ? "done" : "missing"}><Warehouse size={15} />{order.targetWarehouseName || "未绑定俄罗斯仓"}</span><span>{order.deliverySchema || "FBS"}</span></div>
            <div className="ozon-product-lines">{order.products.map((product) => <div key={`${product.offerId}:${product.ozonSku}`}><span><strong>{product.name || product.offerId}</strong><small>货号 {product.offerId || "—"} · Ozon SKU {product.ozonSku || "—"}</small></span><span><small>目标仓 SKU</small><strong className={product.mapped ? "mapped" : "missing"}>{product.wmsSku || "未映射"}</strong></span><span><small>数量 / 可用</small><strong>{product.quantity} / {order.inventoryChecked ? product.availableQty : "待同步"}</strong></span></div>)}</div>
            {order.issues.length ? <div className="ozon-issues"><AlertTriangle size={16} /><div>{order.issues.map((issue) => <span key={issue}>{issue}</span>)}</div></div> : <div className="ozon-ready"><CheckCircle2 size={16} />仓库路由、SKU、库存与商品要求校验通过</div>}
            <footer><div><strong>{order.workflowMessage}</strong><small>{order.push?.wmsOrderNo ? `WMS ${order.push.wmsOrderNo} · 状态 ${order.push.wmsStatus || "确认中"}` : `同步于 ${dateTime(order.syncedAt)}`}</small>{order.fulfillment?.lastError ? <small className="danger-text">{order.fulfillment.lastError}</small> : null}</div>{canPush && order.fulfillment?.stage === "error" ? <div className="ozon-order-actions"><button className="primary" onClick={() => void retryOrder(order)} disabled={Boolean(busy)}>{busy === `retry:${order.postingNumber}` ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}重新入队</button></div> : canPush && order.fulfillment?.stage === "external_awaiting_deliver" ? <div className="ozon-order-actions"><button onClick={() => void retryOrder(order, true)} disabled={Boolean(busy) || Boolean(order.issues.length)}>{busy === `retry:${order.postingNumber}` ? <LoaderCircle className="spinning" size={15} /> : <ShieldCheck size={15} />}显式恢复 WMS 处理</button></div> : null}</footer>
          </article>;
        })}
      </div>
    </section> : null}

    {!loading && tab === "batches" ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">SCHEDULE GATE</p><h3>排单批次</h3><span>规则只生成草稿。运营可勾选部分订单确认；确认前不会发生任何 WMS 写操作。</span></div></header>
      <div className="ozon-batch-list">
        {(payload?.scheduleBatches || []).map((batch) => {
          const selected = selectedOrders(batch);
          const store = payload?.stores.find((item) => item.id === batch.storeId);
          return <article key={batch.id} className="ozon-batch-card">
            <header><div><span className={`ozon-badge ${batch.status === "draft" ? "warning" : "success"}`}>{batch.status === "draft" ? "待确认" : "已确认"}</span><strong>{store?.name || batch.storeId}</strong><small>计划点 {batch.scheduledFor.startsWith("manual:") ? "立即预排" : batch.scheduledFor} · {batch.createdBy}</small></div><div><strong>{batch.status === "draft" ? selected.length : batch.confirmedOrderNumbers.length} / {batch.orderNumbers.length}</strong><small>订单</small></div></header>
            <div className="ozon-batch-orders">{batch.orderNumbers.map((postingNumber) => {
              const order = payload?.orders.find((item) => item.postingNumber === postingNumber);
              return <label key={postingNumber}><input type="checkbox" checked={batch.status === "confirmed" ? batch.confirmedOrderNumbers.includes(postingNumber) : selected.includes(postingNumber)} disabled={batch.status !== "draft"} onChange={() => toggleBatchOrder(batch, postingNumber)} /><span><strong>{postingNumber}</strong><small>{order?.products.map((product) => `${product.wmsSku || product.offerId} × ${product.quantity}`).join("，") || "订单详情已归档"}</small></span><span className={`ozon-badge ${order?.issues.length ? "danger" : "success"}`}>{order?.issues.length ? "需复核" : "校验通过"}</span></label>;
            })}</div>
            {batch.exclusions.length ? <details className="ozon-exclusions"><summary>查看 {batch.exclusions.length} 张排除订单</summary>{batch.exclusions.map((item) => <p key={item.postingNumber}><strong>{item.postingNumber}</strong><span>{item.reasons.join("；")}</span></p>)}</details> : null}
            <footer><small>{batch.status === "draft" ? "确认时会再次核验 Ozon 状态、路由、SKU、库存与特殊要求。" : `确认人 ${batch.confirmedBy} · ${dateTime(batch.confirmedAt)}`}</small>{batch.status === "draft" && canPush ? <button className="primary" onClick={() => void confirmBatch(batch)} disabled={Boolean(busy) || !selected.length}>{busy === `confirm:${batch.id}` ? <LoaderCircle className="spinning" size={15} /> : <ShieldCheck size={15} />}确认排单并入队</button> : null}</footer>
          </article>;
        })}
        {!payload?.scheduleBatches.length ? <div className="ozon-empty"><ListChecks />暂无排单批次。请在“排单规则”中点击“立即生成预排”。</div> : null}
      </div>
    </section> : null}

    {!loading && tab === "mapping" && canConfigure ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">SKU MAPPING</p><h3>Ozon SKU → 俄罗斯仓 SKU</h3><span>映射按店铺和目标仓隔离；未匹配的订单不能进入排单批次。</span></div><button onClick={() => void autoMap()} disabled={Boolean(busy) || !mappingStoreId || !mappingWarehouseId}>{busy === "auto-map" ? <LoaderCircle className="spinning" size={15} /> : <Settings2 size={15} />}安全规则自动匹配</button></header>
      <div className="ozon-mapping-filter"><label><span>Ozon 店铺</span><select value={mappingStoreId} onChange={(event) => setMappingStoreId(event.target.value)}><option value="">请选择店铺</option>{payload?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label><span>目标俄罗斯仓</span><select value={mappingWarehouseId} onChange={(event) => setMappingWarehouseId(event.target.value)}><option value="">请选择俄罗斯仓</option>{payload?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label></div>
      <div className="ozon-mapping-table"><div className="head"><span>Ozon 商品</span><span>Ozon 标识</span><span>目标仓 SKU</span><span>操作</span></div>{mappingProducts.map((product) => {
        const key = `${product.storeId}:${product.offerId || product.ozonSku}`;
        const existing = payload?.skuMappings.find((mapping) => mapping.storeId === product.storeId && mapping.warehouseConnectionId === mappingWarehouseId && (mapping.offerId === product.offerId || (!mapping.offerId && mapping.ozonSku === product.ozonSku)));
        const draft = mappingDrafts[key] ?? existing?.wmsSku ?? "";
        return <div key={key}><span><strong>{product.productName || product.offerId}</strong><small>{product.storeName} · 涉及 {product.orderCount} 个订单</small></span><span><strong>{product.offerId || "—"}</strong><small>Ozon SKU {product.ozonSku || "—"}</small></span><span><input value={draft} onChange={(event) => setMappingDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="精确填写 WMS SKU" /></span><span><button onClick={() => void saveMapping(product)} disabled={Boolean(busy) || !mappingWarehouseId || !draft.trim()}>{busy === `mapping:${key}` ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}保存</button></span></div>;
      })}{!mappingProducts.length ? <div className="ozon-empty">同步 Ozon 订单后，这里会列出待映射商品。</div> : null}</div>
    </section> : null}

    {!loading && tab === "rules" && canConfigure ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">SCHEDULE POLICY</p><h3>北京时间排单规则</h3><span>系统每分钟评估启用规则；同一规则和截点只会生成一个草稿批次。</span></div></header>
      <div className="ozon-rule-form">
        <label><span>店铺 *</span><select value={ruleForm.storeId} onChange={(event) => setRuleForm((current) => ({ ...current, storeId: event.target.value, ozonWarehouseId: "" }))}><option value="">请选择店铺</option>{payload?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        <label><span>Ozon 卖家仓 *</span><select value={ruleForm.ozonWarehouseId} onChange={(event) => setRuleForm((current) => ({ ...current, ozonWarehouseId: event.target.value }))}><option value="">请选择卖家仓</option>{ruleStore?.ozonWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name || warehouse.id}</option>)}</select></label>
        <label><span>规则名称</span><input value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 每日 16 点排单" /></label>
        <label><span>截点（多个用逗号分隔）*</span><input value={ruleForm.cutoffTimes} onChange={(event) => setRuleForm((current) => ({ ...current, cutoffTimes: event.target.value }))} placeholder="11:30, 16:00" /></label>
        <div className="ozon-weekdays"><span>生效星期</span><div>{weekdayLabels.map((label, index) => { const day = index + 1; return <button type="button" key={day} className={ruleForm.weekdays.includes(day) ? "active" : ""} onClick={() => setRuleForm((current) => ({ ...current, weekdays: current.weekdays.includes(day) ? current.weekdays.filter((item) => item !== day) : [...current.weekdays, day].sort() }))}>周{label}</button>; })}</div></div>
        <label className="ozon-toggle"><input type="checkbox" checked={ruleForm.enabled} onChange={(event) => setRuleForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用规则</span></label>
        <button className="primary" onClick={() => void submitRule()} disabled={Boolean(busy) || !ruleForm.storeId || !ruleForm.ozonWarehouseId || !ruleForm.weekdays.length || !ruleForm.cutoffTimes.trim()}>{busy === "save-rule" ? <LoaderCircle className="spinning" size={15} /> : <CalendarClock size={15} />}{ruleForm.id ? "保存规则" : "新增规则"}</button>
      </div>
      <div className="ozon-rule-list">{payload?.scheduleRules.map((rule) => {
        const store = payload.stores.find((item) => item.id === rule.storeId);
        const warehouse = store?.ozonWarehouses.find((item) => item.id === rule.ozonWarehouseId);
        return <article key={rule.id}><header><div><span className={`ozon-badge ${rule.enabled ? "success" : "muted"}`}>{rule.enabled ? "启用" : "停用"}</span><strong>{rule.name || `${store?.name || "店铺"}排单`}</strong><small>{store?.name} · {warehouse?.name || rule.ozonWarehouseId}</small></div><div><strong>{rule.cutoffTimes.join(" / ")}</strong><small>北京时间 · 周{rule.weekdays.map((day) => weekdayLabels[day - 1]).join("、")}</small></div></header><footer><small>最近生成 {dateTime(rule.lastGeneratedAt)}</small><div><button onClick={() => setRuleForm({ id: rule.id, storeId: rule.storeId, ozonWarehouseId: rule.ozonWarehouseId, name: rule.name, weekdays: rule.weekdays, cutoffTimes: rule.cutoffTimes.join(", "), enabled: rule.enabled })}><Settings2 size={14} />编辑</button><button className="primary" onClick={() => void ruleAction(rule, "generate")} disabled={Boolean(busy)}>{busy === `generate:${rule.id}` ? <LoaderCircle className="spinning" size={14} /> : <Play size={14} />}立即生成预排</button><button className="danger" onClick={() => void ruleAction(rule, "delete")} disabled={Boolean(busy)}><Trash2 size={14} />删除</button></div></footer></article>;
      })}{!payload?.scheduleRules.length ? <div className="ozon-empty"><CalendarClock />暂无排单规则。</div> : null}</div>
    </section> : null}

    {!loading && tab === "stores" && canConfigure ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">STORE ACCESS</p><h3>店铺授权与成员</h3><span>管理员可见全部店铺；店主和协作者只能看被授权店铺，协作者不会看到 Client-Id 与密钥信息。</span></div></header>
      <div className="ozon-store-form"><label><span>店铺名称 *</span><input value={storeForm.name} onChange={(event) => setStoreForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 Ozon 旗舰店" /></label><label><span>Client-Id *</span><input value={storeForm.clientId} onChange={(event) => setStoreForm((current) => ({ ...current, clientId: event.target.value }))} placeholder="Ozon Seller Client ID" /></label><label><span>Api-Key {storeForm.id ? "（留空不修改）" : "*"}</span><input type="password" value={storeForm.apiKey} onChange={(event) => setStoreForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="AES-256-GCM 加密落盘" /></label><button onClick={() => void submitStore()} disabled={Boolean(busy) || !storeForm.name || !storeForm.clientId || (!storeForm.id && !storeForm.apiKey)}>{busy === "save-store" ? <LoaderCircle className="spinning" size={16} /> : <KeyRound size={16} />}{storeForm.id ? "保存修改" : "绑定店铺"}</button></div>
      <div className="ozon-store-list">{payload?.stores.map((store) => <article key={store.id}>
        <header><div><strong>{store.name}</strong><small>{store.companyName || "待验证卖家主体"} · {store.accessRole === "admin" ? "管理员" : store.accessRole === "owner" ? "店主" : "协作者"}</small></div><span className={`ozon-badge ${store.lastError ? "danger" : store.connectedAt ? "success" : "warning"}`}>{store.lastError ? "连接异常" : store.connectedAt ? "已授权" : "待测试"}</span></header>
        <div><span><small>Client-Id</small><strong>{store.canManageCredentials ? store.clientId : "仅店主可见"}</strong></span><span><small>Api-Key</small><strong>{store.canManageCredentials ? store.apiKeyMasked || "未配置" : "••••••••"}</strong></span><span><small>店主</small><strong>{store.ownerName || "未分配（仅管理员可见）"}</strong></span><span><small>最近同步</small><strong>{dateTime(store.lastSyncedAt)}</strong></span></div>
        {store.lastError ? <p className="ozon-inline-error"><AlertTriangle size={14} />{store.lastError}</p> : null}
        <footer>{store.canManageCredentials ? <button onClick={() => setStoreForm({ id: store.id, name: store.name, clientId: store.clientId, apiKey: "", enabled: store.enabled })}><Settings2 size={14} />编辑密钥</button> : null}<button onClick={() => void storeAction(store, "test")} disabled={Boolean(busy) || !store.canManageCredentials}>{busy === `test:${store.id}` ? <LoaderCircle className="spinning" size={14} /> : <ShieldCheck size={14} />}验证授权</button><button onClick={() => void storeAction(store, "sync")} disabled={Boolean(busy)}>{busy === `sync:${store.id}` ? <LoaderCircle className="spinning" size={14} /> : <RefreshCw size={14} />}同步订单</button>{store.canManageCredentials ? <button className="danger" onClick={() => void storeAction(store, "delete")} disabled={Boolean(busy)}><Trash2 size={14} />删除</button> : null}</footer>
        {store.canManageCredentials ? <section className="ozon-members"><h4><Users size={16} />店铺成员</h4>{currentUser.role === "admin" ? <label><span>店主</span><select value={store.ownerId} onChange={(event) => void saveMembers(store, store.collaboratorIds, event.target.value)}><option value="">未分配</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.displayName} · {operator.roleLabel}</option>)}</select></label> : null}<div><span>协作者</span><div>{operators.filter((operator) => operator.id !== store.ownerId).map((operator) => <label key={operator.id}><input type="checkbox" checked={store.collaboratorIds.includes(operator.id)} onChange={(event) => void saveMembers(store, event.target.checked ? [...store.collaboratorIds, operator.id] : store.collaboratorIds.filter((id) => id !== operator.id))} /><span>{operator.displayName}<small>{operator.roleLabel}</small></span></label>)}</div></div></section> : null}
        {store.ozonWarehouses.length ? <section className="ozon-routes"><h4><Route size={16} />仓库路由</h4>{store.ozonWarehouses.map((warehouse) => <WarehouseRouteEditor key={warehouse.id} store={store} ozonWarehouse={warehouse} existing={payload.routes.find((route) => route.storeId === store.id && route.ozonWarehouseId === warehouse.id)} payload={payload} onSaved={accept} />)}</section> : <div className="ozon-store-hint">店主先验证授权，读取 Ozon 卖家仓后再配置仓库路由。</div>}
      </article>)}</div>
      {!payload?.stores.length ? <div className="ozon-empty"><Store />当前没有可见的 Ozon 店铺。</div> : null}
    </section> : null}

    {!loading && payload?.taskEvents.some((event) => event.level === "error") ? <section className="ozon-event-strip"><AlertTriangle size={17} /><div><strong>最近异常</strong><span>{payload.taskEvents.find((event) => event.level === "error")?.postingNumber} · {payload.taskEvents.find((event) => event.level === "error")?.message}</span></div><button onClick={() => { setTab("orders"); setOrderFilter("exception"); }}><CircleDot size={14} />查看异常队列</button></section> : null}
  </div>;
}

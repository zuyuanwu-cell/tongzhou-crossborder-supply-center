import React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  KeyRound,
  Link2,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Store,
  Trash2,
  Warehouse,
} from "lucide-react";
import {
  AuthUser,
  OzonOrder,
  OzonPayload,
  OzonStore,
  OzonWarehouseRoute,
  autoMapOzonSkus,
  deleteOzonStore,
  fetchOzonIntegration,
  pushOzonOrder,
  reviewOzonOrder,
  saveOzonSkuMapping,
  saveOzonStore,
  saveOzonWarehouseRoute,
  syncOzonStore,
  testOzonStore,
  verifyOzonOrderInWms,
} from "./api";

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

function pushStatus(order: OzonOrder) {
  if (order.linked) return { label: "已关联 WMS", tone: "success" };
  if (order.push?.status === "failed") return { label: "处理失败", tone: "danger" };
  if (order.push?.status === "configuring") return { label: "正在设定并审单", tone: "info" };
  if (order.push?.status === "verification_pending") return { label: "WMS 状态确认中", tone: "warning" };
  if (order.push?.status === "ready_for_verification") return { label: "待设定 SKU 并审单", tone: "warning" };
  if (order.push?.status === "checking") return { label: "查询中", tone: "info" };
  if (order.push?.status === "waiting_sync") return { label: "等待 WMS 同步", tone: "warning" };
  if (order.workflowStage === "reconcile") return { label: "待关联 WMS", tone: "info" };
  if (order.review?.status === "approved") return { label: "已审核", tone: "info" };
  if (order.ready) return { label: "待审核", tone: "warning" };
  return { label: "待补配置", tone: "muted" };
}

function WarehouseRouteEditor({
  store,
  ozonWarehouse,
  existing,
  payload,
  onSaved,
}: {
  store: OzonStore;
  ozonWarehouse: OzonStore["ozonWarehouses"][number];
  existing?: OzonWarehouseRoute;
  payload: OzonPayload;
  onSaved: (payload: OzonPayload, message: string) => void;
}) {
  const [form, setForm] = React.useState(() => ({
    warehouseConnectionId: existing?.warehouseConnectionId || "",
    platformShop: existing?.platformShop || "",
    wmsWarehouseCode: existing?.wmsWarehouseCode || "",
    shippingMethod: existing?.shippingMethod || "",
  }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setForm({
      warehouseConnectionId: existing?.warehouseConnectionId || "",
      platformShop: existing?.platformShop || "",
      wmsWarehouseCode: existing?.wmsWarehouseCode || "",
      shippingMethod: existing?.shippingMethod || "",
    });
  }, [existing?.warehouseConnectionId, existing?.platformShop, existing?.wmsWarehouseCode, existing?.shippingMethod, existing?.updatedAt]);

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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "仓库路由保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return <article className="ozon-route-card">
    <header><div><strong>{ozonWarehouse.name || `Ozon 仓 ${ozonWarehouse.id}`}</strong><small>ID {ozonWarehouse.id} · {ozonWarehouse.isRfbs ? "rFBS" : "FBS"}</small></div>{existing ? <span className="ozon-badge success"><Check size={13} />已配置</span> : <span className="ozon-badge muted">待配置</span>}</header>
    <div className="ozon-form-grid compact">
      <label><span>目标俄罗斯仓 *</span><select value={form.warehouseConnectionId} onChange={(event) => setForm((current) => ({ ...current, warehouseConnectionId: event.target.value }))}><option value="">请选择俄罗斯1仓 / 2仓</option>{payload.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}{warehouse.warehouseCode ? ` · ${warehouse.warehouseCode}` : ""}</option>)}</select></label>
      <label><span>WMS 店铺编码（自动回填）</span><input value={form.platformShop} onChange={(event) => setForm((current) => ({ ...current, platformShop: event.target.value }))} placeholder="关联成功后自动读取" /></label>
      <label><span>WMS 仓库代码（自动回填）</span><input value={form.wmsWarehouseCode} onChange={(event) => setForm((current) => ({ ...current, wmsWarehouseCode: event.target.value }))} placeholder="例如 MX001" /></label>
      <label><span>WMS 物流代码（自动回填）</span><input value={form.shippingMethod} onChange={(event) => setForm((current) => ({ ...current, shippingMethod: event.target.value }))} placeholder="例如 MXZFH" /></label>
    </div>
    {error ? <p className="ozon-inline-error"><AlertTriangle size={14} />{error}</p> : null}
    <footer><small>WMS 已绑定 Ozon 店铺时，中台只按发货单号查询并关联，不创建通用出库单；后 3 项可留空，首次关联后自动回填。</small><button onClick={() => void save()} disabled={busy || !form.warehouseConnectionId}>{busy ? <LoaderCircle className="spinning" size={15} /> : <Route size={15} />}保存仓库路由</button></footer>
  </article>;
}

export function OzonOrderCenter({ currentUser }: { currentUser: AuthUser }) {
  const canConfigure = hasPermission(currentUser, "ozon_config");
  const canPush = hasPermission(currentUser, "ozon_order_push");
  const [payload, setPayload] = React.useState<OzonPayload | null>(null);
  const [tab, setTab] = React.useState<"orders" | "mapping" | "stores">("orders");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [storeFilter, setStoreFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("pending");
  const [mappingStoreId, setMappingStoreId] = React.useState("");
  const [mappingWarehouseId, setMappingWarehouseId] = React.useState("");
  const [mappingDrafts, setMappingDrafts] = React.useState<Record<string, string>>({});
  const [storeForm, setStoreForm] = React.useState({ id: "", name: "", clientId: "", apiKey: "", enabled: true });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchOzonIntegration();
      setPayload(result);
      setMappingStoreId((current) => current || result.stores[0]?.id || "");
      setMappingWarehouseId((current) => current || result.warehouses[0]?.id || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取 Ozon 订单中心失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  function accept(next: OzonPayload, text: string) {
    setPayload(next);
    setMessage(text);
    setError("");
  }

  async function saveStore() {
    setBusy("save-store");
    setError("");
    setMessage("");
    try {
      const result = await saveOzonStore(storeForm);
      accept(result.payload, `店铺“${result.store.name}”授权信息已安全保存。`);
      setStoreForm({ id: "", name: "", clientId: "", apiKey: "", enabled: true });
      setMappingStoreId((current) => current || result.store.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Ozon 店铺保存失败。");
    } finally { setBusy(""); }
  }

  async function storeAction(store: OzonStore, action: "test" | "sync" | "delete") {
    if (action === "delete" && !window.confirm(`确认删除 Ozon 店铺“${store.name}”及其本地映射和订单记录？`)) return;
    setBusy(`${action}:${store.id}`);
    setError("");
    setMessage("");
    try {
      if (action === "test") {
        const result = await testOzonStore(store.id);
        accept(result.payload, `${store.name} 授权有效，已读取 ${result.result.ozonWarehouses.length} 个卖家仓。`);
      } else if (action === "sync") {
        const result = await syncOzonStore(store.id);
        accept(result.payload, `${store.name} 已同步 ${result.result.count} 个待处理发货单。`);
      } else {
        accept(await deleteOzonStore(store.id), `${store.name} 已删除。`);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败。");
    } finally { setBusy(""); }
  }

  async function orderAction(order: OzonOrder, action: "review" | "verify" | "query") {
    if (action === "verify") {
      const lines = order.products.map((product) => `${product.wmsSku || "未映射"} × ${product.quantity}`).join("\n");
      if (!window.confirm(`确认处理 ${order.postingNumber}？\n\n目标仓：${order.targetWarehouseName}\n商品：\n${lines}\n\n系统只处理 WMS 已有订单，并将其审核到待发货；审核成功后不能再修改。`)) return;
    }
    setBusy(`${action}:${order.postingNumber}`);
    setError("");
    setMessage("");
    try {
      const result = action === "review" ? await reviewOzonOrder(order.postingNumber)
        : action === "query" ? await pushOzonOrder(order.postingNumber)
          : await verifyOzonOrderInWms(order.postingNumber);
      accept(result.payload, action === "review"
        ? `${order.postingNumber} 审核通过，正在等待 WMS 自动拉单。`
        : action === "query"
          ? result.order.linked
            ? `${order.postingNumber} 已确认到待发货，WMS 单号：${result.order.push?.wmsOrderNo}。`
            : `${order.postingNumber} 的 WMS 状态尚未确认，系统会继续自动检查。`
        : result.order.linked
          ? `${order.postingNumber} 已设定 SKU 并审核到待发货，WMS 单号：${result.order.push?.wmsOrderNo}。`
          : result.order.push?.status === "verification_pending"
            ? `${order.postingNumber} 的 WMS 已接收审单请求，正在确认最终状态，请勿重复点击。`
            : `${order.postingNumber} 暂未被 WMS 拉取，本次没有执行任何写入；系统会继续自动检查。`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "订单操作失败。");
    } finally { setBusy(""); }
  }

  async function saveMapping(product: NonNullable<OzonPayload>["products"][number]) {
    const key = `${product.storeId}:${product.offerId || product.ozonSku}`;
    const wmsSku = (mappingDrafts[key] || "").trim();
    if (!mappingWarehouseId || !wmsSku) return;
    setBusy(`mapping:${key}`);
    setError("");
    try {
      const result = await saveOzonSkuMapping({
        storeId: product.storeId,
        warehouseConnectionId: mappingWarehouseId,
        offerId: product.offerId,
        ozonSku: product.ozonSku,
        productName: product.productName,
        wmsSku,
      });
      accept(result, `${product.offerId || product.ozonSku} → ${wmsSku.toUpperCase()} 已保存。`);
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : "SKU 映射保存失败。");
    } finally { setBusy(""); }
  }

  async function autoMap() {
    if (!mappingStoreId || !mappingWarehouseId) return;
    setBusy("auto-map");
    setError("");
    try {
      const result = await autoMapOzonSkus({ storeId: mappingStoreId, warehouseConnectionId: mappingWarehouseId });
      accept(result.payload, `已按精确 SKU 及明确的包装后缀规则自动匹配 ${result.mapped} 项；其余请人工确认。`);
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : "自动匹配失败。");
    } finally { setBusy(""); }
  }

  const visibleOrders = (payload?.orders || []).filter((order) => {
    if (storeFilter && order.storeId !== storeFilter) return false;
    if (keyword && ![order.postingNumber, order.orderNumber, order.storeName, ...order.products.flatMap((product) => [product.offerId, product.ozonSku, product.wmsSku, product.name])].some((value) => value.toLowerCase().includes(keyword.toLowerCase()))) return false;
    if (statusFilter === "pending" && order.linked) return false;
    if (statusFilter === "blocked" && (order.workflowStage !== "review" || order.ready)) return false;
    if (statusFilter === "approved" && order.review?.status !== "approved") return false;
    if (statusFilter === "pushed" && !order.linked) return false;
    return true;
  });
  const mappingProducts = (payload?.products || []).filter((product) => !mappingStoreId || product.storeId === mappingStoreId);

  return <div className="ozon-center">
    <section className="ozon-hero">
      <div><p className="eyebrow">OZON SELLER CONTROL</p><h2>Ozon 订单审核与 WMS 关联</h2><span>店铺独立授权，Ozon 仓精确路由到俄罗斯1仓 / 2仓；中台可设定 WMS SKU 并审核到待发货。</span></div>
      <div className="ozon-hero-mark"><span>OZON</span><small>Seller API</small></div>
    </section>

    <section className="ozon-summary">
      <article><Store /><span>已授权店铺</span><strong>{payload?.summary.stores || 0}</strong></article>
      <article><Clock3 /><span>待处理</span><strong>{payload?.summary.pending || 0}</strong></article>
      <article><ShieldCheck /><span>可审核</span><strong>{payload?.summary.ready || 0}</strong></article>
      <article><PackageCheck /><span>已关联 WMS</span><strong>{payload?.summary.pushed || 0}</strong></article>
    </section>

    <nav className="ozon-tabs">
      <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><PackageCheck size={17} />订单审核</button>
      {canConfigure ? <button className={tab === "mapping" ? "active" : ""} onClick={() => setTab("mapping")}><Link2 size={17} />SKU 映射</button> : null}
      {canConfigure ? <button className={tab === "stores" ? "active" : ""} onClick={() => setTab("stores")}><KeyRound size={17} />店铺授权</button> : null}
    </nav>

    {error ? <div className="notice danger"><AlertTriangle size={17} />{error}</div> : null}
    {message ? <div className="notice success"><CheckCircle2 size={17} />{message}</div> : null}
    {loading ? <div className="ozon-empty"><LoaderCircle className="spinning" />正在读取 Ozon 订单中心…</div> : null}

    {!loading && tab === "orders" ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">REVIEW QUEUE</p><h3>待审核与 WMS 关联</h3><span>后台每 3 分钟只读检查 WMS；只有人工确认“设定 SKU 并审单”后才会写入，且绝不重复创建订单。</span></div><div className="ozon-sync-actions">{payload?.stores.filter((store) => store.enabled).map((store) => <button key={store.id} onClick={() => void storeAction(store, "sync")} disabled={Boolean(busy)}>{busy === `sync:${store.id}` ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}立即同步 {store.name}</button>)}</div></header>
      <div className="ozon-toolbar"><label><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索发货单号、订单号或 SKU" /></label><select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)}><option value="">全部店铺</option>{payload?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="pending">待处理</option><option value="blocked">待补配置</option><option value="approved">已审核</option><option value="pushed">已关联 WMS</option><option value="all">全部</option></select></div>
      <div className="ozon-order-list">
        {!visibleOrders.length ? <div className="ozon-empty"><PackageCheck />当前筛选下没有订单。{payload?.stores.length ? "可点击右上角同步店铺。" : "请先到“店铺授权”添加 Ozon 店铺。"}</div> : null}
        {visibleOrders.map((order) => {
          const state = pushStatus(order);
          return <article className="ozon-order-card" key={order.postingNumber}>
            <header><div><span className={`ozon-badge ${state.tone}`}>{state.label}</span><strong>{order.postingNumber}</strong><small>{order.storeName} · Ozon {statusLabel(order.status)}</small></div><div><small>最晚处理</small><strong>{dateTime(order.shipmentAt)}</strong></div></header>
            <div className="ozon-order-route"><span><Store size={15} />{order.ozonWarehouseName || order.ozonWarehouseId || "未识别 Ozon 仓"}</span><ChevronRight size={16} /><span className={order.targetWarehouseId ? "done" : "missing"}><Warehouse size={15} />{order.targetWarehouseName || "未绑定俄罗斯仓"}</span><span>{order.deliverySchema || "FBS"}</span></div>
            <div className="ozon-product-lines">{order.products.map((product) => <div key={`${product.offerId}:${product.ozonSku}`}><span><strong>{product.name || product.offerId}</strong><small>Ozon货号：{product.offerId || "—"} · SKU：{product.ozonSku || "—"}</small></span><span><small>目标仓 SKU</small><strong className={product.mapped ? "mapped" : "missing"}>{product.wmsSku || "未映射"}</strong></span><span><small>数量 / 可用</small><strong>{product.quantity} / {order.inventoryChecked ? product.availableQty : "待同步"}</strong></span></div>)}</div>
            {order.issues.length ? <div className="ozon-issues"><AlertTriangle size={16} /><div>{order.issues.map((issue) => <span key={issue}>{issue}</span>)}</div></div> : <div className="ozon-ready"><CheckCircle2 size={16} />{order.workflowStage === "reconcile" ? "仓库路由与 SKU 已就绪，可设定 WMS SKU 并审单" : "仓库路由、SKU 与库存校验通过"}</div>}
            <div className="ozon-ready"><CheckCircle2 size={16} />{order.workflowMessage}</div>
            <footer><div>{order.linked ? <><strong>WMS：{order.push?.wmsOrderNo}</strong><small>SKU 已确认，状态已到待发货；{order.push?.platformShop ? `店铺 ${order.push.platformShop} · ` : ""}{dateTime(order.push?.linkedAt || order.push?.checkedAt)}</small></> : order.push?.status === "verification_pending" ? <><strong>WMS 已接收审单请求</strong><small>正在回查待发货状态，请勿重复操作 · {dateTime(order.push.checkedAt)}</small></> : order.push?.status === "ready_for_verification" ? <><strong>WMS：{order.push.wmsOrderNo}</strong><small>订单已拉取，等待设定 SKU 并审单</small></> : order.push?.status === "waiting_sync" ? <><strong>等待 WMS 自动拉单</strong><small>最近检查 {dateTime(order.push.checkedAt)}</small></> : order.review?.status === "approved" ? <><strong>审核人：{order.review.reviewedBy}</strong><small>{dateTime(order.review.reviewedAt)}</small></> : <><strong>{order.orderNumber || order.orderId}</strong><small>同步于 {dateTime(order.syncedAt)}</small></>}</div>{canPush && !order.linked ? <div className="ozon-order-actions">{order.workflowStage === "review" && order.review?.status !== "approved" ? <button onClick={() => void orderAction(order, "review")} disabled={Boolean(busy) || !order.ready}>{busy === `review:${order.postingNumber}` ? <LoaderCircle className="spinning" size={15} /> : <ShieldCheck size={15} />}审核通过</button> : order.push?.status === "verification_pending" ? <button onClick={() => void orderAction(order, "query")} disabled={Boolean(busy)}>{busy === `query:${order.postingNumber}` ? <LoaderCircle className="spinning" size={15} /> : <RefreshCw size={15} />}查询审单结果</button> : <button className="primary" onClick={() => void orderAction(order, "verify")} disabled={Boolean(busy) || !order.reconcileReady || Boolean(order.issues.length)}>{busy === `verify:${order.postingNumber}` ? <LoaderCircle className="spinning" size={15} /> : <Send size={15} />}{order.push?.status === "waiting_sync" || order.push?.status === "failed" ? "重新查询并审单" : "设定 SKU 并审单"}</button>}</div> : null}</footer>
          </article>;
        })}
      </div>
    </section> : null}

    {!loading && tab === "mapping" && canConfigure ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">SKU MAPPING</p><h3>Ozon SKU → 俄罗斯仓 SKU</h3><span>映射按“店铺 + 目标仓”隔离；除完全相同外，仅识别 *1、**1 这类明确包装后缀，其他情况仍需人工确认。</span></div><button onClick={() => void autoMap()} disabled={Boolean(busy) || !mappingStoreId || !mappingWarehouseId}>{busy === "auto-map" ? <LoaderCircle className="spinning" size={15} /> : <Settings2 size={15} />}安全规则自动匹配</button></header>
      <div className="ozon-mapping-filter"><label><span>Ozon 店铺</span><select value={mappingStoreId} onChange={(event) => setMappingStoreId(event.target.value)}><option value="">请选择店铺</option>{payload?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label><span>目标俄罗斯仓</span><select value={mappingWarehouseId} onChange={(event) => setMappingWarehouseId(event.target.value)}><option value="">请选择俄罗斯仓</option>{payload?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label></div>
      <div className="ozon-mapping-table"><div className="head"><span>Ozon 商品</span><span>Ozon 标识</span><span>目标仓 SKU</span><span>操作</span></div>{mappingProducts.map((product) => {
        const key = `${product.storeId}:${product.offerId || product.ozonSku}`;
        const existing = payload?.skuMappings.find((mapping) => mapping.storeId === product.storeId && mapping.warehouseConnectionId === mappingWarehouseId && (mapping.offerId === product.offerId || (!mapping.offerId && mapping.ozonSku === product.ozonSku)));
        const draft = mappingDrafts[key] ?? existing?.wmsSku ?? "";
        return <div key={key}><span><strong>{product.productName || product.offerId}</strong><small>{product.storeName} · 涉及 {product.orderCount} 个订单</small></span><span><strong>{product.offerId || "—"}</strong><small>Ozon SKU {product.ozonSku || "—"}</small></span><span><input value={draft} onChange={(event) => setMappingDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder="精确填写 WMS SKU" /></span><span><button onClick={() => void saveMapping(product)} disabled={Boolean(busy) || !mappingWarehouseId || !draft.trim()}>{busy === `mapping:${key}` ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}保存</button></span></div>;
      })}{!mappingProducts.length ? <div className="ozon-empty">同步 Ozon 待处理订单后，这里会自动列出需要映射的商品。</div> : null}</div>
    </section> : null}

    {!loading && tab === "stores" && canConfigure ? <section className="ozon-panel">
      <header className="ozon-panel-head"><div><p className="eyebrow">SELLER AUTHORIZATION</p><h3>店铺授权</h3><span>每个店铺独立保存 Client-Id 与 Api-Key；密钥只保存在服务器，页面不会回传明文。</span></div></header>
      <div className="ozon-store-form"><label><span>店铺名称 *</span><input value={storeForm.name} onChange={(event) => setStoreForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 Ozon-SJJ旗舰店" /></label><label><span>Client-Id *</span><input value={storeForm.clientId} onChange={(event) => setStoreForm((current) => ({ ...current, clientId: event.target.value }))} placeholder="Ozon Seller Client ID" /></label><label><span>Api-Key {storeForm.id ? "（留空则不修改）" : "*"}</span><input type="password" value={storeForm.apiKey} onChange={(event) => setStoreForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="仅提交给中台服务器" /></label><button onClick={() => void saveStore()} disabled={Boolean(busy) || !storeForm.name || !storeForm.clientId || (!storeForm.id && !storeForm.apiKey)}>{busy === "save-store" ? <LoaderCircle className="spinning" size={16} /> : <KeyRound size={16} />}{storeForm.id ? "保存修改" : "添加店铺"}</button></div>
      <div className="ozon-store-list">{payload?.stores.map((store) => <article key={store.id}><header><div><strong>{store.name}</strong><small>{store.companyName || "待验证卖家主体"}</small></div><span className={`ozon-badge ${store.lastError ? "danger" : store.connectedAt ? "success" : "warning"}`}>{store.lastError ? "连接异常" : store.connectedAt ? "已授权" : "待测试"}</span></header><div><span><small>Client-Id</small><strong>{store.clientId}</strong></span><span><small>Api-Key</small><strong>{store.apiKeyMasked || "未配置"}</strong></span><span><small>卖家仓</small><strong>{store.ozonWarehouses.length}</strong></span><span><small>最近同步</small><strong>{dateTime(store.lastSyncedAt)}</strong></span></div>{store.lastError ? <p className="ozon-inline-error"><AlertTriangle size={14} />{store.lastError}</p> : null}<footer><button onClick={() => setStoreForm({ id: store.id, name: store.name, clientId: store.clientId, apiKey: "", enabled: store.enabled })}><Settings2 size={14} />编辑</button><button onClick={() => void storeAction(store, "test")} disabled={Boolean(busy)}>{busy === `test:${store.id}` ? <LoaderCircle className="spinning" size={14} /> : <ShieldCheck size={14} />}验证授权</button><button onClick={() => void storeAction(store, "sync")} disabled={Boolean(busy)}>{busy === `sync:${store.id}` ? <LoaderCircle className="spinning" size={14} /> : <RefreshCw size={14} />}同步订单</button><button className="danger" onClick={() => void storeAction(store, "delete")} disabled={Boolean(busy)}><Trash2 size={14} />删除</button></footer>{store.ozonWarehouses.length ? <section className="ozon-routes"><h4><Route size={16} />仓库路由</h4>{store.ozonWarehouses.map((warehouse) => <WarehouseRouteEditor key={warehouse.id} store={store} ozonWarehouse={warehouse} existing={payload.routes.find((route) => route.storeId === store.id && route.ozonWarehouseId === warehouse.id)} payload={payload} onSaved={accept} />)}</section> : <div className="ozon-store-hint">先点击“验证授权”，系统会读取该店铺的 Ozon 卖家仓，再分别绑定俄罗斯仓。</div>}</article>)}</div>
      {!payload?.stores.length ? <div className="ozon-empty"><Store />还没有 Ozon 店铺，请先填写上方授权信息。</div> : null}
    </section> : null}
  </div>;
}

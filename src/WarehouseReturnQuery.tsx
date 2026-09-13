import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  PackageOpen,
  PackageSearch,
  RefreshCw,
  Search,
  Truck,
  Warehouse,
  X,
  ZoomIn,
} from "lucide-react";
import {
  AuthUser,
  WarehouseReturnOrder,
  WarehouseReturnQueryPayload,
  WarehouseReturnQueryType,
  queryWarehouseReturns,
  resolveApiUrl,
} from "./api";

const queryTypeOptions: Array<{ value: WarehouseReturnQueryType; label: string; placeholder: string }> = [
  { value: "platform_order", label: "平台原订单号", placeholder: "输入平台后台订单号" },
  { value: "return_order", label: "WMS退货单号", placeholder: "输入仓库退货单号 / RMA号" },
  { value: "tracking", label: "退货物流单号", placeholder: "输入客户退回的物流单号" },
];

const statusTone: Record<string, string> = {
  in_transit: "info",
  received_pending: "warning",
  processing: "warning",
  restocked: "good",
  scrapped: "danger",
  mixed: "mixed",
  exception: "danger",
  cancelled: "muted",
};

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

function localDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return { from: localDate(start), to: localDate(end) };
}

function dateTime(value?: string) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
}

function quantity(value: number) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function queryRange(payload: WarehouseReturnQueryPayload) {
  if (payload.query?.dateFrom && payload.query?.dateTo) {
    const prefix = payload.query.dateRangeMode === "automatic" ? "系统自动：" : "";
    return `${prefix}${payload.query.dateFrom} 至 ${payload.query.dateTo}`;
  }
  return payload.method === "targeted" ? "精确单号定向查询" : "未使用时间范围";
}

function ticketDescription(order: WarehouseReturnOrder) {
  const itemLines = order.items.map((item) => `${item.sku}：应退${item.expectedQty}，实收${item.receivedQty}，上架${item.restockedQty}，报废${item.scrappedQty}`).join("；");
  return [
    `WMS退货状态：${order.statusLabel}`,
    `退货单号：${order.returnOrderNumber || "未提供"}`,
    `退货物流：${order.trackingNumber || "未提供"}`,
    `处理仓库：${order.warehouseName}`,
    itemLines ? `商品处理：${itemLines}` : "WMS未返回商品明细",
    "请仓库核实该退货单的收货、上架或报废处理情况。",
  ].join("\n");
}

export function WarehouseReturnQuery({ currentUser }: { currentUser: AuthUser }) {
  const [queryType, setQueryType] = React.useState<WarehouseReturnQueryType>("platform_order");
  const [query, setQuery] = React.useState("");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [showConditions, setShowConditions] = React.useState(false);
  const [payload, setPayload] = React.useState<WarehouseReturnQueryPayload | null>(null);
  const [selectedOrderId, setSelectedOrderId] = React.useState("");
  const [previewImage, setPreviewImage] = React.useState<{ src: string; title: string } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestRef = React.useRef<AbortController | null>(null);
  const selectedOrder = payload?.orders.find((order) => order.id === selectedOrderId) || payload?.orders[0] || null;
  const currentType = queryTypeOptions.find((item) => item.value === queryType) || queryTypeOptions[0];
  const canShowManualConditions = queryType !== "platform_order"
    || Boolean(payload?.needsInput && payload.requiredFields.includes("warehouseId"));

  React.useEffect(() => () => requestRef.current?.abort(), []);

  function applyRange(days: number) {
    const range = dateRange(days);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  async function runQuery(event?: React.FormEvent) {
    event?.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError(`请输入${currentType.label}。`);
      return;
    }
    if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
      setError("请同时填写查询开始和结束日期。");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await queryWarehouseReturns({ query: normalizedQuery, queryType, warehouseId, dateFrom, dateTo }, controller.signal);
      if (controller.signal.aborted) return;
      setPayload(result);
      setWarehouseId(result.query?.warehouseId || warehouseId);
      setSelectedOrderId(result.orders[0]?.id || "");
      if (result.needsInput) {
        setShowConditions(true);
        if (result.requiredFields.includes("dateRange") && (!dateFrom || !dateTo)) applyRange(30);
      }
    } catch (requestError) {
      if (controller.signal.aborted) return;
      setPayload(null);
      setError(requestError instanceof Error ? requestError.message : "WMS退货查询失败，请稍后重试。");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  function cancelQuery() {
    requestRef.current?.abort();
    requestRef.current = null;
    setLoading(false);
  }

  function createWarehouseTicket(order: WarehouseReturnOrder) {
    const params = new URLSearchParams({
      module: "tickets",
      view: "create",
      warehouseId: order.warehouseId,
      relatedOrder: order.originalOrderNumber || order.returnOrderNumber,
      category: "入库/上架问题",
      title: `核实退货单处理状态：${order.returnOrderNumber || order.originalOrderNumber}`,
      description: ticketDescription(order),
    });
    window.location.hash = `#after-sales?${params.toString()}`;
  }

  return <section className="warehouse-return-query">
    <header className="wrq-heading">
      <div>
        <p className="eyebrow">LIVE WMS RETURN LOOKUP</p>
        <h2>仓库退货状态查询</h2>
        <span>{queryType === "platform_order" ? "输入平台订单号即可，系统会自动判断仓库和查询时间。" : "需要看哪一单就查哪一单。结果直接来自仓库WMS，本系统不批量同步、不保存退货数据。"}</span>
      </div>
      <div className="wrq-live-badge"><RefreshCw size={18} /><span><strong>实时按需查询</strong><small>查询后不留存</small></span></div>
    </header>

    <form className="wrq-search-card" onSubmit={runQuery}>
      <div className="wrq-search-main">
        <label className="wrq-type-field">
          <span>查询类型</span>
          <select value={queryType} onChange={(event) => {
            setQueryType(event.target.value as WarehouseReturnQueryType);
            setPayload(null);
            setWarehouseId("");
            setDateFrom("");
            setDateTo("");
            setShowConditions(false);
          }}>
            {queryTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="wrq-query-field">
          <span>{currentType.label}</span>
          <div><Search size={19} /><input value={query} onChange={(event) => {
            setQuery(event.target.value);
            setPayload(null);
            setSelectedOrderId("");
            if (queryType === "platform_order") setWarehouseId("");
          }} placeholder={currentType.placeholder} autoComplete="off" /></div>
        </label>
        {loading ? <button className="wrq-cancel" type="button" onClick={cancelQuery}><X size={17} />取消查询</button> : <button className="wrq-submit" type="submit"><PackageSearch size={19} />查询WMS</button>}
      </div>
      {canShowManualConditions ? <div className="wrq-condition-toggle">
        <button type="button" onClick={() => setShowConditions((current) => !current)}><Warehouse size={15} />{showConditions ? "收起辅助条件" : queryType === "platform_order" ? "补选仓库" : "选择仓库和时间"}</button>
        <span>系统会先尝试自动识别；无法定位时再补充条件，不会扫描全部仓库。</span>
      </div> : null}
      {showConditions && canShowManualConditions ? <div className="wrq-conditions">
        <label><span>查询仓库</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">由系统自动识别</option>{(payload?.warehouseOptions || []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.country}</option>)}</select></label>
        {queryType !== "platform_order" ? <><label><span>开始日期</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label><span>结束日期</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        <div className="wrq-date-presets"><span>快捷范围</span><button type="button" onClick={() => applyRange(30)}>近30天</button><button type="button" onClick={() => applyRange(90)}>近90天</button><small>单次最多90天</small></div></> : null}
      </div> : null}
    </form>

    {loading ? <div className="wrq-loading"><LoaderCircle className="spinning" size={30} /><div><strong>正在向仓库WMS查询</strong><span>只处理当前订单，查询完成后不会保存退货数据。</span></div></div> : null}
    {error ? <div className="as-notice error"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={15} /></button></div> : null}
    {payload ? <div className={`wrq-result-notice ${payload.complete ? payload.orders.length ? "success" : "empty" : "warning"}`}>
      {payload.complete ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <div><strong>{payload.message}</strong><span>{payload.source ? `${payload.source.name} · ${payload.source.providerName} · 范围：${queryRange(payload)}` : "需要补充查询条件"}{payload.queriedAt ? ` · 查询于 ${dateTime(payload.queriedAt)}` : ""}{payload.pagesRead ? ` · 已核对 ${payload.pagesRead} 页` : ""}</span></div>
      {!payload.needsInput ? <button type="button" onClick={() => void runQuery()}><RefreshCw size={15} />重新查询</button> : null}
    </div> : null}

    {!loading && payload?.needsInput ? <div className="wrq-needs-input">
      <CalendarDays size={24} />
      <div><strong>再补充一点信息就能继续</strong><span>{payload.requiredFields.includes("warehouseId") && payload.requiredFields.includes("dateRange") ? "请选择实际接收退货的仓库和大致退货时间，建议先查近30天。" : payload.requiredFields.includes("warehouseId") ? "请选择实际接收退货的仓库。" : "请选择大致退货发生时间，建议先查近30天。"}</span></div>
      <button type="button" onClick={() => void runQuery()}>使用当前条件继续查询</button>
    </div> : null}

    {!loading && payload && !payload.needsInput && !payload.orders.length ? <div className="wrq-empty">
      <PackageOpen size={34} /><strong>{payload.complete ? "当前条件没有匹配的退货单" : "本次查询未能得出完整结论"}</strong><span>{payload.complete ? "请核对订单号，或更换查询类型后重试。" : "请缩小日期范围后重试，不能把本次结果理解为仓库没有退货。"}</span>
    </div> : null}

    {payload?.orders.length ? <div className="wrq-results-layout">
      <div className="wrq-result-list">
        {payload.orders.map((order) => <button type="button" className={selectedOrder?.id === order.id ? "active" : ""} key={order.id} onClick={() => setSelectedOrderId(order.id)}>
          <span className={`wrq-status ${statusTone[order.status] || "muted"}`}>{order.statusLabel}</span>
          <strong>{order.returnOrderNumber || "未提供退货单号"}</strong>
          <small>原订单：{order.originalOrderNumber || "WMS未返回"}</small>
          <small>{order.warehouseName} · 更新于 {dateTime(order.updatedAt)}</small>
        </button>)}
      </div>
      {selectedOrder ? <article className="wrq-detail">
        <header>
          <div><span className={`wrq-status ${statusTone[selectedOrder.status] || "muted"}`}>{selectedOrder.statusLabel}</span><h3>{selectedOrder.returnOrderNumber || "退货单"}</h3><p>原订单：{selectedOrder.originalOrderNumber || "WMS未返回"}</p></div>
          {hasPermission(currentUser, "warehouse_ticket_report") ? <button type="button" onClick={() => createWarehouseTicket(selectedOrder)}><ExternalLink size={16} />反馈异常</button> : null}
        </header>
        <div className="wrq-order-meta">
          <div><Warehouse size={17} /><span>处理仓库<em>{selectedOrder.warehouseName}</em></span></div>
          <div><Truck size={17} /><span>退货物流<em>{selectedOrder.logisticsCompany || "—"} {selectedOrder.trackingNumber || ""}</em></span></div>
          <div><CalendarDays size={17} /><span>仓库签收<em>{dateTime(selectedOrder.signedAt)}</em></span></div>
          <div><CheckCircle2 size={17} /><span>处理完成<em>{dateTime(selectedOrder.completedAt)}</em></span></div>
        </div>
        <div className="wrq-item-table">
          <div className="head"><span>退货商品</span><span>应退</span><span>实收</span><span>重新上架</span><span>报废</span><span>不良品</span><span>待处理</span></div>
          {selectedOrder.items.length ? selectedOrder.items.map((item) => <div className="row" key={item.id}>
            <div className="wrq-product">
              {item.imageUrl ? <button type="button" onClick={() => setPreviewImage({ src: resolveApiUrl(item.imageUrl), title: item.productName || item.sku })}><img src={resolveApiUrl(item.imageUrl)} alt={item.productName || item.sku} /><ZoomIn size={13} /></button> : <span><PackageOpen size={19} /></span>}
              <div><strong>{item.sku || "未返回SKU"}</strong><small>{item.productName || "产品名称待匹配"}</small>{item.handlingMethod ? <em>{item.handlingMethod}</em> : null}</div>
            </div>
            <strong>{quantity(item.expectedQty)}</strong><strong>{quantity(item.receivedQty)}</strong><strong className="good">{quantity(item.restockedQty)}</strong><strong className="danger">{quantity(item.scrappedQty)}</strong><strong>{quantity(item.badQty)}</strong><strong>{quantity(item.pendingQty)}</strong>
          </div>) : <div className="wrq-no-items">WMS已返回退货主单，但没有返回商品处理明细。</div>}
        </div>
        <footer><span>数据来源：{selectedOrder.providerName}</span><span>本次结果仅在当前页面展示，不会保存到中台。</span></footer>
      </article> : null}
    </div> : null}

    {previewImage ? <div className="wrq-image-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage(null)}><button type="button" onClick={() => setPreviewImage(null)}><X /></button><figure onClick={(event) => event.stopPropagation()}><img src={previewImage.src} alt={previewImage.title} /><figcaption>{previewImage.title}</figcaption></figure></div> : null}
  </section>;
}

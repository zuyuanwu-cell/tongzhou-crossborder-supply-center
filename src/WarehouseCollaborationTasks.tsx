import React from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CheckCircle2, ChevronRight, Clock3, Download,
  ExternalLink, FileText, LoaderCircle, PackageOpen, Plus, RefreshCw, Search, Send, Trash2, Warehouse, X,
} from "lucide-react";
import { AuthUser, resolveApiUrl } from "./api";
import {
  CollaborationTaskOptions, CollaborationTaskProduct, CollaborationWarehouseTask, CollaborationWarehouseTaskDetail,
  CollaborationWarehouseTaskStatus, CollaborationWarehouseTaskType, downloadCollaborationTaskAttachment,
  fetchCollaborationTaskOptions, fetchCollaborationWarehouseTask, fetchCollaborationWarehouseTasks,
  publishCollaborationWarehouseTask,
} from "./warehouse-collaboration-task-api";
import "./warehouse-collaboration-tasks.css";

const typeMeta: Record<string, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  warehouse_inbound: { label: "入库任务", icon: ArrowDownToLine },
  warehouse_outbound: { label: "出库任务", icon: ArrowUpFromLine },
  warehouse_stockup: { label: "备货任务", icon: Boxes },
  warehouse_exception: { label: "异常处理", icon: AlertTriangle },
  warehouse_transfer: { label: "调拨收货", icon: Warehouse },
};

const statusMeta: Record<CollaborationWarehouseTaskStatus, { label: string; tone: string }> = {
  pending: { label: "待接单", tone: "amber" },
  accepted: { label: "已接单", tone: "blue" },
  in_progress: { label: "处理中", tone: "blue" },
  pending_approval: { label: "待审批", tone: "violet" },
  pending_sync: { label: "待同步", tone: "violet" },
  completed: { label: "已完成", tone: "green" },
  rejected: { label: "已驳回", tone: "red" },
  cancelled: { label: "已取消", tone: "gray" },
};

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `cwt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ProductImage({ src, name }: { src?: string; name: string }) {
  return src ? <img className="cwt-product-image" src={resolveApiUrl(src)} alt={name} loading="lazy" /> : <span className="cwt-product-image empty"><PackageOpen size={20} /></span>;
}

function StatusPill({ status }: { status: CollaborationWarehouseTaskStatus }) {
  const meta = statusMeta[status] || { label: status, tone: "gray" };
  return <span className={`cwt-status ${meta.tone}`}>{meta.label}</span>;
}

type DraftLine = CollaborationTaskProduct & { plannedQuantity: number };

function TaskCreateDrawer({ options, onClose, onCreated }: {
  options: CollaborationTaskOptions;
  onClose(): void;
  onCreated(message: string): void;
}) {
  const [organizationCode, setOrganizationCode] = React.useState(options.organizations[0]?.code || "");
  const selectedOrganization = options.organizations.find((item) => item.code === organizationCode);
  const [warehouseRef, setWarehouseRef] = React.useState(selectedOrganization?.warehouses[0]?.resourceRef || "");
  const [itemType, setItemType] = React.useState<CollaborationWarehouseTaskType>("warehouse_inbound");
  const [referenceNo, setReferenceNo] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<"normal" | "urgent">("normal");
  const [dueAt, setDueAt] = React.useState("");
  const [productKeyword, setProductKeyword] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const organization = options.organizations.find((item) => item.code === organizationCode);
    if (!organization?.warehouses.some((item) => item.resourceRef === warehouseRef)) setWarehouseRef(organization?.warehouses[0]?.resourceRef || "");
  }, [organizationCode, options.organizations, warehouseRef]);

  const productMatches = React.useMemo(() => {
    const keyword = productKeyword.trim().toLowerCase();
    if (!keyword) return [];
    return options.products.filter((product) => !lines.some((line) => line.sku === product.sku)
      && `${product.sku} ${product.productName}`.toLowerCase().includes(keyword)).slice(0, 8);
  }, [options.products, lines, productKeyword]);

  function addLine(product: CollaborationTaskProduct) {
    setLines((current) => [...current, { ...product, plannedQuantity: 1 }]);
    setProductKeyword("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!organizationCode || !warehouseRef) return setError("请先选择协同组织和作业仓库。");
    if (!title.trim()) return setError("请填写任务标题。");
    if (!lines.length) return setError("请至少添加一个商品明细。");
    if (lines.some((line) => !Number.isFinite(line.plannedQuantity) || line.plannedQuantity <= 0)) return setError("任务数量必须大于 0。");
    if (itemType === "warehouse_outbound") {
      const insufficient = lines.find((line) => line.plannedQuantity > Number(line.availableByWarehouse[warehouseRef] || 0));
      if (insufficient) return setError(`${insufficient.sku} 的出库数量超过当前可用库存。`);
    }
    setBusy(true);
    try {
      const result = await publishCollaborationWarehouseTask({
        organizationCode,
        warehouseRef,
        itemType,
        referenceNo: referenceNo.trim(),
        title: title.trim(),
        description: description.trim(),
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : "",
        lines: lines.map((line) => ({ sku: line.sku, plannedQuantity: Number(line.plannedQuantity), unit: line.unit })),
      }, makeIdempotencyKey());
      const deliveryNote = result.delivery?.failed ? "任务已保存，协同服务恢复后会自动同步。" : "任务已发布到伙伴门户。";
      onCreated(`${deliveryNote} 中台任务号：${result.coreRefId}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布协同任务失败。");
    } finally {
      setBusy(false);
    }
  }

  return <div className="cwt-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="cwt-create-drawer" onSubmit={submit}>
      <header className="cwt-drawer-head"><div><p>NEW COLLABORATION TASK</p><h2>发布国内仓协同任务</h2><span>只向所选组织发布本任务及白名单商品字段。</span></div><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      <div className="cwt-form-grid">
        <label><span>协同组织</span><select value={organizationCode} onChange={(event) => { setOrganizationCode(event.target.value); setLines([]); }} required><option value="">请选择</option>{options.organizations.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select></label>
        <label><span>作业仓库</span><select value={warehouseRef} onChange={(event) => { setWarehouseRef(event.target.value); setLines([]); }} required><option value="">请选择</option>{selectedOrganization?.warehouses.map((item) => <option value={item.resourceRef} key={item.resourceRef}>{item.resourceName}</option>)}</select></label>
        <label><span>任务类型</span><select value={itemType} onChange={(event) => setItemType(event.target.value as CollaborationWarehouseTaskType)}><option value="warehouse_inbound">入库任务</option><option value="warehouse_outbound">出库任务</option><option value="warehouse_stockup">备货任务</option><option value="warehouse_exception">异常处理</option></select></label>
        <label><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "urgent")}><option value="normal">普通</option><option value="urgent">紧急</option></select></label>
        <label className="wide"><span>任务标题</span><input value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="例如：9 月 29 日到货入库" required /></label>
        <label><span>关联单号（可选）</span><input value={referenceNo} maxLength={120} onChange={(event) => setReferenceNo(event.target.value)} placeholder="采购单、销售单或内部单号" /></label>
        <label><span>要求完成时间（可选）</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <label className="wide"><span>作业说明（可选）</span><textarea rows={3} value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} placeholder="填写收货要求、发货要求、包装方式或异常处理说明" /></label>
      </div>
      <section className="cwt-line-builder">
        <header><div><h3>商品明细</h3><span>{lines.length} 个 SKU</span></div></header>
        <div className="cwt-product-search"><Search size={17} /><input value={productKeyword} onChange={(event) => setProductKeyword(event.target.value)} placeholder="输入 SKU 或商品名称后选择" /></div>
        {productMatches.length ? <div className="cwt-product-results">{productMatches.map((product) => <button type="button" key={product.sku} onClick={() => addLine(product)}><ProductImage src={product.imageUrl} name={product.productName} /><span><b>{product.productName}</b><small>{product.sku} · 本仓可用 {Number(product.availableByWarehouse[warehouseRef] || 0).toLocaleString()} {product.unit}</small></span><Plus size={17} /></button>)}</div> : null}
        <div className="cwt-draft-lines">{lines.map((line) => <article key={line.sku}><ProductImage src={line.imageUrl} name={line.productName} /><span><b>{line.productName}</b><small>{line.sku} · 可用 {Number(line.availableByWarehouse[warehouseRef] || 0).toLocaleString()} {line.unit}</small></span><label><em>任务数量</em><input type="number" min="0.0001" step="0.0001" value={line.plannedQuantity} onChange={(event) => setLines((current) => current.map((item) => item.sku === line.sku ? { ...item, plannedQuantity: Number(event.target.value) } : item))} /><i>{line.unit}</i></label><button type="button" onClick={() => setLines((current) => current.filter((item) => item.sku !== line.sku))} aria-label={`删除 ${line.sku}`}><Trash2 size={17} /></button></article>)}</div>
        {!lines.length ? <div className="cwt-lines-empty"><Boxes size={24} /><span>搜索并添加本次作业涉及的商品</span></div> : null}
      </section>
      {error ? <div className="cwt-alert error"><AlertTriangle size={17} />{error}</div> : null}
      <footer><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}发布给协同伙伴</button></footer>
    </form>
  </div>;
}

function TaskDetailDrawer({ task, onClose }: { task: CollaborationWarehouseTask; onClose(): void }) {
  const [detail, setDetail] = React.useState<CollaborationWarehouseTaskDetail | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const load = React.useCallback(async () => {
    setError("");
    try { setDetail(await fetchCollaborationWarehouseTask(task.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "任务详情加载失败。"); }
  }, [task.id]);
  React.useEffect(() => { void load(); }, [load]);
  const item = detail?.item || task;
  const activeStep = item.status === "pending" ? 0 : ["accepted", "in_progress"].includes(item.status) ? 1 : ["pending_approval", "pending_sync"].includes(item.status) ? 2 : item.status === "completed" ? 3 : 1;
  async function download(attachment: CollaborationWarehouseTaskDetail["attachments"][number]) {
    setBusy(attachment.id);
    setError("");
    try { await downloadCollaborationTaskAttachment(task.id, attachment.id, attachment.fileName); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "附件下载失败。"); }
    finally { setBusy(""); }
  }
  return <div className="cwt-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="cwt-detail-drawer">
    <header className="cwt-drawer-head"><div><p>{item.coreRefId}</p><h2>{item.title}</h2><span>{item.organizationName} · {item.publicPayload.warehouseName || item.publicPayload.warehouseRef}</span></div><button onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
    <div className="cwt-detail-body">
      <div className="cwt-detail-state"><StatusPill status={item.status} /><span>V{item.version}</span><button onClick={() => void load()}><RefreshCw size={15} />刷新</button></div>
      <section className={`cwt-progress ${["rejected", "cancelled"].includes(item.status) ? "stopped" : ""}`}>{["待伙伴接单", "仓库处理中", "中台确认", "任务完成"].map((label, index) => <div className={index <= activeStep ? "active" : ""} key={label}><span>{index + 1}</span><b>{label}</b></div>)}</section>
      <section className="cwt-facts"><div><span>任务类型</span><b>{typeMeta[item.itemType]?.label || item.itemType}</b></div><div><span>关联单号</span><b>{item.publicPayload.referenceNo || "—"}</b></div><div><span>截止时间</span><b>{formatDate(item.dueAt)}</b></div><div><span>最后同步</span><b>{formatDate(item.lastCoreSyncedAt || item.updatedAt)}</b></div></section>
      {item.description ? <section className="cwt-detail-section"><header><h3>作业说明</h3></header><p className="cwt-description">{item.description}</p></section> : null}
      <section className="cwt-detail-section"><header><h3>商品与处理数量</h3><span>{detail?.lines.length || 0} 个 SKU</span></header><div className="cwt-detail-lines">{detail?.lines.map((line) => <article key={line.id}><ProductImage src={line.imageUrl} name={line.productName} /><span><b>{line.productName}</b><small>{line.sku}{line.lotNo ? ` · 批次 ${line.lotNo}` : ""}</small></span><div><strong>{line.completedQuantity.toLocaleString()}</strong><small>/ {line.plannedQuantity.toLocaleString()} {line.unit}</small></div></article>)}</div></section>
      {detail?.attachments.length ? <section className="cwt-detail-section"><header><h3>伙伴上传凭证</h3><span>{detail.attachments.length} 个附件</span></header><div className="cwt-files">{detail.attachments.map((attachment) => <button key={attachment.id} disabled={busy === attachment.id || attachment.scanStatus !== "clean"} onClick={() => void download(attachment)}><FileText size={17} /><span><b>{attachment.fileName}</b><small>{attachment.scanStatus === "clean" ? `${Math.max(1, Math.ceil(attachment.sizeBytes / 1024))} KB` : "安全检查中"}</small></span>{busy === attachment.id ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}</button>)}</div></section> : null}
      {detail?.commands.length ? <section className="cwt-detail-section"><header><h3>伙伴提交与入账结果</h3></header><div className="cwt-command-list">{detail.commands.map((command) => <article key={command.id}><span className={`cwt-command-dot ${command.status}`} /><div><b>{command.resultMessage || command.commandType}</b><small>{command.coreReference ? `主账编号 ${command.coreReference} · ` : ""}{formatDate(command.submittedAt)}</small></div><em>{command.status}</em></article>)}</div></section> : null}
      <section className="cwt-detail-section"><header><h3>协同时间线</h3></header><div className="cwt-timeline">{detail?.events.map((event) => <article key={event.id}><span /><div><b>{event.actorName}</b><p>{event.body || event.eventType}</p><small>{formatDate(event.createdAt)}</small></div></article>)}</div></section>
      {error ? <div className="cwt-alert error"><AlertTriangle size={17} />{error}</div> : null}
    </div>
  </aside></div>;
}

export function WarehouseCollaborationTasks({ currentUser }: { currentUser: AuthUser }) {
  const canPublish = currentUser.permissions?.includes("collaboration_task_publish");
  const [options, setOptions] = React.useState<CollaborationTaskOptions | null>(null);
  const [items, setItems] = React.useState<CollaborationWarehouseTask[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [total, setTotal] = React.useState(0);
  const [organizationCode, setOrganizationCode] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [itemType, setItemType] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [selected, setSelected] = React.useState<CollaborationWarehouseTask | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextOptions, result] = await Promise.all([
        fetchCollaborationTaskOptions(),
        fetchCollaborationWarehouseTasks({ organizationCode, status, itemType, keyword: keyword.trim(), limit: 100 }),
      ]);
      setOptions(nextOptions);
      setItems(result.items || []);
      setCounts(result.counts || {});
      setTotal(result.total || 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "协同任务读取失败。");
    } finally {
      setLoading(false);
    }
  }, [organizationCode, status, itemType, keyword]);

  React.useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);

  const metrics = [
    { label: "待伙伴接单", value: counts.pending || 0, icon: Send },
    { label: "仓库处理中", value: (counts.accepted || 0) + (counts.in_progress || 0), icon: Clock3 },
    { label: "待中台确认", value: (counts.pending_approval || 0) + (counts.pending_sync || 0), icon: RefreshCw },
    { label: "已完成", value: counts.completed || 0, icon: CheckCircle2 },
  ];

  function openPortal() {
    if (!options?.portalUrl) return setError("伙伴门户地址尚未配置，请联系系统管理员。");
    window.open(options.portalUrl, "_blank", "noopener,noreferrer");
  }

  return <section className="cwt-center">
    <header className="cwt-page-head"><div><p>PARTNER WORK ORDERS</p><h2>协同任务</h2><span>从中台向国内仓发布任务，并在这里查看接单、处理、凭证和入账进度。</span></div><div><button className="secondary" onClick={openPortal}><ExternalLink size={17} />打开伙伴门户</button>{canPublish ? <button className="primary" onClick={() => setCreating(true)} disabled={!options?.organizations.length}><Plus size={18} />发布协同任务</button> : null}</div></header>
    <div className="cwt-summary">{metrics.map(({ label, value, icon: Icon }) => <article key={label}><Icon size={20} /><span>{label}</span><strong>{value}</strong></article>)}</div>
    <section className="cwt-panel">
      <div className="cwt-toolbar"><label><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务号、标题或关联单号" /></label><select value={organizationCode} onChange={(event) => setOrganizationCode(event.target.value)}><option value="">全部协同组织</option>{options?.organizations.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select><select value={itemType} onChange={(event) => setItemType(event.target.value)}><option value="">全部任务类型</option>{Object.entries(typeMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statusMeta).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}</select><button onClick={() => void load()} aria-label="刷新"><RefreshCw size={17} /></button></div>
      <div className="cwt-list-head"><span>共 {total} 个任务</span><small>进度来自独立协同门户，库存真值仍以中台主账为准。</small></div>
      {loading ? <div className="cwt-empty"><LoaderCircle className="spin" size={24} />正在读取协同任务…</div> : items.length ? <div className="cwt-task-list">{items.map((task) => { const TypeIcon = typeMeta[task.itemType]?.icon || Boxes; return <button key={task.id} onClick={() => setSelected(task)}><span className="cwt-type-icon"><TypeIcon size={20} /></span><span className="cwt-main-cell"><b>{task.title}</b><small>{task.coreRefId} · {task.organizationName}</small></span><span><b>{task.publicPayload.warehouseName || "未标记仓库"}</b><small>{task.publicPayload.referenceNo || "无关联单号"}</small></span><span><b>{typeMeta[task.itemType]?.label || task.itemType}</b><small>{task.priority === "urgent" ? "紧急" : formatDate(task.dueAt)}</small></span><StatusPill status={task.status} /><ChevronRight size={17} /></button>; })}</div> : <div className="cwt-empty"><Boxes size={26} />当前筛选范围内没有协同任务</div>}
    </section>
    {error ? <div className="cwt-alert error"><AlertTriangle size={17} />{error}</div> : null}
    {message ? <div className="cwt-alert success"><CheckCircle2 size={17} />{message}<button onClick={() => setMessage("")}><X size={15} /></button></div> : null}
    {creating && options ? <TaskCreateDrawer options={options} onClose={() => setCreating(false)} onCreated={(notice) => { setCreating(false); setMessage(notice); void load(); }} /> : null}
    {selected ? <TaskDetailDrawer task={selected} onClose={() => { setSelected(null); void load(); }} /> : null}
  </section>;
}

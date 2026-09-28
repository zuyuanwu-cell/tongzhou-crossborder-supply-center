import React from "react";
import {
  AlertTriangle, ArrowLeftRight, Bell, Boxes, Building2, Camera, Check, CheckCircle2,
  BadgeDollarSign, ChevronRight, CircleDot, Clock3, ClipboardCheck, Factory, FileCheck2, FileText, FlaskConical, Inbox, LayoutDashboard,
  LoaderCircle, LogOut, Menu, PackageCheck, RefreshCw, ScanLine, Search, ShieldCheck, Stamp,
  Truck, Upload, UserPlus, UserRound, Users, Warehouse, X, XCircle, Copy, KeyRound, Mail,
} from "lucide-react";
import {
  acceptInvitation, ApiError, changeOwnPassword, confirmPasswordReset, createMember, fetchDashboard, fetchInventory, fetchInvitations, fetchMe, fetchMembers, fetchNotifications, fetchWorkItem,
  fetchWorkItems, login, logout, markNotificationRead, requestPasswordReset, submitAction, submitOemArtifact, submitSupplierQuote, updateProductionMilestone, uploadAttachment,
  updateMember, updateOwnProfile, reissueInvitation, revokeInvitation,
} from "./api";
import type { Dashboard, InventoryItem, InvitationDeliveryResult, NotificationItem, OrganizationInvitation, OrganizationMember, OrganizationMemberRole, Session, TaskLine, WorkItem, WorkItemDetail, WorkItemStatus } from "./types";

type Route = "overview" | "tasks" | "inventory" | "notifications" | "members" | "account";
const routeMeta: Record<Route, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  overview: { label: "作业总览", icon: LayoutDashboard },
  tasks: { label: "协同任务", icon: ClipboardCheck },
  inventory: { label: "本仓库存", icon: Boxes },
  notifications: { label: "消息中心", icon: Bell },
  members: { label: "成员管理", icon: Users },
  account: { label: "账号安全", icon: UserRound },
};
const statusMeta: Record<WorkItemStatus, { label: string; tone: string }> = {
  pending: { label: "待接单", tone: "amber" }, accepted: { label: "已接单", tone: "blue" }, in_progress: { label: "处理中", tone: "blue" },
  pending_approval: { label: "待中台审批", tone: "violet" }, pending_sync: { label: "待同步", tone: "violet" }, completed: { label: "已完成", tone: "green" },
  rejected: { label: "已驳回", tone: "red" }, cancelled: { label: "已取消", tone: "gray" },
};
const itemTypeMeta: Record<string, { label: string; icon: React.ComponentType<{ size?: number }> }> = {
  warehouse_inbound: { label: "入库", icon: PackageCheck }, warehouse_outbound: { label: "出库", icon: Truck },
  warehouse_transfer: { label: "调拨", icon: ArrowLeftRight }, warehouse_stockup: { label: "备货", icon: Boxes }, warehouse_exception: { label: "异常", icon: AlertTriangle },
  filing_task: { label: "备案", icon: Stamp }, sampling_task: { label: "打样", icon: FlaskConical }, packaging_quote: { label: "包装报价", icon: BadgeDollarSign }, production_order: { label: "生产工单", icon: Factory },
};

function formatDate(value: string, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(new Date(value));
}
function fullDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function useRoute() {
  const read = () => (Object.keys(routeMeta).includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview") as Route;
  const [route, setRoute] = React.useState<Route>(read);
  React.useEffect(() => { const listener = () => setRoute(read()); window.addEventListener("hashchange", listener); return () => window.removeEventListener("hashchange", listener); }, []);
  const navigate = React.useCallback((next: Route) => { location.hash = next; setRoute(next); }, []);
  return [route, navigate] as const;
}

function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose(): void }) {
  React.useEffect(() => { const timer = setTimeout(onClose, 4500); return () => clearTimeout(timer); }, [onClose]);
  return <div className={`toast ${tone}`}>{tone === "success" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}<span>{message}</span><button onClick={onClose} aria-label="关闭"><X size={16} /></button></div>;
}

function LoginPage({ onLogin, onForgot }: { onLogin(session: Session): void; onForgot(): void }) {
  const [form, setForm] = React.useState({ username: "", password: "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await login(form); onLogin(result.session); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story">
      <div className="brand-lockup"><span className="brand-mark"><Boxes size={25} /></span><span><b>同舟</b><small>TONGZHOU COLLABORATION</small></span></div>
      <div className="story-copy">
        <p className="kicker">ONE TASK · ONE BOUNDARY</p>
        <h1>每一件货，<br />都有清晰的<span>交接线。</span></h1>
        <p>面向仓库、服务商和委外工厂的安全协作工作台。你只会看到本组织被授权参与的任务与资料。</p>
      </div>
      <div className="route-ribbon" aria-hidden="true"><span>中台发布</span><i /><span>组织接单</span><i /><span>凭证回传</span><i /><span>主账确认</span></div>
      <div className="login-safety"><ShieldCheck size={18} /><span><b>组织级数据隔离</b> · 全程操作留痕 · 登录保护与账号锁定</span></div>
    </section>
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-card-head"><p>PARTNER ACCESS</p><h2>伙伴登录</h2><span>请输入管理员分配的账号和密码</span></div>
        <label><span>账号</span><input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="请输入登录账号" required /></label>
        <label><span>密码</span><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="至少 12 位" required /></label>
        {error ? <div className="form-error"><AlertTriangle size={16} />{error}</div> : null}
        <button className="primary-action login-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={19} /> : <ChevronRight size={19} />}{busy ? "正在验证…" : "进入协同门户"}</button>
        <button type="button" className="login-help" onClick={onForgot}>忘记密码？发送安全重置邮件</button>
      </form>
      <p className="portal-version">SECURE PARTNER PORTAL · V1</p>
    </section>
  </main>;
}

function CredentialFlowPage({ mode, token = "", onDone }: { mode: "invite" | "reset" | "request"; token?: string; onDone(): void }) {
  const [form, setForm] = React.useState({ username: "", displayName: "", password: "", confirm: "" });
  const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState(""); const [success, setSuccess] = React.useState("");
  const title = mode === "invite" ? "激活伙伴账号" : mode === "reset" ? "设置新密码" : "找回密码";
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "request") { await requestPasswordReset(form.username); setSuccess("如果账号信息匹配，重置邮件将在几分钟内送达。"); }
      else {
        if (form.password !== form.confirm) throw new Error("两次输入的密码不一致。");
        if (mode === "invite") await acceptInvitation(token, form.displayName, form.password);
        else await confirmPasswordReset(token, form.password);
        setSuccess(mode === "invite" ? "账号已激活，请返回登录。" : "密码已更新，其他会话均已撤销。");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败，请稍后重试。"); }
    finally { setBusy(false); }
  }
  return <main className="credential-page"><section className="credential-card"><span className="brand-mark"><ShieldCheck size={25} /></span><p className="kicker">SECURE ACCOUNT FLOW</p><h1>{title}</h1><p>{mode === "invite" ? "完成账号资料并设置至少 12 位、同时包含字母和数字的密码。" : mode === "reset" ? "新密码生效后，所有已登录设备会被安全退出。" : "输入登录账号；无论账号是否存在，页面都不会暴露注册状态。"}</p>
    {success ? <div className="credential-success"><CheckCircle2 size={20} /><span>{success}</span><button className="primary-action" onClick={onDone}>返回登录</button></div> : <form onSubmit={submit}>{mode === "request" ? <label><span>账号</span><input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label> : <>{mode === "invite" ? <label><span>姓名</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label> : null}<label><span>新密码</span><input type="password" autoComplete="new-password" minLength={12} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label><label><span>确认新密码</span><input type="password" autoComplete="new-password" minLength={12} value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} required /></label></>}{error ? <div className="form-error"><AlertTriangle size={16} />{error}</div> : null}<button className="primary-action" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}{mode === "request" ? "发送重置邮件" : "安全确认"}</button><button type="button" className="credential-back" onClick={onDone}>返回登录</button></form>}
  </section></main>;
}

function StatusPill({ status }: { status: WorkItemStatus }) { const meta = statusMeta[status]; return <span className={`status-pill ${meta.tone}`}><CircleDot size={12} />{meta.label}</span>; }
function TaskType({ type }: { type: string }) { const meta = itemTypeMeta[type] || { label: "任务", icon: ClipboardCheck }; const Icon = meta.icon; return <span className="task-type"><Icon size={15} />{meta.label}</span>; }

function MetricCard({ label, value, note, icon: Icon, tone = "ink" }: { label: string; value: React.ReactNode; note: string; icon: React.ComponentType<{ size?: number }>; tone?: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-icon"><Icon size={22} /></div><p>{label}</p><strong>{value}</strong><span>{note}</span></article>;
}

function TaskCard({ item, onOpen }: { item: WorkItem; onOpen(item: WorkItem): void }) {
  const oem = ["filing_task", "sampling_task", "packaging_quote", "production_order"].includes(item.itemType);
  return <button className={`task-card ${item.priority === "urgent" ? "urgent" : ""}`} onClick={() => onOpen(item)}>
    <div className="task-card-top"><TaskType type={item.itemType} /><StatusPill status={item.status} /></div>
    <h3>{item.title}</h3><p>{item.description}</p>
    <div className="task-route"><span>{oem ? item.publicPayload.projectCode : (item.publicPayload.sourceWarehouseName || "供应链中台")}</span><ChevronRight size={14} /><span>{oem ? item.publicPayload.productName : (item.publicPayload.destinationWarehouseName || item.publicPayload.warehouseName)}</span></div>
    <footer><span><Clock3 size={14} />截止 {formatDate(item.dueAt)}</span><span>{item.publicPayload.referenceNo || item.publicPayload.documentVersion || `V${item.version}`}<ChevronRight size={16} /></span></footer>
  </button>;
}

function OverviewPage({ onOpenTask, onNavigate }: { onOpenTask(item: WorkItem): void; onNavigate(route: Route): void }) {
  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [tasks, setTasks] = React.useState<WorkItem[]>([]);
  React.useEffect(() => { Promise.all([fetchDashboard(), fetchWorkItems()]).then(([summary, work]) => { setDashboard(summary.dashboard); setTasks(work.items.slice(0, 4)); }); }, []);
  return <div className="page-stack">
    <section className="work-brief"><div><p className="kicker">TODAY'S HANDOFF</p><h1>今天，把每一次交接<br />做得<strong>清楚、准确、有回音。</strong></h1></div><div className="sync-stamp"><RefreshCw size={18} /><span>库存最近同步<b>{dashboard?.inventorySyncedAt ? formatDate(dashboard.inventorySyncedAt) : "同步中"}</b></span></div></section>
    <section className="metric-grid"><MetricCard label="进行中任务" value={dashboard?.openTasks ?? "—"} note="本组织待处理" icon={ClipboardCheck} /><MetricCard label="紧急任务" value={dashboard?.urgentTasks ?? "—"} note="请优先处理" icon={AlertTriangle} tone="amber" /><MetricCard label="等待中台" value={dashboard?.waitingTasks ?? "—"} note="已提交，勿重复操作" icon={RefreshCw} tone="violet" /><MetricCard label="可见 SKU" value={dashboard?.inventorySkuCount ?? "—"} note="仅限本仓范围" icon={Boxes} tone="green" /></section>
    <section className="section-block"><header><div><p className="kicker">ACTIVE QUEUE</p><h2>当前作业队列</h2></div><button className="text-action" onClick={() => onNavigate("tasks")}>查看全部 <ChevronRight size={16} /></button></header><div className="task-grid">{tasks.map((item) => <TaskCard key={item.id} item={item} onOpen={onOpenTask} />)}</div></section>
    <section className="safety-banner"><div className="safety-symbol"><ShieldCheck size={28} /></div><div><b>你正处于“{tasks[0]?.publicPayload.warehouseName || "本组织"}”数据边界</b><span>页面、搜索、附件和库存均只包含当前组织被授权的数据；所有操作会记录操作者与时间。</span></div></section>
  </div>;
}

function TasksPage({ onOpenTask }: { onOpenTask(item: WorkItem): void }) {
  const [items, setItems] = React.useState<WorkItem[]>([]); const [status, setStatus] = React.useState(""); const [keyword, setKeyword] = React.useState(""); const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(() => { setLoading(true); fetchWorkItems({ status, keyword }).then((value) => setItems(value.items)).finally(() => setLoading(false)); }, [status, keyword]);
  React.useEffect(load, [load]);
  return <div className="page-stack"><section className="page-title"><div><p className="kicker">WORK ITEMS</p><h1>协同任务</h1><span>接单、执行、回传凭证，并跟踪中台处理结果。</span></div><button className="secondary-action" onClick={load}><RefreshCw size={17} />刷新</button></section>
    <section className="filter-bar"><label className="search-field"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务、单号" /></label><div className="filter-chips">{[["","全部"],["pending","待接单"],["in_progress","处理中"],["pending_sync","待同步"],["completed","已完成"]].map(([value,label]) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{label}</button>)}</div></section>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" /><span>正在读取本组织任务…</span></div> : items.length ? <div className="task-grid wide">{items.map((item) => <TaskCard key={item.id} item={item} onOpen={onOpenTask} />)}</div> : <div className="empty-state"><Inbox size={42} /><h3>当前没有匹配任务</h3><p>任务由内部供应链中台发布到你的组织。</p></div>}
  </div>;
}

function InventoryPage() {
  const [items, setItems] = React.useState<InventoryItem[]>([]); const [keyword, setKeyword] = React.useState(""); const [loading, setLoading] = React.useState(true);
  React.useEffect(() => { const timer = setTimeout(() => { setLoading(true); fetchInventory(keyword).then((value) => setItems(value.items)).finally(() => setLoading(false)); }, 180); return () => clearTimeout(timer); }, [keyword]);
  return <div className="page-stack"><section className="page-title"><div><p className="kicker">WAREHOUSE SNAPSHOT</p><h1>本仓库存</h1><span>只读库存投影；实际主账以内部供应链中台为准。</span></div><div className="scope-badge"><ShieldCheck size={16} />组织范围已锁定</div></section>
    <section className="filter-bar"><label className="search-field"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU 或商品名称" /></label><span className="table-count">{items.length} 个 SKU</span></section>
    <section className="inventory-table-wrap">{loading ? <div className="loading-state"><LoaderCircle className="spin" />同步库存视图…</div> : <table className="inventory-table"><thead><tr><th>商品 / SKU</th><th>可用</th><th>锁定</th><th>在途</th><th>同步时间</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.warehouseRef}:${item.sku}`}><td><b>{item.productName}</b><code>{item.sku}</code></td><td><strong>{item.availableQuantity.toLocaleString()}</strong> {item.unit}</td><td>{item.lockedQuantity.toLocaleString()}</td><td className={item.inTransitQuantity ? "in-transit" : ""}>{item.inTransitQuantity.toLocaleString()}</td><td>{formatDate(item.lastCoreSyncedAt)}</td></tr>)}</tbody></table>}</section>
  </div>;
}

function NotificationsPage({ onOpenTask }: { onOpenTask(id: string): void }) {
  const [items, setItems] = React.useState<NotificationItem[]>([]); React.useEffect(() => { fetchNotifications().then((value) => setItems(value.items)); }, []);
  async function open(item: NotificationItem) { if (!item.readAt) { await markNotificationRead(item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)); } if (item.workItemId) onOpenTask(item.workItemId); }
  return <div className="page-stack"><section className="page-title"><div><p className="kicker">INBOX</p><h1>消息中心</h1><span>站内消息是协同通知的权威记录。</span></div></section><section className="message-list">{items.map((item) => <button key={item.id} className={!item.readAt ? "unread" : ""} onClick={() => open(item)}><span className="message-dot" /><div><b>{item.title}</b><p>{item.body}</p><small>{fullDate(item.createdAt)}</small></div><ChevronRight size={18} /></button>)}</section></div>;
}

function OemWorkspace({ detail, busy, setBusy, reload, onChanged, notify, files }: {
  detail: WorkItemDetail; busy: boolean; setBusy(value: boolean): void; reload(): Promise<void>; onChanged(): void;
  notify(message: string, tone: "success" | "error"): void; files: FileList | null;
}) {
  const item = detail.item;
  const [quote, setQuote] = React.useState({ currency: item.publicPayload.quoteCurrency || "CNY", amount: "", minimumOrderQuantity: String(item.publicPayload.quantity || ""), leadTimeDays: "", terms: "" });
  const [artifact, setArtifact] = React.useState({ title: "", summary: "", result: "pending" });
  const isReady = !["pending", "pending_sync", "pending_approval", "completed", "rejected", "cancelled"].includes(item.status);

  async function complete(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await operation();
      if (files?.length) for (const file of Array.from(files)) await uploadAttachment(item.id, file);
      notify(success, "success");
      await reload();
      onChanged();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "提交失败", "error"); }
    finally { setBusy(false); }
  }

  if (item.itemType === "packaging_quote") return <section className="drawer-section oem-panel">
    <header><div><h3>密封报价</h3><span>仅贵司与供应链中台可见，其他包装厂不可见</span></div><ShieldCheck size={18} /></header>
    {detail.oem?.quotes?.length ? <div className="submitted-record"><CheckCircle2 size={18} /><div><b>已提交 V{detail.oem.quotes[0].version}</b><span>{detail.oem.quotes[0].currency} {detail.oem.quotes[0].amount.toLocaleString()} · 交期 {detail.oem.quotes[0].leadTimeDays} 天 · {detail.oem.quotes[0].status}</span></div></div> : null}
    <div className="oem-form-grid"><label><span>币种</span><input value={quote.currency} maxLength={3} onChange={(event) => setQuote({ ...quote, currency: event.target.value.toUpperCase() })} /></label><label><span>报价金额</span><input type="number" min="0" step="0.01" value={quote.amount} onChange={(event) => setQuote({ ...quote, amount: event.target.value })} /></label><label><span>最小起订量</span><input type="number" min="0" value={quote.minimumOrderQuantity} onChange={(event) => setQuote({ ...quote, minimumOrderQuantity: event.target.value })} /></label><label><span>交期（天）</span><input type="number" min="0" value={quote.leadTimeDays} onChange={(event) => setQuote({ ...quote, leadTimeDays: event.target.value })} /></label></div>
    <textarea value={quote.terms} onChange={(event) => setQuote({ ...quote, terms: event.target.value })} placeholder="报价条款、打样费、版费、付款条件等" rows={3} />
    <button className="primary-action inline-submit" disabled={busy || !isReady || !quote.amount || !quote.leadTimeDays} onClick={() => complete(() => submitSupplierQuote(item.id, item.version, { currency: quote.currency, amount: Number(quote.amount), minimumOrderQuantity: Number(quote.minimumOrderQuantity || 0), leadTimeDays: Number(quote.leadTimeDays), terms: quote.terms }), "密封报价已提交，等待中台比价定标")}><BadgeDollarSign size={18} />确认并提交报价</button>
    <p className="sensitive-hint"><ShieldCheck size={14} />提交报价时，系统会校验组织权限、任务版本和数据边界。</p>
  </section>;

  if (item.itemType === "production_order") return <section className="drawer-section oem-panel">
    <header><div><h3>生产里程碑</h3><span>关键数量、材料和交期变更需由中台重新发布版本</span></div><Factory size={18} /></header>
    <div className="milestone-list">{(detail.oem?.milestones || []).map((milestone) => <article key={milestone.id}><span className={`milestone-state ${milestone.status}`}><CircleDot size={13} />{milestone.status}</span><div><b>{milestone.title}</b><small>计划 {fullDate(milestone.plannedAt)}{milestone.publicPayload.note ? ` · ${milestone.publicPayload.note}` : ""}</small></div><div className="milestone-actions"><button disabled={busy || !isReady} onClick={() => complete(() => updateProductionMilestone(milestone.id, item.version, { status: "in_progress", note: "生产已启动" }), "生产进度已提交")}>开始</button><button disabled={busy || !isReady} onClick={() => complete(() => updateProductionMilestone(milestone.id, item.version, { status: "completed", note: "里程碑已完成" }), "里程碑已完成")}>完成</button></div></article>)}</div>
  </section>;

  const artifactType = item.itemType === "filing_task" ? "filing_document" : "sample_result";
  return <section className="drawer-section oem-panel">
    <header><div><h3>{item.itemType === "filing_task" ? "备案资料回传" : "打样结果回传"}</h3><span>资料与修改轮次按版本保存，不覆盖历史记录</span></div><FileText size={18} /></header>
    <div className="artifact-history">{(detail.oem?.artifacts || []).map((entry) => <div key={entry.id}><FileCheck2 size={16} /><span><b>{entry.title}</b><small>V{entry.version} · {entry.status} · {entry.publicPayload.result}</small></span></div>)}</div>
    <div className="oem-form-grid"><label className="span-two"><span>资料标题</span><input value={artifact.title} onChange={(event) => setArtifact({ ...artifact, title: event.target.value })} placeholder={item.itemType === "filing_task" ? "例如：备案申报资料 V1" : "例如：第一轮样品结果"} /></label><label><span>结果</span><select value={artifact.result} onChange={(event) => setArtifact({ ...artifact, result: event.target.value })}><option value="pending">待确认</option><option value="passed">通过</option><option value="failed">未通过</option><option value="revision_required">需修改</option></select></label></div>
    <textarea value={artifact.summary} onChange={(event) => setArtifact({ ...artifact, summary: event.target.value })} placeholder="填写结果摘要、修改建议或补充说明" rows={3} />
    <button className="primary-action inline-submit" disabled={busy || !isReady || !artifact.title} onClick={() => complete(() => submitOemArtifact(item.id, item.version, { artifactType, title: artifact.title, artifactVersion: (detail.oem?.artifacts?.[0]?.version || 0) + 1, publicPayload: { summary: artifact.summary, result: artifact.result } }), "资料版本已提交，等待中台审核")}><FileCheck2 size={18} />提交资料版本</button>
  </section>;
}

function TaskDetailDrawer({ item, onClose, onChanged, notify }: { item: WorkItem; onClose(): void; onChanged(): void; notify(message: string, tone: "success" | "error"): void }) {
  const [detail, setDetail] = React.useState<WorkItemDetail | null>(null); const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState(""); const [files, setFiles] = React.useState<FileList | null>(null);
  const load = React.useCallback(() => fetchWorkItem(item.id).then((value) => setDetail(value)), [item.id]); React.useEffect(() => { load(); }, [load]);
  async function act(action: string, extra: Record<string, unknown> = {}) { if (!detail) return; setBusy(true); try { await submitAction(item.id, detail.item.version, { action, note, ...extra }); if (files?.length) for (const file of Array.from(files)) await uploadAttachment(item.id, file); notify(action === "accept" ? "任务已接单" : "操作已提交，等待中台确认", "success"); await load(); onChanged(); } catch (reason) { notify(reason instanceof Error ? reason.message : "操作失败", "error"); } finally { setBusy(false); } }
  const actionable = detail && !["completed", "cancelled", "rejected", "pending_sync", "pending_approval"].includes(detail.item.status);
  const lines = detail?.lines || [];
  const isOem = ["filing_task", "sampling_task", "packaging_quote", "production_order"].includes(item.itemType);
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="task-drawer">
    <header className="drawer-head"><button className="icon-button" onClick={onClose}><X size={20} /></button><div><TaskType type={item.itemType} /><h2>{item.title}</h2><span>{item.publicPayload.referenceNo || item.publicPayload.projectCode}</span></div><StatusPill status={detail?.item.status || item.status} /></header>
    {!detail ? <div className="loading-state grow"><LoaderCircle className="spin" />正在加载任务详情…</div> : <div className="drawer-body">
      <section className="task-facts"><div><span>{isOem ? "定制项目" : "协作仓库"}</span><b>{isOem ? detail.item.publicPayload.projectCode : detail.item.publicPayload.warehouseName}</b></div><div><span>{isOem ? "产品 / 规格" : "截止时间"}</span><b>{isOem ? `${detail.item.publicPayload.productName || "—"}${detail.item.publicPayload.productSpec ? ` · ${detail.item.publicPayload.productSpec}` : ""}` : fullDate(detail.item.dueAt)}</b></div><div><span>当前版本</span><b>V{detail.item.version}</b></div><div><span>{isOem ? "要求交期" : "主账同步"}</span><b>{isOem ? (detail.item.publicPayload.deliveryDate || fullDate(detail.item.dueAt)) : formatDate(detail.item.lastCoreSyncedAt)}</b></div></section>
      {!isOem ? <section className="drawer-section"><header><h3>作业明细</h3><span>{lines.length} 个 SKU</span></header><div className="line-list">{lines.map((line: TaskLine) => <div key={line.id}><span className="line-index">{String(lines.indexOf(line) + 1).padStart(2, "0")}</span><div><b>{line.productName}</b><code>{line.sku}</code><small>{line.lotNo ? `批次 ${line.lotNo}` : "批次待确认"}{line.barcode ? ` · ${line.barcode}` : ""}</small></div><strong>{line.plannedQuantity.toLocaleString()}<em>{line.unit}</em></strong></div>)}</div></section> : <section className="oem-brief"><span>对外发布内容</span><p>{detail.item.description || detail.item.publicPayload.requirements || "请按已发布版本完成协同。"}</p><small>资料版本 {detail.item.publicPayload.documentVersion || `V${detail.item.version}`} · 数量 {Number(detail.item.publicPayload.quantity || 0).toLocaleString()} {detail.item.publicPayload.unit || "件"}</small></section>}
      <section className="drawer-section"><header><h3>处理说明与凭证</h3><span>写入后不可删除审计记录</span></header>{!isOem ? <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写到货情况、差异或处理说明…" rows={3} /> : null}<label className="upload-zone"><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/csv" onChange={(event) => setFiles(event.target.files)} /><Camera size={22} /><span><b>{files?.length ? `已选择 ${files.length} 个文件` : "拍照或选择附件"}</b><small>图片、PDF、CSV，单个不超过 50MB</small></span><Upload size={18} /></label></section>
      {isOem ? <OemWorkspace detail={detail} busy={busy} setBusy={setBusy} reload={load} onChanged={onChanged} notify={notify} files={files} /> : null}
      <section className="drawer-section timeline"><header><h3>协同记录</h3></header>{detail.events.map((event) => <div className="timeline-row" key={event.id}><span /><div><b>{event.actorName}</b><p>{event.body || event.eventType}</p><small>{fullDate(event.createdAt)}</small></div></div>)}</section>
    </div>}
    {detail ? <footer className="drawer-actions">{detail.item.status === "pending" ? <button className="primary-action" disabled={busy} onClick={() => act("accept")}><Check size={18} />接受任务</button> : null}{!isOem && actionable && detail.item.status !== "pending" ? <><button className="danger-action" disabled={busy || !note} onClick={() => act("report_exception", { category: "warehouse_operation" })}><AlertTriangle size={17} />上报异常</button><button className="primary-action" disabled={busy || !lines.length} onClick={() => act(detail.item.itemType === "warehouse_transfer" ? "transfer_receive" : detail.item.itemType === "warehouse_inbound" ? "inbound_confirm" : "outbound_confirm", { lines: lines.map((line) => ({ sku: line.sku, quantity: line.plannedQuantity, lotNo: line.lotNo, barcode: line.barcode, productionDate: line.productionDate, expiryDate: line.expiryDate })) })}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileCheck2 size={18} />}确认完成并回传</button></> : null}{!actionable && detail.item.status !== "pending" ? <div className="waiting-note"><RefreshCw size={17} /><span>当前操作已提交，请等待中台处理；无需重复操作。</span></div> : null}</footer> : null}
  </aside></div>;
}

function AccountPage({ session, onSessionChange, notify }: { session: Session; onSessionChange(session: Session): void; notify(message: string, tone: "success" | "error"): void }) {
  const [profile, setProfile] = React.useState({ displayName: session.user.displayName, email: session.user.email, currentPassword: "" });
  const [password, setPassword] = React.useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = React.useState("");
  async function refreshSession() { const refreshed = await fetchMe(); onSessionChange(refreshed.session); }
  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setBusy("profile");
    try {
      await updateOwnProfile(profile);
      setProfile((value) => ({ ...value, currentPassword: "" }));
      await refreshSession();
      notify("账号资料已更新", "success");
    } catch (reason) { notify(reason instanceof Error ? reason.message : "账号资料更新失败", "error"); }
    finally { setBusy(""); }
  }
  async function savePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy("password");
    try {
      if (password.newPassword !== password.confirm) throw new Error("两次输入的新密码不一致。");
      await changeOwnPassword({ currentPassword: password.currentPassword, newPassword: password.newPassword });
      setPassword({ currentPassword: "", newPassword: "", confirm: "" });
      await refreshSession();
      notify("密码已更新，其他设备的登录会话已退出", "success");
    } catch (reason) { notify(reason instanceof Error ? reason.message : "密码修改失败", "error"); }
    finally { setBusy(""); }
  }
  return <div className="page-stack account-page">
    <section className="page-title"><div><p className="kicker">ACCOUNT SECURITY</p><h1>账号安全</h1><span>维护自己的姓名、找回邮箱和登录密码。</span></div><div className="scope-badge"><ShieldCheck size={16} />会话受保护</div></section>
    <section className="account-email-note"><Mail size={20} /><div><b>{session.user.email ? "找回邮箱已设置" : "建议补充找回邮箱"}</b><span>{session.user.email ? `密码重置邮件将发送到 ${session.user.email}` : "邮箱不是开户必填项；补充后可在登录页自行找回密码。"}</span></div></section>
    <div className="account-grid">
      <form className="account-card" onSubmit={saveProfile}><header><UserRound size={20} /><div><h2>个人资料</h2><p>更改邮箱需要验证当前密码。</p></div></header><label><span>登录账号</span><input value={session.user.username} disabled /></label><label><span>姓名</span><input value={profile.displayName} maxLength={120} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} required /></label><label><span>找回邮箱（可选）</span><input type="email" autoComplete="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} placeholder="用于自行找回密码" /></label><label><span>当前密码</span><input type="password" autoComplete="current-password" value={profile.currentPassword} onChange={(event) => setProfile({ ...profile, currentPassword: event.target.value })} required /></label><button className="primary-action" disabled={busy === "profile"}>{busy === "profile" ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存资料</button></form>
      <form className="account-card" onSubmit={savePassword}><header><KeyRound size={20} /><div><h2>修改密码</h2><p>新密码生效后，其他设备会自动退出。</p></div></header><label><span>当前密码</span><input type="password" autoComplete="current-password" value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} required /></label><label><span>新密码</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} placeholder="至少 12 位，包含字母和数字" required /></label><label><span>确认新密码</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} required /></label><button className="primary-action" disabled={busy === "password"}>{busy === "password" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}更新密码</button></form>
    </div>
  </div>;
}

const memberRoleLabels: Record<OrganizationMemberRole, string> = { organization_admin: "组织管理员", manager: "业务经理", operator: "操作员", finance: "财务", viewer: "只读成员" };

type ProvisionedAccess = { organizationName: string; username: string; password: string; portalUrl: string };

function accountHandoffText(access: ProvisionedAccess) {
  return `您好，已为您开通同舟伙伴协同账号。\n伙伴登录网址：${access.portalUrl}\n组织名称：${access.organizationName}\n登录账号：${access.username}\n登录密码：${access.password}\n收到后可直接登录；邮箱可登录后在“账号安全”中补充，用于找回密码。`;
}

function MembersPage({ session, notify }: { session: Session; notify(message: string, tone: "success" | "error"): void }) {
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = React.useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [activation, setActivation] = React.useState<InvitationDeliveryResult | null>(null);
  const [provisionedAccess, setProvisionedAccess] = React.useState<ProvisionedAccess | null>(null);
  const emptyMemberForm = { username: "", displayName: "", email: "", password: "", confirm: "", role: "operator" as OrganizationMemberRole };
  const [form, setForm] = React.useState(emptyMemberForm);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [memberPayload, invitationPayload] = await Promise.all([fetchMembers(), fetchInvitations()]);
      setMembers(memberPayload.members || []);
      setInvitations(invitationPayload.invitations || []);
    } catch (reason) { notify(reason instanceof Error ? reason.message : "成员信息读取失败", "error"); }
    finally { setLoading(false); }
  }, [notify]);
  React.useEffect(() => { void load(); }, [load]);

  async function runSensitive(id: string, run: () => Promise<unknown>, success: string) {
    setBusy(id);
    try {
      await run();
      notify(success, "success");
      await load();
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "操作失败", "error");
      return false;
    } finally { setBusy(""); }
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();
    if (form.password !== form.confirm) { notify("两次输入的登录密码不一致", "error"); return; }
    setBusy("invite");
    try {
      const access = { organizationName: session.organization.name, username: form.username, password: form.password, portalUrl: window.location.origin };
      await createMember({ username: form.username, displayName: form.displayName || undefined, email: form.email, password: form.password, role: form.role, mfaRequired: false });
      setProvisionedAccess(access);
      setForm(emptyMemberForm);
      notify("成员账号已创建，可一键复制完整开户文案", "success");
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "成员账号创建失败", "error");
    } finally { setBusy(""); }
  }

  async function renew(invitation: OrganizationInvitation) {
    setBusy(invitation.id);
    try {
      const result = await reissueInvitation(invitation.id);
      setActivation(result);
      notify(result.delivery?.sent ? "激活邮件已重新发送" : "邀请已重签，请复制新激活链接", "success");
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "邀请重发失败", "error");
    } finally { setBusy(""); }
  }

  const activeCount = members.filter((member) => member.status === "active").length;
  const emailCount = members.filter((member) => Boolean(member.email)).length;
  const signedInCount = members.filter((member) => Boolean(member.lastLoginAt)).length;
  return <div className="page-stack member-admin-page">
    <section className="page-title"><div><p className="kicker">ORGANIZATION ACCESS</p><h1>成员管理</h1><span>只管理“{session.organization.name}”成员；其他合作组织不会出现在列表或搜索中。</span></div><div className="scope-badge"><ShieldCheck size={16} />组织边界已锁定</div></section>
    <section className="member-metrics"><article><Users size={20} /><div><strong>{activeCount}</strong><span>有效成员</span></div></article><article><Mail size={20} /><div><strong>{emailCount}</strong><span>已留找回邮箱</span></div></article><article><KeyRound size={20} /><div><strong>{signedInCount}</strong><span>已登录成员</span></div></article></section>
    {provisionedAccess ? <section className="member-credential"><header><div><CheckCircle2 size={20} /><span><b>账号已创建，可直接发给伙伴</b><small>登录密码只在本页临时保留；关闭或刷新后不再显示。</small></span></div><button type="button" onClick={() => setProvisionedAccess(null)} aria-label="关闭开户文案"><X size={17} /></button></header><pre>{accountHandoffText(provisionedAccess)}</pre><button className="primary-action" type="button" onClick={async () => { try { await navigator.clipboard.writeText(accountHandoffText(provisionedAccess)); notify("开户文案已复制", "success"); } catch { notify("复制失败，请手动选择文案复制", "error"); } }}><Copy size={17} />一键复制开户文案</button></section> : null}
    {activation?.activationUrl ? <section className="activation-strip"><div><KeyRound size={20} /><span><b>一次性激活链接</b><small>48 小时有效，仅在本次创建或重签后显示。</small></span></div><code>{activation.activationUrl}</code><button onClick={async () => { await navigator.clipboard.writeText(activation.activationUrl || ""); notify("激活链接已复制", "success"); }}><Copy size={16} />复制</button></section> : null}
    <section className="member-layout">
      <form className="invite-panel" onSubmit={submitInvite}><header><span><UserPlus size={19} /></span><div><h2>新增成员账号</h2><p>管理员分配账号和登录密码；成员收到后可直接进入工作区。</p></div></header><label><span>登录账号</span><input required minLength={3} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.replace(/[^A-Za-z0-9._-]/g, "") })} placeholder="例如 inbound.operator" /></label><label><span>成员姓名（可选）</span><input maxLength={120} autoComplete="off" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="未填写时使用登录账号" /></label><label><span>成员邮箱（可选）</span><input type="email" autoComplete="off" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="可由成员登录后补充" /></label><label><span>登录密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="至少 12 位，包含字母和数字" /></label><label><span>确认登录密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} /></label><label><span>组织角色</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as OrganizationMemberRole })}>{Object.entries(memberRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button className="primary-action" disabled={busy === "invite"}>{busy === "invite" ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}创建成员账号</button><p className="secure-footnote"><ShieldCheck size={13} />登录密码立即哈希，不写入日志；页面只临时保留本次开户文案，角色与停用变更均进入审计记录。</p></form>
      <section className="member-list-panel"><header><div><p className="kicker">ACTIVE MEMBERS</p><h2>组织成员</h2></div><button className="secondary-action" onClick={() => void load()}><RefreshCw size={16} />刷新</button></header>{loading ? <div className="loading-state"><LoaderCircle className="spin" />正在读取成员…</div> : <div className="member-list">{members.map((member) => <article key={member.id} className={member.status === "disabled" ? "disabled" : ""}><span className="member-avatar">{member.displayName.slice(0, 1)}</span><div className="member-identity"><b>{member.displayName}{member.id === session.membership.id ? <em>当前账号</em> : null}</b><small>{member.username} · {member.email || "未留邮箱"}</small><span>{member.lastLoginAt ? `最近登录 ${fullDate(member.lastLoginAt)}` : "尚未登录"}</span></div><select aria-label={`${member.displayName}的角色`} value={member.role} disabled={busy === member.id || member.id === session.membership.id} onChange={(event) => void runSensitive(member.id, () => updateMember(member.id, { role: event.target.value as OrganizationMemberRole }), "成员角色已更新")}>{Object.entries(memberRoleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className={`member-state-action ${member.status === "active" ? "danger" : ""}`} disabled={busy === member.id || member.id === session.membership.id} onClick={() => void runSensitive(member.id, () => updateMember(member.id, { status: member.status === "active" ? "disabled" : "active" }), member.status === "active" ? "成员已停用，会话已撤销" : "成员已重新启用")}>{member.status === "active" ? "停用" : "启用"}</button></article>)}</div>}</section>
    </section>
    {invitations.length ? <section className="invitation-panel"><header><div><p className="kicker">LEGACY INVITATIONS</p><h2>历史邀请记录</h2></div><span>{invitations.length} 条</span></header><div className="invitation-list">{invitations.map((invitation) => <article key={invitation.id}><div><b>{invitation.username}</b><span>{invitation.email || "未留邮箱"}</span></div><div><b>{memberRoleLabels[invitation.role]}</b><span>账号密码登录</span></div><div><b>{invitation.status === "pending" ? "待激活" : invitation.status === "accepted" ? "已激活" : "已失效"}</b><span>{invitation.status === "pending" ? `有效期至 ${fullDate(invitation.expiresAt)}` : fullDate(invitation.acceptedAt || invitation.expiresAt)}</span></div><div>{invitation.status !== "accepted" ? <button disabled={busy === invitation.id} onClick={() => void renew(invitation)}>重发</button> : null}{invitation.status === "pending" ? <button className="danger" disabled={busy === invitation.id} onClick={() => void runSensitive(invitation.id, () => revokeInvitation(invitation.id), "邀请已撤销")}>撤销</button> : null}</div></article>)}</div></section> : null}
  </div>;
}

function AppShell({ session, onSessionChange, onLogout }: { session: Session; onSessionChange(session: Session): void; onLogout(): void }) {
  const [route, navigate] = useRoute(); const [mobileNav, setMobileNav] = React.useState(false); const [selected, setSelected] = React.useState<WorkItem | null>(null); const [toast, setToast] = React.useState<{ message: string; tone: "success" | "error" } | null>(null); const [refreshKey, setRefreshKey] = React.useState(0);
  const canManageMembers = session.membership.role === "organization_admin";
  const showToast = React.useCallback((message: string, tone: "success" | "error") => setToast({ message, tone }), []);
  React.useEffect(() => { if (route === "members" && !canManageMembers) navigate("overview"); }, [route, canManageMembers, navigate]);
  async function openTaskById(id: string) { try { const detail = await fetchWorkItem(id); setSelected(detail.item); } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "任务不存在", tone: "error" }); } }
  const visibleRoutes = (Object.entries(routeMeta) as Array<[Route, typeof routeMeta[Route]]>).filter(([key]) => key !== "members" || canManageMembers);
  const mobileRoutes = visibleRoutes.filter(([key]) => key !== "account");
  const page = route === "overview" ? <OverviewPage key={refreshKey} onOpenTask={setSelected} onNavigate={navigate} /> : route === "tasks" ? <TasksPage key={refreshKey} onOpenTask={setSelected} /> : route === "inventory" ? <InventoryPage key={refreshKey} /> : route === "members" && canManageMembers ? <MembersPage session={session} notify={showToast} /> : route === "account" ? <AccountPage session={session} onSessionChange={onSessionChange} notify={showToast} /> : <NotificationsPage key={refreshKey} onOpenTask={openTaskById} />;
  return <div className="portal-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="sidebar-brand"><span><Boxes size={23} /></span><div><b>同舟协同</b><small>PARTNER PORTAL</small></div></div><div className="org-card"><span><Building2 size={17} /></span><div><small>当前组织</small><b>{session.organization.name}</b><code>{session.organization.code}</code></div><ShieldCheck size={17} /></div><nav>{visibleRoutes.map(([key, meta]) => { const Icon = meta.icon; return <button key={key} className={route === key ? "active" : ""} onClick={() => { navigate(key); setMobileNav(false); }}><Icon size={20} /><span>{meta.label}</span>{key === "notifications" ? <i /> : null}</button>; })}</nav><div className="sidebar-scope"><ShieldCheck size={18} /><div><b>数据边界已锁定</b><span>仅访问本组织资料</span></div></div><button className="profile-card" onClick={() => navigate("account")}><span><UserRound size={19} /></span><div><b>{session.user.displayName}</b><small>{session.user.email || "未设置找回邮箱"}</small></div><ChevronRight size={17} /></button><button className="sidebar-logout" onClick={onLogout}><LogOut size={16} />退出登录</button></aside>
    {mobileNav ? <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="关闭导航" /> : null}
    <main className="main-stage"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div><span>{routeMeta[route].label}</span><small>组织级安全协同 · {session.organization.code}</small></div><div className="topbar-actions"><button onClick={() => navigate("notifications")} aria-label="消息"><Bell size={19} /><i /></button><span className="online-mark"><i />在线</span></div></header><div className="page-content">{page}</div></main>
    <nav className={`mobile-tabs ${canManageMembers ? "with-members" : ""}`}>{mobileRoutes.map(([key, meta]) => { const Icon = meta.icon; return <button key={key} className={route === key ? "active" : ""} onClick={() => navigate(key)}><Icon size={21} /><span>{meta.label.slice(0, 2)}</span></button>; })}</nav>
    {selected ? <TaskDetailDrawer item={selected} onClose={() => setSelected(null)} onChanged={() => setRefreshKey((key) => key + 1)} notify={(message, tone) => setToast({ message, tone })} /> : null}
    {toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </div>;
}

export function App() {
  const [session, setSession] = React.useState<Session | null>(null); const [loading, setLoading] = React.useState(true);
  const initialCredential = React.useMemo(() => { const query = new URLSearchParams(location.search); return query.get("invite") ? { mode: "invite" as const, token: query.get("invite") || "" } : query.get("reset") ? { mode: "reset" as const, token: query.get("reset") || "" } : null; }, []);
  const [credentialFlow, setCredentialFlow] = React.useState<{ mode: "invite" | "reset" | "request"; token: string } | null>(initialCredential);
  React.useEffect(() => { fetchMe().then((value) => setSession(value.session)).catch((reason) => { if (!(reason instanceof ApiError) || reason.status !== 401) console.warn(reason); }).finally(() => setLoading(false)); }, []);
  if (credentialFlow) return <CredentialFlowPage mode={credentialFlow.mode} token={credentialFlow.token} onDone={() => { history.replaceState({}, "", location.pathname); setCredentialFlow(null); }} />;
  if (loading) return <main className="boot-screen"><span className="brand-mark"><Boxes size={26} /></span><LoaderCircle className="spin" /><b>正在建立安全工作区</b><small>VERIFYING ORGANIZATION BOUNDARY</small></main>;
  if (!session) return <LoginPage onLogin={setSession} onForgot={() => setCredentialFlow({ mode: "request", token: "" })} />;
  return <AppShell session={session} onSessionChange={setSession} onLogout={() => logout().finally(() => setSession(null))} />;
}

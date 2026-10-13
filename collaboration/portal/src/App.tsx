import React from "react";
import {
  AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Bell, Boxes, Building2, CalendarDays, Camera, Check, CheckCircle2,
  BadgeDollarSign, ChevronRight, CircleDot, Clock3, ClipboardCheck, Factory, FileCheck2, FileText, FlaskConical, Inbox, LayoutDashboard,
  LoaderCircle, LockKeyhole, LogOut, MapPin, Menu, PackageCheck, Plus, ReceiptText, RefreshCw, Ruler, Scale, ScanLine, Search, ShieldCheck, Stamp,
  Trash2, Truck, Upload, UserPlus, UserRound, Users, Warehouse, X, XCircle, Copy, KeyRound, Mail,
} from "lucide-react";
import {
  acceptInvitation, ApiError, changeOwnPassword, confirmPasswordReset, createMember, createWarehouseOperation, fetchDashboard, fetchInventory, fetchInvitations, fetchMe, fetchMembers, fetchNotifications, fetchWorkItem,
  fetchWorkItems, login, logout, markNotificationRead, requestPasswordReset, submitAction, submitOemArtifact, submitPartnerOrderReport, submitSupplierQuote, uploadAttachment,
  updateMember, updateOwnProfile, reissueInvitation, revokeInvitation,
} from "./api";
import type { Dashboard, InventoryItem, InvitationDeliveryResult, NotificationItem, OrganizationInvitation, OrganizationMember, OrganizationMemberRole, Session, TaskLine, WarehouseOperationLine, WarehouseOperationType, WorkItem, WorkItemDetail, WorkItemStatus } from "./types";

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
  filing_task: { label: "备案", icon: Stamp }, sampling_task: { label: "打样", icon: FlaskConical }, packaging_quote: { label: "包装报价", icon: BadgeDollarSign }, production_order: { label: "加工单", icon: Factory }, purchase_order: { label: "采购单", icon: PackageCheck },
};

function organizationMode(session: Session) {
  if (session.organization.type === "production_factory") return "production";
  if (["material_supplier", "packaging_factory"].includes(session.organization.type)) return "procurement";
  return "warehouse";
}

function routeLabel(session: Session, route: Route) {
  if (route !== "tasks") return routeMeta[route].label;
  const mode = organizationMode(session);
  return mode === "production" ? "加工与采购" : mode === "procurement" ? "采购协同" : "协同任务";
}

function formatDate(value: string, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(date);
}
function fullDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
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
  const oem = ["filing_task", "sampling_task", "packaging_quote", "production_order", "purchase_order"].includes(item.itemType);
  return <button className={`task-card ${item.priority === "urgent" ? "urgent" : ""}`} onClick={() => onOpen(item)}>
    <div className="task-card-top"><TaskType type={item.itemType} /><StatusPill status={item.status} /></div>
    <h3>{item.title}</h3><p>{item.description}</p>
    <div className="task-route"><span>{oem ? (item.publicPayload.orderNo || item.publicPayload.projectCode) : (item.publicPayload.sourceWarehouseName || "供应链中台")}</span><ChevronRight size={14} /><span>{oem ? item.publicPayload.productName : (item.publicPayload.destinationWarehouseName || item.publicPayload.warehouseName)}</span></div>
    <footer><span><Clock3 size={14} />截止 {formatDate(item.dueAt)}</span><span>{item.publicPayload.referenceNo || item.publicPayload.orderNo || item.publicPayload.documentVersion || `V${item.version}`}<ChevronRight size={16} /></span></footer>
  </button>;
}

type OverviewFocus = "all" | "normal" | "urgent" | "overdue" | "dueSoon" | "unscheduled" | `day:${string}`;
const terminalWorkItemStatuses = new Set<WorkItemStatus>(["completed", "rejected", "cancelled"]);

function workItemDeadline(item: WorkItem) {
  const raw = item.dueAt || (typeof item.publicPayload.deliveryDate === "string" ? item.publicPayload.deliveryDate : "");
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function deadlineClass(item: WorkItem, now = new Date()) {
  const deadline = workItemDeadline(item);
  if (!deadline) return "unscheduled" as const;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const dayDifference = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  if (dayDifference < 0) return "overdue" as const;
  if (dayDifference <= 7) return "dueSoon" as const;
  return "scheduled" as const;
}

function orderRiskLabel(item: WorkItem) {
  const deadline = workItemDeadline(item);
  const classification = deadlineClass(item);
  if (classification === "overdue" && deadline) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    return `已逾期 ${Math.max(1, Math.ceil((start.getTime() - dueDay.getTime()) / 86400000))} 天`;
  }
  if (classification === "dueSoon" && deadline) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
    const days = Math.max(0, Math.round((dueDay.getTime() - start.getTime()) / 86400000));
    return days === 0 ? "今天到期" : `${days} 天后到期`;
  }
  return classification === "unscheduled" ? "未设置交期" : `交期 ${formatDate(deadline?.toISOString() || "", false)}`;
}

function PriorityControlBoard({ tasks, focus, entityLabel, onFocus }: { tasks: WorkItem[]; focus: OverviewFocus; entityLabel: string; onFocus(focus: OverviewFocus): void }) {
  const overdue = tasks.filter((item) => deadlineClass(item) === "overdue");
  const urgent = tasks.filter((item) => item.priority === "urgent" && deadlineClass(item) !== "overdue");
  const standard = Math.max(0, tasks.length - overdue.length - urgent.length);
  const total = Math.max(1, tasks.length);
  const overdueEnd = overdue.length / total * 100;
  const urgentEnd = overdueEnd + urgent.length / total * 100;
  const ringStyle = { background: `conic-gradient(#c23c2a 0 ${overdueEnd}%, #f45b0b ${overdueEnd}% ${urgentEnd}%, #2451a4 ${urgentEnd}% 100%)` };
  const rows: Array<{ key: OverviewFocus; label: string; count: number; tone: string }> = [
    { key: "overdue", label: "已经逾期", count: overdue.length, tone: "danger" },
    { key: "urgent", label: "紧急优先", count: urgent.length, tone: "signal" },
    { key: "normal", label: "常规进行", count: standard, tone: "ink" },
  ];
  return <section className="priority-board control-panel">
    <header><div><p className="kicker">ORDER PRIORITY</p><h2>订单优先级</h2></div><span>{tasks.length} 个进行中{entityLabel}</span></header>
    <div className="priority-visual">
      <button className={`priority-ring ${focus === "all" ? "selected" : ""}`} style={ringStyle} onClick={() => onFocus("all")} aria-label={`查看全部 ${tasks.length} 个${entityLabel}`}><span><strong>{tasks.length}</strong><small>进行中</small></span></button>
      <div className="priority-legend">{rows.map((row) => <button key={row.key} className={focus === row.key ? "selected" : ""} onClick={() => onFocus(row.key)}><i className={row.tone} /><span>{row.label}</span><strong>{row.count}</strong><ChevronRight size={15} /></button>)}</div>
    </div>
  </section>;
}

function DeliveryControlBoard({ tasks, focus, entityLabel, onFocus, onOpenTask }: { tasks: WorkItem[]; focus: OverviewFocus; entityLabel: string; onFocus(focus: OverviewFocus): void; onOpenTask(item: WorkItem): void }) {
  const today = React.useMemo(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }, []);
  const buckets = React.useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today); date.setDate(today.getDate() + index);
    const key = localDayKey(date);
    const items = tasks.filter((item) => { const deadline = workItemDeadline(item); return deadline ? localDayKey(deadline) === key : false; });
    return { date, key, items, urgent: items.filter((item) => item.priority === "urgent").length };
  }), [tasks, today]);
  const overdue = tasks.filter((item) => deadlineClass(item) === "overdue");
  const dueSoon = tasks.filter((item) => deadlineClass(item) === "dueSoon");
  const unscheduled = tasks.filter((item) => deadlineClass(item) === "unscheduled");
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.items.length));
  const selectedTasks = focus.startsWith("day:") ? buckets.find((bucket) => `day:${bucket.key}` === focus)?.items || [] : focus === "overdue" ? overdue : focus === "dueSoon" ? dueSoon : focus === "unscheduled" ? unscheduled : focus === "normal" ? tasks.filter((item) => item.priority === "normal" && deadlineClass(item) !== "overdue") : tasks.filter((item) => item.priority === "urgent");
  const riskItems = [...selectedTasks].sort((a, b) => {
    const rank = (entry: WorkItem) => deadlineClass(entry) === "overdue" ? 0 : deadlineClass(entry) === "dueSoon" ? 1 : entry.priority === "urgent" ? 2 : deadlineClass(entry) === "unscheduled" ? 4 : 3;
    const rankDifference = rank(a) - rank(b);
    if (rankDifference) return rankDifference;
    return (workItemDeadline(a)?.getTime() || Number.MAX_SAFE_INTEGER) - (workItemDeadline(b)?.getTime() || Number.MAX_SAFE_INTEGER);
  }).slice(0, 4);
  return <section className="delivery-board control-panel">
    <header><div><p className="kicker">14-DAY DELIVERY</p><h2>14 天交期时间轴</h2></div><span>点击日期查看对应{entityLabel}</span></header>
    <div className="deadline-alerts">
      <button className={`deadline-alert danger ${focus === "overdue" ? "selected" : ""}`} onClick={() => onFocus("overdue")}><AlertTriangle size={19} /><span><b>{overdue.length}</b><small>逾期{entityLabel}</small></span></button>
      <button className={`deadline-alert warning ${focus === "dueSoon" ? "selected" : ""}`} onClick={() => onFocus("dueSoon")}><Clock3 size={19} /><span><b>{dueSoon.length}</b><small>7 天内到期</small></span></button>
      <button className={`deadline-alert neutral ${focus === "unscheduled" ? "selected" : ""}`} onClick={() => onFocus("unscheduled")}><CalendarDays size={19} /><span><b>{unscheduled.length}</b><small>待补交期</small></span></button>
    </div>
    <div className="delivery-timeline" role="group" aria-label="未来十四天订单交期分布">{buckets.map((bucket, index) => <button key={bucket.key} className={focus === `day:${bucket.key}` ? "selected" : ""} onClick={() => onFocus(`day:${bucket.key}`)} title={`${bucket.key}：${bucket.items.length} 个${entityLabel}`}>
      <span className="timeline-bar"><i style={{ height: `${Math.max(bucket.items.length ? 18 : 3, bucket.items.length / maxCount * 100)}%` }} />{bucket.urgent ? <em>{bucket.urgent}</em> : null}</span>
      <b>{bucket.date.getDate()}</b><small>{index === 0 ? "今天" : new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(bucket.date)}</small>
    </button>)}</div>
    <div className="risk-order-list"><div className="risk-list-head"><b>{focus === "overdue" ? "逾期订单" : focus === "dueSoon" ? "即将到期" : focus === "unscheduled" ? "未设交期" : focus === "normal" ? "常规进行" : focus.startsWith("day:") ? "当日交期" : "优先关注"}</b><span>{selectedTasks.length} 个{entityLabel}</span></div>{riskItems.length ? riskItems.map((item) => <button key={item.id} onClick={() => onOpenTask(item)}><span className={`risk-marker ${deadlineClass(item)}`} /><span><b>{item.title}</b><small>{item.publicPayload.orderNo || item.publicPayload.referenceNo || item.publicPayload.projectCode || itemTypeMeta[item.itemType]?.label}</small></span><strong>{orderRiskLabel(item)}</strong><ChevronRight size={16} /></button>) : <div className="risk-empty"><CheckCircle2 size={18} />当前筛选没有风险订单</div>}</div>
  </section>;
}

function OverviewPage({ session, onOpenTask, onNavigate }: { session: Session; onOpenTask(item: WorkItem): void; onNavigate(route: Route): void }) {
  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const [tasks, setTasks] = React.useState<WorkItem[]>([]);
  const [stockupDetails, setStockupDetails] = React.useState<WorkItemDetail[]>([]);
  const [focus, setFocus] = React.useState<OverviewFocus>("all");
  const mode = organizationMode(session);
  React.useEffect(() => { Promise.all([fetchDashboard(), fetchWorkItems({ limit: 100 })]).then(async ([summary, work]) => { setDashboard(summary.dashboard); setTasks(work.items); if (mode === "warehouse") { const details = await Promise.all(work.items.filter((item) => item.itemType === "warehouse_stockup").slice(0, 12).map((item) => fetchWorkItem(item.id).catch(() => null))); setStockupDetails(details.filter(Boolean) as WorkItemDetail[]); } }); }, [mode]);
  const stockupTasks = tasks.filter((item) => item.itemType === "warehouse_stockup");
  const waitingProducts = stockupDetails.filter((detail) => ["pending", "accepted", "in_progress"].includes(detail.item.status)).flatMap((detail) => detail.lines.map((line) => ({ item: detail.item, line })));
  const funnel = [
    { label: "待签收", value: stockupTasks.filter((item) => item.status === "pending").length, tone: "orange" },
    { label: "验货中", value: stockupTasks.filter((item) => ["accepted", "in_progress"].includes(item.status)).length, tone: "blue" },
    { label: "待中台", value: stockupTasks.filter((item) => ["pending_approval", "pending_sync"].includes(item.status)).length, tone: "violet" },
    { label: "已完结", value: stockupTasks.filter((item) => item.status === "completed").length, tone: "green" },
  ];
  const submittedRoutes = stockupDetails.flatMap((detail) => detail.commands.flatMap((command) => Array.isArray(command.payload?.routes) ? command.payload.routes as Array<{ routeType?: string; lines?: Array<{ quantity?: number }> }> : []));
  const routeTotals = submittedRoutes.reduce((totals, route) => ({ ...totals, [route.routeType || "hold"]: Number(totals[route.routeType || "hold"] || 0) + (route.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0) }), {} as Record<string, number>);
  const routeTotal = Object.values(routeTotals).reduce((sum, value) => sum + value, 0);
  const submittedExpenses = stockupDetails.flatMap((detail) => detail.commands.flatMap((command) => Array.isArray(command.payload?.expenses) ? command.payload.expenses as Array<{ category?: string; amountCny?: number }> : []));
  const expenseTotals = submittedExpenses.reduce((totals, expense) => ({ ...totals, [expense.category || "其他"]: Number(totals[expense.category || "其他"] || 0) + Number(expense.amountCny || 0) }), {} as Record<string, number>);
  const entityLabel = mode === "warehouse" ? "任务" : "订单";
  const activeTasks = tasks.filter((item) => !terminalWorkItemStatuses.has(item.status));
  const dueSoonCount = activeTasks.filter((item) => deadlineClass(item) === "dueSoon").length;
  const focusedTasks = activeTasks.filter((item) => {
    if (focus === "all") return true;
    if (focus === "normal") return item.priority === "normal" && deadlineClass(item) !== "overdue";
    if (focus === "urgent") return item.priority === "urgent" && deadlineClass(item) !== "overdue";
    if (focus === "overdue" || focus === "dueSoon" || focus === "unscheduled") return deadlineClass(item) === focus;
    if (focus.startsWith("day:")) { const deadline = workItemDeadline(item); return deadline ? localDayKey(deadline) === focus.slice(4) : false; }
    return true;
  }).sort((a, b) => {
    const priorityDifference = (a.priority === "urgent" ? 0 : 1) - (b.priority === "urgent" ? 0 : 1);
    if (priorityDifference) return priorityDifference;
    return (workItemDeadline(a)?.getTime() || Number.MAX_SAFE_INTEGER) - (workItemDeadline(b)?.getTime() || Number.MAX_SAFE_INTEGER);
  });
  if (mode !== "warehouse") return <div className="page-stack">
    <section className="work-brief"><div><p className="kicker">TODAY'S HANDOFF</p><h1>{mode === "production" ? "加工、采购、打样与异常，" : "交期、备货和发运，"}<br />都要<strong>清楚、准确、有回音。</strong></h1></div><div className="sync-stamp"><RefreshCw size={18} /><span>订单状态<b>实时留痕</b></span></div></section>
    <section className="metric-grid">{mode === "production" ? <><MetricCard label="在产加工单" value={dashboard?.productionOrders ?? "—"} note="仅本组织订单" icon={Factory} /><MetricCard label="物料采购单" value={dashboard?.purchaseOrders ?? "—"} note="兼任供应商订单" icon={PackageCheck} tone="green" /><MetricCard label="临期订单" value={dueSoonCount} note="7 天内到期" icon={Clock3} tone="amber" /><MetricCard label="异常记录" value={dashboard?.exceptionReports ?? "—"} note="需持续跟进" icon={AlertTriangle} tone="violet" /></> : <><MetricCard label="采购单" value={dashboard?.purchaseOrders ?? "—"} note="仅本组织订单" icon={PackageCheck} /><MetricCard label="临期交付" value={dueSoonCount} note="7 天内到期" icon={Clock3} tone="amber" /><MetricCard label="异常记录" value={dashboard?.exceptionReports ?? "—"} note="需持续跟进" icon={AlertTriangle} tone="violet" /><MetricCard label="等待中台" value={dashboard?.waitingTasks ?? "—"} note="提交后自动同步" icon={RefreshCw} tone="green" /></>}</section>
    <section className="overview-control-grid"><PriorityControlBoard tasks={activeTasks} focus={focus} entityLabel={entityLabel} onFocus={setFocus} /><DeliveryControlBoard tasks={activeTasks} focus={focus} entityLabel={entityLabel} onFocus={setFocus} onOpenTask={onOpenTask} /></section>
    <section className="section-block"><header><div><p className="kicker">ACTIVE QUEUE</p><h2>{focus === "all" ? "当前作业队列" : "筛选后的优先队列"}</h2><span className="section-subtitle">{focusedTasks.length} 个{entityLabel}{focus !== "all" ? " · 点击上方“进行中”圆环恢复全部" : ""}</span></div><button className="text-action" onClick={() => onNavigate("tasks")}>查看全部 <ChevronRight size={16} /></button></header>{focusedTasks.length ? <div className="task-grid">{focusedTasks.slice(0, 6).map((entry) => <TaskCard key={entry.id} item={entry} onOpen={onOpenTask} />)}</div> : <div className="compact-empty"><CheckCircle2 size={22} /><span>当前筛选下没有待处理{entityLabel}</span></div>}</section>
    <section className="safety-banner"><div className="safety-symbol"><ShieldCheck size={28} /></div><div><b>你正处于“{session.organization.name || "本组织"}”数据边界</b><span>页面、搜索、附件和订单均只包含当前组织被授权的数据；所有操作会记录操作者与时间。</span></div></section>
  </div>;
  return <div className="page-stack">
    <section className="work-brief warehouse-brief"><div><p className="kicker">DOMESTIC WAREHOUSE DESK</p><h1>先看今天要收什么，<br />再把每一箱货<strong>交代清楚。</strong></h1><p className="brief-caption">签收、验货、换箱、贴码、称重、发运和报费在同一张工单完成。</p></div><div className="sync-stamp"><RefreshCw size={18} /><span>库存最近同步<b>{dashboard?.inventorySyncedAt ? formatDate(dashboard.inventorySyncedAt) : "同步中"}</b></span></div></section>
    <section className="metric-grid"><MetricCard label="待签收商品" value={waitingProducts.length} note="按 SKU 展示" icon={PackageCheck} tone="amber" /><MetricCard label="验货处理中" value={stockupTasks.filter((item) => ["accepted", "in_progress"].includes(item.status)).length} note="含换箱与贴码" icon={ScanLine} /><MetricCard label="等待中台" value={dashboard?.waitingTasks ?? "—"} note="已提交，勿重复操作" icon={RefreshCw} tone="violet" /><MetricCard label="本仓可见 SKU" value={dashboard?.inventorySkuCount ?? "—"} note="仅限授权范围" icon={Boxes} tone="green" /></section>
    <section className="warehouse-ops-grid">
      <article className="ops-funnel"><header><div><p className="kicker">WORKFLOW FUNNEL</p><h2>仓库作业漏斗</h2></div><span>{stockupTasks.length} 单</span></header><div>{funnel.map((stage, index) => <div className={stage.tone} key={stage.label}><span>{String(index + 1).padStart(2, "0")}</span><b>{stage.label}</b><strong>{stage.value}</strong><i style={{ width: `${Math.max(8, stockupTasks.length ? stage.value / stockupTasks.length * 100 : 0)}%` }} /></div>)}</div></article>
      <article className="ops-routes"><header><div><p className="kicker">OUTBOUND MIX</p><h2>验收后去向</h2></div><Truck size={20} /></header><div className="route-visual"><span style={{ background: `conic-gradient(#1e5ba5 0 ${routeTotal ? (routeTotals.overseas_warehouse || 0) / routeTotal * 100 : 0}%, #ef6b2e 0 ${routeTotal ? ((routeTotals.overseas_warehouse || 0) + (routeTotals.domestic_customer || 0)) / routeTotal * 100 : 0}%, #7b8da5 0)` }}><b>{routeTotal}</b><small>已分流</small></span><ul><li><i className="overseas" /><span>海外仓</span><b>{routeTotals.overseas_warehouse || 0}</b></li><li><i className="domestic" /><span>国内客户</span><b>{routeTotals.domestic_customer || 0}</b></li><li><i className="hold" /><span>明确留仓</span><b>{routeTotals.hold || 0}</b></li></ul></div></article>
      <article className="ops-expenses"><header><div><p className="kicker">WAREHOUSE COST</p><h2>仓内费用登记</h2></div><strong>¥{Object.values(expenseTotals).reduce((sum, value) => sum + value, 0).toLocaleString()}</strong></header><div>{Object.entries(expenseTotals).length ? Object.entries(expenseTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, amount]) => <div key={category}><span>{category}</span><i><em style={{ width: `${Math.max(6, amount / Math.max(...Object.values(expenseTotals)) * 100)}%` }} /></i><b>¥{amount.toLocaleString()}</b></div>) : <p>仓库提交费用后，这里会按换箱、贴标、装卸、耗材和货拉拉等类型汇总。</p>}</div></article>
    </section>
    <section className="arrival-board"><header><div><p className="kicker">WAITING FOR RECEIPT</p><h2>等待签收验货的产品</h2></div><button className="text-action" onClick={() => onNavigate("tasks")}>进入全部工单 <ChevronRight size={16} /></button></header>{waitingProducts.length ? <div className="arrival-table"><div className="arrival-head"><span>产品</span><span>到货工单</span><span>预计到仓</span><span>待签收数量</span><span>下一步</span></div>{waitingProducts.slice(0, 8).map(({ item, line }) => <button key={`${item.id}-${line.id}`} onClick={() => onOpenTask(item)}><span><ProductImage src={line.imageUrl} name={line.productName} /><span><b>{line.productName}</b><code>{line.sku}</code></span></span><span><b>{item.publicPayload.referenceNo}</b><small>{item.publicPayload.workOrder?.senderName || "待到货"}</small></span><span>{formatDate(item.publicPayload.workOrder?.expectedArrivalAt || item.dueAt)}</span><span><b>{line.plannedQuantity.toLocaleString()}</b> {line.unit}</span><span>{item.status === "pending" ? "接单并核对" : "继续验货登记"}<ChevronRight size={15} /></span></button>)}</div> : <div className="arrival-empty"><CheckCircle2 size={27} /><span><b>当前没有待签收商品</b><small>新的国内仓工单会自动出现在这里。</small></span></div>}</section>
    <section className="section-block"><header><div><p className="kicker">ACTIVE QUEUE</p><h2>当前作业队列</h2></div><button className="text-action" onClick={() => onNavigate("tasks")}>查看全部 <ChevronRight size={16} /></button></header><div className="task-grid">{tasks.map((item) => <TaskCard key={item.id} item={item} onOpen={onOpenTask} />)}</div></section>
    <section className="safety-banner"><div className="safety-symbol"><ShieldCheck size={28} /></div><div><b>你正处于“{tasks[0]?.publicPayload.warehouseName || "本组织"}”数据边界</b><span>页面、搜索、附件和{mode === "warehouse" ? "库存" : "订单"}均只包含当前组织被授权的数据；所有操作会记录操作者与时间。</span></div></section>
  </div>;
}

function TasksPage({ session, onOpenTask }: { session: Session; onOpenTask(item: WorkItem): void }) {
  const [items, setItems] = React.useState<WorkItem[]>([]); const [counts, setCounts] = React.useState<Record<string, number>>({}); const [status, setStatus] = React.useState(""); const [itemType, setItemType] = React.useState(""); const [keyword, setKeyword] = React.useState(""); const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(() => { setLoading(true); fetchWorkItems({ status, keyword }).then((value) => { setItems(value.items); setCounts(value.counts); }).finally(() => setLoading(false)); }, [status, keyword]);
  React.useEffect(load, [load]);
  const mode = organizationMode(session); const title = mode === "production" ? "订单协同" : mode === "procurement" ? "采购协同" : "协同任务";
  const visibleItems = itemType ? items.filter((item) => item.itemType === itemType) : items;
  const typeOptions = mode === "production" ? [["", "全部单据", ClipboardCheck], ["production_order", "委外加工单", Factory], ["purchase_order", "物料采购单", PackageCheck], ["sampling_task", "打样单", FlaskConical]] as const : [];
  return <div className="page-stack"><section className="page-title"><div><p className="kicker">WORK ITEMS</p><h1>{title}</h1><span>{mode === "production" ? "加工、采购和打样互相分区；反馈进度、物料与包材测试，异常及时上报。" : mode === "procurement" ? "确认订单、反馈备货与交付进度，并留存发运凭证。" : "接单、执行、回传凭证，并跟踪中台处理结果。"}</span></div><button className="secondary-action" onClick={load}><RefreshCw size={17} />刷新</button></section>
    {typeOptions.length ? <nav className="task-type-filter" aria-label="单据类型">{typeOptions.map(([value, label, Icon]) => <button key={value} className={itemType === value ? "active" : ""} onClick={() => setItemType(value)}><Icon size={17} /><span>{label}</span><em>{value ? items.filter((item) => item.itemType === value).length : items.length}</em></button>)}</nav> : null}
    <section className="filter-bar"><label className="search-field"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索任务、单号" /></label><div className="filter-chips">{[["","全部"],["pending","待接单"],["accepted","已接单"],["in_progress","处理中"],["pending_approval","待审批"],["pending_sync","待同步"],["completed","已完成"]].map(([value,label]) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{label}{value && counts[value] ? <em>{counts[value]}</em> : null}</button>)}</div></section>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" /><span>正在读取本组织任务…</span></div> : visibleItems.length ? <div className="task-grid wide">{visibleItems.map((item) => <TaskCard key={item.id} item={item} onOpen={onOpenTask} />)}</div> : <div className="empty-state"><Inbox size={42} /><h3>当前没有匹配任务</h3><p>{mode === "warehouse" ? "任务可由供应链中台下发，也可从“本仓库存”发起仓库作业。" : itemType ? `中台尚未向本组织发布${itemTypeMeta[itemType]?.label || "该类"}单。` : "中台尚未向本组织发布相关订单。"}</p></div>}
  </div>;
}

function ProductImage({ src, name, className = "" }: { src?: string; name: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) return <span className={`product-image-fallback ${className}`} aria-hidden="true">{name.trim().slice(0, 1) || <Boxes size={18} />}</span>;
  return <img className={`product-image ${className}`} src={src} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

type OperationDraftLine = WarehouseOperationLine & { key: string };

function WarehouseOperationModal({ operationType, inventory, canStocktake, onClose, onCreated, notify }: {
  operationType: WarehouseOperationType; inventory: InventoryItem[]; canStocktake: boolean; onClose(): void; onCreated(item: WorkItem): void; notify(message: string, tone: "success" | "error"): void;
}) {
  const labels = { inbound: { title: "发起入库申请", verb: "入库", icon: ArrowDownToLine }, outbound: { title: "发起出库申请", verb: "出库", icon: ArrowUpFromLine }, stocktake: { title: "提交盘点差异", verb: "盘点", icon: ClipboardCheck } } as const;
  const meta = labels[operationType]; const Icon = meta.icon;
  const warehouses = React.useMemo(() => [...new Map(inventory.map((item) => [item.warehouseRef, { ref: item.warehouseRef, name: item.warehouseName }])).values()], [inventory]);
  const [warehouseRef, setWarehouseRef] = React.useState(warehouses[0]?.ref || "");
  const [selectedSku, setSelectedSku] = React.useState(""); const [referenceNo, setReferenceNo] = React.useState(""); const [note, setNote] = React.useState(""); const [lines, setLines] = React.useState<OperationDraftLine[]>([]); const [busy, setBusy] = React.useState(false);
  const options = inventory.filter((item) => item.warehouseRef === warehouseRef);
  React.useEffect(() => { setLines([]); setSelectedSku(""); }, [warehouseRef, operationType]);
  function addProjectedLine() {
    const item = options.find((entry) => entry.sku === selectedSku);
    if (!item || lines.some((line) => line.sku === item.sku)) return;
    setLines((current) => [...current, { key: crypto.randomUUID(), sku: item.sku, productName: item.productName, imageUrl: item.imageUrl, unit: item.unit, ...(operationType === "stocktake" ? { countedQuantity: item.availableQuantity + item.lockedQuantity } : { quantity: 1 }) }]);
    setSelectedSku("");
  }
  function addManualLine() { setLines((current) => [...current, { key: crypto.randomUUID(), sku: "", productName: "", imageUrl: "", unit: "件", quantity: 1 }]); }
  function updateLine(key: string, patch: Partial<OperationDraftLine>) { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (operationType === "stocktake" && !canStocktake) return notify("只有组织管理员或业务经理可以提交盘点差异。", "error");
    if (!warehouseRef || !note.trim() || !lines.length) return notify("请选择仓库、至少一条商品并填写作业说明。", "error");
    if (lines.some((line) => !line.sku.trim() || !line.productName.trim())) return notify("SKU 和商品名称不能为空。", "error");
    if (lines.some((line) => operationType === "stocktake" ? Number(line.countedQuantity) < 0 : Number(line.quantity) <= 0)) return notify("请填写正确的作业数量。", "error");
    setBusy(true);
    try {
      const payloadLines = lines.map(({ key: _key, ...line }) => operationType === "stocktake"
        ? { sku: line.sku, productName: line.productName, imageUrl: line.imageUrl || "", countedQuantity: Number(line.countedQuantity), unit: line.unit }
        : { sku: line.sku, productName: line.productName, imageUrl: line.imageUrl || "", quantity: Number(line.quantity), unit: line.unit, lotNo: line.lotNo || "", barcode: line.barcode || "", productionDate: line.productionDate || "", expiryDate: line.expiryDate || "" });
      const result = await createWarehouseOperation({ operationType, warehouseRef, referenceNo, note: note.trim(), lines: payloadLines });
      notify(`${meta.verb}申请已生成工单，等待内部审批。`, "success"); onCreated(result.item);
    } catch (reason) { notify(reason instanceof Error ? reason.message : "作业申请提交失败", "error"); }
    finally { setBusy(false); }
  }
  return <div className="operation-layer" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><form className="operation-modal" onSubmit={submit}>
    <header><span><Icon size={20} /></span><div><p className="kicker">WAREHOUSE OPERATION</p><h2>{meta.title}</h2><small>提交后进入内部中台审批，审批通过并校验库存后才会写入主账。</small></div><button type="button" className="icon-button" onClick={onClose}><X size={20} /></button></header>
    <div className="operation-form-grid"><label><span>作业仓库</span><select value={warehouseRef} onChange={(event) => setWarehouseRef(event.target.value)} required>{warehouses.map((warehouse) => <option key={warehouse.ref} value={warehouse.ref}>{warehouse.name}</option>)}</select></label><label><span>外部单号（可选）</span><input value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="不填则由系统自动生成" /></label></div>
    <section className="operation-lines"><header><div><h3>商品明细</h3><span>{lines.length} 个 SKU</span></div><div><select value={selectedSku} onChange={(event) => setSelectedSku(event.target.value)}><option value="">选择本仓商品</option>{options.filter((item) => !lines.some((line) => line.sku === item.sku)).map((item) => <option key={item.sku} value={item.sku}>{item.sku} · {item.productName}</option>)}</select><button type="button" onClick={addProjectedLine} disabled={!selectedSku}><Plus size={15} />添加</button>{operationType === "inbound" ? <button type="button" onClick={addManualLine}><Plus size={15} />手动 SKU</button> : null}</div></header>
      <div className="operation-line-list">{lines.map((line) => { const stock = options.find((item) => item.sku === line.sku); return <article key={line.key}><ProductImage src={line.imageUrl} name={line.productName || line.sku || "商品"} /><div className="operation-product">{operationType === "inbound" && !stock ? <><input value={line.sku} onChange={(event) => updateLine(line.key, { sku: event.target.value.toUpperCase().replace(/\s/g, "") })} placeholder="SKU" /><input value={line.productName} onChange={(event) => updateLine(line.key, { productName: event.target.value })} placeholder="商品名称" /></> : <><b>{line.productName}</b><code>{line.sku}</code></>}</div><label><span>{operationType === "stocktake" ? `账面 ${stock ? stock.availableQuantity + stock.lockedQuantity : 0}` : `${meta.verb}数量`}</span><input type="number" min="0" step="0.0001" value={operationType === "stocktake" ? line.countedQuantity : line.quantity} onChange={(event) => updateLine(line.key, operationType === "stocktake" ? { countedQuantity: Number(event.target.value) } : { quantity: Number(event.target.value) })} /></label>{operationType === "inbound" ? <><label><span>批次号</span><input value={line.lotNo || ""} onChange={(event) => updateLine(line.key, { lotNo: event.target.value })} /></label><label><span>条码</span><input value={line.barcode || ""} onChange={(event) => updateLine(line.key, { barcode: event.target.value })} /></label></> : null}<button type="button" className="remove-line" onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))} aria-label="删除明细"><Trash2 size={16} /></button>{operationType === "inbound" ? <div className="operation-dates"><label><span>生产日期</span><input type="date" value={line.productionDate || ""} onChange={(event) => updateLine(line.key, { productionDate: event.target.value })} /></label><label><span>有效期至</span><input type="date" value={line.expiryDate || ""} onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })} /></label></div> : null}</article>; })}</div>
      {!lines.length ? <div className="operation-empty"><Boxes size={26} /><span>从本仓商品中添加作业明细{operationType === "inbound" ? "，也可以手动录入新 SKU" : ""}</span></div> : null}
    </section>
    <label className="operation-note"><span>{meta.verb}原因 / 作业说明</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="说明业务来源、盘点范围或需要中台核对的事项" required /></label>
    <div className="approval-warning"><ShieldCheck size={18} /><span><b>不会直接改库存</b>仓库自主发起的作业统一进入内部审批；重复点击也不会产生重复流水。</span></div>
    <footer><button type="button" className="secondary-action" onClick={onClose}>取消</button><button className="primary-action" disabled={busy || !lines.length || !note.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileCheck2 size={18} />}提交{meta.verb}申请</button></footer>
  </form></div>;
}

function InventoryPage({ session, onOpenTask, notify }: { session: Session; onOpenTask(item: WorkItem): void; notify(message: string, tone: "success" | "error"): void }) {
  const [items, setItems] = React.useState<InventoryItem[]>([]); const [keyword, setKeyword] = React.useState(""); const [loading, setLoading] = React.useState(true);
  const [operation, setOperation] = React.useState<WarehouseOperationType | null>(null);
  const load = React.useCallback(() => { setLoading(true); fetchInventory(keyword).then((value) => setItems(value.items)).finally(() => setLoading(false)); }, [keyword]);
  React.useEffect(() => { const timer = setTimeout(load, 180); return () => clearTimeout(timer); }, [load]);
  const canStocktake = ["organization_admin", "manager"].includes(session.membership.role);
  return <div className="page-stack"><section className="page-title inventory-title"><div><p className="kicker">WAREHOUSE SNAPSHOT</p><h1>本仓库存</h1><span>展示有库存商品；实际主账仍以内部供应链中台为准。</span></div><div className="inventory-actions"><button onClick={() => setOperation("inbound")}><ArrowDownToLine size={16} />发起入库</button><button onClick={() => setOperation("outbound")}><ArrowUpFromLine size={16} />发起出库</button>{canStocktake ? <button className="accent" onClick={() => setOperation("stocktake")}><ClipboardCheck size={16} />库存盘点</button> : null}</div></section>
    <section className="filter-bar"><label className="search-field"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 SKU 或商品名称" /></label><span className="table-count">{items.length} 个 SKU</span></section>
    <section className="inventory-table-wrap">{loading ? <div className="loading-state"><LoaderCircle className="spin" />同步库存视图…</div> : <table className="inventory-table"><thead><tr><th>商品 / SKU</th><th>可用</th><th>锁定</th><th>在途</th><th>同步时间</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.warehouseRef}:${item.sku}`}><td><div className="inventory-product"><ProductImage src={item.imageUrl} name={item.productName} /><span><b>{item.productName}</b><code>{item.sku}</code></span></div></td><td><strong>{item.availableQuantity.toLocaleString()}</strong> {item.unit}</td><td>{item.lockedQuantity.toLocaleString()}</td><td className={item.inTransitQuantity ? "in-transit" : ""}>{item.inTransitQuantity.toLocaleString()}</td><td>{formatDate(item.lastCoreSyncedAt)}</td></tr>)}</tbody></table>}</section>
    {operation ? <WarehouseOperationModal operationType={operation} inventory={items} canStocktake={canStocktake} onClose={() => setOperation(null)} notify={notify} onCreated={(item) => { setOperation(null); load(); onOpenTask(item); }} /> : null}
  </div>;
}

function NotificationsPage({ onOpenTask }: { onOpenTask(id: string): void }) {
  const [items, setItems] = React.useState<NotificationItem[]>([]); React.useEffect(() => { fetchNotifications().then((value) => setItems(value.items)); }, []);
  async function open(item: NotificationItem) { if (!item.readAt) { await markNotificationRead(item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)); } if (item.workItemId) onOpenTask(item.workItemId); }
  return <div className="page-stack"><section className="page-title"><div><p className="kicker">INBOX</p><h1>消息中心</h1><span>站内消息是协同通知的权威记录。</span></div></section><section className="message-list">{items.map((item) => <button key={item.id} className={!item.readAt ? "unread" : ""} onClick={() => open(item)}><span className="message-dot" /><div><b>{item.title}</b><p>{item.body}</p><small>{fullDate(item.createdAt)}</small></div><ChevronRight size={18} /></button>)}</section></div>;
}

function processSteps(value = "") {
  return [...new Set(value.split(/[,，、;；>→\n]+/).map((step) => step.trim()).filter(Boolean))].slice(0, 24);
}

function latestReport(reports: NonNullable<WorkItemDetail["partnerOrder"]>["reports"], type: string) {
  return reports.filter((report) => report.reportType === type).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

function ProductionProcessFlow({ value, reports }: { value?: string; reports: NonNullable<WorkItemDetail["partnerOrder"]>["reports"] }) {
  const steps = processSteps(value);
  const progress = latestReport(reports, "production_progress");
  const exception = latestReport(reports, "exception");
  const percent = Math.max(0, Math.min(100, Number(progress?.progressPercent || 0)));
  const stageKeywords: Record<string, string[]> = { filling: ["灌装"], packaging: ["包装", "装盒", "装箱", "贴标", "打码"], quality_check: ["质检", "检验", "测试"], ready_to_ship: ["发货", "出库"] };
  const stageIndex = steps.findIndex((step) => (stageKeywords[progress?.stage || ""] || []).some((keyword) => step.includes(keyword)));
  const currentIndex = percent >= 100 ? steps.length : stageIndex >= 0 ? stageIndex : Math.min(steps.length - 1, Math.floor(percent / Math.max(1, 100 / steps.length)));
  const blocked = Boolean(exception && (!progress || Date.parse(exception.createdAt) > Date.parse(progress.createdAt)) && percent < 100);
  const [selected, setSelected] = React.useState(Math.max(0, currentIndex));
  React.useEffect(() => setSelected(Math.max(0, currentIndex)), [value, currentIndex]);
  if (!steps.length) return <section className="production-flow empty"><header><div><span>PRODUCTION ROUTE</span><h4>生产工序</h4></div></header><p>首件档案和加工单中暂未填写生产工序。</p></section>;
  return <section className="production-flow">
    <header><div><span>PRODUCTION ROUTE</span><h4>生产工序流程</h4></div><strong className={blocked ? "blocked" : ""}>{blocked ? "当前有异常" : percent ? `整体进度 ${percent}%` : "等待工厂更新"}</strong></header>
    <ol>{steps.map((step, index) => { const state = percent >= 100 || index < currentIndex ? "completed" : index === currentIndex ? (blocked ? "blocked" : "current") : "pending"; return <li className={`${state} ${selected === index ? "selected" : ""}`} key={`${step}-${index}`}><button type="button" onClick={() => setSelected(index)} aria-label={`查看工序：${step}`}><span>{state === "completed" ? <Check size={14} /> : state === "blocked" ? <AlertTriangle size={14} /> : index + 1}</span><b>{step}</b><small>{state === "completed" ? "已完成" : state === "current" ? "当前工序" : state === "blocked" ? "异常待处理" : "待开始"}</small></button></li>; })}</ol>
    <footer><div><span>当前查看</span><b>{steps[selected]}</b></div><p>{selected === currentIndex && progress?.note ? progress.note : selected === currentIndex && blocked ? (exception?.note || exception?.title || "存在待处理异常") : selected < currentIndex || percent >= 100 ? "该工序已按当前整体进度完成。" : "等待前序工序完成后开始。"}</p></footer>
  </section>;
}

const firstArticleImageLabels: Record<string, string> = { packaging: "包装六面", inner_pack: "内托内包", coding: "打码位置", finished: "成品效果", carton: "外箱装箱" };
const firstArticleMatchLabels: Record<string, string> = { barcode: "条码精确关联", sku: "SKU 精确关联", product_name: "产品名精确关联" };

function FirstArticlePanel({ record }: { record: NonNullable<WorkItem["publicPayload"]["firstArticle"]> | undefined }) {
  const [category, setCategory] = React.useState("all");
  const [selectedImage, setSelectedImage] = React.useState<NonNullable<typeof record>["images"][number] | null>(null);
  const [showBom, setShowBom] = React.useState(false);
  if (!record) return <section className="first-article-panel empty"><header><div><span>FIRST ARTICLE</span><h4>首件档案</h4></div><em>未关联</em></header><p>当前产品未找到可精确匹配的首件记录，不会自动展示其他产品资料。</p></section>;
  const categories = [...new Set(record.images.map((image) => image.category))];
  const images = category === "all" ? record.images : record.images.filter((image) => image.category === category);
  return <section className="first-article-panel">
    <header><div><span>FIRST ARTICLE</span><h4>首件档案 · {record.version || "当前版"}</h4></div><em>{firstArticleMatchLabels[record.matchedBy]}</em></header>
    <div className="first-article-summary"><div><span>档案号</span><b>{record.documentNo || "—"}</b></div><div><span>产品 / SKU</span><b>{record.productName || "—"}</b><small>{record.productSku || "未填写 SKU"}</small></div><div><span>规格 / 条码</span><b>{record.specification || "—"}</b><small>{record.barcode || "未填写条码"}</small></div><div><span>备案 / BPOM</span><b>{record.filingName || "—"}</b><small>{record.bpom || "未填写 BPOM"}</small></div></div>
    {record.cartonSpecification ? <p className="first-article-carton"><Boxes size={15} /><span><b>装箱规格</b>{record.cartonSpecification}</span></p> : null}
    {record.images.length ? <><nav className="first-article-tabs"><button type="button" className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部 {record.images.length}</button>{categories.map((key) => <button type="button" className={category === key ? "active" : ""} key={key} onClick={() => setCategory(key)}>{firstArticleImageLabels[key] || key} {record.images.filter((image) => image.category === key).length}</button>)}</nav><div className="first-article-gallery">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} onClick={() => setSelectedImage(image)}><img src={image.url} alt={`${image.label}：${image.name}`} loading="lazy" /><span>{image.label}</span></button>)}</div></> : <div className="first-article-no-images"><Camera size={18} />首件记录中暂无图片</div>}
    {record.bom.length ? <div className="first-article-bom"><button type="button" onClick={() => setShowBom((current) => !current)}><Boxes size={16} /><span>首件 BOM 明细</span><b>{record.bom.length} 项</b><ChevronRight className={showBom ? "open" : ""} size={16} /></button>{showBom ? <div className="first-article-bom-table"><div className="head"><span>分类</span><span>物料</span><span>料体编号</span><span>组成 / 净含量</span></div>{record.bom.map((line, index) => <div key={`${line.materialCode}-${index}`}><span>{line.category || "—"}</span><b>{line.name || "—"}</b><code>{line.materialCode || "—"}</code><span>{[line.composition, line.netContent, line.unit].filter(Boolean).join(" · ") || "—"}</span></div>)}</div> : null}</div> : null}
    {selectedImage ? <div className="first-article-lightbox" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedImage(null); }}><button type="button" onClick={() => setSelectedImage(null)} aria-label="关闭图片"><X size={20} /></button><img src={selectedImage.url} alt={selectedImage.name} /><p>{selectedImage.label} · {selectedImage.name}</p></div> : null}
  </section>;
}

function PartnerOrderWorkspace({ detail, busy, setBusy, reload, onChanged, notify, files, clearFiles }: {
  detail: WorkItemDetail; busy: boolean; setBusy(value: boolean): void; reload(): Promise<void>; onChanged(): void;
  notify(message: string, tone: "success" | "error"): void; files: FileList | null; clearFiles(): void;
}) {
  const item = detail.item; const order = detail.partnerOrder; const production = item.itemType === "production_order";
  const turnkey = production && item.publicPayload.fulfillmentMode === "turnkey";
  const materialLines = (order?.lines || []).filter((line) => ["raw_material", "packaging"].includes(line.lineType));
  const [panel, setPanel] = React.useState<"progress" | "materials" | "fulfillment" | "shipment" | "exception">(production ? "progress" : "fulfillment");
  const [progress, setProgress] = React.useState({ stage: "planning", progressPercent: "10", completedQuantity: "0", expectedCompletionDate: item.publicPayload.deliveryDate || "", note: "" });
  const [fulfillment, setFulfillment] = React.useState({ stage: "confirmed", completedQuantity: "0", expectedDeliveryDate: item.publicPayload.deliveryDate || "", note: "" });
  const [shipment, setShipment] = React.useState({ shippedQuantity: "", shippedAt: new Date().toISOString().slice(0, 10), carrier: "", trackingNo: "", note: "" });
  const [exception, setException] = React.useState({ category: production ? "production_delay" : "delivery_delay", severity: "warning", title: "", description: "", affectedQuantity: "0", expectedResolutionDate: "" });
  const [material, setMaterial] = React.useState({ lineId: materialLines[0]?.id || "", readiness: "not_arrived", arrivedQuantity: "0", testResult: "pending", testedAt: "", exceptionDescription: "", note: "" });
  const actionable = ["accepted", "in_progress", "pending_sync"].includes(item.status);
  const latestByLine = new Map<string, NonNullable<typeof order>["reports"][number]>();
  for (const report of order?.reports || []) if (report.lineId && !latestByLine.has(report.lineId)) latestByLine.set(report.lineId, report);
  const selectedMaterial = materialLines.find((line) => line.id === material.lineId);
  React.useEffect(() => {
    const first = materialLines[0]; if (!first) return;
    const latest = (order?.reports || []).find((report) => report.lineId === first.id && report.reportType === "material_readiness");
    setMaterial({ lineId: first.id, arrivedQuantity: String(latest?.quantity || 0), readiness: latest?.stage || "not_arrived", testResult: latest?.result || "pending", testedAt: latest?.expectedAt?.slice(0, 10) || "", exceptionDescription: String(latest?.details?.exceptionDescription || ""), note: latest?.note || "" });
  }, [item.id, item.version]);

  async function submit(body: Parameters<typeof submitPartnerOrderReport>[2], success: string) {
    setBusy(true);
    try {
      if (files?.length) for (const file of Array.from(files)) await uploadAttachment(item.id, file);
      await submitPartnerOrderReport(item.id, item.version, body);
      clearFiles();
      notify(success, "success"); await reload(); onChanged();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "提交失败", "error"); }
    finally { setBusy(false); }
  }

  const tabs = production
    ? [{ key: "progress", label: "生产进度", icon: Factory }, ...(turnkey ? [{ key: "materials", label: "物料与包材", icon: Boxes }] : []), { key: "shipment", label: "发货反馈", icon: Truck }, { key: "exception", label: "异常上报", icon: AlertTriangle }]
    : [{ key: "fulfillment", label: "履约进度", icon: ClipboardCheck }, { key: "shipment", label: "发货反馈", icon: Truck }, { key: "exception", label: "异常上报", icon: AlertTriangle }];
  const lineTypeLabel = { finished_product: "成品", raw_material: "原料", packaging: "包材" } as const;
  const readinessLabel: Record<string, string> = { not_arrived: "未到齐", partial: "部分到齐", arrived: "已到齐" };
  const testLabel: Record<string, string> = { pending: "待测试", passed: "测试合格", failed: "测试异常", not_required: "无需测试" };

  return <section className="drawer-section partner-order-panel">
    <header><div><h3>{production ? "加工单协同台" : "采购单履约台"}</h3><span>{production ? (turnkey ? "全包模式 · 生产、物料与包材测试均需反馈" : "来料加工 · 按节点反馈生产进度") : "订单确认、备货、发货与异常全程留痕"}</span></div><ShieldCheck size={18} /></header>
    {production ? <ProductionProcessFlow value={item.publicPayload.productionProcess || item.publicPayload.firstArticle?.productionProcess} reports={order?.reports || []} /> : null}
    {production && (item.publicPayload.cartonType || item.publicPayload.barcode) ? <div className="partner-source-facts"><div><span>外箱与箱规</span><b>{[item.publicPayload.cartonType, item.publicPayload.piecesPerCarton ? `${item.publicPayload.piecesPerCarton} ${item.publicPayload.unit || "件"}/箱` : ""].filter(Boolean).join(" · ") || "未填写"}</b></div><div><span>商品条码</span><b>{item.publicPayload.barcode || "未填写"}</b></div></div> : null}
    {production ? <FirstArticlePanel record={item.publicPayload.firstArticle} /> : null}
    <div className="order-line-list">{(order?.lines || []).map((line) => <article key={line.id}><ProductImage src={line.imageUrl} name={line.productName} /><div><span>{lineTypeLabel[line.lineType]}</span><b>{line.productName}</b><code>{line.sku}{line.specification ? ` · ${line.specification}` : ""}</code></div><strong>{line.plannedQuantity.toLocaleString()} <small>{line.unit}</small></strong></article>)}</div>
    <nav className="order-report-tabs">{tabs.map(({ key, label, icon: Icon }) => <button key={key} className={panel === key ? "active" : ""} onClick={() => setPanel(key as typeof panel)}><Icon size={16} />{label}</button>)}</nav>

    {panel === "progress" ? <div className="order-report-form"><div className="form-grid three"><label><span>当前阶段</span><select value={progress.stage} onChange={(event) => setProgress({ ...progress, stage: event.target.value })}><option value="planning">排产准备</option><option value="material_preparation">物料准备</option><option value="filling">灌装生产</option><option value="packaging">包装装箱</option><option value="quality_check">质检</option><option value="ready_to_ship">待发货</option></select></label><label><span>整体进度</span><div className="input-suffix"><input type="number" min="0" max="100" value={progress.progressPercent} onChange={(event) => setProgress({ ...progress, progressPercent: event.target.value })} /><em>%</em></div></label><label><span>已完成数量</span><input type="number" min="0" value={progress.completedQuantity} onChange={(event) => setProgress({ ...progress, completedQuantity: event.target.value })} /></label><label><span>预计完成日期</span><input type="date" value={progress.expectedCompletionDate} onChange={(event) => setProgress({ ...progress, expectedCompletionDate: event.target.value })} /></label><label className="span-two"><span>本次进度说明</span><input value={progress.note} onChange={(event) => setProgress({ ...progress, note: event.target.value })} placeholder="例如：已完成首批灌装，正在进行密封性检查" /></label></div><button className="primary-action inline-submit" disabled={busy || !actionable || !progress.note} onClick={() => void submit({ reportType: "production_progress", stage: progress.stage as "planning", progressPercent: Number(progress.progressPercent), completedQuantity: Number(progress.completedQuantity), expectedCompletionDate: progress.expectedCompletionDate, note: progress.note }, "生产进度已反馈")}>提交进度</button></div> : null}

    {panel === "materials" ? <div className="material-workbench"><div className="material-status-list">{materialLines.map((line) => { const latest = latestByLine.get(line.id); return <button key={line.id} className={material.lineId === line.id ? "active" : ""} onClick={() => setMaterial({ ...material, lineId: line.id, arrivedQuantity: String(latest?.quantity || 0), readiness: latest?.stage || "not_arrived", testResult: latest?.result || "pending", exceptionDescription: String(latest?.details?.exceptionDescription || "") })}><span>{lineTypeLabel[line.lineType]}</span><b>{line.productName}</b><small>计划 {line.plannedQuantity.toLocaleString()} {line.unit}</small><em className={latest?.result === "failed" ? "failed" : latest?.result === "passed" ? "passed" : ""}>{latest ? `${readinessLabel[latest.stage] || latest.stage} · ${testLabel[latest.result] || latest.result}` : "待反馈"}</em></button>; })}</div>{selectedMaterial ? <div className="order-report-form"><h4>{selectedMaterial.productName}<small>最多反馈 {selectedMaterial.plannedQuantity.toLocaleString()} {selectedMaterial.unit}</small></h4><div className="form-grid two"><label><span>到齐状态</span><select value={material.readiness} onChange={(event) => setMaterial({ ...material, readiness: event.target.value })}><option value="not_arrived">未到齐</option><option value="partial">部分到齐</option><option value="arrived">已到齐</option></select></label><label><span>已到数量</span><input type="number" min="0" max={selectedMaterial.plannedQuantity} value={material.arrivedQuantity} onChange={(event) => setMaterial({ ...material, arrivedQuantity: event.target.value })} /></label><label><span>测试结果</span><select value={material.testResult} onChange={(event) => setMaterial({ ...material, testResult: event.target.value })}><option value="pending">待测试</option><option value="passed">测试合格</option><option value="failed">测试不合格</option><option value="not_required">无需测试</option></select></label><label><span>测试日期</span><input type="date" value={material.testedAt} onChange={(event) => setMaterial({ ...material, testedAt: event.target.value })} /></label>{material.testResult === "failed" ? <label className="span-two alert-field"><span>异常说明（必填）</span><textarea rows={2} value={material.exceptionDescription} onChange={(event) => setMaterial({ ...material, exceptionDescription: event.target.value })} placeholder="填写破损、尺寸偏差、密封性或兼容性问题" /></label> : null}<label className="span-two"><span>补充说明</span><input value={material.note} onChange={(event) => setMaterial({ ...material, note: event.target.value })} /></label></div><button className="primary-action inline-submit" disabled={busy || !actionable || (material.testResult === "failed" && !material.exceptionDescription)} onClick={() => void submit({ reportType: "material_readiness", lineId: selectedMaterial.id, readiness: material.readiness as "not_arrived", arrivedQuantity: Number(material.arrivedQuantity), testResult: material.testResult as "pending", testedAt: material.testedAt, exceptionDescription: material.exceptionDescription, note: material.note }, material.testResult === "failed" ? "测试异常已上报" : "物料状态已更新")}>保存到齐与测试结果</button></div> : <div className="empty-inline">该加工单没有需要工厂反馈的物料或包材。</div>}</div> : null}

    {panel === "fulfillment" ? <div className="order-report-form"><div className="form-grid two"><label><span>履约阶段</span><select value={fulfillment.stage} onChange={(event) => setFulfillment({ ...fulfillment, stage: event.target.value })}><option value="confirmed">订单已确认</option><option value="preparing">备料生产中</option><option value="ready_to_ship">待发货</option><option value="shipped">已发货</option><option value="delivered">已交付</option></select></label><label><span>已完成数量</span><input type="number" min="0" value={fulfillment.completedQuantity} onChange={(event) => setFulfillment({ ...fulfillment, completedQuantity: event.target.value })} /></label><label><span>预计交付日期</span><input type="date" value={fulfillment.expectedDeliveryDate} onChange={(event) => setFulfillment({ ...fulfillment, expectedDeliveryDate: event.target.value })} /></label><label><span>进度说明</span><input value={fulfillment.note} onChange={(event) => setFulfillment({ ...fulfillment, note: event.target.value })} placeholder="填写备货、生产或交付情况" /></label></div><button className="primary-action inline-submit" disabled={busy || !actionable || !fulfillment.note} onClick={() => void submit({ reportType: "purchase_fulfillment", stage: fulfillment.stage as "confirmed", expectedDeliveryDate: fulfillment.expectedDeliveryDate, completedQuantity: Number(fulfillment.completedQuantity), note: fulfillment.note }, "采购履约进度已反馈")}>提交履约进度</button></div> : null}

    {panel === "shipment" ? <div className="order-report-form"><div className="form-grid two"><label><span>累计发货数量</span><input type="number" min="0.0001" max={item.publicPayload.quantity ? Number(item.publicPayload.quantity) : undefined} value={shipment.shippedQuantity} onChange={(event) => setShipment({ ...shipment, shippedQuantity: event.target.value })} /></label><label><span>最近发货日期</span><input type="date" value={shipment.shippedAt} onChange={(event) => setShipment({ ...shipment, shippedAt: event.target.value })} /></label><label><span>物流承运商</span><input value={shipment.carrier} onChange={(event) => setShipment({ ...shipment, carrier: event.target.value })} /></label><label><span>物流单号</span><input value={shipment.trackingNo} onChange={(event) => setShipment({ ...shipment, trackingNo: event.target.value })} /></label><label className="span-two"><span>发货说明</span><input value={shipment.note} onChange={(event) => setShipment({ ...shipment, note: event.target.value })} placeholder="多批发货时填写最新一批情况，数量填写累计值" /></label></div><button className="primary-action inline-submit" disabled={busy || !actionable || !Number(shipment.shippedQuantity) || Number(shipment.shippedQuantity) > Number(item.publicPayload.quantity || Infinity)} onClick={() => void submit({ reportType: "shipment", shippedQuantity: Number(shipment.shippedQuantity), shippedAt: shipment.shippedAt, carrier: shipment.carrier, trackingNo: shipment.trackingNo, note: shipment.note }, "发货信息已提交")}>提交发货信息</button></div> : null}

    {panel === "exception" ? <div className="order-report-form exception-form"><div className="form-grid two"><label><span>异常类型</span><select value={exception.category} onChange={(event) => setException({ ...exception, category: event.target.value })}><option value="material_shortage">物料短缺</option><option value="material_quality">物料质量</option><option value="packaging_test">包材测试</option><option value="production_delay">生产延期</option><option value="quality_issue">品质异常</option><option value="delivery_delay">交付延期</option><option value="other">其他</option></select></label><label><span>影响等级</span><select value={exception.severity} onChange={(event) => setException({ ...exception, severity: event.target.value })}><option value="notice">提示</option><option value="warning">警告</option><option value="critical">严重</option></select></label><label className="span-two"><span>异常标题</span><input value={exception.title} onChange={(event) => setException({ ...exception, title: event.target.value })} placeholder="一句话说明问题" /></label><label className="span-two"><span>异常详情</span><textarea rows={3} value={exception.description} onChange={(event) => setException({ ...exception, description: event.target.value })} placeholder="说明现象、已采取措施及需要中台协助的事项" /></label><label><span>影响数量</span><input type="number" min="0" value={exception.affectedQuantity} onChange={(event) => setException({ ...exception, affectedQuantity: event.target.value })} /></label><label><span>预计解决日期</span><input type="date" value={exception.expectedResolutionDate} onChange={(event) => setException({ ...exception, expectedResolutionDate: event.target.value })} /></label></div><button className="danger-action inline-submit" disabled={busy || !actionable || !exception.title || !exception.description} onClick={() => void submit({ reportType: "exception", category: exception.category as "other", severity: exception.severity as "warning", title: exception.title, description: exception.description, affectedQuantity: Number(exception.affectedQuantity), expectedResolutionDate: exception.expectedResolutionDate }, "异常已上报，中台将收到提醒")}>确认上报异常</button></div> : null}

    {order?.reports?.length ? <div className="order-report-history"><h4>最近反馈记录</h4>{order.reports.slice(0, 12).map((report) => <article key={report.id}><span className={`report-dot ${report.result === "failed" || report.severity === "critical" ? "danger" : ""}`} /><div><b>{report.title || ({ production_progress: "生产进度", material_readiness: "物料测试", purchase_fulfillment: "履约进度", shipment: "发货反馈", exception: "异常上报" }[report.reportType])}</b><p>{report.note || `${report.stage} · ${report.result}`}</p><small>{fullDate(report.createdAt)}{report.quantity != null ? ` · 数量 ${report.quantity.toLocaleString()}` : ""}</small></div>{report.progressPercent != null ? <strong>{report.progressPercent}%</strong> : null}</article>)}</div> : null}
  </section>;
}

function OemWorkspace({ detail, busy, setBusy, reload, onChanged, notify, files }: {
  detail: WorkItemDetail; busy: boolean; setBusy(value: boolean): void; reload(): Promise<void>; onChanged(): void;
  notify(message: string, tone: "success" | "error"): void; files: FileList | null;
}) {
  const item = detail.item;
  const [quote, setQuote] = React.useState({ currency: item.publicPayload.quoteCurrency || "CNY", amount: "", minimumOrderQuantity: String(item.publicPayload.quantity || ""), leadTimeDays: "", terms: "" });
  const [artifact, setArtifact] = React.useState({ title: "", summary: "", result: "pending", sampleQuantity: String(item.publicPayload.quantity || ""), unit: item.publicPayload.unit || "件", specificationVersion: "", supplierConclusion: "", nextPlan: "" });
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

  if (item.itemType === "sampling_task") {
    const rounds = detail.oem?.artifacts || [];
    const approved = rounds.find((entry) => entry.status === "approved");
    const latestQuote = detail.oem?.quotes?.[0];
    const categoryLabel = item.publicPayload.sampleCategory === "inner_material" ? "内料打样" : "包材打样";
    const subjectLabel = ({ formula: "配方 / 内料", raw_material: "原料", packaging_box: "包装盒", packaging_bottle: "包装瓶" } as Record<string, string>)[item.publicPayload.sampleSubject || ""] || "样品";
    return <section className="drawer-section oem-panel sampling-panel">
      <header><div><h3>{categoryLabel}闭环</h3><span>{subjectLabel} · 多轮送样不覆盖历史，定版后才开放报价</span></div><FlaskConical size={18} /></header>
      <div className="sampling-route">{[{ label: "接收需求", done: item.status !== "pending" }, { label: "送样评审", done: rounds.length > 0 }, { label: "最终定版", done: Boolean(approved) }, { label: "提交报价", done: Boolean(latestQuote) }, { label: "报价确认", done: latestQuote?.status === "awarded" }].map((step, index) => <React.Fragment key={step.label}><div className={step.done ? "done" : ""}><span>{step.done ? <Check size={12} /> : index + 1}</span><b>{step.label}</b></div>{index < 4 ? <i /> : null}</React.Fragment>)}</div>
      <div className="sampling-brief"><div><span>本轮目标</span><b>{item.publicPayload.sampleGoal || "按发布要求完成可评审样品"}</b></div><div><span>评审标准</span><b>{item.publicPayload.evaluationCriteria || item.publicPayload.requirements || "以中台评审意见为准"}</b></div></div>
      {rounds.length ? <div className="sampling-round-history">{rounds.map((entry) => <article className={entry.status} key={entry.id}><span>R{entry.version}</span><div><b>{entry.title}</b><small>{entry.publicPayload.specificationVersion || "未标注规格版本"} · {entry.publicPayload.sampleQuantity || 0} {entry.publicPayload.unit || item.publicPayload.unit || "件"}</small><p>{entry.publicPayload.summary || entry.publicPayload.supplierConclusion || "未填写摘要"}</p>{entry.publicPayload.reviewNote ? <em>{entry.publicPayload.reviewNote}</em> : null}</div><strong>{entry.status === "submitted" ? "中台评审中" : entry.status === "approved" ? "最终样" : "需修改"}</strong></article>)}</div> : <div className="empty-inline">尚未提交样品结果；请在首轮送样完成后登记。</div>}
      {!approved ? <div className="sampling-round-form"><h4>提交第 {rounds.length + 1} 轮样品</h4><div className="oem-form-grid"><label className="span-two"><span>轮次标题</span><input value={artifact.title} onChange={(event) => setArtifact({ ...artifact, title: event.target.value })} placeholder={`例如：第 ${rounds.length + 1} 轮${subjectLabel}送样`} /></label><label><span>规格 / 配方版本</span><input value={artifact.specificationVersion} onChange={(event) => setArtifact({ ...artifact, specificationVersion: event.target.value })} placeholder="例如：Formula V3" /></label><label><span>供应商自检结论</span><select value={artifact.result} onChange={(event) => setArtifact({ ...artifact, result: event.target.value })}><option value="pending">待中台确认</option><option value="passed">自检通过</option><option value="revision_required">建议继续调整</option><option value="failed">本轮失败</option></select></label><label><span>送样数量</span><input type="number" min="0" step="0.0001" value={artifact.sampleQuantity} onChange={(event) => setArtifact({ ...artifact, sampleQuantity: event.target.value })} /></label><label><span>单位</span><input value={artifact.unit} maxLength={20} onChange={(event) => setArtifact({ ...artifact, unit: event.target.value })} /></label></div><textarea value={artifact.summary} onChange={(event) => setArtifact({ ...artifact, summary: event.target.value })} placeholder="样品表现、测试数据、与上一轮的差异" rows={3} /><div className="oem-form-grid"><label><span>供应商结论</span><input value={artifact.supplierConclusion} onChange={(event) => setArtifact({ ...artifact, supplierConclusion: event.target.value })} placeholder="本轮是否达到发布标准" /></label><label><span>后续计划</span><input value={artifact.nextPlan} onChange={(event) => setArtifact({ ...artifact, nextPlan: event.target.value })} placeholder="如需修改，说明预计下一轮时间" /></label></div><button className="primary-action inline-submit" disabled={busy || !isReady || !artifact.title || !artifact.summary} onClick={() => complete(() => submitOemArtifact(item.id, item.version, { artifactType: "sample_result", title: artifact.title, artifactVersion: rounds.length + 1, publicPayload: { summary: artifact.summary, result: artifact.result, sampleQuantity: Number(artifact.sampleQuantity || 0), unit: artifact.unit, specificationVersion: artifact.specificationVersion, supplierConclusion: artifact.supplierConclusion, nextPlan: artifact.nextPlan } }), `第 ${rounds.length + 1} 轮样品已提交，等待中台评审`)}><FileCheck2 size={18} />提交本轮样品结果</button></div> : null}
      {approved ? <div className="sampling-quote-gate"><header><div><CheckCircle2 size={18} /><span><b>最终样 R{approved.version} 已锁定</b><small>后续报价将永久绑定此版本</small></span></div><em>QUOTE OPEN</em></header>{latestQuote ? <div className="submitted-record"><BadgeDollarSign size={18} /><div><b>{latestQuote.currency} {latestQuote.amount.toLocaleString()} · 报价 V{latestQuote.version}</b><span>绑定最终样 R{latestQuote.sampleVersion || approved.version} · 交期 {latestQuote.leadTimeDays} 天 · {latestQuote.status === "awarded" ? "中台已确认" : "等待中台确认"}</span></div></div> : <><div className="oem-form-grid"><label><span>币种</span><input value={quote.currency} maxLength={3} onChange={(event) => setQuote({ ...quote, currency: event.target.value.toUpperCase() })} /></label><label><span>报价金额</span><input type="number" min="0" step="0.01" value={quote.amount} onChange={(event) => setQuote({ ...quote, amount: event.target.value })} /></label><label><span>最小起订量</span><input type="number" min="0" value={quote.minimumOrderQuantity} onChange={(event) => setQuote({ ...quote, minimumOrderQuantity: event.target.value })} /></label><label><span>量产交期（天）</span><input type="number" min="0" value={quote.leadTimeDays} onChange={(event) => setQuote({ ...quote, leadTimeDays: event.target.value })} /></label></div><textarea value={quote.terms} onChange={(event) => setQuote({ ...quote, terms: event.target.value })} placeholder="单价/总价口径、税费、运费、付款条件、版费或模具费等" rows={3} /><button className="primary-action inline-submit" disabled={busy || !isReady || !quote.amount || !quote.leadTimeDays} onClick={() => complete(() => submitSupplierQuote(item.id, item.version, { currency: quote.currency, amount: Number(quote.amount), minimumOrderQuantity: Number(quote.minimumOrderQuantity || 0), leadTimeDays: Number(quote.leadTimeDays), terms: quote.terms, sampleArtifactId: approved.id }), `已基于最终样 R${approved.version} 提交报价`)}><BadgeDollarSign size={18} />提交最终样报价</button></>}</div> : <div className="sampling-quote-locked"><LockKeyhole size={17} /><span>等待中台确认最终样后，系统自动开放报价入口。</span></div>}
    </section>;
  }

  const artifactType = item.itemType === "filing_task" ? "filing_document" : "sample_result";
  return <section className="drawer-section oem-panel">
    <header><div><h3>{item.itemType === "filing_task" ? "备案资料回传" : "打样结果回传"}</h3><span>资料与修改轮次按版本保存，不覆盖历史记录</span></div><FileText size={18} /></header>
    <div className="artifact-history">{(detail.oem?.artifacts || []).map((entry) => <div key={entry.id}><FileCheck2 size={16} /><span><b>{entry.title}</b><small>V{entry.version} · {entry.status} · {entry.publicPayload.result}</small></span></div>)}</div>
    <div className="oem-form-grid"><label className="span-two"><span>资料标题</span><input value={artifact.title} onChange={(event) => setArtifact({ ...artifact, title: event.target.value })} placeholder={item.itemType === "filing_task" ? "例如：备案申报资料 V1" : "例如：第一轮样品结果"} /></label><label><span>结果</span><select value={artifact.result} onChange={(event) => setArtifact({ ...artifact, result: event.target.value })}><option value="pending">待确认</option><option value="passed">通过</option><option value="failed">未通过</option><option value="revision_required">需修改</option></select></label></div>
    <textarea value={artifact.summary} onChange={(event) => setArtifact({ ...artifact, summary: event.target.value })} placeholder="填写结果摘要、修改建议或补充说明" rows={3} />
    <button className="primary-action inline-submit" disabled={busy || !isReady || !artifact.title} onClick={() => complete(() => submitOemArtifact(item.id, item.version, { artifactType, title: artifact.title, artifactVersion: (detail.oem?.artifacts?.[0]?.version || 0) + 1, publicPayload: { summary: artifact.summary, result: artifact.result } }), "资料版本已提交，等待中台审核")}><FileCheck2 size={18} />提交资料版本</button>
  </section>;
}

function TaskProgress({ status }: { status: WorkItemStatus }) {
  const active = status === "pending" ? 0 : ["accepted", "in_progress"].includes(status) ? 1 : ["pending_approval", "pending_sync"].includes(status) ? 2 : status === "completed" ? 3 : 1;
  const steps = ["待接单", "处理中", "中台确认", "已完成"];
  return <section className={`task-progress ${["rejected", "cancelled"].includes(status) ? "stopped" : ""}`}>{steps.map((label, index) => <div className={index <= active ? "active" : ""} key={label}><span>{index < active ? <Check size={12} /> : index + 1}</span><b>{index === 2 && status === "pending_approval" ? "待审批" : index === 2 && status === "pending_sync" ? "待同步" : label}</b></div>)}</section>;
}

type StockupInspectionDraft = {
  id: string; workOrderLineId: string; sku: string; productName: string; imageUrl: string; unit: string; expectedQty: number;
  receivedQty: number; goodQty: number; damagedQty: number; shortageQty: number; pendingQty: number; requiresRepack: boolean; replacementCartonCount: number;
  lotNo: string; barcode: string; cartonCount: number; unitsPerCarton: number; cartonLengthCm: number; cartonWidthCm: number; cartonHeightCm: number; cartonWeightKg: number; inspectionNote: string;
};
type StockupExpenseDraft = { key: string; category: string; name: string; amountCny: number; occurredAt: string; vendor: string; invoiceNo: string; note: string; includedInCost: boolean };
type StockupRouteDraft = { key: string; routeType: "overseas_warehouse" | "domestic_customer" | "hold"; destinationName: string; destinationCountry: string; destinationAddress: string; contactName: string; contactPhone: string; carrier: string; transportMode: string; trackingNo: string; freightForwarder: string; status: "ready" | "dispatched" | "in_transit" | "delivered" | "received" | "shelved" | "held"; note: string; quantities: Record<string, number> };

function StockupTaskWorkspace({ detail, actionable, busy, onSubmit }: { detail: WorkItemDetail; actionable: boolean; busy: boolean; onSubmit(payload: Record<string, unknown>): void }) {
  const workOrder = detail.item.publicPayload.workOrder;
  const previous = detail.commands.find((command) => command.commandType === "stockup_process")?.payload as { lines?: Array<Record<string, unknown>>; expenses?: Array<Record<string, unknown>>; routes?: Array<Record<string, unknown>>; note?: string } | undefined;
  const [lines, setLines] = React.useState<StockupInspectionDraft[]>(() => detail.lines.map((line) => {
    const saved = previous?.lines?.find((entry) => entry.workOrderLineId === (line.sourceLineId || line.id));
    const value = (key: string, fallback = 0) => Number(saved?.[key] ?? fallback);
    return { id: line.id, workOrderLineId: line.sourceLineId || line.id, sku: line.sku, productName: line.productName, imageUrl: line.imageUrl, unit: line.unit, expectedQty: line.plannedQuantity,
      receivedQty: value("receivedQty", line.plannedQuantity), goodQty: value("goodQty", line.plannedQuantity), damagedQty: value("damagedQty"), shortageQty: value("shortageQty"), pendingQty: value("pendingQty"),
      requiresRepack: Boolean(saved?.requiresRepack), replacementCartonCount: value("replacementCartonCount"), lotNo: String(saved?.lotNo || line.lotNo || ""), barcode: String(saved?.barcode || line.barcode || ""),
      cartonCount: value("cartonCount"), unitsPerCarton: value("unitsPerCarton"), cartonLengthCm: value("cartonLengthCm"), cartonWidthCm: value("cartonWidthCm"), cartonHeightCm: value("cartonHeightCm"), cartonWeightKg: value("cartonWeightKg"), inspectionNote: String(saved?.inspectionNote || "") };
  }));
  const [expenses, setExpenses] = React.useState<StockupExpenseDraft[]>(() => (previous?.expenses || []).map((expense) => ({ key: crypto.randomUUID(), category: String(expense.category || "其他"), name: String(expense.name || ""), amountCny: Number(expense.amountCny || 0), occurredAt: String(expense.occurredAt || new Date().toISOString().slice(0, 10)), vendor: String(expense.vendor || ""), invoiceNo: String(expense.invoiceNo || ""), note: String(expense.note || ""), includedInCost: expense.includedInCost !== false })));
  const [routes, setRoutes] = React.useState<StockupRouteDraft[]>(() => {
    if (previous?.routes?.length) return previous.routes.map((route) => ({ key: crypto.randomUUID(), routeType: String(route.routeType) as StockupRouteDraft["routeType"], destinationName: String(route.destinationName || ""), destinationCountry: String(route.destinationCountry || ""), destinationAddress: String(route.destinationAddress || ""), contactName: String(route.contactName || ""), contactPhone: String(route.contactPhone || ""), carrier: String(route.carrier || ""), transportMode: String(route.transportMode || ""), trackingNo: String(route.trackingNo || ""), freightForwarder: String(route.freightForwarder || ""), status: String(route.status || "ready") as StockupRouteDraft["status"], note: String(route.note || ""), quantities: Object.fromEntries(((route.lines as Array<Record<string, unknown>>) || []).map((line) => [String(line.workOrderLineId), Number(line.quantity || 0)])) }));
    return [{ key: crypto.randomUUID(), routeType: "overseas_warehouse", destinationName: workOrder?.destinationWarehouseName || detail.item.publicPayload.destinationWarehouseName || "", destinationCountry: workOrder?.destinationCountry || "", destinationAddress: "", contactName: "", contactPhone: "", carrier: "货拉拉 + 国际货代", transportMode: "国际货代", trackingNo: "", freightForwarder: "", status: "ready", note: "", quantities: {} }];
  });
  const [note, setNote] = React.useState(String(previous?.note || ""));
  function patchLine(id: string, patch: Partial<StockupInspectionDraft>) { setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line)); }
  function patchExpense(key: string, patch: Partial<StockupExpenseDraft>) { setExpenses((current) => current.map((expense) => expense.key === key ? { ...expense, ...patch } : expense)); }
  function patchRoute(key: string, patch: Partial<StockupRouteDraft>) { setRoutes((current) => current.map((route) => route.key === key ? { ...route, ...patch } : route)); }
  function addExpense() { setExpenses((current) => [...current, { key: crypto.randomUUID(), category: workOrder?.expenseCategories?.[0] || "换箱费", name: "", amountCny: 0, occurredAt: new Date().toISOString().slice(0, 10), vendor: "", invoiceNo: "", note: "", includedInCost: true }]); }
  function addRoute() { setRoutes((current) => [...current, { key: crypto.randomUUID(), routeType: "domestic_customer", destinationName: "", destinationCountry: "中国", destinationAddress: "", contactName: "", contactPhone: "", carrier: "", transportMode: "国内配送", trackingNo: "", freightForwarder: "", status: "ready", note: "", quantities: {} }]); }
  const quantityValid = lines.every((line) => line.receivedQty === line.goodQty + line.damagedQty + line.pendingQty && line.expectedQty === line.receivedQty + line.shortageQty);
  const packageValid = lines.every((line) => line.goodQty === 0 || (line.lotNo.trim() && line.barcode.trim() && line.cartonCount > 0 && line.unitsPerCarton > 0 && line.cartonLengthCm > 0 && line.cartonWidthCm > 0 && line.cartonHeightCm > 0 && line.cartonWeightKg > 0));
  const allocatedByLine = Object.fromEntries(lines.map((line) => [line.workOrderLineId, routes.reduce((sum, route) => sum + Number(route.quantities[line.workOrderLineId] || 0), 0)]));
  const routesValid = routes.length > 0 && routes.every((route) => route.destinationName.trim() && (route.routeType === "hold" ? route.status === "held" : ["dispatched", "in_transit", "delivered", "received", "shelved"].includes(route.status))) && lines.every((line) => Number(allocatedByLine[line.workOrderLineId]) === line.goodQty);
  const ready = quantityValid && packageValid && routesValid;
  const workflow = [
    { label: "签收验货", done: quantityValid, icon: PackageCheck }, { label: "批号条码", done: lines.every((line) => line.lotNo && line.barcode), icon: ScanLine },
    { label: "箱规称重", done: packageValid, icon: Scale }, { label: "分流发运", done: routesValid, icon: Truck }, { label: "费用凭证", done: true, icon: ReceiptText },
  ];
  function submit() {
    const payloadLines = lines.map(({ id: _id, imageUrl: _imageUrl, productName: _productName, unit: _unit, expectedQty: _expectedQty, ...line }) => line);
    const payloadExpenses = expenses.filter((expense) => expense.amountCny > 0 && expense.name.trim()).map(({ key: _key, ...expense }) => expense);
    const payloadRoutes = routes.map(({ key: _key, quantities, ...route }) => ({ ...route, lines: Object.entries(quantities).filter(([, quantity]) => Number(quantity) > 0).map(([workOrderLineId, quantity]) => ({ workOrderLineId, quantity: Number(quantity) })) }));
    onSubmit({ lines: payloadLines, expenses: payloadExpenses, routes: payloadRoutes, note });
  }
  return <section className="stockup-workspace">
    <div className="stockup-checkrail">{workflow.map(({ label, done, icon: Icon }, index) => <div className={done ? "done" : ""} key={label}><span>{done ? <Check size={14} /> : <Icon size={15} />}</span><b>{label}</b><small>0{index + 1}</small></div>)}</div>
    <section className="stockup-arrival-brief"><div><span>预计到仓</span><b>{fullDate(workOrder?.expectedArrivalAt || detail.item.dueAt)}</b></div><div><span>发货方 / 联系</span><b>{workOrder?.senderName || "未登记"}</b><small>{workOrder?.senderContact || "—"}</small></div><div><span>来货物流</span><b>{workOrder?.inboundCarrier || "未登记"}</b><small>{workOrder?.inboundTrackingNo || "—"}</small></div><div><span>最终计划</span><b>{workOrder?.destinationCountry || "待分配"}</b><small>{workOrder?.destinationWarehouseName || "可转国内客户"}</small></div></section>
    <section className="drawer-section stockup-instructions"><header><h3>仓库作业要求</h3><span>逐项完成后再提交</span></header><p>{workOrder?.instructions || detail.item.description}</p></section>
    <section className="drawer-section stockup-inspection"><header><div><h3>01 · 验收、追溯与装箱</h3><span>数量必须守恒；良品需完整登记批号、条码和箱规。</span></div><PackageCheck size={18} /></header><div>{lines.map((line, index) => <article key={line.id}>
      <header><ProductImage src={line.imageUrl} name={line.productName} className="task-line-image" /><div><small>SKU {String(index + 1).padStart(2, "0")}</small><b>{line.productName}</b><code>{line.sku}</code></div><strong>预计 {line.expectedQty.toLocaleString()} {line.unit}</strong></header>
      <div className="inspection-quantity-grid">{([['receivedQty','实收'],['goodQty','良品'],['damagedQty','破损'],['shortageQty','短缺'],['pendingQty','待判']] as const).map(([key,label]) => <label key={key}><span>{label}</span><input type="number" min="0" step="0.01" disabled={!actionable} value={line[key]} onChange={(event) => patchLine(line.id, { [key]: Number(event.target.value) })} /><em>{line.unit}</em></label>)}</div>
      <div className="trace-grid"><label><span><ScanLine size={14} />批号</span><input disabled={!actionable} value={line.lotNo} onChange={(event) => patchLine(line.id, { lotNo: event.target.value })} placeholder="必填" /></label><label><span><ScanLine size={14} />商品条码</span><input disabled={!actionable} value={line.barcode} onChange={(event) => patchLine(line.id, { barcode: event.target.value })} placeholder="必填" /></label><label className="repack-toggle"><input type="checkbox" disabled={!actionable} checked={line.requiresRepack} onChange={(event) => patchLine(line.id, { requiresRepack: event.target.checked })} /><span>需要换纸箱</span></label><label><span>换箱数量</span><input type="number" min="0" disabled={!actionable || !line.requiresRepack} value={line.replacementCartonCount} onChange={(event) => patchLine(line.id, { replacementCartonCount: Number(event.target.value) })} /></label></div>
      <div className="package-grid"><label><span>箱数</span><input type="number" min="0" disabled={!actionable} value={line.cartonCount} onChange={(event) => patchLine(line.id, { cartonCount: Number(event.target.value) })} /></label><label><span>箱规数量</span><input type="number" min="0" disabled={!actionable} value={line.unitsPerCarton} onChange={(event) => patchLine(line.id, { unitsPerCarton: Number(event.target.value) })} /></label><label><span><Ruler size={13} />长 cm</span><input type="number" min="0" disabled={!actionable} value={line.cartonLengthCm} onChange={(event) => patchLine(line.id, { cartonLengthCm: Number(event.target.value) })} /></label><label><span>宽 cm</span><input type="number" min="0" disabled={!actionable} value={line.cartonWidthCm} onChange={(event) => patchLine(line.id, { cartonWidthCm: Number(event.target.value) })} /></label><label><span>高 cm</span><input type="number" min="0" disabled={!actionable} value={line.cartonHeightCm} onChange={(event) => patchLine(line.id, { cartonHeightCm: Number(event.target.value) })} /></label><label><span><Scale size={13} />单箱 kg</span><input type="number" min="0" step="0.01" disabled={!actionable} value={line.cartonWeightKg} onChange={(event) => patchLine(line.id, { cartonWeightKg: Number(event.target.value) })} /></label></div>
      <label className="inspection-note"><span>验货说明</span><input disabled={!actionable} value={line.inspectionNote} onChange={(event) => patchLine(line.id, { inspectionNote: event.target.value })} placeholder="破损位置、抽检结果、处理方式" /></label>
      {!quantityValid && line.receivedQty !== line.goodQty + line.damagedQty + line.pendingQty ? <p className="inline-validation"><AlertTriangle size={13} />实收应等于良品 + 破损 + 待判</p> : null}
    </article>)}</div></section>
    <section className="drawer-section stockup-routes"><header><div><h3>02 · 分流与发运</h3><span>同一批良品可拆分发往海外仓、国内客户或明确留仓。</span></div>{actionable ? <button className="mini-add" onClick={addRoute}><Plus size={15} />增加去向</button> : null}</header><div>{routes.map((route, routeIndex) => <article key={route.key}><header><span>{String(routeIndex + 1).padStart(2, "0")}</span><select disabled={!actionable} value={route.routeType} onChange={(event) => { const routeType = event.target.value as StockupRouteDraft["routeType"]; patchRoute(route.key, { routeType, status: routeType === "hold" ? "held" : "ready", destinationName: routeType === "hold" ? detail.item.publicPayload.warehouseName || "本仓留仓" : "" }); }}><option value="overseas_warehouse">发往海外仓</option><option value="domestic_customer">发给国内客户</option><option value="hold">留在国内仓</option></select><button disabled={!actionable || routes.length === 1} onClick={() => setRoutes((current) => current.filter((entry) => entry.key !== route.key))}><Trash2 size={15} /></button></header><div className="route-form-grid"><label><span><MapPin size={13} />目的地</span><input disabled={!actionable} value={route.destinationName} onChange={(event) => patchRoute(route.key, { destinationName: event.target.value })} placeholder={route.routeType === "domestic_customer" ? "客户名称" : "仓库名称"} /></label><label><span>国家 / 地区</span><input disabled={!actionable || route.routeType === "hold"} value={route.destinationCountry} onChange={(event) => patchRoute(route.key, { destinationCountry: event.target.value })} /></label><label><span>承运 / 货拉拉</span><input disabled={!actionable || route.routeType === "hold"} value={route.carrier} onChange={(event) => patchRoute(route.key, { carrier: event.target.value })} placeholder="承运方" /></label><label><span>货代 / 运单号</span><input disabled={!actionable || route.routeType === "hold"} value={route.trackingNo || route.freightForwarder} onChange={(event) => patchRoute(route.key, route.routeType === "overseas_warehouse" ? { freightForwarder: event.target.value } : { trackingNo: event.target.value })} /></label><label><span>交接状态</span><select disabled={!actionable || route.routeType === "hold"} value={route.status} onChange={(event) => patchRoute(route.key, { status: event.target.value as StockupRouteDraft["status"] })}>{route.routeType === "hold" ? <option value="held">已确认留仓</option> : <><option value="ready">待交承运</option><option value="dispatched">已交承运</option><option value="in_transit">运输中</option><option value="delivered">已送达</option><option value="received">已签收</option><option value="shelved">已上架</option></>}</select></label></div><div className="route-quantity-grid">{lines.map((line) => <label key={line.id}><span>{line.sku}<small>良品 {line.goodQty}</small></span><input type="number" min="0" max={line.goodQty} disabled={!actionable} value={route.quantities[line.workOrderLineId] || 0} onChange={(event) => patchRoute(route.key, { quantities: { ...route.quantities, [line.workOrderLineId]: Number(event.target.value) } })} /><em>{line.unit}</em></label>)}</div></article>)}</div><div className={`allocation-check ${routesValid ? "ok" : ""}`}>{routesValid ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{routesValid ? "全部良品已完成发运或明确留仓" : lines.map((line) => `${line.sku} 已分配 ${allocatedByLine[line.workOrderLineId] || 0}/${line.goodQty}`).join(" · ")}</span></div></section>
    <section className="drawer-section stockup-expenses"><header><div><h3>03 · 仓内费用</h3><span>换箱、贴标、装卸、耗材、仓储和货拉拉费用将进入中台成本复核。</span></div>{actionable ? <button className="mini-add" onClick={addExpense}><Plus size={15} />登记费用</button> : null}</header>{expenses.length ? <div>{expenses.map((expense) => <article key={expense.key}><select disabled={!actionable} value={expense.category} onChange={(event) => patchExpense(expense.key, { category: event.target.value })}>{(workOrder?.expenseCategories || ["换箱费", "贴标费", "装卸费", "包装耗材", "仓储费", "货拉拉费", "其他"]).map((category) => <option key={category}>{category}</option>)}</select><input disabled={!actionable} value={expense.name} onChange={(event) => patchExpense(expense.key, { name: event.target.value })} placeholder="费用说明" /><label><span>¥</span><input type="number" min="0" step="0.01" disabled={!actionable} value={expense.amountCny} onChange={(event) => patchExpense(expense.key, { amountCny: Number(event.target.value) })} /></label><input type="date" disabled={!actionable} value={expense.occurredAt} onChange={(event) => patchExpense(expense.key, { occurredAt: event.target.value })} /><button disabled={!actionable} onClick={() => setExpenses((current) => current.filter((entry) => entry.key !== expense.key))}><Trash2 size={15} /></button></article>)}</div> : <p className="expense-empty">本批次如未产生仓内费用，可以直接提交；后续中台仍可补录成本。</p>}</section>
    <section className="stockup-submit"><label><span>完结说明</span><textarea disabled={!actionable} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="填写验货结论、异常处理及发运交接说明" /></label><div><span>{ready ? <><CheckCircle2 size={17} />作业数据完整，可提交中台</> : <><AlertTriangle size={17} />请完成数量校验、追溯箱规和全部良品分流</>}</span><button className="primary-action" disabled={!actionable || busy || !ready} onClick={submit}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileCheck2 size={18} />}完结仓库作业并回传</button></div></section>
  </section>;
}

function TaskDetailDrawer({ item, onClose, onChanged, notify }: { item: WorkItem; onClose(): void; onChanged(): void; notify(message: string, tone: "success" | "error"): void }) {
  const [detail, setDetail] = React.useState<WorkItemDetail | null>(null); const [lineDrafts, setLineDrafts] = React.useState<TaskLine[]>([]); const [busy, setBusy] = React.useState(false); const [note, setNote] = React.useState(""); const [files, setFiles] = React.useState<FileList | null>(null);
  const load = React.useCallback(() => fetchWorkItem(item.id).then((value) => { setDetail(value); setLineDrafts(value.lines.map((line) => ({ ...line, completedQuantity: line.completedQuantity || line.plannedQuantity }))); }), [item.id]); React.useEffect(() => { load(); }, [load]);
  function patchLine(id: string, patch: Partial<TaskLine>) { setLineDrafts((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line)); }
  async function act(action: string, extra: Record<string, unknown> = {}) { if (!detail) return; setBusy(true); try { await submitAction(item.id, detail.item.version, { action, note, ...extra }); if (files?.length) for (const file of Array.from(files)) await uploadAttachment(item.id, file); notify(action === "accept" ? "任务已接单" : action === "progress" ? "工单已进入处理中" : "操作已提交，等待中台确认", "success"); await load(); onChanged(); } catch (reason) { notify(reason instanceof Error ? reason.message : "操作失败", "error"); } finally { setBusy(false); } }
  const actionable = detail && ["accepted", "in_progress"].includes(detail.item.status);
  const lines = lineDrafts;
  const isPartnerOrder = ["production_order", "purchase_order"].includes(item.itemType);
  const isOem = ["filing_task", "sampling_task", "packaging_quote"].includes(item.itemType);
  const isPrivateTask = isOem || isPartnerOrder;
  const isStockup = detail?.item.itemType === "warehouse_stockup";
  const confirmationAction = detail?.item.itemType === "warehouse_transfer" ? "transfer_receive" : detail?.item.itemType === "warehouse_inbound" ? "inbound_confirm" : detail?.item.itemType === "warehouse_outbound" ? "outbound_confirm" : "";
  const genericCompletion = detail?.item.itemType === "warehouse_exception";
  const linePayload = lines.map((line) => ({ sku: line.sku, quantity: Number(line.completedQuantity), lotNo: line.lotNo, barcode: line.barcode, productionDate: line.productionDate, expiryDate: line.expiryDate }));
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={`task-drawer ${item.itemType === "warehouse_stockup" ? "stockup-drawer" : ""}`}>
    <header className="drawer-head"><button className="icon-button" onClick={onClose}><X size={20} /></button><div><TaskType type={item.itemType} /><h2>{item.title}</h2><span>{item.publicPayload.referenceNo || item.publicPayload.orderNo || item.publicPayload.projectCode}</span></div><StatusPill status={detail?.item.status || item.status} /></header>
    {!detail ? <div className="loading-state grow"><LoaderCircle className="spin" />正在加载任务详情…</div> : <div className="drawer-body">
      {!isOem ? <TaskProgress status={detail.item.status} /> : null}
      <section className="task-facts"><div><span>{isPartnerOrder ? "订单编号" : isOem ? "定制项目" : "协作仓库"}</span><b>{isPartnerOrder ? detail.item.publicPayload.orderNo : isOem ? detail.item.publicPayload.projectCode : detail.item.publicPayload.warehouseName}</b></div><div><span>{isPrivateTask ? "产品 / 规格" : "截止时间"}</span><b>{isPrivateTask ? `${detail.item.publicPayload.productName || "—"}${detail.item.publicPayload.productSpec ? ` · ${detail.item.publicPayload.productSpec}` : ""}` : fullDate(detail.item.dueAt)}</b></div><div><span>当前版本</span><b>V{detail.item.version}</b></div><div><span>{isPrivateTask ? "要求交期" : "主账同步"}</span><b>{isPrivateTask ? (detail.item.publicPayload.deliveryDate || fullDate(detail.item.dueAt)) : formatDate(detail.item.lastCoreSyncedAt)}</b></div></section>
      {!isPrivateTask && !isStockup ? <section className="drawer-section"><header><h3>作业明细</h3><span>{lines.length} 个 SKU · 可填写实际数量</span></header><div className="line-list editable-lines">{lines.map((line: TaskLine, index) => <div key={line.id}><ProductImage src={line.imageUrl} name={line.productName} className="task-line-image" /><div><b>{line.productName}</b><code>{line.sku}</code><small>计划 {line.plannedQuantity.toLocaleString()} {line.unit}{line.lotNo ? ` · 批次 ${line.lotNo}` : ""}</small>{actionable && confirmationAction ? <div className="line-metadata"><input value={line.lotNo} onChange={(event) => patchLine(line.id, { lotNo: event.target.value })} placeholder="批次号" /><input value={line.barcode} onChange={(event) => patchLine(line.id, { barcode: event.target.value })} placeholder="条码" />{detail.item.itemType === "warehouse_inbound" ? <><input type="date" aria-label="生产日期" value={line.productionDate} onChange={(event) => patchLine(line.id, { productionDate: event.target.value })} /><input type="date" aria-label="有效期至" value={line.expiryDate} onChange={(event) => patchLine(line.id, { expiryDate: event.target.value })} /></> : null}</div> : null}</div><label><span>实际数量</span><input type="number" min="0.0001" step="0.0001" value={line.completedQuantity} disabled={!actionable || !confirmationAction} onChange={(event) => patchLine(line.id, { completedQuantity: Number(event.target.value) })} /><em>{line.unit}</em></label><span className="line-index">{String(index + 1).padStart(2, "0")}</span></div>)}</div></section> : isPrivateTask ? <section className="oem-brief"><span>{isPartnerOrder ? (detail.item.publicPayload.fulfillmentMode === "turnkey" ? "全包加工要求" : detail.item.itemType === "purchase_order" ? "采购交付要求" : "来料加工要求") : "对外发布内容"}</span><p>{detail.item.description || detail.item.publicPayload.requirements || "请按已发布版本完成协同。"}</p><small>{isPartnerOrder ? `订单 ${detail.item.publicPayload.orderNo || "—"}` : `资料版本 ${detail.item.publicPayload.documentVersion || `V${detail.item.version}`}`} · 数量 {Number(detail.item.publicPayload.quantity || 0).toLocaleString()} {detail.item.publicPayload.unit || "件"}{isPartnerOrder && detail.item.publicPayload.deliveryAddress ? ` · 交付 ${detail.item.publicPayload.deliveryAddress}` : ""}</small></section> : null}
      {isStockup ? <StockupTaskWorkspace detail={detail} actionable={Boolean(actionable)} busy={busy} onSubmit={(payload) => void act("stockup_process", payload)} /> : null}
      <section className="drawer-section"><header><h3>{isStockup ? "现场凭证" : "处理说明与凭证"}</h3><span>写入后不可删除审计记录</span></header>{(!isPrivateTask && !isStockup) || detail.item.itemType === "sampling_task" ? <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={detail.item.itemType === "sampling_task" ? "填写当前打样阶段、完成情况或需要中台确认的问题…" : "填写到货情况、差异或处理说明…"} rows={3} /> : null}<label className="upload-zone"><input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/csv" onChange={(event) => setFiles(event.target.files)} /><Camera size={22} /><span><b>{files?.length ? `已选择 ${files.length} 个文件` : "拍照或选择附件"}</b><small>{isStockup ? "外箱、破损、换箱和发运凭证；" : ""}图片、PDF、CSV，单个不超过 50MB</small></span><Upload size={18} /></label>{detail.attachments.length ? <div className="attachment-records">{detail.attachments.map((attachment) => <span key={attachment.id}><FileText size={14} />{attachment.fileName}<em>{attachment.scanStatus === "clean" ? "已校验" : "处理中"}</em></span>)}</div> : null}</section>
      {detail.commands.length ? <section className="drawer-section command-results"><header><h3>中台处理结果</h3><span>{detail.commands.length} 条提交</span></header>{detail.commands.map((command) => <article key={command.id}><span className={`command-state ${command.status}`}><CircleDot size={13} />{command.status === "pending_approval" ? "待审批" : command.status === "pending_sync" ? "待同步" : command.status === "applied" ? "已入账" : command.status === "rejected" ? "已驳回" : command.status}</span><div><b>{command.resultMessage || "操作已提交"}</b><small>{command.coreReference ? `主账单号 ${command.coreReference} · ` : ""}{fullDate(command.submittedAt)}</small></div></article>)}</section> : null}
      {isPartnerOrder ? <PartnerOrderWorkspace detail={detail} busy={busy} setBusy={setBusy} reload={load} onChanged={onChanged} notify={notify} files={files} clearFiles={() => setFiles(null)} /> : isOem ? <OemWorkspace detail={detail} busy={busy} setBusy={setBusy} reload={load} onChanged={onChanged} notify={notify} files={files} /> : null}
      <section className="drawer-section timeline"><header><h3>协同记录</h3></header>{detail.events.map((event) => <div className="timeline-row" key={event.id}><span /><div><b>{event.actorName}</b><p>{event.body || event.eventType}</p><small>{fullDate(event.createdAt)}</small></div></div>)}</section>
    </div>}
    {detail ? <footer className="drawer-actions">{detail.item.status === "pending" ? <button className="primary-action" disabled={busy} onClick={() => act("accept")}><Check size={18} />接受任务</button> : null}{detail.item.itemType === "sampling_task" && actionable ? <>{detail.item.status === "accepted" ? <button className="secondary-action" disabled={busy} onClick={() => act("progress", { note: note || "已开始打样", percent: 10 })}><Clock3 size={17} />开始打样</button> : <button className="secondary-action" disabled={busy || !note} onClick={() => act("progress", { note, percent: 50 })}><RefreshCw size={17} />汇报打样进度</button>}</> : null}{!isPrivateTask && !isStockup && actionable ? <>{detail.item.status === "accepted" ? <button className="secondary-action" disabled={busy} onClick={() => act("progress", { note: "仓库已开始处理工单", percent: 10 })}><Clock3 size={17} />开始处理</button> : null}<button className="danger-action" disabled={busy || !note} onClick={() => act("report_exception", { category: "warehouse_operation" })}><AlertTriangle size={17} />上报异常</button>{confirmationAction ? <button className="primary-action" disabled={busy || !lines.length || lines.some((line) => Number(line.completedQuantity) <= 0)} onClick={() => act(confirmationAction, { lines: linePayload })}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileCheck2 size={18} />}确认完成并回传</button> : null}{genericCompletion ? <button className="primary-action" disabled={busy} onClick={() => act("complete")}>{busy ? <LoaderCircle className="spin" size={18} /> : <FileCheck2 size={18} />}完成任务并回传</button> : null}</> : null}{!["pending", "accepted", "in_progress", ...(isPartnerOrder ? ["pending_sync"] : [])].includes(detail.item.status) ? <div className="waiting-note">{detail.item.status === "completed" ? <CheckCircle2 size={17} /> : <RefreshCw className="spin" size={17} />}<span>{detail.item.status === "completed" ? "该工单已完成并保留完整处理记录。" : detail.item.status === "rejected" ? "该申请已被驳回，请查看中台处理结果。" : "当前操作已提交，请等待中台处理；无需重复操作。"}</span></div> : null}</footer> : null}
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
  const mode = organizationMode(session);
  React.useEffect(() => { if ((route === "members" && !canManageMembers) || (route === "inventory" && mode !== "warehouse")) navigate("overview"); }, [route, canManageMembers, mode, navigate]);
  async function openTaskById(id: string) { try { const detail = await fetchWorkItem(id); setSelected(detail.item); } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "任务不存在", tone: "error" }); } }
  const visibleRoutes = (Object.entries(routeMeta) as Array<[Route, typeof routeMeta[Route]]>).filter(([key]) => (key !== "members" || canManageMembers) && (key !== "inventory" || mode === "warehouse"));
  const mobileRoutes = visibleRoutes.filter(([key]) => key !== "account");
  const page = route === "overview" ? <OverviewPage key={refreshKey} session={session} onOpenTask={setSelected} onNavigate={navigate} /> : route === "tasks" ? <TasksPage key={refreshKey} session={session} onOpenTask={setSelected} /> : route === "inventory" && mode === "warehouse" ? <InventoryPage key={refreshKey} session={session} onOpenTask={setSelected} notify={showToast} /> : route === "members" && canManageMembers ? <MembersPage session={session} notify={showToast} /> : route === "account" ? <AccountPage session={session} onSessionChange={onSessionChange} notify={showToast} /> : <NotificationsPage key={refreshKey} onOpenTask={openTaskById} />;
  return <div className="portal-shell">
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="sidebar-brand"><span><Boxes size={23} /></span><div><b>同舟协同</b><small>PARTNER PORTAL</small></div></div><div className="org-card"><span><Building2 size={17} /></span><div><small>当前组织</small><b>{session.organization.name}</b><code>{session.organization.code}</code></div><ShieldCheck size={17} /></div><nav>{visibleRoutes.map(([key, meta]) => { const Icon = meta.icon; return <button key={key} className={route === key ? "active" : ""} onClick={() => { navigate(key); setMobileNav(false); }}><Icon size={20} /><span>{routeLabel(session, key)}</span>{key === "notifications" ? <i /> : null}</button>; })}</nav><div className="sidebar-scope"><ShieldCheck size={18} /><div><b>数据边界已锁定</b><span>仅访问本组织资料</span></div></div><button className="profile-card" onClick={() => navigate("account")}><span><UserRound size={19} /></span><div><b>{session.user.displayName}</b><small>{session.user.email || "未设置找回邮箱"}</small></div><ChevronRight size={17} /></button><button className="sidebar-logout" onClick={onLogout}><LogOut size={16} />退出登录</button></aside>
    {mobileNav ? <button className="nav-scrim" onClick={() => setMobileNav(false)} aria-label="关闭导航" /> : null}
    <main className="main-stage"><header className="topbar"><button className="menu-button" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div><span>{routeLabel(session, route)}</span><small>组织级安全协同 · {session.organization.code}</small></div><div className="topbar-actions"><button onClick={() => navigate("notifications")} aria-label="消息"><Bell size={19} /><i /></button><span className="online-mark"><i />在线</span></div></header><div className="page-content">{page}</div></main>
    <nav className={`mobile-tabs ${canManageMembers ? "with-members" : ""}`}>{mobileRoutes.map(([key, meta]) => { const Icon = meta.icon; return <button key={key} className={route === key ? "active" : ""} onClick={() => navigate(key)}><Icon size={21} /><span>{routeLabel(session, key).slice(0, 2)}</span></button>; })}</nav>
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

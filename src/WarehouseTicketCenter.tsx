import React from "react";
import { AlertTriangle, CheckCircle2, Clock3, Download, FileText, LoaderCircle, PackageSearch, Plus, RefreshCw, Search, Send, Upload, X } from "lucide-react";
import {
  AuthUser,
  NotificationDeliveryOutcome,
  WarehouseTicket,
  WarehouseTicketAttachment,
  WarehouseTicketPayload,
  createWarehouseTicket,
  downloadWarehouseTicketAttachment,
  fetchWarehouseTicket,
  fetchWarehouseTickets,
  updateWarehouseTicket,
  uploadWarehouseTicketAttachment,
} from "./api";

const categories = ["订单催促", "发货/物流问题", "库存/缺货问题", "入库/上架问题", "费用/赔付问题", "数据/系统问题", "其他问题"];
const statusMeta: Record<string, { label: string; tone: string }> = {
  pending_warehouse: { label: "待仓库受理", tone: "warning" },
  processing: { label: "仓库处理中", tone: "info" },
  resolved: { label: "已解决", tone: "good" },
  cancelled: { label: "已取消", tone: "muted" },
};

function hasPermission(user: AuthUser, permission: string) {
  return Boolean(user.permissions?.includes(permission));
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function notificationMessage(prefix: string, outcome?: NotificationDeliveryOutcome) {
  if (outcome?.status === "sent") return `${prefix}，企业微信已推送至 ${outcome.robotCount} 个接收群。`;
  if (outcome?.status === "failed") return `${prefix}，但企业微信推送失败：${outcome.message || "请检查机器人配置"}`;
  return `${prefix}，但企业微信场景未启用或未配置接收群。`;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败。"));
    reader.readAsDataURL(file);
  });
}

export function WarehouseTicketCenter({ currentUser, initialTicketId = "", initialView = "" }: {
  currentUser: AuthUser;
  initialTicketId?: string;
  initialView?: "mine" | "warehouse" | "";
}) {
  const canReport = hasPermission(currentUser, "warehouse_ticket_report");
  const canWarehouse = hasPermission(currentUser, "warehouse_ticket_warehouse");
  const canAdmin = hasPermission(currentUser, "operations");
  const [tab, setTab] = React.useState<"create" | "mine" | "warehouse">(canReport ? "create" : "warehouse");
  const [payload, setPayload] = React.useState<WarehouseTicketPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [warehouseId, setWarehouseId] = React.useState("");
  const [category, setCategory] = React.useState("订单催促");
  const [priority, setPriority] = React.useState<"normal" | "urgent">("normal");
  const [relatedOrderNumber, setRelatedOrderNumber] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [attachments, setAttachments] = React.useState<WarehouseTicketAttachment[]>([]);
  const [selectedTicket, setSelectedTicket] = React.useState<WarehouseTicket | null>(null);
  const [warehouseRemark, setWarehouseRemark] = React.useState("");
  const openedDeepLinkRef = React.useRef("");

  const refresh = React.useCallback(async (filters: { mine?: boolean; status?: string; keyword?: string } = {}) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchWarehouseTickets(filters);
      setPayload(result);
      setWarehouseId((current) => current || result.warehouseOptions?.[0]?.id || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取仓库工单失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh({ mine: tab === "mine", status: tab === "create" ? "all" : status, keyword: tab === "create" ? "" : keyword });
  }, [refresh, tab]);

  React.useEffect(() => {
    const ticketId = initialTicketId.trim();
    if (!ticketId || openedDeepLinkRef.current === ticketId) return;
    openedDeepLinkRef.current = ticketId;
    setTab(initialView === "warehouse" && canWarehouse ? "warehouse" : canReport ? "mine" : "warehouse");
    void openTicket({ id: ticketId });
  }, [initialTicketId, initialView, canReport, canWarehouse]);

  async function uploadFiles(files: FileList | null) {
    const selected = Array.from(files || []).slice(0, 8);
    if (!selected.length) return;
    setBusy("upload");
    setError("");
    try {
      const uploaded: WarehouseTicketAttachment[] = [];
      for (const file of selected) uploaded.push((await uploadWarehouseTicketAttachment({ fileName: file.name, dataUrl: await fileToDataUrl(file) })).upload);
      setAttachments((current) => [...current, ...uploaded].slice(0, 8));
      setMessage(`已上传 ${uploaded.length} 个附件。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传附件失败。");
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    if (!warehouseId) return setError("请选择处理仓库。");
    if (category === "订单催促" && !relatedOrderNumber.trim()) return setError("订单催促工单请填写关联订单号。");
    if (!title.trim() || !description.trim()) return setError("请填写工单主题和详细说明。");
    setBusy("submit");
    setError("");
    try {
      const result = await createWarehouseTicket({ warehouseId, category, priority, relatedOrderNumber, title, description, attachmentIds: attachments.map((item) => item.id) });
      setMessage(notificationMessage(`仓库工单 ${result.ticket.id} 已提交`, result.notification));
      setRelatedOrderNumber("");
      setTitle("");
      setDescription("");
      setAttachments([]);
      setPriority("normal");
      setTab("mine");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交仓库工单失败。");
    } finally {
      setBusy("");
    }
  }

  async function openTicket(ticket: Pick<WarehouseTicket, "id">) {
    setBusy(`detail:${ticket.id}`);
    try {
      const result = await fetchWarehouseTicket(ticket.id);
      setSelectedTicket(result.ticket);
      setWarehouseRemark(result.ticket.warehouseRemark || "");
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "读取仓库工单详情失败。");
    } finally {
      setBusy("");
    }
  }

  async function act(action: "accept" | "reply" | "resolve" | "cancel" | "reopen") {
    if (!selectedTicket) return;
    if (action === "reply" && !warehouseRemark.trim()) return setError("发送回复前，请填写仓库回复内容。");
    if (action === "resolve" && !warehouseRemark.trim()) return setError("完结工单前，请填写处理结果。");
    setBusy(action);
    setError("");
    try {
      const result = await updateWarehouseTicket(selectedTicket.id, { action, warehouseRemark, note: warehouseRemark });
      setSelectedTicket(result.ticket);
      if (action === "reply") setWarehouseRemark("");
      setMessage(notificationMessage(action === "reply" ? `${result.ticket.id} 的回复已提交` : `${result.ticket.id} 已更新为“${statusMeta[result.ticket.status]?.label || result.ticket.status}”`, result.notification));
      await refresh({ mine: tab === "mine", status, keyword });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "更新仓库工单失败。");
    } finally {
      setBusy("");
    }
  }

  async function download(attachment: WarehouseTicketAttachment) {
    try {
      const blob = await downloadWarehouseTicketAttachment(attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "下载附件失败。");
    }
  }

  const renderList = (mine: boolean) => (
    <section className="wt-panel">
      <div className="wt-toolbar">
        <label><Search size={17} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索工单号、订单号或主题" /></label>
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusMeta).map(([key, meta]) => <option value={key} key={key}>{meta.label}</option>)}</select>
        <button type="button" onClick={() => void refresh({ mine, status, keyword })} disabled={loading}><RefreshCw className={loading ? "spinning" : ""} size={16} />查询</button>
      </div>
      <div className="wt-ticket-list">
        {loading ? <div className="wt-empty"><LoaderCircle className="spinning" />正在读取仓库工单…</div> : null}
        {!loading && !payload?.tickets.length ? <div className="wt-empty"><PackageSearch />当前筛选下没有仓库工单</div> : null}
        {(payload?.tickets || []).map((ticket) => <button type="button" className="wt-ticket-row" key={ticket.id} onClick={() => void openTicket(ticket)}>
          <span className={`wt-priority ${ticket.priority}`}>{ticket.priority === "urgent" ? "紧急" : "普通"}</span>
          <span><strong>{ticket.id}</strong><small>{ticket.relatedOrderNumber || "无关联订单"}</small></span>
          <span><strong>{ticket.title}</strong><small>{ticket.category} · {ticket.createdBy}</small></span>
          <span><strong>{ticket.warehouseName}</strong><small>{dateTime(ticket.updatedAt)}</small></span>
          <span className={`as-status ${statusMeta[ticket.status]?.tone || "muted"}`}>{statusMeta[ticket.status]?.label || ticket.status}</span>
        </button>)}
      </div>
    </section>
  );

  return <div className="warehouse-ticket-center">
    <section className="wt-summary-grid">
      <article><Clock3 /><span>待仓库受理</span><strong>{payload?.summary.pendingWarehouse || 0}</strong></article>
      <article><RefreshCw /><span>处理中</span><strong>{payload?.summary.processing || 0}</strong></article>
      <article><AlertTriangle /><span>紧急待办</span><strong>{payload?.summary.urgent || 0}</strong></article>
      <article><CheckCircle2 /><span>累计解决</span><strong>{payload?.summary.resolved || 0}</strong></article>
    </section>
    <nav className="wt-tabs">
      {canReport ? <button className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}><Plus size={17} />提交工单</button> : null}
      {canReport ? <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}><FileText size={17} />我的工单</button> : null}
      {canWarehouse ? <button className={tab === "warehouse" ? "active" : ""} onClick={() => setTab("warehouse")}><PackageSearch size={17} />仓库处理</button> : null}
    </nav>
    {error ? <div className="notice error"><AlertTriangle size={17} />{error}</div> : null}
    {message ? <div className="notice success"><CheckCircle2 size={17} />{message}</div> : null}
    {tab === "create" && canReport ? <section className="wt-create-shell">
      <div className="wt-create-main">
        <header><p className="eyebrow">WAREHOUSE REQUEST</p><h2>提交仓库工单</h2><span>用于催单、库存、入库、物流及日常问题协同；提交后会通知对应仓库。</span></header>
        <div className="wt-form-grid">
          <label><span>处理仓库 *</span><select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="">请选择仓库</option>{(payload?.warehouseOptions || []).map((item) => <option value={item.id} key={item.id}>{item.name}{item.country ? ` · ${item.country}` : ""}</option>)}</select></label>
          <label><span>工单类型 *</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>优先级 *</span><select value={priority} onChange={(event) => setPriority(event.target.value as "normal" | "urgent")}><option value="normal">普通</option><option value="urgent">紧急</option></select></label>
          <label><span>关联平台订单号{category === "订单催促" ? " *" : ""}</span><input value={relatedOrderNumber} onChange={(event) => setRelatedOrderNumber(event.target.value)} placeholder="填写平台后台订单号" /></label>
          <label className="wide"><span>工单主题 *</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="一句话说明需要仓库处理什么" /></label>
          <label className="wide"><span>详细说明 *</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="请写清问题现象、期望仓库动作、截止时间及已核实的信息。" /></label>
        </div>
        <label className="wt-upload"><Upload size={21} /><strong>{busy === "upload" ? "正在上传…" : "上传截图或 PDF"}</strong><span>最多 8 个，单个不超过 8MB</span><input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={(event) => void uploadFiles(event.target.files)} /></label>
        {attachments.length ? <div className="wt-files">{attachments.map((item) => <span key={item.id}><FileText size={15} />{item.fileName}<button onClick={() => setAttachments((current) => current.filter((file) => file.id !== item.id))}><X size={14} /></button></span>)}</div> : null}
      </div>
      <aside><strong>提交前检查</strong><p>订单催促请使用平台后台订单号；问题描述请写清希望仓库完成的动作。</p><button type="button" onClick={() => void submit()} disabled={Boolean(busy)}>{busy === "submit" ? <LoaderCircle className="spinning" size={18} /> : <Send size={18} />}{busy === "submit" ? "正在提交" : "提交给仓库"}</button></aside>
    </section> : null}
    {tab === "mine" && canReport ? renderList(true) : null}
    {tab === "warehouse" && canWarehouse ? renderList(false) : null}
    {selectedTicket ? <div className="as-drawer-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setSelectedTicket(null)}><aside className="as-ticket-drawer wt-drawer">
      <header><div><p className="eyebrow">WAREHOUSE TICKET</p><h2>{selectedTicket.id}</h2><span>{selectedTicket.category} · {selectedTicket.warehouseName}</span></div><button onClick={() => setSelectedTicket(null)}><X size={19} /></button></header>
      <div className="as-drawer-scroll">
        <section className="as-ticket-summary"><span className={`as-status ${statusMeta[selectedTicket.status]?.tone || "muted"}`}>{statusMeta[selectedTicket.status]?.label || selectedTicket.status}</span><div><small>优先级</small><strong>{selectedTicket.priority === "urgent" ? "紧急" : "普通"}</strong></div><div><small>关联订单</small><strong>{selectedTicket.relatedOrderNumber || "未关联"}</strong></div></section>
        <section className="as-drawer-section"><header><div><small>工单主题</small><strong>{selectedTicket.title}</strong></div></header><p>{selectedTicket.description}</p></section>
        <section className="as-drawer-section"><header><div><small>附件</small><strong>{selectedTicket.attachments.length} 个</strong></div></header>{selectedTicket.attachments.length ? <div className="wt-detail-files">{selectedTicket.attachments.map((item) => <button key={item.id} onClick={() => void download(item)}><FileText size={18} /><span>{item.fileName}</span><Download size={15} /></button>)}</div> : <span className="as-empty-inline">暂无附件</span>}</section>
        {canWarehouse ? <section className="as-drawer-section"><label className="as-textarea"><span>仓库回复 / 处理说明</span><textarea value={warehouseRemark} onChange={(event) => setWarehouseRemark(event.target.value)} placeholder="填写核查进展、预计处理时间或最终结果；发送回复后运营会立即收到企业微信通知。" /></label></section> : selectedTicket.warehouseRemark ? <section className="as-drawer-section"><header><div><small>仓库处理说明</small><strong>最近更新</strong></div></header><p>{selectedTicket.warehouseRemark}</p></section> : null}
        {selectedTicket.notifications?.length ? <section className="as-drawer-section as-notification-state"><header><div><small>企业微信通知</small><strong>最近一次：{selectedTicket.notifications.at(-1)?.status === "sent" ? "已发送" : selectedTicket.notifications.at(-1)?.status === "failed" ? "发送失败" : "未配置"}</strong></div></header><span>{dateTime(selectedTicket.notifications.at(-1)?.createdAt)}{selectedTicket.notifications.at(-1)?.message ? ` · ${selectedTicket.notifications.at(-1)?.message}` : ""}</span></section> : null}
        <section className="as-drawer-section as-timeline"><header><div><small>处理时间线</small><strong>{selectedTicket.timeline.length} 个节点</strong></div></header>{[...selectedTicket.timeline].reverse().map((item, index) => <div className="as-timeline-item" key={item.id}><i className={index === 0 ? "active" : ""} /><div><strong>{item.label}</strong><span>{item.actor} · {dateTime(item.createdAt)}</span>{item.note ? <p>{item.note}</p> : null}</div></div>)}</section>
      </div>
      {canWarehouse || canAdmin ? <footer>{selectedTicket.status === "pending_warehouse" ? <button className="primary" onClick={() => void act("accept")} disabled={Boolean(busy)}>确认受理</button> : null}{["pending_warehouse", "processing"].includes(selectedTicket.status) ? <button onClick={() => void act("reply")} disabled={Boolean(busy) || !warehouseRemark.trim()}>发送回复</button> : null}{["pending_warehouse", "processing"].includes(selectedTicket.status) ? <button className="primary" onClick={() => void act("resolve")} disabled={Boolean(busy)}>填写结果并完结</button> : null}{canAdmin && !["resolved", "cancelled"].includes(selectedTicket.status) ? <button className="danger" onClick={() => void act("cancel")} disabled={Boolean(busy)}>取消工单</button> : null}{canAdmin && ["resolved", "cancelled"].includes(selectedTicket.status) ? <button onClick={() => void act("reopen")} disabled={Boolean(busy)}>重新打开</button> : null}</footer> : null}
    </aside></div> : null}
  </div>;
}

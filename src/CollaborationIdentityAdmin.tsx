import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Boxes, Building2, Check, CheckCircle2, ChevronRight, ClipboardCheck, Copy, Download, Factory, FileText, FlaskConical, Handshake, Image as ImageIcon, KeyRound, LoaderCircle, LockKeyhole, Mail, PackageCheck, Paperclip, Plus, RefreshCw, RotateCcw, Save, Search, Send, ShieldCheck, Target, Trash2, Upload, UserPlus, Users, Warehouse, X, XCircle } from "lucide-react";
import {
  bootstrapCollaborationOrganization,
  awardCollaborationSupplierQuote,
  CollaborationAccessGrant,
  CollaborationAccessGrantPayload,
  CollaborationApproval,
  CollaborationInvitation,
  CollaborationInvitationResult,
  CollaborationMember,
  CollaborationOrganization,
  CollaborationOrganizationAccess,
  CollaborationOrganizationStatus,
  CollaborationOrganizationType,
  CollaborationOutsourcingSource,
  CollaborationPartnerOrderReport,
  CollaborationPartnerTaskInput,
  CollaborationPartnerTaskType,
  CollaborationPartnerWorkItem,
  CollaborationPartnerWorkItemDetail,
  downloadCollaborationOrganizationWorkItemAttachment,
  fetchCollaborationOrganizationAccess,
  fetchCollaborationOrganizationAccessGrants,
  fetchCollaborationApprovals,
  fetchCollaborationOrganizations,
  fetchCollaborationOrganizationWorkItems,
  fetchCollaborationOrganizationWorkItem,
  fetchCollaborationOutsourcingSource,
  publishCollaborationPartnerTask,
  reissueCollaborationInvitation,
  revokeCollaborationInvitation,
  replaceCollaborationOrganizationAccessGrants,
  reviewCollaborationCommand,
  reviewCollaborationSampleArtifact,
  saveCollaborationOutsourcingSource,
  syncCollaborationOutsourcingSource,
  updateCollaborationOrganizationStatus,
  updateCollaborationMemberCredentials,
  uploadCollaborationOrganizationWorkItemAttachment,
} from "./collaboration-identity-admin-api";
import { DomesticWarehouse, fetchDomesticWarehouses, fetchWarehouses, WarehouseConnection } from "./api";
import { organizationRoleLabels } from "./collaboration-role-model";
import "./collaboration-identity-admin.css";

const organizationTypes: Array<{ value: CollaborationOrganizationType; label: string; hint: string }> = [
  { value: "warehouse", label: "国内仓 / 海外仓", hint: "入出库、调拨、库存与异常协同" },
  { value: "filing_service", label: "备案服务商", hint: "资料补充、备案节点与结果协同" },
  { value: "sampling_factory", label: "打样工厂", hint: "样品轮次、修改意见与确认协同" },
  { value: "packaging_factory", label: "包装厂", hint: "包装盒/包装瓶打样、采购与私有询报价" },
  { value: "production_factory", label: "委外生产工厂", hint: "加工为主，可同时承接物料采购与打样" },
  { value: "material_supplier", label: "物料供应商", hint: "内料打样、采购单、交期、发货与异常协同" },
];

const statusLabels: Record<CollaborationOrganizationStatus, string> = { active: "使用中", suspended: "已停用", archived: "已归档" };
const roleLabels: Record<string, string> = { organization_admin: "组织管理员", manager: "业务经理", operator: "操作员", finance: "财务", viewer: "只读成员" };
const partnerPortalUrl = "https://partner.tongzhoukuajing.com";

type ProvisionedAccess = { organizationName: string; username: string; password: string };
type WarehouseOption = { ref: string; name: string; meta: string; resourceType: "warehouse" | "organization"; capabilities?: CollaborationAccessGrantPayload["capabilities"] };

function provisioningMessage(access: ProvisionedAccess) {
  return `您好，已为您更新同舟伙伴协同登录凭据。\n伙伴登录网址：${partnerPortalUrl}\n组织名称：${access.organizationName}\n登录账号：${access.username}\n登录密码：${access.password}\n收到后可直接登录；邮箱可登录后在“账号安全”中补充，用于找回密码。`;
}

function formatTime(value?: string) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚无记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function warehouseDirectory(domestic: DomesticWarehouse[], connected: WarehouseConnection[], grants: CollaborationAccessGrant[]) {
  const options = new Map<string, WarehouseOption>();
  domestic.forEach((warehouse) => options.set(warehouse.id, {
    ref: warehouse.id,
    name: warehouse.name,
    meta: [warehouse.code, warehouse.city || warehouse.province, "国内库存"].filter(Boolean).join(" · "),
    resourceType: "warehouse",
  }));
  connected.forEach((warehouse) => {
    const ref = String(warehouse.id || warehouse.resolvedWarehouseId || warehouse.warehouseId || warehouse.warehouseCode || "").trim();
    if (!ref || options.has(ref)) return;
    options.set(ref, {
      ref,
      name: warehouse.name,
      meta: [warehouse.providerName, warehouse.warehouseCode, warehouse.country, "WMS"].filter(Boolean).join(" · "),
      resourceType: "warehouse",
    });
  });
  grants.filter((grant) => grant.resourceType === "warehouse").forEach((grant) => {
    if (!options.has(grant.resourceRef)) options.set(grant.resourceRef, { ref: grant.resourceRef, name: grant.resourceName || grant.resourceRef, meta: "已有协同授权", resourceType: "warehouse" });
  });
  return [...options.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function InvitationRows({ invitations, busyId, onReissue, onRevoke }: {
  invitations: CollaborationInvitation[];
  busyId: string;
  onReissue: (invitation: CollaborationInvitation) => void;
  onRevoke: (invitation: CollaborationInvitation) => void;
}) {
  if (!invitations.length) return <div className="cia-empty"><Mail size={22} /><strong>暂无邀请记录</strong><span>后续成员由该组织的管理员在外部门户邀请。</span></div>;
  return <div className="cia-table-wrap"><table className="cia-table">
    <thead><tr><th>待激活账号</th><th>角色 / 登录方式</th><th>有效期</th><th>状态</th><th aria-label="操作" /></tr></thead>
    <tbody>{invitations.map((invitation) => <tr key={invitation.id}>
      <td><strong>{invitation.username}</strong><small>{invitation.email || "未留邮箱"}</small></td>
      <td><span>{roleLabels[invitation.role] || invitation.role}</span><small>账号密码登录</small></td>
      <td>{formatTime(invitation.expiresAt)}</td>
      <td><span className={`cia-state cia-state-${invitation.status}`}>{invitation.status === "pending" ? "待激活" : invitation.status === "accepted" ? "已激活" : "已失效"}</span></td>
      <td><div className="cia-row-actions">
        {invitation.status !== "accepted" ? <button type="button" disabled={busyId === invitation.id} onClick={() => onReissue(invitation)}>重发</button> : null}
        {invitation.status === "pending" ? <button className="danger" type="button" disabled={busyId === invitation.id} onClick={() => onRevoke(invitation)}>撤销</button> : null}
      </div></td>
    </tr>)}</tbody>
  </table></div>;
}

const approvalActionLabels: Record<string, string> = { inbound_confirm: "仓库自主入库", outbound_confirm: "仓库自主出库", inventory_adjustment: "库存盘点差异", transfer_receive: "调拨收货" };

export function ApprovalQueue({ notify, organizationCode = "", keyword = "", itemType = "", scopeLoading = false }: { notify(message: string, error?: boolean): void; organizationCode?: string; keyword?: string; itemType?: string; scopeLoading?: boolean }) {
  const [items, setItems] = useState<CollaborationApproval[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { const value = await fetchCollaborationApprovals(); setItems(value.approvals || []); }
    catch (error) { notify(error instanceof Error ? error.message : "审批队列读取失败", true); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  const visibleItems = React.useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    const commandType = itemType === "warehouse_inbound" ? "inbound_confirm"
      : itemType === "warehouse_outbound" ? "outbound_confirm"
        : itemType === "warehouse_transfer" ? "transfer_receive"
          : itemType === "warehouse_exception" ? "inventory_adjustment" : "";
    return items.filter((item) => {
      if (organizationCode && item.organizationCode !== organizationCode) return false;
      if (commandType && item.commandType !== commandType) return false;
      if (!normalized) return true;
      return [item.organizationCode, item.coreRefId, item.commandType, item.submittedByName, item.payload.reason, item.payload.note]
        .some((value) => String(value || "").toLowerCase().includes(normalized));
    });
  }, [items, organizationCode, keyword, itemType]);
  async function review(item: CollaborationApproval, approved: boolean) {
    const note = String(notes[item.commandId] || "").trim();
    if (!approved && !note) return notify("驳回时请填写原因。", true);
    setBusy(item.commandId);
    try {
      const result = await reviewCollaborationCommand(item.commandId, approved, note || "审批通过");
      notify(approved ? `已批准并写入主账${result.coreReference ? `：${result.coreReference}` : ""}` : "申请已驳回");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "审批失败", true); }
    finally { setBusy(""); }
  }
  return <section className="cia-section cia-approval-section">
    <div className="cia-section-head"><div><ClipboardCheck size={19} /><div><h4>仓库作业审批</h4><p>仓库自主发起的入库、出库和盘点差异不会直接改主账；批准时还会再次校验库存。</p></div></div><button type="button" className="cia-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "cia-spin" : ""} />刷新</button></div>
    {loading || scopeLoading ? <div className="cia-loading compact"><LoaderCircle size={18} className="cia-spin" />正在按当前任务范围读取待审批作业…</div> : visibleItems.length ? <div className="cia-approval-list">{visibleItems.map((item) => <article key={item.commandId}>
      <header><span><Warehouse size={17} /></span><div><strong>{approvalActionLabels[item.commandType] || item.commandType}</strong><small>{item.organizationCode} · {item.coreRefId}</small></div><em>高风险 · 待审批</em></header>
      <div className="cia-approval-lines">{(item.payload.lines || []).slice(0, 4).map((line) => <span key={`${item.commandId}:${line.sku}`}><code>{line.sku}</code><b>{line.direction === "decrease" ? "-" : line.direction === "increase" ? "+" : ""}{Number(line.quantity).toLocaleString()}</b></span>)}{(item.payload.lines?.length || 0) > 4 ? <span>另 {Number(item.payload.lines?.length) - 4} 项</span> : null}</div>
      <p>{item.payload.reason || item.payload.note || "未填写作业说明"}</p><small>{item.submittedByName || "仓库成员"} · {formatTime(item.submittedAt)}</small>
      <textarea rows={2} value={notes[item.commandId] || ""} onChange={(event) => setNotes((current) => ({ ...current, [item.commandId]: event.target.value }))} placeholder="审批意见；驳回时必填" />
      <footer><button type="button" className="cia-danger-button" disabled={busy === item.commandId} onClick={() => void review(item, false)}><XCircle size={15} />驳回</button><button type="button" className="cia-primary" disabled={busy === item.commandId} onClick={() => void review(item, true)}>{busy === item.commandId ? <LoaderCircle size={15} className="cia-spin" /> : <CheckCircle2 size={15} />}批准并入账</button></footer>
    </article>)}</div> : <div className="cia-empty compact"><CheckCircle2 size={22} /><strong>当前筛选没有待审批作业</strong><span>审批区与下方任务清单使用相同的组织、任务类型和关键词范围。</span></div>}
  </section>;
}

const partnerTaskTypes: Array<{ value: CollaborationPartnerTaskType; label: string; resourceRef: string; permission: string; icon: typeof Factory }> = [
  { value: "production_order", label: "委外加工单", resourceRef: "production", permission: "production.order.view", icon: Factory },
  { value: "purchase_order", label: "物料采购单", resourceRef: "procurement", permission: "procurement.order.view", icon: PackageCheck },
  { value: "sampling_task", label: "打样单", resourceRef: "sampling", permission: "sampling.task.view", icon: FlaskConical },
];

const partnerTaskStatusLabels: Record<string, string> = {
  pending: "待接单", accepted: "已接单", in_progress: "处理中", pending_approval: "待审批", pending_sync: "待同步",
  completed: "已完成", rejected: "已驳回", cancelled: "已取消",
};

type PartnerTaskLineDraft = { sku: string; productName: string; specification: string; plannedQuantity: string; unit: string };
type PartnerTaskDraft = {
  taskType: CollaborationPartnerTaskType; documentNo: string; title: string; dueDate: string; priority: "normal" | "urgent";
  fulfillmentMode: "labor_only" | "turnkey"; requirements: string; deliveryAddress: string; lines: PartnerTaskLineDraft[];
  sampleCategory: "inner_material" | "packaging"; sampleSubject: "formula" | "raw_material" | "packaging_box" | "packaging_bottle";
  sampleGoal: string; evaluationCriteria: string; quoteRequired: boolean;
  packagingMaterial: string; packagingProcess: string; packagingStructureType: string;
  packagingLengthMm: string; packagingWidthMm: string; packagingHeightMm: string; packagingDiameterMm: string; packagingCapacityMl: string;
  packagingColorPrinting: string; packagingDesignVersion: string; packagingFileRequirements: string;
};

function emptyPartnerTaskDraft(taskType: CollaborationPartnerTaskType = "production_order", sampleCategory: "inner_material" | "packaging" = "inner_material"): PartnerTaskDraft {
  return {
    taskType, documentNo: "", title: "", dueDate: "", priority: "normal", fulfillmentMode: "turnkey",
    requirements: "", deliveryAddress: "", lines: [{ sku: "", productName: "", specification: "", plannedQuantity: "", unit: "件" }],
    sampleCategory, sampleSubject: sampleCategory === "packaging" ? "packaging_box" : "formula", sampleGoal: "", evaluationCriteria: "", quoteRequired: true,
    packagingMaterial: "", packagingProcess: "", packagingStructureType: "", packagingLengthMm: "", packagingWidthMm: "", packagingHeightMm: "", packagingDiameterMm: "", packagingCapacityMl: "",
    packagingColorPrinting: "", packagingDesignVersion: "", packagingFileRequirements: "",
  };
}

const partnerReportLabels: Record<string, string> = {
  production_progress: "生产进度", material_readiness: "物料与包材", purchase_fulfillment: "采购履约", exception: "异常上报", shipment: "发货反馈",
};
const partnerMilestoneLabels: Record<string, string> = { pending: "待完成", in_progress: "进行中", completed: "已完成", blocked: "有异常" };

function partnerProductionSteps(value: unknown) {
  return [...new Set(String(value || "").split(/[,，、;；>→\n]+/).map((step) => step.trim()).filter(Boolean))].slice(0, 24);
}

function PartnerProductionFlow({ value, progress, exception }: {
  value: unknown; progress?: CollaborationPartnerOrderReport; exception?: CollaborationPartnerOrderReport;
}) {
  const steps = partnerProductionSteps(value);
  if (!steps.length) return null;
  const latestNote = exception && (!progress || Date.parse(exception.createdAt) > Date.parse(progress.createdAt))
    ? (exception.note || exception.title || "存在待处理异常")
    : progress?.note;
  return <section className="cia-process-flow"><div className="cia-task-detail-title"><Factory size={17} /><strong>生产工序提醒</strong><span>不分先后</span></div><ol>{steps.map((step, index) => <li className="reminder" key={`${step}-${index}`}><span>•</span><b>{step}</b><small>按实际生产安排</small></li>)}</ol><p>{latestNote || "以下工序仅作为工厂执行提醒，不代表固定先后顺序，也不会形成前置阻塞。"}</p></section>;
}

const adminFirstArticleImageLabels: Record<string, string> = { packaging: "包装六面", inner_pack: "内托内包", coding: "打码位置", finished: "成品效果", carton: "外箱装箱" };
const sampleCategoryLabels: Record<string, string> = { inner_material: "料体打样", packaging: "包材打样" };
const sampleSubjectLabels: Record<string, string> = { formula: "配方 / 料体", raw_material: "原料", packaging_box: "包装盒", packaging_bottle: "包装瓶" };

function LocalFilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url ? <img src={url} alt={file.name} /> : <FileText size={20} />;
}

type SamplingFilter = "all" | "pending_review" | "multi_round" | "pending_quote" | "overdue";

function SamplingDashboard({ items, filter, onFilter }: { items: CollaborationPartnerWorkItem[]; filter: SamplingFilter; onFilter(value: SamplingFilter): void }) {
  const now = Date.now();
  const pendingReview = items.filter((item) => Number(item.sampling?.pendingReviewCount || 0) > 0);
  const multiRound = items.filter((item) => Number(item.sampling?.roundCount || 0) > 1);
  const pendingQuote = items.filter((item) => Number(item.sampling?.approvedVersion || 0) > 0 && Number(item.sampling?.quoteCount || 0) === 0);
  const overdue = items.filter((item) => item.dueAt && Date.parse(item.dueAt) < now && !["completed", "cancelled", "rejected"].includes(item.status));
  const approved = items.filter((item) => Number(item.sampling?.approvedVersion || 0) > 0);
  const onePassRate = approved.length ? Math.round(approved.filter((item) => item.sampling?.approvedVersion === 1).length / approved.length * 100) : 0;
  const averageRounds = approved.length ? approved.reduce((sum, item) => sum + Number(item.sampling?.approvedVersion || 0), 0) / approved.length : 0;
  const innerCount = items.filter((item) => item.publicPayload.sampleCategory === "inner_material").length;
  const packagingCount = items.filter((item) => item.publicPayload.sampleCategory === "packaging").length;
  const cards: Array<{ key: SamplingFilter; label: string; value: number; hint: string; icon: typeof FlaskConical }> = [
    { key: "all", label: "进行中需求", value: items.filter((item) => !["completed", "cancelled", "rejected"].includes(item.status)).length, hint: `${items.length} 单累计`, icon: FlaskConical },
    { key: "pending_review", label: "待内部评审", value: pendingReview.length, hint: "尽快给出结论", icon: ClipboardCheck },
    { key: "multi_round", label: "多轮返样", value: multiRound.length, hint: "重点查清原因", icon: RotateCcw },
    { key: "pending_quote", label: "定版待报价", value: pendingQuote.length, hint: "可直接催价", icon: BadgeDollarSign },
    { key: "overdue", label: "已超期", value: overdue.length, hint: "需要升级处理", icon: AlertTriangle },
  ];
  return <section className="cia-sampling-dashboard">
    <header><div><span>SAMPLING CONTROL</span><strong>打样闭环仪表盘</strong></div><div><em>一次通过率 <b>{onePassRate}%</b></em><em>平均定版轮次 <b>{averageRounds ? averageRounds.toFixed(1) : "—"}</b></em></div></header>
    <div className="cia-sampling-metrics">{cards.map(({ key, label, value, hint, icon: Icon }) => <button type="button" className={filter === key ? "active" : ""} key={key} onClick={() => onFilter(key)}><Icon size={18} /><span><small>{label}</small><strong>{value}</strong><em>{hint}</em></span></button>)}</div>
    <div className="cia-sampling-mix"><div><span>内料打样</span><b style={{ width: `${innerCount && items.length ? Math.max(5, innerCount / items.length * 100) : 0}%` }} /><em>{innerCount}</em></div><div><span>包材打样</span><b style={{ width: `${packagingCount && items.length ? Math.max(5, packagingCount / items.length * 100) : 0}%` }} /><em>{packagingCount}</em></div><small><Target size={14} />点击指标即可筛选下方任务</small></div>
  </section>;
}

function SamplingReviewPanel({ detail, onReload, notify }: { detail: CollaborationPartnerWorkItemDetail; onReload(): Promise<void>; notify(message: string, error?: boolean): void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const artifacts = detail.oem?.artifacts || [];
  const quotes = detail.oem?.quotes || [];
  const approved = artifacts.find((artifact) => artifact.status === "approved");
  async function review(artifactId: string, approvedResult: boolean) {
    const note = notes[artifactId] || "";
    const artifact = artifacts.find((entry) => entry.id === artifactId);
    const variants = artifact?.publicPayload.sampleVariants || [];
    if (!approvedResult && !note.trim()) return notify("要求返样时请填写清晰的修改意见。", true);
    if (approvedResult && variants.length && !selectedVariants[artifactId]) return notify("请先选择本轮要定版的具体样品。", true);
    setBusy(artifactId);
    try {
      const result = await reviewCollaborationSampleArtifact(artifactId, approvedResult, note.trim(), selectedVariants[artifactId] || "");
      notify(approvedResult ? `第 ${result.version} 轮已锁定为最终样，伙伴端现在可以报价。` : `第 ${result.version} 轮已退回，等待下一轮送样。`);
      await onReload();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "样品评审失败", true); }
    finally { setBusy(""); }
  }
  async function award(quoteId: string) {
    if (!approvalReference.trim()) return notify("确认报价前请填写内部审批单号。", true);
    setBusy(quoteId);
    try {
      await awardCollaborationSupplierQuote(quoteId, approvalReference.trim());
      notify("最终样报价已确认，打样闭环完成并保留完整审计记录。");
      await onReload();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "报价确认失败", true); }
    finally { setBusy(""); }
  }
  return <>
    {artifacts.some((artifact) => artifact.publicPayload.sampleVariants?.some((variant) => variant.supplierMaterialCode)) ? <section className="cia-supplier-material-register"><header><FlaskConical size={17} /><div><strong>供应商料体编码台账</strong><span>供应商打出料体后登记；平台追踪号与供应商内部编码双向留档。</span></div></header><div>{artifacts.flatMap((artifact) => (artifact.publicPayload.sampleVariants || []).filter((variant) => variant.supplierMaterialCode).map((variant) => ({ artifact, variant }))).map(({ artifact, variant }) => <article key={`${artifact.id}-${variant.variantCode}`}><span>R{artifact.version}</span><div><b>{variant.supplierMaterialCode}</b><small>{variant.name} · 平台追踪号 {variant.variantCode}</small></div><em className={artifact.status}>{artifact.status === "approved" ? "已定版" : artifact.status === "rejected" ? "需返样" : "待评审"}</em></article>)}</div></section> : null}
    <section className="cia-sample-route">
      {[{ label: "需求发布", done: true }, { label: "多轮送样", done: artifacts.length > 0 }, { label: "内部定版", done: Boolean(approved) }, { label: "供应商报价", done: quotes.length > 0 }, { label: "报价确认", done: quotes.some((quote) => quote.status === "awarded") }].map((step, index) => <React.Fragment key={step.label}><div className={step.done ? "done" : ""}><span>{step.done ? <Check size={13} /> : index + 1}</span><b>{step.label}</b></div>{index < 4 ? <i /> : null}</React.Fragment>)}</section>
    <section className="cia-task-detail-section cia-sample-rounds"><div className="cia-task-detail-title"><FlaskConical size={17} /><strong>送样与评审轮次</strong><span>{artifacts.length} 轮 · 历史不可覆盖</span></div>{artifacts.length ? <div>{artifacts.map((artifact) => { const variants = artifact.publicPayload.sampleVariants || []; return <article className={artifact.status} key={artifact.id}><header><span>R{artifact.version}</span><div><strong>{artifact.title}</strong><small>{formatTime(artifact.createdAt)} · {variants.length || 1} 个样品</small></div><em>{artifact.status === "submitted" ? "待评审" : artifact.status === "approved" ? `最终样 ${artifact.publicPayload.approvedVariantCode || ""}` : "需返样"}</em></header><p>{artifact.publicPayload.summary || artifact.publicPayload.supplierConclusion || "伙伴未填写结果摘要"}</p>{variants.length ? <div className="cia-sample-variants">{variants.map((variant) => <label className={artifact.publicPayload.approvedVariantCode === variant.variantCode ? "approved" : ""} key={variant.variantCode}>{artifact.status === "submitted" ? <input type="radio" name={`variant-${artifact.id}`} checked={selectedVariants[artifact.id] === variant.variantCode} onChange={() => setSelectedVariants((current) => ({ ...current, [artifact.id]: variant.variantCode }))} /> : <CheckCircle2 size={15} />}<span><code>{variant.variantCode}</code><b>{variant.name}</b><small>{variant.specificationVersion || "未标注版本"} · {Number(variant.sampleQuantity || 0).toLocaleString()} {variant.unit || "件"}</small>{variant.description ? <em>{variant.description}</em> : null}</span></label>)}</div> : null}<div className="cia-sample-round-facts"><span>供应商判断 <b>{artifact.publicPayload.result || "pending"}</b></span>{artifact.publicPayload.attachmentIds?.length ? <span>本轮文件 <b>{artifact.publicPayload.attachmentIds.length} 个</b></span> : null}{artifact.publicPayload.nextPlan ? <span>下一步 <b>{artifact.publicPayload.nextPlan}</b></span> : null}</div>{artifact.publicPayload.reviewNote ? <aside><ClipboardCheck size={14} /><span>{artifact.publicPayload.reviewNote}</span></aside> : null}{artifact.status === "submitted" ? <footer><textarea rows={2} value={notes[artifact.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [artifact.id]: event.target.value }))} placeholder="通过可补充定版说明；要求返样时必须写明修改点" /><div><button type="button" className="cia-danger-button" disabled={busy === artifact.id} onClick={() => void review(artifact.id, false)}><RotateCcw size={14} />要求返样</button><button type="button" className="cia-primary" disabled={busy === artifact.id} onClick={() => void review(artifact.id, true)}>{busy === artifact.id ? <LoaderCircle size={14} className="cia-spin" /> : <CheckCircle2 size={14} />}确认所选最终样</button></div></footer> : null}</article>; })}</div> : <div className="cia-empty compact"><FlaskConical size={21} /><strong>等待首轮送样</strong><span>伙伴提交后即可在这里评审；要求修改会生成下一轮，不覆盖上一轮。</span></div>}</section>
    <section className="cia-task-detail-section cia-sample-quotes"><div className="cia-task-detail-title"><BadgeDollarSign size={17} /><strong>最终样报价</strong><span>{approved ? `绑定 ${approved.publicPayload.approvedVariantCode || `R${approved.version}`}` : "定版后开放"}</span></div>{!approved ? <div className="cia-sample-gate"><LockKeyhole size={18} /><span><strong>报价闸门尚未开启</strong>先确认最终样，防止供应商按错误版本报价。</span></div> : quotes.length ? <div className="cia-sample-quote-list">{quotes.map((quote) => <article key={quote.id}><span><b>{quote.currency} {quote.amount.toLocaleString()}</b><small>起订 {quote.minimumOrderQuantity.toLocaleString()} · 交期 {quote.leadTimeDays} 天 · 绑定 {quote.sampleVariantCode || `R${quote.sampleVersion || approved.version}`}</small></span><em className={quote.status}>{quote.status === "submitted" ? "待确认" : quote.status === "awarded" ? "已确认" : "未采用"}</em>{quote.status === "submitted" ? <button type="button" className="cia-primary" disabled={busy === quote.id} onClick={() => void award(quote.id)}>确认报价</button> : null}<p>{quote.terms || "未填写报价条款"}</p></article>)}</div> : <div className="cia-empty compact"><BadgeDollarSign size={21} /><strong>最终样已锁定，等待供应商报价</strong><span>伙伴只能基于 {approved.publicPayload.approvedVariantCode || `R${approved.version}`} 提交报价，版本会随报价永久留档。</span></div>}{approved && quotes.some((quote) => quote.status === "submitted") ? <label className="cia-sample-approval-ref"><span>内部审批单号</span><input value={approvalReference} onChange={(event) => setApprovalReference(event.target.value)} placeholder="例如：SP-20261013-001" /></label> : null}</section>
  </>;
}

function PartnerTaskDetailModal({ organizationCode, detail, loading, onClose, onReload, notify }: {
  organizationCode: string; detail: CollaborationPartnerWorkItemDetail | null; loading: boolean; onClose(): void; onReload(): Promise<void>; notify(message: string, error?: boolean): void;
}) {
  const [articleImage, setArticleImage] = useState<{ url: string; name: string; label: string } | null>(null);
  const [attachmentImage, setAttachmentImage] = useState<{ url: string; name: string } | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [showArticleBom, setShowArticleBom] = useState(false);
  async function download(workItemId: string, attachment: CollaborationPartnerWorkItemDetail["attachments"][number]) {
    try {
      const { blob } = await downloadCollaborationOrganizationWorkItemAttachment(organizationCode, workItemId, attachment.id);
      const url = URL.createObjectURL(blob);
      if (attachment.mimeType.startsWith("image/")) {
        if (attachmentImage?.url) URL.revokeObjectURL(attachmentImage.url);
        setAttachmentImage({ url, name: attachment.fileName });
        return;
      }
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = attachment.fileName; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) { notify(reason instanceof Error ? reason.message : "附件下载失败", true); }
  }
  function closeAttachmentImage() {
    if (attachmentImage?.url) URL.revokeObjectURL(attachmentImage.url);
    setAttachmentImage(null);
  }
  async function uploadAttachments(workItemId: string, files: File[]) {
    const accepted = files.filter((file) => file.size <= 50 * 1024 * 1024).slice(0, 20);
    if (!accepted.length) return notify("请选择不超过 50MB 的图片或文件。", true);
    setAttachmentUploading(true);
    let uploaded = 0;
    try {
      for (const file of accepted) {
        await uploadCollaborationOrganizationWorkItemAttachment(organizationCode, workItemId, file);
        uploaded += 1;
      }
      notify(`已补充上传 ${uploaded} 个附件。`);
      await onReload();
    } catch (reason) {
      notify(`已上传 ${uploaded}/${accepted.length} 个附件；${reason instanceof Error ? reason.message : "其余附件上传失败"}`, true);
      await onReload();
    } finally {
      setAttachmentUploading(false);
    }
  }
  const item = detail?.item; const order = detail?.partnerOrder;
  const latestProgress = order?.reports.find((report) => report.reportType === "production_progress");
  const latestException = order?.reports.find((report) => report.reportType === "exception");
  const firstArticle = item?.publicPayload.firstArticle;
  const isSampling = item?.itemType === "sampling_task";
  return <div className="cia-modal-layer cia-task-detail-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><article className="cia-modal cia-task-detail-modal">
    <header><div><span className="cia-eyebrow">PARTNER ORDER TRACE</span><h3>{item?.title || "协同单据详情"}</h3><p>{item ? `${item.coreRefId} · ${partnerTaskStatusLabels[item.status] || item.status} · V${item.version}` : "读取伙伴反馈与中台处理结果"}</p></div><button type="button" onClick={onClose}><X size={18} /></button></header>
    {loading || !detail || !item ? <div className="cia-loading"><LoaderCircle size={22} className="cia-spin" />正在读取工厂反馈明细…</div> : <div className="cia-task-detail-body">
      <section className="cia-task-detail-facts">
        <div><span>{isSampling ? "打样对象" : "订单产品"}</span><strong>{String(item.publicPayload.productName || "—")}</strong><small>{isSampling ? `${sampleCategoryLabels[String(item.publicPayload.sampleCategory)] || "打样"} · ${sampleSubjectLabels[String(item.publicPayload.sampleSubject)] || "未分类"}` : String(item.publicPayload.productSpec || "未填写规格")}</small></div>
        <div><span>计划数量</span><strong>{Number(item.publicPayload.quantity || 0).toLocaleString()} {String(item.publicPayload.unit || "件")}</strong><small>{item.publicPayload.piecesPerCarton ? `${Number(item.publicPayload.piecesPerCarton)} ${String(item.publicPayload.unit || "件")}/箱` : "未填写箱规"}</small></div>
        <div><span>要求交期</span><strong>{item.publicPayload.deliveryDate || (item.dueAt ? formatTime(item.dueAt) : "—")}</strong><small>{isSampling ? (item.dueAt && Date.parse(item.dueAt) < Date.now() && item.status !== "completed" ? "已超期" : "按轮次跟进") : item.publicPayload.factoryExpectedDeliveryDate ? `工厂回复 ${item.publicPayload.factoryExpectedDeliveryDate}` : "等待工厂回复"}</small></div>
        <div><span>{isSampling ? "闭环阶段" : "最新进度"}</span><strong>{isSampling ? (detail.oem?.quotes.some((quote) => quote.status === "awarded") ? "已确认报价" : detail.oem?.artifacts.some((artifact) => artifact.status === "approved") ? "定版待报价" : detail.oem?.artifacts.some((artifact) => artifact.status === "submitted") ? "待内部评审" : "等待送样") : latestProgress?.progressPercent == null ? "尚未反馈" : `${latestProgress.progressPercent}%`}</strong><small>{isSampling ? `${detail.oem?.artifacts.length || 0} 轮送样` : latestProgress?.note || "接单后由工厂更新"}</small></div>
      </section>
      {isSampling ? <SamplingReviewPanel detail={detail} onReload={onReload} notify={notify} /> : <><PartnerProductionFlow value={item.publicPayload.productionProcess || firstArticle?.productionProcess} progress={latestProgress} exception={latestException} />
      {item.publicPayload.cartonType || item.publicPayload.barcode ? <section className="cia-task-source-brief"><div><span>外箱与箱规</span><p>{[item.publicPayload.cartonType, item.publicPayload.piecesPerCarton ? `${item.publicPayload.piecesPerCarton} ${item.publicPayload.unit || "件"}/箱` : ""].filter(Boolean).join(" · ") || "未填写"}</p></div><div><span>商品条码</span><p>{String(item.publicPayload.barcode || "未填写")}</p></div></section> : null}
      {firstArticle ? <section className="cia-first-article"><div className="cia-task-detail-title"><CheckCircle2 size={17} /><strong>首件档案 · {firstArticle.version || "当前版"}</strong><span>{firstArticle.documentNo || "精确关联"}</span></div><div className="cia-first-article-facts"><div><span>产品 / SKU</span><b>{firstArticle.productName || "—"}</b><small>{firstArticle.productSku || "未填写 SKU"}</small></div><div><span>规格 / 条码</span><b>{firstArticle.specification || "—"}</b><small>{firstArticle.barcode || "未填写条码"}</small></div><div><span>备案 / BPOM</span><b>{firstArticle.filingName || "—"}</b><small>{firstArticle.bpom || "未填写 BPOM"}</small></div><div><span>装箱规格</span><b>{firstArticle.cartonSpecification || "—"}</b><small>{firstArticle.updatedAt ? `更新 ${formatTime(firstArticle.updatedAt)}` : "未记录更新时间"}</small></div></div>{firstArticle.images.length ? <div className="cia-first-article-gallery">{firstArticle.images.map((image, index) => <button type="button" key={`${image.url}-${index}`} onClick={() => setArticleImage(image)}><img src={image.url} alt={`${image.label}：${image.name}`} loading="lazy" /><span>{adminFirstArticleImageLabels[image.category] || image.label}</span></button>)}</div> : <div className="cia-first-article-empty">首件记录中暂无图片</div>}{firstArticle.bom.length ? <><button type="button" className="cia-first-article-bom-toggle" onClick={() => setShowArticleBom((current) => !current)}><Boxes size={15} />首件 BOM {firstArticle.bom.length} 项<ChevronRight size={15} className={showArticleBom ? "open" : ""} /></button>{showArticleBom ? <div className="cia-first-article-bom">{firstArticle.bom.map((line, index) => <div key={`${line.materialCode}-${index}`}><span>{line.category || "—"}</span><b>{line.name || "—"}</b><code>{line.materialCode || "—"}</code><small>{[line.composition, line.netContent, line.unit].filter(Boolean).join(" · ") || "—"}</small></div>)}</div> : null}</> : null}</section> : <section className="cia-first-article cia-first-article-empty-state"><div className="cia-task-detail-title"><CheckCircle2 size={17} /><strong>首件档案</strong><span>未关联</span></div><p>当前产品未找到条码、SKU 或产品名完全一致的首件记录。</p></section>}
      <section className="cia-task-detail-section"><div className="cia-task-detail-title"><Boxes size={17} /><strong>成品、物料与包材</strong><span>{order?.lines.length || 0} 项</span></div><div className="cia-task-detail-lines">{order?.lines.map((line) => <article key={line.id}><em>{line.lineType === "finished_product" ? "成品" : line.lineType === "packaging" ? "包材" : "原料"}</em><div><strong>{line.productName}</strong><small>{line.sku}{line.specification ? ` · ${line.specification}` : ""}</small></div><b>{line.plannedQuantity.toLocaleString()} {line.unit}</b></article>)}</div></section>
      {order?.milestones.length ? <section className="cia-task-detail-section"><div className="cia-task-detail-title"><ClipboardCheck size={17} /><strong>关键节点</strong></div><div className="cia-task-milestones">{order.milestones.map((milestone) => <article className={milestone.status} key={milestone.id}><span>{milestone.title}</span><b>{partnerMilestoneLabels[milestone.status] || milestone.status}</b><small>{milestone.plannedAt ? `计划 ${formatTime(milestone.plannedAt)}` : "未设计划日期"}</small></article>)}</div></section> : null}
      <section className="cia-task-detail-section"><div className="cia-task-detail-title"><Factory size={17} /><strong>工厂反馈</strong><span>{order?.reports.length || 0} 条</span></div>{order?.reports.length ? <div className="cia-task-report-list">{order.reports.map((report) => <article className={report.result === "failed" || report.severity === "critical" ? "danger" : ""} key={report.id}><span /><div><strong>{report.title || partnerReportLabels[report.reportType] || report.reportType}</strong><p>{report.note || `${report.stage} · ${report.result}`}</p><small>{report.submittedByName || "工厂成员"} · {formatTime(report.createdAt)}{report.quantity != null ? ` · 数量 ${report.quantity.toLocaleString()}` : ""}</small></div>{report.progressPercent != null ? <b>{report.progressPercent}%</b> : <em>{partnerReportLabels[report.reportType] || "反馈"}</em>}</article>)}</div> : <div className="cia-empty compact"><Factory size={20} /><strong>工厂尚未汇报进度</strong><span>接单已联通；提交生产、物料测试、异常或发货反馈后会显示在这里。</span></div>}</section></>}
      {isSampling || detail.attachments.length ? <section className="cia-task-detail-section"><div className="cia-task-detail-title"><FileText size={17} /><strong>需求与送样附件</strong><span>{detail.attachments.length} 个</span>{isSampling ? <label className="cia-task-detail-upload"><Upload size={14} />{attachmentUploading ? "上传中…" : "补充附件"}<input type="file" multiple disabled={attachmentUploading} accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.docx,.csv" onChange={(event) => { const files = Array.from(event.target.files || []); event.currentTarget.value = ""; void uploadAttachments(item.id, files); }} /></label> : null}</div>{detail.attachments.length ? <div className="cia-task-attachments">{detail.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => void download(item.id, attachment)}>{attachment.mimeType.startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />}<span><b>{attachment.fileName}</b><small>{attachment.mimeType.startsWith("image/") ? "点击预览图片" : "点击下载文件"} · {attachment.scanStatus === "clean" ? "已安全校验" : attachment.scanStatus}</small></span>{attachment.mimeType.startsWith("image/") ? <Search size={15} /> : <Download size={15} />}</button>)}</div> : <div className="cia-empty compact"><Paperclip size={20} /><strong>暂无附件</strong><span>可补充上传需求图片或文件，图片支持直接预览。</span></div>}</section> : null}
      <section className="cia-task-detail-section"><div className="cia-task-detail-title"><RefreshCw size={17} /><strong>中台处理与审计</strong><span>{detail.commands.length + detail.events.length} 条</span></div><div className="cia-task-audit-list">{detail.commands.slice(0, 10).map((command) => <article key={command.id}><strong>{partnerReportLabels[command.commandType.replace(/^order_/, "")] || (command.commandType === "accept" ? "接受任务" : command.commandType)}</strong><span>{command.status === "applied" ? "中台已接收" : command.status}</span><small>{command.resultMessage || "等待处理结果"} · {formatTime(command.submittedAt)}</small></article>)}</div></section>
    </div>}
    {articleImage ? <div className="cia-article-lightbox" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setArticleImage(null); }}><button type="button" onClick={() => setArticleImage(null)} aria-label="关闭图片"><X size={20} /></button><img src={articleImage.url} alt={articleImage.name} /><p>{articleImage.label} · {articleImage.name}</p></div> : null}
    {attachmentImage ? <div className="cia-article-lightbox" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAttachmentImage(); }}><button type="button" onClick={closeAttachmentImage} aria-label="关闭图片"><X size={20} /></button><img src={attachmentImage.url} alt={attachmentImage.name} /><p>需求 / 送样附件 · {attachmentImage.name}</p></div> : null}
  </article></div>;
}

export function PartnerTaskPanel({ organization, access, notify, fixedTaskType, fixedSampleCategory }: {
  organization: CollaborationOrganization;
  access: CollaborationAccessGrantPayload | null;
  notify(message: string, error?: boolean): void;
  fixedTaskType?: CollaborationPartnerTaskType;
  fixedSampleCategory?: "inner_material" | "packaging";
}) {
  const [items, setItems] = useState<CollaborationPartnerWorkItem[]>([]);
  const [draft, setDraft] = useState<PartnerTaskDraft>(() => emptyPartnerTaskDraft(fixedTaskType, fixedSampleCategory));
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [outsourcingSource, setOutsourcingSource] = useState<CollaborationOutsourcingSource | null>(null);
  const [selectedFactoryId, setSelectedFactoryId] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<CollaborationPartnerWorkItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [samplingFilter, setSamplingFilter] = useState<SamplingFilter>("all");
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const selectedType = partnerTaskTypes.find((item) => item.value === (fixedTaskType || draft.taskType)) || partnerTaskTypes[0];
  const baseVisibleItems = fixedTaskType ? items.filter((item) => item.itemType === fixedTaskType && (!fixedSampleCategory || item.publicPayload.sampleCategory === fixedSampleCategory)) : items;
  const visibleItems = fixedTaskType === "sampling_task" && samplingFilter !== "all" ? baseVisibleItems.filter((item) => {
    if (samplingFilter === "pending_review") return Number(item.sampling?.pendingReviewCount || 0) > 0;
    if (samplingFilter === "multi_round") return Number(item.sampling?.roundCount || 0) > 1;
    if (samplingFilter === "pending_quote") return Number(item.sampling?.approvedVersion || 0) > 0 && Number(item.sampling?.quoteCount || 0) === 0;
    return Boolean(item.dueAt && Date.parse(item.dueAt) < Date.now() && !["completed", "cancelled", "rejected"].includes(item.status));
  }) : baseVisibleItems;
  const enabled = Boolean(access?.grants.some((grant) => grant.resourceType === "organization" && grant.resourceRef === selectedType.resourceRef && grant.permissions.includes(selectedType.permission)));
  const productionEnabled = Boolean(access?.grants.some((grant) => grant.resourceType === "organization" && grant.resourceRef === "production" && grant.permissions.includes("production.order.view")));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchCollaborationOrganizationWorkItems(organization.code, fixedTaskType);
      setItems((result.items || []).filter((item) => partnerTaskTypes.some((type) => type.value === item.itemType)));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "协同单据读取失败", true);
    } finally { setLoading(false); }
  }, [organization.code, fixedTaskType, notify]);

  const loadOutsourcingSource = useCallback(async (refresh = false) => {
    if (!productionEnabled) { setOutsourcingSource(null); return; }
    setSourceLoading(true);
    try {
      const result = await fetchCollaborationOutsourcingSource(organization.code, refresh);
      setOutsourcingSource(result);
      setSelectedFactoryId(result.binding?.factoryId || result.options[0]?.factoryId || "");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "千顷 ERP 委外加工单来源读取失败", true);
    } finally { setSourceLoading(false); }
  }, [organization.code, productionEnabled, notify]);

  useEffect(() => { setDraft(emptyPartnerTaskDraft(fixedTaskType, fixedSampleCategory)); setTaskFiles([]); setSamplingFilter("all"); void load(); void loadOutsourcingSource(); }, [organization.code, fixedTaskType, fixedSampleCategory, load, loadOutsourcingSource]);

  function patchLine(index: number, patch: Partial<PartnerTaskLineDraft>) {
    setDraft((current) => ({ ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) }));
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!enabled) return notify(`请先保存“${selectedType.label}”业务权限。`, true);
    const simpleMaterialSampling = draft.taskType === "sampling_task" && draft.sampleCategory === "inner_material";
    const lines = simpleMaterialSampling ? [] : draft.lines.map((line) => ({
      sku: line.sku.trim().toUpperCase(), productName: line.productName.trim(), specification: line.specification.trim(),
      plannedQuantity: Number(line.plannedQuantity), unit: line.unit.trim() || "件",
      lineType: draft.taskType === "purchase_order" || (draft.taskType === "sampling_task" && draft.sampleCategory === "inner_material") ? "raw_material" as const : draft.taskType === "sampling_task" ? "packaging" as const : "finished_product" as const,
    }));
    const samplingProductName = draft.lines[0]?.productName.trim() || "";
    if (simpleMaterialSampling && !samplingProductName) return notify("请填写要打样的产品或项目名称。", true);
    if (!simpleMaterialSampling && lines.some((line) => !line.sku || !line.productName || !(line.plannedQuantity > 0))) return notify("请完整填写每一行的 SKU、品名和数量。", true);
    const totalQuantity = simpleMaterialSampling ? 1 : lines.reduce((sum, line) => sum + line.plannedQuantity, 0);
    const payload: CollaborationPartnerTaskInput = {
      taskType: draft.taskType,
      documentNo: draft.documentNo.trim(),
      title: draft.taskType === "sampling_task" ? "" : draft.title.trim(),
      productName: simpleMaterialSampling ? samplingProductName : lines[0].productName,
      productSpec: simpleMaterialSampling ? "" : lines[0].specification,
      requirements: draft.requirements.trim(),
      description: draft.requirements.trim(),
      priority: draft.priority,
      dueAt: draft.dueDate ? new Date(`${draft.dueDate}T12:00:00+08:00`).toISOString() : undefined,
      quantity: totalQuantity,
      unit: simpleMaterialSampling ? "轮" : lines.length === 1 ? lines[0].unit : "项",
      fulfillmentMode: draft.fulfillmentMode,
      deliveryAddress: draft.deliveryAddress.trim(),
      sampleCategory: draft.taskType === "sampling_task" ? draft.sampleCategory : undefined,
      sampleSubject: draft.taskType === "sampling_task" ? draft.sampleSubject : undefined,
      sampleGoal: draft.taskType === "sampling_task" ? draft.sampleGoal.trim() : undefined,
      evaluationCriteria: draft.taskType === "sampling_task" ? draft.evaluationCriteria.trim() : undefined,
      quoteRequired: draft.taskType === "sampling_task" ? draft.quoteRequired : undefined,
      packagingSpec: draft.taskType === "sampling_task" && draft.sampleCategory === "packaging" ? {
        material: draft.packagingMaterial.trim(), process: draft.packagingProcess.trim(), structureType: draft.packagingStructureType.trim(),
        lengthMm: Number(draft.packagingLengthMm || 0), widthMm: Number(draft.packagingWidthMm || 0), heightMm: Number(draft.packagingHeightMm || 0),
        diameterMm: Number(draft.packagingDiameterMm || 0), capacityMl: Number(draft.packagingCapacityMl || 0), colorPrinting: draft.packagingColorPrinting.trim(),
        designVersion: draft.packagingDesignVersion.trim(), fileRequirements: draft.packagingFileRequirements.trim(),
      } : undefined,
      lines,
    };
    setPublishing(true);
    try {
      const result = await publishCollaborationPartnerTask(organization.code, payload);
      let uploadWarning = "";
      if (taskFiles.length) {
        if (!result.workItemId) {
          uploadWarning = "打样单已经发布，但协同端仍在同步，附件暂未写入。请勿重复创建，可稍后从单据详情补传。";
        } else {
          let uploaded = 0;
          try {
            for (const file of taskFiles) {
              await uploadCollaborationOrganizationWorkItemAttachment(organization.code, result.workItemId, file);
              uploaded += 1;
            }
          } catch {
            uploadWarning = `打样单已经发布，附件已上传 ${uploaded}/${taskFiles.length} 个。请勿重复创建，可稍后从单据详情补传。`;
          }
        }
      }
      notify(uploadWarning || (result.delivery.failed ? "单据已进入重试队列，伙伴端稍后可见。" : `${selectedType.label}已发布给 ${organization.name}${taskFiles.length ? `，并附带 ${taskFiles.length} 个文件` : ""}。`), Boolean(uploadWarning));
      setDraft(emptyPartnerTaskDraft(fixedTaskType, fixedSampleCategory));
      setTaskFiles([]);
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "协同单据发布失败", true);
    } finally { setPublishing(false); }
  }

  async function saveOutsourcingBinding() {
    if (!selectedFactoryId) return notify("请选择千顷 ERP 中的委外灌装工厂。", true);
    setSourceBusy(true);
    try {
      const result = await saveCollaborationOutsourcingSource(organization.code, selectedFactoryId);
      notify(result.delivery.failed ? "绑定已保存，委外加工单正在后台重试同步。" : `已绑定并同步 ${result.synchronization.queued} 张委外加工单。`);
      await Promise.all([loadOutsourcingSource(), load()]);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "委外加工工厂绑定失败", true);
    } finally { setSourceBusy(false); }
  }

  async function syncOutsourcingOrders() {
    if (!outsourcingSource?.binding) return notify("请先绑定千顷 ERP 委外灌装工厂。", true);
    setSourceBusy(true);
    try {
      const result = await syncCollaborationOutsourcingSource(organization.code);
      notify(result.delivery.failed ? "同步任务已进入重试队列。" : `同步完成：更新 ${result.synchronization.queued} 张，未变化 ${result.synchronization.unchanged} 张。`);
      await Promise.all([loadOutsourcingSource(), load()]);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "委外加工单同步失败", true);
    } finally { setSourceBusy(false); }
  }

  async function openDetail(item: CollaborationPartnerWorkItem) {
    setSelectedItemId(item.id); setSelectedDetail(null); setDetailLoading(true);
    try { setSelectedDetail(await fetchCollaborationOrganizationWorkItem(organization.code, item.id)); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "协同单据详情读取失败", true); setSelectedItemId(""); }
    finally { setDetailLoading(false); }
  }

  async function reloadSelectedDetail() {
    if (!selectedItemId) return;
    setSelectedDetail(await fetchCollaborationOrganizationWorkItem(organization.code, selectedItemId));
    await load();
  }

  return <section className="cia-section cia-partner-tasks">
    <div className="cia-section-head"><div><ClipboardCheck size={18} /><div><h4>{fixedSampleCategory ? sampleCategoryLabels[fixedSampleCategory] : fixedTaskType ? selectedType.label : "协同单据"}</h4><p>只有明确发布到“{organization.name}”的{fixedSampleCategory ? sampleCategoryLabels[fixedSampleCategory] : fixedTaskType ? selectedType.label : "单据"}才会进入该组织；打样编号由系统自动生成。</p></div></div><button type="button" className="cia-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "cia-spin" : ""} />刷新进度</button></div>
    {!fixedTaskType ? <div className="cia-task-type-tabs">{partnerTaskTypes.map(({ value, label, icon: Icon }) => <button type="button" key={value} className={draft.taskType === value ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, taskType: value }))}><Icon size={16} />{label}<em>{items.filter((item) => item.itemType === value).length}</em></button>)}</div> : null}
    {!enabled ? <div className="cia-task-permission-warning"><LockKeyhole size={17} /><span>当前组织尚未开通“{selectedType.label}”。请先在上方勾选对应业务空间、使用推荐权限并保存。</span></div> : null}
    {fixedTaskType === "sampling_task" ? <SamplingDashboard items={baseVisibleItems} filter={samplingFilter} onFilter={setSamplingFilter} /> : null}
    {draft.taskType === "production_order" ? <div className="cia-outsourcing-source" id="outsourcing-factory-mapping">
      <div className="cia-outsourcing-source-head"><div><Factory size={18} /><div><strong>千顷 ERP · 委外加工单</strong><span>绑定工厂编号后自动同步，不在中台重复录单；伙伴进度会回写源单</span></div></div><em>源单只读 · 反馈回写</em></div>
      {sourceLoading ? <div className="cia-loading compact"><LoaderCircle size={18} className="cia-spin" />正在读取简道云工厂与订单…</div> : <>
        <div className="cia-outsourcing-source-grid">
          <label><span>该伙伴可见的委外加工工厂</span><select value={selectedFactoryId} onChange={(event) => setSelectedFactoryId(event.target.value)} disabled={!enabled || sourceBusy}>{outsourcingSource?.options.map((item) => <option key={item.factoryId} value={item.factoryId}>{item.factoryName || item.factoryFullName} · 编号 {item.factoryId} · {item.activeOrderCount} 单进行中</option>)}</select><small>绑定后，该伙伴只会同步并看到这个工厂的委外加工单。</small></label>
          <div><span>当前绑定</span><strong>{outsourcingSource?.binding ? `${outsourcingSource.binding.factoryName || outsourcingSource.binding.factoryFullName}（${outsourcingSource.binding.factoryId}）` : "尚未绑定"}</strong><small>{outsourcingSource?.binding?.factoryFullName || "按稳定工厂编号隔离，名称变化不会串单"}</small></div>
          <div><span>同步范围</span><strong>{outsourcingSource?.activeOrderCount || 0} 单进行中</strong><small>已纳管 {outsourcingSource?.trackedOrderCount || 0} 单 · 完结后保留进度记录</small></div>
          <div><span>最近同步</span><strong>{formatTime(outsourcingSource?.lastSyncedAt)}</strong><small>后台每 5 分钟检查一次更新</small></div>
        </div>
        <div className="cia-outsourcing-source-actions"><span><ShieldCheck size={15} />仅投影本工厂订单、负责物料和执行字段；不发送成本、客户、合同及其他供应商</span><div><button type="button" className="cia-secondary" onClick={() => void loadOutsourcingSource(true)} disabled={!enabled || sourceBusy}><RefreshCw size={15} />刷新工厂</button><button type="button" className="cia-secondary" onClick={() => void syncOutsourcingOrders()} disabled={!enabled || sourceBusy || !outsourcingSource?.binding}><RefreshCw size={15} className={sourceBusy ? "cia-spin" : ""} />立即同步</button><button type="button" className="cia-primary" onClick={() => void saveOutsourcingBinding()} disabled={!enabled || sourceBusy || !selectedFactoryId}>{sourceBusy ? <LoaderCircle size={15} className="cia-spin" /> : <Save size={15} />}保存绑定并同步</button></div></div>
      </>}
    </div> : <form className="cia-partner-task-form" onSubmit={publish}>
      <div className="cia-task-form-grid">
        {draft.taskType === "sampling_task" ? <div className="cia-auto-number"><span>打样单号</span><strong>发布后自动生成</strong><small>{draft.sampleCategory === "packaging" ? "DY-BC-日期-序号" : "DY-LT-日期-序号"}</small></div> : <label><span>单据编号</span><input required maxLength={120} value={draft.documentNo} onChange={(event) => setDraft({ ...draft, documentNo: event.target.value })} placeholder={draft.taskType === "purchase_order" ? "例如：CG-20261013-001" : "例如：WW-20261013-001"} /></label>}
        {draft.taskType === "sampling_task" ? <div className="cia-auto-number"><span>对外标题</span><strong>按打样对象自动生成</strong><small>无需手工填写，伙伴端会直接看到清晰标题</small></div> : <label><span>对外标题</span><input required maxLength={240} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={`${selectedType.label}标题`} /></label>}
        <label><span>要求完成日期</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
        <label><span>优先级</span><select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as PartnerTaskDraft["priority"] })}><option value="normal">常规</option><option value="urgent">紧急</option></select></label>
        {draft.taskType === "sampling_task" ? <>{draft.sampleCategory === "inner_material" ? <label className="wide cia-material-subject"><span>打样对象 / 产品名称 <em>必填</em></span><input required maxLength={240} value={draft.lines[0]?.productName || ""} onChange={(event) => patchLine(0, { productName: event.target.value })} placeholder="例如：DEVNEN 胶原蛋白面霜（无需填写 SKU）" /><small>只写大家都能识别的产品或项目名称即可。</small></label> : null}<label><span>具体对象</span><select value={draft.sampleSubject} onChange={(event) => setDraft({ ...draft, sampleSubject: event.target.value as PartnerTaskDraft["sampleSubject"] })}>{draft.sampleCategory === "inner_material" ? <><option value="formula">配方 / 料体</option><option value="raw_material">原料</option></> : <><option value="packaging_box">包装盒</option><option value="packaging_bottle">包装瓶 / 容器</option></>}</select></label><label className="wide"><span>希望这次解决什么</span><input maxLength={2000} value={draft.sampleGoal} onChange={(event) => setDraft({ ...draft, sampleGoal: event.target.value })} placeholder={draft.sampleCategory === "inner_material" ? "例如：清爽不黏、淡香；可一次提供多个料体供确认" : "例如：确认结构、材质、颜色与量产可行性"} /></label></> : null}
        {draft.taskType !== "sampling_task" ? <label className="wide"><span>交付地址（可选）</span><input maxLength={500} value={draft.deliveryAddress} onChange={(event) => setDraft({ ...draft, deliveryAddress: event.target.value })} placeholder="仅填写伙伴执行所需的交付地址" /></label> : null}
      </div>
      {draft.taskType === "sampling_task" && draft.sampleCategory === "packaging" ? <section className="cia-packaging-spec"><header><div><Boxes size={17} /><span><b>包材规格</b><small>材质、工艺、结构和尺寸直接进入伙伴端，不再混在备注里</small></span></div><em>文件由伙伴在每轮送样时上传并绑定</em></header><div><label><span>材质</span><input value={draft.packagingMaterial} onChange={(event) => setDraft({ ...draft, packagingMaterial: event.target.value })} placeholder="如 350g 白卡 / PETG" /></label><label><span>盒型 / 瓶型</span><input value={draft.packagingStructureType} onChange={(event) => setDraft({ ...draft, packagingStructureType: event.target.value })} placeholder="如天地盖、插口盒、圆肩瓶" /></label><label className="wide"><span>表面工艺</span><input value={draft.packagingProcess} onChange={(event) => setDraft({ ...draft, packagingProcess: event.target.value })} placeholder="覆膜、烫金、击凸、UV、丝印等" /></label><label><span>长 mm</span><input type="number" min="0" value={draft.packagingLengthMm} onChange={(event) => setDraft({ ...draft, packagingLengthMm: event.target.value })} /></label><label><span>宽 mm</span><input type="number" min="0" value={draft.packagingWidthMm} onChange={(event) => setDraft({ ...draft, packagingWidthMm: event.target.value })} /></label><label><span>高 mm</span><input type="number" min="0" value={draft.packagingHeightMm} onChange={(event) => setDraft({ ...draft, packagingHeightMm: event.target.value })} /></label><label><span>口径 mm</span><input type="number" min="0" value={draft.packagingDiameterMm} onChange={(event) => setDraft({ ...draft, packagingDiameterMm: event.target.value })} /></label><label><span>容量 ml</span><input type="number" min="0" value={draft.packagingCapacityMl} onChange={(event) => setDraft({ ...draft, packagingCapacityMl: event.target.value })} /></label><label className="wide"><span>颜色 / 印刷</span><input value={draft.packagingColorPrinting} onChange={(event) => setDraft({ ...draft, packagingColorPrinting: event.target.value })} placeholder="色号、印刷方式、专色及打样偏差要求" /></label><label><span>设计稿版本</span><input value={draft.packagingDesignVersion} onChange={(event) => setDraft({ ...draft, packagingDesignVersion: event.target.value })} placeholder="如 Artwork V3" /></label><label className="wide"><span>需回传文件</span><input value={draft.packagingFileRequirements} onChange={(event) => setDraft({ ...draft, packagingFileRequirements: event.target.value })} placeholder="如刀模图、3D 效果图、材质证明、测试报告" /></label></div></section> : null}
      {draft.taskType === "sampling_task" ? <div className="cia-sampling-requirements"><label><span>评审标准（伙伴可见）</span><textarea rows={3} maxLength={5000} value={draft.evaluationCriteria} onChange={(event) => setDraft({ ...draft, evaluationCriteria: event.target.value })} placeholder={draft.sampleCategory === "inner_material" ? "气味、颜色、黏度、肤感、稳定性等" : "材质、结构、颜色、尺寸公差、跌落与相容性等"} /></label><label className="cia-quote-switch"><input type="checkbox" checked={draft.quoteRequired} onChange={(event) => setDraft({ ...draft, quoteRequired: event.target.checked })} /><span><b>最终定版后要求报价</b><small>报价会永久绑定选中的具体样品编码。</small></span></label></div> : null}
      {!(draft.taskType === "sampling_task" && draft.sampleCategory === "inner_material") ? <><div className="cia-task-lines-head"><strong>产品 / 物料明细</strong><button type="button" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, { sku: "", productName: "", specification: "", plannedQuantity: "", unit: "件" }] }))}><Plus size={14} />增加一行</button></div>
      <div className="cia-task-lines">{draft.lines.map((line, index) => <div key={index}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <input required value={line.sku} onChange={(event) => patchLine(index, { sku: event.target.value })} placeholder="SKU" />
        <input required value={line.productName} onChange={(event) => patchLine(index, { productName: event.target.value })} placeholder="产品/物料名称" />
        <input value={line.specification} onChange={(event) => patchLine(index, { specification: event.target.value })} placeholder="规格（可选）" />
        <input required type="number" min="0.0001" step="0.0001" value={line.plannedQuantity} onChange={(event) => patchLine(index, { plannedQuantity: event.target.value })} placeholder="数量" />
        <input required value={line.unit} onChange={(event) => patchLine(index, { unit: event.target.value })} placeholder="单位" />
        <button type="button" aria-label="删除明细" disabled={draft.lines.length === 1} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }))}><Trash2 size={15} /></button>
      </div>)}</div></> : <div className="cia-material-sampling-note"><FlaskConical size={18} /><span><strong>料体编号由供应商送样时填写</strong><small>现在不用填 SKU、料体编码、数量或标题；供应商每轮可登记多个不同料体及其内部编码。</small></span></div>}
      <label className="cia-task-requirements"><span>对外要求与注意事项</span><textarea rows={3} maxLength={5000} value={draft.requirements} onChange={(event) => setDraft({ ...draft, requirements: event.target.value })} placeholder={draft.taskType === "sampling_task" ? "样品规格、轮次、需提交的测试结果和附件" : "生产/交付要求、包材测试标准及异常上报要求"} /></label>
      {draft.taskType === "sampling_task" ? <section className="cia-task-file-picker"><header><div><Paperclip size={17} /><span><b>需求附件</b><small>可上传参考图、配方说明、客户反馈或测试文件；图片可直接预览。</small></span></div><label><Upload size={15} />选择图片或文件<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.docx,.csv" onChange={(event) => { const selected = Array.from(event.target.files || []); const tooLarge = selected.find((file) => file.size > 50 * 1024 * 1024); if (tooLarge) notify(`${tooLarge.name} 超过 50MB，未加入附件。`, true); setTaskFiles((current) => [...current, ...selected.filter((file) => file.size <= 50 * 1024 * 1024)].slice(0, 20)); event.currentTarget.value = ""; }} /></label></header>{taskFiles.length ? <div>{taskFiles.map((file, index) => <article key={`${file.name}-${file.lastModified}-${index}`}><span><LocalFilePreview file={file} /></span><div><b>{file.name}</b><small>{file.type.startsWith("image/") ? "图片 · 发布后伙伴可预览" : "文件附件"} · {(file.size / 1024 / 1024).toFixed(2)} MB</small></div><button type="button" onClick={() => setTaskFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))} aria-label={`移除 ${file.name}`}><X size={15} /></button></article>)}</div> : <p>未选择附件（可选）</p>}</section> : null}
      <footer><span><ShieldCheck size={15} />不会发送成本、客户、店铺、其他供应商或内部备注</span><button type="submit" className="cia-primary" disabled={!enabled || publishing}>{publishing ? <LoaderCircle size={16} className="cia-spin" /> : <Send size={16} />}发布给 {organization.name}</button></footer>
    </form>}
    <div className="cia-task-progress-head"><strong>本组织{fixedTaskType ? selectedType.label : "单据"}与进度</strong><span>{visibleItems.length} 单</span></div>
    {loading ? <div className="cia-loading compact"><LoaderCircle size={18} className="cia-spin" />正在读取伙伴反馈进度…</div> : visibleItems.length ? <div className="cia-task-progress-list">{visibleItems.map((item) => {
      const meta = partnerTaskTypes.find((type) => type.value === item.itemType) || partnerTaskTypes[0]; const Icon = meta.icon;
      const sampleStage = item.itemType === "sampling_task" ? (item.sampling?.awardedQuoteCount ? "报价已确认" : item.sampling?.quoteCount ? "报价待确认" : item.sampling?.approvedVersion ? `R${item.sampling.approvedVersion} 定版待报价` : item.sampling?.pendingReviewCount ? `${item.sampling.pendingReviewCount} 轮待评审` : item.sampling?.roundCount ? `已返样 ${item.sampling.roundCount} 轮` : "等待首轮送样") : "";
      return <button type="button" key={item.id} onClick={() => void openDetail(item)}><span><Icon size={17} /></span><div><strong>{item.title}</strong><small>{meta.label} · {item.coreRefId}</small></div><div><b>{sampleStage || partnerTaskStatusLabels[item.status] || item.status}</b><small>{item.dueAt ? `交期 ${formatTime(item.dueAt)}` : "未设交期"}</small></div><div><b>{item.itemType === "sampling_task" ? `${item.sampling?.roundCount || 0} 轮` : `V${item.version}`}</b><small>{item.updatedAt ? `更新 ${formatTime(item.updatedAt)}` : "等待更新"}</small></div><ChevronRight size={17} /></button>;
    })}</div> : <div className="cia-empty compact"><ClipboardCheck size={22} /><strong>尚无协同单据</strong><span>{draft.taskType === "production_order" ? "绑定千顷 ERP 委外灌装工厂后，进行中的加工单会自动进入伙伴端。" : "选择上方类型并发布后，伙伴端会立即进入对应任务队列。"}</span></div>}
    {selectedItemId ? <PartnerTaskDetailModal organizationCode={organization.code} detail={selectedDetail} loading={detailLoading} onClose={() => { setSelectedItemId(""); setSelectedDetail(null); }} onReload={reloadSelectedDetail} notify={notify} /> : null}
  </section>;
}

export function CollaborationIdentityAdmin() {
  const [organizations, setOrganizations] = useState<CollaborationOrganization[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [detail, setDetail] = useState<CollaborationOrganizationAccess | null>(null);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [activation, setActivation] = useState<CollaborationInvitationResult | null>(null);
  const [provisionedAccess, setProvisionedAccess] = useState<ProvisionedAccess | null>(null);
  const [credentialMember, setCredentialMember] = useState<CollaborationMember | null>(null);
  const [credentialForm, setCredentialForm] = useState({ username: "", password: "", confirm: "" });
  const [access, setAccess] = useState<CollaborationAccessGrantPayload | null>(null);
  const [draftGrants, setDraftGrants] = useState<CollaborationAccessGrant[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [form, setForm] = useState({ name: "", organizationType: "warehouse" as CollaborationOrganizationType, notificationEmail: "", administratorUsername: "", administratorDisplayName: "", administratorEmail: "", administratorPassword: "", administratorPasswordConfirm: "" });
  const loadOrganizations = useCallback(async (nextKeyword = keyword, nextStatus = status) => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchCollaborationOrganizations({ keyword: nextKeyword.trim(), status: nextStatus });
      setOrganizations(payload.organizations || []);
      if (!selectedCode && payload.organizations?.[0]) setSelectedCode(payload.organizations[0].code);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "组织列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [keyword, status, selectedCode]);

  const loadDetail = useCallback(async (code: string) => {
    if (!code) { setDetail(null); return; }
    setDetailLoading(true);
    setError("");
    try {
      const payload = await fetchCollaborationOrganizationAccess(code);
      setDetail({ organization: payload.organization, members: payload.members || [], invitations: payload.invitations || [] });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "组织详情读取失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadAccess = useCallback(async (code: string) => {
    if (!code) { setAccess(null); setDraftGrants([]); setWarehouseOptions([]); return; }
    setAccessLoading(true);
    try {
      const payload = await fetchCollaborationOrganizationAccessGrants(code);
      setAccess(payload);
      setDraftGrants(payload.grants || []);
      if (payload.supportsWarehouseResources) {
        const [domesticResult, connectedResult] = await Promise.allSettled([fetchDomesticWarehouses(), fetchWarehouses()]);
        const domestic = domesticResult.status === "fulfilled" ? domesticResult.value.warehouses || [] : [];
        const connected = connectedResult.status === "fulfilled" ? connectedResult.value.warehouses || [] : [];
        setWarehouseOptions(warehouseDirectory(domestic, connected, payload.grants || []));
      } else {
        setWarehouseOptions([]);
      }
    } catch (requestError) {
      setAccess(null);
      setDraftGrants([]);
      setWarehouseOptions([]);
      setError(requestError instanceof Error ? requestError.message : "资源权限读取失败");
    } finally {
      setAccessLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrganizations("", ""); }, []);
  useEffect(() => { void loadDetail(selectedCode); }, [selectedCode, loadDetail]);
  useEffect(() => { void loadAccess(selectedCode); }, [selectedCode, loadAccess]);

  const metrics = useMemo(() => ({
    total: organizations.length,
    active: organizations.filter((item) => item.status === "active").length,
    adminsMissing: organizations.filter((item) => Number(item.administratorCount || 0) === 0).length,
    pending: organizations.reduce((sum, item) => sum + Number(item.pendingInvitationCount || 0), 0),
  }), [organizations]);

  const resourceOptions = useMemo<WarehouseOption[]>(() => {
    if (!access) return [];
    if (access.organization.organizationType === "warehouse") return warehouseOptions;
    const businessOptions: WarehouseOption[] = access.resources?.length
      ? access.resources.map((resource) => ({ ref: resource.resourceRef, name: resource.resourceName, meta: `${detail?.organization.name || access.organization.name} · 业务协同`, resourceType: "organization" as const, capabilities: resource.capabilities }))
      : [{ ref: access.defaultResourceRef || "", name: detail?.organization.name || access.organization.name, meta: "组织级业务范围", resourceType: "organization" as const, capabilities: access.capabilities }].filter((item) => item.ref);
    const consignmentOptions = access.supportsWarehouseResources
      ? warehouseOptions.map((option) => ({ ...option, meta: `${option.meta ? `${option.meta} · ` : ""}寄存仓库`, capabilities: access.warehouseCapabilities || [] }))
      : [];
    return [...businessOptions, ...consignmentOptions];
  }, [access, warehouseOptions, detail?.organization.name]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setBusyId("create");
    setError("");
    setNotice("");
    try {
      if (form.administratorPassword !== form.administratorPasswordConfirm) throw new Error("两次输入的登录密码不一致。");
      const result = await bootstrapCollaborationOrganization({
        name: form.name.trim(),
        organizationType: form.organizationType,
        status: "active",
        notificationEmail: form.notificationEmail.trim(),
        administrator: { username: form.administratorUsername.trim(), displayName: form.administratorDisplayName.trim() || undefined, email: form.administratorEmail.trim(), password: form.administratorPassword },
      });
      setProvisionedAccess({ organizationName: form.name.trim(), username: form.administratorUsername.trim(), password: form.administratorPassword });
      setActivation(null);
      setSelectedCode(result.organization.code);
      setNotice(`组织与管理员账号已创建，组织编码为 ${result.organization.code}。可点击下方按钮复制完整开户文案。`);
      await loadOrganizations("", "");
      await loadDetail(result.organization.code);
      setForm({ name: "", organizationType: "warehouse", notificationEmail: "", administratorUsername: "", administratorDisplayName: "", administratorEmail: "", administratorPassword: "", administratorPasswordConfirm: "" });
      setShowCreate(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "组织创建失败");
    } finally {
      setBusyId("");
    }
  }

  async function changeStatus(nextStatus: CollaborationOrganizationStatus) {
    if (!detail) return;
    const wording = nextStatus === "active" ? "重新启用" : "停用";
    if (!window.confirm(`${wording}“${detail.organization.name}”？${nextStatus === "suspended" ? "停用会立即撤销该组织的全部登录会话。" : ""}`)) return;
    setBusyId("status");
    setError("");
    try {
      await updateCollaborationOrganizationStatus(detail.organization.code, nextStatus);
      setNotice(`已${wording} ${detail.organization.name}。`);
      await Promise.all([loadOrganizations(), loadDetail(detail.organization.code)]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "组织状态更新失败");
    } finally { setBusyId(""); }
  }

  function toggleResource(option: WarehouseOption) {
    setDraftGrants((current) => {
      const existing = current.find((grant) => grant.resourceType === option.resourceType && grant.resourceRef === option.ref);
      if (existing) return current.filter((grant) => !(grant.resourceType === option.resourceType && grant.resourceRef === option.ref));
      return [...current, {
        resourceType: option.resourceType,
        resourceRef: option.ref,
        resourceName: option.name,
        permissions: (option.capabilities || access?.capabilities || []).map((capability) => capability.key),
      }];
    });
  }

  function toggleCapability(resourceType: "warehouse" | "organization", resourceRef: string, permission: string) {
    setDraftGrants((current) => current.map((grant) => grant.resourceType !== resourceType || grant.resourceRef !== resourceRef ? grant : {
      ...grant,
      permissions: grant.permissions.includes(permission)
        ? grant.permissions.filter((item) => item !== permission)
        : [...grant.permissions, permission],
    }));
  }

  function applyRecommendedPermissions() {
    setDraftGrants((current) => current.map((grant) => {
      const option = resourceOptions.find((item) => item.resourceType === grant.resourceType && item.ref === grant.resourceRef);
      return { ...grant, permissions: (option?.capabilities || access?.capabilities || []).map((capability) => capability.key) };
    }));
  }

  async function saveAccess() {
    if (!detail || !access) return;
    if (!draftGrants.length && !window.confirm("保存后该组织将看不到任何任务或库存。确认撤销全部资源权限？")) return;
    setBusyId("access");
    setError("");
    try {
      const result = await replaceCollaborationOrganizationAccessGrants(detail.organization.code, draftGrants);
      setDraftGrants(result.grants || []);
      setAccess({ ...access, ...result, grants: result.grants || [] });
      setNotice(`已保存 ${detail.organization.name} 的资源与业务权限，立即生效。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "资源权限保存失败");
    } finally {
      setBusyId("");
    }
  }

  async function reissue(invitation: CollaborationInvitation) {
    setBusyId(invitation.id);
    setError("");
    try {
      const result = await reissueCollaborationInvitation(invitation.id);
      setActivation(result);
      setNotice(result.delivery?.sent ? `已向 ${invitation.email} 重发激活邮件。` : "邀请已重签。邮件通道未发送，请立即复制新链接；旧链接已经失效。");
      if (selectedCode) await loadDetail(selectedCode);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "邀请重发失败");
    } finally { setBusyId(""); }
  }

  async function revoke(invitation: CollaborationInvitation) {
    if (!window.confirm(`撤销账号“${invitation.username}”的待激活邀请？`)) return;
    setBusyId(invitation.id);
    setError("");
    try {
      await revokeCollaborationInvitation(invitation.id);
      setNotice(`已撤销 ${invitation.username} 的邀请。`);
      if (selectedCode) await loadDetail(selectedCode);
      await loadOrganizations();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "邀请撤销失败");
    } finally { setBusyId(""); }
  }

  function openCredentialEditor(member: CollaborationMember) {
    setCredentialMember(member);
    setCredentialForm({ username: member.username, password: "", confirm: "" });
    setError("");
  }

  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    if (!detail || !credentialMember) return;
    if (credentialForm.password !== credentialForm.confirm) { setError("两次输入的新密码不一致。"); return; }
    if (credentialForm.username === credentialMember.username && !credentialForm.password) { setError("登录账号没有变化，也没有填写新密码。"); return; }
    setBusyId(`credentials:${credentialMember.id}`);
    setError("");
    try {
      const result = await updateCollaborationMemberCredentials(detail.organization.code, credentialMember.id, {
        username: credentialForm.username.trim(),
        ...(credentialForm.password ? { password: credentialForm.password } : {}),
      });
      setProvisionedAccess(credentialForm.password ? { organizationName: detail.organization.name, username: result.member.username, password: credentialForm.password } : null);
      setNotice(`${result.member.displayName} 的登录账号${result.passwordReset ? "和密码" : ""}已更新，${result.sessionsRevoked ? `并撤销 ${result.sessionsRevoked} 个登录会话。` : "下次登录立即生效。"}`);
      setCredentialMember(null);
      setCredentialForm({ username: "", password: "", confirm: "" });
      await loadDetail(detail.organization.code);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "伙伴账号更新失败");
    } finally {
      setBusyId("");
    }
  }

  return <div className="cia-page">
    <section className="cia-hero">
      <div>
        <span className="cia-kicker"><ShieldCheck size={15} /> 外部协同安全边界</span>
        <h2>伙伴与权限</h2>
        <p>统一维护伙伴组织、账号与可叠加业务角色。业务单据已分流到对应协同工作台，真实库存、成本与合同仍留在内部主账。</p>
      </div>
      <button className="cia-primary" type="button" onClick={() => { setShowCreate(true); setActivation(null); }}><UserPlus size={17} /> 创建组织与管理员</button>
    </section>

    <section className="cia-metrics" aria-label="协同账号概览">
      <article><Building2 size={20} /><div><strong>{metrics.total}</strong><span>合作组织</span></div></article>
      <article><Check size={20} /><div><strong>{metrics.active}</strong><span>正常使用</span></div></article>
      <article className={metrics.adminsMissing ? "warn" : ""}><AlertTriangle size={20} /><div><strong>{metrics.adminsMissing}</strong><span>尚无有效管理员</span></div></article>
      <article><Mail size={20} /><div><strong>{metrics.pending}</strong><span>待激活邀请</span></div></article>
    </section>

    {error ? <div className="cia-banner danger"><AlertTriangle size={17} /><span>{error}</span><button type="button" onClick={() => setError("")}><X size={15} /></button></div> : null}
    {notice ? <div className="cia-banner success"><Check size={17} /><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={15} /></button></div> : null}
    {activation?.activationUrl ? <section className="cia-activation">
      <div><KeyRound size={20} /><div><strong>一次性激活链接</strong><span>仅在本次创建或重签后显示。48 小时内有效，重签后旧链接立即失效。</span></div></div>
      <code>{activation.activationUrl}</code>
      <button type="button" onClick={async () => { await copyText(activation.activationUrl || ""); setNotice("激活链接已复制，请通过可信渠道发送给管理员本人。"); }}><Copy size={16} /> 复制链接</button>
    </section> : null}
    {provisionedAccess ? <section className="cia-credential" aria-live="polite">
      <header><div><KeyRound size={20} /><div><strong>登录凭据已生成</strong><span>用户收到后可直接登录；明文密码仅保留在当前页面。</span></div></div><button type="button" aria-label="关闭并清除登录凭据" onClick={() => setProvisionedAccess(null)}><X size={16} /></button></header>
      <div className="cia-credential-grid"><span>伙伴网址</span><a href={partnerPortalUrl} target="_blank" rel="noreferrer">{partnerPortalUrl}</a><span>登录账号</span><code>{provisionedAccess.username}</code><span>登录密码</span><code>{provisionedAccess.password}</code></div>
      <button className="cia-copy-credential" type="button" onClick={async () => { await copyText(provisioningMessage(provisionedAccess)); setNotice("完整开户文案已复制，可直接发送给对方。"); }}><Copy size={17} /> 一键复制开户文案</button>
    </section> : null}

    <section className="cia-console">
      <aside className="cia-org-list">
        <div className="cia-list-head"><div><strong>合作组织</strong><span>{loading ? "读取中…" : `${organizations.length} 家`}</span></div><button type="button" aria-label="刷新组织列表" onClick={() => void loadOrganizations()} disabled={loading}><RefreshCw size={16} className={loading ? "cia-spin" : ""} /></button></div>
        <form className="cia-filters" onSubmit={(event) => { event.preventDefault(); void loadOrganizations(); }}>
          <label><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索组织名称或编码" /></label>
          <select value={status} onChange={(event) => { setStatus(event.target.value); void loadOrganizations(keyword, event.target.value); }} aria-label="组织状态"><option value="">全部状态</option><option value="active">使用中</option><option value="suspended">已停用</option><option value="archived">已归档</option></select>
        </form>
        <div className="cia-org-scroll">{organizations.map((organization) => <button className={selectedCode === organization.code ? "active" : ""} type="button" key={organization.id} onClick={() => setSelectedCode(organization.code)}>
          <span className="cia-org-mark">{organization.name.slice(0, 1)}</span>
          <span><strong>{organization.name}</strong><small>{organization.code} · {organizationTypes.find((item) => item.value === organization.organizationType)?.label || organization.organizationType}</small><em>{organization.activeMemberCount || 0} 名有效成员 · {organization.pendingInvitationCount || 0} 个待激活</em></span>
          <span className={`cia-dot ${organization.status}`} title={statusLabels[organization.status]} />
          <ChevronRight size={16} />
        </button>)}
        {!loading && !organizations.length ? <div className="cia-empty compact"><Building2 size={22} /><strong>没有匹配的组织</strong><span>调整搜索条件，或创建第一个协同组织。</span></div> : null}</div>
      </aside>

      <div className="cia-detail">
        {detailLoading ? <div className="cia-loading"><LoaderCircle size={22} className="cia-spin" /> 正在读取组织权限与邀请…</div> : detail ? <>
          <header className="cia-detail-head">
            <div><span className="cia-eyebrow">{organizationTypes.find((item) => item.value === detail.organization.organizationType)?.label || detail.organization.organizationType}</span><h3>{detail.organization.name}</h3><p>{detail.organization.code} · 创建于 {formatTime(detail.organization.createdAt)}</p></div>
            <div><span className={`cia-status ${detail.organization.status}`}>{statusLabels[detail.organization.status]}</span>{detail.organization.status === "active" ? <button type="button" className="cia-danger-button" disabled={busyId === "status"} onClick={() => void changeStatus("suspended")}>停用组织</button> : <button type="button" className="cia-secondary" disabled={busyId === "status"} onClick={() => void changeStatus("active")}>重新启用</button>}</div>
          </header>
          <div className="cia-safety-note"><ShieldCheck size={18} /><div><strong>组织边界已经独立</strong><span>该组织成员只能进入自己的协作空间；停用组织会撤销其所有活动会话，但不会删除审计记录。</span></div></div>
          <section className="cia-section cia-access-section">
            <div className="cia-section-head">
              <div><LockKeyhole size={18} /><div><h4>资源与业务权限</h4><p>先分配仓库或业务范围，再决定允许的操作；合作方管理员不能自行扩大这些权限。</p></div></div>
              <div className="cia-access-actions"><button type="button" className="cia-secondary" onClick={applyRecommendedPermissions} disabled={accessLoading || !draftGrants.length}>使用推荐权限</button><button type="button" className="cia-primary" onClick={() => void saveAccess()} disabled={accessLoading || busyId === "access"}>{busyId === "access" ? <LoaderCircle size={15} className="cia-spin" /> : <Save size={15} />}保存权限</button></div>
            </div>
            {accessLoading ? <div className="cia-loading compact"><LoaderCircle size={18} className="cia-spin" /> 正在读取资源目录与授权…</div> : access ? <>
              <div className="cia-access-rule"><Warehouse size={17} /><span><strong>{access.supportsWarehouseResources && access.organization.organizationType !== "warehouse" ? "业务空间 + 寄存仓库双重隔离" : access.organization.organizationType === "warehouse" ? "按仓库隔离" : "按私有协作空间隔离"}</strong>未勾选的资源默认不可见；取消授权不会删除历史记录。</span></div>
              <div className="cia-resource-list">
                {resourceOptions.map((option) => {
                  const grant = draftGrants.find((item) => item.resourceType === option.resourceType && item.resourceRef === option.ref);
                  const capabilities = option.capabilities || (option.resourceType === "warehouse" ? access.warehouseCapabilities : access.capabilities) || [];
                  return <article className={`cia-resource-card ${grant ? "selected" : ""}`} key={`${option.resourceType}:${option.ref}`}>
                    <label className="cia-resource-toggle"><input type="checkbox" checked={Boolean(grant)} onChange={() => toggleResource(option)} /><span><strong>{option.name}</strong><small>{option.resourceType === "warehouse" ? "寄存仓库 · " : "业务协同 · "}{option.meta || option.ref}</small><code>{option.ref}</code></span><em>{grant ? "已授权" : "未授权"}</em></label>
                    {grant ? <div className="cia-capability-grid">{capabilities.map((capability) => <label key={capability.key} className={grant.permissions.includes(capability.key) ? "checked" : ""}><input type="checkbox" checked={grant.permissions.includes(capability.key)} onChange={() => toggleCapability(option.resourceType, option.ref, capability.key)} /><span><strong>{capability.label}</strong><small>{capability.description}</small></span></label>)}</div> : null}
                  </article>;
                })}
                {!resourceOptions.length ? <div className="cia-empty"><Warehouse size={22} /><strong>没有可分配的资源</strong><span>请先建立业务空间或国内仓库；已有历史授权仍会保留显示。</span></div> : null}
              </div>
            </> : <div className="cia-empty"><AlertTriangle size={22} /><strong>资源权限暂不可用</strong><span>请刷新页面；在权限载入前不会扩大任何组织的访问范围。</span></div>}
          </section>
          {access?.resources?.some((resource) => ["production", "procurement", "sampling"].includes(resource.resourceRef)) ? <section className="cia-role-routing"><div><Handshake size={18} /><span><strong>业务协同已按角色分区</strong><small>组织和权限在这里统一维护；加工单、采购单与打样单请进入对应业务工作台。</small></span></div><div>{organizationRoleLabels(detail.organization.organizationType).map((label) => <em key={label}>{label}</em>)}</div>{access.resources.some((resource) => resource.resourceRef === "production") ? <button type="button" onClick={() => { const params = new URLSearchParams({ organization: detail.organization.code, section: "factory-mapping" }); window.location.hash = `#outsourcing-collaboration?${params.toString()}`; }}>配置委外工厂映射<ChevronRight size={15} /></button> : <button type="button" onClick={() => { window.location.hash = "#partner-collaboration"; }}>进入协同总览<ChevronRight size={15} /></button>}</section> : null}
          <section className="cia-section">
            <div className="cia-section-head"><div><Users size={18} /><div><h4>已激活成员</h4><p>中台管理员可修改登录账号或直接重置密码；保存后会撤销该成员现有登录会话。</p></div></div><span>{detail.members.length} 人</span></div>
            {detail.members.length ? <div className="cia-table-wrap"><table className="cia-table"><thead><tr><th>成员</th><th>角色</th><th>账号状态</th><th>最近登录</th><th aria-label="账号操作" /></tr></thead><tbody>{detail.members.map((member) => <tr key={member.id}><td><strong>{member.displayName}</strong><small>{member.username} · {member.email || "未留邮箱"}</small></td><td>{roleLabels[member.role] || member.role}</td><td><span className={`cia-state ${member.status === "active" ? "cia-state-accepted" : "cia-state-expired"}`}>{member.status === "active" ? "正常" : "已停用"}</span><small>账号密码直接登录</small></td><td>{formatTime(member.lastLoginAt)}</td><td><button className="cia-account-action" type="button" onClick={() => openCredentialEditor(member)}><KeyRound size={14} />账号与密码</button></td></tr>)}</tbody></table></div> : <div className="cia-empty"><Users size={22} /><strong>暂无管理员账号</strong><span>创建组织时会同步建立首位管理员账号。</span></div>}
          </section>
          <section className="cia-section">
            <div className="cia-section-head"><div><Mail size={18} /><div><h4>邀请记录</h4><p>重发会轮换令牌；旧链接立即失效。激活完成后不允许继续撤销。</p></div></div><span>{detail.invitations.length} 条</span></div>
            <InvitationRows invitations={detail.invitations} busyId={busyId} onReissue={(item) => void reissue(item)} onRevoke={(item) => void revoke(item)} />
          </section>
        </> : <div className="cia-empty large"><Building2 size={28} /><strong>选择一个合作组织</strong><span>查看其管理员、成员和邀请状态。</span></div>}
      </div>
    </section>

    {showCreate ? <div className="cia-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== "create") setShowCreate(false); }}>
      <form className="cia-modal" onSubmit={submitCreate} role="dialog" aria-modal="true" aria-labelledby="cia-create-title">
        <header><div><span className="cia-kicker"><UserPlus size={14} /> 安全开户</span><h3 id="cia-create-title">创建组织与首位管理员</h3><p>组织编码由系统自动生成。你分配账号和登录密码，管理员收到后可直接进入伙伴门户。</p></div><button type="button" aria-label="关闭" onClick={() => setShowCreate(false)} disabled={busyId === "create"}><X size={18} /></button></header>
        <div className="cia-form-grid">
          <label><span>组织名称</span><input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：华东履约仓" /></label>
          <div className="cia-auto-code"><span>组织编码</span><strong>系统自动生成</strong><small>创建完成后会显示并作为伙伴登录凭据。</small></div>
          <label className="wide"><span>主合作类型</span><select value={form.organizationType} onChange={(event) => setForm({ ...form, organizationType: event.target.value as CollaborationOrganizationType })}>{organizationTypes.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.hint}</option>)}</select><small className="cia-field-help">主类型用于组织归类；创建后可在资源与业务权限中叠加其他协同角色。</small></label>
          <label className="wide"><span>组织通知邮箱（可选）</span><input type="email" value={form.notificationEmail} onChange={(event) => setForm({ ...form, notificationEmail: event.target.value })} placeholder="用于组织级业务通知，不替代管理员邮箱" /></label>
        </div>
        <div className="cia-form-divider"><span>首位组织管理员</span><em>直接登录</em></div>
        <div className="cia-form-grid">
          <label><span>管理员登录账号</span><input required minLength={3} maxLength={80} autoComplete="off" value={form.administratorUsername} onChange={(event) => setForm({ ...form, administratorUsername: event.target.value.replace(/[^A-Za-z0-9._-]/g, "") })} placeholder="例如：east-warehouse-admin" /></label>
          <label><span>管理员姓名（可选）</span><input maxLength={120} autoComplete="off" value={form.administratorDisplayName} onChange={(event) => setForm({ ...form, administratorDisplayName: event.target.value })} placeholder="未填写时使用登录账号" /></label>
          <label><span>管理员邮箱（可选）</span><input type="email" autoComplete="off" value={form.administratorEmail} onChange={(event) => setForm({ ...form, administratorEmail: event.target.value })} placeholder="可登录后补充，用于找回密码" /></label>
          <label><span>登录密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.administratorPassword} onChange={(event) => setForm({ ...form, administratorPassword: event.target.value })} placeholder="至少 12 位，包含字母和数字" /></label>
          <label className="wide"><span>确认登录密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.administratorPasswordConfirm} onChange={(event) => setForm({ ...form, administratorPasswordConfirm: event.target.value })} placeholder="再次输入登录密码" /></label>
        </div>
        <div className="cia-modal-note"><KeyRound size={18} /><span>用户收到账号和密码后可直接登录。服务端只保存 Argon2id 密码哈希；关闭凭证卡或刷新页面后明文密码即被清除。</span></div>
        <footer><button className="cia-secondary" type="button" onClick={() => setShowCreate(false)} disabled={busyId === "create"}>取消</button><button className="cia-primary" type="submit" disabled={busyId === "create"}>{busyId === "create" ? <LoaderCircle size={17} className="cia-spin" /> : <UserPlus size={17} />}{busyId === "create" ? "正在创建…" : "创建组织与账号"}</button></footer>
      </form>
    </div> : null}
    {credentialMember ? <div className="cia-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId.startsWith("credentials:")) setCredentialMember(null); }}>
      <form className="cia-modal cia-credential-modal" onSubmit={saveCredentials} role="dialog" aria-modal="true" aria-labelledby="cia-credential-title">
        <header><div><span className="cia-kicker"><KeyRound size={14} /> 管理员重置</span><h3 id="cia-credential-title">修改账号与密码</h3><p>{detail?.organization.name} · {credentialMember.displayName}。系统不会显示旧密码，密码留空表示只修改登录账号。</p></div><button type="button" aria-label="关闭" onClick={() => setCredentialMember(null)} disabled={busyId.startsWith("credentials:")}><X size={18} /></button></header>
        <div className="cia-form-grid">
          <label className="wide"><span>登录账号</span><input required minLength={3} maxLength={80} autoComplete="off" value={credentialForm.username} onChange={(event) => setCredentialForm({ ...credentialForm, username: event.target.value.replace(/[^A-Za-z0-9._-]/g, "") })} /><small>可使用字母、数字、点、下划线和短横线；保存后旧账号立即失效。</small></label>
          <label><span>新密码（可选）</span><input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={credentialForm.password} onChange={(event) => setCredentialForm({ ...credentialForm, password: event.target.value })} placeholder="至少 12 位，包含字母和数字" /></label>
          <label><span>确认新密码</span><input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={credentialForm.confirm} onChange={(event) => setCredentialForm({ ...credentialForm, confirm: event.target.value })} placeholder="再次输入新密码" /></label>
        </div>
        {error ? <div className="cia-modal-error"><AlertTriangle size={17} /><span>{error}</span></div> : null}
        <div className="cia-modal-note"><ShieldCheck size={18} /><span>保存后会撤销该账号的全部现有会话，并记录操作人、旧账号、新账号及是否重置密码；审计记录不会保存明文密码。</span></div>
        <footer><button className="cia-secondary" type="button" onClick={() => setCredentialMember(null)} disabled={busyId.startsWith("credentials:")}>取消</button><button className="cia-primary" type="submit" disabled={busyId.startsWith("credentials:")}>{busyId.startsWith("credentials:") ? <LoaderCircle size={17} className="cia-spin" /> : <Save size={17} />}{busyId.startsWith("credentials:") ? "正在保存…" : "保存并撤销旧会话"}</button></footer>
      </form>
    </div> : null}
  </div>;
}

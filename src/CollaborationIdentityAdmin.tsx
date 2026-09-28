import React, { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Check, ChevronRight, Copy, KeyRound, LoaderCircle, Mail, RefreshCw, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import {
  bootstrapCollaborationOrganization,
  CollaborationInvitation,
  CollaborationInvitationResult,
  CollaborationOrganization,
  CollaborationOrganizationAccess,
  CollaborationOrganizationStatus,
  CollaborationOrganizationType,
  fetchCollaborationOrganizationAccess,
  fetchCollaborationOrganizations,
  reissueCollaborationInvitation,
  revokeCollaborationInvitation,
  updateCollaborationOrganizationStatus,
} from "./collaboration-identity-admin-api";
import "./collaboration-identity-admin.css";

const organizationTypes: Array<{ value: CollaborationOrganizationType; label: string; hint: string }> = [
  { value: "warehouse", label: "国内仓 / 海外仓", hint: "入出库、调拨、库存与异常协同" },
  { value: "filing_service", label: "备案服务商", hint: "资料补充、备案节点与结果协同" },
  { value: "sampling_factory", label: "打样工厂", hint: "样品轮次、修改意见与确认协同" },
  { value: "packaging_factory", label: "包装厂", hint: "私有询报价与定标结果协同" },
  { value: "production_factory", label: "委外生产工厂", hint: "工单、排期、质检与交付协同" },
];

const statusLabels: Record<CollaborationOrganizationStatus, string> = { active: "使用中", suspended: "已停用", archived: "已归档" };
const roleLabels: Record<string, string> = { organization_admin: "组织管理员", manager: "业务经理", operator: "操作员", finance: "财务", viewer: "只读成员" };

function formatTime(value?: string) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚无记录" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function InvitationRows({ invitations, busyId, onReissue, onRevoke }: {
  invitations: CollaborationInvitation[];
  busyId: string;
  onReissue: (invitation: CollaborationInvitation) => void;
  onRevoke: (invitation: CollaborationInvitation) => void;
}) {
  if (!invitations.length) return <div className="cia-empty"><Mail size={22} /><strong>暂无邀请记录</strong><span>后续成员由该组织的管理员在外部门户邀请。</span></div>;
  return <div className="cia-table-wrap"><table className="cia-table">
    <thead><tr><th>待激活账号</th><th>角色 / MFA</th><th>有效期</th><th>状态</th><th aria-label="操作" /></tr></thead>
    <tbody>{invitations.map((invitation) => <tr key={invitation.id}>
      <td><strong>{invitation.username}</strong><small>{invitation.email || "未留邮箱"}</small></td>
      <td><span>{roleLabels[invitation.role] || invitation.role}</span><small>{invitation.mfaRequired ? "必须启用 MFA" : "常规验证"}</small></td>
      <td>{formatTime(invitation.expiresAt)}</td>
      <td><span className={`cia-state cia-state-${invitation.status}`}>{invitation.status === "pending" ? "待激活" : invitation.status === "accepted" ? "已激活" : "已失效"}</span></td>
      <td><div className="cia-row-actions">
        {invitation.status !== "accepted" ? <button type="button" disabled={busyId === invitation.id} onClick={() => onReissue(invitation)}>重发</button> : null}
        {invitation.status === "pending" ? <button className="danger" type="button" disabled={busyId === invitation.id} onClick={() => onRevoke(invitation)}>撤销</button> : null}
      </div></td>
    </tr>)}</tbody>
  </table></div>;
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

  useEffect(() => { void loadOrganizations("", ""); }, []);
  useEffect(() => { void loadDetail(selectedCode); }, [selectedCode, loadDetail]);

  const metrics = useMemo(() => ({
    total: organizations.length,
    active: organizations.filter((item) => item.status === "active").length,
    adminsMissing: organizations.filter((item) => Number(item.administratorCount || 0) === 0).length,
    pending: organizations.reduce((sum, item) => sum + Number(item.pendingInvitationCount || 0), 0),
  }), [organizations]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setBusyId("create");
    setError("");
    setNotice("");
    try {
      if (form.administratorPassword !== form.administratorPasswordConfirm) throw new Error("两次输入的初始密码不一致。");
      const result = await bootstrapCollaborationOrganization({
        name: form.name.trim(),
        organizationType: form.organizationType,
        status: "active",
        notificationEmail: form.notificationEmail.trim(),
        administrator: { username: form.administratorUsername.trim(), displayName: form.administratorDisplayName.trim() || undefined, email: form.administratorEmail.trim(), password: form.administratorPassword },
      });
      setActivation(null);
      setSelectedCode(result.organization.code);
      setNotice(`组织与管理员账号已创建，组织编码为 ${result.organization.code}。请将账号和初始密码分别通过可信渠道交给管理员。`);
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

  return <div className="cia-page">
    <section className="cia-hero">
      <div>
        <span className="cia-kicker"><ShieldCheck size={15} /> 外部协同安全边界</span>
        <h2>协同组织与账号</h2>
        <p>中台负责创建组织和首位管理员账号；组织编码自动生成。成员账号由合作方管理员在独立门户维护，真实库存、成本与合同仍留在内部主账。</p>
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
          <section className="cia-section">
            <div className="cia-section-head"><div><Users size={18} /><div><h4>已激活成员</h4><p>这里只查看状态。日常新增和角色调整由组织管理员在外部门户完成。</p></div></div><span>{detail.members.length} 人</span></div>
            {detail.members.length ? <div className="cia-table-wrap"><table className="cia-table"><thead><tr><th>成员</th><th>角色</th><th>安全状态</th><th>最近登录</th></tr></thead><tbody>{detail.members.map((member) => <tr key={member.id}><td><strong>{member.displayName}</strong><small>{member.username} · {member.email || "未留邮箱"}</small></td><td>{roleLabels[member.role] || member.role}</td><td><span className={`cia-state ${member.status === "active" ? "cia-state-accepted" : "cia-state-expired"}`}>{member.status === "active" ? "正常" : "已停用"}</span><small>{member.mustChangePassword ? "等待首次修改密码" : member.mfaEnabled ? "MFA 已启用" : member.mfaRequired ? "等待启用 MFA" : "未强制 MFA"}</small></td><td>{formatTime(member.lastLoginAt)}</td></tr>)}</tbody></table></div> : <div className="cia-empty"><Users size={22} /><strong>暂无管理员账号</strong><span>创建组织时会同步建立首位管理员账号。</span></div>}
          </section>
          <section className="cia-section">
            <div className="cia-section-head"><div><Mail size={18} /><div><h4>邀请记录</h4><p>重发会轮换令牌；旧链接立即失效。激活完成后不允许继续撤销。</p></div></div><span>{detail.invitations.length} 条</span></div>
            <InvitationRows invitations={detail.invitations} busyId={busyId} onReissue={(item) => void reissue(item)} onRevoke={(item) => void revoke(item)} />
          </section>
        </> : <div className="cia-empty large"><Building2 size={28} /><strong>选择一个合作组织</strong><span>查看其管理员、成员、MFA 和邀请状态。</span></div>}
      </div>
    </section>

    {showCreate ? <div className="cia-modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== "create") setShowCreate(false); }}>
      <form className="cia-modal" onSubmit={submitCreate} role="dialog" aria-modal="true" aria-labelledby="cia-create-title">
        <header><div><span className="cia-kicker"><UserPlus size={14} /> 安全开户</span><h3 id="cia-create-title">创建组织与首位管理员</h3><p>组织编码由系统自动生成。你分配初始账号和密码，管理员首次登录后必须修改密码并启用 MFA。</p></div><button type="button" aria-label="关闭" onClick={() => setShowCreate(false)} disabled={busyId === "create"}><X size={18} /></button></header>
        <div className="cia-form-grid">
          <label><span>组织名称</span><input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：华东履约仓" /></label>
          <div className="cia-auto-code"><span>组织编码</span><strong>系统自动生成</strong><small>创建完成后会显示并作为伙伴登录凭据。</small></div>
          <label className="wide"><span>合作类型</span><select value={form.organizationType} onChange={(event) => setForm({ ...form, organizationType: event.target.value as CollaborationOrganizationType })}>{organizationTypes.map((item) => <option key={item.value} value={item.value}>{item.label} — {item.hint}</option>)}</select></label>
          <label className="wide"><span>组织通知邮箱（可选）</span><input type="email" value={form.notificationEmail} onChange={(event) => setForm({ ...form, notificationEmail: event.target.value })} placeholder="用于组织级业务通知，不替代管理员邮箱" /></label>
        </div>
        <div className="cia-form-divider"><span>首位组织管理员</span><em>强制 MFA</em></div>
        <div className="cia-form-grid">
          <label><span>管理员登录账号</span><input required minLength={3} maxLength={80} autoComplete="off" value={form.administratorUsername} onChange={(event) => setForm({ ...form, administratorUsername: event.target.value.replace(/[^A-Za-z0-9._-]/g, "") })} placeholder="例如：east-warehouse-admin" /></label>
          <label><span>管理员姓名（可选）</span><input maxLength={120} autoComplete="off" value={form.administratorDisplayName} onChange={(event) => setForm({ ...form, administratorDisplayName: event.target.value })} placeholder="未填写时使用登录账号" /></label>
          <label><span>管理员邮箱（可选）</span><input type="email" autoComplete="off" value={form.administratorEmail} onChange={(event) => setForm({ ...form, administratorEmail: event.target.value })} placeholder="可登录后补充，用于找回密码" /></label>
          <label><span>初始密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.administratorPassword} onChange={(event) => setForm({ ...form, administratorPassword: event.target.value })} placeholder="至少 12 位，包含字母和数字" /></label>
          <label className="wide"><span>确认初始密码</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.administratorPasswordConfirm} onChange={(event) => setForm({ ...form, administratorPasswordConfirm: event.target.value })} placeholder="再次输入初始密码" /></label>
        </div>
        <div className="cia-modal-note"><KeyRound size={18} /><span>初始密码只在本次提交中使用，服务端立即转换为 Argon2id 哈希，不保存或返回明文。请将账号与密码分开传递给管理员。</span></div>
        <footer><button className="cia-secondary" type="button" onClick={() => setShowCreate(false)} disabled={busyId === "create"}>取消</button><button className="cia-primary" type="submit" disabled={busyId === "create"}>{busyId === "create" ? <LoaderCircle size={17} className="cia-spin" /> : <UserPlus size={17} />}{busyId === "create" ? "正在创建…" : "创建组织与账号"}</button></footer>
      </form>
    </div> : null}
  </div>;
}

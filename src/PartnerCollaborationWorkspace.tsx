import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Building2, Check, ChevronRight, ExternalLink, Factory, FlaskConical, Handshake, LoaderCircle, PackageCheck, RefreshCw, Search, ShieldCheck, Users, Warehouse, X } from "lucide-react";
import {
  CollaborationAccessGrantPayload,
  CollaborationOrganization,
  CollaborationPartnerTaskType,
  fetchCollaborationOrganizationAccessGrants,
  fetchCollaborationOrganizations,
} from "./collaboration-identity-admin-api";
import { PartnerTaskPanel } from "./CollaborationIdentityAdmin";
import { organizationRoleLabels, organizationSupportsTask, partnerRoleDefinitions, roleDefinition } from "./collaboration-role-model";
import "./partner-collaboration-workspace.css";

const roleIcons = {
  production_order: Factory,
  purchase_order: PackageCheck,
  sampling_task: FlaskConical,
} satisfies Record<CollaborationPartnerTaskType, typeof Factory>;

function rolePath(taskType: CollaborationPartnerTaskType) {
  return roleDefinition(taskType).hash;
}

function activeRoleLabels(access: CollaborationAccessGrantPayload | null, organization: CollaborationOrganization) {
  if (!access) return organizationRoleLabels(organization.organizationType);
  const labels: string[] = [];
  if (access.grants.some((grant) => grant.resourceRef === "production" && grant.permissions.includes("production.order.view"))) labels.push("委外加工");
  if (access.grants.some((grant) => grant.resourceRef === "procurement" && grant.permissions.includes("procurement.order.view"))) labels.push("物料供应");
  if (access.grants.some((grant) => grant.resourceRef === "sampling" && grant.permissions.includes("sampling.task.view"))) labels.push("打样");
  return labels.length ? labels : organizationRoleLabels(organization.organizationType);
}

export function PartnerCollaborationOverview() {
  const [organizations, setOrganizations] = useState<CollaborationOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await fetchCollaborationOrganizations({ status: "active" });
      setOrganizations(payload.organizations || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "协同组织读取失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const partnerOrganizations = organizations.filter((item) => item.organizationType !== "internal");
  const multiRoleCount = partnerOrganizations.filter((item) => organizationRoleLabels(item.organizationType).length > 1).length;
  const warehouseCount = partnerOrganizations.filter((item) => item.organizationType === "warehouse").length;

  return <div className="pcw-page pcw-overview">
    <section className="pcw-hero overview">
      <div><span className="pcw-kicker"><Handshake size={15} /> PARTNER OPERATIONS</span><h2>协同总览</h2><p>按业务角色进入各自工作台。一个伙伴组织可以同时承担多个角色，但单据始终按组织归属隔离。</p></div>
      <div className="pcw-hero-actions"><button type="button" onClick={() => { window.location.hash = "#collaboration-accounts"; }}><Users size={17} />伙伴与权限</button><button className="primary" type="button" onClick={() => window.open("https://partner.tongzhoukuajing.com", "_blank", "noopener,noreferrer")}><ExternalLink size={17} />打开伙伴门户</button></div>
    </section>

    {error ? <div className="pcw-banner danger"><AlertTriangle size={17} />{error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
    <section className="pcw-overview-metrics">
      <article><Building2 size={21} /><div><strong>{loading ? "—" : partnerOrganizations.length}</strong><span>有效伙伴组织</span></div></article>
      <article><ShieldCheck size={21} /><div><strong>{loading ? "—" : multiRoleCount}</strong><span>多角色伙伴</span></div></article>
      <article><Warehouse size={21} /><div><strong>{loading ? "—" : warehouseCount}</strong><span>仓储组织</span></div></article>
      <article><Check size={21} /><div><strong>组织级</strong><span>单据与数据隔离</span></div></article>
    </section>

    <section className="pcw-role-grid">
      <button className="warehouse" type="button" onClick={() => { window.location.hash = "#domestic-collaboration"; }}><span><Warehouse size={23} /></span><div><small>WAREHOUSE</small><strong>国内仓协同</strong><p>入库、出库、调拨、盘点和异常工单。</p></div><em>{warehouseCount} 家</em><ChevronRight size={19} /></button>
      {partnerRoleDefinitions.filter((role) => role.taskType !== "sampling_task").map((role) => { const Icon = roleIcons[role.taskType]; const count = partnerOrganizations.filter((item) => organizationSupportsTask(item.organizationType, role.taskType)).length; return <button type="button" key={role.taskType} onClick={() => { window.location.hash = role.hash; }}><span><Icon size={23} /></span><div><small>{role.taskType.replaceAll("_", " ").toUpperCase()}</small><strong>{role.label}</strong><p>{role.description}</p></div><em>{count} 家</em><ChevronRight size={19} /></button>; })}
      <button type="button" onClick={() => { window.location.hash = "#material-sampling-collaboration"; }}><span><FlaskConical size={23} /></span><div><small>INNER MATERIAL SAMPLE</small><strong>料体打样</strong><p>一轮可产生多个料体，逐个自动编码、评审定版并绑定报价。</p></div><em>{partnerOrganizations.filter((item) => ["sampling_factory", "production_factory", "material_supplier"].includes(item.organizationType)).length} 家</em><ChevronRight size={19} /></button>
      <button type="button" onClick={() => { window.location.hash = "#packaging-sampling-collaboration"; }}><span><Boxes size={23} /></span><div><small>PACKAGING SAMPLE</small><strong>包材打样</strong><p>独立管理材质、工艺、盒型/瓶型、尺寸及设计文件。</p></div><em>{partnerOrganizations.filter((item) => ["packaging_factory", "production_factory"].includes(item.organizationType)).length} 家</em><ChevronRight size={19} /></button>
    </section>

    <section className="pcw-boundary-strip"><div><ShieldCheck size={19} /><span><strong>一个组织，多种协同身份</strong><small>例如委外工厂可同时承接加工单和采购单，无需重复开户。</small></span></div><i /><div><PackageCheck size={19} /><span><strong>一个页面，一类业务单据</strong><small>加工、采购、打样分别工作，减少误操作和信息拥挤。</small></span></div><i /><div><Users size={19} /><span><strong>一个边界，只看本组织</strong><small>角色叠加不会扩大到其他伙伴，历史操作完整留痕。</small></span></div></section>

    <section className="pcw-partner-snapshot"><header><div><small>ACTIVE PARTNERS</small><h3>伙伴角色分布</h3></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "pcw-spin" : ""} />刷新</button></header>{loading ? <div className="pcw-loading"><LoaderCircle className="pcw-spin" size={20} />正在读取伙伴组织…</div> : partnerOrganizations.length ? <div className="pcw-partner-rows">{partnerOrganizations.slice(0, 12).map((organization) => <article key={organization.id}><span>{organization.name.slice(0, 1)}</span><div><strong>{organization.name}</strong><small>{organization.code} · {organization.activeMemberCount || 0} 名有效成员</small></div><div>{organizationRoleLabels(organization.organizationType).map((label) => <em key={label}>{label}</em>)}</div></article>)}</div> : <div className="pcw-loading">尚未创建伙伴组织。</div>}</section>
  </div>;
}

export function PartnerCollaborationWorkspace({ taskType, sampleCategory }: { taskType: CollaborationPartnerTaskType; sampleCategory?: "inner_material" | "packaging" }) {
  const baseDefinition = roleDefinition(taskType);
  const definition = sampleCategory ? { ...baseDefinition, label: sampleCategory === "packaging" ? "包材打样" : "料体打样", shortLabel: sampleCategory === "packaging" ? "包材打样" : "料体打样", description: sampleCategory === "packaging" ? "独立管理包装盒、包装瓶的材质、工艺、结构尺寸、文件与多轮定版。" : "管理内料与原料多轮打样；一轮可登记多个独立料体并选择最终样。", eligibleOrganizationTypes: sampleCategory === "packaging" ? ["packaging_factory", "production_factory"] : ["sampling_factory", "production_factory", "material_supplier"] } : baseDefinition;
  const Icon = roleIcons[taskType];
  const [organizations, setOrganizations] = useState<CollaborationOrganization[]>([]);
  const [selectedCode, setSelectedCode] = useState("");
  const [access, setAccess] = useState<CollaborationAccessGrantPayload | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const notify = useCallback((message: string, isError = false) => { if (isError) setError(message); else setNotice(message); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const payload = await fetchCollaborationOrganizations({ status: "active" });
      const eligible = (payload.organizations || []).filter((organization) => sampleCategory ? definition.eligibleOrganizationTypes.includes(organization.organizationType) : organizationSupportsTask(organization.organizationType, taskType));
      setOrganizations(eligible);
      setSelectedCode((current) => eligible.some((item) => item.code === current) ? current : (eligible[0]?.code || ""));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "伙伴组织读取失败"); }
    finally { setLoading(false); }
  }, [taskType, sampleCategory]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedCode) { setAccess(null); return; }
    let active = true; setAccessLoading(true); setError("");
    void fetchCollaborationOrganizationAccessGrants(selectedCode).then((payload) => { if (active) setAccess(payload); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "伙伴权限读取失败"); }).finally(() => { if (active) setAccessLoading(false); });
    return () => { active = false; };
  }, [selectedCode]);

  const visibleOrganizations = useMemo(() => { const value = keyword.trim().toLowerCase(); return value ? organizations.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(value)) : organizations; }, [organizations, keyword]);
  const selected = organizations.find((item) => item.code === selectedCode) || null;
  const authorizedCount = organizations.filter((organization) => organization.organizationType === "production_factory" || definition.eligibleOrganizationTypes.includes(organization.organizationType)).length;
  const activeLabels = selected ? activeRoleLabels(access, selected) : [];

  return <div className="pcw-page">
    <section className={`pcw-hero ${taskType}`}><div><span className="pcw-kicker"><Icon size={15} /> {definition.taskType.replaceAll("_", " ").toUpperCase()}</span><h2>{definition.label}</h2><p>{definition.description} 同一家伙伴可拥有多个角色，这里只展示{definition.shortLabel}相关内容。</p></div><div className="pcw-hero-actions"><button type="button" onClick={() => { window.location.hash = "#partner-collaboration"; }}><Handshake size={17} />协同总览</button><button type="button" onClick={() => { window.location.hash = "#collaboration-accounts"; }}><ShieldCheck size={17} />配置伙伴权限</button></div></section>
    {error ? <div className="pcw-banner danger"><AlertTriangle size={17} />{error}<button onClick={() => setError("")}><X size={15} /></button></div> : null}
    {notice ? <div className="pcw-banner success"><Check size={17} />{notice}<button onClick={() => setNotice("")}><X size={15} /></button></div> : null}
    <section className="pcw-workspace">
      <aside className="pcw-org-rail"><header><div><strong>{definition.shortLabel}伙伴</strong><small>{loading ? "读取中…" : `${authorizedCount} 家可配置`}</small></div><button onClick={() => void load()} disabled={loading} aria-label="刷新伙伴"><RefreshCw size={15} className={loading ? "pcw-spin" : ""} /></button></header><label><Search size={15} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索伙伴" /></label><div>{visibleOrganizations.map((organization) => <button type="button" className={organization.code === selectedCode ? "active" : ""} key={organization.id} onClick={() => setSelectedCode(organization.code)}><span>{organization.name.slice(0, 1)}</span><div><strong>{organization.name}</strong><small>{organization.code}</small><em>{organizationRoleLabels(organization.organizationType).join(" · ")}</em></div><ChevronRight size={16} /></button>)}{!loading && !visibleOrganizations.length ? <p>没有符合此角色的伙伴组织。</p> : null}</div></aside>
      <main className="pcw-work-main">{accessLoading ? <div className="pcw-loading tall"><LoaderCircle className="pcw-spin" size={22} />正在读取组织业务权限…</div> : selected ? <><header className="pcw-selected-head"><div><span className="pcw-selected-mark">{selected.name.slice(0, 1)}</span><div><small>当前协同伙伴</small><h3>{selected.name}</h3><p>{selected.code} · {selected.activeMemberCount || 0} 名有效成员</p></div></div><div>{activeLabels.map((label) => <em className={label === definition.shortLabel ? "current" : ""} key={label}>{label}</em>)}</div></header><div className="pcw-multi-role-note"><ShieldCheck size={17} /><span><strong>角色可叠加，数据不混用</strong>当前页面只处理{definition.shortLabel}单据；该伙伴的其他角色请从上方协同总览进入。</span></div><PartnerTaskPanel organization={selected} access={access} notify={notify} fixedTaskType={taskType} fixedSampleCategory={sampleCategory} /></> : <div className="pcw-loading tall"><Building2 size={25} />请先在“伙伴与权限”创建或启用符合此角色的组织。</div>}</main>
    </section>
    <nav className="pcw-role-switch" aria-label="切换协同角色">{partnerRoleDefinitions.filter((role) => role.taskType !== "sampling_task").map((role) => { const RoleIcon = roleIcons[role.taskType]; return <button className={!sampleCategory && role.taskType === taskType ? "active" : ""} type="button" key={role.taskType} onClick={() => { window.location.hash = rolePath(role.taskType); }}><RoleIcon size={16} />{role.shortLabel}</button>; })}<button className={sampleCategory === "inner_material" ? "active" : ""} type="button" onClick={() => { window.location.hash = "#material-sampling-collaboration"; }}><FlaskConical size={16} />料体打样</button><button className={sampleCategory === "packaging" ? "active" : ""} type="button" onClick={() => { window.location.hash = "#packaging-sampling-collaboration"; }}><Boxes size={16} />包材打样</button></nav>
  </div>;
}

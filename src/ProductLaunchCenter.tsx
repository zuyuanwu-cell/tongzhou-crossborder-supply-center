import React from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardCheck,
  Download,
  ExternalLink,
  Factory,
  FlaskConical,
  Grid2X2,
  Lightbulb,
  List,
  LoaderCircle,
  MessageSquare,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  X,
} from "lucide-react";
import {
  AuthUser,
  ProductLaunchInput,
  ProductLaunchChecklistItem,
  ProductLaunchCountryFiling,
  ProductLaunchFactoryAssignment,
  ProductLaunchMeta,
  ProductLaunchPayload,
  ProductLaunchPriority,
  ProductLaunchRequest,
  ProductLaunchStageKey,
  commentProductLaunchRequest,
  assignProductLaunchFactory,
  createProductLaunchRequest,
  fetchProductLaunchMeta,
  fetchProductLaunchRequests,
  progressProductLaunchRequest,
  syncProductLaunchFactoryAssignment,
  updateProductLaunchChecklist,
  updateProductLaunchFiling,
  updateProductLaunchPilot,
  updateProductLaunchRequest,
} from "./api";
import "./product-launch.css";

type QuickFilter = "all" | "submitted" | "progress" | "completed_month" | "overdue" | "mine";
type ViewMode = "board" | "list";

const MAIN_STAGES: Array<{ key: ProductLaunchStageKey; label: string; hint: string }> = [
  { key: "submitted", label: "待评审", hint: "运营已提交，等产品评估" },
  { key: "approved", label: "已立项", hint: "确认要做，安排负责人" },
  { key: "factory_validation", label: "工厂验证", hint: "原料、配方、样品报告与报价" },
  { key: "product_definition", label: "产品定版", hint: "配方表、成分与规格确认" },
  { key: "packaging", label: "文案包装", hint: "产品文案和包装设计" },
  { key: "filing", label: "多国备案", hint: "每个国家单独跟踪准入" },
  { key: "pilot_production", label: "首批生产", hint: "样品确认、审批数量、生产" },
  { key: "completed", label: "首批完成", hint: "首批生产验收完成" },
];
const SIDE_STAGES: Array<{ key: ProductLaunchStageKey; label: string }> = [
  { key: "on_hold", label: "搁置" },
  { key: "rejected", label: "未立项" },
  { key: "cancelled", label: "取消" },
];
const STAGE_LABEL: Record<string, string> = Object.fromEntries([...MAIN_STAGES, ...SIDE_STAGES].map((stage) => [stage.key, stage.label]));
const PRIORITY_META: Record<ProductLaunchPriority, { label: string; rank: number }> = {
  urgent: { label: "紧急", rank: 0 },
  high: { label: "高", rank: 1 },
  normal: { label: "中", rank: 2 },
  low: { label: "低", rank: 3 },
};
const FALLBACK_SOURCES = ["竞品热卖", "平台趋势", "客户/渠道需求", "老品迭代", "供应商推荐", "其他"];
const FALLBACK_PLATFORMS = ["Ozon", "Wildberries", "Yandex Market", "Shopee", "Lazada", "TikTok Shop", "Tokopedia", "线下/分销", "其他"];
const FALLBACK_COUNTRIES = ["俄罗斯", "印度尼西亚", "马来西亚", "越南", "泰国", "菲律宾"];
const FALLBACK_CURRENCIES = ["CNY", "USD", "RUB", "IDR", "MYR", "VND", "THB", "PHP"];
const VIEW_STORAGE_KEY = "tz_product_launch_view";

type FormDraft = {
  title: string;
  category: string;
  targetCountries: string[];
  platform: string;
  source: string;
  reason: string;
  sellingPoints: string;
  competitorLinks: string;
  targetPrice: string;
  currency: string;
  targetCost: string;
  expectedMonthlySales: string;
  firstOrderQty: string;
  priority: ProductLaunchPriority;
  expectedLaunchDate: string;
};

const EMPTY_DRAFT: FormDraft = {
  title: "",
  category: "",
  targetCountries: [],
  platform: "",
  source: "",
  reason: "",
  sellingPoints: "",
  competitorLinks: "",
  targetPrice: "",
  currency: "CNY",
  targetCost: "",
  expectedMonthlySales: "",
  firstOrderQty: "",
  priority: "normal",
  expectedLaunchDate: "",
};

function localToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function shortDate(value?: string) {
  if (!value) return "";
  const date = value.slice(0, 10);
  return date.slice(0, 4) === localToday().slice(0, 4) ? date.slice(5) : date;
}

function dateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function daysSince(value?: string) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function money(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined) return "";
  return `${currency} ${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function bigrams(value: string) {
  const clean = value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const grams = new Set<string>();
  for (let index = 0; index < clean.length - 1; index += 1) grams.add(clean.slice(index, index + 2));
  if (clean.length === 1) grams.add(clean);
  return grams;
}

function similarity(left: string, right: string) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((gram) => { if (b.has(gram)) shared += 1; });
  return shared / Math.min(a.size, b.size);
}

function nextMainStage(stage: ProductLaunchStageKey) {
  const index = MAIN_STAGES.findIndex((item) => item.key === stage);
  return index >= 0 && index < MAIN_STAGES.length - 1 ? MAIN_STAGES[index + 1].key : null;
}

function sortRequests(left: ProductLaunchRequest, right: ProductLaunchRequest) {
  if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
  const priority = PRIORITY_META[left.priority].rank - PRIORITY_META[right.priority].rank;
  if (priority) return priority;
  const due = (left.nextDueDate || "9999").localeCompare(right.nextDueDate || "9999");
  if (due) return due;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function draftFrom(request: ProductLaunchRequest): FormDraft {
  return {
    title: request.title,
    category: request.category || "",
    targetCountries: request.targetCountries?.length ? request.targetCountries : [request.country],
    platform: request.platform || "",
    source: request.source,
    reason: request.reason,
    sellingPoints: request.sellingPoints || "",
    competitorLinks: (request.competitorLinks || []).join("\n"),
    targetPrice: request.targetPrice === null ? "" : String(request.targetPrice),
    currency: request.currency || "CNY",
    targetCost: request.targetCost === null ? "" : String(request.targetCost),
    expectedMonthlySales: request.expectedMonthlySales === null ? "" : String(request.expectedMonthlySales),
    firstOrderQty: request.firstOrderQty === null ? "" : String(request.firstOrderQty),
    priority: request.priority,
    expectedLaunchDate: request.expectedLaunchDate || "",
  };
}

function inputFrom(draft: FormDraft): ProductLaunchInput {
  return {
    ...draft,
    competitorLinks: draft.competitorLinks.split(/\s*[\n,，]\s*/).map((item) => item.trim()).filter(Boolean),
    targetPrice: draft.targetPrice.trim() || null,
    targetCost: draft.targetCost.trim() || null,
    expectedMonthlySales: draft.expectedMonthlySales.trim() || null,
    firstOrderQty: draft.firstOrderQty.trim() || null,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(rows: ProductLaunchRequest[]) {
  const header = ["编号", "产品/方向", "品类", "目标国家", "平台", "需求来源", "优先级", "阶段", "清单进度", "备案进度", "负责人", "下一步", "截止日期", "期望完成", "目标售价", "币种", "目标成本", "预计月销", "意向首批", "审批首批", "实际完成", "关联SKU", "提交人", "提交时间", "最近更新", "需求说明"];
  const lines = rows.map((row) => [
    row.id, row.title, row.category, row.targetCountries.join(" / "), row.platform, row.source, PRIORITY_META[row.priority]?.label, STAGE_LABEL[row.stage] || row.stage,
    `${row.checklistProgress.completed}/${row.checklistProgress.total}`, `${row.filingProgress.approved}/${row.filingProgress.total}`,
    row.owner?.name || "", row.nextAction, row.nextDueDate, row.expectedLaunchDate, row.targetPrice ?? "", row.currency, row.targetCost ?? "",
    row.expectedMonthlySales ?? "", row.firstOrderQty ?? "", row.pilotProduction.approvedQty ?? "", row.pilotProduction.producedQty ?? "", row.linkedSku, row.createdBy, dateTime(row.createdAt), dateTime(row.updatedAt), row.reason,
  ].map(csvCell).join(","));
  const blob = new Blob([`﻿${[header.join(","), ...lines].join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `开品需求-${localToday()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hashParams() {
  return new URLSearchParams(window.location.hash.split("?", 2)[1] || "");
}

function PriorityTag({ priority }: { priority: ProductLaunchPriority }) {
  return <span className={`plc-priority plc-priority--${priority}`}>{PRIORITY_META[priority]?.label || "中"}</span>;
}

function StagePill({ stage }: { stage: ProductLaunchStageKey }) {
  return <span className={`plc-stage-pill plc-stage-pill--${stage}`}>{STAGE_LABEL[stage] || stage}</span>;
}

function OwnerBadge({ owner }: { owner: ProductLaunchRequest["owner"] }) {
  if (!owner?.name) return <span className="plc-owner plc-owner--empty">待指派</span>;
  return <span className="plc-owner"><i>{owner.name.slice(0, 1)}</i>{owner.name}</span>;
}

export function ProductLaunchCenter({ currentUser }: { currentUser: AuthUser }) {
  const [meta, setMeta] = React.useState<ProductLaunchMeta | null>(null);
  const [payload, setPayload] = React.useState<ProductLaunchPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [country, setCountry] = React.useState("");
  const [priority, setPriority] = React.useState("");
  const [quick, setQuick] = React.useState<QuickFilter>("all");
  const [showClosed, setShowClosed] = React.useState(false);
  const [view, setView] = React.useState<ViewMode>(() => {
    try { return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "board"; } catch { return "board"; }
  });
  const [selectedId, setSelectedId] = React.useState(() => hashParams().get("id") || "");
  const [form, setForm] = React.useState<{ mode: "create" | "edit"; id?: string; draft: FormDraft } | null>(() => (hashParams().get("new") === "1" ? { mode: "create", draft: EMPTY_DRAFT } : null));

  const permissions = payload?.permissions || meta?.permissions || { view: true, submit: false, manage: false };
  const userId = String(currentUser.id || "");

  const load = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [metaResult, listResult] = await Promise.all([
        meta ? Promise.resolve(meta) : fetchProductLaunchMeta(),
        fetchProductLaunchRequests(),
      ]);
      setMeta(metaResult);
      setPayload(listResult);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "开品需求读取失败");
    } finally {
      setLoading(false);
    }
  }, [meta]);

  React.useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* storage may be unavailable */ }
  }, [view]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const requests = payload?.requests || [];
  const today = localToday();
  const month = today.slice(0, 7);

  const filtered = React.useMemo(() => {
    const word = keyword.trim().toLowerCase();
    return requests.filter((request) => {
      if (country && !request.targetCountries.includes(country)) return false;
      if (priority && request.priority !== priority) return false;
      if (quick === "submitted" && request.stage !== "submitted") return false;
      if (quick === "progress" && !["approved", "factory_validation", "product_definition", "packaging", "filing", "pilot_production"].includes(request.stage)) return false;
      if (quick === "completed_month" && !(request.stage === "completed" && request.completedAt.slice(0, 7) === month)) return false;
      if (quick === "overdue" && !request.overdue) return false;
      if (quick === "mine" && request.createdById !== userId && request.owner?.id !== userId) return false;
      if (!word) return true;
      return [request.id, request.title, request.category, request.targetCountries.join(" "), request.platform, request.reason, request.linkedSku, request.createdBy, request.owner?.name]
        .some((value) => String(value || "").toLowerCase().includes(word));
    }).sort(sortRequests);
  }, [requests, keyword, country, priority, quick, month, userId]);

  const visibleSideStages = showClosed || quick !== "all";
  const listRows = React.useMemo(
    () => filtered.filter((request) => visibleSideStages || MAIN_STAGES.some((stage) => stage.key === request.stage)),
    [filtered, visibleSideStages],
  );
  const closedCount = filtered.filter((request) => SIDE_STAGES.some((stage) => stage.key === request.stage)).length;
  const selected = requests.find((request) => request.id === selectedId) || null;
  const countries = Array.from(new Set([...(meta?.countries?.length ? meta.countries : FALLBACK_COUNTRIES), ...requests.flatMap((request) => request.targetCountries || [request.country])].filter(Boolean)));

  function replaceRequest(next: ProductLaunchRequest) {
    setPayload((current) => {
      if (!current) return current;
      const exists = current.requests.some((request) => request.id === next.id);
      return { ...current, requests: exists ? current.requests.map((request) => (request.id === next.id ? next : request)) : [next, ...current.requests] };
    });
    void fetchProductLaunchRequests().then(setPayload).catch(() => undefined);
  }

  function openDetail(id: string) {
    setSelectedId(id);
  }

  const summary = payload?.summary;
  const kpis: Array<{ key: QuickFilter; label: string; value: number; note: string; tone: string }> = [
    { key: "submitted", label: "待评审", value: summary?.pendingReview ?? 0, note: "等产品评估", tone: "orange" },
    { key: "progress", label: "推进中", value: summary?.inProgress ?? 0, note: "立项到首批生产", tone: "blue" },
    { key: "completed_month", label: "本月首批完成", value: summary?.completedThisMonth ?? 0, note: `${Number(month.slice(5))} 月验收完成`, tone: "green" },
    { key: "overdue", label: "已逾期", value: summary?.overdue ?? 0, note: "超过截止或期望完成", tone: "red" },
    { key: "mine", label: "与我相关", value: summary?.mine ?? 0, note: "我提交或我负责", tone: "navy" },
  ];

  return (
    <div className="plc-page">
      <section className="plc-hero">
        <div className="plc-hero__copy">
          <p className="plc-eyebrow">PRODUCT LAUNCH</p>
          <h2>开品需求</h2>
          <p>运营提需求后，用一张开品清单串起工厂验证、产品资料、文案包装、多国备案和首批生产，最后明确完成、搁置或取消。</p>
        </div>
        <div className="plc-hero__actions">
          <button type="button" className="plc-button plc-button--ghost" onClick={() => void load(true)} disabled={loading}>
            {loading ? <LoaderCircle size={16} className="plc-spin" /> : <RefreshCw size={16} />}刷新
          </button>
          {permissions.submit ? (
            <button type="button" className="plc-button plc-button--primary" onClick={() => setForm({ mode: "create", draft: EMPTY_DRAFT })}>
              <Plus size={16} />提交开品需求
            </button>
          ) : null}
        </div>
        <ol className="plc-flow" aria-label="开品流程">
          {MAIN_STAGES.map((stage, index) => (
            <li key={stage.key}>
              <span>{index + 1}</span>
              <strong>{stage.label}</strong>
              <em>{stage.hint}</em>
            </li>
          ))}
        </ol>
      </section>

      <section className="plc-kpis" aria-label="开品概况">
        {kpis.map((kpi) => (
          <button
            key={kpi.key}
            type="button"
            className={`plc-kpi plc-kpi--${kpi.tone} ${quick === kpi.key ? "is-active" : ""}`}
            onClick={() => setQuick(quick === kpi.key ? "all" : kpi.key)}
            aria-pressed={quick === kpi.key}
          >
            <span>{kpi.label}</span>
            <strong>{kpi.value}</strong>
            <em>{kpi.note}</em>
          </button>
        ))}
      </section>

      <section className="plc-toolbar">
        <label className="plc-search">
          <Search size={16} />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜产品名、编号、SKU、提交人…" />
          {keyword ? <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")}><X size={14} /></button> : null}
        </label>
        <select value={country} onChange={(event) => setCountry(event.target.value)} aria-label="目标国家">
          <option value="">全部国家</option>
          {countries.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="优先级">
          <option value="">全部优先级</option>
          {(Object.keys(PRIORITY_META) as ProductLaunchPriority[]).map((key) => <option key={key} value={key}>{PRIORITY_META[key].label}</option>)}
        </select>
        <label className="plc-toggle">
          <input type="checkbox" checked={showClosed} onChange={(event) => setShowClosed(event.target.checked)} />
          显示搁置/未立项/取消{closedCount ? `（${closedCount}）` : ""}
        </label>
        {quick !== "all" ? (
          <button type="button" className="plc-filter-chip" onClick={() => setQuick("all")}>
            筛选：{kpis.find((kpi) => kpi.key === quick)?.label}<X size={13} />
          </button>
        ) : null}
        <div className="plc-toolbar__right">
          <div className="plc-segment" role="tablist" aria-label="展示方式">
            <button type="button" role="tab" aria-selected={view === "board"} className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}><Grid2X2 size={15} />看板</button>
            <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "is-active" : ""} onClick={() => setView("list")}><List size={15} />列表</button>
          </div>
          <button type="button" className="plc-button plc-button--ghost" onClick={() => downloadCsv(listRows)} disabled={!listRows.length}><Download size={16} />导出</button>
        </div>
      </section>

      {error ? <div className="plc-alert plc-alert--error"><AlertTriangle size={16} />{error}<button type="button" onClick={() => void load()}>重试</button></div> : null}
      {notice ? <div className="plc-alert plc-alert--ok"><CheckCircle2 size={16} />{notice}</div> : null}

      {loading && !payload ? (
        <div className="plc-empty"><LoaderCircle size={22} className="plc-spin" />正在读取开品需求…</div>
      ) : !requests.length && !error ? (
        <div className="plc-empty plc-empty--first">
          <Lightbulb size={30} />
          <strong>还没有开品需求</strong>
          <span>{permissions.submit ? "看到好卖的竞品、平台趋势或客户想要的东西，点右上角“提交开品需求”。" : "运营提交后会显示在这里。"}</span>
          {permissions.submit ? <button type="button" className="plc-button plc-button--primary" onClick={() => setForm({ mode: "create", draft: EMPTY_DRAFT })}><Plus size={16} />提交第一个需求</button> : null}
        </div>
      ) : view === "board" ? (
        <section className={`plc-board ${visibleSideStages ? "has-side" : ""}`}>
          {[...MAIN_STAGES, ...(visibleSideStages ? [{ key: "side" as const, label: "其他结果", hint: "搁置、未立项、取消" }] : [])].map((column) => {
            const items = filtered.filter((request) => (column.key === "side" ? SIDE_STAGES.some((stage) => stage.key === request.stage) : request.stage === column.key));
            return (
              <div key={column.key} className={`plc-column plc-column--${column.key}`}>
                <header>
                  <strong>{column.label}</strong>
                  <span>{items.length}</span>
                </header>
                <div className="plc-column__body">
                  {items.length ? items.map((request) => (
                    <button key={request.id} type="button" className={`plc-card ${request.overdue ? "is-overdue" : ""} ${selectedId === request.id ? "is-selected" : ""}`} onClick={() => openDetail(request.id)}>
                      <span className="plc-card__top">
                        <PriorityTag priority={request.priority} />
                        {column.key === "side" ? <StagePill stage={request.stage} /> : null}
                        <em>{request.id.replace(/^NP-\d{4}/, "NP-")}</em>
                      </span>
                      <strong className="plc-card__title">{request.title}</strong>
                      <span className="plc-card__meta">{[request.targetCountries.join(" / "), request.platform, money(request.targetPrice, request.currency)].filter(Boolean).join(" · ")}</span>
                      <span className="plc-card__progress"><i style={{ width: `${request.checklistProgress.percent}%` }} /><b>清单 {request.checklistProgress.completed}/{request.checklistProgress.total}</b><em>备案 {request.filingProgress.approved}/{request.filingProgress.total}</em></span>
                      {request.stage !== "completed" && request.nextAction ? (
                        <span className={`plc-card__next ${request.overdue ? "is-late" : ""}`}>
                          <Clock3 size={13} />
                          <span>{request.nextAction}</span>
                          {request.nextDueDate ? <b>{shortDate(request.nextDueDate)}</b> : null}
                        </span>
                      ) : null}
                      {request.stage === "completed" ? (
                        <span className="plc-card__next is-done"><PackageCheck size={13} /><span>{request.linkedSku || "首批已完成"}</span><b>{shortDate(request.completedAt)}</b></span>
                      ) : null}
                      <span className="plc-card__foot">
                        <OwnerBadge owner={request.owner} />
                        <em>{request.closed ? `提交人 ${request.createdBy}` : `已停留 ${daysSince(request.stageEnteredAt)} 天`}</em>
                      </span>
                    </button>
                  )) : <p className="plc-column__empty">暂无</p>}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <section className="plc-table-wrap">
          <table className="plc-table">
            <thead>
              <tr>
                <th>编号</th><th>产品 / 方向</th><th>国家 · 平台</th><th>优先级</th><th>阶段</th><th>开品清单</th><th>负责人</th><th>下一步</th><th>截止</th><th>期望完成</th><th>提交人</th><th>更新</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((request) => (
                <tr key={request.id} className={request.overdue ? "is-overdue" : ""} onClick={() => openDetail(request.id)}>
                  <td className="plc-mono">{request.id}</td>
                  <td><strong>{request.title}</strong>{request.category ? <small>{request.category}</small> : null}</td>
                  <td>{[request.targetCountries.join(" / "), request.platform].filter(Boolean).join(" · ")}</td>
                  <td><PriorityTag priority={request.priority} /></td>
                  <td><StagePill stage={request.stage} /></td>
                  <td>{request.checklistProgress.completed}/{request.checklistProgress.total} · 备案 {request.filingProgress.approved}/{request.filingProgress.total}</td>
                  <td><OwnerBadge owner={request.owner} /></td>
                  <td className="plc-table__next">{request.stage === "completed" ? (request.linkedSku || "首批已完成") : (request.nextAction || "—")}</td>
                  <td className={request.overdue ? "plc-late" : ""}>{shortDate(request.nextDueDate) || "—"}</td>
                  <td>{shortDate(request.expectedLaunchDate) || "—"}</td>
                  <td>{request.createdBy}</td>
                  <td>{dateTime(request.updatedAt)}</td>
                </tr>
              ))}
              {!listRows.length ? <tr><td colSpan={12} className="plc-table__empty">没有符合条件的需求</td></tr> : null}
            </tbody>
          </table>
        </section>
      )}

      {selected ? (
        <ProductLaunchDetail
          request={selected}
          meta={meta}
          canManage={permissions.manage}
          canSubmit={permissions.submit}
          userId={userId}
          onClose={() => setSelectedId("")}
          onEdit={() => setForm({ mode: "edit", id: selected.id, draft: draftFrom(selected) })}
          onUpdated={(next, message) => { replaceRequest(next); setNotice(message); }}
        />
      ) : null}

      {form ? (
        <ProductLaunchForm
          mode={form.mode}
          initial={form.draft}
          meta={meta}
          countries={countries}
          existing={requests.filter((request) => request.id !== form.id)}
          onOpenExisting={(id) => { setForm(null); setSelectedId(id); }}
          onClose={() => setForm(null)}
          onSubmit={async (draft) => {
            const result = form.mode === "edit" && form.id
              ? await updateProductLaunchRequest(form.id, inputFrom(draft))
              : await createProductLaunchRequest(inputFrom(draft));
            replaceRequest(result.request);
            setForm(null);
            setSelectedId(result.request.id);
            setNotice(form.mode === "edit" ? "需求已更新" : `已提交 ${result.request.id}，产品负责人会尽快评审`);
          }}
        />
      ) : null}
    </div>
  );
}

function ProductLaunchDetail({ request, meta, canManage, canSubmit, userId, onClose, onEdit, onUpdated }: {
  request: ProductLaunchRequest;
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  canSubmit: boolean;
  userId: string;
  onClose: () => void;
  onEdit: () => void;
  onUpdated: (request: ProductLaunchRequest, message: string) => void;
}) {
  const isRequester = Boolean(userId) && request.createdById === userId;
  const canEdit = canManage || (canSubmit && isRequester && ["submitted", "on_hold"].includes(request.stage));
  const canWithdraw = !canManage && isRequester && request.stage === "submitted";
  const [stage, setStage] = React.useState<ProductLaunchStageKey>(request.stage);
  const [ownerId, setOwnerId] = React.useState(request.owner?.id || "");
  const [nextAction, setNextAction] = React.useState(request.nextAction || "");
  const [nextDueDate, setNextDueDate] = React.useState(request.nextDueDate || "");
  const [linkedSku, setLinkedSku] = React.useState(request.linkedSku || "");
  const [note, setNote] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setStage(request.stage);
    setOwnerId(request.owner?.id || "");
    setNextAction(request.nextAction || "");
    setNextDueDate(request.nextDueDate || "");
    setLinkedSku(request.linkedSku || "");
    setNote("");
    setError("");
  }, [request.id, request.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const owners = meta?.owners || [];
  const suggestedNext = nextMainStage(request.stage);
  const sideStage = SIDE_STAGES.find((item) => item.key === request.stage);
  const currentIndex = MAIN_STAGES.findIndex((item) => item.key === request.stage);

  async function run(label: string, action: () => Promise<{ request: ProductLaunchRequest }>, message: string) {
    setBusy(label);
    setError("");
    try {
      const result = await action();
      onUpdated(result.request, message);
      if (label === "comment") setComment("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  function saveProgress(targetStage = stage) {
    const owner = ownerId ? (owners.find((item) => item.id === ownerId) || { id: ownerId, name: request.owner?.name || ownerId }) : null;
    const stageChanged = targetStage !== request.stage;
    // Moving to a new stage: an untouched "next step" belongs to the old stage, so replace it.
    const untouchedAction = nextAction === (request.nextAction || "");
    const untouchedDue = nextDueDate === (request.nextDueDate || "");
    const stageHint = MAIN_STAGES.find((item) => item.key === targetStage)?.hint || "";
    void run("progress", () => progressProductLaunchRequest(request.id, {
      stage: targetStage,
      note,
      owner,
      nextAction: stageChanged && untouchedAction ? (targetStage === "completed" ? "" : stageHint) : nextAction,
      nextDueDate: stageChanged && untouchedDue ? "" : nextDueDate,
      linkedSku,
    }), stageChanged ? `已推进到「${STAGE_LABEL[targetStage]}」` : "进度已保存");
  }

  return (
    <div className="plc-drawer-backdrop" onClick={onClose}>
      <aside className="plc-drawer" role="dialog" aria-modal="true" aria-label={`开品需求 ${request.id}`} onClick={(event) => event.stopPropagation()}>
        <header className="plc-drawer__head">
          <div>
            <p className="plc-mono">{request.id} · {request.createdBy} 提交于 {dateTime(request.createdAt)}</p>
            <h3>{request.title}</h3>
            <div className="plc-drawer__tags">
              <StagePill stage={request.stage} />
              <PriorityTag priority={request.priority} />
              {request.overdue ? <span className="plc-late-tag"><AlertTriangle size={13} />已逾期</span> : null}
            </div>
          </div>
          <div className="plc-drawer__head-actions">
            {canEdit ? <button type="button" className="plc-button plc-button--ghost" onClick={onEdit}><Pencil size={15} />修改</button> : null}
            <button type="button" className="plc-icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
          </div>
        </header>

        <div className="plc-drawer__body">
          <ol className={`plc-stepper ${sideStage ? "is-paused" : ""}`}>
            {MAIN_STAGES.map((item, index) => {
              const reached = request.stageHistory?.[item.key];
              const state = sideStage ? (reached ? "done" : "todo") : index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
              return (
                <li key={item.key} className={`is-${state}`}>
                  <span>{state === "done" ? <CheckCircle2 size={14} /> : index + 1}</span>
                  <strong>{item.label}</strong>
                  <em>{reached ? shortDate(reached) : ""}</em>
                </li>
              );
            })}
          </ol>
          {sideStage ? (
            <div className={`plc-side-banner plc-side-banner--${request.stage}`}>
              <strong>{sideStage.label}</strong>
              <span>{request.stage === "rejected" ? (request.rejectReason || "未填写原因") : [...request.timeline].reverse().find((item) => item.toStage === request.stage)?.note || "—"}</span>
            </div>
          ) : null}

          <section className="plc-section">
            <h4>需求信息</h4>
            <dl className="plc-facts">
              <div><dt>目标国家</dt><dd>{request.targetCountries.join(" / ")}</dd></div>
              <div><dt>销售平台</dt><dd>{request.platform || "—"}</dd></div>
              <div><dt>品类</dt><dd>{request.category || "—"}</dd></div>
              <div><dt>需求来源</dt><dd>{request.source}</dd></div>
              <div><dt>目标售价</dt><dd>{money(request.targetPrice, request.currency) || "—"}</dd></div>
              <div><dt>目标成本</dt><dd>{money(request.targetCost, request.currency) || "—"}</dd></div>
              <div><dt>预计月销</dt><dd>{request.expectedMonthlySales ?? "—"}</dd></div>
              <div><dt>意向首批</dt><dd>{request.firstOrderQty ?? "—"}</dd></div>
              <div><dt>期望完成</dt><dd>{request.expectedLaunchDate || "—"}</dd></div>
              <div><dt>负责人</dt><dd>{request.owner?.name || "待指派"}</dd></div>
            </dl>
            <div className="plc-text-block"><span>为什么要开这个品</span><p>{request.reason}</p></div>
            {request.sellingPoints ? <div className="plc-text-block"><span>规格 / 卖点要求</span><p>{request.sellingPoints}</p></div> : null}
            {request.competitorLinks?.length ? (
              <div className="plc-text-block">
                <span>竞品链接</span>
                <ul className="plc-links">
                  {request.competitorLinks.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} />{link}</a></li>)}
                </ul>
              </div>
            ) : null}
            {request.linkedSku ? (
              <a className="plc-sku-link" href={`#products?${new URLSearchParams({ sku: request.linkedSku, tab: "base" }).toString()}`}>
                <Rocket size={15} />已关联产品库 SKU：<b>{request.linkedSku}</b><ChevronRight size={15} />
              </a>
            ) : null}
          </section>

          <LaunchChecklistSection
            request={request}
            meta={meta}
            canManage={canManage}
            busy={busy}
            onAssign={(input) => run("factory-assign", () => assignProductLaunchFactory(request.id, input), "已向委外工厂派发打样与报价任务")}
            onSync={(assignmentId) => run(`factory-sync-${assignmentId}`, () => syncProductLaunchFactoryAssignment(request.id, assignmentId), "委外工厂进度已同步")}
            onSave={(itemKey, input) => run(`checklist-${itemKey}`, () => updateProductLaunchChecklist(request.id, itemKey, input), "开品清单已更新")}
          />

          <CountryFilingSection
            filings={request.countryFilings}
            meta={meta}
            canManage={canManage}
            busy={busy}
            onSave={(countryKey, input) => run(`filing-${countryKey}`, () => updateProductLaunchFiling(request.id, countryKey, input), "国家备案已更新")}
          />

          <PilotProductionSection
            request={request}
            canManage={canManage}
            busy={busy}
            onSave={(input) => run("pilot", () => updateProductLaunchPilot(request.id, input), "样品确认与首批生产已更新")}
          />

          {canManage ? (
            <section className="plc-section plc-section--manage">
              <h4>推进进度</h4>
              {suggestedNext && !sideStage ? (
                <button type="button" className="plc-next-step" disabled={Boolean(busy)} onClick={() => saveProgress(suggestedNext)}>
                  <span>下一步</span>
                  <strong>推进到「{STAGE_LABEL[suggestedNext]}」</strong>
                  <ChevronRight size={18} />
                </button>
              ) : null}
              <div className="plc-form-grid">
                <label>
                  <span>阶段</span>
                  <select value={stage} onChange={(event) => setStage(event.target.value as ProductLaunchStageKey)}>
                    <optgroup label="主流程">{MAIN_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>
                    <optgroup label="其他">{SIDE_STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>
                  </select>
                </label>
                <label>
                  <span>负责人</span>
                  <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                    <option value="">待指派</option>
                    {owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                    {request.owner?.id && !owners.some((owner) => owner.id === request.owner?.id) ? <option value={request.owner.id}>{request.owner.name}</option> : null}
                  </select>
                </label>
                <label className="plc-span-2">
                  <span>下一步要做什么</span>
                  <input value={nextAction} maxLength={200} onChange={(event) => setNextAction(event.target.value)} placeholder="例如：联系 3 家工厂报价打样" />
                </label>
                <label>
                  <span>下一步截止</span>
                  <input type="date" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} />
                </label>
                <label>
                  <span>关联 SKU（建品后填）</span>
                  <input value={linkedSku} maxLength={80} onChange={(event) => setLinkedSku(event.target.value)} placeholder="产品库里的 SKU" />
                </label>
                <label className="plc-span-2">
                  <span>{stage === "rejected" ? "未立项原因（必填）" : stage === "on_hold" ? "搁置原因（必填）" : stage === "cancelled" ? "取消原因（必填）" : "进度说明（选填，会记入时间线）"}</span>
                  <textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="例如：样品已确认，等待检测报告" />
                </label>
              </div>
              {stage === "completed" && !linkedSku ? <p className="plc-hint">建议填上产品库里的 SKU，方便从开品需求跳到最终产品。</p> : null}
              <div className="plc-actions">
                <button type="button" className="plc-button plc-button--primary" disabled={Boolean(busy)} onClick={() => saveProgress()}>
                  {busy === "progress" ? <LoaderCircle size={16} className="plc-spin" /> : <CheckCircle2 size={16} />}保存
                </button>
              </div>
            </section>
          ) : (
            <section className="plc-section plc-section--status">
              <h4>当前进度</h4>
              <p><b>{STAGE_LABEL[request.stage]}</b>{request.nextAction ? `：${request.nextAction}` : ""}{request.nextDueDate ? `（${request.nextDueDate} 前）` : ""}</p>
              {canWithdraw ? (
                <button type="button" className="plc-button plc-button--ghost" disabled={Boolean(busy)} onClick={() => {
                  const reason = window.prompt("请填写取消原因。取消后产品负责人不会再继续评审：");
                  if (reason?.trim()) void run("withdraw", () => progressProductLaunchRequest(request.id, { stage: "cancelled", note: reason.trim() }), "需求已取消");
                }}>取消需求</button>
              ) : null}
            </section>
          )}

          {error ? <div className="plc-alert plc-alert--error"><AlertTriangle size={16} />{error}</div> : null}

          <section className="plc-section">
            <h4>进度记录</h4>
            <div className="plc-comment">
              <textarea value={comment} rows={2} maxLength={1000} onChange={(event) => setComment(event.target.value)} placeholder="补充信息、提问或催一下进度…" />
              <button type="button" className="plc-button plc-button--ghost" disabled={!comment.trim() || Boolean(busy)} onClick={() => void run("comment", () => commentProductLaunchRequest(request.id, comment.trim()), "留言已发送")}>
                {busy === "comment" ? <LoaderCircle size={15} className="plc-spin" /> : <MessageSquare size={15} />}留言
              </button>
            </div>
            <ol className="plc-timeline">
              {[...request.timeline].reverse().map((item) => (
                <li key={item.id} className={`plc-timeline__item plc-timeline__item--${item.type}`}>
                  <i />
                  <div>
                    <p><strong>{item.actor}</strong>{item.label}<time>{dateTime(item.createdAt)}</time></p>
                    {item.note ? <blockquote>{item.note}</blockquote> : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}

type ChecklistUpdate = Partial<Pick<ProductLaunchChecklistItem, "status" | "owner" | "dueDate" | "note">>;
type FilingUpdate = Partial<Pick<ProductLaunchCountryFiling, "status" | "authority" | "requirement" | "filingNo" | "owner" | "dueDate" | "submittedAt" | "approvedAt" | "expiresAt" | "note">>;

function ProgressMeter({ value, label }: { value: number; label: string }) {
  return (
    <div className="plc-workflow-meter" aria-label={`${label} ${value}%`}>
      <span><i style={{ width: `${value}%` }} /></span><b>{label}</b><em>{value}%</em>
    </div>
  );
}

function LaunchChecklistSection({ request, meta, canManage, busy, onSave, onAssign, onSync }: {
  request: ProductLaunchRequest;
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  busy: string;
  onSave: (itemKey: string, input: ChecklistUpdate) => Promise<void>;
  onAssign: (input: { organizationCode: string; checklistKeys: string[]; dueDate?: string; sampleSubject?: "formula" | "raw_material" | "packaging_box" | "packaging_bottle"; requirements?: string; sampleGoal?: string; evaluationCriteria?: string }) => Promise<void>;
  onSync: (assignmentId: string) => Promise<void>;
}) {
  const groups = Array.from(new Map(request.checklist.map((item) => [item.group, item.groupLabel])).entries());
  return (
    <section className="plc-section plc-section--workflow">
      <div className="plc-section-title">
        <div><ClipboardCheck size={18} /><div><h4>开品清单</h4><p>每项都有负责人、截止日期和完成依据</p></div></div>
        <strong>{request.checklistProgress.completed}/{request.checklistProgress.total}</strong>
      </div>
      <ProgressMeter value={request.checklistProgress.percent} label="必做项完成" />
      <FactoryCollaborationPanel request={request} meta={meta} canManage={canManage} busy={busy} onAssign={onAssign} onSync={onSync} />
      <div className="plc-checklist-groups">
        {groups.map(([group, groupLabel]) => (
          <div className="plc-checklist-group" key={group}>
            <h5>{groupLabel}</h5>
            {request.checklist.filter((item) => item.group === group).map((item) => (
              <ChecklistItemEditor key={item.key} item={item} meta={meta} canManage={canManage} saving={busy === `checklist-${item.key}`} onSave={(input) => onSave(item.key, input)} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const FACTORY_TASK_KEYS = ["material_test", "formula_development", "sample_test_report", "factory_quote"];
const FACTORY_ASSIGNMENT_LABELS: Record<ProductLaunchFactoryAssignment["status"], string> = {
  assigned: "已派发",
  accepted: "工厂已接单",
  in_progress: "打样进行中",
  sample_submitted: "样品待评审",
  sample_approved: "最终样已确认",
  quote_submitted: "报价待确认",
  completed: "报价已确认",
  blocked: "有阻塞",
  rejected: "已拒绝",
  cancelled: "已取消",
};
const FACTORY_PERMISSION_LABELS: Record<string, string> = {
  "sampling.task.view": "查看打样任务",
  "sampling.task.handle": "接单和更新进度",
  "sampling.artifact.submit": "提交样品与报告",
  "sampling.quote.submit": "提交定版报价",
};

function FactoryCollaborationPanel({ request, meta, canManage, busy, onAssign, onSync }: {
  request: ProductLaunchRequest;
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  busy: string;
  onAssign: (input: { organizationCode: string; checklistKeys: string[]; dueDate?: string; sampleSubject?: "formula" | "raw_material" | "packaging_box" | "packaging_bottle"; requirements?: string; sampleGoal?: string; evaluationCriteria?: string }) => Promise<void>;
  onSync: (assignmentId: string) => Promise<void>;
}) {
  const collaboration = meta?.factoryCollaboration;
  const factories = collaboration?.factories || [];
  const readyFactories = factories.filter((factory) => factory.ready);
  const [organizationCode, setOrganizationCode] = React.useState(readyFactories[0]?.code || "");
  const [dueDate, setDueDate] = React.useState(request.nextDueDate || request.expectedLaunchDate || "");
  const [sampleSubject, setSampleSubject] = React.useState<"formula" | "raw_material" | "packaging_box" | "packaging_bottle">(request.factoryAssignments?.[0]?.sampleSubject || "formula");
  const [requirements, setRequirements] = React.useState([request.sellingPoints, request.reason].filter(Boolean).join("\n"));
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>(FACTORY_TASK_KEYS);

  React.useEffect(() => {
    setOrganizationCode((current) => readyFactories.some((factory) => factory.code === current) ? current : (readyFactories[0]?.code || ""));
  }, [readyFactories.map((factory) => factory.code).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    setDueDate(request.nextDueDate || request.expectedLaunchDate || "");
    setRequirements([request.sellingPoints, request.reason].filter(Boolean).join("\n"));
  }, [request.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const factoryItems = request.checklist.filter((item) => FACTORY_TASK_KEYS.includes(item.key));
  const toggleTask = (key: string) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  return (
    <div className="plc-factory-collaboration">
      <header>
        <div><Factory size={18} /><span><b>委外工厂协同</b><small>运营派单，工厂在协同伙伴端接单、送样、提交报告和最终报价</small></span></div>
        <a href={["packaging_box", "packaging_bottle"].includes(sampleSubject) ? "#packaging-sampling-collaboration" : "#material-sampling-collaboration"}><FlaskConical size={14} />进入打样工作台</a>
      </header>

      {request.factoryAssignments?.length ? (
        <div className="plc-factory-assignments">
          {request.factoryAssignments.map((assignment) => (
            <article key={assignment.id} className={`is-${assignment.status}`}>
              <div className="plc-factory-assignment-head">
                <span><Factory size={16} /><strong>{assignment.organizationName}</strong><em>{assignment.documentNo}</em></span>
                <b>{FACTORY_ASSIGNMENT_LABELS[assignment.status] || assignment.status}</b>
              </div>
              <div className="plc-factory-assignment-progress">
                <span><FlaskConical size={14} />{assignment.sample.roundCount ? `${assignment.sample.roundCount} 轮样品` : "等待工厂送样"}</span>
                <span>{assignment.sample.approvedVersion ? `R${assignment.sample.approvedVersion} 已定版${assignment.sample.approvedVariantCode ? ` · ${assignment.sample.approvedVariantCode}` : ""}` : assignment.sample.pendingReviewCount ? `${assignment.sample.pendingReviewCount} 轮待评审` : "最终样未确认"}</span>
                <span><BadgeDollarSign size={14} />{assignment.quote.amount !== null ? `${assignment.quote.currency} ${assignment.quote.amount.toLocaleString("zh-CN")} · ${assignment.quote.status === "awarded" ? "已确认" : "待确认"}` : assignment.quoteRequired ? "等待定版报价" : "无需报价"}</span>
              </div>
              <footer>
                <span>{assignment.dueDate ? `截止 ${assignment.dueDate}` : "未设截止"} · 最近同步 {dateTime(assignment.lastSyncedAt)}</span>
                {canManage ? <button type="button" disabled={Boolean(busy)} onClick={() => void onSync(assignment.id)}>{busy === `factory-sync-${assignment.id}` ? <LoaderCircle size={14} className="plc-spin" /> : <RefreshCw size={14} />}刷新进度</button> : null}
              </footer>
            </article>
          ))}
        </div>
      ) : <p className="plc-factory-empty">还没有派发委外打样任务，工厂清单目前只能手工维护。</p>}

      {canManage && !request.closed ? (
        <div className="plc-factory-dispatch">
          {!collaboration?.enabled ? <div className="plc-factory-warning"><AlertTriangle size={15} />{collaboration?.message || "协同服务暂不可用"}</div> : null}
          {factories.some((factory) => !factory.ready) ? (
            <div className="plc-factory-capability-list">
              {factories.filter((factory) => !factory.ready).map((factory) => <span key={factory.code}><b>{factory.name}</b>暂不可派：{factory.missingPermissions.map((permission) => FACTORY_PERMISSION_LABELS[permission] || permission).join("、")}</span>)}
            </div>
          ) : null}
          <div className="plc-factory-dispatch-grid">
            <label><span>协同委外工厂</span><select value={organizationCode} onChange={(event) => setOrganizationCode(event.target.value)}><option value="">请选择</option>{factories.map((factory) => <option key={factory.code} value={factory.code} disabled={!factory.ready}>{factory.name}{factory.ready ? "" : "（权限未开全）"}</option>)}</select></label>
            <label><span>打样对象</span><select value={sampleSubject} onChange={(event) => setSampleSubject(event.target.value as typeof sampleSubject)}><option value="formula">配方 / 料体</option><option value="raw_material">原料</option><option value="packaging_box">包装盒</option><option value="packaging_bottle">包装瓶 / 容器</option></select></label>
            <label><span>要求完成日期</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          <div className="plc-factory-task-picker">
            <span>交给工厂处理</span>
            {factoryItems.map((item) => <label key={item.key} className={selectedKeys.includes(item.key) ? "is-checked" : ""}><input type="checkbox" checked={selectedKeys.includes(item.key)} onChange={() => toggleTask(item.key)} />{item.label}</label>)}
          </div>
          <label className="plc-factory-requirements"><span>工厂可见的打样 / 测试 / 报价要求</span><textarea rows={3} maxLength={5000} value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="写明样品规格、测试标准、需回传的报告和报价口径" /></label>
          <button type="button" className="plc-button plc-button--primary" disabled={!organizationCode || !selectedKeys.length || Boolean(busy)} onClick={() => void onAssign({ organizationCode, checklistKeys: selectedKeys, dueDate, sampleSubject, requirements, sampleGoal: `完成 ${request.title} 的打样定版`, evaluationCriteria: "原料、配方、样品测试结果满足需求并具备量产可行性" })}>{busy === "factory-assign" ? <LoaderCircle size={15} className="plc-spin" /> : <Factory size={15} />}派发打样与报价</button>
        </div>
      ) : null}
    </div>
  );
}

function ChecklistItemEditor({ item, meta, canManage, saving, onSave }: {
  item: ProductLaunchChecklistItem;
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  saving: boolean;
  onSave: (input: ChecklistUpdate) => Promise<void>;
}) {
  const [status, setStatus] = React.useState(item.status);
  const [ownerId, setOwnerId] = React.useState(item.owner?.id || "");
  const [dueDate, setDueDate] = React.useState(item.dueDate || "");
  const [note, setNote] = React.useState(item.note || "");
  React.useEffect(() => {
    setStatus(item.status);
    setOwnerId(item.owner?.id || "");
    setDueDate(item.dueDate || "");
    setNote(item.note || "");
  }, [item.status, item.owner?.id, item.dueDate, item.note]);
  const statuses = meta?.checklistStatuses || [];
  const label = statuses.find((entry) => entry.key === item.status)?.label || item.status;
  if (!canManage) {
    return (
      <div className="plc-check-row plc-check-row--readonly">
        <span className={`plc-work-status plc-work-status--${item.status}`}>{label}</span>
        <strong>{item.label}</strong>
        <em>{item.owner?.name || "待指派"}{item.dueDate ? ` · ${item.dueDate}` : ""}</em>
        {item.note ? <p>{item.note}</p> : null}
      </div>
    );
  }
  const owner = ownerId ? (meta?.owners.find((entry) => entry.id === ownerId) || { id: ownerId, name: item.owner?.name || ownerId }) : null;
  return (
    <div className="plc-check-row">
      <strong>{item.label}{item.required ? <b>*</b> : null}</strong>
      <select value={status} onChange={(event) => setStatus(event.target.value as ProductLaunchChecklistItem["status"])} aria-label={`${item.label}状态`}>
        {statuses.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
      <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} aria-label={`${item.label}负责人`}>
        <option value="">待指派</option>
        {(meta?.owners || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        {item.owner?.id && !meta?.owners.some((entry) => entry.id === item.owner?.id) ? <option value={item.owner.id}>{item.owner.name}</option> : null}
      </select>
      <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label={`${item.label}截止日期`} />
      <input value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder={status === "blocked" || status === "not_required" ? "请填写原因" : "备注 / 完成依据"} />
      <button type="button" className="plc-mini-save" disabled={saving} onClick={() => void onSave({ status, owner, dueDate, note })}>
        {saving ? <LoaderCircle size={14} className="plc-spin" /> : "保存"}
      </button>
    </div>
  );
}

function CountryFilingSection({ filings, meta, canManage, busy, onSave }: {
  filings: ProductLaunchCountryFiling[];
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  busy: string;
  onSave: (countryKey: string, input: FilingUpdate) => Promise<void>;
}) {
  const approved = filings.filter((item) => ["approved", "not_required"].includes(item.status)).length;
  const percent = filings.length ? Math.round((approved / filings.length) * 100) : 100;
  return (
    <section className="plc-section plc-section--workflow">
      <div className="plc-section-title">
        <div><FileBadgeIcon /><div><h4>多国备案</h4><p>按国家拆分，EAC、BPOM 等进度互不混用</p></div></div>
        <strong>{approved}/{filings.length}</strong>
      </div>
      <ProgressMeter value={percent} label="国家准入完成" />
      <div className="plc-filing-grid">
        {filings.map((filing) => <FilingEditor key={filing.countryKey} filing={filing} meta={meta} canManage={canManage} saving={busy === `filing-${filing.countryKey}`} onSave={(input) => onSave(filing.countryKey, input)} />)}
      </div>
    </section>
  );
}

function FileBadgeIcon() {
  return <span className="plc-file-badge">证</span>;
}

function FilingEditor({ filing, meta, canManage, saving, onSave }: {
  filing: ProductLaunchCountryFiling;
  meta: ProductLaunchMeta | null;
  canManage: boolean;
  saving: boolean;
  onSave: (input: FilingUpdate) => Promise<void>;
}) {
  const [status, setStatus] = React.useState(filing.status);
  const [filingNo, setFilingNo] = React.useState(filing.filingNo || "");
  const [ownerId, setOwnerId] = React.useState(filing.owner?.id || "");
  const [dueDate, setDueDate] = React.useState(filing.dueDate || "");
  const [submittedAt, setSubmittedAt] = React.useState(filing.submittedAt || "");
  const [approvedAt, setApprovedAt] = React.useState(filing.approvedAt || "");
  const [note, setNote] = React.useState(filing.note || "");
  React.useEffect(() => {
    setStatus(filing.status);
    setFilingNo(filing.filingNo || "");
    setOwnerId(filing.owner?.id || "");
    setDueDate(filing.dueDate || "");
    setSubmittedAt(filing.submittedAt || "");
    setApprovedAt(filing.approvedAt || "");
    setNote(filing.note || "");
  }, [filing.status, filing.filingNo, filing.owner?.id, filing.dueDate, filing.submittedAt, filing.approvedAt, filing.note]);
  const statuses = meta?.filingStatuses || [];
  const label = statuses.find((entry) => entry.key === filing.status)?.label || filing.status;
  if (!canManage) {
    return (
      <article className="plc-filing-card">
        <header><div><strong>{filing.country}</strong><span>{filing.authority}</span></div><span className={`plc-work-status plc-work-status--${filing.status}`}>{label}</span></header>
        <p>{filing.requirement}</p>
        <dl><div><dt>备案号</dt><dd>{filing.filingNo || "—"}</dd></div><div><dt>负责人</dt><dd>{filing.owner?.name || "待指派"}</dd></div><div><dt>递交</dt><dd>{filing.submittedAt || "—"}</dd></div><div><dt>获批</dt><dd>{filing.approvedAt || "—"}</dd></div></dl>
        {filing.note ? <blockquote>{filing.note}</blockquote> : null}
      </article>
    );
  }
  const owner = ownerId ? (meta?.owners.find((entry) => entry.id === ownerId) || { id: ownerId, name: filing.owner?.name || ownerId }) : null;
  return (
    <article className="plc-filing-card plc-filing-card--edit">
      <header><div><strong>{filing.country}</strong><span>{filing.authority}</span></div><select value={status} onChange={(event) => setStatus(event.target.value as ProductLaunchCountryFiling["status"])}>{statuses.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select></header>
      <p>{filing.requirement}</p>
      <div className="plc-filing-fields">
        <label><span>备案号</span><input value={filingNo} onChange={(event) => setFilingNo(event.target.value)} placeholder="获批后填写" /></label>
        <label><span>负责人</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">待指派</option>{(meta?.owners || []).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label><span>截止</span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
        <label><span>递交</span><input type="date" value={submittedAt} onChange={(event) => setSubmittedAt(event.target.value)} /></label>
        <label><span>获批</span><input type="date" value={approvedAt} onChange={(event) => setApprovedAt(event.target.value)} /></label>
        <label className="plc-filing-note"><span>备注 / 阻塞依据</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <button type="button" className="plc-mini-save" disabled={saving} onClick={() => void onSave({ status, filingNo, owner, dueDate, submittedAt, approvedAt, note })}>{saving ? <LoaderCircle size={14} className="plc-spin" /> : "保存备案"}</button>
    </article>
  );
}

function PilotProductionSection({ request, canManage, busy, onSave }: {
  request: ProductLaunchRequest;
  canManage: boolean;
  busy: string;
  onSave: (input: { sampleConfirmed: boolean; approvedQty: number | string | null; producedQty: number | string | null; note: string }) => Promise<void>;
}) {
  const pilot = request.pilotProduction;
  const [sampleConfirmed, setSampleConfirmed] = React.useState(pilot.sampleConfirmed);
  const [approvedQty, setApprovedQty] = React.useState(pilot.approvedQty === null ? "" : String(pilot.approvedQty));
  const [producedQty, setProducedQty] = React.useState(pilot.producedQty === null ? "" : String(pilot.producedQty));
  const [note, setNote] = React.useState(pilot.note || "");
  React.useEffect(() => {
    setSampleConfirmed(pilot.sampleConfirmed);
    setApprovedQty(pilot.approvedQty === null ? "" : String(pilot.approvedQty));
    setProducedQty(pilot.producedQty === null ? "" : String(pilot.producedQty));
    setNote(pilot.note || "");
  }, [pilot.sampleConfirmed, pilot.approvedQty, pilot.producedQty, pilot.note]);
  return (
    <section className="plc-section plc-section--pilot">
      <div className="plc-section-title">
        <div><PackageCheck size={18} /><div><h4>样品确认与首批生产</h4><p>样品确认后审批首批数量，生产验收完成才能结案</p></div></div>
        <span className={`plc-work-status ${pilot.completedAt ? "plc-work-status--completed" : "plc-work-status--in_progress"}`}>{pilot.completedAt ? "首批已完成" : "待完成"}</span>
      </div>
      {canManage ? (
        <div className="plc-pilot-editor">
          <label className="plc-pilot-confirm"><input type="checkbox" checked={sampleConfirmed} onChange={(event) => setSampleConfirmed(event.target.checked)} /><span><b>样品已确认</b><em>{pilot.sampleConfirmedAt ? dateTime(pilot.sampleConfirmedAt) : "确认后才可审批生产"}</em></span></label>
          <label><span>审批首批数量</span><input inputMode="numeric" value={approvedQty} onChange={(event) => setApprovedQty(event.target.value)} placeholder="件" /></label>
          <label><span>实际完成数量</span><input inputMode="numeric" value={producedQty} onChange={(event) => setProducedQty(event.target.value)} placeholder="件" /></label>
          <label className="plc-pilot-note"><span>生产备注</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="批次、入库或差异说明" /></label>
          <button type="button" className="plc-button plc-button--primary" disabled={busy === "pilot"} onClick={() => void onSave({ sampleConfirmed, approvedQty: approvedQty || null, producedQty: producedQty || null, note })}>{busy === "pilot" ? <LoaderCircle size={15} className="plc-spin" /> : <CheckCircle2 size={15} />}保存首批信息</button>
        </div>
      ) : (
        <dl className="plc-pilot-summary"><div><dt>样品确认</dt><dd>{pilot.sampleConfirmed ? "已确认" : "未确认"}</dd></div><div><dt>审批数量</dt><dd>{pilot.approvedQty ?? "—"}</dd></div><div><dt>实际完成</dt><dd>{pilot.producedQty ?? "—"}</dd></div><div><dt>完成时间</dt><dd>{dateTime(pilot.completedAt)}</dd></div></dl>
      )}
    </section>
  );
}

function ProductLaunchForm({ mode, initial, meta, countries, existing, onOpenExisting, onClose, onSubmit }: {
  mode: "create" | "edit";
  initial: FormDraft;
  meta: ProductLaunchMeta | null;
  countries: string[];
  existing: ProductLaunchRequest[];
  onOpenExisting: (id: string) => void;
  onClose: () => void;
  onSubmit: (draft: FormDraft) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState<FormDraft>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const sources = meta?.sources?.length ? meta.sources : FALLBACK_SOURCES;
  const platforms = meta?.platforms?.length ? meta.platforms : FALLBACK_PLATFORMS;
  const currencies = meta?.currencies?.length ? meta.currencies : FALLBACK_CURRENCIES;

  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const duplicates = React.useMemo(() => {
    if (draft.title.trim().length < 2) return [];
    return existing
      .filter((request) => request.stage !== "cancelled")
      .map((request) => ({ request, score: similarity(draft.title, request.title) + (draft.targetCountries.some((country) => request.targetCountries.includes(country)) ? 0.15 : 0) }))
      .filter((item) => item.score >= 0.6)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.request);
  }, [draft.title, draft.targetCountries, existing]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return setError("请填写产品名称或开品方向。");
    if (!draft.targetCountries.length) return setError("请至少选择一个目标国家。");
    if (!draft.source) return setError("请选择需求来源。");
    if (draft.reason.trim().length < 6) return setError("请写清楚为什么要开这个品（至少 6 个字）。");
    setSaving(true);
    setError("");
    try {
      await onSubmit(draft);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "提交失败");
      setSaving(false);
    }
  }

  return (
    <div className="plc-drawer-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <aside className="plc-drawer plc-drawer--form" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "修改开品需求" : "提交开品需求"} onClick={(event) => event.stopPropagation()}>
        <header className="plc-drawer__head">
          <div>
            <p className="plc-eyebrow">{mode === "edit" ? "EDIT REQUEST" : "NEW REQUEST"}</p>
            <h3>{mode === "edit" ? "修改开品需求" : "提交开品需求"}</h3>
            <p className="plc-form-intro">写清楚“卖给谁、为什么能卖、卖多少钱”，提交后会自动生成开品清单和各国备案任务。</p>
          </div>
          <button type="button" className="plc-icon-button" aria-label="关闭" onClick={onClose} disabled={saving}><X size={18} /></button>
        </header>
        <form className="plc-drawer__body" onSubmit={submit}>
          <fieldset className="plc-fieldset">
            <legend>1. 想开什么品</legend>
            <div className="plc-form-grid">
              <label className="plc-span-2">
                <span>产品名称 / 开品方向 <b>*</b></span>
                <input value={draft.title} maxLength={80} autoFocus onChange={(event) => set("title", event.target.value)} placeholder="例如：大容量便携冲牙器" />
              </label>
              {duplicates.length ? (
                <div className="plc-duplicates plc-span-2">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>可能已经有人提过：</strong>
                    {duplicates.map((request) => (
                      <button key={request.id} type="button" onClick={() => onOpenExisting(request.id)}>
                        {request.title}<em>{request.targetCountries.join(" / ")} · {STAGE_LABEL[request.stage]}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="plc-span-2 plc-country-field">
                <span>目标国家 <b>*</b> <em>可多选，每个国家分别跟踪备案</em></span>
                <div className="plc-country-picker">
                  {countries.map((item) => {
                    const checked = draft.targetCountries.includes(item);
                    return (
                      <label key={item} className={checked ? "is-checked" : ""}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => set("targetCountries", checked ? draft.targetCountries.filter((country) => country !== item) : [...draft.targetCountries, item])}
                        />
                        {item}
                      </label>
                    );
                  })}
                </div>
              </div>
              <label>
                <span>销售平台</span>
                <select value={draft.platform} onChange={(event) => set("platform", event.target.value)}>
                  <option value="">请选择</option>
                  {platforms.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>品类</span>
                <input value={draft.category} maxLength={40} onChange={(event) => set("category", event.target.value)} placeholder="例如：个护电器" />
              </label>
              <label>
                <span>优先级</span>
                <select value={draft.priority} onChange={(event) => set("priority", event.target.value as ProductLaunchPriority)}>
                  {(Object.keys(PRIORITY_META) as ProductLaunchPriority[]).map((key) => <option key={key} value={key}>{PRIORITY_META[key].label}</option>)}
                </select>
              </label>
            </div>
          </fieldset>

          <fieldset className="plc-fieldset">
            <legend>2. 为什么要开</legend>
            <div className="plc-form-grid">
              <label>
                <span>需求来源 <b>*</b></span>
                <select value={draft.source} onChange={(event) => set("source", event.target.value)}>
                  <option value="">请选择</option>
                  {sources.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>期望首批完成日期</span>
                <input type="date" value={draft.expectedLaunchDate} onChange={(event) => set("expectedLaunchDate", event.target.value)} />
              </label>
              <label className="plc-span-2">
                <span>需求说明 <b>*</b></span>
                <textarea value={draft.reason} rows={4} maxLength={2000} onChange={(event) => set("reason", event.target.value)} placeholder="例如：Ozon 同类月销 3000+，差评集中在续航短，我们做大电池款有机会。" />
              </label>
              <label className="plc-span-2">
                <span>规格 / 卖点要求</span>
                <textarea value={draft.sellingPoints} rows={2} maxLength={1000} onChange={(event) => set("sellingPoints", event.target.value)} placeholder="容量、颜色、包装、认证要求等" />
              </label>
              <label className="plc-span-2">
                <span>竞品链接（每行一个，最多 8 个）</span>
                <textarea value={draft.competitorLinks} rows={2} onChange={(event) => set("competitorLinks", event.target.value)} placeholder="https://www.ozon.ru/product/..." />
              </label>
            </div>
          </fieldset>

          <fieldset className="plc-fieldset">
            <legend>3. 生意目标（大概就行）</legend>
            <div className="plc-form-grid plc-form-grid--3">
              <label>
                <span>目标售价</span>
                <input inputMode="decimal" value={draft.targetPrice} onChange={(event) => set("targetPrice", event.target.value)} placeholder="0" />
              </label>
              <label>
                <span>目标成本</span>
                <input inputMode="decimal" value={draft.targetCost} onChange={(event) => set("targetCost", event.target.value)} placeholder="0" />
              </label>
              <label>
                <span>币种</span>
                <select value={draft.currency} onChange={(event) => set("currency", event.target.value)}>
                  {currencies.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <span>预计月销量</span>
                <input inputMode="numeric" value={draft.expectedMonthlySales} onChange={(event) => set("expectedMonthlySales", event.target.value)} placeholder="件/月" />
              </label>
              <label>
                <span>意向首批数量</span>
                <input inputMode="numeric" value={draft.firstOrderQty} onChange={(event) => set("firstOrderQty", event.target.value)} placeholder="件" />
              </label>
            </div>
          </fieldset>

          {error ? <div className="plc-alert plc-alert--error"><AlertTriangle size={16} />{error}</div> : null}
          <div className="plc-form-footer">
            <button type="button" className="plc-button plc-button--ghost" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="plc-button plc-button--primary" disabled={saving}>
              {saving ? <LoaderCircle size={16} className="plc-spin" /> : <CheckCircle2 size={16} />}{mode === "edit" ? "保存修改" : "提交需求"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

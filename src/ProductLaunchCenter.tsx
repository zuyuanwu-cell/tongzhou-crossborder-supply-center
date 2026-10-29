import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Grid2X2,
  Lightbulb,
  List,
  LoaderCircle,
  MessageSquare,
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
  ProductLaunchMeta,
  ProductLaunchPayload,
  ProductLaunchPriority,
  ProductLaunchRequest,
  ProductLaunchStageKey,
  commentProductLaunchRequest,
  createProductLaunchRequest,
  fetchProductLaunchMeta,
  fetchProductLaunchRequests,
  progressProductLaunchRequest,
  updateProductLaunchRequest,
} from "./api";
import "./product-launch.css";

type QuickFilter = "all" | "submitted" | "progress" | "launched_month" | "overdue" | "mine";
type ViewMode = "board" | "list";

const MAIN_STAGES: Array<{ key: ProductLaunchStageKey; label: string; hint: string }> = [
  { key: "submitted", label: "待评审", hint: "运营已提交，等产品评估" },
  { key: "approved", label: "已立项", hint: "确认要做，安排负责人" },
  { key: "sourcing", label: "寻源打样", hint: "找工厂、报价、打样确认" },
  { key: "certification", label: "资质备案", hint: "检测、认证、备案" },
  { key: "listing_prep", label: "上架准备", hint: "建品、素材、Listing、首单" },
  { key: "launched", label: "已上架", hint: "已在平台开卖" },
];
const SIDE_STAGES: Array<{ key: ProductLaunchStageKey; label: string }> = [
  { key: "on_hold", label: "暂缓" },
  { key: "rejected", label: "未通过" },
  { key: "cancelled", label: "已撤回" },
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
  country: string;
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
  country: "",
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
    country: request.country,
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
  const header = ["编号", "产品/方向", "品类", "目标国家", "平台", "需求来源", "优先级", "阶段", "负责人", "下一步", "截止日期", "期望上架", "目标售价", "币种", "目标成本", "预计月销", "首单数量", "关联SKU", "提交人", "提交时间", "最近更新", "需求说明"];
  const lines = rows.map((row) => [
    row.id, row.title, row.category, row.country, row.platform, row.source, PRIORITY_META[row.priority]?.label, STAGE_LABEL[row.stage] || row.stage,
    row.owner?.name || "", row.nextAction, row.nextDueDate, row.expectedLaunchDate, row.targetPrice ?? "", row.currency, row.targetCost ?? "",
    row.expectedMonthlySales ?? "", row.firstOrderQty ?? "", row.linkedSku, row.createdBy, dateTime(row.createdAt), dateTime(row.updatedAt), row.reason,
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
      if (country && request.country !== country) return false;
      if (priority && request.priority !== priority) return false;
      if (quick === "submitted" && request.stage !== "submitted") return false;
      if (quick === "progress" && !["approved", "sourcing", "certification", "listing_prep"].includes(request.stage)) return false;
      if (quick === "launched_month" && !(request.stage === "launched" && request.launchedAt.slice(0, 7) === month)) return false;
      if (quick === "overdue" && !request.overdue) return false;
      if (quick === "mine" && request.createdById !== userId && request.owner?.id !== userId) return false;
      if (!word) return true;
      return [request.id, request.title, request.category, request.country, request.platform, request.reason, request.linkedSku, request.createdBy, request.owner?.name]
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
  const countries = Array.from(new Set([...(meta?.countries?.length ? meta.countries : FALLBACK_COUNTRIES), ...requests.map((request) => request.country)].filter(Boolean)));

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
    { key: "progress", label: "推进中", value: summary?.inProgress ?? 0, note: "立项到上架准备", tone: "blue" },
    { key: "launched_month", label: "本月上架", value: summary?.launchedThisMonth ?? 0, note: `${Number(month.slice(5))} 月已开卖`, tone: "green" },
    { key: "overdue", label: "已逾期", value: summary?.overdue ?? 0, note: "超过截止或期望上架", tone: "red" },
    { key: "mine", label: "与我相关", value: summary?.mine ?? 0, note: "我提交或我负责", tone: "navy" },
  ];

  return (
    <div className="plc-page">
      <section className="plc-hero">
        <div className="plc-hero__copy">
          <p className="plc-eyebrow">PRODUCT LAUNCH</p>
          <h2>开品需求</h2>
          <p>运营把想开的品提上来，产品负责人评审立项，一路跟进到上架。每一步谁做的、卡在哪，都在这里。</p>
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
          显示暂缓/未通过{closedCount ? `（${closedCount}）` : ""}
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
          {[...MAIN_STAGES, ...(visibleSideStages ? [{ key: "side" as const, label: "暂缓 / 关闭", hint: "暂缓、未通过、已撤回" }] : [])].map((column) => {
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
                      <span className="plc-card__meta">{[request.country, request.platform, money(request.targetPrice, request.currency)].filter(Boolean).join(" · ")}</span>
                      {request.stage !== "launched" && request.nextAction ? (
                        <span className={`plc-card__next ${request.overdue ? "is-late" : ""}`}>
                          <Clock3 size={13} />
                          <span>{request.nextAction}</span>
                          {request.nextDueDate ? <b>{shortDate(request.nextDueDate)}</b> : null}
                        </span>
                      ) : null}
                      {request.stage === "launched" ? (
                        <span className="plc-card__next is-done"><Rocket size={13} /><span>{request.linkedSku || "已上架"}</span><b>{shortDate(request.launchedAt)}</b></span>
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
                <th>编号</th><th>产品 / 方向</th><th>国家 · 平台</th><th>优先级</th><th>阶段</th><th>负责人</th><th>下一步</th><th>截止</th><th>期望上架</th><th>提交人</th><th>更新</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((request) => (
                <tr key={request.id} className={request.overdue ? "is-overdue" : ""} onClick={() => openDetail(request.id)}>
                  <td className="plc-mono">{request.id}</td>
                  <td><strong>{request.title}</strong>{request.category ? <small>{request.category}</small> : null}</td>
                  <td>{[request.country, request.platform].filter(Boolean).join(" · ")}</td>
                  <td><PriorityTag priority={request.priority} /></td>
                  <td><StagePill stage={request.stage} /></td>
                  <td><OwnerBadge owner={request.owner} /></td>
                  <td className="plc-table__next">{request.stage === "launched" ? (request.linkedSku || "—") : (request.nextAction || "—")}</td>
                  <td className={request.overdue ? "plc-late" : ""}>{shortDate(request.nextDueDate) || "—"}</td>
                  <td>{shortDate(request.expectedLaunchDate) || "—"}</td>
                  <td>{request.createdBy}</td>
                  <td>{dateTime(request.updatedAt)}</td>
                </tr>
              ))}
              {!listRows.length ? <tr><td colSpan={11} className="plc-table__empty">没有符合条件的需求</td></tr> : null}
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
      nextAction: stageChanged && untouchedAction ? (targetStage === "launched" ? "" : stageHint) : nextAction,
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
              <div><dt>目标国家</dt><dd>{request.country}</dd></div>
              <div><dt>销售平台</dt><dd>{request.platform || "—"}</dd></div>
              <div><dt>品类</dt><dd>{request.category || "—"}</dd></div>
              <div><dt>需求来源</dt><dd>{request.source}</dd></div>
              <div><dt>目标售价</dt><dd>{money(request.targetPrice, request.currency) || "—"}</dd></div>
              <div><dt>目标成本</dt><dd>{money(request.targetCost, request.currency) || "—"}</dd></div>
              <div><dt>预计月销</dt><dd>{request.expectedMonthlySales ?? "—"}</dd></div>
              <div><dt>首单数量</dt><dd>{request.firstOrderQty ?? "—"}</dd></div>
              <div><dt>期望上架</dt><dd>{request.expectedLaunchDate || "—"}</dd></div>
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
                  <span>{stage === "rejected" ? "不通过原因（必填）" : stage === "on_hold" ? "暂缓原因（必填）" : "进度说明（选填，会记入时间线）"}</span>
                  <textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder="例如：样品已确认，等待检测报告" />
                </label>
              </div>
              {stage === "launched" && !linkedSku ? <p className="plc-hint">建议填上产品库里的 SKU，方便后续从需求直接跳到产品。</p> : null}
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
                  if (window.confirm("确定撤回这条开品需求吗？撤回后产品负责人不会再评审。")) void run("withdraw", () => progressProductLaunchRequest(request.id, { stage: "cancelled" }), "需求已撤回");
                }}>撤回需求</button>
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
      .map((request) => ({ request, score: similarity(draft.title, request.title) + (draft.country && request.country === draft.country ? 0.15 : 0) }))
      .filter((item) => item.score >= 0.6)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.request);
  }, [draft.title, draft.country, existing]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return setError("请填写产品名称或开品方向。");
    if (!draft.country) return setError("请选择目标国家。");
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
            <p className="plc-form-intro">写清楚“卖给谁、为什么能卖、卖多少钱”，产品负责人评审会更快。</p>
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
                        {request.title}<em>{request.country} · {STAGE_LABEL[request.stage]}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <label>
                <span>目标国家 <b>*</b></span>
                <select value={draft.country} onChange={(event) => set("country", event.target.value)}>
                  <option value="">请选择</option>
                  {countries.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
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
                <span>期望上架日期</span>
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
                <span>首单数量</span>
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

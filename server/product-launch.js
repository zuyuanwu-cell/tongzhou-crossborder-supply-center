import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { normalizedCountryKey } from "./performance-analytics.js";

// 开品需求 v2：每条需求自带开品清单，多国备案分别跟踪，最终落到首批完成/搁置/取消。
// 数据量小（几百到几千条），沿用仓库工单的 JSON 原子落盘方式。

export const PRODUCT_LAUNCH_STAGES = Object.freeze([
  Object.freeze({ key: "submitted", label: "待评审", main: true }),
  Object.freeze({ key: "approved", label: "已立项", main: true }),
  Object.freeze({ key: "factory_validation", label: "工厂验证", main: true }),
  Object.freeze({ key: "product_definition", label: "产品定版", main: true }),
  Object.freeze({ key: "packaging", label: "文案包装", main: true }),
  Object.freeze({ key: "filing", label: "多国备案", main: true }),
  Object.freeze({ key: "pilot_production", label: "首批生产", main: true }),
  Object.freeze({ key: "completed", label: "首批完成", main: true }),
  Object.freeze({ key: "on_hold", label: "搁置", main: false }),
  Object.freeze({ key: "rejected", label: "未立项", main: false }),
  Object.freeze({ key: "cancelled", label: "取消", main: false }),
]);

export const PRODUCT_LAUNCH_CHECKLIST = Object.freeze([
  Object.freeze({ key: "material_test", label: "原料测试", group: "factory", groupLabel: "委外工厂验证", required: true }),
  Object.freeze({ key: "formula_development", label: "配方开发", group: "factory", groupLabel: "委外工厂验证", required: true }),
  Object.freeze({ key: "sample_test_report", label: "样品与测试报告", group: "factory", groupLabel: "委外工厂验证", required: true }),
  Object.freeze({ key: "factory_quote", label: "工厂报价", group: "factory", groupLabel: "委外工厂验证", required: true }),
  Object.freeze({ key: "formula_sheet", label: "配方表", group: "product", groupLabel: "产品资料定版", required: true }),
  Object.freeze({ key: "ingredient_list", label: "成分信息", group: "product", groupLabel: "产品资料定版", required: true }),
  Object.freeze({ key: "product_copy", label: "产品文案", group: "packaging", groupLabel: "文案与包装", required: true }),
  Object.freeze({ key: "packaging_design", label: "包装设计", group: "packaging", groupLabel: "文案与包装", required: true }),
  Object.freeze({ key: "sample_confirmation", label: "样品确认", group: "production", groupLabel: "首批生产", required: true }),
  Object.freeze({ key: "pilot_quantity_approval", label: "首批数量审批", group: "production", groupLabel: "首批生产", required: true }),
  Object.freeze({ key: "pilot_production_complete", label: "首批生产完成", group: "production", groupLabel: "首批生产", required: true }),
]);

export const PRODUCT_LAUNCH_CHECKLIST_STATUSES = Object.freeze([
  Object.freeze({ key: "pending", label: "待处理" }),
  Object.freeze({ key: "in_progress", label: "进行中" }),
  Object.freeze({ key: "completed", label: "已完成" }),
  Object.freeze({ key: "blocked", label: "有阻塞" }),
  Object.freeze({ key: "not_required", label: "不适用" }),
]);

export const PRODUCT_LAUNCH_FILING_STATUSES = Object.freeze([
  Object.freeze({ key: "pending", label: "待准备" }),
  Object.freeze({ key: "preparing", label: "资料准备" }),
  Object.freeze({ key: "submitted", label: "已递交" }),
  Object.freeze({ key: "approved", label: "已获批" }),
  Object.freeze({ key: "blocked", label: "有阻塞" }),
  Object.freeze({ key: "not_required", label: "无需备案" }),
]);

export const PRODUCT_LAUNCH_SOURCES = Object.freeze(["竞品热卖", "平台趋势", "客户/渠道需求", "老品迭代", "供应商推荐", "其他"]);
export const PRODUCT_LAUNCH_PRIORITIES = Object.freeze([
  Object.freeze({ key: "urgent", label: "紧急" }),
  Object.freeze({ key: "high", label: "高" }),
  Object.freeze({ key: "normal", label: "中" }),
  Object.freeze({ key: "low", label: "低" }),
]);
export const PRODUCT_LAUNCH_PLATFORMS = Object.freeze(["Ozon", "Wildberries", "Yandex Market", "Shopee", "Lazada", "TikTok Shop", "Tokopedia", "线下/分销", "其他"]);
export const PRODUCT_LAUNCH_CURRENCIES = Object.freeze(["CNY", "USD", "RUB", "IDR", "MYR", "VND", "THB", "PHP"]);

const LEGACY_STAGE_ALIASES = Object.freeze({ sourcing: "factory_validation", certification: "filing", listing_prep: "pilot_production", launched: "completed" });
const STAGE_KEYS = new Set(PRODUCT_LAUNCH_STAGES.map((stage) => stage.key));
const PRIORITY_KEYS = new Set(PRODUCT_LAUNCH_PRIORITIES.map((item) => item.key));
const CHECKLIST_KEYS = new Set(PRODUCT_LAUNCH_CHECKLIST.map((item) => item.key));
const FACTORY_CHECKLIST_KEYS = new Set(PRODUCT_LAUNCH_CHECKLIST.filter((item) => item.group === "factory").map((item) => item.key));
const CHECKLIST_STATUS_KEYS = new Set(PRODUCT_LAUNCH_CHECKLIST_STATUSES.map((item) => item.key));
const FILING_STATUS_KEYS = new Set(PRODUCT_LAUNCH_FILING_STATUSES.map((item) => item.key));
const FACTORY_ASSIGNMENT_STATUS_KEYS = new Set(["assigned", "accepted", "in_progress", "sample_submitted", "sample_approved", "quote_submitted", "completed", "blocked", "rejected", "cancelled"]);
const CLOSED_STAGES = new Set(["completed", "on_hold", "rejected", "cancelled"]);
const NOTE_REQUIRED_STAGES = new Set(["rejected", "on_hold", "cancelled"]);
const REQUESTER_EDITABLE_STAGES = new Set(["submitted", "on_hold"]);
const IN_PROGRESS_STAGES = new Set(["approved", "factory_validation", "product_definition", "packaging", "filing", "pilot_production"]);
const MAX_LINKS = 8;
const MAX_COUNTRIES = 12;

const FILING_RULES = Object.freeze({
  RU: Object.freeze({ authority: "EAC", requirement: "EAC 合格认证/声明" }),
  ID: Object.freeze({ authority: "BPOM", requirement: "BPOM 产品注册" }),
  MY: Object.freeze({ authority: "NPRA", requirement: "NPRA 产品备案" }),
  VN: Object.freeze({ authority: "DAV", requirement: "越南 DAV 产品公布/备案" }),
  PH: Object.freeze({ authority: "FDA Philippines", requirement: "菲律宾 FDA 产品注册" }),
  TH: Object.freeze({ authority: "Thai FDA", requirement: "泰国 FDA 产品注册" }),
});

function text(value, max = 0) {
  const result = String(value ?? "").normalize("NFKC").trim();
  return max ? result.slice(0, max) : result;
}

function nowIso() {
  return new Date().toISOString();
}

// Production still runs on Node 16, where structuredClone is unavailable.
function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function today() {
  return nowIso().slice(0, 10);
}

function canonicalStage(key) {
  const value = text(key);
  return LEGACY_STAGE_ALIASES[value] || value || "submitted";
}

function stageLabel(key) {
  const canonical = canonicalStage(key);
  return PRODUCT_LAUNCH_STAGES.find((stage) => stage.key === canonical)?.label || canonical;
}

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });
}

function forbidden(message) {
  return Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

function actorOf(user) {
  return { id: text(user?.id), name: text(user?.displayName || user?.username || user?.id || "系统") };
}

function dateOnly(value, label) {
  const raw = text(value);
  if (!raw) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw invalid(`${label}格式不对，请选择日期。`);
  return raw;
}

function amount(value, label, { integer = false } = {}) {
  if (value === undefined || value === null || text(value) === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw invalid(`${label}需要填写不小于 0 的数字。`);
  if (number > 1e10) throw invalid(`${label}数字太大了。`);
  return integer ? Math.round(number) : Math.round(number * 100) / 100;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "是"].includes(text(value).toLowerCase());
}

function links(value) {
  const list = Array.isArray(value) ? value : text(value).split(/\s*[\n,，]\s*/);
  const result = [];
  for (const item of list) {
    const link = text(item, 600);
    if (!link) continue;
    if (!/^https?:\/\//i.test(link)) throw invalid("竞品链接需要以 http:// 或 https:// 开头。");
    if (!result.includes(link)) result.push(link);
  }
  if (result.length > MAX_LINKS) throw invalid(`竞品链接最多填写 ${MAX_LINKS} 个。`);
  return result;
}

function ownerFrom(input) {
  if (!input) return null;
  const id = text(input.id, 120);
  const name = text(input.name, 60);
  return id || name ? { id, name: name || id } : null;
}

function countriesFrom(value, fallback = []) {
  const input = Array.isArray(value) ? value : value ? [value] : fallback;
  const result = [];
  const seen = new Set();
  for (const item of input) {
    const country = text(item, 30);
    const key = normalizedCountryKey(country);
    if (!country || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(country);
  }
  if (result.length > MAX_COUNTRIES) throw invalid(`目标国家最多选择 ${MAX_COUNTRIES} 个。`);
  return result;
}

function filingRule(country) {
  const key = normalizedCountryKey(country);
  return FILING_RULES[key] || { authority: "按国家确认", requirement: "确认当地准入与备案要求" };
}

function defaultChecklist() {
  return PRODUCT_LAUNCH_CHECKLIST.map((definition) => ({
    key: definition.key,
    label: definition.label,
    group: definition.group,
    groupLabel: definition.groupLabel,
    required: definition.required,
    status: "pending",
    owner: null,
    dueDate: "",
    completedAt: "",
    note: "",
  }));
}

function normalizeChecklist(input) {
  const currentByKey = new Map((Array.isArray(input) ? input : []).map((item) => [text(item?.key), item]));
  return defaultChecklist().map((item) => {
    const current = currentByKey.get(item.key) || {};
    const status = CHECKLIST_STATUS_KEYS.has(text(current.status)) ? text(current.status) : "pending";
    return {
      ...item,
      status,
      owner: ownerFrom(current.owner),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(current.dueDate)) ? text(current.dueDate) : "",
      completedAt: status === "completed" ? text(current.completedAt) : "",
      note: text(current.note, 1000),
    };
  });
}

function filingsForCountries(countries, input) {
  const currentByKey = new Map((Array.isArray(input) ? input : []).map((item) => [normalizedCountryKey(item?.countryKey || item?.country), item]));
  return countries.map((country) => {
    const countryKey = normalizedCountryKey(country);
    const rule = filingRule(country);
    const current = currentByKey.get(countryKey) || {};
    const status = FILING_STATUS_KEYS.has(text(current.status)) ? text(current.status) : "pending";
    return {
      country,
      countryKey,
      authority: text(current.authority, 80) || rule.authority,
      requirement: text(current.requirement, 160) || rule.requirement,
      required: current.required === false ? false : true,
      status,
      filingNo: text(current.filingNo, 120),
      owner: ownerFrom(current.owner),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(current.dueDate)) ? text(current.dueDate) : "",
      submittedAt: /^\d{4}-\d{2}-\d{2}$/.test(text(current.submittedAt)) ? text(current.submittedAt) : "",
      approvedAt: /^\d{4}-\d{2}-\d{2}$/.test(text(current.approvedAt)) ? text(current.approvedAt) : "",
      expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(text(current.expiresAt)) ? text(current.expiresAt) : "",
      note: text(current.note, 1000),
    };
  });
}

function normalizePilotProduction(input = {}) {
  const approvedQtyValue = input.approvedQty;
  const approvedQty = approvedQtyValue === null || approvedQtyValue === undefined || text(approvedQtyValue) === "" ? null : Number(approvedQtyValue);
  const producedQtyValue = input.producedQty;
  const producedQty = producedQtyValue === null || producedQtyValue === undefined || text(producedQtyValue) === "" ? null : Number(producedQtyValue);
  return {
    sampleConfirmed: Boolean(input.sampleConfirmed),
    sampleConfirmedAt: text(input.sampleConfirmedAt),
    approvedQty: Number.isFinite(approvedQty) && approvedQty >= 0 ? Math.round(approvedQty) : null,
    approvedAt: text(input.approvedAt),
    producedQty: Number.isFinite(producedQty) && producedQty >= 0 ? Math.round(producedQty) : null,
    completedAt: text(input.completedAt),
    note: text(input.note, 1000),
  };
}

function factoryChecklistKeys(value) {
  const keys = Array.isArray(value) ? value.map((item) => text(item)) : [];
  const selected = [...new Set(keys.filter((key) => FACTORY_CHECKLIST_KEYS.has(key)))];
  return selected.length ? selected : [...FACTORY_CHECKLIST_KEYS];
}

function normalizeFactoryAssignment(input = {}) {
  const status = FACTORY_ASSIGNMENT_STATUS_KEYS.has(text(input.status)) ? text(input.status) : "assigned";
  const sample = input.sample && typeof input.sample === "object" ? input.sample : {};
  const quote = input.quote && typeof input.quote === "object" ? input.quote : {};
  return {
    id: text(input.id, 120),
    organizationCode: text(input.organizationCode, 64),
    organizationName: text(input.organizationName, 160),
    organizationType: text(input.organizationType, 80),
    checklistKeys: factoryChecklistKeys(input.checklistKeys),
    workItemId: text(input.workItemId, 120),
    documentNo: text(input.documentNo || input.coreRefId, 160),
    status,
    remoteStatus: text(input.remoteStatus, 60),
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(text(input.dueDate)) ? text(input.dueDate) : "",
    sampleCategory: ["inner_material", "packaging"].includes(text(input.sampleCategory)) ? text(input.sampleCategory) : "inner_material",
    sampleSubject: ["formula", "raw_material", "packaging_box", "packaging_bottle"].includes(text(input.sampleSubject)) ? text(input.sampleSubject) : "formula",
    quoteRequired: input.quoteRequired !== false,
    requirements: text(input.requirements, 5000),
    sample: {
      roundCount: Math.max(0, Number(sample.roundCount) || 0),
      pendingReviewCount: Math.max(0, Number(sample.pendingReviewCount) || 0),
      approvedArtifactId: text(sample.approvedArtifactId, 120),
      approvedVersion: Number(sample.approvedVersion) > 0 ? Number(sample.approvedVersion) : null,
      approvedVariantCode: text(sample.approvedVariantCode, 160),
      approvedSupplierMaterialCode: text(sample.approvedSupplierMaterialCode, 160),
      latestTitle: text(sample.latestTitle, 240),
      latestStatus: text(sample.latestStatus, 60),
    },
    quote: {
      count: Math.max(0, Number(quote.count) || 0),
      awardedQuoteId: text(quote.awardedQuoteId, 120),
      latestQuoteId: text(quote.latestQuoteId, 120),
      status: text(quote.status, 60),
      currency: text(quote.currency, 8).toUpperCase(),
      amount: quote.amount === null || quote.amount === undefined || quote.amount === "" ? null : (Number.isFinite(Number(quote.amount)) ? Number(quote.amount) : null),
      minimumOrderQuantity: quote.minimumOrderQuantity === null || quote.minimumOrderQuantity === undefined || quote.minimumOrderQuantity === "" ? null : (Number.isFinite(Number(quote.minimumOrderQuantity)) ? Number(quote.minimumOrderQuantity) : null),
      leadTimeDays: quote.leadTimeDays === null || quote.leadTimeDays === undefined || quote.leadTimeDays === "" ? null : (Number.isFinite(Number(quote.leadTimeDays)) ? Number(quote.leadTimeDays) : null),
      terms: text(quote.terms, 2000),
      sampleVariantCode: text(quote.sampleVariantCode, 160),
    },
    createdAt: text(input.createdAt),
    createdBy: text(input.createdBy, 160),
    createdById: text(input.createdById, 120),
    lastSyncedAt: text(input.lastSyncedAt),
  };
}

function normalizeStoredRecord(source) {
  const request = source && typeof source === "object" ? source : {};
  const targetCountries = countriesFrom(request.targetCountries, [request.country]);
  const stage = canonicalStage(request.stage);
  const stageHistory = { ...(request.stageHistory || {}) };
  if (request.stage && stage !== request.stage && request.stageHistory?.[request.stage] && !stageHistory[stage]) stageHistory[stage] = request.stageHistory[request.stage];
  return {
    ...request,
    schemaVersion: 2,
    country: targetCountries[0] || text(request.country),
    targetCountries,
    stage: STAGE_KEYS.has(stage) ? stage : "submitted",
    stageHistory,
    checklist: normalizeChecklist(request.checklist),
    factoryAssignments: (Array.isArray(request.factoryAssignments) ? request.factoryAssignments : []).map(normalizeFactoryAssignment).filter((item) => item.id && item.organizationCode),
    countryFilings: filingsForCountries(targetCountries, request.countryFilings),
    pilotProduction: normalizePilotProduction(request.pilotProduction),
    completedAt: text(request.completedAt || request.launchedAt),
    timeline: Array.isArray(request.timeline) ? request.timeline : [],
  };
}

// Fields that describe the idea itself (requester can edit while it is still waiting for review).
function normalizeDetails(input, { partial = false, current = {} } = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const pick = (key, fallback) => (partial && !has(key) ? fallback : input[key]);
  const countriesChanged = has("targetCountries") || has("country") || !partial;
  const targetCountries = countriesChanged
    ? countriesFrom(has("targetCountries") ? input.targetCountries : input.country, current.targetCountries || [current.country])
    : countriesFrom(current.targetCountries, [current.country]);
  const result = {
    title: text(pick("title", current.title), 80),
    category: text(pick("category", current.category), 40),
    country: targetCountries[0] || "",
    targetCountries,
    platform: text(pick("platform", current.platform), 40),
    source: text(pick("source", current.source), 30),
    reason: text(pick("reason", current.reason), 2000),
    sellingPoints: text(pick("sellingPoints", current.sellingPoints), 1000),
    competitorLinks: partial && !has("competitorLinks") ? (current.competitorLinks || []) : links(input.competitorLinks),
    targetPrice: partial && !has("targetPrice") ? (current.targetPrice ?? null) : amount(input.targetPrice, "目标售价"),
    currency: text(pick("currency", current.currency || "CNY"), 8).toUpperCase() || "CNY",
    targetCost: partial && !has("targetCost") ? (current.targetCost ?? null) : amount(input.targetCost, "目标成本"),
    expectedMonthlySales: partial && !has("expectedMonthlySales") ? (current.expectedMonthlySales ?? null) : amount(input.expectedMonthlySales, "预计月销量", { integer: true }),
    firstOrderQty: partial && !has("firstOrderQty") ? (current.firstOrderQty ?? null) : amount(input.firstOrderQty, "意向首批数量", { integer: true }),
    priority: text(pick("priority", current.priority || "normal")) || "normal",
    expectedLaunchDate: partial && !has("expectedLaunchDate") ? (current.expectedLaunchDate || "") : dateOnly(input.expectedLaunchDate, "期望完成日期"),
  };
  if (!result.title) throw invalid("请填写产品名称或开品方向。");
  if (!result.targetCountries.length) throw invalid("请至少选择一个目标国家。");
  if (!result.source) throw invalid("请选择需求来源。");
  if (!result.reason || result.reason.length < 6) throw invalid("请写清楚为什么要开这个品（至少 6 个字）。");
  if (!PRIORITY_KEYS.has(result.priority)) throw invalid("优先级不正确。");
  if (!PRODUCT_LAUNCH_CURRENCIES.includes(result.currency)) throw invalid("币种不正确。");
  return result;
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function createStore(cachePath) {
  const state = loadJson(cachePath, { version: 2, updatedAt: "", sequenceDate: "", sequence: 0, requests: [] });
  state.version = 2;
  state.requests = (Array.isArray(state.requests) ? state.requests : []).map(normalizeStoredRecord);

  function persist() {
    mkdirSync(resolve(cachePath, ".."), { recursive: true });
    state.updatedAt = nowIso();
    const temporaryPath = `${cachePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    renameSync(temporaryPath, cachePath);
  }

  function nextId() {
    const date = today().replaceAll("-", "");
    if (state.sequenceDate !== date) {
      state.sequenceDate = date;
      state.sequence = 0;
    }
    state.sequence += 1;
    return `NP-${date}-${String(state.sequence).padStart(4, "0")}`;
  }

  return {
    list: () => state.requests,
    get: (id) => state.requests.find((item) => item.id === id) || null,
    create(request) {
      const created = normalizeStoredRecord({ ...request, id: nextId() });
      state.requests.unshift(created);
      persist();
      return created;
    },
    update(id, updater) {
      const index = state.requests.findIndex((item) => item.id === id);
      if (index < 0) return null;
      state.requests[index] = normalizeStoredRecord(updater(cloneRecord(state.requests[index])));
      persist();
      return state.requests[index];
    },
  };
}

function scopeKeys(dataScopes = {}) {
  return new Set((dataScopes.countries || []).map(normalizedCountryKey).filter(Boolean));
}

function inScope(request, dataScopes = {}) {
  const allowed = scopeKeys(dataScopes);
  if (!allowed.size) return true;
  return countriesFrom(request.targetCountries, [request.country]).some((country) => allowed.has(normalizedCountryKey(country)));
}

function allCountriesInScope(request, dataScopes = {}) {
  const allowed = scopeKeys(dataScopes);
  if (!allowed.size) return true;
  return countriesFrom(request.targetCountries, [request.country]).every((country) => allowed.has(normalizedCountryKey(country)));
}

export function isProductLaunchOverdue(request, day = today()) {
  if (CLOSED_STAGES.has(canonicalStage(request.stage))) return false;
  if (request.nextDueDate && request.nextDueDate < day) return true;
  return Boolean(request.expectedLaunchDate && request.expectedLaunchDate < day);
}

function checklistProgress(checklist) {
  const required = (checklist || []).filter((item) => item.required && item.status !== "not_required");
  const completed = required.filter((item) => item.status === "completed").length;
  return { completed, total: required.length, percent: required.length ? Math.round((completed / required.length) * 100) : 100 };
}

function filingProgress(filings) {
  const required = (filings || []).filter((item) => item.required && item.status !== "not_required");
  const approved = required.filter((item) => item.status === "approved").length;
  return { approved, total: required.length, percent: required.length ? Math.round((approved / required.length) * 100) : 100 };
}

function decorate(source, day) {
  const request = normalizeStoredRecord(source);
  return {
    ...request,
    stageLabel: stageLabel(request.stage),
    overdue: isProductLaunchOverdue(request, day),
    closed: CLOSED_STAGES.has(request.stage),
    checklistProgress: checklistProgress(request.checklist),
    filingProgress: filingProgress(request.countryFilings),
  };
}

function summaryFor(requests, actorId, day) {
  const month = day.slice(0, 7);
  const summary = { total: requests.length, pendingReview: 0, inProgress: 0, completedThisMonth: 0, launchedThisMonth: 0, overdue: 0, mine: 0, onHold: 0, byStage: {} };
  for (const stage of PRODUCT_LAUNCH_STAGES) summary.byStage[stage.key] = 0;
  for (const source of requests) {
    const request = normalizeStoredRecord(source);
    summary.byStage[request.stage] = (summary.byStage[request.stage] || 0) + 1;
    if (request.stage === "submitted") summary.pendingReview += 1;
    if (IN_PROGRESS_STAGES.has(request.stage)) summary.inProgress += 1;
    if (request.stage === "on_hold") summary.onHold += 1;
    if (request.stage === "completed" && String(request.completedAt || "").slice(0, 7) === month) summary.completedThisMonth += 1;
    if (isProductLaunchOverdue(request, day)) summary.overdue += 1;
    if (actorId && (request.createdById === actorId || request.owner?.id === actorId)) summary.mine += 1;
  }
  summary.launchedThisMonth = summary.completedThisMonth;
  return summary;
}

function event(type, actor, extra = {}) {
  return { id: randomUUID(), type, actor: actor.name, actorId: actor.id, createdAt: nowIso(), ...extra };
}

function assertManager(canManage) {
  if (!canManage) throw forbidden("只有开品负责人可以维护开品清单和进度。");
}

function assertCanComplete(request) {
  const checklistMissing = (request.checklist || []).filter((item) => item.required && !["completed", "not_required"].includes(item.status));
  if (checklistMissing.length) throw invalid(`还有 ${checklistMissing.length} 项开品清单未完成，不能标记首批完成。`);
  const filingMissing = (request.countryFilings || []).filter((item) => item.required && !["approved", "not_required"].includes(item.status));
  if (filingMissing.length) throw invalid(`还有 ${filingMissing.length} 个国家备案未完成，不能标记首批完成。`);
  if (!request.pilotProduction?.sampleConfirmed) throw invalid("请先完成样品确认。");
  if (!(request.pilotProduction?.approvedQty > 0)) throw invalid("请先审批首批生产数量。");
  if (!(request.pilotProduction?.producedQty > 0)) throw invalid("请填写首批实际完成数量。");
}

export function createProductLaunchService({ cachePath }) {
  const store = createStore(cachePath);

  function visible(dataScopes) {
    return store.list().filter((request) => inScope(request, dataScopes));
  }

  function list(filters = {}, { user, dataScopes } = {}) {
    const day = today();
    const actorId = text(user?.id);
    const keyword = text(filters.keyword).toLowerCase();
    const stage = canonicalStage(filters.stage);
    const country = normalizedCountryKey(filters.country);
    const priority = text(filters.priority);
    const mine = ["1", "true", "yes"].includes(text(filters.mine).toLowerCase());
    const scoped = visible(dataScopes);
    const requests = scoped.filter((source) => {
      const request = normalizeStoredRecord(source);
      if (filters.stage && filters.stage !== "all") {
        if (filters.stage === "open" ? CLOSED_STAGES.has(request.stage) : request.stage !== stage) return false;
      }
      if (country && !request.targetCountries.some((item) => normalizedCountryKey(item) === country)) return false;
      if (priority && priority !== "all" && request.priority !== priority) return false;
      if (mine && request.createdById !== actorId && request.owner?.id !== actorId) return false;
      if (!keyword) return true;
      return [request.id, request.title, request.category, request.targetCountries.join(" "), request.platform, request.reason, request.linkedSku, request.createdBy, request.owner?.name, ...(request.factoryAssignments || []).map((item) => item.organizationName)]
        .some((value) => text(value).toLowerCase().includes(keyword));
    });
    return { ok: true, updatedAt: nowIso(), summary: summaryFor(scoped, actorId, day), requests: requests.map((request) => decorate(request, day)) };
  }

  function get(id, { dataScopes } = {}) {
    const request = store.get(text(id));
    return request && inScope(request, dataScopes) ? decorate(request, today()) : null;
  }

  function create(input, user, { dataScopes } = {}) {
    const actor = actorOf(user);
    const details = normalizeDetails(input || {});
    if (!allCountriesInScope(details, dataScopes)) throw forbidden("你没有所选国家的数据权限，不能为它提交开品需求。");
    const at = nowIso();
    const created = store.create({
      ...details,
      schemaVersion: 2,
      stage: "submitted",
      stageEnteredAt: at,
      stageHistory: { submitted: at },
      checklist: defaultChecklist(),
      factoryAssignments: [],
      countryFilings: filingsForCountries(details.targetCountries, []),
      pilotProduction: normalizePilotProduction(),
      owner: null,
      nextAction: "等待产品评审",
      nextDueDate: "",
      linkedSku: "",
      completedAt: "",
      createdBy: actor.name,
      createdById: actor.id,
      createdAt: at,
      updatedAt: at,
      timeline: [event("created", actor, { label: "提交开品需求", toStage: "submitted" })],
    });
    return decorate(created, today());
  }

  function requireVisible(id, dataScopes) {
    const current = store.get(text(id));
    if (!current || !inScope(current, dataScopes)) throw Object.assign(new Error("没有找到这条开品需求。"), { statusCode: 404, code: "not_found" });
    return normalizeStoredRecord(current);
  }

  // Requesters may refine their own idea while it waits for review; managers may edit any time.
  function update(id, input, user, { canManage = false, dataScopes } = {}) {
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const isOwner = current.createdById && current.createdById === actor.id;
    if (!canManage && !(isOwner && REQUESTER_EDITABLE_STAGES.has(current.stage))) {
      throw forbidden(isOwner ? "需求已进入评审流程，内容由产品负责人维护；可以在下方留言补充。" : "只能修改自己提交的需求。");
    }
    const details = normalizeDetails(input || {}, { partial: true, current });
    if (!allCountriesInScope(details, dataScopes)) throw forbidden("你没有所选国家的数据权限。");
    const changed = Object.keys(details).filter((key) => JSON.stringify(details[key]) !== JSON.stringify(current[key]));
    if (!changed.length) return decorate(current, today());
    const updated = store.update(current.id, (request) => ({
      ...request,
      ...details,
      countryFilings: filingsForCountries(details.targetCountries, request.countryFilings),
      updatedAt: nowIso(),
      timeline: [...(request.timeline || []), event("edited", actor, { label: "修改需求内容", fields: changed })],
    }));
    return decorate(updated, today());
  }

  // Stage changes, owner, next step and SKU link: product/development managers only.
  function progress(id, input, user, { canManage = false, dataScopes, owners = [] } = {}) {
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const payload = input || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const isRequester = current.createdById && current.createdById === actor.id;
    const nextStage = has("stage") ? canonicalStage(payload.stage) : current.stage;
    const note = text(payload.note, 1000);
    if (!STAGE_KEYS.has(nextStage)) throw invalid("阶段不正确。");
    const withdrawing = nextStage === "cancelled" && current.stage === "submitted" && isRequester;
    if (!canManage && !withdrawing) throw forbidden("只有开品负责人可以推进进度。");
    if (nextStage !== current.stage && NOTE_REQUIRED_STAGES.has(nextStage) && !note) {
      const labels = { rejected: "请写明不立项的原因，方便运营了解。", on_hold: "请写明搁置的原因。", cancelled: "请写明取消的原因。" };
      throw invalid(labels[nextStage]);
    }
    if (nextStage === "completed" && nextStage !== current.stage) assertCanComplete(current);
    const changes = {};
    if (canManage && has("owner")) {
      const owner = ownerFrom(payload.owner);
      if (owner && owner.id && owners.length && !owners.some((item) => item.id === owner.id)) throw invalid("负责人不在可选名单里。");
      const resolved = owner && owner.id ? (owners.find((item) => item.id === owner.id) || owner) : owner;
      if (JSON.stringify(resolved) !== JSON.stringify(current.owner || null)) changes.owner = resolved;
    }
    if (canManage && has("nextAction")) {
      const value = text(payload.nextAction, 200);
      if (value !== (current.nextAction || "")) changes.nextAction = value;
    }
    if (canManage && has("nextDueDate")) {
      const value = dateOnly(payload.nextDueDate, "下一步截止日期");
      if (value !== (current.nextDueDate || "")) changes.nextDueDate = value;
    }
    if (canManage && has("linkedSku")) {
      const value = text(payload.linkedSku, 80).toUpperCase();
      if (value !== (current.linkedSku || "")) changes.linkedSku = value;
    }
    const stageChanged = nextStage !== current.stage;
    if (!stageChanged && !Object.keys(changes).length && !note) return decorate(current, today());
    const at = nowIso();
    const updated = store.update(current.id, (request) => {
      const next = { ...request, ...changes, updatedAt: at };
      const timeline = [...(request.timeline || [])];
      if (stageChanged) {
        next.stage = nextStage;
        next.stageEnteredAt = at;
        next.stageHistory = { ...(request.stageHistory || {}), [nextStage]: at };
        if (nextStage === "completed") next.completedAt = at;
        if (nextStage !== "completed" && request.stage === "completed") next.completedAt = "";
        if (nextStage === "rejected") next.rejectReason = note;
        if (CLOSED_STAGES.has(nextStage)) next.nextDueDate = "";
        timeline.push(event("stage", actor, {
          label: withdrawing ? "撤回需求" : `${stageLabel(request.stage)} → ${stageLabel(nextStage)}`,
          fromStage: request.stage,
          toStage: nextStage,
          note,
        }));
      }
      const fieldLabels = { owner: "负责人", nextAction: "下一步", nextDueDate: "截止日期", linkedSku: "关联 SKU" };
      const changedLabels = Object.keys(changes).map((key) => fieldLabels[key]);
      if (changedLabels.length) {
        timeline.push(event("updated", actor, {
          label: `更新${changedLabels.join("、")}`,
          note: stageChanged ? "" : note,
          details: {
            owner: changes.owner ? changes.owner?.name || "" : undefined,
            nextAction: changes.nextAction,
            nextDueDate: changes.nextDueDate,
            linkedSku: changes.linkedSku,
          },
        }));
      } else if (!stageChanged && note) {
        timeline.push(event("comment", actor, { label: "进度备注", note }));
      }
      next.timeline = timeline;
      return next;
    });
    return decorate(updated, today());
  }

  function updateChecklist(id, itemKey, input, user, { canManage = false, dataScopes, owners = [] } = {}) {
    assertManager(canManage);
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const key = text(itemKey);
    if (!CHECKLIST_KEYS.has(key)) throw invalid("开品清单项目不存在。");
    const existing = current.checklist.find((item) => item.key === key);
    const payload = input || {};
    const status = Object.prototype.hasOwnProperty.call(payload, "status") ? text(payload.status) : existing.status;
    if (!CHECKLIST_STATUS_KEYS.has(status)) throw invalid("清单状态不正确。");
    if (existing.required && status === "not_required" && !text(payload.note || existing.note)) throw invalid("必做项设为不适用时，请填写原因。");
    const owner = Object.prototype.hasOwnProperty.call(payload, "owner") ? ownerFrom(payload.owner) : existing.owner;
    if (owner?.id && owners.length && !owners.some((item) => item.id === owner.id)) throw invalid("负责人不在可选名单里。");
    const resolvedOwner = owner?.id ? (owners.find((item) => item.id === owner.id) || owner) : owner;
    const dueDate = Object.prototype.hasOwnProperty.call(payload, "dueDate") ? dateOnly(payload.dueDate, "清单截止日期") : existing.dueDate;
    const note = Object.prototype.hasOwnProperty.call(payload, "note") ? text(payload.note, 1000) : existing.note;
    const at = nowIso();
    const updated = store.update(current.id, (request) => {
      request.checklist = request.checklist.map((item) => item.key === key ? {
        ...item,
        status,
        owner: resolvedOwner,
        dueDate,
        note,
        completedAt: status === "completed" ? (item.completedAt || at) : "",
      } : item);
      request.updatedAt = at;
      request.timeline = [...request.timeline, event("checklist", actor, { label: `更新清单：${existing.label} · ${PRODUCT_LAUNCH_CHECKLIST_STATUSES.find((item) => item.key === status)?.label}`, itemKey: key, status, note })];
      return request;
    });
    return decorate(updated, today());
  }

  function assignFactory(id, input, user, { canManage = false, dataScopes } = {}) {
    assertManager(canManage);
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    if (CLOSED_STAGES.has(current.stage)) throw invalid("需求已结案，不能再指派委外工厂。");
    const organizationCode = text(input?.organizationCode, 64);
    const organizationName = text(input?.organizationName, 160);
    const workItemId = text(input?.workItemId, 120);
    const documentNo = text(input?.documentNo, 160);
    if (!organizationCode || !organizationName) throw invalid("请选择可处理打样与报价的委外工厂。");
    if (!workItemId || !documentNo) throw invalid("协同任务尚未成功创建，请稍后重试。");
    const duplicate = (current.factoryAssignments || []).find((item) => item.organizationCode === organizationCode && !["completed", "rejected", "cancelled"].includes(item.status));
    if (duplicate) throw invalid(`${organizationName} 已有一条进行中的打样协同任务，请直接刷新进度。`);
    const at = nowIso();
    const assignment = normalizeFactoryAssignment({
      ...input,
      id: text(input?.id, 120) || randomUUID(),
      organizationCode,
      organizationName,
      workItemId,
      documentNo,
      status: "assigned",
      remoteStatus: "pending",
      createdAt: at,
      createdBy: actor.name,
      createdById: actor.id,
      lastSyncedAt: at,
    });
    const updated = store.update(current.id, (request) => {
      request.factoryAssignments = [...(request.factoryAssignments || []), assignment];
      request.checklist = request.checklist.map((item) => assignment.checklistKeys.includes(item.key) && !["completed", "not_required"].includes(item.status) ? {
        ...item,
        status: "in_progress",
        dueDate: item.dueDate || assignment.dueDate,
      } : item);
      request.updatedAt = at;
      request.timeline = [...request.timeline, event("factory_assignment", actor, {
        label: `指派委外工厂：${organizationName}`,
        note: assignment.requirements,
        details: { assignmentId: assignment.id, organizationCode, documentNo, checklistKeys: assignment.checklistKeys },
      })];
      return request;
    });
    return decorate(updated, today());
  }

  function syncFactoryAssignment(id, assignmentIdInput, detail, user, { canManage = false, dataScopes } = {}) {
    assertManager(canManage);
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const assignmentId = text(assignmentIdInput, 120);
    const existing = (current.factoryAssignments || []).find((item) => item.id === assignmentId);
    if (!existing) throw invalid("委外工厂协同任务不存在。");
    const item = detail?.item || {};
    if (text(item.id) !== existing.workItemId || text(item.organizationCode) !== existing.organizationCode || text(item.itemType) !== "sampling_task") {
      throw invalid("协同任务与当前开品需求不匹配，已停止同步。");
    }
    const artifacts = Array.isArray(detail?.oem?.artifacts) ? detail.oem.artifacts.filter((artifact) => artifact?.artifactType === "sample_result") : [];
    const quotes = Array.isArray(detail?.oem?.quotes) ? detail.oem.quotes : [];
    const latestArtifact = [...artifacts].sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0] || null;
    const approvedArtifact = artifacts.find((artifact) => artifact.status === "approved") || null;
    const latestQuote = [...quotes].sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0] || null;
    const awardedQuote = quotes.find((quote) => quote.status === "awarded") || null;
    const remoteStatus = text(item.status, 60);
    let status = "assigned";
    if (["rejected", "cancelled"].includes(remoteStatus)) status = remoteStatus;
    else if (remoteStatus === "completed" || awardedQuote || (!existing.quoteRequired && approvedArtifact)) status = "completed";
    else if (latestQuote) status = "quote_submitted";
    else if (approvedArtifact) status = "sample_approved";
    else if (artifacts.some((artifact) => artifact.status === "submitted")) status = "sample_submitted";
    else if (["accepted"].includes(remoteStatus)) status = "accepted";
    else if (["in_progress", "pending_sync", "pending_approval"].includes(remoteStatus)) status = "in_progress";
    else if (remoteStatus === "blocked") status = "blocked";
    const nextAssignment = normalizeFactoryAssignment({
      ...existing,
      status,
      remoteStatus,
      sample: {
        roundCount: artifacts.length,
        pendingReviewCount: artifacts.filter((artifact) => artifact.status === "submitted").length,
        approvedArtifactId: approvedArtifact?.id || "",
        approvedVersion: approvedArtifact?.version || null,
        approvedVariantCode: approvedArtifact?.publicPayload?.approvedVariantCode || "",
        approvedSupplierMaterialCode: approvedArtifact?.publicPayload?.approvedSupplierMaterialCode || "",
        latestTitle: latestArtifact?.title || "",
        latestStatus: latestArtifact?.status || "",
      },
      quote: {
        count: quotes.length,
        awardedQuoteId: awardedQuote?.id || "",
        latestQuoteId: latestQuote?.id || "",
        status: awardedQuote?.status || latestQuote?.status || "",
        currency: (awardedQuote || latestQuote)?.currency || "",
        amount: (awardedQuote || latestQuote)?.amount ?? null,
        minimumOrderQuantity: (awardedQuote || latestQuote)?.minimumOrderQuantity ?? null,
        leadTimeDays: (awardedQuote || latestQuote)?.leadTimeDays ?? null,
        terms: (awardedQuote || latestQuote)?.terms || "",
        sampleVariantCode: (awardedQuote || latestQuote)?.sampleVariantCode || "",
      },
      lastSyncedAt: nowIso(),
    });
    const before = JSON.stringify({ status: existing.status, remoteStatus: existing.remoteStatus, sample: existing.sample, quote: existing.quote });
    const after = JSON.stringify({ status: nextAssignment.status, remoteStatus: nextAssignment.remoteStatus, sample: nextAssignment.sample, quote: nextAssignment.quote });
    if (before === after) {
      const refreshed = store.update(current.id, (request) => {
        request.factoryAssignments = request.factoryAssignments.map((assignment) => assignment.id === assignmentId ? nextAssignment : assignment);
        return request;
      });
      return decorate(refreshed, today());
    }
    const at = nowIso();
    const updated = store.update(current.id, (request) => {
      const assignments = request.factoryAssignments.map((assignment) => assignment.id === assignmentId ? nextAssignment : assignment);
      request.factoryAssignments = assignments;
      request.checklist = request.checklist.map((checklistItem) => {
        if (!FACTORY_CHECKLIST_KEYS.has(checklistItem.key) || ["completed", "not_required"].includes(checklistItem.status)) return checklistItem;
        const related = assignments.filter((assignment) => assignment.checklistKeys.includes(checklistItem.key));
        if (!related.length) return checklistItem;
        const completed = checklistItem.key === "factory_quote"
          ? related.some((assignment) => assignment.quote.awardedQuoteId)
          : related.some((assignment) => assignment.sample.approvedArtifactId);
        const allFailed = related.every((assignment) => ["blocked", "rejected", "cancelled"].includes(assignment.status));
        return {
          ...checklistItem,
          status: completed ? "completed" : allFailed ? "blocked" : "in_progress",
          completedAt: completed ? (checklistItem.completedAt || at) : "",
        };
      });
      request.updatedAt = at;
      request.timeline = [...request.timeline, event("factory_sync", actor, {
        label: `同步委外工厂进度：${existing.organizationName} · ${status}`,
        details: { assignmentId, status, remoteStatus, sample: nextAssignment.sample, quote: nextAssignment.quote },
      })];
      return request;
    });
    return decorate(updated, today());
  }

  function updateFiling(id, countryKeyInput, input, user, { canManage = false, dataScopes, owners = [] } = {}) {
    assertManager(canManage);
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const countryKey = normalizedCountryKey(countryKeyInput);
    const existing = current.countryFilings.find((item) => item.countryKey === countryKey);
    if (!existing) throw invalid("这条需求没有选择该国家。");
    const payload = input || {};
    const status = Object.prototype.hasOwnProperty.call(payload, "status") ? text(payload.status) : existing.status;
    if (!FILING_STATUS_KEYS.has(status)) throw invalid("备案状态不正确。");
    const owner = Object.prototype.hasOwnProperty.call(payload, "owner") ? ownerFrom(payload.owner) : existing.owner;
    if (owner?.id && owners.length && !owners.some((item) => item.id === owner.id)) throw invalid("负责人不在可选名单里。");
    const resolvedOwner = owner?.id ? (owners.find((item) => item.id === owner.id) || owner) : owner;
    const at = nowIso();
    const nextFiling = {
      ...existing,
      status,
      authority: Object.prototype.hasOwnProperty.call(payload, "authority") ? text(payload.authority, 80) : existing.authority,
      requirement: Object.prototype.hasOwnProperty.call(payload, "requirement") ? text(payload.requirement, 160) : existing.requirement,
      filingNo: Object.prototype.hasOwnProperty.call(payload, "filingNo") ? text(payload.filingNo, 120) : existing.filingNo,
      owner: resolvedOwner,
      dueDate: Object.prototype.hasOwnProperty.call(payload, "dueDate") ? dateOnly(payload.dueDate, "备案截止日期") : existing.dueDate,
      submittedAt: Object.prototype.hasOwnProperty.call(payload, "submittedAt") ? dateOnly(payload.submittedAt, "递交日期") : existing.submittedAt,
      approvedAt: Object.prototype.hasOwnProperty.call(payload, "approvedAt") ? dateOnly(payload.approvedAt, "获批日期") : existing.approvedAt,
      expiresAt: Object.prototype.hasOwnProperty.call(payload, "expiresAt") ? dateOnly(payload.expiresAt, "有效期") : existing.expiresAt,
      note: Object.prototype.hasOwnProperty.call(payload, "note") ? text(payload.note, 1000) : existing.note,
    };
    if (status === "submitted" && !nextFiling.submittedAt) nextFiling.submittedAt = today();
    if (status === "approved" && !nextFiling.approvedAt) nextFiling.approvedAt = today();
    if (status === "blocked" && !nextFiling.note) throw invalid("备案有阻塞时，请填写原因。");
    if (status === "not_required" && !nextFiling.note) throw invalid("标记无需备案时，请填写依据。");
    const updated = store.update(current.id, (request) => {
      request.countryFilings = request.countryFilings.map((item) => item.countryKey === countryKey ? nextFiling : item);
      request.updatedAt = at;
      request.timeline = [...request.timeline, event("filing", actor, { label: `更新${existing.country}备案 · ${PRODUCT_LAUNCH_FILING_STATUSES.find((item) => item.key === status)?.label}`, countryKey, status, note: nextFiling.note })];
      return request;
    });
    return decorate(updated, today());
  }

  function updatePilot(id, input, user, { canManage = false, dataScopes } = {}) {
    assertManager(canManage);
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const payload = input || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key);
    const pilot = {
      ...current.pilotProduction,
      sampleConfirmed: has("sampleConfirmed") ? booleanValue(payload.sampleConfirmed) : current.pilotProduction.sampleConfirmed,
      approvedQty: has("approvedQty") ? amount(payload.approvedQty, "首批审批数量", { integer: true }) : current.pilotProduction.approvedQty,
      producedQty: has("producedQty") ? amount(payload.producedQty, "首批实际完成数量", { integer: true }) : current.pilotProduction.producedQty,
      note: has("note") ? text(payload.note, 1000) : current.pilotProduction.note,
    };
    const at = nowIso();
    if (pilot.sampleConfirmed && !pilot.sampleConfirmedAt) pilot.sampleConfirmedAt = at;
    if (!pilot.sampleConfirmed) pilot.sampleConfirmedAt = "";
    if (pilot.approvedQty > 0 && !pilot.approvedAt) pilot.approvedAt = at;
    if (!(pilot.approvedQty > 0)) pilot.approvedAt = "";
    if (pilot.producedQty > 0 && !pilot.completedAt) pilot.completedAt = at;
    if (!(pilot.producedQty > 0)) pilot.completedAt = "";
    const automaticStatuses = {
      sample_confirmation: pilot.sampleConfirmed,
      pilot_quantity_approval: pilot.approvedQty > 0,
      pilot_production_complete: pilot.producedQty > 0,
    };
    const updated = store.update(current.id, (request) => {
      request.pilotProduction = pilot;
      request.checklist = request.checklist.map((item) => Object.prototype.hasOwnProperty.call(automaticStatuses, item.key) ? {
        ...item,
        status: automaticStatuses[item.key] ? "completed" : "pending",
        completedAt: automaticStatuses[item.key] ? (item.completedAt || at) : "",
      } : item);
      request.updatedAt = at;
      request.timeline = [...request.timeline, event("pilot", actor, { label: "更新样品确认与首批生产", details: { sampleConfirmed: pilot.sampleConfirmed, approvedQty: pilot.approvedQty, producedQty: pilot.producedQty }, note: pilot.note })];
      return request;
    });
    return decorate(updated, today());
  }

  function comment(id, input, user, { dataScopes } = {}) {
    const actor = actorOf(user);
    const current = requireVisible(id, dataScopes);
    const note = text(input?.note, 1000);
    if (!note) throw invalid("请填写留言内容。");
    const updated = store.update(current.id, (request) => ({
      ...request,
      updatedAt: nowIso(),
      timeline: [...(request.timeline || []), event("comment", actor, { label: "留言", note })],
    }));
    return decorate(updated, today());
  }

  return { list, get, create, update, progress, updateChecklist, assignFactory, syncFactoryAssignment, updateFiling, updatePilot, comment };
}

export function productLaunchMeta({ countries = [], owners = [] } = {}) {
  return {
    ok: true,
    stages: PRODUCT_LAUNCH_STAGES,
    sources: PRODUCT_LAUNCH_SOURCES,
    priorities: PRODUCT_LAUNCH_PRIORITIES,
    platforms: PRODUCT_LAUNCH_PLATFORMS,
    currencies: PRODUCT_LAUNCH_CURRENCIES,
    checklistDefinitions: PRODUCT_LAUNCH_CHECKLIST,
    checklistStatuses: PRODUCT_LAUNCH_CHECKLIST_STATUSES,
    filingStatuses: PRODUCT_LAUNCH_FILING_STATUSES,
    filingRules: FILING_RULES,
    countries,
    owners,
  };
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { normalizedCountryKey } from "./performance-analytics.js";

// 开品需求：运营提交开品想法，产品/开发评审立项后一路推进到上架，全程留痕。
// 数据量小（几百到几千条），沿用仓库工单的 JSON 原子落盘方式。

export const PRODUCT_LAUNCH_STAGES = Object.freeze([
  Object.freeze({ key: "submitted", label: "待评审", main: true }),
  Object.freeze({ key: "approved", label: "已立项", main: true }),
  Object.freeze({ key: "sourcing", label: "寻源打样", main: true }),
  Object.freeze({ key: "certification", label: "资质备案", main: true }),
  Object.freeze({ key: "listing_prep", label: "上架准备", main: true }),
  Object.freeze({ key: "launched", label: "已上架", main: true }),
  Object.freeze({ key: "on_hold", label: "暂缓", main: false }),
  Object.freeze({ key: "rejected", label: "未通过", main: false }),
  Object.freeze({ key: "cancelled", label: "已撤回", main: false }),
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

const STAGE_KEYS = new Set(PRODUCT_LAUNCH_STAGES.map((stage) => stage.key));
const PRIORITY_KEYS = new Set(PRODUCT_LAUNCH_PRIORITIES.map((item) => item.key));
const CLOSED_STAGES = new Set(["launched", "rejected", "cancelled"]);
const NOTE_REQUIRED_STAGES = new Set(["rejected", "on_hold"]);
const REQUESTER_EDITABLE_STAGES = new Set(["submitted", "on_hold"]);
const MAX_LINKS = 8;

function text(value, max = 0) {
  const result = String(value ?? "").normalize("NFKC").trim();
  return max ? result.slice(0, max) : result;
}

function nowIso() {
  return new Date().toISOString();
}

// Production still runs on Node 16, where structuredClone is unavailable.
// Product-launch records contain JSON-safe values only, so this keeps store
// updates isolated without raising the runtime requirement for the API.
function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

function today() {
  return nowIso().slice(0, 10);
}

function stageLabel(key) {
  return PRODUCT_LAUNCH_STAGES.find((stage) => stage.key === key)?.label || key;
}

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "invalid_input" });
}

function forbidden(message) {
  return Object.assign(new Error(message), { statusCode: 403, code: "forbidden" });
}

function actorOf(user) {
  return {
    id: text(user?.id),
    name: text(user?.displayName || user?.username || user?.id || "系统"),
  };
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

// Fields that describe the idea itself (requester can edit while it is still waiting for review).
function normalizeDetails(input, { partial = false, current = {} } = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const pick = (key, fallback) => (partial && !has(key) ? fallback : input[key]);
  const result = {
    title: text(pick("title", current.title), 80),
    category: text(pick("category", current.category), 40),
    country: text(pick("country", current.country), 30),
    platform: text(pick("platform", current.platform), 40),
    source: text(pick("source", current.source), 30),
    reason: text(pick("reason", current.reason), 2000),
    sellingPoints: text(pick("sellingPoints", current.sellingPoints), 1000),
    competitorLinks: partial && !has("competitorLinks") ? (current.competitorLinks || []) : links(input.competitorLinks),
    targetPrice: partial && !has("targetPrice") ? (current.targetPrice ?? null) : amount(input.targetPrice, "目标售价"),
    currency: text(pick("currency", current.currency || "CNY"), 8).toUpperCase() || "CNY",
    targetCost: partial && !has("targetCost") ? (current.targetCost ?? null) : amount(input.targetCost, "目标成本"),
    expectedMonthlySales: partial && !has("expectedMonthlySales") ? (current.expectedMonthlySales ?? null) : amount(input.expectedMonthlySales, "预计月销量", { integer: true }),
    firstOrderQty: partial && !has("firstOrderQty") ? (current.firstOrderQty ?? null) : amount(input.firstOrderQty, "首单数量", { integer: true }),
    priority: text(pick("priority", current.priority || "normal")) || "normal",
    expectedLaunchDate: partial && !has("expectedLaunchDate") ? (current.expectedLaunchDate || "") : dateOnly(input.expectedLaunchDate, "期望上架日期"),
  };
  if (!result.title) throw invalid("请填写产品名称或开品方向。");
  if (!result.country) throw invalid("请选择目标国家。");
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
  const state = loadJson(cachePath, { version: 1, updatedAt: "", sequenceDate: "", sequence: 0, requests: [] });
  state.requests = Array.isArray(state.requests) ? state.requests : [];

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
      const created = { ...request, id: nextId() };
      state.requests.unshift(created);
      persist();
      return created;
    },
    update(id, updater) {
      const index = state.requests.findIndex((item) => item.id === id);
      if (index < 0) return null;
      state.requests[index] = updater(cloneRecord(state.requests[index]));
      persist();
      return state.requests[index];
    },
  };
}

function inScope(request, dataScopes = {}) {
  const countries = new Set((dataScopes.countries || []).map(normalizedCountryKey).filter(Boolean));
  return !countries.size || countries.has(normalizedCountryKey(request.country));
}

export function isProductLaunchOverdue(request, day = today()) {
  if (CLOSED_STAGES.has(request.stage) || request.stage === "on_hold") return false;
  if (request.nextDueDate && request.nextDueDate < day) return true;
  return Boolean(request.expectedLaunchDate && request.expectedLaunchDate < day);
}

function decorate(request, day) {
  return {
    ...request,
    stageLabel: stageLabel(request.stage),
    overdue: isProductLaunchOverdue(request, day),
    closed: CLOSED_STAGES.has(request.stage),
  };
}

function summaryFor(requests, actorId, day) {
  const month = day.slice(0, 7);
  const summary = { total: requests.length, pendingReview: 0, inProgress: 0, launchedThisMonth: 0, overdue: 0, mine: 0, onHold: 0, byStage: {} };
  for (const stage of PRODUCT_LAUNCH_STAGES) summary.byStage[stage.key] = 0;
  for (const request of requests) {
    summary.byStage[request.stage] = (summary.byStage[request.stage] || 0) + 1;
    if (request.stage === "submitted") summary.pendingReview += 1;
    if (["approved", "sourcing", "certification", "listing_prep"].includes(request.stage)) summary.inProgress += 1;
    if (request.stage === "on_hold") summary.onHold += 1;
    if (request.stage === "launched" && String(request.launchedAt || "").slice(0, 7) === month) summary.launchedThisMonth += 1;
    if (isProductLaunchOverdue(request, day)) summary.overdue += 1;
    if (actorId && (request.createdById === actorId || request.owner?.id === actorId)) summary.mine += 1;
  }
  return summary;
}

function event(type, actor, extra = {}) {
  return { id: randomUUID(), type, actor: actor.name, actorId: actor.id, createdAt: nowIso(), ...extra };
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
    const stage = text(filters.stage);
    const country = normalizedCountryKey(filters.country);
    const priority = text(filters.priority);
    const mine = ["1", "true", "yes"].includes(text(filters.mine).toLowerCase());
    const scoped = visible(dataScopes);
    const requests = scoped.filter((request) => {
      if (stage && stage !== "all") {
        if (stage === "open" ? CLOSED_STAGES.has(request.stage) : request.stage !== stage) return false;
      }
      if (country && normalizedCountryKey(request.country) !== country) return false;
      if (priority && priority !== "all" && request.priority !== priority) return false;
      if (mine && request.createdById !== actorId && request.owner?.id !== actorId) return false;
      if (!keyword) return true;
      return [request.id, request.title, request.category, request.country, request.platform, request.reason, request.linkedSku, request.createdBy, request.owner?.name]
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
    if (!inScope(details, dataScopes)) throw forbidden("你没有这个国家的数据权限，不能为它提交开品需求。");
    const at = nowIso();
    const created = store.create({
      ...details,
      stage: "submitted",
      stageEnteredAt: at,
      stageHistory: { submitted: at },
      owner: null,
      nextAction: "等待产品评审",
      nextDueDate: "",
      linkedSku: "",
      launchedAt: "",
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
    return current;
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
    if (!inScope(details, dataScopes)) throw forbidden("你没有这个国家的数据权限。");
    const changed = Object.keys(details).filter((key) => JSON.stringify(details[key]) !== JSON.stringify(current[key]));
    if (!changed.length) return decorate(current, today());
    const updated = store.update(current.id, (request) => ({
      ...request,
      ...details,
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
    const nextStage = has("stage") ? text(payload.stage) : current.stage;
    const note = text(payload.note, 1000);
    if (!STAGE_KEYS.has(nextStage)) throw invalid("阶段不正确。");
    const withdrawing = nextStage === "cancelled" && current.stage === "submitted" && isRequester;
    if (!canManage && !withdrawing) throw forbidden("只有开品负责人可以推进进度。");
    if (nextStage !== current.stage && NOTE_REQUIRED_STAGES.has(nextStage) && !note) {
      throw invalid(nextStage === "rejected" ? "请写明不通过的原因，方便运营了解。" : "请写明暂缓的原因。");
    }
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
        if (nextStage === "launched") next.launchedAt = at;
        if (nextStage !== "launched" && request.stage === "launched") next.launchedAt = "";
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

  return { list, get, create, update, progress, comment };
}

export function productLaunchMeta({ countries = [], owners = [] } = {}) {
  return {
    ok: true,
    stages: PRODUCT_LAUNCH_STAGES,
    sources: PRODUCT_LAUNCH_SOURCES,
    priorities: PRODUCT_LAUNCH_PRIORITIES,
    platforms: PRODUCT_LAUNCH_PLATFORMS,
    currencies: PRODUCT_LAUNCH_CURRENCIES,
    countries,
    owners,
  };
}

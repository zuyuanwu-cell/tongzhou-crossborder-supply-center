import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePlatformAttributes } from "./miaoshou-listing-platform.js";

const LISTING_VERSION = 2;
const MAX_DRAFTS = 500;
const MAX_EVENTS = 80;

function text(value) {
  return String(value ?? "").trim();
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stringList(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item))
    .filter(Boolean)));
}

function nowIso() {
  return new Date().toISOString();
}

function fieldValue(input, previous, key) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : previous[key];
}

function loadJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(tempPath, path);
}

function safeStatus(value) {
  const allowed = new Set(["draft", "review_ready", "pushing", "pushed", "failed", "manual_check"]);
  return allowed.has(value) ? value : "draft";
}

function migrateLoadedDraft(draft) {
  const legacy = Number(draft?.version || 1) < LISTING_VERSION;
  if (!legacy || draft?.status === "pushed") return normalizeListingDraft(draft, draft);
  const migrated = {
    ...draft,
    price: null,
    warnings: [...stringList(draft?.warnings), "价格口径已升级为人民币货源价，请重新填写并核对后再推送。"],
  };
  return normalizeListingDraft(migrated, migrated);
}

export function directHttpsUrls(urls) {
  return Array.from(new Set((Array.isArray(urls) ? urls : []).map((value) => text(value)).filter((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  })));
}

export function parseListingAiOutput(rawAnswer) {
  const raw = text(rawAnswer);
  const withoutFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonCandidate = withoutFence.startsWith("{")
    ? withoutFence
    : withoutFence.slice(withoutFence.indexOf("{"), withoutFence.lastIndexOf("}") + 1);
  let parsed = {};
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return {
      title: "",
      description: withoutFence,
      keywords: [],
      sellingPoints: [],
      categoryHint: "",
      warnings: ["AI 返回格式不完整，请人工检查并补充标题。"],
    };
  }
  return {
    title: text(parsed.title),
    description: text(parsed.description || parsed.notesText || parsed.notes),
    keywords: stringList(parsed.keywords),
    sellingPoints: stringList(parsed.sellingPoints),
    categoryHint: text(parsed.categoryHint || parsed.category),
    warnings: stringList(parsed.warnings),
  };
}

export function normalizeListingDraft(input = {}, previous = {}) {
  const createdAt = text(previous.createdAt || input.createdAt) || nowIso();
  const sku = text(fieldValue(input, previous, "sku"));
  const title = text(fieldValue(input, previous, "title"));
  return {
    id: text(previous.id || input.id) || randomUUID(),
    version: LISTING_VERSION,
    sku,
    sourceProductName: text(fieldValue(input, previous, "sourceProductName")),
    platform: text(fieldValue(input, previous, "platform")) || "tiktok",
    site: text(fieldValue(input, previous, "site")) || "ID",
    language: text(fieldValue(input, previous, "language")) || "id",
    title,
    description: text(fieldValue(input, previous, "description")),
    keywords: stringList(fieldValue(input, previous, "keywords")),
    sellingPoints: stringList(fieldValue(input, previous, "sellingPoints")),
    categoryHint: text(fieldValue(input, previous, "categoryHint")),
    shopId: text(fieldValue(input, previous, "shopId")),
    categoryId: text(fieldValue(input, previous, "categoryId")),
    categoryName: text(fieldValue(input, previous, "categoryName")),
    categoryPath: text(fieldValue(input, previous, "categoryPath")),
    platformAttributes: normalizePlatformAttributes(fieldValue(input, previous, "platformAttributes")),
    categoryMetadataCheckedAt: text(fieldValue(input, previous, "categoryMetadataCheckedAt")),
    warnings: stringList(fieldValue(input, previous, "warnings")),
    price: nullableNumber(fieldValue(input, previous, "price")),
    stock: nullableNumber(fieldValue(input, previous, "stock")) ?? 0,
    weight: nullableNumber(fieldValue(input, previous, "weight")),
    packageLength: nullableNumber(fieldValue(input, previous, "packageLength")),
    packageWidth: nullableNumber(fieldValue(input, previous, "packageWidth")),
    packageHeight: nullableNumber(fieldValue(input, previous, "packageHeight")),
    barcode: text(fieldValue(input, previous, "barcode")),
    imageUrls: directHttpsUrls(fieldValue(input, previous, "imageUrls")),
    unavailableMediaCount: Math.max(0, Number(fieldValue(input, previous, "unavailableMediaCount")) || 0),
    status: safeStatus(fieldValue(input, previous, "status") || (title ? "review_ready" : "draft")),
    commonCollectBoxDetailId: text(previous.commonCollectBoxDetailId || input.commonCollectBoxDetailId),
    lastError: text(previous.lastError || input.lastError),
    createdAt,
    createdBy: text(previous.createdBy || input.createdBy),
    updatedAt: nowIso(),
    updatedBy: text(input.updatedBy || previous.updatedBy),
    pushedAt: text(previous.pushedAt || input.pushedAt),
    pushedBy: text(previous.pushedBy || input.pushedBy),
    events: (Array.isArray(previous.events || input.events) ? (previous.events || input.events) : []).slice(-MAX_EVENTS),
  };
}

export function validateListingDraft(draft) {
  const blocking = [];
  const warnings = [];
  if (!text(draft?.sku)) blocking.push("缺少 SKU，不能推送妙手采集箱。");
  if (!text(draft?.title)) blocking.push("请先填写商品标题。");
  if (text(draft?.title).length > 255) blocking.push("商品标题不能超过 255 个字符。");
  if (!(Number(draft?.price) >= 0.01 && Number(draft?.price) <= 99999.99)) blocking.push("货源价需为 0.01–99,999.99 CNY。");
  if (!(Number(draft?.stock) >= 0 && Number(draft?.stock) <= 99999)) blocking.push("库存需为 0–99,999 的整数。");
  if (!Number.isInteger(Number(draft?.stock))) blocking.push("库存必须是整数。");
  if (!directHttpsUrls(draft?.imageUrls).length) blocking.push("至少选择一张公网 HTTPS 商品图片。");
  if (!text(draft?.description)) warnings.push("商品详情为空，建议补充后再推送。");
  if (!(Number(draft?.weight) > 0)) warnings.push("重量未填写；公共采集箱可以先保存，但后续发布前必须补齐。");
  if (![draft?.packageLength, draft?.packageWidth, draft?.packageHeight].every((value) => Number(value) > 0)) {
    warnings.push("包装尺寸未完整填写；后续发布前必须补齐长、宽、高。");
  }
  if (Number(draft?.unavailableMediaCount) > 0) {
    warnings.push(`${Number(draft.unavailableMediaCount)} 个内部附件无法被妙手直接访问，已自动排除。`);
  }
  return { blocking, warnings: Array.from(new Set([...warnings, ...stringList(draft?.warnings)])) };
}

function escapeHtml(value) {
  return text(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function notesHtml(draft) {
  const sections = [];
  if (text(draft.description)) {
    sections.push(...text(draft.description).split(/\n{2,}/).map((line) => `<p>${escapeHtml(line).replaceAll("\n", "<br>")}</p>`));
  }
  if (stringList(draft.sellingPoints).length) {
    sections.push(`<ul>${stringList(draft.sellingPoints).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
  }
  return sections.join("");
}

export function buildCommonCollectBoxPayload(draft) {
  const payload = {
    title: text(draft.title),
    itemNum: text(draft.sku),
    notesText: text(draft.description),
    notes: notesHtml(draft),
    price: Number(draft.price) || 0,
    stock: Math.max(0, Math.floor(Number(draft.stock) || 0)),
    imgUrls: directHttpsUrls(draft.imageUrls),
  };
  if (Number(draft.weight) > 0) payload.weight = Number(draft.weight);
  if (Number(draft.packageLength) > 0) payload.packageLength = Number(draft.packageLength);
  if (Number(draft.packageWidth) > 0) payload.packageWidth = Number(draft.packageWidth);
  if (Number(draft.packageHeight) > 0) payload.packageHeight = Number(draft.packageHeight);
  return payload;
}

function collectBoxId(response) {
  const candidates = [
    response?.commonCollectBoxDetailId,
    response?.data?.commonCollectBoxDetailId,
    response?.data?.id,
    response?.data?.[0]?.commonCollectBoxDetailId,
    response?.data?.[0]?.id,
  ];
  return text(candidates.find((value) => text(value)));
}

function event(type, message, actorName, details = {}) {
  return { id: randomUUID(), type, message, actorName: text(actorName), details, createdAt: nowIso() };
}

export function initMiaoshouListingService({ cacheDir, connector } = {}) {
  if (!cacheDir) throw new Error("缺少妙手草稿缓存目录");
  const storePath = resolve(cacheDir, "miaoshou-listing-drafts.json");
  const loaded = loadJson(storePath, { version: LISTING_VERSION, drafts: [] });
  let state = {
    version: LISTING_VERSION,
    updatedAt: text(loaded.updatedAt),
    drafts: (Array.isArray(loaded.drafts) ? loaded.drafts : []).map(migrateLoadedDraft).slice(-MAX_DRAFTS),
  };

  function persist() {
    state.updatedAt = nowIso();
    saveJson(storePath, state);
  }

  function getDraft(id) {
    return state.drafts.find((draft) => draft.id === text(id)) || null;
  }

  function listDrafts({ sku = "" } = {}) {
    return state.drafts
      .filter((draft) => !text(sku) || draft.sku === text(sku))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function createDraft(input, actorName = "") {
    const draft = normalizeListingDraft({ ...input, createdBy: actorName, updatedBy: actorName });
    draft.events = [event("generated", "已生成 AI 上架草稿", actorName)];
    state.drafts.push(draft);
    if (state.drafts.length > MAX_DRAFTS) state.drafts = state.drafts.slice(-MAX_DRAFTS);
    persist();
    return draft;
  }

  function updateDraft(id, updates, actorName = "") {
    const index = state.drafts.findIndex((draft) => draft.id === text(id));
    if (index < 0) throw new Error("未找到妙手上架草稿");
    const current = state.drafts[index];
    if (["pushed", "pushing", "manual_check"].includes(current.status)) {
      throw new Error("当前草稿状态不可编辑，请新建草稿或先完成妙手人工核对。");
    }
    const allowed = { updatedBy: actorName };
    [
      "title", "description", "keywords", "sellingPoints", "categoryHint", "platform", "site", "language",
      "price", "stock", "weight", "packageLength", "packageWidth", "packageHeight", "barcode", "imageUrls",
      "shopId", "categoryId", "categoryName", "categoryPath", "platformAttributes", "categoryMetadataCheckedAt",
    ].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(updates, key)) allowed[key] = updates[key];
    });
    const next = normalizeListingDraft(allowed, { ...current, status: "review_ready", lastError: "" });
    next.events = [...current.events, event("updated", "已保存人工修改", actorName)].slice(-MAX_EVENTS);
    state.drafts[index] = next;
    persist();
    return next;
  }

  async function pushDraft(id, { confirmed = false, actorName = "" } = {}) {
    if (!confirmed) throw new Error("推送前需要明确确认");
    const index = state.drafts.findIndex((draft) => draft.id === text(id));
    if (index < 0) throw new Error("未找到妙手上架草稿");
    const current = state.drafts[index];
    if (current.status === "pushed" && current.commonCollectBoxDetailId) return current;
    if (current.status === "pushing") throw new Error("草稿正在推送，请勿重复操作");
    if (current.status === "manual_check") throw new Error("上次推送结果不确定，请先在妙手公共采集箱核对，避免重复创建。");
    const validation = validateListingDraft(current);
    if (validation.blocking.length) throw new Error(validation.blocking.join(" "));
    const pushing = normalizeListingDraft({}, { ...current, status: "pushing", lastError: "" });
    pushing.events = [...current.events, event("push_started", "开始推送妙手公共采集箱", actorName)].slice(-MAX_EVENTS);
    state.drafts[index] = pushing;
    persist();
    try {
      if (!connector || typeof connector.createCommonCollectBoxProduct !== "function") throw new Error("妙手商品接口尚未连接");
      const response = await connector.createCommonCollectBoxProduct(buildCommonCollectBoxPayload(pushing));
      const idValue = collectBoxId(response);
      if (!idValue) {
        const error = new Error("妙手已返回成功响应，但缺少采集箱记录 ID，请人工核对是否已经创建。");
        error.ambiguous = true;
        throw error;
      }
      const pushed = normalizeListingDraft({}, {
        ...pushing,
        status: "pushed",
        commonCollectBoxDetailId: idValue,
        pushedAt: nowIso(),
        pushedBy: actorName,
        lastError: "",
      });
      pushed.events = [...pushing.events, event("pushed", "已推送妙手公共采集箱", actorName, { commonCollectBoxDetailId: idValue })].slice(-MAX_EVENTS);
      state.drafts[index] = pushed;
      persist();
      return pushed;
    } catch (error) {
      const failedStatus = error?.ambiguous ? "manual_check" : "failed";
      const failed = normalizeListingDraft({}, { ...pushing, status: failedStatus, lastError: error?.message || "推送失败" });
      failed.events = [...pushing.events, event("push_failed", failed.lastError, actorName, { ambiguous: Boolean(error?.ambiguous) })].slice(-MAX_EVENTS);
      state.drafts[index] = failed;
      persist();
      throw error;
    }
  }

  return {
    createDraft,
    getDraft,
    listDrafts,
    pushDraft,
    updateDraft,
    publicPayload({ sku = "" } = {}) {
      return { ok: true, provider: "miaoshou", updatedAt: state.updatedAt, drafts: listDrafts({ sku }) };
    },
  };
}

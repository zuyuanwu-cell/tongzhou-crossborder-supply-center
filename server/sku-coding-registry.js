import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const REGISTRY_VERSION = 1;
const DEFAULT_RULES = [
  { id: "rule-idwg", name: "印尼外采品", prefix: "TZKJ-IDWG", digits: 3, kind: "外采品", brand: "", country: "印度尼西亚", description: "同舟跨境 · 印尼外采品", enabled: true },
  { id: "rule-sjj", name: "SJJ 自主品牌", prefix: "TZKJ-SJJ", digits: 3, kind: "自主品牌", brand: "SJJ", country: "", description: "同舟跨境 · SJJ 自主品牌", enabled: true },
  { id: "rule-nk", name: "NK 自主品牌", prefix: "TZKJ-NK", digits: 3, kind: "自主品牌", brand: "NK", country: "", description: "同舟跨境 · NK 自主品牌", enabled: true },
];

function text(value) {
  return String(value ?? "").trim();
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeSkuPrefix(value) {
  const prefix = text(value).replace(/\s+/g, "").toUpperCase();
  if (!/^TZKJ-[A-Z]+(?:-[A-Z]+)*-?$/.test(prefix)) {
    throw new Error("编码前缀必须以 TZKJ- 开头，只能包含英文字母和连接符，且不能包含序号。");
  }
  return prefix;
}

export function formatSkuCode(prefix, digits, sequence) {
  const normalizedPrefix = normalizeSkuPrefix(prefix);
  const normalizedDigits = Math.min(8, Math.max(2, integer(digits, 3)));
  const normalizedSequence = integer(sequence);
  if (normalizedSequence <= 0) throw new Error("SKU 序号必须是大于 0 的整数。");
  return `${normalizedPrefix}${String(normalizedSequence).padStart(normalizedDigits, "0")}`;
}

export function discoverSkuPrefix(value) {
  const sku = text(value).toUpperCase();
  const match = sku.match(/^(TZKJ-[A-Z]+(?:-[A-Z]+)*-?)(\d{3,})$/);
  if (!match) return null;
  return { prefix: match[1], digits: match[2].length, sequence: Number(match[2]) };
}

function initialState(now) {
  const createdAt = now();
  return {
    version: REGISTRY_VERSION,
    rules: DEFAULT_RULES.map((rule) => ({ ...rule, lastIssued: 0, createdAt, updatedAt: createdAt, updatedBy: "system" })),
    reservations: [],
  };
}

function normalizeRule(input, current, actor, now, idFactory) {
  const prefix = normalizeSkuPrefix(input.prefix ?? current?.prefix);
  const digits = Math.min(8, Math.max(2, integer(input.digits ?? current?.digits, 3)));
  const updatedAt = now();
  return {
    id: text(current?.id || input.id) || idFactory("rule"),
    name: text(input.name ?? current?.name) || prefix,
    prefix,
    digits,
    kind: text(input.kind ?? current?.kind) || "其他",
    brand: text(input.brand ?? current?.brand),
    country: text(input.country ?? current?.country),
    description: text(input.description ?? current?.description),
    enabled: input.enabled === undefined ? current?.enabled !== false : Boolean(input.enabled),
    lastIssued: Math.max(0, integer(current?.lastIssued)),
    createdAt: current?.createdAt || updatedAt,
    updatedAt,
    updatedBy: text(actor?.name || actor?.id || current?.updatedBy || "system"),
  };
}

function normalizeState(value, now, idFactory) {
  const fallback = initialState(now);
  if (!value || typeof value !== "object") return fallback;
  const rules = Array.isArray(value.rules) ? value.rules : [];
  const seenPrefixes = new Set();
  const normalizedRules = [];
  for (const source of [...DEFAULT_RULES, ...rules]) {
    try {
      const existing = normalizedRules.find((item) => item.id === source.id || item.prefix === normalizeSkuPrefix(source.prefix));
      const rule = normalizeRule(source, existing, { name: source.updatedBy || "system" }, now, idFactory);
      if (seenPrefixes.has(rule.prefix)) {
        const index = normalizedRules.findIndex((item) => item.prefix === rule.prefix);
        normalizedRules[index] = rule;
      } else {
        seenPrefixes.add(rule.prefix);
        normalizedRules.push(rule);
      }
    } catch {
      // Ignore malformed legacy rules while keeping the remaining registry usable.
    }
  }
  return {
    version: REGISTRY_VERSION,
    rules: normalizedRules.length ? normalizedRules : fallback.rules,
    reservations: Array.isArray(value.reservations) ? value.reservations.filter((item) => item && item.id && item.sku) : [],
  };
}

function observedMax(rule, existingSkus) {
  const pattern = new RegExp(`^${escapeRegExp(rule.prefix)}(\\d+)$`, "i");
  let maximum = 0;
  for (const value of existingSkus) {
    const match = text(value).toUpperCase().match(pattern);
    if (match) maximum = Math.max(maximum, Number(match[1]) || 0);
  }
  return maximum;
}

function publicReservation(item) {
  return item ? {
    ...item,
    warehouseResults: Array.isArray(item.warehouseResults) ? item.warehouseResults.map((result) => ({ ...result })) : [],
  } : null;
}

export function createSkuCodingRegistry({ filePath, now = () => new Date().toISOString(), idFactory = (prefix) => `${prefix}-${randomUUID()}` } = {}) {
  if (!filePath) throw new Error("缺少 SKU 编码注册表路径。");
  mkdirSync(dirname(filePath), { recursive: true });
  let parsed = null;
  if (existsSync(filePath)) {
    try { parsed = JSON.parse(readFileSync(filePath, "utf8")); } catch { parsed = null; }
  }
  let state = normalizeState(parsed, now, idFactory);

  function save() {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, filePath);
  }

  function syncDiscoveredRules(existingSkus = []) {
    let changed = false;
    for (const sku of existingSkus) {
      const discovered = discoverSkuPrefix(sku);
      if (!discovered || state.rules.some((rule) => rule.prefix === discovered.prefix)) continue;
      const createdAt = now();
      const code = discovered.prefix.replace(/^TZKJ-/, "").replace(/-$/, "");
      state.rules.push({
        id: idFactory("rule"),
        name: `${code} 编码`,
        prefix: discovered.prefix,
        digits: discovered.digits,
        kind: "历史规则",
        brand: code,
        country: "",
        description: "根据产品基础库现有 SKU 自动识别",
        enabled: true,
        lastIssued: 0,
        createdAt,
        updatedAt: createdAt,
        updatedBy: "system",
      });
      changed = true;
    }
    if (changed) save();
  }

  function ruleView(rule, existingSkus = []) {
    const currentObservedMax = observedMax(rule, existingSkus);
    const reservationMax = state.reservations
      .filter((item) => item.ruleId === rule.id)
      .reduce((maximum, item) => Math.max(maximum, integer(item.sequence)), 0);
    const currentMax = Math.max(currentObservedMax, integer(rule.lastIssued), reservationMax);
    return {
      ...rule,
      observedMax: currentObservedMax,
      issuedMax: Math.max(integer(rule.lastIssued), reservationMax),
      currentMax,
      currentSku: currentMax ? formatSkuCode(rule.prefix, rule.digits, currentMax) : "",
      nextSequence: currentMax + 1,
      nextSku: formatSkuCode(rule.prefix, rule.digits, currentMax + 1),
    };
  }

  function snapshot(existingSkus = []) {
    const normalizedSkus = [...new Set(existingSkus.map((value) => text(value).toUpperCase()).filter(Boolean))];
    syncDiscoveredRules(normalizedSkus);
    return {
      version: REGISTRY_VERSION,
      rules: state.rules.map((rule) => ruleView(rule, normalizedSkus)).sort((left, right) => left.prefix.localeCompare(right.prefix)),
      reservations: state.reservations.slice(-200).reverse().map(publicReservation),
      updatedAt: state.rules.reduce((latest, rule) => String(rule.updatedAt || "") > latest ? String(rule.updatedAt) : latest, ""),
    };
  }

  function upsertRule(input = {}, actor = {}) {
    const requestedId = text(input.id);
    const requestedPrefix = normalizeSkuPrefix(input.prefix);
    const current = state.rules.find((rule) => rule.id === requestedId || rule.prefix === requestedPrefix);
    if (!current && state.rules.some((rule) => rule.prefix === requestedPrefix)) throw new Error(`编码前缀 ${requestedPrefix} 已存在。`);
    if (current && current.prefix !== requestedPrefix && state.reservations.some((item) => item.ruleId === current.id)) {
      throw new Error(`编码规则 ${current.name} 已经发号，不能修改前缀。`);
    }
    const next = normalizeRule(input, current, actor, now, idFactory);
    const duplicate = state.rules.find((rule) => rule.prefix === next.prefix && rule.id !== next.id);
    if (duplicate) throw new Error(`编码前缀 ${next.prefix} 已由 ${duplicate.name} 使用。`);
    if (current) state.rules[state.rules.indexOf(current)] = next;
    else state.rules.push(next);
    save();
    return ruleView(next, []);
  }

  function reserve(input = {}) {
    const rule = state.rules.find((item) => item.id === text(input.ruleId));
    if (!rule) throw new Error("未找到所选 SKU 编码规则。");
    if (!rule.enabled) throw new Error(`编码规则 ${rule.name} 已停用。`);
    const productRecordId = text(input.productRecordId);
    if (!productRecordId) throw new Error("缺少待编码新品记录。");
    const active = state.reservations.find((item) => item.productRecordId === productRecordId && !["cancelled", "failed"].includes(item.status));
    if (active) {
      if (active.ruleId !== rule.id) throw new Error(`该新品已经预占 ${active.sku}，请先使用或撤销原预占号。`);
      return publicReservation(active);
    }
    const existingSkus = Array.isArray(input.existingSkus) ? input.existingSkus : [];
    syncDiscoveredRules(existingSkus);
    const view = ruleView(rule, existingSkus);
    const createdAt = now();
    const reservation = {
      id: idFactory("reservation"),
      ruleId: rule.id,
      productRecordId,
      productName: text(input.productName),
      sequence: view.nextSequence,
      sku: view.nextSku,
      status: "reserved",
      requestedById: text(input.requestedBy?.id),
      requestedByName: text(input.requestedBy?.name),
      createdAt,
      updatedAt: createdAt,
      cancelledAt: "",
      cancelReason: "",
      jdyRecordId: "",
      jdyStatus: "pending",
      warehouseResults: [],
    };
    rule.lastIssued = reservation.sequence;
    rule.updatedAt = createdAt;
    state.reservations.push(reservation);
    save();
    return publicReservation(reservation);
  }

  function cancelReservation(reservationId, actor = {}, reason = "") {
    const reservation = state.reservations.find((item) => item.id === text(reservationId));
    if (!reservation) throw new Error("未找到 SKU 预占记录。");
    if (reservation.status !== "reserved") throw new Error(`SKU ${reservation.sku} 当前状态不能撤销。`);
    reservation.status = "cancelled";
    reservation.cancelledAt = now();
    reservation.updatedAt = reservation.cancelledAt;
    reservation.cancelReason = text(reason) || "人工撤销";
    reservation.cancelledById = text(actor?.id);
    reservation.cancelledByName = text(actor?.name);
    save();
    return publicReservation(reservation);
  }

  function recordArchiveResult(reservationId, result = {}) {
    const reservation = state.reservations.find((item) => item.id === text(reservationId));
    if (!reservation) throw new Error("未找到 SKU 预占记录。");
    if (result.status) reservation.status = text(result.status);
    if (result.jdyRecordId !== undefined) reservation.jdyRecordId = text(result.jdyRecordId);
    if (result.jdyStatus !== undefined) reservation.jdyStatus = text(result.jdyStatus);
    if (result.message !== undefined) reservation.message = text(result.message);
    if (Array.isArray(result.warehouseResults)) reservation.warehouseResults = result.warehouseResults.map((item) => ({ ...item }));
    if (result.productInput && typeof result.productInput === "object") reservation.productInput = { ...result.productInput };
    if (Array.isArray(result.targetConnectionIds)) reservation.targetConnectionIds = [...new Set(result.targetConnectionIds.map(text).filter(Boolean))];
    reservation.updatedAt = now();
    save();
    return publicReservation(reservation);
  }

  function getReservation(reservationId) {
    return publicReservation(state.reservations.find((item) => item.id === text(reservationId)) || null);
  }

  return { snapshot, upsertRule, reserve, cancelReservation, recordArchiveResult, getReservation };
}

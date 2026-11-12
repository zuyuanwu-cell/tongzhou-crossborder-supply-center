// 妙手「自动标记」规则定时开关。
// 妙手开放平台没有标记规则接口，所以由一台同舟智数节点在已登录的妙手网页会话里开关规则；
// 中台只负责：保存每条规则的开启 / 关闭时间、指定执行节点、手动干预、接收节点回报、给出人工待办。
// 时间一律按北京时间（UTC+8）。节点按「应有状态」对齐：每隔几分钟比对一次，不一致才操作。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;
const MAX_EVENTS = 300;
const REPORT_FRESH_MS = 5 * 60 * 1000;
const MISMATCH_GRACE_MS = 10 * 60 * 1000;
export const MIAOSHOU_RULE_CHECK_SECONDS = 120;

function text(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

/** "HH:MM" → 当天第几分钟；允许 "24:00" 表示当天结束。无效返回 null。 */
export function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
}

function formatClock(minutes) {
  if (minutes === DAY_MINUTES) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function beijingMinutes(nowMs) {
  const shifted = nowMs + BEIJING_OFFSET_MS;
  return Math.floor((((shifted % 86400000) + 86400000) % 86400000) / 60000);
}

/** 按时间表，此刻规则应该开启吗？关闭时间早于开启时间表示跨零点。 */
export function scheduledOn(onTime, offTime, nowMs) {
  const on = parseClock(onTime);
  const offRaw = parseClock(offTime);
  if (on === null || offRaw === null) return null;
  const off = offRaw % DAY_MINUTES;
  const start = on % DAY_MINUTES;
  if (start === off) return null;
  const minute = beijingMinutes(nowMs);
  return start < off ? minute >= start && minute < off : minute >= start || minute < off;
}

/** 下一个开 / 关时间点（毫秒时间戳）。 */
export function nextBoundary(onTime, offTime, nowMs) {
  const points = [parseClock(onTime), parseClock(offTime)].filter((value) => value !== null).map((value) => value % DAY_MINUTES);
  if (!points.length) return null;
  const dayStart = Math.floor((nowMs + BEIJING_OFFSET_MS) / 86400000) * 86400000 - BEIJING_OFFSET_MS;
  const candidates = [];
  for (const offset of [0, 1]) for (const point of points) candidates.push(dayStart + offset * 86400000 + point * 60000);
  const next = candidates.filter((at) => at > nowMs).sort((a, b) => a - b)[0];
  return next ?? null;
}

/** 规则此刻的应有状态：手动干预在有效期内优先，否则按时间表。 */
export function desiredState(rule, nowMs) {
  const override = rule.override;
  if (override && (override.state === "on" || override.state === "off") && Date.parse(override.until || "") > nowMs) {
    return { on: override.state === "on", source: "override" };
  }
  const on = scheduledOn(rule.onTime, rule.offTime, nowMs);
  return on === null ? null : { on, source: "schedule" };
}

function defaultTimes(name) {
  // 当前业务约定：OZON 11:00–23:00，WB 11:00–24:00；其他规则给一个通用默认值，保存前可改。
  if (/wb|wildberries/i.test(name)) return { onTime: "11:00", offTime: "24:00" };
  return { onTime: "11:00", offTime: "23:00" };
}

function emptyState() {
  return { version: 1, nodeId: "", rules: {}, report: null, events: [], mismatchSince: {} };
}

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function createMiaoshouRuleSchedule({ filePath, now = () => Date.now() } = {}) {
  let state = emptyState();
  if (filePath && existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed.rules === "object") state = { ...emptyState(), ...parsed };
    } catch (error) {
      console.error("[miaoshou-rule-schedule] failed to read state, starting empty", error);
    }
  }

  function save() {
    if (!filePath) return;
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, filePath);
  }

  const isoNow = () => new Date(now()).toISOString();

  function clearExpiredOverrides() {
    for (const rule of Object.values(state.rules)) {
      if (rule.override && !(Date.parse(rule.override.until || "") > now())) rule.override = null;
    }
  }

  function managedRules() {
    return Object.values(state.rules).filter((rule) => rule.managed);
  }

  /** 下发给执行节点的计划：只包含托管中的规则，节点绝不会动其他规则。 */
  function planFor(nodeId) {
    clearExpiredOverrides();
    if (!state.nodeId || state.nodeId !== nodeId) return { assigned: false, rules: [], checkSeconds: MIAOSHOU_RULE_CHECK_SECONDS };
    return {
      assigned: true,
      checkSeconds: MIAOSHOU_RULE_CHECK_SECONDS,
      rules: managedRules().map((rule) => ({
        ruleId: rule.ruleId,
        name: rule.name,
        onTime: rule.onTime,
        offTime: rule.offTime,
        override: rule.override ? { state: rule.override.state, until: rule.override.until } : null,
      })),
    };
  }

  function observedMap() {
    const map = new Map();
    for (const item of state.report?.rules || []) map.set(item.ruleId, item);
    return map;
  }

  function issues({ nodeOnline = null, nodeName = "" } = {}) {
    clearExpiredOverrides();
    const list = [];
    const managed = managedRules();
    if (!managed.length) return list;
    const add = (code, title, action, extra = {}) => list.push({ code, title, action, ...extra });
    if (!state.nodeId) {
      add("miaoshou_no_node", "妙手排单定时没有指定执行节点", "在采集中心「妙手排单」里选择一台已登录妙手的同舟智数节点。");
      return list;
    }
    if (nodeOnline === false) {
      add("miaoshou_node_offline", "执行妙手排单定时的节点离线", "检查这台（云）电脑是否开机、同舟智数是否在运行；离线期间规则不会按时开关，恢复后会自动补上。", { nodeId: state.nodeId, nodeName });
      return list;
    }
    const report = state.report && state.report.nodeId === state.nodeId ? state.report : null;
    if (!report) {
      add("miaoshou_no_report", "执行节点还没有上报妙手规则状态", "确认这台电脑的同舟智数已升级到支持妙手排单的版本，并在「妙手排单」页登录妙手。", { nodeId: state.nodeId, nodeName });
      return list;
    }
    if (!report.session?.loggedIn) {
      add("miaoshou_logged_out", "妙手登录已失效", "到执行节点的同舟智数「妙手排单」页点「登录妙手」，重新登录一次。", { nodeId: state.nodeId, nodeName, message: report.session?.message || "" });
      return list;
    }
    const observed = observedMap();
    for (const rule of managed) {
      const current = observed.get(rule.ruleId);
      if (!current) {
        add("miaoshou_rule_missing", `妙手里找不到规则「${rule.name}」`, "规则可能在妙手里被删除了。重新创建后在「妙手排单」里重新托管，或取消托管这条规则。", { ruleId: rule.ruleId });
        continue;
      }
      const since = Date.parse(state.mismatchSince[rule.ruleId] || "");
      if (since && now() - since > MISMATCH_GRACE_MS) {
        const want = desiredState(rule, now());
        add("miaoshou_rule_mismatch", `规则「${rule.name}」应${want?.on ? "开启" : "关闭"}但实际是${current.isEnabled ? "开启" : "关闭"}`, "节点多次尝试后状态仍未改变。查看节点日志；也可以先到妙手「自动标记」页手动操作。", { ruleId: rule.ruleId, since: state.mismatchSince[rule.ruleId] });
      }
    }
    return list;
  }

  return {
    filePath,
    planFor,
    issues,

    /** 节点心跳带来的回报：登录状态、规则实际状态、最近的开关记录。 */
    report(nodeId, payload) {
      if (!payload || typeof payload !== "object") return planFor(nodeId);
      const assigned = Boolean(state.nodeId) && state.nodeId === nodeId;
      // 未指定执行节点时也接收第一份规则清单，方便在中台直接勾选；指定后只认执行节点的回报。
      if (!assigned && state.nodeId) return planFor(nodeId);
      const rules = Array.isArray(payload.rules) ? payload.rules.slice(0, 200).map((item) => ({
        ruleId: text(item.ruleId, 40),
        name: text(item.name, 120),
        isEnabled: Boolean(item.isEnabled),
        shopCount: Number(item.shopCount) || 0,
        detail: text(item.detail, 200),
      })).filter((item) => item.ruleId) : null;
      const previous = state.report && state.report.nodeId === nodeId ? state.report : null;
      state.report = {
        nodeId,
        at: isoNow(),
        session: {
          loggedIn: Boolean(payload.session?.loggedIn),
          message: text(payload.session?.message, 300),
          checkedAt: text(payload.session?.checkedAt, 40),
        },
        // 节点没拿到清单（例如掉登录）时保留上一次看到的规则，页面不至于清空。
        rules: rules ?? previous?.rules ?? [],
        rulesAt: rules ? text(payload.rulesAt, 40) || isoNow() : previous?.rulesAt || "",
      };
      if (assigned && Array.isArray(payload.events)) {
        const seen = new Set(state.events.map((event) => event.id));
        for (const event of payload.events.slice(-100)) {
          const id = text(event.id, 80);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          state.events.push({
            id,
            at: text(event.at, 40) || isoNow(),
            ruleId: text(event.ruleId, 40),
            name: text(event.name, 120),
            action: event.action === "on" ? "on" : "off",
            ok: Boolean(event.ok),
            trigger: event.trigger === "override" ? "override" : "schedule",
            message: text(event.message, 300),
          });
        }
        if (state.events.length > MAX_EVENTS) state.events = state.events.slice(-MAX_EVENTS);
      }
      // 规则名称跟随妙手；记录「应有状态与实际不一致」从什么时候开始。
      const observed = observedMap();
      for (const rule of Object.values(state.rules)) {
        const current = observed.get(rule.ruleId);
        if (current?.name) rule.name = current.name;
        const want = rule.managed && assigned && rules ? desiredState(rule, now()) : null;
        if (want && current && current.isEnabled !== want.on) state.mismatchSince[rule.ruleId] ||= isoNow();
        else if (rules || !rule.managed) delete state.mismatchSince[rule.ruleId];
      }
      save();
      return planFor(nodeId);
    },

    /** 页面用：配置 + 妙手里实际的规则 + 状态 + 最近记录。 */
    view({ nodes = [] } = {}) {
      clearExpiredOverrides();
      const observed = observedMap();
      const ids = new Set([...observed.keys(), ...Object.keys(state.rules)]);
      const node = nodes.find((item) => item.id === state.nodeId) || null;
      const fresh = Boolean(state.report) && now() - Date.parse(state.report.at) < REPORT_FRESH_MS;
      const rules = [...ids].map((ruleId) => {
        const config = state.rules[ruleId];
        const current = observed.get(ruleId) || null;
        const name = current?.name || config?.name || ruleId;
        const times = config ? { onTime: config.onTime, offTime: config.offTime } : defaultTimes(name);
        const rule = { ruleId, name, managed: Boolean(config?.managed), ...times, override: config?.override || null };
        const want = rule.managed ? desiredState(rule, now()) : null;
        const boundary = rule.managed ? nextBoundary(rule.onTime, rule.offTime, now()) : null;
        return {
          ...rule,
          exists: Boolean(current),
          isEnabled: current ? current.isEnabled : null,
          shopCount: current?.shopCount ?? 0,
          detail: current?.detail || "",
          desiredOn: want ? want.on : null,
          desiredSource: want ? want.source : "",
          nextChangeAt: boundary ? new Date(boundary).toISOString() : "",
          inSync: want && current ? current.isEnabled === want.on : null,
        };
      }).sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name, "zh-CN"));
      return {
        nodeId: state.nodeId,
        node: node ? { id: node.id, name: node.name, online: node.online, version: node.version } : null,
        session: state.report?.session || null,
        reportAt: state.report?.at || "",
        reportFresh: fresh,
        rulesAt: state.report?.rulesAt || "",
        rules,
        events: state.events.slice(-60).reverse(),
        issues: issues({ nodeOnline: node ? node.online : state.nodeId ? false : null, nodeName: node?.name || "" }),
        checkSeconds: MIAOSHOU_RULE_CHECK_SECONDS,
        timezone: "北京时间",
        serverTime: isoNow(),
      };
    },

    /** 保存执行节点和各规则的时间表。 */
    update({ nodeId, rules } = {}, { by = "" } = {}) {
      if (nodeId !== undefined) {
        const next = text(nodeId, 80);
        if (next !== state.nodeId) {
          state.nodeId = next;
          state.report = null;
          state.mismatchSince = {};
        }
      }
      if (Array.isArray(rules)) {
        for (const input of rules.slice(0, 200)) {
          const ruleId = text(input?.ruleId, 40);
          if (!ruleId) continue;
          const current = state.rules[ruleId] || { ruleId, name: text(input.name, 120) || ruleId, managed: false, ...defaultTimes(text(input.name, 120)), override: null };
          const on = parseClock(input.onTime ?? current.onTime);
          const off = parseClock(input.offTime ?? current.offTime);
          if (on === null || off === null) throw fail(`规则「${current.name}」的时间格式不对，请用 HH:MM（关闭时间可填 24:00）。`);
          if (on === DAY_MINUTES) throw fail(`规则「${current.name}」的开启时间不能是 24:00，请填 00:00。`);
          if (on % DAY_MINUTES === off % DAY_MINUTES) throw fail(`规则「${current.name}」的开启和关闭时间不能相同。`);
          const timesChanged = formatClock(on) !== current.onTime || formatClock(off) !== current.offTime;
          current.onTime = formatClock(on);
          current.offTime = formatClock(off);
          if (input.name) current.name = text(input.name, 120);
          if (input.managed !== undefined) current.managed = Boolean(input.managed);
          // 时间表改了或取消托管后，之前的手动干预不再有意义。
          if (timesChanged || !current.managed) current.override = null;
          current.updatedAt = isoNow();
          current.updatedBy = text(by, 80);
          if (!current.managed) delete state.mismatchSince[ruleId];
          state.rules[ruleId] = current;
        }
      }
      save();
      return true;
    },

    /** 手动干预：立即开启 / 关闭，保持到下一个计划时间点；"auto" 取消干预。 */
    setOverride(ruleId, stateName, { by = "" } = {}) {
      const rule = state.rules[text(ruleId, 40)];
      if (!rule || !rule.managed) throw fail("这条规则还没有托管，先保存时间表。", 409);
      if (stateName === "auto") {
        rule.override = null;
      } else if (stateName === "on" || stateName === "off") {
        const boundary = nextBoundary(rule.onTime, rule.offTime, now());
        rule.override = { state: stateName, until: new Date(boundary ?? now() + 86400000).toISOString(), by: text(by, 80), at: isoNow() };
      } else {
        throw fail("不支持的操作。");
      }
      delete state.mismatchSince[rule.ruleId];
      save();
      return rule;
    },
  };
}

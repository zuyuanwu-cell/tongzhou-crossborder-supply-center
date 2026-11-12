"use strict";

// 妙手排单定时：按中台下发的时间表开关妙手「自动标记」规则。
// 妙手开放平台没有这类接口，这里通过已登录的妙手网页会话调用页面自己的接口（见 MiaoshouSession）。
// 原则：
// - 只操作中台计划里托管的规则，其他规则一律不碰；
// - 按「应有状态」对齐：先读实际状态，不一致才开 / 关，操作后重新读一次确认；
// - 时间一律按北京时间，和中台的算法保持一致（server/miaoshou-rule-schedule.js）。

const crypto = require("node:crypto");

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MINUTES = 24 * 60;
const ORIGIN = "https://erp.91miaoshou.com";
const RULE_PAGE = `${ORIGIN}/order/package_marking_rule/index`;
const API_LIST = "/api/order/package_marking_rule/searchOpOrderPackageMarkingRuleList";
const API_TOGGLE = "/api/order/package_marking_rule/setOpOrderPackageMarkingRuleIsEnabled";

class MiaoshouError extends Error {
  constructor(message, { loggedOut = false } = {}) {
    super(message);
    this.name = "MiaoshouError";
    this.loggedOut = loggedOut;
  }
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null;
  return hours * 60 + minutes;
}

function beijingMinutes(nowMs) {
  const shifted = nowMs + BEIJING_OFFSET_MS;
  return Math.floor((((shifted % 86400000) + 86400000) % 86400000) / 60000);
}

function scheduledOn(onTime, offTime, nowMs) {
  const on = parseClock(onTime);
  const offRaw = parseClock(offTime);
  if (on === null || offRaw === null) return null;
  const off = offRaw % DAY_MINUTES;
  const start = on % DAY_MINUTES;
  if (start === off) return null;
  const minute = beijingMinutes(nowMs);
  return start < off ? minute >= start && minute < off : minute >= start || minute < off;
}

/** 规则此刻的应有状态：中台的手动干预在有效期内优先，否则按时间表。 */
function desiredState(rule, nowMs) {
  const override = rule.override;
  if (override && (override.state === "on" || override.state === "off") && Date.parse(override.until || "") > nowMs) {
    return { on: override.state === "on", source: "override" };
  }
  const on = scheduledOn(rule.onTime, rule.offTime, nowMs);
  return on === null ? null : { on, source: "schedule" };
}

/** 妙手规则列表接口的返回 → 精简后的规则清单。 */
function parseRuleList(json) {
  if (!json || json.result !== "success" || !Array.isArray(json.opOrderPackageMarkingRuleList)) return null;
  return json.opOrderPackageMarkingRuleList.map((item) => ({
    ruleId: String(item.opOrderPackageMarkingRuleId ?? ""),
    name: String(item.ruleName ?? ""),
    isEnabled: String(item.isEnabled) === "1",
    shopCount: Array.isArray(item.ruleContent?.shopIds) ? item.ruleContent.shopIds.length : 0,
    detail: Array.isArray(item.actionFlags) ? item.actionFlags.map((flag) => flag?.remark).filter(Boolean).map((remark) => `标签「${remark}」`).join("、") : "",
  })).filter((rule) => rule.ruleId);
}

/** 判断一次妙手接口返回是不是「没登录」。 */
function classifyResponse(response) {
  const { status = 0, url = "", text = "" } = response || {};
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (status === 401 || status === 403) return { json, error: new MiaoshouError("妙手登录已失效，请重新登录。", { loggedOut: true }) };
  if (!json) {
    const loginPage = /login|passport|sign-?in/i.test(url) || /<html|<!doctype/i.test(text.slice(0, 200));
    return { json, error: new MiaoshouError(loginPage ? "妙手登录已失效，请重新登录。" : `妙手返回了无法识别的内容（HTTP ${status}）。`, { loggedOut: loginPage }) };
  }
  if (json.result !== "success") {
    const reason = String(json.reason || json.message || "妙手接口返回失败");
    return { json, error: new MiaoshouError(reason, { loggedOut: /登录|登陆|login|未授权|会话/i.test(reason) }) };
  }
  return { json, error: null };
}

/**
 * 妙手接口封装。request(method, path, form) 由外部提供（在已登录的妙手页面里发请求），
 * 返回 { status, url, text }。
 */
class MiaoshouApi {
  constructor({ request }) {
    this.request = request;
  }

  async listRules() {
    const { json, error } = classifyResponse(await this.request("GET", API_LIST));
    if (error) throw error;
    const rules = parseRuleList(json);
    if (!rules) throw new MiaoshouError("妙手规则列表的格式变了，可能是妙手改版，需要重新适配。");
    return rules;
  }

  async setEnabled(ruleId, on) {
    if (!/^\d+$/.test(String(ruleId))) throw new MiaoshouError(`规则 ID 不合法：${ruleId}`);
    const { error } = classifyResponse(await this.request("POST", API_TOGGLE, { opOrderPackageMarkingRuleId: String(ruleId), isEnabled: on ? "1" : "0" }));
    if (error) throw error;
  }
}

class MiaoshouKeeper {
  /**
   * @param api      { listRules(), setEnabled(ruleId, on) }
   * @param getPlan  () => 中台下发的计划 { assigned, rules: [{ ruleId, name, onTime, offTime, override }], checkSeconds }
   * @param isActive () => 这台电脑是否启用了妙手（登录过妙手才会启用，避免无关节点去访问妙手）
   */
  constructor({ api, getPlan, isActive = () => true, log = () => {}, now = () => Date.now(), onChange = () => {} }) {
    this.api = api;
    this.getPlan = getPlan;
    this.isActive = isActive;
    this.log = log;
    this.now = now;
    this.onChange = onChange;
    this.session = { loggedIn: false, message: "还没有检查", checkedAt: "" };
    this.rules = null;
    this.rulesAt = "";
    this.events = [];
    this.lastTickAt = "";
    this.timer = null;
    this.busy = false;
    this.warned = new Set();
  }

  start(intervalMs = 60000) {
    this.stop();
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs);
    setTimeout(() => this.tick().catch(() => {}), 8000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  iso() {
    return new Date(this.now()).toISOString();
  }

  setSession(loggedIn, message = "") {
    const changed = this.session.loggedIn !== loggedIn;
    this.session = { loggedIn, message, checkedAt: this.iso() };
    if (changed) this.log(loggedIn ? "info" : "warn", loggedIn ? "妙手已登录" : `妙手未登录：${message}`);
  }

  pushEvent(event) {
    this.events.push({ id: `mse_${this.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`, at: this.iso(), ...event });
    if (this.events.length > 60) this.events = this.events.slice(-60);
  }

  /** 读一次规则清单并按计划对齐。返回本次做了哪些操作。 */
  async tick({ force = false } = {}) {
    if (this.busy) return { skipped: "busy" };
    if (!this.isActive()) return { skipped: "inactive" };
    const plan = this.getPlan() || {};
    const interval = Math.max(60, Number(plan.checkSeconds) || 120) * 1000;
    // 平时按间隔检查；但已知某条规则到点该变了（按上次读到的状态判断）就立刻执行，不等间隔。
    const due = plan.assigned && Array.isArray(plan.rules) && plan.rules.some((target) => {
      const want = desiredState(target, this.now());
      const current = (this.rules || []).find((rule) => rule.ruleId === String(target.ruleId));
      return Boolean(want && current && current.isEnabled !== want.on);
    });
    if (!force && !due && this.lastTickAt && this.now() - Date.parse(this.lastTickAt) < interval - 5000) return { skipped: "interval" };
    this.busy = true;
    const actions = [];
    try {
      let rules = await this.api.listRules();
      this.setSession(true);
      this.rules = rules;
      this.rulesAt = this.iso();
      const targets = plan.assigned && Array.isArray(plan.rules) ? plan.rules : [];
      for (const target of targets) {
        const want = desiredState(target, this.now());
        if (!want) continue;
        const current = rules.find((rule) => rule.ruleId === String(target.ruleId));
        if (!current) {
          if (!this.warned.has(target.ruleId)) this.log("warn", `妙手里找不到规则「${target.name || target.ruleId}」，已跳过`);
          this.warned.add(target.ruleId);
          continue;
        }
        this.warned.delete(target.ruleId);
        if (current.isEnabled === want.on) continue;
        const action = { ruleId: current.ruleId, name: current.name, action: want.on ? "on" : "off", trigger: want.source, ok: false, message: "" };
        try {
          await this.api.setEnabled(current.ruleId, want.on);
          action.sent = true;
        } catch (error) {
          action.message = error.message;
          if (error.loggedOut) this.setSession(false, error.message);
        }
        actions.push(action);
      }
      if (actions.some((action) => action.sent)) {
        // 操作后重新读一次，确认妙手里的状态真的变了。
        rules = await this.api.listRules();
        this.rules = rules;
        this.rulesAt = this.iso();
      }
      for (const action of actions) {
        const after = rules.find((rule) => rule.ruleId === action.ruleId);
        if (action.sent) {
          action.ok = Boolean(after) && after.isEnabled === (action.action === "on");
          if (!action.ok) action.message = "妙手返回成功，但规则状态没有变化";
        }
        const label = `妙手规则「${action.name}」${action.action === "on" ? "开启" : "关闭"}（${action.trigger === "override" ? "中台手动" : "定时"}）`;
        this.log(action.ok ? "info" : "error", action.ok ? `${label}成功` : `${label}失败：${action.message}`);
        this.pushEvent({ ruleId: action.ruleId, name: action.name, action: action.action, trigger: action.trigger, ok: action.ok, message: action.message });
      }
      return { actions };
    } catch (error) {
      if (error.loggedOut) this.setSession(false, error.message);
      else {
        this.session = { ...this.session, message: error.message, checkedAt: this.iso() };
        this.log("warn", `读取妙手规则失败：${error.message}`);
      }
      return { error: error.message, actions };
    } finally {
      this.lastTickAt = this.iso();
      this.busy = false;
      this.onChange();
    }
  }

  /** 随心跳上报给中台。事件带 id，中台去重，所以每次都带最近的几十条。 */
  report() {
    if (!this.isActive()) return null;
    return {
      session: this.session,
      rules: this.session.loggedIn ? this.rules : null,
      rulesAt: this.rulesAt,
      events: this.events.slice(-40),
    };
  }

  /** 界面用。 */
  view() {
    const plan = this.getPlan() || {};
    const targets = plan.assigned && Array.isArray(plan.rules) ? plan.rules : [];
    return {
      active: this.isActive(),
      assigned: Boolean(plan.assigned),
      session: this.session,
      rulesAt: this.rulesAt,
      lastTickAt: this.lastTickAt,
      checkSeconds: Number(plan.checkSeconds) || 120,
      rules: (this.rules || []).map((rule) => {
        const target = targets.find((item) => String(item.ruleId) === rule.ruleId);
        const want = target ? desiredState(target, this.now()) : null;
        return { ...rule, managed: Boolean(target), onTime: target?.onTime || "", offTime: target?.offTime || "", desiredOn: want ? want.on : null, desiredSource: want ? want.source : "", overrideUntil: want?.source === "override" ? target.override.until : "" };
      }),
      events: this.events.slice(-30).reverse(),
    };
  }
}

module.exports = { MiaoshouApi, MiaoshouKeeper, MiaoshouError, desiredState, scheduledOn, parseClock, parseRuleList, classifyResponse, ORIGIN, RULE_PAGE };

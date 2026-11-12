"use strict";

// 妙手排单定时：时间表判断、按应有状态对齐、掉登录处理、心跳对接。
// 运行：node --test test/miaoshou.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { MiaoshouApi, MiaoshouKeeper, MiaoshouError, desiredState, scheduledOn, parseRuleList, classifyResponse } = require("../core/miaoshou");
const { NodeAgent } = require("../core/agent");
const { ConfigStore } = require("../core/config");

const bj = (text) => Date.parse(`${text}+08:00`);

/** 模拟妙手网页接口：返回值与 2026-11-12 在真实妙手上记录的一致。 */
function fakeMiaoshou(initial) {
  const state = { rules: initial.map((rule) => ({ ...rule })), loggedIn: true, calls: [], stuck: false };
  const request = async (method, pathname, form) => {
    state.calls.push({ method, pathname, form });
    if (!state.loggedIn) return { status: 200, url: "https://erp.91miaoshou.com/login", text: "<!doctype html><html>login</html>" };
    if (pathname.endsWith("/searchOpOrderPackageMarkingRuleList")) {
      return { status: 200, url: pathname, text: JSON.stringify({ result: "success", opOrderPackageMarkingRuleList: state.rules.map((rule) => ({ opOrderPackageMarkingRuleId: rule.id, ruleName: rule.name, isEnabled: rule.on ? "1" : "0", ruleContent: { shopIds: new Array(rule.shops).fill("1") }, actionFlags: [{ remark: "排" }] })), total: state.rules.length }) };
    }
    if (pathname.endsWith("/setOpOrderPackageMarkingRuleIsEnabled")) {
      const rule = state.rules.find((item) => item.id === form.opOrderPackageMarkingRuleId);
      if (!rule) return { status: 200, url: pathname, text: JSON.stringify({ result: "fail", reason: "规则不存在" }) };
      if (!state.stuck) rule.on = form.isEnabled === "1";
      return { status: 200, url: pathname, text: JSON.stringify({ result: "success" }) };
    }
    return { status: 404, url: pathname, text: "not found" };
  };
  return { state, api: new MiaoshouApi({ request }) };
}

const RULES = [
  { id: "3660", name: "自动排单", on: false, shops: 27 },
  { id: "7657", name: "OZON排单", on: false, shops: 20 },
  { id: "7658", name: "WB排单", on: false, shops: 7 },
];
const PLAN = { assigned: true, checkSeconds: 120, rules: [
  { ruleId: "7657", name: "OZON排单", onTime: "11:00", offTime: "23:00", override: null },
  { ruleId: "7658", name: "WB排单", onTime: "11:00", offTime: "24:00", override: null },
] };

test("时间表按北京时间判断，24:00 表示到零点", () => {
  assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T10:59:59")), false);
  assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T11:00:00")), true);
  assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T23:00:00")), false);
  assert.equal(scheduledOn("11:00", "24:00", bj("2026-11-12T23:59:00")), true);
  assert.equal(scheduledOn("11:00", "24:00", bj("2026-11-13T00:00:00")), false);
  assert.equal(scheduledOn("20:00", "02:00", bj("2026-11-13T01:00:00")), true);
  assert.equal(scheduledOn("bad", "02:00", 0), null);
  const override = { onTime: "11:00", offTime: "23:00", override: { state: "on", until: new Date(bj("2026-11-12T11:00:00")).toISOString() } };
  assert.deepEqual(desiredState(override, bj("2026-11-12T10:00:00")), { on: true, source: "override" });
  assert.deepEqual(desiredState(override, bj("2026-11-12T11:00:00")), { on: true, source: "schedule" });
});

test("解析妙手规则列表与未登录判断", () => {
  assert.equal(parseRuleList({ result: "fail" }), null);
  assert.equal(classifyResponse({ status: 200, url: "https://erp.91miaoshou.com/login", text: "<html>" }).error.loggedOut, true);
  assert.equal(classifyResponse({ status: 401, text: "{}" }).error.loggedOut, true);
  assert.equal(classifyResponse({ status: 200, text: JSON.stringify({ result: "fail", reason: "请先登录" }) }).error.loggedOut, true);
  assert.equal(classifyResponse({ status: 200, text: JSON.stringify({ result: "fail", reason: "页码数据有误" }) }).error.loggedOut, false);
  assert.equal(classifyResponse({ status: 200, text: JSON.stringify({ result: "success" }) }).error, null);
});

test("按应有状态对齐：到点开、到点关，只动托管的规则", async () => {
  const { state, api } = fakeMiaoshou(RULES);
  let clock = bj("2026-11-12T10:30:00");
  const logs = [];
  const keeper = new MiaoshouKeeper({ api, getPlan: () => PLAN, now: () => clock, log: (level, message) => logs.push(`${level}:${message}`) });

  // 10:30 都应关闭，实际也是关闭：不发任何开关请求
  let result = await keeper.tick();
  assert.deepEqual(result.actions, []);
  assert.equal(state.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(keeper.session.loggedIn, true);

  // 间隔没到且没有到点的规则：跳过
  clock += 30000;
  assert.equal((await keeper.tick()).skipped, "interval");

  // 11:00 到点：不等间隔，立刻把两条托管规则打开；原规则 3660 不动
  clock = bj("2026-11-12T11:00:05");
  result = await keeper.tick();
  assert.deepEqual(result.actions.map((action) => `${action.ruleId}:${action.action}:${action.ok}`), ["7657:on:true", "7658:on:true"]);
  assert.deepEqual(state.rules.map((rule) => rule.on), [false, true, true]);
  assert.deepEqual(state.calls.filter((call) => call.method === "POST").map((call) => call.form), [
    { opOrderPackageMarkingRuleId: "7657", isEnabled: "1" },
    { opOrderPackageMarkingRuleId: "7658", isEnabled: "1" },
  ]);

  // 23:00 只关 OZON；WB 到零点才关
  clock = bj("2026-11-12T23:00:10");
  result = await keeper.tick();
  assert.deepEqual(result.actions.map((action) => `${action.ruleId}:${action.action}`), ["7657:off"]);
  clock = bj("2026-11-13T00:00:10");
  result = await keeper.tick();
  assert.deepEqual(result.actions.map((action) => `${action.ruleId}:${action.action}`), ["7658:off"]);
  assert.deepEqual(state.rules.map((rule) => rule.on), [false, false, false]);

  // 有人在妙手里手动打开了：下一次比对会关回去
  state.rules[1].on = true;
  clock += 3 * 60000;
  result = await keeper.tick();
  assert.deepEqual(result.actions.map((action) => `${action.ruleId}:${action.action}`), ["7657:off"]);

  const report = keeper.report();
  assert.equal(report.events.length, 5);
  assert.ok(report.events.every((event) => event.id && event.ok));
  assert.equal(report.rules.length, 3);
  assert.ok(logs.some((line) => line.includes("OZON排单」开启（定时）成功")));
});

test("中台手动干预优先于时间表；妙手没生效时记为失败", async () => {
  const { state, api } = fakeMiaoshou(RULES);
  const clock = bj("2026-11-12T09:00:00");
  const plan = JSON.parse(JSON.stringify(PLAN));
  plan.rules[1].override = { state: "on", until: new Date(bj("2026-11-12T11:00:00")).toISOString() };
  const keeper = new MiaoshouKeeper({ api, getPlan: () => plan, now: () => clock });
  let result = await keeper.tick();
  assert.deepEqual(result.actions.map((action) => `${action.ruleId}:${action.action}:${action.trigger}:${action.ok}`), ["7658:on:override:true"]);
  assert.equal(keeper.view().rules.find((rule) => rule.ruleId === "7658").desiredSource, "override");

  state.stuck = true;
  plan.rules[0].override = { state: "on", until: new Date(bj("2026-11-12T11:00:00")).toISOString() };
  result = await keeper.tick({ force: true });
  assert.equal(result.actions[0].ok, false);
  assert.match(result.actions[0].message, /没有变化/);
  assert.equal(keeper.report().events.at(-1).ok, false);
});

test("没被中台指定、或这台电脑没启用妙手时不操作", async () => {
  const { state, api } = fakeMiaoshou(RULES.map((rule) => ({ ...rule, on: true })));
  const clock = bj("2026-11-12T09:00:00");
  const unassigned = new MiaoshouKeeper({ api, getPlan: () => ({ assigned: false, rules: PLAN.rules }), now: () => clock });
  assert.deepEqual((await unassigned.tick()).actions, []);
  assert.equal(state.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(unassigned.report().rules.length, 3, "仍上报规则清单，方便在中台勾选");

  const inactive = new MiaoshouKeeper({ api, getPlan: () => PLAN, isActive: () => false, now: () => clock });
  const before = state.calls.length;
  assert.equal((await inactive.tick()).skipped, "inactive");
  assert.equal(state.calls.length, before, "未启用时完全不访问妙手");
  assert.equal(inactive.report(), null);
});

test("妙手掉登录：标记未登录、不上报旧清单，重新登录后恢复", async () => {
  const { state, api } = fakeMiaoshou(RULES);
  let clock = bj("2026-11-12T12:00:00");
  const keeper = new MiaoshouKeeper({ api, getPlan: () => PLAN, now: () => clock });
  state.loggedIn = false;
  const result = await keeper.tick();
  assert.match(result.error, /重新登录/);
  assert.equal(keeper.session.loggedIn, false);
  assert.equal(keeper.report().rules, null);
  state.loggedIn = true;
  clock += 3 * 60000;
  assert.equal((await keeper.tick()).actions.length, 2);
  assert.equal(keeper.session.loggedIn, true);
  await assert.rejects(() => api.setEnabled("7657; drop", true), MiaoshouError);
});

test("心跳：上报妙手状态，保存中台下发的时间表并立即对齐", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-ms-"));
  const store = new ConfigStore(dir);
  store.update((config) => {
    config.node = { id: "node_a", name: "测试节点" };
    config.miaoshou.active = true;
  });
  const { api } = fakeMiaoshou(RULES);
  const keeper = new MiaoshouKeeper({ api, getPlan: () => store.get().miaoshou.plan, isActive: () => store.get().miaoshou.active, now: () => bj("2026-11-12T12:00:00") });
  await keeper.tick();
  const sent = [];
  const client = { token: "tzcn_x", agent: async (name, body) => {
    sent.push({ name, body });
    return name === "heartbeat" ? { schedule: null, commands: [], miaoshou: PLAN } : {};
  } };
  const agent = new NodeAgent({ store, collector: { storeOverview: () => [], running: null }, cli: { path: "x" }, clientFactory: () => client, miaoshou: keeper });
  let changed = 0;
  agent.onMiaoshouPlanChanged = () => {
    changed += 1;
  };
  await agent.heartbeat();
  assert.equal(sent[0].body.miaoshou.session.loggedIn, true);
  assert.equal(sent[0].body.miaoshou.rules.length, 3);
  assert.deepEqual(store.get().miaoshou.plan.rules.map((rule) => rule.ruleId), ["7657", "7658"]);
  assert.equal(changed, 1);
  await agent.heartbeat();
  assert.equal(changed, 1, "时间表没变时不重复触发");
  const reloaded = new ConfigStore(dir);
  assert.equal(reloaded.get().miaoshou.plan.assigned, true, "时间表缓存在本地，中台连不上也能执行");
});

test("妙手会话：在妙手页面里发请求，页面不在妙手域名时判为未登录", async () => {
  const vm = require("node:vm");
  const { MiaoshouSession } = require("../core/miaoshou-session");
  const fetched = [];
  let currentUrl = "https://erp.91miaoshou.com/order/package_marking_rule/index";
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        getURL: () => currentUrl,
        setWindowOpenHandler: () => {},
        on: () => {},
        // 像真实页面一样执行脚本，fetch 换成记录用的假实现。
        executeJavaScript: (script) => vm.runInNewContext(script, {
          fetch: async (url, init) => {
            fetched.push({ url, init });
            return { status: 200, url, text: async () => JSON.stringify({ result: "success" }) };
          },
        }),
      };
    }
    removeMenu() {}
    on() {}
    isDestroyed() { return false; }
    loadURL() { return Promise.resolve(); }
    hide() {}
  }
  const session = new MiaoshouSession({ BrowserWindow: FakeWindow });
  const api = new MiaoshouApi({ request: (method, pathname, form) => session.request(method, pathname, form) });
  await api.setEnabled("7657", false);
  assert.equal(session.window.options.webPreferences.partition, "persist:miaoshou");
  assert.equal(fetched[0].url, "/api/order/package_marking_rule/setOpOrderPackageMarkingRuleIsEnabled");
  assert.equal(fetched[0].init.method, "POST");
  assert.equal(fetched[0].init.body, "opOrderPackageMarkingRuleId=7657&isEnabled=0");
  assert.equal(fetched[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  await session.request("GET", "/api/order/package_marking_rule/searchOpOrderPackageMarkingRuleList");
  assert.equal(fetched[1].init.body, undefined);
  await assert.rejects(() => session.request("GET", "https://evil.example/api/x"), /不允许/);
  currentUrl = "https://account.91miaoshou.com/login";
  await assert.rejects(() => api.listRules(), (error) => error.loggedOut === true);
});

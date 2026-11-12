import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMiaoshouRuleSchedule, desiredState, nextBoundary, parseClock, scheduledOn } from "../server/miaoshou-rule-schedule.js";

// 北京时间 → UTC 时间戳
const bj = (text) => Date.parse(`${text}+08:00`);

assert.equal(parseClock("11:00"), 660);
assert.equal(parseClock("24:00"), 1440);
assert.equal(parseClock("24:01"), null);
assert.equal(parseClock("9:5"), null);

// OZON 11:00–23:00
assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T10:59:00")), false);
assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T11:00:00")), true);
assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T22:59:00")), true);
assert.equal(scheduledOn("11:00", "23:00", bj("2026-11-12T23:00:00")), false);
// WB 11:00–24:00：到零点才关
assert.equal(scheduledOn("11:00", "24:00", bj("2026-11-12T23:59:00")), true);
assert.equal(scheduledOn("11:00", "24:00", bj("2026-11-13T00:00:00")), false);
assert.equal(scheduledOn("11:00", "24:00", bj("2026-11-13T10:59:00")), false);
// 跨零点 20:00–02:00
assert.equal(scheduledOn("20:00", "02:00", bj("2026-11-13T01:30:00")), true);
assert.equal(scheduledOn("20:00", "02:00", bj("2026-11-13T02:00:00")), false);
assert.equal(scheduledOn("11:00", "11:00", bj("2026-11-13T02:00:00")), null);

assert.equal(nextBoundary("11:00", "23:00", bj("2026-11-12T12:00:00")), bj("2026-11-12T23:00:00"));
assert.equal(nextBoundary("11:00", "24:00", bj("2026-11-12T12:00:00")), bj("2026-11-13T00:00:00"));
assert.equal(nextBoundary("11:00", "23:00", bj("2026-11-12T23:30:00")), bj("2026-11-13T11:00:00"));

let clock = bj("2026-11-12T10:00:00");
const file = join(mkdtempSync(join(tmpdir(), "miaoshou-rule-")), "state.json");
const schedule = createMiaoshouRuleSchedule({ filePath: file, now: () => clock });
const nodes = [{ id: "node_a", name: "云电脑-1", online: true, version: "0.5.0" }];
const catalog = [
  { ruleId: "3660", name: "自动排单", isEnabled: false, shopCount: 27 },
  { ruleId: "7657", name: "OZON排单", isEnabled: true, shopCount: 20 },
  { ruleId: "7658", name: "WB排单", isEnabled: true, shopCount: 7 },
];

// 未指定节点：节点拿不到计划，但清单会显示出来，默认时间按平台给出
let plan = schedule.report("node_a", { session: { loggedIn: true }, rules: catalog });
assert.equal(plan.assigned, false);
let view = schedule.view({ nodes });
assert.equal(view.rules.length, 3);
assert.deepEqual(view.rules.find((rule) => rule.ruleId === "7658").offTime, "24:00");
assert.equal(view.issues.length, 0, "没有托管规则时不产生待办");

// 校验
assert.throws(() => schedule.update({ rules: [{ ruleId: "7657", managed: true, onTime: "11:00", offTime: "11:00" }] }), /不能相同/);
assert.throws(() => schedule.update({ rules: [{ ruleId: "7657", managed: true, onTime: "25:00", offTime: "11:00" }] }), /时间格式/);

schedule.update({ nodeId: "node_a", rules: [
  { ruleId: "7657", name: "OZON排单", managed: true, onTime: "11:00", offTime: "23:00" },
  { ruleId: "7658", name: "WB排单", managed: true, onTime: "11:00", offTime: "24:00" },
] }, { by: "管理员" });

// 只下发托管规则；别的节点拿不到
plan = schedule.report("node_a", { session: { loggedIn: true }, rules: catalog });
assert.equal(plan.assigned, true);
assert.deepEqual(plan.rules.map((rule) => rule.ruleId), ["7657", "7658"]);
assert.equal(schedule.planFor("node_b").assigned, false);
assert.equal(schedule.report("node_b", { session: { loggedIn: true }, rules: [] }).assigned, false);
assert.equal(schedule.view({ nodes }).rules.length, 3, "其他节点的回报不覆盖执行节点的清单");

// 10:00 应关闭但实际开启：10 分钟内不报，超过后进人工待办
view = schedule.view({ nodes });
assert.equal(view.rules.find((rule) => rule.ruleId === "7657").desiredOn, false);
assert.equal(view.rules.find((rule) => rule.ruleId === "7657").inSync, false);
assert.equal(view.issues.length, 0);
clock += 11 * 60000;
schedule.report("node_a", { session: { loggedIn: true }, rules: catalog });
assert.deepEqual(schedule.view({ nodes }).issues.map((issue) => issue.code), ["miaoshou_rule_mismatch", "miaoshou_rule_mismatch"]);

// 节点关掉后恢复一致；事件按 id 去重
const closed = catalog.map((rule) => ({ ...rule, isEnabled: false }));
const events = [{ id: "e1", at: new Date(clock).toISOString(), ruleId: "7657", name: "OZON排单", action: "off", ok: true, trigger: "schedule" }];
schedule.report("node_a", { session: { loggedIn: true }, rules: closed, events });
schedule.report("node_a", { session: { loggedIn: true }, rules: closed, events });
view = schedule.view({ nodes });
assert.equal(view.issues.length, 0);
assert.equal(view.events.length, 1);

// 手动开启：保持到下一个计划时间点（11:00），之后回到时间表
schedule.setOverride("7657", "on", { by: "管理员" });
plan = schedule.planFor("node_a");
assert.equal(plan.rules[0].override.state, "on");
assert.equal(Date.parse(plan.rules[0].override.until), bj("2026-11-12T11:00:00"));
assert.deepEqual(desiredState(plan.rules[0], clock), { on: true, source: "override" });
clock = bj("2026-11-12T23:30:00");
assert.equal(schedule.planFor("node_a").rules[0].override, null);
assert.equal(schedule.view({ nodes }).rules.find((rule) => rule.ruleId === "7657").desiredOn, false);
assert.equal(schedule.view({ nodes }).rules.find((rule) => rule.ruleId === "7658").desiredOn, true);
assert.throws(() => schedule.setOverride("3660", "on"), /还没有托管/);

// 掉登录、节点离线、规则被删
schedule.report("node_a", { session: { loggedIn: false, message: "需要重新登录" } });
view = schedule.view({ nodes });
assert.deepEqual(view.issues.map((issue) => issue.code), ["miaoshou_logged_out"]);
assert.equal(view.rules.length, 3, "掉登录时保留上一次看到的规则清单");
assert.deepEqual(schedule.view({ nodes: [{ ...nodes[0], online: false }] }).issues.map((issue) => issue.code), ["miaoshou_node_offline"]);
schedule.report("node_a", { session: { loggedIn: true }, rules: closed.filter((rule) => rule.ruleId !== "7658") });
assert.ok(schedule.view({ nodes }).issues.some((issue) => issue.code === "miaoshou_rule_missing"));

// 持久化
const reloaded = createMiaoshouRuleSchedule({ filePath: file, now: () => clock });
assert.equal(reloaded.planFor("node_a").rules.length, 2);

console.log("miaoshou-rule-schedule tests passed");

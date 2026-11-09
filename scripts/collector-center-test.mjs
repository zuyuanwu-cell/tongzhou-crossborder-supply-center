import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollectorCenter, normalizeSchedule } from "../server/collector-center.js";

let clock = Date.parse("2026-11-09T06:00:00Z");
const dir = mkdtempSync(join(tmpdir(), "collector-center-"));
const file = join(dir, "collector-center.json");
const center = createCollectorCenter({ filePath: file, now: () => clock, saveDelayMs: 1 });

assert.deepEqual(normalizeSchedule({ enabled: true, times: ["9:30", "21:00", "25:00", "09:30"], lookbackDays: 99 }), { enabled: true, times: ["09:30", "21:00"], lookbackDays: 31 });

// 配对：令牌只存哈希，节点可认证
const { node, token } = center.pairNode({ name: "云电脑-Shopee-1", hostname: "CLOUD-01", platforms: ["Shopee"], version: "0.3.0", pairedBy: "管理员" });
assert.match(token, /^tzcn_[0-9a-f]{48}$/);
assert.ok(!readFileSync(file, "utf8").includes(token), "令牌明文不能落盘");
assert.equal(center.authenticate(token)?.id, node.id);
assert.equal(center.authenticate("tzcn_wrong"), null);
assert.equal(center.listNodes()[0].online, false);

// 心跳：首次用节点本地计划初始化；之后以中台为准
let beat = center.heartbeat(node.id, {
  version: "0.3.0",
  running: false,
  health: { ziniaoCli: true },
  localSchedule: { enabled: true, times: ["08:00"], lookbackDays: 2 },
  stores: [
    { storeId: "1", storeName: "店A", platform: "Shopee", site: "ID", enabled: true, matched: true, shopName: "A" },
    { storeId: "2", storeName: "店B", platform: "Shopee", site: "MY", enabled: true, matched: false },
  ],
});
assert.deepEqual(beat.schedule, { enabled: true, times: ["08:00"], lookbackDays: 2 });
assert.deepEqual(beat.commands, []);
let listed = center.listNodes()[0];
assert.equal(listed.online, true);
assert.equal(listed.enabledStoreCount, 2);
assert.equal(listed.unmatchedStoreCount, 1);

center.updateNode(node.id, { schedule: { enabled: true, times: ["09:30", "21:30"], lookbackDays: 3 } });
beat = center.heartbeat(node.id, { localSchedule: { enabled: false, times: ["07:00"] } });
assert.deepEqual(beat.schedule.times, ["09:30", "21:30"], "中台改过计划后，不再被节点本地计划覆盖");

// 立即采集：命令只下发一次
const command = center.createCommand(node.id, { type: "collect", dates: ["2026-11-07", "2026-11-08", "bad"], createdBy: "管理员" });
assert.deepEqual(command.dates, ["2026-11-07", "2026-11-08"]);
beat = center.heartbeat(node.id, {});
assert.equal(beat.commands.length, 1);
assert.equal(beat.commands[0].id, command.id);
assert.equal(center.heartbeat(node.id, {}).commands.length, 0);

// 运行记录：关联命令、可重试失败店铺
center.recordRun(node.id, { id: "run_1", commandId: command.id, status: "running", startedAt: "2026-11-09T06:01:00Z", dates: ["2026-11-07", "2026-11-08"] });
assert.equal(center.getNode(node.id).commands[0].status, "running");
center.recordRun(node.id, {
  id: "run_1",
  commandId: command.id,
  status: "partial",
  trigger: "command",
  startedAt: "2026-11-09T06:01:00Z",
  finishedAt: "2026-11-09T06:05:00Z",
  dates: ["2026-11-07", "2026-11-08"],
  rowCount: 2,
  stores: [
    { storeId: "1", storeName: "店A", status: "ok", rowCount: 2 },
    { storeId: "2", storeName: "店B", status: "failed", message: "未登录" },
  ],
  upload: { ok: true, written: 2, rowCount: 2, shopCount: 1 },
});
assert.equal(center.getRuns(node.id).length, 1);
assert.equal(center.getNode(node.id).commands[0].status, "done");
assert.equal(center.listNodes()[0].lastRun.failedStores, 1);
const retry = center.retryRun(node.id, "run_1", { createdBy: "管理员" });
assert.deepEqual(retry.storeIds, ["2"]);
assert.deepEqual(retry.dates, ["2026-11-07", "2026-11-08"]);
assert.equal(retry.fromRunId, "run_1");

// 日志：按序号增量读取，超出上限自动截断
center.appendLogs(node.id, [{ level: "info", message: "开始" }, { level: "error", message: "店B 未登录" }]);
const logs = center.getLogs(node.id, { afterSeq: 1 });
assert.equal(logs.lines.length, 1);
assert.equal(logs.lines[0].message, "店B 未登录");
center.appendLogs(node.id, Array.from({ length: 500 }, (_, index) => ({ message: `l${index}` })));
for (let index = 0; index < 7; index += 1) center.appendLogs(node.id, Array.from({ length: 500 }, () => ({ message: "x" })));
assert.equal(center.getLogs(node.id, { limit: 5000 }).lines.length, 2000);

// 离线判断与停用
clock += 4 * 60 * 1000;
assert.equal(center.listNodes()[0].online, false);
center.updateNode(node.id, { disabled: true });
assert.equal(center.authenticate(token), null, "停用后令牌失效");
assert.throws(() => center.createCommand(node.id, { type: "collect" }), /停用/);

// 持久化后重新加载
center.flush();
const reloaded = createCollectorCenter({ filePath: file, now: () => clock });
assert.equal(reloaded.listNodes()[0].name, "云电脑-Shopee-1");
assert.equal(reloaded.getRuns(node.id).length, 1);

// 重新配对：同一节点换新令牌，旧令牌失效
reloaded.updateNode(node.id, { disabled: false });
const again = reloaded.pairNode({ nodeId: node.id, hostname: "CLOUD-01" });
assert.equal(again.node.id, node.id);
assert.equal(reloaded.authenticate(token), null);
assert.equal(reloaded.authenticate(again.token)?.id, node.id);

console.log("collector center tests passed");

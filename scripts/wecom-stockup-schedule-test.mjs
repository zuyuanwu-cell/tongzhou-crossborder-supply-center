import assert from "node:assert/strict";
import { shouldRunStockupDailySchedule, stockupScheduleRetryMs } from "../server/wecom-stockup-schedule.js";

const base = {
  enabled: true,
  triggerMode: "daily",
  recipientCount: 1,
  targetMinute: 11 * 60,
  currentRunKey: "2026-10-19-11:00",
  lastRunKey: "",
  lastAttemptAt: "",
  nowMs: Date.parse("2026-10-19T03:29:00.000Z"),
};

assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 10 * 60 + 59 }), false, "计划时间前不得发送");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 11 * 60 }), true, "计划时间到达后应发送");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 11 * 60 + 29 }), true, "错过两分钟窗口后当天仍应补发");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 23 * 60 + 59 }), true, "当天晚些时候仍应补发一次");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 11 * 60 + 29, enabled: false }), false, "停用场景不得发送");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 11 * 60 + 29, recipientCount: 0 }), false, "无明确接收群不得发送");
assert.equal(shouldRunStockupDailySchedule({ ...base, currentMinute: 11 * 60 + 29, lastRunKey: base.currentRunKey }), false, "当天已执行不得重复发送");
assert.equal(shouldRunStockupDailySchedule({
  ...base,
  currentMinute: 11 * 60 + 29,
  lastAttemptAt: new Date(base.nowMs - stockupScheduleRetryMs + 1_000).toISOString(),
}), false, "发送失败后十分钟内不得频繁重试");
assert.equal(shouldRunStockupDailySchedule({
  ...base,
  currentMinute: 11 * 60 + 29,
  lastAttemptAt: new Date(base.nowMs - stockupScheduleRetryMs).toISOString(),
}), true, "发送失败十分钟后应自动重试");

console.log("wecom stockup schedule tests passed");

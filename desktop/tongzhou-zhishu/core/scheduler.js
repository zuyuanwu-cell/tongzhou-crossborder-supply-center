"use strict";

// 每日定时：按电脑本地时间，在设定的时刻（可多个）触发一次采集。
// 电脑休眠错过时刻时，醒来后 2 小时内仍会补跑一次。

function slotKey(date, time) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${time}`;
}

function dueSlots({ times = [], now = new Date(), done = new Set(), graceMinutes = 120 }) {
  const due = [];
  for (const time of times) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
    if (!match) continue;
    const at = new Date(now);
    at.setHours(Number(match[1]), Number(match[2]), 0, 0);
    const key = slotKey(now, `${match[1].padStart(2, "0")}:${match[2]}`);
    const diff = (now - at) / 60000;
    if (diff >= 0 && diff <= graceMinutes && !done.has(key)) due.push(key);
  }
  return due;
}

class Scheduler {
  constructor({ getSchedule, run, log = () => {}, intervalMs = 30000, state = { done: [] }, saveState = () => {} }) {
    this.getSchedule = getSchedule;
    this.runJob = run;
    this.log = log;
    this.intervalMs = intervalMs;
    this.done = new Set(state.done || []);
    this.saveState = saveState;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => this.log("error", `定时任务出错：${error.message}`)), this.intervalMs);
    setTimeout(() => this.tick().catch(() => {}), 5000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()) {
    const schedule = this.getSchedule();
    if (!schedule?.enabled) return null;
    const due = dueSlots({ times: schedule.times, now, done: this.done });
    if (!due.length) return null;
    for (const key of due) this.done.add(key);
    // 只保留最近 60 个记录。
    this.done = new Set([...this.done].slice(-60));
    this.saveState({ done: [...this.done] });
    this.log("info", `定时采集开始（${due.join("、")}）`);
    return this.runJob(due);
  }
}

module.exports = { Scheduler, dueSlots };

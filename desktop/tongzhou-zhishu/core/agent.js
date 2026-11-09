"use strict";

// 节点代理：让同舟智数作为「采集节点」接受中台采集中心管理。
// - 每分钟心跳：上报状态（在线、紫鸟、店铺、正在采集），领取中台的采集计划和命令；
// - 采集开始 / 结束时上报运行记录；日志批量回传；
// - 中台下发的「立即采集 / 重试」排队执行，不与正在进行的采集冲突。
// 中台连不上时照本地缓存的计划继续采集，恢复后补报运行记录。

const os = require("node:os");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 下一次定时采集时间（本机时区）。 */
function nextRunAt(schedule, now = new Date()) {
  if (!schedule?.enabled || !Array.isArray(schedule.times) || !schedule.times.length) return "";
  const candidates = [];
  for (const time of schedule.times) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(time));
    if (!match) continue;
    for (const offset of [0, 1]) {
      const at = new Date(now);
      at.setDate(at.getDate() + offset);
      at.setHours(Number(match[1]), Number(match[2]), 0, 0);
      if (at > now) candidates.push(at);
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates[0] ? candidates[0].toISOString() : "";
}

class NodeAgent {
  constructor({ store, collector, cli, clientFactory, log = () => {}, runCollect, version = "", intervalMs = 60000, logFlushMs = 15000 }) {
    this.store = store;
    this.collector = collector;
    this.cli = cli;
    this.clientFactory = clientFactory;
    this.log = log;
    this.runCollect = runCollect;
    this.version = version;
    this.intervalMs = intervalMs;
    this.logFlushMs = logFlushMs;
    this.logQueue = [];
    this.pendingRuns = new Map();
    this.commandQueue = [];
    this.timers = [];
    this.lastHeartbeat = null;
    this.lastError = "";
    this.progress = "";
    this.onUnauthorized = null;
    this.onScheduleChanged = null;
  }

  enabled() {
    const config = this.store.get();
    return Boolean(config.node?.id && this.clientFactory().token);
  }

  start() {
    this.stop();
    const tick = () => this.heartbeat().catch(() => {});
    this.timers.push(setInterval(tick, this.intervalMs));
    this.timers.push(setInterval(() => this.flushLogs().catch(() => {}), this.logFlushMs));
    setTimeout(tick, 3000);
  }

  stop() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /** main.js 的 log() 调用：缓存日志，定期批量上传。 */
  queueLog(line) {
    if (line.level === "debug") return;
    this.logQueue.push({ at: line.at, level: line.level, message: String(line.message).slice(0, 1000) });
    if (this.logQueue.length > 2000) this.logQueue.splice(0, this.logQueue.length - 2000);
  }

  setProgress(message) {
    this.progress = String(message || "").slice(0, 200);
  }

  storesForReport() {
    return this.collector.storeOverview().map((store) => {
      const target = store.targets[0] || {};
      return {
        storeId: store.storeId,
        storeName: store.storeName,
        platform: store.platform,
        site: store.site,
        enabled: store.enabled,
        shopName: target.shopName || "",
        shopKey: target.shopKey || "",
        matched: !target.auto || Boolean(target.matched),
        lastStatus: store.last?.status || "",
        lastMessage: store.last?.message || "",
      };
    });
  }

  status() {
    const config = this.store.get();
    const stores = this.storesForReport();
    const running = this.collector.running;
    return {
      version: this.version,
      hostname: os.hostname(),
      platforms: [...new Set(stores.map((store) => store.platform).filter(Boolean))],
      running: Boolean(running),
      currentRun: running ? { id: running.id, startedAt: running.startedAt, progress: this.progress } : null,
      health: { ziniaoCli: Boolean(this.cli.path), ziniaoMessage: this.cli.path ? "" : "没有找到紫鸟 CLI", zhongtai: true },
      stores,
      localSchedule: config.schedule,
      nextRunAt: nextRunAt(config.schedule),
    };
  }

  async heartbeat() {
    if (!this.enabled()) return null;
    const client = this.clientFactory();
    let response;
    try {
      response = await client.agent("heartbeat", this.status());
      this.lastHeartbeat = new Date().toISOString();
      this.lastError = "";
    } catch (error) {
      this.lastError = error.message;
      if (error.status === 401 && this.onUnauthorized) this.onUnauthorized();
      return null;
    }
    this.applySchedule(response.schedule);
    for (const command of response.commands || []) this.enqueue(command);
    await this.flushRuns();
    await this.flushLogs();
    return response;
  }

  applySchedule(schedule) {
    if (!schedule) return;
    const current = this.store.get().schedule;
    const next = { ...current, enabled: Boolean(schedule.enabled), times: schedule.times || current.times, lookbackDays: schedule.lookbackDays || current.lookbackDays, autoUpload: true, managed: true };
    const changed = JSON.stringify([current.enabled, current.times, current.lookbackDays, current.managed]) !== JSON.stringify([next.enabled, next.times, next.lookbackDays, true]);
    if (!changed) return;
    this.store.update((config) => {
      config.schedule = next;
    });
    this.log("info", `中台采集计划已更新：${next.enabled ? `每天 ${next.times.join("、")}，采集最近 ${next.lookbackDays} 天` : "已关闭定时采集"}`);
    if (this.onScheduleChanged) this.onScheduleChanged(next);
  }

  enqueue(command) {
    if (this.commandQueue.some((item) => item.id === command.id)) return;
    this.commandQueue.push(command);
    this.log("info", `收到中台命令：${command.fromRunId ? "重试失败店铺" : command.type === "collect" ? "立即采集" : "刷新店铺"}${command.storeIds ? `（${command.storeIds.length} 个店铺）` : ""}`);
    this.drain().catch(() => {});
  }

  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.commandQueue.length) {
        while (this.collector.running) await sleep(5000);
        const command = this.commandQueue.shift();
        await this.execute(command);
      }
    } finally {
      this.draining = false;
    }
  }

  async execute(command) {
    const client = this.clientFactory();
    const ack = (status, extra = {}) => client.agent(`commands/${encodeURIComponent(command.id)}/ack`, { status, ...extra }).catch(() => null);
    try {
      if (command.type === "refresh-stores") {
        const list = await this.collector.refreshStores();
        await ack("done", { message: `读取到 ${list.length} 个紫鸟店铺` });
        return;
      }
      if (command.type === "collect") {
        await ack("running");
        const result = await this.runCollect({ storeIds: command.storeIds || null, dates: command.dates || null, mode: command.mode || "upload", trigger: "command", commandId: command.id });
        await ack(result.status === "failed" ? "failed" : "done", { runId: result.id, message: `${result.rowCount} 行` });
        return;
      }
      await ack("rejected", { message: "不支持的命令" });
    } catch (error) {
      this.log("error", `执行中台命令失败：${error.message}`);
      await ack("failed", { message: error.message });
    }
  }

  /** 采集开始 / 结束时调用；失败的上报会在下次心跳重试。 */
  reportRun(entry) {
    if (!this.enabled()) return;
    const { rows, ...run } = entry;
    this.pendingRuns.set(run.id, run);
    this.flushRuns().catch(() => {});
  }

  async flushRuns() {
    if (!this.enabled() || !this.pendingRuns.size) return;
    const client = this.clientFactory();
    for (const [id, run] of [...this.pendingRuns.entries()]) {
      try {
        await client.agent("runs", { run });
        if (this.pendingRuns.get(id) === run) this.pendingRuns.delete(id);
      } catch {
        return;
      }
    }
  }

  async flushLogs() {
    if (!this.enabled() || !this.logQueue.length || this.flushingLogs) return;
    this.flushingLogs = true;
    const batch = this.logQueue.splice(0, 500);
    try {
      await this.clientFactory().agent("logs", { lines: batch });
    } catch {
      this.logQueue.unshift(...batch);
    } finally {
      this.flushingLogs = false;
    }
  }
}

module.exports = { NodeAgent, nextRunAt };

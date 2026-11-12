// 接口耗时记录：每个响应带 Server-Timing 头；按接口统计 P50 / P95；慢请求（默认 ≥ 1 秒）进日志和最近列表；
// 同时监测事件循环卡顿（主线程被同步计算或整库写盘阻塞的时长），用于定位「整站一起变慢」。

import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const ID_SEGMENT = /\/(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|\d{2,}|[A-Za-z0-9_-]{20,})(?=\/|$)/g;

/** 把带 ID 的路径归并成同一个接口：/api/collector/nodes/abc123.../runs → /api/collector/nodes/:id/runs */
export function routeKey(method, pathname) {
  return `${String(method || "GET").toUpperCase()} ${String(pathname || "/").replace(ID_SEGMENT, "/:id")}`;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(Number(value) || 0);
}

export function createRequestTiming({ slowMs = 1000, sampleSize = 300, slowLimit = 200, blockLimit = 100, logger = console, now = () => performance.now() } = {}) {
  const routes = new Map();
  const slow = [];
  const blocks = [];
  const startedAt = new Date().toISOString();
  let loopDelay = null;
  try {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  } catch {
    loopDelay = null;
  }

  function record(entry) {
    const key = routeKey(entry.method, entry.path);
    let route = routes.get(key);
    if (!route) {
      route = { key, count: 0, errors: 0, totalMs: 0, maxMs: 0, bytes: 0, rawBytes: 0, samples: [] };
      routes.set(key, route);
    }
    route.count += 1;
    if (entry.status >= 500) route.errors += 1;
    route.totalMs += entry.ms;
    route.maxMs = Math.max(route.maxMs, entry.ms);
    route.bytes += entry.bytes;
    route.rawBytes += entry.rawBytes || entry.bytes;
    route.samples.push(entry.ms);
    if (route.samples.length > sampleSize) route.samples.shift();
    if (entry.ms >= slowMs) {
      slow.unshift({ at: new Date().toISOString(), ...entry, route: key });
      if (slow.length > slowLimit) slow.length = slowLimit;
      const phases = entry.phases.length ? ` ${entry.phases.map((phase) => `${phase.name}=${round(phase.ms)}ms`).join(" ")}` : "";
      logger.warn?.(`[slow] ${entry.method} ${entry.path} ${round(entry.ms)}ms status=${entry.status} bytes=${entry.bytes}${entry.rawBytes ? ` raw=${entry.rawBytes}` : ""}${phases}`);
    }
  }

  /**
   * 请求开始时调用。返回的对象挂在 res.timing 上：
   * - mark(name, ms) 记录一个阶段耗时（出现在 Server-Timing 和慢日志里）
   * - time(name, fn) / timeAsync(name, fn) 计时并返回结果
   * - setRawBytes(n) 记录压缩前大小
   */
  function begin(req, res, pathname) {
    const start = now();
    const phases = [];
    let rawBytes = 0;
    let bytes = 0;
    const timing = {
      mark(name, ms) {
        phases.push({ name: String(name).replace(/[^A-Za-z0-9_-]/g, "_"), ms: Number(ms) || 0 });
      },
      time(name, fn) {
        const t = now();
        try {
          return fn();
        } finally {
          timing.mark(name, now() - t);
        }
      },
      async timeAsync(name, fn) {
        const t = now();
        try {
          return await fn();
        } finally {
          timing.mark(name, now() - t);
        }
      },
      setRawBytes(value) {
        rawBytes = Number(value) || 0;
      },
    };
    res.timing = timing;
    const originalWriteHead = res.writeHead;
    res.writeHead = function writeHeadWithTiming(statusCode, ...args) {
      try {
        const header = [`app;dur=${(now() - start).toFixed(1)}`, ...phases.map((phase) => `${phase.name};dur=${phase.ms.toFixed(1)}`)].join(", ");
        if (!this.headersSent) this.setHeader("Server-Timing", header);
      } catch {
        // 头已发送等情况忽略。
      }
      return originalWriteHead.call(this, statusCode, ...args);
    };
    const originalWrite = res.write;
    const originalEnd = res.end;
    res.write = function writeCounted(chunk, ...args) {
      if (chunk) bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      return originalWrite.call(this, chunk, ...args);
    };
    res.end = function endCounted(chunk, ...args) {
      if (chunk && typeof chunk !== "function") bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      return originalEnd.call(this, chunk, ...args);
    };
    res.once("finish", () => {
      record({ method: req.method, path: pathname, status: res.statusCode, ms: now() - start, bytes, rawBytes, phases });
    });
    return timing;
  }

  /** 记录一次主线程阻塞（例如整库写盘），用于证明卡顿来源。 */
  function recordBlock(name, ms, detail = "") {
    if (ms < 200) return;
    blocks.unshift({ at: new Date().toISOString(), name, ms: round(ms), detail });
    if (blocks.length > blockLimit) blocks.length = blockLimit;
    if (ms >= 1000) logger.warn?.(`[block] ${name} ${round(ms)}ms ${detail}`);
  }

  function snapshot({ limit = 60 } = {}) {
    const list = [...routes.values()].map((route) => {
      const sorted = [...route.samples].sort((a, b) => a - b);
      return {
        route: route.key,
        count: route.count,
        errors: route.errors,
        avgMs: round(route.totalMs / route.count),
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        maxMs: round(route.maxMs),
        avgKb: Math.round((route.bytes / route.count / 1024) * 10) / 10,
        avgRawKb: Math.round((route.rawBytes / route.count / 1024) * 10) / 10,
      };
    }).sort((a, b) => b.p95Ms - a.p95Ms);
    const loop = loopDelay ? {
      p50Ms: round(loopDelay.percentile(50) / 1e6),
      p99Ms: round(loopDelay.percentile(99) / 1e6),
      maxMs: round(loopDelay.max / 1e6),
    } : null;
    return { startedAt, slowThresholdMs: slowMs, eventLoop: loop, routes: list.slice(0, limit), slow: slow.slice(0, limit), blocks: blocks.slice(0, limit) };
  }

  function reset() {
    routes.clear();
    slow.length = 0;
    blocks.length = 0;
    loopDelay?.reset();
  }

  return { begin, record, recordBlock, snapshot, reset };
}

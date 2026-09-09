import { Worker } from "node:worker_threads";

export function createPerformanceAnalyticsQueryService() {
  let active = null;
  let initializing = null;
  let sequence = 0;

  function rejectPending(target, error) {
    for (const pending of target.pending.values()) pending.reject(error);
    target.pending.clear();
  }

  function createTarget(input) {
    const worker = new Worker(new URL("./performance-query-worker.js", import.meta.url), {
      execArgv: process.execArgv.filter((argument) => !argument.startsWith("--input-type")),
    });
    const target = {
      worker,
      dataVersion: input.dataVersion,
      pending: new Map(),
      ready: null,
      resolveReady: null,
      rejectReady: null,
      factCount: 0,
    };
    target.ready = new Promise((resolve, reject) => {
      target.resolveReady = resolve;
      target.rejectReady = reject;
    });
    worker.on("message", (message = {}) => {
      if (message.type === "ready") {
        target.factCount = Number(message.factCount || 0);
        target.resolveReady(target);
        return;
      }
      if (message.type === "initialization-error") {
        target.rejectReady(new Error(message.message || "经营分析快照读取失败"));
        return;
      }
      const pending = target.pending.get(message.id);
      if (!pending) return;
      target.pending.delete(message.id);
      if (message.type === "error") pending.reject(new Error(message.message || "经营贡献筛选失败"));
      else pending.resolve(message);
    });
    worker.once("error", (error) => {
      target.rejectReady(error);
      rejectPending(target, error);
      if (active === target) active = null;
      if (initializing === target) initializing = null;
    });
    worker.once("exit", (code) => {
      if (code === 0) return;
      const error = new Error(`经营贡献筛选线程异常退出：${code}`);
      target.rejectReady(error);
      rejectPending(target, error);
      if (active === target) active = null;
      if (initializing === target) initializing = null;
    });
    worker.postMessage({
      type: "initialize",
      dataVersion: input.dataVersion,
      facts: Array.isArray(input.materializedFacts) ? input.materializedFacts : undefined,
      cachePath: input.cachePath || "",
      exchangeRates: input.exchangeRates || [],
      packagingFeeRules: input.packagingFeeRules || [],
    });
    return target;
  }

  async function ensure(input) {
    if (active?.dataVersion === input.dataVersion) return active;
    if (initializing?.dataVersion === input.dataVersion) return initializing.ready;
    if (initializing) {
      await initializing.worker.terminate();
      initializing = null;
    }
    const target = createTarget(input);
    initializing = target;
    try {
      await target.ready;
      const previous = active;
      active = target;
      initializing = null;
      if (previous && previous !== target) await previous.worker.terminate();
      return target;
    } catch (error) {
      if (initializing === target) initializing = null;
      await target.worker.terminate().catch(() => {});
      throw error;
    }
  }

  async function query(input) {
    const target = await ensure(input);
    const id = ++sequence;
    const result = new Promise((resolve, reject) => target.pending.set(id, { resolve, reject }));
    target.worker.postMessage({
      type: "query",
      id,
      filters: input.filters || {},
      scopes: input.scopes || {},
      limits: input.limits || {},
    });
    return result;
  }

  async function close() {
    const targets = [...new Set([active, initializing].filter(Boolean))];
    active = null;
    initializing = null;
    await Promise.all(targets.map(async (target) => {
      rejectPending(target, new Error("经营贡献筛选服务已关闭"));
      await target.worker.terminate();
    }));
  }

  return { query, close };
}

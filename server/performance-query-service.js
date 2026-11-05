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
      partitioned: Boolean(input.partitionDir),
      refreshing: null,
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
      if (message.type === "refreshed" || message.type === "refresh-error") {
        const refreshing = target.refreshing;
        target.refreshing = null;
        if (!refreshing) return;
        if (message.type === "refreshed") {
          target.dataVersion = message.dataVersion;
          target.factCount = Number(message.factCount || 0);
          target.lastRefresh = message.stats || null;
          refreshing.resolve(target);
        } else refreshing.reject(new Error(message.message || "经营分析分区刷新失败"));
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
      partitionDir: input.partitionDir || "",
      exchangeRates: input.exchangeRates || [],
      packagingFeeRules: input.packagingFeeRules || [],
    });
    return target;
  }

  // 分区模式下复用同一个查询线程：新版本只重新读取变化的分区，不再整份重载。
  function refresh(target, input) {
    if (target.refreshing?.dataVersion === input.dataVersion) return target.refreshing.promise;
    const entry = { dataVersion: input.dataVersion };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    target.refreshing = entry;
    target.worker.postMessage({
      type: "refresh",
      dataVersion: input.dataVersion,
      partitionDir: input.partitionDir || "",
      exchangeRates: input.exchangeRates || [],
      packagingFeeRules: input.packagingFeeRules || [],
    });
    return entry.promise;
  }

  async function ensure(input) {
    if (active?.dataVersion === input.dataVersion) return active;
    if (active?.partitioned && input.partitionDir && !initializing) {
      try {
        return await refresh(active, input);
      } catch {
        // 刷新失败时退回重新创建线程。
      }
    }
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
      queryType: input.queryType || "performance",
      onlyRussia: input.onlyRussia !== false,
      scope: input.scope || "",
      params: input.params || {},
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

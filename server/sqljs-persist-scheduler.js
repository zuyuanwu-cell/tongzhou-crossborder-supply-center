// sql.js 的数据库都在内存里，保存时要把整个库导出再写盘，期间整个进程（所有接口）都在等。
// 写入频繁的大库改为「合并写盘」：标记有改动，延迟一段时间统一写一次；退出前、备份前一定会写完。

const schedulers = new Set();
let blockReporter = null;

/** 写盘耗时上报（接入接口耗时记录里的「主线程阻塞」）。 */
export function setPersistBlockReporter(reporter) {
  blockReporter = typeof reporter === "function" ? reporter : null;
}

/**
 * persistNow：真正写盘的函数（同步）。
 * delayMs：最长合并多久。设为 0 表示立即写（与原来行为一致）。
 */
export function createPersistScheduler({ name, persistNow, delayMs = 5000, logger = console } = {}) {
  let timer = null;
  let dirty = false;
  let lastDurationMs = 0;
  let lastPersistAt = "";
  let failures = 0;

  function run() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    const started = Date.now();
    try {
      persistNow();
      failures = 0;
      lastPersistAt = new Date().toISOString();
    } catch (error) {
      dirty = true;
      failures += 1;
      logger.error?.(`[sqljs] ${name} 写盘失败（第 ${failures} 次）`, error);
      if (!timer && failures < 5) {
        timer = setTimeout(run, Math.max(1000, delayMs));
        timer.unref?.();
      }
    } finally {
      lastDurationMs = Date.now() - started;
      blockReporter?.(`persist:${name}`, lastDurationMs);
    }
  }

  const handle = {
    name,
    /** 标记有改动；delayMs 内的多次改动合并成一次写盘。 */
    request() {
      dirty = true;
      if (delayMs <= 0) {
        run();
        return;
      }
      if (!timer) {
        timer = setTimeout(run, delayMs);
        timer.unref?.();
      }
    },
    /** 立即把未写的改动写盘（退出、备份、日终快照前调用）。 */
    flush() {
      run();
    },
    status() {
      return { name, pending: dirty, delayMs, lastDurationMs, lastPersistAt, failures };
    },
  };
  schedulers.add(handle);
  return handle;
}

/** 把所有库未写的改动写盘。返回写了哪些库。 */
export function flushAllPersistSchedulers() {
  const flushed = [];
  for (const scheduler of schedulers) {
    if (scheduler.status().pending) {
      scheduler.flush();
      flushed.push(scheduler.name);
    }
  }
  return flushed;
}

export function persistSchedulerStatus() {
  return [...schedulers].map((scheduler) => scheduler.status());
}

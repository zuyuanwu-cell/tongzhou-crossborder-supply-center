import {
  miaoshouAfterSalesRowCount,
  normalizeMiaoshouCancellations,
  normalizeMiaoshouPackages,
  normalizeMiaoshouReturns,
} from "./miaoshou-performance.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const FULL_AFTER_SALES_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function dateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function addDays(value, days) {
  const date = new Date(`${dateKey(value)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function windows(dateFrom, dateTo, chunkDays) {
  const result = [];
  let cursor = dateFrom;
  while (cursor <= dateTo) {
    const end = addDays(cursor, chunkDays - 1);
    result.push({ dateFrom: cursor, dateTo: end < dateTo ? end : dateTo });
    cursor = addDays(result[result.length - 1].dateTo, 1);
  }
  return result;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function dedupe(rows, key = "identity") {
  const map = new Map();
  for (const row of rows) {
    const identity = text(row?.[key]);
    if (identity) map.set(identity, { ...(map.get(identity) || {}), ...row });
  }
  return [...map.values()];
}

function rangeInput(range) {
  return {
    gmtStartFrom: `${range.dateFrom} 00:00:00`,
    gmtStartTo: `${range.dateTo} 23:59:59`,
  };
}

export function createMiaoshouPerformanceSyncService({
  connector,
  store,
  intervalMs = 15 * 60 * 1000,
  incrementalLookbackDays = 3,
  initialBackfillDays = 90,
  chunkDays = 7,
  now = () => new Date(),
} = {}) {
  if (!connector || !store) throw new Error("妙手经营同步缺少 connector 或 store");
  let running = false;

  function status() {
    return {
      enabled: connector.performanceContext().hasCredentials,
      running,
      intervalMinutes: Math.round(intervalMs / 60_000),
      incrementalLookbackDays,
      initialBackfillDays,
      ...store.getMiaoshouPerformanceSyncState(),
    };
  }

  async function fetchPackagePages(input) {
    const collected = { orders: [], items: [], packageCount: 0, pages: 0 };
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = await connector.searchPerformancePackages({ ...input, page, pageSize: PAGE_SIZE });
      const normalized = normalizeMiaoshouPackages(payload);
      collected.orders.push(...normalized.orders);
      collected.items.push(...normalized.items);
      collected.packageCount += normalized.packageCount;
      collected.pages += 1;
      if (normalized.sourceRowCount < PAGE_SIZE) break;
      if (page === MAX_PAGES) throw new Error("妙手包裹接口达到 200 页安全上限，请缩短同步日期范围");
    }
    return collected;
  }

  async function fetchAfterSalesPages(kind, input) {
    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const payload = kind === "return"
        ? await connector.searchPerformanceReturns({ ...input, page, pageSize: PAGE_SIZE })
        : await connector.searchPerformanceCancellations({ ...input, page, pageSize: PAGE_SIZE });
      const normalized = kind === "return" ? normalizeMiaoshouReturns(payload) : normalizeMiaoshouCancellations(payload);
      rows.push(...normalized);
      if (miaoshouAfterSalesRowCount(payload, kind) < PAGE_SIZE) break;
      if (page === MAX_PAGES) throw new Error(`妙手${kind === "return" ? "退款" : "取消"}接口达到 200 页安全上限，请缩短同步日期范围`);
    }
    return rows;
  }

  async function run({ dateFrom = "", dateTo = "", days = 0, reason = "manual", force = false } = {}) {
    if (running) return { ...status(), skipped: true, message: "妙手经营数据同步正在运行" };
    const context = connector.performanceContext();
    if (!context.hasCredentials) throw new Error("请先配置妙手 AppKey / AppSecret");
    if (!context.shops.length) throw new Error("妙手店铺目录为空，请先同步店铺");
    const current = status();
    if (!force && reason === "scheduled" && current.lastAttemptAt) {
      const elapsed = now().getTime() - Date.parse(current.lastAttemptAt);
      if (Number.isFinite(elapsed) && elapsed < intervalMs) return { ...current, skipped: true, message: "尚未到妙手经营数据同步时间" };
    }

    const today = now().toISOString().slice(0, 10);
    const fallbackDays = (current.lastSuccessAt || current.lastCompletedAt) ? incrementalLookbackDays : initialBackfillDays;
    const requestedDays = Number(days) > 0 ? clamp(days, 1, 365, fallbackDays) : fallbackDays;
    const safeDateTo = dateKey(dateTo) || today;
    const safeDateFrom = dateKey(dateFrom) || addDays(safeDateTo, -(requestedDays - 1));
    if (safeDateFrom > safeDateTo) throw new Error("妙手经营数据同步开始日期不能晚于结束日期");
    const startedAt = now().toISOString();
    running = true;
    store.setMiaoshouPerformanceSyncState({
      ...current,
      status: "running",
      lastAttemptAt: startedAt,
      lastReason: reason,
      dateFrom: safeDateFrom,
      dateTo: safeDateTo,
      lastError: "",
    });

    try {
      const orders = [];
      const items = [];
      const returns = [];
      const cancellations = [];
      const warnings = [];
      let afterSalesWarningCount = 0;
      let packageCount = 0;
      let packagePages = 0;
      const shopGroups = new Map();
      for (const shop of context.shops) {
        const platform = text(shop.platform);
        if (!platform) continue;
        const list = shopGroups.get(platform) || [];
        list.push(text(shop.shopId));
        shopGroups.set(platform, list);
      }
      const syncWindows = windows(safeDateFrom, safeDateTo, clamp(chunkDays, 1, 31, 7));
      for (const range of syncWindows) {
        for (const [platform, shopIds] of shopGroups) {
          for (const shopBatch of chunks(shopIds, 100)) {
            const result = await fetchPackagePages({
              platform,
              shopIds: shopBatch,
              gmtModifiedFrom: `${range.dateFrom} 00:00:00`,
              gmtModifiedTo: `${range.dateTo} 23:59:59`,
            });
            orders.push(...result.orders);
            items.push(...result.items);
            packageCount += result.packageCount;
            packagePages += result.pages;
          }
        }
      }

      // The after-sales APIs filter by creation time, not modification time.
      // A refund opened several days ago can become final today, so a short
      // incremental window alone would leave its status stale forever. Refresh
      // the full analytics horizon once a day; keep the 3-day window between
      // those sweeps to protect API latency and quota.
      const lastFullSweepAt = Date.parse(text(current.lastAfterSalesFullSweepAt));
      const fullAfterSalesSweep = reason === "scheduled"
        && (!Number.isFinite(lastFullSweepAt) || now().getTime() - lastFullSweepAt >= FULL_AFTER_SALES_SWEEP_INTERVAL_MS);
      const afterSalesDateFrom = fullAfterSalesSweep
        ? addDays(safeDateTo, -(initialBackfillDays - 1))
        : safeDateFrom;
      const afterSalesWindows = windows(afterSalesDateFrom, safeDateTo, clamp(chunkDays, 1, 31, 7));
      for (const range of afterSalesWindows) {
        for (const [platform] of shopGroups) {
          try {
            returns.push(...await fetchAfterSalesPages("return", { platform, ...rangeInput(range) }));
          } catch (error) {
            afterSalesWarningCount += 1;
            warnings.push(`${platform} 退款同步失败：${error?.message || error}`);
          }
          try {
            cancellations.push(...await fetchAfterSalesPages("cancellation", { platform, ...rangeInput(range) }));
          } catch (error) {
            afterSalesWarningCount += 1;
            warnings.push(`${platform} 取消单同步失败：${error?.message || error}`);
          }
        }
      }
      const snapshot = {
        orders: dedupe(orders),
        items: dedupe(items),
        returns: dedupe(returns),
        cancellations: dedupe(cancellations),
      };
      const completedAt = now().toISOString();
      const nextState = {
        status: warnings.length ? "partial" : "success",
        lastAttemptAt: startedAt,
        lastSuccessAt: warnings.length ? text(current.lastSuccessAt) : completedAt,
        lastCompletedAt: completedAt,
        lastReason: reason,
        dateFrom: safeDateFrom,
        dateTo: safeDateTo,
        afterSalesDateFrom,
        afterSalesDateTo: safeDateTo,
        lastAfterSalesFullSweepAt: fullAfterSalesSweep && afterSalesWarningCount === 0
          ? completedAt
          : text(current.lastAfterSalesFullSweepAt),
        packageCount,
        packagePages,
        orderCount: snapshot.orders.length,
        itemCount: snapshot.items.length,
        returnCount: snapshot.returns.length,
        cancellationCount: snapshot.cancellations.length,
        warningCount: warnings.length,
        warnings: warnings.slice(0, 20),
        lastError: "",
        shopsSyncedAt: context.shopsSyncedAt,
      };
      store.upsertMiaoshouPerformance(snapshot, nextState);
      return { ...status(), skipped: false, message: warnings.length ? "交易已同步，但售后接口存在缺口，暂不允许切换正式口径" : "妙手交易与售后同步完成" };
    } catch (error) {
      const failedAt = now().toISOString();
      store.setMiaoshouPerformanceSyncState({
        ...store.getMiaoshouPerformanceSyncState(),
        status: "failed",
        lastCompletedAt: failedAt,
        lastError: error?.message || String(error),
      });
      throw error;
    } finally {
      running = false;
    }
  }

  async function runScheduled() {
    if (running || !connector.performanceContext().hasCredentials) return null;
    try {
      return await run({ reason: "scheduled" });
    } catch (error) {
      console.error(`[miaoshou-performance] ${error?.message || error}`);
      return null;
    }
  }

  function start(input = {}) {
    const context = connector.performanceContext();
    if (!context.hasCredentials) throw new Error("请先配置妙手 AppKey / AppSecret");
    if (!context.shops.length) throw new Error("妙手店铺目录为空，请先同步店铺");
    if (running) return { started: false, completion: null, state: status() };
    const completion = run(input);
    return { started: true, completion, state: status() };
  }

  return { run, runScheduled, start, status };
}

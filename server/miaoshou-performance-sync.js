import {
  miaoshouAfterSalesRowCount,
  normalizeMiaoshouCancellations,
  normalizeMiaoshouPackages,
  normalizeMiaoshouReturns,
} from "./miaoshou-performance.js";
import { queryMiaoshouShopBatches } from "./miaoshou-shop-query.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const FULL_AFTER_SALES_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// 按修改时间游标增量同步时，向前重叠一段时间，避免边界上的订单被漏掉。
const CURSOR_OVERLAP_MS = 10 * 60 * 1000;
// 包裹接口单次查询超过 200 页时，把时间窗口对半拆分，最小拆到 1 小时。
const MIN_SPLIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_AFTER_SALES_GAPS = 60;

class PageLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "PageLimitError";
  }
}

function parseNaive(dateTimeText) {
  const match = text(dateTimeText).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

function formatNaive(milliseconds) {
  const date = new Date(milliseconds);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function shiftNaive(dateTimeText, deltaMs) {
  const value = parseNaive(dateTimeText);
  return Number.isFinite(value) ? formatNaive(value + deltaMs) : dateTimeText;
}

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

function dedupe(rows, key = "identity") {
  const map = new Map();
  for (const row of rows) {
    const identity = text(row?.[key]);
    if (identity) map.set(identity, { ...(map.get(identity) || {}), ...row });
  }
  return [...map.values()];
}

function zonedDateTimeParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedDateTime(value, timeZone) {
  const parts = zonedDateTimeParts(value, timeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dateTime: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function rangeEndDateTime(date, currentClock) {
  return date === currentClock.date ? currentClock.dateTime : `${date} 23:59:59`;
}

function rangeInput(range, currentClock) {
  return {
    gmtStartFrom: `${range.dateFrom} 00:00:00`,
    gmtStartTo: rangeEndDateTime(range.dateTo, currentClock),
  };
}

export function createMiaoshouPerformanceSyncService({
  connector,
  store,
  intervalMs = 15 * 60 * 1000,
  incrementalLookbackDays = 3,
  initialBackfillDays = 90,
  chunkDays = 7,
  afterSalesIntervalMs = 30 * 60 * 1000,
  timeZone = "Asia/Shanghai",
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

  async function fetchPackageRange(input) {
    try {
      return await fetchPackagePages(input);
    } catch (error) {
      if (!(error instanceof PageLimitError)) throw error;
      const from = parseNaive(input.gmtModifiedFrom);
      const to = parseNaive(input.gmtModifiedTo);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to - from <= MIN_SPLIT_WINDOW_MS) throw error;
      const middle = from + Math.floor((to - from) / 2 / 1000) * 1000;
      const left = await fetchPackageRange({ ...input, gmtModifiedFrom: formatNaive(from), gmtModifiedTo: formatNaive(middle) });
      const right = await fetchPackageRange({ ...input, gmtModifiedFrom: formatNaive(middle + 1000), gmtModifiedTo: formatNaive(to) });
      return {
        orders: [...left.orders, ...right.orders],
        items: [...left.items, ...right.items],
        packageCount: left.packageCount + right.packageCount,
        pages: left.pages + right.pages,
        splits: (left.splits || 0) + (right.splits || 0) + 1,
      };
    }
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
      if (page === MAX_PAGES) throw new PageLimitError("妙手包裹接口达到 200 页安全上限，已无法继续拆分时间窗口");
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

    const runNow = now();
    const currentClock = zonedDateTime(runNow, timeZone);
    const today = currentClock.date;
    const fallbackDays = (current.lastSuccessAt || current.lastCompletedAt) ? incrementalLookbackDays : initialBackfillDays;
    const requestedDays = Number(days) > 0 ? clamp(days, 1, 365, fallbackDays) : fallbackDays;
    const requestedDateTo = dateKey(dateTo) || today;
    const safeDateTo = requestedDateTo > today ? today : requestedDateTo;
    const safeDateFrom = dateKey(dateFrom) || addDays(safeDateTo, -(requestedDays - 1));
    if (safeDateFrom > safeDateTo) throw new Error("妙手经营数据同步开始日期不能晚于结束日期");
    const startedAt = runNow.toISOString();
    const explicitRange = Boolean(dateKey(dateFrom) || dateKey(dateTo) || Number(days) > 0);
    const cursor = text(current.modifiedCursor);
    const cursorDate = cursor.slice(0, 10);
    // 定时任务且有游标时，只拉游标之后修改过的包裹；游标过旧（超过回看天数）时退回按天回看。
    const useCursor = !explicitRange
      && reason === "scheduled"
      && Number.isFinite(parseNaive(cursor))
      && cursorDate >= addDays(today, -(incrementalLookbackDays - 1));
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
      const invalidShopIds = new Set();
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
      const packageRanges = useCursor
        ? [{ from: shiftNaive(cursor, -CURSOR_OVERLAP_MS), to: currentClock.dateTime }]
        : windows(safeDateFrom, safeDateTo, clamp(chunkDays, 1, 31, 7))
          .map((range) => ({ from: `${range.dateFrom} 00:00:00`, to: rangeEndDateTime(range.dateTo, currentClock) }));
      let windowSplits = 0;
      for (const range of packageRanges) {
        for (const [platform, shopIds] of shopGroups) {
          const queryResult = await queryMiaoshouShopBatches({
            shopIds: shopIds.filter((shopId) => !invalidShopIds.has(shopId)),
            request: (shopBatch) => fetchPackageRange({
              platform,
              shopIds: shopBatch,
              gmtModifiedFrom: range.from,
              gmtModifiedTo: range.to,
            }),
            onInvalidShop: ({ shopId, reason }) => {
              invalidShopIds.add(shopId);
              connector.invalidatePerformanceShop?.(shopId, reason);
            },
          });
          if (queryResult.invalidShops.length) {
            warnings.push(`${platform} 已隔离 ${queryResult.invalidShops.length} 家失效店铺：${queryResult.invalidShops.map((shop) => shop.shopId).join("、")}`);
          }
          for (const batchResult of queryResult.results) {
            const result = batchResult.value;
            if (!result) continue;
            orders.push(...result.orders);
            items.push(...result.items);
            packageCount += result.packageCount;
            packagePages += result.pages;
            windowSplits += result.splits || 0;
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
      // 售后接口按创建时间过滤，成本较高：定时任务按独立节奏（默认 30 分钟）执行，
      // 订单快车道（默认 5 分钟）之间不重复拉取；手动同步、每日全量校正和待补缺口不受限制。
      const previousGaps = (Array.isArray(current.afterSalesGaps) ? current.afterSalesGaps : [])
        .filter((gap) => gap && dateKey(gap.dateFrom) && dateKey(gap.dateTo) && text(gap.platform) && ["return", "cancellation"].includes(gap.kind));
      const lastAfterSalesAt = Date.parse(text(current.lastAfterSalesAt));
      const afterSalesDue = force
        || reason !== "scheduled"
        || fullAfterSalesSweep
        || previousGaps.length > 0
        || !Number.isFinite(lastAfterSalesAt)
        || now().getTime() - lastAfterSalesAt >= afterSalesIntervalMs;
      const afterSalesTasks = [];
      if (afterSalesDue) {
        for (const range of windows(afterSalesDateFrom, safeDateTo, clamp(chunkDays, 1, 31, 7))) {
          for (const [platform] of shopGroups) {
            afterSalesTasks.push({ kind: "return", platform, ...range });
            afterSalesTasks.push({ kind: "cancellation", platform, ...range });
          }
        }
        // 上次失败的窗口如果不在本次范围内，单独补拉。
        for (const gap of previousGaps) {
          const covered = afterSalesTasks.some((task) => task.kind === gap.kind && task.platform === gap.platform
            && task.dateFrom <= gap.dateFrom && task.dateTo >= gap.dateTo);
          if (!covered) afterSalesTasks.push({ kind: gap.kind, platform: gap.platform, dateFrom: gap.dateFrom, dateTo: gap.dateTo });
        }
      }
      const nextGaps = [];
      for (const task of afterSalesTasks) {
        try {
          const rows = await fetchAfterSalesPages(task.kind, { platform: task.platform, ...rangeInput(task, currentClock) });
          if (task.kind === "return") returns.push(...rows);
          else cancellations.push(...rows);
        } catch (error) {
          afterSalesWarningCount += 1;
          const message = error?.message || String(error);
          nextGaps.push({ kind: task.kind, platform: task.platform, dateFrom: task.dateFrom, dateTo: task.dateTo, error: message.slice(0, 200), failedAt: now().toISOString() });
          warnings.push(`${task.platform} ${task.kind === "return" ? "退款" : "取消单"}同步失败（${task.dateFrom}~${task.dateTo}）：${message}`);
        }
      }
      const afterSalesGaps = afterSalesDue ? nextGaps.slice(0, MAX_AFTER_SALES_GAPS) : previousGaps;
      const snapshot = {
        orders: dedupe(orders),
        items: dedupe(items),
        returns: dedupe(returns),
        cancellations: dedupe(cancellations),
      };
      const completedAt = now().toISOString();
      const packageWarningCount = warnings.length - afterSalesWarningCount;
      // 游标只在定时增量或覆盖到当前时刻的同步成功后前移。
      const coversNow = safeDateTo === today;
      const modifiedCursor = (useCursor || (coversNow && (!cursor || safeDateFrom <= cursorDate || !Number.isFinite(parseNaive(cursor)))))
        ? currentClock.dateTime
        : cursor;
      const nextState = {
        // 订单部分成功即记为成功；售后缺口单独记录并在后续同步中补齐，不再拖累订单口径。
        status: packageWarningCount ? "partial" : "success",
        afterSalesStatus: afterSalesGaps.length ? "partial" : "success",
        afterSalesGaps,
        lastAfterSalesAt: afterSalesDue ? completedAt : text(current.lastAfterSalesAt),
        afterSalesSkipped: !afterSalesDue,
        modifiedCursor,
        incrementalMode: useCursor ? "cursor" : "window",
        packageFrom: packageRanges[0]?.from || "",
        packageTo: packageRanges.at(-1)?.to || "",
        windowSplits,
        lastAttemptAt: startedAt,
        lastSuccessAt: completedAt,
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

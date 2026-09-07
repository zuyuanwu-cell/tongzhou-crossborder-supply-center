export const DEFAULT_OUTSOURCING_CACHE_TTL_MS = 5 * 60 * 1000;

function validTime(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

export function shouldRefreshOutsourcingCache(payload, {
  now = new Date(),
  ttlMs = DEFAULT_OUTSOURCING_CACHE_TTL_MS,
} = {}) {
  const syncedAt = validTime(payload?.syncedAt);
  if (!syncedAt) return true;
  return Math.max(0, new Date(now).getTime() - syncedAt) >= Math.max(0, Number(ttlMs) || 0);
}

export function outsourcingCacheState(payload, {
  now = new Date(),
  ttlMs = DEFAULT_OUTSOURCING_CACHE_TTL_MS,
  refreshing = false,
  refreshStartedAt = "",
} = {}) {
  return {
    outsourcingRefreshing: Boolean(refreshing),
    outsourcingCacheStale: shouldRefreshOutsourcingCache(payload, { now, ttlMs }),
    outsourcingRefreshStartedAt: refreshing ? String(refreshStartedAt || "") : "",
  };
}

export function createSingleFlight(task) {
  let current = null;

  return {
    run(...args) {
      if (current) return current;
      let result;
      try {
        result = task(...args);
      } catch (error) {
        result = Promise.reject(error);
      }
      const settled = Promise.resolve(result).finally(() => {
        if (current === settled) current = null;
      });
      current = settled;
      return current;
    },
    active() {
      return Boolean(current);
    },
  };
}

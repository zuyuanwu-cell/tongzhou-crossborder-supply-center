import assert from "node:assert/strict";
import {
  createSingleFlight,
  outsourcingCacheState,
  shouldRefreshOutsourcingCache,
} from "../server/outsourcing-cache-policy.js";

const now = new Date("2026-09-07T12:00:00.000Z");
const fresh = { syncedAt: "2026-09-07T11:57:00.000Z", orders: [{ id: "1" }] };
const stale = { syncedAt: "2026-09-07T11:50:00.000Z", orders: [{ id: "1" }] };

assert.equal(shouldRefreshOutsourcingCache(fresh, { now, ttlMs: 5 * 60_000 }), false);
assert.equal(shouldRefreshOutsourcingCache(stale, { now, ttlMs: 5 * 60_000 }), true);
assert.equal(shouldRefreshOutsourcingCache({ syncedAt: "", orders: [] }, { now, ttlMs: 5 * 60_000 }), true);

let calls = 0;
let resolveRefresh;
const gate = new Promise((resolve) => { resolveRefresh = resolve; });
const refresh = createSingleFlight(async () => {
  calls += 1;
  await gate;
  return { ok: true };
});
const first = refresh.run();
const second = refresh.run();
assert.equal(first, second, "并发刷新应共享同一个任务");
assert.equal(calls, 1);
assert.equal(refresh.active(), true);
resolveRefresh();
await first;
assert.equal(refresh.active(), false);

assert.deepEqual(
  outsourcingCacheState(stale, { now, ttlMs: 5 * 60_000, refreshing: true, refreshStartedAt: "2026-09-07T11:59:00.000Z" }),
  {
    outsourcingRefreshing: true,
    outsourcingCacheStale: true,
    outsourcingRefreshStartedAt: "2026-09-07T11:59:00.000Z",
  },
);

console.log("outsourcing cache policy tests passed");

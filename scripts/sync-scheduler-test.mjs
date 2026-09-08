import assert from "node:assert/strict";
import { createSyncScheduler } from "../server/sync-scheduler.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
}

let clock = Date.parse("2026-09-09T00:00:00.000Z");
const staggeredRuns = [];
const staggered = createSyncScheduler({
  now: () => new Date(clock),
  random: () => 0,
  persist: () => {},
});
staggered.register({ id: "first", label: "First", intervalMs: 60_000, initialDelayMs: 1_000, run: async () => staggeredRuns.push("first") });
staggered.register({ id: "second", label: "Second", intervalMs: 60_000, initialDelayMs: 2_000, run: async () => staggeredRuns.push("second") });

await staggered.tick();
await flush();
assert.deepEqual(staggeredRuns, [], "tasks should respect their startup offsets");
clock += 1_000;
await staggered.tick();
await flush();
assert.deepEqual(staggeredRuns, ["first"], "only the first due task should start");
clock += 1_000;
await staggered.tick();
await flush();
assert.deepEqual(staggeredRuns, ["first", "second"], "the second task should start at its own offset");

clock = Date.parse("2026-09-09T01:00:00.000Z");
const gate = deferred();
const laneRuns = [];
const lanes = createSyncScheduler({ now: () => new Date(clock), random: () => 0, persist: () => {}, laneLimits: { external: 1 } });
lanes.register({ id: "heavy-a", label: "Heavy A", lane: "external", priority: 10, intervalMs: 60_000, run: async () => { laneRuns.push("a"); await gate.promise; } });
lanes.register({ id: "heavy-b", label: "Heavy B", lane: "external", priority: 1, intervalMs: 60_000, run: async () => laneRuns.push("b") });
await lanes.tick();
await flush();
assert.deepEqual(laneRuns, ["a"], "only one task may occupy the external lane");
await lanes.tick();
await flush();
assert.deepEqual(laneRuns, ["a"], "a second heartbeat must not overlap the heavy task");
gate.resolve();
await lanes.waitForIdle();
await lanes.tick();
await flush();
assert.deepEqual(laneRuns, ["a", "b"], "the queued due task should start after the lane is released");

clock = Date.parse("2026-09-09T01:30:00.000Z");
const rerunGate = deferred();
let rerunCount = 0;
const reruns = createSyncScheduler({ now: () => new Date(clock), random: () => 0, persist: () => {} });
reruns.register({ id: "workflow", label: "Workflow", intervalMs: 60_000, run: async () => { rerunCount += 1; if (rerunCount === 1) await rerunGate.promise; } });
await reruns.tick();
await flush();
const queuedRerun = await reruns.trigger("workflow");
assert.equal(queuedRerun.reason, "queued", "triggering a running task should queue one follow-up run");
rerunGate.resolve();
await reruns.waitForIdle();
await reruns.tick();
await reruns.waitForIdle();
assert.equal(rerunCount, 2, "a queued mutation refresh should run after the active refresh completes");

clock = Date.parse("2026-09-09T02:00:00.000Z");
const failure = createSyncScheduler({ now: () => new Date(clock), random: () => 0, persist: () => {}, retryBaseMs: 60_000 });
failure.register({ id: "failing", label: "Failing", intervalMs: 30 * 60_000, run: async () => { throw new Error("provider unavailable"); } });
await failure.tick();
await failure.waitForIdle();
const failedTask = failure.status().tasks.find((task) => task.id === "failing");
assert.equal(failedTask.failureCount, 1);
assert.equal(failedTask.lastError, "provider unavailable");
assert.equal(failedTask.nextRunAt, new Date(clock + 60_000).toISOString(), "first failure should retry after one minute");

clock = Date.parse("2026-09-09T03:00:00.000Z");
const restoredNextRunAt = new Date(clock + 25 * 60_000).toISOString();
const restored = createSyncScheduler({
  now: () => new Date(clock),
  random: () => 0,
  persist: () => {},
  restoredState: {
    tasks: {
      products: {
        lastSuccessAt: "2026-09-09T02:00:00.000Z",
        nextRunAt: restoredNextRunAt,
        failureCount: 0,
      },
    },
  },
});
restored.register({ id: "products", label: "Products", intervalMs: 60 * 60_000, initialDelayMs: 5_000, run: async () => {} });
assert.equal(restored.status().tasks[0].nextRunAt, restoredNextRunAt, "a future persisted schedule should survive restart");

console.log("sync scheduler tests passed");

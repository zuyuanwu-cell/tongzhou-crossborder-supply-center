import assert from "node:assert/strict";
import { recoverInterruptedOrderSyncJobs } from "../server/order-sync-job-state.js";

const store = {
  jobs: [
    {
      id: "running-job",
      status: "running",
      currentWarehouseId: "warehouse-a",
      currentWarehouseName: "A 仓",
      currentChunkLabel: "2026-09-01 ~ 2026-09-07",
      chunks: [
        { warehouseId: "warehouse-a", status: "completed" },
        { warehouseId: "warehouse-a", status: "running" },
      ],
    },
    { id: "queued-job", status: "queued", chunks: [] },
    { id: "completed-job", status: "completed", completedAt: "2026-09-10T00:00:00.000Z", chunks: [] },
  ],
};

const result = recoverInterruptedOrderSyncJobs(store, {
  now: "2026-09-21T07:00:00.000Z",
  message: "interrupted",
});

assert.equal(result.recoveredCount, 2);
assert.deepEqual(result.recoveredJobIds, ["running-job", "queued-job"]);
assert.equal(store.jobs[0].status, "failed");
assert.equal(store.jobs[0].completedAt, "2026-09-21T07:00:00.000Z");
assert.equal(store.jobs[0].currentWarehouseId, "");
assert.equal(store.jobs[0].chunks[0].status, "completed", "completed chunks remain intact");
assert.equal(store.jobs[0].chunks[1].status, "failed", "the interrupted chunk is closed");
assert.equal(store.jobs[1].status, "failed");
assert.equal(store.jobs[2].status, "completed", "terminal jobs remain unchanged");

const secondPass = recoverInterruptedOrderSyncJobs(store, { now: "2026-09-21T07:01:00.000Z" });
assert.equal(secondPass.recoveredCount, 0, "recovery is idempotent");

console.log("order sync job state tests passed");

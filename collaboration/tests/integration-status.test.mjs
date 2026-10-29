import test from "node:test";
import assert from "node:assert/strict";
import { workItemStatusForCommandResult } from "../api/integration.js";

test("final warehouse confirmations close the partner work item after the core applies them", () => {
  for (const commandType of ["inbound_confirm", "outbound_confirm", "transfer_receive", "stockup_process", "complete"]) {
    assert.equal(workItemStatusForCommandResult("applied", commandType), "completed", commandType);
  }
  assert.equal(workItemStatusForCommandResult("applied", "progress"), "in_progress");
  assert.equal(workItemStatusForCommandResult("rejected", "transfer_receive"), "rejected");
});

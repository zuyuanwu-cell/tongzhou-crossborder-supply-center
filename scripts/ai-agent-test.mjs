import assert from "node:assert/strict";
import { normalizeHermesEvent } from "../server/hermes-events.js";

const delta = normalizeHermesEvent({ event: "message.delta", data: { delta: "正在核对" } }, { runId: "run-1" });
assert.deepEqual(delta, { type: "assistant.delta", text: "正在核对" });

const started = normalizeHermesEvent({ event: "tool.started", data: { tool_call_id: "call-1", tool: "tongzhou_query_inventory_risk" } }, { runId: "run-1" });
assert.equal(started.type, "tool.started");
assert.equal(started.toolCallId, "call-1");

const approval = normalizeHermesEvent({
  event: "approval.request",
  data: { tool_call_id: "call-2", request_id: "approval-2", execution_generation: 3 },
}, {
  runId: "run-1",
  proposalForToolCall: () => ({ preview: { title: "创建备货草稿", summary: "2 个 SKU", effects: [], warnings: [] } }),
});
assert.equal(approval.type, "approval.required");
assert.equal(approval.requestId, "approval-2");
assert.equal(approval.executionGeneration, 3);
assert.equal(approval.preview.title, "创建备货草稿");

const completed = normalizeHermesEvent({ event: "run.completed", data: { output: "处理建议", usage: { total_tokens: 12 } } }, { runId: "run-1" });
assert.equal(completed.output, "处理建议");
assert.equal(completed.usage.total_tokens, 12);

assert.equal(normalizeHermesEvent({ event: "reasoning.delta", data: { delta: "hidden" } }, { runId: "run-1" }), null, "Hidden reasoning must never be forwarded.");

console.log("assistant retirement and Hermes event tests passed");

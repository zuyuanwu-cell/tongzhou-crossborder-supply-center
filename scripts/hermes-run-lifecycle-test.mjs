// Run-lifecycle tests for the Hermes mirror: time budget, approval pause,
// approval timeout, stream reconnect, stuck-run release and local stop.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHermesIntegrationStore } from "../server/hermes-integration-db.js";
import {
  createHermesApi,
  DEFAULT_HERMES_APPROVAL_TIMEOUT_MS,
  DEFAULT_HERMES_RUN_TIMEOUT_MS,
  HERMES_STALE_START_MS,
  normalizeHermesApprovalTimeoutMs,
  normalizeHermesRunTimeoutMs,
} from "../server/hermes-api.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const encoder = new TextEncoder();
const auth = { role: "admin", user: { id: "user-a", username: "a", displayName: "A", role: "admin" } };

function sseFrame(type, data) {
  return encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// A controllable SSE stream shaped like the fetch Response the real client returns.
function controllableStream() {
  const queue = [];
  let wake = null;
  let ended = false;
  async function* body() {
    while (true) {
      if (queue.length) { yield queue.shift(); continue; }
      if (ended) return;
      await new Promise((resolve) => { wake = resolve; });
      wake = null;
    }
  }
  return {
    response: { body: body() },
    push(type, data) { queue.push(sseFrame(type, data)); wake?.(); },
    end() { ended = true; wake?.(); },
  };
}

function fakeClient({ streams, statuses = [] }) {
  const calls = { events: 0, stop: 0, steer: 0 };
  let current = null;
  const client = {
    calls,
    async createRun() { return { run_id: "run_remote_1" }; },
    async events() {
      const next = streams[calls.events] || streams.at(-1);
      calls.events += 1;
      current = next;
      return next.stream.response;
    },
    async getRun() { return statuses.shift() || { status: "running" }; },
    async stop() {
      calls.stop += 1;
      current?.onStop?.();
      return { status: "stopping" };
    },
    async steer() { calls.steer += 1; return {}; },
    async approve() { return {}; },
    async health() { return { ok: true, status: "ready" }; },
  };
  return client;
}

async function setup(directory, name, client, options = {}) {
  const store = await initHermesIntegrationStore(join(directory, `${name}.sqlite`), options.storeOptions || {});
  const responses = [];
  const handler = createHermesApi({
    enabled: true,
    model: "deepseek-v4-flash",
    resolveRuntimeConfig: () => ({ configured: true, model: "deepseek-v4-flash", provider: "custom:tongzhou" }),
    store,
    client,
    getAuth: () => auth,
    parseRequestBody: async (req) => req.body || {},
    sendJson: (res, status, payload) => { res.status = status; res.payload = payload; responses.push({ status, payload }); },
    patrol: { status: () => ({}) },
    runTimeoutMs: options.runTimeoutMs,
    approvalTimeoutMs: options.approvalTimeoutMs,
  });
  async function call(method, path, body) {
    const res = {};
    await handler({ method, headers: {}, body }, res, new URL(`http://local${path}`));
    return res;
  }
  return { store, call };
}

async function startRun(env) {
  const conversation = env.store.createConversation({ userId: "user-a", title: "t", context: {} });
  const res = await env.call("POST", `/api/hermes/conversations/${conversation.id}/runs`, { input: "检查库存风险" });
  assert.equal(res.status, 202, JSON.stringify(res.payload));
  return { conversation, runId: res.payload.run.id };
}

async function waitForTerminal(store, runId, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = store.getRun(runId, "user-a");
    if (["completed", "failed", "cancelled", "interrupted"].includes(run?.status)) return run;
    await sleep(20);
  }
  throw new Error(`run ${runId} did not finish; status=${store.getRun(runId, "user-a")?.status}`);
}

const directory = mkdtempSync(join(tmpdir(), "tongzhou-hermes-lifecycle-"));
try {
  // Configuration is clamped to sane bounds and defaults to 10 / 15 minutes.
  assert.equal(normalizeHermesRunTimeoutMs(undefined), DEFAULT_HERMES_RUN_TIMEOUT_MS);
  assert.equal(normalizeHermesRunTimeoutMs("abc"), DEFAULT_HERMES_RUN_TIMEOUT_MS);
  assert.equal(normalizeHermesRunTimeoutMs("1000"), 60_000);
  assert.equal(normalizeHermesRunTimeoutMs("99999999"), 1_800_000);
  assert.equal(normalizeHermesRunTimeoutMs("900000"), 900_000);
  assert.equal(normalizeHermesApprovalTimeoutMs(""), DEFAULT_HERMES_APPROVAL_TIMEOUT_MS);
  assert.equal(normalizeHermesApprovalTimeoutMs("5000"), 60_000);

  // 1. Time spent waiting for a human approval does not count against the run budget.
  {
    const s = controllableStream();
    const client = fakeClient({ streams: [{ stream: s }] });
    const env = await setup(directory, "approval-pause", client, { runTimeoutMs: 400, approvalTimeoutMs: 5_000 });
    const { runId } = await startRun(env);
    s.push("tool.started", { tool: "tongzhou_create_stockup_draft", seq: 1 });
    s.push("approval.request", { tool_call_id: "call-1", request_id: "req-1", seq: 2 });
    await sleep(150);
    assert.equal(env.store.getRun(runId, "user-a").status, "waiting_for_approval");
    await sleep(900); // longer than the 400 ms working budget
    assert.equal(client.calls.stop, 0, "approval wait must not trigger the run timeout");
    s.push("tool.completed", { tool: "tongzhou_create_stockup_draft", seq: 3, preview: "{\"summary\":\"ok\"}" });
    s.push("run.completed", { output: "已完成", seq: 4 });
    s.end();
    const run = await waitForTerminal(env.store, runId);
    assert.equal(run.status, "completed");
  }

  // 2. Exceeding the working budget stops the run with a clear message (not "运行已取消").
  {
    const s = controllableStream();
    const entry = { stream: s, onStop: () => { s.push("run.cancelled", { seq: 9 }); s.end(); } };
    const client = fakeClient({ streams: [entry] });
    const env = await setup(directory, "run-timeout", client, { runTimeoutMs: 300, approvalTimeoutMs: 5_000 });
    const { runId } = await startRun(env);
    s.push("tool.started", { tool: "tongzhou_query_inventory_risk", seq: 1 });
    const run = await waitForTerminal(env.store, runId);
    assert.equal(client.calls.stop, 1);
    assert.equal(run.status, "failed");
    assert.match(run.error, /分钟上限/);
  }

  // 3. An approval that is never answered stops the run after the approval timeout.
  {
    const s = controllableStream();
    const entry = { stream: s, onStop: () => { s.push("run.cancelled", { seq: 9 }); s.end(); } };
    const client = fakeClient({ streams: [entry] });
    const env = await setup(directory, "approval-timeout", client, { runTimeoutMs: 10_000, approvalTimeoutMs: 300 });
    const { runId } = await startRun(env);
    s.push("approval.request", { tool_call_id: "call-2", request_id: "req-2", seq: 1 });
    const run = await waitForTerminal(env.store, runId);
    assert.equal(run.status, "failed");
    assert.match(run.error, /等待审批超过/);
  }

  // 4. A dropped event stream reconnects instead of failing a run that is still working.
  {
    const first = controllableStream();
    const second = controllableStream();
    const client = fakeClient({ streams: [{ stream: first }, { stream: second }], statuses: [{ status: "running" }] });
    const env = await setup(directory, "reconnect", client, { runTimeoutMs: 10_000, approvalTimeoutMs: 10_000 });
    const { runId } = await startRun(env);
    first.push("tool.started", { tool: "tongzhou_query_inventory_risk", seq: 1 });
    first.end(); // proxy cut the connection
    await sleep(300);
    second.push("tool.completed", { tool: "tongzhou_query_inventory_risk", seq: 2, preview: "{\"summary\":\"ok\"}" });
    second.push("run.completed", { output: "结论", seq: 3 });
    second.end();
    const run = await waitForTerminal(env.store, runId);
    assert.equal(run.status, "completed");
    assert.equal(client.calls.events, 2);
  }

  // 5. A run that never reached Hermes is released automatically after the stale window.
  {
    let clock = Date.now() - HERMES_STALE_START_MS - 60_000;
    const client = fakeClient({ streams: [{ stream: controllableStream() }] });
    const env = await setup(directory, "stale", client, { storeOptions: { now: () => new Date(clock) } });
    const conversation = env.store.createConversation({ userId: "user-a", title: "t", context: {} });
    const stuck = env.store.createRun({ conversationId: conversation.id, userId: "user-a", model: "m", idempotencyKey: "stuck-key-0000000001" });
    clock = Date.now();
    assert.equal(env.store.activeRunForUser("user-a")?.id, stuck.id);
    const res = await env.call("GET", "/api/hermes/conversations");
    assert.equal(res.status, 200);
    assert.equal(res.payload.activeRun, null);
    assert.equal(env.store.getRun(stuck.id, "user-a").status, "failed");
  }

  // 6. "停止" releases a run that has no Hermes run id instead of answering 404.
  {
    const client = fakeClient({ streams: [{ stream: controllableStream() }] });
    const env = await setup(directory, "stop-local", client);
    const conversation = env.store.createConversation({ userId: "user-a", title: "t", context: {} });
    const stuck = env.store.createRun({ conversationId: conversation.id, userId: "user-a", model: "m", idempotencyKey: "stuck-key-0000000002" });
    const res = await env.call("POST", `/api/hermes/runs/${stuck.id}/stop`, {});
    assert.equal(res.status, 200);
    assert.equal(env.store.getRun(stuck.id, "user-a").status, "cancelled");
    assert.equal(env.store.activeRunForUser("user-a"), null);
  }

  // 7. "停止" releases the run locally when Hermes no longer knows it.
  {
    const client = fakeClient({ streams: [{ stream: controllableStream() }] });
    client.stop = async () => { throw Object.assign(new Error("not found"), { statusCode: 404 }); };
    const env = await setup(directory, "stop-missing", client);
    const conversation = env.store.createConversation({ userId: "user-a", title: "t", context: {} });
    const run = env.store.createRun({ conversationId: conversation.id, userId: "user-a", model: "m", idempotencyKey: "stuck-key-0000000003" });
    env.store.updateRun(run.id, { hermesRunId: "run_gone", status: "running" });
    const res = await env.call("POST", `/api/hermes/runs/${run.id}/stop`, {});
    assert.equal(res.status, 200);
    assert.equal(env.store.getRun(run.id, "user-a").status, "cancelled");
  }

  console.log("Hermes run lifecycle tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

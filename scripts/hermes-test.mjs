import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Response } from "undici";
import { ROLE_DEFAULT_PERMISSIONS } from "../server/access-control.js";
import { buildExceptionObservations, exceptionFingerprint } from "../server/agent-exception-rules.js";
import { initHermesIntegrationStore } from "../server/hermes-integration-db.js";
import { sha256Hex, signHermesBridgeRequest, verifyHermesBridgeRequest } from "../server/hermes-bridge-auth.js";
import { createHermesClient, parseSseStream } from "../server/hermes-client.js";
import { approvalToolCallId, normalizeHermesEvent } from "../server/hermes-events.js";
import {
  advanceHermesTaskPlan,
  createHermesTaskPlan,
  hermesRunInstructions,
  hermesToolCallSignature,
  isHermesBusinessTool,
  normalizeHermesToolCallLimit,
  scopeHermesRunIdempotencyKey,
} from "../server/hermes-api.js";
import { createHermesToolGateway, hashHermesToolArguments } from "../server/hermes-tool-gateway.js";
import { createHermesModelGateway, prepareHermesModelPayload } from "../server/hermes-model-gateway.js";
import { normalizePartnerProgressDraft } from "../server/hermes-partner-draft-api.js";
import { buildExceptionDossier, buildPersonalTodos } from "../server/agent-exception-dossier.js";

const directory = mkdtempSync(join(tmpdir(), "tongzhou-hermes-test-"));
let clock = new Date("2026-10-20T01:00:00.000Z");
const now = () => new Date(clock);

try {
  const store = await initHermesIntegrationStore(join(directory, "hermes.sqlite"), { now });

  assert(ROLE_DEFAULT_PERMISSIONS.admin.includes("hermes_agent_use"));
  assert(ROLE_DEFAULT_PERMISSIONS.admin.includes("hermes_agent_action"));
  assert(ROLE_DEFAULT_PERMISSIONS.admin.includes("hermes_agent_admin"));
  assert(!ROLE_DEFAULT_PERMISSIONS.direct.includes("hermes_agent_use"));
  assert(!ROLE_DEFAULT_PERMISSIONS.distributor.includes("hermes_agent_use"));

  const conversationA = store.createConversation({ userId: "user-a", title: "A", context: { route: "#movement" } });
  const conversationB = store.createConversation({ userId: "user-b", title: "B", context: { route: "#stockup" } });
  assert.equal(store.getConversation(conversationA.id, "user-a")?.id, conversationA.id);
  assert.equal(store.getConversation(conversationA.id, "user-b"), null);
  assert.equal(store.getConversationBySession(conversationB.hermesSessionId)?.userId, "user-b");
  store.addMessage({ conversationId: conversationA.id, userId: "user-a", role: "user", content: "检查库存风险" });
  assert.equal(store.listMessages(conversationA.id, "user-b"), null);

  const capabilityClient = createHermesClient({
    baseUrl: "http://hermes.test",
    apiKey: "secret",
    fetchImpl: async (url) => {
      if (String(url).endsWith("/health")) return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      return new Response(JSON.stringify({
        features: {
          run_submission: true,
          run_status: true,
          run_events_sse: true,
          run_stop: true,
          run_steer: true,
          run_approval_response: true,
        },
      }), { status: 200 });
    },
  });
  assert.equal((await capabilityClient.health()).status, "ready");

  let submittedRunBody = null;
  const runSubmissionClient = createHermesClient({
    baseUrl: "http://hermes.test",
    apiKey: "secret",
    fetchImpl: async (_url, options) => {
      submittedRunBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ run_id: "run-test" }), { status: 202 });
    },
  });
  await runSubmissionClient.createRun({
    input: "hello",
    sessionId: "session-test",
    model: "agnes-3.0-pro",
    instructions: "test",
    idempotencyKey: "idempotency-test-0001",
  });
  assert.equal(submittedRunBody.model, "agnes-3.0-pro");
  assert.equal(Object.hasOwn(submittedRunBody, "model_options"), false, "custom model requests must not force unsupported reasoning options");

  let steerRequest = null;
  const steerClient = createHermesClient({
    baseUrl: "http://hermes.test",
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      steerRequest = { url: String(url), body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    },
  });
  await steerClient.steer("run-test", "请使用已有证据收口");
  assert.match(steerRequest.url, /\/v1\/runs\/run-test\/steer$/);
  assert.equal(steerRequest.body.input, "请使用已有证据收口");

  const stream = new Response([
    "id: 1\n",
    "data: {\"event\":\"message.delta\",\"delta\":\"正在核对\",\"seq\":1}\n\n",
    "id: 2\n",
    "data: {\"event\":\"run.completed\",\"output\":\"处理建议\",\"seq\":2}\n\n",
  ].join(""), { headers: { "Content-Type": "text/event-stream" } });
  const parsed = [];
  for await (const event of parseSseStream(stream)) parsed.push(event);
  assert.equal(normalizeHermesEvent(parsed[0]).type, "assistant.delta");
  assert.equal(normalizeHermesEvent(parsed[1]).output, "处理建议");
  let streamCleaned = false;
  const earlyExitStream = new Response("data: first\n\ndata: second\n\n", { headers: { "Content-Type": "text/event-stream" } });
  Object.defineProperty(earlyExitStream, "hermesStreamCleanup", { value: () => { streamCleaned = true; } });
  for await (const _event of parseSseStream(earlyExitStream)) break;
  assert.equal(streamCleaned, true, "SSE deadlines must be released when a consumer exits early");
  assert.equal(normalizeHermesEvent({ event: "tool.started", data: { tool: "tool_describe" } }), null, "Hermes platform tools must stay out of the business event stream");
  const approvalEvent = {
    event: "message",
    data: {
      event: "approval.request",
      pattern_key: "plugin_rule:tongzhou:tongzhou_assign_exception:call-99",
      request_id: "approval-1",
    },
  };
  assert.equal(approvalToolCallId(approvalEvent), "call-99");
  assert.equal(normalizeHermesEvent(approvalEvent, { runId: "run-local" }).toolCallId, "call-99");
  const taskPlan = createHermesTaskPlan("核对库存风险", { route: "#movement" });
  assert.equal(taskPlan.steps.length, 4);
  assert.equal(taskPlan.steps[0].status, "completed");
  assert.equal(advanceHermesTaskPlan(taskPlan, "tool.completed").steps.find((item) => item.id === "verify").status, "in_progress");
  assert.equal(advanceHermesTaskPlan(taskPlan, "completed").steps.every((item) => item.status === "completed"), true);
  assert.equal(
    hermesToolCallSignature({ data: { tool: "tongzhou_query_inventory_risk", arguments: { warehouseId: "wh-1", sku: "SKU-1" } } }),
    hermesToolCallSignature({ data: { tool: "tongzhou_query_inventory_risk", arguments: { sku: "SKU-1", warehouseId: "wh-1" } } }),
    "tool loop signatures must ignore object key order",
  );
  const instructions = hermesRunInstructions({ route: "#movement" }, { maxToolCalls: 32, stageToolCalls: 12, softToolCalls: 20, plan: taskPlan });
  assert.match(instructions, /本次人工审批/);
  assert.match(instructions, /真实数据必须通过工具重新读取/);
  assert.match(instructions, /不要用逐个 SKU 的 N\+1 查询/);
  assert.match(instructions, /单个调查阶段最多 12 次/);
  assert.match(instructions, /累计到 20 次时必须停止扩展查询/);
  assert.match(instructions, /执行步骤/);
  assert.equal(isHermesBusinessTool("tongzhou_query_inventory_risk"), true);
  assert.equal(isHermesBusinessTool("tool_describe"), false, "Hermes platform calls must not consume the business tool budget");
  assert.equal(normalizeHermesToolCallLimit("48"), 48);
  assert.equal(normalizeHermesToolCallLimit("invalid"), 32);
  assert.equal(normalizeHermesToolCallLimit(1000), 64);

  const structuredModelPayload = prepareHermesModelPayload({
    model: "caller-model",
    messages: [{ role: "user", content: "return json" }],
    temperature: 0.9,
    max_tokens: 5000,
    tools: [{ type: "function", function: { name: "forbidden" } }],
    tool_choice: "auto",
  }, "deepseek-v4-pro", { structured: true });
  assert.equal(structuredModelPayload.model, "deepseek-v4-pro");
  assert.equal(structuredModelPayload.temperature, 0.1);
  assert.deepEqual(structuredModelPayload.response_format, { type: "json_object" });
  assert.equal(structuredModelPayload.max_tokens, 1200);
  assert.equal("tools" in structuredModelPayload, false);
  assert.equal("tool_choice" in structuredModelPayload, false);

  const modelRequests = [];
  const modelConfigPath = join(directory, "hermes-model-config.json");
  const modelGateway = createHermesModelGateway({
    cacheDir: directory,
    encryptionSecret: "test-model-encryption-secret-0123456789",
    proxySecret: "test-model-proxy-secret-012345678901",
    partnerProxySecret: "test-partner-model-secret-012345678901",
    fetchImpl: async (url, options = {}) => {
      modelRequests.push({ url: String(url), options });
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }), { status: 200 });
      }
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: "chat-test", model: request.model, choices: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    getAuth: (request) => request.auth || { role: "admin", user: { id: "admin-a", role: "admin", permissions: ROLE_DEFAULT_PERMISSIONS.admin } },
    parseRequestBody: async (request) => request.payload || {},
    sendJson: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      response.headersSent = true;
      response.writableEnded = true;
    },
  });
  assert.equal(modelGateway.runtimeConfig().configured, false);
  await modelGateway.saveConfig({ apiKey: "sk-deepseek-test-secret-value", model: "deepseek-v4-pro" }, { id: "admin-a" });
  assert.equal(modelGateway.runtimeConfig().configured, true);
  assert.equal(modelGateway.publicConfig().apiKeyMasked.includes("test-secret-value"), false);
  assert.equal(readFileSync(modelConfigPath, "utf8").includes("sk-deepseek-test-secret-value"), false, "DeepSeek key must be encrypted at rest");

  const legacyConfigRequest = Object.assign(new EventEmitter(), {
    method: "GET",
    headers: {},
    auth: { role: "admin", user: { id: "legacy-internal", role: "admin", permissions: ROLE_DEFAULT_PERMISSIONS.admin } },
  });
  const legacyConfigResponse = { headersSent: false, writableEnded: false };
  await modelGateway.handle(legacyConfigRequest, legacyConfigResponse, new URL("http://tongzhou.local/api/hermes/model-config"));
  assert.equal(legacyConfigResponse.statusCode, 403, "legacy internal access must not expose model configuration");

  function modelResponse() {
    const response = new EventEmitter();
    return Object.assign(response, {
      statusCode: 0,
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      chunks: [],
      writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; this.headersSent = true; },
      write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; },
      end(chunk) { if (chunk) this.write(chunk); this.writableEnded = true; },
    });
  }
  const proxyRequest = Object.assign(new EventEmitter(), {
    method: "POST",
    headers: { authorization: "Bearer test-model-proxy-secret-012345678901" },
    payload: { model: "model-injected-by-caller", messages: [{ role: "user", content: "hello" }], stream: false },
  });
  const proxyResponse = modelResponse();
  assert.equal(await modelGateway.handle(proxyRequest, proxyResponse, new URL("http://tongzhou.local/api/internal/hermes/v1/model/chat/completions")), true);
  assert.equal(proxyResponse.statusCode, 200);
  const upstreamModelBody = JSON.parse(modelRequests.at(-1).options.body);
  assert.equal(upstreamModelBody.model, "deepseek-v4-pro", "the server-selected model must override model input from Hermes");

  const partnerProxyRequest = Object.assign(new EventEmitter(), {
    method: "POST",
    headers: { authorization: "Bearer test-partner-model-secret-012345678901" },
    payload: {
      model: "model-injected-by-caller",
      messages: [{ role: "user", content: "return json" }],
      stream: false,
      temperature: 1,
      tools: [{ type: "function", function: { name: "forbidden" } }],
    },
  });
  const partnerProxyResponse = modelResponse();
  await modelGateway.handle(partnerProxyRequest, partnerProxyResponse, new URL("http://tongzhou.local/api/internal/hermes/v1/model/chat/completions"));
  assert.equal(partnerProxyResponse.statusCode, 200);
  const partnerUpstreamBody = JSON.parse(modelRequests.at(-1).options.body);
  assert.equal(partnerUpstreamBody.temperature, 0.1);
  assert.deepEqual(partnerUpstreamBody.response_format, { type: "json_object" });
  assert.equal(partnerUpstreamBody.max_tokens, 1200);
  assert.equal("tools" in partnerUpstreamBody, false);

  const unauthorizedResponse = modelResponse();
  const unauthorizedRequest = Object.assign(new EventEmitter(), { method: "POST", headers: { authorization: "Bearer wrong" }, payload: {} });
  await modelGateway.handle(unauthorizedRequest, unauthorizedResponse, new URL("http://tongzhou.local/api/internal/hermes/v1/model/chat/completions"));
  assert.equal(unauthorizedResponse.statusCode, 401);
  const scopedRunKey = scopeHermesRunIdempotencyKey("user-a", conversationA.id, "client-request-key-0001");
  assert.equal(scopedRunKey, scopeHermesRunIdempotencyKey("user-a", conversationA.id, "client-request-key-0001"));
  assert.notEqual(scopedRunKey, scopeHermesRunIdempotencyKey("user-b", conversationA.id, "client-request-key-0001"));
  assert.notEqual(scopedRunKey, scopeHermesRunIdempotencyKey("user-a", conversationB.id, "client-request-key-0001"));
  const truncatedToolResult = normalizeHermesEvent({
    event: "message",
    data: {
      event: "tool.completed",
      tool: "tongzhou_query_inventory_risk",
      duration: 0.125,
      preview: '{"ok":true,"summary":"库存风险查询完成","evidence":[{"type":"movement_inventory","id":"SKU-1","updatedAt":"2026-10-20T01:00:00.000Z"}],"items":[{"large":"truncated...',
    },
  }, { toolCallId: "synthetic-1" });
  assert.equal(truncatedToolResult.summary, "库存风险查询完成");
  assert.equal(truncatedToolResult.evidence[0].id, "SKU-1");
  assert.equal(truncatedToolResult.durationMs, 125);

  const run = store.createRun({
    conversationId: conversationA.id,
    userId: "user-a",
    provider: "custom:tongzhou",
    model: "agnes-3.0-pro",
    idempotencyKey: "run-key-a",
    input: "检查库存风险",
    plan: taskPlan,
  });
  const replay = store.createRun({ conversationId: conversationA.id, userId: "user-a", provider: "custom:tongzhou", model: "agnes-3.0-pro", idempotencyKey: "run-key-a" });
  assert.equal(replay.id, run.id);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(run.provider, "custom:tongzhou");
  assert.equal(run.input, "检查库存风险");
  assert.equal(run.plan.steps.length, 4);
  const firstToolEvent = store.appendToolEvent({ runId: run.id, type: "tool.started", tool: "tongzhou_query_inventory_risk", sequence: 7 });
  const replayedToolEvent = store.appendToolEvent({ runId: run.id, type: "tool.started", tool: "tongzhou_query_inventory_risk", sequence: 7 });
  assert.equal(firstToolEvent.idempotentReplay, false);
  assert.equal(replayedToolEvent.idempotentReplay, true);
  assert.equal(store.getRun(run.id, "user-a").toolCount, 1);
  assert.equal(store.lastToolEventSequence(run.id, "user-a"), 7);
  const approvedArgumentsHash = hashHermesToolArguments("tongzhou_assign_exception", { caseId: "case-a", version: 1, assigneeId: "user-a" });
  assert.equal(
    approvedArgumentsHash,
    hashHermesToolArguments("tongzhou_assign_exception", { assigneeId: "user-a", version: 1, caseId: "case-a" }),
    "argument hashing must be stable across object key order",
  );
  assert.notEqual(
    approvedArgumentsHash,
    hashHermesToolArguments("tongzhou_assign_exception", { caseId: "case-a", version: 1, assigneeId: "user-b" }),
    "a changed write target must not match the approved arguments",
  );
  const proposal = store.upsertActionProposal({
    runId: run.id,
    toolCallId: "call-approved-1",
    tool: "tongzhou_assign_exception",
    argumentsHash: approvedArgumentsHash,
    argumentsSummary: { caseId: "case-a", assigneeId: "user-a" },
    preview: { title: "assign" },
    idempotencyKey: "proposal-key-0001",
  });
  assert.equal(proposal.argumentsHash, approvedArgumentsHash);
  store.appendToolEvent({ runId: run.id, type: "tool.completed", tool: "tongzhou_query_inventory_risk", sequence: 8, payload: { durationMs: 125 } });
  const metrics = store.metrics({ days: 14 });
  assert.equal(metrics.runs.total, 1);
  assert.equal(metrics.tools.completed, 1);
  assert.equal(metrics.tools.averageDurationMs, 125);
  const manualAction = store.recordManualAction({ userId: "user-a", idempotencyKey: "manual-action-key-0001", requestHash: "hash-a", result: { case: { id: "case-a" } } });
  assert.equal(manualAction.result.case.id, "case-a");
  assert.equal(store.getManualAction("user-a", "manual-action-key-0001").requestHash, "hash-a");
  assert.equal(store.getManualAction("user-b", "manual-action-key-0001"), null);

  const rawBody = Buffer.from(JSON.stringify({ session_id: conversationA.hermesSessionId, tool_call_id: "call-1234567890", arguments: {} }));
  const timestamp = String(Math.floor(clock.getTime() / 1000));
  const signed = {
    timestamp,
    nonce: "nonce-1234567890abcdef",
    method: "POST",
    path: "/api/internal/hermes/v1/tools/tongzhou_search_resources/execute",
    bodyDigest: sha256Hex(rawBody),
  };
  const signature = signHermesBridgeRequest("test-secret", signed);
  const headers = {
    "x-hermes-timestamp": timestamp,
    "x-hermes-nonce": signed.nonce,
    "x-hermes-body-sha256": signed.bodyDigest,
    "x-hermes-signature": signature,
  };
  const verification = verifyHermesBridgeRequest({
    secret: "test-secret",
    method: signed.method,
    path: signed.path,
    rawBody,
    headers,
    consumeNonce: store.consumeNonce,
    now: () => clock.getTime(),
  });
  assert.equal(verification.nonce, signed.nonce);
  assert.throws(() => verifyHermesBridgeRequest({
    secret: "test-secret", method: signed.method, path: signed.path, rawBody, headers,
    consumeNonce: store.consumeNonce, now: () => clock.getTime(),
  }), (caught) => caught.code === "nonce_replayed");

  const tamperedHeaders = { ...headers, "x-hermes-nonce": "nonce-fedcba0987654321" };
  assert.throws(() => verifyHermesBridgeRequest({
    secret: "test-secret", method: signed.method, path: signed.path, rawBody, headers: tamperedHeaders,
    consumeNonce: store.consumeNonce, now: () => clock.getTime(),
  }), (caught) => caught.code === "signature_invalid");

  let gatewayExecutions = 0;
  const gatewaySecret = "0123456789abcdef0123456789abcdef";
  const gateway = createHermesToolGateway({
    store,
    bridgeSecret: gatewaySecret,
    resolveAuthForUserId: (userId) => userId === "user-a" ? { role: "admin", user: { id: "user-a", role: "admin", status: "active", dataScopes: {} } } : { role: "guest", user: null },
    providers: {
      createStockupDraft: async (args) => {
        gatewayExecutions += 1;
        return { ok: true, draft: { id: "draft-1", quantity: args.lines[0].requestedQty } };
      },
      resolveAssignee: () => null,
    },
    sendJson: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
    },
  });
  let gatewayNonce = 0;
  async function callGateway(path, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    const nonce = `gateway-nonce-${String(++gatewayNonce).padStart(16, "0")}`;
    const gatewayTimestamp = String(Math.floor(Date.now() / 1000));
    const requestToSign = {
      timestamp: gatewayTimestamp,
      nonce,
      method: "POST",
      path,
      bodyDigest: sha256Hex(body),
    };
    const request = Object.assign(Readable.from([body]), {
      method: "POST",
      headers: {
        "x-hermes-timestamp": gatewayTimestamp,
        "x-hermes-nonce": nonce,
        "x-hermes-body-sha256": requestToSign.bodyDigest,
        "x-hermes-signature": signHermesBridgeRequest(gatewaySecret, requestToSign),
      },
    });
    const response = {};
    assert.equal(await gateway(request, response, new URL(`http://tongzhou.local${path}`)), true);
    return response;
  }
  const writeTool = "tongzhou_create_stockup_draft";
  const writeToolCallId = "call-write-approved-1";
  const writePath = `/api/internal/hermes/v1/tools/${writeTool}`;
  const approvedWriteArgs = {
    project: "pilot",
    destinationWarehouseId: "wh-1",
    lines: [{ sku: "SKU-1", requestedQty: 10 }],
  };
  const previewResponse = await callGateway(`${writePath}/preview`, {
    session_id: conversationA.hermesSessionId,
    tool_call_id: writeToolCallId,
    arguments: approvedWriteArgs,
  });
  assert.equal(previewResponse.statusCode, 200);
  store.updateActionProposal(writeToolCallId, { status: "approved", approval: "once", approvedBy: "user-a" });
  const tamperedExecution = await callGateway(`${writePath}/execute`, {
    session_id: conversationA.hermesSessionId,
    tool_call_id: writeToolCallId,
    arguments: { ...approvedWriteArgs, lines: [{ sku: "SKU-1", requestedQty: 999 }] },
  });
  assert.equal(tamperedExecution.statusCode, 409);
  assert.equal(tamperedExecution.payload.code, "proposal_arguments_mismatch");
  assert.equal(gatewayExecutions, 0, "changed arguments must never reach a write provider");
  const approvedExecution = await callGateway(`${writePath}/execute`, {
    session_id: conversationA.hermesSessionId,
    tool_call_id: writeToolCallId,
    arguments: approvedWriteArgs,
  });
  assert.equal(approvedExecution.statusCode, 200);
  assert.equal(gatewayExecutions, 1);
  assert.equal(approvedExecution.payload.result.draft.quantity, 10);
  const checkpointed = store.updateRun(run.id, {
    status: "checkpointed",
    checkpoint: { reason: "tool_loop_detected", canContinue: true },
    stageNo: 2,
  });
  assert.equal(checkpointed.checkpoint.canContinue, true);
  assert.equal(checkpointed.stageNo, 2);

  const fingerprint = exceptionFingerprint({ ruleCode: "inventory_stockout", warehouseId: "wh-1", resourceId: "sku-1", sku: "SKU-1" });
  const input = {
    inventoryRisk: {
      complete: true,
      generatedAt: clock.toISOString(),
      items: [{ id: "sku-1", sku: "SKU-1", warehouseId: "wh-1", country: "俄罗斯", status: "缺货", availableQty: 0, replenishQty: 30 }],
    },
    warehouseSync: { complete: true, syncedAt: clock.toISOString(), results: [] },
    stockup: { complete: true, requests: [], tasks: [] },
    production: { complete: true, timelines: [] },
    now,
  };
  const built = buildExceptionObservations(input);
  assert.equal(built.complete, true);
  assert.equal(built.observations.length, 1);
  assert.equal(built.observations[0].fingerprint, fingerprint);
  const firstScan = store.reconcileCases(built.observations, { scanId: "scan-1", complete: true });
  assert.equal(firstScan.detected.length, 1);
  const secondScan = store.reconcileCases(built.observations, { scanId: "scan-2", complete: true });
  assert.equal(secondScan.detected.length, 0);
  assert.equal(secondScan.changed.length, 0);

  const changedInput = JSON.parse(JSON.stringify(input));
  changedInput.now = now;
  changedInput.inventoryRisk.items[0].inTransitQty = 12;
  const changedObservation = buildExceptionObservations(changedInput);
  const changedScan = store.reconcileCases(changedObservation.observations, { scanId: "scan-2b", complete: true });
  assert.equal(changedScan.changed.length, 1);
  assert.equal(changedScan.changed[0].changeSummary.changed, true);
  assert.match(changedScan.changed[0].changeSummary.summary, /更新 1 项证据/);
  const approvedPlaybook = store.saveApprovedPlaybook({ title: "缺货处理剧本", ruleCodes: ["inventory_stockout"], steps: ["核对库存", "创建备货草稿"] }, { id: "admin-a" });
  assert.equal(approvedPlaybook.status, "approved");
  assert.equal(store.listPlaybooks({ ruleCode: "inventory_stockout" }).length, 1);
  const dossier = buildExceptionDossier(changedScan.changed[0], store.listCaseEvents(changedScan.changed[0].id), store.listPlaybooks());
  assert.equal(dossier.inventoryGap.length, 1);
  assert.equal(dossier.playbooks[0].title, "缺货处理剧本");
  const todos = buildPersonalTodos([changedScan.changed[0]], "user-a");
  assert.equal(todos[0].needsAssignment, true);
  assert.equal(todos[0].needsReplenishmentDecision, true);

  const explicitText = "已经灌装 5000 瓶，完成 60%，预计周五结束";
  const extracted = normalizePartnerProgressDraft({
    fields: { stage: "filling", progressPercent: 60, completedQuantity: 5000, expectedCompletionDate: "2026-10-23", note: explicitText },
    evidence: [
      { field: "stage", sourceQuote: "灌装", normalizedValue: "filling" },
      { field: "completedQuantity", sourceQuote: "5000 瓶", normalizedValue: 5000 },
      { field: "progressPercent", sourceQuote: "60%", normalizedValue: 60 },
      { field: "expectedCompletionDate", sourceQuote: "周五", normalizedValue: "2026-10-23" },
    ], warnings: [],
  }, { itemType: "production_order", allowedStages: ["filling"] }, explicitText);
  assert.deepEqual(extracted.fields, { stage: "filling", progressPercent: 60, completedQuantity: 5000, expectedCompletionDate: "2026-10-23", note: explicitText });
  const vague = normalizePartnerProgressDraft({ fields: { progressPercent: 95, expectedCompletionDate: "2026-10-31", note: "差不多完成了" }, evidence: [], warnings: [] }, { itemType: "production_order", allowedStages: ["filling"] }, "差不多完成了");
  assert.equal(vague.fields.progressPercent, undefined);
  assert.equal(vague.fields.expectedCompletionDate, undefined);
  const unsupported = normalizePartnerProgressDraft({
    fields: { stage: "filling", progressPercent: 95, completedQuantity: 9000, expectedCompletionDate: "2026-10-31", note: explicitText },
    evidence: [
      { field: "stage", sourceQuote: "完成", normalizedValue: "filling" },
      { field: "progressPercent", sourceQuote: "60%", normalizedValue: 95 },
      { field: "completedQuantity", sourceQuote: "5000 瓶", normalizedValue: 9000 },
      { field: "expectedCompletionDate", sourceQuote: "月底左右", normalizedValue: "2026-10-31" },
    ], warnings: [],
  }, { itemType: "production_order", allowedStages: ["filling"] }, `${explicitText}，月底左右`);
  assert.equal(unsupported.fields.stage, "filling");
  assert.equal(unsupported.fields.progressPercent, 60);
  assert.equal(unsupported.fields.completedQuantity, 5000);
  assert.equal(unsupported.fields.expectedCompletionDate, undefined);
  assert.deepEqual(unsupported.evidence.map((item) => [item.field, item.normalizedValue]), [
    ["stage", "filling"],
    ["progressPercent", 60],
    ["completedQuantity", 5000],
  ]);
  const fuzzyDate = normalizePartnerProgressDraft({ fields: {}, evidence: [], warnings: [] }, { itemType: "production_order", allowedStages: ["filling"] }, "预计周五左右完成");
  assert.equal(fuzzyDate.fields.expectedCompletionDate, undefined);
  const invalidDate = normalizePartnerProgressDraft({ fields: {}, evidence: [], warnings: [] }, { itemType: "production_order", allowedStages: ["filling"] }, "预计 2026 年 2 月 31 日完成");
  assert.equal(invalidDate.fields.expectedCompletionDate, undefined);
  const planningDate = normalizePartnerProgressDraft({ fields: {}, evidence: [], warnings: [] }, { itemType: "production_order", allowedStages: ["planning"] }, "计划周五完成");
  assert.equal(planningDate.fields.stage, undefined);

  const warningInput = { ...input, inventoryRisk: JSON.parse(JSON.stringify(input.inventoryRisk)) };
  warningInput.inventoryRisk.items[0].status = "补货预警";
  warningInput.inventoryRisk.items[0].availableQty = 5;
  const warning = buildExceptionObservations(warningInput);
  assert.notEqual(warning.observations[0].fingerprint, fingerprint, "rule changes must produce a distinct fingerprint");

  const production = buildExceptionObservations({
    warehouseSync: { complete: true, syncedAt: clock.toISOString(), results: [] },
    inventoryRisk: { complete: true, generatedAt: clock.toISOString(), items: [] },
    stockup: { complete: true, requests: [], tasks: [] },
    production: {
      complete: true,
      timelines: [
        { orderRecordId: "prod-late", orderNo: "PO-LATE", expectedCompletedAt: "2026-10-18T01:00:00.000Z", events: [], updatedAt: clock.toISOString() },
        { orderRecordId: "prod-material", orderNo: "PO-MATERIAL", expectedCompletedAt: "2026-10-21T01:00:00.000Z", materialReady: false, missingMaterialQty: 2, events: [], updatedAt: clock.toISOString() },
      ],
    },
    now,
  });
  assert.deepEqual(new Set(production.observations.map((item) => item.ruleCode)), new Set(["production_overdue", "production_material_shortage"]));

  store.reconcileCases([], { scanId: "scan-incomplete", complete: false });
  assert.equal(store.getCase(firstScan.detected[0].id).missingScanCount, 0);
  store.reconcileCases([], { scanId: "scan-3", complete: true });
  assert.equal(store.getCase(firstScan.detected[0].id).status, "open");
  assert.equal(store.getCase(firstScan.detected[0].id).missingScanCount, 1);
  store.reconcileCases([], { scanId: "scan-4", complete: true });
  assert.equal(store.getCase(firstScan.detected[0].id).status, "resolved");

  const reopened = store.reconcileCases(built.observations, { scanId: "scan-5", complete: true });
  assert.equal(reopened.detected.length, 1);
  assert.equal(reopened.detected[0].status, "open");
  assert.equal(store.listCases({}, { warehouseIds: ["wh-other"] }).length, 0);
  assert.equal(store.listCases({}, { warehouseIds: ["wh-1"] }).length, 1);
  assert.equal(store.listCases({}, { countries: ["印尼"] }).length, 0);
  assert.equal(store.listCases({}, { countries: ["俄罗斯"] }).length, 1);

  console.log("Hermes integration tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

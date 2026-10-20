import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
import { hermesRunInstructions, scopeHermesRunIdempotencyKey } from "../server/hermes-api.js";
import { createHermesToolGateway, hashHermesToolArguments } from "../server/hermes-tool-gateway.js";

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
          run_approval_response: true,
        },
      }), { status: 200 });
    },
  });
  assert.equal((await capabilityClient.health()).status, "ready");

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
  const instructions = hermesRunInstructions({ route: "#movement" });
  assert.match(instructions, /本次人工审批/);
  assert.match(instructions, /真实数据必须通过工具重新读取/);
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

  const run = store.createRun({ conversationId: conversationA.id, userId: "user-a", model: "anthropic/claude-sonnet-4.6", idempotencyKey: "run-key-a" });
  const replay = store.createRun({ conversationId: conversationA.id, userId: "user-a", model: "anthropic/claude-sonnet-4.6", idempotencyKey: "run-key-a" });
  assert.equal(replay.id, run.id);
  assert.equal(replay.idempotentReplay, true);
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

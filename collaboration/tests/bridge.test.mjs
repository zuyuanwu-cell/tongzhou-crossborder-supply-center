import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollaborationBridgeStore } from "../../server/collaboration-bridge-db.js";
import { createCollaborationBridge } from "../../server/collaboration-bridge.js";

async function fixture(t, { commands = [], resultFailures = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "tongzhou-collaboration-bridge-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await initCollaborationBridgeStore(join(dir, "bridge.sqlite"));
  const requests = [];
  const movements = [];
  let remainingResultFailures = resultFailures;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null, authorization: options.headers?.Authorization });
    if (String(url).includes("/commands?") && (options.method || "GET") === "GET") {
      return new Response(JSON.stringify({ ok: true, commands, nextCursor: commands.at(-1)?.submittedAt || "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/result") && remainingResultFailures > 0) {
      remainingResultFailures -= 1;
      return new Response(JSON.stringify({ ok: false, message: "temporary outage" }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, status: "applied" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const bridge = createCollaborationBridge({
    store,
    domesticInventoryService: {
      createMovement(input, _context, idempotencyKey) {
        movements.push({ input, idempotencyKey });
        return { ok: true, movementId: "movement-1", movementNo: "RK-001" };
      },
      receiveTransfer() { return { ok: true, transfer: { transferNo: "DB-001" } }; },
    },
    listProducts: () => [{ id: "product-1", sku: "SKU-1", name: "测试产品", unit: "件" }],
    baseUrl: "http://collaboration.test",
    internalToken: "internal-test-token",
    fetchImpl,
  });
  return { bridge, movements, requests, store };
}

const projection = {
  organizationCode: "warehouse-a",
  coreRefType: "domestic_inbound",
  coreRefId: "inbound-1",
  itemType: "warehouse_inbound",
  title: "一号仓入库",
  version: 1,
  publicPayload: { warehouseRef: "warehouse-1", warehouseName: "一号仓", referenceNo: "RK-001" },
  lines: [{ sku: "SKU-1", productName: "测试产品", plannedQuantity: 10 }],
};

test("core bridge persists and publishes allowlisted projections", async (t) => {
  const { bridge, requests, store } = await fixture(t);
  const queued = bridge.queueProjection(projection);
  assert.equal(queued.status, "pending");
  assert.throws(() => bridge.queueProjection({ ...projection, eventId: "unsafe", customerName: "敏感客户" }));
  const result = await bridge.flushOutbox();
  assert.deepEqual(result, { published: 1, failed: 0, disabled: false });
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url, "http://collaboration.test/collaboration/internal/v1/projections");
  assert.equal(requests[0].authorization, "Bearer internal-test-token");
  assert.equal(store.status().outbox.published, 1);
});

test("partner inbound command is revalidated and idempotently booked in the core ledger", async (t) => {
  const command = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationCode: "warehouse-a",
    workItemId: "22222222-2222-4222-8222-222222222222",
    coreRefType: "domestic_inbound",
    coreRefId: "inbound-1",
    itemType: "warehouse_inbound",
    publicPayload: projection.publicPayload,
    commandType: "inbound_confirm",
    idempotencyKey: "warehouse-submit-1",
    expectedVersion: 1,
    payload: { action: "inbound_confirm", note: "到货完好", lines: [{ sku: "SKU-1", quantity: 10 }] },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "仓库操作员",
    submittedAt: "2026-09-28T08:00:00.000Z",
  };
  const { bridge, movements, requests, store } = await fixture(t, { commands: [command] });
  const result = await bridge.pullCommands();
  assert.equal(result.processed, 1);
  assert.equal(movements.length, 1);
  assert.equal(movements[0].input.warehouseId, "warehouse-1");
  assert.equal(movements[0].input.lines[0].productName, "测试产品");
  assert.equal(movements[0].idempotencyKey, `collaboration:${command.id}:warehouse-submit-1`);
  assert.equal(store.command(command.id).local_status, "applied");
  assert.equal(requests.at(-1).url, `http://collaboration.test/collaboration/internal/v1/commands/${command.id}/result`);
});

test("high-risk adjustment remains local approval work until reviewed", async (t) => {
  const command = {
    id: "33333333-3333-4333-8333-333333333333",
    organizationCode: "warehouse-a",
    workItemId: "44444444-4444-4444-8444-444444444444",
    coreRefType: "inventory_exception",
    coreRefId: "exception-1",
    itemType: "warehouse_exception",
    publicPayload: projection.publicPayload,
    commandType: "inventory_adjustment",
    idempotencyKey: "adjustment-1",
    expectedVersion: 1,
    payload: { action: "inventory_adjustment", reason: "盘点差异", lines: [{ sku: "SKU-1", quantity: 2, direction: "decrease" }] },
    riskLevel: "high",
    status: "pending_approval",
    submittedByName: "仓库管理员",
    submittedAt: "2026-09-28T09:00:00.000Z",
  };
  const { bridge, movements } = await fixture(t, { commands: [command] });
  await bridge.pullCommands();
  assert.equal(bridge.listApprovals().length, 1);
  assert.equal(movements.length, 0);
  await bridge.reviewCommand(command.id, { approved: true, reviewer: "内控" });
  assert.equal(movements[0].input.type, "adjustment");
  assert.equal(movements[0].input.lines[0].deltaQty, -2);
});

test("a result callback outage never replays an already-booked inventory movement", async (t) => {
  const command = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationCode: "warehouse-a",
    workItemId: "66666666-6666-4666-8666-666666666666",
    coreRefType: "domestic_inbound",
    coreRefId: "inbound-2",
    itemType: "warehouse_inbound",
    publicPayload: projection.publicPayload,
    commandType: "inbound_confirm",
    idempotencyKey: "warehouse-submit-2",
    expectedVersion: 1,
    payload: { action: "inbound_confirm", lines: [{ sku: "SKU-1", quantity: 4 }] },
    riskLevel: "medium",
    status: "pending_sync",
    submittedByName: "仓库操作员",
    submittedAt: "2026-09-28T10:00:00.000Z",
  };
  const { bridge, movements, store } = await fixture(t, { commands: [command], resultFailures: 1 });
  const first = await bridge.pullCommands();
  assert.equal(first.processed, 0);
  assert.equal(movements.length, 1);
  assert.equal(store.command(command.id).local_status, "awaiting_result");
  await bridge.synchronize();
  assert.equal(movements.length, 1);
  assert.equal(store.command(command.id).local_status, "applied");
});

test("identity administration stays behind the server-side collaboration token", async (t) => {
  const { bridge, requests } = await fixture(t);
  const invitationId = "77777777-7777-4777-8777-777777777777";

  await bridge.listOrganizations({ keyword: "华东", status: "active" });
  await bridge.bootstrapOrganization({
    code: "cn-east-warehouse",
    name: "华东仓储",
    organizationType: "warehouse",
    administrator: {
      username: "warehouse-admin",
      email: "admin@example.com",
      displayName: "仓库管理员",
    },
    actorName: "内部管理员",
  });
  await bridge.getOrganizationAccess("cn-east-warehouse");
  await bridge.updateOrganizationStatus("cn-east-warehouse", { status: "suspended", actorName: "内部管理员" });
  await bridge.reissueInvitation(invitationId, { actorName: "内部管理员" });
  await bridge.revokeInvitation(invitationId, { actorName: "内部管理员" });

  assert.equal(requests.length, 6);
  assert.match(requests[0].url, /^http:\/\/collaboration\.test\/collaboration\/internal\/v1\/organizations\?/);
  assert.match(requests[0].url, /keyword=%E5%8D%8E%E4%B8%9C/);
  assert.match(requests[0].url, /status=active/);
  assert.equal(requests[1].url, "http://collaboration.test/collaboration/internal/v1/organizations/bootstrap");
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].body.administrator.password, undefined);
  assert.equal(requests[2].url, "http://collaboration.test/collaboration/internal/v1/organizations/cn-east-warehouse");
  assert.equal(requests[3].method, "PATCH");
  assert.equal(requests[4].url, `http://collaboration.test/collaboration/internal/v1/invitations/${invitationId}/reissue`);
  assert.equal(requests[5].url, `http://collaboration.test/collaboration/internal/v1/invitations/${invitationId}/revoke`);
  assert.ok(requests.every((request) => request.authorization === "Bearer internal-test-token"));
});

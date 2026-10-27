import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createCollaborationBridgeApi } from "../../server/collaboration-bridge-api.js";

function request(handler, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = Readable.from(chunks);
    req.method = method;
    req.headers = { "content-type": "application/json", ...headers };
    const response = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const res = {
      writeHead(status, responseHeaders = {}) {
        response.status = status;
        response.headers = responseHeaders;
      },
      end(value = "") {
        response.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
        resolve(response);
      },
    };
    Promise.resolve(handler(req, res, new URL(`http://localhost${path}`))).catch(reject);
  });
}

function json(response) {
  return JSON.parse(response.body.toString("utf8"));
}

test("bridge API preserves warehouse overdue context and reminder routes", async () => {
  const calls = [];
  const bridge = {
    async listWarehouseTasks(filters, scopes) {
      calls.push(["list", filters, scopes]);
      return { items: [{ updatedAt: "2026-10-25T08:00:00.000Z" }], counts: { overdue: 1 }, total: 1, limit: 100, offset: 0 };
    },
    async remindWarehouseTask(id, input, scopes) {
      calls.push(["remind", id, input, scopes]);
      return { ok: true, remindedAt: "2026-10-25T08:05:00.000Z" };
    },
  };
  const handler = createCollaborationBridgeApi({
    bridge,
    getAuth: () => ({ user: { displayName: "管理员", dataScopes: { warehouseIds: ["wh-1"], skus: ["SKU-1"] } } }),
    canManage: () => true,
    canViewTasks: () => true,
    canPublishTasks: () => true,
  });

  const listed = await request(handler, "GET", "/api/collaboration-bridge/warehouse-tasks?overdue=1&limit=100");
  assert.equal(listed.status, 200);
  assert.equal(listed.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(json(listed).dataContext.scopeKey, "domestic_collaboration_tasks");
  assert.deepEqual(calls[0], ["list", { overdue: "1", limit: "100" }, { warehouseIds: ["wh-1"], skus: ["SKU-1"] }]);

  const workItemId = "11111111-1111-4111-8111-111111111111";
  const reminded = await request(handler, "POST", `/api/collaboration-bridge/warehouse-tasks/${workItemId}/remind`, { note: "请尽快处理" });
  assert.equal(reminded.status, 200);
  assert.equal(json(reminded).ok, true);
  assert.equal(calls[1][0], "remind");
  assert.equal(calls[1][1], workItemId);
  assert.equal(calls[1][2].note, "请尽快处理");
});

test("bridge API preserves outsourcing binding and member credential routes", async () => {
  const calls = [];
  const bridge = {
    async getOutsourcingSourceBinding(code, options) {
      calls.push(["binding", code, options]);
      return { ok: true, binding: { organizationCode: code } };
    },
    async updateMemberCredentials(code, membershipId, input) {
      calls.push(["credentials", code, membershipId, input]);
      return { membershipId, username: input.username };
    },
  };
  const handler = createCollaborationBridgeApi({
    bridge,
    getAuth: () => ({ user: { displayName: "管理员", dataScopes: {} } }),
    canManage: () => true,
  });

  const binding = await request(handler, "GET", "/api/collaboration-bridge/organizations/songyu/outsourcing-source?refresh=1");
  assert.equal(binding.status, 200);
  assert.deepEqual(calls[0], ["binding", "songyu", { refresh: true }]);

  const membershipId = "22222222-2222-4222-8222-222222222222";
  const credentials = await request(handler, "PATCH", `/api/collaboration-bridge/organizations/songyu/members/${membershipId}/credentials`, { username: "songyu-admin", password: "new-password" });
  assert.equal(credentials.status, 200);
  assert.equal(json(credentials).username, "songyu-admin");
  assert.equal(calls[1][0], "credentials");
  assert.equal(calls[1][1], "songyu");
  assert.equal(calls[1][2], membershipId);
});

test("bridge API filters and protects approval commands by warehouse scope", async () => {
  const approvals = ["wh-1", "wh-2"].map((warehouseRef, index) => ({
    local_status: "awaiting_approval",
    command: {
      id: `command-${index + 1}`,
      organizationCode: "warehouse-org",
      workItemId: `item-${index + 1}`,
      coreRefType: "warehouse_task",
      coreRefId: `core-${index + 1}`,
      itemType: "warehouse_inbound",
      commandType: "inventory_adjustment",
      publicPayload: { warehouseRef },
      payload: { reason: "盘点差异" },
      submittedByName: "仓库操作员",
      submittedAt: "2026-10-27T08:00:00.000Z",
      riskLevel: "high",
    },
  }));
  const reviewed = [];
  const bridge = {
    listApprovals: () => approvals,
    getCommand: (id) => approvals.find((row) => row.command.id === id),
    async reviewCommand(id, input) { reviewed.push([id, input]); return { status: "applied" }; },
  };
  const handler = createCollaborationBridgeApi({
    bridge,
    getAuth: () => ({ user: { displayName: "一号仓管理员", dataScopes: { warehouseIds: ["wh-1"] } } }),
    canManage: () => true,
  });

  const listed = await request(handler, "GET", "/api/collaboration-bridge/approvals");
  assert.equal(listed.status, 200);
  assert.deepEqual(json(listed).approvals.map((item) => item.commandId), ["command-1"]);

  const denied = await request(handler, "POST", "/api/collaboration-bridge/commands/command-2/review", { approved: true });
  assert.equal(denied.status, 403);
  assert.equal(json(denied).code, "warehouse_scope_denied");
  assert.equal(reviewed.length, 0);

  const approved = await request(handler, "POST", "/api/collaboration-bridge/commands/command-1/review", { approved: true });
  assert.equal(approved.status, 200);
  assert.equal(reviewed.length, 1);

  const emptyScopeHandler = createCollaborationBridgeApi({
    bridge,
    getAuth: () => ({ role: "manager", user: { displayName: "未分配仓库的经理", dataScopes: { warehouseIds: [] } } }),
    canManage: () => true,
  });
  const emptyScopeList = await request(emptyScopeHandler, "GET", "/api/collaboration-bridge/approvals");
  assert.deepEqual(json(emptyScopeList).approvals, [], "empty warehouse scope must never mean all warehouses");

  const adminHandler = createCollaborationBridgeApi({
    bridge,
    getAuth: () => ({ role: "admin", user: { displayName: "管理员", dataScopes: { warehouseIds: [] } } }),
    canManage: () => true,
  });
  const adminList = await request(adminHandler, "GET", "/api/collaboration-bridge/approvals");
  assert.deepEqual(json(adminList).approvals.map((item) => item.commandId), ["command-1", "command-2"]);
});

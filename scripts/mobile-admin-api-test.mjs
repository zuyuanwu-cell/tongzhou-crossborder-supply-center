import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createMobileAdminApi } from "../server/mobile-admin-api.js";

const task = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationCode: "factory-a",
  organizationName: "甲工厂",
  coreRefType: "production_order",
  coreRefId: "MO-001",
  itemType: "production_order",
  title: "委外生产单 MO-001",
  description: "生产 1,000 件",
  status: "in_progress",
  priority: "urgent",
  publicPayload: { orderNo: "MO-001" },
  dueAt: "2020-01-01T00:00:00.000Z",
  version: 2,
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};

const approvalRow = {
  local_status: "awaiting_approval",
  command: {
    id: "command-1",
    organizationCode: "factory-a",
    workItemId: task.id,
    coreRefType: "production_order",
    coreRefId: "MO-001",
    itemType: "production_order",
    commandType: "report_exception",
    payload: { note: "原料延迟" },
    submittedByName: "供应商张三",
    submittedAt: "2026-10-15T01:00:00.000Z",
    riskLevel: "high",
  },
};

const adminUser = {
  id: "admin-1",
  username: "admin",
  displayName: "中台管理员",
  role: "admin",
  permissions: ["operations", "domestic_inventory_manage", "collaboration_task_view"],
};
const viewerUser = {
  id: "viewer-1",
  username: "viewer",
  displayName: "协同查看员",
  role: "direct",
  permissions: ["collaboration_task_view"],
  rolePermissions: ["collaboration_task_view"],
  permissionOverrides: { allow: ["collaboration_task_view"], deny: [] },
};

let activeAuth = null;
let reviewed = null;
const logs = [];
const bridge = {
  listWarehouseTasks: async () => ({ items: [task], counts: { in_progress: 1 }, total: 1, limit: 50, offset: 0 }),
  getWarehouseTask: async () => ({
    item: task,
    lines: [],
    attachments: [],
    commands: [],
    events: [
      { id: "initial", eventType: "core.oem_projection", body: "任务首次发布", metadata: { version: 1 } },
      { id: "sync", eventType: "core.oem_projection", body: "订单内容已由中台更新", metadata: { version: 2 } },
      { id: "partner", eventType: "partner.progress", body: "已反馈生产进度", metadata: {} },
    ],
  }),
  listApprovals: () => [approvalRow],
  reviewCommand: async (id, input) => { reviewed = { id, input }; return { status: input.approved ? "applied" : "rejected" }; },
  listOrganizations: async () => ({ organizations: [{ id: "org-1", code: "factory-a", name: "甲工厂", organizationType: "production_factory", status: "active", memberCount: 3 }] }),
  getOrganizationAccess: async () => ({ organization: { id: "org-1", code: "factory-a", name: "甲工厂", organizationType: "production_factory", status: "active" }, members: [{ id: "member-1", userId: "user-1", username: "zhangsan", email: "private@example.com", displayName: "张三", role: "manager", status: "active", userStatus: "active" }], invitations: [] }),
};

const handler = createMobileAdminApi({
  bridge,
  authenticateCredentials: (username, password) => username === "admin" && password === "secret" ? adminUser : username === "viewer" && password === "secret" ? viewerUser : null,
  issueToken: (user) => `token-${user.id}`,
  resolveAuth: () => activeAuth,
  appendActionLog: (...args) => logs.push(args),
});

async function invoke(method, path, { body, auth } = {}) {
  activeAuth = auth || null;
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.headers = {};
  request.socket = { remoteAddress: "127.0.0.1" };
  const response = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(chunk = "") { this.body += String(chunk); },
  };
  const handled = await handler(request, response, new URL(path, "http://localhost"));
  assert.equal(handled, true);
  return { status: response.statusCode, payload: response.body ? JSON.parse(response.body) : null };
}

const failedLogin = await invoke("POST", "/api/mobile-admin/v1/auth/login", { body: { username: "admin", password: "bad" } });
assert.equal(failedLogin.status, 401);

const login = await invoke("POST", "/api/mobile-admin/v1/auth/login", { body: { username: "admin", password: "secret" } });
assert.equal(login.status, 200);
assert.equal(login.payload.session.mode, "admin");
assert.equal(login.payload.session.capabilities.reviewCommands, true);
assert.equal(login.payload.token, "token-admin-1");

const unauthorized = await invoke("GET", "/api/mobile-admin/v1/tasks");
assert.equal(unauthorized.status, 401);

const viewerTasks = await invoke("GET", "/api/mobile-admin/v1/tasks", { auth: { role: "direct", user: viewerUser } });
assert.equal(viewerTasks.status, 200);
assert.equal(viewerTasks.payload.items.length, 1);
assert.equal((await invoke("GET", "/api/mobile-admin/v1/approvals", { auth: { role: "direct", user: viewerUser } })).status, 403);

const detail = await invoke("GET", `/api/mobile-admin/v1/tasks/${task.id}`, { auth: { role: "admin", user: adminUser } });
assert.deepEqual(detail.payload.events.map((event) => event.id), ["initial", "partner"], "中台同步更新不得进入移动时间轴");

const overview = await invoke("GET", "/api/mobile-admin/v1/overview", { auth: { role: "admin", user: adminUser } });
assert.equal(overview.status, 200);
assert.equal(overview.payload.overview.metrics.pendingApprovals, 1);
assert.equal(overview.payload.overview.metrics.activeOrganizations, 1);
assert.equal(overview.payload.overview.metrics.overdueTasks, 1);

const organizations = await invoke("GET", "/api/mobile-admin/v1/organizations", { auth: { role: "admin", user: adminUser } });
assert.equal(organizations.payload.organizations[0].name, "甲工厂");
const organization = await invoke("GET", "/api/mobile-admin/v1/organizations/factory-a", { auth: { role: "admin", user: adminUser } });
assert.equal(organization.status, 200);
assert.equal("email" in organization.payload.members[0], false, "移动组织详情不应泄露成员邮箱");

const missingRejectNote = await invoke("POST", "/api/mobile-admin/v1/approvals/command-1/review", { auth: { role: "admin", user: adminUser }, body: { decision: "reject", note: "" } });
assert.equal(missingRejectNote.status, 400);
const approved = await invoke("POST", "/api/mobile-admin/v1/approvals/command-1/review", { auth: { role: "admin", user: adminUser }, body: { decision: "approve", note: "核对无误" } });
assert.equal(approved.status, 200);
assert.equal(reviewed.id, "command-1");
assert.equal(reviewed.input.approved, true);
assert.ok(logs.length >= 2);

console.log("MOBILE_ADMIN_API_TEST_OK");

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fetch } from "undici";

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-user-roles-"));
const port = 19787 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "custom-role-api-test";
let child = null;

function startServer() {
  child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      CACHE_DIR: cacheDir,
      INTERNAL_ACCESS_CODE: accessCode,
      AUTH_SESSION_SECRET: "custom-role-api-session",
      NODE_ENV: "development",
      SKIP_ENV_FILE: "true",
      SYNC_SCHEDULER_ENABLED: "false",
      BACKGROUND_JOBS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child?.exitCode !== null) throw new Error("Role API test server exited before becoming ready.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Role API test server did not become ready in time.");
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function jsonRequest(path, { token = "", method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { response, payload };
}

try {
  startServer();
  await waitForServer();
  const login = await jsonRequest("/api/login", { method: "POST", body: { code: accessCode } });
  assert.equal(login.response.status, 200);
  const token = login.payload.token;

  const initial = await jsonRequest("/api/users", { token });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.payload.roles.length, 4);
  assert.equal(initial.payload.roles.some((role) => role.id === "role-admin" && role.system), true);

  const created = await jsonRequest("/api/roles", {
    token,
    method: "POST",
    body: {
      name: "经营分析专员",
      description: "只看经营数据",
      type: "direct",
      permissions: ["dashboard", "order_analysis", "performance_analysis"],
    },
  });
  assert.equal(created.response.status, 201);
  const roleId = created.payload.role.id;
  assert.equal(created.payload.role.memberCount, 0);

  const duplicate = await jsonRequest("/api/roles", {
    token,
    method: "POST",
    body: { name: " 经营分析专员 ", type: "direct", permissions: [] },
  });
  assert.equal(duplicate.response.status, 409);

  const createdUser = await jsonRequest("/api/users", {
    token,
    method: "POST",
    body: { username: "analyst", password: "test1234", displayName: "分析测试", roleId, role: "direct" },
  });
  assert.equal([201, 202].includes(createdUser.response.status), true);
  assert.equal(createdUser.payload.user.roleId, roleId);
  assert.equal(createdUser.payload.user.permissions.includes("dashboard"), true);
  assert.equal(createdUser.payload.user.permissions.includes("product_view"), false);
  const userId = createdUser.payload.user.id;

  const updated = await jsonRequest(`/api/roles/${encodeURIComponent(roleId)}`, {
    token,
    method: "PATCH",
    body: { permissions: ["movement", "movement_analysis"] },
  });
  assert.equal(updated.response.status, 200);
  const updatedMember = updated.payload.users.find((user) => user.id === userId);
  assert.equal(updatedMember.permissions.includes("movement"), true, "role changes should affect assigned users immediately");
  assert.equal(updatedMember.permissions.includes("dashboard"), false);

  const assignedDelete = await jsonRequest(`/api/roles/${encodeURIComponent(roleId)}`, { token, method: "DELETE" });
  assert.equal(assignedDelete.response.status, 409);

  const reassigned = await jsonRequest(`/api/users/${encodeURIComponent(userId)}/role`, {
    token,
    method: "PATCH",
    body: { roleId: "role-direct" },
  });
  assert.equal(reassigned.response.status, 200);
  assert.equal(reassigned.payload.user.roleId, "role-direct");
  assert.equal(reassigned.payload.user.permissions.includes("product_view"), true);

  const deleted = await jsonRequest(`/api/roles/${encodeURIComponent(roleId)}`, { token, method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.roles.some((role) => role.id === roleId), false);

  const protectedDelete = await jsonRequest("/api/roles/role-admin", { token, method: "DELETE" });
  assert.equal(protectedDelete.response.status, 400);

  console.log("user roles API tests passed");
} finally {
  await stopServer();
  rmSync(cacheDir, { recursive: true, force: true });
}

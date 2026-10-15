import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fetch } from "undici";

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-mobile-admin-session-"));
const port = 20787 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let child = null;

function startServer() {
  child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      CACHE_DIR: cacheDir,
      INTERNAL_ACCESS_CODE: "mobile-admin-session-test",
      AUTH_SESSION_SECRET: "mobile-admin-session-secret",
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
    if (child?.exitCode !== null) throw new Error("Mobile admin session test server exited before becoming ready.");
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Mobile admin session test server did not become ready in time.");
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
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
  return { response, payload: await response.json() };
}

try {
  startServer();
  await waitForServer();

  const setup = await jsonRequest("/api/setup/admin", {
    method: "POST",
    body: { username: "mobile.admin", password: "secure-test-123", displayName: "移动中台管理员" },
  });
  assert.equal(setup.response.status, 201);

  const invalid = await jsonRequest("/api/mobile-admin/v1/auth/login", { method: "POST", body: { username: "mobile.admin", password: "bad" } });
  assert.equal(invalid.response.status, 401);

  const login = await jsonRequest("/api/mobile-admin/v1/auth/login", {
    method: "POST",
    body: { username: "mobile.admin", password: "secure-test-123" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.payload.session.mode, "admin");
  assert.equal(login.payload.session.capabilities.viewTasks, true);
  assert.equal(login.payload.session.capabilities.reviewCommands, true);
  assert.notEqual(login.payload.token, setup.payload.token, "中台移动令牌必须与网页令牌隔离");

  const session = await jsonRequest("/api/mobile-admin/v1/session", { token: login.payload.token });
  assert.equal(session.response.status, 200);
  assert.equal(session.payload.session.user.username, "mobile.admin");

  const webTokenRejected = await jsonRequest("/api/mobile-admin/v1/session", { token: setup.payload.token });
  assert.equal(webTokenRejected.response.status, 401, "网页令牌不能调用中台移动接口");

  const mobileTokenOnWeb = await jsonRequest("/api/me", { token: login.payload.token });
  assert.equal(mobileTokenOnWeb.payload.user.role, "guest", "移动令牌不能提升为网页中台会话");

  console.log("MOBILE_ADMIN_SESSION_API_TEST_OK");
} finally {
  await stopServer();
  rmSync(cacheDir, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fetch } from "undici";

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-user-locale-"));
const port = 18787 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "locale-preference-test";
let child = null;

function startServer() {
  child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      API_PORT: String(port),
      CACHE_DIR: cacheDir,
      INTERNAL_ACCESS_CODE: accessCode,
      AUTH_SESSION_SECRET: "locale-preference-test-session",
      NODE_ENV: "development",
      SKIP_ENV_FILE: "true",
      SYNC_SCHEDULER_ENABLED: "false",
      AUTO_SYNC_INTERVAL_MS: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (child?.exitCode !== null) throw new Error("Locale API test server exited before becoming ready.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Locale API test server did not become ready in time.");
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

async function login() {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: accessCode }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

try {
  startServer();
  await waitForServer();
  const anonymousUpdate = await fetch(`${baseUrl}/api/me/preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "en" }),
  });
  assert.equal(anonymousUpdate.status, 401);

  const session = await login();
  assert.equal(session.user.locale, "zh-CN");

  const invalidUpdate = await fetch(`${baseUrl}/api/me/preferences`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ locale: "fr" }),
  });
  assert.equal(invalidUpdate.status, 400);

  const updateResponse = await fetch(`${baseUrl}/api/me/preferences`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ locale: "id" }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(updated.user.locale, "id");

  const persisted = JSON.parse(readFileSync(join(cacheDir, "users.json"), "utf8"));
  assert.equal(persisted.systemPreferences.locale, "id");

  await stopServer();
  startServer();
  await waitForServer();
  const restoredSession = await login();
  assert.equal(restoredSession.user.locale, "id");

  console.log("User locale API persistence test passed.");
} finally {
  await stopServer();
  rmSync(cacheDir, { recursive: true, force: true });
}

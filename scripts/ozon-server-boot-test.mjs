import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dirname, "..");

function startServer(environment) {
  const output = { stdout: "", stderr: "" };
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: workspace,
    env: { ...process.env, ...environment },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output.stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output.stderr += chunk.toString(); });
  return { child, output };
}

async function waitForHealth(port, child, output) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early\n${output.stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // The listener may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`server did not become healthy\n${output.stderr}`);
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) return child.exitCode;
  return Promise.race([
    new Promise((resolveExit) => child.once("exit", (code) => resolveExit(code))),
    new Promise((_, reject) => setTimeout(() => reject(new Error("child process did not exit")), timeoutMs)),
  ]);
}

const directory = mkdtempSync(join(tmpdir(), "tongzhou-ozon-server-"));
try {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const development = startServer({
    API_PORT: String(port),
    CACHE_DIR: directory,
    SKIP_ENV_FILE: "true",
    BACKGROUND_JOBS_ENABLED: "false",
    NODE_ENV: "development",
  });
  try {
    const health = await waitForHealth(port, development.child, development.output);
    assert.equal(health.ok, true);
    assert.match(development.output.stdout, /background jobs are disabled/i);
    const authHeaders = { Authorization: "Bearer admin123", "Content-Type": "application/json" };
    const initialOzon = await fetch(`http://127.0.0.1:${port}/api/ozon`, { headers: authHeaders });
    assert.equal(initialOzon.status, 200);
    assert.deepEqual((await initialOzon.json()).stores, []);
    const createdResponse = await fetch(`http://127.0.0.1:${port}/api/ozon/stores`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "API 测试店铺", clientId: "client-api", apiKey: "server-api-secret" }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.store.ownerId, "legacy-internal");
    assert.equal("apiKey" in created.store, false);
    assert.equal(JSON.stringify(created).includes("server-api-secret"), false);
    const deletedResponse = await fetch(`http://127.0.0.1:${port}/api/ozon/stores/${encodeURIComponent(created.store.id)}`, { method: "DELETE", headers: authHeaders });
    assert.equal(deletedResponse.status, 200);
    assert.deepEqual((await deletedResponse.json()).stores, []);
  } finally {
    development.child.kill();
    await waitForExit(development.child);
  }

  const production = startServer({
    API_PORT: String(port + 1),
    CACHE_DIR: directory,
    SKIP_ENV_FILE: "true",
    BACKGROUND_JOBS_ENABLED: "false",
    NODE_ENV: "production",
    INTERNAL_ACCESS_CODE: "strong-production-access-code",
    AUTH_SESSION_SECRET: "strong-production-session-secret",
    INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: "",
  });
  const productionExit = await waitForExit(production.child);
  assert.notEqual(productionExit, 0);
  assert.match(production.output.stderr, /INTEGRATION_CREDENTIAL_ENCRYPTION_KEY/);

  console.log("ozon server boot tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

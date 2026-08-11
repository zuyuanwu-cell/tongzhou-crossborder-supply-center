import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAgentCoverage } from "./check-agent-coverage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testCacheDir = mkdtempSync(join(tmpdir(), "tongzhou-agent-index-"));
const port = String(32000 + Math.floor(Math.random() * 10000));
const baseUrl = `http://127.0.0.1:${port}`;
const accessCode = "agent-index-test-access-code";
const timeoutMs = 30000;
const child = spawn(process.execPath, ["server/server.js"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    API_PORT: port,
    NODE_ENV: "development",
    INTERNAL_ACCESS_CODE: accessCode,
    AUTH_SESSION_SECRET: "agent-index-test-session-secret",
    AUTO_SYNC_INTERVAL_MS: "0",
    ORDER_SYNC_TIMEOUT_MS: "1000",
    WAREHOUSE_TEST_TIMEOUT_MS: "1000",
    WMS_REQUEST_TIMEOUT_MS: "1000",
    CACHE_DIR: testCacheDir,
    MOVEMENT_HISTORY_DB_PATH: resolve(testCacheDir, "movement-history.sqlite"),
    SKIP_ENV_FILE: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let childOutput = "";
child.stdout.on("data", (chunk) => {
  childOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  childOutput += chunk.toString();
});

const timer = setTimeout(() => {
  child.kill();
  console.error(`Agent index test timed out after ${timeoutMs}ms.`);
  if (childOutput.trim()) console.error(childOutput.trim());
  process.exit(1);
}, timeoutMs);

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited early with code ${child.exitCode}.\n${childOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("API server did not become healthy in time.");
}

async function request(path, { token = "", expectedStatus = 200, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path} returned non-JSON response: ${text.slice(0, 200)}`);
  }
  assert.equal(
    response.status,
    expectedStatus,
    `${path} expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(data).slice(0, 500)}`,
  );
  return data;
}

function assertCanonicalRecord(record) {
  const requiredFields = [
    "id",
    "type",
    "title",
    "display_name",
    "body",
    "searchable_text",
    "url",
    "source_path",
    "created_at",
    "updated_at",
    "owner",
    "permissions",
    "acl",
    "visibility",
    "source_system",
    "source_id",
    "checksum",
    "version",
    "status",
    "attachments",
    "data",
    "metadata",
  ];
  for (const field of requiredFields) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(record, field),
      `Agent record does not declare ${field}: ${JSON.stringify(record).slice(0, 500)}`,
    );
  }
  for (const field of [
    "id",
    "type",
    "title",
    "searchable_text",
    "source_path",
    "created_at",
    "updated_at",
    "permissions",
    "acl",
    "visibility",
    "source_system",
    "source_id",
    "checksum",
    "version",
  ]) {
    assert.ok(record[field], `Agent record is missing ${field}: ${JSON.stringify(record).slice(0, 500)}`);
  }
}

async function main() {
  await waitForHealth();

  const discovery = await request("/.well-known/agent-index.json");
  assert.equal(discovery.product, "tongzhou-agent-index");
  assert.equal(discovery.discovery, true);
  assert.ok(discovery.resources.length >= 20, "Manifest should enumerate all supported resource types.");
  assert.equal(discovery.endpoints.get_by_id, "/api/agent/resources/{type}/{id}");
  assert.ok(discovery.record_schema.required.includes("permissions"));
  assert.ok(discovery.record_schema.required.includes("updated_at"));
  assert.ok(discovery.resources.some((resource) => resource.type === "product_catalog" && resource.accessible));
  assert.ok(discovery.resources.some((resource) => resource.type === "user" && !resource.accessible));
  assert.ok(discovery.operations.some((operation) => operation.id === "movement_inventory_comparison" && !operation.accessible));
  console.log("[ok] manifest discovery and resource enumeration");

  const openApi = await request("/api/agent/openapi.json");
  assert.equal(openApi.openapi, "3.1.0");
  assert.ok(openApi.paths["/api/agent/search"]);
  assert.equal(openApi.paths["/api/movement-history/compare"].get.operationId, "compareMovementAndInventory");
  assert.equal(openApi.components.securitySchemes.agentBearer.scheme, "bearer");
  assert.ok(openApi.components.schemas.AgentRecord.required.includes("updated_at"));
  assert.ok(openApi.components.schemas.MovementInventoryComparison.required.includes("inventorySummary"));
  console.log("[ok] OpenAPI document");

  const firstPage = await request("/api/agent/resources/product_catalog?page=1&limit=1");
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.total > 1, "Sample catalog should exercise list pagination.");
  assert.equal(firstPage.has_more, true);
  assertCanonicalRecord(firstPage.items[0]);

  const secondPage = await request("/api/agent/resources/product_catalog?page=2&limit=1");
  assert.equal(secondPage.items.length, 1);
  assert.notEqual(secondPage.items[0].id, firstPage.items[0].id);
  console.log("[ok] list pagination and canonical metadata");

  const detail = await request(
    `/api/agent/resources/product_catalog/${encodeURIComponent(firstPage.items[0].id)}`,
  );
  assert.deepEqual(detail.item, firstPage.items[0]);
  console.log("[ok] get_by_id");

  const guestDenied = await request("/api/agent/resources/qualification", {
    expectedStatus: 401,
  });
  assert.equal(guestDenied.ok, false);

  const login = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ code: accessCode }),
  });
  assert.equal(login.user?.role, "admin");
  assert.ok(login.token);
  const token = login.token;

  const createdKey = await request("/api/agent-keys", {
    token,
    method: "POST",
    body: JSON.stringify({ name: "Agent index integration test", expiresInDays: 30 }),
    expectedStatus: 201,
  });
  assert.match(createdKey.apiKey, /^tzai_[A-Za-z0-9_-]+$/);
  assert.equal(createdKey.key.scope, "agent:read");
  const keyList = await request("/api/agent-keys", { token });
  assert.ok(keyList.keys.some((key) => key.id === createdKey.key.id));
  assert.ok(!JSON.stringify(keyList).includes(createdKey.apiKey), "Key list must not return the full API key.");
  assert.ok(!JSON.stringify(keyList).includes("keyHash"), "Key list must not return stored key hashes.");

  await request("/api/agent/resources/qualification?page=1&limit=10", {
    token: createdKey.apiKey,
  });
  await request("/api/users", {
    token: createdKey.apiKey,
    expectedStatus: 401,
  });
  const comparison = await request("/api/movement-history/compare?period=month", {
    token: createdKey.apiKey,
  });
  assert.ok(comparison.inventorySummary);
  assert.ok(Array.isArray(comparison.rows));
  const persistedKeyStore = readFileSync(resolve(testCacheDir, "agent-api-keys.json"), "utf8");
  assert.ok(!persistedKeyStore.includes(createdKey.apiKey), "The API key must never be stored in plaintext.");
  assert.ok(persistedKeyStore.includes("keyHash"), "The API key store should contain only a key hash.");
  console.log("[ok] user-owned read-only Agent API key");

  const userPassword = "AgentKeyUser123!";
  const createdUser = await request("/api/users", {
    token,
    method: "POST",
    body: JSON.stringify({
      username: "agent-key-user",
      password: userPassword,
      displayName: "Agent Key User",
      role: "distributor",
    }),
    expectedStatus: 202,
  });
  const userLogin = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "agent-key-user", password: userPassword }),
  });
  const userKey = await request("/api/agent-keys", {
    token: userLogin.token,
    method: "POST",
    body: JSON.stringify({ name: "Permission follow test", expiresInDays: 30 }),
    expectedStatus: 201,
  });
  await request("/api/agent/resources/qualification?page=1&limit=10", {
    token: userKey.apiKey,
  });
  await request("/api/movement-history/compare?period=month", {
    token: userKey.apiKey,
    expectedStatus: 401,
  });
  await request(`/api/users/${encodeURIComponent(createdUser.user.id)}/status`, {
    token,
    method: "PATCH",
    body: JSON.stringify({ status: "disabled" }),
    expectedStatus: 202,
  });
  await request("/api/agent/resources/qualification?page=1&limit=10", {
    token: userKey.apiKey,
    expectedStatus: 401,
  });
  await request(`/api/users/${encodeURIComponent(createdUser.user.id)}`, {
    token,
    method: "DELETE",
    expectedStatus: 202,
  });
  console.log("[ok] API key follows current user status");

  const adminManifest = await request("/api/agent/manifest", { token });
  assert.ok(adminManifest.resources.every((resource) => resource.accessible));
  assert.notEqual(
    adminManifest.authorization_scope.checksum,
    discovery.authorization_scope.checksum,
    "Authorization-scope checksum must change when the visible resource set changes.",
  );
  await request("/api/agent/resources/qualification?page=1&limit=10", { token });
  console.log("[ok] permission-aware resource filtering");

  const search = await request(
    `/api/agent/search?types=product_catalog&q=${encodeURIComponent(firstPage.items[0].source_id)}`,
  );
  assert.ok(search.items.some((item) => item.id === firstPage.items[0].id));

  const updated = await request(
    "/api/agent/updated_since?types=product_catalog&since=1970-01-01T00%3A00%3A00.000Z",
  );
  assert.equal(updated.total, firstPage.total);
  assert.ok(updated.items.every((item) => new Date(item.updated_at).getTime() > 0));
  console.log("[ok] search and updated_since");

  const categoryName = `Agent tombstone ${Date.now()}`;
  const createdNav = await request("/api/quick-nav/categories", {
    token,
    method: "POST",
    body: JSON.stringify({ name: categoryName, description: "Agent index deletion test" }),
    expectedStatus: 201,
  });
  const category = (createdNav.categories || []).find((item) => item.name === categoryName);
  assert.ok(category?.id, "Quick-nav fixture was not created.");
  const deletedSince = new Date(Date.now() - 1000).toISOString();
  const incrementalNav = await request(
    `/api/agent/updated_since?types=quick_nav_category&since=${encodeURIComponent(deletedSince)}`,
  );
  assert.ok(
    incrementalNav.items.some((item) => item.source_id === category.id),
    "updated_since did not return a newly created record.",
  );
  await request(`/api/quick-nav/categories/${encodeURIComponent(category.id)}`, {
    token,
    method: "DELETE",
  });

  const tombstones = await request(
    `/api/agent/deleted_since?types=quick_nav_category&since=${encodeURIComponent(deletedSince)}`,
  );
  assert.ok(
    tombstones.items.some((item) => item.source_id === category.id && item.reason === "deleted"),
    "deleted_since did not expose the local deletion tombstone.",
  );
  console.log("[ok] deleted_since for deleted or no-longer-visible records");

  const serializedAdminTypes = JSON.stringify(
    await request("/api/agent/search?types=user,warehouse_connection,notification_robot", { token }),
  );
  for (const forbiddenKey of ["passwordHash", "clientSecret", "appToken", "webhookUrl", "apiKey"]) {
    assert.ok(!serializedAdminTypes.includes(forbiddenKey), `Agent payload leaked forbidden key ${forbiddenKey}.`);
  }
  console.log("[ok] secret-field exclusion");

  const coverage = await verifyAgentCoverage({
    baseUrl,
    token,
  });
  assert.ok(coverage.summary.types >= 20);
  assert.equal(coverage.summary.source_count, coverage.summary.enumerated_count);
  console.log(`[ok] coverage gate (${coverage.summary.types} types, ${coverage.summary.source_count} records)`);

  await request(`/api/agent-keys/${encodeURIComponent(createdKey.key.id)}`, {
    token,
    method: "DELETE",
  });
  await request("/api/agent/resources/qualification?page=1&limit=10", {
    token: createdKey.apiKey,
    expectedStatus: 401,
  });
  await request("/api/movement-history/compare?period=month", {
    token: createdKey.apiKey,
    expectedStatus: 401,
  });
  console.log("[ok] API key revocation");
}

try {
  await main();
} finally {
  clearTimeout(timer);
  child.kill();
  rmSync(testCacheDir, { recursive: true, force: true });
}

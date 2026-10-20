import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseSseStream } from "../server/hermes-client.js";
import { hermesEventType } from "../server/hermes-events.js";

const baseUrl = String(process.env.HERMES_CONTRACT_BASE_URL || process.env.HERMES_BASE_URL || "").replace(/\/+$/, "");
const apiKey = String(process.env.HERMES_CONTRACT_API_KEY || process.env.HERMES_API_KEY || "");

if (!baseUrl || !apiKey) {
  console.log("Hermes live contract test skipped: set HERMES_CONTRACT_BASE_URL and HERMES_CONTRACT_API_KEY.");
  process.exit(0);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed with ${response.status}: ${await response.text()}`);
  return response;
}

await request("/health");
const capabilities = await (await request("/v1/capabilities")).json();
assert.equal(capabilities.object, "hermes.api_server.capabilities");
for (const feature of ["run_submission", "run_status", "run_events_sse", "run_stop", "run_approval_response", "tool_progress_events", "approval_events"]) {
  assert.equal(capabilities.features?.[feature], true, `missing Hermes capability: ${feature}`);
}
for (const [name, method, path] of [
  ["runs", "POST", "/v1/runs"],
  ["run_events", "GET", "/v1/runs/{run_id}/events"],
  ["run_approval", "POST", "/v1/runs/{run_id}/approval"],
  ["run_stop", "POST", "/v1/runs/{run_id}/stop"],
]) {
  assert.deepEqual(capabilities.endpoints?.[name], { method, path }, `incompatible Hermes endpoint: ${name}`);
}

if (process.env.HERMES_CONTRACT_RUN === "1") {
  const started = await (await request("/v1/runs", {
    method: "POST",
    headers: { "Idempotency-Key": `tongzhou-contract-${randomUUID()}` },
    body: JSON.stringify({
      input: "Reply with exactly CONTRACT_OK. Do not call any tool.",
      session_id: `tongzhou-contract-${randomUUID()}`,
      model: process.env.HERMES_MODEL || "agnes-3.0-pro",
      instructions: "This is a runtime contract probe. Do not use tools.",
      model_options: { reasoning: { enabled: false } },
    }),
  })).json();
  assert.match(String(started.run_id || ""), /^run_/);
  const eventResponse = await request(`/v1/runs/${encodeURIComponent(started.run_id)}/events`);
  const seen = [];
  for await (const event of parseSseStream(eventResponse)) seen.push(hermesEventType(event));
  assert(seen.includes("run.completed"), `run did not complete; events=${seen.join(",")}`);
  const status = await (await request(`/v1/runs/${encodeURIComponent(started.run_id)}`)).json();
  assert.equal(status.status, "completed");
  assert.match(String(status.output || ""), /CONTRACT_OK/);
}

console.log("Hermes v0.21.7 live contract passed");

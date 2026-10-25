import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHermesPartnerConfigApi } from "../../server/hermes-partner-config-api.js";

const mainServerSource = readFileSync(fileURLToPath(new URL("../../server/server.js", import.meta.url)), "utf8");

function adminAuth() {
  return { role: "admin", user: { id: "admin-1", role: "admin", username: "admin" } };
}

async function parseRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function request(handler, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = { "content-type": "application/json" };
    const response = { status: 0, payload: null };
    const res = {
      headersSent: false,
      writeHead(status) { response.status = status; this.headersSent = true; },
      end(value = "") {
        response.payload = value ? JSON.parse(String(value)) : null;
        resolve(response);
      },
    };
    Promise.resolve(handler(req, res, new URL(`http://localhost${path}`))).catch(reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

test("Hermes partner config API exposes and saves the independent quick-report pilot list", async () => {
  const calls = [];
  const logs = [];
  const bridge = {
    async getPartnerAiConfig() {
      return { config: { enabled: true, organizationIds: ["org-1", "org-2"], quickReportOrganizationIds: ["org-1"] } };
    },
    async listOrganizations() {
      return { organizations: [
        { id: "org-1", code: "factory-a", name: "工厂 A", organizationType: "outsourcing_factory" },
        { id: "org-2", code: "factory-b", name: "工厂 B", organizationType: "outsourcing_factory" },
      ] };
    },
    async savePartnerAiConfig(input) {
      calls.push(input);
      return { ok: true, config: { ...input } };
    },
  };
  const handler = createHermesPartnerConfigApi({
    bridge,
    getAuth: adminAuth,
    parseRequestBody,
    sendJson,
    appendActionLog: (...args) => logs.push(args),
  });

  const current = await request(handler, "GET", "/api/hermes/partner-progress-config");
  assert.equal(current.status, 200);
  assert.deepEqual(current.payload.config.quickReportOrganizationIds, ["org-1"]);
  assert.equal(current.payload.organizations.length, 2);

  const update = await request(handler, "PUT", "/api/hermes/partner-progress-config", {
    enabled: true,
    organizationIds: ["org-1", "org-2"],
    quickReportOrganizationIds: ["org-2"],
  });
  assert.equal(update.status, 200);
  assert.deepEqual(calls[0].quickReportOrganizationIds, ["org-2"]);
  assert.equal(calls[0].actorId, "admin-1");
  assert.equal(logs[0][4].quickReportOrganizationCount, 1);
});

test("Hermes partner config API remains administrator-only", async () => {
  const handler = createHermesPartnerConfigApi({
    bridge: {},
    getAuth: () => ({ role: "direct", user: { id: "user-1", role: "direct" } }),
    parseRequestBody,
    sendJson,
  });
  const response = await request(handler, "GET", "/api/hermes/partner-progress-config");
  assert.equal(response.status, 403);
  assert.equal(response.payload.code, "hermes_admin_required");
});

test("partner configuration routes run before the catch-all Hermes API", () => {
  const partnerRoute = mainServerSource.indexOf("if (await hermesPartnerConfigApi(req, res, url)) return;");
  const catchAllRoute = mainServerSource.indexOf("if (await hermesApi(req, res, url)) return;");
  assert.ok(partnerRoute >= 0, "partner configuration route must be registered");
  assert.ok(catchAllRoute >= 0, "general Hermes route must be registered");
  assert.ok(partnerRoute < catchAllRoute, "partner route must not be swallowed by the Hermes catch-all");
});

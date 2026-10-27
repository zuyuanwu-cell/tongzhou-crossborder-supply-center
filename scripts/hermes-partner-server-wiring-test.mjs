import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../server/server.js", import.meta.url);

test("production server wires the isolated Hermes partner profile", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /createHermesPartnerDraftApi/);
  assert.match(source, /HERMES_PARTNER_BASE_URL/);
  assert.match(source, /HERMES_PARTNER_API_KEY/);
  assert.match(source, /HERMES_PARTNER_BRIDGE_SECRET/);
  assert.match(source, /HERMES_PARTNER_MODEL_PROXY_KEY/);
  assert.match(source, /partnerProxySecret:\s*hermesPartnerModelProxyKey/);
  assert.match(source, /const hermesPartnerClient = createHermesClient/);
  assert.match(source, /const hermesPartnerDraftApi = createHermesPartnerDraftApi/);
  assert.match(source, /if \(await hermesPartnerDraftApi\(req, res, url\)\) return;/);
});

test("partner draft route is registered before the catch-all Hermes API", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const partnerRoute = source.indexOf("if (await hermesPartnerDraftApi(req, res, url)) return;");
  const generalRoute = source.indexOf("if (await hermesApi(req, res, url)) return;");

  assert.notEqual(partnerRoute, -1, "partner draft route must be registered");
  assert.notEqual(generalRoute, -1, "general Hermes route must be registered");
  assert.ok(partnerRoute < generalRoute, "partner draft route must run before the catch-all Hermes API");
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createProductLaunchService, isProductLaunchOverdue } from "../server/product-launch.js";
import { createProductLaunchApi } from "../server/product-launch-api.js";

const dir = mkdtempSync(join(tmpdir(), "product-launch-"));
const cachePath = join(dir, "product-launch-requests.json");
const nativeStructuredClone = globalThis.structuredClone;

try {
  // The production API currently runs on Node 16. Keep the full workflow
  // covered with the newer global deliberately unavailable.
  globalThis.structuredClone = undefined;
  const service = createProductLaunchService({ cachePath });
  const ops = { id: "u-ops", displayName: "运营小王" };
  const other = { id: "u-other", displayName: "运营小李" };
  const pm = { id: "u-pm", displayName: "产品老张" };
  const owners = [{ id: pm.id, name: pm.displayName }];

  const idea = {
    title: "便携冲牙器",
    targetCountries: ["俄罗斯", "印度尼西亚"],
    platform: "Ozon",
    source: "竞品热卖",
    reason: "Ozon 同类月销 3000+，评价集中吐槽续航，我们可以做大电池款。",
    competitorLinks: "https://www.ozon.ru/product/1\nhttps://www.ozon.ru/product/2, https://www.ozon.ru/product/1",
    targetPrice: "1299",
    currency: "rub",
    expectedMonthlySales: "800.4",
    priority: "high",
    expectedLaunchDate: "2026-12-20",
  };

  assert.throws(() => service.create({ ...idea, reason: "" }, ops), /为什么要开这个品/);
  assert.throws(() => service.create({ ...idea, competitorLinks: "ozon.ru/x" }, ops), /http/);
  assert.throws(() => service.create(idea, ops, { dataScopes: { countries: ["俄罗斯"] } }), /数据权限/);

  const created = service.create(idea, ops);
  assert.match(created.id, /^NP-\d{8}-0001$/);
  assert.equal(created.schemaVersion, 2);
  assert.equal(created.stage, "submitted");
  assert.equal(created.stageLabel, "待评审");
  assert.equal(created.currency, "RUB");
  assert.equal(created.targetPrice, 1299);
  assert.equal(created.expectedMonthlySales, 800);
  assert.deepEqual(created.targetCountries, ["俄罗斯", "印度尼西亚"]);
  assert.equal(created.checklist.length, 11);
  assert.equal(created.checklistProgress.percent, 0);
  assert.deepEqual(created.countryFilings.map((item) => item.authority), ["EAC", "BPOM"]);
  assert.deepEqual(created.competitorLinks, ["https://www.ozon.ru/product/1", "https://www.ozon.ru/product/2"]);

  // Requester may refine while waiting for review; others may not.
  assert.equal(service.update(created.id, { firstOrderQty: 500 }, ops).firstOrderQty, 500);
  assert.throws(() => service.update(created.id, { title: "改名" }, other), /自己提交/);

  // Only managers move stages; rejecting needs a reason.
  assert.throws(() => service.progress(created.id, { stage: "approved" }, ops), /负责人/);
  assert.throws(() => service.progress(created.id, { stage: "rejected" }, pm, { canManage: true }), /原因/);
  assert.throws(() => service.progress(created.id, { owner: { id: "nobody" } }, pm, { canManage: true, owners }), /名单/);
  const approved = service.progress(created.id, {
    stage: "approved",
    note: "立项，先找 3 家工厂报价",
    owner: { id: pm.id },
    nextAction: "联系工厂打样",
    nextDueDate: "2026-11-05",
  }, pm, { canManage: true, owners });
  assert.equal(approved.stage, "approved");
  assert.equal(approved.owner.name, "产品老张");
  assert.ok(approved.stageHistory.approved);
  assert.equal(approved.timeline.at(-2).type, "stage");
  assert.equal(approved.timeline.at(-1).type, "updated");

  // Once in the pipeline the requester can no longer edit, but can still leave a note.
  assert.throws(() => service.update(created.id, { title: "x" }, ops), /评审流程/);
  assert.equal(service.comment(created.id, { note: "竞品刚降价到 1199" }, ops).timeline.at(-1).note, "竞品刚降价到 1199");

  // Every checklist item and every country filing is independently traceable.
  assert.throws(() => service.updateChecklist(created.id, "factory_quote", { status: "completed" }, ops), /负责人/);
  assert.throws(() => service.updateChecklist(created.id, "factory_quote", { status: "not_required" }, pm, { canManage: true, owners }), /原因/);
  let workflow = approved;
  for (const item of workflow.checklist.filter((entry) => entry.group !== "production")) {
    workflow = service.updateChecklist(created.id, item.key, { status: "completed", owner: { id: pm.id }, note: `${item.label}已验收` }, pm, { canManage: true, owners });
  }
  assert.equal(workflow.checklistProgress.completed, 8);
  assert.equal(service.updateFiling(created.id, "RU", { status: "blocked", note: "等待实验室补件" }, pm, { canManage: true, owners }).countryFilings[0].status, "blocked");
  assert.throws(() => service.updateFiling(created.id, "ID", { status: "blocked" }, pm, { canManage: true, owners }), /原因/);
  workflow = service.updateFiling(created.id, "RU", { status: "approved", filingNo: "EAC-2026-001" }, pm, { canManage: true, owners });
  workflow = service.updateFiling(created.id, "ID", { status: "approved", filingNo: "BPOM-2026-001" }, pm, { canManage: true, owners });
  assert.equal(workflow.filingProgress.percent, 100);
  assert.ok(workflow.countryFilings[0].approvedAt);

  assert.throws(() => service.progress(created.id, { stage: "completed" }, pm, { canManage: true, owners }), /清单未完成/);
  workflow = service.updatePilot(created.id, { sampleConfirmed: true, approvedQty: 500, producedQty: 480, note: "首批验收入库" }, pm, { canManage: true });
  assert.equal(workflow.pilotProduction.approvedQty, 500);
  assert.equal(workflow.checklistProgress.percent, 100);
  const completed = service.progress(created.id, { stage: "completed", linkedSku: "tz-ru-wf-01" }, pm, { canManage: true, owners });
  assert.equal(completed.linkedSku, "TZ-RU-WF-01");
  assert.ok(completed.completedAt);
  assert.equal(completed.closed, true);
  assert.equal(completed.nextDueDate, "");

  // Withdraw: requester may cancel own request only while it waits for review, with a reason.
  const second = service.create({ ...idea, title: "儿童冲牙器", targetCountries: ["越南"], priority: "normal" }, other);
  assert.throws(() => service.progress(second.id, { stage: "cancelled", note: "渠道不做了" }, ops), /负责人/);
  assert.throws(() => service.progress(second.id, { stage: "cancelled" }, other), /原因/);
  assert.equal(service.progress(second.id, { stage: "cancelled", note: "渠道不做了" }, other).stage, "cancelled");

  const third = service.create({ ...idea, title: "牙线棒", targetCountries: ["俄罗斯"], expectedLaunchDate: "2020-01-01" }, ops);
  assert.equal(isProductLaunchOverdue(third), true);

  const all = service.list({}, { user: ops });
  assert.equal(all.requests.length, 3);
  assert.equal(all.summary.pendingReview, 1);
  assert.equal(all.summary.completedThisMonth, 1);
  assert.equal(all.summary.launchedThisMonth, 1); // compatibility alias for the existing UI
  assert.equal(all.summary.overdue, 1);
  assert.equal(all.summary.mine, 2);
  assert.equal(service.list({ keyword: "冲牙" }, { user: ops }).requests.length, 2);
  assert.equal(service.list({ stage: "open" }, { user: ops }).requests.length, 1);
  assert.equal(service.list({ mine: "1" }, { user: other }).requests.length, 1);
  assert.equal(service.list({ country: "ID" }, { user: ops }).requests.length, 1);
  assert.equal(service.list({}, { user: ops, dataScopes: { countries: ["印度尼西亚"] } }).requests.length, 1);
  assert.equal(service.get(third.id, { dataScopes: { countries: ["越南"] } }), null);

  // Persisted to disk and reloaded.
  assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).version, 2);
  assert.equal(createProductLaunchService({ cachePath }).list({}, { user: ops }).requests.length, 3);

  // v1 production data is upgraded in memory without losing the record/history,
  // and becomes v2 on the next ordinary write.
  const legacyPath = join(dir, "legacy-product-launch.json");
  writeFileSync(legacyPath, JSON.stringify({
    version: 1,
    requests: [{
      id: "NP-20261029-0001",
      title: "线上验收记录",
      country: "俄罗斯",
      source: "其他",
      reason: "保留线上已有数据并兼容升级。",
      stage: "sourcing",
      firstOrderQty: 300,
      stageHistory: { submitted: "2026-10-29T00:00:00.000Z", sourcing: "2026-10-29T01:00:00.000Z" },
      timeline: [{ id: "old", type: "created", label: "提交开品需求" }],
    }],
  }), "utf8");
  const legacyService = createProductLaunchService({ cachePath: legacyPath });
  const migrated = legacyService.get("NP-20261029-0001");
  assert.equal(migrated.stage, "factory_validation");
  assert.equal(migrated.stageHistory.factory_validation, "2026-10-29T01:00:00.000Z");
  assert.equal(migrated.timeline[0].id, "old");
  assert.equal(migrated.checklist.length, 11);
  assert.equal(migrated.countryFilings[0].authority, "EAC");
  assert.equal(migrated.pilotProduction.approvedQty, null);
  legacyService.comment(migrated.id, { note: "兼容升级写入" }, ops);
  assert.equal(JSON.parse(readFileSync(legacyPath, "utf8")).version, 2);

  // HTTP layer: permissions are enforced per route.
  const users = {
    viewer: { role: "direct", user: { id: "v", displayName: "只读", role: "direct", permissionOverrides: { allow: [], deny: ["product_launch_submit"] } } },
    ops: { role: "direct", user: { ...ops, role: "direct" } },
    pm: { role: "direct", user: { ...pm, role: "direct", permissionOverrides: { allow: ["product_launch_manage"], deny: [] } } },
    guest: { role: "guest", user: { id: "g", role: "guest" } },
  };
  const api = createProductLaunchApi({ service, getAuth: (req) => users[req.headers["x-user"]], listOwners: () => owners, listCountries: () => ["俄罗斯", "印度尼西亚", "越南"] });
  async function call(user, method, path, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, headers: { "x-user": user } });
    let status = 0;
    let responseText = "";
    const res = { writeHead(code) { status = code; }, end(chunk) { responseText = String(chunk || ""); } };
    const handled = await api(req, res, new URL(`http://local${path}`));
    return { handled, status, body: responseText ? JSON.parse(responseText) : null };
  }
  const v2 = (path) => `${path}${path.includes("?") ? "&" : "?"}workflowVersion=2`;
  assert.equal((await call("ops", "GET", "/api/other")).handled, false);
  assert.equal((await call("guest", "GET", "/api/product-launch/requests")).status, 403);
  const meta = await call("viewer", "GET", v2("/api/product-launch/meta"));
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.permissions, { view: true, submit: false, manage: false });
  assert.equal(meta.body.stages.length, 11);
  assert.equal(meta.body.checklistDefinitions.length, 11);
  assert.equal((await call("viewer", "POST", "/api/product-launch/requests", idea)).status, 403);
  const posted = await call("ops", "POST", v2("/api/product-launch/requests"), { ...idea, title: "电动牙刷头", targetCountries: ["俄罗斯"] });
  assert.equal(posted.status, 201);
  assert.equal((await call("ops", "POST", v2(`/api/product-launch/requests/${posted.body.request.id}/stage`), { stage: "approved" })).status, 403);
  const moved = await call("pm", "POST", v2(`/api/product-launch/requests/${posted.body.request.id}/stage`), { stage: "factory_validation", owner: { id: pm.id } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.request.stage, "factory_validation");
  assert.equal((await call("viewer", "PATCH", v2(`/api/product-launch/requests/${posted.body.request.id}/checklist/material_test`), { status: "completed" })).status, 403);
  assert.equal((await call("pm", "PATCH", v2(`/api/product-launch/requests/${posted.body.request.id}/checklist/material_test`), { status: "completed" })).status, 200);
  assert.equal((await call("pm", "PATCH", v2(`/api/product-launch/requests/${posted.body.request.id}/filings/RU`), { status: "submitted" })).status, 200);
  assert.equal((await call("pm", "PATCH", v2(`/api/product-launch/requests/${posted.body.request.id}/pilot`), { sampleConfirmed: true, approvedQty: 100 })).status, 200);
  assert.equal((await call("pm", "GET", v2("/api/product-launch/requests/NP-0"))).status, 404);
  const listed = await call("viewer", "GET", v2("/api/product-launch/requests?stage=factory_validation"));
  assert.equal(listed.body.requests.length, 1);

  // The backend is released before dist/: old clients keep their 9-stage
  // contract until the new frontend opts into workflowVersion=2.
  const legacyMeta = await call("viewer", "GET", "/api/product-launch/meta");
  assert.equal(legacyMeta.body.stages.length, 9);
  assert.equal(legacyMeta.body.stages[2].key, "sourcing");
  const legacyListed = await call("viewer", "GET", "/api/product-launch/requests?stage=sourcing");
  assert.equal(legacyListed.body.requests.length, 1);
  assert.equal(legacyListed.body.requests[0].stage, "sourcing");

  console.log("product launch tests passed");
} finally {
  globalThis.structuredClone = nativeStructuredClone;
  rmSync(dir, { recursive: true, force: true });
}

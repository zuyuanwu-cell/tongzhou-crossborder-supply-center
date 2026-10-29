import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createProductLaunchService, isProductLaunchOverdue } from "../server/product-launch.js";
import { createProductLaunchApi } from "../server/product-launch-api.js";

const dir = mkdtempSync(join(tmpdir(), "product-launch-"));
const cachePath = join(dir, "product-launch-requests.json");

try {
  const service = createProductLaunchService({ cachePath });
  const ops = { id: "u-ops", displayName: "运营小王" };
  const other = { id: "u-other", displayName: "运营小李" };
  const pm = { id: "u-pm", displayName: "产品老张" };
  const owners = [{ id: pm.id, name: pm.displayName }];

  const idea = {
    title: "便携冲牙器",
    country: "俄罗斯",
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
  assert.throws(() => service.create(idea, ops, { dataScopes: { countries: ["越南"] } }), /数据权限/);

  const created = service.create(idea, ops);
  assert.match(created.id, /^NP-\d{8}-0001$/);
  assert.equal(created.stage, "submitted");
  assert.equal(created.stageLabel, "待评审");
  assert.equal(created.currency, "RUB");
  assert.equal(created.targetPrice, 1299);
  assert.equal(created.expectedMonthlySales, 800);
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
  assert.equal(approved.nextAction, "联系工厂打样");
  assert.ok(approved.stageHistory.approved);
  assert.equal(approved.timeline.at(-2).type, "stage");
  assert.equal(approved.timeline.at(-1).type, "updated");

  // Once in the pipeline the requester can no longer edit, but can still leave a note.
  assert.throws(() => service.update(created.id, { title: "x" }, ops), /评审流程/);
  assert.equal(service.comment(created.id, { note: "竞品刚降价到 1199" }, ops).timeline.at(-1).note, "竞品刚降价到 1199");

  const launched = service.progress(created.id, { stage: "launched", linkedSku: "tz-ru-wf-01" }, pm, { canManage: true, owners });
  assert.equal(launched.linkedSku, "TZ-RU-WF-01");
  assert.ok(launched.launchedAt);
  assert.equal(launched.closed, true);
  assert.equal(launched.nextDueDate, "");

  // Withdraw: requester may cancel own request only while it waits for review.
  const second = service.create({ ...idea, title: "儿童冲牙器", country: "越南", priority: "normal" }, other);
  assert.throws(() => service.progress(second.id, { stage: "cancelled" }, ops), /负责人/);
  assert.equal(service.progress(second.id, { stage: "cancelled" }, other).stage, "cancelled");

  const third = service.create({ ...idea, title: "牙线棒", expectedLaunchDate: "2020-01-01" }, ops);
  assert.equal(isProductLaunchOverdue(third), true);

  const all = service.list({}, { user: ops });
  assert.equal(all.requests.length, 3);
  assert.equal(all.summary.pendingReview, 1);
  assert.equal(all.summary.launchedThisMonth, 1);
  assert.equal(all.summary.overdue, 1);
  assert.equal(all.summary.mine, 2);
  assert.equal(service.list({ keyword: "冲牙" }, { user: ops }).requests.length, 2);
  assert.equal(service.list({ stage: "open" }, { user: ops }).requests.length, 1);
  assert.equal(service.list({ mine: "1" }, { user: other }).requests.length, 1);
  assert.equal(service.list({ country: "VN" }, { user: ops }).requests.length, 1);
  assert.equal(service.list({}, { user: ops, dataScopes: { countries: ["越南"] } }).requests.length, 1);
  assert.equal(service.get(created.id, { dataScopes: { countries: ["越南"] } }), null);

  // Persisted to disk and reloaded.
  assert.equal(JSON.parse(readFileSync(cachePath, "utf8")).requests.length, 3);
  assert.equal(createProductLaunchService({ cachePath }).list({}, { user: ops }).requests.length, 3);

  // HTTP layer: permissions are enforced per route.
  const users = {
    viewer: { role: "direct", user: { id: "v", displayName: "只读", role: "direct", permissionOverrides: { allow: [], deny: ["product_launch_submit"] } } },
    ops: { role: "direct", user: { ...ops, role: "direct" } },
    pm: { role: "direct", user: { ...pm, role: "direct", permissionOverrides: { allow: ["product_launch_manage"], deny: [] } } },
    guest: { role: "guest", user: { id: "g", role: "guest" } },
  };
  const api = createProductLaunchApi({ service, getAuth: (req) => users[req.headers["x-user"]], listOwners: () => owners, listCountries: () => ["俄罗斯", "越南"] });
  async function call(user, method, path, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method, headers: { "x-user": user } });
    let status = 0;
    let text = "";
    const res = { writeHead(code) { status = code; }, end(chunk) { text = String(chunk || ""); } };
    const handled = await api(req, res, new URL(`http://local${path}`));
    return { handled, status, body: text ? JSON.parse(text) : null };
  }
  assert.equal((await call("ops", "GET", "/api/other")).handled, false);
  assert.equal((await call("guest", "GET", "/api/product-launch/requests")).status, 403);
  const meta = await call("viewer", "GET", "/api/product-launch/meta");
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.body.permissions, { view: true, submit: false, manage: false });
  assert.equal(meta.body.stages.length, 9);
  assert.equal((await call("viewer", "POST", "/api/product-launch/requests", idea)).status, 403);
  const posted = await call("ops", "POST", "/api/product-launch/requests", { ...idea, title: "电动牙刷头" });
  assert.equal(posted.status, 201);
  assert.equal((await call("ops", "POST", `/api/product-launch/requests/${posted.body.request.id}/stage`, { stage: "approved" })).status, 403);
  const moved = await call("pm", "POST", `/api/product-launch/requests/${posted.body.request.id}/stage`, { stage: "sourcing", owner: { id: pm.id } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.request.stage, "sourcing");
  assert.equal((await call("pm", "GET", "/api/product-launch/requests/NP-0")).status, 404);
  const listed = await call("viewer", "GET", "/api/product-launch/requests?stage=sourcing");
  assert.equal(listed.body.requests.length, 1);

  console.log("product launch tests passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

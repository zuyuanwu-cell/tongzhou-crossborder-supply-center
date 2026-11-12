import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createCollectorReleases, compareVersions } from "../server/collector-releases.js";

assert.equal(compareVersions("0.5.10", "0.5.9"), 1);
assert.equal(compareVersions("0.5.1", "0.5.1"), 0);

const keys = generateKeyPairSync("ed25519");
const root = mkdtempSync(join(tmpdir(), "collector-releases-"));
const keyFile = join(root, "update-key.json");
const TOKEN = "release-token-0123456789abcdef";
let clock = Date.parse("2026-11-12T04:00:00Z");
const make = () => createCollectorReleases({ dir: join(root, "store"), publicKeyFile: keyFile, releaseToken: TOKEN, now: () => clock });
let releases = make();

function pack(version, privateKey = keys.privateKey) {
  const buffer = gzipSync(Buffer.from(JSON.stringify({ format: 1, version, electron: "44", files: { "main.js": Buffer.from(version).toString("base64") } })));
  return { manifest: { version, electron: "44", sha256: createHash("sha256").update(buffer).digest("hex"), size: buffer.length, signature: sign(null, buffer, privateKey).toString("base64"), notes: `说明 ${version}` }, bundle: buffer.toString("base64"), buffer };
}

const node = (id, extra = {}) => ({ id, name: `节点${id}`, online: true, disabled: false, version: "0.5.1", update: { current: "0.5.1", shell: "0.5.1", enabled: true, state: "idle", lastError: "", lastFailure: null }, ...extra });
let nodes = [node("a"), node("b"), node("c", { update: null, version: "0.4.0" })];

// 令牌
assert.equal(releases.tokenValid(TOKEN), true);
assert.equal(releases.tokenValid("release-token-0123456789abcdeX"), false);
assert.equal(releases.tokenValid(""), false);
assert.equal(createCollectorReleases({ dir: join(root, "x"), publicKeyFile: keyFile, releaseToken: "short" }).tokenValid("short"), false);

// 没有公钥时拒绝上传
const first = pack("0.5.2");
assert.throws(() => releases.upload(first), /没有更新公钥/);
writeFileSync(keyFile, JSON.stringify({ publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64") }));

// 签名、哈希、版本号校验
assert.throws(() => releases.upload(pack("0.5.2", generateKeyPairSync("ed25519").privateKey)), /签名无效/);
assert.throws(() => releases.upload({ ...first, manifest: { ...first.manifest, sha256: "00" } }), /校验值不一致/);
assert.throws(() => releases.upload({ ...first, manifest: { ...first.manifest, version: "v1" } }), /版本号格式/);

// 没有试跑节点：上传后先暂停，任何节点都拿不到
let result = releases.upload(first, { by: "发版脚本" });
assert.equal(result.rollout.mode, "paused");
assert.equal(releases.targetFor(nodes[0], nodes), null);
assert.throws(() => releases.setRollout({ mode: "canary" }), /试跑节点/);

// 选试跑节点：只有它拿到目标版本
releases.setRollout({ canaryNodeIds: ["a"], mode: "canary" }, { by: "管理员" });
assert.equal(releases.targetFor(nodes[0], nodes).version, "0.5.2");
assert.equal(releases.targetFor(nodes[0], nodes).signature, first.manifest.signature);
assert.equal(releases.targetFor(nodes[1], nodes), null);
assert.deepEqual(releases.bundle("0.5.2").buffer, first.buffer);
assert.equal(releases.bundle("9.9.9"), null);
let view = releases.view({ nodes });
assert.deepEqual(view.nodes.map((row) => row.status), ["waiting", "held", "manual"]);
assert.equal(view.issues.length, 0, "未被推送到的旧版本节点不产生待办");

// 试跑节点更新中 / 待确认：不提升
nodes[0] = node("a", { update: { current: "0.5.2", shell: "0.5.1", enabled: true, state: "pending" } });
clock += 60 * 60000;
assert.equal(releases.targetFor(nodes[1], nodes), null);
assert.equal(releases.view({ nodes }).nodes[0].status, "confirming");

// 即使版本号已经相同，节点仍处于错误状态或关闭了更新，也不能误判为试跑成功
nodes[0] = node("a", { update: { current: "0.5.2", shell: "0.5.1", enabled: true, state: "error", lastError: "启动异常" } });
assert.equal(releases.targetFor(nodes[1], nodes), null);
nodes[0] = node("a", { update: { current: "0.5.2", shell: "0.5.1", enabled: false, state: "idle" } });
assert.equal(releases.targetFor(nodes[1], nodes), null);

// 试跑节点确认成功后，稳定 30 分钟自动推给全部
nodes[0] = node("a", { update: { current: "0.5.2", shell: "0.5.1", enabled: true, state: "idle" } });
assert.equal(releases.targetFor(nodes[1], nodes), null, "刚确认，开始计时");
clock += 29 * 60000;
assert.equal(releases.targetFor(nodes[1], nodes), null);
clock += 2 * 60000;
assert.equal(releases.targetFor(nodes[1], nodes).version, "0.5.2");
view = releases.view({ nodes });
assert.equal(view.rollout.mode, "all");
assert.match(view.rollout.updatedBy, /自动/);
// 推全部后，不支持自动更新的旧节点提示手动安装
assert.deepEqual(view.issues.map((issue) => `${issue.code}:${issue.nodeId}`), ["update_manual:c"]);

// 试跑节点中途掉线则重新计时
releases.setRollout({ mode: "canary" });
clock += 10 * 60000;
releases.view({ nodes });
nodes[0] = { ...nodes[0], online: false };
releases.view({ nodes });
nodes[0] = { ...nodes[0], online: true };
clock += 25 * 60000;
assert.equal(releases.view({ nodes }).rollout.mode, "canary");

// 版本号倒退被拒绝；同内容重复上传是幂等的
assert.throws(() => releases.upload(pack("0.5.1")), /必须高于/);
assert.equal(releases.upload(first).release.version, "0.5.2");

// 新版本上传：回到只推试跑节点；失败的节点进待办
const second = pack("0.5.3");
result = releases.upload(second, { by: "发版脚本" });
assert.equal(result.rollout.mode, "canary");
assert.equal(result.rollout.version, "0.5.3");
nodes[0] = node("a", { update: { current: "0.5.2", shell: "0.5.1", enabled: true, state: "error", lastError: "0.5.3 之前更新失败（新版本启动后一直没能连上中台）", lastFailure: { version: "0.5.3", reason: "x", at: "" } } });
view = releases.view({ nodes });
assert.equal(view.nodes[0].status, "failed");
assert.deepEqual(view.issues.map((issue) => issue.code), ["update_failed"]);
clock += 3 * 60 * 60000;
assert.equal(releases.view({ nodes }).rollout.mode, "canary", "试跑失败不会自动推全部");

// 暂停后谁也拿不到；停用的节点拿不到
releases.setRollout({ mode: "all" });
assert.equal(releases.targetFor({ ...nodes[1], disabled: true }, nodes), null);
releases.setRollout({ mode: "paused" });
assert.equal(releases.targetFor(nodes[0], nodes), null);

// 持久化；只保留最近 5 个版本的更新包
for (const version of ["0.5.4", "0.5.5", "0.5.6", "0.5.7"]) releases.upload(pack(version));
assert.equal(existsSync(join(root, "store", "update-0.5.2.bundle")), false);
releases = make();
view = releases.view({ nodes });
assert.equal(view.releases.length, 5);
assert.equal(view.releases[0].version, "0.5.7");
assert.equal(view.rollout.version, "0.5.7");
assert.deepEqual(view.rollout.canaryNodeIds, ["a"]);

console.log("collector-releases tests passed");

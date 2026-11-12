"use strict";

// 自动更新：签名校验、解包、待确认 / 确认 / 回退、启动时选版本。
// 运行：node --test test/updater.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { Updater, verifyBundle, buildBundle, signBundle, sha256 } = require("../core/updater");
const { selectApp, compareVersions, readJson } = require("../core/boot-select");

const keys = crypto.generateKeyPairSync("ed25519");
const PUBLIC = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const PRIVATE = keys.privateKey.export({ type: "pkcs8", format: "pem" });

function release(version, { electron = "44", extra = {}, key = PRIVATE } = {}) {
  const files = { "main.js": `module.exports = "${version}";`, "package.json": JSON.stringify({ name: "tongzhou-zhishu", version }), "core/a.js": "1", "ui/index.html": "<html>", ...extra };
  const bundle = buildBundle({ version, electron, files });
  return { bundle, manifest: { version, electron, sha256: sha256(bundle), size: bundle.length, signature: signBundle(bundle, key) } };
}

function setup({ current = "0.5.1", shell = "0.5.1", source = "shell", idle = () => true } = {}) {
  const updatesDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-up-")), "updates");
  const packages = new Map();
  const logs = [];
  let relaunched = 0;
  const updater = new Updater({ updatesDir, currentVersion: current, shellVersion: shell, source, electronVersion: "44.10.1", publicKey: PUBLIC, download: async (version) => packages.get(version), isIdle: idle, relaunch: () => { relaunched += 1; }, log: (level, message) => logs.push(`${level}:${message}`) });
  return { updatesDir, packages, logs, updater, relaunched: () => relaunched };
}

test("版本比较", () => {
  assert.equal(compareVersions("0.5.10", "0.5.9"), 1);
  assert.equal(compareVersions("0.5.1", "0.6.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("abc", "1.0.0"), 0);
});

test("签名校验：改过内容、别人的签名、越界文件名都拒绝", () => {
  const { bundle, manifest } = release("0.5.2");
  assert.equal(verifyBundle(bundle, manifest, PUBLIC).version, "0.5.2");
  const tampered = Buffer.from(bundle);
  tampered[tampered.length - 10] ^= 0xff;
  assert.throws(() => verifyBundle(tampered, manifest, PUBLIC), /校验值不一致/);
  assert.throws(() => verifyBundle(tampered, { ...manifest, sha256: sha256(tampered) }, PUBLIC), /签名无效/);
  const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const forged = release("0.5.2", { key: other });
  assert.throws(() => verifyBundle(forged.bundle, forged.manifest, PUBLIC), /签名无效/);
  assert.throws(() => verifyBundle(bundle, manifest, ""), /没有配置更新公钥/);
  assert.throws(() => verifyBundle(bundle, { ...manifest, version: "0.5.3" }, PUBLIC), /版本号/);
  for (const name of ["../evil.js", "core/../../evil.js", "node_modules/x.js", "C:/x.js"]) {
    const bad = release("0.5.2", { extra: { [name]: "x" } });
    assert.throws(() => verifyBundle(bad.bundle, bad.manifest, PUBLIC), /不允许的文件/);
  }
});

test("下载 → 校验 → 解包 → 空闲时重启；启动两次未确认则回退到安装包版本", async () => {
  const ctx = setup();
  const { bundle, manifest } = release("0.5.2");
  ctx.packages.set("0.5.2", bundle);
  await ctx.updater.consider(manifest);
  assert.equal(ctx.relaunched(), 1);
  assert.equal(fs.readFileSync(path.join(ctx.updatesDir, "v0.5.2", "main.js"), "utf8"), 'module.exports = "0.5.2";');
  assert.deepEqual({ ...readJson(path.join(ctx.updatesDir, "current.json")), at: "" }, { version: "0.5.2", sha256: manifest.sha256, state: "pending", attempts: 0, previous: null, at: "" });

  // 重启：外壳选中新版本（第 1、2 次启动），第 3 次仍未确认 → 回退
  const boot = () => selectApp({ updatesDir: ctx.updatesDir, shellDir: "/shell", shellVersion: "0.5.1" });
  assert.deepEqual([boot().version, boot().version], ["0.5.2", "0.5.2"]);
  const third = boot();
  assert.equal(third.source, "shell");
  assert.match(third.note, /未通过确认/);
  assert.equal(fs.existsSync(path.join(ctx.updatesDir, "current.json")), false);

  // 回退后不再重试同一个包，并把原因报给中台
  const again = setup();
  fs.cpSync(ctx.updatesDir, again.updatesDir, { recursive: true });
  again.packages.set("0.5.2", bundle);
  await again.updater.consider(manifest);
  assert.equal(again.relaunched(), 0);
  assert.match(again.updater.status().lastError, /之前更新失败/);
  assert.equal(again.updater.status().lastFailure.version, "0.5.2");
});

test("确认：连上中台后转为已确认，之后启动不再计数；再升级失败时回退到上一个更新版本", async () => {
  const ctx = setup();
  const first = release("0.5.2");
  ctx.packages.set("0.5.2", first.bundle);
  await ctx.updater.consider(first.manifest);
  const boot = () => selectApp({ updatesDir: ctx.updatesDir, shellDir: "/shell", shellVersion: "0.5.1" });
  assert.equal(boot().version, "0.5.2");

  // 新进程（0.5.2）连上中台
  const running = new Updater({ updatesDir: ctx.updatesDir, currentVersion: "0.5.2", shellVersion: "0.5.1", source: "update", electronVersion: "44.10.1", publicKey: PUBLIC, download: async (version) => ctx.packages.get(version), relaunch: () => {} });
  assert.equal(running.status().state, "pending");
  assert.equal(running.confirm(), true);
  assert.equal(running.confirm(), false);
  assert.equal(readJson(path.join(ctx.updatesDir, "current.json")).state, "confirmed");
  for (let i = 0; i < 5; i += 1) assert.equal(boot().version, "0.5.2");

  // 0.5.3 文件损坏 → 回到 0.5.2，而不是安装包的 0.5.1
  const second = release("0.5.3");
  ctx.packages.set("0.5.3", second.bundle);
  await running.consider(second.manifest);
  assert.equal(readJson(path.join(ctx.updatesDir, "current.json")).previous, "0.5.2");
  fs.rmSync(path.join(ctx.updatesDir, "v0.5.3", "main.js"));
  const fallback = boot();
  assert.equal(fallback.version, "0.5.2");
  assert.match(fallback.note, /回退到 0.5.2/);
});

test("采集中不重启，采集结束后再生效；手动装了更新的完整包时更新目录让位", async () => {
  let busy = true;
  const ctx = setup({ idle: () => !busy });
  const { bundle, manifest } = release("0.5.2");
  ctx.packages.set("0.5.2", bundle);
  await ctx.updater.consider(manifest);
  assert.equal(ctx.relaunched(), 0);
  assert.equal(ctx.updater.status().state, "staged");
  assert.equal(fs.existsSync(path.join(ctx.updatesDir, "current.json")), false);
  busy = false;
  assert.equal(ctx.updater.applyIfIdle(), true);
  assert.equal(ctx.relaunched(), 1);
  assert.equal(ctx.updater.applyIfIdle(), false, "只重启一次");

  const newerShell = selectApp({ updatesDir: ctx.updatesDir, shellDir: "/shell", shellVersion: "0.6.0" });
  assert.equal(newerShell.source, "shell");
  assert.equal(fs.existsSync(path.join(ctx.updatesDir, "current.json")), false);
});

test("不更新的情况：没有目标、版本不更高、运行环境不同、签名无效、没有公钥", async () => {
  const ctx = setup();
  await ctx.updater.consider(null);
  await ctx.updater.consider(release("0.5.1").manifest);
  await ctx.updater.consider(release("0.5.0").manifest);
  assert.equal(ctx.updater.status().state, "idle");

  await ctx.updater.consider(release("0.6.0", { electron: "45" }).manifest);
  assert.match(ctx.updater.status().lastError, /手动安装完整包/);

  const other = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  const forged = release("0.5.2", { key: other });
  ctx.packages.set("0.5.2", forged.bundle);
  await ctx.updater.consider(forged.manifest);
  assert.match(ctx.updater.status().lastError, /签名无效/);
  assert.equal(fs.existsSync(path.join(ctx.updatesDir, "v0.5.2")), false);
  assert.equal(ctx.relaunched(), 0);

  const noKey = new Updater({ updatesDir: ctx.updatesDir, currentVersion: "0.5.1", shellVersion: "0.5.1", publicKey: "", download: async () => forged.bundle });
  await noKey.consider(forged.manifest);
  assert.match(noKey.status().lastError, /没有配置更新公钥/);
  assert.equal(noKey.status().enabled, false);
});

test("发版脚本生成的更新包能通过校验，且不包含外壳入口", () => {
  const { execFileSync } = require("node:child_process");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tzzs-key-"));
  const keyFile = path.join(home, "key.pem");
  fs.writeFileSync(keyFile, PRIVATE);
  const root = path.join(__dirname, "..");
  const keyJson = path.join(root, "core", "update-key.json");
  const original = fs.readFileSync(keyJson, "utf8");
  try {
    fs.writeFileSync(keyJson, JSON.stringify({ publicKey: PUBLIC }));
    execFileSync(process.execPath, [path.join(root, "scripts", "release-update.js"), "--notes", "测试"], { env: { ...process.env, TZZS_UPDATE_PRIVATE_KEY: keyFile }, stdio: "pipe" });
    const version = require("../package.json").version;
    const manifest = readJson(path.join(root, "dist", `update-${version}.json`));
    const bundle = verifyBundle(fs.readFileSync(path.join(root, "dist", `update-${version}.bundle`)), manifest, PUBLIC);
    assert.ok(bundle.files["core/updater.js"] && bundle.files["ui/app.js"] && bundle.files["build/icon.ico"]);
    assert.equal(bundle.files["bootstrap.js"], undefined);
    assert.equal(JSON.parse(Buffer.from(bundle.files["package.json"], "base64").toString()).main, "bootstrap.js");
    assert.equal(manifest.notes, "测试");
  } finally {
    fs.writeFileSync(keyJson, original);
    // 只删除本测试生成的两个文件，不动 dist 里已经打好的安装包。
    const version = require("../package.json").version;
    for (const name of [`update-${version}.bundle`, `update-${version}.json`]) fs.rmSync(path.join(root, "dist", name), { force: true });
  }
});

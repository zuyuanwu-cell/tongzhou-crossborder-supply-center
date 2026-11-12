"use strict";

// 自动更新：中台心跳告诉节点目标版本 → 下载更新包 → 校验签名 → 解包到数据目录 → 空闲时重启生效。
// 安全：更新包必须带 Ed25519 签名，公钥内置在程序里（core/update-key.json），私钥只在打包电脑上。
// 即使中台服务器被人控制，也推不了没有签名的程序。
// 更新包格式：gzip(JSON { format: 1, version, electron: "<主版本号>", files: { "<相对路径>": "<base64>" } })。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { compareVersions, parseVersion, versionDir, usable, readJson, writeJson } = require("./boot-select");

const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;
const ALLOWED_ROOT = /^(main\.js|preload\.js|package\.json|(core|ui|build)\/[A-Za-z0-9._\-\/]+)$/;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function publicKeyObject(base64) {
  return crypto.createPublicKey({ key: Buffer.from(String(base64 || ""), "base64"), format: "der", type: "spki" });
}

/** 校验更新包的大小、哈希和签名；通过后返回解析出的内容。失败抛出带原因的错误。 */
function verifyBundle(buffer, manifest, publicKey) {
  if (!publicKey) throw new Error("程序里没有配置更新公钥");
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("更新包是空的");
  if (buffer.length > MAX_BUNDLE_BYTES) throw new Error("更新包过大");
  if (sha256(buffer) !== String(manifest.sha256 || "").toLowerCase()) throw new Error("更新包校验值不一致（下载不完整或被改动）");
  let signatureOk = false;
  try {
    signatureOk = crypto.verify(null, buffer, publicKeyObject(publicKey), Buffer.from(String(manifest.signature || ""), "base64"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw new Error("更新包签名无效，已拒绝");
  let bundle;
  try {
    bundle = JSON.parse(zlib.gunzipSync(buffer, { maxOutputLength: 200 * 1024 * 1024 }).toString("utf8"));
  } catch {
    throw new Error("更新包格式不对");
  }
  if (bundle.format !== 1 || !parseVersion(bundle.version) || !bundle.files || typeof bundle.files !== "object") throw new Error("更新包格式不对");
  if (bundle.version !== manifest.version) throw new Error("更新包里的版本号与发布信息不一致");
  for (const name of Object.keys(bundle.files)) {
    if (!ALLOWED_ROOT.test(name) || name.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error(`更新包里有不允许的文件：${name}`);
  }
  if (!bundle.files["main.js"] || !bundle.files["package.json"]) throw new Error("更新包缺少必要文件");
  return bundle;
}

/** 打包（发版脚本和测试用）。 */
function buildBundle({ version, electron, files }) {
  const encoded = {};
  for (const name of Object.keys(files).sort()) encoded[name] = Buffer.from(files[name]).toString("base64");
  return zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, version, electron: String(electron), files: encoded })), { level: 9 });
}

function signBundle(buffer, privateKeyPem) {
  return crypto.sign(null, buffer, crypto.createPrivateKey(privateKeyPem)).toString("base64");
}

class Updater {
  /**
   * @param download  (version) => Promise<Buffer>   从中台下载更新包
   * @param isIdle    () => boolean                  现在可以重启吗（没在采集）
   * @param relaunch  () => void                     重启程序
   */
  constructor({ updatesDir, currentVersion, shellVersion, source = "shell", bootNote = "", electronVersion = "", publicKey = "", download, isIdle = () => true, relaunch = () => {}, log = () => {}, now = () => Date.now() }) {
    this.updatesDir = updatesDir;
    this.currentVersion = currentVersion;
    this.shellVersion = shellVersion;
    this.source = source;
    this.bootNote = bootNote;
    this.electronMajor = String(electronVersion || "").split(".")[0];
    this.publicKey = publicKey;
    this.download = download;
    this.isIdle = isIdle;
    this.relaunch = relaunch;
    this.log = log;
    this.now = now;
    this.staged = "";
    this.state = "idle";
    this.lastError = "";
    this.target = "";
    this.busy = false;
    this.restarting = false;
    if (bootNote) this.log("warn", bootNote);
  }

  currentFile() {
    return path.join(this.updatesDir, "current.json");
  }

  failures() {
    return readJson(path.join(this.updatesDir, "failed.json"), []);
  }

  /** 本次启动的版本是不是还在「待确认」。 */
  pending() {
    const current = readJson(this.currentFile(), null);
    return Boolean(current && current.version === this.currentVersion && current.state === "pending");
  }

  /** 成功连上中台后调用：确认新版本可用，清理更旧的版本目录。 */
  confirm() {
    const current = readJson(this.currentFile(), null);
    if (!current || current.version !== this.currentVersion || current.state !== "pending") return false;
    writeJson(this.currentFile(), { ...current, state: "confirmed", attempts: 0, confirmedAt: new Date(this.now()).toISOString() });
    this.log("info", `已更新到 ${this.currentVersion}，运行正常`);
    try {
      for (const name of fs.readdirSync(this.updatesDir)) {
        const match = /^v(\d+\.\d+\.\d+)(\.tmp)?$/.exec(name);
        if (match && match[1] !== this.currentVersion && match[1] !== current.previous) fs.rmSync(path.join(this.updatesDir, name), { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
    return true;
  }

  fail(message) {
    this.state = "error";
    if (this.lastError !== message) this.log("warn", `自动更新：${message}`);
    this.lastError = message;
  }

  /** 心跳拿到中台的目标版本后调用。 */
  async consider(target) {
    if (this.busy || this.restarting) return;
    if (!target || !parseVersion(target.version)) {
      this.target = "";
      if (this.state !== "error") this.state = "idle";
      return;
    }
    this.target = target.version;
    if (compareVersions(target.version, this.currentVersion) <= 0) {
      this.state = "idle";
      this.lastError = "";
      return;
    }
    if (!this.publicKey) return this.fail("这个安装包没有配置更新公钥，不能自动更新，请手动安装新版本");
    if (target.electron && this.electronMajor && String(target.electron) !== this.electronMajor) return this.fail(`${target.version} 需要新的运行环境，请手动安装完整包`);
    const failed = this.failures().find((item) => item.version === target.version && (!item.sha256 || item.sha256 === target.sha256));
    if (failed) return this.fail(`${target.version} 之前更新失败（${failed.reason}），已停用这个版本，等待新版本`);
    this.busy = true;
    try {
      if (this.staged !== target.version || !usable(this.updatesDir, target.version, this.shellVersion)) {
        this.state = "downloading";
        this.log("info", `发现新版本 ${target.version}，开始下载`);
        const buffer = await this.download(target.version);
        const bundle = verifyBundle(buffer, target, this.publicKey);
        if (bundle.electron && this.electronMajor && String(bundle.electron) !== this.electronMajor) throw new Error(`${target.version} 需要新的运行环境，请手动安装完整包`);
        const finalDir = versionDir(this.updatesDir, target.version);
        const tempDir = `${finalDir}.tmp`;
        fs.rmSync(tempDir, { recursive: true, force: true });
        for (const [name, content] of Object.entries(bundle.files)) {
          const file = path.join(tempDir, ...name.split("/"));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(content, "base64"));
        }
        if (readJson(path.join(tempDir, "package.json"), {}).version !== target.version) throw new Error("更新包里的 package.json 版本号不对");
        fs.rmSync(finalDir, { recursive: true, force: true });
        fs.renameSync(tempDir, finalDir);
        this.staged = target.version;
        this.stagedSha = target.sha256;
        this.log("info", `新版本 ${target.version} 已下载并通过签名校验`);
      }
      this.state = "staged";
      this.lastError = "";
      this.applyIfIdle();
    } catch (error) {
      this.fail(error.message);
    } finally {
      this.busy = false;
    }
  }

  /** 已下载的新版本：空闲时切换并重启。采集结束后也会调用。 */
  applyIfIdle() {
    if (this.restarting || this.state !== "staged" || !this.staged) return false;
    if (!this.isIdle()) return false;
    writeJson(this.currentFile(), {
      version: this.staged,
      sha256: this.stagedSha || "",
      state: "pending",
      attempts: 0,
      previous: this.source === "update" ? this.currentVersion : null,
      at: new Date(this.now()).toISOString(),
    });
    this.restarting = true;
    this.state = "restarting";
    this.log("info", `正在重启以更新到 ${this.staged}`);
    this.relaunch();
    return true;
  }

  /** 随心跳上报、界面显示。 */
  status() {
    const failed = this.failures().slice(-1)[0] || null;
    return {
      current: this.currentVersion,
      shell: this.shellVersion,
      source: this.source,
      enabled: Boolean(this.publicKey),
      state: this.pending() ? "pending" : this.state,
      target: this.target,
      staged: this.staged,
      lastError: this.lastError,
      lastFailure: failed ? { version: failed.version, reason: failed.reason, at: failed.at } : null,
    };
  }
}

module.exports = { Updater, verifyBundle, buildBundle, signBundle, sha256, MAX_BUNDLE_BYTES };

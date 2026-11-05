"use strict";

// 紫鸟 CLI（@ziniao-open/cli）封装。
// - 只用 spawn 直接调用 exe（不经过 shell），参数不需要转义；
// - 所有命令带 --format json，stdout 解析 {"ok":true,"data":...}，stderr 解析错误对象；
// - SOCKS 代理连接失败按官方建议等待 5 秒重试，最多 3 次；
// - 页面内执行脚本采用「启动 + 轮询」两段式，不依赖 CLI 是否 await Promise。

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const IS_WIN = process.platform === "win32";
const CLI_VERSION = "1.2.0";
const DOWNLOAD_BASE = "https://ziniao-open-prod.s3.cn-northwest-1.amazonaws.com.cn/ziniao-cli/releases";

class ZiniaoError extends Error {
  constructor(message, { type = "unknown", code = "", hint = "", stdout = "", stderr = "", args = [] } = {}) {
    super(message);
    this.name = "ZiniaoError";
    this.type = type;
    this.code = code;
    this.hint = hint;
    this.stdout = stdout;
    this.stderr = stderr;
    this.args = args;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function candidatePaths({ configuredPath = "", dataDir = "" } = {}) {
  const env = process.env;
  const exe = IS_WIN ? "ziniao-cli.exe" : "ziniao-cli";
  const list = [];
  if (configuredPath) list.push(configuredPath);
  if (dataDir) list.push(path.join(dataDir, "bin", exe));
  if (IS_WIN) {
    if (env.APPDATA) {
      list.push(path.join(env.APPDATA, "npm", "node_modules", "@ziniao-open", "cli", "bin", exe));
      list.push(path.join(env.APPDATA, "ziniaobrowser", "cli", "ziniao.exe"));
    }
    if (env.LOCALAPPDATA) list.push(path.join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "ziniao.exe"));
  }
  for (const dir of String(env.PATH || env.Path || "").split(path.delimiter)) {
    if (!dir) continue;
    list.push(path.join(dir, exe));
    if (IS_WIN) list.push(path.join(dir, "ziniao.exe"));
  }
  return [...new Set(list)];
}

function locateCli(options = {}) {
  for (const candidate of candidatePaths(options)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 继续 */
    }
  }
  return "";
}

function parseJsonLoose(textValue) {
  const raw = String(textValue || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // CLI 偶尔会在 JSON 前后输出提示行：取最后一个完整 JSON 对象。
    const lines = raw.split(/\r?\n/).reverse();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        return JSON.parse(trimmed);
      } catch {
        /* 继续 */
      }
    }
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(raw.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isSocksError(error) {
  const textValue = `${error?.code || ""} ${error?.message || ""} ${error?.stderr || ""}`;
  return /SOCKS_CONNECTION_FAILED|ERR_SOCKS|ERR_PROXY_CONNECTION_FAILED|ERR_TUNNEL_CONNECTION_FAILED/i.test(textValue);
}

/** 在任意嵌套结构里找以 marker 开头的字符串（页面脚本返回值的位置不固定）。 */
function findMarkedString(value, marker, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.startsWith(marker)) return value;
    const index = value.indexOf(marker);
    if (index >= 0) {
      // 被二次 JSON 编码时字符串里会带转义，尝试解开。
      const parsed = parseJsonLoose(value);
      if (parsed && parsed !== value) return findMarkedString(parsed, marker, depth + 1);
      return value.slice(index);
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMarkedString(item, marker, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = findMarkedString(item, marker, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const MARK = "TZJSON:";

function decodeMarked(found) {
  if (!found) return undefined;
  let body = found.slice(MARK.length);
  // 末尾可能跟着 CLI 自己的引号或换行。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return JSON.parse(body);
    } catch {
      body = body.replace(/["'\s]+$/, "");
    }
  }
  return undefined;
}

class ZiniaoCli {
  constructor({ cliPath = "", dataDir = "", log = () => {}, timeoutMs = 120000, spawnImpl = spawn, extraEnv = {} } = {}) {
    this.dataDir = dataDir;
    this.configuredPath = cliPath;
    this.log = log;
    this.timeoutMs = timeoutMs;
    this.spawnImpl = spawnImpl;
    this.extraEnv = extraEnv;
    this.execStyle = null; // { command: "page"|"automation", flag: "--script", wrap: "expr"|"return" }
    this.helpCache = new Map();
  }

  get path() {
    return locateCli({ configuredPath: this.configuredPath, dataDir: this.dataDir });
  }

  runRaw(args, { timeoutMs = this.timeoutMs, input = null } = {}) {
    const bin = this.path;
    if (!bin) {
      return Promise.reject(new ZiniaoError("没有找到紫鸟 CLI（ziniao-cli.exe）。请在「设置」里一键安装或指定路径。", { type: "setup", code: "CLI_NOT_FOUND" }));
    }
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(bin, args, {
        windowsHide: true,
        env: { ...process.env, ...this.extraEnv, NO_COLOR: "1" },
      });
      let stdout = "";
      let stderr = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new ZiniaoError(`紫鸟 CLI 超时（${Math.round(timeoutMs / 1000)} 秒）：${args.slice(0, 2).join(" ")}`, { type: "timeout", code: "TIMEOUT", stdout, stderr, args }));
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(new ZiniaoError(`无法启动紫鸟 CLI：${error.message}`, { type: "setup", code: error.code || "SPAWN_FAILED", args }));
      });
      child.on("close", (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      if (input !== null) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  async run(args, { timeoutMs, retries = 3, input = null } = {}) {
    const fullArgs = args.includes("--format") ? args : [...args, "--format", "json"];
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const started = Date.now();
        const { code, stdout, stderr } = await this.runRaw(fullArgs, { timeoutMs, input });
        const out = parseJsonLoose(stdout);
        const err = parseJsonLoose(stderr);
        this.log("debug", `ziniao ${fullArgs.slice(0, 3).join(" ")} → ${code} (${Date.now() - started}ms)`);
        if (out && out.ok !== false && code === 0) return out.data !== undefined ? out.data : out;
        const errorObject = (err && err.error) || (out && out.error) || null;
        const message = errorObject?.message || stderr.trim() || stdout.trim() || `紫鸟 CLI 退出码 ${code}`;
        throw new ZiniaoError(message, {
          type: errorObject?.type || "unknown",
          code: errorObject?.code || String(code),
          hint: errorObject?.hint || "",
          stdout,
          stderr,
          args: fullArgs,
        });
      } catch (error) {
        lastError = error;
        if (attempt < retries && isSocksError(error)) {
          this.log("warn", `代理连接失败，5 秒后重试（${attempt + 1}/${retries}）`);
          await sleep(5000);
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  async help(sub) {
    if (this.helpCache.has(sub)) return this.helpCache.get(sub);
    let textValue = "";
    try {
      const { stdout, stderr } = await this.runRaw([...sub.split(" "), "--help"], { timeoutMs: 20000 });
      textValue = `${stdout}\n${stderr}`;
    } catch {
      textValue = "";
    }
    this.helpCache.set(sub, textValue);
    return textValue;
  }

  async version() {
    try {
      const { stdout, stderr } = await this.runRaw(["--version"], { timeoutMs: 20000 });
      return `${stdout}${stderr}`.trim().split(/\r?\n/)[0] || "";
    } catch (error) {
      return `不可用：${error.message}`;
    }
  }

  doctor() {
    return this.run(["doctor"], { timeoutMs: 60000, retries: 0 });
  }

  async listStores({ keyword = "" } = {}) {
    const args = ["store", "list", "--all"];
    if (keyword) args.push("--keyword", keyword);
    let data;
    try {
      data = await this.run(args, { timeoutMs: 60000 });
    } catch (error) {
      // 旧版本没有 --all 参数时退回不带 --all。
      if (/unknown flag|--all/i.test(error.message)) data = await this.run(args.filter((item) => item !== "--all"), { timeoutMs: 60000 });
      else throw error;
    }
    const list = Array.isArray(data) ? data : data?.list || data?.stores || data?.items || data?.records || [];
    return list.map((store) => ({
      storeId: String(store.storeId ?? store.id ?? store.browserId ?? store.browserOauth ?? ""),
      storeName: String(store.storeName ?? store.name ?? store.browserName ?? ""),
      platformName: String(store.platformName ?? store.platform ?? store.siteName ?? ""),
      site: String(store.site ?? store.siteName ?? store.country ?? ""),
      ip: String(store.ip ?? store.proxyIp ?? ""),
      raw: store,
    })).filter((store) => store.storeId || store.storeName);
  }

  openStore({ storeId, url = "", headless = false, expectedName = "" }) {
    const args = ["store", "open", "--id", String(storeId)];
    if (url) args.push("--url", url);
    if (headless) args.push("--headless");
    if (expectedName) args.push("--expected-name", expectedName);
    return this.run(args, { timeoutMs: 180000 });
  }

  closeStore({ storeId }) {
    return this.run(["store", "close", "--id", String(storeId)], { timeoutMs: 60000, retries: 0 }).catch((error) => {
      this.log("warn", `关闭店铺窗口失败（可忽略）：${error.message}`);
      return null;
    });
  }

  visit({ storeId, url, waitUntil = "networkidle", timeoutMs = 90000 }) {
    return this.run(["page", "visit", "--store-id", String(storeId), "--url", url, "--wait-until", waitUntil, "--timeout", String(timeoutMs)], { timeoutMs: timeoutMs + 30000 });
  }

  /** 根据 --help 推断「在页面里执行 JS」应使用的命令与参数名。 */
  async detectExecStyle() {
    if (this.execStyle) return this.execStyle;
    const pageHelp = await this.help("page exec");
    const flags = ["--script", "--code", "--expression", "--js", "--source"];
    const flag = flags.find((item) => pageHelp.includes(item));
    if (flag) {
      this.execStyle = { command: "page", flag, storeFlag: pageHelp.includes("--store-id") ? "--store-id" : "", wrap: null };
    } else {
      const autoHelp = await this.help("automation run");
      this.execStyle = { command: "automation", flag: "--steps", storeFlag: autoHelp.includes("--store-id") ? "--store-id" : "", wrap: null };
    }
    return this.execStyle;
  }

  async execOnce(storeId, script, { timeoutMs = 60000, targetId = "" } = {}) {
    const style = await this.detectExecStyle();
    let args;
    if (style.command === "page") {
      args = ["page", "exec"];
      if (style.storeFlag) args.push(style.storeFlag, String(storeId));
      if (targetId) args.push("--target-id", targetId);
      args.push(style.flag, script);
    } else {
      args = ["automation", "run"];
      if (style.storeFlag) args.push(style.storeFlag, String(storeId));
      args.push("--steps", JSON.stringify([{ type: "exec", script, timeoutMs }]));
    }
    return this.run(args, { timeoutMs: timeoutMs + 30000 });
  }

  /**
   * 同步表达式求值：表达式结果必须是字符串 "TZJSON:<json>"。
   * 首次会探测 CLI 是把脚本当作表达式还是函数体（需要 return）。
   */
  async evaluate(storeId, expression, options = {}) {
    const variants = this.execStyle?.wrap ? [this.execStyle.wrap] : ["expr", "return", "iife"];
    let lastData = null;
    for (const wrap of variants) {
      const script = wrap === "expr" ? expression : wrap === "return" ? `return (${expression});` : `(() => (${expression}))()`;
      const data = await this.execOnce(storeId, script, options);
      lastData = data;
      const found = findMarkedString(data, MARK);
      if (found) {
        if (this.execStyle && !this.execStyle.wrap) {
          this.execStyle.wrap = wrap;
          this.log("info", `紫鸟页面脚本模式：${this.execStyle.command} ${this.execStyle.flag} / ${wrap}`);
        }
        return decodeMarked(found);
      }
    }
    throw new ZiniaoError("页面脚本没有返回结果：紫鸟 CLI 的 page exec 返回格式与预期不同。请在「诊断」页查看原始输出。", {
      type: "exec",
      code: "EXEC_NO_RESULT",
      stdout: JSON.stringify(lastData).slice(0, 2000),
    });
  }

  /**
   * 运行一段异步页面代码（函数体，可 await，最终 return 一个可 JSON 化的值）。
   * 先启动、写入 window.__tzJobs[id]，再轮询读取，兼容 CLI 不等待 Promise 的情况。
   */
  async runInPage(storeId, asyncBody, { timeoutMs = 90000, pollMs = 1000 } = {}) {
    const id = `j${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;
    const starter = `(function(){var w=window;w.__tzJobs=w.__tzJobs||{};w.__tzJobs[${JSON.stringify(id)}]={done:false};`
      + `(async function(){${asyncBody}\n})().then(function(v){w.__tzJobs[${JSON.stringify(id)}]={done:true,value:v};},`
      + `function(e){w.__tzJobs[${JSON.stringify(id)}]={done:true,error:String(e&&e.stack||e)};});`
      + `return "TZJSON:"+JSON.stringify({started:true});})()`;
    await this.evaluate(storeId, starter, { timeoutMs: 30000 });
    const reader = `(function(){var j=(window.__tzJobs||{})[${JSON.stringify(id)}];`
      + `if(j&&j.done){delete window.__tzJobs[${JSON.stringify(id)}];}`
      + `return "TZJSON:"+JSON.stringify(j||{missing:true});})()`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const state = await this.evaluate(storeId, reader, { timeoutMs: 30000 });
      if (state?.missing) throw new ZiniaoError("页面在采集过程中刷新或跳转了，请重试。", { type: "exec", code: "PAGE_RELOADED" });
      if (state?.done) {
        if (state.error) throw new ZiniaoError(`页面脚本出错：${String(state.error).slice(0, 300)}`, { type: "exec", code: "PAGE_SCRIPT_ERROR" });
        return state.value;
      }
    }
    throw new ZiniaoError(`页面脚本超时（${Math.round(timeoutMs / 1000)} 秒）`, { type: "timeout", code: "PAGE_SCRIPT_TIMEOUT" });
  }
}

// ---------------------------------------------------------------------------
// 一键安装紫鸟 CLI：与官方 npm 包 postinstall 相同的下载源与 SHA-256 校验。
// ---------------------------------------------------------------------------

async function downloadBuffer(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`HTTP ${response.status}：${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function extractZip(archivePath, destDir, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const command = IS_WIN ? "powershell.exe" : "unzip";
    const args = IS_WIN
      ? ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`]
      : ["-o", archivePath, "-d", destDir];
    const child = spawnImpl(command, args, { windowsHide: true });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`解压失败，退出码 ${code}`))));
  });
}

function findFile(dir, name) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return "";
}

async function installCli({ dataDir, version = CLI_VERSION, log = () => {}, fetchImpl = fetch } = {}) {
  const goos = IS_WIN ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const goarch = process.arch === "arm64" ? "arm64" : "amd64";
  const ext = goos === "windows" ? "zip" : "tar.gz";
  const archiveName = `ziniao-cli-${version}-${goos}-${goarch}.${ext}`;
  const base = `${DOWNLOAD_BASE}/v${version}`;
  log("info", `下载紫鸟 CLI ${version}：${archiveName}`);
  const checksums = (await downloadBuffer(`${base}/checksums.txt`, fetchImpl)).toString("utf8");
  const expected = checksums.split(/\r?\n/).map((line) => line.trim().match(/^([0-9a-f]{64})\s+\*?(\S+)$/i)).find((match) => match && match[2] === archiveName)?.[1];
  if (!expected) throw new Error(`checksums.txt 中没有 ${archiveName}`);
  const archive = await downloadBuffer(`${base}/${archiveName}`, fetchImpl);
  const actual = crypto.createHash("sha256").update(archive).digest("hex");
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error("紫鸟 CLI 校验失败（SHA-256 不一致），已停止安装。");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tz-ziniao-"));
  const archivePath = path.join(work, archiveName);
  fs.writeFileSync(archivePath, archive);
  if (ext === "zip") await extractZip(archivePath, work);
  else await new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xf", archivePath, "-C", work]);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar 退出码 ${code}`))));
  });
  const exe = IS_WIN ? "ziniao-cli.exe" : "ziniao-cli";
  const found = findFile(work, exe);
  if (!found) throw new Error(`压缩包里没有 ${exe}`);
  const target = path.join(dataDir, "bin", exe);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(found, target);
  if (!IS_WIN) fs.chmodSync(target, 0o755);
  fs.rmSync(work, { recursive: true, force: true });
  log("info", `紫鸟 CLI 已安装：${target}`);
  return target;
}

module.exports = { ZiniaoCli, ZiniaoError, locateCli, candidatePaths, installCli, parseJsonLoose, findMarkedString, decodeMarked, isSocksError, CLI_VERSION };

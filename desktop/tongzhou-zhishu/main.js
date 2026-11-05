"use strict";

// 同舟智数 · Electron 主进程

const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, safeStorage, nativeImage, Notification, powerSaveBlocker } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { ConfigStore } = require("./core/config");
const { ZiniaoCli, installCli, CLI_VERSION } = require("./core/ziniao");
const { ZhongtaiClient } = require("./core/zhongtai");
const { Collector, defaultDates } = require("./core/collector");
const { Scheduler } = require("./core/scheduler");
const { describePlatforms, allTemplates } = require("./core/platforms");
const { METRIC_FIELDS, validateTemplate } = require("./core/recipe");
const { SITES } = require("./core/sites");

app.setName("同舟智数");
// 测试或便携使用时可通过环境变量指定数据目录。
if (process.env.TZZS_DATA_DIR) app.setPath("userData", process.env.TZZS_DATA_DIR);
if (process.platform === "win32") app.setAppUserModelId("com.tongzhou.zhishu");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const dataDir = app.getPath("userData");
const logDir = path.join(dataDir, "logs");
fs.mkdirSync(logDir, { recursive: true });

let mainWindow = null;
let tray = null;
let quitting = false;
const logBuffer = [];

function log(level, message) {
  const line = { at: new Date().toISOString(), level, message: String(message) };
  if (level !== "debug") {
    logBuffer.push(line);
    if (logBuffer.length > 800) logBuffer.shift();
    mainWindow?.webContents.send("log", line);
  }
  try {
    fs.appendFileSync(path.join(logDir, `${line.at.slice(0, 10)}.log`), `${line.at} [${level}] ${line.message}\n`);
  } catch {
    /* ignore */
  }
}

const store = new ConfigStore(dataDir);

// ---------------------------------------------------------------------------
// 令牌加密保存（Windows DPAPI，换电脑/换用户无法解密）
// ---------------------------------------------------------------------------

function readToken() {
  const { tokenEnc, token } = store.get().zhongtai;
  if (tokenEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(tokenEnc, "base64"));
    } catch {
      return "";
    }
  }
  return token || "";
}

function writeToken(value) {
  store.update((config) => {
    if (safeStorage.isEncryptionAvailable()) {
      config.zhongtai.tokenEnc = value ? safeStorage.encryptString(value).toString("base64") : "";
      config.zhongtai.token = "";
    } else {
      config.zhongtai.token = value;
    }
  });
}

const cli = new ZiniaoCli({ cliPath: store.get().ziniao.cliPath, dataDir, log });
const zhongtai = () => new ZhongtaiClient({ baseUrl: store.get().zhongtai.baseUrl, token: readToken() });
const collector = new Collector({ cli, store, log, zhongtaiFactory: zhongtai });

const schedulerStateFile = path.join(dataDir, "scheduler.json");
const scheduler = new Scheduler({
  getSchedule: () => store.get().schedule,
  log,
  state: (() => {
    try {
      return JSON.parse(fs.readFileSync(schedulerStateFile, "utf8"));
    } catch {
      return { done: [] };
    }
  })(),
  saveState: (state) => fs.writeFileSync(schedulerStateFile, JSON.stringify(state)),
  run: () => startCollect({ mode: store.get().schedule.autoUpload ? "upload" : "preview", trigger: "schedule" }).catch((error) => log("error", `定时采集失败：${error.message}`)),
});

// ---------------------------------------------------------------------------
// 采集
// ---------------------------------------------------------------------------

async function startCollect({ storeIds = null, dates = null, mode = "upload", trigger = "manual" } = {}) {
  if (collector.running) throw new Error("已有采集任务在运行");
  const blocker = powerSaveBlocker.start("prevent-app-suspension");
  log("info", `开始采集（${trigger === "schedule" ? "定时" : "手动"}，${mode === "upload" ? "写入中台" : mode === "preview" ? "中台试匹配" : "仅本地"}）`);
  mainWindow?.webContents.send("run-state", { running: true });
  updateTray();
  try {
    const result = await collector.collect({
      storeIds,
      dates,
      mode,
      trigger,
      onProgress: (event) => mainWindow?.webContents.send("progress", event),
    });
    const ok = result.stores.filter((item) => item.status === "ok").length;
    const failed = result.stores.filter((item) => item.status === "failed").length;
    const uploaded = result.upload?.ok ? `，中台${result.upload.dryRun ? "可匹配" : "写入"} ${result.upload.dryRun ? result.upload.rowCount : result.upload.written} 行` : result.upload ? `，写入中台失败：${result.upload.message}` : "";
    const summary = `采集完成：成功 ${ok} 店，失败 ${failed} 店，共 ${result.rowCount} 行${uploaded}`;
    log(failed || (result.upload && !result.upload.ok) ? "warn" : "info", summary);
    if (Notification.isSupported() && (trigger === "schedule" || !mainWindow?.isVisible())) new Notification({ title: "同舟智数", body: summary }).show();
    return result;
  } finally {
    powerSaveBlocker.stop(blocker);
    mainWindow?.webContents.send("run-state", { running: false });
    updateTray();
  }
}

// ---------------------------------------------------------------------------
// 界面状态
// ---------------------------------------------------------------------------

function publicConfig() {
  const config = store.get();
  const token = readToken();
  return {
    ...config,
    zhongtai: { baseUrl: config.zhongtai.baseUrl, hasToken: Boolean(token), tokenHint: token ? `${token.slice(0, 4)}…${token.slice(-4)}` : "" },
  };
}

function state() {
  return {
    appVersion: app.getVersion(),
    config: publicConfig(),
    platforms: describePlatforms(),
    metricFields: METRIC_FIELDS,
    sites: Object.entries(SITES).map(([code, info]) => ({ code, ...info })),
    cliPath: cli.path,
    cliVersion: CLI_VERSION,
    running: Boolean(collector.running),
    history: store.history().slice(0, 30),
    logs: logBuffer.slice(-300),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    defaultDates: defaultDates(store.get().schedule),
    templateProblems: Object.fromEntries(Object.values(store.get().templates).map((template) => [template.id, validateTemplate(template)])),
    builtinTemplates: Object.values(allTemplates({})),
    storeOverview: collector.storeOverview(),
  };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (error) {
      log("error", `${channel}：${error.message}`);
      return { ok: false, message: error.message, code: error.code || "", hint: error.hint || "", detail: error.stdout ? String(error.stdout).slice(0, 2000) : "" };
    }
  });
}

handle("state", () => state());

handle("settings:save", ({ zhongtai: zt = {}, ziniao = {}, schedule = {}, openAtLogin }) => {
  if (zt.token !== undefined && zt.token !== "") writeToken(String(zt.token).trim());
  if (zt.clearToken) writeToken("");
  store.update((config) => {
    if (zt.baseUrl !== undefined) config.zhongtai.baseUrl = String(zt.baseUrl).trim().replace(/\/+$/, "");
    Object.assign(config.ziniao, ziniao);
    if (schedule.times) schedule.times = schedule.times.map((time) => String(time).trim()).filter((time) => /^\d{1,2}:\d{2}$/.test(time));
    Object.assign(config.schedule, schedule);
  });
  if (ziniao.cliPath !== undefined) cli.configuredPath = ziniao.cliPath;
  if (openAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: Boolean(openAtLogin), args: ["--hidden"] });
  updateTray();
  return state();
});

handle("zhongtai:test", async () => {
  const client = zhongtai();
  await client.ping();
  const shops = await client.listShops();
  return { shops, shopsSupported: shops !== null };
});

async function refreshZhongtaiShops() {
  const shops = await zhongtai().listShops();
  if (Array.isArray(shops)) store.update((config) => {
    config.zhongtaiShops = shops;
  });
  return shops || [];
}

handle("zhongtai:shops", () => refreshZhongtaiShops());

// 用中台账号登录一次即可：领取采集令牌后加密保存，密码不保存。
handle("zhongtai:pair", async ({ baseUrl, username, password }) => {
  if (baseUrl) store.update((config) => {
    config.zhongtai.baseUrl = String(baseUrl).trim().replace(/\/+$/, "");
  });
  const client = new ZhongtaiClient({ baseUrl: store.get().zhongtai.baseUrl });
  const result = await client.pair({ username: String(username || "").trim(), password: String(password || ""), device: require("node:os").hostname() });
  writeToken(result.token);
  store.update((config) => {
    config.zhongtaiUser = { username: result.user?.username || username, displayName: result.user?.displayName || username, at: new Date().toISOString() };
  });
  await refreshZhongtaiShops().catch((error) => log("warn", `读取中台店铺失败：${error.message}`));
  log("info", `已连接中台（${result.user?.displayName || username}）`);
  return state();
});

handle("zhongtai:unpair", () => {
  writeToken("");
  store.update((config) => {
    config.zhongtaiUser = null;
  });
  return state();
});

handle("cli:diagnose", async () => {
  const pathFound = cli.path;
  if (!pathFound) return { path: "", version: "", doctor: null, message: "没有找到紫鸟 CLI" };
  const version = await cli.version();
  let doctor = null;
  let doctorError = "";
  try {
    doctor = await cli.doctor();
  } catch (error) {
    doctorError = `${error.message}${error.hint ? `（${error.hint}）` : ""}`;
  }
  cli.execStyle = null;
  cli.helpCache.clear();
  const execStyle = await cli.detectExecStyle();
  return { path: pathFound, version, doctor, doctorError, execStyle };
});

handle("cli:install", async () => {
  const target = await installCli({ dataDir, log });
  cli.helpCache.clear();
  cli.execStyle = null;
  return { path: target };
});

handle("cli:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "选择 ziniao-cli.exe", properties: ["openFile"], filters: [{ name: "程序", extensions: ["exe"] }, { name: "全部", extensions: ["*"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  store.update((config) => {
    config.ziniao.cliPath = result.filePaths[0];
  });
  cli.configuredPath = result.filePaths[0];
  return result.filePaths[0];
});

handle("stores:refresh", async () => collector.refreshStores());

handle("stores:save", (mapping) => {
  if (!mapping.storeId) throw new Error("缺少店铺 ID");
  return store.upsertStore(mapping);
});

handle("stores:remove", ({ storeId }) => {
  store.update((config) => {
    delete config.stores[storeId];
  });
  return true;
});

// 调试转储：校准/试采的原始结果写到程序目录下的 debug\ 文件夹，便于技术人员排查卖家中心改版。
function debugDump(name, data) {
  try {
    const dir = path.join(path.dirname(process.execPath), "debug");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.json`), JSON.stringify(data, null, 1));
  } catch {
    /* ignore */
  }
}

handle("calibrate:discover", async (payload) => {
  const result = await collector.discover(payload);
  const raw = collector.discoveries.get(payload.storeId);
  debugDump("discover", { payload, href: raw?.href, requests: (raw?.requests || []).map(({ json, ...rest }) => ({ ...rest, json: JSON.stringify(json).slice(0, 60000) })) });
  return result;
});
handle("calibrate:build", (payload) => collector.buildTemplate(payload));
handle("calibrate:test", async (payload) => {
  const result = await collector.testTemplate(payload);
  debugDump("trial", { payload, result });
  return result;
});

handle("templates:save", (template) => store.upsertTemplate(template));
handle("templates:delete", ({ id }) => {
  store.deleteTemplate(id);
  return true;
});

handle("templates:export", async ({ id }) => {
  const template = store.get().templates[id];
  if (!template) throw new Error("模板不存在");
  const result = await dialog.showSaveDialog(mainWindow, { title: "导出采集模板", defaultPath: `${template.name.replace(/[\\/:*?"<>|]/g, "_")}.tzzs.json`, filters: [{ name: "同舟智数模板", extensions: ["json"] }] });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, JSON.stringify({ kind: "tongzhou-zhishu-template", version: 1, template }, null, 2));
  return result.filePath;
});

handle("templates:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "导入采集模板", properties: ["openFile"], filters: [{ name: "同舟智数模板", extensions: ["json"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], "utf8"));
  const template = parsed.kind === "tongzhou-zhishu-template" ? parsed.template : parsed;
  if (!template || !Array.isArray(template.endpoints)) throw new Error("不是有效的同舟智数模板文件");
  // 只接受 https 接口，防止导入的模板把请求发到奇怪的地方。
  for (const endpoint of template.endpoints) if (!/^https:\/\/[^/]*shopee|^https:\/\/[^/]*tiktok|^https:\/\/[^/]*lazada/i.test(endpoint.url)) throw new Error(`模板里的接口地址不在允许范围：${endpoint.url}`);
  return store.upsertTemplate({ ...template, id: "" });
});

handle("collect:start", (payload) => {
  // 不等待完成：进度通过事件推送，结果写入历史。
  startCollect(payload).catch((error) => log("error", `采集失败：${error.message}`));
  return true;
});
handle("collect:cancel", () => {
  collector.cancel();
  log("warn", "已请求取消：当前店铺完成后停止");
  return true;
});
handle("history:list", () => store.history());
handle("history:rows", ({ id }) => store.resultRows(id));
handle("history:reupload", ({ id, dryRun }) => collector.reupload(id, { dryRun }));
handle("open:logs", () => shell.openPath(logDir));
handle("open:data", () => shell.openPath(dataDir));
function splitArgs(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(String(text || "")))) out.push(match[1] !== undefined ? match[1].replace(/\\"/g, '"') : match[2] !== undefined ? match[2] : match[3]);
  return out;
}

// 调试：直接运行紫鸟 CLI 命令，返回原始输出（用于适配不同 CLI 版本）。
handle("debug:cli", async ({ args }) => {
  const list = Array.isArray(args) ? args : splitArgs(args);
  const started = Date.now();
  const result = await cli.runRaw(list, { timeoutMs: 180000 });
  return { args: list, ms: Date.now() - started, ...result };
});
handle("debug:page", async ({ storeId, body }) => cli.runInPage(storeId, body, { timeoutMs: 120000 }));
handle("app:relaunch", () => {
  quitting = true;
  app.relaunch();
  app.exit(0);
});

handle("open:url", ({ url }) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
  return true;
});

// ---------------------------------------------------------------------------
// 窗口与托盘
// ---------------------------------------------------------------------------

function iconPath() {
  return path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png");
}

function createWindow({ hidden = false } = {}) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "同舟智数",
    icon: fs.existsSync(iconPath()) ? iconPath() : undefined,
    show: !hidden,
    backgroundColor: "#f5f6f8",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.removeMenu();
  if (!hidden) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "ui", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      if (!store.get().trayHintShown && Notification.isSupported()) {
        new Notification({ title: "同舟智数仍在后台运行", body: "定时采集会照常执行。右键托盘图标可退出。" }).show();
        store.update((config) => {
          config.trayHintShown = true;
        });
      }
    }
  });
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  mainWindow.focus();
}

function updateTray() {
  if (!tray) return;
  const schedule = store.get().schedule;
  tray.setToolTip(`同舟智数${collector.running ? " · 采集中" : ""}${schedule.enabled ? ` · 每天 ${schedule.times.join("、")}` : ""}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开同舟智数", click: showWindow },
    { type: "separator" },
    { label: collector.running ? "采集进行中…" : "立即采集并写入中台", enabled: !collector.running, click: () => startCollect({ mode: "upload" }).catch((error) => log("error", error.message)) },
    { label: "取消采集", enabled: Boolean(collector.running), click: () => collector.cancel() },
    { type: "separator" },
    { label: "退出", click: () => {
      quitting = true;
      app.quit();
    } },
  ]));
}

function createTray() {
  const image = fs.existsSync(path.join(__dirname, "build", "tray.png"))
    ? nativeImage.createFromPath(path.join(__dirname, "build", "tray.png"))
    : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.on("click", showWindow);
  updateTray();
}

app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  /* 常驻托盘 */
});

app.whenReady().then(() => {
  const hidden = process.argv.includes("--hidden");
  createWindow({ hidden });
  createTray();
  scheduler.start();
  log("info", `同舟智数 ${app.getVersion()} 已启动，数据目录：${dataDir}`);
  // 启动时自动读取紫鸟店铺和中台店铺名单，用户不需要手动点。
  setTimeout(async () => {
    if (cli.path) await collector.refreshStores().then((list) => log("info", `读取到 ${list.length} 个紫鸟店铺`)).catch((error) => log("warn", `读取紫鸟店铺失败：${error.message}`));
    if (readToken()) await refreshZhongtaiShops().catch(() => {});
    mainWindow?.webContents.send("run-state", { running: Boolean(collector.running) });
  }, 1500);
});

"use strict";

// 同舟智数 · 启动入口（外壳）。
// 选出要运行的程序版本（安装包自带，或自动更新下载的新版本）后加载它的 main.js。
// 自动更新只替换程序代码（几百 KB），不动 Electron 运行环境。

const { app } = require("electron");
const path = require("node:path");

const { selectApp, rollback } = require("./core/boot-select");

app.setName("同舟智数");
// 测试或便携使用时可通过环境变量指定数据目录。
if (process.env.TZZS_DATA_DIR) app.setPath("userData", process.env.TZZS_DATA_DIR);

const shellVersion = require("./package.json").version;
const updatesDir = path.join(app.getPath("userData"), "updates");

let selected = { dir: __dirname, version: shellVersion, source: "shell", note: "" };
try {
  selected = selectApp({ updatesDir, shellDir: __dirname, shellVersion });
} catch (error) {
  selected.note = `读取更新状态失败，使用安装包自带的程序：${error.message}`;
}

global.__TZZS_BOOT__ = { shellDir: __dirname, shellVersion, updatesDir, version: selected.version, source: selected.source, note: selected.note };

try {
  require(path.join(selected.dir, "main.js"));
} catch (error) {
  if (selected.source !== "update") throw error;
  // 新版本一加载就报错：记为失败、回退，然后重启（不在同一个进程里再加载另一份，避免状态混乱）。
  try {
    rollback(updatesDir, shellVersion, `启动报错：${String(error && error.message).slice(0, 200)}`);
  } catch {
    /* ignore */
  }
  app.relaunch();
  app.exit(0);
}

"use strict";

// 启动时决定运行哪一份程序：安装包自带的（外壳），还是自动更新下载到数据目录里的新版本。
// 这个文件属于外壳，只有重新安装完整包才会变，所以逻辑要保持简单、稳定：
// - 更新版本必须比外壳版本新，否则用外壳（手动装了更新的完整包时自动让位）；
// - 新版本第一次启动是「待确认」：连续 2 次启动都没被确认（没能连上中台），第 3 次启动回退；
// - 回退到上一个可用的更新版本，没有就回到外壳，并记入 failed.json 不再重试同一个包。

const fs = require("node:fs");
const path = require("node:path");

const MAX_PENDING_STARTS = 2;

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
  return match ? match.slice(1).map(Number) : null;
}

/** a > b → 1，a < b → -1，相等或无法比较 → 0。 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function versionDir(updatesDir, version) {
  return path.join(updatesDir, `v${version}`);
}

/** 这个版本目录是否完整可用。 */
function usable(updatesDir, version, shellVersion) {
  if (!parseVersion(version) || compareVersions(version, shellVersion) <= 0) return false;
  const dir = versionDir(updatesDir, version);
  if (!fs.existsSync(path.join(dir, "main.js"))) return false;
  return readJson(path.join(dir, "package.json"), {}).version === version;
}

function recordFailure(updatesDir, entry) {
  const file = path.join(updatesDir, "failed.json");
  const list = readJson(file, []).filter((item) => item && item.version !== entry.version);
  list.push(entry);
  writeJson(file, list.slice(-20));
}

/** 把当前版本标记为失败并回退；返回回退后应运行的版本（null = 外壳）。 */
function rollback(updatesDir, shellVersion, reason, nowIso = new Date().toISOString()) {
  const currentFile = path.join(updatesDir, "current.json");
  const current = readJson(currentFile, null);
  if (!current) return null;
  recordFailure(updatesDir, { version: current.version, sha256: current.sha256 || "", reason, at: nowIso });
  const previous = current.previous && usable(updatesDir, current.previous, shellVersion) ? current.previous : null;
  if (previous) writeJson(currentFile, { version: previous, state: "confirmed", attempts: 0, previous: null, rolledBackFrom: current.version, at: nowIso });
  else fs.rmSync(currentFile, { force: true });
  return previous;
}

/**
 * @returns {{ dir: string, version: string, source: "shell" | "update", note: string }}
 */
function selectApp({ updatesDir, shellDir, shellVersion, nowIso = new Date().toISOString() }) {
  const shell = (note = "") => ({ dir: shellDir, version: shellVersion, source: "shell", note });
  const update = (version, note = "") => ({ dir: versionDir(updatesDir, version), version, source: "update", note });
  const currentFile = path.join(updatesDir, "current.json");
  const current = readJson(currentFile, null);
  if (!current || !current.version) return shell();
  if (compareVersions(current.version, shellVersion) <= 0) {
    // 手动安装了同版本或更新的完整包：更新目录让位。
    fs.rmSync(currentFile, { force: true });
    return shell("安装包版本不低于已下载的更新，使用安装包自带的程序");
  }
  if (!usable(updatesDir, current.version, shellVersion)) {
    const previous = rollback(updatesDir, shellVersion, "更新文件不完整", nowIso);
    return previous ? update(previous, `更新 ${current.version} 文件不完整，已回退到 ${previous}`) : shell(`更新 ${current.version} 文件不完整，已回退到安装包版本`);
  }
  if (current.state === "pending") {
    const attempts = Number(current.attempts || 0) + 1;
    if (attempts > MAX_PENDING_STARTS) {
      const previous = rollback(updatesDir, shellVersion, "新版本启动后一直没能连上中台", nowIso);
      return previous ? update(previous, `更新 ${current.version} 未通过确认，已回退到 ${previous}`) : shell(`更新 ${current.version} 未通过确认，已回退到安装包版本`);
    }
    writeJson(currentFile, { ...current, attempts });
  }
  return update(current.version);
}

module.exports = { selectApp, rollback, compareVersions, parseVersion, versionDir, usable, readJson, writeJson, MAX_PENDING_STARTS };

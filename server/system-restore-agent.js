import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fetch as undiciFetch } from "undici";
import { recoverRestoreTransaction, runRestoreTransaction } from "./system-restore-transaction.js";

const execFileAsync = promisify(execFile);

function loadEnv() {
  if (process.env.SKIP_ENV_FILE === "true") return;
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!process.env[key]) process.env[key] = trimmed.slice(separator + 1).trim();
  }
}

loadEnv();

const projectRoot = resolve(process.cwd());
const backupRoot = resolve(process.env.SYSTEM_BACKUP_DIR || resolve(projectRoot, ".system-backup"));
const requestDir = resolve(backupRoot, "restore-requests");
const transactionDir = resolve(backupRoot, "transactions");
const jobsDir = resolve(backupRoot, "jobs");
const heartbeatPath = resolve(backupRoot, "restore-agent-heartbeat.json");
const auditPath = resolve(backupRoot, "audit.jsonl");
const appName = process.env.SYSTEM_BACKUP_PM2_APP || "tongzhou-supply-api";
const pm2Bin = process.env.PM2_BIN || (process.platform === "win32" ? "pm2.cmd" : "pm2");
const pollMs = Math.max(1_000, Number(process.env.SYSTEM_RESTORE_POLL_MS || 3_000));

mkdirSync(requestDir, { recursive: true, mode: 0o700 });
mkdirSync(transactionDir, { recursive: true, mode: 0o700 });
mkdirSync(jobsDir, { recursive: true, mode: 0o700 });

function atomicWriteJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function updateJob(id, patch) {
  const path = resolve(jobsDir, `${id}.json`);
  if (!existsSync(path)) return;
  const current = readJson(path);
  atomicWriteJson(path, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

function audit(action, details = {}) {
  const entry = { createdAt: new Date().toISOString(), actor: "restore-agent", action, details };
  appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function pm2(...args) {
  await execFileAsync(pm2Bin, args, { cwd: projectRoot, windowsHide: true, timeout: 60_000 });
}

function operationsFor(request) {
  return {
    exists: existsSync,
    rename(source, target) {
      renameSync(source, target);
    },
    failedPath(path, id) {
      return `${path}.failed-import-${id}-${Date.now()}`;
    },
    async stopApp() {
      await pm2("stop", appName);
    },
    async startApp() {
      await pm2("restart", appName, "--update-env");
    },
    async waitForHealthy() {
      const deadline = Date.now() + Math.max(10_000, Number(request.healthTimeoutMs || 90_000));
      let lastMessage = "";
      while (Date.now() < deadline) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        try {
          const response = await undiciFetch(request.healthUrl, { signal: controller.signal });
          const payload = await response.json().catch(() => ({}));
          if (response.ok && payload.ok) return;
          lastMessage = `HTTP ${response.status}`;
        } catch (error) {
          lastMessage = error.message;
        } finally {
          clearTimeout(timeout);
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
      }
      throw new Error(`Application health check timed out: ${lastMessage}`);
    },
  };
}

function validateRequest(request) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(String(request.id || ""))) throw new Error("Invalid restore request id");
  const expectedEnv = resolve(process.env.SYSTEM_BACKUP_ENV_PATH || resolve(projectRoot, ".env"));
  const expectedCache = resolve(process.env.CACHE_DIR || resolve(projectRoot, ".cache"));
  if (resolve(request.paths?.targetEnv || "") !== expectedEnv) throw new Error("Restore target environment path is invalid");
  if (resolve(request.paths?.targetCache || "") !== expectedCache) throw new Error("Restore target cache path is invalid");
  const expectedPaths = {
    readyCache: `${expectedCache}.next-import-${request.id}`,
    rollbackCache: `${expectedCache}.pre-import-${request.id}`,
    readyEnv: `${expectedEnv}.next-import-${request.id}`,
    rollbackEnv: `${expectedEnv}.pre-import-${request.id}`,
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (resolve(request.paths?.[key] || "") !== resolve(expected)) throw new Error(`Restore path is invalid: ${key}`);
  }
  if (!/^http:\/\/127\.0\.0\.1:\d+\/api\/health$/.test(String(request.healthUrl || ""))) {
    throw new Error("Restore health URL is invalid");
  }
}

async function processRequest(path) {
  const request = readJson(path);
  if (request.status !== "queued") return;
  validateRequest(request);
  atomicWriteJson(path, { ...request, status: "processing", startedAt: new Date().toISOString() });
  updateJob(request.id, { status: "restoring", phase: "stopping_service", message: "正在停止主服务并切换数据" });
  audit("restore_started", { jobId: request.id, envMode: request.envMode });
  const journalPath = resolve(transactionDir, `${request.id}.json`);
  try {
    const result = await runRestoreTransaction({
      id: request.id,
      journalPath,
      paths: request.paths,
      operations: operationsFor(request),
    });
    atomicWriteJson(path, { ...request, status: "completed", completedAt: new Date().toISOString() });
    updateJob(request.id, {
      status: "completed",
      phase: "completed",
      progress: 100,
      completedAt: new Date().toISOString(),
      message: "系统恢复完成，健康检查通过",
      rollbackAvailable: true,
    });
    audit("restore_completed", { jobId: request.id, phase: result.phase });
  } catch (error) {
    const rolledBack = Boolean(error.rolledBack);
    atomicWriteJson(path, {
      ...request,
      status: rolledBack ? "rolled_back" : "failed",
      completedAt: new Date().toISOString(),
      error: String(error.message || error),
    });
    updateJob(request.id, {
      status: rolledBack ? "rolled_back" : "failed",
      phase: rolledBack ? "rolled_back" : "failed",
      completedAt: new Date().toISOString(),
      message: rolledBack ? "恢复失败，已自动回滚到原数据" : "恢复失败，未修改原数据",
      error: String(error.message || error),
    });
    audit(rolledBack ? "restore_rolled_back" : "restore_failed", { jobId: request.id, message: String(error.message || error) });
  }
}

async function recoverInterruptedTransactions() {
  for (const name of readdirSync(transactionDir).filter((item) => item.endsWith(".json"))) {
    const journalPath = resolve(transactionDir, name);
    const journal = readJson(journalPath);
    if (["committed", "rolled_back"].includes(journal.phase)) continue;
    const requestPath = resolve(requestDir, `${journal.id}.json`);
    const request = existsSync(requestPath) ? readJson(requestPath) : { id: journal.id, paths: journal.paths, healthUrl: `http://127.0.0.1:${process.env.API_PORT || 8787}/api/health` };
    try {
      const recovered = await recoverRestoreTransaction({ journalPath, operations: operationsFor(request) });
      if (recovered?.phase === "rolled_back") {
        if (existsSync(requestPath)) atomicWriteJson(requestPath, { ...request, status: "rolled_back", recoveredAt: new Date().toISOString() });
        updateJob(journal.id, { status: "rolled_back", phase: "rolled_back", message: "恢复代理重启后已自动回滚原数据" });
        audit("restore_recovered_with_rollback", { jobId: journal.id });
      }
    } catch (error) {
      updateJob(journal.id, { status: "failed", phase: "recovery_failed", error: String(error.message || error), message: "自动回滚失败，需要人工处理" });
      audit("restore_recovery_failed", { jobId: journal.id, message: String(error.message || error) });
    }
  }

  for (const name of readdirSync(requestDir).filter((item) => item.endsWith(".json"))) {
    const requestPath = resolve(requestDir, name);
    const request = readJson(requestPath);
    if (request.status !== "processing") continue;
    const journalPath = resolve(transactionDir, `${request.id}.json`);
    const journal = existsSync(journalPath) ? readJson(journalPath) : null;
    if (journal?.phase === "committed") {
      atomicWriteJson(requestPath, { ...request, status: "completed", recoveredAt: new Date().toISOString() });
      updateJob(request.id, { status: "completed", phase: "completed", progress: 100, message: "系统恢复完成，恢复代理已确认事务提交", rollbackAvailable: true });
      continue;
    }
    if (journal?.phase === "rolled_back") {
      atomicWriteJson(requestPath, { ...request, status: "rolled_back", recoveredAt: new Date().toISOString() });
      updateJob(request.id, { status: "rolled_back", phase: "rolled_back", message: "恢复代理重启后已自动回滚原数据" });
      continue;
    }
    if (journal) continue;
    try { await operationsFor(request).startApp(); } catch { /* best effort; PM2 may already be running */ }
    atomicWriteJson(requestPath, { ...request, status: "failed", recoveredAt: new Date().toISOString(), error: "Restore agent stopped before transaction journal creation" });
    updateJob(request.id, { status: "failed", phase: "interrupted_before_transaction", message: "恢复代理在数据切换前中断，当前数据未修改，请重新导入" });
    audit("restore_interrupted_before_transaction", { jobId: request.id });
  }
}

let processing = false;
async function poll() {
  if (processing) return;
  processing = true;
  try {
    for (const name of readdirSync(requestDir).filter((item) => item.endsWith(".json")).sort()) {
      await processRequest(resolve(requestDir, name));
    }
  } catch (error) {
    console.error("[system-restore-agent] poll failed", error);
  } finally {
    processing = false;
  }
}

function writeHeartbeat() {
  atomicWriteJson(heartbeatPath, {
    ok: true,
    pid: process.pid,
    appName,
    updatedAt: new Date().toISOString(),
  });
}

await recoverInterruptedTransactions();
writeHeartbeat();
setInterval(writeHeartbeat, 5_000);
setInterval(() => { void poll(); }, pollMs);
void poll();
console.log(`[system-restore-agent] watching ${requestDir}`);

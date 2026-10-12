import {
  appendFileSync,
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { createEncryptedBackup, extractEncryptedBackup, inspectBackupHeader } from "./system-backup-archive.js";
import { listEnvKeys, mergeRestoredEnv, parseEnvDocument } from "./system-backup-env.js";

const ACTIVE_JOB_STATUSES = new Set(["queued", "snapshotting", "exporting", "uploading", "validating", "preparing_restore", "queued_restore", "restoring"]);
const SAFE_JOB_ID = /^[a-f0-9-]{36}$/;

function nowIso() {
  return new Date().toISOString();
}

function safeMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 2_000);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function isInside(parent, child) {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${sep}`);
}

function atomicWriteJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function directoryStats(path) {
  if (!existsSync(path)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop();
    const info = lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in backup data: ${current}`);
    if (info.isDirectory()) {
      for (const name of readdirSync(current)) pending.push(resolve(current, name));
    } else if (info.isFile()) {
      files += 1;
      bytes += info.size;
    }
  }
  return { bytes, files };
}

function availableDiskBytes(path) {
  let existing = resolve(path);
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  if (process.platform === "win32") {
    const drive = resolve(existing).match(/^([A-Za-z]):/i)?.[1];
    if (!drive) throw new Error("Cannot determine the backup drive");
    const output = execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-PSDrive -Name '${drive.toUpperCase()}').Free`,
    ], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
    const value = Number(output);
    if (!Number.isFinite(value)) throw new Error("Cannot determine available disk space");
    return value;
  }
  const output = execFileSync("df", ["-Pk", existing], { encoding: "utf8", timeout: 10_000 });
  const lines = output.trim().split(/\r?\n/);
  const columns = lines.at(-1)?.trim().split(/\s+/) || [];
  const kibibytes = Number(columns[3]);
  if (!Number.isFinite(kibibytes)) throw new Error("Cannot determine available disk space");
  return kibibytes * 1024;
}

function assertDiskCapacity(path, requiredBytes) {
  const freeBytes = availableDiskBytes(path);
  if (freeBytes < requiredBytes) {
    throw new Error(`Insufficient disk space: ${Math.ceil(requiredBytes / 1024 / 1024)} MiB required`);
  }
  return freeBytes;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameToken(actual, expectedHash) {
  const actualHash = Buffer.from(sha256(String(actual || "")), "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  return expected.length === actualHash.length && timingSafeEqual(actualHash, expected);
}

function cleanDownloadName(value) {
  const normalized = basename(String(value || "backup.tzbak")).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.toLowerCase().endsWith(".tzbak") ? normalized : `${normalized}.tzbak`;
}

function currentGitSha(projectRoot) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
  } catch {
    return String(process.env.APP_GIT_SHA || "").trim();
  }
}

function envPort(envText, fallback) {
  const raw = parseEnvDocument(envText).values.get("API_PORT");
  const value = Number(String(raw || "").replace(/^['\"]|['\"]$/g, ""));
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

export function createSystemBackupService({
  projectRoot = process.cwd(),
  cacheDir = resolve(projectRoot, ".cache"),
  envPath = resolve(projectRoot, ".env"),
  backupRoot = resolve(process.env.SYSTEM_BACKUP_DIR || resolve(projectRoot, ".system-backup")),
  scheduler,
  collaborationBridge,
  maintenanceGate,
  waitForApplicationIdle = async () => {},
  resumeBackgroundJobs = true,
  gitSha = currentGitSha(projectRoot),
  maxUploadBytes = Math.max(64 * 1024 * 1024, Number(process.env.SYSTEM_BACKUP_MAX_BYTES || 4 * 1024 * 1024 * 1024)),
  backgroundIdleTimeoutMs = Math.max(120_000, Number(process.env.SYSTEM_BACKUP_QUIESCE_TIMEOUT_MS || 2 * 60 * 60_000)),
  backgroundStatusIntervalMs = 5_000,
  maintenanceTimeoutMs = 120_000,
} = {}) {
  if (isInside(cacheDir, backupRoot)) throw new Error("SYSTEM_BACKUP_DIR must be outside CACHE_DIR");
  const jobsDir = resolve(backupRoot, "jobs");
  const workDir = resolve(backupRoot, "work");
  const exportsDir = resolve(backupRoot, "exports");
  const uploadsDir = resolve(backupRoot, "uploads");
  const requestDir = resolve(backupRoot, "restore-requests");
  const heartbeatPath = resolve(backupRoot, "restore-agent-heartbeat.json");
  const auditPath = resolve(backupRoot, "audit.jsonl");
  const secrets = new Map();
  const downloadTickets = new Map();
  let cachedDataStats = null;

  for (const path of [backupRoot, jobsDir, workDir, exportsDir, uploadsDir, requestDir]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }

  function jobPath(id) {
    if (!SAFE_JOB_ID.test(String(id || ""))) throw new Error("Invalid backup job id");
    return resolve(jobsDir, `${id}.json`);
  }

  function readJob(id) {
    const path = jobPath(id);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  }

  function writeJob(job) {
    const next = { ...job, updatedAt: nowIso() };
    atomicWriteJson(jobPath(job.id), next);
    return next;
  }

  function updateJob(id, patch) {
    const current = readJob(id);
    if (!current) throw new Error("Backup job not found");
    return writeJob({ ...current, ...patch });
  }

  function publicJob(job) {
    if (!job) return null;
    const {
      uploadTokenHash,
      packagePath,
      uploadPath,
      stageDir,
      stagedCacheDir,
      stagedEnvPath,
      restorePaths,
      ...safe
    } = job;
    return safe;
  }

  function appendAudit(action, actor, details = {}) {
    const entry = {
      id: randomUUID(),
      createdAt: nowIso(),
      action,
      actorId: String(actor?.id || "system"),
      actorName: String(actor?.displayName || actor?.username || "system"),
      details,
    };
    appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    return entry;
  }

  function listAudit(limit = 100) {
    if (!existsSync(auditPath)) return [];
    return readFileSync(auditPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(500, Number(limit) || 100)))
      .reverse()
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  }

  function listJobs(limit = 30) {
    return readdirSync(jobsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try { return readJob(name.slice(0, -5)); } catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit)
      .map(publicJob);
  }

  function restoreAgentStatus() {
    if (!existsSync(heartbeatPath)) return { healthy: false, message: "恢复代理尚未上报心跳" };
    try {
      const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8"));
      const ageMs = Date.now() - Date.parse(heartbeat.updatedAt || "");
      return {
        healthy: heartbeat.ok === true && Number.isFinite(ageMs) && ageMs <= 15_000,
        updatedAt: heartbeat.updatedAt || "",
        ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null,
        message: ageMs <= 15_000 ? "恢复代理在线" : "恢复代理心跳已过期",
      };
    } catch {
      return { healthy: false, message: "恢复代理心跳无效" };
    }
  }

  function getDataStats() {
    if (cachedDataStats && Date.now() - cachedDataStats.measuredAt < 30_000) return cachedDataStats;
    cachedDataStats = { ...directoryStats(cacheDir), measuredAt: Date.now() };
    return cachedDataStats;
  }

  function status() {
    cleanupExpiredArtifacts();
    const data = getDataStats();
    return {
      ok: true,
      gitSha,
      data: { bytes: data.bytes, files: data.files, envPresent: existsSync(envPath) },
      scope: {
        included: ["主应用业务缓存与本地数据库", "主应用 .env 配置"],
        excluded: ["协同系统 PostgreSQL 数据库", "对象存储中的外部文件", "服务器与 Nginx/PM2 配置"],
      },
      importEnabled: ["1", "true"].includes(String(process.env.ALLOW_SYSTEM_IMPORT || "").toLowerCase()),
      maxUploadBytes,
      maintenance: maintenanceGate?.status?.() || { active: false, activeMutations: 0 },
      restoreAgent: restoreAgentStatus(),
      jobs: listJobs(),
      audit: listAudit(50),
    };
  }

  function activeJob(type) {
    return listJobs(100).find((job) => job.type === type && ACTIVE_JOB_STATUSES.has(job.status));
  }

  function runningBackgroundTaskLabels() {
    try {
      return (scheduler?.status?.().tasks || [])
        .filter((task) => task.running)
        .map((task) => String(task.label || task.id || "").trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch {
      return [];
    }
  }

  async function waitForBackgroundIdle(jobId) {
    const startedAt = Date.now();
    const timeoutMs = Math.max(100, Number(backgroundIdleTimeoutMs) || 2 * 60 * 60_000);
    const intervalMs = Math.max(10, Math.min(timeoutMs, Number(backgroundStatusIntervalMs) || 5_000));
    const completion = Promise.all([
      Promise.resolve(scheduler?.waitForIdle?.()),
      Promise.resolve(collaborationBridge?.waitForIdle?.()),
      Promise.resolve(waitForApplicationIdle()),
    ]).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error }),
    );

    while (true) {
      const labels = runningBackgroundTaskLabels();
      updateJob(jobId, {
        status: "snapshotting",
        phase: "waiting_background_tasks",
        progress: 5,
        message: labels.length
          ? `正在等待后台任务安全收尾（业务可正常使用）：${labels.join("、")}`
          : "正在等待后台写入安全收尾，期间业务可正常使用",
      });
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        throw new Error(`等待后台同步任务完成超时${labels.length ? `：${labels.join("、")}` : ""}`);
      }
      const result = await Promise.race([completion, wait(Math.min(intervalMs, remainingMs))]);
      if (!result) continue;
      if (!result.ok) throw result.error;
      return;
    }
  }

  async function snapshotForExport(job) {
    const snapshotDir = resolve(workDir, job.id, "snapshot");
    const snapshotCache = resolve(snapshotDir, "cache");
    const snapshotEnv = resolve(snapshotDir, ".env");
    const wasSchedulerRunning = Boolean(scheduler?.status?.().enabled);
    let maintenanceEntered = false;
    scheduler?.stop?.();
    collaborationBridge?.stop?.();
    try {
      await waitForBackgroundIdle(job.id);
      updateJob(job.id, { status: "snapshotting", phase: "draining_writes", progress: 8, message: "正在短暂停止写入并排空当前请求" });
      await maintenanceGate.enter("system_backup_snapshot", { timeoutMs: maintenanceTimeoutMs });
      maintenanceEntered = true;
      await withTimeout(Promise.all([
        Promise.resolve(scheduler?.waitForIdle?.()),
        Promise.resolve(collaborationBridge?.waitForIdle?.()),
        Promise.resolve(waitForApplicationIdle()),
      ]), maintenanceTimeoutMs, "进入快照窗口后仍有写入任务未完成");
      rmSync(snapshotDir, { recursive: true, force: true });
      mkdirSync(snapshotDir, { recursive: true, mode: 0o700 });
      updateJob(job.id, { phase: "copying_snapshot", progress: 15, message: "正在创建一致性数据快照" });
      if (existsSync(cacheDir)) cpSync(cacheDir, snapshotCache, { recursive: true, errorOnExist: true, preserveTimestamps: true });
      else mkdirSync(snapshotCache, { recursive: true, mode: 0o700 });
      if (existsSync(envPath)) cpSync(envPath, snapshotEnv, { errorOnExist: true, preserveTimestamps: true });
      else writeFileSync(snapshotEnv, "", { encoding: "utf8", mode: 0o600 });
      return { snapshotDir, snapshotCache, snapshotEnv };
    } finally {
      if (maintenanceEntered) maintenanceGate.leave();
      if (resumeBackgroundJobs || wasSchedulerRunning) {
        scheduler?.start?.();
        collaborationBridge?.start?.();
      }
    }
  }

  async function processExport(id) {
    const password = secrets.get(id);
    let snapshot;
    try {
      const job = readJob(id);
      const stats = getDataStats();
      assertDiskCapacity(backupRoot, Math.max(512 * 1024 * 1024, Math.ceil(stats.bytes * 2.2)));
      appendAudit("export_started", job.actor, { jobId: id, dataBytes: stats.bytes, fileCount: stats.files });
      snapshot = await snapshotForExport(job);
      const destinationPath = resolve(exportsDir, `${id}.tzbak`);
      updateJob(id, { status: "exporting", phase: "encrypting", progress: 25, message: "正在压缩并加密备份包" });
      const envText = readFileSync(snapshot.snapshotEnv, "utf8");
      const result = await createEncryptedBackup({
        destinationPath,
        password,
        sources: [
          { sourcePath: snapshot.snapshotEnv, archivePath: ".env" },
          { sourcePath: snapshot.snapshotCache, archivePath: "cache" },
        ],
        manifest: {
          gitSha,
          application: "tongzhou-supply-chain-center",
          scope: ["main-cache", "environment"],
          envKeys: listEnvKeys(envText),
          collaborationIncluded: false,
        },
        readme: "同舟供应链中心加密备份包。仅可在相同 Git 版本中通过系统备份页面导入。独立协同系统数据不在此包内。\n",
        onProgress: (() => {
          let lastProgress = -1;
          return ({ completedBytes, currentPath }) => {
          const denominator = Math.max(1, stats.bytes);
          const progress = Math.min(94, 25 + Math.round((completedBytes / denominator) * 69));
          if (progress !== lastProgress) {
            lastProgress = progress;
            updateJob(id, { progress, currentPath, message: "正在压缩并加密备份包" });
          }
          };
        })(),
      });
      const completedAt = nowIso();
      updateJob(id, {
        status: "completed",
        phase: "ready_to_download",
        progress: 100,
        currentPath: "",
        message: "备份包已生成，可领取下载链接",
        completedAt,
        packagePath: destinationPath,
        packageBytes: result.bytes,
        artifactExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        manifest: {
          gitSha: result.manifest.gitSha,
          createdAt: result.manifest.createdAt,
          fileCount: result.manifest.fileCount,
          totalBytes: result.manifest.totalBytes,
          collaborationIncluded: false,
        },
      });
      appendAudit("export_completed", job.actor, { jobId: id, packageBytes: result.bytes });
    } catch (error) {
      const job = readJob(id);
      updateJob(id, { status: "failed", phase: "failed", message: "备份导出失败", error: safeMessage(error), completedAt: nowIso() });
      appendAudit("export_failed", job?.actor, { jobId: id, message: safeMessage(error) });
    } finally {
      secrets.get(id)?.fill?.(0);
      secrets.delete(id);
      if (snapshot?.snapshotDir) rmSync(dirname(snapshot.snapshotDir), { recursive: true, force: true });
    }
  }

  function createExport({ actor, password }) {
    if (activeJob("export")) throw Object.assign(new Error("已有备份导出任务正在执行"), { statusCode: 409 });
    const id = randomUUID();
    const createdAt = nowIso();
    const shaLabel = gitSha ? gitSha.slice(0, 8) : "unknown";
    const timestamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const job = writeJob({
      id,
      type: "export",
      status: "queued",
      phase: "queued",
      progress: 0,
      message: "备份任务已排队",
      createdAt,
      actor: { id: actor.id, username: actor.username, displayName: actor.displayName },
      downloadName: cleanDownloadName(`tongzhou-backup-${timestamp}-${shaLabel}.tzbak`),
    });
    secrets.set(id, Buffer.from(password));
    setImmediate(() => { void processExport(id); });
    return publicJob(job);
  }

  async function validateImport(id) {
    const password = secrets.get(id);
    const job = readJob(id);
    const stageDir = resolve(workDir, id, "validated");
    try {
      updateJob(id, { status: "validating", phase: "decrypting", progress: 40, message: "正在解密并校验备份包" });
      const header = inspectBackupHeader(job.uploadPath);
      if (header.estimatedPlainBytes > maxUploadBytes * 4) throw new Error("备份声明的解压体积超过安全限制");
      assertDiskCapacity(stageDir, Math.max(512 * 1024 * 1024, Math.ceil(Number(header.estimatedPlainBytes || job.fileSize) * 1.25)));
      const result = await extractEncryptedBackup({
        packagePath: job.uploadPath,
        destinationDir: stageDir,
        password,
        limits: {
          maxFiles: 25_000,
          maxTotalBytes: Math.min(maxUploadBytes * 4, 16 * 1024 * 1024 * 1024),
          maxEntryBytes: maxUploadBytes,
        },
        onProgress: (() => {
          let lastProgress = -1;
          return ({ completedBytes, currentPath }) => {
          const denominator = Math.max(1, Number(header.estimatedPlainBytes || job.fileSize));
          const progress = Math.min(85, 40 + Math.round((completedBytes / denominator) * 45));
          if (progress !== lastProgress) {
            lastProgress = progress;
            updateJob(id, { progress, currentPath, message: "正在解密并校验备份包" });
          }
          };
        })(),
      });
      if (!gitSha || result.manifest.gitSha !== gitSha) {
        throw new Error(`备份版本不匹配：需要 ${gitSha || "已发布版本 SHA"}，备份为 ${result.manifest.gitSha || "未知"}`);
      }
      const stagedCacheDir = resolve(stageDir, "cache");
      const importedEnvPath = resolve(stageDir, ".env");
      if (!existsSync(stagedCacheDir) || !statSync(stagedCacheDir).isDirectory()) throw new Error("备份中缺少主应用缓存目录");
      const importedEnv = existsSync(importedEnvPath) ? readFileSync(importedEnvPath, "utf8") : "";
      const targetEnv = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
      if (job.envMode === "full") {
        const importedCacheDir = String(parseEnvDocument(importedEnv).values.get("CACHE_DIR") || "").replace(/^['\"]|['\"]$/g, "");
        if (importedCacheDir && resolve(projectRoot, importedCacheDir) !== resolve(cacheDir)) {
          throw new Error("完整恢复包中的 CACHE_DIR 与当前服务器不一致，请改用迁移模式或在同路径服务器恢复");
        }
      }
      const merged = mergeRestoredEnv({ importedText: importedEnv, targetText: targetEnv, mode: job.envMode });
      writeFileSync(importedEnvPath, merged.text, { encoding: "utf8", mode: 0o600 });
      chmodSync(importedEnvPath, 0o600);
      const validated = updateJob(id, {
        status: "validated",
        phase: "awaiting_confirmation",
        progress: 90,
        currentPath: "",
        message: "备份包校验通过，等待确认应用",
        validationExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        stageDir,
        stagedCacheDir,
        stagedEnvPath: importedEnvPath,
        preview: {
          gitSha: result.manifest.gitSha,
          createdAt: result.manifest.createdAt,
          fileCount: result.manifest.fileCount,
          totalBytes: result.manifest.totalBytes,
          envMode: job.envMode,
          importedEnvKeyCount: merged.importedKeys.length,
          preservedEnvKeys: merged.preservedKeys,
          omittedHostKeys: merged.omittedHostKeys,
          collaborationIncluded: result.manifest.collaborationIncluded === true,
          warnings: result.manifest.collaborationIncluded === true
            ? []
            : ["此备份不包含独立协同系统 PostgreSQL 数据及对象存储文件。"],
        },
      });
      rmSync(job.uploadPath, { force: true });
      appendAudit("import_validated", job.actor, { jobId: id, gitSha: result.manifest.gitSha, envMode: job.envMode, totalBytes: result.manifest.totalBytes });
      return publicJob(validated);
    } catch (error) {
      rmSync(stageDir, { recursive: true, force: true });
      rmSync(job.uploadPath, { force: true });
      updateJob(id, { status: "failed", phase: "validation_failed", message: "备份包校验失败", error: safeMessage(error), completedAt: nowIso() });
      appendAudit("import_validation_failed", job.actor, { jobId: id, message: safeMessage(error) });
      throw error;
    } finally {
      secrets.get(id)?.fill?.(0);
      secrets.delete(id);
    }
  }

  function createImport({ actor, password, fileName, fileSize, envMode = "migration" }) {
    if (activeJob("import")) throw Object.assign(new Error("已有备份导入任务正在执行"), { statusCode: 409 });
    const safeFileSize = Number(fileSize);
    if (!Number.isSafeInteger(safeFileSize) || safeFileSize <= 0 || safeFileSize > maxUploadBytes) {
      throw Object.assign(new Error("备份文件大小无效或超过限制"), { statusCode: 400 });
    }
    if (!String(fileName || "").toLowerCase().endsWith(".tzbak")) throw Object.assign(new Error("请选择 .tzbak 备份文件"), { statusCode: 400 });
    if (!["migration", "full"].includes(envMode)) throw Object.assign(new Error("环境变量恢复模式无效"), { statusCode: 400 });
    const id = randomUUID();
    const uploadToken = randomBytes(32).toString("base64url");
    const uploadPath = resolve(uploadsDir, `${id}.tzbak`);
    const job = writeJob({
      id,
      type: "import",
      status: "awaiting_upload",
      phase: "awaiting_upload",
      progress: 0,
      message: "等待上传备份文件",
      createdAt: nowIso(),
      actor: { id: actor.id, username: actor.username, displayName: actor.displayName },
      fileName: cleanDownloadName(fileName),
      fileSize: safeFileSize,
      envMode,
      uploadPath,
      uploadTokenHash: sha256(uploadToken),
      uploadExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    });
    secrets.set(id, Buffer.from(password));
    const expirationTimer = setTimeout(() => {
      const current = readJob(id);
      if (current?.status !== "awaiting_upload") return;
      secrets.get(id)?.fill?.(0);
      secrets.delete(id);
      updateJob(id, { status: "failed", phase: "upload_expired", message: "上传票据已过期，请重新创建导入任务", completedAt: nowIso(), uploadTokenHash: "" });
      appendAudit("import_upload_expired", job.actor, { jobId: id });
    }, 15 * 60_000);
    expirationTimer.unref?.();
    appendAudit("import_created", job.actor, { jobId: id, fileSize: safeFileSize, envMode });
    return { job: publicJob(job), uploadToken };
  }

  async function receiveImportUpload({ id, token, stream, contentLength }) {
    const job = readJob(id);
    if (!job || job.type !== "import" || job.status !== "awaiting_upload") throw Object.assign(new Error("导入任务不在待上传状态"), { statusCode: 409 });
    if (Date.parse(job.uploadExpiresAt || "") < Date.now()) throw Object.assign(new Error("上传票据已过期"), { statusCode: 401 });
    if (!sameToken(token, job.uploadTokenHash)) throw Object.assign(new Error("上传票据无效或已过期"), { statusCode: 401 });
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength !== job.fileSize || declaredLength > maxUploadBytes) {
      throw Object.assign(new Error("上传文件大小与创建任务时不一致"), { statusCode: 400 });
    }
    rmSync(job.uploadPath, { force: true });
    updateJob(id, { status: "uploading", phase: "uploading", progress: 1, message: "正在上传备份文件", uploadTokenHash: "" });
    let received = 0;
    let lastProgress = -1;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > job.fileSize || received > maxUploadBytes) {
          callback(new Error("上传内容超过允许大小"));
          return;
        }
        const progress = Math.max(1, Math.min(35, Math.round((received / job.fileSize) * 35)));
        if (progress !== lastProgress) {
          lastProgress = progress;
          updateJob(id, { progress, uploadedBytes: received, message: "正在上传备份文件" });
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(stream, counter, createWriteStream(job.uploadPath, { flags: "wx", mode: 0o600 }));
      if (received !== job.fileSize) throw new Error("上传内容不完整");
      updateJob(id, { status: "queued", phase: "queued_validation", progress: 36, uploadedBytes: received, message: "上传完成，等待校验" });
      setImmediate(() => { void validateImport(id).catch(() => {}); });
      return publicJob(readJob(id));
    } catch (error) {
      rmSync(job.uploadPath, { force: true });
      secrets.get(id)?.fill?.(0);
      secrets.delete(id);
      updateJob(id, { status: "failed", phase: "upload_failed", message: "备份文件上传失败", error: safeMessage(error), completedAt: nowIso() });
      appendAudit("import_upload_failed", job.actor, { jobId: id, message: safeMessage(error) });
      throw error;
    }
  }

  function restorePathSet(id) {
    return {
      targetCache: resolve(cacheDir),
      readyCache: `${resolve(cacheDir)}.next-import-${id}`,
      rollbackCache: `${resolve(cacheDir)}.pre-import-${id}`,
      targetEnv: resolve(envPath),
      readyEnv: `${resolve(envPath)}.next-import-${id}`,
      rollbackEnv: `${resolve(envPath)}.pre-import-${id}`,
    };
  }

  async function prepareRestore(id) {
    const job = readJob(id);
    const paths = restorePathSet(id);
    try {
      if (existsSync(paths.rollbackCache) || existsSync(paths.rollbackEnv)) throw new Error("该任务的回滚副本已存在，需要人工检查");
      if (existsSync(paths.readyCache) || existsSync(paths.readyEnv)) throw new Error("该任务的待切换目录已存在，需要人工检查");
      const stats = directoryStats(job.stagedCacheDir);
      assertDiskCapacity(dirname(paths.targetCache), Math.max(256 * 1024 * 1024, Math.ceil(stats.bytes * 1.1)));
      cpSync(job.stagedCacheDir, paths.readyCache, { recursive: true, errorOnExist: true, preserveTimestamps: true });
      cpSync(job.stagedEnvPath, paths.readyEnv, { errorOnExist: true, preserveTimestamps: true });
      chmodSync(paths.readyEnv, 0o600);
      const mergedEnv = readFileSync(paths.readyEnv, "utf8");
      const healthPort = envPort(mergedEnv, Number(process.env.API_PORT || 8787));
      const request = {
        id,
        status: "queued",
        createdAt: nowIso(),
        envMode: job.envMode,
        paths,
        healthUrl: `http://127.0.0.1:${healthPort}/api/health`,
        healthTimeoutMs: 90_000,
      };
      atomicWriteJson(resolve(requestDir, `${id}.json`), request);
      updateJob(id, {
        status: "queued_restore",
        phase: "queued_restore",
        progress: 95,
        message: "已交给独立恢复代理，主服务将短暂重启",
        restorePaths: paths,
      });
      appendAudit("restore_queued", job.actor, { jobId: id, envMode: job.envMode });
      try {
        rmSync(job.stageDir, { recursive: true, force: true });
        rmSync(job.uploadPath, { force: true });
      } catch {
        // The ready copy and restore request are already complete; stale staging is safe to clean later.
      }
    } catch (error) {
      rmSync(paths.readyCache, { recursive: true, force: true });
      rmSync(paths.readyEnv, { force: true });
      updateJob(id, { status: "failed", phase: "prepare_restore_failed", message: "准备恢复数据失败", error: safeMessage(error), completedAt: nowIso() });
      appendAudit("restore_prepare_failed", job.actor, { jobId: id, message: safeMessage(error) });
    }
  }

  function applyImport({ id, actor }) {
    const job = readJob(id);
    if (!job || job.type !== "import" || job.status !== "validated") throw Object.assign(new Error("导入任务尚未完成校验或已被处理"), { statusCode: 409 });
    if (!["1", "true"].includes(String(process.env.ALLOW_SYSTEM_IMPORT || "").toLowerCase())) {
      throw Object.assign(new Error("当前服务器未启用系统导入，请设置 ALLOW_SYSTEM_IMPORT=1 后重启服务"), { statusCode: 409 });
    }
    const agent = restoreAgentStatus();
    if (!agent.healthy) throw Object.assign(new Error(`恢复代理不可用：${agent.message}`), { statusCode: 503 });
    const updated = updateJob(id, { status: "preparing_restore", phase: "copying_restore_payload", progress: 91, message: "正在准备同盘原子切换数据" });
    appendAudit("restore_confirmed", actor, { jobId: id, envMode: job.envMode });
    setImmediate(() => { void prepareRestore(id); });
    return publicJob(updated);
  }

  function createDownloadTicket(id, actor) {
    const job = readJob(id);
    if (!job || job.type !== "export" || job.status !== "completed" || !job.packagePath || !existsSync(job.packagePath)) {
      throw Object.assign(new Error("备份包尚未生成或已经失效"), { statusCode: 409 });
    }
    const token = randomBytes(32).toString("base64url");
    downloadTickets.set(token, { id, actorId: actor.id, expiresAt: Date.now() + 5 * 60_000 });
    appendAudit("download_ticket_created", actor, { jobId: id });
    return { token, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
  }

  function consumeDownloadTicket(token, actor) {
    const ticket = downloadTickets.get(String(token || ""));
    downloadTickets.delete(String(token || ""));
    if (!ticket || ticket.expiresAt < Date.now() || ticket.actorId !== actor.id) throw Object.assign(new Error("下载票据无效或已过期"), { statusCode: 401 });
    const job = readJob(ticket.id);
    if (!job?.packagePath || !existsSync(job.packagePath)) throw new Error("备份文件不存在");
    appendAudit("backup_downloaded", actor, { jobId: job.id, packageBytes: job.packageBytes });
    return { id: job.id, path: job.packagePath, fileName: job.downloadName, bytes: job.packageBytes };
  }

  function markDownloadFinished(id, { remove = true } = {}) {
    const job = readJob(id);
    if (!job) return;
    if (remove && job.packagePath) rmSync(job.packagePath, { force: true });
    updateJob(id, { downloadConsumedAt: nowIso(), artifactRemoved: remove });
  }

  function cleanupExpiredArtifacts() {
    const now = Date.now();
    for (const name of readdirSync(jobsDir).filter((item) => item.endsWith(".json"))) {
      let job;
      try { job = readJob(name.slice(0, -5)); } catch { continue; }
      if (!job?.packagePath || job.artifactRemoved || Date.parse(job.artifactExpiresAt || "") > now) continue;
      rmSync(job.packagePath, { force: true });
      updateJob(job.id, { artifactRemoved: true, artifactExpiredAt: nowIso() });
    }
    for (const name of readdirSync(jobsDir).filter((item) => item.endsWith(".json"))) {
      let job;
      try { job = readJob(name.slice(0, -5)); } catch { continue; }
      if (job?.type !== "import" || job.status !== "validated" || Date.parse(job.validationExpiresAt || "") > now) continue;
      if (job.stageDir) rmSync(job.stageDir, { recursive: true, force: true });
      if (job.uploadPath) rmSync(job.uploadPath, { force: true });
      updateJob(job.id, { status: "expired", phase: "validation_expired", message: "已校验数据超过 24 小时，已安全清理，请重新导入", completedAt: nowIso() });
      appendAudit("import_validation_expired", job.actor, { jobId: job.id });
    }
    for (const [token, ticket] of downloadTickets) {
      if (ticket.expiresAt < now) downloadTickets.delete(token);
    }
  }

  // Passwords are deliberately not recoverable. Jobs interrupted before validation must be restarted by the administrator.
  for (const name of readdirSync(jobsDir).filter((item) => item.endsWith(".json"))) {
    let job;
    try { job = readJob(name.slice(0, -5)); } catch { continue; }
    if (!["awaiting_upload", "queued", "snapshotting", "exporting", "uploading", "validating"].includes(job.status)) continue;
    if (job.uploadPath) rmSync(job.uploadPath, { force: true });
    if (job.stageDir) rmSync(job.stageDir, { recursive: true, force: true });
    rmSync(resolve(workDir, job.id), { recursive: true, force: true });
    updateJob(job.id, { status: "failed", phase: "interrupted", message: "服务重启中断了任务，请重新创建", completedAt: nowIso(), uploadTokenHash: "" });
  }
  cleanupExpiredArtifacts();
  const cleanupTimer = setInterval(cleanupExpiredArtifacts, 60 * 60_000);
  cleanupTimer.unref?.();

  return {
    applyImport,
    consumeDownloadTicket,
    createDownloadTicket,
    createExport,
    createImport,
    getJob: (id) => publicJob(readJob(id)),
    listAudit,
    markDownloadFinished,
    receiveImportUpload,
    restoreAgentStatus,
    status,
  };
}

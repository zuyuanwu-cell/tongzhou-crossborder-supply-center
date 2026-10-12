import assert from "node:assert/strict";
import { createReadStream, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createEncryptedBackup,
  extractEncryptedBackup,
  inspectBackupHeader,
  validateArchivePath,
} from "../server/system-backup-archive.js";
import { isHostBoundEnvKey, mergeRestoredEnv } from "../server/system-backup-env.js";
import { createSystemBackupService } from "../server/system-backup-service.js";
import { createSystemMaintenanceGate } from "../server/system-maintenance-gate.js";

async function waitForJob(service, id, statuses, timeoutMs = 10_000) {
  const expected = new Set(statuses);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = service.getJob(id);
    if (expected.has(job?.status)) return job;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for job ${id}: ${service.getJob(id)?.status}`);
}

const root = mkdtempSync(resolve(tmpdir(), "tongzhou-system-backup-test-"));

try {
  const sourceCache = resolve(root, "source-cache");
  mkdirSync(resolve(sourceCache, "nested"), { recursive: true });
  writeFileSync(resolve(sourceCache, "orders.json"), JSON.stringify({ order: "A-100", quantity: 3 }));
  writeFileSync(resolve(sourceCache, "nested", "facts.sqlite"), Buffer.from([0, 1, 2, 3, 255]));
  const sourceEnv = resolve(root, "source.env");
  writeFileSync(sourceEnv, "API_PORT=8787\nAUTH_SESSION_SECRET=source-secret\nORDER_DB_PATH=/source/orders.db\n");

  const packagePath = resolve(root, "fixture.tzbak");
  const password = "correct horse battery staple";
  const created = await createEncryptedBackup({
    destinationPath: packagePath,
    password,
    sources: [
      { sourcePath: sourceEnv, archivePath: ".env" },
      { sourcePath: sourceCache, archivePath: "cache" },
    ],
    manifest: { gitSha: "0123456789abcdef", scope: ["main-cache", "environment"] },
  });
  assert.equal(created.manifest.fileCount, 3);
  assert.ok(created.bytes > 100);
  assert.equal(inspectBackupHeader(packagePath).formatVersion, 1);

  const extracted = resolve(root, "extracted");
  const result = await extractEncryptedBackup({ packagePath, destinationDir: extracted, password });
  assert.equal(result.manifest.gitSha, "0123456789abcdef");
  assert.deepEqual(readFileSync(resolve(extracted, "cache", "nested", "facts.sqlite")), Buffer.from([0, 1, 2, 3, 255]));
  assert.match(readFileSync(resolve(extracted, ".env"), "utf8"), /AUTH_SESSION_SECRET=source-secret/);

  await assert.rejects(
    extractEncryptedBackup({ packagePath, destinationDir: resolve(root, "wrong-password"), password: "this password is wrong" }),
    /authenticate|invalid|unsupported|incorrect|failed/i,
  );

  const tamperedPath = resolve(root, "tampered.tzbak");
  const tampered = readFileSync(packagePath);
  tampered[Math.floor(tampered.length / 2)] ^= 0xff;
  writeFileSync(tamperedPath, tampered);
  await assert.rejects(
    extractEncryptedBackup({ packagePath: tamperedPath, destinationDir: resolve(root, "tampered"), password }),
    /authenticate|checksum|invalid|incorrect|failed/i,
  );

  await assert.rejects(
    extractEncryptedBackup({
      packagePath,
      destinationDir: resolve(root, "limited"),
      password,
      limits: { maxTotalBytes: 2 },
    }),
    /allowed extracted size/i,
  );

  for (const unsafePath of ["../secret", "cache/../../secret", "/absolute", "cache\\escape", "other/file"]) {
    assert.throws(() => validateArchivePath(unsafePath), /archive path|package root/i);
  }
  assert.equal(validateArchivePath("cache/nested/data.sqlite"), "cache/nested/data.sqlite");

  assert.equal(isHostBoundEnvKey("ORDER_DB_PATH"), true);
  assert.equal(isHostBoundEnvKey("AUTH_SESSION_SECRET"), false);
  const migrated = mergeRestoredEnv({
    mode: "migration",
    importedText: "API_PORT=8787\nAUTH_SESSION_SECRET=source-secret\nORDER_DB_PATH=/source/orders.db\nSOURCE_ONLY_UPLOAD_DIR=/source/upload\n",
    targetText: "API_PORT=9900\nAUTH_SESSION_SECRET=target-secret\nORDER_DB_PATH=D:/target/orders.db\nCACHE_DIR=D:/target/cache\n",
  });
  assert.match(migrated.text, /API_PORT=9900/);
  assert.match(migrated.text, /AUTH_SESSION_SECRET=source-secret/);
  assert.match(migrated.text, /ORDER_DB_PATH=D:\/target\/orders\.db/);
  assert.match(migrated.text, /CACHE_DIR=D:\/target\/cache/);
  assert.doesNotMatch(migrated.text, /SOURCE_ONLY_UPLOAD_DIR/);
  assert.deepEqual(migrated.omittedHostKeys, ["SOURCE_ONLY_UPLOAD_DIR"]);

  const full = mergeRestoredEnv({
    mode: "full",
    importedText: "API_PORT=8787\nAUTH_SESSION_SECRET=source-secret\n",
    targetText: "API_PORT=9900\nAUTH_SESSION_SECRET=target-secret\n",
  });
  assert.match(full.text, /API_PORT=8787/);
  assert.match(full.text, /AUTH_SESSION_SECRET=source-secret/);
  assert.deepEqual(full.preservedKeys, []);

  const unitGate = createSystemMaintenanceGate();
  const activeWrite = unitGate.beginRequest("POST");
  const enteringMaintenance = unitGate.enter("test_snapshot");
  await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.equal(unitGate.status().active, true);
  assert.equal(unitGate.beginRequest("PATCH").allowed, false);
  assert.equal(unitGate.beginRequest("GET").allowed, true);
  activeWrite.release();
  await enteringMaintenance;
  assert.equal(unitGate.status().activeMutations, 0);
  unitGate.leave();
  assert.equal(unitGate.status().active, false);

  const slowRoot = resolve(root, "slow-service");
  const slowCache = resolve(slowRoot, ".cache");
  const slowEnv = resolve(slowRoot, ".env");
  mkdirSync(slowCache, { recursive: true });
  writeFileSync(resolve(slowCache, "state.json"), JSON.stringify({ slow: true }));
  writeFileSync(slowEnv, "API_PORT=8787\nAUTH_SESSION_SECRET=slow-secret\n");
  const slowGate = createSystemMaintenanceGate();
  let schedulerIdle = false;
  let finishScheduledWrite;
  const scheduledWrite = new Promise((resolveWrite) => { finishScheduledWrite = resolveWrite; });
  const slowScheduler = {
    status: () => ({ enabled: true, tasks: [{ id: "slow-sync", label: "慢速同步", running: !schedulerIdle }] }),
    stop: () => {},
    start: () => {},
    waitForIdle: () => schedulerIdle ? Promise.resolve() : scheduledWrite,
  };
  const idleBridge = { stop: () => {}, start: () => {}, waitForIdle: async () => {} };
  const slowService = createSystemBackupService({
    projectRoot: slowRoot,
    cacheDir: slowCache,
    envPath: slowEnv,
    backupRoot: resolve(slowRoot, ".system-backup"),
    scheduler: slowScheduler,
    collaborationBridge: idleBridge,
    maintenanceGate: slowGate,
    gitSha: "fedcba9876543210",
    maxUploadBytes: 64 * 1024 * 1024,
    backgroundIdleTimeoutMs: 1_000,
    backgroundStatusIntervalMs: 10,
    maintenanceTimeoutMs: 1_000,
  });
  const slowActor = { id: "admin-slow", username: "admin-slow", displayName: "Slow Admin" };
  const slowExport = slowService.createExport({ actor: slowActor, password });
  const waitingExport = await waitForJob(slowService, slowExport.id, ["snapshotting"]);
  assert.equal(waitingExport.phase, "waiting_background_tasks");
  assert.match(waitingExport.message, /业务可正常使用/);
  assert.equal(slowGate.status().active, false);
  const writeWhileWaiting = slowGate.beginRequest("POST");
  assert.equal(writeWhileWaiting.allowed, true);
  writeWhileWaiting.release();
  schedulerIdle = true;
  finishScheduledWrite();
  const slowCompleted = await waitForJob(slowService, slowExport.id, ["completed", "failed"]);
  assert.equal(slowCompleted.status, "completed", slowCompleted.error);
  assert.equal(slowGate.status().active, false);

  const serviceRoot = resolve(root, "service");
  const serviceCache = resolve(serviceRoot, ".cache");
  const serviceEnv = resolve(serviceRoot, ".env");
  mkdirSync(serviceCache, { recursive: true });
  writeFileSync(resolve(serviceCache, "state.json"), JSON.stringify({ healthy: true }));
  writeFileSync(serviceEnv, "API_PORT=8787\nAUTH_SESSION_SECRET=portable-secret\n");
  const gate = createSystemMaintenanceGate();
  const lifecycle = [];
  const idleController = {
    running: true,
    status: () => ({ enabled: true }),
    stop: () => lifecycle.push("stop"),
    start: () => lifecycle.push("start"),
    waitForIdle: async () => lifecycle.push("idle"),
  };
  const service = createSystemBackupService({
    projectRoot: serviceRoot,
    cacheDir: serviceCache,
    envPath: serviceEnv,
    backupRoot: resolve(serviceRoot, ".system-backup"),
    scheduler: idleController,
    collaborationBridge: idleController,
    maintenanceGate: gate,
    gitSha: "fedcba9876543210",
    maxUploadBytes: 64 * 1024 * 1024,
  });
  const actor = { id: "admin-1", username: "admin", displayName: "Admin" };
  const exportJob = service.createExport({ actor, password });
  const exported = await waitForJob(service, exportJob.id, ["completed", "failed"]);
  assert.equal(exported.status, "completed", exported.error);
  assert.equal(gate.status().active, false);
  assert.deepEqual(lifecycle, ["stop", "stop", "idle", "idle", "idle", "idle", "start", "start"]);
  const ticket = service.createDownloadTicket(exportJob.id, actor);
  const download = service.consumeDownloadTicket(ticket.token, actor);
  assert.equal(statSync(download.path).size, exported.packageBytes);

  writeFileSync(serviceEnv, "API_PORT=9900\nAUTH_SESSION_SECRET=target-secret\n");
  const imported = service.createImport({
    actor,
    password,
    fileName: download.fileName,
    fileSize: statSync(download.path).size,
    envMode: "migration",
  });
  await service.receiveImportUpload({
    id: imported.job.id,
    token: imported.uploadToken,
    stream: createReadStream(download.path),
    contentLength: statSync(download.path).size,
  });
  const validated = await waitForJob(service, imported.job.id, ["validated", "failed"]);
  assert.equal(validated.status, "validated", validated.error);
  assert.equal(validated.preview.gitSha, "fedcba9876543210");
  assert.deepEqual(validated.preview.preservedEnvKeys, ["API_PORT"]);
  assert.equal(validated.preview.collaborationIncluded, false);
  service.markDownloadFinished(exportJob.id);
  assert.equal(service.status().jobs.length, 2);

  console.log("system-backup tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

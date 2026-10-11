import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const TERMINAL_PHASES = new Set(["committed", "rolled_back"]);
const MUTATING_PHASES = new Set([
  "stopping",
  "stopped",
  "moving_current",
  "current_moved",
  "activating",
  "activated",
  "starting",
  "health_check",
  "rollback",
]);

function nowIso() {
  return new Date().toISOString();
}

function atomicWriteJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

export function readRestoreJournal(journalPath) {
  if (!existsSync(journalPath)) return null;
  return JSON.parse(readFileSync(journalPath, "utf8"));
}

function journalWriter(journalPath, initial) {
  let state = { ...initial, updatedAt: nowIso() };
  atomicWriteJson(journalPath, state);
  return {
    get: () => ({ ...state }),
    set(phase, extra = {}) {
      state = { ...state, ...extra, phase, updatedAt: nowIso() };
      atomicWriteJson(journalPath, state);
      return { ...state };
    },
  };
}

function assertRestorePaths(paths) {
  for (const key of ["targetCache", "readyCache", "rollbackCache", "targetEnv", "readyEnv", "rollbackEnv"]) {
    if (!paths?.[key]) throw new Error(`Missing restore path: ${key}`);
  }
  if (paths.targetCache === paths.readyCache || paths.targetCache === paths.rollbackCache) {
    throw new Error("Restore cache paths must be distinct");
  }
  if (paths.targetEnv === paths.readyEnv || paths.targetEnv === paths.rollbackEnv) {
    throw new Error("Restore environment paths must be distinct");
  }
}

function moveIfPresent(operations, source, target) {
  if (!operations.exists(source)) return false;
  operations.rename(source, target);
  return true;
}

export async function rollbackRestore({ journalPath, journal, operations }) {
  const current = journal || readRestoreJournal(journalPath);
  if (!current) throw new Error("Restore journal is missing");
  const writer = journalWriter(journalPath, current);
  const { paths } = current;
  writer.set("rollback", { rollbackStartedAt: nowIso() });
  await operations.stopApp().catch(() => {});

  if (operations.exists(paths.rollbackCache)) {
    if (operations.exists(paths.targetCache)) {
      moveIfPresent(operations, paths.targetCache, operations.failedPath(paths.targetCache, current.id));
    }
    operations.rename(paths.rollbackCache, paths.targetCache);
  }
  if (operations.exists(paths.rollbackEnv)) {
    if (operations.exists(paths.targetEnv)) {
      moveIfPresent(operations, paths.targetEnv, operations.failedPath(paths.targetEnv, current.id));
    }
    operations.rename(paths.rollbackEnv, paths.targetEnv);
  }
  await operations.startApp();
  writer.set("rolled_back", { rolledBackAt: nowIso() });
  return writer.get();
}

export async function runRestoreTransaction({ id, journalPath, paths, operations }) {
  assertRestorePaths(paths);
  if (!operations.exists(paths.readyCache) || !operations.exists(paths.readyEnv)) {
    throw new Error("Validated restore payload is not ready");
  }
  if (operations.exists(paths.rollbackCache) || operations.exists(paths.rollbackEnv)) {
    throw new Error("Rollback target already exists");
  }
  const writer = journalWriter(journalPath, {
    id,
    phase: "prepared",
    createdAt: nowIso(),
    paths,
  });

  try {
    writer.set("stopping");
    await operations.stopApp();
    writer.set("stopped");

    writer.set("moving_current");
    moveIfPresent(operations, paths.targetCache, paths.rollbackCache);
    moveIfPresent(operations, paths.targetEnv, paths.rollbackEnv);
    writer.set("current_moved");

    writer.set("activating");
    operations.rename(paths.readyCache, paths.targetCache);
    operations.rename(paths.readyEnv, paths.targetEnv);
    writer.set("activated");

    writer.set("starting");
    await operations.startApp();
    writer.set("health_check");
    await operations.waitForHealthy();
    writer.set("committed", { committedAt: nowIso() });
    return writer.get();
  } catch (error) {
    const failed = writer.set(writer.get().phase, { error: String(error?.message || error) });
    if (MUTATING_PHASES.has(failed.phase) || operations.exists(paths.rollbackCache) || operations.exists(paths.rollbackEnv)) {
      const rolledBack = await rollbackRestore({ journalPath, journal: failed, operations });
      throw Object.assign(new Error(`Restore failed and was rolled back: ${error.message || error}`), { rolledBack, cause: error });
    }
    throw error;
  }
}

export async function recoverRestoreTransaction({ journalPath, operations }) {
  const journal = readRestoreJournal(journalPath);
  if (!journal || TERMINAL_PHASES.has(journal.phase)) return journal;
  return rollbackRestore({ journalPath, journal, operations });
}

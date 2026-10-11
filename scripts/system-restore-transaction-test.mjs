import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { recoverRestoreTransaction, runRestoreTransaction } from "../server/system-restore-transaction.js";

function fixture(root, name) {
  const base = resolve(root, name);
  mkdirSync(base, { recursive: true });
  const paths = {
    targetCache: resolve(base, "cache"),
    readyCache: resolve(base, "cache.next"),
    rollbackCache: resolve(base, "cache.previous"),
    targetEnv: resolve(base, ".env"),
    readyEnv: resolve(base, ".env.next"),
    rollbackEnv: resolve(base, ".env.previous"),
  };
  mkdirSync(paths.targetCache);
  mkdirSync(paths.readyCache);
  writeFileSync(resolve(paths.targetCache, "value.txt"), "old");
  writeFileSync(resolve(paths.readyCache, "value.txt"), "new");
  writeFileSync(paths.targetEnv, "VALUE=old\n");
  writeFileSync(paths.readyEnv, "VALUE=new\n");
  return { base, paths, journalPath: resolve(base, "journal.json") };
}

function operations({ failHealth = false, calls = [] } = {}) {
  return {
    exists: existsSync,
    rename(source, target) {
      calls.push(`rename:${source}->${target}`);
      renameSync(source, target);
    },
    failedPath(path, id) {
      return `${path}.failed-${id}`;
    },
    async stopApp() { calls.push("stop"); },
    async startApp() { calls.push("start"); },
    async waitForHealthy() {
      calls.push("health");
      if (failHealth) throw new Error("health check failed");
    },
  };
}

const root = mkdtempSync(resolve(tmpdir(), "tongzhou-restore-test-"));
try {
  const success = fixture(root, "success");
  const committed = await runRestoreTransaction({ id: "success", ...success, operations: operations() });
  assert.equal(committed.phase, "committed");
  assert.equal(readFileSync(resolve(success.paths.targetCache, "value.txt"), "utf8"), "new");
  assert.equal(readFileSync(resolve(success.paths.rollbackCache, "value.txt"), "utf8"), "old");
  assert.equal(readFileSync(success.paths.targetEnv, "utf8"), "VALUE=new\n");

  const failure = fixture(root, "failure");
  await assert.rejects(
    runRestoreTransaction({ id: "failure", ...failure, operations: operations({ failHealth: true }) }),
    /rolled back/i,
  );
  assert.equal(readFileSync(resolve(failure.paths.targetCache, "value.txt"), "utf8"), "old");
  assert.equal(readFileSync(failure.paths.targetEnv, "utf8"), "VALUE=old\n");
  assert.equal(JSON.parse(readFileSync(failure.journalPath, "utf8")).phase, "rolled_back");

  const recovery = fixture(root, "recovery");
  renameSync(recovery.paths.targetCache, recovery.paths.rollbackCache);
  renameSync(recovery.paths.targetEnv, recovery.paths.rollbackEnv);
  renameSync(recovery.paths.readyCache, recovery.paths.targetCache);
  renameSync(recovery.paths.readyEnv, recovery.paths.targetEnv);
  writeFileSync(recovery.journalPath, JSON.stringify({
    id: "recovery",
    phase: "activated",
    paths: recovery.paths,
  }));
  const recovered = await recoverRestoreTransaction({ journalPath: recovery.journalPath, operations: operations() });
  assert.equal(recovered.phase, "rolled_back");
  assert.equal(readFileSync(resolve(recovery.paths.targetCache, "value.txt"), "utf8"), "old");
  assert.equal(readFileSync(recovery.paths.targetEnv, "utf8"), "VALUE=old\n");

  // Even a pre-mutation crash is closed as a safe rollback so the app cannot remain stopped.
  const prepared = fixture(root, "prepared");
  writeFileSync(prepared.journalPath, JSON.stringify({ id: "prepared", phase: "prepared", paths: prepared.paths }));
  const unchanged = await recoverRestoreTransaction({ journalPath: prepared.journalPath, operations: operations() });
  assert.equal(unchanged.phase, "rolled_back");
  assert.equal(readFileSync(resolve(prepared.paths.targetCache, "value.txt"), "utf8"), "old");

  console.log("system-restore-transaction tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

const heldLocks = new Map();
let cleanupRegistered = false;

function cleanupHeldLocks() {
  for (const [lockPath, ownerPid] of heldLocks) {
    if (ownerPid !== process.pid || lockOwner(lockPath) !== process.pid) continue;
    try { unlinkSync(lockPath); } catch {}
  }
  heldLocks.clear();
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function lockOwner(lockPath) {
  try {
    return Number(JSON.parse(readFileSync(lockPath, "utf8"))?.pid || 0);
  } catch {
    return 0;
  }
}

export function acquireSqlJsWriterLock(dbPath) {
  const lockPath = `${dbPath}.lock`;
  if (heldLocks.has(lockPath)) {
    throw Object.assign(new Error(`数据库 ${dbPath} 已由当前进程持有，拒绝启动第二个写入实例。`), { code: "SQLJS_WRITER_LOCKED" });
  }
  const create = () => {
    const fd = openSync(lockPath, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, database: dbPath, acquiredAt: new Date().toISOString() }), { encoding: "utf8" });
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };
  try {
    create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const ownerPid = lockOwner(lockPath);
    if (processIsAlive(ownerPid)) {
      throw Object.assign(new Error(`数据库 ${dbPath} 已由进程 ${ownerPid} 持有，拒绝启动第二个写入进程。`), { code: "SQLJS_WRITER_LOCKED" });
    }
    try { unlinkSync(lockPath); } catch {}
    create();
  }

  heldLocks.set(lockPath, process.pid);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.once("exit", cleanupHeldLocks);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    heldLocks.delete(lockPath);
    if (lockOwner(lockPath) !== process.pid) return;
    try { unlinkSync(lockPath); } catch {}
  };
  return release;
}

function writeDurableFile(filePath, bytes) {
  let fd;
  try {
    fd = openSync(filePath, "wx", 0o600);
    writeFileSync(fd, Buffer.from(bytes));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
    }
    if (existsSync(filePath)) {
      try { unlinkSync(filePath); } catch {}
    }
    throw error;
  }
}

export function persistSqlJsDatabaseAtomically(dbPath, bytes, { backupExisting = true } = {}) {
  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${dbPath}.bak`;
  const backupTempPath = `${backupPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeDurableFile(tempPath, bytes);
    if (backupExisting && existsSync(dbPath)) {
      writeDurableFile(backupTempPath, readFileSync(dbPath));
      if (existsSync(backupPath)) unlinkSync(backupPath);
      renameSync(backupTempPath, backupPath);
    }
    renameSync(tempPath, dbPath);
  } catch (error) {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
    if (existsSync(backupTempPath)) {
      try { unlinkSync(backupTempPath); } catch {}
    }
    throw error;
  }
}

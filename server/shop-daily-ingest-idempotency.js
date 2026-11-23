import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function readState(filePath) {
  if (!existsSync(filePath)) return { version: 1, entries: {} };
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") {
    throw new Error("店铺日报采集幂等记录格式无效，已停止写入以避免重复数据。");
  }
  return parsed;
}

function writeStateAtomic(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tempPath, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}

function publicReplay(result) {
  return result && typeof result === "object"
    ? { ...result, idempotentReplay: true }
    : { ok: true, idempotentReplay: true };
}

export function createShopDailyIngestIdempotency({
  filePath,
  pendingTtlMs = DEFAULT_PENDING_TTL_MS,
  retentionMs = DEFAULT_RETENTION_MS,
  maxEntries = 5000,
  now = () => Date.now(),
} = {}) {
  const resolvedPath = resolve(filePath || resolve(process.cwd(), ".cache", "shop-daily-ingest-idempotency.json"));
  let state = readState(resolvedPath);

  function persist() {
    const cutoff = now() - retentionMs;
    const entries = Object.entries(state.entries)
      .filter(([, entry]) => Number(entry?.updatedAt || 0) >= cutoff)
      .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
      .slice(0, maxEntries);
    state = { version: 1, entries: Object.fromEntries(entries) };
    writeStateAtomic(resolvedPath, state);
  }

  function begin(key, digest) {
    const normalizedKey = String(key || "").trim().slice(0, 240);
    const normalizedDigest = String(digest || "").trim();
    if (!normalizedKey) return { status: "unmanaged" };
    if (!normalizedDigest) throw new Error("幂等请求摘要不能为空。");

    const existing = state.entries[normalizedKey];
    if (existing && existing.digest !== normalizedDigest) {
      return { status: "conflict" };
    }
    if (existing?.status === "completed") {
      return { status: "replay", result: publicReplay(existing.result) };
    }
    const timestamp = now();
    if (existing?.status === "pending" && timestamp - Number(existing.updatedAt || 0) < pendingTtlMs) {
      return {
        status: "pending",
        retryAfterSeconds: Math.max(1, Math.ceil((pendingTtlMs - (timestamp - Number(existing.updatedAt || 0))) / 1000)),
      };
    }

    state.entries[normalizedKey] = {
      digest: normalizedDigest,
      status: "pending",
      createdAt: Number(existing?.createdAt || timestamp),
      updatedAt: timestamp,
    };
    persist();
    return { status: "started", key: normalizedKey };
  }

  function complete(key, digest, result) {
    const normalizedKey = String(key || "").trim().slice(0, 240);
    if (!normalizedKey) return;
    const existing = state.entries[normalizedKey];
    if (!existing || existing.digest !== digest) throw new Error("店铺日报采集幂等上下文已变化。");
    state.entries[normalizedKey] = {
      ...existing,
      status: "completed",
      result,
      updatedAt: now(),
    };
    persist();
  }

  function abort(key, digest) {
    const normalizedKey = String(key || "").trim().slice(0, 240);
    if (!normalizedKey) return;
    const existing = state.entries[normalizedKey];
    if (existing?.status === "pending" && existing.digest === digest) {
      delete state.entries[normalizedKey];
      persist();
    }
  }

  return {
    filePath: resolvedPath,
    begin,
    complete,
    abort,
  };
}

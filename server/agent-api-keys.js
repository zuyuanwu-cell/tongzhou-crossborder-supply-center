import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const KEY_PREFIX = "tzai_";
const MAX_ACTIVE_KEYS_PER_USER = 5;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 1000;

function hashKey(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function readStore(path) {
  if (!existsSync(path)) return { version: 1, updatedAt: "", keys: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || ""),
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
    };
  } catch {
    return { version: 1, updatedAt: "", keys: [] };
  }
}

function writeStore(path, store) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(temporaryPath, path);
}

function statusFor(record, now = Date.now()) {
  if (record.revokedAt) return "revoked";
  if (new Date(record.expiresAt).getTime() <= now) return "expired";
  return "active";
}

function publicKey(record) {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scope: record.scope,
    status: statusFor(record),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt || "",
    revokedAt: record.revokedAt || "",
  };
}

export function createAgentApiKeyStore({
  cacheDir,
  now = () => new Date(),
} = {}) {
  const storePath = resolve(cacheDir, "agent-api-keys.json");
  let store = readStore(storePath);

  function save() {
    store.updatedAt = now().toISOString();
    writeStore(storePath, store);
  }

  function listForUser(userId) {
    return store.keys
      .filter((record) => record.userId === userId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(publicKey);
  }

  function create({ userId, name, expiresInDays = DEFAULT_EXPIRY_DAYS }) {
    const safeUserId = String(userId || "").trim();
    if (!safeUserId) throw new Error("创建 Agent API Key 缺少用户标识。");
    const activeCount = store.keys
      .filter((record) => record.userId === safeUserId)
      .filter((record) => statusFor(record, now().getTime()) === "active")
      .length;
    if (activeCount >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new Error(`每个用户最多保留 ${MAX_ACTIVE_KEYS_PER_USER} 个有效 Agent API Key。`);
    }

    const safeName = String(name || "Agent API Key").trim().slice(0, 60) || "Agent API Key";
    const safeExpiryDays = Math.max(
      1,
      Math.min(MAX_EXPIRY_DAYS, Math.floor(Number(expiresInDays) || DEFAULT_EXPIRY_DAYS)),
    );
    const createdAt = now();
    const secret = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
    const record = {
      id: `ak_${randomBytes(12).toString("base64url")}`,
      userId: safeUserId,
      name: safeName,
      keyHash: hashKey(secret),
      keyPrefix: `${secret.slice(0, 13)}…`,
      scope: "agent:read",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + safeExpiryDays * 86400000).toISOString(),
      lastUsedAt: "",
      revokedAt: "",
    };
    store.keys.unshift(record);
    save();
    return {
      apiKey: secret,
      key: publicKey(record),
    };
  }

  function authenticate(secret) {
    const value = String(secret || "");
    if (!value.startsWith(KEY_PREFIX) || value.length < 32) return null;
    const keyHash = hashKey(value);
    const record = store.keys.find((entry) => entry.keyHash === keyHash);
    if (!record || statusFor(record, now().getTime()) !== "active") return null;

    const lastUsedAt = record.lastUsedAt ? new Date(record.lastUsedAt).getTime() : 0;
    if (!lastUsedAt || now().getTime() - lastUsedAt >= LAST_USED_WRITE_INTERVAL_MS) {
      record.lastUsedAt = now().toISOString();
      save();
    }
    return {
      id: record.id,
      userId: record.userId,
      scope: record.scope,
    };
  }

  function revoke({ userId, id }) {
    const record = store.keys.find((entry) => entry.id === id && entry.userId === userId);
    if (!record) return null;
    if (!record.revokedAt) {
      record.revokedAt = now().toISOString();
      save();
    }
    return publicKey(record);
  }

  function revokeAllForUser(userId) {
    let changed = false;
    const revokedAt = now().toISOString();
    for (const record of store.keys) {
      if (record.userId !== userId || record.revokedAt) continue;
      record.revokedAt = revokedAt;
      changed = true;
    }
    if (changed) save();
  }

  return {
    authenticate,
    create,
    listForUser,
    revoke,
    revokeAllForUser,
  };
}

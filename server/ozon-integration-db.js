import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

const ENTITY_TABLES = Object.freeze({
  routes: ["ozon_routes", (row) => `${row.storeId}::${row.ozonWarehouseId}`],
  skuMappings: ["ozon_sku_mappings", (row) => `${row.storeId}::${row.warehouseConnectionId}::${row.offerId || `sku:${row.ozonSku}`}`],
  orders: ["ozon_orders", (row) => row.postingNumber],
  scheduleRules: ["ozon_schedule_rules", (row) => row.id],
  scheduleBatches: ["ozon_schedule_batches", (row) => row.id],
  taskEvents: ["ozon_task_events", (row) => row.id],
});
const ARCHIVE_ENTITY_KEYS = new Set(["orders", "scheduleBatches", "taskEvents"]);
const ONLINE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function encryptionKey(secret) {
  const value = text(secret);
  if (value.length < 16) throw new Error("Ozon 集成密钥加密主密钥长度不足，请配置 INTEGRATION_CREDENTIAL_ENCRYPTION_KEY（至少 16 位）。");
  return createHash("sha256").update(value, "utf8").digest();
}

export function encryptOzonApiKey(value, secret) {
  const apiKey = text(value);
  if (!apiKey) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

export function decryptOzonApiKey(payload, secret) {
  if (!payload?.iv || !payload?.tag || !payload?.data) return "";
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

function rows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

function json(value, fallback = {}) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function legacyState(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export async function initOzonIntegrationStore({ dbPath, legacyPath = "", encryptionSecret } = {}) {
  if (!text(dbPath)) throw new Error("缺少 Ozon 数据库路径。");
  encryptionKey(encryptionSecret);
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS ozon_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ozon_stores (
      id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      api_key_iv TEXT,
      api_key_tag TEXT,
      api_key_data TEXT
    );
    CREATE TABLE IF NOT EXISTS ozon_routes (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_routes_store ON ozon_routes(store_id);
    CREATE TABLE IF NOT EXISTS ozon_sku_mappings (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_sku_store ON ozon_sku_mappings(store_id);
    CREATE TABLE IF NOT EXISTS ozon_orders (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_orders_store ON ozon_orders(store_id, updated_at);
    CREATE TABLE IF NOT EXISTS ozon_schedule_rules (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_rules_store ON ozon_schedule_rules(store_id);
    CREATE TABLE IF NOT EXISTS ozon_schedule_batches (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      rule_id TEXT NOT NULL DEFAULT '',
      scheduled_for TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ozon_task_events (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_events_store ON ozon_task_events(store_id, updated_at);
    CREATE TABLE IF NOT EXISTS ozon_archives (
      entity_type TEXT NOT NULL,
      archive_month TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      archived_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(entity_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ozon_archives_month ON ozon_archives(archive_month, entity_type);
  `);
  const batchColumns = new Set(rows(db, "PRAGMA table_info(ozon_schedule_batches)").map((row) => row.name));
  if (!batchColumns.has("rule_id")) db.run("ALTER TABLE ozon_schedule_batches ADD COLUMN rule_id TEXT NOT NULL DEFAULT ''");
  if (!batchColumns.has("scheduled_for")) db.run("ALTER TABLE ozon_schedule_batches ADD COLUMN scheduled_for TEXT NOT NULL DEFAULT ''");
  const batchRows = rows(db, "SELECT id,payload_json FROM ozon_schedule_batches WHERE rule_id='' OR scheduled_for=''");
  const backfillBatch = db.prepare("UPDATE ozon_schedule_batches SET rule_id=?,scheduled_for=? WHERE id=?");
  try {
    for (const row of batchRows) {
      const batch = json(row.payload_json);
      backfillBatch.run([text(batch.ruleId), text(batch.scheduledFor), text(row.id)]);
    }
  } finally {
    backfillBatch.free();
  }
  db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_ozon_batches_slot ON ozon_schedule_batches(rule_id,scheduled_for) WHERE rule_id<>'' AND scheduled_for<>''");

  function flush() {
    const nextPath = `${dbPath}.${process.pid}.next`;
    writeFileSync(nextPath, Buffer.from(db.export()));
    renameSync(nextPath, dbPath);
  }

  function loadState() {
    const meta = Object.fromEntries(rows(db, "SELECT key,value FROM ozon_meta").map((row) => [row.key, row.value]));
    const stores = rows(db, "SELECT payload_json,api_key_iv,api_key_tag,api_key_data FROM ozon_stores ORDER BY updated_at DESC").map((row) => ({
      ...json(row.payload_json),
      apiKey: decryptOzonApiKey({ iv: row.api_key_iv, tag: row.api_key_tag, data: row.api_key_data }, encryptionSecret),
    }));
    const state = {
      version: Number(meta.state_version || 3),
      updatedAt: text(meta.updated_at),
      stores,
    };
    for (const [key, [table]] of Object.entries(ENTITY_TABLES)) {
      state[key] = rows(db, `SELECT payload_json FROM ${table} ORDER BY updated_at DESC`).map((row) => json(row.payload_json));
    }
    return state;
  }

  function saveState(state = {}) {
    const updatedAt = text(state.updatedAt) || new Date().toISOString();
    db.run("BEGIN TRANSACTION");
    try {
      db.run("INSERT OR REPLACE INTO ozon_meta(key,value) VALUES('state_version',?),('updated_at',?)", [String(state.version || 3), updatedAt]);
      db.run("DELETE FROM ozon_stores");
      const storeStatement = db.prepare("INSERT INTO ozon_stores(id,updated_at,payload_json,api_key_iv,api_key_tag,api_key_data) VALUES(?,?,?,?,?,?)");
      try {
        for (const source of Array.isArray(state.stores) ? state.stores : []) {
          const store = { ...source };
          const encrypted = encryptOzonApiKey(store.apiKey, encryptionSecret);
          delete store.apiKey;
          storeStatement.run([text(store.id), updatedAt, JSON.stringify(store), encrypted?.iv || "", encrypted?.tag || "", encrypted?.data || ""]);
        }
      } finally {
        storeStatement.free();
      }
      for (const [key, [table, idOf]] of Object.entries(ENTITY_TABLES)) {
        db.run(`DELETE FROM ${table}`);
        const statement = key === "scheduleBatches"
          ? db.prepare(`INSERT INTO ${table}(id,store_id,rule_id,scheduled_for,updated_at,payload_json) VALUES(?,?,?,?,?,?)`)
          : db.prepare(`INSERT INTO ${table}(id,store_id,updated_at,payload_json) VALUES(?,?,?,?)`);
        const archiveStatement = ARCHIVE_ENTITY_KEYS.has(key)
          ? db.prepare("INSERT OR REPLACE INTO ozon_archives(entity_type,archive_month,entity_id,archived_at,payload_json) VALUES(?,?,?,?,?)")
          : null;
        const activeEntities = [];
        try {
          for (const entity of Array.isArray(state[key]) ? state[key] : []) {
            const entityUpdatedAt = text(entity.updatedAt || entity.at || entity.createdAt || entity.syncedAt || updatedAt);
            const entityTime = new Date(entityUpdatedAt).getTime();
            if (archiveStatement && Number.isFinite(entityTime) && Date.now() - entityTime > ONLINE_RETENTION_MS) {
              archiveStatement.run([key, entityUpdatedAt.slice(0, 7), text(idOf(entity)), updatedAt, JSON.stringify(entity)]);
              continue;
            }
            activeEntities.push(entity);
            if (key === "scheduleBatches") {
              statement.run([text(idOf(entity)), text(entity.storeId), text(entity.ruleId), text(entity.scheduledFor), text(entity.updatedAt || updatedAt), JSON.stringify(entity)]);
            } else {
              statement.run([text(idOf(entity)), text(entity.storeId), text(entity.updatedAt || entity.at || updatedAt), JSON.stringify(entity)]);
            }
          }
          if (archiveStatement) state[key] = activeEntities;
        } finally {
          statement.free();
          archiveStatement?.free();
        }
      }
      db.run("COMMIT");
      flush();
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  const hasState = rows(db, "SELECT COUNT(*) AS count FROM ozon_stores")[0]?.count > 0
    || rows(db, "SELECT value FROM ozon_meta WHERE key='legacy_imported_at'").length > 0;
  if (!hasState) {
    const legacy = legacyState(legacyPath);
    if (legacy) {
      const now = new Date().toISOString();
      saveState({ ...legacy, version: 3, updatedAt: text(legacy.updatedAt) || now });
      db.run("INSERT OR REPLACE INTO ozon_meta(key,value) VALUES('legacy_imported_at',?)", [now]);
      flush();
    }
  }

  return {
    loadState,
    saveState,
    close() { db.close(); },
    archiveStats() {
      return rows(db, "SELECT archive_month AS month,entity_type AS entityType,COUNT(*) AS count FROM ozon_archives GROUP BY archive_month,entity_type ORDER BY archive_month DESC,entity_type");
    },
    dbPath,
  };
}

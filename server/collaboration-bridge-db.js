import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function rows(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const output = [];
    while (statement.step()) output.push(statement.getAsObject());
    return output;
  } finally {
    statement.free();
  }
}

export async function initCollaborationBridgeStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS collaboration_outbox (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_collaboration_outbox_ready
      ON collaboration_outbox(status, next_attempt_at, created_at);

    CREATE TABLE IF NOT EXISTS collaboration_command_inbox (
      command_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      remote_status TEXT NOT NULL,
      local_status TEXT NOT NULL,
      result_json TEXT,
      last_error TEXT,
      submitted_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      processed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_collaboration_commands_status
      ON collaboration_command_inbox(local_status, submitted_at);

    CREATE TABLE IF NOT EXISTS collaboration_bridge_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function transaction(fn) {
    db.run("BEGIN TRANSACTION");
    try {
      const value = fn();
      db.run("COMMIT");
      persist();
      return value;
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }

  function enqueue({ id, eventType, payload, now }) {
    return transaction(() => {
      db.run(
        `INSERT INTO collaboration_outbox(id,event_type,payload_json,status,next_attempt_at,created_at)
         VALUES (?,?,?,'pending',?,?) ON CONFLICT(id) DO NOTHING`,
        [id, eventType, JSON.stringify(payload), now, now],
      );
      return rows(db, "SELECT * FROM collaboration_outbox WHERE id=?", [id])[0];
    });
  }

  function readyOutbox(now, limit = 50) {
    return rows(
      db,
      `SELECT * FROM collaboration_outbox
       WHERE status IN ('pending','retry') AND next_attempt_at<=?
       ORDER BY created_at,id LIMIT ?`,
      [now, Math.max(1, Math.min(200, Number(limit) || 50))],
    );
  }

  function markPublished(id, result, now) {
    transaction(() => db.run(
      "UPDATE collaboration_outbox SET status='published',processed_at=?,last_error=NULL,payload_json=? WHERE id=?",
      [now, JSON.stringify({ ...JSON.parse(rows(db, "SELECT payload_json FROM collaboration_outbox WHERE id=?", [id])[0]?.payload_json || "{}"), _delivery: result }), id],
    ));
  }

  function markOutboxRetry(id, error, nextAttemptAt) {
    transaction(() => db.run(
      `UPDATE collaboration_outbox SET status='retry',attempt_count=attempt_count+1,
       next_attempt_at=?,last_error=? WHERE id=?`,
      [nextAttemptAt, String(error || "unknown_error").slice(0, 2_000), id],
    ));
  }

  function upsertCommand(command, now) {
    transaction(() => db.run(
      `INSERT INTO collaboration_command_inbox
       (command_id,payload_json,remote_status,local_status,submitted_at,received_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(command_id) DO UPDATE SET payload_json=excluded.payload_json,
         remote_status=excluded.remote_status,
         local_status=CASE
           WHEN collaboration_command_inbox.local_status IN ('applied','rejected','failed') THEN collaboration_command_inbox.local_status
           WHEN excluded.remote_status='pending_approval' THEN 'awaiting_approval'
           ELSE collaboration_command_inbox.local_status
         END`,
      [command.id, JSON.stringify(command), command.status, command.status === "pending_approval" ? "awaiting_approval" : "received", command.submittedAt, now],
    ));
  }

  function command(commandId) {
    const row = rows(db, "SELECT * FROM collaboration_command_inbox WHERE command_id=?", [commandId])[0];
    return row ? { ...row, command: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null } : null;
  }

  function listCommands(statuses = [], limit = 100) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const normalized = statuses.filter(Boolean);
    const where = normalized.length ? `WHERE local_status IN (${normalized.map(() => "?").join(",")})` : "";
    return rows(db, `SELECT * FROM collaboration_command_inbox ${where} ORDER BY submitted_at,command_id LIMIT ?`, [...normalized, safeLimit])
      .map((row) => ({ ...row, command: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null }));
  }

  function markCommand(commandId, localStatus, { result = null, error = "", processedAt = null, remoteStatus = "" } = {}) {
    transaction(() => db.run(
      `UPDATE collaboration_command_inbox SET local_status=?,
       remote_status=CASE WHEN ?='' THEN remote_status ELSE ? END,
       result_json=?,last_error=?,processed_at=? WHERE command_id=?`,
      [localStatus, remoteStatus, remoteStatus, result ? JSON.stringify(result) : null, String(error || "").slice(0, 2_000), processedAt, commandId],
    ));
  }

  function state(key, fallback = "") {
    return String(rows(db, "SELECT value FROM collaboration_bridge_state WHERE key=?", [key])[0]?.value ?? fallback);
  }

  function setState(key, value, now) {
    transaction(() => db.run(
      `INSERT INTO collaboration_bridge_state(key,value,updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      [key, String(value), now],
    ));
  }

  function status() {
    const outbox = rows(db, "SELECT status,COUNT(*) AS count FROM collaboration_outbox GROUP BY status");
    const commands = rows(db, "SELECT local_status AS status,COUNT(*) AS count FROM collaboration_command_inbox GROUP BY local_status");
    return {
      outbox: Object.fromEntries(outbox.map((item) => [String(item.status), Number(item.count)])),
      commands: Object.fromEntries(commands.map((item) => [String(item.status), Number(item.count)])),
      commandCursor: state("command_cursor"),
      lastSuccessfulSyncAt: state("last_successful_sync_at"),
    };
  }

  persist();
  return { command, enqueue, listCommands, markCommand, markOutboxRetry, markPublished, readyOutbox, setState, state, status, upsertCommand };
}

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function text(value) {
  return String(value ?? "").trim();
}

function json(value, fallback) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function jsonText(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

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

function nowIso(now = () => new Date()) {
  const value = now();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function conversationFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    hermesSessionId: row.hermes_session_id,
    title: row.title,
    context: json(row.page_context_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    runId: row.run_id || "",
    role: row.role,
    content: row.content,
    evidence: json(row.evidence_json, []),
    createdAt: row.created_at,
  };
}

function runFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    hermesRunId: row.hermes_run_id || "",
    status: row.status,
    model: row.model,
    provider: row.provider || "",
    usage: json(row.usage_json, {}),
    toolCount: Number(row.tool_count || 0),
    error: row.error || "",
    durationMs: Number(row.duration_ms || 0),
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toolEventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence_no || 0),
    type: row.event_type,
    toolCallId: row.tool_call_id || "",
    tool: row.tool_name || "",
    summary: row.summary || "",
    payload: json(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function proposalFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    tool: row.tool_name,
    argumentsHash: row.arguments_hash || "",
    argumentsSummary: json(row.arguments_summary_json, {}),
    preview: json(row.preview_json, {}),
    status: row.status,
    requestId: row.hermes_request_id || "",
    executionGeneration: Number(row.execution_generation || 0),
    approval: row.approval_choice || "",
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || "",
    idempotencyKey: row.idempotency_key,
    result: json(row.result_json, {}),
    error: row.error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function caseFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    ruleCode: row.rule_code,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    fingerprint: row.fingerprint,
    warehouseId: row.warehouse_id || "",
    project: row.project || "",
    country: row.country || "",
    sku: row.sku || "",
    title: row.title,
    summary: row.summary,
    severity: row.severity,
    status: row.status,
    assigneeId: row.assignee_id || "",
    assigneeName: row.assignee_name || "",
    evidence: json(row.evidence_json, []),
    href: row.href || "",
    sourceUpdatedAt: row.source_updated_at || "",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at || "",
    resolution: row.resolution || "",
    version: Number(row.version || 1),
    missingScanCount: Number(row.missing_scan_count || 0),
    lastNotifiedAt: row.last_notified_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function caseEventFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    eventType: row.event_type,
    actorId: row.actor_id || "",
    actorName: row.actor_name || "",
    payload: json(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function normalizeScopes(scopes = {}) {
  return {
    warehouseIds: new Set((scopes.warehouseIds || []).map(text).filter(Boolean)),
    countries: new Set((scopes.countries || []).map(text).filter(Boolean)),
    skus: new Set((scopes.skus || []).map((value) => text(value).toUpperCase()).filter(Boolean)),
  };
}

function inCaseScope(item, scopes = {}) {
  const safe = normalizeScopes(scopes);
  if (safe.warehouseIds.size && (!item.warehouseId || !safe.warehouseIds.has(text(item.warehouseId)))) return false;
  if (safe.countries.size && (!item.country || !safe.countries.has(text(item.country)))) return false;
  if (safe.skus.size && (!item.sku || !safe.skus.has(text(item.sku).toUpperCase()))) return false;
  return true;
}

export async function initHermesIntegrationStore(dbPath, { now = () => new Date() } = {}) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS hermes_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      hermes_session_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      page_context_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_conversations_user ON hermes_conversations(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS hermes_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      run_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hermes_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_messages_conversation ON hermes_messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS hermes_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      hermes_run_id TEXT UNIQUE,
      request_idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT,
      usage_json TEXT NOT NULL DEFAULT '{}',
      tool_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES hermes_conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_runs_user_status ON hermes_runs(user_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS hermes_tool_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      tool_call_id TEXT,
      tool_name TEXT,
      summary TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence_no),
      FOREIGN KEY(run_id) REFERENCES hermes_runs(id)
    );

    CREATE TABLE IF NOT EXISTS hermes_action_proposals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL UNIQUE,
      tool_name TEXT NOT NULL,
      arguments_hash TEXT NOT NULL DEFAULT '',
      arguments_summary_json TEXT NOT NULL DEFAULT '{}',
      preview_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL,
      hermes_request_id TEXT,
      execution_generation INTEGER,
      approval_choice TEXT,
      approved_by TEXT,
      approved_at TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES hermes_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_hermes_proposals_run ON hermes_action_proposals(run_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_exception_cases (
      id TEXT PRIMARY KEY,
      rule_code TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      warehouse_id TEXT,
      project TEXT,
      country TEXT,
      sku TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_id TEXT,
      assignee_name TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      evidence_hash TEXT NOT NULL,
      href TEXT,
      source_updated_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_scan_id TEXT,
      missing_scan_count INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      resolution TEXT,
      last_notified_at TEXT,
      last_notified_severity TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_cases_status ON agent_exception_cases(status, severity, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_agent_cases_scope ON agent_exception_cases(warehouse_id, sku, status);

    CREATE TABLE IF NOT EXISTS agent_case_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(case_id) REFERENCES agent_exception_cases(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_case_events_case ON agent_case_events(case_id, created_at);

    CREATE TABLE IF NOT EXISTS hermes_request_nonces (
      nonce TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hermes_integration_state (
      state_key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hermes_manual_actions (
      user_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, idempotency_key)
    );
  `);
  const caseColumns = new Set(rows(db, "PRAGMA table_info(agent_exception_cases)").map((item) => item.name));
  if (!caseColumns.has("country")) db.run("ALTER TABLE agent_exception_cases ADD COLUMN country TEXT");
  const proposalColumns = new Set(rows(db, "PRAGMA table_info(hermes_action_proposals)").map((item) => item.name));
  if (!proposalColumns.has("arguments_hash")) db.run("ALTER TABLE hermes_action_proposals ADD COLUMN arguments_hash TEXT NOT NULL DEFAULT ''");

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function run(sql, params = []) {
    db.run(sql, params);
  }

  function all(sql, params = []) {
    return rows(db, sql, params);
  }

  function first(sql, params = []) {
    return rows(db, sql, params)[0] || null;
  }

  function transaction(fn) {
    db.run("BEGIN IMMEDIATE");
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

  function createConversation({ userId, title = "新会话", context = {} }) {
    const createdAt = nowIso(now);
    const item = {
      id: randomUUID(),
      userId: text(userId),
      hermesSessionId: `tz_${randomUUID()}`,
      title: text(title).slice(0, 120) || "新会话",
      context,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    };
    if (!item.userId) throw Object.assign(new Error("Conversation user is required."), { statusCode: 400 });
    transaction(() => run(
      "INSERT INTO hermes_conversations (id,user_id,hermes_session_id,title,page_context_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      [item.id, item.userId, item.hermesSessionId, item.title, jsonText(item.context), item.status, createdAt, createdAt],
    ));
    return item;
  }

  function listConversations(userId, { limit = 50 } = {}) {
    return all(
      "SELECT * FROM hermes_conversations WHERE user_id=? AND status!='deleted' ORDER BY updated_at DESC LIMIT ?",
      [text(userId), Math.max(1, Math.min(100, Number(limit) || 50))],
    ).map(conversationFromRow);
  }

  function getConversation(id, userId) {
    return conversationFromRow(first("SELECT * FROM hermes_conversations WHERE id=? AND user_id=? AND status!='deleted'", [text(id), text(userId)]));
  }

  function getConversationBySession(sessionId) {
    return conversationFromRow(first("SELECT * FROM hermes_conversations WHERE hermes_session_id=? AND status='active'", [text(sessionId)]));
  }

  function updateConversation(id, userId, patch = {}) {
    const current = getConversation(id, userId);
    if (!current) return null;
    const updatedAt = nowIso(now);
    const title = patch.title === undefined ? current.title : text(patch.title).slice(0, 120) || current.title;
    const context = patch.context === undefined ? current.context : patch.context;
    const status = patch.status === undefined ? current.status : text(patch.status);
    transaction(() => run(
      "UPDATE hermes_conversations SET title=?,page_context_json=?,status=?,updated_at=? WHERE id=? AND user_id=?",
      [title, jsonText(context), status, updatedAt, current.id, current.userId],
    ));
    return getConversation(id, userId);
  }

  function addMessage({ conversationId, userId, runId = "", role, content, evidence = [] }) {
    const conversation = getConversation(conversationId, userId);
    if (!conversation) throw Object.assign(new Error("Conversation not found."), { statusCode: 404 });
    const createdAt = nowIso(now);
    const item = { id: randomUUID(), conversationId, runId: text(runId), role: text(role), content: String(content || ""), evidence, createdAt };
    transaction(() => {
      run(
        "INSERT INTO hermes_messages (id,conversation_id,user_id,run_id,role,content,evidence_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
        [item.id, conversationId, userId, item.runId || null, item.role, item.content, jsonText(evidence, []), createdAt],
      );
      run("UPDATE hermes_conversations SET updated_at=? WHERE id=?", [createdAt, conversationId]);
    });
    return item;
  }

  function listMessages(conversationId, userId, { limit = 200 } = {}) {
    if (!getConversation(conversationId, userId)) return null;
    return all(
      "SELECT * FROM hermes_messages WHERE conversation_id=? AND user_id=? ORDER BY created_at ASC LIMIT ?",
      [text(conversationId), text(userId), Math.max(1, Math.min(500, Number(limit) || 200))],
    ).map(messageFromRow);
  }

  function createRun({ conversationId, userId, provider = "configured", model, idempotencyKey }) {
    if (!getConversation(conversationId, userId)) throw Object.assign(new Error("Conversation not found."), { statusCode: 404 });
    const replay = runFromRow(first("SELECT * FROM hermes_runs WHERE request_idempotency_key=?", [text(idempotencyKey)]));
    if (replay) return { ...replay, idempotentReplay: true };
    const createdAt = nowIso(now);
    const item = {
      id: randomUUID(), conversationId, hermesRunId: "", status: "queued", model: text(model), provider: text(provider) || "configured",
      usage: {}, toolCount: 0, error: "", durationMs: 0, startedAt: "", completedAt: "", createdAt, updatedAt: createdAt,
    };
    transaction(() => run(
      "INSERT INTO hermes_runs (id,conversation_id,user_id,request_idempotency_key,status,model,provider,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [item.id, conversationId, userId, text(idempotencyKey), item.status, item.model, item.provider, createdAt, createdAt],
    ));
    return item;
  }

  function getRun(id, userId) {
    return runFromRow(first("SELECT * FROM hermes_runs WHERE id=? AND user_id=?", [text(id), text(userId)]));
  }

  function getRunByHermesId(hermesRunId) {
    return runFromRow(first("SELECT * FROM hermes_runs WHERE hermes_run_id=?", [text(hermesRunId)]));
  }

  function activeRunForUser(userId) {
    return runFromRow(first(
      "SELECT * FROM hermes_runs WHERE user_id=? AND status IN ('queued','running','waiting_for_approval','stopping') ORDER BY created_at DESC LIMIT 1",
      [text(userId)],
    ));
  }

  function activeRunForConversation(conversationId) {
    return runFromRow(first(
      "SELECT * FROM hermes_runs WHERE conversation_id=? AND status IN ('queued','running','waiting_for_approval','stopping') ORDER BY created_at DESC LIMIT 1",
      [text(conversationId)],
    ));
  }

  function countActiveRuns() {
    return Number(first("SELECT COUNT(*) AS count FROM hermes_runs WHERE status IN ('queued','running','waiting_for_approval','stopping')")?.count || 0);
  }

  function listActiveRuns() {
    return all("SELECT * FROM hermes_runs WHERE status IN ('queued','running','waiting_for_approval','stopping') ORDER BY created_at ASC LIMIT 100").map(runFromRow);
  }

  function updateRun(id, patch = {}) {
    const current = runFromRow(first("SELECT * FROM hermes_runs WHERE id=?", [text(id)]));
    if (!current) return null;
    const updatedAt = nowIso(now);
    const next = { ...current, ...patch, updatedAt };
    transaction(() => run(
      `UPDATE hermes_runs SET hermes_run_id=?,status=?,model=?,provider=?,usage_json=?,tool_count=?,error=?,duration_ms=?,started_at=?,completed_at=?,updated_at=? WHERE id=?`,
      [next.hermesRunId || null, next.status, next.model, next.provider || null, jsonText(next.usage), Number(next.toolCount || 0), next.error || null,
        Number(next.durationMs || 0), next.startedAt || null, next.completedAt || null, updatedAt, current.id],
    ));
    return runFromRow(first("SELECT * FROM hermes_runs WHERE id=?", [current.id]));
  }

  function appendToolEvent({ runId, type, toolCallId = "", tool = "", summary = "", payload = {}, sequence }) {
    const seq = Number.isFinite(Number(sequence)) ? Number(sequence) : Number(first("SELECT COALESCE(MAX(sequence_no),0)+1 AS next FROM hermes_tool_events WHERE run_id=?", [runId])?.next || 1);
    const existing = toolEventFromRow(first("SELECT * FROM hermes_tool_events WHERE run_id=? AND sequence_no=?", [runId, seq]));
    if (existing) return { ...existing, idempotentReplay: true };
    const createdAt = nowIso(now);
    const id = randomUUID();
    transaction(() => {
      run(
        "INSERT OR IGNORE INTO hermes_tool_events (id,run_id,sequence_no,event_type,tool_call_id,tool_name,summary,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, runId, seq, text(type), text(toolCallId) || null, text(tool) || null, text(summary) || null, jsonText(payload), createdAt],
      );
      if (text(type) === "tool.started") run("UPDATE hermes_runs SET tool_count=tool_count+1,updated_at=? WHERE id=?", [createdAt, runId]);
    });
    return { ...toolEventFromRow(first("SELECT * FROM hermes_tool_events WHERE run_id=? AND sequence_no=?", [runId, seq])), idempotentReplay: false };
  }

  function listToolEvents(runId, userId, afterSequence = 0) {
    const owned = first("SELECT id FROM hermes_runs WHERE id=? AND user_id=?", [text(runId), text(userId)]);
    if (!owned) return null;
    return all("SELECT * FROM hermes_tool_events WHERE run_id=? AND sequence_no>? ORDER BY sequence_no ASC LIMIT 1000", [runId, Number(afterSequence) || 0]).map(toolEventFromRow);
  }

  function lastToolEventSequence(runId, userId) {
    const owned = first("SELECT id FROM hermes_runs WHERE id=? AND user_id=?", [text(runId), text(userId)]);
    if (!owned) return 0;
    return Number(first("SELECT COALESCE(MAX(sequence_no),0) AS sequence FROM hermes_tool_events WHERE run_id=?", [runId])?.sequence || 0);
  }

  function upsertActionProposal({ runId, toolCallId, tool, argumentsHash, argumentsSummary = {}, preview = {}, status = "pending", idempotencyKey }) {
    const existing = proposalFromRow(first("SELECT * FROM hermes_action_proposals WHERE tool_call_id=?", [text(toolCallId)]));
    if (existing) return existing;
    const createdAt = nowIso(now);
    const id = randomUUID();
    transaction(() => run(
      "INSERT INTO hermes_action_proposals (id,run_id,tool_call_id,tool_name,arguments_hash,arguments_summary_json,preview_json,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [id, runId, toolCallId, tool, text(argumentsHash), jsonText(argumentsSummary), jsonText(preview), status, idempotencyKey, createdAt, createdAt],
    ));
    return proposalFromRow(first("SELECT * FROM hermes_action_proposals WHERE id=?", [id]));
  }

  function getActionProposalByToolCall(toolCallId) {
    return proposalFromRow(first("SELECT * FROM hermes_action_proposals WHERE tool_call_id=?", [text(toolCallId)]));
  }

  function updateActionProposal(toolCallId, patch = {}) {
    const current = getActionProposalByToolCall(toolCallId);
    if (!current) return null;
    const updatedAt = nowIso(now);
    const next = { ...current, ...patch };
    transaction(() => run(
      "UPDATE hermes_action_proposals SET preview_json=?,status=?,hermes_request_id=?,execution_generation=?,approval_choice=?,approved_by=?,approved_at=?,result_json=?,error=?,updated_at=? WHERE tool_call_id=?",
      [jsonText(next.preview), next.status, next.requestId || null, Number(next.executionGeneration || 0) || null, next.approval || null, next.approvedBy || null, next.approvedAt || null, jsonText(next.result), next.error || null, updatedAt, toolCallId],
    ));
    return getActionProposalByToolCall(toolCallId);
  }

  function appendCaseEvent(caseId, eventType, payload = {}, actor = {}) {
    const createdAt = nowIso(now);
    const id = randomUUID();
    run(
      "INSERT INTO agent_case_events (id,case_id,event_type,actor_id,actor_name,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
      [id, caseId, text(eventType), text(actor.id) || null, text(actor.name) || null, jsonText(payload), createdAt],
    );
    return { id, caseId, eventType, actorId: text(actor.id), actorName: text(actor.name), payload, createdAt };
  }

  function getCase(id, scopes = {}) {
    const item = caseFromRow(first("SELECT * FROM agent_exception_cases WHERE id=?", [text(id)]));
    return item && inCaseScope(item, scopes) ? item : null;
  }

  function recordCaseEvent(caseId, eventType, payload = {}, actor = {}, scopes = {}) {
    if (!getCase(caseId, scopes)) return null;
    return transaction(() => appendCaseEvent(caseId, eventType, payload, actor));
  }

  function getCaseByFingerprint(fingerprint) {
    return caseFromRow(first("SELECT * FROM agent_exception_cases WHERE fingerprint=?", [text(fingerprint)]));
  }

  function listCases(filters = {}, scopes = {}) {
    const where = [];
    const params = [];
    if (text(filters.status)) { where.push("status=?"); params.push(text(filters.status)); }
    if (text(filters.severity)) { where.push("severity=?"); params.push(text(filters.severity)); }
    if (text(filters.assigneeId)) { where.push("assignee_id=?"); params.push(text(filters.assigneeId)); }
    if (text(filters.ruleCode)) { where.push("rule_code=?"); params.push(text(filters.ruleCode)); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 200));
    return all(`SELECT * FROM agent_exception_cases ${clause} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, updated_at DESC LIMIT ?`, [...params, limit])
      .map(caseFromRow)
      .filter((item) => inCaseScope(item, scopes));
  }

  function listCaseEvents(caseId, scopes = {}) {
    if (!getCase(caseId, scopes)) return null;
    return all("SELECT * FROM agent_case_events WHERE case_id=? ORDER BY created_at ASC", [text(caseId)]).map(caseEventFromRow);
  }

  function updateCase(caseId, patch = {}, actor = {}, scopes = {}) {
    const current = getCase(caseId, scopes);
    if (!current) return null;
    const allowedStatuses = new Set(["open", "investigating", "action_pending", "resolved", "dismissed"]);
    const nextStatus = patch.status === undefined ? current.status : text(patch.status);
    if (!allowedStatuses.has(nextStatus)) throw Object.assign(new Error("Invalid case status."), { statusCode: 400 });
    if (patch.version !== undefined && Number(patch.version) !== current.version) {
      throw Object.assign(new Error("Case version changed. Refresh before updating."), { statusCode: 409, code: "version_conflict" });
    }
    const updatedAt = nowIso(now);
    const assigneeId = patch.assigneeId === undefined ? current.assigneeId : text(patch.assigneeId);
    const assigneeName = patch.assigneeName === undefined ? current.assigneeName : text(patch.assigneeName);
    const resolution = patch.resolution === undefined ? current.resolution : text(patch.resolution);
    const resolvedAt = ["resolved", "dismissed"].includes(nextStatus) ? (current.resolvedAt || updatedAt) : "";
    transaction(() => {
      run(
        "UPDATE agent_exception_cases SET status=?,assignee_id=?,assignee_name=?,resolution=?,resolved_at=?,version=version+1,updated_at=? WHERE id=?",
        [nextStatus, assigneeId || null, assigneeName || null, resolution || null, resolvedAt || null, updatedAt, caseId],
      );
      const eventType = nextStatus !== current.status ? (nextStatus === "resolved" ? "resolved" : nextStatus === "dismissed" ? "dismissed" : "status_changed") : "assigned";
      appendCaseEvent(caseId, eventType, { fromStatus: current.status, toStatus: nextStatus, assigneeId, assigneeName, resolution }, actor);
    });
    return getCase(caseId, scopes);
  }

  function reconcileCases(observations = [], { scanId = randomUUID(), complete = true, actor = { id: "system", name: "Hermes patrol" } } = {}) {
    const detected = [];
    const escalated = [];
    const changed = [];
    const resolved = [];
    const seen = new Set();
    const timestamp = nowIso(now);
    const rank = { low: 0, medium: 1, high: 2, critical: 3 };
    transaction(() => {
      for (const observation of observations) {
        const fingerprint = text(observation.fingerprint);
        if (!fingerprint || seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        const evidence = Array.isArray(observation.evidence) ? observation.evidence : [];
        const evidenceHash = text(observation.evidenceHash);
        const current = getCaseByFingerprint(fingerprint);
        if (!current) {
          const id = randomUUID();
          run(
            `INSERT INTO agent_exception_cases (id,rule_code,resource_type,resource_id,fingerprint,warehouse_id,project,country,sku,title,summary,severity,status,evidence_json,evidence_hash,href,source_updated_at,first_seen_at,last_seen_at,last_scan_id,missing_scan_count,version,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, observation.ruleCode, observation.resourceType, observation.resourceId, fingerprint, text(observation.warehouseId) || null,
              text(observation.project) || null, text(observation.country) || null, text(observation.sku) || null, observation.title, observation.summary, observation.severity,
              "open", jsonText(evidence, []), evidenceHash, text(observation.href) || null, text(observation.sourceUpdatedAt) || null,
              timestamp, timestamp, scanId, 0, 1, timestamp, timestamp],
          );
          appendCaseEvent(id, "detected", { severity: observation.severity, evidence }, actor);
          detected.push(caseFromRow(first("SELECT * FROM agent_exception_cases WHERE id=?", [id])));
          continue;
        }
        const wasInactive = ["resolved", "dismissed"].includes(current.status);
        const severityUp = (rank[observation.severity] ?? 0) > (rank[current.severity] ?? 0);
        const evidenceChanged = evidenceHash !== text(first("SELECT evidence_hash FROM agent_exception_cases WHERE id=?", [current.id])?.evidence_hash);
        const nextStatus = wasInactive ? "open" : current.status;
        run(
          `UPDATE agent_exception_cases SET title=?,summary=?,severity=?,status=?,warehouse_id=?,project=?,country=?,sku=?,evidence_json=?,evidence_hash=?,href=?,source_updated_at=?,last_seen_at=?,last_scan_id=?,missing_scan_count=0,resolved_at=NULL,resolution=NULL,version=version+1,updated_at=? WHERE id=?`,
          [observation.title, observation.summary, observation.severity, nextStatus, text(observation.warehouseId) || null,
            text(observation.project) || null, text(observation.country) || null, text(observation.sku) || null, jsonText(evidence, []), evidenceHash,
            text(observation.href) || null, text(observation.sourceUpdatedAt) || null, timestamp, scanId, timestamp, current.id],
        );
        if (wasInactive) appendCaseEvent(current.id, "reopened", { severity: observation.severity, evidence }, actor);
        else if (severityUp) appendCaseEvent(current.id, "severity_escalated", { from: current.severity, to: observation.severity, evidence }, actor);
        else if (evidenceChanged) appendCaseEvent(current.id, "evidence_updated", { evidence }, actor);
        const next = caseFromRow(first("SELECT * FROM agent_exception_cases WHERE id=?", [current.id]));
        if (wasInactive) detected.push(next);
        else if (severityUp) escalated.push(next);
        else if (evidenceChanged) changed.push(next);
      }

      if (complete) {
        const active = all("SELECT * FROM agent_exception_cases WHERE status NOT IN ('resolved','dismissed')").map(caseFromRow);
        for (const item of active) {
          if (seen.has(item.fingerprint)) continue;
          const missing = item.missingScanCount + 1;
          if (missing < 2) {
            run("UPDATE agent_exception_cases SET missing_scan_count=?,last_scan_id=?,version=version+1,updated_at=? WHERE id=?", [missing, scanId, timestamp, item.id]);
            continue;
          }
          run("UPDATE agent_exception_cases SET status='resolved',resolved_at=?,resolution=?,missing_scan_count=?,last_scan_id=?,version=version+1,updated_at=? WHERE id=?", [timestamp, "连续两次完整巡检未再发现异常", missing, scanId, timestamp, item.id]);
          appendCaseEvent(item.id, "auto_resolved", { missingScanCount: missing, scanId }, actor);
          resolved.push(caseFromRow(first("SELECT * FROM agent_exception_cases WHERE id=?", [item.id])));
        }
      }
    });
    return { scanId, complete: Boolean(complete), detected, escalated, changed, resolved, observed: seen.size };
  }

  function markCaseNotified(caseId, severity) {
    const timestamp = nowIso(now);
    transaction(() => run("UPDATE agent_exception_cases SET last_notified_at=?,last_notified_severity=?,updated_at=? WHERE id=?", [timestamp, text(severity), timestamp, text(caseId)]));
    return caseFromRow(first("SELECT * FROM agent_exception_cases WHERE id=?", [text(caseId)]));
  }

  function consumeNonce(nonce, expiresAt) {
    const safeNonce = text(nonce);
    const expiry = new Date(expiresAt).toISOString();
    if (!safeNonce) return false;
    return transaction(() => {
      run("DELETE FROM hermes_request_nonces WHERE expires_at<=?", [nowIso(now)]);
      if (first("SELECT nonce FROM hermes_request_nonces WHERE nonce=?", [safeNonce])) return false;
      run("INSERT INTO hermes_request_nonces (nonce,expires_at,created_at) VALUES (?,?,?)", [safeNonce, expiry, nowIso(now)]);
      return true;
    });
  }

  function getState(key, fallback = null) {
    const row = first("SELECT value_json FROM hermes_integration_state WHERE state_key=?", [text(key)]);
    return row ? json(row.value_json, fallback) : fallback;
  }

  function setState(key, value) {
    const updatedAt = nowIso(now);
    transaction(() => run(
      `INSERT INTO hermes_integration_state (state_key,value_json,updated_at) VALUES (?,?,?)
       ON CONFLICT(state_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      [text(key), jsonText(value), updatedAt],
    ));
    return value;
  }

  function getManualAction(userId, idempotencyKey) {
    const row = first("SELECT * FROM hermes_manual_actions WHERE user_id=? AND idempotency_key=?", [text(userId), text(idempotencyKey)]);
    return row ? { userId: row.user_id, idempotencyKey: row.idempotency_key, requestHash: row.request_hash, result: json(row.result_json, {}), createdAt: row.created_at } : null;
  }

  function recordManualAction({ userId, idempotencyKey, requestHash, result }) {
    const createdAt = nowIso(now);
    transaction(() => run(
      "INSERT OR IGNORE INTO hermes_manual_actions (user_id,idempotency_key,request_hash,result_json,created_at) VALUES (?,?,?,?,?)",
      [text(userId), text(idempotencyKey), text(requestHash), jsonText(result), createdAt],
    ));
    return getManualAction(userId, idempotencyKey);
  }

  function metrics({ days = 14 } = {}) {
    const periodDays = Math.max(1, Math.min(365, Number(days) || 14));
    const cutoff = new Date(new Date(nowIso(now)).getTime() - periodDays * 86_400_000).toISOString();
    const runs = all("SELECT * FROM hermes_runs WHERE created_at>=?", [cutoff]).map(runFromRow);
    const proposals = all("SELECT * FROM hermes_action_proposals WHERE created_at>=?", [cutoff]).map(proposalFromRow);
    const toolEvents = all("SELECT * FROM hermes_tool_events WHERE created_at>=? AND event_type='tool.completed'", [cutoff]).map(toolEventFromRow);
    const firstEvents = new Map(all("SELECT run_id,MIN(created_at) AS first_at FROM hermes_tool_events WHERE created_at>=? GROUP BY run_id", [cutoff]).map((item) => [item.run_id, item.first_at]));
    const activeCases = Number(first("SELECT COUNT(*) AS count FROM agent_exception_cases WHERE status IN ('open','investigating','action_pending')")?.count || 0);
    const completed = runs.filter((item) => item.status === "completed");
    const failed = runs.filter((item) => ["failed", "cancelled", "interrupted"].includes(item.status));
    const inputTokens = runs.reduce((sum, item) => sum + Number(item.usage?.input_tokens || item.usage?.prompt_tokens || 0), 0);
    const outputTokens = runs.reduce((sum, item) => sum + Number(item.usage?.output_tokens || item.usage?.completion_tokens || 0), 0);
    const costUsd = runs.reduce((sum, item) => sum + Number(item.usage?.cost_usd || item.usage?.cost || 0), 0);
    const completedDurations = completed.map((item) => item.durationMs).filter((value) => value > 0);
    const toolDurations = toolEvents.map((item) => Number(item.payload?.durationMs || 0)).filter((value) => value > 0);
    const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    const median = (values) => {
      if (!values.length) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    };
    const firstEventLatencies = runs.map((item) => {
      const firstAt = Date.parse(firstEvents.get(item.id) || "");
      const startedAt = Date.parse(item.startedAt || item.createdAt || "");
      return Number.isFinite(firstAt) && Number.isFinite(startedAt) ? Math.max(0, firstAt - startedAt) : 0;
    }).filter((value) => value > 0);
    return {
      periodDays,
      runs: {
        total: runs.length,
        completed: completed.length,
        failed: failed.length,
        successRate: runs.length ? Number((completed.length / runs.length).toFixed(4)) : 0,
        averageDurationMs: average(completedDurations),
        firstEventMedianMs: median(firstEventLatencies),
      },
      tools: { completed: toolEvents.length, averageDurationMs: average(toolDurations) },
      approvals: {
        total: proposals.length,
        approved: proposals.filter((item) => item.approval === "once").length,
        denied: proposals.filter((item) => item.approval === "deny").length,
        outcomeUnknown: proposals.filter((item) => item.status === "outcome_unknown").length,
      },
      usage: { inputTokens, outputTokens, costUsd: Number(costUsd.toFixed(6)) },
      cases: { active: activeCases },
    };
  }

  function prune({ messageDays = 90, auditDays = 365 } = {}) {
    const messageCutoff = new Date(new Date(nowIso(now)).getTime() - Number(messageDays) * 86_400_000).toISOString();
    const auditCutoff = new Date(new Date(nowIso(now)).getTime() - Number(auditDays) * 86_400_000).toISOString();
    transaction(() => {
      run("DELETE FROM hermes_messages WHERE created_at<?", [messageCutoff]);
      run("DELETE FROM hermes_request_nonces WHERE expires_at<=?", [nowIso(now)]);
      run("DELETE FROM hermes_tool_events WHERE created_at<?", [auditCutoff]);
    });
  }

  persist();
  return {
    dbPath,
    createConversation,
    listConversations,
    getConversation,
    getConversationBySession,
    updateConversation,
    addMessage,
    listMessages,
    createRun,
    getRun,
    getRunByHermesId,
    activeRunForUser,
    activeRunForConversation,
    countActiveRuns,
    listActiveRuns,
    updateRun,
    appendToolEvent,
    listToolEvents,
    lastToolEventSequence,
    upsertActionProposal,
    getActionProposalByToolCall,
    updateActionProposal,
    getCase,
    getCaseByFingerprint,
    recordCaseEvent,
    listCases,
    listCaseEvents,
    updateCase,
    reconcileCases,
    markCaseNotified,
    consumeNonce,
    getState,
    setState,
    getManualAction,
    recordManualAction,
    metrics,
    prune,
  };
}

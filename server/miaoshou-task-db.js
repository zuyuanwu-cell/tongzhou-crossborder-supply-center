import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs from "sql.js";

function all(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    return rows;
  } finally {
    statement.free();
  }
}

function first(db, sql, params = []) {
  return all(db, sql, params)[0] || null;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function taskFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ""),
    opOrderPackageId: String(row.op_order_package_id || ""),
    shopId: String(row.shop_id || ""),
    shopName: String(row.shop_name || ""),
    platform: String(row.platform || ""),
    site: String(row.site || ""),
    appPackageNo: String(row.app_package_no || ""),
    platformOrderSn: String(row.platform_order_sn || ""),
    status: String(row.status || "pending"),
    trackingNo: String(row.tracking_no || ""),
    headTrackingNo: String(row.head_tracking_no || ""),
    logisticsType: String(row.logistics_type || ""),
    waybillUrl: String(row.waybill_url || ""),
    errorCode: String(row.error_code || ""),
    errorMessage: String(row.error_message || ""),
    attempts: Number(row.attempts || 0),
    firstSeenAt: String(row.first_seen_at || ""),
    lastAttemptAt: String(row.last_attempt_at || ""),
    completedAt: String(row.completed_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function eventFromRow(row) {
  return {
    id: String(row.id || ""),
    taskId: String(row.task_id || ""),
    type: String(row.event_type || ""),
    status: String(row.status || ""),
    message: String(row.message || ""),
    code: String(row.code || ""),
    createdAt: String(row.created_at || ""),
    details: parseJson(row.details_json, {}),
  };
}

function packageId(input) {
  return String(input?.opOrderPackageId ?? input?.op_order_package_id ?? "").trim();
}

function packageField(input, ...keys) {
  for (const key of keys) {
    const value = input?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function safePackageSnapshot(input = {}) {
  return {
    opOrderPackageId: packageId(input),
    shopId: packageField(input, "shopId"),
    platform: packageField(input, "platform"),
    site: packageField(input, "site"),
    appPackageNo: packageField(input, "appPackageNo"),
    platformOrderSn: packageField(input, "platformOrderSn"),
    appPackageStatus: packageField(input, "appPackageStatus"),
    appPackageStatusText: packageField(input, "appPackageStatusText"),
    platformPackageStatus: packageField(input, "platformPackageStatus"),
    fulfillmentType: packageField(input, "fulfillmentType"),
    logisticsNo: packageField(input, "logisticsNo"),
    applyTrackingNoFailCode: packageField(input, "applyTrackingNoFailCode"),
    applyTrackingNoFailReason: packageField(input, "applyTrackingNoFailReason"),
  };
}

export async function initMiaoshouTaskStore(dbPath) {
  const SQL = await initSqlJs();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
  db.run(`
    PRAGMA user_version = 1;
    CREATE TABLE IF NOT EXISTS miaoshou_tasks (
      id TEXT PRIMARY KEY,
      op_order_package_id TEXT NOT NULL UNIQUE,
      shop_id TEXT,
      shop_name TEXT,
      platform TEXT,
      site TEXT,
      app_package_no TEXT,
      platform_order_sn TEXT,
      status TEXT NOT NULL,
      tracking_no TEXT,
      head_tracking_no TEXT,
      logistics_type TEXT,
      waybill_url TEXT,
      error_code TEXT,
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_attempt_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      package_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miaoshou_tasks_status ON miaoshou_tasks(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_miaoshou_tasks_shop ON miaoshou_tasks(shop_id, updated_at);
    CREATE TABLE IF NOT EXISTS miaoshou_task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT,
      message TEXT,
      code TEXT,
      created_at TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miaoshou_events_task ON miaoshou_task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_miaoshou_events_created ON miaoshou_task_events(created_at);
  `);

  function persist() {
    writeFileSync(dbPath, Buffer.from(db.export()));
  }

  function eventId(taskId, now) {
    return `mse_${taskId}_${now.replace(/\D/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function addEvent(taskId, type, status, message = "", code = "", details = {}, { shouldPersist = true } = {}) {
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO miaoshou_task_events
        (id, task_id, event_type, status, message, code, created_at, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [eventId(taskId, now), taskId, type, status || "", message || "", code || "", now, JSON.stringify(details || {})],
    );
    if (shouldPersist) persist();
  }

  function getTask(id) {
    return taskFromRow(first(db, "SELECT * FROM miaoshou_tasks WHERE id = ?", [String(id || "")]));
  }

  function getByPackageId(opOrderPackageId) {
    return taskFromRow(first(db, "SELECT * FROM miaoshou_tasks WHERE op_order_package_id = ?", [String(opOrderPackageId || "")]));
  }

  function upsertPending(packageRow, shop = {}) {
    const opOrderPackageId = packageId(packageRow);
    if (!opOrderPackageId) throw new Error("妙手包裹缺少 opOrderPackageId");
    const existing = getByPackageId(opOrderPackageId);
    const now = new Date().toISOString();
    const id = existing?.id || `ms_${opOrderPackageId}`;
    db.run(
      `INSERT INTO miaoshou_tasks (
        id, op_order_package_id, shop_id, shop_name, platform, site, app_package_no,
        platform_order_sn, status, tracking_no, head_tracking_no, logistics_type,
        waybill_url, error_code, error_message, attempts, first_seen_at, last_attempt_at,
        completed_at, updated_at, package_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', '', '', '', '', 0, ?, '', '', ?, ?)
      ON CONFLICT(op_order_package_id) DO UPDATE SET
        shop_id = excluded.shop_id,
        shop_name = excluded.shop_name,
        platform = excluded.platform,
        site = excluded.site,
        app_package_no = excluded.app_package_no,
        platform_order_sn = excluded.platform_order_sn,
        updated_at = excluded.updated_at,
        package_json = excluded.package_json`,
      [
        id,
        opOrderPackageId,
        packageField(packageRow, "shopId") || String(shop.shopId || ""),
        packageField(packageRow, "shopName", "shopNick") || String(shop.shopName || shop.platformShopName || ""),
        packageField(packageRow, "platform") || String(shop.platform || ""),
        packageField(packageRow, "site") || String(shop.site || ""),
        packageField(packageRow, "appPackageNo", "platformPackageNo"),
        packageField(packageRow, "platformOrderSn", "platformOrderSns"),
        now,
        now,
        JSON.stringify(safePackageSnapshot(packageRow)),
      ],
    );
    if (!existing) addEvent(id, "discovered", "pending", "发现待申请运单号包裹", "", {}, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function markRunning(id) {
    const now = new Date().toISOString();
    db.run(
      `UPDATE miaoshou_tasks SET status = 'running', attempts = attempts + 1,
       last_attempt_at = ?, updated_at = ?, error_code = '', error_message = '' WHERE id = ?`,
      [now, now, id],
    );
    addEvent(id, "apply_started", "running", "开始申请运单号", "", {}, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function markSuccess(id, result = {}) {
    const now = new Date().toISOString();
    db.run(
      `UPDATE miaoshou_tasks SET status = 'succeeded', tracking_no = ?, head_tracking_no = ?,
       logistics_type = ?, error_code = '', error_message = '', completed_at = ?, updated_at = ? WHERE id = ?`,
      [result.trackingNo || "", result.headTrackingNo || "", result.logisticsType || "", now, now, id],
    );
    addEvent(id, "apply_succeeded", "succeeded", `运单号申请成功${result.trackingNo ? `：${result.trackingNo}` : ""}`, "", result, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function markFailure(id, { status = "manual_check", code = "", message = "申请失败", details = {} } = {}) {
    const safeStatus = status === "retry_wait" ? "retry_wait" : "manual_check";
    const now = new Date().toISOString();
    db.run(
      `UPDATE miaoshou_tasks SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      [safeStatus, String(code || ""), String(message || ""), now, id],
    );
    addEvent(id, "apply_failed", safeStatus, message, code, details, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function markWaybill(id, url) {
    const now = new Date().toISOString();
    db.run("UPDATE miaoshou_tasks SET waybill_url = ?, updated_at = ? WHERE id = ?", [String(url || ""), now, id]);
    addEvent(id, "waybill_ready", "succeeded", "面单链接已获取", "", { url: String(url || "") }, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function resetForRetry(id) {
    const task = getTask(id);
    if (!task) throw new Error("未找到妙手运单任务");
    if (task.status === "succeeded") throw new Error("该包裹已经申请成功，不能重复申请");
    const now = new Date().toISOString();
    db.run("UPDATE miaoshou_tasks SET status = 'pending', error_code = '', error_message = '', updated_at = ? WHERE id = ?", [now, id]);
    addEvent(id, "manual_retry", "pending", "管理员确认重新申请", "", {}, { shouldPersist: false });
    persist();
    return getTask(id);
  }

  function listTasks({ limit = 100, status = "", shopId = "" } = {}) {
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push("status = ?");
      params.push(status);
    }
    if (shopId) {
      clauses.push("shop_id = ?");
      params.push(shopId);
    }
    params.push(Math.max(1, Math.min(500, Number(limit || 100))));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return all(db, `SELECT * FROM miaoshou_tasks ${where} ORDER BY updated_at DESC LIMIT ?`, params).map(taskFromRow);
  }

  function listEvents(limit = 100) {
    return all(db, "SELECT * FROM miaoshou_task_events ORDER BY created_at DESC LIMIT ?", [Math.max(1, Math.min(500, Number(limit || 100)))]).map(eventFromRow);
  }

  function counts() {
    const grouped = Object.fromEntries(all(db, "SELECT status, COUNT(*) AS count FROM miaoshou_tasks GROUP BY status").map((row) => [row.status, Number(row.count || 0)]));
    return {
      total: Object.values(grouped).reduce((sum, value) => sum + value, 0),
      pending: grouped.pending || 0,
      running: grouped.running || 0,
      succeeded: grouped.succeeded || 0,
      retryWait: grouped.retry_wait || 0,
      manualCheck: grouped.manual_check || 0,
    };
  }

  const interrupted = all(db, "SELECT id FROM miaoshou_tasks WHERE status = 'running'");
  if (interrupted.length) {
    const now = new Date().toISOString();
    db.run(
      "UPDATE miaoshou_tasks SET status = 'manual_check', error_code = 'interrupted', error_message = '服务重启时任务正在申请，请先在妙手核实运单号', updated_at = ? WHERE status = 'running'",
      [now],
    );
    interrupted.forEach(({ id }) => addEvent(id, "interrupted", "manual_check", "服务重启，需人工核实是否已经生成运单号", "interrupted", {}, { shouldPersist: false }));
  }
  persist();

  return {
    addEvent,
    counts,
    dbPath,
    getByPackageId,
    getTask,
    listEvents,
    listTasks,
    markFailure,
    markRunning,
    markSuccess,
    markWaybill,
    persist,
    resetForRetry,
    upsertPending,
  };
}

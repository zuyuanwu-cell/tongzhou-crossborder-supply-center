// 采集中心：管理部署在各台（云）电脑上的同舟智数采集节点。
// - 节点用中台账号配对后拿到独立令牌（服务器只保存哈希），可单独停用；
// - 节点每分钟心跳：上报状态、领取采集计划和待执行命令；
// - 节点回传每次采集的运行记录与日志，中台可查看、重试、立即采集。
// 数据量很小（节点个位数~几十），用 JSON 文件持久化，写入做防抖与原子替换。

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const COLLECTOR_ONLINE_WINDOW_MS = 3 * 60 * 1000;
const MAX_RUNS_PER_NODE = 200;
const MAX_LOGS_PER_NODE = 3000;
const MAX_COMMANDS_PER_NODE = 100;
const COMMAND_EXPIRE_MS = 24 * 60 * 60 * 1000;
const COMMAND_TYPES = new Set(["collect", "refresh-stores"]);

function text(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export function normalizeSchedule(input = {}, fallback = {}) {
  const base = { enabled: false, times: ["09:30"], lookbackDays: 3, ...fallback };
  const times = Array.isArray(input.times)
    ? input.times.map((time) => text(time, 5)).filter((time) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(time)).map((time) => time.padStart(5, "0"))
    : base.times;
  const lookback = Number(input.lookbackDays ?? base.lookbackDays);
  return {
    enabled: input.enabled === undefined ? Boolean(base.enabled) : Boolean(input.enabled),
    times: [...new Set(times)].sort().slice(0, 12),
    lookbackDays: Number.isFinite(lookback) ? Math.min(31, Math.max(1, Math.round(lookback))) : 3,
  };
}

function sanitizeStores(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 500).map((store) => ({
    storeId: text(store.storeId, 40),
    storeName: text(store.storeName, 120),
    platform: text(store.platform, 40),
    site: text(store.site, 8),
    enabled: store.enabled !== false,
    shopName: text(store.shopName, 160),
    shopKey: text(store.shopKey, 200),
    matched: Boolean(store.matched),
    lastStatus: text(store.lastStatus, 20),
    lastMessage: text(store.lastMessage, 300),
  })).filter((store) => store.storeId);
}

function sanitizeRun(run = {}) {
  const stores = Array.isArray(run.stores) ? run.stores.slice(0, 500).map((store) => ({
    storeId: text(store.storeId, 40),
    storeName: text(store.storeName, 120),
    status: text(store.status, 20),
    message: text(store.message, 500),
    rowCount: Number(store.rowCount) || 0,
  })) : [];
  const issues = Array.isArray(run.issues) ? run.issues.slice(0, 300).map((issue) => ({
    level: issue.level === "error" ? "error" : "warn",
    storeName: text(issue.storeName, 120),
    shopName: text(issue.shopName, 160),
    date: isDate(issue.date) ? issue.date : "",
    message: text(issue.message, 500),
  })) : [];
  const upload = run.upload && typeof run.upload === "object" ? {
    ok: Boolean(run.upload.ok),
    dryRun: Boolean(run.upload.dryRun),
    rowCount: Number(run.upload.rowCount) || 0,
    written: Number(run.upload.written) || 0,
    shopCount: Number(run.upload.shopCount) || 0,
    message: text(run.upload.message, 500),
  } : null;
  return {
    id: text(run.id, 80),
    trigger: text(run.trigger, 20) || "manual",
    mode: text(run.mode, 20) || "upload",
    status: text(run.status, 20) || "running",
    startedAt: text(run.startedAt, 40),
    finishedAt: text(run.finishedAt, 40),
    dates: Array.isArray(run.dates) ? run.dates.filter(isDate).slice(0, 62) : [],
    rowCount: Number(run.rowCount) || 0,
    commandId: text(run.commandId, 80),
    stores,
    issues,
    upload,
  };
}

function emptyState() {
  return { version: 1, nodes: {} };
}

export function createCollectorCenter({ filePath, now = () => Date.now(), saveDelayMs = 400 } = {}) {
  let state = emptyState();
  if (filePath && existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed.nodes === "object") state = { ...emptyState(), ...parsed };
    } catch (error) {
      console.error("[collector-center] failed to read state, starting empty", error);
    }
  }
  let saveTimer = null;

  function saveNow() {
    if (!filePath) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    mkdirSync(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, filePath);
  }

  function scheduleSave() {
    if (!filePath || saveTimer) return;
    saveTimer = setTimeout(() => {
      try {
        saveNow();
      } catch (error) {
        console.error("[collector-center] save failed", error);
      }
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  function nodeOrThrow(nodeId) {
    const node = state.nodes[nodeId];
    if (!node) {
      const error = new Error("采集节点不存在。");
      error.statusCode = 404;
      throw error;
    }
    return node;
  }

  function isoNow() {
    return new Date(now()).toISOString();
  }

  function expireCommands(node) {
    const cutoff = now() - COMMAND_EXPIRE_MS;
    for (const command of node.commands) {
      if ((command.status === "pending" || command.status === "delivered") && Date.parse(command.createdAt) < cutoff) {
        command.status = "expired";
        command.finishedAt = isoNow();
      }
    }
    if (node.commands.length > MAX_COMMANDS_PER_NODE) node.commands = node.commands.slice(-MAX_COMMANDS_PER_NODE);
  }

  function publicNode(node, { detail = false } = {}) {
    const lastSeen = Date.parse(node.lastSeenAt || "") || 0;
    const online = !node.disabled && lastSeen > 0 && now() - lastSeen < COLLECTOR_ONLINE_WINDOW_MS;
    const lastRun = node.runs[node.runs.length - 1] || null;
    const stores = node.status?.stores || [];
    return {
      id: node.id,
      name: node.name,
      hostname: node.hostname,
      platforms: node.platforms,
      version: node.version,
      disabled: Boolean(node.disabled),
      pairedBy: node.pairedBy,
      pairedAt: node.pairedAt,
      lastSeenAt: node.lastSeenAt || "",
      online,
      schedule: node.schedule,
      running: Boolean(node.status?.running),
      currentRun: node.status?.currentRun || null,
      health: node.status?.health || null,
      storeCount: stores.length,
      enabledStoreCount: stores.filter((store) => store.enabled).length,
      unmatchedStoreCount: stores.filter((store) => store.enabled && !store.matched).length,
      nextRunAt: node.status?.nextRunAt || "",
      lastRun: lastRun ? {
        id: lastRun.id,
        status: lastRun.status,
        trigger: lastRun.trigger,
        startedAt: lastRun.startedAt,
        finishedAt: lastRun.finishedAt,
        rowCount: lastRun.rowCount,
        failedStores: lastRun.stores.filter((store) => store.status === "failed").length,
        storeCount: lastRun.stores.length,
        upload: lastRun.upload,
      } : null,
      pendingCommands: node.commands.filter((command) => command.status === "pending" || command.status === "delivered").length,
      ...(detail ? {
        stores,
        commands: node.commands.slice(-30).reverse(),
      } : {}),
    };
  }

  return {
    filePath,

    flush() {
      saveNow();
    },

    pairNode({ nodeId = "", name = "", hostname = "", platforms = [], version = "", pairedBy = "" } = {}) {
      const token = `tzcn_${randomBytes(24).toString("hex")}`;
      const existing = nodeId && state.nodes[nodeId] ? state.nodes[nodeId] : null;
      const id = existing ? existing.id : newId("node");
      const node = existing || {
        id,
        name: text(name, 60) || text(hostname, 60) || "采集节点",
        hostname: text(hostname, 120),
        platforms: [],
        version: "",
        schedule: normalizeSchedule({}),
        pairedAt: isoNow(),
        pairedBy: "",
        lastSeenAt: "",
        disabled: false,
        status: null,
        runs: [],
        logs: [],
        logSeq: 0,
        commands: [],
      };
      node.tokenHash = hashToken(token);
      node.hostname = text(hostname, 120) || node.hostname;
      node.platforms = Array.isArray(platforms) ? platforms.map((item) => text(item, 30)).filter(Boolean).slice(0, 10) : node.platforms;
      node.version = text(version, 30) || node.version;
      node.pairedBy = text(pairedBy, 80);
      node.pairedAt = isoNow();
      node.disabled = false;
      if (!existing && name) node.name = text(name, 60);
      state.nodes[id] = node;
      saveNow();
      return { node: publicNode(node), token };
    },

    authenticate(token) {
      const raw = String(token || "").trim();
      if (!raw.startsWith("tzcn_")) return null;
      const actual = Buffer.from(hashToken(raw));
      for (const node of Object.values(state.nodes)) {
        if (node.disabled || !node.tokenHash) continue;
        const expected = Buffer.from(node.tokenHash);
        if (expected.length === actual.length && timingSafeEqual(expected, actual)) return node;
      }
      return null;
    },

    heartbeat(nodeId, payload = {}) {
      const node = nodeOrThrow(nodeId);
      node.lastSeenAt = isoNow();
      node.version = text(payload.version, 30) || node.version;
      node.hostname = text(payload.hostname, 120) || node.hostname;
      if (Array.isArray(payload.platforms)) node.platforms = payload.platforms.map((item) => text(item, 30)).filter(Boolean).slice(0, 10);
      node.status = {
        running: Boolean(payload.running),
        currentRun: payload.currentRun && typeof payload.currentRun === "object" ? {
          id: text(payload.currentRun.id, 80),
          startedAt: text(payload.currentRun.startedAt, 40),
          progress: text(payload.currentRun.progress, 200),
        } : null,
        health: payload.health && typeof payload.health === "object" ? {
          ziniaoCli: Boolean(payload.health.ziniaoCli),
          ziniaoMessage: text(payload.health.ziniaoMessage, 300),
          zhongtai: payload.health.zhongtai !== false,
        } : null,
        stores: sanitizeStores(payload.stores),
        nextRunAt: text(payload.nextRunAt, 40),
      };
      // 节点第一次上报时，用它本地的计划初始化中台计划（之后以中台为准）。
      if (!node.scheduleInitialized && payload.localSchedule) {
        node.schedule = normalizeSchedule(payload.localSchedule, node.schedule);
        node.scheduleInitialized = true;
      }
      expireCommands(node);
      const commands = node.commands.filter((command) => command.status === "pending");
      for (const command of commands) {
        command.status = "delivered";
        command.deliveredAt = isoNow();
      }
      scheduleSave();
      return {
        node: { id: node.id, name: node.name },
        schedule: node.schedule,
        commands: commands.map(({ id, type, storeIds, dates, mode, fromRunId }) => ({ id, type, storeIds, dates, mode, fromRunId })),
        serverTime: isoNow(),
      };
    },

    recordRun(nodeId, run) {
      const node = nodeOrThrow(nodeId);
      const clean = sanitizeRun(run);
      if (!clean.id) {
        const error = new Error("运行记录缺少 id。");
        error.statusCode = 400;
        throw error;
      }
      const index = node.runs.findIndex((item) => item.id === clean.id);
      clean.receivedAt = isoNow();
      if (index >= 0) node.runs[index] = clean;
      else node.runs.push(clean);
      if (node.runs.length > MAX_RUNS_PER_NODE) node.runs = node.runs.slice(-MAX_RUNS_PER_NODE);
      if (clean.commandId) {
        const command = node.commands.find((item) => item.id === clean.commandId);
        if (command) {
          command.runId = clean.id;
          if (clean.finishedAt) {
            command.status = clean.status === "failed" ? "failed" : "done";
            command.finishedAt = clean.finishedAt;
          } else {
            command.status = "running";
          }
        }
      }
      scheduleSave();
      return clean;
    },

    appendLogs(nodeId, lines = []) {
      const node = nodeOrThrow(nodeId);
      const list = Array.isArray(lines) ? lines.slice(-500) : [];
      for (const line of list) {
        node.logSeq = (node.logSeq || 0) + 1;
        node.logs.push({
          seq: node.logSeq,
          at: text(line.at, 40) || isoNow(),
          level: ["error", "warn", "info"].includes(line.level) ? line.level : "info",
          message: text(line.message, 1000),
        });
      }
      if (node.logs.length > MAX_LOGS_PER_NODE) node.logs = node.logs.slice(-MAX_LOGS_PER_NODE);
      scheduleSave();
      return { accepted: list.length, lastSeq: node.logSeq };
    },

    ackCommand(nodeId, commandId, { status = "done", message = "", runId = "" } = {}) {
      const node = nodeOrThrow(nodeId);
      const command = node.commands.find((item) => item.id === commandId);
      if (!command) return null;
      command.status = ["running", "done", "failed", "rejected"].includes(status) ? status : "done";
      command.message = text(message, 500);
      if (runId) command.runId = text(runId, 80);
      if (command.status !== "running") command.finishedAt = isoNow();
      scheduleSave();
      return command;
    },

    listNodes() {
      return Object.values(state.nodes)
        .map((node) => publicNode(node))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "zh-CN"));
    },

    getNode(nodeId) {
      return publicNode(nodeOrThrow(nodeId), { detail: true });
    },

    updateNode(nodeId, patch = {}) {
      const node = nodeOrThrow(nodeId);
      if (patch.name !== undefined) node.name = text(patch.name, 60) || node.name;
      if (patch.disabled !== undefined) node.disabled = Boolean(patch.disabled);
      if (patch.schedule) {
        node.schedule = normalizeSchedule(patch.schedule, node.schedule);
        node.scheduleInitialized = true;
      }
      saveNow();
      return publicNode(node, { detail: true });
    },

    removeNode(nodeId) {
      nodeOrThrow(nodeId);
      delete state.nodes[nodeId];
      saveNow();
      return true;
    },

    createCommand(nodeId, { type = "collect", storeIds = null, dates = null, mode = "upload", fromRunId = "", createdBy = "" } = {}) {
      const node = nodeOrThrow(nodeId);
      if (!COMMAND_TYPES.has(type)) {
        const error = new Error("不支持的命令。");
        error.statusCode = 400;
        throw error;
      }
      if (node.disabled) {
        const error = new Error("节点已停用。");
        error.statusCode = 409;
        throw error;
      }
      const command = {
        id: newId("cmd"),
        type,
        storeIds: Array.isArray(storeIds) && storeIds.length ? storeIds.map((id) => text(id, 40)).filter(Boolean).slice(0, 500) : null,
        dates: Array.isArray(dates) && dates.length ? dates.filter(isDate).slice(0, 62) : null,
        mode: mode === "preview" ? "preview" : "upload",
        fromRunId: text(fromRunId, 80),
        createdBy: text(createdBy, 80),
        createdAt: isoNow(),
        status: "pending",
      };
      node.commands.push(command);
      expireCommands(node);
      saveNow();
      return command;
    },

    /** 重试某次运行里失败（或部分失败）的店铺，日期沿用那次运行。 */
    retryRun(nodeId, runId, { createdBy = "", storeIds = null } = {}) {
      const node = nodeOrThrow(nodeId);
      const run = node.runs.find((item) => item.id === runId);
      if (!run) {
        const error = new Error("运行记录不存在。");
        error.statusCode = 404;
        throw error;
      }
      const targets = Array.isArray(storeIds) && storeIds.length
        ? storeIds
        : run.stores.filter((store) => store.status === "failed" || store.status === "partial").map((store) => store.storeId);
      if (!targets.length) {
        const error = new Error("这次采集没有失败的店铺。");
        error.statusCode = 400;
        throw error;
      }
      return this.createCommand(nodeId, { type: "collect", storeIds: targets, dates: run.dates, mode: run.mode === "preview" ? "preview" : "upload", fromRunId: runId, createdBy });
    },

    getRuns(nodeId, { limit = 50 } = {}) {
      const node = nodeOrThrow(nodeId);
      return node.runs.slice(-Math.min(200, Math.max(1, limit))).reverse();
    },

    getLogs(nodeId, { afterSeq = 0, limit = 500 } = {}) {
      const node = nodeOrThrow(nodeId);
      const after = Number(afterSeq) || 0;
      const lines = node.logs.filter((line) => line.seq > after);
      return { lines: lines.slice(-Math.min(2000, Math.max(1, limit))), lastSeq: node.logSeq || 0 };
    },
  };
}

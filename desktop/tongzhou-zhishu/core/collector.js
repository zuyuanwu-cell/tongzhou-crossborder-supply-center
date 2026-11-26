"use strict";

// 采集编排：校准（探测接口 → 生成模板 → 试采）与正式采集（逐店铺打开紫鸟 → 页面内重放接口 → 取值 → 回写中台）。

const crypto = require("node:crypto");
const { getPlatform, guessPlatform, allTemplates } = require("./platforms");
const { hookBody, probeBody, pageInfoBody, replayBody, orderReportBody, loginRecoveryBody, pageCheckBody, restoreOrderTypeBody } = require("./page-scripts");
const { templatizeRequest, flattenNumbers, suggestMetrics, extractMetrics, mappingParts, fillRequest, placeholderValues, validateTemplate, METRIC_KEYS } = require("./recipe");
const { comparePageCheck, evidenceEndpoint, pageDateText } = require("./quality");
const { siteInfo, siteToday, addDays, dateList } = require("./sites");
const { newId } = require("./config");
const { ORDER_REPORT_LOOKBACK_DAYS, emptyDay, orderReportWindows, parseShopeeOrderReport } = require("./shopee-order-report");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadRetryDelay(attempts) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
  return schedule[Math.min(Math.max(0, Number(attempts || 1) - 1), schedule.length - 1)];
}

function publicUploadRow(row) {
  const result = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (!key.startsWith("_") && value !== undefined) result[key] = value;
  }
  return result;
}

function collectionCheckpointKey({ storeId = "", targetId = "", country = "", date = "" } = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify([String(storeId), String(targetId), String(country), String(date)]))
    .digest("hex");
}

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function errorDetails(error) {
  const chain = errorChain(error);
  return {
    codes: chain.map((item) => String(item?.code || "").toUpperCase()).filter(Boolean),
    message: chain.map((item) => String(item?.message || item || "")).filter(Boolean).join(" | "),
  };
}

function isBrowserSessionError(error) {
  const { codes, message } = errorDetails(error);
  return codes.some((code) => [
    "CDP_ERROR",
    "PAGE_RELOADED",
    "ZCLAW_TIMEOUT",
    "ENAMETOOLONG",
    "E2BIG",
    "COMMAND_LINE_TOO_LONG",
    "PAGE_NOT_READY",
  ].includes(code))
    || /ENAMETOOLONG|E2BIG|CDP|Browser automation failed|ZClaw 工具调用失败\s*\[-1\]\s*:\s*Uncaught|about:blank|页面.*刷新|页面.*跳转|navigation|session closed/i.test(message);
}

function isTransientPageProbeError(error) {
  const { codes, message } = errorDetails(error);
  if (codes.includes("CANCELLED") || codes.some((code) => ["ENAMETOOLONG", "E2BIG", "COMMAND_LINE_TOO_LONG"].includes(code))) return false;
  return isBrowserSessionError(error)
    || codes.some((code) => ["PAGE_SCRIPT_ERROR", "TIMEOUT", "ETIMEDOUT"].includes(code))
    || /timed?\s*out|请求超时/i.test(message);
}

function classifyFailure(error) {
  const { codes, message } = errorDetails(error);
  if (codes.includes("STORE_MAPPING_REQUIRED") || /mapping|required.*shop|店铺.*映射|映射.*店铺/i.test(message)) return "mapping";
  // 业务脚本抛出的 429 也可能被 ZClaw 包成 PAGE_SCRIPT_ERROR，必须优先进入全局限流熔断。
  if (codes.includes("SHOPEE_RATE_LIMIT") || /HTTP\s*429|rate.?limit|限流/i.test(message)) return "rate_limit";
  // 浏览器/CDP 断流不能因为外层错误文字带有“未登录”而被归到账号问题。
  if (isBrowserSessionError(error)) return "browser_session";
  if (codes.includes("NOT_LOGGED_IN") || /not logged|未登录|登录失效/i.test(message)) return "login";
  if (codes.includes("CAPTCHA") || /captcha|验证码|二次验证|mfa/i.test(message)) return "manual_verification";
  if (/报表|表头|header|schema|字段.*缺失/i.test(message)) return "report_schema";
  if (/UPLOAD_|写入中台|upload|fetch failed|ECONN|ETIMEDOUT|timeout|network/i.test(`${codes.join(" ")} ${message}`)) return "upload_network";
  return "unknown";
}

function shopeeRateLimitDetails(error) {
  const message = String(error?.message || error || "");
  const marked = /SHOPEE_RATE_LIMIT\|(\d+)\|([^\r\n]*)/i.exec(message);
  if (marked) return { limited: true, retryAfterMs: Math.max(0, Number(marked[1]) || 0), message: marked[2] || "Shopee 订单报表接口限流。" };
  if (/Shopee[^\r\n]{0,80}(?:HTTP\s*429|接口限流)|HTTP\s*429/i.test(message)) {
    return { limited: true, retryAfterMs: 0, message: "Shopee 订单报表接口限流。" };
  }
  return { limited: false, retryAfterMs: 0, message };
}

function shopeeRateLimitCooldown(strikes, retryAfterMs = 0, {
  schedule = [15 * 60_000, 30 * 60_000, 60 * 60_000],
  jitterMinMs = 20_000,
  jitterMaxMs = 45_000,
  random = Math.random,
} = {}) {
  const safeSchedule = Array.isArray(schedule) && schedule.length ? schedule : [15 * 60_000, 30 * 60_000, 60 * 60_000];
  const index = Math.min(Math.max(1, Number(strikes) || 1) - 1, safeSchedule.length - 1);
  const min = Math.max(0, Number(jitterMinMs) || 0);
  const max = Math.max(min, Number(jitterMaxMs) || min);
  const jitter = min + Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * (max - min + 1));
  return Math.max(0, Number(retryAfterMs) || 0, Number(safeSchedule[index]) || 0) + jitter;
}

function shopeeReportGap({
  minMs = 20_000,
  maxMs = 45_000,
  random = Math.random,
} = {}) {
  const min = Math.max(0, Number(minMs) || 0);
  const max = Math.max(min, Number(maxMs) || min);
  const ratio = Math.max(0, Math.min(1, Number(random()) || 0));
  return min + Math.floor(ratio * (max - min));
}

function parseJson(textValue) {
  try {
    return JSON.parse(textValue);
  } catch {
    return null;
  }
}

const DEFAULT_REPLAY_BATCH_REQUESTS = 12;
const DEFAULT_REPLAY_SCRIPT_CHARS = 12000;

function isCommandLineTooLong(error) {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  const message = String(error?.message || "");
  return ["ENAMETOOLONG", "E2BIG", "COMMAND_LINE_TOO_LONG"].includes(code)
    || /ENAMETOOLONG|E2BIG|command line.{0,30}(too long|过长)|参数.{0,20}过长/i.test(message);
}

function replayRequestTooLarge(request, scriptLength, maxScriptChars) {
  const error = new Error(`单个采集接口脚本过长（${scriptLength} 字符，上限 ${maxScriptChars}），请检查采集模板`);
  error.code = "REPLAY_REQUEST_TOO_LARGE";
  error.requestKey = request?.key || "";
  error.retryable = false;
  return error;
}

/**
 * 页面重放脚本最终会作为 Windows 命令行参数交给紫鸟 CLI。
 * 同时限制接口数量和脚本字符数，避免还没进入店铺页面就触发 ENAMETOOLONG。
 */
function buildReplayBatches(requests, {
  maxRequests = DEFAULT_REPLAY_BATCH_REQUESTS,
  maxScriptChars = DEFAULT_REPLAY_SCRIPT_CHARS,
} = {}) {
  const batches = [];
  let current = [];
  for (const request of requests || []) {
    const candidate = [...current, request];
    const candidateLength = replayBody(candidate).length;
    if (current.length && (candidate.length > maxRequests || candidateLength > maxScriptChars)) {
      batches.push(current);
      current = [request];
      const singleLength = replayBody(current).length;
      if (singleLength > maxScriptChars) throw replayRequestTooLarge(request, singleLength, maxScriptChars);
    } else {
      current = candidate;
      if (current.length === 1 && candidateLength > maxScriptChars) {
        throw replayRequestTooLarge(request, candidateLength, maxScriptChars);
      }
    }
  }
  if (current.length) batches.push(current);
  return batches;
}

/** 平台接口常见的「HTTP 200 但业务失败」结构。 */
function businessError(json) {
  if (!json || typeof json !== "object") return "";
  const code = json.code ?? json.err_code ?? json.errcode ?? json.error_code;
  if (code !== undefined && code !== null && ![0, "0", 200, "200", "success"].includes(code)) {
    return String(json.message || json.msg || json.err_msg || json.error_msg || `错误码 ${code}`);
  }
  if (typeof json.error === "string" && json.error && !/^(0|none|ok)$/i.test(json.error)) return json.message || json.error;
  if (typeof json.error === "number" && json.error !== 0) return json.message || json.msg || `错误码 ${json.error}`;
  return "";
}

/** 默认采集日期：最近 lookbackDays 个已结束的自然日（按站点时区），可选包含今天。 */
function defaultDates({ lookbackDays = 3, includeToday = false, site = "SG", now = Date.now() } = {}) {
  const today = siteToday(site, now);
  const to = includeToday ? today : addDays(today, -1);
  return dateList(addDays(to, -(Math.max(1, lookbackDays) - 1)), to);
}

function requestedDates(input, { maxDays = 366 } = {}) {
  if (input == null || (Array.isArray(input) && input.length === 0)) return null;
  if (!Array.isArray(input)) {
    const error = new Error("补采日期格式无效，请重新选择日期范围。");
    error.code = "INVALID_BACKFILL_DATES";
    error.retryable = false;
    throw error;
  }
  const dates = [...new Set(input.map((value) => String(value || "").trim()))].sort();
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const error = new Error(`补采日期“${date || "空值"}”格式无效。`);
      error.code = "INVALID_BACKFILL_DATES";
      error.retryable = false;
      throw error;
    }
    const [year, month, day] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      const error = new Error(`补采日期“${date}”不存在。`);
      error.code = "INVALID_BACKFILL_DATES";
      error.retryable = false;
      throw error;
    }
  }
  const spanDays = dates.length
    ? Math.round((Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86400000) + 1
    : 0;
  if (dates.length > maxDays || spanDays > maxDays) {
    const error = new Error(`单次历史补采最多 ${maxDays} 天，请缩短日期范围后重试。`);
    error.code = "BACKFILL_RANGE_TOO_LARGE";
    error.retryable = false;
    throw error;
  }
  return dates;
}

function validateBackfillScope(dates, plan) {
  if (!Array.isArray(dates) || dates.length <= 21) return;
  if (Array.isArray(plan) && plan.length === 1) return;
  const error = new Error(`超过 21 天的历史补采必须先选择单个紫鸟店铺；当前日期共 ${dates.length} 天。程序会在单店内按最多 7 天自动分片。`);
  error.code = "BACKFILL_SINGLE_STORE_REQUIRED";
  error.retryable = false;
  throw error;
}

class Collector {
  constructor({ cli, store, log = () => {}, zhongtaiFactory, waits = {}, imageEncoder = null, random = Math.random }) {
    this.cli = cli;
    // 截图压缩（Electron 主进程里用 nativeImage 转 JPEG）；返回 { mime, base64 } 或 null。
    this.imageEncoder = imageEncoder;
    this.waits = {
      fresh: 8000,
      reused: 4000,
      visit: 5000,
      retry: 5000,
      pageProbeRetry: 1000,
      pageProbeAttempts: 3,
      pageReadyRetry: 2000,
      pageReadyAttempts: 20,
      // 正常页面（包括可自动处理的登录页）一次探测即可继续；仅当刚经历白屏
      // 或关闭遮挡弹窗时，waitForReadyPage 会额外要求连续两次稳定指纹。
      pageReadyStablePasses: 1,
      storeReconnectAttempts: 2,
      storeReconnectDelay: 1500,
      shopeeLogin: 8000,
      shopeeLoginPollRetry: 1500,
      shopeeLoginPollAttempts: 12,
      shopeeAutofillPollRetry: 1000,
      shopeeAutofillPollAttempts: 8,
      shopeeReportGapMin: 20_000,
      shopeeReportGapMax: 45_000,
      shopeeRateLimitSchedule: [15 * 60_000, 30 * 60_000, 60 * 60_000],
      shopeeRateLimitJitterMin: 20_000,
      shopeeRateLimitJitterMax: 45_000,
      shopeeReportRetries: 1,
      ...waits,
    };
    this.store = store;
    this.log = log;
    this.zhongtaiFactory = zhongtaiFactory;
    this.discoveries = new Map();
    this.running = null;
    this.cancelRequested = false;
    this.shopeeRateLimitUntil = 0;
    this.shopeeRateLimitStrikes = 0;
    this.shopeeLastReportAt = 0;
    this.shopeeNextReportGapMs = 0;
    this.random = typeof random === "function" ? random : Math.random;
    this.uploadFlushPromise = null;
  }

  config() {
    return this.store.get();
  }

  uploadJobId(runId) {
    return `upload:${runId}`;
  }

  baseRunStatus(run) {
    const stores = Array.isArray(run?.stores) ? run.stores : [];
    const failed = stores.filter((item) => item.status === "failed").length;
    if (run?.status === "cancelled") return "cancelled";
    if (failed && failed === stores.length) return "failed";
    if (failed || (run?.issues || []).some((issue) => issue.level === "error")) return "partial";
    return "ok";
  }

  queueUpload(runId, { source = "ziniao" } = {}) {
    if (!this.store.resultRows(runId).length) throw new Error("No persisted rows are available for upload");
    const job = this.store.upsertUploadJob({
      id: this.uploadJobId(runId),
      runId,
      source,
      status: "queued",
      nextAttemptAt: new Date().toISOString(),
      lastError: "",
    });
    const upload = {
      ok: false,
      queued: true,
      attempts: Number(job.attempts || 0),
      message: "Data is safely stored locally and queued for upload",
      at: new Date().toISOString(),
    };
    this.store.updateHistory(runId, { upload, status: "upload_queued" });
    return job;
  }

  async attemptUploadJob(inputJob, { force = false, throwOnError = false } = {}) {
    let job = this.store.uploadOutbox().find((item) => item.id === inputJob?.id) || inputJob;
    if (!job?.runId) throw new Error("Invalid upload job");
    if (!force && job.status === "needs_attention") return null;
    if (!force && job.nextAttemptAt && Date.parse(job.nextAttemptAt) > Date.now()) return null;
    const persistedRows = this.store.resultRows(job.runId);
    const rows = persistedRows.map(publicUploadRow);
    if (!persistedRows.length) {
      this.store.removeUploadJob(job.id);
      const error = new Error("Persisted upload rows are missing");
      this.store.updateHistory(job.runId, { upload: { ok: false, queued: false, message: error.message, at: new Date().toISOString() }, status: "upload_failed" });
      if (throwOnError) throw error;
      return { ok: false, queued: false, message: error.message };
    }

    const attempt = Number(job.attempts || 0) + 1;
    job = this.store.upsertUploadJob({
      ...job,
      attempts: attempt,
      status: "uploading",
      lastAttemptAt: new Date().toISOString(),
    });
    this.store.updateHistory(job.runId, {
      upload: { ok: false, queued: true, uploading: true, attempts: attempt, message: `Uploading ${rows.length} persisted rows`, at: new Date().toISOString() },
      status: "uploading",
    });

    try {
      const result = await this.zhongtaiFactory().ingest(rows, { dryRun: false, runId: job.runId });
      const errors = Array.isArray(result.errors) ? result.errors : [];
      const acceptedRows = Number(result.rowCount);
      if (errors.length) {
        const error = new Error(`中台拒绝了 ${errors.length} 条数据，请先处理映射或字段错误后重试`);
        error.code = "UPLOAD_ROW_ERRORS";
        error.retryable = false;
        error.details = errors.slice(0, 50);
        throw error;
      }
      if (Number.isFinite(acceptedRows) && acceptedRows < rows.length) {
        const error = new Error(`中台仅确认 ${acceptedRows}/${rows.length} 条数据，已保留本地队列等待处理`);
        error.code = "UPLOAD_INCOMPLETE";
        error.retryable = false;
        throw error;
      }
      const checkpoints = persistedRows
        .filter((row) => row?._checkpointKey)
        .map((row) => ({
          key: row._checkpointKey,
          storeId: row._storeId || "",
          storeName: row._store || "",
          targetId: row._targetId || "",
          country: row._targetCountry || "",
          date: row.date || "",
          runId: job.runId,
        }));
      this.store.markCollectionCheckpoints(checkpoints);
      const upload = {
        ok: true,
        queued: false,
        attempts: attempt,
        rowCount: result.rowCount,
        written: result.written,
        shopCount: result.shopCount,
        errors: [],
        warnings: (result.warnings || []).slice(0, 50),
        checkpointCount: checkpoints.length,
        at: new Date().toISOString(),
      };
      this.store.removeUploadJob(job.id);
      const run = (this.store.history() || []).find((item) => item.id === job.runId);
      this.store.updateHistory(job.runId, { upload, status: this.baseRunStatus(run) });
      return upload;
    } catch (error) {
      const retryable = error.retryable !== false;
      const nextAttemptAt = retryable ? new Date(Date.now() + uploadRetryDelay(attempt)).toISOString() : "";
      const failureCategory = classifyFailure(error);
      this.store.upsertUploadJob({
        ...job,
        status: retryable ? "retry_wait" : "needs_attention",
        nextAttemptAt,
        lastError: error.message,
        lastStatus: Number(error.status || 0),
        failureCategory,
        details: Array.isArray(error.details) ? error.details : [],
      });
      const upload = {
        ok: false,
        queued: true,
        needsAttention: !retryable,
        attempts: attempt,
        message: error.message,
        status: Number(error.status || 0),
        nextAttemptAt,
        failureCategory,
        errors: Array.isArray(error.details) ? error.details : [],
        at: new Date().toISOString(),
      };
      this.store.updateHistory(job.runId, { upload, status: retryable ? "upload_failed" : "needs_attention" });
      if (error.status === 401 && this.onUnauthorized) this.onUnauthorized();
      if (throwOnError) throw error;
      return upload;
    }
  }

  async flushUploadOutbox({ force = false } = {}) {
    if (this.uploadFlushPromise) return this.uploadFlushPromise;
    this.uploadFlushPromise = (async () => {
      const results = [];
      for (const job of this.store.uploadOutbox()) {
        const result = await this.attemptUploadJob(job, { force, throwOnError: false });
        if (result) results.push({ runId: job.runId, ...result });
      }
      return results;
    })();
    try {
      return await this.uploadFlushPromise;
    } finally {
      this.uploadFlushPromise = null;
    }
  }

  // -------------------------------------------------------------------------
  // 店铺
  // -------------------------------------------------------------------------

  async refreshStores({ attempts = 2, retryDelayMs = 5000, preserveCacheOnEmpty = true } = {}) {
    const previous = Array.isArray(this.config().storeCache) ? this.config().storeCache : [];
    const maxAttempts = Math.max(1, Math.round(Number(attempts) || 1));
    let stores = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      stores = await this.cli.listStores();
      if (stores.length) break;
      if (attempt < maxAttempts) {
        this.log("warn", `紫鸟暂未返回店铺，${Math.max(0, Number(retryDelayMs) || 0) / 1000} 秒后重试（${attempt}/${maxAttempts}）。`);
        await this.waitCancelable(Math.max(0, Number(retryDelayMs) || 0));
      }
    }

    const probedAt = new Date().toISOString();
    if (!stores.length && previous.length && preserveCacheOnEmpty) {
      this.store.update((config) => {
        config.storeCacheLastProbeAt = probedAt;
        config.storeCacheLastProbeStatus = "empty_preserved";
      });
      this.log("warn", `紫鸟连续 ${maxAttempts} 次返回 0 家店铺，已保留本地缓存的 ${previous.length} 家，避免清空可采集店铺；后续刷新成功后会自动更新。`);
      return previous;
    }

    this.store.update((config) => {
      config.storeCache = stores.map(({ raw, ...store }) => store);
      config.storeCacheAt = probedAt;
      config.storeCacheLastProbeAt = probedAt;
      config.storeCacheLastProbeStatus = stores.length ? "ok" : "empty";
    });
    return this.config().storeCache;
  }

  async openAt(storeId, url) {
    const { headless } = this.config().ziniao;
    const opened = await this.cli.openStore({ storeId, url, headless });
    const reused = Boolean(opened && (opened.reused || opened.isReused || opened.alreadyOpen));
    // SPA 页面加载后还会继续请求接口，稍等再操作。
    await sleep(reused ? this.waits.reused : this.waits.fresh);
    return { reused, opened };
  }

  async reopenCurrentStore(storeId, url) {
    const { headless } = this.config().ziniao;
    await this.cli.closeStore({ storeId });
    await this.waitCancelable(500);
    await this.cli.openStore({ storeId, url, headless });
    await this.waitCancelable(this.waits.fresh);
    return this.waitForReadyPage(storeId, url, { allowVisit: true });
  }

  async recoverStoreConnection(storeId, url, cause) {
    const maxAttempts = Math.max(1, Math.round(Number(this.waits.storeReconnectAttempts) || 1));
    let lastError = cause;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.log(
        "warn",
        `原页面自动化连接已失效，正在完全关闭并重新打开当前店铺（${attempt}/${maxAttempts}）：${lastError?.message || "连接中断"}`,
      );
      try {
        const info = await this.reopenCurrentStore(storeId, url);
        this.log("info", "已建立新的店铺页面连接，继续采集。");
        return info;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientPageProbeError(error)) throw error;
        await this.waitCancelable(Math.max(0, Number(this.waits.storeReconnectDelay) || 0) * attempt);
      }
    }
    throw lastError;
  }

  isPageReady(info) {
    const href = String(info?.href || "");
    return Boolean(href)
      && !/^about:blank(?:$|[?#])/i.test(href)
      && String(info?.ready || "complete").toLowerCase() !== "loading"
      && info?.visuallyBlank !== true
      && info?.busy !== true;
  }

  logDismissedObstructions(info) {
    const count = Math.max(0, Number(info?.dismissed) || 0);
    if (count) this.log("info", `已关闭 ${count} 个广告、公告或引导遮挡层，继续采集。`);
  }

  async waitForReadyPage(storeId, url, {
    attempts = this.waits.pageReadyAttempts,
    delayMs = this.waits.pageReadyRetry,
    allowVisit = false,
    initialInfo = null,
    stablePasses = this.waits.pageReadyStablePasses,
  } = {}) {
    const requiredPasses = Math.max(1, Math.round(Number(stablePasses) || 1));
    const maxAttempts = Math.max(requiredPasses, Math.round(Number(attempts) || 1));
    let info = null;
    let visited = false;
    let usedInitialInfo = false;
    let stableCount = 0;
    let stableFingerprint = "";
    let requireTransientConfirmation = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (!usedInitialInfo && initialInfo) {
        info = initialInfo;
        usedInitialInfo = true;
      } else {
        info = await this.readPageInfoWithRetry(storeId);
      }
      this.logDismissedObstructions(info);
      const ready = this.isPageReady(info);
      const dismissed = Math.max(0, Number(info?.dismissed) || 0) > 0;
      // 白屏恢复和弹窗关闭都可能只短暂露出一帧可用内容；这两种场景需要
      // 再连续确认两次相同页面。普通 loading -> 登录页则应立即进入自动登录，
      // 否则会因为登录页只出现一次而错过已保存密码的登录按钮。
      if (info?.visuallyBlank === true || dismissed) requireTransientConfirmation = true;
      const passesForCurrentState = requireTransientConfirmation
        ? Math.max(2, requiredPasses)
        : requiredPasses;
      const fingerprint = JSON.stringify([
        String(info?.href || ""),
        Boolean(info?.hasPassword),
        Boolean(info?.hasLoginControl),
        Boolean(info?.hasCaptcha),
      ]);
      if (!ready || dismissed) {
        stableCount = 0;
        stableFingerprint = "";
      } else if (fingerprint === stableFingerprint) {
        stableCount += 1;
      } else {
        stableFingerprint = fingerprint;
        stableCount = 1;
      }
      if (stableCount >= passesForCurrentState) return info;
      if (allowVisit && !visited && attempt >= Math.min(3, maxAttempts)) {
        visited = true;
        this.log("info", "店铺窗口仍为空白，正在重新导航到采集页面并等待加载完成。");
        await this.cli.visit({ storeId, url });
        stableCount = 0;
        stableFingerprint = "";
      }
      if (attempt < maxAttempts) await this.waitCancelable(delayMs);
    }
    const error = new Error(`店铺页面在等待后仍未加载完成：${info?.href || "空白页"}`);
    error.code = "PAGE_NOT_READY";
    throw error;
  }

  async readPageInfoWithRetry(storeId, {
    attempts = this.waits.pageProbeAttempts,
    delayMs = this.waits.pageProbeRetry,
  } = {}) {
    const maxAttempts = Math.max(1, Math.round(Number(attempts) || 1));
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.cli.runInPage(storeId, pageInfoBody(), { timeoutMs: 30000 });
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isTransientPageProbeError(error)) throw error;
        this.log("warn", `店铺页面连接瞬时中断，正在原位重新附着（${attempt}/${maxAttempts - 1}）：${error.message}`);
        await this.waitCancelable(delayMs);
      }
    }
    throw lastError;
  }

  async ensurePage(storeId, platform, url) {
    let info;
    try {
      info = await this.readPageInfoWithRetry(storeId);
    } catch (error) {
      if (!isTransientPageProbeError(error)) throw error;
      info = await this.recoverStoreConnection(storeId, url, error);
    }
    this.logDismissedObstructions(info);
    if (!info?.href || /^about:blank(?:$|[?#])/i.test(String(info.href))) {
      this.log("warn", "检测到空白页，正在只重开当前店铺并等待页面真正加载完成。");
      info = await this.reopenCurrentStore(storeId, url);
    } else {
      if (!this.isPageReady(info)) this.log("info", "店铺页面仍在加载，等待完成后再开始采集。");
      info = await this.waitForReadyPage(storeId, url, { allowVisit: true, initialInfo: info });
    }
    let check = platform.checkPage(info);
    const wantOrigin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    })();
    const onOrigin = (() => {
      try {
        return new URL(info.href).origin === wantOrigin;
      } catch {
        return false;
      }
    })();
    if (check.ok && !onOrigin && wantOrigin) {
      await this.cli.visit({ storeId, url });
      await this.waitCancelable(this.waits.visit);
      info = await this.waitForReadyPage(storeId, url);
      check = platform.checkPage(info);
    }
    if (!check.ok && check.code === "NOT_LOGGED_IN" && platform?.id === "shopee") {
      this.log("info", "检测到 Shopee 登录失效，正在尝试使用浏览器已保存的账号密码自动登录。");
      const readLoginRecovery = async () => {
        let recovery;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            recovery = await this.cli.runInPage(storeId, loginRecoveryBody(), { timeoutMs: 30000 });
            break;
          } catch (error) {
            if (attempt >= 2 || !isTransientPageProbeError(error)) throw error;
            this.log("warn", `Shopee 登录页面连接瞬时中断，正在重开当前店铺后重试登录：${error.message}`);
            info = await this.reopenCurrentStore(storeId, url);
            check = platform.checkPage(info);
            if (check.ok) {
              recovery = { attempted: false, alreadyLoggedIn: true };
              break;
            }
          }
        }
        return recovery;
      };
      const waitForLoginRecovery = async () => {
        const maxPolls = Math.max(1, Math.round(Number(this.waits.shopeeAutofillPollAttempts) || 1));
        let recovery = null;
        for (let poll = 1; poll <= maxPolls; poll += 1) {
          recovery = await readLoginRecovery();
          if (!recovery?.autofillMissing || recovery?.requiresManual || recovery?.attempted || recovery?.alreadyLoggedIn) return recovery;
          if (poll === 1) this.log("info", "登录表单已出现，正在等待紫鸟自动填充已保存的账号密码。");
          if (poll < maxPolls) await this.waitCancelable(this.waits.shopeeAutofillPollRetry);
        }
        return recovery;
      };
      let recovery = await waitForLoginRecovery();
      if (recovery?.requiresManual) {
        check = { ok: false, code: "CAPTCHA", message: `${recovery.reason} 请在紫鸟里完成验证后重试。` };
      } else if (recovery?.attempted) {
        const runNativeLoginClick = async (action) => {
          const selectors = Array.from(new Set([
            ...(Array.isArray(action?.nativeSelectors) ? action.nativeSelectors : []),
            action?.nativeSelector,
          ].filter(Boolean).map((value) => String(value))));
          if (!selectors.length) return;
          if (typeof this.cli.clickElement !== "function") {
            const error = new Error("当前紫鸟连接器不支持可信登录点击，请更新同舟智数后重试。");
            error.code = "NATIVE_CLICK_UNAVAILABLE";
            throw error;
          }
          let lastError;
          for (const selector of selectors) {
            try {
              await this.cli.clickElement({
                storeId,
                selector,
                hint: action.method === "saved-account" ? "Shopee 已保存账号继续按钮" : "Shopee 登录按钮",
              }, { timeoutMs: 30000 });
              lastError = null;
              break;
            } catch (error) {
              lastError = error;
              const missing = String(error?.code || "") === "ELEMENT_NOT_FOUND"
                || /element could not be located|element not found/i.test(String(error?.message || ""));
              if (!missing) throw error;
              this.log("warn", "Shopee 登录按钮选择器已失效，自动尝试备用入口。");
            }
          }
          if (lastError) throw lastError;
          this.log("info", action.method === "saved-account"
            ? "已通过紫鸟原生点击选择保存账号，等待登录表单。"
            : "已通过紫鸟原生点击提交保存的账号密码，等待进入卖家中心。");
        };
        const pollLoginResult = async () => {
          await this.waitCancelable(this.waits.shopeeLogin);
          const maxPolls = Math.max(1, Math.round(Number(this.waits.shopeeLoginPollAttempts) || 1));
          for (let poll = 1; poll <= maxPolls; poll += 1) {
            info = await this.readPageInfoWithRetry(storeId);
            this.logDismissedObstructions(info);
            check = platform.checkPage(info);
            if (check.ok || check.code === "CAPTCHA") break;
            if (poll < maxPolls) await this.waitCancelable(this.waits.shopeeLoginPollRetry);
          }
        };

        await runNativeLoginClick(recovery);
        await pollLoginResult();
        if (!check.ok && check.code === "NOT_LOGGED_IN" && recovery.method === "saved-account") {
          const secondStep = await waitForLoginRecovery();
          if (secondStep?.requiresManual) {
            check = { ok: false, code: "CAPTCHA", message: `${secondStep.reason} 请在紫鸟里完成验证后重试。` };
          } else if (secondStep?.attempted) {
            await runNativeLoginClick(secondStep);
            await pollLoginResult();
          } else if (secondStep?.alreadyLoggedIn) {
            info = await this.readPageInfoWithRetry(storeId);
            check = platform.checkPage(info);
          }
        }
        if (check.ok) this.log("info", "Shopee 已使用浏览器保存的登录信息自动恢复。");
      } else if (recovery?.alreadyLoggedIn) {
        // 检测与恢复之间页面可能已由浏览器自动跳回卖家中心，重新读取后再定性。
        info = await this.readPageInfoWithRetry(storeId);
        check = platform.checkPage(info);
        if (check.ok) this.log("info", "Shopee 页面已自行恢复登录，继续当前店铺采集。");
      } else {
        check = { ok: false, code: "NOT_LOGGED_IN", message: `Shopee 卖家中心未登录。${recovery?.reason || "自动登录未成功。"} 请在紫鸟里确认已保存密码；如有验证码请手动完成一次。` };
      }
    }
    if (!check.ok) {
      const error = new Error(check.message);
      error.code = check.code;
      throw error;
    }
    return info;
  }

  async waitCancelable(ms) {
    let remaining = Math.max(0, Number(ms) || 0);
    while (remaining > 0) {
      if (this.cancelRequested) {
        const error = new Error("采集已取消");
        error.code = "CANCELLED";
        error.retryable = false;
        throw error;
      }
      const part = Math.min(1000, remaining);
      await sleep(part);
      remaining -= part;
    }
  }

  nextShopeeReportGap() {
    if (Object.prototype.hasOwnProperty.call(this.waits, "shopeeReportGap")) {
      return Math.max(0, Number(this.waits.shopeeReportGap) || 0);
    }
    return shopeeReportGap({
      minMs: this.waits.shopeeReportGapMin,
      maxMs: this.waits.shopeeReportGapMax,
      random: this.random,
    });
  }

  async waitForShopeeReportSlot({ storeId, onProgress = () => {} } = {}) {
    const gapUntil = this.shopeeLastReportAt + Math.max(0, Number(this.shopeeNextReportGapMs) || 0);
    const until = Math.max(this.shopeeRateLimitUntil, gapUntil);
    const waitMs = Math.max(0, until - Date.now());
    if (!waitMs) return;
    onProgress({ storeId, phase: "order-report-cooldown", message: `Shopee 报表接口冷却中，约 ${Math.ceil(waitMs / 60000)} 分钟后自动续跑` });
    await this.waitCancelable(waitMs);
  }

  async runReplayBatches({
    storeId,
    storeName,
    requests,
    platform,
    page,
    timeoutMs,
    onProgress = () => {},
    maxRequests = DEFAULT_REPLAY_BATCH_REQUESTS,
    maxScriptChars = DEFAULT_REPLAY_SCRIPT_CHARS,
  }) {
    const queue = buildReplayBatches(requests, { maxRequests, maxScriptChars });
    const results = {};
    let replayMeta = {};
    let completedRequests = 0;
    const retryPerBatch = Math.max(0, Number(this.config().ziniao?.retryPerStore) || 0);

    for (let index = 0; index < queue.length; index += 1) {
      if (this.cancelRequested) {
        const error = new Error("采集已取消");
        error.code = "CANCELLED";
        error.retryable = false;
        error.batchCheckpointed = true;
        throw error;
      }
      const batch = queue[index];
      onProgress({
        storeId,
        phase: "fetch",
        message: `${storeName}：读取第 ${index + 1}/${queue.length} 批（${batch.length} 个接口，已完成 ${completedRequests}/${requests.length}）`,
      });

      let replay = null;
      let lastError = null;
      for (let attempt = 0; attempt <= retryPerBatch && !replay; attempt += 1) {
        try {
          replay = await this.cli.runInPage(storeId, replayBody(batch), { timeoutMs });
        } catch (error) {
          lastError = error;
          if (isCommandLineTooLong(error) || ["NOT_LOGGED_IN", "CAPTCHA", "CANCELLED"].includes(error.code)) break;
          this.log("warn", `${storeName} 第 ${index + 1} 批第 ${attempt + 1} 次失败：${error.message}`);
          if (attempt < retryPerBatch) {
            await this.ensurePage(storeId, platform, page).catch(() => null);
            await sleep(this.waits.retry);
          }
        }
      }

      if (!replay && isCommandLineTooLong(lastError) && batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        queue.splice(index, 1, batch.slice(0, middle), batch.slice(middle));
        index -= 1;
        this.log("warn", `${storeName} 第 ${index + 2} 批命令仍过长，已自动拆成更小批次`);
        continue;
      }
      if (!replay) {
        const error = lastError || new Error("页面批次采集失败");
        error.message = `${storeName} 第 ${index + 1}/${queue.length} 批采集失败（前 ${completedRequests} 个接口已完成）：${error.message}`;
        error.batchCheckpointed = true;
        error.retryable = false;
        throw error;
      }

      replayMeta = { ...replayMeta, ...replay };
      delete replayMeta.results;
      Object.assign(results, replay.results || {});
      completedRequests += batch.length;
    }
    return { ...replayMeta, results };
  }

  // -------------------------------------------------------------------------
  // 校准
  // -------------------------------------------------------------------------

  /**
   * 打开店铺到指定页面，安装请求记录器并抓取接口。reopen=false 时不重新导航，
   * 用于运营在紫鸟窗口里切换日期 / 点开广告报表之后「再抓一次」。
   */
  async discover({ storeId, platformId = "shopee", pageUrl, reopen = true }) {
    const platform = getPlatform(platformId);
    if (!platform) throw new Error(`未知平台：${platformId}`);
    if (reopen) {
      await this.openAt(storeId, pageUrl);
      await this.ensurePage(storeId, platform, pageUrl);
    }
    await this.cli.runInPage(storeId, hookBody(platform.API_PATTERN), { timeoutMs: 30000 });
    const probe = await this.cli.runInPage(storeId, probeBody(platform.API_PATTERN), { timeoutMs: 120000 });
    const previous = reopen ? [] : this.discoveries.get(storeId)?.requests || [];
    const byKey = new Map(previous.map((request) => [`${request.method} ${request.url} ${request.body || ""}`, request]));
    for (const request of probe.requests || []) {
      const json = parseJson(request.text);
      if (!json) continue;
      if (request.via === "refetch" && request.status !== 200) continue;
      const leaves = flattenNumbers(json);
      if (!leaves.length) continue;
      byKey.set(`${request.method} ${request.url} ${request.body || ""}`, {
        method: request.method,
        url: request.url,
        body: request.body || null,
        headers: request.headers || {},
        status: request.status,
        via: request.via,
        json,
        numberCount: leaves.length,
        businessError: businessError(json),
      });
    }
    const requests = [...byKey.values()].map((request, index) => ({ ...request, index }));
    this.discoveries.set(storeId, { cookies: probe.cookies || {}, requests, href: probe.href, title: probe.title, at: Date.now() });
    return {
      href: probe.href,
      title: probe.title,
      resourceCount: probe.resourceCount,
      requests: requests.map((request) => ({
        index: request.index,
        method: request.method,
        url: request.url,
        body: request.body ? String(request.body).slice(0, 400) : null,
        status: request.status,
        via: request.via,
        numberCount: request.numberCount,
        businessError: request.businessError,
        preview: flattenNumbers(request.json, { limit: 400 }),
      })),
    };
  }

  /** 用选中的请求生成模板，并给出字段映射建议。 */
  buildTemplate({ storeId, platformId = "shopee", indexes = [], name = "", sellerCenter = "cnsc", shopIds = [], templateId = "" }) {
    const discovery = this.discoveries.get(storeId);
    if (!discovery) throw new Error("请先对这个店铺执行一次「抓取接口」");
    const platform = getPlatform(platformId);
    const existing = templateId ? this.config().templates[templateId] : null;
    const template = existing ? JSON.parse(JSON.stringify(existing)) : platform.blankTemplate({ sellerCenter, name });
    if (name) template.name = name;
    try {
      template.collectPath = new URL(discovery.href).pathname;
    } catch {
      /* 保留默认 */
    }
    const notes = [];
    const samples = [];
    let next = (template.endpoints || []).length + 1;
    for (const index of indexes) {
      const request = discovery.requests.find((item) => item.index === Number(index));
      if (!request) continue;
      const { endpoint, replaced, error } = templatizeRequest(request, { shopIds, cookies: discovery.cookies });
      if (!endpoint) {
        notes.push(`${request.url}：${error}`);
        continue;
      }
      endpoint.id = `e${next}`;
      next += 1;
      template.endpoints.push(endpoint);
      samples.push({ endpoint, sample: request.json });
      notes.push(`${endpoint.label}：${replaced.length ? replaced.join("，") : "没有识别到日期参数（只能取页面当前日期）"}`);
    }
    const suggestions = suggestMetrics(samples);
    template.metrics = { ...suggestions, ...(template.metrics || {}) };
    for (const value of Object.values(template.metrics)) delete value.sampleValue;
    const sampleLeaves = {};
    for (const { endpoint, sample } of samples) sampleLeaves[endpoint.id] = flattenNumbers(sample, { limit: 400 });
    return { template, notes, suggestions, samples: sampleLeaves, problems: validateTemplate(template) };
  }

  /** 店铺对应的卖家中心域名（按紫鸟平台名识别站点，可在店铺设置里覆盖）。 */
  storeOrigin(store, platform, settings = {}) {
    if (settings.origin) return settings.origin;
    const { sellerCenter } = platform.storeSite(store);
    return platform.originFor(settings.sellerCenter || sellerCenter);
  }

  templateFor(settings = {}, platform) {
    const templates = allTemplates(this.config().templates);
    return templates[settings.templateId] || templates[platform.defaultTemplateId] || null;
  }

  /**
   * 读取 Shopee 官方订单导表并按付款日期汇总。报表明细只在内存中解析，
   * 不落盘、不上传；返回给采集证据的只有按日汇总和非敏感任务元数据。
   */
  async collectShopeeOrderReport({ store, target, platform, origin, dates, timeoutMs, onProgress = () => {} }) {
    // 历史补采使用更小的七天分片，降低单次导表数据量和 Shopee 429 风险；
    // 日常短周期采集仍沿用平台允许的默认窗口。
    const windows = orderReportWindows(dates, {
      // orderReportWindows 的范围从“回看起始日”计算；需要把 14 天回看期也计入，
      // 才能得到真正的 7 个目标日期一片，而不是误拆成逐日导表。
      maxRangeDays: dates.length > 7 ? ORDER_REPORT_LOOKBACK_DAYS + 7 : undefined,
    });
    const result = {
      source: "shopee-order-export",
      screeningCondition: "order_creation_date",
      payAmountFormula: "order_subtotal_minus_seller_voucher",
      lookbackDays: ORDER_REPORT_LOOKBACK_DAYS,
      days: {},
      reports: [],
    };
    if (!windows.length) return result;
    const page = `${origin}/portal/sale/order`;
    await this.cli.visit({ storeId: store.storeId, url: page });
    await sleep(this.waits.visit);
    await this.ensurePage(store.storeId, platform, page);
    for (const window of windows) {
      try {
        onProgress({ storeId: store.storeId, phase: "order-report", message: `${store.storeName}：导出 Shopee 官方订单表 ${window.startDate} 至 ${window.endDate}` });
        let downloaded = null;
        const maxAttempts = 1 + Math.max(0, Number(this.waits.shopeeReportRetries) || 0);
        for (let attempt = 1; attempt <= maxAttempts && !downloaded; attempt += 1) {
          await this.waitForShopeeReportSlot({ storeId: store.storeId, onProgress });
          try {
            downloaded = await this.cli.runInPage(store.storeId, orderReportBody(window), { timeoutMs: Math.max(timeoutMs, 5 * 60 * 1000) });
            this.shopeeLastReportAt = Date.now();
            this.shopeeNextReportGapMs = this.nextShopeeReportGap();
            this.shopeeRateLimitStrikes = 0;
          } catch (error) {
            const rateLimit = shopeeRateLimitDetails(error);
            if (!rateLimit.limited) throw error;
            this.shopeeRateLimitStrikes += 1;
            const cooldown = shopeeRateLimitCooldown(this.shopeeRateLimitStrikes, rateLimit.retryAfterMs, {
              schedule: this.waits.shopeeRateLimitSchedule,
              jitterMinMs: this.waits.shopeeRateLimitJitterMin,
              jitterMaxMs: this.waits.shopeeRateLimitJitterMax,
            });
            this.shopeeRateLimitUntil = Math.max(this.shopeeRateLimitUntil, Date.now() + cooldown);
            this.log("warn", `${store.storeName}：Shopee 报表接口触发限流，冷却 ${Math.ceil(cooldown / 60000)} 分钟后从当前报表续跑。`);
            if (attempt >= maxAttempts) {
              const limited = new Error("Shopee 订单报表接口持续限流，本店已暂停；稍后可从该店重新补采，不会写入错误口径。");
              limited.code = "SHOPEE_RATE_LIMIT";
              limited.retryable = false;
              throw limited;
            }
          }
        }
        const buffer = Buffer.from(String(downloaded?.base64 || ""), "base64");
        if (!buffer.length || buffer.length !== Number(downloaded?.bytes || 0)) throw new Error("Shopee 订单报表下载数据不完整。");
        const parsed = parseShopeeOrderReport(buffer, { site: target.country });
        for (const date of window.dates) result.days[date] = parsed.days[date] || emptyDay();
        result.reports.push({
          reportId: downloaded.reportId,
          startDate: window.startDate,
          endDate: window.endDate,
          bytes: buffer.length,
          rowCount: parsed.rowCount,
          uniqueOrderCount: parsed.uniqueOrderCount,
        });
      } catch (error) {
        error.partialOrderReport = result;
        error.failedWindow = {
          startDate: window.startDate,
          endDate: window.endDate,
          dates: [...window.dates],
        };
        throw error;
      }
    }
    return result;
  }

  /** 按模板试采某一天，返回各接口的数值叶子和取到的字段值，供人工核对。 */
  async testTemplate({ storeId, template, date, target = {} }) {
    const platform = getPlatform(template.platform);
    const cached = (this.config().storeCache || []).find((item) => item.storeId === storeId) || { storeId };
    const origin = this.storeOrigin(cached, platform, this.config().stores[storeId] || {});
    const page = `${origin}${template.collectPath || "/"}`;
    await this.openAt(storeId, page);
    await this.ensurePage(storeId, platform, page);
    const site = target.country || platform.storeSite(cached).site || "SG";
    const values = placeholderValues({ date, site, shopId: target.shopId || "", origin });
    const requests = template.endpoints.map((endpoint) => ({ key: endpoint.id, ...fillRequest(endpoint, values) }));
    const replay = await this.cli.runInPage(storeId, replayBody(requests), { timeoutMs: 120000 });
    const responses = {};
    const endpoints = [];
    for (const endpoint of template.endpoints) {
      const result = replay.results?.[endpoint.id] || { status: 0, error: "无返回" };
      const error = result.error || (result.status !== 200 ? `HTTP ${result.status}` : businessError(result.json));
      responses[endpoint.id] = { ...result, error };
      endpoints.push({ id: endpoint.id, label: endpoint.label, status: result.status, error, ms: result.ms, preview: result.json ? flattenNumbers(result.json, { limit: 400 }) : [], text: result.text || "" });
    }
    const extracted = extractMetrics(template, responses);
    return { date, endpoints, values: extracted.values, missing: extracted.missing };
  }

  // -------------------------------------------------------------------------
  // 正式采集
  // -------------------------------------------------------------------------

  cancel() {
    this.cancelRequested = true;
  }

  /** 中台店铺自动匹配：名称（忽略大小写/空格/符号）一致且站点一致。 */
  matchZhongtaiShop(storeName, site, identity = null, platformId = "") {
    const candidates = [
      ...(Array.isArray(identity?.shopNames) ? identity.shopNames : []),
      identity?.username,
      identity?.shopName,
      storeName,
    ].filter(Boolean);
    for (const name of candidates) {
      const found = this.matchZhongtaiShopName(name, site, platformId);
      if (found) return found;
    }
    return null;
  }

  matchZhongtaiShopName(storeName, site, platformId = "") {
    const shops = this.config().zhongtaiShops || [];
    if (!shops.length) return null;
    const norm = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
    const target = norm(storeName);
    if (!target) return null;
    const expectedSite = String(site || "").toUpperCase();
    const expectedPlatform = norm(platformId);
    const sameScope = shops.filter((shop) => {
      const country = String(shop.countryCode || "").toUpperCase();
      const platform = norm(shop.platform);
      return (!expectedSite || !country || country === expectedSite)
        && (!expectedPlatform || !platform || platform === expectedPlatform);
    });
    const names = (shop) => [shop.shopName, shop.rawName, shop.alias, shop.miaoshouShopName, shop.miaoshouAlias]
      .map(norm)
      .filter(Boolean);
    const scored = sameScope.map((shop) => {
      let score = 0;
      for (const name of names(shop)) {
        if (name === target) score = Math.max(score, 10000 + name.length);
        else if (name.length >= 4 && target.length >= 4 && (name.includes(target) || target.includes(name))) {
          score = Math.max(score, 1000 + Math.min(name.length, target.length));
        }
      }
      return { shop, score };
    }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored[1] && scored[1].score === scored[0].score) return null;
    return scored[0].shop;
  }

  /** 店铺页用：所有可识别平台的紫鸟店铺 + 自动识别的站点和对应的中台店铺。 */
  storeOverview() {
    const config = this.config();
    const lastRun = (this.store.history() || [])[0];
    const lastByStore = new Map((lastRun?.stores || []).map((item) => [item.storeId, item]));
    return (config.storeCache || []).map((store) => {
      const platform = guessPlatform(store);
      if (!platform) return null;
      const settings = config.stores[store.storeId] || {};
      const template = this.templateFor(settings, platform);
      const { site } = platform.storeSite(store);
      const manual = (settings.targets || []).filter((target) => target.shopName || target.shopKey);
      const matched = manual.length ? null : this.matchZhongtaiShop(store.storeName, site, settings.identity, platform.id);
      return {
        storeId: store.storeId,
        storeName: store.storeName,
        platformName: store.platformName,
        platform: platform.name,
        site,
        templateReady: Boolean(template && !template.requiresCalibration),
        endpointCount: Array.isArray(template?.endpoints) ? template.endpoints.length : 0,
        officialReport: platform.id === "shopee" && template?.builtin === true,
        enabled: settings.enabled !== false,
        targets: manual.length ? manual : [{ shopName: matched?.shopName || store.storeName, shopKey: matched?.shopKey || "", country: site, auto: true, matched: Boolean(matched) }],
        last: lastByStore.get(store.storeId) || null,
      };
    }).filter(Boolean);
  }

  /** 店铺采集计划：紫鸟里所有可识别平台的店铺默认参与，无需逐个配置。 */
  plan({ storeIds = null } = {}) {
    const config = this.config();
    const plan = [];
    const skipped = [];
    const cache = config.storeCache || [];
    for (const store of cache) {
      const platform = guessPlatform(store);
      if (!platform) continue;
      if (storeIds && !storeIds.includes(store.storeId)) continue;
      const settings = config.stores[store.storeId] || {};
      if (!storeIds && settings.enabled === false) continue;
      const template = this.templateFor(settings, platform);
      if (!template) {
        skipped.push({ storeId: store.storeId, storeName: store.storeName, reason: "没有可用的采集模板" });
        continue;
      }
      if (template.requiresCalibration) {
        skipped.push({
          storeId: store.storeId,
          storeName: store.storeName,
          reason: "TikTok 采集模板需要先在模板校准中采样真实店铺接口，未校准前不会写入 0 值。",
        });
        continue;
      }
      const { site } = platform.storeSite(store);
      const origin = this.storeOrigin(store, platform, settings);
      let targets = (settings.targets || []).filter((target) => target.enabled !== false && (target.shopName || target.shopKey));
      if (!targets.length) {
        if (!site) {
          skipped.push({ storeId: store.storeId, storeName: store.storeName, reason: "无法从紫鸟平台名识别站点，请在店铺里手动选择" });
          continue;
        }
        const matched = this.matchZhongtaiShop(store.storeName, site, settings.identity, platform.id);
        targets = [{ id: `auto-${store.storeId}`, shopName: matched?.shopName || store.storeName, shopKey: matched?.shopKey || "", country: site, auto: true }];
      }
      targets = targets.map((target, index) => ({ ...target, id: target.id || `t${index}`, country: target.country || site }));
      plan.push({ store: { ...store, ...settings, storeId: store.storeId, storeName: store.storeName }, targets, template, platform, origin });
    }
    return { plan, skipped };
  }

  async collectStore({ store, targets, template, platform, origin }, { dates, mode = "upload", onProgress = () => {} }) {
    const { closeAfter, storeTimeoutSec } = this.config().ziniao;
    const page = `${origin}${template.collectPath || "/"}`;
    const rows = [];
    const issues = [];
    let skippedCheckpoints = 0;
    const pendingDates = new Map();
    for (const target of targets) {
      const requested = dates[target.country] || dates.default || [];
      const pending = mode === "upload"
        ? requested.filter((date) => {
          const key = collectionCheckpointKey({ storeId: store.storeId, targetId: target.id, country: target.country, date });
          const completed = this.store.hasCollectionCheckpoint(key);
          if (completed) skippedCheckpoints += 1;
          return !completed;
        })
        : requested;
      pendingDates.set(target.id, pending);
    }
    targets = targets.filter((target) => (pendingDates.get(target.id) || []).length > 0);
    if (!targets.length) {
      onProgress({ storeId: store.storeId, phase: "checkpoint", message: `${store.storeName}：所选日期均已成功写入中台，已跳过` });
      return { ok: true, rows, issues, screenshots: [], skippedCheckpoints };
    }
    let reused = false;
    try {
      onProgress({ storeId: store.storeId, phase: "preflight", message: `${store.storeName}：预检模板、店铺映射与历史断点` });
      onProgress({ storeId: store.storeId, phase: "open", message: `打开 ${store.storeName}` });
      ({ reused } = await this.openAt(store.storeId, page));
      await this.ensurePage(store.storeId, platform, page);
      onProgress({ storeId: store.storeId, phase: "preflight", message: `${store.storeName}：紫鸟网络、CDP、卖家中心页面与登录态正常` });
      let pageIdentity = null;
      if (platform.identityPageBody && platform.parsePageIdentity) {
        const snapshot = await this.cli.runInPage(store.storeId, platform.identityPageBody(), { timeoutMs: 30000 });
        pageIdentity = platform.parsePageIdentity(snapshot);
        if (pageIdentity) {
          this.store.update((config) => {
            config.stores[store.storeId] = {
              ...(config.stores[store.storeId] || { storeId: store.storeId, storeName: store.storeName }),
              identity: pageIdentity,
            };
          });
          for (const target of targets) {
            if (!target.auto || target.shopKey) continue;
            const matched = this.matchZhongtaiShop(store.storeName, target.country, pageIdentity, platform.id);
            if (matched) Object.assign(target, { shopKey: matched.shopKey, shopName: matched.shopName });
          }
        }
      }
      if (mode === "upload" && platform.id === "tiktok" && targets.some((target) => target.auto && !target.shopKey)) {
        const error = new Error(`无法把紫鸟 TikTok 店铺“${pageIdentity?.shopName || store.storeName}”唯一对应到妙手店铺，请检查妙手店铺名称、平台和国家。`);
        error.code = "STORE_MAPPING_REQUIRED";
        error.retryable = false;
        throw error;
      }
      const requests = [];
      for (const target of targets) {
        const targetDates = pendingDates.get(target.id) || [];
        for (const date of targetDates) {
          const values = placeholderValues({ date, site: target.country, shopId: target.shopId || "", origin });
          for (const endpoint of template.endpoints) requests.push({ key: `${target.id}|${date}|${endpoint.id}`, ...fillRequest(endpoint, values) });
        }
      }
      if (platform.identityRequests) requests.push(...platform.identityRequests(origin));
      onProgress({ storeId: store.storeId, phase: "fetch", message: `${store.storeName}：读取 ${requests.length} 个数据接口` });
      const timeoutMs = Math.max(60, Number(storeTimeoutSec) || 240) * 1000;
      const replay = await this.runReplayBatches({
        storeId: store.storeId,
        storeName: store.storeName,
        requests,
        platform,
        page,
        timeoutMs,
        onProgress,
      });
      // 记住店铺身份；自动对应没对上的，用 Shopee 登录名 / 店铺名再对一次。
      const identity = pageIdentity || (platform.parseIdentity ? platform.parseIdentity(replay.results) : null);
      if (identity) {
        this.store.update((config) => {
          config.stores[store.storeId] = { ...(config.stores[store.storeId] || { storeId: store.storeId, storeName: store.storeName }), identity };
        });
        for (const target of targets) {
          if (!target.auto || target.shopKey) continue;
          const matched = this.matchZhongtaiShop(store.storeName, target.country, identity, platform.id);
          if (matched) Object.assign(target, { shopKey: matched.shopKey, shopName: matched.shopName });
        }
      }
      if (mode === "upload" && targets.some((target) => target.auto && !target.shopKey)) {
        const error = new Error(`店铺“${identity?.shopName || pageIdentity?.shopName || store.storeName}”没有唯一中台映射，正式上传已停止。请先完成店铺映射后重试；预览模式仍可用于校准。`);
        error.code = "STORE_MAPPING_REQUIRED";
        error.retryable = false;
        throw error;
      }
      onProgress({ storeId: store.storeId, phase: "preflight", message: `${store.storeName}：中台店铺映射与报表模板检查通过` });
      let orderReport = null;
      if (platform.id === "shopee" && template.builtin === true && targets.length === 1) {
        const target = targets[0];
        const targetDates = pendingDates.get(target.id) || [];
        try {
          orderReport = await this.collectShopeeOrderReport({ store, target, platform, origin, dates: targetDates, timeoutMs, onProgress });
        } catch (error) {
          const partial = error?.partialOrderReport;
          if (partial?.reports?.length) {
            orderReport = partial;
            const failedWindow = error?.failedWindow || {};
            issues.push({
              level: "warn",
              storeName: store.storeName,
              shopName: target.shopName,
              date: failedWindow.startDate || "",
              message: `Shopee 官方订单表已完成 ${partial.reports.length} 个日期分片；${failedWindow.startDate || "后续日期"} 至 ${failedWindow.endDate || "末日"} 采集失败，本次先保存已成功日期，剩余日期下次自动续采：${error.message}`,
            });
          } else {
            throw new Error(`Shopee 官方订单导表失败，已停止本店采集以避免写入错误支付口径：${error.message}`, { cause: error });
          }
        }
      }
      for (const target of targets) {
        const info = siteInfo(target.country);
        const targetDates = pendingDates.get(target.id) || [];
        for (const date of targetDates) {
          const responses = {};
          const notReadyEndpoints = new Set();
          for (const endpoint of template.endpoints) {
            const result = replay.results?.[`${target.id}|${date}|${endpoint.id}`] || { status: 0, error: "无返回" };
            const error = result.error || (result.status !== 200 ? `HTTP ${result.status}` : businessError(result.json));
            responses[endpoint.id] = { ...result, error };
            if (error) {
              const notReady = /isn'?t ready|not ready|data_ready/i.test(error);
              if (notReady) notReadyEndpoints.add(endpoint.id);
              issues.push(notReady
                ? { level: "warn", storeName: store.storeName, shopName: target.shopName, date, message: `${endpoint.label}：Shopee 还没生成这一天的数据，下次采集会自动补上` }
                : { level: "error", storeName: store.storeName, shopName: target.shopName, date, message: `${endpoint.label}：${error}` });
            }
          }
          const { values, missing: allMissing } = extractMetrics(template, responses);
          const dashboard = { payAmount: values.payAmount, orderCount: values.orderCount };
          const reportDay = orderReport?.days?.[date] || null;
          if (orderReport && !reportDay) {
            issues.push({
              level: "warn",
              storeName: store.storeName,
              shopName: target.shopName,
              date,
              message: "Shopee 官方订单表尚未成功返回该日期，本次不写入商业分析的替代金额；下次补采会从该日期继续。",
            });
            continue;
          }
          if (reportDay) {
            values.payAmount = reportDay.payAmount;
            values.orderCount = reportDay.orderCount;
            const different = Number(dashboard.payAmount) !== Number(reportDay.payAmount) || Number(dashboard.orderCount) !== Number(reportDay.orderCount);
            if (different) {
              issues.push({
                level: "warn",
                storeName: store.storeName,
                shopName: target.shopName,
                date,
                message: `支付销售口径差异已记录：订单小计减卖家券 ${reportDay.payAmount} / ${reportDay.orderCount} 单，商业分析 ${dashboard.payAmount ?? "缺失"} / ${dashboard.orderCount ?? "缺失"} 单`,
              });
            }
          }
          const suppliedByOrderReport = reportDay ? new Set(["payAmount", "orderCount"]) : new Set();
          const notReadyFields = allMissing.filter((field) => !suppliedByOrderReport.has(field) && mappingParts(template.metrics[field]).some((part) => notReadyEndpoints.has(part.endpoint)));
          const missing = allMissing.filter((field) => !suppliedByOrderReport.has(field) && !notReadyFields.includes(field));
          if (!Object.keys(values).length) {
            issues.push({ level: "warn", storeName: store.storeName, shopName: target.shopName, date, message: "没有取到任何字段，已跳过" });
            continue;
          }
          if (missing.length) issues.push({ level: "warn", storeName: store.storeName, shopName: target.shopName, date, message: `缺少字段：${missing.join("、")}` });
          const endpoints = {};
          for (const endpoint of template.endpoints) endpoints[endpoint.id] = evidenceEndpoint(endpoint, responses[endpoint.id]);
          const salesChannel = String(target.salesChannel || template.salesChannel || platform.defaultSalesChannel?.(target.country) || "").trim().toUpperCase();
          const metadataMissing = [
            ...missing,
            ...notReadyFields,
            ...(platform.id === "tiktok" && (!salesChannel || salesChannel === "UNSPECIFIED") ? ["sales_channel"] : []),
          ];
          const dataStatus = metadataMissing.length ? "PARTIAL" : "COMPLETE";
          const channelMetadata = platform.id === "tiktok" ? {
            salesChannel,
            purchaseChannel: String(target.purchaseChannel || salesChannel || "").trim().toUpperCase(),
            timezone: platform.siteTimezones?.[target.country] || info?.timezone || "",
            definitionVersion: "tiktok-daily-v1",
            dataStatus,
            missingModules: [...new Set(metadataMissing)],
          } : {};
          rows.push({
            date,
            shopKey: target.shopKey || undefined,
            shopName: target.shopName,
            country: info?.name || target.country,
            platform: platform.name,
            currency: target.currency || info?.currency || "",
            ...channelMetadata,
            ...values,
            _store: store.storeName,
            _storeId: store.storeId,
            _targetId: target.id,
            _targetCountry: target.country,
            _checkpointKey: collectionCheckpointKey({ storeId: store.storeId, targetId: target.id, country: target.country, date }),
            evidence: {
              storeId: store.storeId,
              storeName: store.storeName,
              site: target.country,
              origin,
              templateId: template.id || "",
              templateVersion: Number(template.version) || 1,
              collectedAt: new Date().toISOString(),
              values,
              orderReport: reportDay ? {
                source: orderReport.source,
                screeningCondition: orderReport.screeningCondition,
                payAmountFormula: orderReport.payAmountFormula,
                lookbackDays: orderReport.lookbackDays,
                dashboard,
                summary: reportDay,
                reports: orderReport.reports,
              } : null,
              missing,
              notReady: notReadyFields,
              endpoints,
              pageCheck: null,
            },
          });
        }
      }
      const screenshots = [];
      if (targets.length === 1 && platform.pageCheck && this.config().quality?.pageCheck !== false) {
        await this.pageCheck({ store, target: targets[0], platform, origin, rows, issues, screenshots, onProgress });
      }
      return { ok: true, rows, issues, screenshots, skippedCheckpoints };
    } finally {
      if (closeAfter && !reused) await this.cli.closeStore({ storeId: store.storeId });
    }
  }

  /**
   * 页面核对：只核对站点「昨天」那一行（商业分析首页的「昨天」快捷选项）。
   * 核对失败不影响采集结果，只记为「未核对」。
   */
  async pageCheck({ store, target, platform, origin, rows, issues, screenshots, onProgress = () => {} }) {
    const yesterday = addDays(siteToday(target.country), -1);
    const row = rows.find((item) => item.date === yesterday);
    if (!row) return;
    const settings = this.config().quality || {};
    let page = null;
    try {
      onProgress({ storeId: store.storeId, phase: "check", message: `${store.storeName}：与 Shopee 后台页面核对 ${yesterday}` });
      await this.cli.visit({ storeId: store.storeId, url: `${origin}${platform.pageCheck.path}` });
      await sleep(this.waits.visit);
      page = await this.cli.runInPage(store.storeId, pageCheckBody({ expectDate: pageDateText(yesterday) }), { timeoutMs: 90000 });
    } catch (error) {
      page = { notes: [`页面核对失败：${error.message}`] };
    }
    const pageCheckValues = row.evidence.orderReport?.dashboard || row.evidence.values;
    const check = comparePageCheck(pageCheckValues, page, target.country);
    row.evidence.pageCheck = { at: new Date().toISOString(), date: yesterday, ...check, orderType: page?.orderType || "", lang: page?.lang || "", raw: page?.values || {}, notes: page?.notes || [] };
    if (check.status === "mismatch") {
      const detail = Object.entries(check.fields).filter(([, item]) => !item.match).map(([field, item]) => `${field} 采集 ${item.collected} / 页面 ${item.page}`).join("；");
      issues.push({ level: "warn", storeName: store.storeName, shopName: target.shopName, date: yesterday, message: `与 Shopee 后台页面不一致：${detail}` });
    }
    if (page?.period && settings.screenshot !== false && this.cli.screenshot) {
      try {
        const filePath = await this.cli.screenshot({ storeId: store.storeId });
        const image = this.imageEncoder ? await this.imageEncoder(filePath) : null;
        if (image?.base64) screenshots.push({ storeId: store.storeId, storeName: store.storeName, shopName: target.shopName, date: yesterday, ...image });
      } catch (error) {
        this.log("warn", `${store.storeName} 截图失败（不影响采集）：${error.message}`);
      }
    }
    if (page?.keepOrderType) {
      await this.cli.runInPage(store.storeId, restoreOrderTypeBody(page.keepOrderType), { timeoutMs: 30000 }).catch(() => null);
    }
  }

  /**
   * 执行采集。dates：日期数组（所有站点相同）或 null（按各店铺站点时区自动取最近 N 天）。
   * mode：upload（写入中台）| preview（中台试匹配，不写入）| local（只采集不连中台）。
   */
  async collect({ storeIds = null, dates = null, mode = "upload", trigger = "manual", commandId = "", onProgress = () => {} } = {}) {
    if (this.running) throw new Error("已有采集任务在运行");
    const config = this.config();
    const selectedDates = requestedDates(dates);
    const runId = newId("run");
    const startedAt = new Date().toISOString();
    this.cancelRequested = false;
    const { plan, skipped } = this.plan({ storeIds });
    validateBackfillScope(selectedDates, plan);
    const entry = {
      id: runId,
      trigger,
      mode,
      commandId,
      startedAt,
      finishedAt: "",
      status: "running",
      dates: selectedDates || defaultDates(config.schedule),
      stores: [],
      rowCount: 0,
      issues: [],
      upload: null,
    };
    this.running = entry;
    this.store.appendHistory(entry);
    if (this.onRunUpdate) this.onRunUpdate({ ...entry });
    const allRows = [];
    const allScreenshots = [];
    try {
      for (const item of skipped) entry.stores.push({ storeId: item.storeId, storeName: item.storeName, status: "skipped", message: item.reason, rowCount: 0 });
      for (let index = 0; index < plan.length; index += 1) {
        const item = plan[index];
        if (this.cancelRequested) {
          entry.stores.push({ storeId: item.store.storeId, storeName: item.store.storeName, status: "cancelled", message: "已取消", rowCount: 0 });
          continue;
        }
        const dateMap = { default: [] };
        for (const target of item.targets) {
          dateMap[target.country] = selectedDates || defaultDates({ ...config.schedule, site: target.country });
        }
        dateMap.default = selectedDates || defaultDates(config.schedule);
        onProgress({ index, total: plan.length, storeId: item.store.storeId, phase: "start", message: `(${index + 1}/${plan.length}) ${item.store.storeName}` });
        const attempts = 1 + Math.max(0, Number(config.ziniao.retryPerStore) || 0);
        let result = null;
        let lastError = null;
        for (let attempt = 1; attempt <= attempts && !result; attempt += 1) {
          try {
            result = await this.collectStore(item, { dates: dateMap, mode, onProgress });
          } catch (error) {
            lastError = error;
            this.log("warn", `${item.store.storeName} 第 ${attempt} 次采集失败：${error.message}`);
            if (["NOT_LOGGED_IN", "CAPTCHA"].includes(error.code) || error.retryable === false || error.batchCheckpointed) break;
            if (attempt < attempts) await sleep(this.waits.retry);
          }
        }
        if (result) {
          allRows.push(...result.rows);
          allScreenshots.push(...(result.screenshots || []));
          entry.issues.push(...result.issues);
          const hasError = result.issues.some((issue) => issue.level === "error");
          const skippedCheckpoints = Number(result.skippedCheckpoints || 0);
          entry.stores.push({
            storeId: item.store.storeId,
            storeName: item.store.storeName,
            status: hasError ? "partial" : "ok",
            message: hasError ? "部分接口失败" : (skippedCheckpoints ? `已跳过 ${skippedCheckpoints} 个成功日期` : ""),
            rowCount: result.rows.length,
            skippedCheckpoints,
          });
          this.log("info", `${item.store.storeName}：${result.rows.length} 行${skippedCheckpoints ? `，跳过 ${skippedCheckpoints} 个已成功日期` : ""}`);
        } else {
          const failureCategory = classifyFailure(lastError);
          entry.stores.push({ storeId: item.store.storeId, storeName: item.store.storeName, status: "failed", message: lastError?.message || "失败", rowCount: 0, failureCategory });
          entry.issues.push({ level: "error", storeName: item.store.storeName, message: lastError?.message || "失败", failureCategory });
        }
        entry.rowCount = allRows.length;
        this.store.saveResultRows(runId, allRows);
        this.store.updateHistory(runId, {
          stores: entry.stores,
          issues: entry.issues.slice(0, 300),
          rowCount: entry.rowCount,
          status: "running",
          lastCheckpointAt: new Date().toISOString(),
        });
        onProgress({ index: index + 1, total: plan.length, storeId: item.store.storeId, phase: "done", message: `${item.store.storeName} 完成` });
      }
      entry.rowCount = allRows.length;
      entry.pageChecks = allRows.filter((row) => row.evidence?.pageCheck).map((row) => ({ storeName: row._store, shopName: row.shopName, date: row.date, status: row.evidence.pageCheck.status, message: row.evidence.pageCheck.message }));
      const rows = allRows.map(publicUploadRow);
      entry.status = this.cancelRequested ? "cancelled" : this.baseRunStatus(entry);
      entry.finishedAt = new Date().toISOString();
      entry.issues = entry.issues.slice(0, 300);
      // 采集结果必须先完整落盘，随后才允许发起网络上传。即使上传时断网，
      // 重启程序后也能从结果文件和 outbox 中继续补传，不会重新采集店铺。
      this.store.saveResultRows(runId, allRows);
      this.store.updateHistory(runId, { ...entry });

      if (rows.length && mode === "preview") {
        onProgress({ phase: "upload", message: "中台试匹配…" });
        try {
          const result = await this.zhongtaiFactory().ingest(rows, { dryRun: true, runId });
          entry.upload = { ok: true, dryRun: true, queued: false, rowCount: result.rowCount, written: result.written, shopCount: result.shopCount, errors: (result.errors || []).slice(0, 50), warnings: (result.warnings || []).slice(0, 50), at: new Date().toISOString() };
        } catch (error) {
          entry.upload = { ok: false, dryRun: true, queued: false, message: error.message, status: error.status || 0, at: new Date().toISOString() };
          entry.status = "upload_failed";
          if (error.status === 401 && this.onUnauthorized) this.onUnauthorized();
        }
        this.store.updateHistory(runId, { upload: entry.upload, status: entry.status });
      } else if (rows.length && mode === "upload") {
        onProgress({ phase: "upload", message: `写入中台 ${rows.length} 行…` });
        const job = this.queueUpload(runId);
        entry.upload = await this.attemptUploadJob(job, { force: true, throwOnError: false });
        entry.status = entry.upload?.ok
          ? this.baseRunStatus(entry)
          : (entry.upload?.needsAttention ? "needs_attention" : "upload_failed");
        if (entry.upload?.ok && allScreenshots.length) {
          const client = this.zhongtaiFactory();
          if (typeof client.agent === "function" && client.isNode) {
            let sent = 0;
            for (const shot of allScreenshots) {
              try {
                await client.agent("evidence/screenshot", shot);
                sent += 1;
              } catch (error) {
                this.log("warn", `上传 ${shot.storeName} 截图失败：${error.message}`);
              }
            }
            entry.upload.screenshots = sent;
          }
        }
        this.store.updateHistory(runId, { upload: entry.upload, status: entry.status });
      }
      if (this.onRunUpdate) this.onRunUpdate({ ...entry });
      return entry;
    } finally {
      this.running = null;
    }
  }

  /** 重新上传某次采集结果（例如当时中台不可用）。 */
  async reupload(runId, { dryRun = false } = {}) {
    const rows = this.store.resultRows(runId).map(publicUploadRow);
    if (!rows.length) throw new Error("这次采集没有可上传的数据");
    if (dryRun) {
      const result = await this.zhongtaiFactory().ingest(rows, { dryRun: true, runId });
      return { ok: true, dryRun: true, queued: false, rowCount: result.rowCount, written: result.written, shopCount: result.shopCount, errors: (result.errors || []).slice(0, 50), warnings: (result.warnings || []).slice(0, 50), at: new Date().toISOString() };
    }
    const job = this.queueUpload(runId, { source: "manual-retry" });
    return this.attemptUploadJob(job, { force: true, throwOnError: true });
  }
}

module.exports = {
  Collector,
  defaultDates,
  requestedDates,
  validateBackfillScope,
  businessError,
  buildReplayBatches,
  isCommandLineTooLong,
  shopeeRateLimitDetails,
  shopeeRateLimitCooldown,
  shopeeReportGap,
  publicUploadRow,
  collectionCheckpointKey,
  classifyFailure,
  DEFAULT_REPLAY_BATCH_REQUESTS,
  DEFAULT_REPLAY_SCRIPT_CHARS,
  METRIC_KEYS,
};

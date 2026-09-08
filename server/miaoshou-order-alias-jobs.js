import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { normalizeMiaoshouOrderNumber } from "./miaoshou-order-alias.js";

const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;
const MATCH_BATCH_SIZE = 25;
const PREVIEW_ROWS = 300;

function nowIso() {
  return new Date().toISOString();
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function loadJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  renameSync(temporaryPath, path);
}

function safeCell(value) {
  return String(value ?? "").slice(0, 50_000);
}

function csvCell(value) {
  const raw = safeCell(value);
  const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function statusLabel(status) {
  if (status === "matched") return "已匹配";
  if (status === "unmatched") return "未匹配";
  if (status === "query_failed") return "查询失败";
  if (status === "ambiguous") return "存在冲突";
  if (status === "alias_missing") return "缺少别名";
  if (status === "shop_missing") return "店铺未同步";
  if (status === "invalid") return "格式无效";
  return status || "等待匹配";
}

function sourceLabel(source) {
  if (source === "local_cache") return "中台缓存";
  if (source === "miaoshou_live") return "妙手实时查询";
  return "";
}

function pendingResult(orderNumber) {
  return {
    orderNumber,
    shopAlias: "未匹配",
    platformShopName: "",
    platform: "",
    site: "",
    shopId: "",
    status: orderNumber ? "pending" : "invalid",
    source: "",
    note: orderNumber ? "等待后台匹配" : "订单号为空",
  };
}

function failedResult(orderNumber, message) {
  return {
    orderNumber,
    shopAlias: "未匹配",
    platformShopName: "",
    platform: "",
    site: "",
    shopId: "",
    status: "query_failed",
    source: "miaoshou_live",
    note: message || "妙手订单查询失败",
  };
}

function countsFor(orderNumbers, results) {
  const counts = {
    total: orderNumbers.length,
    processed: 0,
    matched: 0,
    unmatched: 0,
    needsReview: 0,
    cacheHits: 0,
    liveHits: 0,
  };
  for (const orderNumber of orderNumbers) {
    const entry = results.get(orderNumber);
    if (!entry) continue;
    counts.processed += 1;
    if (entry.result.status === "matched") counts.matched += 1;
    else if (entry.result.status === "unmatched") counts.unmatched += 1;
    else counts.needsReview += 1;
    if (entry.result.source === "local_cache") counts.cacheHits += 1;
    if (entry.result.source === "miaoshou_live" && entry.result.status === "matched") counts.liveHits += 1;
  }
  return counts;
}

function rowCountsFor(rows, results) {
  return rows.reduce((counts, row) => {
    const result = results.get(row.orderNumber)?.result || pendingResult(row.orderNumber);
    counts.total += 1;
    if (result.status === "matched") counts.matched += 1;
    else if (result.status !== "pending") counts.needsReview += 1;
    return counts;
  }, { total: 0, matched: 0, needsReview: 0 });
}

function publicJob(job) {
  const { ownerId, ownerName, ...visible } = job;
  return visible;
}

export function createMiaoshouOrderAliasJobService({ cacheDir, matcher, connector } = {}) {
  if (!cacheDir || !matcher?.match) throw new Error("订单别名后台任务缺少运行环境");
  const jobDir = resolve(cacheDir, "miaoshou-order-alias-jobs");
  const indexPath = resolve(cacheDir, "miaoshou-order-alias-jobs.json");
  mkdirSync(jobDir, { recursive: true });
  let state = loadJson(indexPath, { version: 1, updatedAt: "", jobs: [] });
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  const resultCache = new Map();
  let running = false;
  let scheduled = false;

  for (const job of state.jobs) {
    if (["running", "verifying"].includes(job.status)) {
      job.status = "queued";
      job.stage = "queued";
      job.message = "服务恢复后已重新进入后台队列";
      job.updatedAt = nowIso();
    }
  }
  persistIndex();

  function datasetPath(jobId) {
    return resolve(jobDir, `${jobId}.dataset.json`);
  }

  function resultsPath(jobId) {
    return resolve(jobDir, `${jobId}.results.ndjson`);
  }

  function persistIndex() {
    state.updatedAt = nowIso();
    atomicWriteJson(indexPath, state);
  }

  function persistDataset(jobId, dataset) {
    atomicWriteJson(datasetPath(jobId), dataset);
  }

  function loadDataset(jobId) {
    const dataset = loadJson(datasetPath(jobId), null);
    if (!dataset || !Array.isArray(dataset.rows) || !Array.isArray(dataset.headers)) {
      throw new Error("后台任务的原始数据不存在或已损坏");
    }
    return dataset;
  }

  function loadResults(jobId) {
    if (resultCache.has(jobId)) return resultCache.get(jobId);
    const results = new Map();
    if (existsSync(resultsPath(jobId))) {
      for (const line of readFileSync(resultsPath(jobId), "utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry?.orderNumber && entry?.result) results.set(entry.orderNumber, entry);
        } catch {
          // A truncated final checkpoint is ignored; earlier completed lines remain usable.
        }
      }
    }
    resultCache.set(jobId, results);
    return results;
  }

  function appendResults(jobId, entries) {
    if (!entries.length) return;
    const results = loadResults(jobId);
    appendFileSync(resultsPath(jobId), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    for (const entry of entries) results.set(entry.orderNumber, entry);
  }

  function findJob(jobId) {
    return state.jobs.find((job) => job.id === jobId) || null;
  }

  function canAccess(job, ownerId) {
    return Boolean(job && job.ownerId === ownerId);
  }

  function updateSummary(job, dataset, results) {
    job.counts = countsFor(dataset.orderNumbers, results);
    job.rowCounts = rowCountsFor(dataset.rows, results);
    job.processed = job.counts.processed;
    job.updatedAt = nowIso();
  }

  function enqueue() {
    if (scheduled || running) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void drain();
    }, 0);
  }

  async function queryBatch(job, orderNumbers, verificationPass) {
    try {
      const response = await matcher.match({ orderNumbers, forceLive: verificationPass > 1 });
      return response.results.map((result) => ({
        orderNumber: result.orderNumber,
        verificationPass,
        queryComplete: response.queryComplete || result.status !== "query_failed",
        result,
        updatedAt: nowIso(),
      }));
    } catch (error) {
      const message = error?.message || "妙手订单查询失败";
      return orderNumbers.map((orderNumber) => ({
        orderNumber,
        verificationPass,
        queryComplete: false,
        result: failedResult(orderNumber, message),
        updatedAt: nowIso(),
      }));
    }
  }

  async function runJob(job) {
    const dataset = loadDataset(job.id);
    const results = loadResults(job.id);
    job.status = "running";
    job.stage = "refreshing_shops";
    job.startedAt = job.startedAt || nowIso();
    job.message = "正在同步最新妙手店铺与别名";
    job.updatedAt = nowIso();
    persistIndex();

    try {
      if (connector?.syncShops) await connector.syncShops();
      job.directoryWarning = "";
    } catch (error) {
      job.directoryWarning = `店铺目录刷新失败，已继续使用最近一次目录：${error?.message || error}`;
    }

    job.stage = "matching";
    job.message = "正在逐个订单精确查询全部平台与店铺范围";
    persistIndex();
    const firstPassPending = dataset.orderNumbers.filter((orderNumber) => !results.has(orderNumber));
    for (const batch of chunks(firstPassPending, MATCH_BATCH_SIZE)) {
      appendResults(job.id, await queryBatch(job, batch, 1));
      updateSummary(job, dataset, results);
      job.progressPercent = Math.min(80, Math.round((job.processed / Math.max(1, job.total)) * 80));
      persistIndex();
    }

    const verificationTargets = dataset.orderNumbers.filter((orderNumber) => {
      const entry = results.get(orderNumber);
      return entry && entry.verificationPass < 2 && ["unmatched", "query_failed"].includes(entry.result.status);
    });
    job.status = "verifying";
    job.stage = "verifying";
    job.verificationTotal = verificationTargets.length;
    job.verificationCompleted = 0;
    job.message = verificationTargets.length
      ? "正在对未命中与接口异常订单进行第二次独立复查"
      : "已完成全部订单核验";
    job.progressPercent = verificationTargets.length ? 80 : 100;
    persistIndex();

    for (const batch of chunks(verificationTargets, MATCH_BATCH_SIZE)) {
      appendResults(job.id, await queryBatch(job, batch, 2));
      job.verificationCompleted += batch.length;
      updateSummary(job, dataset, results);
      job.progressPercent = 80 + Math.round((job.verificationCompleted / Math.max(1, job.verificationTotal)) * 20);
      persistIndex();
    }

    updateSummary(job, dataset, results);
    job.status = job.counts.needsReview ? "completed_with_warnings" : "completed";
    job.stage = "completed";
    job.progressPercent = 100;
    job.completedAt = nowIso();
    job.downloadReady = true;
    job.message = job.counts.needsReview
      ? `任务完成：${job.counts.matched} 个订单已匹配，${job.counts.unmatched} 个确认未匹配，${job.counts.needsReview} 个需要复核`
      : `任务完成：${job.counts.matched} 个订单已匹配，${job.counts.unmatched} 个确认未匹配`;
    persistIndex();
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (true) {
        const job = state.jobs.find((candidate) => candidate.status === "queued");
        if (!job) break;
        try {
          await runJob(job);
        } catch (error) {
          job.status = "failed";
          job.stage = "failed";
          job.message = error?.message || "后台匹配任务执行失败";
          job.updatedAt = nowIso();
          job.completedAt = nowIso();
          persistIndex();
        }
      }
    } finally {
      running = false;
    }
  }

  function create(input = {}, owner = {}) {
    const rawHeaders = Array.isArray(input.headers) ? input.headers : [];
    const rawRows = Array.isArray(input.rows) ? input.rows : [];
    if (!rawHeaders.length) throw new Error("导入数据缺少表头");
    if (rawHeaders.length > MAX_COLUMNS) throw new Error(`导入文件最多支持 ${MAX_COLUMNS} 列`);
    if (!rawRows.length) throw new Error("导入文件没有数据行");
    if (rawRows.length > MAX_ROWS) throw new Error(`单个后台任务最多支持 ${MAX_ROWS} 行`);
    const headers = rawHeaders.map((header, index) => safeCell(header) || `未命名列${index + 1}`);
    const rows = rawRows.map((row, index) => ({
      rowNumber: Number(row?.rowNumber) > 0 ? Number(row.rowNumber) : index + 2,
      cells: headers.map((_, cellIndex) => safeCell(Array.isArray(row?.cells) ? row.cells[cellIndex] : "")),
      orderNumber: normalizeMiaoshouOrderNumber(row?.orderNumber),
    }));
    const orderNumbers = [...new Set(rows.map((row) => row.orderNumber).filter(Boolean))];
    if (!orderNumbers.length) throw new Error("导入文件没有有效的平台订单号");
    const createdAt = nowIso();
    const id = `alias-${createdAt.replace(/\D/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const sourceName = basename(safeCell(input.sourceName) || "手动粘贴");
    const job = {
      id,
      type: "miaoshou_order_alias",
      sourceName,
      ownerId: safeCell(owner.id) || "unknown",
      ownerName: safeCell(owner.displayName || owner.username) || "未知用户",
      status: "queued",
      stage: "queued",
      message: "任务已进入后台队列，关闭页面不会中断",
      createdAt,
      updatedAt: createdAt,
      startedAt: "",
      completedAt: "",
      total: orderNumbers.length,
      rowCount: rows.length,
      processed: 0,
      progressPercent: 0,
      verificationTotal: 0,
      verificationCompleted: 0,
      directoryWarning: "",
      downloadReady: false,
      counts: { total: orderNumbers.length, processed: 0, matched: 0, unmatched: 0, needsReview: 0, cacheHits: 0, liveHits: 0 },
      rowCounts: { total: rows.length, matched: 0, needsReview: 0 },
    };
    persistDataset(id, { version: 1, sourceName, headers, rows, orderNumbers });
    state.jobs.push(job);
    persistIndex();
    enqueue();
    return publicJob(job);
  }

  function list(ownerId) {
    return {
      ok: true,
      updatedAt: state.updatedAt,
      jobs: state.jobs
        .filter((job) => canAccess(job, ownerId))
        .slice()
        .reverse()
        .slice(0, 50)
        .map(publicJob),
    };
  }

  function detail(jobId, ownerId) {
    const job = findJob(jobId);
    if (!canAccess(job, ownerId)) return null;
    const dataset = loadDataset(job.id);
    const results = loadResults(job.id);
    return {
      ok: true,
      job: publicJob(job),
      previewRows: dataset.rows.slice(0, PREVIEW_ROWS).map((row) => ({
        rowNumber: row.rowNumber,
        orderNumber: row.orderNumber,
        result: results.get(row.orderNumber)?.result || pendingResult(row.orderNumber),
      })),
      previewLimit: PREVIEW_ROWS,
    };
  }

  function download(jobId, ownerId) {
    const job = findJob(jobId);
    if (!canAccess(job, ownerId)) return null;
    if (!job.downloadReady) throw new Error("任务尚未完成，暂时不能下载");
    const dataset = loadDataset(job.id);
    const results = loadResults(job.id);
    const extraHeaders = ["店铺别名", "匹配状态", "平台", "站点", "妙手店铺ID", "妙手店铺名称", "匹配来源", "备注"];
    const lines = [dataset.headers.concat(extraHeaders).map(csvCell).join(",")];
    for (const row of dataset.rows) {
      const result = results.get(row.orderNumber)?.result || pendingResult(row.orderNumber);
      lines.push([
        ...row.cells,
        result.shopAlias || "未匹配",
        statusLabel(result.status),
        result.platform,
        result.site,
        result.shopId,
        result.platformShopName,
        sourceLabel(result.source),
        result.note,
      ].map(csvCell).join(","));
    }
    return {
      fileName: `妙手店铺别名匹配-${job.createdAt.slice(0, 10)}-${job.id.slice(-8)}.csv`,
      content: `\uFEFF${lines.join("\r\n")}`,
    };
  }

  enqueue();
  return { create, detail, download, list };
}

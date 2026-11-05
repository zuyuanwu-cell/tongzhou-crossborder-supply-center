"use strict";

// 采集编排：校准（探测接口 → 生成模板 → 试采）与正式采集（逐店铺打开紫鸟 → 页面内重放接口 → 取值 → 回写中台）。

const { getPlatform } = require("./platforms");
const { hookBody, probeBody, pageInfoBody, replayBody } = require("./page-scripts");
const { templatizeRequest, flattenNumbers, suggestMetrics, extractMetrics, fillRequest, placeholderValues, validateTemplate, METRIC_KEYS } = require("./recipe");
const { siteInfo, siteToday, addDays, dateList } = require("./sites");
const { newId } = require("./config");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(textValue) {
  try {
    return JSON.parse(textValue);
  } catch {
    return null;
  }
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

class Collector {
  constructor({ cli, store, log = () => {}, zhongtaiFactory, waits = {} }) {
    this.cli = cli;
    this.waits = { fresh: 5000, reused: 2500, visit: 3000, retry: 5000, ...waits };
    this.store = store;
    this.log = log;
    this.zhongtaiFactory = zhongtaiFactory;
    this.discoveries = new Map();
    this.running = null;
    this.cancelRequested = false;
  }

  config() {
    return this.store.get();
  }

  // -------------------------------------------------------------------------
  // 店铺
  // -------------------------------------------------------------------------

  async refreshStores() {
    const stores = await this.cli.listStores();
    this.store.update((config) => {
      config.storeCache = stores.map(({ raw, ...store }) => store);
      config.storeCacheAt = new Date().toISOString();
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

  async ensurePage(storeId, platform, url) {
    let info = await this.cli.runInPage(storeId, pageInfoBody(), { timeoutMs: 30000 });
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
      await sleep(this.waits.visit);
      info = await this.cli.runInPage(storeId, pageInfoBody(), { timeoutMs: 30000 });
      check = platform.checkPage(info);
    }
    if (!check.ok) {
      const error = new Error(check.message);
      error.code = check.code;
      throw error;
    }
    return info;
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
    template.collectPage = discovery.href || template.collectPage;
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

  /** 按模板试采某一天，返回各接口的数值叶子和取到的字段值，供人工核对。 */
  async testTemplate({ storeId, template, date, target = {} }) {
    const platform = getPlatform(template.platform);
    await this.openAt(storeId, template.collectPage);
    await this.ensurePage(storeId, platform, template.collectPage);
    const values = placeholderValues({ date, site: target.country || "SG", shopId: target.shopId || "" });
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

  plan({ storeIds = null } = {}) {
    const config = this.config();
    const plan = [];
    const skipped = [];
    for (const store of Object.values(config.stores)) {
      if (storeIds && !storeIds.includes(store.storeId)) continue;
      if (!storeIds && !store.enabled) continue;
      const targets = (store.targets || []).filter((target) => target.enabled !== false && target.shopName);
      const template = config.templates[store.templateId];
      if (!targets.length) {
        skipped.push({ storeId: store.storeId, storeName: store.storeName, reason: "没有配置对应的中台店铺" });
        continue;
      }
      if (!template) {
        skipped.push({ storeId: store.storeId, storeName: store.storeName, reason: "没有选择采集模板" });
        continue;
      }
      const problems = validateTemplate(template).filter((problem) => !/没有日期参数/.test(problem));
      if (problems.length) {
        skipped.push({ storeId: store.storeId, storeName: store.storeName, reason: `模板「${template.name}」不完整：${problems.join("；")}` });
        continue;
      }
      plan.push({ store, targets, template });
    }
    return { plan, skipped };
  }

  async collectStore({ store, targets, template }, { dates, onProgress = () => {} }) {
    const platform = getPlatform(template.platform);
    const { closeAfter, storeTimeoutSec } = this.config().ziniao;
    const rows = [];
    const issues = [];
    let reused = false;
    try {
      onProgress({ storeId: store.storeId, phase: "open", message: `打开 ${store.storeName}` });
      ({ reused } = await this.openAt(store.storeId, template.collectPage));
      await this.ensurePage(store.storeId, platform, template.collectPage);
      const requests = [];
      for (const target of targets) {
        const targetDates = dates[target.country] || dates.default;
        for (const date of targetDates) {
          const values = placeholderValues({ date, site: target.country, shopId: target.shopId || "" });
          for (const endpoint of template.endpoints) requests.push({ key: `${target.id}|${date}|${endpoint.id}`, ...fillRequest(endpoint, values) });
        }
      }
      onProgress({ storeId: store.storeId, phase: "fetch", message: `${store.storeName}：请求 ${requests.length} 个接口` });
      const timeoutMs = Math.max(60, Number(storeTimeoutSec) || 240) * 1000;
      const replay = await this.cli.runInPage(store.storeId, replayBody(requests), { timeoutMs });
      for (const target of targets) {
        const info = siteInfo(target.country);
        const targetDates = dates[target.country] || dates.default;
        for (const date of targetDates) {
          const responses = {};
          for (const endpoint of template.endpoints) {
            const result = replay.results?.[`${target.id}|${date}|${endpoint.id}`] || { status: 0, error: "无返回" };
            const error = result.error || (result.status !== 200 ? `HTTP ${result.status}` : businessError(result.json));
            responses[endpoint.id] = { ...result, error };
            if (error) issues.push({ level: "error", storeName: store.storeName, shopName: target.shopName, date, message: `${endpoint.label}：${error}` });
          }
          const { values, missing } = extractMetrics(template, responses);
          if (!Object.keys(values).length) {
            issues.push({ level: "warn", storeName: store.storeName, shopName: target.shopName, date, message: "没有取到任何字段，已跳过" });
            continue;
          }
          if (missing.length) issues.push({ level: "warn", storeName: store.storeName, shopName: target.shopName, date, message: `缺少字段：${missing.join("、")}` });
          rows.push({
            date,
            shopKey: target.shopKey || undefined,
            shopName: target.shopName,
            country: info?.name || target.country,
            platform: platform.name,
            currency: target.currency || info?.currency || "",
            ...values,
            _store: store.storeName,
          });
        }
      }
      return { ok: true, rows, issues };
    } finally {
      if (closeAfter && !reused) await this.cli.closeStore({ storeId: store.storeId });
    }
  }

  /**
   * 执行采集。dates：日期数组（所有站点相同）或 null（按各店铺站点时区自动取最近 N 天）。
   * mode：upload（写入中台）| preview（中台试匹配，不写入）| local（只采集不连中台）。
   */
  async collect({ storeIds = null, dates = null, mode = "upload", trigger = "manual", onProgress = () => {} } = {}) {
    if (this.running) throw new Error("已有采集任务在运行");
    const config = this.config();
    const runId = newId("run");
    const startedAt = new Date().toISOString();
    this.cancelRequested = false;
    const { plan, skipped } = this.plan({ storeIds });
    const entry = { id: runId, trigger, mode, startedAt, finishedAt: "", status: "running", stores: [], rowCount: 0, issues: [], upload: null };
    this.running = entry;
    const allRows = [];
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
          dateMap[target.country] = Array.isArray(dates) && dates.length ? dates : defaultDates({ ...config.schedule, site: target.country });
        }
        dateMap.default = Array.isArray(dates) && dates.length ? dates : defaultDates(config.schedule);
        onProgress({ index, total: plan.length, storeId: item.store.storeId, phase: "start", message: `(${index + 1}/${plan.length}) ${item.store.storeName}` });
        const attempts = 1 + Math.max(0, Number(config.ziniao.retryPerStore) || 0);
        let result = null;
        let lastError = null;
        for (let attempt = 1; attempt <= attempts && !result; attempt += 1) {
          try {
            result = await this.collectStore(item, { dates: dateMap, onProgress });
          } catch (error) {
            lastError = error;
            this.log("warn", `${item.store.storeName} 第 ${attempt} 次采集失败：${error.message}`);
            if (["NOT_LOGGED_IN", "CAPTCHA"].includes(error.code)) break;
            if (attempt < attempts) await sleep(this.waits.retry);
          }
        }
        if (result) {
          allRows.push(...result.rows);
          entry.issues.push(...result.issues);
          const hasError = result.issues.some((issue) => issue.level === "error");
          entry.stores.push({ storeId: item.store.storeId, storeName: item.store.storeName, status: hasError ? "partial" : "ok", message: hasError ? "部分接口失败" : "", rowCount: result.rows.length });
          this.log("info", `${item.store.storeName}：${result.rows.length} 行`);
        } else {
          entry.stores.push({ storeId: item.store.storeId, storeName: item.store.storeName, status: "failed", message: lastError?.message || "失败", rowCount: 0 });
          entry.issues.push({ level: "error", storeName: item.store.storeName, message: lastError?.message || "失败" });
        }
        onProgress({ index: index + 1, total: plan.length, storeId: item.store.storeId, phase: "done", message: `${item.store.storeName} 完成` });
      }
      entry.rowCount = allRows.length;
      const rows = allRows.map(({ _store, ...row }) => {
        for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
        return row;
      });
      if (rows.length && mode !== "local") {
        onProgress({ phase: "upload", message: mode === "preview" ? "中台试匹配…" : `写入中台 ${rows.length} 行…` });
        try {
          const client = this.zhongtaiFactory();
          const result = await client.ingest(rows, { dryRun: mode === "preview" });
          entry.upload = { ok: true, dryRun: mode === "preview", rowCount: result.rowCount, written: result.written, shopCount: result.shopCount, errors: result.errors.slice(0, 50), warnings: result.warnings.slice(0, 50), at: new Date().toISOString() };
        } catch (error) {
          entry.upload = { ok: false, message: error.message, at: new Date().toISOString() };
        }
      }
      const failed = entry.stores.filter((store) => store.status === "failed").length;
      entry.status = this.cancelRequested ? "cancelled" : entry.upload && !entry.upload.ok ? "upload_failed" : failed && failed === plan.length ? "failed" : failed || entry.issues.some((issue) => issue.level === "error") ? "partial" : "ok";
      entry.finishedAt = new Date().toISOString();
      entry.issues = entry.issues.slice(0, 300);
      this.store.appendHistory({ ...entry, rows: allRows });
      return entry;
    } finally {
      this.running = null;
    }
  }

  /** 重新上传某次采集结果（例如当时中台不可用）。 */
  async reupload(runId, { dryRun = false } = {}) {
    const rows = this.store.resultRows(runId).map(({ _store, ...row }) => row);
    if (!rows.length) throw new Error("这次采集没有可上传的数据");
    const result = await this.zhongtaiFactory().ingest(rows, { dryRun });
    const upload = { ok: true, dryRun, rowCount: result.rowCount, written: result.written, shopCount: result.shopCount, errors: result.errors.slice(0, 50), warnings: result.warnings.slice(0, 50), at: new Date().toISOString() };
    if (!dryRun) this.store.updateHistory(runId, { upload, status: "ok" });
    return upload;
  }
}

module.exports = { Collector, defaultDates, businessError, METRIC_KEYS };

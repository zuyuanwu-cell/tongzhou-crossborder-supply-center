"use strict";

// 同舟供应链中台客户端：只使用采集专用令牌（X-Ingest-Token），不需要中台登录账号。

const CHUNK = 2000;

class ZhongtaiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.name = "ZhongtaiError";
    this.status = status;
    this.body = body;
  }
}

class ZhongtaiClient {
  constructor({ baseUrl = "", token = "", fetchImpl = fetch, timeoutMs = 60000 } = {}) {
    this.baseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
    this.token = String(token || "").trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  ensureConfigured() {
    if (!/^https?:\/\//.test(this.baseUrl)) throw new ZhongtaiError("请先在「设置」里填写中台地址，例如 https://gyl.tongzhoukuajing.com");
    if (this.token.length < 24) throw new ZhongtaiError("请先在「设置」里填写采集令牌（服务器 SHOP_METRICS_INGEST_TOKEN 的值，至少 24 位）");
  }

  async request(pathname, { method = "GET", body } = {}) {
    this.ensureConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: { "content-type": "application/json", "x-ingest-token": this.token, "x-client": "tongzhou-zhishu" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ZhongtaiError(error.name === "AbortError" ? "连接中台超时" : `连接中台失败：${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    const textValue = await response.text();
    let json = null;
    try {
      json = JSON.parse(textValue);
    } catch {
      json = null;
    }
    if (!response.ok || (json && json.ok === false)) {
      const message = json?.message || (response.status === 404 ? "中台没有这个接口（可能需要先更新中台版本）" : `中台返回 HTTP ${response.status}`);
      throw new ZhongtaiError(message, { status: response.status, body: json || textValue.slice(0, 500) });
    }
    return json;
  }

  /** 用 0 行试写验证地址与令牌。 */
  async ping() {
    const result = await this.request("/api/shop-daily-report/ingest", { method: "POST", body: { source: "ziniao", dryRun: true, rows: [] } });
    return { ok: true, result };
  }

  /** 中台店铺列表（需要中台已更新到包含 /ingest/shops 的版本；旧版本返回 null）。 */
  async listShops() {
    try {
      const result = await this.request("/api/shop-daily-report/ingest/shops");
      return Array.isArray(result?.shops) ? result.shops : [];
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  /** 分批写入；dryRun 时只预览匹配结果。返回合并后的结果。 */
  async ingest(rows, { dryRun = false, source = "ziniao" } = {}) {
    const merged = { rowCount: 0, shopCount: 0, written: 0, errors: [], warnings: [], sample: [], batches: 0 };
    const shopKeys = new Set();
    let reportedShops = 0;
    for (let index = 0; index < rows.length; index += CHUNK) {
      const chunk = rows.slice(index, index + CHUNK);
      const result = await this.request("/api/shop-daily-report/ingest", { method: "POST", body: { source, dryRun, rows: chunk } });
      merged.batches += 1;
      merged.rowCount += Number(result.rowCount || 0);
      merged.written += Number(result.written || 0);
      reportedShops += Number(result.shopCount || 0);
      merged.errors.push(...(result.errors || []));
      merged.warnings.push(...(result.warnings || []));
      for (const row of result.sample || []) {
        shopKeys.add(row.shopKey);
        if (merged.sample.length < 60) merged.sample.push(row);
      }
    }
    merged.shopCount = Math.max(shopKeys.size, reportedShops);
    merged.dryRun = dryRun;
    return merged;
  }
}

module.exports = { ZhongtaiClient, ZhongtaiError };

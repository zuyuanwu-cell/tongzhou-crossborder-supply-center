"use strict";

const { MiaoshouError } = require("./miaoshou");

const QUERY_SIZE = 20;
const PAGE_SIZE = 50;
const POLL_INTERVAL = 5 * 60_000;
const DAY = 24 * 60 * 60_000;
const key = ({ shopId, orderNo }) => JSON.stringify([shopId, orderNo]);

async function readReviewMarks(requestPage, candidates) {
  const requested = new Map(candidates.map((order) => [key(order), order]));
  const orderNos = [...new Set(candidates.map((order) => order.orderNo))];
  const marks = new Map();
  for (let i = 0; i < orderNos.length; i += QUERY_SIZE) {
    const batch = orderNos.slice(i, i + QUERY_SIZE);
    if (batch.some((no) => /[,\r\n]/.test(no))) throw new MiaoshouError("妙手查询包含无法批量匹配的订单号。");
    const allowed = new Set(batch);
    for (let page = 1; ; page += 1) {
      const result = await requestPage({
        source: "orderProcess", appPackageTab: "all", sortField: "gmtOrderStart", sortType: "desc",
        platformOrderSns: batch.join(","), platformOrderSnsRp: "eq", page, pageSize: PAGE_SIZE,
      });
      const total = Number(result?.total);
      if (!Array.isArray(result?.orders) || result.total == null || !Number.isSafeInteger(total) || total < 0 ||
          total > PAGE_SIZE * 12 || result.packageCount !== Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE))) {
        throw new MiaoshouError("妙手订单分页返回异常，本轮数据未提交。");
      }
      for (const row of result.orders) {
        const id = key(row);
        if (!allowed.has(row.orderNo) || !requested.has(id) || !["0", "1"].includes(row.mark)) continue;
        const marked = row.mark === "1";
        if (!marks.has(id)) marks.set(id, marked);
        else if (marks.get(id) !== marked) marks.set(id, null);
      }
      if (page * PAGE_SIZE >= total) break;
    }
  }
  return [...marks].filter(([, marked]) => marked !== null).map(([id, marked]) => ({ ...requested.get(id), marked }));
}

class MiaoshouReviewSync {
  constructor({ requestPage, isActive, log, now = Date.now }) {
    this.requestPage = requestPage;
    this.isActive = isActive;
    this.log = log;
    this.now = now;
    this.recent = null;
    this.history = null;
    this.historyCompletedAt = null;
    this.lastAttempt = null;
    this.busy = false;
  }

  async tick(client) {
    const started = this.now();
    if (this.busy || !this.isActive() || (this.lastAttempt !== null && started - this.lastAttempt < POLL_INTERVAL)) return;
    this.busy = true;
    this.lastAttempt = started;
    try {
      const historyDue = this.historyCompletedAt === null || started - this.historyCompletedAt >= DAY;
      const plan = await client.agent("miaoshou-review-orders", { action: "plan", recent: this.recent, history: historyDue ? this.history : false });
      if (plan.unboundShopCount) this.log("warn", `妙手测评同步有 ${plan.unboundShopCount} 家店铺没有唯一有效的中台绑定。`);
      const candidates = [...plan.recent.orders, ...(plan.history?.orders || [])];
      if (candidates.length) {
        const observations = await readReviewMarks(this.requestPage, candidates);
        if (!this.isActive()) return;
        const unknown = new Set(candidates.map(key)).size - observations.length;
        const result = observations.length ? await client.agent("miaoshou-review-orders", {
          action: "sync", observedAt: new Date(started).toISOString(), observations,
        }) : null;
        const label = plan.mode === "preview" ? "妙手测评同步预览" : "妙手测评同步";
        const summary = result ? `新增 ${result.added}，更新 ${result.updated}，撤标 ${result.removed}，已有手工记录 ${result.manual}，已有汇总待对账 ${result.importedDay}，待结算 ${result.missingSettlement}，未匹配 ${result.unmatched}。` : "未取得有效测评标记。";
        this.log(unknown || result?.unmatched ? "warn" : "info", `${label}，已核对 ${observations.length} 笔，状态不明 ${unknown} 笔。${summary}`);
      }
      this.recent = plan.recent.next;
      if (plan.history) {
        this.history = plan.history.next;
        if (!this.history) this.historyCompletedAt = started;
      }
    } catch (error) {
      this.log("warn", `妙手测评同步失败：${error.message}`);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { readReviewMarks, MiaoshouReviewSync };

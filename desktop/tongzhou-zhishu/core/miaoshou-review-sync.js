"use strict";

const { MiaoshouError } = require("./miaoshou");

const QUERY_SIZE = 20;
const PAGE_SIZE = 50;
const POLL_INTERVAL = 5 * 60_000;
const key = ({ shopId, orderNo }) => JSON.stringify([shopId, orderNo]);
const HISTORY_QUERY = {
  source: "orderHistory", appPackageTab: "all", sortField: "gmtOrderStart", sortType: "desc",
  waitProcessTab: "all", supplierProcessStatus: "all", isLogisticsCompanyGroupMode: "1",
};

async function* reviewPages(requestPage, filters) {
  let expectedTotal = null;
  for (let page = 1; ; page += 1) {
    const result = await requestPage({ ...HISTORY_QUERY, ...filters, page, pageSize: PAGE_SIZE });
    const total = Number(result?.total);
    if (!Array.isArray(result?.orders) || result.total == null || !Number.isSafeInteger(total) || total < 0 ||
        total > PAGE_SIZE * 12 || (expectedTotal !== null && expectedTotal !== total) ||
        result.packageCount !== Math.min(PAGE_SIZE, Math.max(0, total - (page - 1) * PAGE_SIZE))) {
      throw new MiaoshouError("妙手订单分页返回异常，本轮数据未提交。");
    }
    expectedTotal = total;
    yield result.orders;
    if (page * PAGE_SIZE >= total) break;
  }
}

async function readMarkedReviewOrders(requestPage) {
  const marked = new Map();
  for await (const orders of reviewPages(requestPage, { orderTagsRp: "includeAll", "orderTags[0]": "marketingOrder" })) {
    for (const row of orders) {
      if (row.mark !== "1" || !row.shopId || !row.orderNo) throw new MiaoshouError("妙手测评筛选返回了无效订单标记。");
      marked.set(key(row), { shopId: row.shopId, orderNo: row.orderNo, marked: true, orderStartedAt: row.orderStartedAt });
    }
  }
  return [...marked.values()];
}

async function readReviewMarks(requestPage, candidates) {
  const requested = new Map(candidates.map((order) => [key(order), order]));
  const orderNos = [...new Set(candidates.map((order) => order.orderNo))];
  const marks = new Map();
  for (let i = 0; i < orderNos.length; i += QUERY_SIZE) {
    const batch = orderNos.slice(i, i + QUERY_SIZE);
    if (batch.some((no) => /[,\r\n]/.test(no))) throw new MiaoshouError("妙手查询包含无法批量匹配的订单号。");
    const allowed = new Set(batch);
    for await (const orders of reviewPages(requestPage, { platformOrderSns: batch.join(","), platformOrderSnsRp: "eq" })) {
      for (const row of orders) {
        const id = key(row);
        if (!allowed.has(row.orderNo) || !requested.has(id) || !["0", "1"].includes(row.mark)) continue;
        const marked = row.mark === "1";
        if (!marks.has(id)) marks.set(id, marked);
        else if (marks.get(id) !== marked) marks.set(id, null);
      }
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
    this.lastAttempt = null;
    this.busy = false;
  }

  async tick(client) {
    const started = this.now();
    if (this.busy || !this.isActive() || (this.lastAttempt !== null && started - this.lastAttempt < POLL_INTERVAL)) return;
    this.busy = true;
    this.lastAttempt = started;
    try {
      const plan = await client.agent("miaoshou-review-orders", { action: "plan", strategy: "marked" });
      if (plan.unboundShopCount) this.log("warn", `妙手测评同步有 ${plan.unboundShopCount} 家店铺没有唯一有效的中台绑定。`);
      const marked = await readMarkedReviewOrders(this.requestPage);
      const present = new Set(marked.map(key));
      const candidates = (plan.tracked || []).filter((row) => !present.has(key(row)));
      const reviewed = await readReviewMarks(this.requestPage, candidates);
      if (!this.isActive()) return;
      const withinRange = marked.filter((row) => {
        // 为各站点保留日期边界，由服务端的订单时间做最终校验。
        const day = row.orderStartedAt?.slice(0, 10);
        return !plan.earliestCandidateDate || !/^\d{4}-\d{2}-\d{2}$/.test(day || "") || day >= plan.earliestCandidateDate;
      });
      const observations = [...withinRange, ...reviewed];
      const counts = { added: 0, updated: 0, removed: 0, manual: 0, importedDay: 0, missingSettlement: 0, unmatched: 0, outsideWindow: 0 };
      counts.outsideWindow = marked.length - withinRange.length;
      for (let offset = 0; offset < observations.length; offset += 160) {
        const result = await client.agent("miaoshou-review-orders", {
          action: "sync", observedAt: new Date(started).toISOString(), observations: observations.slice(offset, offset + 160),
        });
        for (const field of Object.keys(counts)) counts[field] += Number(result[field]) || 0;
      }
      const unknown = candidates.length - reviewed.length;
      const label = plan.mode === "preview" ? "妙手测评同步预览" : "妙手测评同步";
      this.log(unknown || counts.unmatched ? "warn" : "info",
        `${label}，标记 ${marked.length} 笔，范围外 ${counts.outsideWindow}，新增 ${counts.added}，更新 ${counts.updated}，撤标 ${counts.removed}，已有手工记录 ${counts.manual}，已有汇总待对账 ${counts.importedDay}，待结算 ${counts.missingSettlement}，未匹配 ${counts.unmatched}，撤标状态待确认 ${unknown}。`);
    } catch (error) {
      this.log("warn", `妙手测评同步失败：${error.message}`);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { readMarkedReviewOrders, readReviewMarks, MiaoshouReviewSync };

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMiaoshouOrderAliasJobService } from "../server/miaoshou-order-alias-jobs.js";

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-alias-jobs-"));
let shopRefreshes = 0;
const attempts = new Map();
const matcher = {
  async match({ orderNumbers, forceLive }) {
    return {
      ok: true,
      queryComplete: true,
      results: orderNumbers.map((orderNumber) => {
        attempts.set(orderNumber, (attempts.get(orderNumber) || 0) + 1);
        if (orderNumber === "SECOND-PASS" && forceLive) {
          return {
            orderNumber,
            shopAlias: "复查命中店铺",
            platformShopName: "Second Pass Shop",
            platform: "shopee",
            site: "ID",
            shopId: "SHOP-2",
            status: "matched",
            source: "miaoshou_live",
            note: "二次复查命中",
          };
        }
        if (orderNumber === "SECOND-PASS") {
          return {
            orderNumber,
            shopAlias: "未匹配",
            platformShopName: "",
            platform: "",
            site: "",
            shopId: "",
            status: "unmatched",
            source: "miaoshou_live",
            note: "首次未命中",
          };
        }
        if (orderNumber === "REVIEW") {
          return {
            orderNumber,
            shopAlias: "未匹配",
            platformShopName: "",
            platform: "",
            site: "",
            shopId: "",
            status: "query_failed",
            source: "miaoshou_live",
            note: "接口暂时不可用",
          };
        }
        return {
          orderNumber,
          shopAlias: "已命中店铺",
          platformShopName: "Matched Shop",
          platform: "shopee",
          site: "ID",
          shopId: "SHOP-1",
          status: "matched",
          source: "local_cache",
          note: "缓存精确命中",
        };
      }),
    };
  },
};
const connector = {
  async syncShops() { shopRefreshes += 1; },
};

const owner = { id: "USER-1", displayName: "测试用户" };
const service = createMiaoshouOrderAliasJobService({ cacheDir, matcher, connector });
const job = service.create({
  sourceName: "orders.csv",
  headers: ["平台订单号", "备注"],
  rows: [
    { rowNumber: 2, cells: ["MATCHED", "第一行"], orderNumber: "MATCHED" },
    { rowNumber: 3, cells: ["SECOND-PASS", "第二行"], orderNumber: "SECOND-PASS" },
    { rowNumber: 4, cells: ["REVIEW", "第三行"], orderNumber: "REVIEW" },
    { rowNumber: 5, cells: ["MATCHED", "重复行"], orderNumber: "MATCHED" },
  ],
}, owner);

assert.equal(job.status, "queued");
assert.equal(job.total, 3);
assert.equal(job.rowCount, 4);
assert.equal(service.detail(job.id, "OTHER"), null);

let completed;
for (let index = 0; index < 100; index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  completed = service.list(owner.id).jobs.find((entry) => entry.id === job.id);
  if (completed && !["queued", "running", "verifying"].includes(completed.status)) break;
}

assert.equal(shopRefreshes, 1);
assert.equal(completed?.status, "completed_with_warnings");
assert.equal(completed?.progressPercent, 100);
assert.equal(completed?.counts.matched, 2);
assert.equal(completed?.counts.needsReview, 1);
assert.equal(completed?.rowCounts.matched, 3);
assert.equal(attempts.get("SECOND-PASS"), 2);
assert.equal(attempts.get("REVIEW"), 2);

const detail = service.detail(job.id, owner.id);
assert.equal(detail.previewRows.length, 4);
assert.equal(detail.previewRows[1].result.shopAlias, "复查命中店铺");
const download = service.download(job.id, owner.id);
assert.match(download.content, /^\uFEFF/);
assert.match(download.content, /复查命中店铺/);
assert.match(download.content, /接口暂时不可用/);

const recovered = createMiaoshouOrderAliasJobService({ cacheDir, matcher, connector });
assert.equal(recovered.list(owner.id).jobs[0].id, job.id);
assert.equal(recovered.detail(job.id, owner.id).job.downloadReady, true);

console.log("miaoshou order alias background job tests passed");

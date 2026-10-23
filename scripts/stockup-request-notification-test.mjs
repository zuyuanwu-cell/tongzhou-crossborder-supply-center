import assert from "node:assert/strict";
import { buildStockupRequestSubmittedMarkdown } from "../server/stockup-notifications.js";

const markdown = buildStockupRequestSubmittedMarkdown({
  id: "spr-test",
  requestNo: "BR-20261020-TEST",
  project: "凌云团队",
  destinationCountry: "俄罗斯",
  destinationWarehouseName: "俄罗斯2仓",
  expectedArrivalAt: "2026-11-10",
  priority: "紧急",
  requesterName: "测试运营",
  lines: [
    { requestedQty: 100, unit: "件" },
    { requestedQty: 20, unit: "件" },
  ],
}, { requestOrigin: "https://gyl.tongzhoukuajing.com" });

assert.match(markdown, /新备货需求待认领/);
assert.match(markdown, /BR-20261020-TEST/);
assert.match(markdown, /120 件/);
assert.match(markdown, /供应链负责人请进入执行台认领/);
assert.match(markdown, /https:\/\/gyl\.tongzhoukuajing\.com\/\?stockupRequest=spr-test#stockup-execution/);
console.log("stockup request notification tests passed");

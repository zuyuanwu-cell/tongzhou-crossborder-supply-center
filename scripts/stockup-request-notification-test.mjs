import assert from "node:assert/strict";
import {
  buildStockupRequestProgressMarkdown,
  buildStockupRequestSubmittedMarkdown,
  normalizeStockupProgressNodes,
  resolveStockupSceneDelivery,
} from "../server/stockup-notifications.js";

const request = {
  id: "spr-test",
  requestNo: "BR-20261020-TEST",
  project: "凌云团队",
  destinationCountry: "俄罗斯",
  destinationWarehouseName: "俄罗斯2仓",
  expectedArrivalAt: "2026-11-10",
  priority: "紧急",
  requesterName: "测试运营",
  status: "in_progress",
  journeyStage: "consolidating",
  lines: [
    { requestedQty: 100, unit: "件" },
    { requestedQty: 20, unit: "件" },
  ],
};

const submitted = buildStockupRequestSubmittedMarkdown(request, {
  requestOrigin: "https://gyl.tongzhoukuajing.com",
  extraText: "请供应链当天认领。",
});

assert.match(submitted, /新备货需求待接单/);
assert.match(submitted, /BR-20261020-TEST/);
assert.match(submitted, /120 件/);
assert.match(submitted, /供应链负责人请进入执行台认领/);
assert.match(submitted, /国内现货、跨仓调拨、采购或委外生产/);
assert.match(submitted, /请供应链当天认领/);
assert.match(submitted, /https:\/\/gyl\.tongzhoukuajing\.com\/\?stockupRequest=spr-test#stockup-execution/);

const progress = buildStockupRequestProgressMarkdown(request, {
  node: "shipment_dispatched",
  detail: "FY-TEST 已发运，物流单号 TRACK-001。",
  actorName: "物流专员",
}, {
  requestOrigin: "https://gyl.tongzhoukuajing.com",
  extraText: "运营仅接收已配置的关键节点。",
});

assert.match(progress, /备货需求进度：货物已发运/);
assert.match(progress, /FY-TEST 已发运/);
assert.match(progress, /物流专员/);
assert.match(progress, /运营仅接收已配置的关键节点/);

assert.deepEqual(normalizeStockupProgressNodes(["accepted", "accepted", "unknown", "shipment_dispatched"]), ["accepted", "shipment_dispatched"]);
assert.deepEqual(resolveStockupSceneDelivery({ enabled: false, robotIds: ["ops"] }), { shouldSend: false, reason: "disabled", robotIds: [] });
assert.deepEqual(resolveStockupSceneDelivery({ enabled: true, robotIds: [] }), { shouldSend: false, reason: "recipients_missing", robotIds: [] });
assert.equal(resolveStockupSceneDelivery({ enabled: true, robotIds: ["ops"], progressNodes: [] }, "accepted").reason, "node_disabled");
assert.deepEqual(resolveStockupSceneDelivery({ enabled: true, robotIds: ["ops"], progressNodes: ["accepted"] }, "accepted"), { shouldSend: true, reason: "ready", robotIds: ["ops"] });

console.log("stockup request notification tests passed");

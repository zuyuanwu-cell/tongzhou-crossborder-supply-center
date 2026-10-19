import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildStockupWarningLinkMarkdown,
  buildStockupWarningReportModel,
  buildWecomImageBody,
  hydrateStockupWarningThumbnails,
  renderStockupWarningPng,
  renderStockupWarningPngWithImages,
  renderStockupWarningSvg,
  stockupWarningReportConstants,
  summarizeStockupWarningDeliveries,
} from "../server/stockup-warning-report.js";
import { buildStockupPayload } from "../server/stockup-center.js";
import { renderStockupWarningReport } from "../server/stockup-warning-renderer.js";

const payload = {
  generatedAt: "2026-10-16T09:12:00+08:00",
  counts: { netRecommendedQty: 7_350 },
  recommendations: [
    {
      id: "sku-b",
      sku: "TZKJ-NK030",
      name: "Naturekiss 生发喷雾",
      imageUrl: "https://cdn.example.com/naturekiss.png",
      country: "俄罗斯",
      unit: "瓶",
      status: "补货预警",
      availableQty: 1_240,
      inTransitQty: 2_000,
      replenishQty: 5_600,
      outsourcingInProductionQty: 1_600,
      netReplenishQty: 4_000,
      yesterdayOutboundQty: 317,
      yesterdayReservedQty: 286,
      daysCover: 8.2,
      estimatedStockoutDate: "2026-10-24",
      trend30: [40, 42, 39, 51, 49, 56, 62, 59, 72, 74, 81, 93, 99, 107],
      warehouseBreakdown: [{ warehouseName: "俄罗斯2仓", availableQty: 1_240 }],
    },
    {
      id: "sku-a",
      sku: "TZKJ-QL032",
      name: "QLEV 男士脱毛膏",
      country: "俄罗斯",
      unit: "支",
      status: "缺货",
      availableQty: 0,
      inTransitQty: 800,
      replenishQty: 3_850,
      outsourcingInProductionQty: 500,
      netReplenishQty: 3_350,
      yesterdayOutboundQty: 468,
      yesterdayReservedQty: 392,
      daysCover: 0,
      estimatedStockoutDate: "2026-10-16",
      trend30: [56, 61, 65, 70, 76, 79, 91, 94, 106, 115, 121, 132, 145, 151],
      warehouseBreakdown: [{ warehouseName: "俄罗斯1仓", availableQty: 0 }],
    },
  ],
};

const model = buildStockupWarningReportModel(payload);
assert.equal(model.totalItems, 2);
assert.equal(model.items[0].sku, "TZKJ-QL032", "缺货商品应排在首位");
assert.equal(model.items[0].yesterdayReservedQty, 392);
assert.equal(model.items[1].outsourcingInProductionQty, 1_600);
assert.equal(model.items[1].imageUrl, "https://cdn.example.com/naturekiss.png");
assert.equal(model.nearestStockoutDate, "2026-10-16");

const integrated = buildStockupPayload({
  generatedAt: payload.generatedAt,
  items: payload.recommendations,
}, {}, {}, {});
const integratedNaturekiss = integrated.recommendations.find((item) => item.sku === "TZKJ-NK030");
const integratedQlev = integrated.recommendations.find((item) => item.sku === "TZKJ-QL032");
assert.equal(integratedNaturekiss.yesterdayOutboundQty, 317);
assert.equal(integratedQlev.estimatedStockoutDate, "2026-10-16");
assert.deepEqual(integratedNaturekiss.trend30, payload.recommendations[0].trend30);

const svg = renderStockupWarningSvg(model);
assert.match(svg, /备货预警日报/);
assert.match(svg, /昨日出库/);
assert.match(svg, /有效订单预占/);
assert.match(svg, /委外在产/);
assert.match(svg, /建议备货/);
assert.doesNotMatch(svg, /成本|客户|供应商/);
assert.match(svg, /thumb-initial/);

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let thumbnailFetches = 0;
const hydrated = await hydrateStockupWarningThumbnails(model, {
  fetchImpl: async (url) => {
    thumbnailFetches += 1;
    return {
      ok: true,
      url,
      headers: { get: (name) => name === "content-type" ? "image/png" : null },
      arrayBuffer: async () => onePixelPng,
    };
  },
});
assert.equal(thumbnailFetches, 1);
assert.match(hydrated.items[1].thumbnailDataUri, /^data:image\/png;base64,/);
assert.ok(Buffer.from(hydrated.items[1].thumbnailDataUri.split(",")[1], "base64").length < 100_000, "产品原图应先压缩为轻量缩略图");
assert.match(renderStockupWarningSvg(hydrated), /<image href="data:image\/png;base64,/);

const imageReport = await renderStockupWarningPngWithImages(payload, {
  fetchImpl: async (url) => ({
    ok: true,
    url,
    headers: { get: (name) => name === "content-type" ? "image/png" : null },
    arrayBuffer: async () => onePixelPng,
  }),
});
assert.ok(imageReport.buffer.length > 10_000);

const workerPayload = structuredClone(payload);
workerPayload.recommendations[0].imageUrl = `data:image/png;base64,${onePixelPng.toString("base64")}`;
const workerReport = await renderStockupWarningReport(workerPayload, { timeoutMs: 20_000 });
assert.ok(workerReport.buffer.length > 10_000, "独立线程应生成可发送的长图");

const report = renderStockupWarningPng(payload);
assert.deepEqual([...report.buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(report.buffer.length > 10_000);
assert.ok(report.buffer.length < stockupWarningReportConstants.wecomImageLimit);

const bundledFontReport = renderStockupWarningPng(payload, { loadSystemFonts: false });
assert.ok(bundledFontReport.buffer.length > 10_000, "无系统中文字体时仍应使用应用内字体生成长图");

const body = buildWecomImageBody(report.buffer);
assert.equal(body.msgtype, "image");
assert.equal(body.image.md5, createHash("md5").update(report.buffer).digest("hex"));
assert.equal(Buffer.from(body.image.base64, "base64").length, report.buffer.length);

const markdown = buildStockupWarningLinkMarkdown(model, { linkUrl: "https://gyl.tongzhoukuajing.com/#stockup-recommendations" });
assert.match(markdown, /2 个 SKU/);
assert.match(markdown, /进入供应链中台/);
assert.match(markdown, /https:\/\/gyl\.tongzhoukuajing\.com/);

const deliveries = summarizeStockupWarningDeliveries({
  robots: [
    { id: "robot-ok", name: "成功群" },
    { id: "robot-fallback", name: "回退群" },
  ],
  imageResults: [
    { robotId: "robot-ok", ok: true },
    { robotId: "robot-fallback", ok: false, message: "图片超限" },
  ],
  linkResults: [{ robotId: "robot-ok", ok: true }],
  fallbackResults: [{ robotId: "robot-fallback", ok: true }],
});
assert.deepEqual(deliveries[0], {
  robotId: "robot-ok",
  robotName: "成功群",
  ok: true,
  imageOk: true,
  linkOk: true,
  fallbackSent: false,
  message: "长图和详情链接已发送",
});
assert.equal(deliveries[1].ok, false, "发送文字回退也不能把长图测试标为成功");
assert.equal(deliveries[1].fallbackSent, true);
assert.match(deliveries[1].message, /图片超限/);
assert.match(deliveries[1].message, /已回退发送文字提醒/);

console.log("stockup warning report tests passed");

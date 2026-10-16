import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderStockupWarningPng } from "../server/stockup-warning-report.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "output", "playwright", "stockup-warning-long-image.png");
const trend = (base, slope, noise = 5) => Array.from({ length: 30 }, (_, index) => Math.max(0, Math.round(base + slope * index + Math.sin(index * 1.7) * noise)));
const previewThumbnail = (label, color, type = "bottle") => {
  const shape = type === "box"
    ? `<rect x="24" y="22" width="72" height="92" rx="8" fill="${color}"/><rect x="31" y="30" width="58" height="25" rx="5" fill="#fff" opacity=".9"/><path d="M31 67h58M31 78h44" stroke="#fff" stroke-width="4" opacity=".62"/>`
    : type === "tube"
      ? `<path d="M35 27h50l8 79c1 9-5 14-14 14H41c-9 0-15-5-14-14l8-79Z" fill="${color}"/><rect x="39" y="21" width="42" height="12" rx="4" fill="#173E69"/><rect x="38" y="47" width="44" height="34" rx="8" fill="#fff" opacity=".92"/>`
      : `<rect x="43" y="16" width="34" height="18" rx="5" fill="#173E69"/><rect x="35" y="31" width="50" height="90" rx="13" fill="${color}"/><rect x="40" y="54" width="40" height="42" rx="8" fill="#fff" opacity=".92"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="132" viewBox="0 0 120 132"><rect width="120" height="132" rx="18" fill="#F5F8FC"/>${shape}<text x="60" y="75" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#173E69">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};
const recommendations = [
  { sku: "TZKJ-QL032", name: "QLEV 男士脱毛膏", country: "俄罗斯", warehouseName: "俄罗斯2仓", unit: "支", status: "缺货", availableQty: 0, inTransitQty: 800, replenishQty: 7_200, outsourcingInProductionQty: 2_400, netReplenishQty: 4_800, yesterdayOutboundQty: 468, yesterdayReservedQty: 392, daysCover: 0, estimatedStockoutDate: "2026-10-16", trend30: trend(62, 3.3, 9) },
  { sku: "TZKJ-NK030", name: "Naturekiss 生发喷雾", country: "俄罗斯", warehouseName: "俄罗斯1仓", unit: "瓶", status: "补货预警", availableQty: 1_240, inTransitQty: 2_000, replenishQty: 5_600, outsourcingInProductionQty: 1_600, netReplenishQty: 4_000, yesterdayOutboundQty: 317, yesterdayReservedQty: 286, daysCover: 4.2, estimatedStockoutDate: "2026-10-20", trend30: trend(38, 2.4, 7) },
  { sku: "TZKJ-SJJ001", name: "SJJ 男士发胶", country: "俄罗斯", warehouseName: "俄罗斯2仓", unit: "瓶", status: "补货预警", availableQty: 860, inTransitQty: 5_000, replenishQty: 4_500, outsourcingInProductionQty: 1_200, netReplenishQty: 3_300, yesterdayOutboundQty: 241, yesterdayReservedQty: 208, daysCover: 6.1, estimatedStockoutDate: "2026-10-22", trend30: trend(94, .8, 15) },
  { sku: "RA0001", name: "RAVINIA HAIR GROWTH SPRAY 生发喷雾", country: "印度尼西亚", warehouseName: "神牛雅加达仓", unit: "瓶", status: "补货预警", availableQty: 1_580, inTransitQty: 1_800, replenishQty: 3_600, outsourcingInProductionQty: 900, netReplenishQty: 2_700, yesterdayOutboundQty: 183, yesterdayReservedQty: 164, daysCover: 8.6, estimatedStockoutDate: "2026-10-25", trend30: trend(45, 1.45, 8) },
  { sku: "TZKJ-QL025", name: "QLEV 防脱生发洗发水", country: "马来西亚", warehouseName: "神牛马来仓", unit: "瓶", status: "补货预警", availableQty: 2_130, inTransitQty: 0, replenishQty: 2_900, outsourcingInProductionQty: 0, netReplenishQty: 2_900, yesterdayOutboundQty: 137, yesterdayReservedQty: 121, daysCover: 11.4, estimatedStockoutDate: "2026-10-28", trend30: trend(70, -.45, 13) },
  { sku: "TZKJ-QL028", name: "QLEV 人参黄金抗皱淡纹精华液", country: "菲律宾", warehouseName: "菲律宾马尼拉仓", unit: "盒", status: "补货预警", availableQty: 1_760, inTransitQty: 900, replenishQty: 2_200, outsourcingInProductionQty: 600, netReplenishQty: 1_600, yesterdayOutboundQty: 94, yesterdayReservedQty: 87, daysCover: 14.2, estimatedStockoutDate: "2026-10-30", trend30: trend(51, .3, 6) },
].map((item, index) => ({
  id: `preview-${index + 1}`,
  ...item,
  imageUrl: previewThumbnail(item.sku.split("-").at(-1)?.slice(0, 5) || "SKU", ["#172D4D", "#7EC8C2", "#151B29", "#E48E63", "#3974B7", "#D2A84F"][index], ["bottle", "bottle", "box", "bottle", "tube", "box"][index]),
  sales7: item.trend30.slice(-7).reduce((sum, value) => sum + value, 0),
  sales30: item.trend30.reduce((sum, value) => sum + value, 0),
  sales90: item.trend30.reduce((sum, value) => sum + value, 0) * 3,
  warehouseBreakdown: [{ warehouseId: `wh-${index + 1}`, warehouseName: item.warehouseName, availableQty: item.availableQty }],
}));

const payload = {
  generatedAt: "2026-10-16T09:12:00+08:00",
  counts: {
    recommendations: recommendations.length,
    netRecommendedQty: recommendations.reduce((sum, item) => sum + item.netReplenishQty, 0),
  },
  recommendations,
};

const report = renderStockupWarningPng(payload, { loadSystemFonts: false });
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, report.buffer);
console.log(outputPath);

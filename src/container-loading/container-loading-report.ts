import type { ContainerLoadingMetrics, ContainerLoadingPlan, ContainerPlacement } from "./types";
import { skuColorHex } from "./color";

type ReportInput = {
  plan: ContainerLoadingPlan;
  placements: ContainerPlacement[];
  metrics: ContainerLoadingMetrics;
  strategyLabel: string;
  warnings: string[];
};

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const PAGE_MARGIN = 70;
const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif';

function canvasPage() {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法创建 PDF 绘图画布。");
  context.fillStyle = "#F4F7FB";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size = 24, color = "#143B67", weight = 500, align: CanvasTextAlign = "left") {
  context.fillStyle = color;
  context.font = `${weight} ${size}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillText(value, x, y);
}

function wrap(context: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number, lineHeight: number, size = 22, color = "#536F8D", weight = 500) {
  context.fillStyle = color;
  context.font = `${weight} ${size}px ${FONT}`;
  context.textAlign = "left";
  context.textBaseline = "top";
  let line = "";
  let top = y;
  for (const character of value) {
    const next = line + character;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, top);
      line = character;
      top += lineHeight;
    } else line = next;
  }
  if (line) context.fillText(line, x, top);
  return top + lineHeight;
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fill: string, stroke = "") {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 2;
    context.stroke();
  }
}

function pageHeader(context: CanvasRenderingContext2D, plan: ContainerLoadingPlan, section: string, pageNumber: number, totalPages: number) {
  text(context, "同舟供应链 · 仓库装柜作业指导", PAGE_MARGIN, 50, 20, "#F45B0B", 800);
  text(context, section, PAGE_MARGIN, 84, 38, "#092F64", 800);
  text(context, `${plan.planNo}  |  ${plan.container.name}`, PAGE_WIDTH - PAGE_MARGIN, 60, 18, "#6E8298", 600, "right");
  context.strokeStyle = "#D8E3EF";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(PAGE_MARGIN, 140);
  context.lineTo(PAGE_WIDTH - PAGE_MARGIN, 140);
  context.stroke();
  text(context, `第 ${pageNumber} / ${totalPages} 页`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 52, 16, "#8191A3", 500, "right");
}

function drawTopView(context: CanvasRenderingContext2D, input: ReportInput, x: number, y: number, width: number, height: number, maxSequence = 0) {
  const { plan } = input;
  rounded(context, x, y, width, height, 16, "#FFFFFF", "#C9D9EA");
  const pad = 26;
  const drawingWidth = width - pad * 2;
  const drawingHeight = height - pad * 2;
  const scale = Math.min(drawingWidth / plan.container.lengthCm, drawingHeight / plan.container.widthCm);
  const containerWidth = plan.container.lengthCm * scale;
  const containerHeight = plan.container.widthCm * scale;
  const left = x + (width - containerWidth) / 2;
  const top = y + (height - containerHeight) / 2;
  context.fillStyle = "#EAF1F8";
  context.fillRect(left, top, containerWidth, containerHeight);
  context.save();
  context.beginPath();
  context.rect(left, top, containerWidth, containerHeight);
  context.clip();
  const visible = [...input.placements]
    .filter((placement) => !maxSequence || placement.sequence <= maxSequence)
    .sort((a, b) => a.z - b.z || a.sequence - b.sequence);
  visible.forEach((placement) => {
    context.globalAlpha = 0.76;
    context.fillStyle = skuColorHex(placement.sku);
    context.fillRect(left + placement.x * scale, top + placement.y * scale, Math.max(1, placement.lengthCm * scale), Math.max(1, placement.widthCm * scale));
    context.globalAlpha = 0.34;
    context.strokeStyle = "#FFFFFF";
    context.lineWidth = 1;
    context.strokeRect(left + placement.x * scale, top + placement.y * scale, Math.max(1, placement.lengthCm * scale), Math.max(1, placement.widthCm * scale));
  });
  context.restore();
  context.globalAlpha = 1;
  context.strokeStyle = "#1B5FA8";
  context.lineWidth = 4;
  context.strokeRect(left, top, containerWidth, containerHeight);
  context.strokeStyle = "#F45B0B";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(left + containerWidth, top);
  context.lineTo(left + containerWidth, top + containerHeight);
  context.stroke();
  text(context, "柜门", left + containerWidth - 4, top - 24, 15, "#F45B0B", 800, "right");
  text(context, "柜尾", left + 4, top - 24, 15, "#58738F", 700);
}

function metricCard(context: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, value: string, accent = false) {
  rounded(context, x, y, width, 118, 14, accent ? "#FFF4EC" : "#FFFFFF", accent ? "#FFC6A6" : "#D8E3EF");
  text(context, label, x + 18, y + 18, 17, "#6F8297", 600);
  text(context, value, x + 18, y + 51, 32, accent ? "#E8530B" : "#113D6D", 800);
}

function legend(context: CanvasRenderingContext2D, plan: ContainerLoadingPlan, x: number, y: number, width: number) {
  const itemWidth = width / 3;
  plan.items.slice(0, 12).forEach((item, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    const left = x + column * itemWidth;
    const top = y + row * 44;
    context.fillStyle = skuColorHex(item.sku);
    context.fillRect(left, top + 5, 18, 18);
    text(context, `${item.sku} · ${item.cartonCount}箱`, left + 28, top, 16, "#274D73", 650);
  });
  if (plan.items.length > 12) text(context, `另有 ${plan.items.length - 12} 个 SKU，详见明细页`, x, y + 184, 15, "#7A8CA0", 500);
}

function buildSummaryPage(input: ReportInput, pageNumber: number, totalPages: number) {
  const { canvas, context } = canvasPage();
  pageHeader(context, input.plan, "装柜方案总览", pageNumber, totalPages);
  text(context, input.plan.name, PAGE_MARGIN, 176, 31, "#0D386C", 800);
  const source = input.plan.sourceShipmentNo ? `来源发运单：${input.plan.sourceShipmentNo}` : "来源：自由模拟";
  const status = ({ draft: "草稿 - 未确认", confirmed: "已确认", loaded: "已装柜", voided: "已作废" } as Record<string, string>)[input.plan.status] || input.plan.status;
  text(context, `${source}   目的仓：${input.plan.destinationWarehouseName || "-"}   方案状态：${status}`, PAGE_MARGIN, 222, 19, input.plan.status === "confirmed" ? "#167055" : "#B95718", 650);
  text(context, `计算策略：${input.strategyLabel}   方案版本：V${input.plan.version}   生成时间：${new Date().toLocaleString("zh-CN")}`, PAGE_MARGIN, 254, 18, "#637D99", 500);

  const cardWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - 36) / 4;
  metricCard(context, PAGE_MARGIN, 305, cardWidth, "已装 / 待装", `${input.metrics.loadedCartons} / ${input.metrics.unplacedCartons} 箱`, true);
  metricCard(context, PAGE_MARGIN + (cardWidth + 12), 305, cardWidth, "体积利用率", `${input.metrics.volumeUtilization.toFixed(1)}%`);
  metricCard(context, PAGE_MARGIN + (cardWidth + 12) * 2, 305, cardWidth, "装载重量", `${input.metrics.loadedWeightKg.toFixed(1)} kg`);
  metricCard(context, PAGE_MARGIN + (cardWidth + 12) * 3, 305, cardWidth, "重心均衡", `${input.metrics.balanceScore.toFixed(1)} 分`);

  text(context, "俯视装载图（柜门在右侧）", PAGE_MARGIN, 458, 23, "#153F6C", 750);
  drawTopView(context, input, PAGE_MARGIN, 500, PAGE_WIDTH - PAGE_MARGIN * 2, 470);
  text(context, "SKU 颜色图例", PAGE_MARGIN, 1010, 23, "#153F6C", 750);
  legend(context, input.plan, PAGE_MARGIN, 1055, PAGE_WIDTH - PAGE_MARGIN * 2);

  rounded(context, PAGE_MARGIN, 1285, PAGE_WIDTH - PAGE_MARGIN * 2, 300, 16, "#FFFFFF", "#D8E3EF");
  text(context, "开工前核对", PAGE_MARGIN + 24, 1312, 23, "#153F6C", 800);
  const checks = [
    `柜内尺寸 ${input.plan.container.lengthCm} × ${input.plan.container.widthCm} × ${input.plan.container.heightCm} cm，柜门 ${input.plan.container.doorWidthCm} × ${input.plan.container.doorHeightCm} cm。`,
    `计划装载 ${input.metrics.loadedCartons} 箱，合计 ${input.metrics.loadedWeightKg.toFixed(1)} kg；不得超过柜体最大载重 ${input.plan.container.maxPayloadKg} kg。`,
    "按装柜顺序从柜尾向柜门作业；每完成一个阶段，核对 SKU、箱数与剩余通道。",
    "如现场箱规、破损、柜内障碍或货物数量与报告不一致，应暂停并联系中台重新排布。",
  ];
  checks.forEach((value, index) => {
    context.fillStyle = index === 3 ? "#F45B0B" : "#1F6BB2";
    context.beginPath();
    context.arc(PAGE_MARGIN + 34, 1370 + index * 50, 6, 0, Math.PI * 2);
    context.fill();
    text(context, value, PAGE_MARGIN + 54, 1355 + index * 50, 18, index === 3 ? "#9C3B15" : "#486783", 550);
  });
  return canvas;
}

function buildSequencePage(input: ReportInput, pageNumber: number, totalPages: number) {
  const { canvas, context } = canvasPage();
  pageHeader(context, input.plan, "分阶段装柜顺序", pageNumber, totalPages);
  text(context, "按序号推进，每个阶段结束后再进入下一阶段", PAGE_MARGIN, 176, 21, "#607A96", 550);
  const total = Math.max(1, input.placements.length);
  const stages = [0.25, 0.5, 0.75, 1];
  const areaWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - 24) / 2;
  const areaHeight = 570;
  stages.forEach((ratio, index) => {
    const left = PAGE_MARGIN + (index % 2) * (areaWidth + 24);
    const top = 235 + Math.floor(index / 2) * 690;
    const from = index === 0 ? 1 : Math.floor(total * stages[index - 1]) + 1;
    const to = Math.max(from, Math.floor(total * ratio));
    rounded(context, left, top, areaWidth, 640, 16, "#FFFFFF", "#D8E3EF");
    text(context, `阶段 ${index + 1}`, left + 22, top + 20, 23, "#F45B0B", 850);
    text(context, `装柜序号 ${from} - ${to}  ·  累计 ${Math.round(ratio * 100)}%`, left + 22, top + 56, 17, "#54718E", 600);
    drawTopView(context, input, left + 18, top + 100, areaWidth - 36, areaHeight - 125, to);
    const stageSkus = Array.from(new Set(input.placements.filter((placement) => placement.sequence >= from && placement.sequence <= to).map((placement) => placement.sku)));
    text(context, `本阶段 SKU：${stageSkus.slice(0, 5).join("、")}${stageSkus.length > 5 ? ` 等 ${stageSkus.length} 款` : ""}`, left + 22, top + 592, 15, "#607A96", 550);
  });
  return canvas;
}

function buildDetailPage(input: ReportInput, rows: ContainerLoadingPlan["items"], pageNumber: number, totalPages: number, chunkIndex: number) {
  const { canvas, context } = canvasPage();
  pageHeader(context, input.plan, chunkIndex ? "SKU 装柜明细（续）" : "SKU 装柜明细与风险提醒", pageNumber, totalPages);
  const columns = [PAGE_MARGIN, 155, 390, 640, 775, 935, 1085];
  rounded(context, PAGE_MARGIN, 180, PAGE_WIDTH - PAGE_MARGIN * 2, 54, 10, "#E9F2FB");
  ["颜色", "SKU", "产品", "计划箱数", "实际装入", "箱规 cm", "单箱 kg"].forEach((value, index) => text(context, value, columns[index], 195, 16, "#355C82", 800));
  let top = 244;
  rows.forEach((item, index) => {
    const loaded = input.placements.filter((placement) => placement.itemId === item.id).length;
    if (index % 2 === 0) {
      context.fillStyle = "#F8FAFD";
      context.fillRect(PAGE_MARGIN, top, PAGE_WIDTH - PAGE_MARGIN * 2, 66);
    }
    context.fillStyle = skuColorHex(item.sku);
    context.fillRect(columns[0] + 10, top + 20, 24, 24);
    text(context, item.sku, columns[1], top + 17, 15, "#183F69", 700);
    text(context, item.productName.slice(0, 18), columns[2], top + 17, 15, "#294F76", 550);
    text(context, String(item.cartonCount), columns[3], top + 17, 16, "#294F76", 650);
    text(context, String(loaded), columns[4], top + 17, 16, loaded < item.cartonCount ? "#D84C13" : "#167055", 750);
    text(context, `${item.cartonLengthCm}×${item.cartonWidthCm}×${item.cartonHeightCm}`, columns[5], top + 17, 14, "#294F76", 550);
    text(context, String(item.cartonWeightKg), columns[6], top + 17, 15, "#294F76", 550);
    top += 66;
  });

  if (!chunkIndex) {
    const stageTop = Math.max(top + 45, 460);
    text(context, "分阶段现场核对表", PAGE_MARGIN, stageTop, 24, "#153F6C", 800);
    rounded(context, PAGE_MARGIN, stageTop + 44, PAGE_WIDTH - PAGE_MARGIN * 2, 48, 9, "#E9F2FB");
    const stageColumns = [PAGE_MARGIN + 18, PAGE_MARGIN + 140, PAGE_MARGIN + 375, PAGE_MARGIN + 650, PAGE_MARGIN + 920];
    ["阶段", "装柜序号", "本阶段箱数", "涉及 SKU", "现场确认"].forEach((value, index) => text(context, value, stageColumns[index], stageTop + 58, 16, "#355C82", 800));
    const total = Math.max(1, input.placements.length);
    let stageRowTop = stageTop + 98;
    [0.25, 0.5, 0.75, 1].forEach((ratio, index) => {
      const from = index === 0 ? 1 : Math.floor(total * [0, 0.25, 0.5, 0.75][index]) + 1;
      const to = Math.max(from, Math.floor(total * ratio));
      const placements = input.placements.filter((placement) => placement.sequence >= from && placement.sequence <= to);
      const skus = Array.from(new Set(placements.map((placement) => placement.sku)));
      if (index % 2 === 0) {
        context.fillStyle = "#F8FAFD";
        context.fillRect(PAGE_MARGIN, stageRowTop - 8, PAGE_WIDTH - PAGE_MARGIN * 2, 54);
      }
      text(context, `阶段 ${index + 1}`, stageColumns[0], stageRowTop, 16, "#E8530B", 800);
      text(context, `${from} - ${to}`, stageColumns[1], stageRowTop, 16, "#294F76", 650);
      text(context, `${placements.length} 箱`, stageColumns[2], stageRowTop, 16, "#294F76", 650);
      text(context, `${skus.length} 款`, stageColumns[3], stageRowTop, 16, "#294F76", 650);
      context.strokeStyle = "#7890A8";
      context.lineWidth = 2;
      context.strokeRect(stageColumns[4] + 25, stageRowTop - 2, 24, 24);
      stageRowTop += 54;
    });

    const riskTop = stageRowTop + 36;
    text(context, "现场风险提醒", PAGE_MARGIN, riskTop, 24, "#153F6C", 800);
    const warnings = input.warnings.length ? input.warnings : ["方案未检测到高风险提醒，仍须以现场柜况、箱体完好度和承运人要求为准。"];
    let warningTop = riskTop + 50;
    const availableWarnings = Math.max(1, Math.floor((PAGE_HEIGHT - 90 - warningTop) / 76));
    warnings.slice(0, availableWarnings).forEach((warning, index) => {
      rounded(context, PAGE_MARGIN, warningTop, PAGE_WIDTH - PAGE_MARGIN * 2, 64, 10, index ? "#FFF8EE" : "#FFF1EB", index ? "#F5D7AC" : "#F5B99B");
      text(context, String(index + 1).padStart(2, "0"), PAGE_MARGIN + 18, warningTop + 18, 17, "#E8530B", 850);
      wrap(context, warning, PAGE_MARGIN + 60, warningTop + 14, PAGE_WIDTH - PAGE_MARGIN * 2 - 82, 24, 16, "#7A4A2B", 600);
      warningTop += 76;
    });
  }
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error("PDF 页面渲染失败。"));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/jpeg", 0.9);
  });
}

function ascii(value: string) {
  return new TextEncoder().encode(value);
}

function joinBytes(parts: Uint8Array[]) {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => { result.set(part, offset); offset += part.byteLength; });
  return result;
}

function jpegPagesToPdf(images: Uint8Array[]) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const objectCount = 2 + images.length * 3;
  const chunks: Uint8Array[] = [];
  const offsets = Array(objectCount + 1).fill(0);
  let cursor = 0;
  const push = (value: Uint8Array) => { chunks.push(value); cursor += value.byteLength; };
  const pushText = (value: string) => push(ascii(value));
  const object = (id: number, body: Uint8Array[]) => {
    offsets[id] = cursor;
    pushText(`${id} 0 obj\n`);
    body.forEach(push);
    pushText("\nendobj\n");
  };
  pushText("%PDF-1.4\n%PDFIMAGE\n");
  object(1, [ascii("<< /Type /Catalog /Pages 2 0 R >>")]);
  const pageIds = images.map((_, index) => 3 + index * 3);
  object(2, [ascii(`<< /Type /Pages /Count ${images.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`)]);
  images.forEach((image, index) => {
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    const content = ascii(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${imageName} Do\nQ`);
    object(pageId, [ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
    object(contentId, [ascii(`<< /Length ${content.byteLength} >>\nstream\n`), content, ascii("\nendstream")]);
    object(imageId, [ascii(`<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>\nstream\n`), image, ascii("\nendstream")]);
  });
  const xrefOffset = cursor;
  pushText(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) pushText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  pushText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return joinBytes(chunks);
}

export async function exportContainerLoadingGuidePdf(input: ReportInput) {
  const detailChunks: Array<ContainerLoadingPlan["items"]> = [];
  for (let index = 0; index < input.plan.items.length; index += 8) detailChunks.push(input.plan.items.slice(index, index + 8));
  if (!detailChunks.length) detailChunks.push([]);
  const totalPages = 2 + detailChunks.length;
  const canvases = [
    buildSummaryPage(input, 1, totalPages),
    buildSequencePage(input, 2, totalPages),
    ...detailChunks.map((rows, index) => buildDetailPage(input, rows, index + 3, totalPages, index)),
  ];
  const images = await Promise.all(canvases.map(canvasToJpeg));
  const pdf = jpegPagesToPdf(images);
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${input.plan.planNo}-${input.strategyLabel}-装柜指导报告.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

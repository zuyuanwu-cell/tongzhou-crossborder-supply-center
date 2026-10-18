import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MM_TO_PT = 72 / 25.4;

function ascii(value) {
  return String(value ?? "").replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, (character) => `\\${character}`);
}

function utf16Hex(value) {
  const text = String(value ?? "");
  let output = "FEFF";
  for (let index = 0; index < text.length; index += 1) output += text.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  return output;
}

function textCommand(value, x, y, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${utf16Hex(value)}> Tj ET`;
}

function lineCommand(x1, y1, x2, y2) {
  return `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function rectCommand(x, y, width, height) {
  return `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`;
}

function pdfBuffer(pages, width, height) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const cidFontId = add("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>");
  const fontId = add(`<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontId} 0 R] >>`);
  const pageIds = [];
  for (const content of pages) {
    const bytes = Buffer.from(content, "utf8");
    const contentId = add(`<< /Length ${bytes.length} >>\nstream\n${content}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, "utf8");
    chunks.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(Buffer.from(xref, "utf8"));
  return Buffer.concat(chunks);
}

function packingPages(shipment) {
  const width = 210 * MM_TO_PT;
  const height = 297 * MM_TO_PT;
  const margin = 36;
  const rowsPerPage = 22;
  const lines = Array.isArray(shipment.lines) ? shipment.lines : [];
  const pages = [];
  for (let offset = 0; offset < Math.max(1, lines.length); offset += rowsPerPage) {
    const pageLines = lines.slice(offset, offset + rowsPerPage);
    const commands = ["0.75 w"];
    commands.push(textCommand("备货装箱单 / PACKING LIST", margin, height - 48, 18));
    commands.push(textCommand(`发运批次：${shipment.shipmentNo}`, margin, height - 78, 10));
    commands.push(textCommand(`海外仓单：${shipment.wmsOrderNo || "-"}`, 310, height - 78, 10));
    commands.push(textCommand(`目的仓：${shipment.destinationWarehouseName}`, margin, height - 96, 10));
    commands.push(textCommand(`运输方式：${shipment.transportMode || "-"}`, 310, height - 96, 10));
    const forwarder = shipment.forwarderSnapshot || {};
    commands.push(textCommand(`货代收货：${forwarder.forwarderName || "-"} / ${forwarder.locationName || "-"}`, margin, height - 114, 9));
    commands.push(textCommand(`地址：${forwarder.address || "-"}`, margin, height - 132, 9));
    commands.push(textCommand(`联系人：${forwarder.contactName || "-"}  ${forwarder.contactPhone || ""}`, margin, height - 150, 9));
    const tableTop = height - 178;
    const columns = [margin, 72, 180, 330, 390, 450, 540];
    commands.push(rectCommand(margin, tableTop - 24 - pageLines.length * 22, width - margin * 2, 24 + pageLines.length * 22));
    columns.slice(1, -1).forEach((x) => commands.push(lineCommand(x, tableTop, x, tableTop - 24 - pageLines.length * 22)));
    for (let row = 0; row <= pageLines.length; row += 1) commands.push(lineCommand(margin, tableTop - 24 - row * 22, width - margin, tableTop - 24 - row * 22));
    ["序号", "SKU", "产品", "数量", "箱数", "箱规"].forEach((label, index) => commands.push(textCommand(label, columns[index] + 4, tableTop - 17, 8)));
    pageLines.forEach((line, index) => {
      const y = tableTop - 39 - index * 22;
      commands.push(textCommand(String(offset + index + 1), columns[0] + 4, y, 8));
      commands.push(textCommand(line.sku, columns[1] + 4, y, 7));
      commands.push(textCommand(String(line.productName || "").slice(0, 18), columns[2] + 4, y, 7));
      commands.push(textCommand(`${line.shippedQty} ${line.unit}`, columns[3] + 4, y, 8));
      commands.push(textCommand(String(line.cartonCount || 0), columns[4] + 4, y, 8));
      commands.push(textCommand(`${line.unitsPerCarton || 0}/箱`, columns[5] + 4, y, 8));
    });
    commands.push(textCommand(`总箱数：${shipment.packages || 0}    总重：${Number(shipment.totalWeightKg || 0).toFixed(2)} kg    体积：${Number(shipment.totalVolumeM3 || 0).toFixed(3)} m³`, margin, 54, 10));
    commands.push(textCommand(`文件版本：V${Number(shipment.documentVersion || 0) + 1}    第 ${pages.length + 1} 页`, margin, 34, 8));
    pages.push(commands.join("\n"));
  }
  return { pages, width, height };
}

function markPages(shipment) {
  const width = 100 * MM_TO_PT;
  const height = 100 * MM_TO_PT;
  const totalCartons = Math.max(1, Math.round(Number(shipment.packages || 0)));
  const expanded = [];
  for (const line of shipment.lines || []) for (let carton = 0; carton < Math.max(0, Math.round(Number(line.cartonCount || 0))); carton += 1) expanded.push(line);
  while (expanded.length < totalCartons) expanded.push(null);
  const pages = expanded.slice(0, totalCartons).map((line, index) => {
    const commands = ["1 w", rectCommand(12, 12, width - 24, height - 24)];
    commands.push(textCommand("同舟供应链 · 箱唛", 28, height - 42, 16));
    commands.push(textCommand(`批次：${shipment.shipmentNo}`, 28, height - 72, 10));
    commands.push(textCommand(`海外仓单：${shipment.wmsOrderNo || "-"}`, 28, height - 94, 10));
    commands.push(textCommand(`目的仓：${shipment.destinationWarehouseName}`, 28, height - 116, 10));
    commands.push(textCommand(`箱号：${index + 1} / ${totalCartons}`, 28, height - 156, 22));
    commands.push(textCommand(`SKU：${line?.sku || "MIXED"}`, 28, height - 190, 12));
    commands.push(textCommand(`箱规：${line?.unitsPerCarton || "-"} ${line?.unit || "件"}/箱`, 28, height - 214, 10));
    const route = shipment.forwarderSnapshot?.routingRequirements;
    if (route) commands.push(textCommand(`路由：${String(route).slice(0, 20)}`, 28, 32, 8));
    return commands.join("\n");
  });
  return { pages, width, height };
}

function savePdf(directory, fileName, pdf, snapshot) {
  const filePath = resolve(directory, fileName);
  writeFileSync(filePath, pdf);
  return { fileName, filePath, sha256: createHash("sha256").update(pdf).digest("hex"), snapshot };
}

export function createStockupDispatchDocumentService({ outputDir }) {
  const directory = resolve(outputDir);
  mkdirSync(directory, { recursive: true });
  return {
    generate(shipment) {
      const safeNo = ascii(shipment.shipmentNo || "shipment").replace(/[^A-Za-z0-9_-]/g, "_");
      const version = Number(shipment.documentVersion || 0) + 1;
      const packing = packingPages(shipment);
      const marks = markPages(shipment);
      const snapshot = { shipmentId: shipment.id, shipmentNo: shipment.shipmentNo, wmsOrderNo: shipment.wmsOrderNo, forwarderSnapshot: shipment.forwarderSnapshot, lines: shipment.lines, version, generatedAt: new Date().toISOString() };
      return { ok: true, documents: [
        { documentType: "packing_list", ...savePdf(directory, `${safeNo}-V${version}-packing-list.pdf`, pdfBuffer(packing.pages, packing.width, packing.height), snapshot) },
        { documentType: "carton_marks", ...savePdf(directory, `${safeNo}-V${version}-carton-marks.pdf`, pdfBuffer(marks.pages, marks.width, marks.height), snapshot) },
      ] };
    },
  };
}


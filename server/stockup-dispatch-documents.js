import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const MM_TO_PT = 72 / 25.4;
const PRODUCT_IMAGE_HOSTS = new Set(["files.jiandaoyun.com"]);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function ascii(value) {
  return String(value ?? "").replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, (character) => `\\${character}`);
}

function utf16Hex(value) {
  const text = String(value ?? "");
  let output = "FEFF";
  for (let index = 0; index < text.length; index += 1) output += text.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  return output;
}

function textCommand(value, x, y, size = 10, color = [0.04, 0.14, 0.28]) {
  return `${color.join(" ")} rg BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td <${utf16Hex(value)}> Tj ET`;
}

function lineCommand(x1, y1, x2, y2, color = [0.78, 0.84, 0.91], width = 0.65) {
  return `${color.join(" ")} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function rectCommand(x, y, width, height, color = [0.35, 0.5, 0.7], lineWidth = 0.8) {
  return `${color.join(" ")} RG ${lineWidth} w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`;
}

function fillRectCommand(x, y, width, height, color) {
  return `${color.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`;
}

function drawImageCommand(name, image, x, y, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const left = x + (maxWidth - width) / 2;
  const bottom = y + (maxHeight - height) / 2;
  return `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${left.toFixed(2)} ${bottom.toFixed(2)} cm /${name} Do Q`;
}

function streamObject(dictionary, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`, "utf8"), bytes, Buffer.from("\nendstream", "utf8")]);
}

function pdfBuffer(pages, width, height) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalogId = add("");
  const pagesId = add("");
  const cidFontId = add("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /SimHei /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>");
  const fontId = add(`<< /Type /Font /Subtype /Type0 /BaseFont /SimHei /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontId} 0 R] >>`);
  const pageIds = [];
  for (const sourcePage of pages) {
    const page = typeof sourcePage === "string" ? { content: sourcePage, images: [] } : sourcePage;
    const xObjects = [];
    for (const image of page.images || []) {
      const imageId = add(streamObject(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter}`, image.data));
      xObjects.push(`/${image.name} ${imageId} 0 R`);
    }
    const contentId = add(streamObject("", page.content));
    const xObjectResource = xObjects.length ? `/XObject << ${xObjects.join(" ")} >>` : "";
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 ${fontId} 0 R >> ${xObjectResource} >> /Contents ${contentId} 0 R >>`));
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "utf8"), raw, Buffer.from("\nendobj\n", "utf8")]);
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

function paeth(a, b, c) {
  const prediction = a + b - c;
  const pa = Math.abs(prediction - a);
  const pb = Math.abs(prediction - b);
  const pc = Math.abs(prediction - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngToPdfImage(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const dataParts = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") transparency = data;
    else if (type === "IDAT") dataParts.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0 || !dataParts.length) return null;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels) return null;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(dataParts));
  if (inflated.length < (stride + 1) * height) return null;
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset++];
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = inflated[inputOffset++];
      const left = column >= channels ? pixels[rowOffset + column - channels] : 0;
      const up = row > 0 ? pixels[rowOffset - stride + column] : 0;
      const upLeft = row > 0 && column >= channels ? pixels[rowOffset - stride + column - channels] : 0;
      const value = filter === 0 ? raw
        : filter === 1 ? raw + left
          : filter === 2 ? raw + up
            : filter === 3 ? raw + Math.floor((left + up) / 2)
              : filter === 4 ? raw + paeth(left, up, upLeft)
                : NaN;
      if (!Number.isFinite(value)) return null;
      pixels[rowOffset + column] = value & 255;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    let red;
    let green;
    let blue;
    let alpha = 255;
    if (colorType === 0 || colorType === 4) red = green = blue = pixels[pixel * channels];
    else if (colorType === 2 || colorType === 6) [red, green, blue] = [pixels[pixel * channels], pixels[pixel * channels + 1], pixels[pixel * channels + 2]];
    else {
      const paletteIndex = pixels[pixel];
      red = palette?.[paletteIndex * 3] ?? 255;
      green = palette?.[paletteIndex * 3 + 1] ?? 255;
      blue = palette?.[paletteIndex * 3 + 2] ?? 255;
      alpha = transparency?.[paletteIndex] ?? 255;
    }
    if (colorType === 4) alpha = pixels[pixel * channels + 1];
    if (colorType === 6) alpha = pixels[pixel * channels + 3];
    const target = pixel * 3;
    rgb[target] = Math.round((red * alpha + 255 * (255 - alpha)) / 255);
    rgb[target + 1] = Math.round((green * alpha + 255 * (255 - alpha)) / 255);
    rgb[target + 2] = Math.round((blue * alpha + 255 * (255 - alpha)) / 255);
  }
  return { width, height, data: deflateSync(rgb), filter: "FlateDecode" };
}

function jpegToPdfImage(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), data: buffer, filter: "DCTDecode" };
    }
    if (length < 2) return null;
    offset += length + 2;
  }
  return null;
}

function imageToPdfImage(buffer) {
  return pngToPdfImage(buffer) || jpegToPdfImage(buffer);
}

async function defaultImageLoader(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== "https:" || !PRODUCT_IMAGE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadProductImages(lines, imageLoader) {
  const urls = [...new Set((lines || []).map((line) => String(line.imageUrl || "").trim()).filter(Boolean))];
  const images = new Map();
  for (const url of urls) {
    try {
      const source = await imageLoader(url);
      const image = source ? imageToPdfImage(Buffer.from(source)) : null;
      if (image) images.set(url, image);
    } catch {
      // Missing images must not prevent dispatch document generation.
    }
  }
  return images;
}

function packingPages(shipment, productImages) {
  const width = 210 * MM_TO_PT;
  const height = 297 * MM_TO_PT;
  const margin = 28;
  const rowHeight = 38;
  const rowsPerPage = 13;
  const lines = Array.isArray(shipment.lines) ? shipment.lines : [];
  const pages = [];
  for (let offset = 0; offset < Math.max(1, lines.length); offset += rowsPerPage) {
    const pageLines = lines.slice(offset, offset + rowsPerPage);
    const commands = [];
    const images = [];
    commands.push(fillRectCommand(0, height - 78, width, 78, [0.03, 0.19, 0.39]));
    commands.push(fillRectCommand(margin, height - 58, 7, 32, [1, 0.34, 0.06]));
    commands.push(textCommand("同舟供应链 · 发运指导", margin + 18, height - 39, 9, [0.58, 0.79, 1]));
    commands.push(textCommand("备货装箱单  PACKING LIST", margin + 18, height - 61, 18, [1, 1, 1]));
    commands.push(textCommand(`批次 ${shipment.shipmentNo}`, 365, height - 41, 9, [1, 1, 1]));
    const summaryY = height - 112;
    const summary = [
      ["目的仓", shipment.destinationWarehouseName || "-"],
      ["总箱数", `${shipment.packages || 0} 箱`],
      ["总重量", `${Number(shipment.totalWeightKg || 0).toFixed(2)} kg`],
      ["总体积", `${Number(shipment.totalVolumeM3 || 0).toFixed(3)} CBM`],
    ];
    summary.forEach(([label, value], index) => {
      const x = margin + index * 135;
      commands.push(fillRectCommand(x, summaryY, 125, 27, index === 0 ? [1, 0.94, 0.9] : [0.94, 0.97, 1]));
      commands.push(textCommand(label, x + 7, summaryY + 17, 6.5, [0.35, 0.45, 0.58]));
      commands.push(textCommand(String(value).slice(0, 16), x + 7, summaryY + 6, 8.5, index === 0 ? [0.82, 0.24, 0.04] : [0.03, 0.19, 0.39]));
    });
    const forwarder = shipment.forwarderSnapshot || {};
    commands.push(textCommand(`货代收货：${forwarder.forwarderName || "-"} / ${forwarder.locationName || "-"}`, margin, height - 132, 8));
    commands.push(textCommand(`WMS 单：${shipment.wmsOrderNo || "待创建"}`, 365, height - 132, 7.2, [0.25, 0.34, 0.45]));
    commands.push(textCommand(`地址：${String(forwarder.address || "-").slice(0, 48)}`, margin, height - 146, 7.5, [0.25, 0.34, 0.45]));
    const tableTop = height - 166;
    const columns = [margin, 52, 94, 190, 337, 404, 449, width - margin];
    const tableBottom = tableTop - 24 - pageLines.length * rowHeight;
    commands.push(fillRectCommand(margin, tableTop - 24, width - margin * 2, 24, [0.89, 0.94, 0.99]));
    commands.push(rectCommand(margin, tableBottom, width - margin * 2, tableTop - tableBottom, [0.61, 0.71, 0.83]));
    columns.slice(1, -1).forEach((x) => commands.push(lineCommand(x, tableTop, x, tableBottom)));
    for (let row = 0; row <= pageLines.length; row += 1) commands.push(lineCommand(margin, tableTop - 24 - row * rowHeight, width - margin, tableTop - 24 - row * rowHeight));
    ["#", "图片", "SKU", "产品", "数量", "箱数", "箱规"].forEach((label, index) => commands.push(textCommand(label, columns[index] + 4, tableTop - 17, 7.2, [0.08, 0.25, 0.47])));
    pageLines.forEach((line, index) => {
      const rowTop = tableTop - 24 - index * rowHeight;
      const y = rowTop - 23;
      commands.push(textCommand(String(offset + index + 1).padStart(2, "0"), columns[0] + 4, y, 7));
      const image = productImages.get(String(line.imageUrl || ""));
      if (image) {
        const name = `Im${index + 1}`;
        images.push({ name, ...image });
        commands.push(drawImageCommand(name, image, columns[1] + 3, rowTop - rowHeight + 3, columns[2] - columns[1] - 6, rowHeight - 6));
      } else {
        commands.push(fillRectCommand(columns[1] + 8, rowTop - 30, 25, 24, [0.95, 0.97, 0.99]));
        commands.push(textCommand("暂无", columns[1] + 10, rowTop - 20, 6, [0.55, 0.62, 0.7]));
      }
      commands.push(textCommand(String(line.sku || "-").slice(0, 18), columns[2] + 4, y + 5, 6.8));
      commands.push(textCommand(String(line.productName || "-").slice(0, 19), columns[3] + 4, y + 5, 6.8));
      commands.push(textCommand(`${line.shippedQty} ${line.unit || "件"}`, columns[4] + 4, y + 5, 7.2));
      commands.push(textCommand(String(line.cartonCount || 0), columns[5] + 4, y + 5, 8.5, [0.82, 0.24, 0.04]));
      commands.push(textCommand(`${line.unitsPerCarton || 0}/箱`, columns[6] + 4, y + 9, 7));
      commands.push(textCommand(`${Number(line.cartonLengthCm || 0)}×${Number(line.cartonWidthCm || 0)}×${Number(line.cartonHeightCm || 0)}cm`, columns[6] + 4, y - 3, 5.6, [0.35, 0.45, 0.58]));
    });
    commands.push(fillRectCommand(margin, 31, width - margin * 2, 33, [0.03, 0.19, 0.39]));
    commands.push(textCommand(`箱唛 ${shipment.boxMark || "-"}`, margin + 10, 51, 8.5, [1, 1, 1]));
    commands.push(textCommand(`物流单号 ${shipment.trackingNo || "-"}`, margin + 10, 38, 8, [0.72, 0.86, 1]));
    commands.push(textCommand(`文件 V${Number(shipment.documentVersion || 0) + 1} · 第 ${pages.length + 1}/${Math.max(1, Math.ceil(lines.length / rowsPerPage))} 页`, 430, 43, 7, [1, 1, 1]));
    pages.push({ content: commands.join("\n"), images });
  }
  return { pages, width, height };
}

function markPages(shipment) {
  const width = 100 * MM_TO_PT;
  const height = 100 * MM_TO_PT;
  const totalCartons = Math.max(1, Math.round(Number(shipment.packages || 0)));
  const expanded = [];
  for (const line of shipment.lines || []) {
    for (let carton = 0; carton < Math.max(0, Math.round(Number(line.cartonCount || 0))); carton += 1) expanded.push(line);
  }
  while (expanded.length < totalCartons) expanded.push(null);
  const pages = expanded.slice(0, totalCartons).map((line, index) => {
    const commands = [];
    commands.push(fillRectCommand(0, 0, width, height, [0.98, 0.99, 1]));
    commands.push(fillRectCommand(0, height - 58, width, 58, [0.03, 0.19, 0.39]));
    commands.push(fillRectCommand(0, height - 65, width, 7, [1, 0.34, 0.06]));
    commands.push(fillRectCommand(16, height - 44, 23, 23, [1, 0.34, 0.06]));
    commands.push(fillRectCommand(21, height - 32, 5, 5, [1, 1, 1]));
    commands.push(fillRectCommand(29, height - 32, 5, 5, [1, 1, 1]));
    commands.push(fillRectCommand(25, height - 40, 5, 5, [1, 1, 1]));
    commands.push(textCommand("同舟供应链 · 仓库装运箱唛", 48, height - 30, 11, [1, 1, 1]));
    commands.push(textCommand("TONGZHOU SHIPPING MARK", 48, height - 45, 6.8, [0.58, 0.79, 1]));
    commands.push(textCommand("目的仓 DESTINATION", 18, height - 86, 6.5, [0.35, 0.45, 0.58]));
    commands.push(textCommand(String(shipment.destinationWarehouseName || "-").slice(0, 18), 18, height - 108, 15, [0.03, 0.19, 0.39]));
    commands.push(fillRectCommand(16, height - 171, width - 32, 49, [1, 0.94, 0.89]));
    commands.push(textCommand("CARTON", 25, height - 143, 7, [0.82, 0.24, 0.04]));
    commands.push(textCommand(`${String(index + 1).padStart(3, "0")} / ${String(totalCartons).padStart(3, "0")}`, 25, height - 165, 23, [0.82, 0.24, 0.04]));
    commands.push(textCommand(`箱唛：${String(shipment.boxMark || "-").slice(0, 23)}`, 18, height - 194, 10, [0.03, 0.19, 0.39]));
    commands.push(textCommand(`SKU：${line?.sku || "MIXED"}`, 18, height - 214, 9));
    commands.push(textCommand(`品名：${String(line?.productName || "混装").slice(0, 21)}`, 18, height - 231, 8));
    commands.push(textCommand(`箱规：${line?.unitsPerCarton || "-"} ${line?.unit || "件"}/箱`, 18, height - 248, 8));
    commands.push(lineCommand(16, 28, width - 16, 28, [0.68, 0.77, 0.87], 0.8));
    commands.push(textCommand(`批次 ${shipment.shipmentNo}`, 18, 17, 6.5, [0.35, 0.45, 0.58]));
    commands.push(textCommand(`物流 ${shipment.trackingNo || "-"}`, 150, 17, 6.5, [0.35, 0.45, 0.58]));
    return { content: commands.join("\n"), images: [] };
  });
  return { pages, width, height };
}

function savePdf(directory, fileName, pdf, snapshot) {
  const filePath = resolve(directory, fileName);
  writeFileSync(filePath, pdf);
  return { fileName, filePath, sha256: createHash("sha256").update(pdf).digest("hex"), snapshot };
}

export function createStockupDispatchDocumentService({ outputDir, imageLoader = defaultImageLoader }) {
  const directory = resolve(outputDir);
  mkdirSync(directory, { recursive: true });
  return {
    async generate(shipment) {
      const safeNo = ascii(shipment.shipmentNo || "shipment").replace(/[^A-Za-z0-9_-]/g, "_");
      const version = Number(shipment.documentVersion || 0) + 1;
      const productImages = await loadProductImages(shipment.lines, imageLoader);
      const packing = packingPages(shipment, productImages);
      const marks = markPages(shipment);
      const snapshot = { shipmentId: shipment.id, shipmentNo: shipment.shipmentNo, wmsOrderNo: shipment.wmsOrderNo, forwarderSnapshot: shipment.forwarderSnapshot, lines: shipment.lines, embeddedImageCount: productImages.size, version, generatedAt: new Date().toISOString() };
      return { ok: true, documents: [
        { documentType: "packing_list", ...savePdf(directory, `${safeNo}-V${version}-packing-list.pdf`, pdfBuffer(packing.pages, packing.width, packing.height), snapshot) },
        { documentType: "carton_marks", ...savePdf(directory, `${safeNo}-V${version}-carton-marks.pdf`, pdfBuffer(marks.pages, marks.width, marks.height), snapshot) },
      ] };
    },
  };
}

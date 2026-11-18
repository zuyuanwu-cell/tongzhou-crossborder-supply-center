"use strict";

// 只读解析 Shopee 订单导出的 xlsx。桌面版是免安装包，不能依赖外部 npm
// 模块，因此这里只实现所需的 ZIP/XML 子集；不会写回或修改原文件。

const { inflateRawSync } = require("node:zlib");

function text(value) {
  return String(value ?? "");
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function unzip(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const end = findEndOfCentralDirectory(source);
  if (end < 0) throw new Error("文件不是有效的 xlsx（找不到 ZIP 目录）。");
  const entries = source.readUInt16LE(end + 10);
  let offset = source.readUInt32LE(end + 16);
  const files = new Map();
  for (let index = 0; index < entries; index += 1) {
    if (source.readUInt32LE(offset) !== 0x02014b50) throw new Error("xlsx 的 ZIP 目录已损坏。");
    const method = source.readUInt16LE(offset + 10);
    const compressedSize = source.readUInt32LE(offset + 20);
    const nameLength = source.readUInt16LE(offset + 28);
    const extraLength = source.readUInt16LE(offset + 30);
    const commentLength = source.readUInt16LE(offset + 32);
    const localOffset = source.readUInt32LE(offset + 42);
    const name = source.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    if (source.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("xlsx 的 ZIP 文件头已损坏。");
    const localNameLength = source.readUInt16LE(localOffset + 26);
    const localExtraLength = source.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = source.subarray(dataOffset, dataOffset + compressedSize);
    if (method === 0) files.set(name, Buffer.from(compressed));
    else if (method === 8) files.set(name, inflateRawSync(compressed));
    else throw new Error(`xlsx 使用了不支持的 ZIP 压缩方式：${method}`);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value) {
  return text(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, valueHex) => String.fromCodePoint(parseInt(valueHex, 16)))
    .replace(/&#(\d+);/g, (_, valueDec) => String.fromCodePoint(Number(valueDec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlText(xml) {
  const withoutPhonetics = text(xml).replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  return [...withoutPhonetics.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)/i.exec(text(reference))?.[1]?.toUpperCase() || "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function parseXlsx(buffer) {
  const files = unzip(buffer);
  const sheetName = [...files.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error("订单报表里没有可读取的工作表。");
  const shared = [];
  const sharedFile = [...files.keys()].find((name) => /^xl\/sharedStrings\.xml$/i.test(name));
  if (sharedFile) {
    const xml = files.get(sharedFile).toString("utf8");
    for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(xmlText(match[1]));
  }
  const rows = [];
  const sheet = files.get(sheetName).toString("utf8");
  // Shopee 的报表偶尔把 dimension 写成 A1:A1，实际仍有几百行；不能依赖 dimension。
  for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const reference = /\sr="([A-Z]+\d+)"/i.exec(attributes)?.[1] || "";
      const index = reference ? columnIndex(reference) : row.length;
      const type = /\st="([^"]+)"/.exec(attributes)?.[1] || "";
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = xmlText(body);
      else if (type === "b") value = text(raw) === "1" ? "TRUE" : "FALSE";
      else if (raw !== undefined) value = decodeXml(raw).trim();
      while (row.length < index) row.push("");
      row[index] = value;
    }
    rows.push(row);
  }
  return rows;
}

module.exports = { parseXlsx, unzip };

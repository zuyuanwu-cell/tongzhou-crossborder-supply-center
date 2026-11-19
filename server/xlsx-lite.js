import { strFromU8, unzipSync } from "fflate";

const text = (value) => String(value ?? "");

function decodeXmlEntities(value) {
  return text(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(xml) {
  const cleaned = text(xml).replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  return [...cleaned.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXmlEntities(match[1]))
    .join("");
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)/.exec(text(reference).toUpperCase())?.[1] || "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

export function parseXlsx(buffer) {
  let archive;
  try {
    archive = unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
  } catch {
    throw new Error("文件不是有效的 xlsx（可能已损坏或被加密），请用 Excel 另存为 .xlsx 后重试。");
  }
  const sheetPath = Object.keys(archive).find((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path));
  if (!sheetPath) throw new Error("这个 xlsx 里没有可读的工作表，请确认文件内容。");

  const sharedStrings = [];
  const sharedPath = Object.keys(archive).find((path) => /^xl\/sharedStrings\.xml$/i.test(path));
  if (sharedPath) {
    const sharedXml = strFromU8(archive[sharedPath]);
    for (const match of sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) sharedStrings.push(textOf(match[1]));
  }

  const grid = [];
  const sheetXml = strFromU8(archive[sheetPath]);
  for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const rowAttributes = rowMatch[0].slice(0, rowMatch[0].indexOf(">"));
    const declaredRow = Number(/\sr="(\d+)"/.exec(rowAttributes)?.[1] || 0);
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const reference = /\sr="([A-Z]+[0-9]+)"/i.exec(attributes)?.[1] || "";
      const targetColumn = reference ? columnIndex(reference) : row.length;
      const type = /\st="([^"]+)"/.exec(attributes)?.[1] || "";
      const rawValue = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") {
        const sharedIndex = Number(rawValue);
        value = Number.isInteger(sharedIndex) && sharedStrings[sharedIndex] !== undefined ? sharedStrings[sharedIndex] : "";
      } else if (type === "inlineStr") value = textOf(body);
      else if (type === "b") value = text(rawValue) === "1" ? "TRUE" : "FALSE";
      else if (rawValue !== undefined) value = decodeXmlEntities(rawValue).trim();
      while (row.length < targetColumn) row.push("");
      row[targetColumn] = value;
    }
    const targetRow = declaredRow > 0 ? declaredRow - 1 : grid.length;
    while (grid.length < targetRow) grid.push([]);
    grid[targetRow] = row;
  }
  return grid.map((row) => row.map((cell) => text(cell)));
}

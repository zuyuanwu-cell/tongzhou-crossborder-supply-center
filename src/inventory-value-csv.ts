import type { PerformanceSupplementalProductCost } from "./api";

export type InventoryValueCostImportRow = Pick<PerformanceSupplementalProductCost, "sku" | "countryKey" | "countryName" | "productName" | "unitCostCny" | "effectiveDate" | "enabled" | "note">;

function normalizeHeader(value: string) {
  return String(value || "")
    .replace(/[\uFEFF\u200B]/g, "")
    .replace(/[\s()（）_\-:：]/g, "")
    .trim()
    .toLowerCase();
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && line[index] === delimiter) count += 1;
  }
  return count;
}

function detectDelimiter(source: string) {
  const directive = source.match(/^\uFEFF?sep=(.)\r?\n/i);
  if (directive) return { delimiter: directive[1], source: source.slice(directive[0].length) };
  const headerLine = source.split(/\r?\n/, 1)[0] || "";
  const candidates = [",", "\t", ";", "，"];
  const delimiter = candidates
    .map((value) => ({ value, count: countDelimiter(headerLine, value) }))
    .sort((left, right) => right.count - left.count)[0];
  return { delimiter: delimiter?.count ? delimiter.value : ",", source };
}

export function parseInventoryValueCsvGrid(input: string) {
  const detected = detectDelimiter(String(input || "").replace(/^\uFEFF/, ""));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < detected.source.length; index += 1) {
    const character = detected.source[index];
    if (quoted) {
      if (character === '"' && detected.source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === detected.delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && detected.source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV存在未闭合的双引号，请检查文件格式。");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function decodeInventoryValueCsv(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) return "";
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder("utf-16le").decode(bytes.subarray(2)).replace(/^\uFEFF/, "");
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder("utf-16be").decode(bytes.subarray(2)).replace(/^\uFEFF/, "");
  if (bytes.length >= 4) {
    const sampleLength = Math.min(bytes.length, 200);
    let evenNulls = 0;
    let oddNulls = 0;
    for (let index = 0; index < sampleLength; index += 1) {
      if (bytes[index] !== 0) continue;
      if (index % 2) oddNulls += 1;
      else evenNulls += 1;
    }
    if (oddNulls > sampleLength / 8) return new TextDecoder("utf-16le").decode(bytes).replace(/^\uFEFF/, "");
    if (evenNulls > sampleLength / 8) return new TextDecoder("utf-16be").decode(bytes).replace(/^\uFEFF/, "");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    } catch {
      throw new Error("CSV编码无法识别，请使用Excel的“CSV UTF-8”格式保存后重试。");
    }
  }
}

export function normalizeInventoryValueCsvDate(value: string) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (!match) return raw;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

export function parseInventoryValueCostCsv(text: string): InventoryValueCostImportRow[] {
  const grid = parseInventoryValueCsvGrid(text);
  if (grid.length < 2) throw new Error("CSV中没有可导入的数据行。");
  const headers = grid[0].map(normalizeHeader);
  const indexOf = (...aliases: string[]) => headers.findIndex((header) => aliases.map(normalizeHeader).includes(header));
  const indexes = {
    sku: indexOf("SKU", "商品SKU", "产品SKU"),
    country: indexOf("国家代码", "国家", "国家名称", "国家/地区", "Country", "CountryCode", "CountryKey"),
    countryName: indexOf("国家名称", "国家", "国家/地区", "CountryName"),
    productName: indexOf("产品名称", "商品名称", "ProductName"),
    cost: indexOf("人民币单位成本", "人民币成本", "单位成本CNY", "成本CNY", "UnitCostCny"),
    effectiveDate: indexOf("生效日期", "成本生效日期", "EffectiveDate"),
    enabled: indexOf("启用", "状态", "Enabled"),
    note: indexOf("备注", "说明", "Note"),
  };
  const missingHeaders = [
    [indexes.sku, "SKU"],
    [indexes.country, "国家代码/国家"],
    [indexes.cost, "人民币单位成本"],
    [indexes.effectiveDate, "生效日期"],
  ].filter(([index]) => Number(index) < 0).map(([, label]) => label);
  if (missingHeaders.length) {
    const detectedHeaders = grid[0].map((value) => value.trim()).filter(Boolean).slice(0, 12).join("、") || "未识别到表头";
    throw new Error(`CSV缺少必填列：${missingHeaders.join("、")}。当前识别表头：${detectedHeaders}。`);
  }
  return grid.slice(1).filter((row) => row.some((value) => value.trim())).map((row) => {
    const country = String(row[indexes.country] || "").trim();
    const date = normalizeInventoryValueCsvDate(String(row[indexes.effectiveDate] || ""));
    return {
      sku: String(row[indexes.sku] || "").trim(),
      countryKey: country,
      countryName: indexes.countryName >= 0 ? String(row[indexes.countryName] || country).trim() : country,
      productName: indexes.productName >= 0 ? String(row[indexes.productName] || "").trim() : "",
      unitCostCny: Number(String(row[indexes.cost] || 0).replace(/[,，\s¥￥]/g, "")),
      effectiveDate: date,
      enabled: indexes.enabled < 0 || !["否", "0", "false", "停用", "禁用", "disabled"].includes(String(row[indexes.enabled] || "是").trim().toLowerCase()),
      note: indexes.note >= 0 ? String(row[indexes.note] || "仓库货值缺失成本补录").trim() : "仓库货值缺失成本补录",
    };
  });
}

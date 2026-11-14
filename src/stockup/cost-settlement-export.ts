import { strToU8, zipSync } from "fflate";
import type { StockupReceipt } from "./types";

type Preview = Record<string, any>;
type Cell = string | number | boolean | null | undefined;

function xml(value: Cell) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function worksheet(rows: Cell[][]) {
  const widthCount = Math.max(1, ...rows.map((row) => row.length));
  const widths = Array.from({ length: widthCount }, (_, index) => {
    const width = Math.min(48, Math.max(12, ...rows.map((row) => String(row[index] ?? "").length + 2)));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = rowIndex === 0 ? ' s="1"' : typeof value === "number" ? ' s="2"' : "";
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}"${style}><v>${value}</v></c>`;
      if (typeof value === "boolean") return `<c r="${reference}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
      return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const lastCell = `${columnName(widthCount - 1)}${Math.max(1, rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${columnName(widthCount - 1)}1"/>
</worksheet>`;
}

function makeWorkbook(sheets: Array<{ name: string; rows: Cell[][] }>) {
  const contentTypes = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentTypes}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF164A86"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(sheet.rows)); });
  return zipSync(files, { level: 6 });
}

export function downloadCostSettlementWorkbook(receipt: StockupReceipt, preview: Preview) {
  const summaries = preview.skuSummary || [];
  const items = preview.items || [];
  const versions = preview.versions || [];
  const allocationRows = summaries.flatMap((row: Record<string, any>) => (row.allocationBreakdown || []).map((allocation: Record<string, any>) => [
    row.sku, row.productName, allocation.category, allocation.name, allocation.requestedMethod, allocation.appliedMethod,
    allocation.amountCny, allocation.basis, allocation.totalBasis, allocation.ratio, allocation.allocatedAmountCny, allocation.formula, allocation.fallbackReason,
  ]));
  const sheets = [
    { name: "结算概览", rows: [
      ["字段", "值", "计算口径"],
      ["到仓批次", receipt.receiptNo, ""], ["仓库", receipt.warehouseName, ""], ["实际到仓", receipt.arrivedAt, ""],
      ["良品总数量", preview.totals?.costingQty || 0, preview.metricExplanations?.costingQty?.formula || ""],
      ["总重量 kg", preview.totals?.totalWeightKg || 0, preview.metricExplanations?.totalWeightKg?.formula || ""],
      ["总体积 m³", preview.totals?.totalVolumeM3 || 0, preview.metricExplanations?.totalVolumeM3?.formula || ""],
      ["货品成本 CNY", preview.totals?.goodsCostCny || 0, preview.metricExplanations?.goodsCostCny?.formula || ""],
      ["分摊费用 CNY", preview.totals?.allocatedCostCny || 0, preview.metricExplanations?.allocatedCostCny?.formula || ""],
      ["到仓总成本 CNY", preview.totals?.totalCostCny || 0, preview.metricExplanations?.totalCostCny?.formula || ""],
      ["加权单价 CNY", preview.totals?.unitCostCny || 0, preview.metricExplanations?.unitCostCny?.formula || ""],
      ["公式版本", preview.formulaVersion || "", ""], ["计算时间", preview.calculatedAt || "", ""],
    ] },
    { name: "SKU汇总", rows: [["SKU", "产品名称", "来源行数", "良品数量", "重量 kg", "体积 m³", "货品成本 CNY", "分摊费用 CNY", "到仓总成本 CNY", "到仓单价 CNY"], ...summaries.map((row: Record<string, any>) => [row.sku, row.productName, row.sourceLineCount, row.goodQty, row.weightKg, row.volumeM3, row.goodsCostCny, row.allocatedCostCny, row.totalCostCny, row.unitCostCny])] },
    { name: "费用明细", rows: [["费用分类", "费用名称", "供应商", "单据号", "发生日期", "原币金额", "币种", "汇率", "人民币金额", "参与分摊", "分摊方式", "备注"], ...items.map((item: Record<string, any>) => [item.category, item.name, item.vendor, item.invoiceNo, item.occurredAt, item.originalAmount, item.currency, item.exchangeRate, item.amountCny, item.included ? "是" : "否", item.allocationMethod, item.note])] },
    { name: "计算过程", rows: [["SKU", "产品名称", "费用分类", "费用名称", "设定方式", "实际方式", "费用金额 CNY", "本 SKU 依据", "全部依据", "分摊比例", "分摊金额 CNY", "公式", "回退说明"], ...allocationRows] },
    { name: "版本记录", rows: [["版本", "类型", "状态", "良品数量", "货品成本 CNY", "分摊费用 CNY", "总成本 CNY", "单价 CNY", "说明", "创建人", "创建时间", "锁定人", "锁定时间"], ...versions.map((version: Record<string, any>) => [version.version, version.versionType, version.status, version.costingQty, version.goodsCostCny, version.allocatedCostCny, version.totalCostCny, version.unitCostCny, version.note, version.createdBy, version.createdAt, version.lockedBy, version.lockedAt])] },
  ];
  const bytes = makeWorkbook(sheets);
  const workbookBuffer = new Uint8Array(bytes).buffer;
  const url = URL.createObjectURL(new Blob([workbookBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${receipt.receiptNo || "成本结算"}-成本核算.xlsx`.replace(/[\\/:*?"<>|]/g, "-");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

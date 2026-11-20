import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";
import {
  containsQuestionMarkEncodingDamage,
  decodeShopDirectoryCsv,
  parseShopDirectoryCsv,
} from "../server/shop-directory-file.js";
import { parseXlsx } from "../server/xlsx-lite.js";

const doubleBom = Buffer.from("\uFEFF\uFEFF店铺ID,主项目组\r\nshop-1,深六项目", "utf8");
assert.deepEqual(parseShopDirectoryCsv(decodeShopDirectoryCsv(doubleBom)), [
  ["店铺ID", "主项目组"],
  ["shop-1", "深六项目"],
]);

const gb18030 = Buffer.from("terGzElELNb3z+7Ev9fpDQpzaG9wLTEsye7B+c/uxL8=", "base64");
assert.deepEqual(parseShopDirectoryCsv(decodeShopDirectoryCsv(gb18030)), [
  ["店铺ID", "主项目组"],
  ["shop-1", "深六项目"],
]);

assert.equal(containsQuestionMarkEncodingDamage(["??ID", "????"]), true);
assert.equal(containsQuestionMarkEncodingDamage(["店铺ID", "主项目组"]), false);

const workbook = zipSync({
  "xl/worksheets/sheet1.xml": strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>店铺ID</t></is></c><c r="B1" t="inlineStr"><is><t>主项目组</t></is></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>shop-1</t></is></c><c r="B2" t="inlineStr"><is><t>深六项目</t></is></c></row>'
    + '</sheetData></worksheet>',
  ),
});
assert.deepEqual(parseXlsx(workbook), [["店铺ID", "主项目组"], ["shop-1", "深六项目"]]);

const bundledWorkbookModule = await build({
  entryPoints: [fileURLToPath(new URL("../src/stockup/cost-settlement-export.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const workbookModuleUrl = `data:text/javascript;base64,${Buffer.from(bundledWorkbookModule.outputFiles[0].text).toString("base64")}`;
const { makeWorkbook } = await import(workbookModuleUrl);
const exportedWorkbook = makeWorkbook([{ name: "店铺归属", rows: [["店铺ID", "主项目组"], ["shop-1", "深六项目"]] }]);
assert.deepEqual(parseXlsx(exportedWorkbook), [["店铺ID", "主项目组"], ["shop-1", "深六项目"]]);

const serverSource = await readFile(new URL("../server/server.js", import.meta.url), "utf8");
const importRoute = serverSource.slice(
  serverSource.indexOf('url.pathname === "/api/shop-directory/import"'),
  serverSource.indexOf('url.pathname === "/api/shop-directory/user-options"'),
);
assert.match(importRoute, /queuePerformanceAnalyticsRefresh\("shop-directory-import"\)/);
assert.match(importRoute, /refreshPerformanceAnalyticsShopDirectoryCache\(updatedDirectory\)/);
assert.doesNotMatch(importRoute, /await warmPerformanceAnalyticsMaterialization/);

const uiSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
assert.match(uiSource, /tongzhou-shop-directory-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}\.xlsx/);
assert.match(uiSource, />导出 Excel<\/button>/);

console.log("shop directory import file tests passed");

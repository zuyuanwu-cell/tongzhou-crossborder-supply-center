import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

process.env.TZ = "Asia/Shanghai";

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

const expirySource = readFileSync(resolve("src/qualification-expiry.ts"), "utf8");
const expiryUrl = `data:text/javascript;base64,${Buffer.from(compile(expirySource)).toString("base64")}`;
const coverageSource = readFileSync(resolve("src/qualification-coverage.ts"), "utf8")
  .replace('from "./qualification-expiry"', `from "${expiryUrl}"`);
const coverageModule = await import(`data:text/javascript;base64,${Buffer.from(compile(coverageSource)).toString("base64")}`);

const warehouse = { warehouseId: "wh-id", warehouseName: "印尼仓", availableQty: 10, lockedQty: 0, inTransitQty: 0, totalQty: 10 };
const products = [
  { id: "p1", sku: "SKU-1", name: "产品一", country: "印度尼西亚", brand: "A", category: "个护", warehouseBreakdown: [warehouse] },
  { id: "p2", sku: "SKU-2", name: "产品二", country: "印度尼西亚", brand: "A", category: "个护", warehouseBreakdown: [warehouse] },
  { id: "p3", sku: "SKU-3", name: "产品三", country: "印度尼西亚", brand: "B", category: "个护", warehouseBreakdown: [warehouse] },
  { id: "p4", sku: "SKU-4", name: "产品四", country: "印度尼西亚", brand: "B", category: "个护", warehouseBreakdown: [warehouse] },
  { id: "p5", sku: "SKU-5", name: "零库存", country: "印度尼西亚", warehouseBreakdown: [{ ...warehouse, totalQty: 0, availableQty: 0 }] },
  { id: "p6", sku: "AEE0004-TZKJ-QL032", name: "带公司前缀产品", country: "印度尼西亚", warehouseBreakdown: [warehouse] },
  { id: "p7", sku: "6975000000001", name: "同配方条码产品", country: "印度尼西亚", warehouseBreakdown: [warehouse] },
];
const qualifications = [
  { id: "q1", productRecordId: "p1", sku: "SKU-1", qualificationCategory: "印尼本土BPOM", qualificationName: "本土证", issuer: "A1", effectiveDate: "2025-01-01", expiryDate: "2028-01-01", files: [] },
  { id: "q2", productRecordId: "p1", sku: "SKU-1", qualificationCategory: "印尼跨境BPOM", qualificationName: "旧跨境证", issuer: "A2", effectiveDate: "2024-01-01", expiryDate: "2025-01-01", files: [] },
  { id: "q3", productRecordId: "p2", sku: "SKU-2", qualificationCategory: "印尼跨境BPOM", qualificationName: "临期证", issuer: "B1", effectiveDate: "2025-01-01", expiryDate: "2026-11-20", files: [] },
  { id: "q4", productRecordId: "p3", sku: "SKU-3", qualificationCategory: "印尼本土BPOM", qualificationName: "过期证", issuer: "C1", effectiveDate: "2024-01-01", expiryDate: "2026-01-01", files: [] },
  { id: "q5", productRecordId: "x", sku: "OTHER", qualificationCategory: "马来NOT", qualificationName: "其他国家", issuer: "X", effectiveDate: "2025-01-01", expiryDate: "2028-01-01", files: [] },
  { id: "q6", productRecordId: "another-record", sku: "TZKJ-QL032", qualificationCategory: "印尼本土BPOM", qualificationName: "前缀归一化证书", issuer: "A6", effectiveDate: "2025-01-01", expiryDate: "2028-01-01", files: [] },
  { id: "q7", productRecordId: "canonical-product", sku: "TZKJ-NK017", productName: "同配方条码产品", qualificationCategory: "印尼本土BPOM", qualificationName: "同产品不同条码证书", issuer: "A7", effectiveDate: "2025-01-01", expiryDate: "2028-01-01", files: [] },
];

const options = coverageModule.buildQualificationWarehouseOptions(products);
assert.equal(options.length, 1);
assert.equal(options[0].productCount, 6, "zero-stock products must stay outside the warehouse audit scope");
assert.equal(options[0].country, "印度尼西亚");

const expandedProducts = coverageModule.buildQualificationCoverageProducts(products, [
  { id: "base-6", sku: "SKU-6", skuNo: "006", name: "WMS 产品", nameEn: "WMS Product", unit: "盒", category: "个护", brand: "C" },
], [
  { warehouseId: "wh-my", warehouseName: "马来仓", country: "马来西亚", sku: "SKU-6", availableQty: 8, lockedQty: 1, inTransitQty: 2, totalQty: 11, syncedAt: "2026-10-09T00:00:00Z" },
]);
const expanded = expandedProducts.find((row) => row.sku === "SKU-6");
assert.equal(expanded?.name, "WMS 产品");
assert.equal(expanded?.warehouseBreakdown?.[0]?.country, "马来西亚");
assert.equal(expanded?.warehouseBreakdown?.[0]?.totalQty, 11);

const result = coverageModule.buildQualificationCoverage(products, qualifications, "wh-id", new Date("2026-10-10T00:00:00+08:00"));
assert.deepEqual(result.categories.map((row) => row.name), ["印尼本土BPOM", "印尼跨境BPOM"]);
assert.equal(result.summary.products, 6);
assert.equal(result.summary.covered, 4);
assert.equal(result.summary.risk, 1);
assert.equal(result.summary.expired, 1);
assert.equal(result.summary.missing, 1);
assert.equal(result.summary.coverageRate, 66.7);
assert.equal(result.products.find((row) => row.sku === "SKU-1")?.status, "valid", "one valid local path should cover the product even if an alternative path expired");
assert.equal(result.products.find((row) => row.sku === "SKU-2")?.status, "warning");
assert.equal(result.products.find((row) => row.sku === "SKU-3")?.status, "expired");
assert.equal(result.products.find((row) => row.sku === "SKU-4")?.status, "missing");
assert.equal(result.products.find((row) => row.sku === "AEE0004-TZKJ-QL032")?.status, "valid", "warehouse SKU prefixes should still match the canonical Tongzhou SKU");
assert.equal(result.products.find((row) => row.sku === "6975000000001")?.status, "valid", "alternate warehouse barcodes should inherit an exact same-name qualification record");
assert.equal(coverageModule.qualificationCategoryMatchesCountry("俄罗斯EAC", "俄罗斯"), true);
assert.equal(coverageModule.qualificationCategoryMatchesCountry("俄罗斯国际认证", "俄罗斯联邦"), true);
assert.equal(coverageModule.qualificationCategoryMatchesCountry("马来NOT", "印度尼西亚"), false);

console.log("qualification coverage tests passed");

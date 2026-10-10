import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const cacheFiles = [".cache/products.json", ".cache/warehouse-sync.json", ".cache/qualifications.json"];
if (!cacheFiles.every((file) => existsSync(resolve(file)))) {
  console.log("qualification coverage data check skipped: local caches are incomplete");
  process.exit(0);
}

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

const expirySource = readFileSync(resolve("src/qualification-expiry.ts"), "utf8");
const expiryUrl = `data:text/javascript;base64,${Buffer.from(compile(expirySource)).toString("base64")}`;
const coverageSource = readFileSync(resolve("src/qualification-coverage.ts"), "utf8")
  .replace('from "./qualification-expiry"', `from "${expiryUrl}"`);
const coverage = await import(`data:text/javascript;base64,${Buffer.from(compile(coverageSource)).toString("base64")}`);

const productsCache = JSON.parse(readFileSync(resolve(cacheFiles[0]), "utf8"));
const warehouseCache = JSON.parse(readFileSync(resolve(cacheFiles[1]), "utf8"));
const qualificationCache = JSON.parse(readFileSync(resolve(cacheFiles[2]), "utf8"));
const products = coverage.buildQualificationCoverageProducts([], productsCache.productBase || [], warehouseCache.inventory || []);
const rows = coverage.buildQualificationWarehouseOptions(products).map((warehouse) => {
  const result = coverage.buildQualificationCoverage(products, qualificationCache.qualifications || [], warehouse.id, new Date());
  return {
    warehouse: warehouse.name,
    country: warehouse.country,
    products: result.summary.products,
    covered: result.summary.covered,
    coverageRate: result.summary.coverageRate,
    risk: result.summary.risk,
    expired: result.summary.expired,
    undated: result.summary.undated,
    missing: result.summary.missing,
    categories: result.categories.map((category) => category.name).join(" / "),
  };
});

if (!rows.length) throw new Error("qualification coverage data check failed: no positive-stock warehouse was found");
console.table(rows);

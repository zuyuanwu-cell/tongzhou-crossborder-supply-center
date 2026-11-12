import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JIANYUN_FORMS } from "../server/field-mapping.js";
import { normalizeCatalog, normalizeProductBase } from "../server/normalize-products.js";

const baseFields = JIANYUN_FORMS.productBase.fields;
const catalogFields = JIANYUN_FORMS.productCatalog.fields;

const baseRecords = [{
  data_id: "product-sjj001",
  [baseFields.skuNo]: { value: "00030" },
  [baseFields.sku]: { value: "TZKJ-SJJ001" },
  [baseFields.productName]: { value: "SJJ 男士发胶" },
  [baseFields.unit]: { value: "瓶" },
  [baseFields.functionCategory]: { value: "头发造型" },
  [baseFields.supplier]: { value: "测试供应商" },
  [baseFields.packageLengthCm]: { value: 5.6 },
  [baseFields.packageWidthCm]: { value: 5.6 },
  [baseFields.packageHeightCm]: { value: 23 },
  [baseFields.volumeM3]: { value: 0.00072128 },
  [baseFields.grossWeightG]: { value: 234 },
  [baseFields.grossWeightKg]: { value: 0.234 },
  [baseFields.cartonSpec]: { value: "48" },
}, {
  data_id: "product-computed",
  [baseFields.skuNo]: { value: "00031" },
  [baseFields.sku]: { value: "TZKJ-TEST001" },
  [baseFields.productName]: { value: "换算测试品" },
  [baseFields.packageLengthCm]: { value: 10 },
  [baseFields.packageWidthCm]: { value: 20 },
  [baseFields.packageHeightCm]: { value: 30 },
  [baseFields.grossWeightG]: { value: 750 },
}];

const base = normalizeProductBase(baseRecords);
assert.equal(base[0].functionCategory, "头发造型");
assert.equal(base[0].supplier, "测试供应商");
assert.equal(base[0].packageLengthCm, 5.6);
assert.equal(base[0].packageWidthCm, 5.6);
assert.equal(base[0].packageHeightCm, 23);
assert.equal(base[0].volumeM3, 0.00072128);
assert.equal(base[0].grossWeightG, 234);
assert.equal(base[0].grossWeightKg, 0.234);
assert.equal(base[0].cartonSpec, "48");
assert.equal(base[0].length, "5.6");
assert.equal(base[0].weight, "0.234");

assert.equal(base[1].volumeM3, 0.006);
assert.equal(base[1].grossWeightKg, 0.75);
assert.equal(base[1].grossWeightG, 750);

const catalog = normalizeCatalog([{
  data_id: "catalog-sjj001",
  [catalogFields.skuNo]: { value: "00030" },
  [catalogFields.sku]: { value: "TZKJ-SJJ001" },
  [catalogFields.productNameCn]: { value: "SJJ 男士发胶" },
}], base);

assert.equal(catalog[0].packageLengthCm, 5.6);
assert.equal(catalog[0].volumeM3, 0.00072128);
assert.equal(catalog[0].grossWeightKg, 0.234);
assert.equal(catalog[0].cartonSpec, "48");

const productUi = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
for (const label of ["包装长", "包装宽", "包装高", "包装体积", "毛重", "箱规"]) {
  assert.ok(productUi.includes(`["${label}"`), `产品详情缺少 ${label}`);
}

console.log("PRODUCT_PACKAGING_FIELDS_TEST_OK");

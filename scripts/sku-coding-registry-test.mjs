import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSkuCodingRegistry,
  discoverSkuPrefix,
  formatSkuCode,
  normalizeSkuPrefix,
} from "../server/sku-coding-registry.js";

assert.equal(normalizeSkuPrefix(" tzkj-idwg "), "TZKJ-IDWG");
assert.equal(formatSkuCode("TZKJ-IDWG", 3, 34), "TZKJ-IDWG034");
assert.deepEqual(discoverSkuPrefix("TZKJ-IDWG033"), { prefix: "TZKJ-IDWG", digits: 3, sequence: 33 });
assert.deepEqual(discoverSkuPrefix("TZKJ-RU-0074"), { prefix: "TZKJ-RU-", digits: 4, sequence: 74 });
assert.equal(discoverSkuPrefix("YTD2226"), null);

const directory = mkdtempSync(join(tmpdir(), "tongzhou-sku-coding-"));
const filePath = join(directory, "registry.json");
let tick = 0;
const now = () => `2026-10-13T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const idFactory = (() => { let value = 0; return (prefix) => `${prefix}-${++value}`; })();

try {
  const registry = createSkuCodingRegistry({ filePath, now, idFactory });
  const existingSkus = [
    "TZKJ-IDWG001",
    "TZKJ-IDWG033",
    "TZKJ-SJJ010",
    "TZKJ-NK051",
    "TZKJ-QL049",
    "TZKJ-RU-0074",
  ];
  const snapshot = registry.snapshot(existingSkus);
  const idwg = snapshot.rules.find((item) => item.prefix === "TZKJ-IDWG");
  const sjj = snapshot.rules.find((item) => item.prefix === "TZKJ-SJJ");
  const nk = snapshot.rules.find((item) => item.prefix === "TZKJ-NK");
  const ql = snapshot.rules.find((item) => item.prefix === "TZKJ-QL");
  const ru = snapshot.rules.find((item) => item.prefix === "TZKJ-RU-");
  assert.equal(idwg.observedMax, 33);
  assert.equal(idwg.nextSku, "TZKJ-IDWG034");
  assert.equal(sjj.nextSku, "TZKJ-SJJ011");
  assert.equal(nk.nextSku, "TZKJ-NK052");
  assert.equal(ql.nextSku, "TZKJ-QL050");
  assert.equal(ru.nextSku, "TZKJ-RU-0075");

  const first = registry.reserve({
    ruleId: idwg.id,
    productRecordId: "product-1",
    productName: "印尼外采新品 A",
    requestedBy: { id: "user-1", name: "测试员" },
    existingSkus,
  });
  const second = registry.reserve({
    ruleId: idwg.id,
    productRecordId: "product-2",
    productName: "印尼外采新品 B",
    requestedBy: { id: "user-1", name: "测试员" },
    existingSkus,
  });
  assert.equal(first.sku, "TZKJ-IDWG034");
  assert.equal(second.sku, "TZKJ-IDWG035");
  assert.equal(registry.reserve({ ruleId: idwg.id, productRecordId: "product-1", existingSkus }).id, first.id, "同一新品重复点击应复用预占");

  registry.cancelReservation(first.id, { id: "user-1", name: "测试员" }, "选错编码规则");
  const third = registry.reserve({ ruleId: idwg.id, productRecordId: "product-3", existingSkus });
  assert.equal(third.sku, "TZKJ-IDWG036", "已撤销号码不回收");

  const custom = registry.upsertRule({
    name: "新自主品牌",
    prefix: "TZKJ-ABC",
    digits: 3,
    kind: "自主品牌",
    brand: "ABC",
    enabled: true,
  }, { id: "admin-1", name: "管理员" });
  assert.equal(custom.nextSku, "TZKJ-ABC001");
  const customReservation = registry.reserve({ ruleId: custom.id, productRecordId: "product-4", existingSkus });
  assert.equal(customReservation.sku, "TZKJ-ABC001");
  assert.throws(() => registry.upsertRule({ ...custom, prefix: "TZKJ-CHANGED" }), /已经发号/);

  const disabled = registry.upsertRule({ ...custom, enabled: false }, { id: "admin-1", name: "管理员" });
  assert.equal(disabled.enabled, false);
  assert.throws(() => registry.reserve({ ruleId: disabled.id, productRecordId: "product-5", existingSkus }), /已停用/);

  registry.recordArchiveResult(second.id, {
    status: "partial",
    jdyRecordId: "jdy-product-2",
    warehouseResults: [
      { connectionId: "id-shenniu-jakarta", status: "success", externalId: "sku-2" },
      { connectionId: "ru-moscow-1", status: "failed", message: "缺少尺寸" },
    ],
  });
  assert.equal(registry.getReservation(second.id).status, "partial");
  assert.equal(registry.getReservation(second.id).warehouseResults.length, 2);

  const reloaded = createSkuCodingRegistry({ filePath, now, idFactory });
  assert.equal(reloaded.getReservation(second.id).jdyRecordId, "jdy-product-2");
  assert.equal(reloaded.snapshot(existingSkus).rules.find((item) => item.prefix === "TZKJ-IDWG").nextSku, "TZKJ-IDWG037");

  console.log("sku coding registry tests passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}

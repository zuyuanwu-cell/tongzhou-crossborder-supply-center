import assert from "node:assert/strict";
import { buildProductionMaterialProgress } from "../server/production-materials.js";
import { buildSupplierRedactionEntries, redactSupplierText, supplierAlias, supplierReference } from "../server/supplier-privacy.js";

const field = (value) => ({ value });

const outsourcingRecords = [
  {
    data_id: "production-a",
    out_order_id: field("JG-A"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-a"),
    _widget_1744031628891: field("杭州同厂加工有限公司"),
    _widget_1666521891102: field("同厂加工"),
    _widget_1666513866246: field([
      {
        _widget_1667632334265: field("PK-A-2"),
        _widget_1689750794526: field("2026-08-09T00:00:00.000Z"),
      },
    ]),
  },
  {
    data_id: "production-b",
    out_order_id: field("JG-B"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-b"),
    _widget_1744031628891: field("宁波委外工厂有限公司"),
    _widget_1666521891102: field("宁波工厂"),
  },
  {
    data_id: "production-c",
    out_order_id: field("JG-C"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-c"),
  },
  {
    data_id: "production-d",
    out_order_id: field("JG-D"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-d"),
  },
  {
    data_id: "production-e",
    out_order_id: field("JG-E"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-e"),
  },
  {
    data_id: "production-f",
    out_order_id: field("JG-F"),
    _widget_1690015838240: field("进行中"),
    _widget_1741698535338: field("factory-f"),
  },
];

const purchaseRecords = [
  {
    data_id: "po-a-package",
    _widget_1690032758345: field("PO-A-1"),
    _widget_1741689808043: field("2026-08-01T00:00:00.000Z"),
    out_order_id: field("JG-A"),
    bom_vendor_id: field("vendor-package-a"),
    bom_vendor_name: field("秘密包材供应商甲"),
    _widget_1699618605970: field("采购中"),
    bom: field([
      {
        bom_sku: field("PK-A-1"),
        bom_fenlei: field("内包辅材"),
        bom_sku_name: field("软管"),
        bom_unit: field("支"),
        bom_qty: field(100),
        _widget_1741951692582: field(100),
      },
      {
        bom_sku: field("PK-A-2"),
        bom_fenlei: field("外包辅材"),
        bom_sku_name: field("彩盒"),
        bom_unit: field("个"),
        bom_qty: field(100),
        _widget_1741951692582: field(100),
      },
    ]),
  },
  {
    data_id: "po-a-inner",
    _widget_1690032758345: field("PO-A-2"),
    out_order_id: field("JG-A"),
    bom_vendor_id: field("factory-a"),
    bom_vendor_name: field("杭州同厂加工有限公司"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("IN-A"), bom_fenlei: field("内料"), bom_sku_name: field("膏体"), bom_qty: field(100) }]),
  },
  {
    data_id: "po-b-package",
    _widget_1690032758345: field("PO-B-1"),
    _widget_1741689808043: field("2026-08-02T00:00:00.000Z"),
    out_order_id: field("JG-B"),
    bom_vendor_id: field("vendor-package-b"),
    bom_vendor_name: field("秘密包材供应商乙"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("PK-B"), bom_fenlei: field("外包辅材"), bom_sku_name: field("纸箱"), bom_unit: field("个"), bom_qty: field(50) }]),
  },
  {
    data_id: "po-b-inner",
    _widget_1690032758345: field("PO-B-2"),
    out_order_id: field("JG-B"),
    bom_vendor_id: field("inner-vendor-b"),
    bom_vendor_name: field("秘密内料供应商乙"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("IN-B"), bom_fenlei: field("内料"), bom_sku_name: field("精华液"), bom_unit: field("千克"), bom_qty: field(50) }]),
  },
  {
    data_id: "po-cancelled",
    _widget_1690032758345: field("PO-B-X"),
    out_order_id: field("JG-B"),
    bom_vendor_id: field("cancelled-vendor"),
    bom_vendor_name: field("应被排除的供应商"),
    _widget_1699618605970: field("已作废"),
    bom: field([{ bom_sku: field("PK-X"), bom_fenlei: field("外包辅材"), bom_sku_name: field("废弃纸盒"), bom_qty: field(999) }]),
  },
  {
    data_id: "po-d-standard",
    _widget_1690032758345: field("PO-D-1"),
    _widget_1741689808043: field("2026-08-10T00:00:00.000Z"),
    out_order_id: field("JG-D"),
    bom_vendor_id: field("vendor-d"),
    bom_vendor_name: field("常规包材供应商"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("PK-D"), bom_fenlei: field("内包辅材"), bom_sku_name: field("软管"), bom_unit: field("支"), bom_qty: field(100) }]),
  },
  {
    data_id: "po-e-single-box",
    _widget_1690032758345: field("PO-E-1"),
    _widget_1741689808043: field("2026-08-10T00:00:00.000Z"),
    out_order_id: field("JG-E"),
    bom_vendor_id: field("vendor-e"),
    bom_vendor_name: field("单盒供应商"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("PK-E"), bom_fenlei: field("外包辅材"), bom_sku_name: field("单只彩盒"), bom_unit: field("个"), bom_qty: field(100) }]),
  },
  {
    data_id: "po-f-premium-box",
    _widget_1690032758345: field("PO-F-1"),
    _widget_1741689808043: field("2026-08-10T00:00:00.000Z"),
    out_order_id: field("JG-F"),
    bom_vendor_id: field("vendor-f"),
    bom_vendor_name: field("精装包装供应商"),
    _widget_1699618605970: field("采购中"),
    bom: field([{ bom_sku: field("PK-F"), bom_fenlei: field("外包辅材"), bom_sku_name: field("精装礼盒套盒"), bom_unit: field("套"), bom_qty: field(100) }]),
  },
];

const inboundRecords = [
  {
    data_id: "in-a-1",
    _widget_1690032758345: field("RK-A-1"),
    _widget_1741850722101: field("2026-08-03T00:00:00.000Z"),
    _widget_1696603667734: field("PO-A-1"),
    _widget_1741756513043: field([
      { _widget_1741756513046: field("PK-A-1"), _widget_1741850722077: field(40) },
      { _widget_1741756513046: field("PK-A-2"), _widget_1741850722077: field(100) },
    ]),
  },
  {
    data_id: "in-a-2",
    _widget_1690032758345: field("RK-A-2"),
    _widget_1741850722101: field("2026-08-05T00:00:00.000Z"),
    _widget_1696603667734: field("PO-A-1"),
    _widget_1741756513043: field([{ _widget_1741756513046: field("PK-A-1"), _widget_1741850722077: field(60) }]),
  },
  {
    data_id: "in-b-package",
    _widget_1690032758345: field("RK-B-1"),
    _widget_1741850722101: field("2026-08-06T00:00:00.000Z"),
    _widget_1696603667734: field("PO-B-1"),
    _widget_1741756513043: field([{ _widget_1741756513046: field("PK-B"), _widget_1741850722077: field(50) }]),
  },
  {
    data_id: "in-b-inner-partial",
    _widget_1690032758345: field("RK-B-2"),
    _widget_1741850722101: field("2026-08-07T00:00:00.000Z"),
    _widget_1696603667734: field("PO-B-2"),
    _widget_1741756513043: field([{ _widget_1741756513046: field("IN-B"), _widget_1741850722077: field(20) }]),
  },
];

const first = buildProductionMaterialProgress(outsourcingRecords, purchaseRecords, inboundRecords, "test", new Date("2026-08-27T00:00:00.000Z"));
const a = first.byOrderNo["JG-A"];
const b = first.byOrderNo["JG-B"];
const c = first.byOrderNo["JG-C"];
const d = first.byOrderNo["JG-D"];
const e = first.byOrderNo["JG-E"];
const f = first.byOrderNo["JG-F"];

assert.equal(a.status, "ready", "同厂内料应被忽略，包材全部累计入库后即到齐");
assert.equal(a.readyMaterials, 2);
assert.equal(a.exceptionalInner.total, 0);
assert.equal(a.materials.find((item) => item.sku === "PK-A-1")?.arrivedQty, 100, "多张入库单应累计");

assert.equal(b.status, "partial", "异厂内料应纳入判断");
assert.equal(b.exceptionalInner.total, 1);
assert.equal(b.exceptionalInner.ready, 0);
assert.equal(b.totalMaterials, 2);
assert.equal(b.readyMaterials, 1);
assert.equal(b.materials.some((item) => item.sku === "PK-X"), false, "作废采购单必须排除");

assert.equal(c.status, "review", "未识别到包材时不得自动判定到齐");
assert.equal(c.statusLabel, "数据待核查");

assert.equal(a.purchaseOrders.length, 1);
assert.equal(a.purchaseOrders[0].orderNo, "PO-A-1");
assert.equal(a.purchaseOrders[0].orderedAt, "2026-08-01T00:00:00.000Z");
assert.equal(a.purchaseOrders[0].durationDays, 4, "采购单全部到齐后应以最后入库日截止计时");
assert.equal(a.purchaseOrders[0].status, "ready");
assert.equal(a.materials.find((item) => item.sku === "PK-A-2")?.expectedDeliveryAt, "2026-08-09T00:00:00.000Z", "人工计划到料时间优先");
assert.equal(a.materials.find((item) => item.sku === "PK-A-2")?.expectedDeliverySource, "planned");

assert.deepEqual(d.materials[0].leadTime, { code: "standard", label: "常规包材", warningDays: 15, maxDays: 20 });
assert.equal(d.materials[0].purchaseOrderedAt, "2026-08-10T00:00:00.000Z");
assert.equal(d.materials[0].expectedDeliveryAt, "2026-08-30T00:00:00.000Z");
assert.equal(d.materials[0].purchaseDurationDays, 17);
assert.equal(d.materials[0].leadTimeStatus, "warning", "常规包材第 15–20 天应提醒但不算逾期");

assert.deepEqual(e.materials[0].leadTime, { code: "single_box", label: "单只盒", warningDays: 7, maxDays: 10 });
assert.equal(e.materials[0].expectedDeliveryAt, "2026-08-20T00:00:00.000Z");
assert.equal(e.materials[0].leadTimeStatus, "overdue", "单只盒超过 10 天应逾期");

assert.deepEqual(f.materials[0].leadTime, { code: "premium_box", label: "精装/套盒", warningDays: 25, maxDays: 25 });
assert.equal(f.materials[0].expectedDeliveryAt, "2026-09-04T00:00:00.000Z");
assert.equal(f.materials[0].leadTimeStatus, "normal", "精装套盒 25 天内应为正常");

const completed = buildProductionMaterialProgress(outsourcingRecords, purchaseRecords, [
  ...inboundRecords,
  {
    data_id: "in-b-inner-rest",
    _widget_1690032758345: field("RK-B-3"),
    _widget_1741850722101: field("2026-08-09T00:00:00.000Z"),
    _widget_1696603667734: field("PO-B-2"),
    _widget_1741756513043: field([{ _widget_1741756513046: field("IN-B"), _widget_1741850722077: field(30) }]),
  },
], "test", new Date("2026-08-27T00:00:00.000Z"));
assert.equal(completed.byOrderNo["JG-B"].status, "ready");
assert.equal(completed.byOrderNo["JG-B"].readyAt, "2026-08-09T00:00:00.000Z");

const aliasA = supplierAlias("vendor-package-a", "秘密包材供应商甲");
assert.match(aliasA, /^供应商 [A-Z0-9]{4}$/);
assert.equal(aliasA, supplierAlias("vendor-package-a", "另一个名称"), "有供应商 ID 时匿名代号应稳定");
assert.equal(supplierReference("factory-a", "同厂加工"), supplierReference("factory-a", "杭州同厂加工有限公司"));
assert.notEqual(aliasA, supplierAlias("vendor-package-b", "秘密包材供应商乙"));
const redactionEntries = buildSupplierRedactionEntries([
  { id: "vendor-package-a", name: "秘密包材供应商甲有限公司" },
  { id: "vendor-package-b", name: "秘密包材供应商乙" },
  { id: "vendor-short", name: "义乌市雅领包装制品有限公司" },
], ["雅领（预计明天送达）"]);
const redactedRemark = redactSupplierText("秘密包材供应商甲预计明天送达，秘密包材供应商乙待确认", redactionEntries);
assert.equal(redactedRemark.includes("秘密包材供应商"), false, "跟单备注中的已知供应商名称也应脱敏");
assert.match(redactedRemark, /供应商 [A-Z0-9]{4}/);
assert.equal(redactSupplierText("雅领（预计明天送达）", redactionEntries).includes("雅领"), false, "备注中的供应商简称也应脱敏");

const serialized = JSON.stringify(first);
for (const secret of ["秘密包材供应商甲", "秘密包材供应商乙", "秘密内料供应商乙", "vendor-package-a", "inner-vendor-b"]) {
  assert.equal(serialized.includes(secret), false, `响应不得包含原始供应商信息：${secret}`);
}

console.log("production material readiness tests passed");

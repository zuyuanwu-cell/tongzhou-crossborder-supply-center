import assert from "node:assert/strict";
import { buildStockupWorkflowPayload, buildWorkflowStageCounts, calculateShipmentCosts, completeProductCoding, findStockupOrderLinkField, shipmentFeeJdyData, stockupDemandJdyData, stockupExecutionJdyData, updateStockupExecutionLine, workflowShipmentJdyData } from "../server/stockup-workflow.js";
import { JIANYUN_FORMS } from "../server/field-mapping.js";

function shipment(lines) {
  return {
    id: "shipment-test-1",
    shipmentNo: "FH-TEST-001",
    stockupOrderRecordId: "stockup-1",
    project: "SHOPEE 印尼",
    destinationCountry: "印度尼西亚",
    destinationWarehouseName: "神牛仓",
    currentCostVersion: 0,
    lines,
  };
}

const lines = [
  { id: "line-a", productRecordId: "p-a", sku: "SKU-A", productName: "A", shippedQty: 10, receivedQty: 10, totalWeightKg: 3, totalVolumeM3: 0.02, baseUnitCostCny: 5, baseCostTotalCny: 50 },
  { id: "line-b", productRecordId: "p-b", sku: "SKU-B", productName: "B", shippedQty: 20, receivedQty: 20, totalWeightKg: 2, totalVolumeM3: 0.03, baseUnitCostCny: 10, baseCostTotalCny: 200 },
];

const weightPreview = calculateShipmentCosts({
  shipment: shipment(lines),
  costType: "正式",
  fees: [{ id: "fee-1", feeType: "头程运费", originalAmount: 100, exchangeRate: 1, allocationMethod: "按重量", includedInLandedCost: true }],
});
assert.equal(weightPreview.ok, true);
assert.deepEqual(weightPreview.feeResults[0].allocations.map((item) => item.finalAmount), [60, 40]);
assert.equal(weightPreview.totals.allocationDifferenceCny, 0);
assert.equal(weightPreview.costBatches[0].landedUnitCostCny, 11);
assert.equal(weightPreview.costBatches[1].landedUnitCostCny, 12);

const volumePreview = calculateShipmentCosts({
  shipment: shipment(lines),
  fees: [{ feeType: "保险费", originalAmount: 50, exchangeRate: 1, allocationMethod: "volume", includedInLandedCost: true }],
});
assert.deepEqual(volumePreview.feeResults[0].allocations.map((item) => item.finalAmount), [20, 30]);

const quantityPreview = calculateShipmentCosts({
  shipment: shipment(lines),
  fees: [{ feeType: "包装材料费", originalAmount: 30, exchangeRate: 1, allocationMethod: "quantity", includedInLandedCost: true }],
});
assert.deepEqual(quantityPreview.feeResults[0].allocations.map((item) => item.finalAmount), [10, 20]);

const valuePreview = calculateShipmentCosts({
  shipment: shipment(lines),
  fees: [{ feeType: "保险费", originalAmount: 25, exchangeRate: 1, allocationMethod: "value", includedInLandedCost: true }],
});
assert.deepEqual(valuePreview.feeResults[0].allocations.map((item) => item.finalAmount), [5, 20]);

const roundingPreview = calculateShipmentCosts({
  shipment: shipment([
    { id: "a", sku: "A", shippedQty: 1, totalWeightKg: 1, baseUnitCostCny: 1 },
    { id: "b", sku: "B", shippedQty: 1, totalWeightKg: 1, baseUnitCostCny: 1 },
    { id: "c", sku: "C", shippedQty: 1, totalWeightKg: 1, baseUnitCostCny: 1 },
  ]),
  fees: [{ feeType: "其他", originalAmount: 100, exchangeRate: 1, allocationMethod: "weight", includedInLandedCost: true }],
});
assert.deepEqual(roundingPreview.feeResults[0].allocations.map((item) => item.finalAmount), [33.34, 33.33, 33.33]);
assert.equal(roundingPreview.feeResults[0].allocations.reduce((sum, item) => sum + item.finalAmount, 0), 100);

const excludedPreview = calculateShipmentCosts({
  shipment: shipment(lines),
  fees: [{ feeType: "其他", originalAmount: 10, exchangeRate: 1, allocationMethod: "quantity", includedInLandedCost: false }],
});
assert.equal(excludedPreview.totals.includedFeesCny, 0);
assert.equal(excludedPreview.totals.excludedFeesCny, 10);
assert.equal(excludedPreview.totals.landedCostCny, 250);

const zeroBasisPreview = calculateShipmentCosts({
  shipment: shipment(lines.map((line) => ({ ...line, totalWeightKg: 0 }))),
  fees: [{ feeType: "头程运费", originalAmount: 10, exchangeRate: 1, allocationMethod: "weight", includedInLandedCost: true }],
});
assert.equal(zeroBasisPreview.ok, false);
assert.match(zeroBasisPreview.errors.join(" "), /基数合计为 0/);

const missingSkuPreview = calculateShipmentCosts({
  shipment: shipment([{ ...lines[0], sku: "" }]),
  fees: [],
});
assert.equal(missingSkuPreview.ok, false);
assert.equal(missingSkuPreview.costBatches[0].exceptionCode, 101);

const feeData = shipmentFeeJdyData({
  shipmentRecordId: "shipment-test-1",
  shipmentNo: "FH-TEST-001",
  feeType: "头程运费",
  originalAmount: 100,
  exchangeRate: 1,
  currency: "CNY",
  allocationMethod: "weight",
}, weightPreview.feeResults[0]);
assert.equal(feeData[JIANYUN_FORMS.shipmentFees.fields.amountCny].value, 100);
assert.equal(feeData[JIANYUN_FORMS.shipmentFees.fields.allocations].value.length, 2);

const demandPrepared = stockupDemandJdyData({
  productSourceType: "外采新品",
  productName: "测试新品",
  requestedQty: 100,
  destinationCountry: "印度尼西亚",
  stockupMethod: "外采成品",
});
assert.match(demandPrepared.demandBatchNo, /^XQ-/);
assert.match(demandPrepared.temporaryProductNo, /^TMP-/);
assert.equal(demandPrepared.data[JIANYUN_FORMS.stockupDemands.fields.skuCodingStatus].value, "待编码");

const demand = {
  id: "demand-1", demandBatchNo: "XQ-001", sku: "SKU-A", productName: "A", productRecordId: "p-a",
  requestedQty: 100, plannedQty: 0, stockupMethod: "外采成品", destinationCountry: "印度尼西亚",
  destinationWarehouseRecordId: "wh-1", destinationWarehouseName: "神牛仓", project: "SHOPEE 印尼",
};
const executionPrepared = stockupExecutionJdyData({ plannedQty: 100, baseUnitCost: 5 }, demand);
assert.equal(executionPrepared.plannedQty, 100);
assert.equal(executionPrepared.lineData[JIANYUN_FORMS.stockupOrderLines.fields.officialSku].value, "SKU-A");

assert.equal(findStockupOrderLinkField([
  { type: "text", widgetName: "text-field", label: "备货单记录ID" },
  { type: "linkdata", widgetName: "_widget_link_field", label: "关联备货单", targetEntryId: JIANYUN_FORMS.stockupOrders.entryId },
]), "_widget_link_field");
assert.equal(findStockupOrderLinkField([{ type: "text", widgetName: "text-field", label: "备货单记录ID" }]), "");

const scopedPayload = buildStockupWorkflowPayload({
  demandRecords: [
    { data_id: "new-demand", [JIANYUN_FORMS.stockupDemands.fields.demandBatchNo]: { value: "XQ-TEST-001" }, [JIANYUN_FORMS.stockupDemands.fields.requestedQty]: { value: 10 } },
    { data_id: "old-demand", [JIANYUN_FORMS.stockupDemands.fields.demandBatchNo]: { value: "LEGACY-001" }, [JIANYUN_FORMS.stockupDemands.fields.requestedQty]: { value: 20 } },
  ],
  orderRecords: [], lineRecords: [], shipmentRecords: [], feeRecords: [], costRecords: [], productRecords: [], warnings: [],
});
assert.equal(scopedPayload.historyHidden, true);
assert.deepEqual(scopedPayload.demands.map((item) => item.id), ["new-demand"]);

const stageCounts = buildWorkflowStageCounts({
  demands: [
    { id: "demand-pending", requestedQty: 10, plannedQty: 0, businessStatus: "待受理" },
    { id: "demand-moved", requestedQty: 10, plannedQty: 10, businessStatus: "执行中" },
    { id: "demand-coding", requestedQty: 10, plannedQty: 0, businessStatus: "待编码" },
  ],
  orderLines: [
    { id: "line-execution", plannedQty: 10, cancelledQty: 0, qualifiedQty: 5, shippedQty: 0, status: "生产中" },
    { id: "line-shipment", plannedQty: 10, cancelledQty: 0, qualifiedQty: 10, shippedQty: 0, status: "待发货" },
    { id: "line-complete", plannedQty: 10, cancelledQty: 0, qualifiedQty: 10, shippedQty: 10, status: "已发货" },
  ],
  shipments: [
    { id: "shipment-cost", lines: [{ id: "shipment-cost-line" }] },
    { id: "shipment-lock", lines: [{ id: "shipment-lock-line" }] },
    { id: "shipment-complete", lines: [{ id: "shipment-complete-line" }] },
  ],
  costBatches: [
    { shipmentRecordId: "shipment-lock", shipmentLineId: "shipment-lock-line", status: "待锁定", isCurrent: true },
    { shipmentRecordId: "shipment-complete", shipmentLineId: "shipment-complete-line", status: "已锁定", isCurrent: true },
  ],
  productCodingQueue: [{ id: "coding-1", sourceDemandRecordId: "demand-coding" }],
});
assert.deepEqual(stageCounts, {
  pendingDemands: 1,
  pendingExecutionLines: 1,
  pendingShipmentLines: 1,
  pendingCostShipments: 1,
  pendingLockShipments: 1,
  activeExecutionLines: 2,
  activeWorkItems: 6,
});

const workflow = {
  demands: [demand],
  stockupOrders: [{ id: "order-1", orderNo: "BHD-001", project: "SHOPEE 印尼", destinationCountry: "印度尼西亚", destinationWarehouseRecordId: "wh-1", destinationWarehouseName: "神牛仓", status: "执行中", orderedQty: 0, completedQty: 0, shippedQty: 0, receivedQty: 0, dataVersion: 1 }],
  stockupLines: [{ id: "stock-line-1", orderRecordId: "order-1", demandRecordId: "demand-1", productRecordId: "p-a", temporaryProductNo: "", sku: "SKU-A", productName: "A", plannedQty: 100, orderedQty: 0, completedQty: 0, qualifiedQty: 0, shippedQty: 0, receivedQty: 0, baseCurrency: "CNY", baseExchangeRate: 1, actualBaseUnitCost: 5, status: "待下单" }],
};
const progressDryRun = await updateStockupExecutionLine({ stockupLineRecordId: "stock-line-1", orderedQty: 100, completedQty: 100, qualifiedQty: 95, actualBaseUnitCost: 5.2, dryRun: true }, workflow);
assert.equal(progressDryRun.status, "部分合格");
assert.equal(progressDryRun.totals.orderedQty, 100);

const readyWorkflow = { ...workflow, stockupLines: [{ ...workflow.stockupLines[0], orderedQty: 100, completedQty: 100, qualifiedQty: 95, actualBaseUnitCost: 5.2, status: "部分合格" }] };
const shipmentPrepared = workflowShipmentJdyData({ stockupOrderRecordId: "order-1", lines: [{ stockupLineRecordId: "stock-line-1", shippedQty: 90, totalWeightKg: 45, totalVolumeM3: 0.4 }] }, readyWorkflow);
assert.equal(shipmentPrepared.normalizedLines.length, 1);
assert.equal(shipmentPrepared.data[JIANYUN_FORMS.shipments.fields.actualWeightKg].value, 45);
assert.throws(() => workflowShipmentJdyData({ stockupOrderRecordId: "order-1", lines: [{ stockupLineRecordId: "stock-line-1", shippedQty: 96, totalWeightKg: 45, totalVolumeM3: 0.4 }] }, readyWorkflow), /不能超过合格可发数量/);

const codingDryRun = await completeProductCoding({ productRecordId: "demand:demand-1", sku: "NEW-SKU-001", dryRun: true }, {
  demands: [{ ...demand, sku: "", temporaryProductNo: "" }],
  productOptions: [],
  productCodingQueue: [{ id: "demand:demand-1", temporaryProductNo: "历史需求-demand-1", productName: "A", sourceDemandRecordId: "demand-1", sourceDemandBatchNo: "XQ-001", codingAppliedAt: "", skuCodingStatus: "待编码" }],
});
assert.equal(codingDryRun.dryRun, true);
assert.equal(codingDryRun.productData[JIANYUN_FORMS.productBase.fields.sku].value, "NEW-SKU-001");
assert.equal(codingDryRun.demandData[JIANYUN_FORMS.stockupDemands.fields.officialSku].value, "NEW-SKU-001");

console.log("stockup-workflow-test: ok");

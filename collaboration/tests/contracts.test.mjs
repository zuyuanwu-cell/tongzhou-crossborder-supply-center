import test from "node:test";
import assert from "node:assert/strict";
import { collaborationProjectionSchema, internalPartnerTaskSchema, internalWarehouseTaskSchema, inventoryProjectionSchema, oemArtifactSchema, oemProjectionSchema, partnerOrderProjectionSchema, partnerOrderReportSchema, riskByAction, sampleArtifactReviewSchema, supplierQuoteSchema, warehouseOperationSchema, workItemActionSchema } from "../shared/contracts.js";
import { canPerformAction, requiresMfaAtLogin } from "../api/permissions.js";
import { organizationAccessCatalog } from "../api/access.js";

const validProjection = {
  eventId: "evt-1",
  organizationCode: "warehouse-a",
  coreRefType: "domestic_transfer",
  coreRefId: "transfer-1",
  itemType: "warehouse_transfer",
  title: "调拨收货",
  version: 1,
  publicPayload: { warehouseRef: "wh-1", warehouseName: "一号仓", referenceNo: "DB-1" },
  lines: [{ sku: "SKU-1", productName: "产品一", plannedQuantity: 10 }],
};

test("collaboration projection only accepts the public allowlist", () => {
  assert.equal(collaborationProjectionSchema.parse(validProjection).lines[0].sku, "SKU-1");
  assert.equal(collaborationProjectionSchema.safeParse({ ...validProjection, customerName: "敏感客户" }).success, false);
  assert.equal(collaborationProjectionSchema.safeParse({ ...validProjection, publicPayload: { ...validProjection.publicPayload, unitCost: 99 } }).success, false);
});

test("partner action schemas reject unbounded and unknown payload fields", () => {
  assert.equal(workItemActionSchema.safeParse({ action: "accept", note: "已收到" }).success, true);
  assert.equal(workItemActionSchema.safeParse({ action: "accept", internalCost: 42 }).success, false);
  assert.equal(workItemActionSchema.safeParse({ action: "inventory_adjustment", reason: "盘点差异", lines: [{ sku: "SKU-1", quantity: 2, direction: "decrease" }] }).success, true);
  assert.equal(workItemActionSchema.safeParse({ action: "inventory_adjustment", reason: "盘点差异", lines: [{ sku: "SKU-1", quantity: 2 }] }).success, false);
  assert.equal(riskByAction.inventory_adjustment, "high");
  const stockupProcess = {
    action: "stockup_process",
    note: "验收并完成分流",
    lines: [{ workOrderLineId: "line-1", sku: "SKU-1", receivedQty: 10, goodQty: 9, damagedQty: 1, shortageQty: 0, pendingQty: 0, requiresRepack: true, replacementCartonCount: 1, lotNo: "LOT-1", barcode: "6970001", cartonCount: 1, unitsPerCarton: 9, cartonLengthCm: 50, cartonWidthCm: 40, cartonHeightCm: 30, cartonWeightKg: 12 }],
    expenses: [{ category: "换箱费", name: "换箱", amountCny: 10, occurredAt: "2026-10-13" }],
    routes: [{ routeType: "overseas_warehouse", destinationName: "莫斯科仓", destinationCountry: "俄罗斯", status: "dispatched", lines: [{ workOrderLineId: "line-1", quantity: 6 }] }, { routeType: "domestic_customer", destinationName: "上海客户", destinationCountry: "中国", status: "dispatched", lines: [{ workOrderLineId: "line-1", quantity: 3 }] }],
  };
  assert.equal(workItemActionSchema.safeParse(stockupProcess).success, true);
  assert.equal(workItemActionSchema.safeParse({ ...stockupProcess, lines: [{ ...stockupProcess.lines[0], unitCost: 99 }] }).success, false);
  assert.equal(riskByAction.stockup_process, "medium");
});

test("inventory images and partner-created warehouse operations stay on a strict allowlist", () => {
  const inventory = { eventId: "inventory-1", organizationCode: "warehouse-a", warehouseRef: "wh-1", warehouseName: "一号仓", version: 1, syncedAt: new Date().toISOString(), items: [{ sku: "SKU-1", productName: "产品一", barcode: "697000000001", imageUrl: "https://files.example.test/product.jpg", availableQuantity: 8 }] };
  assert.equal(inventoryProjectionSchema.safeParse(inventory).success, true);
  assert.equal(inventoryProjectionSchema.parse(inventory).items[0].barcode, "697000000001");
  assert.equal(inventoryProjectionSchema.safeParse({ ...inventory, items: [{ ...inventory.items[0], imageUrl: "not-a-url" }] }).success, false);
  assert.equal(inventoryProjectionSchema.safeParse({ ...inventory, items: [{ ...inventory.items[0], imageUrl: "http://files.example.test/product.jpg" }] }).success, false);
  const inbound = { operationType: "inbound", warehouseRef: "wh-1", referenceNo: "", note: "采购到货", lines: [{ sku: "SKU-1", productName: "产品一", quantity: 3, unit: "件" }] };
  assert.equal(warehouseOperationSchema.safeParse(inbound).success, true);
  assert.equal(warehouseOperationSchema.safeParse({ ...inbound, internalCost: 99 }).success, false);
  assert.equal(warehouseOperationSchema.safeParse({ operationType: "stocktake", warehouseRef: "wh-1", note: "月度盘点", lines: [{ sku: "SKU-1", productName: "产品一", countedQuantity: 0, unit: "件" }] }).success, true);
});

test("internal warehouse task publication only accepts public collaboration fields", () => {
  const input = {
    organizationCode: "warehouse-a",
    warehouseRef: "wh-1",
    itemType: "warehouse_outbound",
    referenceNo: "CK-20260929-001",
    title: "电商订单出库",
    description: "按附件清单拣货并复核",
    priority: "urgent",
    dueAt: "2026-09-30T10:00:00.000+08:00",
    lines: [{ sku: "SKU-1", plannedQuantity: 12, unit: "盒" }],
  };
  assert.equal(internalWarehouseTaskSchema.safeParse(input).success, true);
  assert.equal(internalWarehouseTaskSchema.safeParse({ ...input, internalCost: 18.5 }).success, false);
  assert.equal(internalWarehouseTaskSchema.safeParse({ ...input, itemType: "warehouse_stocktake" }).success, false);
  assert.equal(internalWarehouseTaskSchema.safeParse({ ...input, lines: [{ sku: "SKU-1", plannedQuantity: 0 }] }).success, false);
  const stockup = {
    ...input,
    itemType: "warehouse_stockup",
    coreRefType: "stockup_warehouse_work_order",
    coreRefId: "work-order-1",
    lines: [{ sourceLineId: "line-1", sku: "SKU-1", plannedQuantity: 12, unit: "盒" }],
    workOrder: { workOrderId: "work-order-1", requestNo: "BH-001", expectedArrivalAt: "2026-09-30T10:00:00.000+08:00", instructions: "验货、换箱并登记箱规", expenseCategories: ["换箱费", "货拉拉费"] },
  };
  assert.equal(internalWarehouseTaskSchema.safeParse(stockup).success, true);
  assert.equal(internalWarehouseTaskSchema.safeParse({ ...stockup, workOrder: { ...stockup.workOrder, supplierUnitCost: 8 } }).success, false);
});

test("organization jobs enforce role capabilities without an authenticator gate", () => {
  const operator = { role: "operator", status: "active", permissions: [] };
  const manager = { role: "manager", status: "active", permissions: [] };
  assert.equal(canPerformAction(operator, "transfer_receive"), true);
  assert.equal(canPerformAction(operator, "inventory_adjustment"), false);
  assert.equal(canPerformAction(manager, "inventory_adjustment"), true);
  assert.equal(canPerformAction(operator, "stockup_process"), true);
  assert.equal(requiresMfaAtLogin({ role: "organization_admin", mfa_required: true }), false);
});

test("OEM projections create one typed private space and reject sensitive fields", () => {
  const projection = {
    eventId: "oem-event-1",
    organizationCode: "packaging-partner-a",
    coreRefType: "packaging_rfq",
    coreRefId: "rfq-1",
    spaceType: "packaging_quote",
    itemType: "packaging_quote",
    title: "包装盲报价",
    version: 1,
    publicPayload: { projectCode: "OEM-001", productName: "洗护套装", quantity: 1000, quoteCurrency: "CNY" },
  };
  assert.equal(oemProjectionSchema.safeParse(projection).success, true);
  assert.equal(oemProjectionSchema.safeParse({ ...projection, itemType: "sampling_task" }).success, false);
  assert.equal(oemProjectionSchema.safeParse({ ...projection, publicPayload: { ...projection.publicPayload, internalCost: 12 } }).success, false);
});

test("blind quote contract accepts business terms but no competitor metadata", () => {
  const quote = { workItemId: "11111111-1111-4111-8111-111111111111", currency: "CNY", amount: 12000, minimumOrderQuantity: 1000, leadTimeDays: 21, terms: "含税到仓" };
  assert.equal(supplierQuoteSchema.safeParse(quote).success, true);
  assert.equal(supplierQuoteSchema.safeParse({ ...quote, competitorName: "另一家包装厂" }).success, false);
});

test("sampling contracts enforce typed rounds, review reasons and exact approved-version quote binding", () => {
  const sampling = {
    taskType: "sampling_task", documentNo: "DY-001", title: "洗发水内料打样", productName: "洗发水", quantity: 6, unit: "瓶",
    sampleCategory: "inner_material", sampleSubject: "formula", sampleGoal: "确认香型与肤感", evaluationCriteria: "稳定性和气味合格", quoteRequired: true,
    lines: [{ sku: "SAMPLE-1", productName: "洗发水内料", plannedQuantity: 6, unit: "瓶", lineType: "raw_material" }],
  };
  assert.equal(internalPartnerTaskSchema.safeParse(sampling).success, true);
  assert.equal(internalPartnerTaskSchema.safeParse({ ...sampling, title: "", documentNo: "", quantity: 1, unit: "轮", lines: [] }).success, true);
  assert.equal(internalPartnerTaskSchema.safeParse({ ...sampling, documentNo: "" }).success, true);
  assert.equal(internalPartnerTaskSchema.safeParse({ ...sampling, taskType: "purchase_order", documentNo: "", sampleCategory: undefined, sampleSubject: undefined }).success, false);
  assert.equal(internalPartnerTaskSchema.safeParse({ ...sampling, sampleCategory: "packaging", sampleSubject: "formula" }).success, false);
  assert.equal(internalPartnerTaskSchema.safeParse({ ...sampling, internalTargetCost: 5.2 }).success, false);
  const artifact = { workItemId: "11111111-1111-4111-8111-111111111111", artifactType: "sample_result", title: "第2轮样品", version: 2, publicPayload: { summary: "黏度已调整", result: "passed", roundNo: 2, sampleCategory: "inner_material", sampleSubject: "formula", sampleQuantity: 6, unit: "瓶", specificationVersion: "Formula V2", supplierConclusion: "自检通过", nextPlan: "等待中台评审", sampleVariants: [{ supplierMaterialCode: "SY-A-2601", name: "清爽型 A", sampleQuantity: 3, unit: "瓶", description: "清爽、低香" }, { supplierMaterialCode: "SY-B-2601", name: "滋润型 B", sampleQuantity: 3, unit: "瓶", description: "滋润度更高" }], attachmentIds: [] } };
  assert.equal(oemArtifactSchema.safeParse(artifact).success, true);
  assert.equal(oemArtifactSchema.safeParse({ ...artifact, publicPayload: { ...artifact.publicPayload, sampleVariants: [{ ...artifact.publicPayload.sampleVariants[0], variantCode: "MANUAL-CODE" }] } }).success, false);
  assert.equal(sampleArtifactReviewSchema.safeParse({ approved: false, note: "" }).success, false);
  assert.equal(sampleArtifactReviewSchema.safeParse({ approved: false, note: "香型需要继续减弱" }).success, true);
  assert.equal(sampleArtifactReviewSchema.safeParse({ approved: true, approvedVariantCode: "LT-SAMPLE-R02-01", note: "客户确认" }).success, true);
  assert.equal(supplierQuoteSchema.safeParse({ workItemId: artifact.workItemId, sampleArtifactId: "22222222-2222-4222-8222-222222222222", currency: "CNY", amount: 26000, minimumOrderQuantity: 10000, leadTimeDays: 20, terms: "含税" }).success, true);
});

test("partner order projections expose only one organization's production or purchase order", () => {
  const projection = {
    eventId: "partner-order-1", organizationCode: "pf-factory-a", coreRefType: "outsourcing_order", coreRefId: "MO-001",
    orderType: "production", itemType: "production_order", title: "委外灌装加工单 MO-001", version: 1,
    publicPayload: { orderNo: "MO-001", projectCode: "OEM-001", productName: "洗护套装", productSpec: "500ml × 2", barcode: "6970000000001", productionProcess: "灌装,贴标,装盒", cartonType: "专用箱", piecesPerCarton: 24, factoryExpectedDeliveryDate: "2026-11-18", fulfillmentMode: "turnkey", quantity: 10000, unit: "套", deliveryDate: "2026-11-20", firstArticle: { matchedBy: "barcode", documentNo: "FA-001", version: "V2", productSku: "SKU-F", productName: "洗护套装", specification: "500ml × 2", barcode: "6970000000001", productionProcess: "灌装,贴标,装盒", cartonSpecification: "24套/箱", updatedAt: "2026-10-13T10:00:00.000Z", bom: [{ category: "包材", name: "瓶体", materialCode: "PACK-1", netContent: "500", unit: "ml", composition: "2" }], images: [{ category: "finished", label: "成品效果", name: "成品.jpg", url: "https://files.jiandaoyun.com/finished.jpg", mime: "image/jpeg", size: 1024 }] } },
    lines: [
      { lineRef: "finished-1", lineType: "finished_product", sku: "SKU-F", productName: "洗护套装", plannedQuantity: 10000, unit: "套", responsibility: "factory" },
      { lineRef: "pack-1", lineType: "packaging", sku: "PACK-1", productName: "500ml 瓶体", plannedQuantity: 10500, unit: "个", responsibility: "factory" },
    ],
  };
  assert.equal(partnerOrderProjectionSchema.safeParse(projection).success, true);
  assert.equal(partnerOrderProjectionSchema.parse(projection).publicPayload.piecesPerCarton, 24);
  assert.equal(partnerOrderProjectionSchema.safeParse({ ...projection, publicPayload: { ...projection.publicPayload, internalCost: 12 } }).success, false);
  assert.equal(partnerOrderProjectionSchema.safeParse({ ...projection, publicPayload: { ...projection.publicPayload, firstArticle: { ...projection.publicPayload.firstArticle, supplierName: "不应外发" } } }).success, false);
  assert.equal(partnerOrderProjectionSchema.safeParse({ ...projection, lines: projection.lines.map((line, index) => index ? { ...line, unitPrice: 1.2 } : line) }).success, false);
  assert.equal(partnerOrderProjectionSchema.safeParse({ ...projection, orderType: "purchase" }).success, false);
  assert.equal(partnerOrderProjectionSchema.safeParse({ ...projection, organizationCode: "" }).success, false);
});

test("turnkey material tests require an explanation when testing fails", () => {
  const report = { reportType: "material_readiness", lineId: "11111111-1111-4111-8111-111111111111", readiness: "arrived", arrivedQuantity: 100, testResult: "failed", testedAt: "2026-10-13", exceptionDescription: "", note: "" };
  assert.equal(partnerOrderReportSchema.safeParse(report).success, false);
  assert.equal(partnerOrderReportSchema.safeParse({ ...report, exceptionDescription: "瓶盖密封测试漏液" }).success, true);
  assert.equal(partnerOrderReportSchema.safeParse({ reportType: "production_progress", stage: "filling", progressPercent: 101, completedQuantity: 10, expectedCompletionDate: "2026-10-20", note: "灌装中" }).success, false);
});

test("full-service production factories can be explicitly granted production, procurement and sampling", () => {
  const catalog = organizationAccessCatalog("production_factory");
  assert.deepEqual(catalog.resources.map((resource) => resource.resourceRef), ["sampling", "production", "procurement"]);
  const procurement = catalog.resources.find((resource) => resource.resourceRef === "procurement");
  assert.deepEqual(procurement.capabilities.map((capability) => capability.key), [
    "procurement.order.view",
    "procurement.fulfillment.update",
    "procurement.exception.report",
    "attachment.upload",
  ]);
  const sampling = catalog.resources.find((resource) => resource.resourceRef === "sampling");
  assert.equal(sampling.capabilities.some((capability) => capability.key === "sampling.quote.submit"), true);
  assert.deepEqual(organizationAccessCatalog("material_supplier").resources.map((resource) => resource.resourceRef), ["sampling", "procurement"]);
  assert.deepEqual(organizationAccessCatalog("packaging_factory").resources.map((resource) => resource.resourceRef), ["sampling", "packaging_quote", "procurement"]);
});

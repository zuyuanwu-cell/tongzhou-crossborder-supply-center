import { z } from "zod";

const limitedText = (max) => z.string().trim().max(max);
const isoDateTime = z.string().datetime({ offset: true }).or(z.literal(""));
const quantity = z.number().finite().nonnegative();
const httpsImageUrl = z.string().url().max(2_000).refine((value) => {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}, "图片地址必须使用 HTTPS。");

export const warehouseLineSchema = z.object({
  sourceLineId: limitedText(160).optional().default(""),
  sku: limitedText(100).min(1),
  productName: limitedText(300).min(1),
  imageUrl: httpsImageUrl.optional().or(z.literal("")),
  plannedQuantity: quantity,
  completedQuantity: quantity.optional().default(0),
  unit: limitedText(20).default("件"),
  lotNo: limitedText(100).optional().default(""),
  barcode: limitedText(100).optional().default(""),
  productionDate: limitedText(10).optional().default(""),
  expiryDate: limitedText(10).optional().default(""),
}).strict();

const stockupWorkOrderPayloadSchema = z.object({
  workOrderId: limitedText(160).min(1),
  workflowVersion: z.number().int().min(1).max(2).optional().default(1),
  requestNo: limitedText(120).min(1),
  expectedArrivalAt: isoDateTime.optional().default(""),
  senderName: limitedText(200).optional().default(""),
  senderContact: limitedText(300).optional().default(""),
  inboundCarrier: limitedText(120).optional().default(""),
  inboundTrackingNo: limitedText(160).optional().default(""),
  instructions: limitedText(5_000).min(1),
  destinationCountry: limitedText(120).optional().default(""),
  destinationWarehouseName: limitedText(200).optional().default(""),
  lineRequirements: z.record(limitedText(160), z.object({ shelfLifeManaged: z.boolean().optional().default(false) }).strict()).optional().default({}),
  expenseCategories: z.array(limitedText(40).min(1)).max(30).optional().default([]),
}).strict();

const safeWarehousePayloadSchema = z.object({
  referenceNo: limitedText(120).optional().default(""),
  warehouseRef: limitedText(120).min(1),
  warehouseName: limitedText(200).min(1),
  sourceWarehouseName: limitedText(200).optional().default(""),
  destinationWarehouseName: limitedText(200).optional().default(""),
  note: limitedText(2_000).optional().default(""),
  workOrder: stockupWorkOrderPayloadSchema.optional(),
}).strict();

export const collaborationProjectionSchema = z.object({
  eventId: limitedText(160).min(1),
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  coreRefType: limitedText(80).min(1),
  coreRefId: limitedText(160).min(1),
  itemType: z.enum(["warehouse_inbound", "warehouse_outbound", "warehouse_transfer", "warehouse_stockup", "warehouse_exception"]),
  title: limitedText(240).min(1),
  description: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  status: z.enum(["pending", "accepted", "in_progress", "pending_approval", "pending_sync", "completed", "rejected", "cancelled"]).optional().default("pending"),
  dueAt: isoDateTime.optional().default(""),
  version: z.number().int().positive(),
  publicPayload: safeWarehousePayloadSchema,
  lines: z.array(warehouseLineSchema).max(2_000).default([]),
}).strict();

export const internalWarehouseTaskSchema = z.object({
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  warehouseRef: limitedText(120).min(1),
  itemType: z.enum(["warehouse_inbound", "warehouse_outbound", "warehouse_stockup", "warehouse_exception"]),
  coreRefType: limitedText(80).optional().default("internal_warehouse_task"),
  coreRefId: limitedText(160).optional().default(""),
  referenceNo: limitedText(120).optional().default(""),
  title: limitedText(240).min(1),
  description: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  dueAt: isoDateTime.optional().default(""),
  lines: z.array(z.object({
    sourceLineId: limitedText(160).optional().default(""),
    sku: limitedText(100).min(1),
    plannedQuantity: z.number().finite().positive(),
    unit: limitedText(20).optional().default(""),
  }).strict()).min(1).max(500),
  workOrder: stockupWorkOrderPayloadSchema.optional(),
}).strict();

export const inventoryProjectionSchema = z.object({
  eventId: limitedText(160).min(1),
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  warehouseRef: limitedText(120).min(1),
  warehouseName: limitedText(200).min(1),
  version: z.number().int().positive(),
  syncedAt: z.string().datetime({ offset: true }),
  items: z.array(z.object({
    sku: limitedText(100).min(1),
    productName: limitedText(300).min(1),
    imageUrl: httpsImageUrl.optional().or(z.literal("")),
    availableQuantity: quantity,
    lockedQuantity: quantity.optional().default(0),
    inTransitQuantity: quantity.optional().default(0),
    unit: limitedText(20).optional().default("件"),
  }).strict()).max(20_000),
}).strict();

const warehouseOperationLineSchema = z.object({
  sku: limitedText(100).min(1),
  productName: limitedText(300).min(1),
  imageUrl: httpsImageUrl.optional().or(z.literal("")),
  quantity: z.number().finite().positive(),
  unit: limitedText(20).optional().default("件"),
  lotNo: limitedText(100).optional().default(""),
  barcode: limitedText(100).optional().default(""),
  productionDate: limitedText(10).optional().default(""),
  expiryDate: limitedText(10).optional().default(""),
}).strict();

const stocktakeLineSchema = z.object({
  sku: limitedText(100).min(1),
  productName: limitedText(300).min(1),
  imageUrl: httpsImageUrl.optional().or(z.literal("")),
  countedQuantity: quantity,
  unit: limitedText(20).optional().default("件"),
}).strict();

const warehouseOperationBase = {
  warehouseRef: limitedText(120).min(1),
  referenceNo: limitedText(120).optional().default(""),
  note: limitedText(2_000).min(1),
};

export const warehouseOperationSchema = z.discriminatedUnion("operationType", [
  z.object({ ...warehouseOperationBase, operationType: z.literal("inbound"), lines: z.array(warehouseOperationLineSchema).min(1).max(500) }).strict(),
  z.object({ ...warehouseOperationBase, operationType: z.literal("outbound"), lines: z.array(warehouseOperationLineSchema).min(1).max(500) }).strict(),
  z.object({ ...warehouseOperationBase, operationType: z.literal("stocktake"), lines: z.array(stocktakeLineSchema).min(1).max(2_000) }).strict(),
]);

const packagingSpecSchema = z.object({
  material: limitedText(500).optional().default(""),
  process: limitedText(1_000).optional().default(""),
  structureType: limitedText(500).optional().default(""),
  lengthMm: quantity.optional().default(0), widthMm: quantity.optional().default(0), heightMm: quantity.optional().default(0),
  diameterMm: quantity.optional().default(0), capacityMl: quantity.optional().default(0),
  colorPrinting: limitedText(1_000).optional().default(""), designVersion: limitedText(120).optional().default(""),
  fileRequirements: limitedText(2_000).optional().default(""),
}).strict();

const orderLineSchema = z.object({
  id: limitedText(160).min(1), lineType: z.enum(["finished_product", "raw_material", "packaging", "service"]),
  sku: limitedText(100).optional().default(""), productName: limitedText(300).min(1), imageUrl: httpsImageUrl.optional().or(z.literal("")),
  specification: limitedText(2_000).optional().default(""), plannedQuantity: quantity, completedQuantity: quantity.optional().default(0),
  unit: limitedText(20).optional().default("件"), unitPrice: quantity.optional().default(0), currency: limitedText(3).regex(/^[A-Z]{3}$/).optional().default("CNY"),
}).strict();

const firstArticleSchema = z.object({
  matchedBy: limitedText(80).optional().default(""), documentNo: limitedText(160).optional().default(""), version: limitedText(80).optional().default(""),
  productSku: limitedText(100).optional().default(""), productName: limitedText(300).optional().default(""), specification: limitedText(2_000).optional().default(""),
  brandName: limitedText(200).optional().default(""), unit: limitedText(20).optional().default(""), barcode: limitedText(100).optional().default(""),
  filingName: limitedText(300).optional().default(""), bpom: limitedText(160).optional().default(""), productionProcess: limitedText(5_000).optional().default(""),
  cartonSpecification: limitedText(1_000).optional().default(""), updatedAt: isoDateTime.optional().default(""),
  bom: z.array(z.object({ category: limitedText(120).optional().default(""), name: limitedText(300).min(1), materialCode: limitedText(160).optional().default(""), netContent: limitedText(120).optional().default(""), unit: limitedText(20).optional().default(""), composition: limitedText(500).optional().default("") }).strict()).max(500).optional().default([]),
  images: z.array(z.object({ category: limitedText(80).optional().default(""), label: limitedText(200).optional().default(""), name: limitedText(240).optional().default(""), url: limitedText(2_000).min(1), mime: limitedText(120).optional().default(""), size: quantity.optional().default(0) }).strict()).max(100).optional().default([]),
}).strict();

const oemPublicPayloadSchema = z.object({
  projectCode: limitedText(120).min(1),
  productName: limitedText(300).min(1),
  productSpec: limitedText(2_000).optional().default(""),
  documentVersion: limitedText(80).optional().default(""),
  requirements: limitedText(5_000).optional().default(""),
  quantity: quantity.optional().default(0),
  unit: limitedText(20).optional().default("件"),
  deliveryDate: limitedText(10).optional().default(""),
  quoteCurrency: limitedText(3).regex(/^[A-Z]{3}$/).optional().default("CNY"),
  orderNo: limitedText(160).optional().default(""), referenceNo: limitedText(160).optional().default(""),
  productImageUrl: httpsImageUrl.optional().or(z.literal("")), barcode: limitedText(100).optional().default(""),
  productionProcess: limitedText(5_000).optional().default(""), cartonType: limitedText(500).optional().default(""), piecesPerCarton: quantity.optional().default(0),
  fulfillmentMode: limitedText(80).optional().default(""), deliveryAddress: limitedText(1_000).optional().default(""), note: limitedText(2_000).optional().default(""),
  sampleCategory: z.enum(["inner_material", "packaging"]).optional(), sampleSubject: limitedText(120).optional().default(""),
  sampleGoal: limitedText(2_000).optional().default(""), evaluationCriteria: limitedText(5_000).optional().default(""), quoteRequired: z.boolean().optional().default(false),
  packagingSpec: packagingSpecSchema.optional(), firstArticle: firstArticleSchema.optional(), orderLines: z.array(orderLineSchema).max(2_000).optional().default([]),
  linkedProductionOrderNo: limitedText(160).optional().default(""), orderedAt: isoDateTime.optional().default(""),
  receivedQuantity: quantity.optional().default(0), pendingReceiptQuantity: quantity.optional().default(0), orderAmount: quantity.optional().default(0), payableAmount: quantity.optional().default(0),
  paymentTerms: limitedText(1_000).optional().default(""), settlementBasis: limitedText(160).optional().default(""), settlementStatus: limitedText(160).optional().default(""), currency: limitedText(3).regex(/^[A-Z]{3}$/).optional().default("CNY"),
  inboundDocuments: z.array(z.object({ inboundNo: limitedText(160).min(1), inboundAt: isoDateTime.optional().default(""), receivedQuantity: quantity.optional().default(0), payableAmount: quantity.optional().default(0), settlementStatus: limitedText(160).optional().default("") }).strict()).max(500).optional().default([]),
}).strict();

export const oemProjectionSchema = z.object({
  eventId: limitedText(160).min(1),
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  coreRefType: limitedText(80).min(1),
  coreRefId: limitedText(160).min(1),
  spaceType: z.enum(["filing", "sampling", "packaging_quote", "production", "purchase"]),
  itemType: z.enum(["filing_task", "sampling_task", "packaging_quote", "production_order", "purchase_order"]),
  title: limitedText(240).min(1),
  description: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  status: z.enum(["pending", "accepted", "in_progress", "pending_approval", "pending_sync", "completed", "rejected", "cancelled"]).optional().default("pending"),
  dueAt: isoDateTime.optional().default(""),
  version: z.number().int().positive(),
  publicPayload: oemPublicPayloadSchema,
  milestones: z.array(z.object({
    milestoneType: limitedText(80).min(1),
    title: limitedText(240).min(1),
    plannedAt: isoDateTime.optional().default(""),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional().default("pending"),
    publicPayload: z.object({ note: limitedText(2_000).optional().default("") }).strict().optional().default({ note: "" }),
  }).strict()).max(100).optional().default([]),
}).strict().superRefine((value, context) => {
  const expected = { filing: "filing_task", sampling: "sampling_task", packaging_quote: "packaging_quote", production: "production_order", purchase: "purchase_order" }[value.spaceType];
  if (value.itemType !== expected) context.addIssue({ code: z.ZodIssueCode.custom, path: ["itemType"], message: "OEM 空间类型与任务类型不匹配。" });
});

export const supplierQuoteSchema = z.object({
  workItemId: z.string().uuid(),
  currency: limitedText(3).regex(/^[A-Z]{3}$/),
  amount: z.number().finite().nonnegative(),
  minimumOrderQuantity: quantity.optional().default(0),
  leadTimeDays: z.number().int().min(0).max(3650),
  terms: limitedText(5_000).optional().default(""),
  sampleArtifactId: z.string().uuid().optional(),
}).strict();

export const oemArtifactSchema = z.object({
  workItemId: z.string().uuid(),
  artifactType: z.enum(["filing_document", "sample_result", "design_file", "quality_report"]),
  title: limitedText(240).min(1),
  version: z.number().int().positive(),
  publicPayload: z.object({
    summary: limitedText(5_000).optional().default(""),
    result: z.enum(["pending", "passed", "failed", "revision_required"]).optional().default("pending"),
    supplierConclusion: limitedText(2_000).optional().default(""), nextPlan: limitedText(2_000).optional().default(""),
    attachmentIds: z.array(z.string().uuid()).max(100).optional().default([]),
    approvedVariantCode: limitedText(160).optional().default(""), reviewNote: limitedText(2_000).optional().default(""),
    sampleVariants: z.array(z.object({
      variantCode: limitedText(160).optional().default(""), supplierMaterialCode: limitedText(160).optional().default(""), name: limitedText(300).min(1),
      sampleQuantity: quantity.optional().default(0), unit: limitedText(20).optional().default(""), specificationVersion: limitedText(120).optional().default(""), description: limitedText(2_000).optional().default(""),
      material: limitedText(500).optional().default(""), process: limitedText(1_000).optional().default(""), structureType: limitedText(500).optional().default(""),
      lengthMm: quantity.optional().default(0), widthMm: quantity.optional().default(0), heightMm: quantity.optional().default(0), diameterMm: quantity.optional().default(0), capacityMl: quantity.optional().default(0), colorPrinting: limitedText(1_000).optional().default(""),
    }).strict()).max(100).optional().default([]),
  }).strict(),
}).strict();

export const milestoneUpdateSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  note: limitedText(2_000).optional().default(""),
}).strict();

const optionalReportFields = {
  note: limitedText(2_000).optional().default(""),
};

export const partnerOrderReportSchema = z.discriminatedUnion("reportType", [
  z.object({ reportType: z.literal("production_progress"), stage: limitedText(80).min(1), progressPercent: z.number().int().min(0).max(100), completedQuantity: quantity.optional().default(0), expectedCompletionDate: limitedText(10).optional().default(""), ...optionalReportFields }).strict(),
  z.object({ reportType: z.literal("material_readiness"), lineId: limitedText(160).min(1), readiness: limitedText(80).min(1), arrivedQuantity: quantity.optional().default(0), testResult: z.enum(["pending", "passed", "failed"]), testedAt: limitedText(10).optional().default(""), exceptionDescription: limitedText(2_000).optional().default(""), ...optionalReportFields }).strict(),
  z.object({ reportType: z.literal("purchase_fulfillment"), stage: limitedText(80).min(1), completedQuantity: quantity.optional().default(0), expectedDeliveryDate: limitedText(10).optional().default(""), ...optionalReportFields }).strict(),
  z.object({ reportType: z.literal("shipment"), shippedQuantity: z.number().finite().positive(), shippedAt: limitedText(10).min(10), carrier: limitedText(200).optional().default(""), trackingNo: limitedText(200).optional().default(""), ...optionalReportFields }).strict(),
  z.object({ reportType: z.literal("exception"), category: limitedText(80).min(1), severity: z.enum(["low", "medium", "high", "critical"]), title: limitedText(240).min(1), description: limitedText(5_000).min(1), affectedQuantity: quantity.optional().default(0), expectedResolutionDate: limitedText(10).optional().default("") }).strict(),
]);

const actionLineSchema = z.object({
  sku: limitedText(100).min(1),
  quantity: z.number().finite().positive(),
  lotNo: limitedText(100).optional().default(""),
  barcode: limitedText(100).optional().default(""),
  productionDate: limitedText(10).optional().default(""),
  expiryDate: limitedText(10).optional().default(""),
}).strict();

const adjustmentLineSchema = actionLineSchema.extend({
  direction: z.enum(["increase", "decrease"]),
}).strict();

const stockupInspectionLineSchema = z.object({
  workOrderLineId: limitedText(160).min(1),
  sku: limitedText(100).min(1),
  receivedQty: quantity,
  goodQty: quantity,
  damagedQty: quantity,
  shortageQty: quantity,
  pendingQty: quantity,
  requiresRepack: z.boolean().optional().default(false),
  replacementCartonCount: quantity.optional().default(0),
  lotNo: limitedText(100).min(1),
  barcode: limitedText(100).min(1),
  cartonCount: z.number().finite().positive(),
  unitsPerCarton: z.number().finite().positive(),
  cartonLengthCm: z.number().finite().positive(),
  cartonWidthCm: z.number().finite().positive(),
  cartonHeightCm: z.number().finite().positive(),
  cartonWeightKg: z.number().finite().positive(),
  inspectionNote: limitedText(2_000).optional().default(""),
}).strict();

const stockupInspectionLotV2Schema = z.object({
  quantity: z.number().finite().positive(),
  lotNo: limitedText(100).min(1),
  barcode: limitedText(100).min(1),
  productionDate: limitedText(10).min(10),
  expiryDate: limitedText(10).optional().default(""),
  cartonCount: z.number().finite().positive(),
  unitsPerCarton: z.number().finite().positive(),
  looseQuantity: quantity.optional().default(0),
  cartonLengthCm: z.number().finite().positive(),
  cartonWidthCm: z.number().finite().positive(),
  cartonHeightCm: z.number().finite().positive(),
  cartonWeightKg: z.number().finite().positive(),
}).strict();

const stockupInspectionLineV2Schema = z.object({
  id: limitedText(160).min(1),
  receivedQty: quantity,
  goodQty: quantity,
  damagedQty: quantity,
  shortageQty: quantity,
  pendingQty: quantity,
  requiresRepack: z.boolean().optional().default(false),
  replacementCartonCount: quantity.optional().default(0),
  inspectionNote: limitedText(2_000).optional().default(""),
  lots: z.array(stockupInspectionLotV2Schema).max(100),
  evidence: z.array(z.object({ kind: z.enum(["damage", "shortage", "pending", "repack_before", "repack_after", "normal"]), attachmentId: limitedText(160).min(1), fileName: limitedText(240).optional().default("") }).strict()).max(100).default([]),
}).strict();

const stockupExpenseSchema = z.object({
  category: limitedText(40).min(1),
  name: limitedText(160).min(1),
  amountCny: z.number().finite().positive(),
  occurredAt: limitedText(10).min(10),
  vendor: limitedText(200).optional().default(""),
  invoiceNo: limitedText(160).optional().default(""),
  voucherUrl: limitedText(2_000).optional().default(""),
  note: limitedText(2_000).optional().default(""),
  includedInCost: z.boolean().optional().default(true),
}).strict();

const stockupRouteSchema = z.object({
  routeType: z.enum(["overseas_warehouse", "domestic_customer", "hold"]),
  destinationId: limitedText(160).optional().default(""),
  destinationName: limitedText(240).min(1),
  destinationCountry: limitedText(120).optional().default(""),
  destinationAddress: limitedText(1_000).optional().default(""),
  contactName: limitedText(120).optional().default(""),
  contactPhone: limitedText(80).optional().default(""),
  carrier: limitedText(160).optional().default(""),
  transportMode: limitedText(120).optional().default(""),
  trackingNo: limitedText(160).optional().default(""),
  freightForwarder: limitedText(200).optional().default(""),
  status: z.enum(["planned", "ready", "dispatched", "in_transit", "delivered", "received", "shelved", "held"]),
  plannedPickupAt: isoDateTime.optional().default(""),
  dispatchedAt: isoDateTime.optional().default(""),
  note: limitedText(2_000).optional().default(""),
  lines: z.array(z.object({ workOrderLineId: limitedText(160).min(1), quantity: z.number().finite().positive() }).strict()).min(1).max(2_000),
}).strict();

export const workItemActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), note: limitedText(2_000).optional().default("") }).strict(),
  z.object({ action: z.literal("progress"), note: limitedText(2_000).min(1), percent: z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ action: z.literal("report_exception"), category: limitedText(80).min(1), note: limitedText(5_000).min(1) }).strict(),
  z.object({ action: z.enum(["inbound_confirm", "outbound_confirm", "transfer_receive"]), lines: z.array(actionLineSchema).min(1).max(2_000), note: limitedText(2_000).optional().default("") }).strict(),
  z.object({ action: z.literal("inventory_adjustment"), lines: z.array(adjustmentLineSchema).min(1).max(2_000), reason: limitedText(2_000).min(1) }).strict(),
  z.object({ action: z.literal("stockup_process"), lines: z.array(z.union([stockupInspectionLineSchema, stockupInspectionLineV2Schema])).min(1).max(2_000), expenses: z.array(stockupExpenseSchema).max(200).default([]), routes: z.array(stockupRouteSchema).max(200).default([]), note: limitedText(2_000).optional().default("") }).strict(),
  z.object({ action: z.literal("complete"), note: limitedText(2_000).optional().default("") }).strict(),
]);

export const commandResultSchema = z.object({
  status: z.enum(["applied", "pending_approval", "rejected", "failed"]),
  resultCode: limitedText(80).optional().default(""),
  message: limitedText(2_000).optional().default(""),
  coreReference: limitedText(160).optional().default(""),
  workItemVersion: z.number().int().positive().optional(),
}).strict();

export const riskByAction = Object.freeze({
  accept: "low",
  progress: "low",
  report_exception: "low",
  inbound_confirm: "medium",
  outbound_confirm: "medium",
  transfer_receive: "medium",
  inventory_adjustment: "high",
  stockup_process: "medium",
  complete: "medium",
});

export const sensitiveActions = new Set(["inventory_adjustment"]);

export function publicPayloadForProjection(input) {
  return safeWarehousePayloadSchema.parse(input);
}

import { z } from "zod";

const limitedText = (max) => z.string().trim().max(max);
const isoDateTime = z.string().datetime({ offset: true }).or(z.literal(""));
const quantity = z.number().finite().nonnegative();
const dateOnly = limitedText(10).regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal(""));
const httpsImageUrl = z.string().url().max(2_000).refine((value) => {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}, "图片地址必须使用 HTTPS。");

export const warehouseLineSchema = z.object({
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

const safeWarehousePayloadSchema = z.object({
  referenceNo: limitedText(120).optional().default(""),
  warehouseRef: limitedText(120).min(1),
  warehouseName: limitedText(200).min(1),
  sourceWarehouseName: limitedText(200).optional().default(""),
  destinationWarehouseName: limitedText(200).optional().default(""),
  note: limitedText(2_000).optional().default(""),
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
  referenceNo: limitedText(120).optional().default(""),
  title: limitedText(240).min(1),
  description: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  dueAt: isoDateTime.optional().default(""),
  lines: z.array(z.object({
    sku: limitedText(100).min(1),
    plannedQuantity: z.number().finite().positive(),
    unit: limitedText(20).optional().default(""),
  }).strict()).min(1).max(500),
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
  sampleCategory: z.enum(["inner_material", "packaging"]).optional(),
  sampleSubject: z.enum(["formula", "raw_material", "packaging_box", "packaging_bottle"]).optional(),
  sampleGoal: limitedText(2_000).optional().default(""),
  evaluationCriteria: limitedText(5_000).optional().default(""),
  quoteRequired: z.boolean().optional().default(true),
  packagingSpec: z.object({
    material: limitedText(500).optional().default(""),
    process: limitedText(1_000).optional().default(""),
    structureType: limitedText(300).optional().default(""),
    lengthMm: quantity.optional().default(0),
    widthMm: quantity.optional().default(0),
    heightMm: quantity.optional().default(0),
    diameterMm: quantity.optional().default(0),
    capacityMl: quantity.optional().default(0),
    colorPrinting: limitedText(1_000).optional().default(""),
    designVersion: limitedText(120).optional().default(""),
    fileRequirements: limitedText(2_000).optional().default(""),
  }).strict().optional(),
}).strict();

export const oemProjectionSchema = z.object({
  eventId: limitedText(160).min(1),
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  coreRefType: limitedText(80).min(1),
  coreRefId: limitedText(160).min(1),
  spaceType: z.enum(["filing", "sampling", "packaging_quote", "production"]),
  itemType: z.enum(["filing_task", "sampling_task", "packaging_quote", "production_order"]),
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
  const expected = { filing: "filing_task", sampling: "sampling_task", packaging_quote: "packaging_quote", production: "production_order" }[value.spaceType];
  if (value.itemType !== expected) context.addIssue({ code: z.ZodIssueCode.custom, path: ["itemType"], message: "OEM 空间类型与任务类型不匹配。" });
  if (value.spaceType === "sampling" && (!value.publicPayload.sampleCategory || !value.publicPayload.sampleSubject)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicPayload"], message: "打样任务必须明确打样大类与对象。" });
});

export const partnerOrderLineSchema = z.object({
  lineRef: limitedText(120).min(1),
  lineType: z.enum(["finished_product", "raw_material", "packaging"]),
  sku: limitedText(100).min(1),
  productName: limitedText(300).min(1),
  specification: limitedText(1_000).optional().default(""),
  imageUrl: httpsImageUrl.optional().or(z.literal("")),
  plannedQuantity: quantity,
  unit: limitedText(20).optional().default("件"),
  requiredDate: dateOnly.optional().default(""),
  responsibility: z.enum(["tongzhou", "factory", "supplier"]),
  unitPrice: quantity.optional(),
  currency: limitedText(3).regex(/^[A-Z]{3}$/).optional().default("CNY"),
}).strict();

const firstArticleBomItemSchema = z.object({
  category: limitedText(120).optional().default(""),
  name: limitedText(300).optional().default(""),
  materialCode: limitedText(120).optional().default(""),
  netContent: limitedText(120).optional().default(""),
  unit: limitedText(20).optional().default(""),
  composition: limitedText(120).optional().default(""),
}).strict();

const firstArticleImageSchema = z.object({
  category: z.enum(["packaging", "inner_pack", "coding", "finished", "carton"]),
  label: limitedText(80).min(1),
  name: limitedText(240).min(1),
  url: httpsImageUrl,
  mime: limitedText(100).optional().default("image/jpeg"),
  size: quantity.optional().default(0),
}).strict();

const firstArticleRecordSchema = z.object({
  matchedBy: z.enum(["barcode", "sku", "product_name"]),
  documentNo: limitedText(120).optional().default(""),
  version: limitedText(80).optional().default(""),
  productSku: limitedText(120).optional().default(""),
  productName: limitedText(300).optional().default(""),
  specification: limitedText(1_000).optional().default(""),
  brandName: limitedText(120).optional().default(""),
  unit: limitedText(20).optional().default(""),
  barcode: limitedText(120).optional().default(""),
  filingName: limitedText(300).optional().default(""),
  bpom: limitedText(300).optional().default(""),
  productionProcess: limitedText(2_000).optional().default(""),
  cartonSpecification: limitedText(1_000).optional().default(""),
  updatedAt: isoDateTime.optional().default(""),
  bom: z.array(firstArticleBomItemSchema).max(100).optional().default([]),
  images: z.array(firstArticleImageSchema).max(40).optional().default([]),
}).strict();

const partnerOrderPublicPayloadSchema = z.object({
  orderNo: limitedText(120).min(1),
  projectCode: limitedText(120).optional().default(""),
  productName: limitedText(300).optional().default(""),
  productSpec: limitedText(1_000).optional().default(""),
  barcode: limitedText(120).optional().default(""),
  fulfillmentMode: z.enum(["labor_only", "turnkey", "supplier"]),
  requirements: limitedText(5_000).optional().default(""),
  productionProcess: limitedText(2_000).optional().default(""),
  cartonType: limitedText(200).optional().default(""),
  piecesPerCarton: quantity.optional().default(0),
  factoryExpectedDeliveryDate: dateOnly.optional().default(""),
  quantity: quantity.optional().default(0),
  unit: limitedText(20).optional().default("件"),
  deliveryDate: dateOnly.optional().default(""),
  deliveryAddress: limitedText(500).optional().default(""),
  paymentTerms: limitedText(1_000).optional().default(""),
  currency: limitedText(3).regex(/^[A-Z]{3}$/).optional().default("CNY"),
  firstArticle: firstArticleRecordSchema.optional(),
}).strict();

export const partnerOrderProjectionSchema = z.object({
  eventId: limitedText(160).min(1),
  organizationCode: limitedText(64).regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  coreRefType: limitedText(80).min(1),
  coreRefId: limitedText(160).min(1),
  orderType: z.enum(["production", "purchase"]),
  itemType: z.enum(["production_order", "purchase_order"]),
  title: limitedText(240).min(1),
  description: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  status: z.enum(["pending", "accepted", "in_progress", "pending_approval", "pending_sync", "completed", "rejected", "cancelled"]).optional().default("pending"),
  dueAt: isoDateTime.optional().default(""),
  version: z.number().int().positive(),
  publicPayload: partnerOrderPublicPayloadSchema,
  lines: z.array(partnerOrderLineSchema).min(1).max(500),
  milestones: z.array(z.object({
    milestoneType: limitedText(80).min(1),
    title: limitedText(240).min(1),
    plannedAt: isoDateTime.optional().default(""),
    status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional().default("pending"),
    publicPayload: z.object({ note: limitedText(2_000).optional().default("") }).strict().optional().default({ note: "" }),
  }).strict()).max(100).optional().default([]),
}).strict().superRefine((value, context) => {
  const expectedType = value.orderType === "production" ? "production_order" : "purchase_order";
  if (value.itemType !== expectedType) context.addIssue({ code: z.ZodIssueCode.custom, path: ["itemType"], message: "订单类型与任务类型不匹配。" });
  if (value.orderType === "purchase" && value.publicPayload.fulfillmentMode !== "supplier") context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicPayload", "fulfillmentMode"], message: "采购单必须使用供应商履约模式。" });
  if (value.orderType === "production" && value.lines.some((line) => line.unitPrice !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["lines"], message: "生产加工单不得向工厂投影价格字段。" });
});

export const internalPartnerTaskSchema = z.object({
  taskType: z.enum(["production_order", "purchase_order", "sampling_task"]),
  documentNo: limitedText(120).optional().default(""),
  title: limitedText(240).min(1),
  productName: limitedText(300).min(1),
  productSpec: limitedText(1_000).optional().default(""),
  description: limitedText(5_000).optional().default(""),
  requirements: limitedText(5_000).optional().default(""),
  priority: z.enum(["normal", "urgent"]).optional().default("normal"),
  dueAt: isoDateTime.optional().default(""),
  quantity: quantity,
  unit: limitedText(20).optional().default("件"),
  fulfillmentMode: z.enum(["labor_only", "turnkey"]).optional().default("turnkey"),
  deliveryAddress: limitedText(500).optional().default(""),
  sampleCategory: z.enum(["inner_material", "packaging"]).optional(),
  sampleSubject: z.enum(["formula", "raw_material", "packaging_box", "packaging_bottle"]).optional(),
  sampleGoal: limitedText(2_000).optional().default(""),
  evaluationCriteria: limitedText(5_000).optional().default(""),
  quoteRequired: z.boolean().optional().default(true),
  packagingSpec: z.object({
    material: limitedText(500).optional().default(""),
    process: limitedText(1_000).optional().default(""),
    structureType: limitedText(300).optional().default(""),
    lengthMm: quantity.optional().default(0),
    widthMm: quantity.optional().default(0),
    heightMm: quantity.optional().default(0),
    diameterMm: quantity.optional().default(0),
    capacityMl: quantity.optional().default(0),
    colorPrinting: limitedText(1_000).optional().default(""),
    designVersion: limitedText(120).optional().default(""),
    fileRequirements: limitedText(2_000).optional().default(""),
  }).strict().optional(),
  lines: z.array(z.object({
    sku: limitedText(100).min(1),
    productName: limitedText(300).min(1),
    specification: limitedText(1_000).optional().default(""),
    imageUrl: httpsImageUrl.optional().or(z.literal("")),
    plannedQuantity: quantity,
    unit: limitedText(20).optional().default("件"),
    lineType: z.enum(["finished_product", "raw_material", "packaging"]).optional(),
  }).strict()).min(1).max(500),
}).strict().superRefine((value, context) => {
  if (value.taskType !== "sampling_task") {
    if (!value.documentNo) context.addIssue({ code: z.ZodIssueCode.custom, path: ["documentNo"], message: "请填写单据编号。" });
    return;
  }
  if (!value.sampleCategory) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleCategory"], message: "请选择内料打样或包材打样。" });
  if (!value.sampleSubject) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleSubject"], message: "请选择具体打样对象。" });
  if (value.sampleCategory === "inner_material" && !["formula", "raw_material"].includes(value.sampleSubject || "")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleSubject"], message: "内料打样对象必须是配方或原料。" });
  if (value.sampleCategory === "packaging" && !["packaging_box", "packaging_bottle"].includes(value.sampleSubject || "")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["sampleSubject"], message: "包材打样对象必须是包装盒或包装瓶。" });
});

const sampleVariantSchema = z.object({
  name: limitedText(160).min(1),
  sampleQuantity: quantity.optional().default(0),
  unit: limitedText(20).optional().default("件"),
  specificationVersion: limitedText(120).optional().default(""),
  description: limitedText(3_000).optional().default(""),
  material: limitedText(500).optional().default(""),
  process: limitedText(1_000).optional().default(""),
  structureType: limitedText(300).optional().default(""),
  lengthMm: quantity.optional().default(0),
  widthMm: quantity.optional().default(0),
  heightMm: quantity.optional().default(0),
  diameterMm: quantity.optional().default(0),
  capacityMl: quantity.optional().default(0),
  colorPrinting: limitedText(1_000).optional().default(""),
}).strict();

export const partnerOrderReportSchema = z.discriminatedUnion("reportType", [
  z.object({
    reportType: z.literal("production_progress"),
    stage: z.enum(["planning", "material_preparation", "filling", "packaging", "quality_check", "ready_to_ship"]),
    progressPercent: z.number().int().min(0).max(100),
    completedQuantity: quantity.optional().default(0),
    expectedCompletionDate: dateOnly.optional().default(""),
    note: limitedText(2_000).min(1),
  }).strict(),
  z.object({
    reportType: z.literal("material_readiness"),
    lineId: z.string().uuid(),
    readiness: z.enum(["not_arrived", "partial", "arrived"]),
    arrivedQuantity: quantity,
    testResult: z.enum(["pending", "passed", "failed", "not_required"]),
    testedAt: dateOnly.optional().default(""),
    exceptionDescription: limitedText(2_000).optional().default(""),
    note: limitedText(2_000).optional().default(""),
  }).strict().superRefine((value, context) => {
    if (value.testResult === "failed" && !value.exceptionDescription) context.addIssue({ code: z.ZodIssueCode.custom, path: ["exceptionDescription"], message: "测试不合格时必须填写异常说明。" });
  }),
  z.object({
    reportType: z.literal("purchase_fulfillment"),
    stage: z.enum(["confirmed", "preparing", "ready_to_ship", "shipped", "delivered"]),
    expectedDeliveryDate: dateOnly.optional().default(""),
    completedQuantity: quantity.optional().default(0),
    note: limitedText(2_000).min(1),
  }).strict(),
  z.object({
    reportType: z.literal("exception"),
    category: z.enum(["material_shortage", "material_quality", "packaging_test", "production_delay", "quality_issue", "delivery_delay", "other"]),
    severity: z.enum(["notice", "warning", "critical"]),
    title: limitedText(240).min(1),
    description: limitedText(5_000).min(1),
    affectedQuantity: quantity.optional().default(0),
    expectedResolutionDate: dateOnly.optional().default(""),
  }).strict(),
  z.object({
    reportType: z.literal("shipment"),
    shippedQuantity: z.number().finite().positive(),
    shippedAt: dateOnly,
    carrier: limitedText(200).optional().default(""),
    trackingNo: limitedText(200).optional().default(""),
    note: limitedText(2_000).optional().default(""),
  }).strict(),
]);

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
    roundNo: z.number().int().positive().optional(),
    sampleCategory: z.enum(["inner_material", "packaging"]).optional(),
    sampleSubject: z.enum(["formula", "raw_material", "packaging_box", "packaging_bottle"]).optional(),
    sampleQuantity: quantity.optional().default(0),
    unit: limitedText(20).optional().default("件"),
    specificationVersion: limitedText(120).optional().default(""),
    supplierConclusion: limitedText(2_000).optional().default(""),
    nextPlan: limitedText(2_000).optional().default(""),
    sampleVariants: z.array(sampleVariantSchema).min(1).max(20).optional(),
    attachmentIds: z.array(z.string().uuid()).max(30).optional().default([]),
  }).strict(),
}).strict();

export const sampleArtifactReviewSchema = z.object({
  approved: z.boolean(),
  approvedVariantCode: limitedText(120).optional().default(""),
  note: limitedText(2_000).optional().default(""),
  reviewer: limitedText(200).optional().default("供应链中台"),
}).strict().superRefine((value, context) => {
  if (!value.approved && !value.note) context.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "要求返样时必须填写修改意见。" });
});

export const milestoneUpdateSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "blocked"]),
  note: limitedText(2_000).optional().default(""),
}).strict();

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

export const workItemActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), note: limitedText(2_000).optional().default("") }).strict(),
  z.object({ action: z.literal("progress"), note: limitedText(2_000).min(1), percent: z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ action: z.literal("report_exception"), category: limitedText(80).min(1), note: limitedText(5_000).min(1) }).strict(),
  z.object({ action: z.enum(["inbound_confirm", "outbound_confirm", "transfer_receive"]), lines: z.array(actionLineSchema).min(1).max(2_000), note: limitedText(2_000).optional().default("") }).strict(),
  z.object({ action: z.literal("inventory_adjustment"), lines: z.array(adjustmentLineSchema).min(1).max(2_000), reason: limitedText(2_000).min(1) }).strict(),
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
  complete: "medium",
});

export const sensitiveActions = new Set(["inventory_adjustment"]);

export function publicPayloadForProjection(input) {
  return safeWarehousePayloadSchema.parse(input);
}

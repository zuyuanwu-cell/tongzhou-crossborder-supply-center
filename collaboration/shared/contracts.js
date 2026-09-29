import { z } from "zod";

const limitedText = (max) => z.string().trim().max(max);
const isoDateTime = z.string().datetime({ offset: true }).or(z.literal(""));
const quantity = z.number().finite().nonnegative();
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
});

export const supplierQuoteSchema = z.object({
  workItemId: z.string().uuid(),
  currency: limitedText(3).regex(/^[A-Z]{3}$/),
  amount: z.number().finite().nonnegative(),
  minimumOrderQuantity: quantity.optional().default(0),
  leadTimeDays: z.number().int().min(0).max(3650),
  terms: limitedText(5_000).optional().default(""),
}).strict();

export const oemArtifactSchema = z.object({
  workItemId: z.string().uuid(),
  artifactType: z.enum(["filing_document", "sample_result", "design_file", "quality_report"]),
  title: limitedText(240).min(1),
  version: z.number().int().positive(),
  publicPayload: z.object({
    summary: limitedText(5_000).optional().default(""),
    result: z.enum(["pending", "passed", "failed", "revision_required"]).optional().default("pending"),
  }).strict(),
}).strict();

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

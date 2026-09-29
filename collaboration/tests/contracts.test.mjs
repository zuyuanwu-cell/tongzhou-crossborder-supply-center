import test from "node:test";
import assert from "node:assert/strict";
import { collaborationProjectionSchema, internalWarehouseTaskSchema, inventoryProjectionSchema, oemProjectionSchema, riskByAction, supplierQuoteSchema, warehouseOperationSchema, workItemActionSchema } from "../shared/contracts.js";
import { canPerformAction, requiresMfaAtLogin } from "../api/permissions.js";

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
});

test("inventory images and partner-created warehouse operations stay on a strict allowlist", () => {
  const inventory = { eventId: "inventory-1", organizationCode: "warehouse-a", warehouseRef: "wh-1", warehouseName: "一号仓", version: 1, syncedAt: new Date().toISOString(), items: [{ sku: "SKU-1", productName: "产品一", imageUrl: "https://files.example.test/product.jpg", availableQuantity: 8 }] };
  assert.equal(inventoryProjectionSchema.safeParse(inventory).success, true);
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
});

test("organization jobs enforce role capabilities without an authenticator gate", () => {
  const operator = { role: "operator", status: "active", permissions: [] };
  const manager = { role: "manager", status: "active", permissions: [] };
  assert.equal(canPerformAction(operator, "transfer_receive"), true);
  assert.equal(canPerformAction(operator, "inventory_adjustment"), false);
  assert.equal(canPerformAction(manager, "inventory_adjustment"), true);
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

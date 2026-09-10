import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createWarehouseTicketService } from "../server/warehouse-tickets.js";
import { buildWarehouseTicketCreatedMarkdown, buildWarehouseTicketProgressMarkdown } from "../server/after-sales-notifications.js";

const tempDir = mkdtempSync(resolve(tmpdir(), "tongzhou-warehouse-ticket-"));
try {
  const service = createWarehouseTicketService({ cachePath: resolve(tempDir, "tickets.json"), uploadDir: resolve(tempDir, "uploads") });
  const operator = { id: "operator-1", displayName: "运营测试" };
  const upload = service.saveUpload({ fileName: "proof.png", dataUrl: "data:image/png;base64,iVBORw0KGgo=" }, operator, "http://localhost:8787");
  assert.equal(service.canAccessUpload(upload.id, {}, operator.id), true);
  assert.throws(() => service.create({ warehouseId: "wh-id", warehouseName: "印尼仓", category: "订单催促", title: "催发", description: "请核实", attachmentIds: [] }, operator), /订单号/);
  const created = service.create({
    warehouseId: "wh-id",
    warehouseName: "印尼仓",
    country: "印度尼西亚",
    category: "订单催促",
    priority: "urgent",
    relatedOrderNumber: "ORDER-1",
    title: "订单超过时效仍未出库",
    description: "请今天内核实并反馈预计出库时间。",
    attachmentIds: [upload.id],
  }, operator);
  assert.match(created.ticket.id, /^WT-\d{8}-0001$/);
  assert.equal(created.ticket.status, "pending_warehouse");
  assert.match(buildWarehouseTicketCreatedMarkdown(created.ticket), /仓库工单待处理/);
  const warehouse = { id: "warehouse-1", displayName: "仓库测试" };
  const accepted = service.updateWarehouse(created.ticket.id, { action: "accept", note: "已开始核查" }, warehouse);
  assert.equal(accepted.ticket.status, "processing");
  const replied = service.updateWarehouse(created.ticket.id, { action: "reply", note: "已定位订单，预计 16:00 前出库" }, warehouse);
  assert.equal(replied.ticket.status, "processing");
  assert.equal(replied.ticket.timeline.at(-1).label, "仓库回复工单");
  assert.match(buildWarehouseTicketProgressMarkdown(replied.ticket, { requestOrigin: "https://gyl.example.com" }), /module=tickets/);
  assert.throws(() => service.updateWarehouse(created.ticket.id, { action: "resolve" }, warehouse), /处理结果/);
  const resolved = service.updateWarehouse(created.ticket.id, { action: "resolve", note: "已安排今日出库" }, warehouse);
  assert.equal(resolved.ticket.status, "resolved");
  assert.match(buildWarehouseTicketProgressMarkdown(resolved.ticket, { statusLabel: "已解决" }), /已解决/);
  assert.equal(service.list({ dataScopes: { warehouseIds: ["wh-id"] } }).summary.total, 1);
  assert.equal(service.list({ dataScopes: { warehouseIds: ["wh-my"] } }).summary.total, 0);
  assert.equal(service.list({ createdById: operator.id }).summary.total, 1);
  assert.equal(service.list({ createdById: "other" }).summary.total, 0);
  service.recordNotification(created.ticket.id, { eventType: "created", target: "warehouse", status: "sent", robotCount: 1 });
  assert.equal(service.get(created.ticket.id).notifications.at(-1).status, "sent");
  console.log("warehouse ticket workflow tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

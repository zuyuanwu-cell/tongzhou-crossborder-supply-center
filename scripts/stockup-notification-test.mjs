import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-notify-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const operator = { auth: { user: { id: "op", displayName: "运营" } }, viewAll: false };
  const manager = { auth: { user: { id: "manager", displayName: "跟单" } }, viewAll: true };
  const request = service.createRequest({ project: "测试", destinationCountry: "俄罗斯", destinationWarehouseName: "俄罗斯1仓", expectedArrivalAt: "2026-10-10", reason: "补库存", submit: true, lines: [{ sku: "SKU-N", productName: "通知产品", method: "采购", requestedQty: 1 }] }, operator, "notification");
  service.setRequestStatus(request.requestId, "accepted", {}, manager);
  const notifications = service.listNotifications(operator);
  assert.equal(notifications.unread, 1);
  service.markNotificationRead(notifications.items[0].id, operator);
  assert.equal(service.listNotifications(operator).unread, 0);
  console.log("stockup notification tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { buildWmsPushTask, buildWmsWarehouseOptions, normalizeWmsPushStore, publicWmsPushTasks, recoverInterruptedWmsPushes, upsertWmsPushTask } from "../server/wms-stockup-push.js";

const options = buildWmsWarehouseOptions([
  { id: "sea-id", name: "神牛 | 印尼仓", country: "印度尼西亚", providerId: "sea_wms", providerName: "SEA WMS", warehouseCode: "YINNI", warehouseId: "56064" },
], [
  { id: "jdy-wh", warehouseName: "神牛印尼仓", countryRegion: "印度尼西亚", warehouseCode: "YINNI / 56064", firstMileReceivingAddress: "Jakarta test address" },
], () => ({ supported: true, configured: true, createMode: "草稿备货单", message: "确认后创建" }));
assert.equal(options.length, 1);
assert.equal(options[0].warehouseRecordId, "jdy-wh");
assert.equal(options[0].warehouseName, "神牛印尼仓");
assert.equal(options[0].createConfigured, true);

const task = buildWmsPushTask({
  shipmentRecordId: "shipment-1",
  shipmentNo: "FH-20260814-001",
  stockupOrderRecordId: "order-1",
  warehouseOption: options[0],
  carrier: "test carrier",
  trackingNo: "TRACK-1",
  createdBy: "tester",
  lines: [{ sku: "SKU-A", productName: "A", quantity: 10, purchasePrice: 5.2, purchasePriceCurrency: "CNY" }],
});
assert.equal(task.status, "pending_confirmation");
assert.equal(task.payloadSnapshot.lines[0].sku, "SKU-A");
assert.equal(task.externalReferenceNo, "FH-20260814-001");

const first = upsertWmsPushTask(normalizeWmsPushStore(null), task);
assert.equal(first.created, true);
const duplicate = upsertWmsPushTask(first.store, { ...task, id: "different-id" });
assert.equal(duplicate.created, false);
assert.equal(duplicate.store.tasks.length, 1);

const publicTask = publicWmsPushTasks(first.store, options)[0];
assert.equal(publicTask.canPush, true);
assert.equal(publicTask.lineCount, 1);
assert.equal("payloadSnapshot" in publicTask, false);

const recovered = recoverInterruptedWmsPushes({ tasks: [{ ...task, status: "pushing" }] });
assert.equal(recovered.tasks[0].status, "needs_manual_check");
assert.match(recovered.tasks[0].lastError, /核实/);

console.log("wms-stockup-push-test: ok");

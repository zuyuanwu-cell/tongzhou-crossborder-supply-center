import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";
import { assertReceiptQuantities } from "../server/stockup-status-machine.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-collaboration-"));
try {
  const store = await initStockupCollaborationStore(resolve(temp, "test.sqlite"));
  const service = createStockupCollaborationService(store);
  const context = {
    auth: { role: "admin", user: { id: "admin-test", displayName: "测试管理员" } },
    viewAll: true,
    viewCost: true,
    revealSupplier: true,
  };

  const input = {
    project: "直营一组",
    destinationCountry: "俄罗斯",
    destinationWarehouseId: "ru-1",
    destinationWarehouseName: "俄罗斯1仓",
    expectedArrivalAt: "2026-11-30",
    priority: "加急",
    reason: "补库存",
    submit: true,
    lines: [
      { productId: "p1", sku: "TZKJ-RU-0001", productName: "测试产品A", method: "采购", requestedQty: 100, unit: "件", targetUnitCostCny: 8.5 },
      { productId: "p2", sku: "TZKJ-RU-0002", productName: "测试产品B", method: "委外生产", requestedQty: 50, unit: "盒", targetUnitCostCny: 12 },
    ],
  };
  const created = service.createRequest(input, context, "idem-create-1");
  const duplicated = service.createRequest(input, context, "idem-create-1");
  assert.equal(created.requestId, duplicated.requestId, "相同幂等键不能重复建单");
  assert.equal(service.listRequests({}, context).total, 1);

  service.setRequestStatus(created.requestId, "accepted", {}, context);
  const accepted = service.getRequest(created.requestId, context);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.lines.length, 2);

  const skuScopedContext = { ...context, skus: ["TZKJ-RU-0001"] };
  const scopedList = service.listRequests({}, skuScopedContext);
  assert.equal(scopedList.total, 1, "SKU scope should retain requests containing an authorized SKU");
  assert.deepEqual(scopedList.items[0].lines.map((line) => line.sku), ["TZKJ-RU-0001"], "list responses must not expose sibling SKUs");
  assert.deepEqual(service.getRequest(created.requestId, skuScopedContext).lines.map((line) => line.sku), ["TZKJ-RU-0001"], "detail responses must not expose sibling SKUs");

  const taskResult = service.createTask({ requestId: created.requestId, lineId: accepted.lines[0].id, plannedQty: 60, supplierName: "测试供应商" }, context);
  assert.equal(taskResult.task.plannedQty, 60);
  const updatedTask = service.updateTask(taskResult.task.id, { version: taskResult.task.version, orderedQty: 60, completedQty: 40, status: "in_progress" }, context).task;
  assert.equal(updatedTask.completedQty, 40);
  assert.equal(service.getRequest(created.requestId, context).status, "in_progress");

  const siblingTask = service.createTask({ requestId: created.requestId, lineId: accepted.lines[1].id, plannedQty: 20, supplierName: "另一个供应商" }, context).task;
  assert.deepEqual(service.listTasks({}, skuScopedContext).tasks.map((task) => task.lineId), [accepted.lines[0].id], "task lists must honor SKU scope");
  assert.throws(
    () => service.updateTask(siblingTask.id, { version: siblingTask.version, status: "in_progress" }, skuScopedContext),
    (error) => error?.statusCode === 403,
    "a scoped user must not update a sibling SKU task",
  );

  const draft = service.createRequest({ ...input, submit: false, project: "直营二组" }, context, "idem-draft-1");
  const draftDetail = service.getRequest(draft.requestId, context);
  await assert.rejects(
    async () => service.updateRequest(draft.requestId, { version: draftDetail.version + 1, project: "冲突" }, context),
    /其他用户更新/,
  );

  assert.throws(() => assertReceiptQuantities({ expectedQty: 10, receivedQty: 9, goodQty: 8, damagedQty: 0, pendingQty: 0, shortageQty: 1 }), /实收数量必须等于/);
  assert.doesNotThrow(() => assertReceiptQuantities({ expectedQty: 10, receivedQty: 9, goodQty: 8, damagedQty: 1, pendingQty: 0, shortageQty: 1 }));

  console.log("stockup collaboration tests passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

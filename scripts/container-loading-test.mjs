import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLoadingCandidates, simulateContainerLoading } from "../server/container-loading-engine.js";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createContainerLoadingService } from "../server/container-loading-service.js";

const container = { code: "20GP", name: "20GP", lengthCm: 589, widthCm: 235, heightCm: 239, doorWidthCm: 234, doorHeightCm: 228, maxPayloadKg: 28200 };
const items = [{ id: "sku-1", sku: "SKU-1", productName: "测试商品", cartonCount: 100, unitsPerCarton: 24, cartonLengthCm: 60, cartonWidthCm: 40, cartonHeightCm: 40, cartonWeightKg: 10, orientation: "upright", priority: 5 }];

const candidates = generateLoadingCandidates({ container, items });
assert.equal(candidates.length, 3);
for (const candidate of candidates) {
  assert.ok(candidate.metrics.loadedCartons > 0);
  assert.ok(candidate.metrics.loadedCartons <= 100);
  assert.ok(candidate.placements.every((placement) => placement.x >= 0 && placement.y >= 0 && placement.z >= 0));
  assert.ok(candidate.placements.every((placement) => placement.x + placement.lengthCm <= container.lengthCm + 0.01));
  assert.ok(candidate.placements.every((placement) => placement.y + placement.widthCm <= container.widthCm + 0.01));
  assert.ok(candidate.placements.every((placement) => placement.z + placement.heightCm <= container.heightCm + 0.01));
}

const doorBlocked = simulateContainerLoading({
  container,
  items: [{ ...items[0], cartonCount: 1, cartonWidthCm: 230, cartonHeightCm: 230, orientation: "fixed" }],
});
assert.equal(doorBlocked.metrics.loadedCartons, 0);
assert.ok(doorBlocked.warnings.some((warning) => warning.includes("柜门")));

const overweight = simulateContainerLoading({
  container,
  items: [{ ...items[0], cartonCount: 100, cartonWeightKg: 1000 }],
});
assert.ok(overweight.metrics.loadedCartons <= 28);
assert.ok(overweight.metrics.loadedWeightKg <= container.maxPayloadKg);

const directory = await mkdtemp(join(tmpdir(), "tongzhou-container-loading-"));
try {
  const store = await initStockupCollaborationStore(join(directory, "stockup.sqlite"));
  const shipment = {
    id: "shipment-1",
    shipmentNo: "FY-TEST-001",
    destinationWarehouseId: "warehouse-1",
    destinationWarehouseName: "俄罗斯2仓",
    destinationCountry: "俄罗斯",
    status: "in_transit",
    version: 3,
    packages: 101,
    totalWeightKg: 1003,
    totalVolumeM3: 9.6175,
    lines: items.map((item) => ({
      ...item,
      shippedQty: item.cartonCount * item.unitsPerCarton + 5,
      packagingGroups: [
        { kind: "standard", cartonCount: item.cartonCount, unitsPerCarton: item.unitsPerCarton, cartonLengthCm: item.cartonLengthCm, cartonWidthCm: item.cartonWidthCm, cartonHeightCm: item.cartonHeightCm, cartonWeightKg: item.cartonWeightKg },
        { kind: "remainder", cartonCount: 1, unitsPerCarton: 5, cartonLengthCm: 35, cartonWidthCm: 25, cartonHeightCm: 20, cartonWeightKg: 3 },
      ],
    })),
  };
  const stockupService = {
    listShipments: () => ({ ok: true, shipments: [shipment] }),
    getShipment: (shipmentId) => {
      if (shipmentId !== shipment.id) throw Object.assign(new Error("not found"), { statusCode: 404 });
      return shipment;
    },
  };
  const service = createContainerLoadingService({ store, stockupService });
  const context = { viewAll: true, auth: { role: "admin", user: { id: "admin-1", displayName: "管理员" } }, warehouseIds: [], countries: [], skus: [] };
  const bootstrap = service.bootstrap(context);
  assert.equal(bootstrap.shipments.length, 1);
  assert.equal(bootstrap.shipments[0].lines.length, 2);
  assert.equal(bootstrap.shipments[0].lines[1].productName, "测试商品（尾数箱）");
  assert.equal(bootstrap.shipments[0].lines[1].unitsPerCarton, 5);
  assert.equal(bootstrap.containerTypes.length, 4);

  const preview = await service.calculatePreview({ sourceShipmentId: shipment.id, containerType: "20GP", selectedStrategy: "balanced" }, context);
  assert.equal(preview.preview, true);
  assert.equal(preview.sourceShipmentNo, shipment.shipmentNo);
  assert.equal(preview.candidates.length, 3);
  assert.equal(preview.selectedStrategy, "balanced");
  assert.equal(service.listPlans({}, context).plans.length, 0, "临时测算不得创建正式装柜方案");

  const created = await service.createPlan({ sourceShipmentId: shipment.id, containerType: "20GP", selectedStrategy: "balanced" }, context);
  assert.equal(created.plan.sourceShipmentNo, shipment.shipmentNo);
  assert.equal(created.plan.candidates.length, 3);
  assert.equal(created.plan.status, "draft");
  const bootstrapAfterCreate = service.bootstrap(context);
  assert.equal(bootstrapAfterCreate.plans.length, 1);
  assert.ok(bootstrapAfterCreate.plans[0].summary.metrics.loadedCartons > 0);
  const skuRestricted = service.listPlans({}, { ...context, skus: ["OTHER-SKU"] });
  assert.equal(skuRestricted.plans.length, 0, "SKU-scoped users must not see plans containing other SKUs");
  const workerCreated = await service.createPlan({
    containerType: "20GP",
    items: [{ ...items[0], id: "worker-sku", cartonCount: 300 }],
  }, context);
  assert.equal(workerCreated.plan.candidates.length, 3, "large plans should be calculated in a worker thread");

  const selected = created.plan.candidates.find((candidate) => candidate.strategy === "balanced");
  const saved = service.saveVersion(created.plan.id, { expectedVersion: created.plan.version, strategy: "balanced", placements: selected.placements }, context);
  assert.equal(saved.plan.version, 2);
  assert.equal(saved.versions[0].versionType, "manual_adjustment");

  const confirmed = service.confirmPlan(created.plan.id, { expectedVersion: saved.plan.version, strategy: "balanced" }, context);
  assert.equal(confirmed.plan.status, "confirmed");
  assert.equal(confirmed.plan.confirmedVersion, 3);
  await assert.rejects(() => service.recalculate(created.plan.id, { expectedVersion: confirmed.plan.version }, context), /不能重新计算/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("container loading engine and service tests passed");

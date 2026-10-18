import assert from "node:assert/strict";
import { allocatePurchaseOrder, temporarySku, validateInspectionLine } from "../server/stockup-v2-domain.js";

const allocation = allocatePurchaseOrder({
  paidTotal: 115,
  lines: [
    { id: "a", quantity: 10, merchandiseAmount: 60 },
    { id: "b", quantity: 5, merchandiseAmount: 40 },
  ],
});
assert.equal(allocation.sharedAmount, 15);
assert.equal(allocation.lines.reduce((sum, line) => sum + Math.round(line.allocatedAmount * 100), 0), 11_500);
assert.equal(allocation.lines[0].estimatedUnitCost, 6.9);
assert.equal(allocation.lines[1].estimatedUnitCost, 9.2);

const discount = allocatePurchaseOrder({ paidTotal: 90, lines: [{ id: "a", quantity: 3, merchandiseAmount: 60 }, { id: "b", quantity: 3, merchandiseAmount: 40 }] });
assert.equal(discount.sharedAmount, -10);
assert.equal(discount.lines.reduce((sum, line) => sum + Math.round(line.allocatedAmount * 100), 0), 9_000);

assert.throws(() => allocatePurchaseOrder({ paidTotal: 100, lines: [{ id: "a", quantity: 1, merchandiseAmount: 100 }], overrides: { a: 1 } }), (error) => error?.code === "allocation_not_balanced");

assert.doesNotThrow(() => validateInspectionLine({
  expectedQty: 21, receivedQty: 20, goodQty: 18, damagedQty: 2, shortageQty: 1, pendingQty: 0, requiresRepack: true,
  evidence: [{ kind: "damage", attachmentId: "att-1" }, { kind: "shortage", attachmentId: "att-2" }, { kind: "repack_before", attachmentId: "att-3" }, { kind: "repack_after", attachmentId: "att-4" }],
  lots: [{ quantity: 18, lotNo: "LOT-1", barcode: "690001", productionDate: "2026-10-01", cartonCount: 1, unitsPerCarton: 18, looseQuantity: 0, cartonLengthCm: 40, cartonWidthCm: 30, cartonHeightCm: 20, cartonWeightKg: 5 }],
}));
assert.throws(() => validateInspectionLine({ expectedQty: 10, receivedQty: 10, goodQty: 10, lots: [] }), (error) => error?.code === "inspection_lot_required");
assert.equal(temporarySku(new Date("2026-10-18T00:00:00Z"), 7), "TMP-20261018-0007");

console.log("stockup v2 domain tests passed");


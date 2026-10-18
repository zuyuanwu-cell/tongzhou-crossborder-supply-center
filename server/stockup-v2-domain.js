export const STOCKUP_V2_STATUSES = Object.freeze([
  "draft",
  "submitted",
  "purchasing",
  "warehouse_inspection",
  "inspection_review",
  "inventory_ready",
  "inventory_reserved",
  "wms_created",
  "instruction_issued",
  "handed_over",
  "overseas_received",
  "cost_locked",
  "cancelled",
]);

const V2_TRANSITIONS = Object.freeze({
  draft: new Set(["submitted", "cancelled"]),
  submitted: new Set(["purchasing", "draft", "cancelled"]),
  purchasing: new Set(["warehouse_inspection", "cancelled"]),
  warehouse_inspection: new Set(["inspection_review", "cancelled"]),
  inspection_review: new Set(["warehouse_inspection", "inventory_ready", "cancelled"]),
  inventory_ready: new Set(["inventory_reserved", "cancelled"]),
  inventory_reserved: new Set(["wms_created", "inventory_ready", "cancelled"]),
  wms_created: new Set(["instruction_issued", "inventory_ready", "cancelled"]),
  instruction_issued: new Set(["handed_over", "inventory_ready", "cancelled"]),
  handed_over: new Set(["overseas_received"]),
  overseas_received: new Set(["cost_locked"]),
  cost_locked: new Set(),
  cancelled: new Set(),
});

function fail(message, code = "stockup_v2_validation", statusCode = 400) {
  throw Object.assign(new Error(message), { code, statusCode });
}

function numeric(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function cents(value) {
  return Math.round((numeric(value) + Number.EPSILON) * 100);
}

export function moneyFromCents(value) {
  return Math.round(numeric(value)) / 100;
}

export function assertStockupV2Transition(from, to) {
  if (!V2_TRANSITIONS[from]?.has(to)) fail(`现货备货状态不能从“${from}”变更为“${to}”。`, "invalid_v2_transition", 409);
}

export function allocateAmountByBasis(totalAmount, rows, overrides = null) {
  const targetCents = cents(totalAmount);
  if (!Array.isArray(rows) || !rows.length) fail("分摊至少需要一条明细。", "allocation_lines_required");
  const normalized = rows.map((row, index) => ({
    id: String(row.id || index),
    basis: Math.max(0, numeric(row.basis)),
  }));
  if (overrides) {
    const allocations = normalized.map((row) => ({ id: row.id, amount: moneyFromCents(cents(overrides[row.id])) }));
    if (allocations.reduce((sum, row) => sum + cents(row.amount), 0) !== targetCents) fail("人工分摊金额合计必须等于待分摊总额。", "allocation_not_balanced");
    return allocations;
  }
  const basisTotal = normalized.reduce((sum, row) => sum + row.basis, 0);
  const weighted = normalized.map((row, index) => ({
    ...row,
    index,
    exact: basisTotal > 0 ? targetCents * row.basis / basisTotal : targetCents / normalized.length,
  }));
  const allocated = weighted.map((row) => ({ ...row, value: Math.trunc(row.exact) }));
  let remainder = targetCents - allocated.reduce((sum, row) => sum + row.value, 0);
  const order = [...allocated].sort((left, right) => {
    const fractionDiff = (right.exact - Math.trunc(right.exact)) - (left.exact - Math.trunc(left.exact));
    if (fractionDiff) return remainder >= 0 ? fractionDiff : -fractionDiff;
    const basisDiff = right.basis - left.basis;
    return basisDiff || left.index - right.index;
  });
  for (let cursor = 0; remainder !== 0; cursor += 1) {
    order[cursor % order.length].value += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
  }
  return allocated.sort((left, right) => left.index - right.index).map((row) => ({ id: row.id, amount: moneyFromCents(row.value) }));
}

export function allocatePurchaseOrder({ paidTotal, lines, overrides = null }) {
  if (!Array.isArray(lines) || !lines.length) fail("采购单至少需要一条商品明细。", "purchase_lines_required");
  const normalized = lines.map((line, index) => {
    const quantity = numeric(line.quantity);
    const merchandiseAmount = numeric(line.merchandiseAmount);
    if (quantity <= 0) fail(`第 ${index + 1} 行采购数量必须大于 0。`, "invalid_purchase_quantity");
    if (merchandiseAmount < 0) fail(`第 ${index + 1} 行商品金额不能小于 0。`, "invalid_merchandise_amount");
    return { ...line, id: String(line.id || index), quantity, merchandiseAmount };
  });
  const merchandiseTotal = moneyFromCents(normalized.reduce((sum, line) => sum + cents(line.merchandiseAmount), 0));
  const sharedAmount = moneyFromCents(cents(paidTotal) - cents(merchandiseTotal));
  const sharedAllocations = allocateAmountByBasis(sharedAmount, normalized.map((line) => ({ id: line.id, basis: line.merchandiseAmount })), overrides);
  const sharedById = new Map(sharedAllocations.map((item) => [item.id, item.amount]));
  const allocatedLines = normalized.map((line) => {
    const sharedAllocation = numeric(sharedById.get(line.id));
    const allocatedAmount = moneyFromCents(cents(line.merchandiseAmount) + cents(sharedAllocation));
    return { ...line, sharedAllocation, allocatedAmount, estimatedUnitCost: moneyFromCents(cents(allocatedAmount) / line.quantity) };
  });
  if (allocatedLines.reduce((sum, line) => sum + cents(line.allocatedAmount), 0) !== cents(paidTotal)) fail("采购金额分摊结果不守恒。", "purchase_allocation_not_balanced");
  return { paidTotal: moneyFromCents(cents(paidTotal)), merchandiseTotal, sharedAmount, lines: allocatedLines };
}

export function validateInspectionLine(input) {
  const expectedQty = numeric(input.expectedQty);
  const receivedQty = numeric(input.receivedQty);
  const goodQty = numeric(input.goodQty);
  const damagedQty = numeric(input.damagedQty);
  const shortageQty = numeric(input.shortageQty);
  const pendingQty = numeric(input.pendingQty);
  if ([expectedQty, receivedQty, goodQty, damagedQty, shortageQty, pendingQty].some((value) => value < 0)) fail("验收数量不能为负数。", "invalid_inspection_quantity");
  if (cents(receivedQty) !== cents(goodQty + damagedQty + pendingQty)) fail("实收数量必须等于良品、破损与待处理数量之和。", "inspection_received_mismatch");
  if (cents(expectedQty) !== cents(receivedQty + shortageQty)) fail("预计数量必须等于实收与短少数量之和。", "inspection_expected_mismatch");
  const lots = Array.isArray(input.lots) ? input.lots : [];
  if (goodQty > 0 && !lots.length) fail("良品必须至少拆分到一个批次。", "inspection_lot_required");
  const lotQty = lots.reduce((sum, lot) => sum + numeric(lot.quantity), 0);
  if (cents(lotQty) !== cents(goodQty)) fail("批次数量合计必须等于良品数量。", "inspection_lot_quantity_mismatch");
  for (const [index, lot] of lots.entries()) {
    const quantity = numeric(lot.quantity);
    const cartonCount = numeric(lot.cartonCount);
    const unitsPerCarton = numeric(lot.unitsPerCarton);
    const looseQuantity = numeric(lot.looseQuantity);
    if (quantity <= 0) fail(`第 ${index + 1} 个批次数量必须大于 0。`, "invalid_inspection_lot_quantity");
    if (!String(lot.lotNo || "").trim() || !String(lot.barcode || "").trim() || !String(lot.productionDate || "").trim()) fail(`第 ${index + 1} 个批次必须填写批次号、条码和生产日期。`, "inspection_traceability_required");
    if (lot.shelfLifeManaged && !String(lot.expiryDate || "").trim()) fail(`第 ${index + 1} 个批次必须填写有效期。`, "inspection_expiry_required");
    if (cartonCount > 0 || unitsPerCarton > 0) {
      if (![cartonCount, unitsPerCarton, numeric(lot.cartonLengthCm), numeric(lot.cartonWidthCm), numeric(lot.cartonHeightCm), numeric(lot.cartonWeightKg)].every((value) => value > 0)) fail(`第 ${index + 1} 个批次请补齐箱数、箱规、尺寸和单箱重量。`, "inspection_carton_required");
      if (cents(cartonCount * unitsPerCarton + looseQuantity) !== cents(quantity)) fail(`第 ${index + 1} 个批次的箱装数量、散件数与批次数量不一致。`, "inspection_carton_quantity_mismatch");
    }
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if ((damagedQty > 0 || shortageQty > 0 || pendingQty > 0 || input.requiresRepack) && evidence.length === 0) fail("破损、短少、待处理或换箱必须上传验收凭证。", "inspection_evidence_required");
  const evidenceKinds = new Set(evidence.map((item) => String(item.kind || "")));
  if (damagedQty > 0 && !evidenceKinds.has("damage")) fail("破损数量大于 0 时必须上传破损凭证。", "inspection_damage_evidence_required");
  if (shortageQty > 0 && !evidenceKinds.has("shortage")) fail("短少数量大于 0 时必须上传短少凭证。", "inspection_shortage_evidence_required");
  if (pendingQty > 0 && !evidenceKinds.has("pending")) fail("待处理数量大于 0 时必须上传待处理凭证。", "inspection_pending_evidence_required");
  if (input.requiresRepack) {
    if (!evidenceKinds.has("repack_before") || !evidenceKinds.has("repack_after")) fail("换箱必须同时上传处理前和处理后凭证。", "repack_evidence_required");
  }
  return { expectedQty, receivedQty, goodQty, damagedQty, shortageQty, pendingQty, lots, evidence };
}

export function temporarySku(date = new Date(), sequence = 1) {
  const value = date instanceof Date ? date : new Date(date);
  const stamp = `${value.getFullYear()}${String(value.getMonth() + 1).padStart(2, "0")}${String(value.getDate()).padStart(2, "0")}`;
  return `TMP-${stamp}-${String(sequence).padStart(4, "0")}`;
}


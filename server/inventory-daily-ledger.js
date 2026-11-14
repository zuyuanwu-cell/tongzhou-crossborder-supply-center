import { addBusinessDays, eventDateInTimezone } from "./date-time.js";

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function sku(value) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function identity(source = {}) {
  const warehouseId = text(source.warehouseId || source.destinationWarehouseId || source.warehouseName);
  const skuValue = sku(source.sku || source.countrySku);
  return {
    key: `${warehouseId}::${skuValue}`,
    warehouseId,
    warehouseName: text(source.warehouseName || source.destinationWarehouseName || warehouseId),
    sku: skuValue,
    productName: text(source.productName || source.name || skuValue),
  };
}

function onHand(row) {
  return round(number(row?.availableQty) + number(row?.lockedQty));
}

function exactSnapshot(snapshots, date, timezone) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => text(snapshot?.date) === date && (!snapshot?.timezone || !timezone || snapshot.timezone === timezone))
    .sort((left, right) => text(right.capturedAt).localeCompare(text(left.capturedAt)))[0] || null;
}

function endOfDaySnapshot(snapshot, bizDate, timezone) {
  if (!snapshot?.capturedAt) return false;
  const capturedAt = new Date(snapshot.capturedAt);
  if (Number.isNaN(capturedAt.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(capturedAt);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  const minutes = number(part("hour")) * 60 + number(part("minute"));
  return (localDate === bizDate && minutes >= 23 * 60 + 45)
    || (localDate === addBusinessDays(bizDate, 1) && minutes <= 15);
}

function addMetric(rows, source, field, value) {
  const rowIdentity = identity(source);
  if (!rowIdentity.warehouseId || !rowIdentity.sku) return;
  const current = rows.get(rowIdentity.key) || {
    ...rowIdentity,
    openingQty: 0,
    inboundQty: 0,
    returnRestockQty: 0,
    transferInQty: 0,
    transferOutQty: 0,
    orderOutboundQty: 0,
    otherOutboundQty: 0,
    adjustQty: 0,
    closingQty: 0,
    faultyQty: 0,
    temporaryQty: 0,
    inTransitQty: 0,
  };
  current[field] = round(number(current[field]) + number(value));
  rows.set(rowIdentity.key, current);
}

export function inventoryMovementsFromDailyLedger(rows = []) {
  const movements = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const common = {
      warehouseId: text(row?.warehouseId),
      warehouseName: text(row?.warehouseName),
      sku: sku(row?.sku),
      productName: text(row?.productName),
      occurredAt: text(row?.bizDate),
      createdAt: text(row?.updatedAt || row?.bizDate),
      source: "inventory_daily_ledger",
    };
    if (!common.warehouseId || !common.sku || !common.occurredAt) continue;
    if (number(row?.transferInQty)) movements.push({ ...common, type: "transfer_in", quantity: Math.abs(number(row.transferInQty)) });
    if (number(row?.transferOutQty)) movements.push({ ...common, type: "transfer_out", quantity: Math.abs(number(row.transferOutQty)) });
    if (number(row?.adjustQty)) movements.push({ ...common, type: "adjustment", quantity: Math.abs(number(row.adjustQty)), signedQty: number(row.adjustQty) });
  }
  return movements;
}

export function buildInventoryDailyLedger({
  bizDate,
  timezone = "Asia/Shanghai",
  snapshots = [],
  outboundOrders = [],
  inboundReceipts = [],
  inventoryMovements = [],
  returnFacts = [],
  valuations = [],
  ordersComplete = true,
  movementsComplete = true,
} = {}) {
  const openingDate = addBusinessDays(bizDate, -1);
  const openingSnapshot = exactSnapshot(snapshots, openingDate, timezone);
  const closingSnapshot = exactSnapshot(snapshots, bizDate, timezone);
  const rows = new Map();

  for (const row of openingSnapshot?.rows || []) addMetric(rows, row, "openingQty", onHand(row));
  for (const row of closingSnapshot?.rows || []) {
    addMetric(rows, row, "closingQty", onHand(row));
    addMetric(rows, row, "faultyQty", row.faultyQty);
    addMetric(rows, row, "temporaryQty", row.temporaryQty);
    addMetric(rows, row, "inTransitQty", row.inTransitQty);
  }
  for (const order of outboundOrders || []) {
    if (eventDateInTimezone(order.shippedAt || order.createdAt, timezone) !== bizDate) continue;
    const type = text(order.outboundType || order.type).toLowerCase();
    addMetric(rows, order, ["other", "b2b", "fbo", "reship", "replacement"].includes(type) ? "otherOutboundQty" : "orderOutboundQty", number(order.quantity || order.shippedQty));
  }
  for (const receipt of inboundReceipts || []) {
    if (eventDateInTimezone(receipt.arrivedAt || receipt.receivedAt || receipt.createdAt, timezone) !== bizDate) continue;
    addMetric(rows, receipt, "inboundQty", Math.max(number(receipt.shelvedQty), number(receipt.goodQty), number(receipt.receivedQty)));
  }
  for (const movement of inventoryMovements || []) {
    if (eventDateInTimezone(movement.occurredAt || movement.createdAt, timezone) !== bizDate) continue;
    const type = text(movement.type).toLowerCase();
    if (type === "transfer_in") addMetric(rows, movement, "transferInQty", movement.quantity);
    else if (type === "transfer_out") addMetric(rows, movement, "transferOutQty", movement.quantity);
    else if (["adjustment", "damage", "stocktake"].includes(type)) addMetric(rows, movement, "adjustQty", movement.signedQty ?? movement.quantity);
  }
  for (const fact of returnFacts || []) {
    if (text(fact.dispositionDate) !== bizDate) continue;
    addMetric(rows, fact, "returnRestockQty", fact.restockedQty);
  }

  const valuationByKey = new Map((Array.isArray(valuations) ? valuations : []).map((row) => [identity(row).key, row]));
  const commonFlags = [
    ...(!openingSnapshot ? ["opening_snapshot_missing"] : []),
    ...(openingSnapshot && !endOfDaySnapshot(openingSnapshot, openingDate, timezone) ? ["opening_snapshot_off_schedule"] : []),
    ...(!closingSnapshot ? ["closing_snapshot_missing"] : []),
    ...(closingSnapshot && !endOfDaySnapshot(closingSnapshot, bizDate, timezone) ? ["closing_snapshot_off_schedule"] : []),
    ...(!ordersComplete ? ["orders_incomplete"] : []),
    ...(!movementsComplete ? ["movements_incomplete"] : []),
  ];
  const ledgerRows = [...rows.values()].map((row) => {
    const valuation = valuationByKey.get(row.key) || null;
    const expectedClosingQty = round(
      row.openingQty + row.inboundQty + row.returnRestockQty + row.transferInQty
      - row.transferOutQty - row.orderOutboundQty - row.otherOutboundQty + row.adjustQty,
    );
    const varianceQty = round(row.closingQty - expectedClosingQty);
    const unitCostCny = valuation?.unitCostCny === null || valuation?.unitCostCny === undefined ? null : number(valuation.unitCostCny);
    return {
      bizDate,
      timezone,
      ...row,
      expectedClosingQty,
      varianceQty,
      unitCostCny,
      inventoryValueCny: unitCostCny === null ? 0 : round(row.closingQty * unitCostCny, 2),
      costBasis: text(valuation?.costBasis || (unitCostCny === null ? "missing" : "unknown")),
      costEffectiveDate: text(valuation?.costEffectiveDate),
      rateEffectiveDate: text(valuation?.rateEffectiveDate),
      dataFlags: [...commonFlags, ...(unitCostCny === null && row.closingQty > 0 ? ["cost_missing"] : [])],
    };
  });
  return {
    bizDate,
    timezone,
    openingDate,
    openingSnapshot: openingSnapshot ? { date: openingSnapshot.date, capturedAt: openingSnapshot.capturedAt || "" } : null,
    closingSnapshot: closingSnapshot ? { date: closingSnapshot.date, capturedAt: closingSnapshot.capturedAt || "" } : null,
    status: commonFlags.length ? "partial" : "ready",
    dataFlags: commonFlags,
    rows: ledgerRows.sort((left, right) => left.warehouseId.localeCompare(right.warehouseId) || left.sku.localeCompare(right.sku)),
  };
}

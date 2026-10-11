import { resolveMovementComparisonRanges } from "./movement-comparison.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function skuKey(value) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function identifier(value) {
  return text(value).replace(/[\s\u200B-\u200D\uFEFF]+/g, "").toUpperCase();
}

function dateKey(value, timezone = "Asia/Shanghai") {
  const source = text(value);
  const literal = source.match(/^(\d{4}-\d{2}-\d{2})/);
  if (literal && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(source)) return literal[1];
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return literal?.[1] || "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const part = (type) => parts.find((item) => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

function inRange(value, range, timezone) {
  const key = dateKey(value, timezone);
  return Boolean(key && key >= range.from && key <= range.to);
}

function previousDay(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return new Date(parsed.getTime() - DAY_MS).toISOString().slice(0, 10);
}

export function resolveOverseasReconciliationRanges(input = {}) {
  return resolveMovementComparisonRanges(input);
}

function latestSnapshotAtOrBefore(snapshots, date, timezone) {
  return (snapshots || [])
    .filter((item) => (!timezone || !item.timezone || item.timezone === timezone) && text(item.date) <= date)
    .sort((left, right) => text(right.date).localeCompare(text(left.date)) || text(right.capturedAt).localeCompare(text(left.capturedAt)))[0] || null;
}

function snapshotKey(row) {
  return `${text(row?.warehouseId || row?.warehouseName)}::${skuKey(row?.sku || row?.countrySku)}`;
}

function onHandQty(row) {
  if (!row) return 0;
  return round(number(row.availableQty) + number(row.lockedQty));
}

function orderIdentifiers(order) {
  return [
    order?.platformOrderSn,
    order?.platformOrderNumber,
    order?.platformOrderNo,
    order?.originalOrderNumber,
    order?.orderNo,
    order?.orderNumber,
    order?.referenceNo,
    order?.refrenceNo,
    order?.id,
  ].map(identifier).filter(Boolean);
}

function orderShopName(order) {
  return text(order?.shopAlias || order?.shopName || order?.shopNick || order?.storeName || order?.platformName) || "未识别店铺";
}

function ticketRequiresPhysicalReturn(ticket) {
  const reason = `${text(ticket?.primaryReason)} ${text(ticket?.secondaryReason)}`;
  return /退货|退回|寄回|return/i.test(reason) && !/不退货|无需退回|无需寄回/i.test(reason);
}

function ticketItemMatches(ticket, sku) {
  const items = Array.isArray(ticket?.originalItems) ? ticket.originalItems : [];
  if (!items.length || !sku) return true;
  return items.some((item) => skuKey(item.sku || item.skuNo) === sku);
}

function ticketQuantity(ticket) {
  return round((ticket?.originalItems || []).reduce((sum, item) => sum + number(item.quantity), 0));
}

function buildReturnFacts({ wmsReturnOrders, afterSalesTickets, outboundOrders, claimMap, timezone }) {
  const ticketByOrder = new Map();
  for (const ticket of afterSalesTickets || []) {
    if (!ticketRequiresPhysicalReturn(ticket)) continue;
    const key = identifier(ticket.originalOrderNumber || ticket.orderNumber);
    if (!key) continue;
    if (!ticketByOrder.has(key)) ticketByOrder.set(key, []);
    ticketByOrder.get(key).push(ticket);
  }

  const orderByIdentifier = new Map();
  for (const order of outboundOrders || []) {
    for (const key of orderIdentifiers(order)) {
      if (!orderByIdentifier.has(key)) orderByIdentifier.set(key, order);
    }
  }

  const matchedTicketIds = new Set();
  const facts = [];
  for (const order of wmsReturnOrders || []) {
    const orderKey = identifier(order.originalOrderNumber);
    const orderRecord = orderByIdentifier.get(orderKey);
    const candidates = ticketByOrder.get(orderKey) || [];
    const items = Array.isArray(order.items) && order.items.length ? order.items : [{ id: "unknown", sku: "", productName: "", expectedQty: 0 }];
    for (const item of items) {
      const sku = skuKey(item.sku || item.skuNo || item.id);
      const warehouseId = text(order.warehouseId);
      const warehouseCandidates = candidates.filter((ticket) => !ticket.warehouseId || !warehouseId || text(ticket.warehouseId) === warehouseId);
      const matchedTicket = warehouseCandidates.find((ticket) => ticketItemMatches(ticket, sku)) || null;
      const hasOrderConflict = warehouseCandidates.length > 0 && !matchedTicket;
      if (matchedTicket) matchedTicketIds.add(text(matchedTicket.id));
      const factId = `${text(order.id || order.returnOrderNumber)}::${sku || text(item.id) || "unknown"}`;
      const claimed = claimMap?.[factId] || null;
      const expectedQty = round(item.expectedQty);
      const receivedQty = round(item.receivedQty);
      const restockedQty = round(item.restockedQty);
      const scrappedQty = round(item.scrappedQty);
      const pendingQty = round(Math.max(number(item.pendingQty), receivedQty - restockedQty - scrappedQty));
      const returnQty = round(Math.max(expectedQty, receivedQty, restockedQty + scrappedQty + pendingQty));
      const activityAt = text(order.createdAt || order.submittedAt || order.signedAt || order.updatedAt || order.completedAt);
      const dispositionAt = text(order.completedAt || order.updatedAt || order.signedAt || activityAt);
      facts.push({
        id: factId,
        source: "wms",
        providerId: text(order.providerId),
        providerName: text(order.providerName),
        warehouseId,
        warehouseName: text(order.warehouseName) || "未识别海外仓",
        country: text(order.country),
        returnOrderNumber: text(order.returnOrderNumber),
        originalOrderNumber: text(order.originalOrderNumber),
        trackingNumber: text(order.trackingNumber),
        sku,
        productName: text(item.productName) || sku || "未识别产品",
        shopName: text(matchedTicket?.shopAlias || matchedTicket?.shopName) || orderShopName(orderRecord),
        status: text(order.status) || "processing",
        statusLabel: text(order.statusLabel) || "处理中",
        returnQty,
        expectedQty,
        receivedQty,
        restockedQty,
        scrappedQty,
        pendingQty,
        badQty: round(item.badQty),
        handlingMethod: text(item.handlingMethod),
        activityAt,
        activityDate: dateKey(activityAt, timezone),
        dispositionAt,
        dispositionDate: dateKey(dispositionAt, timezone),
        afterSalesTicketId: text(matchedTicket?.id),
        claimStatus: matchedTicket ? "matched" : hasOrderConflict ? "conflict" : claimed ? "claimed" : "unclaimed",
        claim: claimed ? {
          ownerId: text(claimed.ownerId),
          ownerName: text(claimed.ownerName),
          claimedAt: text(claimed.claimedAt),
        } : null,
      });
    }
  }

  const ticketOnly = (afterSalesTickets || [])
    .filter(ticketRequiresPhysicalReturn)
    .filter((ticket) => !matchedTicketIds.has(text(ticket.id)))
    .map((ticket) => ({
      id: `ticket::${text(ticket.id)}`,
      source: "after_sales",
      ticketId: text(ticket.id),
      warehouseId: text(ticket.warehouseId),
      warehouseName: text(ticket.warehouseName) || "未分配海外仓",
      originalOrderNumber: text(ticket.originalOrderNumber),
      shopName: text(ticket.shopAlias || ticket.shopName) || "未识别店铺",
      status: "recorded_pending",
      statusLabel: "已录单未见实物",
      expectedQty: ticketQuantity(ticket),
      activityAt: text(ticket.createdAt || ticket.updatedAt),
      activityDate: dateKey(ticket.createdAt || ticket.updatedAt, timezone),
    }));
  return { facts, ticketOnly };
}

function movementDate(item, timezone) {
  return dateKey(item?.shippedAt || item?.occurredAt || item?.arrivedAt || item?.actualShippedAt || item?.createdAt || item?.updatedAt, timezone);
}

function rowIdentity(source = {}) {
  return {
    warehouseId: text(source.warehouseId || source.destinationWarehouseId),
    warehouseName: text(source.warehouseName || source.destinationWarehouseName) || "未识别海外仓",
    country: text(source.country || source.destinationCountry),
    sku: skuKey(source.sku || source.countrySku),
    productName: text(source.productName || source.name || source.sku || source.countrySku) || "未识别产品",
  };
}
function addMetric(map, source, field, value) {
  const identity = rowIdentity(source);
  if (!identity.warehouseId || !identity.sku) return;
  const key = `${identity.warehouseId}::${identity.sku}`;
  const current = map.get(key) || { ...identity, outboundQty: 0, inboundQty: 0, transferInQty: 0, transferOutQty: 0, adjustmentQty: 0, returnReceivedQty: 0, restockedQty: 0, scrappedQty: 0, pendingReturnQty: 0, returnQty: 0 };
  current[field] = round(number(current[field]) + number(value));
  if (!current.productName && identity.productName) current.productName = identity.productName;
  map.set(key, current);
}

function inventoryDifferenceTone(varianceQty, actualQty) {
  const absolute = Math.abs(number(varianceQty));
  const rate = absolute / Math.max(1, Math.abs(number(actualQty)));
  if (absolute >= 10 || rate >= 0.05) return "critical";
  if (absolute >= 2 || rate >= 0.01) return "warning";
  return "balanced";
}

function aggregateRankings(facts, field, labelField) {
  const groups = new Map();
  for (const fact of facts) {
    const key = text(fact[field]) || (field === "shopName" ? "未识别店铺" : "未识别");
    const group = groups.get(key) || {
      [field]: key,
      [labelField]: text(fact[labelField]) || key,
      returnQty: 0,
      receivedQty: 0,
      restockedQty: 0,
      scrappedQty: 0,
      pendingQty: 0,
      inTransitQty: 0,
      factCount: 0,
      warehouseIds: new Set(),
      shops: new Set(),
      skus: new Set(),
    };
    group.returnQty += number(fact.returnQty);
    group.receivedQty += number(fact.receivedQty);
    group.restockedQty += number(fact.restockedQty);
    group.scrappedQty += number(fact.scrappedQty);
    group.pendingQty += number(fact.pendingQty);
    group.inTransitQty += fact.status === "in_transit" ? number(fact.returnQty) : 0;
    group.factCount += 1;
    if (fact.warehouseId) group.warehouseIds.add(fact.warehouseId);
    if (fact.shopName) group.shops.add(fact.shopName);
    if (fact.sku) group.skus.add(fact.sku);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    returnQty: round(group.returnQty),
    receivedQty: round(group.receivedQty),
    restockedQty: round(group.restockedQty),
    scrappedQty: round(group.scrappedQty),
    pendingQty: round(group.pendingQty),
    inTransitQty: round(group.inTransitQty),
    warehouseCount: group.warehouseIds.size,
    shopCount: group.shops.size,
    skuCount: group.skus.size,
    warehouseIds: undefined,
    shops: undefined,
    skus: undefined,
  })).sort((left, right) => right.returnQty - left.returnQty || right.factCount - left.factCount);
}

function buildPeriod({
  range,
  snapshots,
  warehouses,
  outboundOrders,
  inboundReceipts,
  inboundShipments,
  inventoryMovements,
  returnFacts,
  ticketOnlyReturns,
  timezone,
}) {
  const warehouseMap = new Map((warehouses || []).map((item) => [text(item.id), item]));
  const allowedWarehouseIds = new Set(warehouseMap.keys());
  const rowAllowed = (row) => !allowedWarehouseIds.size || allowedWarehouseIds.has(text(row?.warehouseId || row?.destinationWarehouseId));
  const openingSnapshot = latestSnapshotAtOrBefore(snapshots, previousDay(range.from), timezone);
  const closingSnapshot = latestSnapshotAtOrBefore(snapshots, range.to, timezone);
  const openingRows = new Map((openingSnapshot?.rows || []).filter(rowAllowed).map((row) => [snapshotKey(row), row]));
  const closingRows = new Map((closingSnapshot?.rows || []).filter(rowAllowed).map((row) => [snapshotKey(row), row]));
  const metrics = new Map();

  for (const order of outboundOrders || []) {
    if (!rowAllowed(order) || !inRange(order.shippedAt || order.occurredAt || order.createdAt, range, timezone)) continue;
    addMetric(metrics, order, "outboundQty", number(order.quantity || order.shippedQty));
  }
  for (const receipt of inboundReceipts || []) {
    if (!rowAllowed(receipt) || !inRange(receipt.arrivedAt || receipt.receivedAt || receipt.createdAt, range, timezone)) continue;
    addMetric(metrics, receipt, "inboundQty", Math.max(number(receipt.shelvedQty), number(receipt.goodQty), number(receipt.receivedQty)));
  }
  for (const movement of inventoryMovements || []) {
    if (!rowAllowed(movement) || !inRange(movement.occurredAt || movement.createdAt, range, timezone)) continue;
    const type = text(movement.type);
    const qty = number(movement.quantity);
    if (type === "transfer_in") addMetric(metrics, movement, "transferInQty", qty);
    else if (type === "transfer_out") addMetric(metrics, movement, "transferOutQty", qty);
    else if (type === "adjustment") addMetric(metrics, movement, "adjustmentQty", number(movement.signedQty ?? movement.quantity));
  }
  const periodFacts = (returnFacts || []).filter((fact) => rowAllowed(fact) && fact.activityDate >= range.from && fact.activityDate <= range.to);
  const dispositionFacts = (returnFacts || []).filter((fact) => rowAllowed(fact) && fact.dispositionDate >= range.from && fact.dispositionDate <= range.to);
  for (const fact of dispositionFacts) {
    addMetric(metrics, fact, "returnReceivedQty", fact.receivedQty);
    addMetric(metrics, fact, "restockedQty", fact.restockedQty);
    addMetric(metrics, fact, "scrappedQty", fact.scrappedQty);
    addMetric(metrics, fact, "pendingReturnQty", fact.pendingQty);
  }
  for (const fact of periodFacts) addMetric(metrics, fact, "returnQty", fact.returnQty);

  const keys = new Set([...openingRows.keys(), ...closingRows.keys(), ...metrics.keys()]);
  const skuRows = [...keys].map((key) => {
    const opening = openingRows.get(key);
    const closing = closingRows.get(key);
    const metric = metrics.get(key) || {};
    const identity = rowIdentity(closing || opening || metric);
    const openingInventoryQty = onHandQty(opening);
    const actualInventoryQty = onHandQty(closing);
    const theoreticalInventoryQty = round(
      openingInventoryQty
      + number(metric.inboundQty)
      + number(metric.restockedQty)
      + number(metric.transferInQty)
      - number(metric.outboundQty)
      - number(metric.transferOutQty)
      + number(metric.adjustmentQty),
    );
    const varianceQty = round(actualInventoryQty - theoreticalInventoryQty);
    const varianceRate = theoreticalInventoryQty ? round(varianceQty / Math.abs(theoreticalInventoryQty), 4) : varianceQty ? 1 : 0;
    const relatedFacts = periodFacts.filter((fact) => fact.warehouseId === identity.warehouseId && fact.sku === identity.sku);
    return {
      ...identity,
      openingInventoryQty,
      actualInventoryQty,
      theoreticalInventoryQty,
      varianceQty,
      varianceRate,
      differenceTone: inventoryDifferenceTone(varianceQty, actualInventoryQty),
      inboundQty: round(metric.inboundQty),
      outboundQty: round(metric.outboundQty),
      transferInQty: round(metric.transferInQty),
      transferOutQty: round(metric.transferOutQty),
      adjustmentQty: round(metric.adjustmentQty),
      returnReceivedQty: round(metric.returnReceivedQty),
      restockedQty: round(metric.restockedQty),
      scrappedQty: round(metric.scrappedQty),
      pendingReturnQty: round(metric.pendingReturnQty),
      returnQty: round(metric.returnQty),
      shopCount: new Set(relatedFacts.map((fact) => fact.shopName).filter(Boolean)).size,
      returnFactCount: relatedFacts.length,
      returnFacts: relatedFacts,
      snapshotComparable: Boolean(opening && closing),
    };
  });

  const shipmentRows = (inboundShipments || []).filter((item) => rowAllowed(item) && inRange(item.actualShippedAt || item.createdAt, range, timezone));
  const inboundInTransitQty = round(shipmentRows.reduce((sum, item) => sum + number(item.quantity || item.shippedQty), 0));
  const warehouseIds = new Set([...warehouseMap.keys(), ...skuRows.map((row) => row.warehouseId).filter(Boolean), ...periodFacts.map((fact) => fact.warehouseId).filter(Boolean)]);
  const warehouseRows = [...warehouseIds].map((warehouseId) => {
    const warehouse = warehouseMap.get(warehouseId) || {};
    const rows = skuRows.filter((row) => row.warehouseId === warehouseId);
    const facts = periodFacts.filter((fact) => fact.warehouseId === warehouseId);
    const inboundTransit = shipmentRows.filter((item) => text(item.warehouseId || item.destinationWarehouseId) === warehouseId)
      .reduce((sum, item) => sum + number(item.quantity || item.shippedQty), 0);
    const sum = (field) => round(rows.reduce((total, row) => total + number(row[field]), 0));
    const varianceQty = sum("varianceQty");
    const actualInventoryQty = sum("actualInventoryQty");
    return {
      warehouseId,
      warehouseName: text(warehouse.name) || rows[0]?.warehouseName || facts[0]?.warehouseName || "未识别海外仓",
      country: text(warehouse.country) || rows[0]?.country || facts[0]?.country || "",
      providerId: text(warehouse.providerId),
      openingInventoryQty: sum("openingInventoryQty"),
      actualInventoryQty,
      theoreticalInventoryQty: sum("theoreticalInventoryQty"),
      varianceQty,
      varianceRate: sum("theoreticalInventoryQty") ? round(varianceQty / Math.abs(sum("theoreticalInventoryQty")), 4) : varianceQty ? 1 : 0,
      differenceTone: inventoryDifferenceTone(varianceQty, actualInventoryQty),
      inboundQty: sum("inboundQty"),
      outboundQty: sum("outboundQty"),
      transferInQty: sum("transferInQty"),
      transferOutQty: sum("transferOutQty"),
      adjustmentQty: sum("adjustmentQty"),
      returnQty: round(facts.reduce((total, fact) => total + number(fact.returnQty), 0)),
      returnReceivedQty: sum("returnReceivedQty"),
      restockedQty: sum("restockedQty"),
      scrappedQty: sum("scrappedQty"),
      pendingReturnQty: sum("pendingReturnQty"),
      inTransitReturnQty: round(facts.filter((fact) => fact.status === "in_transit").reduce((total, fact) => total + number(fact.returnQty), 0)),
      inboundInTransitQty: round(inboundTransit),
      unclaimedReturnCount: facts.filter((fact) => fact.claimStatus === "unclaimed").length,
      unclaimedReturnQty: round(facts.filter((fact) => fact.claimStatus === "unclaimed").reduce((total, fact) => total + number(fact.returnQty), 0)),
      skuCount: rows.length,
      anomalySkuCount: rows.filter((row) => row.differenceTone !== "balanced").length,
      returnFactCount: facts.length,
      skuRows: rows.sort((left, right) => Math.abs(right.varianceQty) - Math.abs(left.varianceQty) || right.returnQty - left.returnQty),
      coverage: {
        openingSnapshot: openingSnapshot ? "ready" : "missing",
        closingSnapshot: closingSnapshot ? "ready" : "missing",
        outboundOrders: "ready",
        inboundReceipts: "ready",
        returnFacts: "ready",
        transferMovements: (inventoryMovements || []).some((item) => text(item.warehouseId) === warehouseId && /^transfer_/.test(text(item.type))) ? "ready" : "missing",
      },
    };
  }).sort((left, right) => {
    const tone = { critical: 0, warning: 1, balanced: 2 };
    return (tone[left.differenceTone] ?? 9) - (tone[right.differenceTone] ?? 9) || Math.abs(right.varianceQty) - Math.abs(left.varianceQty);
  });

  const sumWarehouse = (field) => round(warehouseRows.reduce((sum, row) => sum + number(row[field]), 0));
  const returnQty = round(periodFacts.reduce((sum, fact) => sum + number(fact.returnQty), 0));
  const unclaimedFacts = periodFacts.filter((fact) => fact.claimStatus === "unclaimed");
  const matchedQty = round(periodFacts.filter((fact) => fact.claimStatus === "matched").reduce((sum, fact) => sum + number(fact.returnQty), 0));
  const periodTicketOnly = (ticketOnlyReturns || []).filter((ticket) => ticket.activityDate >= range.from && ticket.activityDate <= range.to && rowAllowed(ticket));
  const summary = {
    openingInventoryQty: sumWarehouse("openingInventoryQty"),
    actualInventoryQty: sumWarehouse("actualInventoryQty"),
    theoreticalInventoryQty: sumWarehouse("theoreticalInventoryQty"),
    varianceQty: sumWarehouse("varianceQty"),
    inboundQty: sumWarehouse("inboundQty"),
    outboundQty: sumWarehouse("outboundQty"),
    transferInQty: sumWarehouse("transferInQty"),
    transferOutQty: sumWarehouse("transferOutQty"),
    adjustmentQty: sumWarehouse("adjustmentQty"),
    returnQty,
    returnReceivedQty: sumWarehouse("returnReceivedQty"),
    inTransitReturnQty: round(periodFacts.filter((fact) => fact.status === "in_transit").reduce((sum, fact) => sum + number(fact.returnQty), 0)),
    pendingReturnQty: sumWarehouse("pendingReturnQty"),
    restockedQty: sumWarehouse("restockedQty"),
    scrappedQty: sumWarehouse("scrappedQty"),
    inboundInTransitQty,
    unclaimedReturnCount: unclaimedFacts.length,
    unclaimedReturnQty: round(unclaimedFacts.reduce((sum, fact) => sum + number(fact.returnQty), 0)),
    matchedReturnQty: matchedQty,
    afterSalesCoverageRate: returnQty ? round(matchedQty / returnQty, 4) : 1,
    recordedWithoutWmsCount: periodTicketOnly.length,
    recordedWithoutWmsQty: round(periodTicketOnly.reduce((sum, ticket) => sum + number(ticket.expectedQty), 0)),
    warehouseCount: warehouseRows.length,
    anomalyWarehouseCount: warehouseRows.filter((row) => row.differenceTone !== "balanced").length,
    anomalySkuCount: skuRows.filter((row) => row.differenceTone !== "balanced").length,
  };

  return {
    range,
    openingSnapshot: openingSnapshot ? { date: openingSnapshot.date, capturedAt: openingSnapshot.capturedAt || "" } : null,
    closingSnapshot: closingSnapshot ? { date: closingSnapshot.date, capturedAt: closingSnapshot.capturedAt || "" } : null,
    summary,
    warehouses: warehouseRows,
    skuRows,
    returnFacts: periodFacts.sort((left, right) => text(right.activityAt).localeCompare(text(left.activityAt))),
    ticketOnlyReturns: periodTicketOnly,
    rankings: {
      skus: aggregateRankings(periodFacts, "sku", "productName"),
      shops: aggregateRankings(periodFacts, "shopName", "shopName"),
      warehouses: aggregateRankings(periodFacts, "warehouseId", "warehouseName"),
    },
  };
}

function metricDelta(current, previous) {
  const currentValue = round(current);
  const previousValue = round(previous);
  const change = round(currentValue - previousValue);
  return {
    current: currentValue,
    previous: previousValue,
    change,
    rate: previousValue ? round(change / Math.abs(previousValue), 4) : currentValue ? null : 0,
  };
}

function mergeRankingComparison(current, previous, key) {
  const previousMap = new Map(previous.map((item) => [text(item[key]), item]));
  return current.map((item) => ({
    ...item,
    previousReturnQty: round(previousMap.get(text(item[key]))?.returnQty),
    changeQty: round(item.returnQty - number(previousMap.get(text(item[key]))?.returnQty)),
    changeRate: number(previousMap.get(text(item[key]))?.returnQty)
      ? round((item.returnQty - number(previousMap.get(text(item[key]))?.returnQty)) / Math.abs(number(previousMap.get(text(item[key]))?.returnQty)), 4)
      : item.returnQty ? null : 0,
  }));
}

export function buildOverseasInventoryReconciliation({
  ranges,
  period = "month",
  anchorDate = new Date().toISOString().slice(0, 10),
  from,
  to,
  timezone = "Asia/Shanghai",
  snapshots = [],
  warehouses = [],
  outboundOrders = [],
  inboundReceipts = [],
  inboundShipments = [],
  inventoryMovements = [],
  wmsReturnOrders = [],
  afterSalesTickets = [],
  claimMap = {},
  sources = {},
} = {}) {
  const resolvedRanges = ranges || resolveOverseasReconciliationRanges({ period, anchorDate, from, to });
  const returnData = buildReturnFacts({ wmsReturnOrders, afterSalesTickets, outboundOrders, claimMap, timezone });
  const common = {
    snapshots,
    warehouses,
    outboundOrders,
    inboundReceipts,
    inboundShipments,
    inventoryMovements,
    returnFacts: returnData.facts,
    ticketOnlyReturns: returnData.ticketOnly,
    timezone,
  };
  const current = buildPeriod({ ...common, range: resolvedRanges.current });
  const previous = buildPeriod({ ...common, range: resolvedRanges.previous });
  const previousWarehouseMap = new Map(previous.warehouses.map((item) => [item.warehouseId, item]));
  const warehouseRows = current.warehouses.map((item) => ({
    ...item,
    comparison: {
      actualInventoryQty: metricDelta(item.actualInventoryQty, previousWarehouseMap.get(item.warehouseId)?.actualInventoryQty),
      varianceQty: metricDelta(item.varianceQty, previousWarehouseMap.get(item.warehouseId)?.varianceQty),
      returnQty: metricDelta(item.returnQty, previousWarehouseMap.get(item.warehouseId)?.returnQty),
      restockedQty: metricDelta(item.restockedQty, previousWarehouseMap.get(item.warehouseId)?.restockedQty),
      scrappedQty: metricDelta(item.scrappedQty, previousWarehouseMap.get(item.warehouseId)?.scrappedQty),
    },
  }));
  return {
    ok: true,
    scope: "overseas",
    generatedAt: new Date().toISOString(),
    timezone,
    ranges: resolvedRanges,
    filters: { period, anchorDate, from: text(from), to: text(to) },
    summary: current.summary,
    comparison: {
      summary: Object.fromEntries(Object.keys(current.summary).map((key) => [key, metricDelta(current.summary[key], previous.summary[key])])),
      previousSummary: previous.summary,
    },
    snapshots: { opening: current.openingSnapshot, closing: current.closingSnapshot, previousOpening: previous.openingSnapshot, previousClosing: previous.closingSnapshot },
    warehouses: warehouseRows,
    returnFacts: current.returnFacts,
    ticketOnlyReturns: current.ticketOnlyReturns,
    rankings: {
      skus: mergeRankingComparison(current.rankings.skus, previous.rankings.skus, "sku"),
      shops: mergeRankingComparison(current.rankings.shops, previous.rankings.shops, "shopName"),
      warehouses: mergeRankingComparison(current.rankings.warehouses, previous.rankings.warehouses, "warehouseId"),
    },
    sources: {
      inventory: { status: current.closingSnapshot ? "ready" : "missing", syncedAt: text(sources.inventorySyncedAt), snapshotDate: current.closingSnapshot?.date || "" },
      orders: { status: sources.orderComplete === false ? "partial" : "ready", syncedAt: text(sources.ordersSyncedAt) },
      inbound: { status: "ready", syncedAt: text(sources.inboundSyncedAt) },
      returns: { status: sources.returnComplete === false ? "partial" : "ready", syncedAt: text(sources.returnsSyncedAt), errors: Array.isArray(sources.returnErrors) ? sources.returnErrors : [] },
      transfers: { status: (inventoryMovements || []).some((item) => /^transfer_/.test(text(item.type))) ? "ready" : "missing", syncedAt: text(sources.transferSyncedAt), message: (inventoryMovements || []).some((item) => /^transfer_/.test(text(item.type))) ? "已纳入海外仓调拨流水" : "当前 WMS 尚未提供海外仓调拨流水，剩余影响进入无法解释差异。" },
    },
  };
}

function text(value) {
  return String(value || "").trim();
}

const CONFIRMED_YUN_WAREHOUSE_CODES = new Map([
  ["俄罗斯1仓", "MX001"],
  ["俄罗斯2仓", "DD001"],
]);

function warehouseNameKey(value) {
  return text(value).replace(/\s+/g, "");
}

function sameIdentifier(left, right) {
  return text(left).toUpperCase() === text(right).toUpperCase();
}

export function resolveWarehouseBinding(payload = {}, existingConnection = null) {
  const existing = existingConnection || {};
  const providerId = text(payload.providerId || existing.providerId || "sea_wms");
  const submittedCode = text(payload.warehouseCode);
  const submittedId = text(payload.warehouseId);
  const existingCode = text(existing.warehouseCode);
  const existingId = text(existing.warehouseId);
  const existingResolvedId = text(existing.resolvedWarehouseId);

  if (providerId === "yunwms_ru") {
    const warehouseCode = submittedCode || submittedId || existingCode || existingId || existingResolvedId;
    return {
      warehouseCode,
      warehouseId: warehouseCode,
      resolvedWarehouseId: warehouseCode,
    };
  }

  const warehouseCode = submittedCode || existingCode;
  const warehouseId = submittedId || submittedCode || existingId || existingCode;
  const bindingChanged = Boolean(submittedCode || submittedId)
    && (warehouseCode !== existingCode || warehouseId !== existingId);

  return {
    warehouseCode,
    warehouseId,
    resolvedWarehouseId: bindingChanged ? warehouseId : existingResolvedId,
  };
}

export function warehouseBindingChanged(previous = {}, next = {}) {
  const normalizeUrl = (value) => text(value).replace(/\/+$/, "").toLowerCase();
  return [
    text(previous.providerId).toLowerCase() !== text(next.providerId).toLowerCase(),
    normalizeUrl(previous.baseUrl) !== normalizeUrl(next.baseUrl),
    text(previous.warehouseCode).toUpperCase() !== text(next.warehouseCode).toUpperCase(),
    text(previous.warehouseId).toUpperCase() !== text(next.warehouseId).toUpperCase(),
  ].some(Boolean);
}

export function normalizeWarehouseConnectionBindings(connections = []) {
  const changedWarehouseIds = new Set();
  let changedCount = 0;
  const normalizedConnections = (Array.isArray(connections) ? connections : []).map((connection) => {
    if (text(connection?.providerId) !== "yunwms_ru") return connection;

    const confirmedWarehouseCode = text(connection?.warehouseCode)
      ? ""
      : CONFIRMED_YUN_WAREHOUSE_CODES.get(warehouseNameKey(connection?.name));
    const binding = resolveWarehouseBinding({
      providerId: "yunwms_ru",
      ...(confirmedWarehouseCode ? { warehouseCode: confirmedWarehouseCode } : {}),
    }, connection);
    if (!binding.warehouseCode) return connection;

    const changed = ["warehouseCode", "warehouseId", "resolvedWarehouseId"]
      .some((field) => !sameIdentifier(connection?.[field], binding[field]));
    if (!changed) return connection;

    changedCount += 1;
    [connection?.id, connection?.warehouseCode, connection?.warehouseId, connection?.resolvedWarehouseId]
      .map(text)
      .filter(Boolean)
      .forEach((identifier) => changedWarehouseIds.add(identifier));
    return { ...connection, ...binding };
  });

  return {
    connections: normalizedConnections,
    changed: changedCount > 0,
    changedCount,
    changedWarehouseIds: [...changedWarehouseIds],
  };
}

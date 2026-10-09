function text(value) {
  return String(value || "").trim();
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

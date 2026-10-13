function text(value) {
  return String(value ?? "").trim();
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function existingSkus(workflow = {}) {
  return [...new Set([
    ...(workflow.productOptions || []).map((item) => item.sku),
    ...(workflow.productCodingQueue || []).map((item) => item.officialSku),
  ].map((value) => text(value).toUpperCase()).filter(Boolean))];
}

function queueProduct(workflow, productRecordId) {
  return (workflow?.productCodingQueue || []).find((item) => item.id === text(productRecordId));
}

function isDirectDraft(input = {}) {
  return text(input.mode).toLowerCase() === "direct" && /^manual:/i.test(text(input.productRecordId));
}

function directDraftProduct(input = {}) {
  if (!isDirectDraft(input)) return null;
  const productName = text(input.productName || input.product?.productName);
  if (!productName) throw new Error("请先填写新品中文名称。");
  return {
    id: text(input.productRecordId),
    productName,
    productNameEn: text(input.product?.productNameEn),
    brand: text(input.product?.brand),
    specification: text(input.product?.specification),
    barcode: text(input.product?.barcode),
    unit: text(input.product?.unit || "件"),
  };
}

function publicWarehouseResult(connectionId, status, values = {}) {
  return {
    connectionId,
    warehouseName: text(values.warehouseName || values.connectionName),
    providerId: text(values.providerId),
    status,
    externalId: text(values.externalId),
    message: text(values.message),
    updatedAt: new Date().toISOString(),
  };
}

export function createSkuCodingService({
  registry,
  completeProductCodingFn,
  createWarehouseProductFn,
  resolveConnection = () => null,
} = {}) {
  if (!registry) throw new Error("缺少 SKU 编码注册表。");
  if (typeof completeProductCodingFn !== "function") throw new Error("缺少简道云产品建档处理器。");
  if (typeof createWarehouseProductFn !== "function") throw new Error("缺少 WMS 商品建档处理器。");

  function snapshot(workflow = {}, warehouseOptions = []) {
    const skus = existingSkus(workflow);
    return {
      ok: true,
      ...registry.snapshot(skus),
      queue: workflow.productCodingQueue || [],
      warehouseOptions,
      catalogSkuCount: skus.length,
      catalogSyncedAt: text(workflow.syncedAt),
      catalogSource: "jiandaoyun-product-base",
    };
  }

  function upsertRule(input, actor) {
    return registry.upsertRule(input, actor);
  }

  function reserve(input, workflow, actor) {
    const product = queueProduct(workflow, input.productRecordId) || directDraftProduct(input);
    if (!product) throw new Error("未找到待编码新品，请刷新编码队列后重试，或使用“直接新建”。");
    return registry.reserve({
      ruleId: input.ruleId,
      productRecordId: product.id,
      productName: product.productName,
      requestedBy: actor,
      existingSkus: existingSkus(workflow),
    });
  }

  function cancel(input, actor) {
    return registry.cancelReservation(input.reservationId, actor, input.reason);
  }

  function productInput(input, product, sku) {
    const source = input?.product && typeof input.product === "object" ? input.product : {};
    return {
      ...source,
      sku,
      productName: text(source.productName || product?.productName),
      productNameEn: text(source.productNameEn || product?.productNameEn),
      brand: text(source.brand || product?.brand),
      specification: text(source.specification || product?.specification),
      barcode: text(source.barcode || product?.barcode),
      unit: text(source.unit || product?.unit || "件"),
    };
  }

  async function pushWarehouses(targetIds, input, previousResults = [], createOverride) {
    const createProduct = createOverride || createWarehouseProductFn;
    const previousByConnection = new Map(previousResults.map((item) => [item.connectionId, item]));
    const results = [];
    for (const connectionId of unique(targetIds)) {
      const previous = previousByConnection.get(connectionId);
      if (previous?.status === "success") {
        results.push(previous);
        continue;
      }
      const connection = resolveConnection(connectionId);
      if (!connection) {
        results.push(publicWarehouseResult(connectionId, "failed", { message: "仓库连接不存在或已经停用。" }));
        continue;
      }
      try {
        const created = await createProduct(connection, input);
        results.push(publicWarehouseResult(connectionId, "success", { ...connection, ...created }));
      } catch (error) {
        results.push(publicWarehouseResult(connectionId, "failed", { ...connection, message: error?.message || "WMS 商品建档失败" }));
      }
    }
    return results;
  }

  async function complete(input, workflow, actor) {
    const reservationId = text(input.reservationId);
    if (!reservationId) return completeProductCodingFn(input, workflow);
    const reservation = registry.getReservation(reservationId);
    if (!reservation) throw new Error("未找到 SKU 预占记录，请重新获取下一编码。");
    if (reservation.productRecordId !== text(input.productRecordId)) throw new Error("SKU 预占记录与当前新品不一致。");
    if (reservation.status === "cancelled") throw new Error(`SKU ${reservation.sku} 已撤销，不能继续建档。`);
    if (reservation.status === "completed") return { ok: true, alreadyCompleted: true, ...reservation };
    const direct = isDirectDraft(input);
    const product = queueProduct(workflow, input.productRecordId) || directDraftProduct(input);
    if (!product) throw new Error("未找到待编码新品，请刷新编码队列后重试，或使用“直接新建”。");
    const normalizedProduct = productInput(input, product, reservation.sku);
    const targetConnectionIds = unique(input.warehouseConnectionIds);
    const jdy = await completeProductCodingFn({
      ...input,
      mode: direct ? "direct" : "queue",
      sku: reservation.sku,
      product: normalizedProduct,
    }, workflow);
    if (input.dryRun) {
      return { ...jdy, reservationId, sku: reservation.sku, status: "preview", warehouseResults: [] };
    }
    const warehouseResults = await pushWarehouses(targetConnectionIds, normalizedProduct, reservation.warehouseResults || []);
    const status = warehouseResults.some((item) => item.status === "failed") ? "partial" : "completed";
    const saved = registry.recordArchiveResult(reservationId, {
      status,
      jdyRecordId: jdy.productRecordId,
      jdyStatus: "success",
      message: status === "partial" ? "简道云已建档，部分 WMS 建档失败，可单独重试。" : "简道云及所选 WMS 建档完成。",
      warehouseResults,
      productInput: normalizedProduct,
      targetConnectionIds,
      completedById: text(actor?.id),
      completedByName: text(actor?.name),
    });
    return { ok: true, ...saved, productRecordId: jdy.productRecordId, sourceProductRecordId: saved.productRecordId, demandRecordId: jdy.demandRecordId, sku: reservation.sku };
  }

  async function retry(input, actor, overrides = {}) {
    const reservation = registry.getReservation(input.reservationId);
    if (!reservation) throw new Error("未找到 SKU 建档记录。");
    if (!reservation.jdyRecordId || reservation.jdyStatus !== "success") throw new Error("简道云产品档案尚未成功，不能单独重试 WMS。");
    const requested = unique(input.warehouseConnectionIds);
    const failedIds = (reservation.warehouseResults || []).filter((item) => item.status === "failed").map((item) => item.connectionId);
    const targetIds = requested.length ? requested.filter((id) => failedIds.includes(id)) : failedIds;
    if (!targetIds.length) return { ok: true, alreadyCompleted: true, ...reservation };
    const retried = await pushWarehouses(targetIds, reservation.productInput || { sku: reservation.sku, productName: reservation.productName }, [], overrides.createWarehouseProductFn);
    const retriedById = new Map(retried.map((item) => [item.connectionId, item]));
    const warehouseResults = (reservation.warehouseResults || []).map((item) => retriedById.get(item.connectionId) || item);
    for (const item of retried) {
      if (!warehouseResults.some((existing) => existing.connectionId === item.connectionId)) warehouseResults.push(item);
    }
    const status = warehouseResults.some((item) => item.status === "failed") ? "partial" : "completed";
    const saved = registry.recordArchiveResult(reservation.id, {
      status,
      jdyRecordId: reservation.jdyRecordId,
      jdyStatus: "success",
      warehouseResults,
      productInput: reservation.productInput,
      targetConnectionIds: reservation.targetConnectionIds,
      message: status === "completed" ? "WMS 商品档案重试完成。" : "仍有 WMS 商品档案创建失败。",
      retriedById: text(actor?.id),
      retriedByName: text(actor?.name),
    });
    return { ok: true, ...saved };
  }

  return { snapshot, upsertRule, reserve, cancel, complete, retry };
}

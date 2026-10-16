import { createHash } from "node:crypto";

function limitFor(filters, fallback = 80, maximum = 200) {
  return Math.max(1, Math.min(maximum, Math.floor(Number(filters?.limit) || fallback)));
}

function keywordFor(filters) {
  return String(filters?.keyword || "").trim().toLowerCase();
}

function includesKeyword(item, keyword, fields) {
  if (!keyword) return true;
  return fields.some((field) => String(item?.[field] || "").toLowerCase().includes(keyword));
}

function imageKeyFor(url) {
  return url ? createHash("sha256").update(String(url)).digest("hex") : "";
}

function inventoryRecordId(item) {
  if (item?.id) return String(item.id);
  return `inv_${createHash("sha256").update(`${text(item?.warehouseId)}|${text(item?.sku).toUpperCase()}`).digest("hex")}`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return String(value || "").trim();
}

function mobileLoadingItem(item) {
  return {
    id: text(item?.id),
    sku: text(item?.sku),
    productName: text(item?.productName),
    cartonCount: number(item?.cartonCount),
    unitsPerCarton: number(item?.unitsPerCarton),
    cartonLengthCm: number(item?.cartonLengthCm),
    cartonWidthCm: number(item?.cartonWidthCm),
    cartonHeightCm: number(item?.cartonHeightCm),
    cartonWeightKg: number(item?.cartonWeightKg),
    orientation: ["fixed", "upright", "any"].includes(String(item?.orientation)) ? String(item.orientation) : "upright",
  };
}

function mobileLoadingCandidate(candidate, renderLimit = 600) {
  const allPlacements = Array.isArray(candidate?.placements) ? candidate.placements : [];
  return {
    strategy: text(candidate?.strategy),
    score: number(candidate?.score),
    metrics: candidate?.metrics || {},
    warnings: Array.isArray(candidate?.warnings) ? candidate.warnings.map(String) : [],
    totalPlacements: allPlacements.length,
    renderedPlacements: Math.min(allPlacements.length, renderLimit),
    renderLimited: allPlacements.length > renderLimit,
    placements: allPlacements.slice(0, renderLimit).map((placement) => ({
      placementId: text(placement.placementId),
      itemId: text(placement.itemId),
      sku: text(placement.sku),
      productName: text(placement.productName),
      sequence: number(placement.sequence),
      x: number(placement.x),
      y: number(placement.y),
      z: number(placement.z),
      lengthCm: number(placement.lengthCm),
      widthCm: number(placement.widthCm),
      heightCm: number(placement.heightCm),
      cartonWeightKg: number(placement.cartonWeightKg),
    })),
  };
}

export function createMobileAdminBusinessProviders({
  domesticInventoryService,
  domesticInventoryContextForAuth,
  getProducts,
  productResponsePayload,
  getQualifications,
  scopedPartnerPayload,
  getStockupPayload,
  containerLoadingService,
  hasPermission,
}) {
  function visibleProductPayload(auth) {
    return productResponsePayload(getProducts(), auth, "detail");
  }

  function productIndex(auth) {
    const payload = visibleProductPayload(auth);
    const bySku = new Map();
    for (const product of [...(payload.productBase || []), ...(payload.catalog || [])]) {
      const sku = text(product.sku || product.skuNo).toUpperCase();
      if (!sku) continue;
      const current = bySku.get(sku) || {};
      bySku.set(sku, {
        ...current,
        ...product,
        imageUrl: current.imageUrl || product.imageUrl || product.qualificationImageUrl || "",
        specification: current.specification || product.specification || "",
        barcode: current.barcode || product.barcode || "",
      });
    }
    return { payload, bySku };
  }

  function withProductImage(item, bySku) {
    const product = bySku.get(text(item.sku).toUpperCase()) || {};
    const imageUrl = item.imageUrl || product.imageUrl || product.qualificationImageUrl || "";
    return {
      ...item,
      imageUrl,
      imageKey: imageKeyFor(imageUrl),
      specification: item.specification || product.specification || "",
      barcode: item.barcode || product.barcode || "",
      brand: item.brand || product.brand || "",
      category: item.category || product.category || "",
    };
  }

  function containerContext(auth) {
    const scopes = auth?.user?.dataScopes || {};
    return {
      auth,
      viewAll: auth?.role === "admin" || ["container_loading_manage", "container_loading_confirm", "stockup_request_view_all", "stockup_execution_manage"].some((permission) => hasPermission(auth, permission)),
      countries: Array.isArray(scopes.countries) ? scopes.countries.map(String).filter(Boolean) : [],
      warehouseIds: Array.isArray(scopes.warehouseIds) ? scopes.warehouseIds.map(String).filter(Boolean) : [],
      skus: Array.isArray(scopes.skus) ? scopes.skus.map((value) => String(value).toUpperCase()).filter(Boolean) : [],
    };
  }

  function domesticInventory(filters, auth) {
    const { bySku } = productIndex(auth);
    const payload = domesticInventoryService.list({
      warehouseId: filters.warehouseId || "",
      keyword: filters.keyword || "",
      lowStock: filters.lowStock === "1" ? "1" : "",
    }, domesticInventoryContextForAuth(auth));
    return {
      updatedAt: payload.updatedAt || "",
      summary: payload.summary || {},
      warehouses: (payload.warehouses || []).map((warehouse) => ({
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        city: warehouse.city || "",
        status: warehouse.status,
        skuCount: Number(warehouse.skuCount || 0),
        onHandQty: Number(warehouse.onHandQty || 0),
        lowStockSkuCount: Number(warehouse.lowStockSkuCount || 0),
      })),
      items: (payload.balances || []).slice(0, limitFor(filters, 80)).map((item) => withProductImage({
        id: inventoryRecordId(item),
        warehouseId: item.warehouseId,
        warehouseName: item.warehouseName,
        sku: item.sku,
        productName: item.productName,
        imageUrl: item.imageUrl || "",
        unit: item.unit || "件",
        onHandQty: Number(item.onHandQty || 0),
        reservedQty: Number(item.reservedQty || 0),
        availableQty: Number(item.availableQty || 0),
        safetyStockQty: Number(item.safetyStockQty || 0),
        lowStock: Boolean(item.lowStock),
        updatedAt: item.updatedAt || "",
      }, bySku)),
    };
  }

  function products(filters, auth) {
    const payload = productResponsePayload(getProducts(), auth, "list");
    const keyword = keywordFor(filters);
    const country = String(filters.country || "").trim();
    const alert = String(filters.alert || "").trim();
    const filtered = (payload.catalog || [])
      .filter((item) => includesKeyword(item, keyword, ["sku", "skuNo", "countrySku", "name", "nameEn", "brand", "category"]))
      .filter((item) => !country || item.country === country)
      .filter((item) => !alert || item.alert === alert);
    return {
      updatedAt: payload.syncedAt || "",
      summary: {
        products: filtered.length,
        countries: new Set(filtered.map((item) => item.country).filter(Boolean)).size,
        inStock: filtered.filter((item) => Number(item.stockQty || item.warehouseTotalQty || 0) > 0).length,
        alerts: filtered.filter((item) => item.alert && item.alert !== "健康").length,
      },
      filters: { countries: [...new Set((payload.catalog || []).map((item) => item.country).filter(Boolean))].sort() },
      items: filtered.slice(0, limitFor(filters, 80)).map((item) => ({
        id: item.id,
        sku: item.sku,
        skuNo: item.skuNo,
        countrySku: item.countrySku || "",
        name: item.name,
        nameEn: item.nameEn || "",
        country: item.country || "",
        brand: item.brand || "",
        category: item.category || "",
        unit: item.unit || "件",
        imageUrl: item.imageUrl || "",
        imageKey: imageKeyFor(item.imageUrl || item.qualificationImageUrl || ""),
        stockQty: Number(item.stockQty || item.warehouseTotalQty || 0),
        inTransitQty: Number(item.inTransitQty || 0),
        status: item.status || "",
        alert: item.alert || "",
        ...(item.directPrice !== undefined ? { directPrice: Number(item.directPrice || 0), directCurrency: item.directCurrency || "" } : {}),
        ...(item.distributionPrice !== undefined ? { distributionPrice: Number(item.distributionPrice || 0), distributionCurrency: item.distributionCurrency || "" } : {}),
        ...(item.salesPrice !== undefined ? { salesPrice: Number(item.salesPrice || 0), salesCurrency: item.salesCurrency || "" } : {}),
      })),
    };
  }

  function qualifications(filters, auth) {
    const payload = scopedPartnerPayload(getQualifications(), "qualifications", auth);
    const keyword = keywordFor(filters);
    const status = String(filters.status || "").trim();
    const now = Date.now();
    const decorate = (item) => {
      const expiry = item.expiryDate ? Date.parse(item.expiryDate) : 0;
      const days = expiry ? Math.ceil((expiry - now) / 86_400_000) : null;
      return {
        id: item.id,
        sku: item.sku,
        productName: item.productName,
        qualificationName: item.qualificationName,
        qualificationCategory: item.qualificationCategory,
        market: item.market,
        issuer: item.issuer || "",
        effectiveDate: item.effectiveDate || "",
        expiryDate: item.expiryDate || "",
        expiryStatus: days === null ? "undated" : days < 0 ? "expired" : days <= 90 ? "expiring" : "valid",
        daysToExpiry: days,
        fileCount: Array.isArray(item.files) ? item.files.length : 0,
        remark: item.remark || "",
      };
    };
    const allItems = (payload.qualifications || []).map(decorate);
    const filtered = allItems
      .filter((item) => includesKeyword(item, keyword, ["sku", "productName", "qualificationName", "qualificationCategory", "market", "issuer"]))
      .filter((item) => !status || item.expiryStatus === status);
    return {
      updatedAt: payload.syncedAt || "",
      summary: {
        qualifications: allItems.length,
        withFiles: allItems.filter((item) => item.fileCount > 0).length,
        expiring: allItems.filter((item) => item.expiryStatus === "expiring").length,
        expired: allItems.filter((item) => item.expiryStatus === "expired").length,
      },
      items: filtered.slice(0, limitFor(filters, 80)),
    };
  }

  function stockupRisks(filters, auth) {
    const payload = getStockupPayload();
    const { bySku } = productIndex(auth);
    const keyword = keywordFor(filters);
    const status = String(filters.status || "").trim();
    const recommendations = payload.recommendations || [];
    const filtered = recommendations
      .filter((item) => includesKeyword(item, keyword, ["sku", "countrySku", "name", "country", "status"]))
      .filter((item) => !status || item.status === status);
    return {
      updatedAt: payload.generatedAt || "",
      summary: {
        recommendations: Number(payload.counts?.recommendations || 0),
        stockout: recommendations.filter((item) => item.status === "缺货").length,
        replenish: recommendations.filter((item) => item.status === "补货预警").length,
        netRecommendedQty: Number(payload.counts?.netRecommendedQty || 0),
      },
      items: filtered.slice(0, limitFor(filters, 80)).map((item) => withProductImage({
        id: item.id,
        sku: item.sku,
        countrySku: item.countrySku || "",
        name: item.name,
        country: item.country || "",
        unit: item.unit || "件",
        status: item.status,
        availableQty: Number(item.availableQty || 0),
        inTransitQty: Number(item.inTransitQty || 0),
        sales30: Number(item.sales30 || 0),
        daysCover: item.daysCover,
        replenishQty: Number(item.replenishQty || 0),
        outsourcingInProductionQty: Number(item.outsourcingInProductionQty || 0),
        netReplenishQty: Number(item.netReplenishQty || 0),
        suggestion: item.suggestion || "",
      }, bySku)),
    };
  }

  function containerLoading(filters, auth) {
    const payload = containerLoadingService.bootstrap(containerContext(auth));
    const keyword = keywordFor(filters);
    const status = String(filters.status || "").trim();
    const plans = payload.plans || [];
    const filtered = plans
      .filter((item) => includesKeyword(item, keyword, ["planNo", "name", "sourceShipmentNo", "destinationWarehouseName", "containerType"]))
      .filter((item) => !status || item.status === status);
    return {
      updatedAt: plans.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, ""),
      summary: {
        plans: plans.length,
        draft: plans.filter((item) => item.status === "draft").length,
        confirmed: plans.filter((item) => item.status === "confirmed").length,
        shipments: (payload.shipments || []).length,
      },
      items: filtered.slice(0, limitFor(filters, 80)),
    };
  }

  containerLoading.calculatorBootstrap = (auth) => {
    const payload = containerLoadingService.bootstrap(containerContext(auth));
    return {
      containerTypes: (payload.containerTypes || []).map((container) => ({
        code: text(container.code),
        name: text(container.name),
        lengthCm: number(container.lengthCm),
        widthCm: number(container.widthCm),
        heightCm: number(container.heightCm),
        doorWidthCm: number(container.doorWidthCm),
        doorHeightCm: number(container.doorHeightCm),
        maxPayloadKg: number(container.maxPayloadKg),
      })),
      shipments: (payload.shipments || []).map((shipment) => ({
        id: text(shipment.id),
        shipmentNo: text(shipment.shipmentNo),
        destinationWarehouseName: text(shipment.destinationWarehouseName),
        destinationCountry: text(shipment.destinationCountry),
        status: text(shipment.status),
        packages: number(shipment.packages),
        totalWeightKg: number(shipment.totalWeightKg),
        totalVolumeM3: number(shipment.totalVolumeM3),
        lines: (shipment.lines || []).map(mobileLoadingItem),
      })),
      limits: payload.limits || { maxCartons: 2000, detailedRenderCartons: 600 },
    };
  };

  containerLoading.calculate = async (input, auth) => {
    if (Array.isArray(input?.items) && input.items.length > 50) {
      throw Object.assign(new Error("一次临时测算最多录入 50 行商品。"), { statusCode: 400, code: "too_many_item_lines" });
    }
    const result = await containerLoadingService.calculatePreview(input || {}, containerContext(auth));
    return {
      preview: true,
      sourceType: result.sourceType,
      sourceShipmentId: result.sourceShipmentId,
      sourceShipmentNo: result.sourceShipmentNo,
      destinationWarehouseName: result.destinationWarehouseName,
      container: result.container,
      items: (result.items || []).map(mobileLoadingItem),
      selectedStrategy: result.selectedStrategy,
      candidates: (result.candidates || []).map((candidate) => mobileLoadingCandidate(candidate, 600)),
      calculatedAt: result.calculatedAt,
    };
  };

  domesticInventory.detail = (recordId, auth) => {
    const payload = domesticInventoryService.list({}, domesticInventoryContextForAuth(auth));
    const item = (payload.balances || []).find((candidate) => inventoryRecordId(candidate) === String(recordId));
    if (!item) return null;
    const { bySku } = productIndex(auth);
    return withProductImage({
      id: inventoryRecordId(item),
      warehouseId: item.warehouseId,
      warehouseName: item.warehouseName,
      sku: item.sku,
      productName: item.productName,
      imageUrl: item.imageUrl || "",
      unit: item.unit || "件",
      onHandQty: number(item.onHandQty),
      reservedQty: number(item.reservedQty),
      availableQty: number(item.availableQty),
      safetyStockQty: number(item.safetyStockQty),
      lowStock: Boolean(item.lowStock),
      updatedAt: item.updatedAt || "",
    }, bySku);
  };

  products.detail = (recordId, auth) => {
    const { payload } = productIndex(auth);
    const catalog = (payload.catalog || []).find((item) => String(item.id) === String(recordId));
    const baseById = (payload.productBase || []).find((item) => String(item.id) === String(recordId));
    const sku = text(catalog?.sku || baseById?.sku).toUpperCase();
    const base = baseById || (payload.productBase || []).find((item) => text(item.sku).toUpperCase() === sku) || {};
    const item = catalog || baseById;
    if (!item) return null;
    const merged = { ...base, ...catalog };
    const imageUrl = merged.imageUrl || merged.qualificationImageUrl || "";
    const fields = [
      "id", "sku", "skuNo", "countrySku", "name", "nameEn", "country", "channel", "category", "functionCategory", "productType", "skuAttribute", "unit", "brand", "barcode", "specification", "weight", "length", "width", "height", "project", "status", "alert", "stockQty", "warehouseTotalQty", "inTransitQty", "publicDescription", "sellingPoints", "sellingPointsEn", "directPrice", "directCurrency", "distributionPrice", "distributionCurrency", "salesPrice", "salesCurrency",
    ];
    const detail = Object.fromEntries(fields.filter((key) => merged[key] !== undefined).map((key) => [key, merged[key]]));
    return { ...detail, id: item.id, imageUrl, imageKey: imageKeyFor(imageUrl) };
  };

  qualifications.detail = (recordId, auth) => {
    const payload = scopedPartnerPayload(getQualifications(), "qualifications", auth);
    const item = (payload.qualifications || []).find((candidate) => String(candidate.id) === String(recordId));
    if (!item) return null;
    const expiry = item.expiryDate ? Date.parse(item.expiryDate) : 0;
    const daysToExpiry = expiry ? Math.ceil((expiry - Date.now()) / 86_400_000) : null;
    return {
      id: item.id,
      sku: item.sku,
      productName: item.productName,
      qualificationName: item.qualificationName,
      qualificationCategory: item.qualificationCategory,
      market: item.market,
      issuer: item.issuer || "",
      effectiveDate: item.effectiveDate || "",
      expiryDate: item.expiryDate || "",
      expiryStatus: daysToExpiry === null ? "undated" : daysToExpiry < 0 ? "expired" : daysToExpiry <= 90 ? "expiring" : "valid",
      daysToExpiry,
      remark: item.remark || "",
      files: (Array.isArray(item.files) ? item.files : []).map((file) => ({ id: file.id || file.url || "", name: file.name || "资质附件", url: file.url || "" })).filter((file) => file.url),
    };
  };

  stockupRisks.detail = (recordId, auth) => {
    const item = (getStockupPayload().recommendations || []).find((candidate) => String(candidate.id) === String(recordId));
    if (!item) return null;
    const { bySku } = productIndex(auth);
    return withProductImage({
      ...Object.fromEntries(Object.entries(item).filter(([key]) => key !== "raw")),
      id: item.id,
      availableQty: number(item.availableQty),
      inTransitQty: number(item.inTransitQty),
      sales30: number(item.sales30),
      replenishQty: number(item.replenishQty),
      outsourcingInProductionQty: number(item.outsourcingInProductionQty),
      netReplenishQty: number(item.netReplenishQty),
    }, bySku);
  };

  containerLoading.detail = (recordId, auth) => {
    const result = containerLoadingService.getPlan(recordId, containerContext(auth));
    const plan = result.plan;
    if (!plan) return null;
    const selected = (plan.candidates || []).find((candidate) => candidate.strategy === plan.selectedStrategy) || plan.candidates?.[0] || {};
    return {
      id: plan.id,
      planNo: plan.planNo,
      name: plan.name,
      sourceType: plan.sourceType,
      sourceShipmentId: plan.sourceShipmentId,
      sourceShipmentNo: plan.sourceShipmentNo,
      destinationWarehouseId: plan.destinationWarehouseId,
      destinationWarehouseName: plan.destinationWarehouseName,
      containerType: plan.containerType,
      status: plan.status,
      selectedStrategy: plan.selectedStrategy,
      version: plan.version,
      confirmedAt: plan.confirmedAt,
      confirmedBy: plan.confirmedBy,
      createdByName: plan.createdByName,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      container: plan.container || {},
      items: (plan.items || []).map(mobileLoadingItem),
      candidate: mobileLoadingCandidate({ ...selected, strategy: selected.strategy || plan.selectedStrategy }, 600),
      versions: (result.versions || []).slice(0, 10),
    };
  };

  const providers = { domesticInventory, products, qualifications, stockupRisks, containerLoading };
  providers.resolveImage = (key) => {
    const source = getProducts();
    for (const product of [...(source.productBase || []), ...(source.catalog || [])]) {
      for (const url of [product.imageUrl, product.qualificationImageUrl]) if (url && imageKeyFor(url) === key) return String(url);
    }
    return "";
  };
  return providers;
}

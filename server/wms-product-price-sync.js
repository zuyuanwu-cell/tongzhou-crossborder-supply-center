import { randomUUID } from "node:crypto";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 30;
const MAX_EXECUTIONS = 200;
const MAX_HISTORY = 500;

function text(value) {
  return String(value ?? "").trim();
}

function skuKey(value) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function countryKey(value) {
  const source = text(value).toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = new Map([
    ["印尼", "indonesia"], ["印度尼西亚", "indonesia"], ["indonesia", "indonesia"], ["id", "indonesia"],
    ["马来", "malaysia"], ["马来西亚", "malaysia"], ["malaysia", "malaysia"], ["my", "malaysia"],
    ["越南", "vietnam"], ["vietnam", "vietnam"], ["vn", "vietnam"],
    ["俄罗斯", "russia"], ["俄罗斯联邦", "russia"], ["russia", "russia"], ["ru", "russia"],
  ]);
  return aliases.get(source) || source;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function connectionEnabled(connection) {
  return !/(停用|禁用|disabled|inactive)/i.test(text(connection?.status));
}

function capabilityForConnection(connection, capabilityFor) {
  const capability = capabilityFor(connection);
  if (connectionEnabled(connection)) return capability;
  return {
    ...capability,
    configured: false,
    message: "该仓库已停用，不能同步价格。",
  };
}

function moneyEqual(left, right) {
  return Math.abs(numberOrZero(left) - numberOrZero(right)) < 0.000001;
}

function sourcePrice(product) {
  const price = numberOrZero(product?.directCostPrice ?? product?.directPrice);
  const currency = text(product?.directCostCurrency || product?.directCurrency).toUpperCase();
  return { price, currency };
}

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    updatedAt: text(source.updatedAt),
    previews: source.previews && typeof source.previews === "object" ? source.previews : {},
    executions: source.executions && typeof source.executions === "object" ? source.executions : {},
    history: Array.isArray(source.history) ? source.history : [],
  };
}

function summaryFromRows(rows) {
  const counts = {
    total: rows.length,
    pending: 0,
    unchanged: 0,
    missing_price: 0,
    unmatched: 0,
    conflict: 0,
    succeeded: 0,
    failed: 0,
  };
  for (const row of rows) {
    if (Object.hasOwn(counts, row.status)) counts[row.status] += 1;
  }
  return counts;
}

function problem(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function trimObjectMap(input, limit, timestampField) {
  return Object.fromEntries(
    Object.entries(input || {})
      .sort(([, left], [, right]) => text(right?.[timestampField]).localeCompare(text(left?.[timestampField])))
      .slice(0, limit),
  );
}

export function createWmsProductPriceSyncService({
  cachePath,
  loadJsonCache,
  saveJsonCache,
  listConnections,
  listProducts,
  capabilityFor,
  fetchWarehouseCatalog,
  updatePurchasePrice,
  now = () => new Date(),
  createId = () => randomUUID(),
} = {}) {
  if (!cachePath || !loadJsonCache || !saveJsonCache || !listConnections || !listProducts || !capabilityFor || !fetchWarehouseCatalog || !updatePurchasePrice) {
    throw new Error("WMS 价格同步服务缺少初始化依赖。");
  }
  let store = normalizeStore(loadJsonCache(cachePath));

  function persist() {
    store.updatedAt = now().toISOString();
    store.previews = trimObjectMap(store.previews, MAX_PREVIEWS, "createdAt");
    store.executions = trimObjectMap(store.executions, MAX_EXECUTIONS, "createdAt");
    store.history = store.history.slice(0, MAX_HISTORY);
    saveJsonCache(cachePath, store);
  }

  function options() {
    return {
      ok: true,
      mapping: {
        sourceField: "直营供货价",
        targetField: "WMS 采购价",
      protectedFields: ["申报价值", "库存", "重量", "尺寸", "箱规", "商品图片"],
      },
      warehouses: listConnections().map((connection) => {
        const capability = capabilityForConnection(connection, capabilityFor);
        return {
          id: connection.id,
          name: connection.name,
          country: connection.country,
          providerId: connection.providerId,
          status: connection.status,
          capability,
        };
      }),
    };
  }

  async function preview({ warehouseIds, actorId, allowedWarehouseIds, allowedSkus, allowedCountries }) {
    const requestedIds = [...new Set((Array.isArray(warehouseIds) ? warehouseIds : []).map(text).filter(Boolean))];
    if (!requestedIds.length) throw problem(400, "warehouse_required", "请至少选择一个仓库。");
    const connectionById = new Map(listConnections().map((connection) => [connection.id, connection]));
    const selected = requestedIds.map((id) => connectionById.get(id)).filter(Boolean);
    if (selected.length !== requestedIds.length) throw problem(404, "warehouse_not_found", "部分仓库不存在或已停用，请刷新后重试。");
    const warehouseScope = new Set((Array.isArray(allowedWarehouseIds) ? allowedWarehouseIds : []).map(text).filter(Boolean));
    if (warehouseScope.size && selected.some((connection) => !warehouseScope.has(connection.id))) {
      throw problem(403, "warehouse_scope_forbidden", "所选仓库超出当前账号的数据范围。");
    }

    const allProducts = listProducts();
    const skuScope = new Set((Array.isArray(allowedSkus) ? allowedSkus : []).map(skuKey).filter(Boolean));
    const countryScope = new Set((Array.isArray(allowedCountries) ? allowedCountries : []).map(countryKey).filter(Boolean));
    const products = (Array.isArray(allProducts) ? allProducts : []).filter((product) => (
      (!skuScope.size || skuScope.has(skuKey(product.sku)))
      && (!countryScope.size || countryScope.has(countryKey(product.country)))
    ));
    const rows = [];
    const warehouseSummaries = [];
    for (const connection of selected) {
      const capability = capabilityForConnection(connection, capabilityFor);
      if (!capability.supported || !capability.configured) {
        warehouseSummaries.push({
          warehouseId: connection.id,
          warehouseName: connection.name,
          country: connection.country,
          providerId: connection.providerId,
          status: "unsupported",
          message: capability.message,
          counts: summaryFromRows([]),
        });
        continue;
      }

      let catalogResult;
      try {
        catalogResult = await fetchWarehouseCatalog(connection);
      } catch (error) {
        warehouseSummaries.push({
          warehouseId: connection.id,
          warehouseName: connection.name,
          country: connection.country,
          providerId: connection.providerId,
          status: "error",
          message: error?.message || "读取 WMS 商品失败。",
          counts: summaryFromRows([]),
        });
        continue;
      }
      if (!catalogResult?.ok) {
        warehouseSummaries.push({
          warehouseId: connection.id,
          warehouseName: connection.name,
          country: connection.country,
          providerId: connection.providerId,
          status: "error",
          message: catalogResult?.message || "读取 WMS 商品失败。",
          counts: summaryFromRows([]),
        });
        continue;
      }

      const localBySku = new Map();
      for (const product of products.filter((item) => countryKey(item.country) === countryKey(connection.country))) {
        const key = skuKey(product.sku);
        if (!key) continue;
        const existing = localBySku.get(key) || [];
        existing.push(product);
        localBySku.set(key, existing);
      }
      const wmsBySku = new Map();
      for (const product of catalogResult.products || []) {
        const key = skuKey(product.sku);
        if (!key) continue;
        const existing = wmsBySku.get(key) || [];
        existing.push(product);
        wmsBySku.set(key, existing);
      }

      const warehouseRows = [];
      for (const [sku, localMatches] of localBySku.entries()) {
        const prices = localMatches.map(sourcePrice);
        const uniquePrices = new Set(prices.map(({ price, currency }) => `${price}|${currency}`));
        const product = localMatches[0];
        const price = prices[0];
        const wmsMatches = wmsBySku.get(sku) || [];
        let status = "pending";
        let reason = "直营供货价与 WMS 采购价不同。";
        if (uniquePrices.size > 1) {
          status = "conflict";
          reason = "同一国家和 SKU 存在多个直营供货价，请先整理产品库。";
        } else if (!(price.price > 0) || !/^[A-Z]{3}$/.test(price.currency)) {
          status = "missing_price";
          reason = !(price.price > 0) ? "产品库未维护有效直营供货价。" : "产品库价格币种不是 3 位币种代码。";
        } else if (wmsMatches.length !== 1 || !wmsMatches[0]?.goodsSkuId) {
          status = "unmatched";
          reason = wmsMatches.length > 1 ? "WMS 存在重复 SKU，不能自动选择。" : "WMS 未找到唯一且可写的同 SKU 商品。";
        } else {
          const wmsProduct = wmsMatches[0];
          const targetCurrency = text(wmsProduct.purchasePriceCurrency).toUpperCase();
          if (moneyEqual(price.price, wmsProduct.purchasePrice) && price.currency === targetCurrency) {
            status = "unchanged";
            reason = "价格和币种已一致。";
          }
        }
        const wmsProduct = wmsMatches.length === 1 ? wmsMatches[0] : null;
        warehouseRows.push({
          id: `${connection.id}:${sku}`,
          warehouseId: connection.id,
          warehouseName: connection.name,
          country: connection.country,
          providerId: connection.providerId,
          sku,
          productName: text(product.name || wmsProduct?.name || sku),
          goodsSkuId: text(wmsProduct?.goodsSkuId),
          sourcePrice: price.price,
          sourceCurrency: price.currency,
          currentPrice: numberOrZero(wmsProduct?.purchasePrice),
          currentCurrency: text(wmsProduct?.purchasePriceCurrency).toUpperCase(),
          status,
          reason,
        });
      }
      rows.push(...warehouseRows);
      warehouseSummaries.push({
        warehouseId: connection.id,
        warehouseName: connection.name,
        country: connection.country,
        providerId: connection.providerId,
        status: "ready",
        message: "已读取 WMS 商品并完成精确 SKU 比对。",
        counts: summaryFromRows(warehouseRows),
      });
    }

    const createdAt = now();
    const token = createId();
    const result = {
      ok: true,
      previewToken: token,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PREVIEW_TTL_MS).toISOString(),
      warehouseIds: requestedIds,
      scope: {
        warehouseIds: [...warehouseScope],
        skus: [...skuScope],
        countries: [...countryScope],
      },
      warehouseSummaries,
      rows,
      summary: summaryFromRows(rows),
    };
    store.previews[token] = { ...result, actorId: text(actorId), executedAt: "" };
    persist();
    return result;
  }

  async function execute({ previewToken, idempotencyKey, actorId, allowedWarehouseIds }) {
    const token = text(previewToken);
    const key = text(idempotencyKey);
    const actor = text(actorId);
    if (!token) throw problem(400, "preview_required", "缺少价格同步预览，请重新生成预览。");
    if (!key) throw problem(400, "idempotency_key_required", "同步价格必须提供 Idempotency-Key。");
    const replayKey = `${actor}:${key}`;
    if (store.executions[replayKey]) return { ...store.executions[replayKey].result, idempotentReplay: true };
    const saved = store.previews[token];
    if (!saved) throw problem(404, "preview_not_found", "价格同步预览不存在，请重新生成。");
    if (saved.actorId && saved.actorId !== actor) throw problem(403, "preview_owner_mismatch", "不能执行其他用户创建的价格同步预览。");
    if (new Date(saved.expiresAt).getTime() <= now().getTime()) throw problem(409, "preview_expired", "价格同步预览已过期，请重新读取 WMS 价格。");
    const warehouseScope = new Set((Array.isArray(allowedWarehouseIds) ? allowedWarehouseIds : []).map(text).filter(Boolean));
    if (warehouseScope.size && saved.warehouseIds.some((warehouseId) => !warehouseScope.has(warehouseId))) {
      throw problem(403, "warehouse_scope_forbidden", "仓库授权范围已变化，请重新生成预览。");
    }

    const connectionById = new Map(listConnections().map((connection) => [connection.id, connection]));
    const rows = [];
    for (const row of saved.rows.filter((item) => item.status === "pending")) {
      const connection = connectionById.get(row.warehouseId);
      if (!connection || !connectionEnabled(connection)) {
        rows.push({ ...row, status: "failed", reason: "仓库配置已删除或停用。" });
        continue;
      }
      const capability = capabilityForConnection(connection, capabilityFor);
      if (!capability.supported || !capability.configured) {
        rows.push({ ...row, status: "failed", reason: capability.message || "仓库价格写入能力已失效。" });
        continue;
      }
      try {
        await updatePurchasePrice(connection, {
          goodsSkuId: row.goodsSkuId,
          sku: row.sku,
          productName: row.productName,
          purchasePrice: row.sourcePrice,
          purchasePriceCurrency: row.sourceCurrency,
        });
        rows.push({ ...row, status: "succeeded", reason: "WMS 已接受采购价更新。" });
      } catch (error) {
        rows.push({ ...row, status: "failed", reason: error?.message || "WMS 采购价更新失败。" });
      }
    }

    const createdAt = now().toISOString();
    const result = {
      ok: rows.every((row) => row.status === "succeeded"),
      executionId: createId(),
      previewToken: token,
      createdAt,
      rows,
      summary: summaryFromRows(rows),
      idempotentReplay: false,
    };
    store.executions[replayKey] = { createdAt, result };
    saved.executedAt = createdAt;
    store.history.unshift({
      executionId: result.executionId,
      actorId: actor,
      createdAt,
      warehouseIds: saved.warehouseIds,
      summary: result.summary,
    });
    persist();
    return result;
  }

  return { options, preview, execute };
}

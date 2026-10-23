const INVALID_SHOP_PATTERN = /已解绑|不存在店铺|店铺[^，。]*不存在|shop[^，。]*(?:unbind|not\s*exist|invalid)/i;
const SHOP_SCOPE_ERROR_PATTERN = /越权操作|无权操作|无权限[^，。]*店铺/i;
const NO_DATA_PATTERN = /没有符合条件的数据|没有匹配的数据|未查询到数据|no\s+(?:matching\s+)?data|no\s+records?\s+found/i;

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function uniqueShopIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function isMiaoshouInvalidShopError(error) {
  return INVALID_SHOP_PATTERN.test(`${text(error?.code)} ${text(error?.message)}`);
}

export function isMiaoshouShopScopeError(error) {
  return SHOP_SCOPE_ERROR_PATTERN.test(`${text(error?.code)} ${text(error?.message)}`);
}

export function isMiaoshouNoDataError(error) {
  return NO_DATA_PATTERN.test(`${text(error?.code)} ${text(error?.message)}`);
}

export async function queryMiaoshouShopBatches({
  shopIds = [],
  batchSize = 100,
  request,
  onInvalidShop,
} = {}) {
  if (typeof request !== "function") throw new Error("妙手店铺查询缺少 request 回调");
  const normalizedShopIds = uniqueShopIds(shopIds);
  const safeBatchSize = Math.max(1, Math.min(100, Math.floor(Number(batchSize) || 100)));
  const results = [];
  const invalidCandidates = [];

  async function queryBatch(batch) {
    if (!batch.length) return;
    try {
      const value = await request(batch);
      results.push({ shopIds: batch, value });
    } catch (error) {
      if (isMiaoshouNoDataError(error)) {
        results.push({ shopIds: batch, value: null, noData: true });
        return;
      }
      const explicitInvalidShop = isMiaoshouInvalidShopError(error);
      const genericScopeError = isMiaoshouShopScopeError(error);
      if (!explicitInvalidShop && !genericScopeError) throw error;
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await queryBatch(batch.slice(0, middle));
        await queryBatch(batch.slice(middle));
        return;
      }
      invalidCandidates.push({
        shopId: batch[0],
        reason: text(error?.message) || "店铺已解绑、不存在或不在当前授权范围",
        genericScopeError,
      });
    }
  }

  for (const batch of chunks(normalizedShopIds, safeBatchSize)) await queryBatch(batch);
  if (
    normalizedShopIds.length
    && invalidCandidates.length === normalizedShopIds.length
    && invalidCandidates.every((candidate) => candidate.genericScopeError)
  ) {
    throw new Error("妙手接口对全部店铺返回“越权操作”，请检查开放平台订单权限；本次未停用任何店铺。");
  }
  const invalidShops = invalidCandidates.map(({ genericScopeError: _genericScopeError, ...candidate }) => candidate);
  for (const invalidShop of invalidShops) await onInvalidShop?.(invalidShop);
  return { results, invalidShops };
}

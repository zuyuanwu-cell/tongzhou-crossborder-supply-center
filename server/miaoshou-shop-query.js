const INVALID_SHOP_PATTERN = /已解绑|不存在店铺|店铺[^，。]*不存在|shop[^，。]*(?:unbind|not\s*exist|invalid)/i;
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
  const invalidShops = [];

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
      if (!isMiaoshouInvalidShopError(error)) throw error;
      if (batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await queryBatch(batch.slice(0, middle));
        await queryBatch(batch.slice(middle));
        return;
      }
      const invalidShop = { shopId: batch[0], reason: text(error?.message) || "店铺已解绑或不存在" };
      invalidShops.push(invalidShop);
      await onInvalidShop?.(invalidShop);
    }
  }

  for (const batch of chunks(normalizedShopIds, safeBatchSize)) await queryBatch(batch);
  return { results, invalidShops };
}

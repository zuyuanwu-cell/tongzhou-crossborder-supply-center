const DEFAULT_PROVIDER_ENDPOINT = "https://api.frankfurter.dev/v2/rates";
const DEFAULT_PROVIDER_PAGE = "https://frankfurter.dev/";

function text(value) {
  return String(value ?? "").trim();
}

function dateKey(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
}

function addUtcDays(dateValue, days) {
  const base = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function roundRate(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e12) / 1e12;
}

export function normalizeExchangeRateCurrencies(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value).toUpperCase())
    .filter((value) => /^[A-Z]{3}$/.test(value) && !["CNY", "RMB"].includes(value))))
    .sort()
    .slice(0, 50);
}

export function buildFrankfurterRatesUrl({ endpoint = DEFAULT_PROVIDER_ENDPOINT, dateFrom, dateTo, currencies = [] } = {}) {
  const url = new URL(endpoint);
  url.searchParams.set("base", "CNY");
  url.searchParams.set("quotes", normalizeExchangeRateCurrencies(currencies).join(","));
  if (dateKey(dateFrom)) url.searchParams.set("from", dateKey(dateFrom));
  if (dateKey(dateTo)) url.searchParams.set("to", dateKey(dateTo));
  return url.toString();
}

export function parseFrankfurterRates(payload, requestedCurrencies = []) {
  const requested = new Set(normalizeExchangeRateCurrencies(requestedCurrencies));
  const rows = Array.isArray(payload) ? payload : [];
  const rates = [];
  for (const row of rows) {
    const base = text(row?.base).toUpperCase();
    const currency = text(row?.quote).toUpperCase();
    const effectiveDate = dateKey(row?.date);
    const quotePerCny = Number(row?.rate);
    if (base !== "CNY" || !requested.has(currency) || !effectiveDate || !Number.isFinite(quotePerCny) || quotePerCny <= 0) continue;
    rates.push({
      currency,
      effectiveDate,
      rateToCny: roundRate(1 / quotePerCny),
      source: "auto:frankfurter",
    });
  }
  const deduplicated = new Map(rates.map((rate) => [`${rate.currency}|${rate.effectiveDate}`, rate]));
  return [...deduplicated.values()].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.currency.localeCompare(b.currency));
}

export async function fetchFrankfurterRates({
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_PROVIDER_ENDPOINT,
  dateFrom,
  dateTo,
  currencies = [],
  timeoutMs = 15_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持汇率网络请求。");
  const normalizedCurrencies = normalizeExchangeRateCurrencies(currencies);
  if (!normalizedCurrencies.length) return { rates: [], requestUrl: "", missingCurrencies: [] };
  const requestUrl = buildFrankfurterRatesUrl({ endpoint, dateFrom, dateTo, currencies: normalizedCurrencies });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs) || 15_000));
  try {
    const response = await fetchImpl(requestUrl, {
      headers: { Accept: "application/json", "User-Agent": "Tongzhou-Supply-Center/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`汇率服务返回 HTTP ${response.status}`);
    const contentLength = Number(response.headers?.get?.("content-length") || 0);
    if (contentLength > 5 * 1024 * 1024) throw new Error("汇率服务响应过大，已拒绝处理。");
    const payload = await response.json();
    const rates = parseFrankfurterRates(payload, normalizedCurrencies);
    if (!rates.length) throw new Error("汇率服务没有返回可用数据。");
    const returnedCurrencies = new Set(rates.map((rate) => rate.currency));
    return {
      rates,
      requestUrl,
      missingCurrencies: normalizedCurrencies.filter((currency) => !returnedCurrencies.has(currency)),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("汇率服务请求超时。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createExchangeRateSyncService({
  store,
  fetchImpl = globalThis.fetch,
  enabled = true,
  endpoint = DEFAULT_PROVIDER_ENDPOINT,
  intervalMs = 24 * 60 * 60 * 1000,
  backfillDays = 120,
  timeoutMs = 15_000,
  configuredCurrencies = [],
  now = () => new Date(),
} = {}) {
  if (!store) throw new Error("初始化自动汇率同步缺少存储实例。");
  let running = false;

  function status() {
    const stored = store.getExchangeRateSyncState?.() || {};
    const lastSuccessTime = Date.parse(stored.lastSuccessAt || "");
    const nextSyncAt = Number.isFinite(lastSuccessTime)
      ? new Date(lastSuccessTime + Math.max(60 * 60 * 1000, Number(intervalMs) || 24 * 60 * 60 * 1000)).toISOString()
      : "";
    return {
      enabled: Boolean(enabled),
      running,
      provider: "Frankfurter",
      providerUrl: DEFAULT_PROVIDER_PAGE,
      intervalHours: Math.round(Math.max(60 * 60 * 1000, Number(intervalMs) || 24 * 60 * 60 * 1000) / 3_600_000),
      backfillDays: Math.max(7, Number(backfillDays) || 120),
      lastAttemptAt: text(stored.lastAttemptAt),
      lastSuccessAt: text(stored.lastSuccessAt),
      lastRateDate: text(stored.lastRateDate),
      lastError: text(stored.lastError),
      lastReason: text(stored.lastReason),
      lastUpdatedCount: Number(stored.lastUpdatedCount) || 0,
      currencies: normalizeExchangeRateCurrencies(stored.currencies || []),
      missingCurrencies: normalizeExchangeRateCurrencies(stored.missingCurrencies || []),
      nextSyncAt,
    };
  }

  async function run({ force = false, reason = "scheduled" } = {}) {
    if (!enabled) return { ...status(), skipped: true, message: "自动汇率同步已关闭。" };
    if (running) return { ...status(), skipped: true, message: "汇率同步正在进行中。" };
    const current = status();
    const currentTime = now();
    const lastSuccessTime = Date.parse(current.lastSuccessAt || "");
    const minimumInterval = Math.max(60 * 60 * 1000, Number(intervalMs) || 24 * 60 * 60 * 1000);
    if (!force && Number.isFinite(lastSuccessTime) && currentTime.getTime() - lastSuccessTime < minimumInterval) {
      return { ...current, skipped: true, message: "当前汇率仍在有效同步周期内。" };
    }
    const currencies = normalizeExchangeRateCurrencies([
      ...(store.listSalesCurrencies?.() || []),
      ...configuredCurrencies,
    ]);
    if (!currencies.length) return { ...current, skipped: true, message: "当前订单没有需要折算的外币。" };

    running = true;
    const lastRateDate = dateKey(current.lastRateDate);
    const dateTo = currentTime.toISOString().slice(0, 10);
    const dateFrom = lastRateDate ? addUtcDays(lastRateDate, -7) : addUtcDays(currentTime, -Math.max(7, Number(backfillDays) || 120));
    const attemptAt = currentTime.toISOString();
    try {
      const result = await fetchFrankfurterRates({ fetchImpl, endpoint, dateFrom, dateTo, currencies, timeoutMs });
      store.upsertExchangeRates(result.rates, "auto:frankfurter", { preserveOverrides: true });
      const latestRateDate = result.rates.reduce((latest, rate) => rate.effectiveDate > latest ? rate.effectiveDate : latest, lastRateDate || "");
      const nextState = {
        lastAttemptAt: attemptAt,
        lastSuccessAt: now().toISOString(),
        lastRateDate: latestRateDate,
        lastError: result.missingCurrencies.length ? `未返回币种：${result.missingCurrencies.join("、")}` : "",
        lastReason: text(reason),
        lastUpdatedCount: result.rates.length,
        currencies,
        missingCurrencies: result.missingCurrencies,
      };
      store.setExchangeRateSyncState?.(nextState);
      running = false;
      return { ...status(), skipped: false, message: result.missingCurrencies.length ? "汇率已部分同步。" : "汇率同步成功。" };
    } catch (error) {
      store.setExchangeRateSyncState?.({
        ...store.getExchangeRateSyncState?.(),
        lastAttemptAt: attemptAt,
        lastError: error instanceof Error ? error.message : String(error),
        lastReason: text(reason),
        currencies,
      });
      throw error;
    } finally {
      running = false;
    }
  }

  return { run, status };
}

export { DEFAULT_PROVIDER_ENDPOINT };

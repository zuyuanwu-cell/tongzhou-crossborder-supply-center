import assert from "node:assert/strict";
import {
  buildFrankfurterRatesUrl,
  createExchangeRateSyncService,
  normalizeExchangeRateCurrencies,
  parseFrankfurterRates,
} from "../server/exchange-rate-sync.js";

assert.deepEqual(normalizeExchangeRateCurrencies(["idr", "CNY", "MYR", "idr", "RMB", "bad-code", "VND"]), ["IDR", "MYR", "VND"]);

const parsed = parseFrankfurterRates([
  { date: "2026-08-28", base: "CNY", quote: "IDR", rate: 2500 },
  { date: "2026-08-28", base: "CNY", quote: "MYR", rate: 0.625 },
  { date: "2026-08-28", base: "USD", quote: "VND", rate: 26000 },
], ["IDR", "MYR", "VND"]);
assert.equal(parsed.length, 2);
assert.equal(parsed.find((row) => row.currency === "IDR")?.rateToCny, 0.0004);
assert.equal(parsed.find((row) => row.currency === "MYR")?.rateToCny, 1.6);

const requestUrl = new URL(buildFrankfurterRatesUrl({
  dateFrom: "2026-05-01",
  dateTo: "2026-08-28",
  currencies: ["IDR", "MYR", "VND"],
}));
assert.equal(requestUrl.searchParams.get("base"), "CNY");
assert.equal(requestUrl.searchParams.get("quotes"), "IDR,MYR,VND");
assert.equal(requestUrl.searchParams.get("from"), "2026-05-01");

let storedState = {};
let storedRates = [];
let capturedUrl = "";
const fakeStore = {
  listSalesCurrencies: () => ["CNY", "IDR", "MYR", "VND"],
  getExchangeRateSyncState: () => storedState,
  setExchangeRateSyncState: (state) => { storedState = structuredClone(state); },
  upsertExchangeRates: (rates) => { storedRates.push(...rates); },
};
const fetchImpl = async (url) => {
  capturedUrl = String(url);
  return {
    ok: true,
    headers: { get: () => null },
    json: async () => [
      { date: "2026-08-28", base: "CNY", quote: "IDR", rate: 2500 },
      { date: "2026-08-28", base: "CNY", quote: "MYR", rate: 0.625 },
      { date: "2026-08-28", base: "CNY", quote: "VND", rate: 4000 },
    ],
  };
};
const fixedNow = new Date("2026-08-28T01:00:00.000Z");
const service = createExchangeRateSyncService({
  store: fakeStore,
  fetchImpl,
  intervalMs: 24 * 60 * 60 * 1000,
  backfillDays: 120,
  now: () => fixedNow,
});
const firstRun = await service.run({ reason: "test" });
assert.equal(firstRun.skipped, false);
assert.equal(firstRun.running, false);
assert.equal(firstRun.lastRateDate, "2026-08-28");
assert.equal(storedRates.length, 3);
assert.equal(new URL(capturedUrl).searchParams.get("from"), "2026-04-30");
const secondRun = await service.run({ reason: "test" });
assert.equal(secondRun.skipped, true, "a fresh successful sync should not call the provider again");

const previousRates = structuredClone(storedRates);
const failingService = createExchangeRateSyncService({
  store: fakeStore,
  fetchImpl: async () => { throw new Error("provider unavailable"); },
  now: () => new Date("2026-08-30T02:00:00.000Z"),
});
await assert.rejects(() => failingService.run({ force: true, reason: "failure-test" }), /provider unavailable/);
assert.deepEqual(storedRates, previousRates, "provider failure must retain the previous valid rates");
assert.match(storedState.lastError, /provider unavailable/);

console.log("exchange rate sync tests passed");

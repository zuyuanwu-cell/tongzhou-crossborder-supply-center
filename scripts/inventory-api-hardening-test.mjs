import assert from "node:assert/strict";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { corsHeaders, encodeJsonResponse } from "../server/http-response.js";

const payload = { ok: true, rows: Array.from({ length: 500 }, (_, index) => ({ index, value: `row-${index}` })) };
const gzip = encodeJsonResponse(payload, "gzip");
assert.equal(gzip.encoding, "gzip");
assert.deepEqual(JSON.parse(gunzipSync(gzip.body)), payload);
const brotli = encodeJsonResponse(payload, "br, gzip");
assert.equal(brotli.encoding, "br");
assert.deepEqual(JSON.parse(brotliDecompressSync(brotli.body)), payload);
assert.equal(encodeJsonResponse({ ok: true }, "gzip").encoding, "");
assert.equal(corsHeaders()["Access-Control-Allow-Origin"], "https://gyl.tongzhoukuajing.com");
assert.notEqual(corsHeaders()["Access-Control-Allow-Origin"], "*");

const serverSource = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
const compareRoute = serverSource.match(/url\.pathname === "\/api\/movement-history\/compare"[\s\S]{0,500}?sendJson\(res, (\d+)/);
assert.equal(compareRoute?.[1], "403", "permission denial uses 403 instead of an authentication-looking 401");
assert.equal(/"Access-Control-Allow-Origin": "\*"/.test(serverSource), false, "authenticated exports never advertise wildcard CORS");
assert.equal(serverSource.includes("minutes < 23 * 60 + 50"), true, "daily inventory snapshot runs in the end-of-day window");
assert.equal(serverSource.includes('refreshWarehouseInventoryForSnapshot("daily_eod", date)'), true, "end-of-day snapshot preserves its business date");
assert.match(
  serverSource,
  /const snapshotBoundaryDates = \[[\s\S]{0,500}?\.map\(\(to\) => movementHistoryStore\.getLatestSnapshot\(\{ to, timezone \}, \{ includeRows: true \}\)\)/,
  "overseas reconciliation loads only the four period-boundary snapshots",
);
assert.equal(
  serverSource.includes("movementHistoryStore.getSnapshots({\n    from: addBusinessDays(ranges.previous.from, -1)"),
  false,
  "overseas reconciliation does not scan every snapshot in the full comparison window",
);
assert.equal(
  serverSource.includes("if (!result.succeeded && result.failed) throw new Error"),
  true,
  "partial WMS return refreshes keep the normal schedule while total failures trigger retry",
);
assert.equal(
  serverSource.includes("if (result.retryableFailed) throw new Error"),
  true,
  "transient WMS return failures retry while permanent missing warehouse-code configuration stays on the normal schedule",
);
assert.match(
  serverSource,
  /const dailyLedgerCoversComparison = allowedWarehouseIds\.size > 0[\s\S]{0,350}?const dailyLedgerRows = dailyLedgerCoversComparison \? inventoryLedgerStore\.listDailyLedger/,
  "incomplete ledger coverage is detected before materializing a large comparison window",
);
assert.match(
  serverSource,
  /const outboundOrders = \(cachedOrdersSync\.orders \|\| \[\]\)\.filter/,
  "overseas reconciliation reuses the decoded order snapshot instead of reparsing the sql.js payload table",
);
assert.equal(serverSource.includes("function warehouseReturnProductIndex()"), true);
assert.equal(
  serverSource.includes("const productIndex = warehouseReturnProductIndex();"),
  true,
  "return-product enrichment builds one lookup index per payload instead of rescanning the full catalog for every item",
);

console.log("inventory API hardening tests passed");

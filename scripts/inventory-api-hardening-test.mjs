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

console.log("inventory API hardening tests passed");

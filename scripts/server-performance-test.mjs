// 性能改造（第一步）的单元测试：异步压缩、接口耗时记录、sql.js 合并写盘、动销历史瘦身。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { encodeJsonResponse, encodeJsonResponseAsync } from "../server/http-response.js";
import { createRequestTiming, routeKey } from "../server/request-timing.js";
import { createPersistScheduler, flushAllPersistSchedulers, persistSchedulerStatus, setPersistBlockReporter } from "../server/sqljs-persist-scheduler.js";
import { initMovementHistoryStore } from "../server/movement-history-db.js";

const silent = { warn() {}, error() {}, log() {} };

// 1. 压缩：小包同步，大包异步；br / gzip 均可还原。
{
  const small = encodeJsonResponse({ ok: true }, "br");
  assert.equal(small.encoding, "");
  const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ i, name: `店铺-${i % 37}`, amount: i * 1.5 })) };
  const raw = JSON.stringify(big);
  for (const acceptEncoding of ["br", "gzip", ""]) {
    const result = await new Promise((resolve, reject) => encodeJsonResponseAsync(big, acceptEncoding, (error, value) => (error ? reject(error) : resolve(value))));
    assert.equal(result.rawBytes, Buffer.byteLength(raw));
    const decoded = result.encoding === "br" ? zlib.brotliDecompressSync(result.body) : result.encoding === "gzip" ? zlib.gunzipSync(result.body) : Buffer.from(result.body);
    assert.equal(decoded.toString("utf8"), raw);
    if (acceptEncoding) assert.ok(result.body.length < raw.length / 3, `${acceptEncoding} 应明显压缩`);
  }
  const circular = {};
  circular.self = circular;
  let stringifyError = null;
  encodeJsonResponseAsync(circular, "br", (error) => { stringifyError = error; });
  assert.ok(stringifyError instanceof TypeError, "无法序列化时同步回调错误");
}

// 2. 接口耗时：ID 归并、Server-Timing、慢请求、阻塞记录。
{
  assert.equal(routeKey("get", "/api/collector/nodes/0123456789abcdef0123/runs"), "GET /api/collector/nodes/:id/runs");
  assert.equal(routeKey("GET", "/api/shop-daily-report"), "GET /api/shop-daily-report");
  let clock = 0;
  const warnings = [];
  const timing = createRequestTiming({ slowMs: 100, logger: { warn: (line) => warnings.push(line) }, now: () => clock });
  const res = new EventEmitter();
  const headers = {};
  res.headersSent = false;
  res.setHeader = (key, value) => { headers[key] = value; };
  res.writeHead = () => res;
  res.write = () => true;
  res.end = () => { res.emit("finish"); };
  res.statusCode = 200;
  timing.begin({ method: "GET" }, res, "/api/shop-daily-report");
  res.timing.mark("context", 40);
  clock = 150;
  res.writeHead(200);
  res.end(Buffer.alloc(2048));
  assert.match(headers["Server-Timing"], /app;dur=150\.0, context;dur=40\.0/);
  const snap = timing.snapshot();
  assert.equal(snap.routes[0].route, "GET /api/shop-daily-report");
  assert.equal(snap.routes[0].p95Ms, 150);
  assert.equal(snap.slow.length, 1);
  assert.ok(warnings.some((line) => line.startsWith("[slow]") && line.includes("context=40ms")));
  timing.recordBlock("persist:test", 50);
  timing.recordBlock("persist:test", 1500);
  assert.equal(timing.snapshot().blocks.length, 1);
  timing.reset();
  assert.equal(timing.snapshot().routes.length, 0);
}

// 3. 合并写盘：多次改动只写一次；flush 立即写；失败会保留待写状态。
{
  let writes = 0;
  const blocks = [];
  setPersistBlockReporter((name, ms) => blocks.push(name));
  const scheduler = createPersistScheduler({ name: "test-db", persistNow: () => { writes += 1; }, delayMs: 60_000, logger: silent });
  scheduler.request();
  scheduler.request();
  scheduler.request();
  assert.equal(writes, 0);
  assert.equal(scheduler.status().pending, true);
  assert.deepEqual(flushAllPersistSchedulers().filter((name) => name === "test-db"), ["test-db"]);
  assert.equal(writes, 1);
  assert.equal(scheduler.status().pending, false);
  scheduler.flush();
  assert.equal(writes, 1, "没有改动时 flush 不写盘");
  assert.ok(blocks.includes("persist:test-db"));

  let fail = true;
  const flaky = createPersistScheduler({ name: "flaky-db", persistNow: () => { if (fail) throw new Error("disk"); }, delayMs: 60_000, logger: silent });
  flaky.request();
  flaky.flush();
  assert.equal(flaky.status().pending, true);
  assert.equal(flaky.status().failures, 1);
  fail = false;
  flaky.flush();
  assert.equal(flaky.status().pending, false);
  assert.ok(persistSchedulerStatus().some((item) => item.name === "flaky-db"));

  const immediate = createPersistScheduler({ name: "immediate-db", persistNow: () => { writes += 1; }, delayMs: 0, logger: silent });
  immediate.request();
  assert.equal(writes, 2, "delayMs=0 时立即写");
  setPersistBlockReporter(null);
}

// 4. 动销历史：版本只存元数据；旧库瘦身后数据仍完整。
{
  const dir = mkdtempSync(path.join(tmpdir(), "perf-test-"));
  try {
    const dbPath = path.join(dir, "movement-history.sqlite");
    const store = await initMovementHistoryStore(dbPath);
    const rows = Array.from({ length: 300 }, (_, i) => ({ sku: `SKU-${i}`, warehouseId: "W1", availableQty: i, sales7d: i % 5 }));
    store.upsertSnapshot({ date: "2026-11-10", timezone: "Asia/Shanghai", capturedAt: "2026-11-10T10:00:00Z", totals: {}, rows });
    store.upsertSnapshot({ date: "2026-11-10", timezone: "Asia/Shanghai", capturedAt: "2026-11-10T12:00:00Z", totals: {}, rows });
    store.flush();
    const versions = store.listVersions({ date: "2026-11-10", timezone: "Asia/Shanghai" });
    assert.ok(versions.length >= 1);
    assert.ok(statSync(dbPath).size > 0);
    const reopened = await initMovementHistoryStore(dbPath);
    const result = reopened.compactVersions({ backup: false });
    assert.ok(result && typeof result === "object");
    const again = reopened.compactVersions({ backup: false });
    assert.ok(again.skipped, "瘦身只做一次");
    reopened.flush();
    const latest = reopened.getLatestSnapshot({ date: "2026-11-10", timezone: "Asia/Shanghai" });
    assert.equal(latest.rows.length, 300, "瘦身后最新快照完整");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("server-performance-test 通过");
// 显式退出。另：Node 22 偶发退出时后台编译线程与 GC 互等卡死（V8 问题，与业务代码无关），npm 脚本用 --single-threaded 规避。
process.exit(0);

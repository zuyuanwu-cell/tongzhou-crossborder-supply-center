import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createShopDailyIngestIdempotency } from "../server/shop-daily-ingest-idempotency.js";

const dir = mkdtempSync(resolve(tmpdir(), "shop-daily-idempotency-"));
const filePath = resolve(dir, "state.json");
let clock = 1_000_000;

try {
  let store = createShopDailyIngestIdempotency({ filePath, now: () => clock, pendingTtlMs: 1_000 });
  assert.equal(store.begin("node:run:0:digest", "body-a").status, "started");
  assert.equal(store.begin("node:run:0:digest", "body-a").status, "pending");
  assert.equal(store.begin("node:run:0:digest", "body-b").status, "conflict");

  store.complete("node:run:0:digest", "body-a", { ok: true, written: 12 });
  const replay = store.begin("node:run:0:digest", "body-a");
  assert.equal(replay.status, "replay");
  assert.equal(replay.result.written, 12);
  assert.equal(replay.result.idempotentReplay, true);

  store = createShopDailyIngestIdempotency({ filePath, now: () => clock, pendingTtlMs: 1_000 });
  assert.equal(store.begin("node:run:0:digest", "body-a").status, "replay", "重启后仍应记住已完成请求");

  assert.equal(store.begin("node:run:1:digest", "body-c").status, "started");
  clock += 1_100;
  assert.equal(store.begin("node:run:1:digest", "body-c").status, "started", "超时的处理中请求允许安全接管");
  store.abort("node:run:1:digest", "body-c");
  assert.equal(store.begin("node:run:1:digest", "body-c").status, "started");

  const disk = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(disk.entries["node:run:0:digest"].status, "completed");
  console.log("SHOP_DAILY_INGEST_IDEMPOTENCY_TEST_OK");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

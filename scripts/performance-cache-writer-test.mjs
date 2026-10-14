import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeGzipJsonArrayAtomic } from "../server/atomic-json-gzip.js";

const directory = await mkdtemp(join(tmpdir(), "tongzhou-performance-cache-"));
try {
  const targetPath = join(directory, "performance-facts.json.gz");
  const rows = Array.from({ length: 2_000 }, (_, index) => ({
    orderId: `ORDER-${index}`,
    sku: `SKU-${index % 25}`,
    quantity: index + 1,
    shopName: index % 2 ? "雅加达店" : "莫斯科店",
  }));
  await writeGzipJsonArrayAtomic(targetPath, { dataVersion: "test-v1", factCount: rows.length }, "facts", rows);

  const parsed = JSON.parse(gunzipSync(await readFile(targetPath)).toString("utf8"));
  assert.equal(parsed.dataVersion, "test-v1");
  assert.equal(parsed.factCount, rows.length);
  assert.equal(parsed.facts.length, rows.length);
  assert.deepEqual(parsed.facts[0], rows[0]);
  assert.deepEqual(parsed.facts.at(-1), rows.at(-1));
  assert.deepEqual(await readdir(directory), ["performance-facts.json.gz"]);
  await assert.rejects(() => writeGzipJsonArrayAtomic(targetPath, null, "facts", rows), /metadata must be an object/);
  await assert.rejects(() => writeGzipJsonArrayAtomic(targetPath, {}, "facts", null), /rows must be an array/);
  console.log("performance cache streaming writer test passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}

import { parentPort, workerData } from "node:worker_threads";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { reconcileMiaoshouPerformance } from "./miaoshou-performance.js";
import { materializePerformanceFacts } from "./performance-analytics.js";
import { initPerformanceAnalyticsStore } from "./performance-analytics-db.js";
import { applyShopDirectoryProfile } from "./shop-directory.js";
import { writeGzipJsonArrayAtomic } from "./atomic-json-gzip.js";

async function run() {
  const startedAt = Date.now();
  const store = await initPerformanceAnalyticsStore(workerData.dbPath);
  let orderSnapshot = null;
  if (workerData.orderCachePath && existsSync(workerData.orderCachePath)) {
    try {
      orderSnapshot = JSON.parse(readFileSync(workerData.orderCachePath, "utf8"));
    } catch {
      orderSnapshot = null;
    }
  }
  let sourceFacts = Array.isArray(orderSnapshot?.orders)
    ? orderSnapshot.orders
    : store.listSalesFacts();
  const sourceSyncedAt = String(orderSnapshot?.syncedAt || workerData.sourceSyncedAt || "");
  let facts = sourceFacts
    .map((fact) => applyShopDirectoryProfile(fact, workerData.shopDirectory || {}));
  const miaoshouSnapshot = store.listMiaoshouPerformance();
  let hybrid = reconcileMiaoshouPerformance({
    facts,
    ...miaoshouSnapshot,
    requestedSource: workerData.requestedSource || "shadow",
    syncState: workerData.syncState || {},
  });
  const materializedFacts = materializePerformanceFacts({
    facts: hybrid.facts,
    products: workerData.products || {},
    exchangeRates: workerData.exchangeRates || [],
    packagingFeeRules: workerData.packagingFeeRules || [],
    supplementalProductCosts: workerData.supplementalProductCosts || [],
  });
  const transactionReconciliation = hybrid.reconciliation;
  orderSnapshot = null;
  sourceFacts = null;
  facts = null;
  hybrid = null;
  const materializedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const metadata = {
    dataVersion: workerData.dataVersion || "",
    materializedAt,
    materializationDurationMs: durationMs,
    shopDirectory: workerData.shopDirectory || {},
    factCount: materializedFacts.length,
    transactionReconciliation,
    transactionSync: workerData.transactionSync || {},
    stale: false,
    targetDataVersion: workerData.dataVersion || "",
    sourceSyncedAt,
  };
  // A materialization job only starts for a new data version, so its result
  // must replace the previous snapshot even when that file was written
  // recently. Otherwise every restart recomputes the same 60k+ rows.
  if (workerData.cachePath) {
    await writeGzipJsonArrayAtomic(workerData.cachePath, metadata, "facts", materializedFacts, { level: 1 });
  }
  if (workerData.metadataPath) {
    const temporaryMetadataPath = `${workerData.metadataPath}.${process.pid}.tmp`;
    writeFileSync(temporaryMetadataPath, JSON.stringify(metadata));
    renameSync(temporaryMetadataPath, workerData.metadataPath);
  }
  parentPort.postMessage({
    ok: true,
    ...metadata,
    ...(workerData.returnFacts === false ? {} : { facts: materializedFacts }),
    reconciliation: transactionReconciliation,
    durationMs,
  });
  store.close?.();
}

run().catch((error) => {
  parentPort.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : "",
  });
});

import { parentPort, workerData } from "node:worker_threads";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { reconcileMiaoshouPerformance } from "./miaoshou-performance.js";
import { materializePerformanceFacts } from "./performance-analytics.js";
import { initPerformanceAnalyticsStore } from "./performance-analytics-db.js";
import { applyShopDirectoryProfile } from "./shop-directory.js";

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
  const sourceFacts = Array.isArray(orderSnapshot?.orders)
    ? orderSnapshot.orders
    : store.listSalesFacts();
  const sourceSyncedAt = String(orderSnapshot?.syncedAt || workerData.sourceSyncedAt || "");
  const facts = sourceFacts
    .map((fact) => applyShopDirectoryProfile(fact, workerData.shopDirectory || {}));
  const miaoshouSnapshot = store.listMiaoshouPerformance();
  const hybrid = reconcileMiaoshouPerformance({
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
  const materializedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const metadata = {
    dataVersion: workerData.dataVersion || "",
    materializedAt,
    materializationDurationMs: durationMs,
    shopDirectory: workerData.shopDirectory || {},
    factCount: materializedFacts.length,
    transactionReconciliation: hybrid.reconciliation,
    transactionSync: workerData.transactionSync || {},
    stale: false,
    targetDataVersion: workerData.dataVersion || "",
    sourceSyncedAt,
  };
  // A materialization job only starts for a new data version, so its result
  // must replace the previous snapshot even when that file was written
  // recently. Otherwise every restart recomputes the same 60k+ rows.
  if (workerData.cachePath) {
    const cachePayload = JSON.stringify({
      ...metadata,
      facts: materializedFacts,
    });
    const temporaryPath = `${workerData.cachePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, gzipSync(Buffer.from(cachePayload), { level: 1 }));
    renameSync(temporaryPath, workerData.cachePath);
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
    reconciliation: hybrid.reconciliation,
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

import { parentPort, workerData } from "node:worker_threads";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { reconcileMiaoshouPerformance } from "./miaoshou-performance.js";
import { materializePerformanceFacts } from "./performance-analytics.js";
import { initPerformanceAnalyticsStore } from "./performance-analytics-db.js";
import { applyShopDirectoryProfile } from "./shop-directory.js";
import { createHash } from "node:crypto";
import { materializeWithPartitions, PARTITION_SCHEMA_VERSION } from "./performance-partitions.js";

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
    revenueBasis: workerData.revenueBasis || "payAmount",
    enabledShopKeys: workerData.enabledShopKeys || [],
    shopDirectory: workerData.shopDirectory || null,
    syncState: workerData.syncState || {},
  });
  // 产品、打包费、补录成本属于全局规则，变化时全部分区重算；汇率按分区日期单独计入哈希。
  const staticHash = createHash("sha1").update(JSON.stringify([
    PARTITION_SCHEMA_VERSION,
    workerData.products || {},
    workerData.packagingFeeRules || [],
    workerData.supplementalProductCosts || [],
  ])).digest("hex").slice(0, 20);
  const partitioned = materializeWithPartitions({
    facts: hybrid.facts,
    cacheDirectory: workerData.partitionDir || "",
    staticHash,
    exchangeRates: workerData.exchangeRates || [],
    forceFull: workerData.forceFullMaterialization === true,
    loadReusedRows: !workerData.partitionDir,
    materialize: (subset) => materializePerformanceFacts({
      facts: subset,
      products: workerData.products || {},
      exchangeRates: workerData.exchangeRates || [],
      packagingFeeRules: workerData.packagingFeeRules || [],
      supplementalProductCosts: workerData.supplementalProductCosts || [],
    }),
  });
  const materializedFacts = partitioned.rows;
  const usePartitions = Boolean(workerData.partitionDir);
  const materializedAt = new Date().toISOString();
  const durationMs = Date.now() - startedAt;
  const metadata = {
    dataVersion: workerData.dataVersion || "",
    materializedAt,
    materializationDurationMs: durationMs,
    shopDirectory: workerData.shopDirectory || {},
    factCount: usePartitions ? partitioned.stats.totalRowCount : materializedFacts.length,
    partitioned: usePartitions,
    partitionDir: usePartitions ? workerData.partitionDir : "",
    transactionReconciliation: hybrid.reconciliation,
    transactionSync: workerData.transactionSync || {},
    stale: false,
    targetDataVersion: workerData.dataVersion || "",
    sourceSyncedAt,
    partitionStats: partitioned.stats,
  };
  // A materialization job only starts for a new data version, so its result
  // must replace the previous snapshot even when that file was written
  // recently. Otherwise every restart recomputes the same 60k+ rows.
  // 使用分区时，查询线程直接读取分区文件，不再写整份快照。
  if (workerData.cachePath && !usePartitions) {
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
    ...(workerData.returnFacts === false || usePartitions ? {} : { facts: materializedFacts }),
    reconciliation: hybrid.reconciliation,
    durationMs,
    rebuiltPartitionKeys: partitioned.rebuiltKeys,
    removedPartitionKeys: partitioned.removedKeys,
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

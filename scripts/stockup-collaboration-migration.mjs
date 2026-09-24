import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const cacheDir = resolve(process.env.CACHE_DIR || resolve(process.cwd(), ".cache"));
const sourcePath = resolve(cacheDir, "stockup-workflow.json");
const targetPath = resolve(process.env.STOCKUP_COLLABORATION_DB_PATH || resolve(cacheDir, "stockup-collaboration.sqlite"));
const apply = process.argv.includes("--apply");

if (!existsSync(sourcePath)) {
  console.log("没有找到旧备货缓存，不需要迁移。");
  process.exit(0);
}

const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const groups = new Map();
for (const demand of source.demands || []) {
  const key = String(demand.demandBatchNo || demand.id || "").trim();
  if (!key) continue;
  const group = groups.get(key) || [];
  group.push(demand);
  groups.set(key, group);
}

console.log(`发现 ${groups.size} 个历史需求批次、${(source.demands || []).length} 行产品。`);
if (!apply) {
  console.log("当前为只读预览。确认后使用 --apply 写入本地协同库；不会写入简道云。" );
  process.exit(0);
}

const store = await initStockupCollaborationStore(targetPath);
const service = createStockupCollaborationService(store);
const context = { auth: { role: "admin", user: { id: "migration", displayName: "历史数据迁移" } }, viewAll: true, viewCost: true, revealSupplier: true };
let imported = 0;
for (const [batchNo, demands] of groups) {
  const first = demands[0];
  const submitted = new Date(first.submittedAt || first.createdAt || Date.now());
  const fallbackArrival = new Date(submitted.getTime() + 45 * 86400000).toISOString().slice(0, 10);
  service.createRequest({
    project: first.project || "历史备货",
    destinationCountry: first.destinationCountry || "未配置国家",
    destinationWarehouseId: first.destinationWarehouseRecordId || "",
    destinationWarehouseName: first.destinationWarehouseName || first.destinationCountry || "历史目的仓",
    expectedArrivalAt: first.expectedArrivalAt ? String(first.expectedArrivalAt).slice(0, 10) : fallbackArrival,
    priority: first.priority || "常规",
    reason: first.reason || "历史备货迁移",
    platform: first.platform || "",
    note: `由旧备货批次 ${batchNo} 只读迁移；原状态：${first.businessStatus || "未配置"}`,
    submit: true,
    lines: demands.map((demand) => ({
      productId: demand.productRecordId || "",
      sku: demand.sku || demand.temporaryProductNo || `LEGACY-${demand.id}`,
      productName: demand.productName || demand.sku || "历史产品",
      method: demand.stockupMethod === "委外生产" ? "委外生产" : "采购",
      requestedQty: Number(demand.requestedQty || demand.plannedQty || 0) || 1,
      unit: demand.unit || "件",
      note: `原需求行：${demand.demandLineNo || ""}`,
    })),
  }, context, `legacy-stockup-${batchNo}`);
  imported += 1;
}
console.log(`迁移完成：${imported} 个历史需求批次。目标：${targetPath}`);

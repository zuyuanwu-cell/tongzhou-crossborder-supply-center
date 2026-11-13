// 动销历史库一次性瘦身（2026-11）：去掉版本记录里从未被读取的整份行明细，再整理数据库文件。
// 用法（必须先停掉中台 API，否则运行中的进程会用内存里的旧库覆盖文件）：
//   pm2 stop tongzhou-supply-api
//   node scripts/compact-movement-history.mjs [.cache/movement-history.sqlite]
//   pm2 start tongzhou-supply-api
// 会先把原文件备份为 movement-history.sqlite.before-compact.bak；确认中台正常后可删除备份。
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { initMovementHistoryStore } from "../server/movement-history-db.js";

const dbPath = resolve(process.argv[2] || process.env.MOVEMENT_HISTORY_DB_PATH || ".cache/movement-history.sqlite");
if (!existsSync(dbPath)) {
  console.error(`找不到 ${dbPath}`);
  process.exit(1);
}
console.log(`开始瘦身 ${dbPath}（${Math.round(statSync(dbPath).size / 1048576)} MB）。请确认中台 API 已停止。`);
const started = Date.now();
const store = await initMovementHistoryStore(dbPath, {});
const result = store.compactVersions();
store.flush();
const versions = store.listVersions({});
const latest = store.getLatestSnapshot({}, { includeRows: true });
console.log(JSON.stringify({
  result,
  sizeMb: Math.round(statSync(dbPath).size / 1048576),
  versions: versions.length,
  latestSnapshot: latest ? { date: latest.date, rows: latest.rows?.length || 0 } : null,
  ms: Date.now() - started,
}, null, 2));

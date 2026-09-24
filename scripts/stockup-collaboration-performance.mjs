import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { initStockupCollaborationStore } from "../server/stockup-collaboration-db.js";
import { createStockupCollaborationService } from "../server/stockup-collaboration-service.js";

const temp = mkdtempSync(resolve(tmpdir(), "stockup-performance-"));
const requestCount = Number(process.env.STOCKUP_PERF_REQUESTS || 2000);
const linesPerRequest = Number(process.env.STOCKUP_PERF_LINES || 5);
try {
  const store = await initStockupCollaborationStore(resolve(temp, "performance.sqlite"));
  const timestamp = new Date().toISOString();
  store.transaction(() => {
    for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
      const requestId = `perf-request-${requestIndex}`;
      store.run(`INSERT INTO stockup_requests (id,request_no,project,destination_country,destination_warehouse_id,destination_warehouse_name,expected_arrival_at,priority,reason,platform,note,status,requester_id,requester_name,assignee_id,assignee_name,exception_count,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, '', '',0,1,?,?)`, [requestId, `PERF-${String(requestIndex).padStart(6, "0")}`, "性能测试", "俄罗斯", "ru-1", "俄罗斯1仓", "2026-12-31", "常规", "性能测试", "", "", "in_progress", "perf-user", "性能账号", timestamp, timestamp]);
      for (let lineIndex = 0; lineIndex < linesPerRequest; lineIndex += 1) store.run(`INSERT INTO stockup_request_lines (id,request_id,product_id,sku,product_name,image_url,specification,method,requested_qty,unit,target_unit_cost_cny,expected_arrival_at,note,status,fulfilled_qty,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`, [`perf-line-${requestIndex}-${lineIndex}`, requestId, "", `SKU-${lineIndex}`, `产品${lineIndex}`, "", "", "采购", 100, "件", 10, "", "", "in_progress", timestamp, timestamp]);
    }
  });
  const service = createStockupCollaborationService(store);
  const context = { auth: { user: { id: "perf-user", displayName: "性能账号" } }, viewAll: true };
  const startedAt = performance.now();
  const result = service.listRequests({ page: 1, pageSize: 20 }, context);
  const elapsed = performance.now() - startedAt;
  assert.equal(result.total, requestCount);
  assert.equal(result.items.length, 20);
  assert.ok(elapsed < 500, `分页列表读取 ${elapsed.toFixed(1)}ms，超过 500ms 目标`);
  console.log(`stockup performance passed: ${requestCount * linesPerRequest} lines, first page ${elapsed.toFixed(1)}ms`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

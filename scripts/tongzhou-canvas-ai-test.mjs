import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTongzhouCanvasAi } from "../server/tongzhou-canvas-ai.js";

const cacheDir = mkdtempSync(join(tmpdir(), "tongzhou-canvas-ai-"));
const requests = [];
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

async function mockFetch(url, options = {}) {
  const parsed = new URL(url);
  const body = options.body ? JSON.parse(options.body) : null;
  requests.push({ path: parsed.pathname, method: options.method || "GET", headers: options.headers || {}, body });
  assert.equal(options.headers?.Authorization, "Bearer tz_live_user_secret");

  if (parsed.pathname.endsWith("/models")) return json(200, {
    data: [
      { id: "chat-pro", name: "标题文案 Pro", category: "chat", estimated_credits: 2 },
      { id: "image-pro", name: "商品图 Pro", category: "image", estimated_credits: 8 },
      { id: "video-pro", name: "短视频 Pro", category: "video", estimated_credits: 30 },
    ],
  });
  if (parsed.pathname.endsWith("/balance")) return json(200, { balance: 168, credit_unit_price: 0.01, currency: "CNY" });
  if (parsed.pathname.endsWith("/workflows")) return json(200, {
    data: [{ id: "wf-product-video", name: "产品图转视频", revision: 3, contract: { inputs: { prompt: "string", image: "url" } } }],
  });
  if (parsed.pathname.endsWith("/tasks") && options.method === "POST") {
    assert.equal(options.headers?.["Idempotency-Key"]?.startsWith("tzsc-"), true);
    assert.equal(body.category, "chat");
    assert.equal(body.model, "chat-pro");
    assert.equal(body.params.temperature, 0.2);
    return json(202, { task: { id: "task-1", status: "queued", estimated_credits: 2 }, request_id: "request-task" });
  }
  if (parsed.pathname.endsWith("/tasks/task-1")) return json(200, {
    task: { id: "task-1", status: "succeeded", progress: 100, charged_credits: 2, output: { type: "text", text: "测试标题" } },
    request_id: "request-task-result",
  });
  if (parsed.pathname.endsWith("/workflows/wf-product-video/runs") && options.method === "POST") {
    assert.equal(body.inputs.prompt, "镜头环绕产品");
    return json(202, { run: { id: "run-1" }, request_id: "request-workflow" });
  }
  if (parsed.pathname.endsWith("/workflow-runs/run-1")) return json(200, {
    run: { id: "run-1", status: "succeeded", progress: 100, charged_credits: 21, output: { type: "video", urls: ["https://cdn.example.com/result.mp4"] } },
    request_id: "request-workflow-result",
  });
  return json(404, { message: `unexpected ${parsed.pathname}` });
}

try {
  const service = initTongzhouCanvasAi({
    cacheDir,
    encryptionSecret: "test-encryption-secret-at-least-16",
    fetchImpl: mockFetch,
    sleepImpl: async () => {},
  });

  const saved = await service.saveUserConfig("user-1", {
    apiKey: "tz_live_user_secret",
    models: { text: "chat-pro", image: "image-pro", video: "video-pro" },
    workflows: { video: "wf-product-video" },
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.apiKeyMasked.includes("tz_live_user_secret"), false);
  assert.equal(saved.models.text, "chat-pro");
  assert.equal(saved.catalog.models.length, 3);
  assert.equal(saved.catalog.workflows[0].id, "wf-product-video");
  assert.equal(saved.catalog.balance.balance, 168);

  const storedConfig = readFileSync(join(cacheDir, "tongzhou-canvas-ai-users.json"), "utf8");
  assert.equal(storedConfig.includes("tz_live_user_secret"), false, "API Key must never be persisted in plaintext");

  const modelJob = await service.submitModelTask("user-1", {
    category: "chat",
    messages: [{ role: "user", content: "写一个标题" }],
    params: { temperature: 0.2 },
  });
  assert.equal(modelJob.status, "queued");
  const modelResult = await service.waitForJob("user-1", modelJob.id, { intervalMs: 0 });
  assert.equal(modelResult.status, "succeeded");
  assert.equal(modelResult.output.text, "测试标题");

  const workflowJob = await service.submitWorkflowRun("user-1", {
    workflowId: "wf-product-video",
    inputs: { prompt: "镜头环绕产品", image: "https://cdn.example.com/product.png" },
  });
  const workflowResult = await service.waitForJob("user-1", workflowJob.id, { intervalMs: 0 });
  assert.deepEqual(workflowResult.output.urls, ["https://cdn.example.com/result.mp4"]);

  await assert.rejects(() => service.pollJob("user-2", modelJob.id), /未找到当前用户/);
  const cleared = await service.saveUserConfig("user-1", { clearKey: true });
  assert.equal(cleared.configured, false);
  assert.equal(requests.filter((item) => item.path.endsWith("/models")).length, 1);
  console.log("tongzhou canvas ai tests passed");
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}

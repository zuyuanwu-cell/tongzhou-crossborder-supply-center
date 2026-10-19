import { Worker } from "node:worker_threads";

const workerUrl = new URL("./stockup-warning-render-worker.js", import.meta.url);

function reportPayload(payload = {}) {
  return {
    generatedAt: payload.generatedAt,
    counts: payload.counts,
    recommendations: Array.isArray(payload.recommendations) ? payload.recommendations : [],
  };
}

function runRenderWorker(payload, { withImages, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData: { payload: reportPayload(payload), withImages } });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().catch(() => {});
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error(`备货预警长图生成超过 ${Math.ceil(timeoutMs / 1000)} 秒。`)), timeoutMs);
    worker.once("message", (result) => {
      if (!result?.ok) {
        finish(reject, new Error(result?.message || "备货预警长图生成失败。"));
        return;
      }
      finish(resolve, {
        buffer: Buffer.from(result.buffer),
        model: result.model,
        width: result.width,
      });
    });
    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code) => {
      if (code !== 0 && !settled) finish(reject, new Error(`备货预警长图线程异常退出：${code}`));
    });
  });
}

export async function renderStockupWarningReport(payload, options = {}) {
  const timeoutMs = Math.max(10_000, Number(options.timeoutMs) || 60_000);
  try {
    return await runRenderWorker(payload, { withImages: true, timeoutMs });
  } catch (error) {
    const fallback = await runRenderWorker(payload, {
      withImages: false,
      timeoutMs: Math.max(5_000, Number(options.fallbackTimeoutMs) || 15_000),
    });
    return {
      ...fallback,
      thumbnailFallbackReason: error?.message || "产品缩略图读取失败。",
    };
  }
}

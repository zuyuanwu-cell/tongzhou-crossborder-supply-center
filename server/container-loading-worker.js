import { parentPort, workerData } from "node:worker_threads";
import { generateLoadingCandidates } from "./container-loading-engine.js";

try {
  const candidates = generateLoadingCandidates(workerData || {});
  parentPort?.postMessage({ ok: true, candidates });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: {
      message: error?.message || "装柜方案计算失败。",
      code: error?.code || "container_loading_worker_error",
      statusCode: Number(error?.statusCode || 400),
    },
  });
}


import { parentPort, workerData } from "node:worker_threads";
import { fetch as undiciFetch } from "undici";
import { renderStockupWarningPng, renderStockupWarningPngWithImages } from "./stockup-warning-report.js";

if (!globalThis.fetch) globalThis.fetch = undiciFetch;

try {
  const report = workerData?.withImages === false
    ? renderStockupWarningPng(workerData?.payload || {})
    : await renderStockupWarningPngWithImages(workerData?.payload || {}, { fetchImpl: globalThis.fetch });
  const bytes = new Uint8Array(report.buffer);
  parentPort?.postMessage({ ok: true, buffer: bytes, model: report.model, width: report.width }, [bytes.buffer]);
} catch (error) {
  parentPort?.postMessage({ ok: false, message: error?.message || "备货预警长图生成失败。" });
}

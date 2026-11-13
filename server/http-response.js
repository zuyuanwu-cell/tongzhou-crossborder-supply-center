import { brotliCompress, brotliCompressSync, constants as zlibConstants, gzip, gzipSync } from "node:zlib";

// 压缩参数：brotli 默认等级 11 压 14 MB JSON 要 20 多秒（并阻塞整个进程），等级 4 只要 0.1 秒，体积仍比 gzip 小。
export const BROTLI_OPTIONS = Object.freeze({
  params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  },
});
export const GZIP_OPTIONS = Object.freeze({ level: 5 });
// 超过这个大小的响应放到 libuv 线程池里压缩，不阻塞其他请求。
export const ASYNC_COMPRESSION_THRESHOLD_BYTES = 64 * 1024;

function pickEncoding(acceptEncoding) {
  const accepted = String(acceptEncoding || "").toLowerCase();
  if (/\bbr\b/.test(accepted)) return "br";
  if (/\bgzip\b/.test(accepted)) return "gzip";
  return "";
}

export function encodeJsonResponse(payload, acceptEncoding = "", thresholdBytes = 1024) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length < thresholdBytes) return { body, encoding: "" };
  const encoding = pickEncoding(acceptEncoding);
  if (encoding === "br") return { body: brotliCompressSync(body, BROTLI_OPTIONS), encoding };
  if (encoding === "gzip") return { body: gzipSync(body, GZIP_OPTIONS), encoding };
  return { body, encoding: "" };
}

/**
 * 与 encodeJsonResponse 相同，但大响应在线程池里压缩。回调 (error, { body, encoding, rawBytes })。
 * 小响应同步完成，行为不变。
 */
export function encodeJsonResponseAsync(payload, acceptEncoding = "", callback, { thresholdBytes = 1024, asyncThresholdBytes = ASYNC_COMPRESSION_THRESHOLD_BYTES } = {}) {
  let body;
  try {
    body = Buffer.from(JSON.stringify(payload));
  } catch (error) {
    callback(error);
    return;
  }
  const rawBytes = body.length;
  const encoding = body.length < thresholdBytes ? "" : pickEncoding(acceptEncoding);
  if (!encoding) {
    callback(null, { body, encoding: "", rawBytes });
    return;
  }
  if (body.length < asyncThresholdBytes) {
    const compressed = encoding === "br" ? brotliCompressSync(body, BROTLI_OPTIONS) : gzipSync(body, GZIP_OPTIONS);
    callback(null, { body: compressed, encoding, rawBytes });
    return;
  }
  const done = (error, compressed) => {
    // 压缩失败时退回不压缩，保证请求仍有响应。
    if (error) callback(null, { body, encoding: "", rawBytes });
    else callback(null, { body: compressed, encoding, rawBytes });
  };
  if (encoding === "br") brotliCompress(body, BROTLI_OPTIONS, done);
  else gzip(body, GZIP_OPTIONS, done);
}

export function corsHeaders(origin = "") {
  return {
    "Access-Control-Allow-Origin": String(origin || "https://gyl.tongzhoukuajing.com"),
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Backup-Upload-Token,X-Backup-Download-Ticket,X-Hermes-Timestamp,X-Hermes-Nonce,X-Hermes-Body-Sha256,X-Hermes-Signature,Last-Event-ID",
    Vary: "Origin, Accept-Encoding",
  };
}

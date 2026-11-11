import { brotliCompressSync, gzipSync } from "node:zlib";

export function encodeJsonResponse(payload, acceptEncoding = "", thresholdBytes = 1024) {
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length < thresholdBytes) return { body, encoding: "" };
  const accepted = String(acceptEncoding || "").toLowerCase();
  if (/\bbr\b/.test(accepted)) return { body: brotliCompressSync(body), encoding: "br" };
  if (/\bgzip\b/.test(accepted)) return { body: gzipSync(body), encoding: "gzip" };
  return { body, encoding: "" };
}

export function corsHeaders(origin = "") {
  return {
    "Access-Control-Allow-Origin": String(origin || "https://gyl.tongzhoukuajing.com"),
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key,X-Backup-Upload-Token,X-Backup-Download-Ticket,X-Hermes-Timestamp,X-Hermes-Nonce,X-Hermes-Body-Sha256,X-Hermes-Signature,Last-Event-ID",
    Vary: "Origin, Accept-Encoding",
  };
}

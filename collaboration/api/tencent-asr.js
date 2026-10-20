import { createHash, createHmac } from "node:crypto";

const HOST = "asr.tencentcloudapi.com";
const ENDPOINT = `https://${HOST}`;
const SERVICE = "asr";
const VERSION = "2019-06-14";

function hmac(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message, statusCode = 502, code = "asr_failed", details = {}) {
  return Object.assign(new Error(message), { statusCode, code, details });
}

function voiceFormat(mimeType, fileName = "") {
  const mime = String(mimeType || "").toLowerCase().split(";")[0];
  const suffix = String(fileName || "").toLowerCase().split(".").pop();
  if (mime === "audio/mpeg" || suffix === "mp3") return "mp3";
  if (["audio/mp4", "audio/x-m4a"].includes(mime) || suffix === "m4a") return "m4a";
  if (["audio/aac", "audio/x-aac"].includes(mime) || suffix === "aac") return "aac";
  if (["audio/wav", "audio/wave", "audio/x-wav"].includes(mime) || suffix === "wav") return "wav";
  throw fail("不支持该录音格式。", 415, "unsupported_audio_format");
}

function authorization({ secretId, secretKey, timestamp, body }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:${HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(body)].join("\n");
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = hmac(secretSigning, stringToSign, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export async function recognizeShortAudio({
  buffer,
  mimeType,
  fileName,
  secretId,
  secretKey,
  engine = "16k_zh",
  hotwords = [],
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail("录音内容为空。", 400, "empty_audio");
  if (!secretId || !secretKey) throw fail("腾讯云语音识别尚未配置。", 503, "asr_not_configured");
  const bodyObject = {
    EngSerViceType: engine,
    SourceType: 1,
    VoiceFormat: voiceFormat(mimeType, fileName),
    Data: buffer.toString("base64"),
    DataLen: buffer.length,
    FilterPunc: 0,
    ConvertNumMode: 1,
    WordInfo: 0,
  };
  const hotwordList = [...new Set((hotwords || []).map((item) => String(item || "").trim()).filter(Boolean))]
    .slice(0, 30).map((item) => `${item.slice(0, 10)}|8`).join(",");
  if (hotwordList) bodyObject.HotwordList = hotwordList;
  const body = JSON.stringify(bodyObject);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: authorization({ secretId, secretKey, timestamp, body }),
        "Content-Type": "application/json; charset=utf-8",
        Host: HOST,
        "X-TC-Action": "SentenceRecognition",
        "X-TC-Version": VERSION,
        "X-TC-Timestamp": String(timestamp),
      },
      body,
      signal: controller.signal,
    });
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    const result = payload.Response || {};
    if (!response.ok || result.Error) {
      const upstreamCode = String(result.Error?.Code || `HTTP_${response.status}`);
      throw fail(result.Error?.Message || "腾讯云语音识别失败。", response.status === 429 ? 429 : 502, "asr_upstream_error", { upstreamCode, requestId: result.RequestId || "" });
    }
    return {
      transcript: String(result.Result || "").trim(),
      durationMs: Number(result.AudioDuration || 0),
      requestId: String(result.RequestId || ""),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw fail("语音识别超时，请重试或改用文字输入。", 504, "asr_timeout");
    if (error?.code) throw error;
    throw fail("无法连接腾讯云语音识别服务。", 502, "asr_unreachable");
  } finally {
    clearTimeout(timer);
  }
}

export { voiceFormat as tencentAsrVoiceFormat };

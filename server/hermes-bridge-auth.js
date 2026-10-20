import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const HERMES_BRIDGE_WINDOW_MS = 5 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalHermesBridgeRequest({ timestamp, nonce, method, path, bodyDigest }) {
  return [text(timestamp), text(nonce), text(method).toUpperCase(), text(path), text(bodyDigest).toLowerCase()].join("\n");
}

export function signHermesBridgeRequest(secret, request) {
  if (!text(secret)) throw new Error("Hermes bridge secret is not configured.");
  return createHmac("sha256", secret).update(canonicalHermesBridgeRequest(request)).digest("hex");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(text(left), "utf8");
  const rightBuffer = Buffer.from(text(right), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyHermesBridgeRequest({
  secret,
  method,
  path,
  rawBody,
  headers,
  consumeNonce,
  now = () => Date.now(),
  windowMs = HERMES_BRIDGE_WINDOW_MS,
}) {
  if (!text(secret)) throw Object.assign(new Error("Hermes bridge is not configured."), { statusCode: 503, code: "bridge_not_configured" });
  const timestamp = text(headers["x-hermes-timestamp"]);
  const nonce = text(headers["x-hermes-nonce"]);
  const suppliedDigest = text(headers["x-hermes-body-sha256"]).toLowerCase();
  const suppliedSignature = text(headers["x-hermes-signature"]).toLowerCase();
  if (!timestamp || !nonce || !suppliedDigest || !suppliedSignature) {
    throw Object.assign(new Error("Hermes bridge signature headers are required."), { statusCode: 401, code: "signature_required" });
  }
  if (!/^[A-Za-z0-9._:-]{16,200}$/.test(nonce)) {
    throw Object.assign(new Error("Invalid Hermes bridge nonce."), { statusCode: 401, code: "invalid_nonce" });
  }
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Number(now()) - timestampMs) > windowMs) {
    throw Object.assign(new Error("Hermes bridge signature has expired."), { statusCode: 401, code: "signature_expired" });
  }
  const actualDigest = sha256Hex(rawBody);
  if (!safeEqual(actualDigest, suppliedDigest)) {
    throw Object.assign(new Error("Hermes bridge body digest does not match."), { statusCode: 401, code: "body_digest_mismatch" });
  }
  const expected = signHermesBridgeRequest(secret, { timestamp, nonce, method, path, bodyDigest: actualDigest });
  if (!safeEqual(expected, suppliedSignature)) {
    throw Object.assign(new Error("Hermes bridge signature is invalid."), { statusCode: 401, code: "signature_invalid" });
  }
  const expiresAt = new Date(timestampMs + windowMs + 1_000).toISOString();
  if (!consumeNonce(nonce, expiresAt)) {
    throw Object.assign(new Error("Hermes bridge nonce has already been used."), { statusCode: 409, code: "nonce_replayed" });
  }
  return { timestamp: new Date(timestampMs).toISOString(), nonce, bodyDigest: actualDigest };
}

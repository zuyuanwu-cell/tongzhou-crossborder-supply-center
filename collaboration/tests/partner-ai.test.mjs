import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

process.env.SKIP_ENV_FILE = "true";
process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";
process.env.HERMES_PARTNER_BRIDGE_SECRET = "bridge-secret-at-least-thirty-two-characters";
process.env.COLLABORATION_PARTNER_AI_BRIDGE_URL = "http://partner-ai.test";

const { requestPartnerProgressDraft } = await import("../api/partner-ai-bridge.js");
const { recognizeShortAudio } = await import("../api/tencent-asr.js");

test("partner draft bridge signs the exact body and uses a one-time nonce", async () => {
  let captured;
  const payload = { principal: { organizationId: "org", userId: "user", workItemId: "work" }, text: "完成 60%", task: { id: "work", version: 1 } };
  const draft = await requestPartnerProgressDraft(payload, { fetchImpl: async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ ok: true, draft: { type: "work_item_progress", fields: { action: "progress", note: payload.text } } }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  assert.equal(draft.type, "work_item_progress");
  const body = Buffer.from(captured.options.body);
  const digest = createHash("sha256").update(body).digest("hex");
  assert.equal(captured.options.headers["X-Hermes-Body-Sha256"], digest);
  const canonical = [captured.options.headers["X-Hermes-Timestamp"], captured.options.headers["X-Hermes-Nonce"], "POST", "/api/internal/hermes/v1/partner-progress-drafts", digest].join("\n");
  assert.equal(captured.options.headers["X-Hermes-Signature"], createHmac("sha256", process.env.HERMES_PARTNER_BRIDGE_SECRET).update(canonical).digest("hex"));
});

test("Tencent ASR request uses TC3 authorization without exposing credentials in its body", async () => {
  let captured;
  const result = await recognizeShortAudio({
    buffer: Buffer.from("RIFF-test-audio"), mimeType: "audio/wav", fileName: "voice.wav", secretId: "AKIDEXAMPLE", secretKey: "secret-key-example",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ Response: { Result: "完成 60%", AudioDuration: 1.2, RequestId: "request-1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(result.transcript, "完成 60%");
  assert.match(captured.options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.equal(JSON.stringify(captured.body).includes("secret-key-example"), false);
  assert.equal(captured.body.VoiceFormat, "wav");
});

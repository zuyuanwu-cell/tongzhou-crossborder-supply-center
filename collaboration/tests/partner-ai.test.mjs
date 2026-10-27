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
const { validatePartnerAiAudioContent } = await import("../api/partner-ai.js");
const { jsonbParameter } = await import("../api/jsonb-parameter.js");

test("partner AI JSONB values are sent as JSON documents instead of PostgreSQL array literals", () => {
  const evidence = [{ field: "note", quote: "已经做好了", normalizedValue: "已经做好了" }];
  const serialized = jsonbParameter(evidence, []);
  assert.equal(serialized, JSON.stringify(evidence));
  assert.deepEqual(JSON.parse(serialized), evidence);
  assert.equal(jsonbParameter(undefined, []), "[]");
});

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
      return new Response(JSON.stringify({ Response: { Result: "完成 60%", AudioDuration: 1200, RequestId: "request-1" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(result.transcript, "完成 60%");
  assert.match(captured.options.headers.Authorization, /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.equal(JSON.stringify(captured.body).includes("secret-key-example"), false);
  assert.equal(captured.body.VoiceFormat, "wav");
  assert.equal(result.durationMs, 1200);
});

test("partner audio rejects a forged MIME type before it reaches Tencent ASR", () => {
  assert.throws(
    () => validatePartnerAiAudioContent(Buffer.from("not-an-mp3"), "audio/mpeg"),
    (error) => error?.code === "invalid_audio_content" && error?.statusCode === 415,
  );
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0); wav.write("WAVE", 8);
  assert.doesNotThrow(() => validatePartnerAiAudioContent(wav, "audio/wav"));
});

test("Tencent ASR preserves upstream account state errors for fail-closed configuration tests", async () => {
  await assert.rejects(
    recognizeShortAudio({
      buffer: Buffer.from("ID3-test-audio"), mimeType: "audio/mpeg", fileName: "voice.mp3",
      secretId: "AKIDEXAMPLE", secretKey: "secret-key-example",
      fetchImpl: async () => new Response(JSON.stringify({ Response: { Error: { Code: "FailedOperation.ServiceIsolate", Message: "arrears" }, RequestId: "request-2" } }), { status: 400, headers: { "Content-Type": "application/json" } }),
    }),
    (error) => error?.code === "asr_upstream_error" && error?.details?.upstreamCode === "FailedOperation.ServiceIsolate",
  );
});

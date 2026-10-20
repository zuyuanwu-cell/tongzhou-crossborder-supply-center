import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { collaborationConfig } from "./config.js";
import { withSystem } from "./db.js";
import { recognizeShortAudio } from "./tencent-asr.js";

const configSchema = z.object({
  enabled: z.boolean().default(false),
  textEnabled: z.boolean().default(true),
  voiceEnabled: z.boolean().default(false),
  organizationIds: z.array(z.string().uuid()).max(100).default([]),
  userDailyLimit: z.number().int().min(1).max(500).default(30),
  organizationDailyLimit: z.number().int().min(1).max(10_000).default(120),
  asr: z.object({
    secretId: z.string().trim().max(300).default(""),
    secretKey: z.string().trim().max(500).default(""),
    engine: z.enum(["16k_zh", "16k_zh-PY", "16k_zh_dialect"]).default("16k_zh"),
  }).default({}),
}).strict();

function encryptionKey() {
  return createHash("sha256").update(`partner-ai\n${collaborationConfig.secretKey}`).digest();
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") });
}

function decrypt(value) {
  const payload = JSON.parse(String(value || "{}"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv || "", "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag || "", "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data || "", "base64")), decipher.final()]).toString("utf8"));
}

function environmentDefaults() {
  return configSchema.parse({
    enabled: process.env.COLLABORATION_PARTNER_AI_ENABLED === "true",
    textEnabled: process.env.COLLABORATION_PARTNER_AI_TEXT_ENABLED !== "false",
    voiceEnabled: process.env.COLLABORATION_PARTNER_AI_VOICE_ENABLED === "true",
    organizationIds: String(process.env.COLLABORATION_PARTNER_AI_ORGANIZATION_IDS || "").split(",").map((item) => item.trim()).filter(Boolean),
    userDailyLimit: Number(process.env.COLLABORATION_PARTNER_AI_USER_DAILY_LIMIT || 30),
    organizationDailyLimit: Number(process.env.COLLABORATION_PARTNER_AI_ORG_DAILY_LIMIT || 120),
    asr: {
      secretId: String(process.env.TENCENT_ASR_SECRET_ID || ""),
      secretKey: String(process.env.TENCENT_ASR_SECRET_KEY || ""),
      engine: String(process.env.TENCENT_ASR_ENGINE || "16k_zh"),
    },
  });
}

export async function getPartnerAiSettings() {
  const row = await withSystem(async (client) => (await client.query("SELECT encrypted_config,updated_by,updated_at FROM partner_ai_settings WHERE singleton_key='global'")).rows[0] || null);
  if (!row) return { config: environmentDefaults(), updatedBy: "environment", updatedAt: "" };
  return { config: configSchema.parse(decrypt(row.encrypted_config)), updatedBy: row.updated_by || "", updatedAt: new Date(row.updated_at).toISOString() };
}

export async function savePartnerAiSettings(input, actorId = "") {
  const current = await getPartnerAiSettings();
  const candidate = {
    ...current.config,
    ...input,
    asr: {
      ...current.config.asr,
      ...(input.asr || {}),
      secretId: String(input.asr?.secretId || "").trim() || current.config.asr.secretId,
      secretKey: String(input.asr?.secretKey || "").trim() || current.config.asr.secretKey,
    },
  };
  const config = configSchema.parse(candidate);
  await withSystem((client) => client.query(
    `INSERT INTO partner_ai_settings(singleton_key,encrypted_config,updated_by)
     VALUES ('global',$1,$2)
     ON CONFLICT(singleton_key) DO UPDATE SET encrypted_config=excluded.encrypted_config,updated_by=excluded.updated_by,updated_at=now()`,
    [encrypt(config), String(actorId || "system").slice(0, 160)],
  ));
  return { config, updatedBy: String(actorId || "system"), updatedAt: new Date().toISOString() };
}

export function publicPartnerAiSettings(value) {
  const config = value.config || value;
  const mask = (secret) => secret ? `${String(secret).slice(0, 4)}••••${String(secret).slice(-4)}` : "";
  return {
    enabled: config.enabled,
    textEnabled: config.textEnabled,
    voiceEnabled: config.voiceEnabled,
    organizationIds: config.organizationIds,
    userDailyLimit: config.userDailyLimit,
    organizationDailyLimit: config.organizationDailyLimit,
    asr: {
      configured: Boolean(config.asr?.secretId && config.asr?.secretKey),
      secretIdMasked: mask(config.asr?.secretId),
      engine: config.asr?.engine || "16k_zh",
    },
    updatedBy: value.updatedBy || "",
    updatedAt: value.updatedAt || "",
  };
}

export function partnerAiEnabledFor(config, organizationId, mode = "text") {
  return Boolean(config.enabled
    && config.organizationIds.includes(String(organizationId || ""))
    && (mode === "voice" ? config.voiceEnabled : config.textEnabled));
}

export async function partnerAiCapabilitiesFor(organizationId) {
  try {
    const { config } = await getPartnerAiSettings();
    const organizationEnabled = Boolean(config.enabled && config.organizationIds.includes(String(organizationId || "")));
    return {
      enabled: Boolean(organizationEnabled && (config.textEnabled || config.voiceEnabled)),
      textEnabled: Boolean(organizationEnabled && config.textEnabled),
      voiceEnabled: Boolean(organizationEnabled && config.voiceEnabled && config.asr?.secretId && config.asr?.secretKey),
    };
  } catch {
    return { enabled: false, textEnabled: false, voiceEnabled: false };
  }
}

function silentWav(durationMs = 320, sampleRate = 16_000) {
  const sampleCount = Math.floor((durationMs / 1_000) * sampleRate);
  const dataLength = sampleCount * 2;
  const output = Buffer.alloc(44 + dataLength);
  output.write("RIFF", 0); output.writeUInt32LE(36 + dataLength, 4); output.write("WAVE", 8);
  output.write("fmt ", 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22); output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32); output.writeUInt16LE(16, 34); output.write("data", 36); output.writeUInt32LE(dataLength, 40);
  return output;
}

export async function testPartnerAiAsrConnection(input = {}) {
  const current = await getPartnerAiSettings();
  const secretId = String(input?.asr?.secretId || "").trim() || current.config.asr.secretId;
  const secretKey = String(input?.asr?.secretKey || "").trim() || current.config.asr.secretKey;
  const engine = String(input?.asr?.engine || current.config.asr.engine || "16k_zh");
  const result = await recognizeShortAudio({ buffer: silentWav(), mimeType: "audio/wav", fileName: "connection-test.wav", secretId, secretKey, engine, timeoutMs: 12_000 });
  return { ok: true, message: "腾讯云语音识别连接成功。", requestId: result.requestId, testedAt: new Date().toISOString() };
}

export { configSchema as partnerAiConfigSchema };

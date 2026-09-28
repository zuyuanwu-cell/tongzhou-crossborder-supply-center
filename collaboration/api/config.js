import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile() {
  if (process.env.SKIP_ENV_FILE === "true") return;
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

function required(name, { developmentFallback = "" } = {}) {
  const value = String(process.env[name] || developmentFallback).trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const production = process.env.NODE_ENV === "production";
const localDatabaseUrl = "postgres://tongzhou_portal:local-portal-only@127.0.0.1:64321/tongzhou_collaboration";
const localIntegrationDatabaseUrl = "postgres://tongzhou_integration:local-integration-only@127.0.0.1:64321/tongzhou_collaboration";

export const collaborationConfig = Object.freeze({
  production,
  port: Math.max(1, Number(process.env.COLLABORATION_API_PORT || 8790)),
  databaseUrl: required("COLLABORATION_DATABASE_URL", { developmentFallback: production ? "" : localDatabaseUrl }),
  integrationDatabaseUrl: String(process.env.COLLABORATION_INTEGRATION_DATABASE_URL || (production ? "" : localIntegrationDatabaseUrl)).trim(),
  publicOrigin: required("COLLABORATION_PUBLIC_ORIGIN", { developmentFallback: production ? "" : "http://localhost:5174" }),
  cookieSecure: process.env.COLLABORATION_COOKIE_SECURE !== "false" && production,
  secretKey: required("COLLABORATION_SECRET_KEY", { developmentFallback: production ? "" : "local-only-change-before-production" }),
  internalToken: required("COLLABORATION_INTERNAL_TOKEN", { developmentFallback: production ? "" : "local-internal-token-change-me" }),
  storageDriver: process.env.COLLABORATION_STORAGE_DRIVER === "s3" ? "s3" : "local",
  allowLocalPrivateStorage: process.env.COLLABORATION_ALLOW_LOCAL_PRIVATE_STORAGE === "true",
  storageDir: resolve(process.env.COLLABORATION_STORAGE_DIR || resolve(process.cwd(), ".cache", "collaboration-objects")),
  clamscanPath: String(process.env.COLLABORATION_CLAMSCAN_PATH || "clamscan").trim(),
  trustLocalUploads: !production && process.env.COLLABORATION_DEV_TRUST_UPLOADS !== "false",
  s3: {
    endpoint: String(process.env.COLLABORATION_S3_ENDPOINT || "").trim(),
    region: String(process.env.COLLABORATION_S3_REGION || "auto").trim(),
    bucket: String(process.env.COLLABORATION_S3_BUCKET || "").trim(),
    accessKeyId: String(process.env.COLLABORATION_S3_ACCESS_KEY_ID || "").trim(),
    secretAccessKey: String(process.env.COLLABORATION_S3_SECRET_ACCESS_KEY || "").trim(),
  },
  wecomWebhook: String(process.env.COLLABORATION_WECOM_WEBHOOK || "").trim(),
  smtpUrl: String(process.env.COLLABORATION_SMTP_URL || "").trim(),
  oemEnabled: process.env.COLLABORATION_OEM_ENABLED === "true",
  commandPollMs: Math.max(5_000, Number(process.env.COLLABORATION_COMMAND_POLL_MS || 10_000)),
  autoMigrate: process.env.COLLABORATION_AUTO_MIGRATE === "true" || (!production && process.env.COLLABORATION_AUTO_MIGRATE !== "false"),
  sessionAbsoluteMs: 12 * 60 * 60 * 1000,
  sessionIdleMs: 60 * 60 * 1000,
  mfaFreshMs: 10 * 60 * 1000,
});

if (collaborationConfig.production) {
  if (collaborationConfig.secretKey.length < 32) throw new Error("COLLABORATION_SECRET_KEY must be at least 32 characters in production.");
  if (collaborationConfig.internalToken.length < 32) throw new Error("COLLABORATION_INTERNAL_TOKEN must be at least 32 characters in production.");
  if (!collaborationConfig.cookieSecure) throw new Error("Secure collaboration cookies are required in production.");
  if (collaborationConfig.storageDriver !== "s3" && !collaborationConfig.allowLocalPrivateStorage) {
    throw new Error("S3 storage or explicit private local storage is required in production.");
  }
  if (collaborationConfig.storageDriver === "s3" && (!collaborationConfig.s3.bucket || !collaborationConfig.s3.accessKeyId || !collaborationConfig.s3.secretAccessKey)) {
    throw new Error("Complete S3 private storage credentials are required in production.");
  }
  if (!collaborationConfig.integrationDatabaseUrl) throw new Error("COLLABORATION_INTEGRATION_DATABASE_URL is required in production.");
  if (collaborationConfig.integrationDatabaseUrl === collaborationConfig.databaseUrl) throw new Error("Portal and integration PostgreSQL roles must use different connection URLs in production.");
}

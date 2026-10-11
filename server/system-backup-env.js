const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const HOST_BOUND_EXACT_KEYS = new Set([
  "NODE_ENV",
  "PORT",
  "API_PORT",
  "HOST",
  "CACHE_DIR",
  "SKIP_ENV_FILE",
  "BACKGROUND_JOBS_ENABLED",
  "ALLOW_SYSTEM_IMPORT",
  "SYSTEM_BACKUP_DIR",
  "SYSTEM_BACKUP_ENV_PATH",
  "SYSTEM_BACKUP_MAX_BYTES",
  "SYSTEM_BACKUP_PM2_APP",
  "SYSTEM_RESTORE_POLL_MS",
  "PM2_BIN",
  "COLLABORATION_DATABASE_URL",
  "COLLABORATION_API_BASE_URL",
  "COLLABORATION_PUBLIC_ORIGIN",
  "COLLABORATION_COOKIE_DOMAIN",
  "COLLABORATION_STORAGE_DRIVER",
  "COLLABORATION_STORAGE_DIR",
  "COLLABORATION_S3_ENDPOINT",
  "COLLABORATION_S3_REGION",
  "COLLABORATION_S3_BUCKET",
]);

export function isHostBoundEnvKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  if (!ENV_KEY_PATTERN.test(normalized)) return false;
  if (HOST_BOUND_EXACT_KEYS.has(normalized)) return true;
  return (
    normalized.endsWith("_DB_PATH")
    || normalized.endsWith("_CACHE_DIR")
    || normalized.endsWith("_STORAGE_DIR")
    || normalized.endsWith("_UPLOAD_DIR")
  );
}

export function parseEnvDocument(input) {
  const entries = [];
  const values = new Map();
  const text = String(input || "").replace(/^\uFEFF/, "");

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const candidate = trimmed.startsWith("export ") ? trimmed.slice(7).trimStart() : trimmed;
    const separator = candidate.indexOf("=");
    if (separator <= 0) continue;
    const key = candidate.slice(0, separator).trim();
    if (!ENV_KEY_PATTERN.test(key)) continue;
    const rawValue = candidate.slice(separator + 1);
    if (!values.has(key)) entries.push(key);
    values.set(key, rawValue);
  }

  return { entries, values };
}

function renderEnv(entries, values, heading) {
  const lines = [heading];
  for (const key of entries) {
    if (!values.has(key)) continue;
    lines.push(`${key}=${values.get(key)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function mergeRestoredEnv({ importedText, targetText, mode = "migration" }) {
  if (mode !== "migration" && mode !== "full") {
    throw new Error("Unsupported environment restore mode");
  }

  const imported = parseEnvDocument(importedText);
  const target = parseEnvDocument(targetText);

  if (mode === "full") {
    return {
      text: renderEnv(imported.entries, imported.values, "# Restored by Tongzhou system backup (full mode)"),
      mode,
      importedKeys: [...imported.entries],
      preservedKeys: [],
      omittedHostKeys: [],
    };
  }

  const outputEntries = [];
  const outputValues = new Map();
  const preservedKeys = [];
  const omittedHostKeys = [];

  for (const key of imported.entries) {
    if (!isHostBoundEnvKey(key)) {
      outputEntries.push(key);
      outputValues.set(key, imported.values.get(key));
      continue;
    }
    if (target.values.has(key)) {
      outputEntries.push(key);
      outputValues.set(key, target.values.get(key));
      preservedKeys.push(key);
    } else {
      omittedHostKeys.push(key);
    }
  }

  for (const key of target.entries) {
    if (!isHostBoundEnvKey(key) || outputValues.has(key)) continue;
    outputEntries.push(key);
    outputValues.set(key, target.values.get(key));
    preservedKeys.push(key);
  }

  return {
    text: renderEnv(outputEntries, outputValues, "# Restored by Tongzhou system backup (migration mode)"),
    mode,
    importedKeys: outputEntries.filter((key) => !preservedKeys.includes(key)),
    preservedKeys,
    omittedHostKeys,
  };
}

export function listEnvKeys(input) {
  return parseEnvDocument(input).entries;
}

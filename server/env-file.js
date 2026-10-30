import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseEnvFileValue(rawValue) {
  const value = String(rawValue ?? "").trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  return value;
}

export function loadEnvFile({
  env = process.env,
  envPath = resolve(process.cwd(), ".env"),
  exists = existsSync,
  read = readFileSync,
} = {}) {
  if (env.SKIP_ENV_FILE === "true" || !exists(envPath)) return;
  const content = read(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key || env[key]) continue;
    env[key] = parseEnvFileValue(line.slice(separator + 1));
  }
}

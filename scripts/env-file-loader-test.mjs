import assert from "node:assert/strict";
import { loadEnvFile, parseEnvFileValue } from "../server/env-file.js";

assert.equal(parseEnvFileValue('"quoted-token"'), "quoted-token");
assert.equal(parseEnvFileValue("'single-quoted-token'"), "single-quoted-token");
assert.equal(parseEnvFileValue("plain-token"), "plain-token");

const env = { EXISTING: "runtime-value" };
loadEnvFile({
  env,
  envPath: "test.env",
  exists: () => true,
  read: () => [
    "# ignored",
    'COLLABORATION_INTERNAL_TOKEN="64-character-production-token"',
    "URL_WITH_QUERY=https://example.test/?a=b",
    "EXISTING=file-value",
  ].join("\r\n"),
});

assert.equal(env.COLLABORATION_INTERNAL_TOKEN, "64-character-production-token");
assert.equal(env.URL_WITH_QUERY, "https://example.test/?a=b");
assert.equal(env.EXISTING, "runtime-value");

console.log("ENV_FILE_LOADER_TEST_OK");

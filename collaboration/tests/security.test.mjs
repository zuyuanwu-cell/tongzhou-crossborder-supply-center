import test from "node:test";
import assert from "node:assert/strict";

process.env.SKIP_ENV_FILE = "true";
process.env.COLLABORATION_SECRET_KEY = "test-secret-key-at-least-thirty-two-characters";
process.env.COLLABORATION_INTERNAL_TOKEN = "test-internal-token-at-least-thirty-two-characters";

const security = await import("../api/security.js");

test("Argon2id password hashes verify and reject invalid passwords", async () => {
  const encoded = await security.hashPassword("SecureWarehouse2026!");
  assert.match(encoded, /^\$argon2id\$/);
  assert.equal(await security.verifyPassword(encoded, "SecureWarehouse2026!"), true);
  assert.equal(await security.verifyPassword(encoded, "wrong-password"), false);
});

test("encrypted MFA secrets round-trip without plaintext storage", () => {
  const encrypted = security.encryptSecret("TOTP-SECRET-EXAMPLE");
  assert.equal(encrypted.includes("TOTP-SECRET-EXAMPLE"), false);
  assert.equal(security.decryptSecret(encrypted), "TOTP-SECRET-EXAMPLE");
});

test("session and CSRF cookies use separate access policies", () => {
  assert.match(security.sessionCookie("token"), /HttpOnly/);
  assert.match(security.sessionCookie("token"), /SameSite=Lax/);
  assert.doesNotMatch(security.csrfCookie("csrf"), /HttpOnly/);
});

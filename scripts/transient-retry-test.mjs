import assert from "node:assert/strict";
import { isTransientIntegrationError, withTransientRetry } from "../server/transient-retry.js";

assert.equal(isTransientIntegrationError(new Error("WMS request failed 502: Bad Gateway")), true);
assert.equal(isTransientIntegrationError(new Error("request timed out")), true);
assert.equal(isTransientIntegrationError(new Error("invalid warehouse code")), false);

let attempts = 0;
const recovered = await withTransientRetry(async () => {
  attempts += 1;
  if (attempts < 3) throw new Error("WMS request failed 502: Bad Gateway");
  return "ok";
}, { attempts: 3, delayMs: 0, sleep: async () => {} });
assert.equal(recovered, "ok");
assert.equal(attempts, 3);

let permanentAttempts = 0;
await assert.rejects(() => withTransientRetry(async () => {
  permanentAttempts += 1;
  throw new Error("invalid warehouse code");
}, { attempts: 3, delayMs: 0, sleep: async () => {} }), /invalid warehouse code/);
assert.equal(permanentAttempts, 1);

console.log("transient retry tests passed");

import assert from "node:assert/strict";
import {
  createLocalUser,
  normalizeStoredUser,
  normalizeUiLocale,
  publicUser,
} from "../server/user-auth.js";

assert.equal(normalizeUiLocale(), "zh-CN");
assert.equal(normalizeUiLocale("zh_cn"), "zh-CN");
assert.equal(normalizeUiLocale("EN-us"), "en");
assert.equal(normalizeUiLocale("id-ID"), "id");

const created = createLocalUser({
  username: "locale-test",
  password: "safe-test-password",
  displayName: "Locale Test",
  role: "direct",
  locale: "id-ID",
});
assert.equal(created.locale, "id");
assert.equal(publicUser(created).locale, "id");

const restored = normalizeStoredUser({ ...created, locale: "en-GB" });
assert.equal(restored.locale, "en");
assert.equal(publicUser(restored).locale, "en");

const legacy = normalizeStoredUser({ ...created, locale: undefined });
assert.equal(legacy.locale, "zh-CN");

console.log("User locale preference tests passed.");

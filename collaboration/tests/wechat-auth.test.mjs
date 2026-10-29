import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

process.env.SKIP_ENV_FILE = "true";
process.env.COLLABORATION_WECHAT_APPID = "wx-test-app";
process.env.COLLABORATION_WECHAT_SECRET = "test-app-secret";

const { exchangeWechatCode } = await import("../api/wechat-auth.js");

test("exchangeWechatCode maps an expired WeChat code to a safe client error", async () => {
  await assert.rejects(
    exchangeWechatCode("expired-code-123", {
      fetchImpl: async () => new Response(JSON.stringify({ errcode: 40029, errmsg: "invalid code" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    (error) => error?.statusCode === 400 && error?.code === "wechat_code_invalid",
  );
});

test("exchangeWechatCode maps a network failure without exposing credentials", async () => {
  await assert.rejects(
    exchangeWechatCode("network-code-123", {
      fetchImpl: async () => { throw new Error("network down"); },
    }),
    (error) => error?.statusCode === 502 && error?.code === "wechat_unavailable" && !String(error.message).includes("test-app-secret"),
  );
});

test("exchangeWechatCode returns only HMAC identities and the migration stores no raw openid", async () => {
  const rawOpenid = "raw-openid-must-not-be-stored";
  const rawUnionid = "raw-unionid-must-not-be-stored";
  const identity = await exchangeWechatCode("valid-code-123", {
    fetchImpl: async () => new Response(JSON.stringify({ openid: rawOpenid, unionid: rawUnionid, session_key: "not-stored" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.match(identity.openidHash, /^[0-9a-f]{64}$/);
  assert.match(identity.unionidHash, /^[0-9a-f]{64}$/);
  assert.notEqual(identity.openidHash, rawOpenid);
  assert.notEqual(identity.unionidHash, rawUnionid);
  assert.equal(JSON.stringify(identity).includes(rawOpenid), false);
  assert.equal(JSON.stringify(identity).includes(rawUnionid), false);

  const migration = readFileSync(fileURLToPath(new URL("../migrations/0017_wechat_login_bindings.sql", import.meta.url)), "utf8");
  assert.match(migration, /openid_hash\s+text\s+NOT NULL/);
  assert.doesNotMatch(migration, /\bopenid\s+text\b/);
  assert.doesNotMatch(migration, /\bsession_key\b\s+text\b/);
});

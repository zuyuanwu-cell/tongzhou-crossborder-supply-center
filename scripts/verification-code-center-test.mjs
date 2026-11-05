import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerificationCodeCenter, extractLoginVerificationCode } from "../server/verification-code-center.js";
import { effectivePermissions, sanitizePermissionUpdate } from "../server/access-control.js";

const root = mkdtempSync(join(tmpdir(), "tongzhou-verification-code-"));
const statePath = join(root, "state.json");
let currentTime = Date.parse("2026-11-05T08:00:00.000Z");
let messages = [];

const mailFetcher = {
  async testConnection() { return { ok: true }; },
  async fetchRecent() { return messages; },
};

const admin = { role: "admin", user: { id: "admin", username: "admin", displayName: "管理员", role: "admin" } };
const operator = { role: "direct", user: { id: "operator-1", username: "ops", displayName: "运营甲", role: "direct" } };
const other = { role: "direct", user: { id: "operator-2", username: "other", displayName: "运营乙", role: "direct" } };

try {
  assert.equal(effectivePermissions(admin.user).includes("verification_code_manage"), true);
  assert.equal(effectivePermissions(operator.user).includes("verification_code_view"), false);
  assert.deepEqual(
    sanitizePermissionUpdate("direct", { allow: ["verification_code_view", "verification_code_manage"] }).allow,
    ["verification_code_view"],
  );
  assert.equal(
    sanitizePermissionUpdate("warehouse", { allow: ["verification_code_view"] }).allow.includes("verification_code_view"),
    false,
  );

  assert.equal(extractLoginVerificationCode({ subject: "店铺登录验证码", text: "您的验证码为 483921，15 分钟有效。" }), "483921");
  assert.equal(extractLoginVerificationCode({ subject: "重置密码验证码", text: "验证码 483921" }), "");
  assert.equal(extractLoginVerificationCode({ subject: "付款验证码", text: "verification code 483921" }), "");
  assert.equal(extractLoginVerificationCode({ subject: "登录验证码", text: "验证码 20261105" }), "");

  const service = createVerificationCodeCenter({
    statePath,
    encryptionKey: "11".repeat(32),
    mailFetcher,
    now: () => currentTime,
    usersProvider: () => [admin.user, operator.user, other.user],
  });

  const mailbox = await service.upsertMailbox({
    label: "运营邮箱",
    address: "ops@example.com",
    host: "imap.example.com",
    port: 993,
    secure: true,
    username: "ops@example.com",
    password: "mail-app-password",
  });
  assert.equal(mailbox.secretConfigured, true);
  assert.equal("encryptedSecret" in mailbox, false);

  const binding = service.upsertBinding({
    mailboxId: mailbox.id,
    platform: "Ozon",
    shopName: "俄罗斯一店",
    shopKey: "ozon-ru-001",
    senderPatterns: ["@ozon.example"],
    subjectKeywords: ["登录验证码"],
    allowedUserIds: [operator.user.id],
  });

  const operatorPayload = service.payload(operator);
  assert.equal(operatorPayload.bindings.length, 1);
  assert.equal(operatorPayload.mailboxes.length, 0);
  assert.equal(service.payload(other).bindings.length, 0);
  await assert.rejects(() => service.createRequest(other, binding.id), /无权获取/);

  messages = [{
    id: "message-1",
    sender: "login@ozon.example",
    subject: "Ozon 店铺登录验证码",
    text: "您的验证码为 483921，请勿转发。",
    receivedAt: new Date(currentTime + 1000).toISOString(),
  }];
  const request = await service.createRequest(operator, binding.id);
  assert.equal(request.status, "ready");

  const readyPayload = service.payload(operator);
  assert.equal(readyPayload.requests[0].maskedCode, "••••21");
  assert.equal(JSON.stringify(readyPayload).includes("483921"), false);
  assert.equal(service.revealCode(operator, request.id, "copy").code, "483921");

  const stored = readFileSync(statePath, "utf8");
  assert.equal(stored.includes("483921"), false);
  assert.equal(stored.includes("mail-app-password"), false);
  assert.equal(stored.includes("encryptedCode"), true);

  currentTime += 2000;
  const second = await service.createRequest(admin, binding.id);
  assert.equal(second.status, "pending", "已经消费过的邮件不得再次匹配给另一个请求");

  const adminPayload = service.payload(admin, { manage: true });
  assert.equal(adminPayload.mailboxes.length, 1);
  assert.equal(adminPayload.users.length, 3);
  assert.equal(JSON.stringify(adminPayload).includes("mail-app-password"), false);

  console.log("VERIFICATION_CODE_CENTER_TEST_OK");
} finally {
  rmSync(root, { recursive: true, force: true });
}

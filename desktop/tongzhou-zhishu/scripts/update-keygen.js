"use strict";

// 生成自动更新的签名密钥（只需要做一次，在负责打包发版的电脑上执行）。
// - 私钥：保存在用户目录 ~/.tongzhou-zhishu/update-private-key.pem，不进 Git、不上传服务器；
// - 公钥：写入 core/update-key.json，需要提交到 Git（会随安装包和中台一起发布）。
// 私钥丢失后，已安装的节点无法再自动更新，只能重新生成密钥并手动安装一次完整包。
// 用法：npm run update:keygen

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const privateFile = process.env.TZZS_UPDATE_PRIVATE_KEY || path.join(os.homedir(), ".tongzhou-zhishu", "update-private-key.pem");
const publicFile = path.join(__dirname, "..", "core", "update-key.json");

if (fs.existsSync(privateFile)) {
  const publicKey = crypto.createPublicKey(fs.readFileSync(privateFile, "utf8")).export({ type: "spki", format: "der" }).toString("base64");
  const current = JSON.parse(fs.readFileSync(publicFile, "utf8")).publicKey;
  if (current === publicKey) {
    console.log(`密钥已存在且与 core/update-key.json 一致，无需重新生成：${privateFile}`);
    process.exit(0);
  }
  if (!current) {
    fs.writeFileSync(publicFile, `${JSON.stringify({ publicKey }, null, 2)}\n`);
    console.log(`已用现有私钥写入公钥：${publicFile}`);
    process.exit(0);
  }
  console.error(`私钥已存在（${privateFile}），但和 core/update-key.json 里的公钥不一致。为避免误覆盖，已停止。`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.mkdirSync(path.dirname(privateFile), { recursive: true });
fs.writeFileSync(privateFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
fs.writeFileSync(publicFile, `${JSON.stringify({ publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64") }, null, 2)}\n`);
console.log(`私钥已保存：${privateFile}（请备份到安全的地方，不要提交到 Git，不要放到服务器）`);
console.log(`公钥已写入：${publicFile}（请提交到 Git）`);

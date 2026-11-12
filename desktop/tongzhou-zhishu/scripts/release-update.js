"use strict";

// 生成并（可选）发布同舟智数的自动更新包。
// 用法：
//   npm run release:update                      只生成 dist/update-<版本>.bundle 和 .json
//   npm run release:update -- --publish         生成后上传到中台（需要环境变量 COLLECTOR_RELEASE_TOKEN）
//   可选：--notes "更新说明"   --url https://gyl.tongzhoukuajing.com（或环境变量 TZZS_RELEASE_URL）
// 签名私钥默认在 ~/.tongzhou-zhishu/update-private-key.pem（npm run update:keygen 生成）。
// 上传后新版本不会立刻推给所有节点：在中台「采集中心 → 版本更新」先推给试跑节点。

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildBundle, signBundle, verifyBundle, sha256 } = require("../core/updater");

const root = path.resolve(__dirname, "..");
const pkg = require(path.join(root, "package.json"));
const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

function collect(dir, base = dir) {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, collect(full, base));
    else out[path.relative(base, full).split(path.sep).join("/")] = fs.readFileSync(full);
  }
  return out;
}

async function main() {
  const privateFile = process.env.TZZS_UPDATE_PRIVATE_KEY || path.join(os.homedir(), ".tongzhou-zhishu", "update-private-key.pem");
  if (!fs.existsSync(privateFile)) throw new Error(`没有找到签名私钥：${privateFile}。第一次发版前先执行 npm run update:keygen`);
  const privateKey = fs.readFileSync(privateFile, "utf8");
  const publicKey = JSON.parse(fs.readFileSync(path.join(root, "core", "update-key.json"), "utf8")).publicKey;
  const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  if (!publicKey) throw new Error("core/update-key.json 里还没有公钥，先执行 npm run update:keygen 并提交");
  if (publicKey !== derived) throw new Error("签名私钥和 core/update-key.json 里的公钥不是一对，已停止（用错私钥发出去的包节点不会接受）");

  // 与安装包里 resources/app 的内容一致（bootstrap.js 属于外壳，不在更新包里）。
  const { devDependencies, scripts, ...runtimePkg } = pkg;
  const files = { "main.js": fs.readFileSync(path.join(root, "main.js")), "preload.js": fs.readFileSync(path.join(root, "preload.js")), "package.json": Buffer.from(JSON.stringify(runtimePkg, null, 2)) };
  for (const dir of ["core", "ui", "build"]) {
    for (const [name, content] of Object.entries(collect(path.join(root, dir)))) files[`${dir}/${name}`] = content;
  }
  const electron = String(pkg.devDependencies.electron).replace(/^[^\d]*/, "").split(".")[0];
  const bundle = buildBundle({ version: pkg.version, electron, files });
  const manifest = {
    version: pkg.version,
    electron,
    sha256: sha256(bundle),
    size: bundle.length,
    signature: signBundle(bundle, privateKey),
    notes: option("--notes"),
    createdAt: new Date().toISOString(),
  };
  verifyBundle(bundle, manifest, publicKey);

  const outDir = path.join(root, "dist");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `update-${pkg.version}.bundle`), bundle);
  fs.writeFileSync(path.join(outDir, `update-${pkg.version}.json`), JSON.stringify(manifest, null, 2));
  console.log(`更新包已生成：dist/update-${pkg.version}.bundle（${(bundle.length / 1024).toFixed(0)} KB，${Object.keys(files).length} 个文件）`);

  if (!args.includes("--publish")) return;
  const token = process.env.COLLECTOR_RELEASE_TOKEN || "";
  if (token.length < 24) throw new Error("上传需要环境变量 COLLECTOR_RELEASE_TOKEN（与服务器上配置的一致，至少 24 位）");
  if (typeof fetch !== "function") throw new Error("上传需要 Node 18 或以上");
  const base = String(option("--url", process.env.TZZS_RELEASE_URL || "https://gyl.tongzhoukuajing.com")).replace(/\/+$/, "");
  const response = await fetch(`${base}/api/collector/releases`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-release-token": token },
    body: JSON.stringify({ manifest, bundle: bundle.toString("base64") }),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok || !json?.ok) throw new Error(`上传失败：${json?.message || `HTTP ${response.status}`}`);
  console.log(`已上传到 ${base}：${pkg.version}。当前推送状态：${json.rollout?.label || json.rollout?.mode || ""}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function fail(message) {
  console.error(`[frontend-release] FAIL: ${message}`);
  process.exitCode = 1;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label}无法读取：${filePath}（${error.message}）`);
  }
}

function walkFiles(rootDirectory) {
  const output = [];
  const pending = [rootDirectory];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolutePath);
      else if (entry.isFile()) output.push(absolutePath);
    }
  }
  return output;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countOccurrences(text, marker) {
  if (!marker) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(marker, offset)) >= 0) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

function inspectDistribution(directory) {
  const root = path.resolve(directory);
  const indexPath = path.join(root, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`缺少 index.html：${indexPath}`);

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const referencedAssets = [];
  const referencePattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of indexHtml.matchAll(referencePattern)) {
    const reference = match[1];
    if (/^(?:https?:|data:|#)/i.test(reference)) continue;
    const normalized = reference.replace(/[?#].*$/, "").replace(/^\//, "");
    if (!normalized) continue;
    const absolutePath = path.join(root, normalized);
    referencedAssets.push({ reference, absolutePath });
  }

  for (const asset of referencedAssets) {
    if (!fs.existsSync(asset.absolutePath)) fail(`index.html 引用了不存在的资源：${asset.reference}`);
    else if (fs.statSync(asset.absolutePath).size === 0) fail(`资源为空文件：${asset.reference}`);
  }

  const scriptReferences = Array.from(indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi))
    .map((match) => match[1].replace(/[?#].*$/, "").replace(/^\//, ""))
    .map((reference) => path.join(root, reference));
  const entryJavaScript = scriptReferences.filter((filePath) => filePath.endsWith(".js") && fs.existsSync(filePath));
  if (!entryJavaScript.length) fail("index.html 没有引用入口 JavaScript");

  const reachableAssets = new Set(
    referencedAssets
      .map((asset) => asset.absolutePath)
      .filter((filePath) => /\.(?:js|css)$/i.test(filePath) && fs.existsSync(filePath)),
  );
  const pendingJavaScript = [...reachableAssets].filter((filePath) => filePath.endsWith(".js"));
  while (pendingJavaScript.length) {
    const currentFile = pendingJavaScript.pop();
    const source = fs.readFileSync(currentFile, "utf8");
    for (const match of source.matchAll(/["']([^"']+\.(?:js|css))["']/g)) {
      const reference = match[1].replace(/[?#].*$/, "");
      const candidates = reference.startsWith("/")
        ? [path.join(root, reference.replace(/^\//, ""))]
        : [path.resolve(path.dirname(currentFile), reference), path.join(root, reference)];
      const dependency = candidates.find((filePath) => fs.existsSync(filePath));
      if (!dependency || reachableAssets.has(dependency)) continue;
      reachableAssets.add(dependency);
      if (dependency.endsWith(".js")) pendingJavaScript.push(dependency);
    }
  }

  const files = walkFiles(root);
  const jsFiles = [...reachableAssets].filter((filePath) => filePath.endsWith(".js"));
  const cssFiles = [...reachableAssets].filter((filePath) => filePath.endsWith(".css"));
  const jsText = jsFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
  const cssText = cssFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
  const searchableText = `${indexHtml}\n${jsText}\n${cssText}`;

  return {
    root,
    indexPath,
    indexHtml,
    files,
    jsFiles,
    cssFiles,
    entryJavaScript,
    searchableText,
    entryJavaScriptBytes: entryJavaScript.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
    totalJavaScriptBytes: jsFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
    totalCssBytes: cssFiles.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0),
  };
}

function ratioCheck(label, candidateValue, baselineValue, minimumRatio) {
  if (!baselineValue) return;
  const ratio = candidateValue / baselineValue;
  if (ratio < minimumRatio) {
    fail(`${label}相对线上基线仅保留 ${(ratio * 100).toFixed(1)}%，最低要求 ${(minimumRatio * 100).toFixed(1)}%`);
  }
}

const args = parseArguments(process.argv.slice(2));
const candidateDirectory = args.candidate || "dist";
const contractPath = path.resolve(args.contract || "config/production-ui-contract.json");

let contract;
let candidate;
let baseline = null;

try {
  contract = readJson(contractPath, "前端契约");
  candidate = inspectDistribution(candidateDirectory);
  if (args.baseline) baseline = inspectDistribution(args.baseline);
} catch (error) {
  fail(error.message);
  process.exit();
}

if (!candidate.indexHtml.includes(`<title>${contract.applicationTitle}</title>`)) {
  fail(`页面标题必须为“${contract.applicationTitle}”`);
}

for (const [metric, minimum] of Object.entries(contract.minimums || {})) {
  const actual = Number(candidate[metric] || 0);
  if (actual < Number(minimum || 0)) fail(`${metric}=${actual}，低于安全下限 ${minimum}`);
}

const protectedMarkers = new Set();
for (const feature of contract.features || []) {
  const missing = (feature.allOf || []).filter((marker) => {
    protectedMarkers.add(marker);
    return !candidate.searchableText.includes(marker);
  });
  if (missing.length) fail(`${feature.description || feature.id} 缺少关键标记：${missing.join("、")}`);

  if (feature.anyOf?.length) {
    feature.anyOf.forEach((marker) => protectedMarkers.add(marker));
    if (!feature.anyOf.some((marker) => candidate.searchableText.includes(marker))) {
      fail(`${feature.description || feature.id} 未命中任一候选标记：${feature.anyOf.join("、")}`);
    }
  }
}

for (const marker of contract.forbiddenText || []) {
  if (candidate.searchableText.includes(marker)) fail(`构建产物包含禁止文本：${JSON.stringify(marker)}`);
}

if (baseline) {
  const retention = contract.baselineRetention || {};
  ratioCheck("入口 JavaScript", candidate.entryJavaScriptBytes, baseline.entryJavaScriptBytes, Number(retention.minimumEntryJavaScriptRatio || 0));
  ratioCheck("全部 JavaScript", candidate.totalJavaScriptBytes, baseline.totalJavaScriptBytes, Number(retention.minimumTotalJavaScriptRatio || 0));
  ratioCheck("全部 CSS", candidate.totalCssBytes, baseline.totalCssBytes, Number(retention.minimumTotalCssRatio || 0));

  const markerRatio = Number(retention.minimumProtectedMarkerRatio || 0);
  for (const marker of protectedMarkers) {
    const baselineCount = countOccurrences(baseline.searchableText, marker);
    const candidateCount = countOccurrences(candidate.searchableText, marker);
    if (baselineCount && candidateCount / baselineCount < markerRatio) {
      fail(`关键标记“${marker}”由线上 ${baselineCount} 处降为 ${candidateCount} 处`);
    }
  }
}

const manifest = {
  schemaVersion: 1,
  verifiedAt: new Date().toISOString(),
  sourceCommit: args.commit || process.env.DEPLOY_TARGET_COMMIT || "unknown",
  contract: path.basename(contractPath),
  metrics: {
    entryJavaScriptBytes: candidate.entryJavaScriptBytes,
    totalJavaScriptBytes: candidate.totalJavaScriptBytes,
    totalCssBytes: candidate.totalCssBytes,
  },
  assets: candidate.files
    .filter((filePath) => /\.(?:html|js|css)$/i.test(filePath))
    .map((filePath) => ({
      path: path.relative(candidate.root, filePath).replaceAll(path.sep, "/"),
      bytes: fs.statSync(filePath).size,
      sha256: sha256(filePath),
    }))
    .sort((left, right) => left.path.localeCompare(right.path)),
};

if (args["write-manifest"]) {
  const outputPath = path.resolve(String(args["write-manifest"]));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

if (process.exitCode) process.exit();

console.log("[frontend-release] PASS");
console.log(JSON.stringify(manifest.metrics));

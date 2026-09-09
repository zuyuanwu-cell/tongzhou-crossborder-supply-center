import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetch } from "undici";

function loadLocalAccessCode() {
  const rows = readFileSync(resolve(process.cwd(), ".env"), "utf8").split(/\r?\n/);
  for (const row of rows) {
    const line = row.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== "INTERNAL_ACCESS_CODE") continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

const baseUrl = process.env.LOCAL_API_BASE_URL || "http://127.0.0.1:8787";
const accessCode = process.env.INTERNAL_ACCESS_CODE || loadLocalAccessCode();
if (!accessCode) throw new Error("未配置本地内部访问码，无法执行登录态性能检查。");

const login = await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: accessCode }),
});
if (!login.ok) throw new Error(`本地登录失败（HTTP ${login.status}）。`);
const loginPayload = await login.json();
const token = String(loginPayload.token || "");
if (!token) throw new Error("本地登录未返回会话令牌。");

async function timed(path) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const bytes = (await response.arrayBuffer()).byteLength;
  return {
    path,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
    responseKb: Math.round(bytes / 1024),
  };
}

async function payloadProfile(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json();
  return Object.fromEntries(Object.entries(payload)
    .map(([key, value]) => [key, {
      rows: Array.isArray(value) ? value.length : undefined,
      kb: Math.round(Buffer.byteLength(JSON.stringify(value ?? null)) / 1024),
    }])
    .filter(([, value]) => value.kb >= 10)
    .sort(([, left], [, right]) => right.kb - left.kb));
}

const movementAndSession = await Promise.all([timed("/api/movement"), timed("/api/me")]);
const analysisAndSession = await Promise.all([timed("/api/order-analysis"), timed("/api/me")]);
const stockupViews = await Promise.all([
  timed("/api/stockup?view=dashboard"),
  timed("/api/stockup?view=production"),
  timed("/api/stockup?view=stockup-recommendations&inboundLimit=100"),
]);
const warm = await Promise.all([timed("/api/movement"), timed("/api/order-analysis")]);
const stockupRecommendationProfile = await payloadProfile("/api/stockup?view=stockup-recommendations");
const movementProfile = await payloadProfile("/api/movement");

console.log(JSON.stringify({ movementAndSession, analysisAndSession, stockupViews, warm, stockupRecommendationProfile, movementProfile }, null, 2));

const requests = [...movementAndSession, ...analysisAndSession, ...stockupViews, ...warm];
const failedRequest = requests.find((item) => item.status !== 200);
if (failedRequest) throw new Error(`${failedRequest.path} 返回 HTTP ${failedRequest.status}。`);
const blockedSession = [movementAndSession[1], analysisAndSession[1]].find((item) => item.durationMs > 200);
if (blockedSession) throw new Error(`重计算期间登录态接口耗时 ${blockedSession.durationMs}ms，超过 200ms 门槛。`);
const recommendationView = stockupViews.find((item) => item.path.includes("stockup-recommendations"));
if (recommendationView && recommendationView.responseKb > 500) {
  throw new Error(`备货建议首屏响应 ${recommendationView.responseKb}KB，超过 500KB 门槛。`);
}
const slowWarmRequest = warm.find((item) => item.durationMs > 500);
if (slowWarmRequest) throw new Error(`${slowWarmRequest.path} 热查询耗时 ${slowWarmRequest.durationMs}ms，超过 500ms 门槛。`);

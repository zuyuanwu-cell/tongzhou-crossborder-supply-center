import { createHmac } from "node:crypto";

export const MIAOSHOU_BASE_URL = "https://openapi-erp.91miaoshou.com";

export const MIAOSHOU_PATHS = {
  shops: "/open/v1/product/shop/shop/get_shop_list",
  packages: "/open/v1/order/package/fetch/search_package_list",
  applyTrackingNo: "/open/v1/order/package/logistics/tracking_no/apply",
  waybill: "/open/v1/order/package/logistics/waybill/get_waybill",
};

function nonEmpty(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`缺少${label}`);
  return text;
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || MIAOSHOU_BASE_URL).trim().replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("妙手 API 地址必须使用 HTTPS");
  }
  return baseUrl;
}

export function buildMiaoshouSignature({ appSecret, path, timestamp, appKey, bodyText }) {
  const secret = nonEmpty(appSecret, "妙手 AppSecret");
  const content = `${secret}${path}${timestamp}${appKey}${bodyText}${secret}`;
  return createHmac("sha256", secret).update(content, "utf8").digest("hex");
}

function responseIndicatesFailure(payload) {
  const result = String(payload?.result ?? "").trim().toLowerCase();
  if (["fail", "failed", "failure", "error"].includes(result)) return true;
  if (["success", "ok", "true"].includes(result)) return false;
  const code = String(payload?.code ?? "").trim().toLowerCase();
  return Boolean(code && !["0", "200", "success", "ok"].includes(code));
}

export class MiaoshouApiError extends Error {
  constructor(message, { code = "", status = 0, retryable = false, ambiguous = false, payload = null } = {}) {
    super(message);
    this.name = "MiaoshouApiError";
    this.code = String(code || "");
    this.status = Number(status || 0);
    this.retryable = Boolean(retryable);
    this.ambiguous = Boolean(ambiguous);
    this.payload = payload;
  }
}

export function createMiaoshouClient({
  appKey,
  appSecret,
  baseUrl = MIAOSHOU_BASE_URL,
  timeoutMs = 25_000,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const safeAppKey = nonEmpty(appKey, "妙手 AppKey");
  const safeAppSecret = nonEmpty(appSecret, "妙手 AppSecret");
  const safeBaseUrl = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持网络请求");

  async function request(path, body = {}) {
    const timestamp = String(Math.floor(now() / 1000));
    const bodyText = JSON.stringify(body ?? {});
    const signature = buildMiaoshouSignature({
      appSecret: safeAppSecret,
      path,
      timestamp,
      appKey: safeAppKey,
      bodyText,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${safeBaseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-app-key": safeAppKey,
          "x-timestamp": timestamp,
          "x-sign": signature,
        },
        body: bodyText,
        signal: controller.signal,
      });
    } catch (error) {
      const timeout = error?.name === "AbortError";
      throw new MiaoshouApiError(timeout ? "妙手接口请求超时" : `妙手接口连接失败：${error?.message || "未知错误"}`, {
        code: timeout ? "timeout" : "network_error",
        retryable: false,
        ambiguous: true,
      });
    } finally {
      clearTimeout(timer);
    }

    const responseText = await response.text();
    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new MiaoshouApiError(`妙手接口返回了非 JSON 内容（HTTP ${response.status}）`, {
        code: "invalid_json",
        status: response.status,
        retryable: response.status >= 500,
      });
    }
    if (!response.ok || responseIndicatesFailure(payload)) {
      const code = payload?.code || `http_${response.status}`;
      const message = payload?.message || payload?.msg || `妙手接口请求失败（HTTP ${response.status}）`;
      const retryable = response.status === 429 || response.status >= 500 || /频率|限流|稍后|超时|系统繁忙/.test(message);
      throw new MiaoshouApiError(message, { code, status: response.status, retryable, payload });
    }
    return payload;
  }

  return {
    request,
    getShops(input) {
      return request(MIAOSHOU_PATHS.shops, input);
    },
    searchPackages(input) {
      return request(MIAOSHOU_PATHS.packages, input);
    },
    applyTrackingNo(opOrderPackageId) {
      return request(MIAOSHOU_PATHS.applyTrackingNo, { opOrderPackageId: Number(opOrderPackageId) });
    },
    getWaybill(opOrderPackageId) {
      return request(MIAOSHOU_PATHS.waybill, { opOrderPackageId: String(opOrderPackageId) });
    },
  };
}

#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import https from "node:https";

function envValue(name) {
  if (process.env[name]) return String(process.env[name]).trim();
  if (!fs.existsSync(".env")) return "";
  for (const rawLine of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1 || line.slice(0, separator).trim() !== name) continue;
    const value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
    return value;
  }
  return "";
}

function fail(message) {
  throw new Error(`[ui-smoke] ${message}`);
}

function request(baseUrl, pathname, { method = "GET", token = "", body } = {}) {
  const url = new URL(pathname, baseUrl);
  const transport = url.protocol === "https:" ? https : http;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const requestHandle = transport.request(url, {
      method,
      timeout: 20_000,
      headers: {
        Accept: "application/json, text/html;q=0.9",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: Number(response.statusCode || 0),
        contentType: String(response.headers["content-type"] || ""),
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    requestHandle.on("timeout", () => requestHandle.destroy(new Error(`request timed out: ${pathname}`)));
    requestHandle.on("error", reject);
    if (payload) requestHandle.write(payload);
    requestHandle.end();
  });
}

function json(response, label) {
  if (response.status < 200 || response.status >= 300) fail(`${label} returned HTTP ${response.status}`);
  try { return JSON.parse(response.text); }
  catch { fail(`${label} did not return JSON`); }
}

const baseUrl = envValue("DEPLOY_UI_BASE_URL") || "http://127.0.0.1:8787";
const accessCode = envValue("INTERNAL_ACCESS_CODE");
if (!accessCode) fail("INTERNAL_ACCESS_CODE is unavailable; authenticated smoke cannot run");

const root = await request(baseUrl, "/");
if (root.status !== 200 || !root.contentType.includes("text/html") || !/<script\b[^>]+src=/i.test(root.text)) fail("frontend shell is unavailable");

const login = json(await request(baseUrl, "/api/login", { method: "POST", body: { code: accessCode } }), "login");
if (!login.ok || !login.token || login.user?.role !== "admin") fail("internal smoke login did not produce an administrator session");

const me = json(await request(baseUrl, "/api/me", { token: login.token }), "current user");
if (!me.ok || me.user?.role !== "admin") fail("authenticated administrator session is not usable");

const dashboard = json(await request(baseUrl, "/api/dashboard-summary", { token: login.token }), "operations workbench");
const currencies = new Set((dashboard.marketSnapshot?.items || []).map((item) => String(item.currency || "").toUpperCase()));
for (const currency of ["RUB", "IDR", "MYR", "VND"]) if (!currencies.has(currency)) fail(`operations workbench is missing ${currency} market/time data`);

const products = json(await request(baseUrl, "/api/products?mode=list", { token: login.token }), "product library");
if (!products.ok || !Array.isArray(products.catalog) || !products.counts || !Number.isFinite(Number(products.counts.visibleCatalog))) fail("product-library payload is incomplete");

console.log(`[ui-smoke] PASS admin=${me.user.username || me.user.id || "internal"} markets=${currencies.size} products=${products.counts.visibleCatalog}`);

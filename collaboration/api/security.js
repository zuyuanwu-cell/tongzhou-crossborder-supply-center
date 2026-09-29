import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import { collaborationConfig } from "./config.js";

const encryptionKey = createHash("sha256").update(collaborationConfig.secretKey).digest();

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function tokenHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hashPassword(password) {
  return hash(String(password), {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

export async function verifyPassword(encoded, password) {
  try {
    return await verify(String(encoded || ""), String(password || ""));
  } catch {
    return false;
  }
}

export function validateNewPassword(password) {
  const value = String(password || "");
  if (value.length < 12) throw Object.assign(new Error("密码至少需要 12 位。"), { statusCode: 400, code: "weak_password" });
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw Object.assign(new Error("密码必须同时包含字母和数字。"), { statusCode: 400, code: "weak_password" });
  return value;
}

export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value) {
  const [ivText, tagText, ciphertextText] = String(value || "").split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted secret.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export function createTotpSecret() {
  return authenticator.generateSecret();
}

export function totpUri(username, organizationName, secret) {
  return authenticator.keyuri(username, `同舟协同 · ${organizationName}`, secret);
}

export function verifyTotp(secret, token) {
  try {
    return authenticator.verify({ token: String(token || "").replace(/\s+/g, ""), secret });
  } catch {
    return false;
  }
}

export function parseCookies(header = "") {
  return Object.fromEntries(String(header).split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return ["", ""];
    return [decodeURIComponent(part.slice(0, separator).trim()), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

export function sessionCookie(value, maxAgeSeconds = 12 * 60 * 60) {
  return `tz_collab_session=${encodeURIComponent(value)}; Path=/collaboration; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${collaborationConfig.cookieSecure ? "; Secure" : ""}`;
}

export function csrfCookie(value, maxAgeSeconds = 12 * 60 * 60) {
  return `tz_collab_csrf=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${collaborationConfig.cookieSecure ? "; Secure" : ""}`;
}

export function clearLegacyCsrfCookie() {
  const secure = collaborationConfig.cookieSecure ? "; Secure" : "";
  return `tz_collab_csrf=; Path=/collaboration; SameSite=Lax; Max-Age=0${secure}`;
}

export function clearSessionCookies() {
  const secure = collaborationConfig.cookieSecure ? "; Secure" : "";
  return [
    `tz_collab_session=; Path=/collaboration; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `tz_collab_csrf=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
    clearLegacyCsrfCookie(),
  ];
}

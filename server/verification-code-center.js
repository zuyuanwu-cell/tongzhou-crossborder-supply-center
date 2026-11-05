import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const CODE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TTL_MS = 5 * 60 * 1000;
const MESSAGE_LOOKBACK_MS = 3 * 60 * 1000;
const BLOCKED_MESSAGE_PATTERN = /(重置密码|修改密码|找回密码|绑定手机|更换手机|支付密码|付款|提现|银行卡|收款账户|reset\s+password|change\s+password|payment|withdraw|bank\s+account)/i;
const CODE_CONTEXT_PATTERN = /(验证码|动态码|校验码|登录码|verification\s*code|one[-\s]*time\s*(?:password|code)|\botp\b)/i;
const CONTEXT_CODE_PATTERNS = [
  /(?:验证码|动态码|校验码|登录码)[^A-Z0-9]{0,24}([A-Z0-9]{4,8})/i,
  /(?:verification\s*code|one[-\s]*time\s*(?:password|code)|\botp\b)[^A-Z0-9]{0,24}([A-Z0-9]{4,8})/i,
  /\b([0-9]{4,8})\b/,
];

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function uniqueStrings(values, maxItems = 50, maxLength = 120) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, maxLength))
    .filter(Boolean)))
    .slice(0, maxItems);
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function parseEncryptionKey(raw) {
  const value = text(raw, 500);
  if (!value) return null;
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to the explicit configuration error below.
  }
  throw new Error("VERIFICATION_CODE_ENCRYPTION_KEY 必须是 32 字节 Base64 或 64 位十六进制密钥。");
}

function encryptString(value, key) {
  if (!key) throw Object.assign(new Error("验证码中心尚未配置服务端加密密钥。"), { statusCode: 503, code: "encryption_key_missing" });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

function decryptString(value, key) {
  if (!key) throw Object.assign(new Error("验证码中心尚未配置服务端加密密钥。"), { statusCode: 503, code: "encryption_key_missing" });
  const [version, ivValue, tagValue, encryptedValue] = String(value || "").split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("加密数据格式无效。");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
}

function normalizeHost(value) {
  const host = text(value, 255).toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || isIP(host)) {
    throw Object.assign(new Error("请输入公开邮箱服务的 IMAP 主机名，不支持本机地址或 IP。"), { statusCode: 400 });
  }
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) {
    throw Object.assign(new Error("IMAP 主机名格式不正确。"), { statusCode: 400 });
  }
  return host;
}

function isPrivateAddress(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized) return true;
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return false;
  const octets = ipv4.split(".").map(Number);
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] >= 224;
}

async function assertPublicMailHost(host) {
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
    throw Object.assign(new Error("IMAP 主机解析到了内网或保留地址，已拒绝连接。"), { statusCode: 400, code: "private_mail_host" });
  }
}

function normalizeMailbox(input, existing = null) {
  const port = Number(input.port ?? existing?.port ?? 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("IMAP 端口无效。"), { statusCode: 400 });
  const address = text(input.address ?? existing?.address, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw Object.assign(new Error("邮箱地址格式不正确。"), { statusCode: 400 });
  const username = text(input.username ?? existing?.username ?? address, 254);
  if (!username) throw Object.assign(new Error("请输入 IMAP 登录账号。"), { statusCode: 400 });
  return {
    label: text(input.label ?? existing?.label, 80) || address,
    address,
    host: normalizeHost(input.host ?? existing?.host),
    port,
    secure: input.secure === undefined ? existing?.secure !== false : input.secure !== false,
    username,
    enabled: input.enabled === undefined ? existing?.enabled !== false : input.enabled !== false,
  };
}

function normalizeBinding(input, existing = null) {
  const senderPatterns = uniqueStrings(input.senderPatterns ?? existing?.senderPatterns, 20, 120).map((item) => item.toLowerCase());
  const subjectKeywords = uniqueStrings(input.subjectKeywords ?? existing?.subjectKeywords, 20, 60);
  if (!senderPatterns.length) throw Object.assign(new Error("请至少填写一个验证码邮件发件人或域名。"), { statusCode: 400 });
  if (!subjectKeywords.length) throw Object.assign(new Error("请至少填写一个验证码邮件主题关键词。"), { statusCode: 400 });
  const platform = text(input.platform ?? existing?.platform, 60);
  const shopName = text(input.shopName ?? existing?.shopName, 100);
  const shopKey = text(input.shopKey ?? existing?.shopKey, 120).toLowerCase();
  if (!platform || !shopName || !shopKey) throw Object.assign(new Error("平台、店铺名称和店铺标识不能为空。"), { statusCode: 400 });
  return {
    mailboxId: text(input.mailboxId ?? existing?.mailboxId, 80),
    platform,
    shopName,
    shopKey,
    senderPatterns,
    subjectKeywords,
    allowedUserIds: uniqueStrings(input.allowedUserIds ?? existing?.allowedUserIds, 200, 100),
    enabled: input.enabled === undefined ? existing?.enabled !== false : input.enabled !== false,
  };
}

function emptyState() {
  return { version: 1, mailboxes: [], bindings: [], requests: [], codes: [], updatedAt: "" };
}

function loadState(path) {
  if (!path || !existsSync(path)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: 1,
      mailboxes: Array.isArray(parsed.mailboxes) ? parsed.mailboxes : [],
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
      updatedAt: text(parsed.updatedAt, 40),
    };
  } catch {
    return emptyState();
  }
}

function saveState(path, state) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

function sanitizeMailbox(mailbox) {
  return {
    id: mailbox.id,
    label: mailbox.label,
    address: mailbox.address,
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure !== false,
    username: mailbox.username,
    enabled: mailbox.enabled !== false,
    secretConfigured: Boolean(mailbox.encryptedSecret),
    lastSyncedAt: mailbox.lastSyncedAt || "",
    lastSuccessAt: mailbox.lastSuccessAt || "",
    lastError: mailbox.lastError || "",
    createdAt: mailbox.createdAt || "",
    updatedAt: mailbox.updatedAt || "",
  };
}

function senderMatches(sender, patterns) {
  const normalized = String(sender || "").toLowerCase();
  return patterns.some((pattern) => normalized === pattern || normalized.includes(pattern.startsWith("@") ? pattern : pattern));
}

function subjectMatches(subject, keywords) {
  const normalized = String(subject || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(String(keyword).toLowerCase()));
}

export function extractLoginVerificationCode(message) {
  const subject = String(message?.subject || "");
  const body = String(message?.text || "");
  const combined = `${subject}\n${body}`.slice(0, 30_000);
  if (!CODE_CONTEXT_PATTERN.test(combined) || BLOCKED_MESSAGE_PATTERN.test(combined)) return "";
  for (const pattern of CONTEXT_CODE_PATTERNS) {
    const match = combined.match(pattern);
    const code = String(match?.[1] || "").toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) continue;
    if (/^(?:19|20)\d{6}$/.test(code)) continue;
    return code;
  }
  return "";
}

export function createImapMailFetcher() {
  return {
    async testConnection(mailbox, password) {
      await assertPublicMailHost(mailbox.host);
      const client = new ImapFlow({
        host: mailbox.host,
        port: mailbox.port,
        secure: mailbox.secure !== false,
        auth: { user: mailbox.username, pass: password },
        logger: false,
        disableAutoIdle: true,
        tls: { rejectUnauthorized: true },
      });
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX", { readOnly: true });
        lock.release();
      } finally {
        try { await client.logout(); } catch { /* best effort */ }
      }
      return { ok: true };
    },
    async fetchRecent(mailbox, password, since) {
      await assertPublicMailHost(mailbox.host);
      const client = new ImapFlow({
        host: mailbox.host,
        port: mailbox.port,
        secure: mailbox.secure !== false,
        auth: { user: mailbox.username, pass: password },
        logger: false,
        disableAutoIdle: true,
        tls: { rejectUnauthorized: true },
      });
      const messages = [];
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX", { readOnly: true });
        try {
          const uids = await client.search({ since: new Date(since) }, { uid: true });
          const recentUids = uids.slice(-30);
          if (recentUids.length) {
            for await (const item of client.fetch(recentUids, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
              if (!item.source || item.source.length > 2 * 1024 * 1024) continue;
              const parsed = await simpleParser(item.source, { skipHtmlToText: false, skipImageLinks: true });
              messages.push({
                id: text(parsed.messageId || `${mailbox.id}:${item.uid}`, 255),
                uid: item.uid,
                sender: text(parsed.from?.value?.[0]?.address || item.envelope?.from?.[0]?.address, 254).toLowerCase(),
                subject: text(parsed.subject || item.envelope?.subject, 500),
                text: text(parsed.text || parsed.html || "", 30_000),
                receivedAt: new Date(parsed.date || item.internalDate || Date.now()).toISOString(),
              });
            }
          }
        } finally {
          lock.release();
        }
      } finally {
        try { await client.logout(); } catch { /* best effort */ }
      }
      return messages;
    },
  };
}

export function createVerificationCodeCenter(options = {}) {
  const now = options.now || Date.now;
  const statePath = options.statePath || "";
  const encryptionKey = parseEncryptionKey(options.encryptionKey || "");
  const mailFetcher = options.mailFetcher || createImapMailFetcher();
  const usersProvider = options.usersProvider || (() => []);
  let state = loadState(statePath);
  let timer = null;
  let syncing = false;

  function persist() {
    state.updatedAt = nowIso(now);
    saveState(statePath, state);
  }

  function cleanup() {
    const current = now();
    const before = `${state.requests.length}/${state.codes.length}`;
    state.requests = state.requests.filter((request) => new Date(request.expiresAt).getTime() > current || request.status === "ready");
    state.codes = state.codes.filter((code) => new Date(code.expiresAt).getTime() > current);
    const validCodeIds = new Set(state.codes.map((code) => code.id));
    state.requests = state.requests.filter((request) => request.status !== "ready" || validCodeIds.has(request.codeId));
    const after = `${state.requests.length}/${state.codes.length}`;
    if (before !== after) persist();
  }

  function canAccessBinding(auth, binding) {
    if (!auth?.user?.id || binding?.enabled === false) return false;
    if (auth.role === "admin") return true;
    return (binding.allowedUserIds || []).includes(auth.user.id);
  }

  function payload(auth, { manage = false } = {}) {
    cleanup();
    const visibleBindings = state.bindings.filter((binding) => manage || canAccessBinding(auth, binding));
    const visibleBindingIds = new Set(visibleBindings.map((binding) => binding.id));
    const visibleRequests = state.requests
      .filter((request) => manage ? visibleBindingIds.has(request.bindingId) : request.userId === auth?.user?.id && visibleBindingIds.has(request.bindingId))
      .map((request) => {
        const code = request.status === "ready" ? state.codes.find((item) => item.id === request.codeId) : null;
        return {
          ...request,
          codeId: request.status === "ready" ? request.codeId : "",
          maskedCode: code?.maskedCode || "",
          codeReceivedAt: code?.receivedAt || "",
          codeExpiresAt: code?.expiresAt || "",
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      ok: true,
      configured: Boolean(encryptionKey),
      codeTtlSeconds: CODE_TTL_MS / 1000,
      mailboxes: manage ? state.mailboxes.map(sanitizeMailbox) : [],
      bindings: visibleBindings.map((binding) => ({ ...binding, mailboxAddress: state.mailboxes.find((mailbox) => mailbox.id === binding.mailboxId)?.address || "" })),
      requests: visibleRequests,
      users: manage ? usersProvider().map((user) => ({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, status: user.status || "active" })) : [],
      updatedAt: state.updatedAt || "",
    };
  }

  async function upsertMailbox(input, mailboxId = "") {
    const existing = mailboxId ? state.mailboxes.find((item) => item.id === mailboxId) : null;
    if (mailboxId && !existing) throw Object.assign(new Error("邮箱配置不存在。"), { statusCode: 404 });
    const normalized = normalizeMailbox(input, existing);
    const password = String(input.password || "");
    if (!existing && !password) throw Object.assign(new Error("新增邮箱必须填写 IMAP 专用密码或授权码。"), { statusCode: 400 });
    const timestamp = nowIso(now);
    const mailbox = {
      ...(existing || {}),
      ...normalized,
      id: existing?.id || `mailbox_${randomUUID()}`,
      encryptedSecret: password ? encryptString(password, encryptionKey) : existing?.encryptedSecret,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    if (existing) state.mailboxes = state.mailboxes.map((item) => item.id === mailbox.id ? mailbox : item);
    else state.mailboxes.unshift(mailbox);
    persist();
    return sanitizeMailbox(mailbox);
  }

  async function deleteMailbox(mailboxId) {
    if (state.bindings.some((binding) => binding.mailboxId === mailboxId)) throw Object.assign(new Error("该邮箱仍绑定店铺，请先删除店铺绑定。"), { statusCode: 409 });
    const before = state.mailboxes.length;
    state.mailboxes = state.mailboxes.filter((item) => item.id !== mailboxId);
    if (state.mailboxes.length === before) throw Object.assign(new Error("邮箱配置不存在。"), { statusCode: 404 });
    persist();
  }

  async function testMailbox(mailboxId) {
    const mailbox = state.mailboxes.find((item) => item.id === mailboxId);
    if (!mailbox) throw Object.assign(new Error("邮箱配置不存在。"), { statusCode: 404 });
    const started = now();
    try {
      await mailFetcher.testConnection(mailbox, decryptString(mailbox.encryptedSecret, encryptionKey));
      mailbox.lastSuccessAt = nowIso(now);
      mailbox.lastError = "";
      mailbox.lastSyncedAt = mailbox.lastSuccessAt;
      persist();
      return { ok: true, latencyMs: now() - started };
    } catch (error) {
      mailbox.lastError = text(error?.message || "IMAP 连接失败", 300);
      mailbox.lastSyncedAt = nowIso(now);
      persist();
      throw Object.assign(new Error(`邮箱连接失败：${mailbox.lastError}`), { statusCode: 502, code: "imap_connection_failed" });
    }
  }

  function upsertBinding(input, bindingId = "") {
    const existing = bindingId ? state.bindings.find((item) => item.id === bindingId) : null;
    if (bindingId && !existing) throw Object.assign(new Error("店铺绑定不存在。"), { statusCode: 404 });
    const normalized = normalizeBinding(input, existing);
    if (!state.mailboxes.some((mailbox) => mailbox.id === normalized.mailboxId)) throw Object.assign(new Error("请选择有效邮箱。"), { statusCode: 400 });
    if (state.bindings.some((binding) => binding.id !== bindingId && binding.shopKey === normalized.shopKey)) throw Object.assign(new Error("该店铺标识已经绑定。"), { statusCode: 409 });
    const timestamp = nowIso(now);
    const binding = { ...(existing || {}), ...normalized, id: existing?.id || `binding_${randomUUID()}`, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    if (existing) state.bindings = state.bindings.map((item) => item.id === binding.id ? binding : item);
    else state.bindings.unshift(binding);
    persist();
    return binding;
  }

  function deleteBinding(bindingId) {
    const before = state.bindings.length;
    state.bindings = state.bindings.filter((item) => item.id !== bindingId);
    if (state.bindings.length === before) throw Object.assign(new Error("店铺绑定不存在。"), { statusCode: 404 });
    state.requests = state.requests.filter((request) => request.bindingId !== bindingId);
    state.codes = state.codes.filter((code) => code.bindingId !== bindingId);
    persist();
  }

  async function createRequest(auth, bindingId) {
    cleanup();
    const binding = state.bindings.find((item) => item.id === bindingId);
    if (!binding || !canAccessBinding(auth, binding)) throw Object.assign(new Error("无权获取该店铺验证码。"), { statusCode: 403 });
    const mailbox = state.mailboxes.find((item) => item.id === binding.mailboxId && item.enabled !== false);
    if (!mailbox) throw Object.assign(new Error("店铺邮箱未启用，请联系管理员。"), { statusCode: 409 });
    const conflicting = state.requests.find((request) => request.status === "pending" && request.mailboxId === mailbox.id && request.platform === binding.platform && new Date(request.expiresAt).getTime() > now());
    if (conflicting && conflicting.userId !== auth.user.id) throw Object.assign(new Error("该邮箱和平台正在为其他同事接收验证码，请稍后再试，避免验证码串单。"), { statusCode: 409, code: "mailbox_request_busy" });
    if (conflicting && conflicting.userId === auth.user.id && conflicting.bindingId === binding.id) return conflicting;
    const createdAt = nowIso(now);
    const request = {
      id: `request_${randomUUID()}`,
      bindingId: binding.id,
      mailboxId: mailbox.id,
      platform: binding.platform,
      shopKey: binding.shopKey,
      shopName: binding.shopName,
      userId: auth.user.id,
      userName: auth.user.displayName || auth.user.username || "",
      status: "pending",
      createdAt,
      expiresAt: new Date(now() + REQUEST_TTL_MS).toISOString(),
      codeId: "",
      lastError: "",
    };
    state.requests.unshift(request);
    persist();
    await syncPendingRequests({ requestIds: [request.id] });
    return state.requests.find((item) => item.id === request.id) || request;
  }

  async function syncPendingRequests({ requestIds = [] } = {}) {
    if (syncing) return;
    syncing = true;
    try {
      cleanup();
      const requested = new Set(requestIds);
      const pending = state.requests.filter((request) => request.status === "pending" && (!requested.size || requested.has(request.id)));
      const byMailbox = new Map();
      for (const request of pending) {
        const list = byMailbox.get(request.mailboxId) || [];
        list.push(request);
        byMailbox.set(request.mailboxId, list);
      }
      for (const [mailboxId, requests] of byMailbox.entries()) {
        const mailbox = state.mailboxes.find((item) => item.id === mailboxId && item.enabled !== false);
        if (!mailbox) continue;
        try {
          const earliest = Math.min(...requests.map((request) => new Date(request.createdAt).getTime())) - MESSAGE_LOOKBACK_MS;
          const messages = await mailFetcher.fetchRecent(mailbox, decryptString(mailbox.encryptedSecret, encryptionKey), earliest);
          for (const request of requests) {
            const binding = state.bindings.find((item) => item.id === request.bindingId);
            if (!binding) continue;
            const candidates = messages
              .filter((message) => new Date(message.receivedAt).getTime() >= new Date(request.createdAt).getTime() - MESSAGE_LOOKBACK_MS)
              .filter((message) => senderMatches(message.sender, binding.senderPatterns) && subjectMatches(message.subject, binding.subjectKeywords))
              .map((message) => {
                const code = extractLoginVerificationCode(message);
                const fingerprint = code ? createHash("sha256").update(`${mailbox.id}:${message.id}:${code}`).digest("hex") : "";
                return { message, code, fingerprint };
              })
              .filter((item) => item.code)
              .filter((item) => !state.codes.some((code) => code.fingerprint === item.fingerprint && code.requestId !== request.id))
              .sort((a, b) => String(b.message.receivedAt).localeCompare(String(a.message.receivedAt)));
            const match = candidates[0];
            if (!match) continue;
            let codeRecord = state.codes.find((item) => item.fingerprint === match.fingerprint && item.requestId === request.id);
            if (!codeRecord) {
              const receivedAtMs = new Date(match.message.receivedAt).getTime();
              codeRecord = {
                id: `code_${randomUUID()}`,
                requestId: request.id,
                bindingId: binding.id,
                mailboxId: mailbox.id,
                encryptedCode: encryptString(match.code, encryptionKey),
                maskedCode: `••••${match.code.slice(-2)}`,
                fingerprint: match.fingerprint,
                sender: match.message.sender,
                subject: match.message.subject,
                receivedAt: match.message.receivedAt,
                expiresAt: new Date(Math.min(now() + CODE_TTL_MS, receivedAtMs + CODE_TTL_MS)).toISOString(),
                revealedBy: [],
              };
              state.codes.unshift(codeRecord);
            }
            request.status = "ready";
            request.codeId = codeRecord.id;
            request.completedAt = nowIso(now);
            request.lastError = "";
          }
          mailbox.lastSyncedAt = nowIso(now);
          mailbox.lastSuccessAt = mailbox.lastSyncedAt;
          mailbox.lastError = "";
        } catch (error) {
          mailbox.lastSyncedAt = nowIso(now);
          mailbox.lastError = text(error?.message || "IMAP 同步失败", 300);
          for (const request of requests) request.lastError = "邮箱暂时无法读取，系统会自动重试。";
        }
      }
      persist();
    } finally {
      syncing = false;
    }
  }

  async function refreshRequest(auth, requestId, manage = false) {
    const request = state.requests.find((item) => item.id === requestId);
    if (!request || (!manage && request.userId !== auth?.user?.id)) throw Object.assign(new Error("验证码请求不存在。"), { statusCode: 404 });
    await syncPendingRequests({ requestIds: [request.id] });
    return state.requests.find((item) => item.id === request.id);
  }

  function revealCode(auth, requestId, purpose = "view", manage = false) {
    cleanup();
    const request = state.requests.find((item) => item.id === requestId);
    if (!request || (!manage && request.userId !== auth?.user?.id)) throw Object.assign(new Error("验证码请求不存在。"), { statusCode: 404 });
    if (request.status !== "ready") throw Object.assign(new Error("验证码尚未收到。"), { statusCode: 409 });
    const codeRecord = state.codes.find((item) => item.id === request.codeId);
    if (!codeRecord || new Date(codeRecord.expiresAt).getTime() <= now()) throw Object.assign(new Error("验证码已过期，请重新获取。"), { statusCode: 410 });
    codeRecord.revealedBy = [...(codeRecord.revealedBy || []), { userId: auth.user.id, purpose: purpose === "copy" ? "copy" : "view", at: nowIso(now) }].slice(-50);
    persist();
    return {
      requestId: request.id,
      code: decryptString(codeRecord.encryptedCode, encryptionKey),
      expiresAt: codeRecord.expiresAt,
      receivedAt: codeRecord.receivedAt,
      shopName: request.shopName,
      platform: request.platform,
    };
  }

  function start(intervalMs = 10_000) {
    if (timer) return;
    timer = setInterval(() => { void syncPendingRequests(); }, Math.max(5_000, Number(intervalMs) || 10_000));
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    payload,
    upsertMailbox,
    deleteMailbox,
    testMailbox,
    upsertBinding,
    deleteBinding,
    createRequest,
    refreshRequest,
    revealCode,
    syncPendingRequests,
    cleanup,
    start,
    stop,
    _state: () => state,
  };
}

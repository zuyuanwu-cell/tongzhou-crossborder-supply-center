const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.PROD ? "" : `${window.location.protocol}//${window.location.hostname}:8787`);
const AUTH_TOKEN_KEY = "tongzhou_auth_token";

export type HermesContext = {
  route: string;
  filters?: Record<string, string | number | boolean>;
  selectedRefs?: Array<{ type: string; id: string }>;
};

export type HermesEvidenceRef = {
  type?: string;
  id?: string;
  label?: string;
  title?: string;
  href?: string;
  sourceUpdatedAt?: string;
  updatedAt?: string;
  value?: string | number;
};

export type HermesActionPreview = {
  title: string;
  summary: string;
  effects?: string[];
  warnings?: string[];
  target?: { type?: string; id?: string; href?: string };
  expectedVersion?: number;
};

export type HermesConversation = {
  id: string;
  title: string;
  context: HermesContext;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type HermesMessage = {
  id: string;
  conversationId: string;
  runId?: string;
  role: "user" | "assistant";
  content: string;
  evidence: HermesEvidenceRef[];
  createdAt: string;
};

export type HermesRun = {
  id: string;
  conversationId: string;
  status: string;
  model: string;
  toolCount: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type HermesCase = {
  id: string;
  ruleCode: string;
  resourceType: string;
  resourceId: string;
  warehouseId?: string;
  project?: string;
  country?: string;
  sku?: string;
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "investigating" | "action_pending" | "resolved" | "dismissed";
  assigneeId?: string;
  assigneeName?: string;
  evidence: HermesEvidenceRef[];
  href?: string;
  sourceUpdatedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  resolution?: string;
  version: number;
  updatedAt: string;
};

export type HermesStatus = {
  enabled: boolean;
  status: string;
  ready?: boolean;
  modelConfigured?: boolean;
  model: string;
  activeRuns?: number;
  maxGlobalRuns?: number;
  missingCapabilities?: string[];
  patrol?: { enabled?: boolean; running?: boolean; lastRunAt?: string; lastError?: string };
  metrics?: {
    periodDays: number;
    runs: { total: number; completed: number; failed: number; successRate: number; averageDurationMs: number; firstEventMedianMs: number };
    tools: { completed: number; averageDurationMs: number };
    approvals: { total: number; approved: number; denied: number; outcomeUnknown: number };
    usage: { inputTokens: number; outputTokens: number; costUsd: number };
    cases: { active: number };
  };
};

export type HermesModelOption = {
  id: string;
  label: string;
  description: string;
};

export type HermesModelConfig = {
  provider: "deepseek";
  providerLabel: string;
  baseUrl: string;
  model: string;
  models: HermesModelOption[];
  configured: boolean;
  apiKeyMasked: string;
  updatedAt?: string;
  lastTest?: { ok: boolean; message: string; testedAt: string } | null;
};

export type HermesEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.started"; toolCallId: string; tool: string; label: string }
  | { type: "tool.completed"; toolCallId: string; summary: string; evidence: HermesEvidenceRef[] }
  | { type: "approval.required"; runId: string; toolCallId: string; preview: HermesActionPreview }
  | { type: "run.completed"; messageId: string }
  | { type: "run.failed" | "run.cancelled"; message: string };

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...((init.headers as Record<string, string> | undefined) || {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("无法连接同舟服务，请检查网络后重试。");
  }
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.message || `请求失败（HTTP ${response.status}）。`);
  return payload as T;
}

export function fetchHermesStatus(signal?: AbortSignal) {
  return request<HermesStatus & { ok: boolean }>("/api/hermes/status", { signal });
}

export function fetchHermesModelConfig(signal?: AbortSignal) {
  return request<{ ok: boolean; config: HermesModelConfig }>("/api/hermes/model-config", { signal });
}

export function testHermesModelConfig(input: { apiKey?: string; model: string }) {
  return request<{ ok: boolean; model: string; message: string; testedAt: string }>("/api/hermes/model-config/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveHermesModelConfig(input: { apiKey?: string; model: string }) {
  return request<{ ok: boolean; config: HermesModelConfig }>("/api/hermes/model-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchHermesConversations(signal?: AbortSignal) {
  return request<{ ok: boolean; conversations: HermesConversation[]; activeRun?: HermesRun | null }>("/api/hermes/conversations", { signal });
}

export function createHermesConversation(input: { title?: string; context: HermesContext }) {
  return request<{ ok: boolean; conversation: HermesConversation }>("/api/hermes/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchHermesMessages(conversationId: string, signal?: AbortSignal) {
  return request<{ ok: boolean; messages: HermesMessage[] }>(`/api/hermes/conversations/${encodeURIComponent(conversationId)}/messages`, { signal });
}

export function startHermesRun(conversationId: string, input: { input: string; context: HermesContext }) {
  return request<{ ok: boolean; run: HermesRun }>(`/api/hermes/conversations/${encodeURIComponent(conversationId)}/runs`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(input),
  });
}

export function decideHermesApproval(runId: string, input: { toolCallId: string; choice: "once" | "deny"; reauthPassword?: string }) {
  return request<{ ok: boolean; choice: string }>(`/api/hermes/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function stopHermesRun(runId: string) {
  return request<{ ok: boolean; status: string }>(`/api/hermes/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
    body: "{}",
  });
}

export function fetchHermesCases(filters: { status?: string; severity?: string; assigneeId?: string } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const suffix = query.size ? `?${query.toString()}` : "";
  return request<{ ok: boolean; cases: HermesCase[] }>(`/api/hermes/cases${suffix}`, { signal });
}

type StreamFrame = { id: number; event: HermesEvent };

function parseFrame(frame: string): StreamFrame | null {
  let id = 0;
  const data: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  try {
    return { id, event: JSON.parse(data.join("\n")) as HermesEvent };
  } catch {
    return null;
  }
}

export async function* streamHermesRunEvents(runId: string, options: { after?: number; signal?: AbortSignal } = {}): AsyncGenerator<StreamFrame> {
  const query = options.after ? `?after=${encodeURIComponent(String(options.after))}` : "";
  const response = await fetch(`${API_BASE}/api/hermes/runs/${encodeURIComponent(runId)}/events${query}`, {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal: options.signal,
  });
  if (!response.ok) {
    let message = `连接运行事件失败（HTTP ${response.status}）。`;
    try { message = (await response.json()).message || message; } catch { /* retain safe message */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("服务器未返回可读取的事件流。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(boundary + (match?.[0].length || 2));
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    const parsed = parseFrame(buffer);
    if (parsed) yield parsed;
  } finally {
    reader.releaseLock();
  }
}

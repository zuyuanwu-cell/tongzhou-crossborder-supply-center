function text(value) {
  return String(value ?? "").trim();
}

function publicErrorBody(payload, status) {
  return text(payload?.error?.message || payload?.message || payload?.detail) || `Hermes request failed (${status}).`;
}

export class HermesClientError extends Error {
  constructor(message, status = 502, code = "hermes_error", details = {}) {
    super(message);
    this.name = "HermesClientError";
    this.statusCode = status;
    this.code = code;
    this.details = details;
  }
}

export function createHermesClient({ baseUrl, apiKey, fetchImpl = globalThis.fetch, requestTimeoutMs = 15_000 } = {}) {
  const root = text(baseUrl).replace(/\/+$/, "");
  const key = text(apiKey);

  function configured() {
    return Boolean(root && key);
  }

  async function request(path, { method = "GET", body, headers = {}, timeoutMs = requestTimeoutMs, stream = false } = {}) {
    if (!configured()) throw new HermesClientError("Hermes runtime is not configured.", 503, "hermes_not_configured");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer?.unref?.();
    try {
      const response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        let payload = {};
        try { payload = await response.json(); } catch { payload = {}; }
        throw new HermesClientError(publicErrorBody(payload, response.status), response.status, text(payload?.error?.code || payload?.code) || "hermes_error", payload);
      }
      if (stream) return response;
      if (response.status === 204) return {};
      return response.json();
    } catch (error) {
      if (error instanceof HermesClientError) throw error;
      if (error?.name === "AbortError") throw new HermesClientError("Hermes request timed out.", 504, "hermes_timeout");
      throw new HermesClientError("Hermes runtime is unavailable.", 503, "hermes_unavailable", { cause: text(error?.message) });
    } finally {
      clearTimeout(timer);
    }
  }

  async function capabilities() {
    return request("/v1/capabilities", { timeoutMs: Math.min(5_000, requestTimeoutMs) });
  }

  async function health() {
    if (!configured()) return { ok: false, status: "disabled", reason: "not_configured" };
    try {
      const [liveness, capabilityPayload] = await Promise.all([
        request("/health", { timeoutMs: Math.min(3_000, requestTimeoutMs) }),
        capabilities(),
      ]);
      const features = capabilityPayload?.features || {};
      const required = ["run_submission", "run_status", "run_events_sse", "run_stop", "run_steer", "run_approval_response"];
      const missing = required.filter((feature) => features[feature] !== true);
      return { ok: !missing.length, status: !missing.length ? "ready" : "incompatible", liveness, capabilities: capabilityPayload, missing };
    } catch (error) {
      return { ok: false, status: "unavailable", reason: error.code || "hermes_unavailable", message: error.message };
    }
  }

  function createRun({ input, sessionId, model, instructions, idempotencyKey }) {
    return request("/v1/runs", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      timeoutMs: Math.max(30_000, requestTimeoutMs),
      body: {
        input: String(input || ""),
        session_id: text(sessionId),
        model: text(model),
        instructions: text(instructions),
      },
    });
  }

  function getRun(runId) {
    return request(`/v1/runs/${encodeURIComponent(runId)}`);
  }

  function events(runId, { lastEventId = "" } = {}) {
    return request(`/v1/runs/${encodeURIComponent(runId)}/events`, {
      stream: true,
      timeoutMs: 190_000,
      headers: text(lastEventId) ? { "Last-Event-ID": text(lastEventId) } : {},
    });
  }

  function approve(runId, { requestId, choice }) {
    return request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      body: {
        request_id: text(requestId),
        choice: choice === "once" ? "once" : "deny",
      },
    });
  }

  function stop(runId) {
    return request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: {} });
  }

  function steer(runId, input) {
    return request(`/v1/runs/${encodeURIComponent(runId)}/steer`, {
      method: "POST",
      body: { input: text(input) },
    });
  }

  return { approve, capabilities, configured, createRun, events, getRun, health, steer, stop };
}

export async function* parseSseStream(response) {
  if (!response?.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let eventId = "";
  let dataLines = [];

  function flush() {
    if (!dataLines.length) {
      eventName = "message";
      eventId = "";
      return null;
    }
    const raw = dataLines.join("\n");
    let data = raw;
    try { data = JSON.parse(raw); } catch { /* preserve text */ }
    const event = { event: eventName, id: eventId, data };
    eventName = "message";
    eventId = "";
    dataLines = [];
    return event;
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) {
        const event = flush();
        if (event) yield event;
      } else if (!line.startsWith(":")) {
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") eventName = value;
        else if (field === "id") eventId = value;
        else if (field === "data") dataLines.push(value);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) dataLines.push(buffer.trim());
  const event = flush();
  if (event) yield event;
}

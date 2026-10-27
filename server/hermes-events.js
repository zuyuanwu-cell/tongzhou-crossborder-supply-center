import { readFileSync } from "node:fs";

function text(value) {
  return String(value ?? "").trim();
}

const TOOL_MANIFEST = JSON.parse(readFileSync(new URL("../integrations/hermes/tool-manifest.json", import.meta.url), "utf8"));
const TOOL_LABELS = Object.freeze(Object.fromEntries((TOOL_MANIFEST.tools || []).map((item) => [item.name, item.label])));

export function hermesEventType(event) {
  return text(event?.event === "message"
    ? event?.data?.event || event?.data?.type
    : event?.event || event?.data?.event || event?.data?.type);
}

function toolCallIdFromApproval(data) {
  const direct = text(data.tool_call_id || data.toolCallId || data.call_id);
  if (direct) return direct;
  const pattern = text(data.pattern_key);
  const match = pattern.match(/^plugin_rule:tongzhou:[^:]+:(.+)$/);
  return text(match?.[1]);
}

function parseJsonStringAt(value, start) {
  if (value[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      try { return JSON.parse(value.slice(start, index + 1)); }
      catch { return null; }
    }
  }
  return null;
}

function parseJsonArrayAt(value, start) {
  if (value[start] !== "[") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(value.slice(start, index + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

function toolPreview(value) {
  if (value && typeof value === "object") return value;
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Hermes v0.21.7 truncates public tool previews at 500 characters. The
    // bridge puts summary/evidence first so those complete fields can still be
    // recovered when only the trailing business payload was truncated.
    const recovered = {};
    const summaryMatch = /"summary"\s*:\s*/.exec(raw);
    if (summaryMatch) {
      const parsed = parseJsonStringAt(raw, summaryMatch.index + summaryMatch[0].length);
      if (parsed !== null) recovered.summary = parsed;
    }
    const evidenceMatch = /"evidence"\s*:\s*/.exec(raw);
    if (evidenceMatch) {
      const parsed = parseJsonArrayAt(raw, evidenceMatch.index + evidenceMatch[0].length);
      if (parsed) recovered.evidence = parsed;
    }
    return recovered;
  }
}

export function normalizeHermesEvent(event, { runId, toolCallId: correlatedToolCallId = "", proposalForToolCall = () => null } = {}) {
  const data = event?.data && typeof event.data === "object" ? event.data : { text: String(event?.data || "") };
  const type = hermesEventType(event);
  const toolCallId = text(correlatedToolCallId) || (type === "approval.request" ? toolCallIdFromApproval(data) : text(data.tool_call_id || data.toolCallId || data.call_id));
  if (["message.delta", "assistant.delta"].includes(type)) {
    return { type: "assistant.delta", text: String(data.delta ?? data.text ?? "") };
  }
  if (type === "tool.started") {
    const tool = text(data.tool || data.name);
    if (!Object.hasOwn(TOOL_LABELS, tool)) return null;
    return {
      type: "tool.started",
      toolCallId,
      tool,
      label: TOOL_LABELS[tool] || text(data.label) || "执行业务工具",
    };
  }
  if (["tool.completed", "tool.failed"].includes(type)) {
    const tool = text(data.tool || data.name);
    if (!Object.hasOwn(TOOL_LABELS, tool)) return null;
    const preview = toolPreview(data.preview);
    return {
      type: "tool.completed",
      toolCallId,
      tool,
      summary: text(preview.summary || data.summary) || (data.error ? "工具执行失败" : "工具执行完成"),
      evidence: Array.isArray(preview.evidence) ? preview.evidence : (Array.isArray(data.evidence) ? data.evidence : []),
      error: Boolean(data.error || type === "tool.failed"),
      durationMs: Math.max(0, Math.round(Number(data.duration || 0) * 1000)),
    };
  }
  if (type === "approval.request") {
    const proposal = proposalForToolCall(toolCallId);
    return {
      type: "approval.required",
      runId,
      toolCallId,
      requestId: text(data.prompt_id || data.request_id),
      executionGeneration: Number(data.execution_generation || 0),
      preview: proposal?.preview || {
        title: text(data.description) || "业务动作需要确认",
        summary: text(data.command) || "Hermes 请求执行写操作。",
        effects: [],
        warnings: [],
      },
    };
  }
  if (type === "run.completed") {
    return {
      type: "run.completed",
      messageId: "",
      output: String(data.output || data.text || ""),
      usage: data.usage || {},
      runtime: data.runtime || {},
    };
  }
  if (["run.failed", "run.cancelled", "run.interrupted"].includes(type)) {
    return {
      type: type === "run.failed" ? "run.failed" : "run.cancelled",
      message: text(data.error || data.message) || (type === "run.failed" ? "Hermes 运行失败。" : "运行已取消。"),
    };
  }
  return null;
}

export function approvalToolCallId(event) {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  return toolCallIdFromApproval(data);
}

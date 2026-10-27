import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hasPermission } from "./access-control.js";
import { verifyHermesBridgeRequest } from "./hermes-bridge-auth.js";

const HERMES_TOOL_MANIFEST = JSON.parse(readFileSync(new URL("../integrations/hermes/tool-manifest.json", import.meta.url), "utf8"));
const HERMES_TOOL_ENTRIES = Array.isArray(HERMES_TOOL_MANIFEST.tools) ? HERMES_TOOL_MANIFEST.tools : [];
const HERMES_TOOLS_BY_NAME = new Map(HERMES_TOOL_ENTRIES.map((item) => [item.name, item]));
const HERMES_TOOL_LABELS = Object.freeze(Object.fromEntries(HERMES_TOOL_ENTRIES.map((item) => [item.name, item.label])));
export const HERMES_READ_TOOLS = Object.freeze(new Set(HERMES_TOOL_ENTRIES.filter((item) => item.mode === "read").map((item) => item.name)));
export const HERMES_WRITE_TOOLS = Object.freeze(new Set(HERMES_TOOL_ENTRIES.filter((item) => item.mode === "write").map((item) => item.name)));

function text(value) {
  return String(value ?? "").trim();
}

function error(message, statusCode = 400, code = "invalid_request") {
  return Object.assign(new Error(message), { statusCode, code });
}

function toolIdempotencyKey(sessionId, toolCallId, tool) {
  return `hermes:${createHash("sha256").update(`${sessionId}\n${toolCallId}\n${tool}`).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (value === undefined) return "null";
  return JSON.stringify(value);
}

export function sanitizeHermesToolArguments(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const sanitize = (value) => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !String(key).startsWith("_"))
      .map(([key, item]) => [key, sanitize(item)]));
  };
  return sanitize(args);
}

export function hashHermesToolArguments(tool, args) {
  return createHash("sha256").update(`${text(tool)}\n${canonicalJson(sanitizeHermesToolArguments(args))}`).digest("hex");
}

function scopeFor(auth) {
  const dataScopes = auth?.user?.dataScopes || {};
  return {
    warehouseIds: Array.isArray(dataScopes.warehouseIds) ? dataScopes.warehouseIds.map(String).filter(Boolean) : [],
    countries: Array.isArray(dataScopes.countries) ? dataScopes.countries.map(String).filter(Boolean) : [],
    skus: Array.isArray(dataScopes.skus) ? dataScopes.skus.map((value) => String(value).toUpperCase()).filter(Boolean) : [],
  };
}

function hasAny(auth, permissions) {
  return auth?.role === "admin" || permissions.some((permission) => hasPermission(auth, permission));
}

function requireToolPermission(auth, tool, phase) {
  const entry = HERMES_TOOLS_BY_NAME.get(tool);
  if (!entry) throw error("Tool is not enabled for Tongzhou Hermes.", 404, "tool_not_enabled");
  const required = Array.isArray(entry.permissions) ? entry.permissions : [];
  for (const permission of required) {
    if (hasPermission(auth, permission)) continue;
    const code = permission === "hermes_agent_use"
      ? "hermes_permission_required"
      : permission === "hermes_agent_action"
        ? "hermes_action_permission_required"
        : "business_permission_required";
    throw error(`当前账号缺少工具 ${tool} 所需权限：${permission}。`, 403, code);
  }
  const permissionAnyOf = Array.isArray(entry.permissionAnyOf) ? entry.permissionAnyOf : [];
  if (permissionAnyOf.length && !hasAny(auth, permissionAnyOf)) throw error(`当前账号缺少工具 ${tool} 对应的业务权限。`, 403, "business_permission_required");
  if (phase === "execute" && auth?.user?.status === "disabled") throw error("当前账号已停用，不能执行动作。", 403, "user_disabled");
}

function summarizeArguments(tool, args) {
  if (tool === "tongzhou_create_stockup_draft") {
    return {
      project: text(args.project),
      destinationWarehouseId: text(args.destinationWarehouseId),
      expectedArrivalAt: text(args.expectedArrivalAt),
      lineCount: Array.isArray(args.lines) ? args.lines.length : 0,
      totalQuantity: (args.lines || []).reduce((sum, line) => sum + Number(line.requestedQty || 0), 0),
    };
  }
  if (["tongzhou_assign_exception", "tongzhou_update_exception_status", "tongzhou_send_exception_reminder"].includes(tool)) {
    return {
      caseId: text(args.caseId),
      version: Number(args.version || 0),
      status: text(args.status),
      assigneeId: text(args.assigneeId),
      assigneeName: text(args.assigneeName),
      note: text(args.note || args.resolution).slice(0, 300),
    };
  }
  return {};
}

function buildPreview(tool, args, context) {
  const summary = summarizeArguments(tool, args);
  if (tool === "tongzhou_create_stockup_draft") {
    if (!summary.destinationWarehouseId || !summary.lineCount) throw error("备货草稿必须包含目标仓库和明细。", 400, "invalid_stockup_draft");
    return {
      title: "创建备货需求草稿",
      summary: `${summary.project || "未命名项目"}，${summary.lineCount} 个 SKU，共 ${summary.totalQuantity} 件`,
      effects: ["仅创建待人工审核草稿", `目标仓库：${summary.destinationWarehouseId}`],
      warnings: ["不会自动提交；缺少 SKU 的明细可能生成临时编码。"],
      target: { type: "stockup_request", href: "#stockup" },
    };
  }
  const currentCase = context.store.getCase(summary.caseId, context.scopes);
  if (!currentCase) throw error("异常案例不存在或超出当前数据范围。", 404, "case_not_found");
  if (summary.version && summary.version !== currentCase.version) throw error("异常案例版本已变化，请重新查看后再操作。", 409, "version_conflict");
  if (tool === "tongzhou_assign_exception") {
    const assignee = context.providers.resolveAssignee(summary.assigneeId);
    if (!assignee) throw error("责任人不存在或账号已停用。", 404, "assignee_not_found");
    return {
      title: "分派异常责任人",
      summary: `${currentCase.title} → ${assignee.displayName || assignee.username || assignee.id}`,
      effects: ["更新异常责任人", "将异常状态更新为调查中"],
      warnings: [],
      target: { type: "exception_case", id: currentCase.id, href: currentCase.href || "#hermes-agent" },
      expectedVersion: currentCase.version,
    };
  }
  if (tool === "tongzhou_update_exception_status") return {
    title: "更新异常处理状态",
    summary: `${currentCase.title}：${currentCase.status} → ${summary.status}`,
    effects: ["更新异常状态", "记录不可变审计事件"],
    warnings: [summary.status === "resolved" ? "手动关闭后，后续巡检仍可能重新发现异常。" : ""].filter(Boolean),
    target: { type: "exception_case", id: currentCase.id, href: currentCase.href || "#hermes-agent" },
    expectedVersion: currentCase.version,
  };
  return {
    title: "发送异常催办",
    summary: `${currentCase.title} → ${currentCase.assigneeName || "未分派"}`,
    effects: ["向配置的企业微信群发送催办", "记录催办审计事件"],
    warnings: ["将产生外部消息，请确认责任人和内容无误。"],
    target: { type: "exception_case", id: currentCase.id, href: currentCase.href || "#hermes-agent" },
    expectedVersion: currentCase.version,
  };
}

function sanitizeResult(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeResult(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const blocked = /(secret|password|token|webhook|credential|appkey|app_key|private|supplier.*(phone|contact)|phone.*supplier)/i;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !blocked.test(key))
    .map(([key, item]) => [key, sanitizeResult(item, depth + 1)]));
}

function evidenceFromResult(tool, result) {
  if (Array.isArray(result?.evidence)) return result.evidence;
  if (tool === "tongzhou_query_exception_cases") {
    return (result?.cases || []).map((item) => ({ type: "exception_case", id: item.id, label: item.title, href: item.href || "#hermes-agent", updatedAt: item.updatedAt }));
  }
  if (tool === "tongzhou_query_stockup_execution") {
    return [...(result?.requests || []), ...(result?.tasks || [])].map((item) => ({ type: "stockup", id: item.id, label: item.title || item.project || item.id, href: "#stockup", updatedAt: item.updatedAt }));
  }
  if (tool === "tongzhou_query_partner_tasks") {
    return (result?.tasks || []).map((item) => ({ type: "partner_task", id: item.id, label: item.title || item.id, href: "#partner-collaboration", updatedAt: item.updatedAt }));
  }
  if (result?.case) return [{ type: "exception_case", id: result.case.id, label: result.case.title, href: result.case.href || "#hermes-agent", updatedAt: result.case.updatedAt }];
  return [];
}

function envelopeToolResult(tool, value) {
  const result = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  const { ok, summary, evidence, ...rest } = result;
  // Hermes exposes only a bounded public result preview. Keep a small evidence
  // header first while retaining the full business payload for the model.
  const eventEvidence = evidenceFromResult(tool, { ...result, evidence }).slice(0, 3).map((item) => sanitizeResult(item));
  return {
    ok: ok !== false,
    summary: text(summary) || HERMES_TOOL_LABELS[tool] || "工具执行完成",
    evidence: eventEvidence,
    ...rest,
  };
}

async function readRawBody(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw error("Hermes tool request is too large.", 413, "payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createHermesToolGateway({
  store,
  bridgeSecret,
  resolveAuthForUserId,
  providers,
  sendJson,
  appendActionLog = () => {},
} = {}) {
  async function executeRead(tool, args, auth, scopes) {
    if (tool === "tongzhou_search_resources") return providers.searchResources(args, auth);
    if (tool === "tongzhou_get_resource") return providers.getResource(args, auth);
    if (tool === "tongzhou_query_exception_cases") return { ok: true, cases: store.listCases(args, scopes) };
    if (tool === "tongzhou_query_inventory_risk") return providers.queryInventoryRisk(args, auth);
    if (tool === "tongzhou_query_stockup_execution") return providers.queryStockupExecution(args, auth);
    if (tool === "tongzhou_query_production_timeline") return providers.queryProductionTimeline(args, auth);
    if (tool === "tongzhou_query_partner_tasks") {
      if (!hasPermission(auth, "collaboration_task_view")) throw error("当前账号没有伙伴协同任务查看权限。", 403, "business_permission_required");
      return providers.queryPartnerTasks(args, auth);
    }
    if (tool === "tongzhou_compare_movement_inventory") return providers.compareMovementInventory(args, auth);
    throw error("Tool is not enabled.", 404, "tool_not_enabled");
  }

  async function executeWrite(tool, args, auth, scopes, proposal) {
    if (proposal.status !== "approved" || proposal.approvedBy !== auth.user.id) {
      throw error("This action has not been approved by the current user.", 409, "approval_required");
    }
    if (tool === "tongzhou_create_stockup_draft") return providers.createStockupDraft(args, auth, proposal.idempotencyKey);
    if (tool === "tongzhou_assign_exception") {
      return providers.assignException(args, auth, scopes);
    }
    if (tool === "tongzhou_update_exception_status") {
      const caseItem = store.updateCase(args.caseId, {
        version: args.version,
        status: args.status,
        resolution: args.resolution || args.note,
      }, { id: auth.user.id, name: auth.user.displayName || auth.user.username }, scopes);
      if (!caseItem) throw error("异常案例不存在或超出当前数据范围。", 404, "case_not_found");
      return {
        ok: true,
        case: caseItem,
      };
    }
    if (tool === "tongzhou_send_exception_reminder") return providers.sendExceptionReminder(args, auth, proposal.idempotencyKey, scopes);
    throw error("Tool is not enabled.", 404, "tool_not_enabled");
  }

  return async function handleHermesToolGateway(req, res, url) {
    const match = url.pathname.match(/^\/api\/internal\/hermes\/v1\/tools\/([^/]+)\/(preview|execute)$/);
    if (!match) return false;
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, code: "method_not_allowed", message: "Method not allowed." });
      return true;
    }
    try {
      const rawBody = await readRawBody(req);
      verifyHermesBridgeRequest({
        secret: bridgeSecret,
        method: req.method,
        path: url.pathname,
        rawBody,
        headers: req.headers,
        consumeNonce: (nonce, expiresAt) => store.consumeNonce(nonce, expiresAt),
      });
      let payload;
      try { payload = rawBody.length ? JSON.parse(rawBody.toString("utf8")) : {}; }
      catch { throw error("Hermes tool body must be valid JSON.", 400, "invalid_json"); }
      const tool = decodeURIComponent(match[1]);
      const phase = match[2];
      if (!HERMES_READ_TOOLS.has(tool) && !HERMES_WRITE_TOOLS.has(tool)) throw error("Tool is not enabled for Tongzhou Hermes.", 404, "tool_not_enabled");
      const sessionId = text(payload.session_id);
      const toolCallId = text(payload.tool_call_id);
      const args = sanitizeHermesToolArguments(payload.arguments);
      if (!sessionId || !toolCallId) throw error("session_id and tool_call_id are required.", 400, "missing_tool_context");
      const conversation = store.getConversationBySession(sessionId);
      if (!conversation) throw error("Hermes session is not bound to an active Tongzhou conversation.", 403, "session_not_bound");
      const auth = resolveAuthForUserId(conversation.userId);
      if (!auth?.user?.id || auth.role === "guest") throw error("The bound user is no longer active.", 403, "user_not_active");
      requireToolPermission(auth, tool, phase);
      const scopes = scopeFor(auth);
      const activeRun = store.activeRunForConversation(conversation.id);
      if (!activeRun || activeRun.userId !== conversation.userId) throw error("No active run owns this tool call.", 409, "run_not_active");

      if (HERMES_READ_TOOLS.has(tool)) {
        if (phase !== "execute") throw error("Read tools do not support preview.", 400, "preview_not_supported");
        const result = sanitizeResult(envelopeToolResult(tool, await executeRead(tool, args, auth, scopes)));
        appendActionLog(auth, "Hermes 只读工具调用", "hermes_tool", tool, { toolCallId, sessionId, runId: activeRun.id });
        sendJson(res, 200, result);
        return true;
      }

      const idempotencyKey = toolIdempotencyKey(sessionId, toolCallId, tool);
      const argumentsHash = hashHermesToolArguments(tool, args);
      if (phase === "preview") {
        const preview = buildPreview(tool, args, { store, scopes, providers, auth });
        const proposal = store.upsertActionProposal({
          runId: activeRun.id,
          toolCallId,
          tool,
          argumentsHash,
          argumentsSummary: summarizeArguments(tool, args),
          preview,
          idempotencyKey,
        });
        if (proposal.argumentsHash !== argumentsHash) {
          throw error("Tool arguments changed after the action preview was created.", 409, "proposal_arguments_mismatch");
        }
        sendJson(res, 200, { ok: true, proposalId: proposal.id, preview: proposal.preview, idempotencyKey: proposal.idempotencyKey });
        return true;
      }

      let proposal = store.getActionProposalByToolCall(toolCallId);
      if (!proposal || proposal.tool !== tool || proposal.runId !== activeRun.id) throw error("No matching approved action proposal exists.", 409, "proposal_not_found");
      if (!proposal.argumentsHash || proposal.argumentsHash !== argumentsHash) {
        throw error("Tool arguments do not match the action that was approved.", 409, "proposal_arguments_mismatch");
      }
      if (proposal.status === "approval_submitting") {
        const deadline = Date.now() + 16_000;
        while (proposal.status === "approval_submitting" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          proposal = store.getActionProposalByToolCall(toolCallId);
        }
      }
      if (["executed", "outcome_unknown"].includes(proposal.status)) {
        sendJson(res, 200, { ok: proposal.status === "executed", idempotentReplay: true, status: proposal.status, result: proposal.result });
        return true;
      }
      if (proposal.status === "executing") {
        store.updateActionProposal(toolCallId, { status: "outcome_unknown", error: "Previous execution was interrupted; verify by idempotency key before retrying." });
        sendJson(res, 200, { ok: false, idempotentReplay: true, status: "outcome_unknown", result: proposal.result });
        return true;
      }
      if (proposal.status !== "approved" || proposal.approval !== "once") {
        throw error("This action has not been approved by the current user.", 409, "approval_required");
      }
      store.updateActionProposal(toolCallId, { status: "executing", error: "" });
      try {
        const result = sanitizeResult(envelopeToolResult(tool, await executeWrite(tool, args, auth, scopes, proposal)));
        store.updateActionProposal(toolCallId, { status: "executed", result });
        appendActionLog(auth, "Hermes 写工具执行", "hermes_tool", tool, { toolCallId, proposalId: proposal.id, idempotencyKey, result });
        sendJson(res, 200, { ok: true, status: "executed", result });
      } catch (executionError) {
        const unknown = executionError?.code === "outcome_unknown" || executionError?.name === "AbortError";
        store.updateActionProposal(toolCallId, { status: unknown ? "outcome_unknown" : "failed", error: executionError?.message || "Action failed." });
        throw executionError;
      }
      return true;
    } catch (caught) {
      sendJson(res, Number(caught?.statusCode || 500), { ok: false, code: caught?.code || "hermes_tool_error", message: caught?.message || "Hermes tool request failed." });
      return true;
    }
  };
}

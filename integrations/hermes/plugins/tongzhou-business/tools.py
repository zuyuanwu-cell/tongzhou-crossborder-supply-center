"""Handlers and approval gate for Tongzhou business tools."""

from __future__ import annotations

import json
from typing import Any

from .client import BridgeError, TongzhouBridgeClient
from .schemas import READ_TOOLS, TOOL_SCHEMAS, WRITE_TOOLS

_CORRELATION_ARGUMENT = "_tongzhou_tool_call_id"


def _context(arguments: dict[str, Any], kwargs: dict[str, Any]) -> tuple[str, str]:
    return (
        str(kwargs.get("session_id") or "").strip(),
        str(arguments.get(_CORRELATION_ARGUMENT) or kwargs.get("tool_call_id") or "").strip(),
    )


def make_handler(tool: str, bridge: TongzhouBridgeClient):
    def handle(arguments: dict[str, Any], **kwargs: Any) -> str:
        clean_arguments = dict(arguments or {})
        session_id, tool_call_id = _context(clean_arguments, kwargs)
        clean_arguments.pop(_CORRELATION_ARGUMENT, None)
        if not session_id or not tool_call_id:
            return json.dumps(
                {"error": "Hermes did not provide the required session/tool correlation context"},
                ensure_ascii=False,
                separators=(",", ":"),
            )
        try:
            result = bridge.call(
                tool,
                "execute",
                clean_arguments,
                session_id=session_id,
                tool_call_id=tool_call_id,
            )
            return json.dumps(result, ensure_ascii=False, separators=(",", ":"))
        except BridgeError as error:
            return json.dumps({"error": str(error)}, ensure_ascii=False, separators=(",", ":"))

    return handle


def make_correlation_hook():
    """Thread the trusted Hermes call id into the later registry handler.

    Hermes v0.21.7 passes session_id/task_id to plugin handlers, while the
    tool_call_id is only present on lifecycle hooks. A separate modify
    directive is combined with the approval directive by Hermes before
    dispatch, so the model never supplies this value.
    """

    def correlate(tool_name: str = "", **kwargs: Any):
        if tool_name not in TOOL_SCHEMAS:
            return None
        tool_call_id = str(kwargs.get("tool_call_id") or "").strip()
        if not tool_call_id:
            return {"action": "block", "message": "BLOCKED: missing Hermes tool correlation context"}
        return {"action": "modify", "args": {_CORRELATION_ARGUMENT: tool_call_id}}

    return correlate


def make_approval_hook(bridge: TongzhouBridgeClient):
    def pre_tool_call(tool_name: str = "", args: dict[str, Any] | None = None, **kwargs: Any):
        if tool_name not in WRITE_TOOLS:
            return None
        session_id = str(kwargs.get("session_id") or "").strip()
        tool_call_id = str(kwargs.get("tool_call_id") or "").strip()
        if not session_id or not tool_call_id:
            return {"action": "block", "message": "BLOCKED: missing Hermes session/tool correlation context"}
        try:
            result = bridge.call(
                tool_name,
                "preview",
                dict(args or {}),
                session_id=session_id,
                tool_call_id=tool_call_id,
            )
        except BridgeError as error:
            return {"action": "block", "message": f"BLOCKED: action preview failed: {error}"}
        preview = result.get("preview") if isinstance(result.get("preview"), dict) else {}
        title = str(preview.get("title") or tool_name)
        summary = str(preview.get("summary") or "请确认本次业务动作")
        warnings = [str(item) for item in preview.get("warnings", []) if str(item).strip()]
        message = f"{title}?{summary}"
        if warnings:
            message += "?" + "?".join(warnings[:3])
        return {
            "action": "approve",
            "message": message,
            "rule_key": f"tongzhou:{tool_name}:{tool_call_id}",
        }

    return pre_tool_call


def register_tools(ctx, bridge: TongzhouBridgeClient) -> None:
    for name, schema in TOOL_SCHEMAS.items():
        ctx.register_tool(
            name=name,
            toolset="tongzhou-business",
            schema=schema,
            handler=make_handler(name, bridge),
            description=schema["description"],
        )
    # Hermes combines modify + approve directives from separate hooks. Register
    # correlation first so every read/write handler receives the trusted id.
    ctx.register_hook("pre_tool_call", make_correlation_hook())
    ctx.register_hook("pre_tool_call", make_approval_hook(bridge))


__all__ = [
    "READ_TOOLS",
    "WRITE_TOOLS",
    "make_handler",
    "make_correlation_hook",
    "make_approval_hook",
    "register_tools",
]

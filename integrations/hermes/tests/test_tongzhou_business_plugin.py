from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import sys
from pathlib import Path

import pytest


PLUGIN_DIR = Path(__file__).parents[1] / "plugins" / "tongzhou-business"
PACKAGE_NAME = "tongzhou_business_test_plugin"


def load_module(name: str):
    package_init = PLUGIN_DIR / "__init__.py"
    if PACKAGE_NAME not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            PACKAGE_NAME, package_init, submodule_search_locations=[str(PLUGIN_DIR)]
        )
        package = importlib.util.module_from_spec(spec)
        sys.modules[PACKAGE_NAME] = package
        assert spec.loader
        spec.loader.exec_module(package)
    return __import__(f"{PACKAGE_NAME}.{name}", fromlist=[name])


client_module = load_module("client")
schemas = load_module("schemas")
tools = load_module("tools")
TongzhouBridgeClient = client_module.TongzhouBridgeClient
BridgeError = client_module.BridgeError


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.payload


class FakeBridge:
    def __init__(self, result=None, error=None):
        self.result = result or {"ok": True}
        self.error = error
        self.calls = []

    def call(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if self.error:
            raise self.error
        return self.result


class FakeContext:
    def __init__(self):
        self.registered_tools = []
        self.registered_hooks = []

    def register_tool(self, **kwargs):
        self.registered_tools.append(kwargs)

    def register_hook(self, name, callback):
        self.registered_hooks.append((name, callback))


def test_signed_request_matches_node_canonical_contract():
    captured = {}

    def opener(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse({"ok": True, "items": []})

    secret = "s" * 32
    bridge = TongzhouBridgeClient(
        "http://tongzhou-api:8787",
        secret,
        opener=opener,
        clock=lambda: 1_700_000_000,
        nonce_factory=lambda: "nonce-1234567890abcdef",
    )
    result = bridge.call(
        "tongzhou_query_inventory_risk",
        "execute",
        {"sku": "SKU-1"},
        session_id="tz-session",
        tool_call_id="call-1",
    )
    request = captured["request"]
    body = request.data
    digest = hashlib.sha256(body).hexdigest()
    canonical = "\n".join((
        "1700000000",
        "nonce-1234567890abcdef",
        "POST",
        "/api/internal/hermes/v1/tools/tongzhou_query_inventory_risk/execute",
        digest,
    ))
    expected = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    assert request.get_header("X-hermes-signature") == expected
    assert request.get_header("X-hermes-body-sha256") == digest
    assert captured["timeout"] == 15
    assert result["ok"] is True


def test_registers_only_declared_business_tools_and_correlation_approval_hooks():
    context = FakeContext()
    bridge = FakeBridge()
    tools.register_tools(context, bridge)
    assert {item["name"] for item in context.registered_tools} == set(schemas.TOOL_SCHEMAS)
    assert {item["toolset"] for item in context.registered_tools} == {"tongzhou-business"}
    assert [name for name, _callback in context.registered_hooks] == ["pre_tool_call", "pre_tool_call"]


def test_correlation_hook_injects_trusted_call_id_for_registry_handler():
    hook = tools.make_correlation_hook()
    result = hook(
        tool_name="tongzhou_query_inventory_risk",
        tool_call_id="call-1",
    )
    assert result == {
        "action": "modify",
        "args": {"_tongzhou_tool_call_id": "call-1"},
    }
    assert hook(tool_name="tongzhou_query_inventory_risk", tool_call_id="")["action"] == "block"


def test_read_tool_does_not_request_approval():
    hook = tools.make_approval_hook(FakeBridge())
    assert hook(
        tool_name="tongzhou_query_inventory_risk",
        args={"sku": "SKU-1"},
        session_id="tz-session",
        tool_call_id="call-1",
    ) is None


def test_write_tool_previews_then_requests_unique_one_time_approval():
    bridge = FakeBridge({
        "ok": True,
        "preview": {"title": "创建备货草稿", "summary": "2 个 SKU", "warnings": []},
    })
    hook = tools.make_approval_hook(bridge)
    result = hook(
        tool_name="tongzhou_assign_exception",
        args={"caseId": "case-1", "version": 2, "assigneeId": "u-2"},
        session_id="tz-session",
        tool_call_id="call-99",
    )
    assert result["action"] == "approve"
    assert result["rule_key"] == "tongzhou:tongzhou_assign_exception:call-99"
    assert bridge.calls[0][0][1] == "preview"


def test_every_declared_write_tool_is_approval_gated():
    for index, tool_name in enumerate(sorted(schemas.WRITE_TOOLS)):
        bridge = FakeBridge({
            "ok": True,
            "preview": {"title": tool_name, "summary": "impact preview", "warnings": []},
        })
        result = tools.make_approval_hook(bridge)(
            tool_name=tool_name,
            args={"caseId": "case-1", "version": 1},
            session_id="tz-session",
            tool_call_id=f"call-{index}",
        )
        assert result["action"] == "approve"
        assert result["rule_key"] == f"tongzhou:{tool_name}:call-{index}"
        assert bridge.calls[0][0][1] == "preview"


def test_write_tool_fails_closed_when_preview_or_context_is_missing():
    missing = tools.make_approval_hook(FakeBridge())(
        tool_name="tongzhou_send_exception_reminder", args={}, session_id="", tool_call_id=""
    )
    failed = tools.make_approval_hook(FakeBridge(error=BridgeError("offline")))(
        tool_name="tongzhou_send_exception_reminder",
        args={"caseId": "case-1", "version": 1},
        session_id="tz-session",
        tool_call_id="call-2",
    )
    assert missing["action"] == "block"
    assert failed["action"] == "block"


def test_handler_never_accepts_model_supplied_identity_context():
    forbidden = {"userId", "user_id", "permissions", "authorization", "token", "session_id", "tool_call_id"}
    for schema in schemas.TOOL_SCHEMAS.values():
        assert forbidden.isdisjoint(schema["parameters"]["properties"])

    bridge = FakeBridge()
    handler = tools.make_handler("tongzhou_query_exception_cases", bridge)
    missing = json.loads(handler({"status": "open"}, session_id="tz-session"))
    assert "error" in missing

    result = json.loads(handler(
        {"status": "open", "_tongzhou_tool_call_id": "call-7"},
        session_id="tz-session",
    ))
    assert result["ok"] is True
    assert bridge.calls[0][0][2] == {"status": "open"}
    assert bridge.calls[0][1]["tool_call_id"] == "call-7"

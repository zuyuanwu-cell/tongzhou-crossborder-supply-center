"""Small signed HTTP client for the server-owned Tongzhou bridge."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Callable

from .schemas import WRITE_TOOLS


class BridgeError(RuntimeError):
    """A fail-closed bridge error safe to return as a tool failure."""


class TongzhouBridgeClient:
    def __init__(
        self,
        base_url: str | None = None,
        secret: str | None = None,
        *,
        opener: Callable[..., Any] | None = None,
        clock: Callable[[], float] = time.time,
        nonce_factory: Callable[[], str] = lambda: uuid.uuid4().hex,
    ) -> None:
        self.base_url = (base_url or os.environ.get("TONGZHOU_BRIDGE_BASE_URL", "")).rstrip("/")
        self.secret = secret or os.environ.get("HERMES_BRIDGE_SECRET", "")
        self.opener = opener or urllib.request.urlopen
        self.clock = clock
        self.nonce_factory = nonce_factory
        if not self.base_url.startswith(("http://", "https://")):
            raise BridgeError("TONGZHOU_BRIDGE_BASE_URL must be an http(s) URL")
        if len(self.secret) < 32:
            raise BridgeError("HERMES_BRIDGE_SECRET must contain at least 32 characters")

    def _headers(self, path: str, body: bytes) -> dict[str, str]:
        timestamp = str(int(self.clock()))
        nonce = self.nonce_factory()
        digest = hashlib.sha256(body).hexdigest()
        canonical = "\n".join((timestamp, nonce, "POST", path, digest))
        signature = hmac.new(self.secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
        return {
            "Content-Type": "application/json",
            "X-Hermes-Timestamp": timestamp,
            "X-Hermes-Nonce": nonce,
            "X-Hermes-Body-SHA256": digest,
            "X-Hermes-Signature": signature,
        }

    def call(
        self,
        tool: str,
        phase: str,
        arguments: dict[str, Any],
        *,
        session_id: str,
        tool_call_id: str,
    ) -> dict[str, Any]:
        if not session_id or not tool_call_id:
            raise BridgeError("Hermes did not provide the required session/tool correlation context")
        if phase not in {"preview", "execute"}:
            raise BridgeError("Unsupported bridge phase")
        path = f"/api/internal/hermes/v1/tools/{tool}/{phase}"
        payload = {
            "session_id": session_id,
            "tool_call_id": tool_call_id,
            "arguments": arguments,
        }
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}", body, self._headers(path, body), method="POST"
        )
        timeout = 30 if phase == "execute" and tool in WRITE_TOOLS else 15
        try:
            with self.opener(request, timeout=timeout) as response:
                raw = response.read(1_048_577)
                if len(raw) > 1_048_576:
                    raise BridgeError("Tongzhou bridge response exceeded 1 MiB")
        except urllib.error.HTTPError as error:
            raw = error.read(65_537)
            try:
                detail = json.loads(raw.decode("utf-8"))
                message = str(detail.get("message") or detail.get("code") or "bridge request failed")
            except (UnicodeDecodeError, json.JSONDecodeError):
                message = "bridge request failed"
            raise BridgeError(f"Tongzhou bridge rejected the request ({error.code}): {message}") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise BridgeError("Tongzhou bridge is unavailable") from error
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BridgeError("Tongzhou bridge returned invalid JSON") from error
        if not isinstance(result, dict):
            raise BridgeError("Tongzhou bridge returned an invalid result")
        if result.get("ok") is False:
            raise BridgeError(str(result.get("message") or result.get("code") or "Tongzhou bridge request failed"))
        return result

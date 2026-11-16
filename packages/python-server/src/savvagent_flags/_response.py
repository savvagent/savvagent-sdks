"""Reading the evaluate response (docs/SDK-DEVELOPER-GUIDE.md, Flag Evaluation)."""

from __future__ import annotations

from typing import Any

from .exceptions import SavvagentFlagsError


def evaluate_payload(data: Any) -> tuple[dict[str, Any], bool]:
    """Return the response object and its ``enabled`` flag, or raise ``SavvagentFlagsError``.

    The server answers ``{"key", "enabled", "variation", "configuration", ...}``. A body that is
    not an object, or whose ``enabled`` is missing or not a JSON boolean, is a failed lookup: the
    caller returns the default and caches nothing (#112). Substituting the default here would
    cache it for the TTL as if the server had said so.
    """
    if not isinstance(data, dict):
        raise SavvagentFlagsError("the evaluate response is not a JSON object")
    enabled = data.get("enabled")
    if not isinstance(enabled, bool):
        raise SavvagentFlagsError("the evaluate response has no boolean `enabled`")
    return data, enabled


def response_metadata(data: dict[str, Any]) -> tuple[int | None, str | None]:
    """Return the response's ``version`` and ``scope``; a field of the wrong type is ``None``.

    Malformed metadata never fails a lookup: ``enabled`` is the only field that does. A JSON
    boolean is not a version, though ``bool`` is an ``int`` in Python.
    """
    version = data.get("version")
    scope = data.get("scope")
    return (
        version if isinstance(version, int) and not isinstance(version, bool) else None,
        scope if isinstance(scope, str) else None,
    )

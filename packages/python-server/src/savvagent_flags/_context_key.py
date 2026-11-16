"""
Canonical cache key for an evaluation context.
"""

from __future__ import annotations

import json
from typing import Any


def context_key(context: dict[str, Any]) -> str | None:
    """
    Return the canonical JSON of the context the SDK sends to the server.

    The server's answer depends on the whole context (user, attributes, ...),
    so the evaluation cache must be keyed by it as well as by flag key;
    otherwise one user's result is served to another (#127). Keys are sorted
    so the same attributes inserted in a different order share one entry.

    Returns None when the context cannot be encoded (for example an attribute
    holding a non-JSON value); the caller then skips the cache for that call.
    """
    try:
        return json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    except (TypeError, ValueError):
        return None

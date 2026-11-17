"""The plain-HTTP warning for a server key, shared by the sync and async clients."""

from __future__ import annotations

import sys
from urllib.parse import urlsplit

_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def warn_if_plain_http(api_key: str, base_url: str) -> None:
    """Warn once on stderr when a ``srv_`` key would be sent without TLS.

    The server key is a secret: it travels in ``Authorization`` on every request
    and on the realtime stream. Matches the Rust SDK: no warning for an ``https``
    base URL, a loopback host (``localhost``, ``127.0.0.1``, ``[::1]``), an
    ``sdk_`` key, or a base URL without a scheme.
    """
    if not api_key.startswith("srv_"):
        return
    try:
        parts = urlsplit(base_url)
        host = parts.hostname
    except ValueError:
        return
    scheme = parts.scheme.lower()
    if not scheme or scheme == "https" or host in _LOOPBACK_HOSTS:
        return
    print(
        f"Savvagent Flags: the server key will be sent over {scheme}; use an https base_url",
        file=sys.stderr,
    )

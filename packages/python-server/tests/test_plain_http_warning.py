"""A server key sent over plain HTTP is warned about once (#44)."""

from __future__ import annotations

import pytest

from savvagent_flags import AsyncFlagClient, FlagClient, FlagClientConfig

CLIENTS = [FlagClient, AsyncFlagClient]


def _build(client_cls: type, api_key: str, base_url: str) -> None:
    client = client_cls(
        FlagClientConfig(
            api_key=api_key,
            base_url=base_url,
            enable_realtime=False,
            enable_telemetry=False,
        )
    )
    if isinstance(client, FlagClient):
        client.close()


@pytest.mark.parametrize("client_cls", CLIENTS)
@pytest.mark.parametrize(
    ("base_url", "scheme"),
    [
        ("http://flags.internal:8080/flags", "http"),
        ("HTTP://flags.example.com", "http"),
        ("ws://flags.example.com", "ws"),
    ],
)
def test_server_key_over_plain_http_warns_once(
    capsys: pytest.CaptureFixture[str], client_cls: type, base_url: str, scheme: str
) -> None:
    _build(client_cls, "srv_secret", base_url)
    err = capsys.readouterr().err
    message = f"Savvagent Flags: the server key will be sent over {scheme}; use an https base_url"
    assert err.count(message) == 1
    assert "srv_secret" not in err


@pytest.mark.parametrize("client_cls", CLIENTS)
@pytest.mark.parametrize(
    ("api_key", "base_url"),
    [
        ("srv_secret", "https://api.savvagent.com/flags"),
        ("srv_secret", "http://localhost:8080"),
        ("srv_secret", "http://LOCALHOST:8080"),
        ("srv_secret", "http://127.0.0.1:8080/flags"),
        ("srv_secret", "http://[::1]:8080"),
        ("sdk_public", "http://flags.internal:8080"),
        ("srv_secret", "flags.internal/flags"),
    ],
)
def test_no_warning(
    capsys: pytest.CaptureFixture[str], client_cls: type, api_key: str, base_url: str
) -> None:
    _build(client_cls, api_key, base_url)
    assert "will be sent over" not in capsys.readouterr().err

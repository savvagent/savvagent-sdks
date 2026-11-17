"""Both clients send the configured environment and can switch it (#49)."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from savvagent_flags import AsyncFlagClient, FlagClient, FlagClientConfig, FlagContext
from tests.conftest import server_body

URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"


def _ok() -> httpx.Response:
    return httpx.Response(200, json=server_body("checkout", True))


def _config() -> FlagClientConfig:
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        environment="staging",
        enable_realtime=False,
        enable_telemetry=False,
    )


def _sent_environment(route: respx.Route, call: int = -1) -> object:
    return json.loads(route.calls[call].request.content)["context"].get("environment")


class TestSyncEnvironment:
    @respx.mock
    def test_fills_configured_environment(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        with FlagClient(_config()) as client:
            client.evaluate("checkout", FlagContext(user_id="u1"))
        assert _sent_environment(route) == "staging"

    @respx.mock
    def test_caller_environment_wins(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        with FlagClient(_config()) as client:
            client.evaluate("checkout", FlagContext(user_id="u1", environment="beta"))
        assert _sent_environment(route) == "beta"

    @respx.mock
    def test_set_environment_clears_cache_and_is_sent(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        with FlagClient(_config()) as client:
            client.evaluate("checkout")
            client.set_environment("production")
            assert client.get_environment() == "production"
            assert client.is_enabled_cached("checkout") is False
            client.evaluate("checkout")
        assert route.call_count == 2
        assert _sent_environment(route, 1) == "production"


class TestAsyncEnvironment:
    @respx.mock
    async def test_fills_configured_environment(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        async with AsyncFlagClient(_config()) as client:
            await client.evaluate("checkout", FlagContext(user_id="u1"))
        assert _sent_environment(route) == "staging"

    @respx.mock
    async def test_fills_environment_without_context(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        async with AsyncFlagClient(_config()) as client:
            await client.evaluate("checkout")
        assert _sent_environment(route) == "staging"

    @respx.mock
    async def test_caller_environment_wins_and_context_is_not_mutated(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        context = FlagContext(user_id="u1")
        async with AsyncFlagClient(_config()) as client:
            await client.evaluate("checkout", FlagContext(user_id="u1", environment="beta"))
            await client.evaluate("checkout", context)
        assert _sent_environment(route, 0) == "beta"
        assert _sent_environment(route, 1) == "staging"
        assert context.environment is None

    def test_get_environment_defaults_to_config(self) -> None:
        assert AsyncFlagClient(_config()).get_environment() == "staging"

    @respx.mock
    async def test_set_environment_clears_cache_and_is_sent(self) -> None:
        route = respx.post(URL).mock(return_value=_ok())
        async with AsyncFlagClient(_config()) as client:
            await client.evaluate("checkout")
            assert client.is_enabled_cached("checkout") is True
            client.set_environment("production")
            assert client.get_environment() == "production"
            # The old environment's entry is gone, not merely keyed differently.
            assert await client._cache.keys() == []
            await client.evaluate("checkout")
        assert route.call_count == 2
        assert _sent_environment(route, 1) == "production"

    @respx.mock
    async def test_set_environment_drops_a_result_in_flight(self) -> None:
        """A response requested before set_environment is not cached after it."""
        client = AsyncFlagClient(_config())

        def respond(request: httpx.Request) -> httpx.Response:
            client.set_environment("production")
            return httpx.Response(200, json=server_body("checkout", True))

        respx.post(URL).mock(side_effect=respond)
        async with client:
            await client.evaluate("checkout")
            assert await client._cache.keys() == []


@pytest.mark.parametrize("client_cls", [FlagClient, AsyncFlagClient])
def test_set_environment_is_synchronous(client_cls: type) -> None:
    client = client_cls(_config())
    assert client.set_environment("beta") is None
    assert client.get_environment() == "beta"
    if isinstance(client, FlagClient):
        client.close()

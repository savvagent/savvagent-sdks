"""An evaluate in flight when its flag is invalidated must not re-cache its stale result."""

from __future__ import annotations

import httpx
import pytest
import respx

from savvagent_flags import AsyncFlagClient, FlagClient, FlagClientConfig
from savvagent_flags.cache import AsyncFlagCache, FlagCache
from tests.conftest import server_body

URL = "https://api.savvagent.com/flags/api/flags/kill/evaluate"


def _config() -> FlagClientConfig:
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        base_url="https://api.savvagent.com/flags",
        enable_realtime=False,
        enable_telemetry=False,
    )


def test_sync_invalidation_during_request_drops_the_write() -> None:
    client = FlagClient(_config())
    calls: list[int] = []

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            # The kill switch flips while this (stale) request is in flight.
            client.invalidate_cache("kill")
            return httpx.Response(200, json=server_body("kill", True))
        return httpx.Response(200, json=server_body("kill", False))

    with respx.mock(assert_all_called=False) as router:
        router.post(URL).mock(side_effect=respond)
        first = client.evaluate("kill")
        second = client.evaluate("kill")
    client.close()

    assert first.value is True
    assert second.reason == "evaluated"
    assert second.value is False
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_async_invalidation_during_request_drops_the_write() -> None:
    async with AsyncFlagClient(_config()) as client:
        await _run_async(client)


async def _run_async(client: AsyncFlagClient) -> None:
    calls: list[int] = []

    async def respond(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        if len(calls) == 1:
            await client.invalidate_cache("kill")
            return httpx.Response(200, json=server_body("kill", True))
        return httpx.Response(200, json=server_body("kill", False))

    with respx.mock(assert_all_called=False) as router:
        router.post(URL).mock(side_effect=respond)
        first = await client.evaluate("kill")
        second = await client.evaluate("kill")
    assert first.value is True
    assert second.reason == "evaluated"
    assert second.value is False
    assert len(calls) == 2


def test_cache_generation_rules() -> None:
    cache = FlagCache()
    gen = cache.generation("a")
    cache.invalidate("b")  # another flag: does not matter
    cache.set("a", True, generation=gen)
    assert cache.get("a") is True

    gen = cache.generation("a")
    cache.invalidate("a")
    cache.set("a", False, generation=gen)
    assert cache.get("a") is None

    gen = cache.generation("a")
    cache.invalidate()  # all flags
    cache.set("a", False, generation=gen)
    assert cache.get("a") is None

    cache.set("a", True)  # no generation: always stored
    assert cache.get("a") is True


@pytest.mark.asyncio
async def test_async_cache_generation_rules() -> None:
    cache = AsyncFlagCache()
    gen = cache.generation("a")
    cache.mark_invalidated("a")
    await cache.set("a", True, generation=gen)
    assert await cache.get("a") is None

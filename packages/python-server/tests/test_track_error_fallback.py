"""track_error reports the right value, never another context's (#34)."""

from __future__ import annotations

import json
from typing import Any

import httpx
import respx

from savvagent_flags import AsyncFlagClient, FlagClient, FlagClientConfig, FlagContext
from savvagent_flags.types import FlagUpdateEvent
from tests.conftest import server_body

URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"


def _config(cache_ttl: int = 60) -> FlagClientConfig:
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        base_url="https://api.savvagent.com/flags",
        enable_realtime=False,
        enable_telemetry=False,
        cache_ttl=cache_ttl,
    )


def _by_user(request: httpx.Request) -> httpx.Response:
    context = json.loads(request.content)["context"]
    return httpx.Response(200, json=server_body("checkout", context.get("user_id") == "a"))


def _update(key: str) -> FlagUpdateEvent:
    return FlagUpdateEvent(type="flag.updated", flag_key=key, data={"key": key})


ERR = RuntimeError("boom")


class TestSyncTrackErrorFallback:
    def _client(self, cache_ttl: int = 60) -> tuple[FlagClient, list[Any]]:
        client = FlagClient(_config(cache_ttl))
        recorded: list[Any] = []
        client._telemetry.track_error = recorded.append  # type: ignore[method-assign]
        return client, recorded

    def test_cache_miss_for_one_context_never_reports_another_contexts_value(self) -> None:
        client, recorded = self._client(cache_ttl=0)
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            client.evaluate("checkout", FlagContext(user_id="b"))
            client.evaluate("checkout", FlagContext(user_id="a"))
        client.track_error("checkout", ERR, FlagContext(user_id="b"))
        client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    def test_context_less_error_uses_last_value(self) -> None:
        client, recorded = self._client()
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            client.evaluate("checkout", FlagContext(user_id="a"))
        client.track_error("checkout", ERR)
        client.close()
        assert [e.flag_enabled for e in recorded] == [True]

    def test_response_that_predates_an_invalidation_is_not_remembered(self) -> None:
        client, recorded = self._client()

        def respond(request: httpx.Request) -> httpx.Response:
            client.invalidate_cache("checkout")
            return httpx.Response(200, json=server_body("checkout", True))

        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=respond)
            assert client.evaluate("checkout", FlagContext(user_id="a")).value is True
        client.track_error("checkout", ERR)
        client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    def _seed(self, client: FlagClient) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            client.evaluate("checkout", FlagContext(user_id="a"))
        assert client._last_values == {"checkout": True}

    def test_realtime_update_forgets_the_flag(self) -> None:
        client, recorded = self._client()
        self._seed(client)
        client._on_realtime_update(_update("checkout"))
        client.track_error("checkout", ERR)
        client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    def test_invalidate_cache_forgets_the_flag(self) -> None:
        client, _ = self._client()
        self._seed(client)
        client.invalidate_cache("other")
        assert client._last_values == {"checkout": True}
        client.invalidate_cache("checkout")
        assert client._last_values == {}
        client.close()

    def test_invalidate_cache_without_key_forgets_everything(self) -> None:
        client, _ = self._client()
        self._seed(client)
        client.invalidate_cache()
        assert client._last_values == {}
        client.close()


class TestAsyncTrackErrorFallback:
    async def _client(self, cache_ttl: int = 60) -> tuple[AsyncFlagClient, list[Any]]:
        client = AsyncFlagClient(_config(cache_ttl))
        await client.__aenter__()
        recorded: list[Any] = []

        async def record(event: Any) -> None:
            recorded.append(event)

        client._telemetry.track_error = record  # type: ignore[method-assign]
        return client, recorded

    async def test_cache_miss_for_one_context_never_reports_another_contexts_value(
        self,
    ) -> None:
        client, recorded = await self._client(cache_ttl=0)
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            await client.evaluate("checkout", FlagContext(user_id="b"))
            await client.evaluate("checkout", FlagContext(user_id="a"))
        await client.track_error("checkout", ERR, FlagContext(user_id="b"))
        await client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    async def test_context_less_error_uses_last_value(self) -> None:
        client, recorded = await self._client()
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            await client.evaluate("checkout", FlagContext(user_id="a"))
        await client.track_error("checkout", ERR)
        await client.close()
        assert [e.flag_enabled for e in recorded] == [True]

    async def test_response_that_predates_an_invalidation_is_not_remembered(self) -> None:
        client, recorded = await self._client()

        async def respond(request: httpx.Request) -> httpx.Response:
            await client.invalidate_cache("checkout")
            return httpx.Response(200, json=server_body("checkout", True))

        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=respond)
            assert (await client.evaluate("checkout", FlagContext(user_id="a"))).value is True
        await client.track_error("checkout", ERR)
        await client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    async def _seed(self, client: AsyncFlagClient) -> None:
        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=_by_user)
            await client.evaluate("checkout", FlagContext(user_id="a"))
        assert client._last_values == {"checkout": True}

    async def test_realtime_update_forgets_the_flag(self) -> None:
        client, recorded = await self._client()
        await self._seed(client)
        client._sync_invalidate_cache("checkout")
        await client.track_error("checkout", ERR)
        await client.close()
        assert [e.flag_enabled for e in recorded] == [False]

    async def test_invalidate_cache_forgets_the_flag(self) -> None:
        client, _ = await self._client()
        await self._seed(client)
        await client.invalidate_cache("other")
        assert client._last_values == {"checkout": True}
        await client.invalidate_cache("checkout")
        assert client._last_values == {}
        await client.close()

    async def test_invalidate_cache_without_key_forgets_everything(self) -> None:
        client, _ = await self._client()
        await self._seed(client)
        await client.invalidate_cache()
        assert client._last_values == {}
        await client.close()

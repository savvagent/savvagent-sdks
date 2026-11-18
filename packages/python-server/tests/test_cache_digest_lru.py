"""Digest cache keys and one total LRU bound across all flags (#30)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

import httpx
import respx

from savvagent_flags import (
    AsyncFlagCache,
    AsyncFlagClient,
    FlagCache,
    FlagClient,
    FlagClientConfig,
    FlagContext,
)
from savvagent_flags import cache as cache_module
from savvagent_flags._context_key import context_key
from tests.conftest import server_body

URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
SECRET_USER = "alice-secret-user-id"


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _stored_keys(cache: FlagCache | AsyncFlagCache) -> list[tuple[str, str]]:
    """Every (flag, context) key the cache holds, from both the LRU map and the flag index."""
    keys = list(cache._entries.keys())
    for flag, digests in cache._by_flag.items():
        keys.extend((flag, d) for d in digests)
    return keys


def _config() -> FlagClientConfig:
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        base_url="https://api.savvagent.com/flags",
        enable_realtime=False,
        enable_telemetry=False,
    )


class TestDigestKey:
    def test_stored_key_is_sha256_hex_of_context_json(self) -> None:
        cache = FlagCache(ttl=60)
        raw = context_key({"user_id": SECRET_USER, "attributes": {"plan": "pro"}})
        assert raw is not None
        cache.set("f", True, context_key=raw)
        assert _stored_keys(cache) == [("f", _sha256(raw))] * 2
        assert cache.get("f", context_key=raw) is True

    def test_equal_contexts_share_one_entry_and_different_contexts_do_not(self) -> None:
        cache = FlagCache(ttl=60)
        a = context_key({"user_id": "u", "attributes": {"x": 1, "y": 2}})
        b = context_key({"attributes": {"y": 2, "x": 1}, "user_id": "u"})
        c = context_key({"user_id": "u", "attributes": {"x": 1, "y": 3}})
        assert a is not None and b is not None and c is not None
        cache.set("f", True, context_key=a)
        cache.set("f", False, context_key=b)
        assert len(cache) == 1
        assert cache.get("f", context_key=a) is False
        cache.set("f", True, context_key=c)
        assert len(cache) == 2

    def test_raw_user_id_is_in_no_cache_key(self) -> None:
        cache = FlagCache(ttl=60)
        raw = context_key({"user_id": SECRET_USER})
        assert raw is not None
        cache.set("f", True, context_key=raw)
        cache.set("g", True, context_key=raw)
        for flag, digest in _stored_keys(cache):
            assert SECRET_USER not in flag and SECRET_USER not in digest
        assert all(SECRET_USER not in repr(e) for e in cache._entries.values())

    async def test_async_stored_key_is_sha256_hex_and_raw_user_id_is_in_no_key(self) -> None:
        cache = AsyncFlagCache(ttl=60)
        raw = context_key({"user_id": SECRET_USER})
        assert raw is not None
        await cache.set("f", True, context_key=raw)
        assert _stored_keys(cache) == [("f", _sha256(raw))] * 2
        assert await cache.get("f", context_key=raw) is True
        assert cache.peek_entry("f", context_key=raw) is not None

    def test_client_cache_holds_no_raw_context_and_request_body_is_full_context(self) -> None:
        client = FlagClient(_config())
        bodies: list[Any] = []

        def respond(request: httpx.Request) -> httpx.Response:
            bodies.append(json.loads(request.content))
            return httpx.Response(200, json=server_body("checkout", True))

        with respx.mock(assert_all_called=False) as router:
            router.post(URL).mock(side_effect=respond)
            ctx = FlagContext(user_id=SECRET_USER)
            assert client.evaluate("checkout", ctx).value is True
            assert client.evaluate("checkout", ctx).reason == "cached"
        assert client.is_enabled_cached("checkout", ctx) is True
        keys = _stored_keys(client._cache)
        client.close()
        assert len(bodies) == 1
        assert bodies[0]["context"]["user_id"] == SECRET_USER
        assert keys and all(SECRET_USER not in d for _, d in keys)

    async def test_async_client_cache_holds_no_raw_context(self) -> None:
        ctx = FlagContext(user_id=SECRET_USER)
        async with AsyncFlagClient(_config()) as client:
            with respx.mock(assert_all_called=False) as router:
                router.post(URL).mock(
                    return_value=httpx.Response(200, json=server_body("checkout", True))
                )
                assert (await client.evaluate("checkout", ctx)).value is True
                assert (await client.evaluate("checkout", ctx)).reason == "cached"
            assert client.is_enabled_cached("checkout", ctx) is True
            keys = _stored_keys(client._cache)
        assert keys and all(SECRET_USER not in d for _, d in keys)


class TestTotalBound:
    def test_default_total_bound_is_10000_and_per_flag_name_is_an_alias(self) -> None:
        assert cache_module.MAX_ENTRIES == 10_000
        assert cache_module.MAX_CONTEXTS_PER_FLAG == cache_module.MAX_ENTRIES
        assert FlagCache()._max_entries == 10_000
        assert AsyncFlagCache()._max_entries == 10_000

    def test_entries_across_flags_never_exceed_cap_and_lru_goes_first(self) -> None:
        cache = FlagCache(ttl=60)
        cache._max_entries = 3
        cache.set("f", True, context_key="1")
        cache.set("g", True, context_key="2")
        cache.set("h", True, context_key="3")
        for i in range(4, 10):
            cache.set("fgh"[i % 3], True, context_key=str(i))
            assert len(cache._entries) <= 3
            assert sum(len(d) for d in cache._by_flag.values()) <= 3
        # The oldest went first: only the last three writes remain.
        assert cache.get("f", context_key="1") is None
        assert [cache.get("fgh"[i % 3], context_key=str(i)) for i in (7, 8, 9)] == [True] * 3

    async def test_async_entries_across_flags_never_exceed_cap_and_lru_goes_first(self) -> None:
        cache = AsyncFlagCache(ttl=60)
        cache._max_entries = 2
        await cache.set("f", True, context_key="a")
        await cache.set("g", True, context_key="a")
        await cache.set("h", True, context_key="a")
        assert len(cache._entries) == 2
        assert await cache.get("f", context_key="a") is None
        assert await cache.get("g", context_key="a") is True
        assert await cache.get("h", context_key="a") is True

    def test_hit_refreshes_recency(self) -> None:
        cache = FlagCache(ttl=60)
        cache._max_entries = 2
        cache.set("f", True, context_key="a")
        cache.set("g", True, context_key="b")
        assert cache.get("f", context_key="a") is True  # "f"/"a" is now the most recent
        cache.set("h", True, context_key="c")
        assert cache.get("f", context_key="a") is True
        assert cache.get("g", context_key="b") is None

    async def test_async_hit_refreshes_recency(self) -> None:
        cache = AsyncFlagCache(ttl=60)
        cache._max_entries = 2
        await cache.set("f", True, context_key="a")
        await cache.set("g", True, context_key="b")
        assert cache.peek_entry("f", context_key="a") is not None
        await cache.set("h", True, context_key="c")
        assert await cache.get("f", context_key="a") is True
        assert await cache.get("g", context_key="b") is None

    def test_rewriting_an_existing_entry_at_the_cap_evicts_nothing(self) -> None:
        cache = FlagCache(ttl=60)
        cache._max_entries = 2
        cache.set("f", True, context_key="a")
        cache.set("g", True, context_key="b")
        cache.set("f", False, context_key="a")
        assert cache.get("f", context_key="a") is False
        assert cache.get("g", context_key="b") is True


class TestInvalidationWithDigestKeys:
    def test_invalidate_flag_removes_all_its_contexts_and_leaves_other_flags(self) -> None:
        cache = FlagCache(ttl=60)
        for ctx in ("a", "b", "c"):
            cache.set("f", True, context_key=ctx)
        cache.set("g", True, context_key="a")
        cache.invalidate("f")
        assert all(cache.get("f", context_key=ctx) is None for ctx in ("a", "b", "c"))
        assert cache.get("g", context_key="a") is True
        assert _stored_keys(cache) == [("g", _sha256("a"))] * 2

    async def test_async_invalidate_flag_removes_all_its_contexts_and_leaves_other_flags(
        self,
    ) -> None:
        cache = AsyncFlagCache(ttl=60)
        for ctx in ("a", "b"):
            await cache.set("f", True, context_key=ctx)
        await cache.set("g", True, context_key="a")
        await cache.invalidate("f")
        assert await cache.get("f", context_key="a") is None
        assert await cache.get("g", context_key="a") is True
        cache.invalidate_nowait("g")
        assert _stored_keys(cache) == []

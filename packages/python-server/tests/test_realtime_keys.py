"""Keys from the realtime stream are validated before anything is invalidated (#34)."""

from __future__ import annotations

import json

from savvagent_flags.cache import AsyncFlagCache, FlagCache
from savvagent_flags.realtime import AsyncRealtimeService, RealtimeService
from savvagent_flags.types import FlagUpdateEvent

BAD_PAYLOADS = [
    json.dumps({"key": "../x", "type": "flag.updated"}),
    json.dumps(["a"]),
    json.dumps({"key": 5, "type": "flag.updated"}),
    json.dumps({"key": None, "type": "flag.updated"}),
    json.dumps({"type": "flag.updated"}),
    "7",
    "not json",
]


def _sync() -> tuple[RealtimeService, list[FlagUpdateEvent]]:
    service = RealtimeService("https://api.savvagent.com/flags", "k")
    seen: list[FlagUpdateEvent] = []
    service.subscribe("*", seen.append)
    return service, seen


def _async() -> tuple[AsyncRealtimeService, list[FlagUpdateEvent]]:
    service = AsyncRealtimeService("https://api.savvagent.com/flags", "k")
    seen: list[FlagUpdateEvent] = []
    service.subscribe("*", seen.append)
    return service, seen


def test_sync_flag_event_with_invalid_keys_is_skipped() -> None:
    service, seen = _sync()
    for payload in BAD_PAYLOADS:
        service._handle_flag_event("flag.updated", payload)
    assert seen == []
    assert service._reconnect_attempts == 0


def test_sync_generic_message_with_invalid_keys_is_skipped() -> None:
    service, seen = _sync()
    for payload in BAD_PAYLOADS:
        service._handle_generic_message(payload)
    assert seen == []
    assert service._reconnect_attempts == 0


def test_sync_valid_events_still_notify() -> None:
    service, seen = _sync()
    service._handle_flag_event("flag.updated", json.dumps({"key": "new-flag_1.x"}))
    service._handle_generic_message(json.dumps({"type": "flag.updated", "key": "b"}))
    assert [e.flag_key for e in seen] == ["new-flag_1.x", "b"]


async def test_async_flag_event_with_invalid_keys_is_skipped() -> None:
    service, seen = _async()
    for payload in BAD_PAYLOADS:
        await service._handle_flag_event("flag.updated", payload)
    assert seen == []
    assert service._reconnect_attempts == 0


async def test_async_generic_message_with_invalid_keys_is_skipped() -> None:
    service, seen = _async()
    for payload in BAD_PAYLOADS:
        await service._handle_generic_message(payload)
    assert seen == []
    assert service._reconnect_attempts == 0


async def test_async_valid_events_still_notify() -> None:
    service, seen = _async()
    await service._handle_flag_event("flag.updated", json.dumps({"key": "a"}))
    await service._handle_generic_message(json.dumps({"type": "flag.updated", "key": "b"}))
    assert [e.flag_key for e in seen] == ["a", "b"]


def test_sync_generations_map_is_capped() -> None:
    cache = FlagCache()
    cache._max_generations = 3
    before = cache.generation("a")
    for key in ("a", "b", "c"):
        cache.invalidate(key)
    assert len(cache._generations) == 3
    cache.invalidate("d")  # over the cap: new epoch, map dropped
    assert cache._generations == {}
    # A generation read before the reset is still recognised as stale.
    assert cache.generation("a") != before
    cache.set("a", True, generation=before)
    assert cache.get("a") is None


async def test_async_generations_map_is_capped() -> None:
    cache = AsyncFlagCache()
    cache._max_generations = 3
    before = cache.generation("a")
    for key in ("a", "b", "c", "d"):
        await cache.invalidate(key)
    assert cache._generations == {}
    await cache.set("a", True, generation=before)
    assert await cache.get("a") is None

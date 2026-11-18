"""
Savvagent Flags Python Server SDK - Cache Implementation
"""

from __future__ import annotations

import asyncio
import hashlib
import threading
import time
from collections import OrderedDict
from typing import Any

from .types import CacheEntry

MAX_ENTRIES = 10_000
"""Most cached evaluations across all flags and contexts; the least recently used goes first."""

MAX_CONTEXTS_PER_FLAG = MAX_ENTRIES
"""Deprecated alias of ``MAX_ENTRIES``.

The cache used to hold up to this many contexts for each flag. It now holds
``MAX_ENTRIES`` entries in total across all flags (#30); this name is kept so
existing imports keep working and will be removed in a future major release.
"""

MAX_GENERATIONS = 10_000
"""Most per-flag invalidation counters kept before a new epoch replaces them."""


def _digest(context_key: str) -> str:
    """The lowercase hex SHA-256 of a context's canonical JSON: the key it is cached under."""
    return hashlib.sha256(context_key.encode("utf-8")).hexdigest()


class _CacheCore:
    """
    State and lock-free operations shared by FlagCache and AsyncFlagCache.

    Entries are keyed by ``(flag key, SHA-256 hex of the context's canonical
    JSON)``, so the raw context (user IDs, attributes) is never kept in the
    cache. One least-recently-used bound covers every flag; a hit refreshes
    recency. ``_by_flag`` indexes each flag's digests so ``invalidate(flag)``
    does not scan.

    Callers hold the subclass's lock, except where AsyncFlagCache documents why
    it need not.
    """

    def __init__(self, ttl: int) -> None:
        self._entries: OrderedDict[tuple[str, str], CacheEntry] = OrderedDict()
        self._by_flag: dict[str, set[str]] = {}
        self._ttl = ttl
        self._max_entries = MAX_ENTRIES
        # Bumped by every invalidation so a write from a request that started
        # before it can be dropped (see generation()).
        self._epoch = 0
        self._generations: dict[str, int] = {}
        self._max_generations = MAX_GENERATIONS

    def _generation(self, key: str) -> tuple[int, int]:
        return (self._epoch, self._generations.get(key, 0))

    def _bump(self, key: str | None) -> None:
        if key:
            self._generations[key] = self._generations.get(key, 0) + 1
            # Bound the map: past the cap a new epoch invalidates every
            # outstanding generation at once, so the counters can be dropped.
            if len(self._generations) > self._max_generations:
                self._epoch += 1
                self._generations.clear()
        else:
            self._epoch += 1
            self._generations.clear()

    def generation(self, key: str) -> tuple[int, int]:
        """
        Read the flag's invalidation generation. Pass it to set() so a result
        fetched before an invalidation is not cached after it.
        """
        return self._generation(key)

    def _remove(self, slot: tuple[str, str]) -> None:
        del self._entries[slot]
        flag, digest = slot
        digests = self._by_flag.get(flag)
        if digests is not None:
            digests.discard(digest)
            if not digests:
                del self._by_flag[flag]

    def _get(self, key: str, context_key: str) -> CacheEntry | None:
        slot = (key, _digest(context_key))
        entry = self._entries.get(slot)
        if entry is None:
            return None
        if time.time() > entry.expires_at:
            self._remove(slot)
            return None
        self._entries.move_to_end(slot)
        return entry

    def _store(
        self,
        key: str,
        context_key: str,
        generation: tuple[int, int] | None,
        entry: CacheEntry,
    ) -> None:
        if generation is not None and generation != self._generation(key):
            return
        slot = (key, _digest(context_key))
        self._entries[slot] = entry
        self._entries.move_to_end(slot)
        self._by_flag.setdefault(key, set()).add(slot[1])
        while len(self._entries) > max(self._max_entries, 1):
            self._remove(next(iter(self._entries)))

    def _drop(self, key: str | None) -> None:
        self._bump(key)
        if key:
            for digest in self._by_flag.pop(key, set()):
                self._entries.pop((key, digest), None)
        else:
            self._entries.clear()
            self._by_flag.clear()

    def _keys(self) -> list[str]:
        now = time.time()
        return [
            flag
            for flag, digests in self._by_flag.items()
            if any(self._entries[(flag, d)].expires_at > now for d in digests)
        ]

    def _len(self) -> int:
        now = time.time()
        return sum(1 for entry in self._entries.values() if entry.expires_at > now)

    def _entry(
        self,
        value: bool,
        flag_id: str | None,
        configuration: Any,
        variation: str | None,
        version: int | None,
        scope: str | None,
    ) -> CacheEntry:
        return CacheEntry(
            value=value,
            configuration=configuration,
            variation=variation,
            expires_at=time.time() + self._ttl,
            flag_id=flag_id,
            version=version,
            scope=scope,
        )


class FlagCache(_CacheCore):
    """
    Thread-safe in-memory cache for flag values with TTL, keyed by flag and context key.

    The context key is stored as its SHA-256 digest, never as given. At most
    ``MAX_ENTRIES`` entries are kept across all flags, evicting the least
    recently used.

    This synchronous cache implementation uses threading.RLock for
    thread safety, making it safe to use in multi-threaded applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        super().__init__(ttl)
        self._lock = threading.RLock()

    def get(self, key: str, *, context_key: str = "") -> bool | None:
        """
        Get a cached flag value.

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The cached boolean value, or None if not found or expired.
        """
        entry = self.get_entry(key, context_key=context_key)
        return entry.value if entry else None

    def get_entry(self, key: str, *, context_key: str = "") -> CacheEntry | None:
        """
        Get a complete cached entry (includes configuration and variation).

        A hit makes the entry the most recently used.

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        with self._lock:
            return self._get(key, context_key)

    def set(
        self,
        key: str,
        value: bool,
        flag_id: str | None = None,
        configuration: Any = None,
        variation: str | None = None,
        *,
        version: int | None = None,
        scope: str | None = None,
        context_key: str = "",
        generation: tuple[int, int] | None = None,
    ) -> None:
        """
        Set a flag value in cache.

        Args:
            key: The flag key.
            value: The boolean flag value.
            flag_id: Optional flag ID for reference.
            configuration: Optional configuration data.
            variation: Optional variation identifier.
            version: Optional flag version that produced the value.
            scope: Optional flag scope (``"application"`` or ``"enterprise"``).
            context_key: Canonical key of the evaluation context.
            generation: The value of generation(key) read before the request
                started; the write is dropped if the flag was invalidated since.
        """
        entry = self._entry(value, flag_id, configuration, variation, version, scope)
        with self._lock:
            self._store(key, context_key, generation, entry)

    def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        with self._lock:
            self._drop(key)

    def clear(self) -> None:
        """Clear all cached values."""
        self.invalidate()

    def keys(self) -> list[str]:
        """
        Get all cached flag keys.

        Returns:
            List of cached flag keys (not including expired entries).
        """
        with self._lock:
            return self._keys()

    def __len__(self) -> int:
        """Return the number of non-expired entries in the cache."""
        with self._lock:
            return self._len()


class AsyncFlagCache(_CacheCore):
    """
    Async-safe in-memory cache for flag values with TTL, keyed by flag and context key.

    The context key is stored as its SHA-256 digest, never as given. At most
    ``MAX_ENTRIES`` entries are kept across all flags, evicting the least
    recently used.

    This asynchronous cache implementation uses asyncio.Lock for
    async safety, making it safe to use in async applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        super().__init__(ttl)
        self._lock = asyncio.Lock()

    async def get(self, key: str, *, context_key: str = "") -> bool | None:
        """
        Get a cached flag value.

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The cached boolean value, or None if not found or expired.
        """
        entry = await self.get_entry(key, context_key=context_key)
        return entry.value if entry else None

    async def get_entry(self, key: str, *, context_key: str = "") -> CacheEntry | None:
        """
        Get a complete cached entry (includes configuration and variation).

        A hit makes the entry the most recently used.

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        async with self._lock:
            return self.peek_entry(key, context_key=context_key)

    def peek_entry(self, key: str, *, context_key: str = "") -> CacheEntry | None:
        """
        Synchronous get_entry, for code that cannot await.

        Safe on the event loop's thread without the lock: no critical section of
        this cache awaits, so none is ever suspended part-way when this runs.
        """
        return self._get(key, context_key)

    async def set(
        self,
        key: str,
        value: bool,
        flag_id: str | None = None,
        configuration: Any = None,
        variation: str | None = None,
        *,
        version: int | None = None,
        scope: str | None = None,
        context_key: str = "",
        generation: tuple[int, int] | None = None,
    ) -> None:
        """
        Set a flag value in cache.

        Args:
            key: The flag key.
            value: The boolean flag value.
            flag_id: Optional flag ID for reference.
            configuration: Optional configuration data.
            variation: Optional variation identifier.
            version: Optional flag version that produced the value.
            scope: Optional flag scope (``"application"`` or ``"enterprise"``).
            context_key: Canonical key of the evaluation context.
            generation: The value of generation(key) read before the request
                started; the write is dropped if the flag was invalidated since.
        """
        entry = self._entry(value, flag_id, configuration, variation, version, scope)
        async with self._lock:
            self._store(key, context_key, generation, entry)

    async def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        async with self._lock:
            self._drop(key)

    def mark_invalidated(self, key: str | None = None) -> None:
        """Bump the generation synchronously (for callbacks that cannot await)."""
        self._bump(key)

    def invalidate_nowait(self, key: str | None = None) -> None:
        """Synchronous invalidate (see peek_entry for why this needs no lock)."""
        self._drop(key)

    async def clear(self) -> None:
        """Clear all cached values."""
        await self.invalidate()

    async def keys(self) -> list[str]:
        """
        Get all cached flag keys.

        Returns:
            List of cached flag keys (not including expired entries).
        """
        async with self._lock:
            return self._keys()

    async def __aenter__(self) -> AsyncFlagCache:
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.clear()

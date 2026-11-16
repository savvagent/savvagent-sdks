"""
Savvagent Flags Python Server SDK - Cache Implementation
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from .types import CacheEntry

MAX_CONTEXTS_PER_FLAG = 10_000
"""Most distinct evaluation contexts cached for one flag; bounds memory."""


class FlagCache:
    """
    Thread-safe in-memory cache for flag values with TTL, keyed by flag and context key.

    This synchronous cache implementation uses threading.RLock for
    thread safety, making it safe to use in multi-threaded applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        self._cache: dict[str, dict[str, CacheEntry]] = {}
        self._ttl = ttl
        self._max_contexts_per_flag = MAX_CONTEXTS_PER_FLAG
        # Bumped by every invalidation so a write from a request that started
        # before it can be dropped (see generation()).
        self._epoch = 0
        self._generations: dict[str, int] = {}
        self._lock = threading.RLock()

    def _generation(self, key: str) -> tuple[int, int]:
        return (self._epoch, self._generations.get(key, 0))

    def _bump(self, key: str | None) -> None:
        if key:
            self._generations[key] = self._generations.get(key, 0) + 1
        else:
            self._epoch += 1
            self._generations.clear()

    def generation(self, key: str) -> tuple[int, int]:
        """
        Read the flag's invalidation generation. Pass it to set() so a result
        fetched before an invalidation is not cached after it.
        """
        return self._generation(key)

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

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        with self._lock:
            contexts = self._cache.get(key)
            if contexts is None:
                return None
            entry = contexts.get(context_key)
            if entry is None:
                return None

            # Check if expired
            if time.time() > entry.expires_at:
                del contexts[context_key]
                if not contexts:
                    del self._cache[key]
                return None

            return entry

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
        with self._lock:
            if generation is not None and generation != self._generation(key):
                return
            contexts = self._cache.setdefault(key, {})
            if len(contexts) >= self._max_contexts_per_flag and context_key not in contexts:
                # At the bound: drop expired entries, and if still more than
                # half full, start over so the newest context always fits.
                now = time.time()
                for stale in [k for k, e in contexts.items() if e.expires_at <= now]:
                    del contexts[stale]
                if len(contexts) > self._max_contexts_per_flag // 2:
                    contexts.clear()
            contexts[context_key] = CacheEntry(
                value=value,
                configuration=configuration,
                variation=variation,
                expires_at=time.time() + self._ttl,
                flag_id=flag_id,
                version=version,
                scope=scope,
            )

    def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        with self._lock:
            self._bump(key)
            if key:
                self._cache.pop(key, None)
            else:
                self._cache.clear()

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
            now = time.time()
            return [
                key
                for key, contexts in self._cache.items()
                if any(entry.expires_at > now for entry in contexts.values())
            ]

    def __len__(self) -> int:
        """Return the number of non-expired entries in the cache."""
        with self._lock:
            now = time.time()
            return sum(
                1
                for contexts in self._cache.values()
                for entry in contexts.values()
                if entry.expires_at > now
            )


class AsyncFlagCache:
    """
    Async-safe in-memory cache for flag values with TTL, keyed by flag and context key.

    This asynchronous cache implementation uses asyncio.Lock for
    async safety, making it safe to use in async applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        self._cache: dict[str, dict[str, CacheEntry]] = {}
        self._ttl = ttl
        self._max_contexts_per_flag = MAX_CONTEXTS_PER_FLAG
        # Bumped by every invalidation so a write from a request that started
        # before it can be dropped (see generation()).
        self._epoch = 0
        self._generations: dict[str, int] = {}
        self._lock = asyncio.Lock()

    def _generation(self, key: str) -> tuple[int, int]:
        return (self._epoch, self._generations.get(key, 0))

    def _bump(self, key: str | None) -> None:
        if key:
            self._generations[key] = self._generations.get(key, 0) + 1
        else:
            self._epoch += 1
            self._generations.clear()

    def generation(self, key: str) -> tuple[int, int]:
        """
        Read the flag's invalidation generation. Pass it to set() so a result
        fetched before an invalidation is not cached after it.
        """
        return self._generation(key)

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

        Args:
            key: The flag key to retrieve.
            context_key: Canonical key of the evaluation context.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        async with self._lock:
            contexts = self._cache.get(key)
            if contexts is None:
                return None
            entry = contexts.get(context_key)
            if entry is None:
                return None

            # Check if expired
            if time.time() > entry.expires_at:
                del contexts[context_key]
                if not contexts:
                    del self._cache[key]
                return None

            return entry

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
        async with self._lock:
            if generation is not None and generation != self._generation(key):
                return
            contexts = self._cache.setdefault(key, {})
            if len(contexts) >= self._max_contexts_per_flag and context_key not in contexts:
                # At the bound: drop expired entries, and if still more than
                # half full, start over so the newest context always fits.
                now = time.time()
                for stale in [k for k, e in contexts.items() if e.expires_at <= now]:
                    del contexts[stale]
                if len(contexts) > self._max_contexts_per_flag // 2:
                    contexts.clear()
            contexts[context_key] = CacheEntry(
                value=value,
                configuration=configuration,
                variation=variation,
                expires_at=time.time() + self._ttl,
                flag_id=flag_id,
                version=version,
                scope=scope,
            )

    async def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        async with self._lock:
            self._bump(key)
            if key:
                self._cache.pop(key, None)
            else:
                self._cache.clear()

    def mark_invalidated(self, key: str | None = None) -> None:
        """Bump the generation synchronously (for callbacks that cannot await)."""
        self._bump(key)

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
            now = time.time()
            return [
                key
                for key, contexts in self._cache.items()
                if any(entry.expires_at > now for entry in contexts.values())
            ]

    async def __aenter__(self) -> AsyncFlagCache:
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.clear()

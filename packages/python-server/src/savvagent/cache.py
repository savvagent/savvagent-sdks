"""
Savvagent Python Server SDK - Cache Implementation
"""

from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from .types import CacheEntry


class FlagCache:
    """
    Thread-safe in-memory cache for flag values with TTL.

    This synchronous cache implementation uses threading.RLock for
    thread safety, making it safe to use in multi-threaded applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        self._cache: dict[str, CacheEntry] = {}
        self._ttl = ttl
        self._lock = threading.RLock()

    def get(self, key: str) -> bool | None:
        """
        Get a cached flag value.

        Args:
            key: The flag key to retrieve.

        Returns:
            The cached boolean value, or None if not found or expired.
        """
        entry = self.get_entry(key)
        return entry.value if entry else None

    def get_entry(self, key: str) -> CacheEntry | None:
        """
        Get a complete cached entry (includes configuration and variation).

        Args:
            key: The flag key to retrieve.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None

            # Check if expired
            if time.time() > entry.expires_at:
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
    ) -> None:
        """
        Set a flag value in cache.

        Args:
            key: The flag key.
            value: The boolean flag value.
            flag_id: Optional flag ID for reference.
            configuration: Optional configuration data.
            variation: Optional variation identifier.
        """
        with self._lock:
            self._cache[key] = CacheEntry(
                value=value,
                configuration=configuration,
                variation=variation,
                expires_at=time.time() + self._ttl,
                flag_id=flag_id,
            )

    def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        with self._lock:
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
                for key, entry in self._cache.items()
                if entry.expires_at > now
            ]

    def __len__(self) -> int:
        """Return the number of non-expired entries in the cache."""
        with self._lock:
            now = time.time()
            return sum(1 for entry in self._cache.values() if entry.expires_at > now)


class AsyncFlagCache:
    """
    Async-safe in-memory cache for flag values with TTL.

    This asynchronous cache implementation uses asyncio.Lock for
    async safety, making it safe to use in async applications.
    """

    def __init__(self, ttl: int = 60) -> None:
        """
        Initialize the cache.

        Args:
            ttl: Time-to-live in seconds (default: 60)
        """
        self._cache: dict[str, CacheEntry] = {}
        self._ttl = ttl
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> bool | None:
        """
        Get a cached flag value.

        Args:
            key: The flag key to retrieve.

        Returns:
            The cached boolean value, or None if not found or expired.
        """
        entry = await self.get_entry(key)
        return entry.value if entry else None

    async def get_entry(self, key: str) -> CacheEntry | None:
        """
        Get a complete cached entry (includes configuration and variation).

        Args:
            key: The flag key to retrieve.

        Returns:
            The complete CacheEntry, or None if not found or expired.
        """
        async with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None

            # Check if expired
            if time.time() > entry.expires_at:
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
    ) -> None:
        """
        Set a flag value in cache.

        Args:
            key: The flag key.
            value: The boolean flag value.
            flag_id: Optional flag ID for reference.
            configuration: Optional configuration data.
            variation: Optional variation identifier.
        """
        async with self._lock:
            self._cache[key] = CacheEntry(
                value=value,
                configuration=configuration,
                variation=variation,
                expires_at=time.time() + self._ttl,
                flag_id=flag_id,
            )

    async def invalidate(self, key: str | None = None) -> None:
        """
        Invalidate a specific flag or all flags.

        Args:
            key: The flag key to invalidate. If None, invalidates all flags.
        """
        async with self._lock:
            if key:
                self._cache.pop(key, None)
            else:
                self._cache.clear()

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
                for key, entry in self._cache.items()
                if entry.expires_at > now
            ]

    async def __aenter__(self) -> "AsyncFlagCache":
        """Async context manager entry."""
        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit."""
        await self.clear()

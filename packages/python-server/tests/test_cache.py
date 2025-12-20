"""Tests for FlagCache and AsyncFlagCache."""

import time
import pytest

from savvagent import FlagCache, AsyncFlagCache


class TestFlagCache:
    """Tests for the synchronous FlagCache."""

    def test_set_and_get(self) -> None:
        """Test basic set and get operations."""
        cache = FlagCache(ttl=60)
        cache.set("test-flag", True)

        assert cache.get("test-flag") is True

    def test_get_nonexistent_key(self) -> None:
        """Test getting a key that doesn't exist."""
        cache = FlagCache(ttl=60)

        assert cache.get("nonexistent") is None

    def test_get_entry(self) -> None:
        """Test getting a complete cache entry."""
        cache = FlagCache(ttl=60)
        cache.set(
            "test-flag",
            True,
            flag_id="flag_123",
            configuration={"setting": "value"},
            variation="variant_a",
        )

        entry = cache.get_entry("test-flag")
        assert entry is not None
        assert entry.value is True
        assert entry.flag_id == "flag_123"
        assert entry.configuration == {"setting": "value"}
        assert entry.variation == "variant_a"

    def test_ttl_expiration(self) -> None:
        """Test that entries expire after TTL."""
        cache = FlagCache(ttl=1)  # 1 second TTL
        cache.set("test-flag", True)

        assert cache.get("test-flag") is True

        # Wait for expiration
        time.sleep(1.1)

        assert cache.get("test-flag") is None

    def test_invalidate_specific_key(self) -> None:
        """Test invalidating a specific cache entry."""
        cache = FlagCache(ttl=60)
        cache.set("flag-1", True)
        cache.set("flag-2", False)

        cache.invalidate("flag-1")

        assert cache.get("flag-1") is None
        assert cache.get("flag-2") is False

    def test_invalidate_all(self) -> None:
        """Test invalidating all cache entries."""
        cache = FlagCache(ttl=60)
        cache.set("flag-1", True)
        cache.set("flag-2", False)

        cache.invalidate()

        assert cache.get("flag-1") is None
        assert cache.get("flag-2") is None

    def test_clear(self) -> None:
        """Test clearing the cache."""
        cache = FlagCache(ttl=60)
        cache.set("flag-1", True)
        cache.set("flag-2", False)

        cache.clear()

        assert len(cache) == 0

    def test_keys(self) -> None:
        """Test getting all cached keys."""
        cache = FlagCache(ttl=60)
        cache.set("flag-1", True)
        cache.set("flag-2", False)

        keys = cache.keys()
        assert set(keys) == {"flag-1", "flag-2"}

    def test_len(self) -> None:
        """Test cache length."""
        cache = FlagCache(ttl=60)
        assert len(cache) == 0

        cache.set("flag-1", True)
        assert len(cache) == 1

        cache.set("flag-2", False)
        assert len(cache) == 2

    def test_special_characters_in_key(self) -> None:
        """Test keys with special characters."""
        cache = FlagCache(ttl=60)
        special_key = "flag:with/special.chars-and_underscores"
        cache.set(special_key, True)

        assert cache.get(special_key) is True


class TestAsyncFlagCache:
    """Tests for the asynchronous AsyncFlagCache."""

    @pytest.mark.asyncio
    async def test_set_and_get(self) -> None:
        """Test basic set and get operations."""
        cache = AsyncFlagCache(ttl=60)
        await cache.set("test-flag", True)

        assert await cache.get("test-flag") is True

    @pytest.mark.asyncio
    async def test_get_nonexistent_key(self) -> None:
        """Test getting a key that doesn't exist."""
        cache = AsyncFlagCache(ttl=60)

        assert await cache.get("nonexistent") is None

    @pytest.mark.asyncio
    async def test_get_entry(self) -> None:
        """Test getting a complete cache entry."""
        cache = AsyncFlagCache(ttl=60)
        await cache.set(
            "test-flag",
            True,
            flag_id="flag_123",
            configuration={"setting": "value"},
            variation="variant_a",
        )

        entry = await cache.get_entry("test-flag")
        assert entry is not None
        assert entry.value is True
        assert entry.flag_id == "flag_123"
        assert entry.configuration == {"setting": "value"}
        assert entry.variation == "variant_a"

    @pytest.mark.asyncio
    async def test_ttl_expiration(self) -> None:
        """Test that entries expire after TTL."""
        import asyncio

        cache = AsyncFlagCache(ttl=1)  # 1 second TTL
        await cache.set("test-flag", True)

        assert await cache.get("test-flag") is True

        # Wait for expiration
        await asyncio.sleep(1.1)

        assert await cache.get("test-flag") is None

    @pytest.mark.asyncio
    async def test_invalidate_specific_key(self) -> None:
        """Test invalidating a specific cache entry."""
        cache = AsyncFlagCache(ttl=60)
        await cache.set("flag-1", True)
        await cache.set("flag-2", False)

        await cache.invalidate("flag-1")

        assert await cache.get("flag-1") is None
        assert await cache.get("flag-2") is False

    @pytest.mark.asyncio
    async def test_invalidate_all(self) -> None:
        """Test invalidating all cache entries."""
        cache = AsyncFlagCache(ttl=60)
        await cache.set("flag-1", True)
        await cache.set("flag-2", False)

        await cache.invalidate()

        assert await cache.get("flag-1") is None
        assert await cache.get("flag-2") is None

    @pytest.mark.asyncio
    async def test_context_manager(self) -> None:
        """Test async context manager."""
        async with AsyncFlagCache(ttl=60) as cache:
            await cache.set("test-flag", True)
            assert await cache.get("test-flag") is True

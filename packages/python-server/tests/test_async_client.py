"""Tests for the asynchronous AsyncFlagClient."""

import pytest
import httpx
import respx

from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext
from savvagent.exceptions import InvalidAPIKeyError


@pytest.fixture
def async_config() -> FlagClientConfig:
    """Create a test client configuration for async tests."""
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        application_id="test-app",
        base_url="https://flags-api.savvagent.com",
        enable_realtime=False,
        enable_telemetry=False,
        cache_ttl=60,
        timeout=5.0,
    )


class TestAsyncFlagClientConstruction:
    """Tests for AsyncFlagClient initialization."""

    def test_valid_sdk_key(self, async_config: FlagClientConfig) -> None:
        """Test construction with valid SDK key."""
        client = AsyncFlagClient(async_config)
        assert client is not None

    def test_invalid_key_raises(self) -> None:
        """Test that invalid key prefix raises error."""
        config = FlagClientConfig(
            api_key="invalid_key",
            enable_realtime=False,
        )
        with pytest.raises(InvalidAPIKeyError):
            AsyncFlagClient(config)

    @pytest.mark.asyncio
    async def test_context_manager(self, async_config: FlagClientConfig) -> None:
        """Test async context manager pattern."""
        async with AsyncFlagClient(async_config) as client:
            assert client is not None


class TestAsyncFlagEvaluation:
    """Tests for async flag evaluation."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_enabled_flag(self, async_config: FlagClientConfig) -> None:
        """Test evaluating an enabled flag."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"value": True, "flagId": "flag_123"},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("test-flag")

            assert result.value is True
            assert result.key == "test-flag"
            assert result.reason == "evaluated"

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_disabled_flag(self, async_config: FlagClientConfig) -> None:
        """Test evaluating a disabled flag."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"value": False, "flagId": "flag_123"},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("test-flag")

            assert result.value is False
            assert result.reason == "evaluated"

    @pytest.mark.asyncio
    @respx.mock
    async def test_is_enabled_convenience(self, async_config: FlagClientConfig) -> None:
        """Test is_enabled convenience method."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"value": True})
        )

        async with AsyncFlagClient(async_config) as client:
            assert await client.is_enabled("test-flag") is True

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_with_context(self, async_config: FlagClientConfig) -> None:
        """Test evaluation with context."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"value": True})
        )

        async with AsyncFlagClient(async_config) as client:
            context = FlagContext(user_id="user-123", environment="production")
            result = await client.evaluate("test-flag", context)

            assert result.value is True

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_caching(self, async_config: FlagClientConfig) -> None:
        """Test that evaluations are cached."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"value": True})
        )

        async with AsyncFlagClient(async_config) as client:
            # First call hits API
            result1 = await client.evaluate("test-flag")
            assert result1.reason == "evaluated"

            # Second call uses cache
            result2 = await client.evaluate("test-flag")
            assert result2.reason == "cached"
            assert result2.value is True

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_api_error_returns_default(
        self, async_config: FlagClientConfig
    ) -> None:
        """Test that API errors return default value."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(500, json={"error": "Internal error"})
        )

        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("test-flag")

            assert result.reason == "error"
            assert result.value is False


class TestAsyncDynamicConfiguration:
    """Tests for async dynamic configuration (Phase 1)."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_config_enabled(self, async_config: FlagClientConfig) -> None:
        """Test getting configuration for enabled flag."""
        respx.post("https://flags-api.savvagent.com/api/flags/config-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "value": True,
                    "configuration": {"theme": "dark", "limit": 100},
                },
            )
        )

        async with AsyncFlagClient(async_config) as client:
            config = await client.get_config("config-flag")

            assert config == {"theme": "dark", "limit": 100}

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_config_disabled_returns_default(
        self, async_config: FlagClientConfig
    ) -> None:
        """Test that disabled flag returns default configuration."""
        respx.post("https://flags-api.savvagent.com/api/flags/config-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"value": False, "configuration": {"theme": "dark"}},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            config = await client.get_config("config-flag", default={"theme": "light"})

            assert config == {"theme": "light"}


class TestAsyncVariations:
    """Tests for async multi-variant flags (Phase 2)."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_variation(self, async_config: FlagClientConfig) -> None:
        """Test getting variation details."""
        respx.post("https://flags-api.savvagent.com/api/flags/experiment/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "value": True,
                    "variation": "variant_a",
                    "configuration": {"color": "blue"},
                },
            )
        )

        async with AsyncFlagClient(async_config) as client:
            result = await client.get_variation("experiment")

            assert result.variation == "variant_a"
            assert result.enabled is True
            assert result.configuration == {"color": "blue"}


class TestAsyncOverrides:
    """Tests for async configuration and variation overrides."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_config_override(self, async_config: FlagClientConfig) -> None:
        """Test setting a configuration override."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"value": True, "configuration": {"original": True}},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            # Set override before evaluation
            client.set_config_override("test-flag", {"overridden": True})

            result = await client.evaluate("test-flag")
            assert result.configuration == {"overridden": True}

    @pytest.mark.asyncio
    @respx.mock
    async def test_variation_override(self, async_config: FlagClientConfig) -> None:
        """Test setting a variation override."""
        respx.post("https://flags-api.savvagent.com/api/flags/experiment/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"value": True, "variation": "control"},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            # Set override
            client.set_variation_override("experiment", "forced_variant")

            result = await client.get_variation("experiment")
            assert result.variation == "forced_variant"


class TestAsyncBulkOperations:
    """Tests for async bulk flag operations."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_get_all_flags(self, async_config: FlagClientConfig) -> None:
        """Test getting all flags."""
        respx.get("https://flags-api.savvagent.com/api/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={
                    "flags": [
                        {"key": "flag-1", "enabled": True, "scope": "application"},
                        {"key": "flag-2", "enabled": False, "scope": "enterprise"},
                    ],
                    "count": 2,
                    "organization_id": "org_123",
                },
            )
        )

        async with AsyncFlagClient(async_config) as client:
            flags = await client.get_all_flags()

            assert len(flags) == 2
            assert flags[0].key == "flag-1"
            assert flags[0].enabled is True


class TestAsyncCacheManagement:
    """Tests for async cache management."""

    @pytest.mark.asyncio
    @respx.mock
    async def test_invalidate_cache(self, async_config: FlagClientConfig) -> None:
        """Test cache invalidation."""
        respx.post("https://flags-api.savvagent.com/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"value": True})
        )

        async with AsyncFlagClient(async_config) as client:
            # First call caches
            await client.evaluate("test-flag")

            # Second call uses cache
            result = await client.evaluate("test-flag")
            assert result.reason == "cached"

            # Invalidate
            await client.invalidate_cache("test-flag")

            # Third call hits API again
            result = await client.evaluate("test-flag")
            assert result.reason == "evaluated"

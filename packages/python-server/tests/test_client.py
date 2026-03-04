"""Tests for the synchronous FlagClient."""

import pytest
import httpx
import respx

from savvagent import FlagClient, FlagClientConfig, FlagContext
from savvagent.exceptions import InvalidAPIKeyError
from tests.conftest import mock_flag_response, mock_flags_list_response


class TestFlagClientConstruction:
    """Tests for FlagClient initialization."""

    def test_valid_sdk_key(self) -> None:
        """Test construction with valid SDK key."""
        config = FlagClientConfig(
            api_key="sdk_valid_key",
            enable_realtime=False,
            enable_telemetry=False,
        )
        client = FlagClient(config)
        client.close()

    def test_valid_server_key(self) -> None:
        """Test construction with valid server key."""
        config = FlagClientConfig(
            api_key="srv_valid_key",
            enable_realtime=False,
            enable_telemetry=False,
        )
        client = FlagClient(config)
        client.close()

    def test_invalid_key_prefix(self) -> None:
        """Test that invalid key prefix raises error."""
        config = FlagClientConfig(
            api_key="invalid_key",
            enable_realtime=False,
        )
        with pytest.raises(InvalidAPIKeyError):
            FlagClient(config)

    def test_empty_key(self) -> None:
        """Test that empty key raises error."""
        config = FlagClientConfig(
            api_key="",
            enable_realtime=False,
        )
        with pytest.raises(InvalidAPIKeyError):
            FlagClient(config)

    def test_context_manager(self, client_config: FlagClientConfig) -> None:
        """Test context manager pattern."""
        with FlagClient(client_config) as client:
            assert client is not None


class TestFlagEvaluation:
    """Tests for flag evaluation."""

    @respx.mock
    def test_evaluate_enabled_flag(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test evaluating an enabled flag."""
        mock_flag_response(mock_api, "test-flag", value=True)

        result = client.evaluate("test-flag")

        assert result.value is True
        assert result.key == "test-flag"
        assert result.reason == "evaluated"

    @respx.mock
    def test_evaluate_disabled_flag(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test evaluating a disabled flag."""
        mock_flag_response(mock_api, "test-flag", value=False)

        result = client.evaluate("test-flag")

        assert result.value is False
        assert result.reason == "evaluated"

    @respx.mock
    def test_is_enabled_convenience(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test is_enabled convenience method."""
        mock_flag_response(mock_api, "test-flag", value=True)

        assert client.is_enabled("test-flag") is True

    @respx.mock
    def test_evaluate_with_context(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test evaluation with context."""
        mock_flag_response(mock_api, "test-flag", value=True)

        context = FlagContext(user_id="user-123", environment="production")
        result = client.evaluate("test-flag", context)

        assert result.value is True

    @respx.mock
    def test_evaluate_caching(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test that evaluations are cached."""
        mock_flag_response(mock_api, "test-flag", value=True)

        # First call hits API
        result1 = client.evaluate("test-flag")
        assert result1.reason == "evaluated"

        # Second call uses cache
        result2 = client.evaluate("test-flag")
        assert result2.reason == "cached"
        assert result2.value is True

    @respx.mock
    def test_evaluate_api_error_returns_default(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        """Test that API errors return default value."""
        mock_api.post(
            "https://flags-api.savvagent.com/api/flags/test-flag/evaluate"
        ).mock(return_value=httpx.Response(500, json={"error": "Internal error"}))

        result = client.evaluate("test-flag")

        assert result.reason == "error"
        assert result.value is False  # Default value

    def test_evaluate_uses_configured_default(self, client_config: FlagClientConfig) -> None:
        """Test that configured defaults are used on error."""
        config = FlagClientConfig(
            api_key="sdk_test",
            defaults={"my-flag": True},
            enable_realtime=False,
            enable_telemetry=False,
        )

        with respx.mock:
            respx.post(
                "https://flags-api.savvagent.com/api/flags/my-flag/evaluate"
            ).mock(return_value=httpx.Response(500))

            with FlagClient(config) as client:
                result = client.evaluate("my-flag")
                assert result.value is True  # Configured default


class TestDynamicConfiguration:
    """Tests for dynamic configuration (Phase 1)."""

    @respx.mock
    def test_get_config_enabled(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test getting configuration for enabled flag."""
        mock_flag_response(
            mock_api,
            "config-flag",
            value=True,
            configuration={"theme": "dark", "limit": 100},
        )

        config = client.get_config("config-flag")

        assert config == {"theme": "dark", "limit": 100}

    @respx.mock
    def test_get_config_disabled_returns_default(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        """Test that disabled flag returns default configuration."""
        mock_flag_response(mock_api, "config-flag", value=False, configuration={"theme": "dark"})

        config = client.get_config("config-flag", default={"theme": "light"})

        assert config == {"theme": "light"}

    @respx.mock
    def test_get_config_no_config_returns_default(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        """Test that flag without configuration returns default."""
        mock_flag_response(mock_api, "config-flag", value=True, configuration=None)

        config = client.get_config("config-flag", default={"fallback": True})

        assert config == {"fallback": True}


class TestVariations:
    """Tests for multi-variant flags (Phase 2)."""

    @respx.mock
    def test_get_variation(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test getting variation details."""
        mock_flag_response(
            mock_api,
            "experiment",
            value=True,
            variation="variant_a",
            configuration={"color": "blue"},
        )

        result = client.get_variation("experiment")

        assert result.variation == "variant_a"
        assert result.enabled is True
        assert result.configuration == {"color": "blue"}

    @respx.mock
    def test_get_variation_default_control(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        """Test that missing variation defaults to 'control'."""
        mock_flag_response(mock_api, "experiment", value=True, variation=None)

        result = client.get_variation("experiment")

        assert result.variation == "control"


class TestOverrides:
    """Tests for configuration and variation overrides."""

    @respx.mock
    def test_config_override(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test setting a configuration override."""
        mock_flag_response(
            mock_api,
            "test-flag",
            value=True,
            configuration={"original": True},
        )

        # Set override
        client.set_config_override("test-flag", {"overridden": True})

        result = client.evaluate("test-flag")
        assert result.configuration == {"overridden": True}

    @respx.mock
    def test_config_override_merge(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test merging configuration override."""
        from savvagent import ConfigOverrideOptions

        mock_flag_response(
            mock_api,
            "test-flag",
            value=True,
            configuration={"original": True, "keep": "this"},
        )

        # First call to cache the result
        client.evaluate("test-flag")

        # Set merge override
        client.set_config_override(
            "test-flag",
            {"original": False, "new": "value"},
            ConfigOverrideOptions(merge=True),
        )

        result = client.evaluate("test-flag")
        assert result.configuration == {"original": False, "keep": "this", "new": "value"}

    @respx.mock
    def test_variation_override(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test setting a variation override."""
        mock_flag_response(mock_api, "experiment", value=True, variation="control")

        # Set override
        client.set_variation_override("experiment", "forced_variant")

        result = client.get_variation("experiment")
        assert result.variation == "forced_variant"

    def test_has_override_methods(self, client: FlagClient) -> None:
        """Test override inspection methods."""
        assert client.has_config_override("test-flag") is False
        assert client.has_variation_override("test-flag") is False

        client.set_config_override("test-flag", {"value": 1})
        client.set_variation_override("test-flag", "variant_a")

        assert client.has_config_override("test-flag") is True
        assert client.has_variation_override("test-flag") is True

    def test_clear_overrides(self, client: FlagClient) -> None:
        """Test clearing overrides."""
        client.set_config_override("test-flag", {"value": 1})
        client.set_variation_override("test-flag", "variant_a")

        client.clear_config_override("test-flag")
        client.clear_variation_override("test-flag")

        assert client.has_config_override("test-flag") is False
        assert client.has_variation_override("test-flag") is False

    def test_clear_all_overrides(self, client: FlagClient) -> None:
        """Test clearing all overrides at once."""
        client.set_config_override("flag-1", {"value": 1})
        client.set_config_override("flag-2", {"value": 2})
        client.set_variation_override("flag-1", "variant_a")

        client.clear_all_overrides()

        assert client.get_config_overrides() == {}
        assert client.get_variation_overrides() == {}


class TestBulkOperations:
    """Tests for bulk flag operations."""

    @respx.mock
    def test_get_all_flags(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test getting all flags."""
        mock_flags_list_response(
            mock_api,
            [
                {"key": "flag-1", "enabled": True, "scope": "application"},
                {"key": "flag-2", "enabled": False, "scope": "enterprise"},
            ],
        )

        flags = client.get_all_flags()

        assert len(flags) == 2
        assert flags[0].key == "flag-1"
        assert flags[0].enabled is True
        assert flags[1].key == "flag-2"
        assert flags[1].scope == "enterprise"


class TestCacheManagement:
    """Tests for cache management."""

    @respx.mock
    def test_invalidate_cache(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test cache invalidation."""
        mock_flag_response(mock_api, "test-flag", value=True)

        # First call caches
        client.evaluate("test-flag")

        # Second call uses cache
        result = client.evaluate("test-flag")
        assert result.reason == "cached"

        # Invalidate
        client.invalidate_cache("test-flag")

        # Third call hits API again
        result = client.evaluate("test-flag")
        assert result.reason == "evaluated"

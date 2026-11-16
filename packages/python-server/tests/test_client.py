"""Tests for the synchronous FlagClient."""

import json
from typing import Any

import httpx
import pytest
import respx

from savvagent_flags import FlagClient, FlagClientConfig, FlagContext
from savvagent_flags.exceptions import InvalidAPIKeyError, InvalidFlagKeyError
from tests.conftest import mock_flag_response, mock_flags_list_response, server_body


class TestBaseUrl:
    """Tests for the default base URL and trailing-slash handling."""

    def test_default_base_url(self) -> None:
        config = FlagClientConfig(api_key="sdk_valid_key")
        assert config.base_url == "https://api.savvagent.com/flags"

    def test_trailing_slashes_are_removed(self) -> None:
        config = FlagClientConfig(
            api_key="sdk_valid_key", base_url="https://flags.example.com/flags//"
        )
        assert config.base_url == "https://flags.example.com/flags"

    @respx.mock
    def test_evaluate_uses_default_base_url(self) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/test-flag/evaluate"
        ).mock(
            return_value=httpx.Response(
                200,
                json={
                    "key": "test-flag",
                    "enabled": True,
                    "scope": "application",
                    "variation": None,
                    "configuration": None,
                    "timestamp": 1700000000,
                    "version": 1,
                    "context": {},
                },
            )
        )
        config = FlagClientConfig(
            api_key="sdk_valid_key", enable_realtime=False, enable_telemetry=False
        )
        client = FlagClient(config)
        try:
            assert client.evaluate("test-flag").value is True
        finally:
            client.close()
        assert route.called


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
            "https://api.savvagent.com/flags/api/flags/test-flag/evaluate"
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
                "https://api.savvagent.com/flags/api/flags/my-flag/evaluate"
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

    def test_config_override_invalid_chains_cause(self, client: FlagClient) -> None:
        """Test an unserializable override raises ValueError chained to the TypeError."""
        with pytest.raises(ValueError, match="Invalid configuration for flag 'flag'") as exc_info:
            client.set_config_override("flag", {"bad": object()})
        assert isinstance(exc_info.value.__cause__, TypeError)

    @respx.mock
    def test_config_override_merge(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        """Test merging configuration override."""
        from savvagent_flags import ConfigOverrideOptions

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


INVALID_FLAG_KEYS = [
    "a/b",
    "a?b",
    "a#b",
    ".",
    "..",
    "",
    "bad key",
    "flag\n",
    "a" * 129,
]


class TestInvalidFlagKey:
    """Flag keys that cannot be carried in a URL path are never sent (#107)."""

    @pytest.mark.parametrize("key", INVALID_FLAG_KEYS)
    @respx.mock
    def test_invalid_key_returns_default_without_request(self, key: str) -> None:
        errors: list[Exception] = []
        route = respx.route()
        config = FlagClientConfig(
            api_key="sdk_test_key_12345",
            base_url="https://api.savvagent.com/flags",
            enable_realtime=False,
            enable_telemetry=False,
            defaults={key: True},
            on_error=errors.append,
        )
        with FlagClient(config) as client:
            result = client.evaluate(key)

        assert result.value is True
        assert result.reason == "error"
        assert result.key == key
        assert route.called is False
        assert respx.calls.call_count == 0
        assert len(errors) == 1
        assert isinstance(errors[0], InvalidFlagKeyError)

    @pytest.mark.parametrize("key", [None, 42, ["a"]])
    @respx.mock
    def test_non_string_key_returns_false_without_raising(self, key: object) -> None:
        errors: list[Exception] = []
        route = respx.route()
        config = FlagClientConfig(
            api_key="sdk_test_key_12345",
            enable_realtime=False,
            enable_telemetry=False,
            on_error=errors.append,
        )
        with FlagClient(config) as client:
            result = client.evaluate(key)  # type: ignore[arg-type]  # untyped callers

        assert result.value is False
        assert result.reason == "error"
        assert route.called is False
        assert len(errors) == 1
        assert "non-string value of type" in str(errors[0])

    @respx.mock
    def test_valid_key_hits_expected_path(self, client_config: FlagClientConfig) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/new-checkout.v2_b/evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        with FlagClient(client_config) as client:
            result = client.evaluate("new-checkout.v2_b")
        assert route.called
        assert result.reason == "evaluated"

    @respx.mock
    def test_128_character_key_is_valid(self, client_config: FlagClientConfig) -> None:
        key = "a" * 128
        route = respx.post(
            f"https://api.savvagent.com/flags/api/flags/{key}/evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        with FlagClient(client_config) as client:
            result = client.evaluate(key)
        assert route.called
        assert result.reason == "evaluated"

    @respx.mock
    def test_triple_dot_key_is_valid(self, client_config: FlagClientConfig) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/.../evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        with FlagClient(client_config) as client:
            result = client.evaluate("...")
        assert route.called
        assert result.reason == "evaluated"



class TestEvaluateContract:
    """The evaluate call follows docs/SDK-DEVELOPER-GUIDE.md (#112)."""

    @pytest.mark.parametrize("enabled", [True, False])
    @respx.mock
    def test_reads_enabled_from_the_documented_path(
        self, client_config: FlagClientConfig, enabled: bool
    ) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
        ).mock(return_value=httpx.Response(200, json=server_body("checkout", enabled)))
        client_config.defaults = {"checkout": not enabled}
        with FlagClient(client_config) as client:
            result = client.evaluate("checkout")
        assert route.call_count == 1
        assert result.value is enabled
        assert result.reason == "evaluated"
        assert result.variation is None
        assert result.configuration is None

    @pytest.mark.parametrize(
        "body",
        [{"value": True}, {"enabled": "true"}, {"enabled": 1}, {"enabled": None}, [True]],
    )
    @respx.mock
    def test_body_without_boolean_enabled_is_a_failed_lookup(
        self, client_config: FlagClientConfig, body: object
    ) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
        ).mock(return_value=httpx.Response(200, json=body))
        errors: list[Exception] = []
        client_config.defaults = {"checkout": False}
        client_config.on_error = errors.append
        with FlagClient(client_config) as client:
            first = client.evaluate("checkout")
            second = client.evaluate("checkout")
        assert first.value is False
        assert first.reason == "error"
        assert second.reason == "error"
        assert len(errors) == 2
        # Not cached: the second lookup asks the server again.
        assert route.call_count == 2


FLAG_URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"


def _answer_by_user(request: httpx.Request) -> httpx.Response:
    """Server stand-in: true for user a, false for anyone else."""
    context = json.loads(request.content)["context"]
    return httpx.Response(200, json=server_body("checkout", context.get("user_id") == "a"))


def _answer_by_plan(request: httpx.Request) -> httpx.Response:
    context = json.loads(request.content)["context"]
    pro = context.get("attributes", {}).get("plan") == "pro"
    return httpx.Response(200, json=server_body("checkout", pro))


class TestContextCache:
    """The cache is keyed by flag and evaluation context (#127)."""

    def test_ab(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        route = mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        results = [
            client.evaluate("checkout", FlagContext(user_id=u)) for u in ("a", "b", "a", "b")
        ]
        assert [r.value for r in results] == [True, False, True, False]
        assert [r.reason for r in results] == ["evaluated", "evaluated", "cached", "cached"]
        assert route.call_count == 2

    def test_attribute(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        route = mock_api.post(FLAG_URL).mock(side_effect=_answer_by_plan)
        pro = client.evaluate("checkout", FlagContext(user_id="u", attributes={"plan": "pro"}))
        free = client.evaluate("checkout", FlagContext(user_id="u", attributes={"plan": "free"}))
        assert (pro.value, pro.reason) == (True, "evaluated")
        assert (free.value, free.reason) == (False, "evaluated")
        assert route.call_count == 2

    def test_attribute_order(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        route = mock_api.post(FLAG_URL).mock(side_effect=_answer_by_plan)
        client.evaluate("checkout", FlagContext(attributes={"plan": "pro", "region": "eu"}))
        second = client.evaluate(
            "checkout", FlagContext(attributes={"region": "eu", "plan": "pro"})
        )
        assert second.reason == "cached"
        assert route.call_count == 1

    def test_invalidate(self, client: FlagClient, mock_api: respx.MockRouter) -> None:
        route = mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        for u in ("a", "b"):
            client.evaluate("checkout", FlagContext(user_id=u))
        client.invalidate_cache("checkout")
        for u in ("a", "b"):
            assert client.evaluate("checkout", FlagContext(user_id=u)).reason == "evaluated"
        assert route.call_count == 4

    def test_list_fetch_does_not_seed(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        mock_flags_list_response(
            mock_api,
            [{"key": "checkout", "enabled": True, "scope": "application", "environments": {}}],
        )
        mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        client.get_all_flags("production")
        # The list's `enabled` is the environment switch, not a context's result.
        assert client._cache.keys() == []
        result = client.evaluate("checkout", FlagContext(user_id="b"))
        assert result.value is False
        assert result.reason == "evaluated"

    def test_track_error_uses_the_callers_context(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        recorded: list[Any] = []
        client._telemetry.track_error = recorded.append  # type: ignore[method-assign]
        for u in ("a", "b"):
            client.evaluate("checkout", FlagContext(user_id=u))
        err = RuntimeError("boom")
        client.track_error("checkout", err, FlagContext(user_id="b"))
        client.track_error("checkout", err, FlagContext(user_id="a"))
        assert [e.flag_enabled for e in recorded] == [False, True]

    def test_track_error_without_its_context_reports_the_last_evaluation(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        recorded: list[Any] = []
        client._telemetry.track_error = recorded.append  # type: ignore[method-assign]
        client.evaluate("checkout", FlagContext(user_id="a"))
        err = RuntimeError("boom")
        # Reported with no context: the flag's most recent evaluation (on), not False.
        client.track_error("checkout", err)
        # A flag never evaluated is reported off.
        client.track_error("other", err)
        assert [e.flag_enabled for e in recorded] == [True, False]

    def test_unserializable_context_skips_the_cache(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        route = mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        context = FlagContext(user_id="a", attributes={"when": object()})
        result = client.evaluate("checkout", context)
        # The request cannot be sent either: the default, reason "error", nothing cached.
        assert result.reason == "error"
        assert client._cache.keys() == []
        assert route.call_count == 0

    def test_caller_context_is_not_modified(
        self, client: FlagClient, mock_api: respx.MockRouter
    ) -> None:
        mock_api.post(FLAG_URL).mock(side_effect=_answer_by_user)
        context = FlagContext(user_id="a")
        client.evaluate("checkout", context)
        assert context.application_id is None
        assert context.environment is None


class TestResultMetadata:
    """The result reports the server's `version` and `scope` (#124)."""

    @respx.mock
    def test_evaluated_and_cached_results_carry_version_and_scope(
        self, client_config: FlagClientConfig
    ) -> None:
        route = respx.post(FLAG_URL).mock(
            return_value=httpx.Response(200, json=server_body("checkout", True))
        )
        with FlagClient(client_config) as client:
            first = client.evaluate("checkout")
            second = client.evaluate("checkout")
        assert route.call_count == 1
        assert first.reason == "evaluated"
        assert first.metadata is not None
        assert first.metadata.version == 3
        assert first.metadata.scope == "application"
        assert first.metadata.flag_id is None
        assert first.metadata.description is None
        assert first.metadata.variant is None
        assert second.reason == "cached"
        assert second.metadata is not None
        assert second.metadata.version == 3
        assert second.metadata.scope == "application"

    @pytest.mark.parametrize(
        "overrides",
        [
            {"version": "3", "scope": 7},
            {"version": True},
            {"version": 1.5},
            {"version": None, "scope": None},
        ],
    )
    @respx.mock
    def test_malformed_metadata_never_fails_the_lookup(
        self, client_config: FlagClientConfig, overrides: dict[str, Any]
    ) -> None:
        body = {**server_body("checkout", True), **overrides}
        respx.post(FLAG_URL).mock(return_value=httpx.Response(200, json=body))
        errors: list[Exception] = []
        client_config.on_error = errors.append
        with FlagClient(client_config) as client:
            first = client.evaluate("checkout")
            second = client.evaluate("checkout")
        assert errors == []
        for result, reason in ((first, "evaluated"), (second, "cached")):
            assert result.value is True
            assert result.reason == reason
            assert result.metadata is not None
            if "version" in overrides:
                assert result.metadata.version is None
            if "scope" in overrides:
                assert result.metadata.scope is None

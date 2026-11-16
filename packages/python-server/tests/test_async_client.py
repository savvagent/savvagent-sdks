"""Tests for the asynchronous AsyncFlagClient."""

import json

import httpx
import pytest
import respx

from savvagent_flags import AsyncFlagClient, FlagClientConfig, FlagContext
from savvagent_flags.exceptions import InvalidAPIKeyError, InvalidFlagKeyError
from tests.conftest import server_body


@pytest.fixture
def async_config() -> FlagClientConfig:
    """Create a test client configuration for async tests."""
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        application_id="test-app",
        base_url="https://api.savvagent.com/flags",
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"enabled": True, "flagId": "flag_123"},
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"enabled": False, "flagId": "flag_123"},
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"enabled": True})
        )

        async with AsyncFlagClient(async_config) as client:
            assert await client.is_enabled("test-flag") is True

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_with_context(self, async_config: FlagClientConfig) -> None:
        """Test evaluation with context."""
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"enabled": True})
        )

        async with AsyncFlagClient(async_config) as client:
            context = FlagContext(user_id="user-123", environment="production")
            result = await client.evaluate("test-flag", context)

            assert result.value is True

    @pytest.mark.asyncio
    @respx.mock
    async def test_evaluate_caching(self, async_config: FlagClientConfig) -> None:
        """Test that evaluations are cached."""
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"enabled": True})
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
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
        respx.post("https://api.savvagent.com/flags/api/flags/config-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "enabled": True,
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
        respx.post("https://api.savvagent.com/flags/api/flags/config-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"enabled": False, "configuration": {"theme": "dark"}},
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
        respx.post("https://api.savvagent.com/flags/api/flags/experiment/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={
                    "enabled": True,
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"enabled": True, "configuration": {"original": True}},
            )
        )

        async with AsyncFlagClient(async_config) as client:
            # Set override before evaluation
            client.set_config_override("test-flag", {"overridden": True})

            result = await client.evaluate("test-flag")
            assert result.configuration == {"overridden": True}

    @pytest.mark.asyncio
    async def test_config_override_invalid_chains_cause(
        self, async_config: FlagClientConfig
    ) -> None:
        """Test an unserializable override raises ValueError chained to the TypeError."""
        async with AsyncFlagClient(async_config) as client:
            with pytest.raises(ValueError, match="Invalid configuration for flag 'flag'") as exc_info:
                client.set_config_override("flag", {"bad": object()})
            assert isinstance(exc_info.value.__cause__, TypeError)

    @pytest.mark.asyncio
    @respx.mock
    async def test_variation_override(self, async_config: FlagClientConfig) -> None:
        """Test setting a variation override."""
        respx.post("https://api.savvagent.com/flags/api/flags/experiment/evaluate").mock(
            return_value=httpx.Response(
                200,
                json={"enabled": True, "variation": "control"},
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
        respx.get("https://api.savvagent.com/flags/api/sdk/flags").mock(
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
        respx.post("https://api.savvagent.com/flags/api/flags/test-flag/evaluate").mock(
            return_value=httpx.Response(200, json={"enabled": True})
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


class TestAsyncInvalidFlagKey:
    """Flag keys that cannot be carried in a URL path are never sent (#107)."""

    @pytest.mark.parametrize("key", INVALID_FLAG_KEYS)
    @pytest.mark.asyncio
    @respx.mock
    async def test_invalid_key_returns_default_without_request(self, key: str) -> None:
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
        async with AsyncFlagClient(config) as client:
            result = await client.evaluate(key)

        assert result.value is True
        assert result.reason == "error"
        assert result.key == key
        assert route.called is False
        assert respx.calls.call_count == 0
        assert len(errors) == 1
        assert isinstance(errors[0], InvalidFlagKeyError)

    @pytest.mark.parametrize("key", [None, 42, ["a"]])
    @pytest.mark.asyncio
    @respx.mock
    async def test_non_string_key_returns_false_without_raising(self, key: object) -> None:
        errors: list[Exception] = []
        route = respx.route()
        config = FlagClientConfig(
            api_key="sdk_test_key_12345",
            enable_realtime=False,
            enable_telemetry=False,
            on_error=errors.append,
        )
        async with AsyncFlagClient(config) as client:
            result = await client.evaluate(key)  # type: ignore[arg-type]  # untyped callers

        assert result.value is False
        assert result.reason == "error"
        assert route.called is False
        assert len(errors) == 1
        assert "non-string value of type" in str(errors[0])

    @pytest.mark.asyncio
    @respx.mock
    async def test_valid_key_hits_expected_path(self, async_config: FlagClientConfig) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/new-checkout.v2_b/evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("new-checkout.v2_b")
        assert route.called
        assert result.reason == "evaluated"

    @pytest.mark.asyncio
    @respx.mock
    async def test_128_character_key_is_valid(self, async_config: FlagClientConfig) -> None:
        key = "a" * 128
        route = respx.post(
            f"https://api.savvagent.com/flags/api/flags/{key}/evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate(key)
        assert route.called
        assert result.reason == "evaluated"

    @pytest.mark.asyncio
    @respx.mock
    async def test_triple_dot_key_is_valid(self, async_config: FlagClientConfig) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/.../evaluate"
        ).mock(return_value=httpx.Response(200, json={"enabled": True}))
        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("...")
        assert route.called
        assert result.reason == "evaluated"



class TestAsyncEvaluateContract:
    """The evaluate call follows docs/SDK-DEVELOPER-GUIDE.md (#112)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("enabled", [True, False])
    @respx.mock
    async def test_reads_enabled_from_the_documented_path(
        self, async_config: FlagClientConfig, enabled: bool
    ) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
        ).mock(return_value=httpx.Response(200, json=server_body("checkout", enabled)))
        async_config.defaults = {"checkout": not enabled}
        async with AsyncFlagClient(async_config) as client:
            result = await client.evaluate("checkout")
        assert route.call_count == 1
        assert result.value is enabled
        assert result.reason == "evaluated"
        assert result.variation is None
        assert result.configuration is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [{"value": True}, {"enabled": "true"}, {"enabled": 1}, {"enabled": None}, [True]],
    )
    @respx.mock
    async def test_body_without_boolean_enabled_is_a_failed_lookup(
        self, async_config: FlagClientConfig, body: object
    ) -> None:
        route = respx.post(
            "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
        ).mock(return_value=httpx.Response(200, json=body))
        errors: list[Exception] = []
        async_config.defaults = {"checkout": False}
        async_config.on_error = errors.append
        async with AsyncFlagClient(async_config) as client:
            first = await client.evaluate("checkout")
            second = await client.evaluate("checkout")
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


class TestAsyncContextCache:
    """The cache is keyed by flag and evaluation context (#127)."""

    async def test_ab(self, async_config: FlagClientConfig) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.post(FLAG_URL).mock(side_effect=_answer_by_user)
            async with AsyncFlagClient(async_config) as client:
                results = [
                    await client.evaluate("checkout", FlagContext(user_id=u))
                    for u in ("a", "b", "a", "b")
                ]
        assert [r.value for r in results] == [True, False, True, False]
        assert [r.reason for r in results] == ["evaluated", "evaluated", "cached", "cached"]
        assert route.call_count == 2

    async def test_invalidate(self, async_config: FlagClientConfig) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.post(FLAG_URL).mock(side_effect=_answer_by_user)
            async with AsyncFlagClient(async_config) as client:
                for u in ("a", "b"):
                    await client.evaluate("checkout", FlagContext(user_id=u))
                await client.invalidate_cache("checkout")
                for u in ("a", "b"):
                    result = await client.evaluate("checkout", FlagContext(user_id=u))
                    assert result.reason == "evaluated"
        assert route.call_count == 4

    async def test_list_fetch_does_not_seed(self, async_config: FlagClientConfig) -> None:
        with respx.mock(assert_all_called=False) as mock:
            mock.get("https://api.savvagent.com/flags/api/sdk/flags").mock(
                return_value=httpx.Response(
                    200,
                    json={
                        "flags": [
                            {
                                "key": "checkout",
                                "enabled": True,
                                "scope": "application",
                                "environments": {},
                            }
                        ]
                    },
                )
            )
            mock.post(FLAG_URL).mock(side_effect=_answer_by_user)
            async with AsyncFlagClient(async_config) as client:
                await client.get_all_flags("production")
                # The list's `enabled` is the environment switch, not a context's result.
                assert await client._cache.keys() == []
                result = await client.evaluate("checkout", FlagContext(user_id="b"))
        assert result.value is False
        assert result.reason == "evaluated"


FLAG_URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"


class TestResultMetadata:
    """The result reports the server's `version` and `scope` (#124)."""

    @respx.mock
    async def test_evaluated_and_cached_results_carry_version_and_scope(
        self, async_config: FlagClientConfig
    ) -> None:
        route = respx.post(FLAG_URL).mock(
            return_value=httpx.Response(200, json=server_body("checkout", True))
        )
        async with AsyncFlagClient(async_config) as client:
            first = await client.evaluate("checkout")
            second = await client.evaluate("checkout")
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
    async def test_malformed_metadata_never_fails_the_lookup(
        self, async_config: FlagClientConfig, overrides: dict
    ) -> None:
        body = {**server_body("checkout", True), **overrides}
        respx.post(FLAG_URL).mock(return_value=httpx.Response(200, json=body))
        errors: list[Exception] = []
        async_config.on_error = errors.append
        async with AsyncFlagClient(async_config) as client:
            first = await client.evaluate("checkout")
            second = await client.evaluate("checkout")
        assert errors == []
        for result, reason in ((first, "evaluated"), (second, "cached")):
            assert result.value is True
            assert result.reason == reason
            assert result.metadata is not None
            if "version" in overrides:
                assert result.metadata.version is None
            if "scope" in overrides:
                assert result.metadata.scope is None

"""Env-derived defaults, the cache-only read and the static test client (#31)."""

from __future__ import annotations

import time

import httpx
import pytest
import respx

from savvagent_flags import (
    AsyncFlagClient,
    FlagClient,
    FlagClientConfig,
    FlagContext,
)
from savvagent_flags.types import EvaluationEvent
from tests.conftest import server_body

URL = "https://api.savvagent.com/flags/api/flags/checkout/evaluate"
VAR = "SAVVAGENT_TEST_CHECKOUT_DEFAULT"


def _ok() -> httpx.Response:
    return httpx.Response(200, json=server_body("checkout", True))


def _config(**kwargs: object) -> FlagClientConfig:
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        application_id="test-app",
        enable_realtime=False,
        enable_telemetry=False,
        **kwargs,  # type: ignore[arg-type]
    )


class TestDefaultFrom:
    def test_value_is_set(self) -> None:
        config = _config().set_default_from("checkout", lambda: True)
        assert config.defaults == {"checkout": True}

    def test_none_keeps_earlier_default(self) -> None:
        config = _config(defaults={"checkout": True}).set_default_from("checkout", lambda: None)
        assert config.defaults == {"checkout": True}

    def test_called_once_when_set(self) -> None:
        calls: list[int] = []

        def source() -> bool:
            calls.append(1)
            return False

        config = _config(defaults={"checkout": True}).set_default_from("checkout", source)
        with FlagClient(config) as client:
            client.is_enabled_cached("checkout")
            client.is_enabled_cached("checkout")
        assert calls == [1]
        assert config.defaults == {"checkout": False}

    def test_chains(self) -> None:
        config = (
            _config()
            .set_default_from("a", lambda: True)
            .set_default_from("b", lambda: False)
        )
        assert config.defaults == {"a": True, "b": False}


class TestDefaultFromEnv:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("1", True),
            ("true", True),
            (" YES ", True),
            ("On", True),
            ("0", False),
            ("FALSE", False),
            ("no", False),
            ("off\n", False),
        ],
    )
    def test_accepted_values(
        self, monkeypatch: pytest.MonkeyPatch, raw: str, expected: bool
    ) -> None:
        monkeypatch.setenv(VAR, raw)
        config = _config(defaults={"checkout": not expected}).set_default_from_env("checkout", VAR)
        assert config.defaults["checkout"] is expected

    def test_unset_is_silent_and_keeps_default(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.delenv(VAR, raising=False)
        config = _config(defaults={"checkout": True}).set_default_from_env("checkout", VAR)
        assert config.defaults == {"checkout": True}
        assert capsys.readouterr().err == ""

    @pytest.mark.parametrize("raw", ["", "maybe", "2"])
    def test_invalid_warns_without_value_and_keeps_default(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], raw: str
    ) -> None:
        monkeypatch.setenv(VAR, raw)
        config = _config().set_default_from_env("checkout", VAR)
        assert "checkout" not in config.defaults
        err = capsys.readouterr().err
        assert f"environment variable '{VAR}' is not a boolean; ignoring it" in err
        if raw:
            assert raw not in err

    def test_drives_the_error_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(VAR, "true")
        config = _config().set_default_from_env("checkout", VAR)
        with respx.mock:
            respx.post(URL).mock(return_value=httpx.Response(503))
            with FlagClient(config) as client:
                result = client.evaluate("checkout")
        assert result.value is True
        assert result.reason == "error"


class TestIsEnabledCachedSync:
    def test_miss_returns_default_without_request(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.post(URL)
            with FlagClient(_config(defaults={"checkout": True})) as client:
                assert client.is_enabled_cached("checkout") is True
                assert client.is_enabled_cached("other") is False
            assert route.call_count == 0

    def test_hit_returns_cached_value_for_that_context(self) -> None:
        with respx.mock:
            route = respx.post(URL).mock(return_value=_ok())
            with FlagClient(_config()) as client:
                client.evaluate("checkout", FlagContext(user_id="u1"))
                assert client.is_enabled_cached("checkout", FlagContext(user_id="u1")) is True
                # Another context has no entry of its own.
                assert client.is_enabled_cached("checkout", FlagContext(user_id="u2")) is False
            assert route.call_count == 1

    def test_expired_entry_is_a_miss(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            with FlagClient(_config(cache_ttl=1)) as client:
                client.evaluate("checkout")
                real = time.time
                monkeypatch.setattr(time, "time", lambda: real() + 5)
                assert client.is_enabled_cached("checkout") is False

    def test_invalidated_entry_is_a_miss(self) -> None:
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            with FlagClient(_config()) as client:
                client.evaluate("checkout")
                client.invalidate_cache("checkout")
                assert client.is_enabled_cached("checkout") is False

    def test_invalid_key_returns_default(self) -> None:
        with FlagClient(_config(defaults={"bad/key": True})) as client:
            assert client.is_enabled_cached("bad/key") is True
            assert client.is_enabled_cached("../x") is False

    def test_hit_is_counted_and_miss_is_not(self) -> None:
        tracked: list[EvaluationEvent] = []
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            with FlagClient(_config()) as client:
                client.evaluate("checkout")
                client._telemetry.track_evaluation = tracked.append  # type: ignore[method-assign]
                client.is_enabled_cached("checkout")
                client.is_enabled_cached("never-evaluated")
        assert [(e.flag_key, e.result) for e in tracked] == [("checkout", True)]


class TestIsEnabledCachedAsync:
    def test_is_a_plain_method_usable_outside_a_loop(self) -> None:
        client = AsyncFlagClient(_config(defaults={"checkout": True}))
        assert client.is_enabled_cached("checkout") is True

    async def test_miss_returns_default_without_request(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.post(URL)
            async with AsyncFlagClient(_config(defaults={"checkout": True})) as client:
                assert client.is_enabled_cached("checkout") is True
            assert route.call_count == 0

    async def test_hit_returns_cached_value_for_that_context(self) -> None:
        with respx.mock:
            route = respx.post(URL).mock(return_value=_ok())
            async with AsyncFlagClient(_config()) as client:
                await client.evaluate("checkout", FlagContext(user_id="u1"))
                assert client.is_enabled_cached("checkout", FlagContext(user_id="u1")) is True
                assert client.is_enabled_cached("checkout", FlagContext(user_id="u2")) is False
            assert route.call_count == 1

    async def test_expired_entry_is_a_miss(self, monkeypatch: pytest.MonkeyPatch) -> None:
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            async with AsyncFlagClient(_config(cache_ttl=1)) as client:
                await client.evaluate("checkout")
                real = time.time
                monkeypatch.setattr(time, "time", lambda: real() + 5)
                assert client.is_enabled_cached("checkout") is False

    async def test_entry_invalidated_by_stream_is_a_miss(self) -> None:
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            async with AsyncFlagClient(_config()) as client:
                await client.evaluate("checkout")
                # The realtime callback is synchronous; the delete is scheduled,
                # but a read straight after it must already miss.
                client._sync_invalidate_cache("checkout")
                assert client.is_enabled_cached("checkout") is False

    async def test_hit_is_counted_and_miss_is_not(self) -> None:
        with respx.mock:
            respx.post(URL).mock(return_value=_ok())
            config = _config()
            config.enable_telemetry = True
            async with AsyncFlagClient(config) as client:
                await client.evaluate("checkout")
                client._telemetry._evaluation_queue.clear()
                client.is_enabled_cached("checkout")
                client.is_enabled_cached("never-evaluated")
                queued = list(client._telemetry._evaluation_queue)
                client._telemetry._evaluation_queue.clear()
        assert [(e.flag_key, e.result) for e in queued] == [("checkout", True)]


class TestStaticFlagsSync:
    def test_serves_fixed_values_without_network(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.route()
            client = FlagClient.static_flags({"checkout": True, "banner": False})
            try:
                assert client.is_enabled("checkout") is True
                assert client.is_enabled("banner") is False
                assert client.is_enabled("anything-else") is False
                assert client.is_enabled_cached("checkout") is True
                assert client.is_enabled_cached("anything-else") is False
                result = client.evaluate("checkout", FlagContext(user_id="u1"))
                assert result.reason == "static"
                assert result.metadata is None
                assert client.get_all_flags() == []
                assert client.get_enterprise_flags() == []
                client.track_error("checkout", RuntimeError("boom"))
            finally:
                client.close()
            assert route.call_count == 0

    def test_overrides_still_apply(self) -> None:
        with FlagClient.static_flags({"checkout": True}) as client:
            client.set_config_override("checkout", {"limit": 3})
            client.set_variation_override("checkout", "b")
            assert client.get_config("checkout") == {"limit": 3}
            assert client.get_variation("checkout").variation == "b"

    def test_invalid_key_is_rejected(self) -> None:
        with FlagClient.static_flags({"bad/key": True}) as client:
            assert client.evaluate("bad/key").reason == "error"
            assert client.evaluate("bad/key").value is False

    def test_accepts_pairs(self) -> None:
        with FlagClient.static_flags([("checkout", True)]) as client:
            assert client.is_enabled("checkout") is True


class TestStaticFlagsAsync:
    async def test_serves_fixed_values_without_network_or_async_with(self) -> None:
        with respx.mock(assert_all_called=False) as mock:
            route = mock.route()
            client = AsyncFlagClient.static_flags({"checkout": True})
            assert await client.is_enabled("checkout") is True
            assert await client.is_enabled("anything-else") is False
            assert client.is_enabled_cached("checkout") is True
            result = await client.evaluate("checkout")
            assert result.reason == "static"
            assert await client.get_all_flags() == []
            assert await client.get_enterprise_flags() == []
            await client.track_error("checkout", RuntimeError("boom"))
            await client.close()
            assert route.call_count == 0

    async def test_works_inside_async_with_and_overrides_apply(self) -> None:
        async with AsyncFlagClient.static_flags({"checkout": True}) as client:
            client.set_config_override("checkout", {"limit": 3})
            assert await client.get_config("checkout") == {"limit": 3}

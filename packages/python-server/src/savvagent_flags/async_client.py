"""
Savvagent Flags Python Server SDK - Asynchronous Client

Savvagent Flags Server Client for feature flag evaluation with AI-powered error detection.
"""

from __future__ import annotations

import dataclasses
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar
from urllib.parse import quote

import httpx

from ._context_key import context_key
from ._flag_key import default_for, describe_flag_key, is_valid_flag_key
from ._response import evaluate_payload, response_metadata
from .cache import AsyncFlagCache
from .exceptions import InvalidAPIKeyError, InvalidFlagKeyError
from .realtime import AsyncRealtimeService
from .telemetry import AsyncTelemetryService
from .types import (
    ConfigOverrideEntry,
    ConfigOverrideOptions,
    ErrorEvent,
    EvaluationEvent,
    FlagClientConfig,
    FlagContext,
    FlagDefinition,
    FlagEvaluationResult,
    FlagMetadata,
    VariationOverrideEntry,
    VariationResult,
)

T = TypeVar("T")


class AsyncFlagClient:
    """
    Asynchronous Savvagent Flags Server Client for feature flag evaluation.

    This is the async client for use with asyncio-based applications.
    For synchronous applications, use FlagClient.

    Example:
        ```python
        from savvagent_flags import AsyncFlagClient, FlagClientConfig, FlagContext

        config = FlagClientConfig(api_key="sdk_your_key_here")

        async with AsyncFlagClient(config) as client:
            if await client.is_enabled("new-feature", FlagContext(user_id="123")):
                await do_new_thing()
        ```
    """

    def __init__(self, config: FlagClientConfig) -> None:
        """
        Initialize the AsyncFlagClient.

        Args:
            config: Client configuration including API key and options.

        Raises:
            InvalidAPIKeyError: If the API key is invalid.
        """
        # Validate API key - server SDK accepts both SDK keys (sdk_) and Server keys (srv_)
        if not config.api_key or (
            not config.api_key.startswith("sdk_") and not config.api_key.startswith("srv_")
        ):
            raise InvalidAPIKeyError(
                'Invalid API key. API keys must start with "sdk_" (SDK key) or "srv_" (Server key)'
            )

        self._config = config
        self._cache = AsyncFlagCache(config.cache_ttl)
        # The most recent evaluated value per flag, for track_error when the error's
        # context has no cached entry of its own (bounded by the host's flag keys).
        self._last_values: dict[str, bool] = {}
        self._telemetry = AsyncTelemetryService(
            config.base_url,
            config.api_key,
            config.enable_telemetry,
        )
        self._realtime: AsyncRealtimeService | None = None
        self._config_overrides: dict[str, ConfigOverrideEntry] = {}
        self._variation_overrides: dict[str, VariationOverrideEntry] = {}
        self._client: httpx.AsyncClient | None = None

        # Initialize real-time service (will be connected in __aenter__)
        if config.enable_realtime:
            self._realtime = AsyncRealtimeService(
                config.base_url,
                config.api_key,
                lambda connected: print(
                    f"[Savvagent Flags] Real-time: {'connected' if connected else 'disconnected'}",
                    file=sys.stderr,
                ),
            )

    async def __aenter__(self) -> AsyncFlagClient:
        """Async context manager entry."""
        self._client = httpx.AsyncClient(timeout=self._config.timeout)
        await self._telemetry.start()

        if self._realtime:
            # Subscribe to all flag updates to invalidate cache
            self._realtime.subscribe(
                "*", lambda event: self._sync_invalidate_cache(event.flag_key)
            )
            await self._realtime.connect()

        return self

    async def __aexit__(self, *args: Any) -> None:
        """Async context manager exit - ensures cleanup."""
        await self.close()

    def _sync_invalidate_cache(self, flag_key: str) -> None:
        """Synchronously mark a cache entry for invalidation (called from SSE callback)."""
        # Note: Since SSE callbacks are sync, we store keys to invalidate
        # and the next async operation will handle it
        import asyncio
        self._cache.mark_invalidated(flag_key)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._cache.invalidate(flag_key))
        except RuntimeError:
            pass  # No running loop, cache will be invalidated on next access

    async def evaluate(
        self, flag_key: str, context: FlagContext | None = None
    ) -> FlagEvaluationResult:
        """
        Evaluate a feature flag.

        Args:
            flag_key: The flag key to evaluate.
            context: Optional context for targeted rollouts.

        Returns:
            FlagEvaluationResult with value, configuration, and metadata.
        """
        if not is_valid_flag_key(flag_key):
            # Never put an unvalidated key in the URL path (#107): no request,
            # no telemetry, just the configured default.
            if self._config.on_error:
                self._config.on_error(
                    InvalidFlagKeyError(f"Invalid flag key: {describe_flag_key(flag_key)}")
                )
            return FlagEvaluationResult(
                key=flag_key,
                value=default_for(self._config.defaults, flag_key),
                reason="error",
            )

        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        start_time = time.time()

        try:
            # Check for variation override first
            variation_override = self._variation_overrides.get(flag_key)

            # The cache key is the context as sent, computed before the lookup.
            eval_context = self._prepare_context(context)
            ctx_key = context_key(eval_context.to_dict())

            # Check cache
            cached_entry = (
                await self._cache.get_entry(flag_key, context_key=ctx_key)
                if ctx_key is not None
                else None
            )
            if cached_entry is not None:
                configuration = cached_entry.configuration
                variation = cached_entry.variation

                # Apply configuration override
                config_override = self._config_overrides.get(flag_key)
                if config_override:
                    if config_override.merge and configuration:
                        configuration = self._merge_configurations(
                            configuration, config_override.config
                        )
                    else:
                        configuration = config_override.config

                # Apply variation override
                if variation_override:
                    variation = variation_override.variation

                result = FlagEvaluationResult(
                    key=flag_key,
                    value=cached_entry.value,
                    configuration=configuration,
                    variation=variation,
                    reason="cached",
                    metadata=FlagMetadata(
                        flag_id=cached_entry.flag_id,
                        version=cached_entry.version,
                        scope=cached_entry.scope,
                    ),
                )

                self._last_values[flag_key] = cached_entry.value
                await self._track_evaluation(flag_key, cached_entry.value, context, start_time)
                return result

            # Read before the request: an invalidation while it is in flight
            # makes the cache drop this result instead of storing it stale.
            generation = self._cache.generation(flag_key)

            # Call API - Per SDK Developer Guide: POST /api/flags/{key}/evaluate
            response = await self._client.post(
                f"{self._config.base_url}/api/flags/{quote(flag_key, safe='')}/evaluate",
                json={"context": eval_context.to_dict()},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._config.api_key}",
                },
            )
            response.raise_for_status()

            data, value = evaluate_payload(response.json())
            self._last_values[flag_key] = value
            version, scope = response_metadata(data)

            # Cache the result (including configuration and variation)
            if ctx_key is not None:
                await self._cache.set(
                    flag_key,
                    value,
                    data.get("flagId"),
                    data.get("configuration"),
                    data.get("variation"),
                    version=version,
                    scope=scope,
                    context_key=ctx_key,
                    generation=generation,
                )

            # Apply overrides to evaluated result
            final_configuration = data.get("configuration")
            final_variation = data.get("variation")

            config_override = self._config_overrides.get(flag_key)
            if config_override:
                if config_override.merge and final_configuration:
                    final_configuration = self._merge_configurations(
                        final_configuration, config_override.config
                    )
                else:
                    final_configuration = config_override.config

            if variation_override:
                final_variation = variation_override.variation

            result = FlagEvaluationResult(
                key=flag_key,
                value=value,
                configuration=final_configuration,
                variation=final_variation,
                reason="evaluated",
                metadata=FlagMetadata(
                    flag_id=data.get("flagId"),
                    description=data.get("description"),
                    variant=data.get("variant"),
                    version=version,
                    scope=scope,
                ),
            )

            await self._track_evaluation(flag_key, value, eval_context, start_time)
            return result

        except Exception as e:
            if self._config.on_error:
                self._config.on_error(e)

            default_value = self._config.defaults.get(flag_key, False)
            await self._track_evaluation(flag_key, default_value, context, start_time)

            return FlagEvaluationResult(
                key=flag_key,
                value=default_value,
                reason="error",
            )

    async def is_enabled(self, flag_key: str, context: FlagContext | None = None) -> bool:
        """
        Check if a flag is enabled (convenience method).

        Args:
            flag_key: The flag key to check.
            context: Optional context for targeted rollouts.

        Returns:
            True if the flag is enabled, False otherwise.
        """
        result = await self.evaluate(flag_key, context)
        return result.value

    async def get_config(
        self,
        flag_key: str,
        context: FlagContext | None = None,
        default: T | None = None,
    ) -> T | None:
        """
        Get dynamic configuration for a flag (Phase 1).

        Returns configuration if flag is enabled, otherwise returns default or None.

        Args:
            flag_key: The flag key to get configuration for.
            context: Optional context for targeted rollouts.
            default: Default value if flag is disabled or has no configuration.

        Returns:
            The configuration value, or default if flag is disabled.
        """
        result = await self.evaluate(flag_key, context)

        if not result.value:
            return default

        return result.configuration if result.configuration is not None else default

    async def get_variation(
        self,
        flag_key: str,
        context: FlagContext | None = None,
    ) -> VariationResult:
        """
        Get variation details for multi-variant flags (Phase 2).

        Returns variation name, enabled status, and configuration.

        Args:
            flag_key: The flag key to get variation for.
            context: Optional context for targeted rollouts.

        Returns:
            VariationResult with variation identifier and configuration.
        """
        result = await self.evaluate(flag_key, context)
        return VariationResult(
            variation=result.variation or "control",
            enabled=result.value,
            configuration=result.configuration,
        )

    def subscribe(
        self,
        flag_key: str,
        callback: Callable[[], None],
    ) -> Callable[[], None]:
        """
        Subscribe to flag updates.

        Args:
            flag_key: The flag key to subscribe to, or "*" for all flags.
            callback: Function to call when the flag is updated.

        Returns:
            An unsubscribe function.
        """
        if not self._realtime:
            print("[Savvagent Flags] Real-time updates are disabled", file=sys.stderr)
            return lambda: None

        return self._realtime.subscribe(flag_key, lambda _: callback())

    async def track_error(
        self,
        flag_key: str,
        error: Exception,
        context: FlagContext | None = None,
    ) -> None:
        """
        Track an error that occurred in flagged code.

        This correlates errors with feature flags for AI-powered analysis.

        Args:
            flag_key: The flag key associated with the error.
            error: The exception that was raised.
            context: Optional context for the evaluation.
        """
        # The value cached for this error's own context; else the flag's most recent
        # evaluation (an error is often reported without the context it was evaluated
        # with, and reporting False would count flag-on errors as flag-off); else False
        # for a flag never evaluated. Never raise into the caller's error handling.
        cached: bool | None = None
        try:
            ctx_key = context_key(self._prepare_context(context).to_dict())
            if ctx_key is not None:
                cached = await self._cache.get(flag_key, context_key=ctx_key)
        except Exception:
            cached = None
        if cached is None:
            cached = self._last_values.get(flag_key)
        flag_enabled = bool(cached)

        await self._telemetry.track_error(
            ErrorEvent(
                flag_key=flag_key,
                flag_enabled=flag_enabled,
                error_type=type(error).__name__,
                error_message=str(error),
                stack_trace=traceback.format_exc(),
                context=context,
                timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
        )

    async def invalidate_cache(self, flag_key: str | None = None) -> None:
        """
        Invalidate cache for a specific flag or all flags.

        Args:
            flag_key: The flag key to invalidate, or None for all flags.
        """
        await self._cache.invalidate(flag_key)

    async def close(self) -> None:
        """Clean up resources."""
        await self._telemetry.close()
        if self._realtime:
            await self._realtime.close()
        await self._cache.clear()
        self._last_values.clear()
        if self._client:
            await self._client.aclose()
            self._client = None

    # Override methods

    def set_config_override(
        self,
        flag_key: str,
        config: Any,
        options: ConfigOverrideOptions | None = None,
    ) -> None:
        """
        Set a configuration override for a flag.

        Useful for testing different configuration values without server changes.

        Args:
            flag_key: The flag key to override.
            config: The configuration to use.
            options: Override options (merge, validate).

        Raises:
            ValueError: If configuration is invalid and validation is enabled.
        """
        opts = options or ConfigOverrideOptions()

        # Validate JSON structure
        if opts.validate:
            try:
                json.dumps(config)
            except (TypeError, ValueError) as e:
                raise ValueError(f"Invalid configuration for flag '{flag_key}': {e}") from e

        # Store override
        self._config_overrides[flag_key] = ConfigOverrideEntry(
            config=config,
            merge=opts.merge,
            timestamp=time.time(),
        )

        # Note: Cache invalidation happens on next async access

    def clear_config_override(self, flag_key: str) -> None:
        """
        Clear configuration override for a flag.

        Args:
            flag_key: The flag key to clear override for.
        """
        self._config_overrides.pop(flag_key, None)

    def set_variation_override(self, flag_key: str, variation: str) -> None:
        """
        Set a variation override for a multi-variant flag.

        Forces the flag to return a specific variation.

        Args:
            flag_key: The flag key to override.
            variation: The variation identifier to force.
        """
        self._variation_overrides[flag_key] = VariationOverrideEntry(
            variation=variation,
            timestamp=time.time(),
        )

    def clear_variation_override(self, flag_key: str) -> None:
        """
        Clear variation override for a flag.

        Args:
            flag_key: The flag key to clear override for.
        """
        self._variation_overrides.pop(flag_key, None)

    def has_config_override(self, flag_key: str) -> bool:
        """
        Check if a flag has a configuration override.

        Args:
            flag_key: The flag key to check.

        Returns:
            True if an override exists.
        """
        return flag_key in self._config_overrides

    def has_variation_override(self, flag_key: str) -> bool:
        """
        Check if a flag has a variation override.

        Args:
            flag_key: The flag key to check.

        Returns:
            True if an override exists.
        """
        return flag_key in self._variation_overrides

    def get_config_overrides(self) -> dict[str, dict[str, Any]]:
        """
        Get all configuration overrides (for debugging/inspection).

        Returns:
            Dictionary of flag keys to override details.
        """
        return {
            key: {"config": entry.config, "merge": entry.merge, "timestamp": entry.timestamp}
            for key, entry in self._config_overrides.items()
        }

    def get_variation_overrides(self) -> dict[str, dict[str, Any]]:
        """
        Get all variation overrides (for debugging/inspection).

        Returns:
            Dictionary of flag keys to override details.
        """
        return {
            key: {"variation": entry.variation, "timestamp": entry.timestamp}
            for key, entry in self._variation_overrides.items()
        }

    async def clear_all_overrides(self) -> None:
        """Clear all configuration and variation overrides."""
        self._config_overrides.clear()
        self._variation_overrides.clear()
        await self._cache.clear()
        self._last_values.clear()

    async def get_all_flags(self, environment: str = "development") -> list[FlagDefinition]:
        """
        Get all flags for the application (and enterprise-scoped flags).

        Per SDK Developer Guide: GET /api/sdk/flags

        Args:
            environment: Environment to evaluate enabled state for.

        Returns:
            List of flag definitions.
        """
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        try:
            response = await self._client.get(
                f"{self._config.base_url}/api/sdk/flags",
                params={"environment": environment},
                headers={"Authorization": f"Bearer {self._config.api_key}"},
            )
            response.raise_for_status()

            data = response.json()
            flags = [
                FlagDefinition(
                    key=f["key"],
                    enabled=f["enabled"],
                    scope=f["scope"],
                    environments=f.get("environments", {}),
                    variations=f.get("variations"),
                    configuration=f.get("configuration"),
                    version=f.get("version", 0),
                )
                for f in data.get("flags", [])
            ]

            return flags

        except Exception as e:
            if self._config.on_error:
                self._config.on_error(e)
            return []

    async def get_enterprise_flags(self, environment: str = "development") -> list[FlagDefinition]:
        """
        Get only enterprise-scoped flags for the organization.

        Per SDK Developer Guide: GET /api/sdk/enterprise-flags

        Args:
            environment: Environment to evaluate enabled state for.

        Returns:
            List of enterprise flag definitions.
        """
        if not self._client:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        try:
            response = await self._client.get(
                f"{self._config.base_url}/api/sdk/enterprise-flags",
                params={"environment": environment},
                headers={"Authorization": f"Bearer {self._config.api_key}"},
            )
            response.raise_for_status()

            data = response.json()
            return [
                FlagDefinition(
                    key=f["key"],
                    enabled=f["enabled"],
                    scope=f["scope"],
                    environments=f.get("environments", {}),
                    variations=f.get("variations"),
                    configuration=f.get("configuration"),
                    version=f.get("version", 0),
                )
                for f in data.get("flags", [])
            ]

        except Exception as e:
            if self._config.on_error:
                self._config.on_error(e)
            return []

    def _prepare_context(self, context: FlagContext | None) -> FlagContext:
        """
        Copy the caller's context and fill in the configured defaults.

        The copy keeps the caller's object unmodified, so the same object can
        be reused without its filled-in fields leaking into later calls.
        """
        eval_context = dataclasses.replace(context) if context is not None else FlagContext()
        if not eval_context.application_id and self._config.application_id:
            eval_context.application_id = self._config.application_id
        return eval_context

    async def _track_evaluation(
        self,
        flag_key: str,
        result: bool,
        context: FlagContext | None,
        start_time: float,
    ) -> None:
        """Track an evaluation event."""
        await self._telemetry.track_evaluation(
            EvaluationEvent(
                flag_key=flag_key,
                result=result,
                context=context,
                duration_ms=int((time.time() - start_time) * 1000),
                timestamp=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
        )

    def _merge_configurations(self, base: Any, override: Any) -> Any:
        """
        Deep merge two configuration objects.

        Override values take precedence over base values.
        """
        if not isinstance(base, dict) or not isinstance(override, dict):
            return override

        result = base.copy()
        for key, value in override.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = self._merge_configurations(result[key], value)
            else:
                result[key] = value

        return result

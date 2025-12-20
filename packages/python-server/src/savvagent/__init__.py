"""
Savvagent Python Server SDK

AI-powered feature flags for Python backend applications.

Example:
    ```python
    from savvagent import FlagClient, FlagClientConfig, FlagContext

    config = FlagClientConfig(
        api_key="sdk_your_key_here",
        application_id="my-app",
    )

    with FlagClient(config) as client:
        # Boolean check
        if client.is_enabled("new-feature", FlagContext(user_id="123")):
            do_new_thing()

        # Dynamic configuration
        settings = client.get_config("settings-flag", default={})

        # Multi-variant experiments
        variation = client.get_variation("experiment")
        if variation.variation == "variant_a":
            show_variant_a()

        # Error tracking
        try:
            risky_operation()
        except Exception as e:
            client.track_error("risky-flag", e)
            raise
    ```

For async applications:
    ```python
    from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

    config = FlagClientConfig(api_key="sdk_your_key_here")

    async with AsyncFlagClient(config) as client:
        if await client.is_enabled("new-feature"):
            await do_new_thing()
    ```
"""

from .async_client import AsyncFlagClient
from .cache import AsyncFlagCache, FlagCache
from .client import FlagClient
from .exceptions import (
    APIError,
    AuthenticationError,
    ConfigurationError,
    ConnectionError,
    InvalidAPIKeyError,
    RateLimitError,
    SavvagentError,
    TimeoutError,
)
from .realtime import AsyncRealtimeService, RealtimeService
from .telemetry import AsyncTelemetryService, TelemetryService
from .types import (
    CacheEntry,
    ConfigOverrideOptions,
    ErrorEvent,
    EvaluationEvent,
    FlagClientConfig,
    FlagContext,
    FlagDefinition,
    FlagEvaluationResult,
    FlagListResponse,
    FlagMetadata,
    FlagUpdateEvent,
    VariationResult,
)

__version__ = "1.0.0"

__all__ = [
    # Version
    "__version__",
    # Main clients
    "FlagClient",
    "AsyncFlagClient",
    # Configuration
    "FlagClientConfig",
    "FlagContext",
    "ConfigOverrideOptions",
    # Results
    "FlagEvaluationResult",
    "VariationResult",
    "FlagDefinition",
    "FlagListResponse",
    "FlagMetadata",
    # Services (for advanced use)
    "FlagCache",
    "AsyncFlagCache",
    "TelemetryService",
    "AsyncTelemetryService",
    "RealtimeService",
    "AsyncRealtimeService",
    # Types
    "CacheEntry",
    "EvaluationEvent",
    "ErrorEvent",
    "FlagUpdateEvent",
    # Exceptions
    "SavvagentError",
    "InvalidAPIKeyError",
    "APIError",
    "AuthenticationError",
    "RateLimitError",
    "TimeoutError",
    "ConnectionError",
    "ConfigurationError",
]

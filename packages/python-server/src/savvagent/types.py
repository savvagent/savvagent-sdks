"""
Savvagent Python Server SDK Types
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal


@dataclass
class FlagClientConfig:
    """
    Configuration for initializing the FlagClient.

    Per SDK Developer Guide: https://flags-docs.savvagent.com/sdk-developer-guide
    """

    api_key: str
    """
    API key for authentication.
    - SDK keys (sdk_) - Safe for client-side apps (browsers, mobile)
    - Server keys (srv_) - Secret, for server-side apps only (Node.js, Python)
    """

    application_id: str | None = None
    """Application ID for application-scoped flags (omit for enterprise flags only)."""

    base_url: str = "https://flags-api.savvagent.com"
    """Base URL for the Savvagent API."""

    environment: str = "production"
    """Environment for flag evaluation (e.g., "development", "staging", "production", "beta")."""

    enable_realtime: bool = True
    """Enable real-time flag updates via SSE."""

    cache_ttl: int = 60
    """Cache TTL in seconds (default: 60 = 1 minute)."""

    enable_telemetry: bool = True
    """Enable telemetry tracking."""

    defaults: dict[str, bool] = field(default_factory=dict)
    """Default flag values when evaluation fails."""

    on_error: Callable[[Exception], None] | None = None
    """Custom error handler."""

    timeout: float = 5.0
    """Request timeout in seconds."""


@dataclass
class FlagContext:
    """
    Context passed to flag evaluation.

    Per SDK Developer Guide: https://flags-docs.savvagent.com/sdk-developer-guide
    """

    user_id: str | None = None
    """User ID for targeted rollouts (logged-in users) - required for percentage rollouts."""

    anonymous_id: str | None = None
    """Anonymous ID for consistent rollouts (anonymous users) - alternative to user_id."""

    session_id: str | None = None
    """Session ID as fallback identifier."""

    environment: str | None = None
    """Target environment (e.g., "production", "staging")."""

    organization_id: str | None = None
    """Organization ID for multi-tenant apps."""

    application_id: str | None = None
    """Application ID for hierarchical flag lookup (auto-injected from config)."""

    language: str | None = None
    """User's language code (e.g., "en", "es")."""

    ip_address: str | None = None
    """IP address for geo-targeting (server-side only)."""

    user_agent: str | None = None
    """User agent string (server-side only)."""

    attributes: dict[str, Any] = field(default_factory=dict)
    """Custom attributes for targeting rules."""

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API requests."""
        result: dict[str, Any] = {}

        for key in [
            "user_id",
            "anonymous_id",
            "session_id",
            "environment",
            "organization_id",
            "application_id",
            "language",
            "ip_address",
            "user_agent",
        ]:
            value = getattr(self, key)
            if value is not None:
                result[key] = value

        if self.attributes:
            result["attributes"] = self.attributes

        return result


@dataclass
class FlagMetadata:
    """Metadata about a flag."""

    flag_id: str | None = None
    description: str | None = None
    variant: str | None = None


@dataclass
class FlagEvaluationResult:
    """Result from flag evaluation."""

    key: str
    """Flag key."""

    value: bool
    """Evaluated value."""

    configuration: Any = None
    """Dynamic configuration attached to the flag (Phase 1)."""

    variation: str | None = None
    """Variation identifier for multi-variant flags (Phase 2)."""

    reason: Literal["cached", "evaluated", "default", "error"] = "evaluated"
    """Reason for the value."""

    metadata: FlagMetadata | None = None
    """Metadata about the flag."""


@dataclass
class VariationResult:
    """Variation result for multi-variant flags."""

    variation: str
    """Variation identifier (e.g., "control", "variant_a")."""

    enabled: bool
    """Whether the flag is enabled."""

    configuration: Any = None
    """Configuration attached to this variation."""


@dataclass
class CacheEntry:
    """Cache entry for flag values."""

    value: bool
    """Cached flag value."""

    configuration: Any = None
    """Cached configuration."""

    variation: str | None = None
    """Cached variation identifier."""

    expires_at: float = 0.0
    """Unix timestamp when entry expires."""

    flag_id: str | None = None
    """Flag ID for reference."""


@dataclass
class EvaluationEvent:
    """Telemetry event for flag evaluation."""

    flag_key: str
    result: bool
    context: FlagContext | None = None
    duration_ms: int = 0
    trace_id: str | None = None
    timestamp: str = ""


@dataclass
class ErrorEvent:
    """Telemetry event for errors in flagged code."""

    flag_key: str
    flag_enabled: bool
    error_type: str
    error_message: str
    stack_trace: str | None = None
    context: FlagContext | None = None
    trace_id: str | None = None
    timestamp: str = ""


@dataclass
class FlagUpdateEvent:
    """Real-time update event from SSE."""

    type: Literal["flag.updated", "flag.deleted", "flag.created"]
    flag_key: str
    data: Any = None


@dataclass
class ConfigOverrideOptions:
    """Options for setting configuration overrides."""

    merge: bool = False
    """Merge with API configuration instead of replacing."""

    validate: bool = True
    """Validate configuration structure."""


@dataclass
class ConfigOverrideEntry:
    """Internal structure for storing configuration overrides."""

    config: Any
    """Configuration override data."""

    merge: bool
    """Whether to merge with API config."""

    timestamp: float
    """Timestamp when override was set."""


@dataclass
class VariationOverrideEntry:
    """Internal structure for storing variation overrides."""

    variation: str
    """Forced variation identifier."""

    timestamp: float
    """Timestamp when override was set."""


@dataclass
class FlagDefinition:
    """
    Flag definition returned from getAllFlags endpoint.

    Per SDK Developer Guide: GET /api/sdk/flags
    """

    key: str
    """Flag key."""

    enabled: bool
    """Enabled state for the requested environment."""

    scope: Literal["application", "enterprise"]
    """Flag scope."""

    environments: dict[str, dict[str, Any]] = field(default_factory=dict)
    """Environment configuration with enabled state and rollout percentage."""

    variations: dict[str, Any] | None = None
    """Variation definitions for A/B testing (if any)."""

    configuration: Any = None
    """Dynamic configuration attached to the flag."""

    version: int = 0
    """Flag version for cache invalidation."""


@dataclass
class FlagListResponse:
    """
    Response from getAllFlags endpoint.

    Per SDK Developer Guide: GET /api/sdk/flags
    """

    flags: list[FlagDefinition] = field(default_factory=list)
    """List of flag definitions."""

    count: int = 0
    """Total count of flags returned."""

    organization_id: str = ""
    """Organization ID."""

    application_id: str | None = None
    """Application ID (present for SDK key auth)."""

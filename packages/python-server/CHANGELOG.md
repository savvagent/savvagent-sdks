# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - Unreleased

### Changed (breaking)

- The distribution is renamed from `savvagent` to `savvagent-flags` (`pip install savvagent-flags`), and the import package from `savvagent` to `savvagent_flags`

### Added

- The default `base_url` is `https://api.savvagent.com/flags`
- `InvalidFlagKeyError`: a flag key that is not 1-128 characters of `[A-Za-z0-9._-]` (or is `.` or `..`) is rejected before any request is made
- Evaluation results carry the flag `version` and `scope` metadata
- An evaluation in flight when its flag is invalidated no longer re-caches its stale result
- `AsyncFlagClient.set_environment` / `get_environment`, matching `FlagClient`; changing the environment clears the cache (#49)
- `FlagClientConfig.set_default_from_env(flag_key, var)` and `set_default_from(flag_key, fn)`: a flag's default read once from an environment variable or a function, the equivalents of the Rust SDK's `with_default_env` / `with_default_fn` (#31)
- `is_enabled_cached(flag_key, context=None)` on both clients: the unexpired cached value, else the configured default, without a request; a plain method on `AsyncFlagClient` too (#31)
- `FlagClient.static_flags(flags)` and `AsyncFlagClient.static_flags(flags)`: a client that serves fixed values and never touches the network, for tests; its results have `reason="static"` (#31)
- Building a client with a `srv_` key and a non-`https`, non-loopback `base_url` prints one warning to stderr: `Savvagent Flags: the server key will be sent over <scheme>; use an https base_url` (#44)

### Changed

- The evaluation cache keys each context by the SHA-256 hex digest of its canonical JSON, so raw user IDs and attributes are no longer kept in the cache; the evaluate request still sends the full context (#30)
- The cache holds at most 10,000 entries in total across all flags, evicting the least recently used (a cache hit counts as a use), instead of up to 10,000 contexts for each flag (#30)

### Deprecated

- `savvagent_flags.cache.MAX_CONTEXTS_PER_FLAG` is now an alias of the new `MAX_ENTRIES` total bound and will be removed in a future major release (#30)

### Fixed

- `AsyncFlagClient` sends the configured `environment` when the context has none, as `FlagClient` does; it sent none, so the server used its default environment (#49)
- `AsyncFlagClient` drops a flag's cached entries as soon as the realtime stream invalidates it, instead of on a task scheduled for later
- `track_error` falls back to the flag's last evaluated value only when called without a context; a cache miss for a given context reports `False` instead of another user's value
- The last evaluated value is remembered only when no invalidation overtook the request, and it is forgotten on a realtime update and by `invalidate_cache`
- Keys from the realtime stream are validated before the cache is invalidated; invalid or non-string keys and malformed generic messages are skipped without dropping the connection
- The per-flag invalidation counters are bounded: past 10,000 flags a new epoch replaces them
- Evaluations are cached per flag and per evaluation context, not per flag key alone, so one user's result is no longer served to another
- The flag key is sent as a single, percent-encoded path segment
- The client follows the documented evaluate contract
- Examples hold to the declared Python 3.9 floor; mypy runs with `python_version = "3.10"` because mypy no longer accepts 3.9 as a target
- `ruff check` passes and is part of the gate
- `uv.lock` is committed so CI installs reproducibly

## [1.0.0] - 2024-12-19

### Added

- Initial release of the Savvagent Python Server SDK
- `FlagClient` - Synchronous client for feature flag evaluation
- `AsyncFlagClient` - Asynchronous client for async applications
- `FlagCache` and `AsyncFlagCache` - TTL-based in-memory caching
- `TelemetryService` and `AsyncTelemetryService` - Batch telemetry tracking
- `RealtimeService` and `AsyncRealtimeService` - SSE-based real-time updates
- Dynamic configuration support (`get_config`)
- Multi-variant experiment support (`get_variation`)
- Configuration and variation override system for testing
- Error tracking with flag correlation (`track_error`)
- Framework examples for FastAPI, Flask, and Django
- Full type hints with PEP 561 support
- Comprehensive test suite

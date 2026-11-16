# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - Unreleased

### Fixed

- Evaluations are cached per flag and per evaluation context, not per flag key alone, so one user's result is no longer served to another
- The flag key is sent as a single, percent-encoded path segment
- The client follows the documented evaluate contract
- Examples and the mypy configuration hold to the declared Python 3.9 floor
- `ruff check` passes and is part of the gate

## [1.0.0] - 2024-12-19

### Added

- Initial release of the Otto Flags Python Server SDK
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

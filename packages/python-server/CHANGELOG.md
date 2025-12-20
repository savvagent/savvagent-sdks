# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

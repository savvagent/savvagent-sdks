---
'@savvagent/node-server': patch
---

Fix a cross-user flag cache leak (#22). The evaluation cache was keyed by flag key only, so a result evaluated for one context was served to every other context for the cache TTL. Cache entries are now keyed by flag key plus a deterministic hash of the evaluation context, invalidating a flag clears it for every context, `getAllFlags()` no longer seeds the evaluation cache with environment-level values, `trackError()` looks up the flag state for its own context, and `cacheTtl: 0` now disables caching instead of falling back to 60 seconds.

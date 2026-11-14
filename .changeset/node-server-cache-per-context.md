---
'@savvagent/node-server': patch
---

Fix a cross-user flag cache leak (#22). The evaluation cache was keyed by flag key only, so a result evaluated for one context was served to every other context for the cache TTL.

- Cache entries are now keyed by flag key plus a deterministic hash of the evaluation context (Date values are hashed the way the request serializes them, and a `__proto__` attribute is kept). Invalidating a flag clears it for every context, and `trackError()` looks up the flag state for its own context.
- The cache is bounded: new `cacheMaxEntries` option (default 10000) caps the number of cached (flag, context) results, evicting the least recently used, so a long-running server seeing many distinct users does not grow without limit.
- `cacheTtl: 0` now disables caching instead of falling back to 60 seconds.
- `getAllFlags()` no longer seeds the evaluation cache with environment-level values.

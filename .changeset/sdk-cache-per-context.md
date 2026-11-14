---
'@savvagent/sdk': patch
---

Fix a cross-user flag cache leak (#22). The evaluation cache was keyed by flag key only, so a result evaluated for one user's context was served to every other context for the cache TTL; this mattered most for server-side code that shares one client across requests (`@savvagent/astro`, `@savvagent/nextjs`, `@savvagent/sveltekit`). Cache entries are now keyed by flag key plus a deterministic hash of the evaluation context, invalidating a flag clears it for every context, cached results keep their metadata, `getAllFlags()` no longer seeds the evaluation cache with environment-level values, and `cacheTtl: 0` now disables caching instead of falling back to 60 seconds.

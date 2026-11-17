---
'@savvagent/sdk': minor
---

Export the evaluation cache's helpers so other Savvagent SDKs share one implementation instead of copying it (#27).

- New exports: `contextCacheKey(context)`, `DEFAULT_CACHE_MAX_ENTRIES`, `isValidFlagKey(key)` (the flag-key rule: 1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) and `defaultFor(defaults, key)` (`true` only for an own `true` entry).
- `FlagCache` stays exported, and its public contract is now documented in its TSDoc and the README: entries are keyed by flag key and `contextCacheKey` of the context as sent, and `get(key)` / `getEntry(key)` without a context key read only the empty-context entry, never a value cached for another context.

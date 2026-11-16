---
'@savvagent/node-server': patch
---

Port fixes from the archived flags repo (#40).

- The flag key is sent as one encoded path segment. A key outside the server's rule (1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) returns the default with `reason: 'error'` and sends no request, so a key cannot steer the request, and the API key with it, to another endpoint.
- `evaluate` follows the documented contract: a response without a boolean `enabled` is a failed lookup that returns the default and is not cached, instead of caching the default for the TTL. The server's `null` configuration and variation come back as `undefined`.
- Result metadata reports the server's `version` and `scope`, on cached results as well as fresh ones (cached results now also carry `flagId`). `CacheEntry` gains optional `version` and `scope`.
- An evaluation whose request was in flight when its flag was invalidated (for example by a realtime update) is returned but no longer cached, so the stale value is not served for the TTL. `FlagCache` gains `generation(key)`, and `FlagCache.set` gains optional trailing `metadata` and `generation` parameters.
- `trackError` without a cached entry for its context reports the flag's most recent evaluated value instead of `false`.

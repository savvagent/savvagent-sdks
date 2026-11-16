---
'@savvagent/node-server': patch
---

Port fixes from the archived flags repo (#40).

- The flag key is sent as one encoded path segment. A key outside the server's rule (1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) returns the default with `reason: 'error'` (the message in `metadata.description`) and sends no request, so a key cannot steer the request, and the API key with it, to another endpoint.
- `evaluate` follows the documented contract: a response without a boolean `enabled` is a failed lookup that returns the default and is not cached, instead of caching the default for the TTL. The server's `null` configuration and variation come back as `undefined`.
- Result metadata reports the server's `version` and `scope`, on cached results as well as fresh ones (cached results now also carry `flagId`). `CacheEntry` gains optional `version` and `scope`.
- An evaluation whose request was in flight when its flag was invalidated (for example by a realtime update) is returned but no longer cached, so the stale value is not served for the TTL. Out-of-order responses across an invalidation keep the newer result. `FlagCache` gains `generation(key)`, and `FlagCache.set` gains optional trailing `metadata` and `generation` parameters. The per-flag generation counters are bounded by `cacheMaxEntries`.
- `trackError` called without a context reports the flag's most recent evaluated value instead of `false`. A call with a context reports only that context's cached value (else `false`), never another user's. A result that predates an invalidation, and an invalidated flag, are not remembered.
- The request abort timer is cleared when `fetch` rejects, in `evaluate`, `getAllFlags` and `getEnterpriseFlags`, so a failed request no longer keeps a timer alive for the timeout.
- `defaults` is read as an own property, so an unconfigured key such as `__proto__`, `toString` or `constructor` falls back to `false` instead of a value inherited from `Object.prototype`. Only an own default of `true` counts; any other configured value is `false`.
- The telemetry flush interval no longer keeps the Node.js process alive. Call `close()` to flush queued events before exit.

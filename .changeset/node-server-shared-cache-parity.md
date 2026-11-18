---
'@savvagent/node-server': minor
---

Use `@savvagent/sdk`'s flag cache, and add the Rust SDK's env-derived defaults, synchronous cached read, static test client and plain-HTTP warning (#27, #31, #44).

- The evaluation cache, `contextCacheKey`, `DEFAULT_CACHE_MAX_ENTRIES`, the flag-key rule and the defaults lookup now come from `@savvagent/sdk` instead of a copy, so a fix lands once. `FlagCache` keeps its call shape (`set` takes configuration and variation, `getEntry` returns them, `invalidate()` with no key clears everything) and gains `keys()`; its contract, including that `get(key)` reads only the empty-context entry, is documented. `contextCacheKey` and `DEFAULT_CACHE_MAX_ENTRIES` are now exported.
- New `defaultsFrom` option and `defaultFromEnv(name)` helper: defaults computed once when the client is built, from an environment variable (`1`/`true`/`yes`/`on`, `0`/`false`/`no`/`off`) or any function.
- New `client.isEnabledCached(flagKey, context?)`: a synchronous read that never makes a request or waits. It returns the unexpired cached value for that context, else the configured default.
- New `FlagClient.staticFlags(flags)`: a client for tests that serves fixed values (`reason: 'static'`) and never touches the network. `FlagEvaluationResult['reason']` gains `'static'`.
- A `srv_` server key with a base URL that is not `https` and not a loopback host now logs one warning: `Savvagent Flags: the server key will be sent over http; use an https base_url`.

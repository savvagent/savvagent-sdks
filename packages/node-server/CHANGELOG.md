# @savvagent/node-server

## 1.2.0

### Minor Changes

- 0a297ce: Use `@savvagent/sdk`'s flag cache, and add the Rust SDK's env-derived defaults, synchronous cached read, static test client and plain-HTTP warning (#27, #31, #44).

  - The evaluation cache, `contextCacheKey`, `DEFAULT_CACHE_MAX_ENTRIES`, the flag-key rule and the defaults lookup now come from `@savvagent/sdk` instead of a copy, so a fix lands once. `FlagCache` keeps its call shape (`set` takes configuration and variation, `getEntry` returns them, `invalidate()` with no key clears everything) and gains `keys()`; its contract, including that `get(key)` reads only the empty-context entry, is documented. `contextCacheKey` and `DEFAULT_CACHE_MAX_ENTRIES` are now exported.
  - New `defaultsFrom` option and `defaultFromEnv(name)` helper: defaults computed once when the client is built, from an environment variable (`1`/`true`/`yes`/`on`, `0`/`false`/`no`/`off`) or any function.
  - New `client.isEnabledCached(flagKey, context?)`: a synchronous read that never makes a request or waits. It returns the unexpired cached value for that context, else the configured default.
  - New `FlagClient.staticFlags(flags)`: a client for tests that serves fixed values (`reason: 'static'`) and never touches the network. `FlagEvaluationResult['reason']` gains `'static'`.
  - A `srv_` server key with a base URL that is not `https` and not a loopback host now logs one warning: `Savvagent Flags: the server key will be sent over http; use an https base_url`.

### Patch Changes

- 1965cc7: Cache entries are now keyed by the lowercase SHA-256 hex digest of the canonical evaluation context instead of the raw context JSON, so user IDs and attributes are no longer held as cache keys. The exported `contextCacheKey` now returns that 64-character digest. The total entry cap (`maxEntries` / `cacheMaxEntries`, default 10,000, least recently used evicted first) is unchanged. (#30)
- 68621dd: Default the Flags API base URL to `https://api.savvagent.com/flags` and strip trailing slashes from a supplied base URL. `@savvagent/node-server` now reads `enabled` from the evaluate response; before, every flag returned its configured default.
- 0a297ce: Docs: use the SAVVAGENT_FLAGS_API_KEY / SAVVAGENT_FLAGS_API_URL env var names.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- f92d5f2: Port fixes from the archived flags repo (#40).

  - The flag key is sent as one encoded path segment. A key outside the server's rule (1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) returns the default with `reason: 'error'` (the message in `metadata.description`) and sends no request, so a key cannot steer the request, and the API key with it, to another endpoint.
  - `evaluate` follows the documented contract: a response without a boolean `enabled` is a failed lookup that returns the default and is not cached, instead of caching the default for the TTL. The server's `null` configuration and variation come back as `undefined`.
  - Result metadata reports the server's `version` and `scope`, on cached results as well as fresh ones (cached results now also carry `flagId`). `CacheEntry` gains optional `version` and `scope`.
  - An evaluation whose request was in flight when its flag was invalidated (for example by a realtime update) is returned but no longer cached, so the stale value is not served for the TTL. Out-of-order responses across an invalidation keep the newer result. `FlagCache` gains `generation(key)`, and `FlagCache.set` gains optional trailing `metadata` and `generation` parameters. The per-flag generation counters are bounded by `cacheMaxEntries`.
  - `trackError` called without a context reports the flag's most recent evaluated value instead of `false`. A call with a context reports only that context's cached value (else `false`), never another user's. A result that predates an invalidation, and an invalidated flag, are not remembered.
  - The request abort timer is cleared when `fetch` rejects, in `evaluate`, `getAllFlags` and `getEnterpriseFlags`, so a failed request no longer keeps a timer alive for the timeout.
  - `defaults` is read as an own property, so an unconfigured key such as `__proto__`, `toString` or `constructor` falls back to `false` instead of a value inherited from `Object.prototype`. Only an own default of `true` counts; any other configured value is `false`.
  - The telemetry flush interval no longer keeps the Node.js process alive. Call `close()` to flush queued events before exit.

- 8b34482: Fix a cross-user flag cache leak (#22). The evaluation cache was keyed by flag key only, so a result evaluated for one context was served to every other context for the cache TTL.

  - Cache entries are now keyed by flag key plus a deterministic hash of the evaluation context (Date values are hashed the way the request serializes them, and a `__proto__` attribute is kept). Invalidating a flag clears it for every context, and `trackError()` looks up the flag state for its own context.
  - The cache is bounded: new `cacheMaxEntries` option (default 10000) caps the number of cached (flag, context) results, evicting the least recently used, so a long-running server seeing many distinct users does not grow without limit.
  - `cacheTtl: 0` now disables caching instead of falling back to 60 seconds.
  - `getAllFlags()` no longer seeds the evaluation cache with environment-level values.
  - Cache keys no longer overflow the stack on a `toJSON` that returns `this` (toJSON is applied once, as `JSON.stringify` does). A cyclic context throws a `TypeError` instead of recursing, and `trackError` in node-server tolerates it. Expired entries are swept at most once per TTL, so a full cache no longer scans every entry on each write. A `NaN` `cacheMaxEntries` falls back to the default cap.

- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
- 0a297ce: Add tests that pin behaviours recorded in the cross-SDK behaviour matrix (`docs/SDK-DEVELOPER-GUIDE.md`). For `@savvagent/sdk`: a `srv_` key is rejected, `trackError` without a context reports `flagEnabled: true` with no last-value fallback, there is no static client, cache-only read or env-derived default, and a realtime event's key is not validated before its cache entry is invalidated. For `@savvagent/node-server`: a `srv_` key is accepted, and a realtime event's key is not validated before its cache entry is invalidated. No runtime change.
- Updated dependencies [1965cc7]
- Updated dependencies [68621dd]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
- Updated dependencies [f92d5f2]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
  - @savvagent/sdk@1.2.0

## 1.1.0

### Minor Changes

- Add environment support with setEnvironment/getEnvironment methods across all SDKs for dynamic environment switching at runtime.

## 1.0.1

### Patch Changes

- Updates for new API parameters

## 1.0.0

### Major Changes

- Initial Release of Savvagent SDKs

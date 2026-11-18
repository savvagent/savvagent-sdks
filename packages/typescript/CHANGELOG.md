# @savvagent/sdk

## 1.2.0

### Minor Changes

- 1965cc7: Cache entries are now keyed by the lowercase SHA-256 hex digest of the canonical evaluation context instead of the raw context JSON, so user IDs and attributes are no longer held as cache keys. The exported `contextCacheKey` now returns that 64-character digest. The total entry cap (`maxEntries` / `cacheMaxEntries`, default 10,000, least recently used evicted first) is unchanged. (#30)
- 0a297ce: New `@savvagent/sdk/server` subpath: the request scope shared by the server integrations (#26). It provides `parseCookies`; `buildRequestContext` (the `user_id` cookie is read only with `trustUserIdCookie`); `createRequestScope`, whose `getUserId` is called once per request, bounded by `evaluationTimeoutMs` and treated as anonymous when it throws, rejects or times out, while an explicit `userId` or `user_id` wins; `assignAnonymousId`, `newAnonymousId`, `serializeAnonymousIdCookie` and `anonymousIdCookieOptions` for the per-visitor `savvagent_anonymous_id` cookie (not HttpOnly, `Path=/`, `SameSite=Lax`, one year, `Secure` on https); `toServerConfig` and `createServerClient` (no realtime, no language detection, one attempt per evaluation); `evaluateBounded` (one attempt, 1000 ms by default, the flag's default with `reason: 'error'` on a timeout, an error or a missing client); and `throttleErrors` (each message once a minute). The module carries no copy of `FlagClient` and needs only Web Crypto, so it runs on Node.js and edge runtimes. The root `@savvagent/sdk` entry is unchanged.
- 0a297ce: Export the evaluation cache's helpers so other Savvagent SDKs share one implementation instead of copying it (#27).

  - New exports: `contextCacheKey(context)`, `DEFAULT_CACHE_MAX_ENTRIES`, `isValidFlagKey(key)` (the flag-key rule: 1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) and `defaultFor(defaults, key)` (`true` only for an own `true` entry).
  - `FlagCache` stays exported, and its public contract is now documented in its TSDoc and the README: entries are keyed by flag key and `contextCacheKey` of the context as sent, and `get(key)` / `getEntry(key)` without a context key read only the empty-context entry, never a value cached for another context.

### Patch Changes

- 68621dd: Default the Flags API base URL to `https://api.savvagent.com/flags` and strip trailing slashes from a supplied base URL. `@savvagent/node-server` now reads `enabled` from the evaluate response; before, every flag returned its configured default.
- 0a297ce: Docs: use the SAVVAGENT_FLAGS_API_KEY / SAVVAGENT_FLAGS_API_URL env var names.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- 8b34482: In the browser, the client now uses the `savvagent_anonymous_id` cookie as its anonymous ID when one is present (and mirrors it to localStorage), falling back to the localStorage ID as before. Server integrations such as `@savvagent/astro` and `@savvagent/react-router` set that cookie, so server-rendered and client-side evaluations put a visitor in the same rollout bucket.

  Server-set and browser-generated IDs use the same `anon_<uuid>` format. A returning visitor who already has a localStorage ID moves to the cookie ID the first time the server sets it, so their percentage-rollout bucket can change once.

- 0a297ce: Add tests that pin behaviours recorded in the cross-SDK behaviour matrix (`docs/SDK-DEVELOPER-GUIDE.md`). For `@savvagent/sdk`: a `srv_` key is rejected, `trackError` without a context reports `flagEnabled: true` with no last-value fallback, there is no static client, cache-only read or env-derived default, and a realtime event's key is not validated before its cache entry is invalidated. For `@savvagent/node-server`: a `srv_` key is accepted, and a realtime event's key is not validated before its cache entry is invalidated. No runtime change.
- 8b34482: Fix a cross-user flag cache leak (#22). The evaluation cache was keyed by flag key only, so a result evaluated for one user's context was served to every other context for the cache TTL; this mattered most for server-side code that shares one client across requests (`@savvagent/astro`, `@savvagent/nextjs`, `@savvagent/sveltekit`).

  - Cache entries are now keyed by flag key plus a deterministic hash of the evaluation context (Date values are hashed the way the request serializes them, and a `__proto__` attribute is kept). Invalidating a flag clears it for every context, and cached results keep their metadata.
  - The cache is bounded: new `cacheMaxEntries` option (default 10000) caps the number of cached (flag, context) results, evicting the least recently used, so a long-running server seeing many distinct users does not grow without limit.
  - `cacheTtl: 0` now disables caching instead of falling back to 60 seconds.
  - `FlagCache.get(key)` and `FlagCache.getEntry(key)` called without a context key now read only the entry cached for the empty context, not a result cached for some other context (the public contract is to be settled in #27).
  - `getAllFlags()` no longer seeds the evaluation cache with environment-level values, so `getCachedFlags()` no longer lists flags after a `getAllFlags()` call; it lists flags that have been evaluated.
  - Cache keys no longer overflow the stack on a `toJSON` that returns `this` (toJSON is applied once, as `JSON.stringify` does). A cyclic context throws a `TypeError` instead of recursing. Expired entries are swept at most once per TTL, so a full cache no longer scans every entry on each write. A `NaN` `cacheMaxEntries` falls back to the default cap.

- f92d5f2: Port fixes from the archived flags repo, and harden the evaluate path (#39).

  - Flag keys are validated and sent as exactly one percent-encoded path segment. A key no flag can have (outside 1-128 characters of `[A-Za-z0-9._-]`, or `.` or `..`) no longer reaches the network, where `/`, `?`, `#` or `..` could steer the request and its SDK key to another endpoint. `evaluate` returns the default with `reason: 'error'` and the problem in `metadata.description`, and reports the same error to `onError`.
    - The key is checked before the override lookup, so a local-only override on an invalid key such as `'my flag'` now returns an error instead of the override value.
    - A non-string key from untyped JavaScript (`undefined`, `null`, a number, an object) now fails the same way instead of being interpolated into the URL.
  - An evaluate response without a boolean `enabled` is a failed lookup: `evaluate` returns the default with `reason: 'error'`, reports it to `onError`, and does not cache it. Before, it was read as `false` and cached for the TTL. A `null` `configuration` or `variation` is now reported as `undefined`, as the types say.
  - An evaluation whose request started before an invalidation is no longer cached, so a kill switch flipped mid-request is not undone by the stale answer. A realtime update, `clearCache()`, `setEnvironment()`, and setting or clearing an override all count; setting or clearing an override now also drops that flag's cached results. `FlagCache` gains `generation(key)` and an optional trailing `generation` parameter on `set`; existing calls are unchanged. The per-flag generation counts are bounded by `cacheMaxEntries`.
  - A configured default is read only from `defaults`' own properties, and only `true` counts. A flag key such as `__proto__`, `toString` or `constructor` used to return `Object.prototype` or a function as its value on an error path; it now returns `false`.
  - The 10 second request abort timer is cleared even when `fetch` throws synchronously (for example when it is not defined), so it no longer keeps a Node process alive.
  - `metadata.version` reports the server's flag version on fresh and cached results, only when it is an integer; a malformed `version` or `scope` is dropped instead of failing the lookup.

- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
- 0a297ce: `defaultFor` and `isValidFlagKey` now have one definition, shared by the client and `@savvagent/sdk/server`; both entry points export the same functions, with the same signatures. `fallbackResult` from `@savvagent/sdk/server` takes an optional `{ timestamp: true }` that adds `metadata.timestamp`. `parseLanguage` and `compactContext` are no longer exported from `@savvagent/sdk/server` (the subpath is unreleased and no package used them).
- 8b34482: The telemetry flush timer no longer keeps a Node.js process alive on its own, so a build that evaluates flags server-side (for example while prerendering Astro pages) can exit without closing the client.

## 1.1.0

### Minor Changes

- Add environment support with setEnvironment/getEnvironment methods across all SDKs for dynamic environment switching at runtime.

## 1.0.1

### Patch Changes

- Updates for new API parameters

## 1.0.0

### Major Changes

- Initial Release of Savvagent SDKs

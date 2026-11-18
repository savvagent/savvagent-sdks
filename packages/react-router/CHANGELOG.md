# @savvagent/react-router

## 1.0.0

### Major Changes

- 0a297ce: `@savvagent/astro` and `@savvagent/react-router` now use the request scope shared by the server integrations, `@savvagent/sdk/server` (#26), like `@savvagent/nextjs` and `@savvagent/sveltekit`. Cookie parsing, the anonymous ID and its cookie, the request context and `user_id` rules, bounded evaluation and error throttling now have one implementation. Their own copies are removed. The exported names (`toServerConfig`, `parseCookies`, `throttleErrors`, the cookie names and timeout constants) are kept and re-export the shared ones. The anonymous ID cookie is unchanged: `savvagent_anonymous_id=anon_<uuid>`, not HttpOnly, `Path=/`, `SameSite=Lax`, one year, `Secure` on https. The `user_id` cookie is still ignored unless `trustUserIdCookie` is set, and evaluations are still bounded by `evaluationTimeoutMs`.

  `@savvagent/astro`:

  - `evaluateForRequest()` (given `{ locals: Astro.locals }`) and `createFlagMiddleware()` evaluate through the request's `Astro.locals.savvagent` when it exists, instead of building a new scope. A first-time visitor's middleware evaluations now carry the anonymous ID the integration just assigned, and the `getUserId` exported from `configModule` applies without being passed again, resolved once per request. Their own `getUserId` and `evaluationTimeoutMs` options apply only when there is no `Astro.locals.savvagent`; their `trustUserIdCookie` applies then too, and with it can only narrow (see below).
  - `createSavvagentLocals()` wraps its `reportError` option once, so a throw from it is logged instead of escaping from the timers that bound `getUserId` and evaluations.
  - `Astro.locals.savvagent` calls the client's `evaluate` for `isEnabled` and `withFlag` too (`FlagClient.isEnabled` is `evaluate().value`, so results are the same).
  - The `Cookie` header is parsed by the shared `parseCookies`. It splits on `;` with or without a following space, trims names and values, removes surrounding double quotes, and keeps the first of repeated names. Before, it split on `'; '` only, kept quotes, and the last repeated name won.
  - In `Astro.locals.savvagent` and the request helpers, a per-call context value that is `undefined`, `null` or `''` no longer clears the request's value, and `attributes` are merged one level deep. `getRequestContext(request, overrides)` keeps its behaviour: overrides replace request values as given.
  - **Breaking:** a request helper's own `trustUserIdCookie: false` now narrows trust when the helper reuses `Astro.locals.savvagent`: the call is evaluated without a `user_id` that came from the cookie (a user from `getUserId` or from the call's `context` still applies). A helper can never widen trust: `trustUserIdCookie: true` has no effect on a request whose integration does not trust the cookie.
  - `newAnonymousId()` uses Web Crypto. On Node.js 18 (supported by Astro 4 and 5), which has no global Web Crypto, it still falls back to `node:crypto`. IDs are always `anon_<uuid>`.

  `@savvagent/react-router`:

  - `@savvagent/react-router` is at 0.0.0 with its first release pending (see its own changeset), so these changes land in that first release rather than in a later one.
  - `getUserId` is bounded by `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects or times out, `forRequest()` and the middleware no longer reject. The failure goes to `onError` (`getUserId failed; evaluating without a user_id`, with the original error as its `cause`, or `getUserId timed out after <n>ms; evaluating without a user_id`), and the request is evaluated without any `user_id`, including a trusted `user_id` cookie's. A `getUserId` that returns nothing still falls back to a trusted cookie.
  - `getUserId` is resolved by the shared request scope: once per scope, and not at all when the client could not be created. `forRequest()` and the middleware still await it, so `scope.context.user_id` is final when they resolve. A `user_id` in the per-request `context` option is treated like `userId`: it is used instead of `getUserId`.

- 8b34482: Add `@savvagent/react-router`, the React Router 8 (framework mode) SDK that replaces `@savvagent/remix`. It evaluates flags on the server in loaders, actions and route middleware with a per-request context, and hydrates the results into the `@savvagent/react` provider so the first render shows real values instead of defaults. The `user_id` cookie is ignored unless `trustUserIdCookie` is set; supply the user from your own auth with `getUserId` or `forRequest(request, { userId })`. On the server, evaluations make one attempt, are bounded by `evaluationTimeoutMs` (default 1000 ms) and fall back to defaults, and `onError` reports the same error at most once a minute, so an unreachable Flags API cannot stall page loads. Peers: `react-router` >=8.5.1 <9, `react` >=19.2.7 <20; Node.js >=22.22.

### Patch Changes

- 0a297ce: Docs: use the SAVVAGENT_FLAGS_API_KEY / SAVVAGENT_FLAGS_API_URL env var names.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- f92d5f2: Defaults are read as own properties only. A flag key such as `__proto__`, `toString` or `constructor` no longer evaluates to an inherited value when the client is unavailable. It evaluates to `false`, matching `@savvagent/sdk`.
- Updated dependencies [8b34482]
- Updated dependencies [1965cc7]
- Updated dependencies [68621dd]
- Updated dependencies [0a297ce]
- Updated dependencies [0a297ce]
- Updated dependencies [8b34482]
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
  - @savvagent/react@1.2.0
  - @savvagent/sdk@1.2.0

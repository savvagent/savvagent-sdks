# @savvagent/astro

## 2.0.0

### Major Changes

- 8b34482: Support Astro 4.14 through 7 and provide `Astro.locals.savvagent`.

  - The peer range is now `astro >=4.14.0 <8` (was `>=3.0.0 <5`). The integration injects its `App.Locals` types with `injectTypes`, which Astro added in 4.14, so Astro 3.x and 4.0 to 4.13 are no longer supported. Built and tested on Astro 7.4; the example's full E2E suite also passes on Astro 4.16, 5.18 and 6.4.
  - The integration now actually provides `Astro.locals.savvagent` (`isEnabled`, `evaluate`, `withFlag`, `trackError`, `context`, `client`) on every request, with context from the request's cookies and `Accept-Language`. Previously pages that read it threw. The `SavvagentLocals` type and `createSavvagentMiddleware(config, options?)` are exported. `client` is process-wide and must not be mutated per request.
  - `Astro.locals.savvagent` ignores the `user_id` cookie by default (#23): the browser sets it, so any visitor could claim another user's targeting. Supply the user with a `getUserId({ request, locals })` function exported from the `configModule` (it runs on the request's first evaluation, so it sees what your auth middleware put in `Astro.locals`; it has its own `evaluationTimeoutMs` timer, so a request's first evaluation can take up to twice the bound, and if it throws, rejects or times out the error goes to `onError` and the request is evaluated without a `user_id`, including a trusted cookie's), or pass `user_id` in the context. The new `trustUserIdCookie: true` integration option reads the cookie again, for demos.
  - **Breaking:** `getRequestContext()`, `evaluateForRequest()` and `createFlagMiddleware()` no longer read the `user_id` cookie either, unless passed `trustUserIdCookie: true` (`getRequestContext(request, overrides, { trustUserIdCookie })`). `evaluateForRequest(request, flagKey, context, options)` and `createFlagMiddleware(config, options)` take the same `getUserId`, `trustUserIdCookie` and `evaluationTimeoutMs` options as `Astro.locals.savvagent`, and their evaluations are bounded the same way. `createFlagMiddleware` also accepts a `context` option, static or derived from the Astro context, so a forged cookie can no longer steer its redirects, rewrites or handlers.
  - Server-side evaluations are bounded. The server client makes one attempt per evaluation (`retryAttempts: 1`) and does not detect a language from the server's own locale (`disableLanguageDetection: true`) unless the config says otherwise. Each `Astro.locals.savvagent` evaluation is bounded by the new `evaluationTimeoutMs` option (default 1000 ms) and falls back to the flag's default with `reason: 'error'`, and `onError` reports the same message at most once a minute, so an unreachable Flags API cannot stall every page.
  - Visitors without a `savvagent_anonymous_id` cookie get a cryptographically random anonymous ID in the `anon_<uuid>` format the browser SDK and `@savvagent/react-router` use, set as that cookie (not HttpOnly, so the browser SDK uses the same ID; Secure over HTTPS), so they keep a stable rollout bucket on the server and in the browser. Prerendered pages read no request headers or cookies (Astro 5+); on Astro 4 prerendered pages get a fresh ID per build.
  - New `configModule` option: a module whose default export is the config, imported by the middleware at server runtime, so environment variables are read when the server starts and function options such as `onError` are kept. The inline `config` option still works but is inlined as JSON at build time and drops function options (with a warning). An inline `apiKey` now logs a warning that it is written into the server bundle; never put a server-only secret in `config`.
  - The config is validated at startup and problems are logged. If the client cannot be created, requests render with flag defaults instead of failing.
  - The server-side client is created by the middleware instead of in `astro:config:setup`, and realtime (SSE) is off on the server unless `enableRealtime: true` is set.
  - The `./middleware` entry is ESM only.

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

### Patch Changes

- 0a297ce: Harden request helpers that narrow trust with `trustUserIdCookie: false` on reused `Astro.locals.savvagent`. The narrowed scope's `context` no longer exposes a `user_id` that came from the cookie. When the reused scope is not the one the middleware created (for example a copy), the helper falls back to a fresh anonymous scope that no longer throws when the client was never initialised; it returns defaults instead. The behaviour is documented on `RequestHelperOptions`.
- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
- 8b34482: Cap peer dependency ranges at the framework majors the SDKs are built and tested against, so package managers no longer claim support for untested future majors. Lower bounds are unchanged.
- 0a297ce: Docs: use the SAVVAGENT_FLAGS_API_KEY / SAVVAGENT_FLAGS_API_URL env var names.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- f92d5f2: Defaults are read as own properties only. A flag key such as `__proto__`, `toString` or `constructor` no longer evaluates to an inherited value when the client is unavailable. It evaluates to `false`, matching `@savvagent/sdk`.
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

### Patch Changes

- Updated dependencies
  - @savvagent/sdk@1.1.0

## 1.0.1

### Patch Changes

- Updates for new API parameters
- Updated dependencies
  - @savvagent/sdk@1.0.1

## 1.0.0

### Major Changes

- Initial Release of Savvagent SDKs

### Patch Changes

- Updated dependencies
  - @savvagent/sdk@1.0.0

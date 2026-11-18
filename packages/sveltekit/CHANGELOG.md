# @savvagent/sveltekit

## 2.0.0

### Major Changes

- 0a297ce: The server helpers now use the shared request scope from `@savvagent/sdk/server` (#26), and every visitor is evaluated with their own anonymous ID.

  - **Per-visitor anonymous ID.** A visitor without a `savvagent_anonymous_id` cookie gets a new `anon_<uuid>` ID, and the cookie is set (not HttpOnly, so the browser SDK reads it; `Path=/`, `SameSite=Lax`, one year, `Secure` on https). Before, such visitors were all evaluated under the shared server client's single process-wide ID, so they landed in one rollout bucket.
    - Next.js: `createMiddleware`, `redirectIfEnabled` and `rewriteIfEnabled` set the cookie on their response and forward the new ID to the page rendered for the same request. The new `getAnonymousId(request)` and `setAnonymousIdCookie(request, response)` do the same in a middleware function of your own. Server Actions and Route Handlers set the cookie through `cookies()`; Server Components cannot set cookies, so there a new visitor keeps one ID per render until the middleware stores one. `getRequestContext` returns the visitor's anonymous ID.
    - SvelteKit: `getEventContext` and `evaluateForEvent` assign the ID once per request and set the cookie with `event.cookies.set`. If SvelteKit refuses the cookie (after a streamed response has started), the failure goes to `onError` and the request still uses the new ID.
  - **Breaking:** `getUserId` is now bounded by `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects or times out, the flag is evaluated without any `user_id`, including a trusted `user_id` cookie's, and `onError` receives `getUserId failed; evaluating without a user_id` (the original error is its `cause`) or `getUserId timed out after <n>ms; evaluating without a user_id`, instead of the original error. A `getUserId` that returns nothing still falls back to a trusted cookie.
  - **Breaking:** contexts built from the request (`createServerContext`, `getRequestContext`, `getEventContext`, and those passed to the client) leave out keys without a value instead of carrying `undefined`, `null` or `''`, and an override that is `undefined`, `null` or `''` no longer clears a request value. `language` is the first `Accept-Language` tag without its `q` weight.
  - The `user_id` cookie is still ignored unless `trustUserIdCookie` is set, and evaluations are still bounded by `evaluationTimeoutMs`. `DEFAULT_EVALUATION_TIMEOUT_MS` is still exported. The packages' internal `bounded` module is removed in favour of `@savvagent/sdk/server`.
  - A per-call `user_id` of `''`, `null` or `undefined` (for example `isEnabled(key, { user_id: '' })`) is not an explicit user: it does not skip `getUserId`, and is ignored like any other empty override.

- f8e3d0a: The server helpers no longer trust the `user_id` cookie (#23), and server-side evaluations are bounded when the Flags API is slow or down (#25), matching `@savvagent/astro` and `@savvagent/react-router`.

  - **Breaking:** `user_id` is no longer read from the `user_id` cookie by default. The browser sets that cookie, so any visitor could claim another user's ID, receive that user's targeted flags and, in Next.js middleware, steer flag-based redirects and rewrites. Supply the authenticated user with the new `getUserId` option of `initServerClient` / `initMiddlewareClient` (Next.js) or `initSvelteKitServer` (SvelteKit), or pass `user_id` in the context. Next.js Server Component helpers call `getUserId()` with no arguments, `evaluateForRequest` passes it the `Request`, and the middleware helpers pass it the `NextRequest`; SvelteKit's `evaluateForEvent` passes it the event, including `locals`. If `getUserId` throws or rejects, the error goes to `onError` and the flag is evaluated without a user. The new `trustUserIdCookie: true` option reads the cookie again, for demos. `getRequestContext` (Next.js middleware) and `getEventContext` (SvelteKit) take a `{ trustUserIdCookie }` third argument.
  - **Breaking:** the evaluation helpers no longer reject when evaluation fails. `isEnabled`, `evaluate`, `withFlag`, `evaluateForRequest`, `evaluateMultiple`, `isEnabledMultiple`, `isEnabledInMiddleware`, `redirectIfEnabled`, `rewriteIfEnabled` (Next.js) and `isEnabled`, `evaluate`, `withFlag`, `evaluateForEvent` (SvelteKit) are bounded by the new `evaluationTimeoutMs` option (default 1000 ms). On a timeout or error they resolve with the flag's default from `config.defaults` (`reason: 'error'`). `evaluateMultiple` still records the failure in `errors` and applies `defaultValues`. `withFlag` evaluates through the bounded path, so it no longer calls the client's `withFlag`. Errors thrown by its callback are tracked and re-thrown, as before.
  - The server and middleware clients make one attempt per evaluation (`retryAttempts: 1`), open no realtime (SSE) connection and do not detect a language from the server's locale, unless the config sets these. Before, a request could block for about 33 s per flag while the Flags API was down.
  - `onError` receives the same error message at most once a minute.
  - Calls on the raw client (`getServerClient()`, `getMiddlewareClient()`, the `client` argument of `createMiddleware`'s `onRequest`) get the server defaults but are not bounded by `evaluationTimeoutMs`.

### Minor Changes

- 8b34482: Build and unit-test against SvelteKit 3 and widen the `@sveltejs/kit` peer range to `>=1.0.0 <4`. The lower bound is unchanged: the package imports only the `RequestEvent` type from Kit (a type-only import erased at build), and the `cookies` and `request` members it reads exist in every Kit release in range. Svelte 4 and 5 remain supported. The unit tests mock the Kit `RequestEvent`; there is no end-to-end coverage of the server helpers yet (#29).

### Patch Changes

- 8b34482: Cap peer dependency ranges at the framework majors the SDKs are built and tested against, so package managers no longer claim support for untested future majors. Lower bounds are unchanged.
- 0a297ce: Docs: use the SAVVAGENT_FLAGS_API_KEY / SAVVAGENT_FLAGS_API_URL env var names.
- 0a297ce: Docs: the READMEs describe these packages as the Flags SDKs for savvagent-services, say that the copies on npm before this release are older than the source (and that `@savvagent/react-router` had none), and link the repository's install-from-source route. The `@savvagent/sdk` README now names the package `@savvagent/sdk` instead of `@savvagent/typescript`. The `@savvagent/nextjs` README explains moving from `middleware.ts` to Next.js 16's `proxy.ts`, and that the anonymous-ID cookie's `Secure` attribute trusts the `x-forwarded-proto` header as sent.
- 0a297ce: Fix the package's type entry points for ESM and CJS consumers (publint/attw clean).
- Updated dependencies [8b34482]
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
- Updated dependencies [8b34482]
- Updated dependencies [0a297ce]
  - @savvagent/svelte@1.1.1
  - @savvagent/sdk@1.2.0

## 1.1.0

### Minor Changes

- Add environment support with setEnvironment/getEnvironment methods across all SDKs for dynamic environment switching at runtime.

### Patch Changes

- Updated dependencies
  - @savvagent/sdk@1.1.0
  - @savvagent/svelte@1.1.0

## 1.0.1

### Patch Changes

- Updates for new API parameters
- Updated dependencies
  - @savvagent/svelte@1.0.1
  - @savvagent/sdk@1.0.1

## 1.0.0

### Major Changes

- Initial Release of Savvagent SDKs

### Patch Changes

- Updated dependencies
  - @savvagent/svelte@1.0.0
  - @savvagent/sdk@1.0.0

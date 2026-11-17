---
'@savvagent/nextjs': major
'@savvagent/sveltekit': major
---

The server helpers now use the shared request scope from `@savvagent/sdk/server` (#26), and every visitor is evaluated with their own anonymous ID.

- **Per-visitor anonymous ID.** A visitor without a `savvagent_anonymous_id` cookie gets a new `anon_<uuid>` ID, and the cookie is set (not HttpOnly, so the browser SDK reads it; `Path=/`, `SameSite=Lax`, one year, `Secure` on https). Before, such visitors were all evaluated under the shared server client's single process-wide ID, so they landed in one rollout bucket.
  - Next.js: `createMiddleware`, `redirectIfEnabled` and `rewriteIfEnabled` set the cookie on their response and forward the new ID to the page rendered for the same request. The new `getAnonymousId(request)` and `setAnonymousIdCookie(request, response)` do the same in a middleware function of your own. Server Actions and Route Handlers set the cookie through `cookies()`; Server Components cannot set cookies, so there a new visitor keeps one ID per render until the middleware stores one. `getRequestContext` returns the visitor's anonymous ID.
  - SvelteKit: `getEventContext` and `evaluateForEvent` assign the ID once per request and set the cookie with `event.cookies.set`. If SvelteKit refuses the cookie (after a streamed response has started), the failure goes to `onError` and the request still uses the new ID.
- **Breaking:** `getUserId` is now bounded by `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects or times out, the flag is evaluated without any `user_id`, including a trusted `user_id` cookie's, and `onError` receives `getUserId failed; evaluating without a user_id` (the original error is its `cause`) or `getUserId timed out after <n>ms; evaluating without a user_id`, instead of the original error. A `getUserId` that returns nothing still falls back to a trusted cookie.
- **Breaking:** contexts built from the request (`createServerContext`, `getRequestContext`, `getEventContext`, and those passed to the client) leave out keys without a value instead of carrying `undefined`, `null` or `''`, and an override that is `undefined`, `null` or `''` no longer clears a request value. `language` is the first `Accept-Language` tag without its `q` weight.
- The `user_id` cookie is still ignored unless `trustUserIdCookie` is set, and evaluations are still bounded by `evaluationTimeoutMs`. `DEFAULT_EVALUATION_TIMEOUT_MS` is still exported. The packages' internal `bounded` module is removed in favour of `@savvagent/sdk/server`.

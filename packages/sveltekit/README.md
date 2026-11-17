# @savvagent/sveltekit

SvelteKit SDK for Savvagent with server-side load functions and client-side stores.

## Installation

```bash
npm install @savvagent/sveltekit
```

## Quick Start

### Server-Side (Load Functions)

```ts
// src/hooks.server.ts
import { initSvelteKitServer } from '@savvagent/sveltekit/server';

initSvelteKitServer(
  { apiKey: process.env.SAVVAGENT_FLAGS_API_KEY! },
  // Who the request is for, from your own auth (set in your `handle` hook).
  { getUserId: (event) => event.locals?.user?.id }
);
```

```ts
// +page.server.ts
import { evaluateForEvent } from '@savvagent/sveltekit/server';

export async function load(event) {
  return { enabled: await evaluateForEvent(event, 'new-feature') };
}
```

### Client-Side (Stores)

```svelte
<!-- +layout.svelte -->
<script>
import { initSavvagent } from '@savvagent/sveltekit';

initSavvagent({
  apiKey: import.meta.env.VITE_SAVVAGENT_FLAGS_API_KEY,
});
</script>
```

```svelte
<!-- +page.svelte -->
<script>
import { createFlag } from '@savvagent/sveltekit';

const isEnabled = createFlag('client-feature');
</script>

{#if $isEnabled}
  <NewFeature />
{/if}
```

## User identity

> **The `user_id` cookie is not read by default.** The browser sets cookies, so
> any visitor can set `user_id` to another user's ID and receive that user's
> targeted flags.

`evaluateForEvent` resolves `user_id` in this order:

1. `user_id` in the context you pass.
2. The `getUserId(event)` option of `initSvelteKitServer`, for example from
   `event.locals` set by your auth hook. It is bounded by
   `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects or times
   out, the failure goes to `onError` (as
   `getUserId failed; evaluating without a user_id`, with the original error
   as `cause`, or `getUserId timed out ...`) and the flag is evaluated without
   a user, also without a trusted `user_id` cookie. If it returns nothing,
   the next source applies.
3. The `user_id` cookie, only when `trustUserIdCookie: true` is set. Use this
   for demos, or when nothing a flag gates is sensitive.

`getEventContext(event, overrides?, { trustUserIdCookie }?)` follows 1 and 3
but does not call `getUserId`. `isEnabled`, `evaluate` and `withFlag` use only
the context you pass, so pass the authenticated user's ID yourself:
`isEnabled('flag', { user_id: locals.user?.id })`.

## Anonymous visitors

`evaluateForEvent` and `getEventContext` evaluate every visitor with their own
`anonymous_id`, so percentage rollouts bucket anonymous visitors one by one
instead of all together. The ID comes from the `savvagent_anonymous_id`
cookie, the cookie the browser SDK reads, so a visitor gets the same flags on
the server and in the browser.

A visitor without the cookie gets a new `anon_<uuid>` ID, the same for the
whole request, and `event.cookies.set` stores it: not HttpOnly (the browser
SDK reads it), `Path=/`, `SameSite=Lax`, one year, and `Secure` on https. If
SvelteKit refuses the cookie (after a streamed response has started), the
failure goes to `onError` and the request still uses the new ID.

`isEnabled`, `evaluate` and `withFlag` use only the context you pass; pass
`getEventContext(event)` to them to get the same anonymous ID.

## When the Flags API is down

Server-side evaluations are bounded, so a slow or unreachable Flags API cannot
stall every page:

- The server client makes one attempt per evaluation (`retryAttempts: 1`),
  opens no realtime (SSE) connection and does not detect a language from the
  server's locale, unless your config sets these.
- `isEnabled`, `evaluate`, `withFlag` and `evaluateForEvent` are bounded by
  `evaluationTimeoutMs` (default 1000 ms). On a timeout or error they resolve
  with the flag's default from `config.defaults` (`reason: 'error'`) and do
  not throw. `getUserId` has its own bound of the same length.
- `onError` receives the same error message at most once a minute.

Calls you make on the raw client from `getServerClient()` are not bounded by
`evaluationTimeoutMs`.

## API Reference

### Server-Side (`@savvagent/sveltekit/server`)

- `initSvelteKitServer(config, options?)` - Initialize server client (first call wins). Options: `getUserId`, `trustUserIdCookie` (default `false`), `evaluationTimeoutMs` (default `1000`)
- `isEnabled(flagKey, context?)` - Check if flag is enabled
- `evaluate(flagKey, context?)` - Get detailed result
- `evaluateForEvent(event, flagKey, context?)` - Evaluate with event context
- `getEventContext(event, overrides?, options?)` - Extract context from event, assigning a new visitor an anonymous ID (see [Anonymous visitors](#anonymous-visitors))
- `withFlag(flagKey, callback, context?)` - Run `callback` only if the flag is enabled
- `trackError(flagKey, error, context?)` - Track errors

### Client-Side

All stores and functions from `@savvagent/svelte` are available.

## License

MIT

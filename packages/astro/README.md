# @savvagent/astro

Astro integration for Savvagent with server-side rendering and middleware support.

## Requirements

- Astro 4.14 or later, up to Astro 7 (`astro >=4.14.0 <8`); built and tested on Astro 7.
- An adapter (for example `@astrojs/node`) for on-demand rendered pages, so flags are evaluated per request.
- On Astro 4, which cannot tell the middleware that a page is being prerendered,
  each prerendered page is evaluated with a fresh random anonymous ID at build
  time, so percentage rollouts on prerendered pages can differ from one build
  to the next. Pass an explicit `user_id` or `anonymous_id` there if that
  matters, or use Astro 5 or later.

## Installation

```bash
npm install @savvagent/astro
```

## Quick Start

### 1. Add Integration

Put the client config in a module and point the integration at it with
`configModule`. The middleware imports that module at server runtime, so
environment variables are read when the server starts (not baked in at
`astro build`) and function options such as `onError` are kept.

```js
// src/savvagent.config.mjs
export default {
  apiKey: process.env.SAVVAGENT_SDK_KEY,
  applicationId: process.env.SAVVAGENT_APP_ID,
  onError: (error) => console.error('[Savvagent]', error),
};
```

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import savvagent from '@savvagent/astro';

export default defineConfig({
  integrations: [savvagent({ configModule: './src/savvagent.config.mjs' })],
});
```

`configModule` is resolved against the project root. You can pass the config
inline instead, with `savvagent({ config: { apiKey: process.env.SAVVAGENT_SDK_KEY } })`,
but then it is serialized as JSON into the server bundle: values are fixed when
the Astro config is loaded (at `astro build` for production), the `apiKey` is
written into the built files, and function options are dropped. The
integration warns about both.

> **Warning:** never put a server-only secret in `config`. Everything in it is
> written into the server bundle. Use `configModule` and read secrets from the
> environment at server runtime.

The integration checks the config at startup and reports a missing or invalid
`apiKey` with Astro's logger. If the client cannot be created, requests still
render and `Astro.locals.savvagent` returns flag defaults.

The integration registers middleware that creates one server-side client and
provides `Astro.locals.savvagent` on every request. It also injects the
`App.Locals` types, so `Astro.locals.savvagent` is typed once `astro sync` (or
`astro dev`) has run. Realtime updates are off on the server unless you set
`enableRealtime: true`.

#### Identifying the user

`user_id` comes from, in order of precedence:

1. The `context` you pass to a method, for example `{ user_id: session.userId }`.
2. A `getUserId({ request, locals })` function exported from your `configModule`.
   It runs once per request, on the first evaluation, so it can read a user that
   your own auth middleware stored in `Astro.locals`. It is bounded by
   `evaluationTimeoutMs`. If it throws, rejects or times out, the error goes to
   `onError` (throttled) and the request is evaluated without a `user_id`.
   Because it runs on the first evaluation, `trackError()` called before any
   evaluation in a request carries no `user_id`; pass one in its context if
   you need it. The integration checks whether the module exports `getUserId`
   when the server starts, so after adding the export during `astro dev`,
   restart the dev server.
3. The `user_id` cookie, only with `trustUserIdCookie: true`.

With both `getUserId` and `trustUserIdCookie`, the two ways `getUserId` can
come back empty are treated differently:

- It returns nothing (`undefined`, `null` or `''`): no user from your auth, so
  the trusted `user_id` cookie is used.
- It throws, rejects or times out: your auth could not answer, so the request
  is evaluated without any `user_id`, not even the cookie's. Once `getUserId`
  is configured it decides who the user is, and a failure falls back to the
  least privileged identity.

The `reportError` you pass to `createSavvagentLocals` yourself is wrapped so
that a throw from it is logged, never thrown out of the timers that bound
`getUserId` and each evaluation.

```js
// src/savvagent.config.mjs
export default { apiKey: process.env.SAVVAGENT_SDK_KEY };
export function getUserId({ locals }) {
  return locals.user?.id;
}
```

> **Warning:** the `user_id` cookie is set by the browser, so any visitor can
> claim any user's ID and receive that user's targeted flags (#23). It is
> ignored by default. Enable `trustUserIdCookie` only for demos, or when nothing
> gated by a flag is sensitive.

```ts
// Demo only: trust the browser's user_id cookie.
savvagent({ configModule: './src/savvagent.config.mjs', trustUserIdCookie: true });
```

The `getRequestContext()`, `evaluateForRequest()` and `createFlagMiddleware()`
helpers follow the same rules: they ignore the `user_id` cookie unless you pass
`trustUserIdCookie: true` (see their sections below).

#### Evaluation on the server

When `getUserId` is configured it has its own timer of the same length, so the
first evaluation of a request can take up to twice `evaluationTimeoutMs`.

The server-side client makes one attempt per evaluation (`retryAttempts: 1`),
does not detect a language from the server's own locale
(`disableLanguageDetection: true`) and opens no realtime connection, unless your
config says otherwise. Each `Astro.locals.savvagent` evaluation is bounded by
the `evaluationTimeoutMs` integration option (default 1000): when the Flags API
is slow or down, it resolves with the flag's default (`reason: 'error'`) instead
of holding up the page. `onError` (default `console.error`) hears about the same
error message at most once a minute.

The bound applies to each evaluation, not to the page: evaluations awaited one
after another add up, while evaluations started together with `Promise.all`
cost about one bound.

#### Anonymous ID

Visitors without a `savvagent_anonymous_id` cookie get a new random ID (`anon_<uuid>`, the same format as the browser SDK), set as
that cookie (`SameSite=Lax`, `Secure` over HTTPS, one year), so each visitor
keeps a stable rollout bucket. The cookie is deliberately not `HttpOnly`: the
browser SDK (`@savvagent/sdk` and the framework SDKs built on it) reads it and
uses the same anonymous ID, so server-rendered and client-side evaluations put
a visitor in the same bucket. It holds only a random ID. On prerendered pages
no request headers or cookies are read (Astro 5 and later).

### 2. Use in Astro Components

```astro
---
// Context from the request (the `session_id` and `savvagent_anonymous_id`
// cookies, Accept-Language, and the user from getUserId) is merged in;
// values you pass win.
const showNewLayout = await Astro.locals.savvagent.isEnabled('new-layout', {
  attributes: { plan: 'pro' },
});
---

{showNewLayout ? (
  <NewLayout />
) : (
  <OldLayout />
)}
```

## API Reference

### `Astro.locals.savvagent`

Available in pages, endpoints and your own middleware:

| Member | Description |
| --- | --- |
| `isEnabled(flagKey, context?)` | `Promise<boolean>` |
| `evaluate(flagKey, context?)` | `Promise<FlagEvaluationResult>` |
| `withFlag(flagKey, callback, context?)` | Runs `callback` when the flag is on, else returns `null` |
| `trackError(flagKey, error, context?)` | Reports an error with flag context |
| `context` | The `FlagContext` derived from the request |
| `client` | The process-wide `FlagClient` (`null` if it could not be created) |

`client` is shared by every request in the server process. Never mutate it
per request (`setUserId`, `setOverride`, `setEnvironment`, ...): that would
change results for all visitors. Pass per-request context to the methods
instead.

The type is exported as `SavvagentLocals`. If you compose middleware yourself
instead of using the integration, `createSavvagentMiddleware(config, options?)`
returns the same middleware; `options` takes `trustUserIdCookie`, `getUserId`
and `evaluationTimeoutMs`.

### Integration options

| Option | Description |
| --- | --- |
| `configModule` | Module whose default export is the client config, imported at server runtime. May also export `getUserId`. |
| `config` | Inline client config, serialized as JSON into the server bundle. |
| `trustUserIdCookie` | Read `user_id` from the `user_id` cookie (default `false`). Demos only. |
| `evaluationTimeoutMs` | Upper bound on one evaluation, in milliseconds (default `1000`). |

### Server-Side Functions

These use the same process-wide client as `Astro.locals.savvagent` (when imported as ESM, as Astro does), without request context.

#### `isEnabled(flagKey, context?)`

Check if a flag is enabled.

```astro
---
import { isEnabled } from '@savvagent/astro';

const enabled = await isEnabled('my-feature');
---
```

#### `evaluate(flagKey, context?)`

Get detailed evaluation result.

```astro
---
import { evaluate } from '@savvagent/astro';

const result = await evaluate('premium-features');
const { value, reason, metadata } = result;
---
```

#### `withFlag(flagKey, callback, context?)`

Execute code conditionally.

```astro
---
import { withFlag } from '@savvagent/astro';

const data = await withFlag('use-new-api', async () => {
  return await fetchFromNewAPI();
});
---
```

#### `evaluateForRequest(request, flagKey, context?, options?)`

Evaluate with automatic request context. Pass `{ locals: Astro.locals }` as
`options`: the evaluation then goes through the request's
`Astro.locals.savvagent`, with its anonymous ID (also for a first-time visitor,
whose cookie the integration has just set), the integration's `getUserId`
(resolved once per request) and its `trustUserIdCookie` and
`evaluationTimeoutMs`. `context` is merged over it as in
`Astro.locals.savvagent`.

Without `Astro.locals.savvagent` (no integration, or a middleware that runs
before it), `options` takes the same options as `Astro.locals.savvagent`
(`getUserId`, `trustUserIdCookie` and `evaluationTimeoutMs`), and a new scope is
built from the request alone: it assigns no anonymous ID. Either way the
evaluation is bounded and falls back to the flag's default.

```astro
---
import { evaluateForRequest } from '@savvagent/astro';

const showBeta = await evaluateForRequest(Astro.request, 'beta-ui', undefined, {
  locals: Astro.locals,
});
---
```

> **Warning:** the `user_id` cookie is read only with `trustUserIdCookie: true`.
> The browser sets it, so any visitor can claim another user's targeting (#23).

`getRequestContext(request, overrides?, { trustUserIdCookie? })` returns the
context these helpers derive from a request. It is synchronous, so it cannot
call `getUserId`; pass the authenticated user in `overrides`. It reads the
`user_id` cookie only with `trustUserIdCookie: true`.

### Middleware

Create middleware for flag-based routing:

```ts
// src/middleware.ts
import { sequence } from 'astro/middleware';
import { createFlagMiddleware } from '@savvagent/astro';

const flagMiddleware = createFlagMiddleware(
  {
    'maintenance-mode': {
      redirect: '/maintenance',
    },
    'beta-access': {
      rewrite: (url) => '/beta' + url.pathname,
    },
  },
  // Who the visitor is, from your own auth.
  { getUserId: ({ locals }) => locals.user?.id }
);

export const onRequest = sequence(flagMiddleware);
```

When the integration is installed, its middleware runs first, and
`createFlagMiddleware` evaluates through `context.locals.savvagent`: the same
anonymous ID (a first-time visitor's included), and the `getUserId` from your
`configModule`, resolved once per request for the middleware and the page
alike. You don't pass `getUserId` again.

The second argument takes `context`: extra context for every evaluation, or a
function of the Astro context that returns it, such as
`({ locals }) => ({ user_id: locals.user?.id })`. It also takes `getUserId`,
`trustUserIdCookie` and `evaluationTimeoutMs`, which apply only when there is
no `context.locals.savvagent`. Each evaluation is bounded and falls back to the
flag's default.

> **Warning:** the `user_id` cookie is read only with `trustUserIdCookie: true`.
> The browser sets it, so with it any visitor could steer redirects, rewrites
> and handlers gated on another user's flags (#23).

## Using with UI Frameworks

Astro supports multiple UI frameworks. Use the appropriate SDK in your islands:

### React Islands

```astro
---
// Import server-side
import { isEnabled } from '@savvagent/astro';
const serverFlag = await isEnabled('ssr-feature');
---

<!-- Client-side React island -->
<ReactComponent client:load>
  {/* Use @savvagent/react hooks inside */}
</ReactComponent>
```

### Vue Islands

```astro
<VueComponent client:load>
  {/* Use @savvagent/vue composables inside */}
</VueComponent>
```

## License

MIT

# @savvagent/react-router

React Router 8 SDK for [Savvagent](https://savvagent.com) feature flags, for apps in **framework mode**.

- Evaluate flags on the server in **loaders**, **actions** and **route middleware**, with a context built from each request.
- Hydrate the server's results into the React provider, so server rendering and the first client render show real flag values, not a flash of defaults.
- Use the hooks from [`@savvagent/react`](../react) (`useFlag`, `useFlags`, `useUser`, `useTrackError`, ...) on the client. They are re-exported from this package.

This package replaces `@savvagent/remix`: Remix is now React Router. See [Migrating from @savvagent/remix](#migrating-from-savvagentremix).

## Requirements

- `react-router` 8.5.1 or later (8.x), in framework mode with server rendering
- `react` and `react-dom` 19.2.7 or later (19.x)
- Node.js 22.22 or later (React Router 8's own requirement)

## Installation

```bash
npm install @savvagent/react-router
# or
pnpm add @savvagent/react-router
```

## Setup

### 1. Create the server integration

Create it once, in a server-only module. React Router keeps `.server` modules out of the browser bundle.

```ts
// app/savvagent.server.ts
import { createSavvagentServer } from '@savvagent/react-router';
import { getSession } from './sessions.server';

export const savvagent = createSavvagentServer(
  {
    apiKey: process.env.SAVVAGENT_SDK_KEY!,
    applicationId: 'your-application-id',
    defaults: { 'new-checkout': false },
  },
  {
    // Context for every evaluation (per-request values win).
    defaultContext: { environment: 'production' },
    // The signed-in user, from your own auth.
    getUserId: async ({ request }) => {
      const session = await getSession(request.headers.get('Cookie'));
      return session.get('userId');
    },
  }
);
```

All requests share one `FlagClient`. This is safe because the client's cache is keyed by the evaluation context. Each request's user, anonymous ID, language and attributes are passed with each evaluation, and no request writes them to the shared client.

### 2. Add the middleware and evaluate flags in the root loader

```tsx
// app/root.tsx
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { SavvagentProvider, getSavvagent } from '@savvagent/react-router';
import type { Route } from './+types/root';
import { savvagent } from './savvagent.server';

// Creates the per-request scope for all loaders and actions, and sets the
// anonymous ID cookie for new visitors.
export const middleware: Route.MiddlewareFunction[] = [savvagent.middleware];

export async function loader({ context }: Route.LoaderArgs) {
  const flags = await getSavvagent(context).evaluateFlags(['new-checkout', 'beta-banner']);
  return { flags };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <SavvagentProvider
      config={{ apiKey: 'sdk_your_public_key', applicationId: 'your-application-id' }}
      defaultContext={{ environment: 'production' }}
      flags={loaderData.flags}
    >
      <Outlet />
    </SavvagentProvider>
  );
}
```

### 3. Read flags in components

```tsx
import { useFlag } from '@savvagent/react-router';

export function Checkout() {
  // Server-rendered with the loader's value; no loading state, no flash.
  const { value: newCheckout } = useFlag('new-checkout');
  return newCheckout ? <NewCheckout /> : <LegacyCheckout />;
}
```

## How hydration works

`<SavvagentProvider flags>` holds the results that the loader evaluated. `useFlag` and `useFlags` from this package wrap the `@savvagent/react` hooks:

1. Until the browser client has evaluated a flag, they return the server's result with `loading: false`. The server render and the hydration render therefore match, and both show real values.
2. When the browser client exists, a local override (`client.setOverride`, `initialOverrides`) takes effect at once, as it does in `client.evaluate`.
3. After the browser client's first evaluation, they return the live `@savvagent/react` result, which includes realtime updates and override changes.
4. If the browser's evaluation of a flag fails (`reason: 'error'`, for example when an ad blocker, CSP or CORS blocks the request), the hooks keep the server's value for that flag instead of switching to the default. Local overrides still win.

`useFlags` uses hydrated values only when every requested key was hydrated. Results the server failed to evaluate (`reason: 'error'`) are not hydrated. In both cases the hooks behave like plain `@savvagent/react` hooks and start in `loading: true`. To read the raw server results, for example to show "server value" next to an override, use `useHydratedFlags()`.

To keep the server and the browser consistent, evaluate with the same context on both sides: the same `applicationId`, `environment` and attributes. The anonymous ID cookie set by the middleware (`savvagent_anonymous_id`) is read by the browser SDK, so anonymous visitors land in the same rollout bucket on both sides.

## Usage

### Loaders

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const savvagent = getSavvagent(context);

  // Boolean
  const showBeta = await savvagent.isEnabled('beta-banner');

  // Detailed result (value, reason, metadata such as variation and configuration)
  const pricing = await savvagent.evaluate('pricing-v2', { attributes: { plan: 'pro' } });

  // Several flags at once, for <SavvagentProvider flags>
  const flags = await savvagent.evaluateFlags(['new-checkout', 'beta-banner']);

  return { showBeta, pricing, flags };
}
```

### Actions

```ts
export async function action({ request, context }: Route.ActionArgs) {
  const savvagent = getSavvagent(context);
  const form = await request.formData();

  // Runs the callback only if the flag is on. Errors it throws are tracked
  // against the flag, then re-thrown.
  const result = await savvagent.withFlag('new-order-processor', () => processOrder(form));
  if (result !== null) return result;

  try {
    return await legacyProcessOrder(form);
  } catch (error) {
    savvagent.trackError('new-order-processor', error as Error);
    throw error;
  }
}
```

### Without the middleware

`forRequest` creates the same request scope directly. Return its `headers` from the loader, so new visitors get the anonymous ID cookie:

```ts
import { data } from 'react-router';
import { savvagent } from '~/savvagent.server';

export async function loader({ request }: Route.LoaderArgs) {
  const scope = await savvagent.forRequest(request, { userId: await requireUserId(request) });
  return data({ flags: await scope.evaluateFlags(['new-checkout']) }, { headers: scope.headers });
}
```

### Other client hooks

`useSavvagent`, `useWithFlag`, `useUser`, `useTrackError` and `useEnvironment` are the `@savvagent/react` hooks, re-exported unchanged. See the [@savvagent/react README](../react/README.md).

## User identity and security

The evaluation `user_id` decides user targeting and percentage rollouts, so take it from a source the visitor cannot forge. In order of precedence:

1. `forRequest(request, { userId })`: an explicit ID from your own auth.
2. `getUserId({ request, context })`: called once for every request scope. `context` is the router context when it runs in the middleware, so it can read a user that your auth middleware stored there. It is bounded by `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects or times out, the request scope is still created: the failure goes to `onError` (`getUserId failed; evaluating without a user_id`, with the original error as its `cause`, or `getUserId timed out after <n>ms; evaluating without a user_id`) and the request is evaluated without any `user_id`, a trusted cookie's included. If it returns nothing, a trusted `user_id` cookie is used.
3. The `user_id` cookie, only with `trustUserIdCookie: true`.

> **Warning:** the `user_id` cookie is set by the browser, so any visitor can claim any user's ID and receive that user's targeted flags. It is ignored by default. Enable `trustUserIdCookie` only for demos, or when nothing gated by a flag is sensitive.

Visitors are also identified by the `savvagent_anonymous_id` cookie. When it is missing, the server assigns a new random ID and the middleware sets the cookie (`Path=/`, `SameSite=Lax`, one year, `Secure` on HTTPS). The cookie is not `HttpOnly`, because the browser SDK reads it. Set `setAnonymousIdCookie: false` to turn the cookie off. `session_id` comes from the `session_id` cookie and `language` from `Accept-Language`.

Never mutate the shared client per request (`setUserId`, `setOverride`, `setEnvironment`): those change it for every request in the process. Pass context instead.

## API reference

### `createSavvagentServer(config, options?)`

`config` is a [`FlagClientConfig`](../typescript/README.md). Returns a `SavvagentServer`.

The server applies these defaults, so a slow or unreachable Flags API cannot stall page loads or flood the logs:

| Setting | Server default | Why |
|---|---|---|
| `config.retryAttempts` | `1` (the browser SDK default is 3, with backoff) | A page waits on these evaluations, so there are no retries. |
| `evaluationTimeoutMs` (option) | `1000` | Each evaluation resolves with the flag's default (`reason: 'error'`) after this many milliseconds. `getUserId` has the same bound, so creating a request scope with a hanging `getUserId` takes at most this long. |
| `config.onError` | Called at most once per 60 seconds for the same error message | When the API is down, every request fails the same way. Without `onError`, errors go to `console.error`. |
| `config.enableRealtime` | `false` | No SSE connection from the server. |
| `config.disableLanguageDetection` | `true` | `language` comes from `Accept-Language`, not the server's locale. |

The bound applies to each evaluation, not to the page: evaluations awaited one after another add up, while `evaluateFlags` (or `Promise.all`) runs them in parallel and costs about one bound.

When evaluation fails or times out, loaders still resolve: `evaluate` and `evaluateFlags` return `config.defaults` (or `false`) with `reason: 'error'`, and these results are not hydrated.

`SavvagentServer` members:

| Member | Description |
|---|---|
| `middleware` | Route middleware: creates the request scope, stores it for `getSavvagent`, and adds the anonymous ID cookie to the response. |
| `forRequest(request, { userId?, context? })` | Returns a `Promise<SavvagentRequest>` scope for one request. |
| `getRequestContext(request, overrides?)` | The context read from the request's cookies and headers, over `defaultContext`. It does not include the user from `getUserId`. |
| `client` | The shared `FlagClient`, created on first use. `null` if it could not be created (for example a missing API key); evaluations then return `config.defaults`. |
| `close()` | Closes the shared client. |

Options: `defaultContext`, `getUserId`, `trustUserIdCookie` (default `false`), `setAnonymousIdCookie` (default `true`), `evaluationTimeoutMs` (default `1000`).

### `SavvagentRequest`

| Member | Description |
|---|---|
| `isEnabled(flagKey, context?)` | `Promise<boolean>` |
| `evaluate(flagKey, context?)` | `Promise<FlagEvaluationResult>` |
| `evaluateFlags(flagKeys, context?)` | `Promise<SavvagentFlags>` (results keyed by flag key), for `<SavvagentProvider flags>` |
| `withFlag(flagKey, callback, context?)` | Runs `callback` if the flag is on (using the same bounded evaluation). Errors are tracked, then re-thrown. Returns `null` when the flag is off. |
| `trackError(flagKey, error, context?)` | Reports an error against a flag. |
| `context` | The request's evaluation context. |
| `headers` | `Set-Cookie` headers for the response, if any. |

The context you pass to a method is merged over the request's context (`attributes` are merged key by key).

### `getSavvagent(context)`

Returns the request scope that the middleware stored in the router context. Throws if the middleware is not installed.

### Client

- `SavvagentProvider`: the `@savvagent/react` provider, with an extra `flags` prop.
- `useFlag`, `useFlags`: the `@savvagent/react` hooks, starting from hydrated values.
- `useHydratedFlags()`: the raw `flags` passed to the provider.

## Migrating from @savvagent/remix

| `@savvagent/remix` | `@savvagent/react-router` |
|---|---|
| `initRemixClient(config)` at module level | `export const savvagent = createSavvagentServer(config, options)` in `app/savvagent.server.ts` |
| `getRemixClient()` | `savvagent.client` |
| `getRequestContext(request, overrides)` | `savvagent.getRequestContext(request, overrides)`, or `getSavvagent(context).context` |
| `isEnabled(key, context)` in a loader | `getSavvagent(context).isEnabled(key)` (the request context is applied for you) |
| `evaluate`, `withFlag`, `trackError` | The same methods on `getSavvagent(context)` or `await savvagent.forRequest(request)` |
| `evaluateForRequest(request, key)` | `(await savvagent.forRequest(request)).isEnabled(key)` |
| `setEnvironment(env)` / `getEnvironment()` | Set `environment` in `config` or `defaultContext`, or pass it per call. Changing it on the shared client would affect every request. |
| `json({ enabled })` | Return plain objects, or `data(...)` from `react-router` for headers |
| `@remix-run/react` hooks via `@savvagent/remix` | Import the hooks from `@savvagent/react-router` |

Behavior changes:

- **`user_id` cookie.** `@savvagent/remix` read `user_id` from a cookie. This package ignores that cookie unless you set `trustUserIdCookie: true`. Supply the user with `getUserId` or `forRequest(request, { userId })` instead.
- **No flash on hydration.** Pass the loader's `evaluateFlags` result to `<SavvagentProvider flags>`. Components then render server values from the first paint, where before they started from defaults.
- **Anonymous ID.** Visitors without a `savvagent_anonymous_id` cookie get one, so the server and the browser bucket them the same way.

Upgrade the app itself with React Router's [Remix upgrade guide](https://reactrouter.com/upgrading/remix), then replace `@savvagent/remix` with this package.

## License

MIT

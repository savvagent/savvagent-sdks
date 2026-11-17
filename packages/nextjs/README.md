# @savvagent/nextjs

Next.js SDK for Savvagent with full App Router support, including Server Components, Client Components, Middleware, and Server Actions.

## Installation

```bash
npm install @savvagent/nextjs
# or
pnpm add @savvagent/nextjs
# or
yarn add @savvagent/nextjs
```

## Quick Start

### 1. Initialize Server Client

```tsx
// app/layout.tsx
import { initServerClient } from '@savvagent/nextjs/server';
import { auth } from '@/auth'; // your auth library

initServerClient(
  {
    apiKey: process.env.SAVVAGENT_API_KEY!,
    applicationId: process.env.SAVVAGENT_APP_ID,
  },
  // Who the request is for, from your own auth (see "User identity" below).
  { getUserId: async () => (await auth())?.user?.id }
);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### 2. Client Components

```tsx
// app/components/feature.tsx
'use client';

import { useFlag } from '@savvagent/nextjs/client';

export function Feature() {
  const { value, loading } = useFlag('new-feature');

  if (loading) return <div>Loading...</div>;

  return value ? <NewFeature /> : <OldFeature />;
}
```

### 3. Server Components

```tsx
// app/page.tsx
import { isEnabled } from '@savvagent/nextjs/server';

export default async function Page() {
  const enabled = await isEnabled('new-layout');

  return enabled ? <NewLayout /> : <OldLayout />;
}
```

### 4. Middleware

```ts
// middleware.ts
import { initMiddlewareClient, createMiddleware, isEnabledInMiddleware } from '@savvagent/nextjs/middleware';
import { NextResponse } from 'next/server';

initMiddlewareClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});

export default createMiddleware({
  async onRequest(request) {
    const maintenance = await isEnabledInMiddleware(request, 'maintenance-mode');

    if (maintenance) {
      return NextResponse.rewrite(new URL('/maintenance', request.url));
    }
  },
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

> **Next.js 16:** the `middleware.ts` file convention is deprecated in favor of `proxy.ts` (export a function named `proxy`, or a default export). The helpers in `@savvagent/nextjs/middleware` take a `NextRequest` and return a `NextResponse`, so they work unchanged from either file. `proxy.ts` runs on the Node.js runtime; the Edge runtime is not available there.

## User identity

> **The `user_id` cookie is not read by default.** The browser sets cookies, so
> any visitor can set `user_id` to another user's ID and receive that user's
> targeted flags (and, in middleware, steer flag-based redirects and rewrites).

Supply the authenticated user from your own auth instead. The server and
middleware helpers resolve `user_id` in this order:

1. `user_id` in the context you pass to the helper.
2. The `getUserId` option of `initServerClient` / `initMiddlewareClient`.
   For Server Components it takes no arguments and can call `cookies()`,
   `headers()` or your auth library; `evaluateForRequest` passes it the
   `Request`, and the middleware helpers pass it the `NextRequest`. It is
   bounded by `evaluationTimeoutMs` (default 1000 ms). If it throws, rejects
   or times out, the failure goes to `onError` (as
   `getUserId failed; evaluating without a user_id`, with the original error
   as `cause`, or `getUserId timed out ...`) and the flag is evaluated without
   a user, also without a trusted `user_id` cookie. If it returns nothing,
   the next source applies.
3. The `user_id` cookie, only when `trustUserIdCookie: true` is set. Use this
   for demos, or when nothing a flag gates is sensitive.

`session_id` and `language` are read from the request.

## Anonymous visitors

Every visitor is evaluated with their own `anonymous_id`, so percentage
rollouts bucket anonymous visitors one by one instead of all together. The ID
comes from the `savvagent_anonymous_id` cookie, the cookie the browser SDK
reads, so a visitor gets the same flags from Server Components and from
Client Components.

A visitor without the cookie gets a new `anon_<uuid>` ID, which is stored in
the cookie: not HttpOnly (the browser SDK reads it), `Path=/`,
`SameSite=Lax`, one year, and `Secure` on https. Where it is stored:

- **Middleware** (recommended): `createMiddleware`, `redirectIfEnabled` and
  `rewriteIfEnabled` set the cookie on their response, and forward the new ID
  to the page rendered for the same request. In a middleware function of your
  own, `getAnonymousId(request)` returns the ID and
  `setAnonymousIdCookie(request, response)` sets the cookie on the response
  you return.
- **Server Actions and Route Handlers**: the server helpers set the cookie
  through `cookies()`.
- **Server Components** cannot set cookies. Without the middleware, a new
  visitor keeps one ID for the whole render, and gets the cookie from the
  middleware or a later Server Action.

## When the Flags API is down

Server-side evaluations are bounded, so a slow or unreachable Flags API cannot
stall every page:

- The server and middleware clients make one attempt per evaluation
  (`retryAttempts: 1`), open no realtime (SSE) connection and do not detect a
  language from the server's locale, unless your config sets these.
- Each evaluation by `isEnabled`, `evaluate`, `withFlag`, `evaluateForRequest`,
  `evaluateMultiple`, `isEnabledInMiddleware`, `redirectIfEnabled` and
  `rewriteIfEnabled` is bounded by `evaluationTimeoutMs` (default 1000 ms). On a
  timeout or error it resolves with the flag's default from `config.defaults`
  (`reason: 'error'`) and does not throw. `getUserId` has its own bound of the
  same length.
- `onError` receives the same error message at most once a minute.

Calls you make on the raw client (`getServerClient()`, `getMiddlewareClient()`,
or the `client` passed to `createMiddleware`'s `onRequest`) are not bounded by
`evaluationTimeoutMs`.

## API Reference

### Server Components

#### `initServerClient(config, options?)`

Initialize the server-side client. Call once in your root layout. Only the
first call takes effect.

```tsx
import { initServerClient } from '@savvagent/nextjs/server';

initServerClient(
  {
    apiKey: process.env.SAVVAGENT_API_KEY!,
    applicationId: process.env.SAVVAGENT_APP_ID,
    baseUrl: process.env.SAVVAGENT_BASE_URL,
  },
  {
    getUserId: async () => (await auth())?.user?.id,
    evaluationTimeoutMs: 1000,
  }
);
```

| Option | Default | |
| --- | --- | --- |
| `getUserId` | none | Returns the authenticated user's ID. See [User identity](#user-identity). |
| `trustUserIdCookie` | `false` | Read `user_id` from the `user_id` cookie. Demos only. |
| `evaluationTimeoutMs` | `1000` | Upper bound on one evaluation. See [When the Flags API is down](#when-the-flags-api-is-down). |

#### `isEnabled(flagKey, context?)`

Check if a flag is enabled in a Server Component.

```tsx
import { isEnabled } from '@savvagent/nextjs/server';

export default async function Page() {
  const enabled = await isEnabled('premium-features', {
    user_id: 'user123',
    attributes: { plan: 'pro' },
  });

  return <div>{enabled ? 'Premium' : 'Standard'}</div>;
}
```

#### `evaluate(flagKey, context?)`

Get detailed flag evaluation result.

```tsx
import { evaluate } from '@savvagent/nextjs/server';

export default async function Page() {
  const result = await evaluate('beta-feature');

  console.log({
    value: result.value,
    reason: result.reason, // 'cached' | 'evaluated' | 'default' | 'error'
    metadata: result.metadata,
  });

  return <Component enabled={result.value} />;
}
```

#### `withFlag(flagKey, callback, context?)`

Execute code conditionally based on flag value.

```tsx
import { withFlag } from '@savvagent/nextjs/server';

export default async function Page() {
  const data = await withFlag('use-new-api', async () => {
    return await fetchFromNewAPI();
  });

  // data is null if flag is disabled
  return data ? <NewView data={data} /> : <OldView />;
}
```

#### `createServerContext(overrides?)`

Create a context object from the Next.js request: `anonymous_id` and `session_id` from cookies, `language` from `Accept-Language`, and `user_id` as described in [User identity](#user-identity).

```tsx
import { createServerContext, isEnabled, getServerClient } from '@savvagent/nextjs/server';

export default async function Page() {
  const context = await createServerContext({
    attributes: { plan: 'enterprise' },
  });

  const client = getServerClient();
  const enabled = await client.isEnabled('enterprise-features', context);

  return <div>...</div>;
}
```

### Client Components

Use the `'use client'` directive and import from `@savvagent/nextjs/client`:

```tsx
'use client';

import {
  SavvagentProvider,
  useFlag,
  useSavvagent,
  useUser,
  useTrackError,
} from '@savvagent/nextjs/client';
```

All client-side APIs are the same as `@savvagent/react`. See the [@savvagent/react documentation](../react/README.md) for details.

#### Example: Wrap Client-Side App

```tsx
// app/providers.tsx
'use client';

import { SavvagentProvider } from '@savvagent/nextjs/client';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SavvagentProvider
      config={{
        apiKey: process.env.NEXT_PUBLIC_SAVVAGENT_API_KEY!,
        enableRealtime: true,
      }}
    >
      {children}
    </SavvagentProvider>
  );
}
```

```tsx
// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

### Route Handlers

#### `evaluateForRequest(request, flagKey, context?)`

Evaluate flags in API routes with request context.

```tsx
// app/api/data/route.ts
import { evaluateForRequest } from '@savvagent/nextjs/server';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const useNewAPI = await evaluateForRequest(request, 'new-api-version');

  const data = useNewAPI
    ? await fetchFromNewAPI()
    : await fetchFromOldAPI();

  return Response.json(data);
}
```

### Server Actions

```tsx
// app/actions.ts
'use server';

import { isEnabled, trackError } from '@savvagent/nextjs/server';

export async function submitForm(formData: FormData) {
  const useNewValidation = await isEnabled('new-validation');

  try {
    if (useNewValidation) {
      await validateWithNewLogic(formData);
    } else {
      await validateWithOldLogic(formData);
    }
  } catch (error) {
    await trackError('new-validation', error as Error);
    throw error;
  }
}
```

### Middleware

#### `initMiddlewareClient(config, options?)`

Initialize the middleware client. It takes the same options as
`initServerClient`, except that `getUserId` receives the `NextRequest`
(for example to verify a session token).

```ts
import { initMiddlewareClient } from '@savvagent/nextjs/middleware';

initMiddlewareClient(
  { apiKey: process.env.SAVVAGENT_API_KEY! },
  { getUserId: async (request) => (await verifySession(request.cookies.get('session')?.value))?.userId }
);
```

`getRequestContext(request, overrides?, { trustUserIdCookie }?)` reads the
`user_id` cookie only when `trustUserIdCookie` is set, and does not call
`getUserId`. Its `anonymous_id` is the visitor's (see
[Anonymous visitors](#anonymous-visitors)).

`getAnonymousId(request)` returns the visitor's anonymous ID: the cookie's, or
the new one assigned to this request. `setAnonymousIdCookie(request, response)`
adds the cookie for a newly assigned ID to `response` and returns it (or a
copy, when the response's headers are immutable); it does nothing for a
returning visitor.

#### `createMiddleware(config)`

Create a middleware function with custom logic. `onRequest` also receives the
raw client as its second argument; its calls are not bounded by
`evaluationTimeoutMs`, so prefer `isEnabledInMiddleware`. The response
(`onRequest`'s, or `NextResponse.next()`) sets the anonymous ID cookie for a
new visitor.

```ts
import { createMiddleware, isEnabledInMiddleware } from '@savvagent/nextjs/middleware';
import { NextResponse } from 'next/server';

export default createMiddleware({
  async onRequest(request) {
    const maintenance = await isEnabledInMiddleware(request, 'maintenance-mode');
    if (maintenance) {
      return NextResponse.rewrite(new URL('/maintenance', request.url));
    }
  },
});
```

#### `redirectIfEnabled(request, flagKey, redirectUrl, context?)`

Redirect users when a flag is enabled.

```ts
import { redirectIfEnabled } from '@savvagent/nextjs/middleware';

export async function middleware(request: NextRequest) {
  const redirect = await redirectIfEnabled(
    request,
    'force-upgrade',
    '/upgrade'
  );
  if (redirect) return redirect;
}
```

#### `rewriteIfEnabled(request, flagKey, rewriteUrl, context?)`

Rewrite requests when a flag is enabled (useful for A/B testing).

```ts
import { rewriteIfEnabled } from '@savvagent/nextjs/middleware';

export async function middleware(request: NextRequest) {
  const rewrite = await rewriteIfEnabled(
    request,
    'beta-ui',
    '/beta' + request.nextUrl.pathname
  );
  if (rewrite) return rewrite;
}
```

## Usage Patterns

### SSR with User Context

```tsx
// app/dashboard/page.tsx
import { isEnabled } from '@savvagent/nextjs/server';
import { auth } from '@/auth'; // your auth library

export default async function DashboardPage() {
  // Use the authenticated user, never a cookie the browser can set.
  const session = await auth();

  const showNewDashboard = await isEnabled('new-dashboard', {
    user_id: session?.user?.id,
  });

  return showNewDashboard ? <NewDashboard /> : <OldDashboard />;
}
```

### Mixed Server + Client

```tsx
// app/page.tsx (Server Component)
import { isEnabled } from '@savvagent/nextjs/server';
import { ClientFeature } from './client-feature';

export default async function Page() {
  const serverFlag = await isEnabled('server-feature');

  return (
    <div>
      {serverFlag && <ServerComponent />}
      <ClientFeature /> {/* Client component with its own flags */}
    </div>
  );
}
```

```tsx
// app/client-feature.tsx (Client Component)
'use client';

import { useFlag } from '@savvagent/nextjs/client';

export function ClientFeature() {
  const { value } = useFlag('client-feature');
  return value ? <NewUI /> : <OldUI />;
}
```

### Middleware-Based A/B Testing

```ts
// middleware.ts
import { initMiddlewareClient, isEnabledInMiddleware } from '@savvagent/nextjs/middleware';
import { NextRequest, NextResponse } from 'next/server';

initMiddlewareClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});

export async function middleware(request: NextRequest) {
  // A/B test: 50% of visitors see variant B, bucketed by their anonymous ID.
  // Bounded: if the Flags API is down, visitors get the default variant.
  const variantB = await isEnabledInMiddleware(request, 'checkout-variant-b');

  if (variantB && request.nextUrl.pathname === '/checkout') {
    return NextResponse.rewrite(new URL('/checkout-b', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/checkout'],
};
```

### Progressive Migration

```tsx
// Gradually migrate to new implementation
import { isEnabled } from '@savvagent/nextjs/server';

export default async function Page() {
  const useNewComponent = await isEnabled('use-new-component', {
    attributes: {
      rolloutPercentage: 10, // Start with 10% of users
    },
  });

  return useNewComponent ? <NewComponent /> : <LegacyComponent />;
}
```

## Environment Variables

```env
# Server-side API key (for Server Components, Route Handlers, Middleware)
SAVVAGENT_API_KEY=sdk_...

# Client-side API key (for Client Components with real-time updates)
NEXT_PUBLIC_SAVVAGENT_API_KEY=sdk_...

# Optional
SAVVAGENT_APP_ID=your-app-id
SAVVAGENT_BASE_URL=https://api.savvagent.com/flags
```

## TypeScript Support

Full TypeScript support with type definitions for all APIs.

```tsx
import type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
} from '@savvagent/nextjs';
```

## Best Practices

1. **Use Server Components when possible** - They're faster and reduce client bundle size
2. **Initialize server client in root layout** - Ensures it's ready for all server components
3. **Use middleware for route-level flags** - Great for redirects, rewrites, and A/B tests
4. **Separate client/server API keys** - Use `NEXT_PUBLIC_` prefix only for client-side keys
5. **Supply the user from your auth** - Pass `getUserId`; the `user_id` cookie is client-controlled and ignored unless `trustUserIdCookie` is set
6. **Track errors in new features** - Use `trackError()` to correlate errors with flag changes

## License

MIT

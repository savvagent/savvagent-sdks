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

initServerClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
  applicationId: process.env.SAVVAGENT_APP_ID,
});

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
import { initMiddlewareClient, createMiddleware } from '@savvagent/nextjs/middleware';

initMiddlewareClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});

export default createMiddleware({
  async onRequest(request, client) {
    const context = { user_id: request.cookies.get('user_id')?.value };
    const maintenance = await client.isEnabled('maintenance-mode', context);

    if (maintenance) {
      return NextResponse.rewrite(new URL('/maintenance', request.url));
    }
  },
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

## API Reference

### Server Components

#### `initServerClient(config)`

Initialize the server-side client. Call once in your root layout.

```tsx
import { initServerClient } from '@savvagent/nextjs/server';

initServerClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
  applicationId: process.env.SAVVAGENT_APP_ID,
  baseUrl: process.env.SAVVAGENT_BASE_URL,
});
```

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

Create a context object from Next.js request (automatically extracts cookies and headers).

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

#### `initMiddlewareClient(config)`

Initialize the middleware client.

```ts
import { initMiddlewareClient } from '@savvagent/nextjs/middleware';

initMiddlewareClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});
```

#### `createMiddleware(config)`

Create a middleware function with custom logic.

```ts
import { createMiddleware } from '@savvagent/nextjs/middleware';
import { NextResponse } from 'next/server';

export default createMiddleware({
  async onRequest(request, client) {
    const context = {
      user_id: request.cookies.get('user_id')?.value,
    };

    const maintenance = await client.isEnabled('maintenance-mode', context);
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
import { cookies } from 'next/headers';
import { isEnabled } from '@savvagent/nextjs/server';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const userId = cookieStore.get('user_id')?.value;

  const showNewDashboard = await isEnabled('new-dashboard', {
    user_id: userId,
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
import { initMiddlewareClient, getMiddlewareClient, getRequestContext } from '@savvagent/nextjs/middleware';
import { NextRequest, NextResponse } from 'next/server';

initMiddlewareClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});

export async function middleware(request: NextRequest) {
  const client = getMiddlewareClient();
  const context = getRequestContext(request);

  // A/B test: 50% of users see variant B
  const variantB = await client.isEnabled('checkout-variant-b', context);

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
SAVVAGENT_BASE_URL=https://api.savvagent.com
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
5. **Leverage automatic context** - Server helpers auto-extract user data from cookies/headers
6. **Track errors in new features** - Use `trackError()` to correlate errors with flag changes

## License

MIT

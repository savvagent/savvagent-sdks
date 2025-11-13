# @savvagent/remix

Remix SDK for Savvagent with support for loaders, actions, and client-side hooks.

## Installation

```bash
npm install @savvagent/remix
```

## Quick Start

### 1. Initialize in root route

```tsx
// app/root.tsx
import { initRemixClient } from '@savvagent/remix';

initRemixClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
  applicationId: process.env.SAVVAGENT_APP_ID,
});

export default function App() {
  return (
    <html>
      <body>
        <Outlet />
      </body>
    </html>
  );
}
```

### 2. Use in loaders

```tsx
// app/routes/dashboard.tsx
import { isEnabled } from '@savvagent/remix';
import { LoaderFunctionArgs, json } from '@remix-run/node';

export async function loader({ request }: LoaderFunctionArgs) {
  const showNewDashboard = await isEnabled('new-dashboard', {
    user_id: await getUserId(request),
  });

  return json({ showNewDashboard });
}

export default function Dashboard() {
  const { showNewDashboard } = useLoaderData<typeof loader>();
  return showNewDashboard ? <NewDashboard /> : <OldDashboard />;
}
```

### 3. Use in actions

```tsx
import { trackError } from '@savvagent/remix';
import { ActionFunctionArgs, json } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const formData = await request.formData();
    await processForm(formData);
    return json({ success: true });
  } catch (error) {
    trackError('form-processor', error as Error);
    return json({ error: 'Failed' }, { status: 500 });
  }
}
```

### 4. Use client-side hooks

```tsx
// app/routes/feature.tsx
import { useFlag } from '@savvagent/remix';

export default function Feature() {
  const { value, loading } = useFlag('client-feature');

  if (loading) return <div>Loading...</div>;
  return value ? <NewFeature /> : <OldFeature />;
}
```

## API Reference

### Server-Side

#### `initRemixClient(config)`
Initialize the client (call once in root route).

#### `isEnabled(flagKey, context?)`
Check if flag is enabled.

#### `evaluate(flagKey, context?)`
Get detailed evaluation result.

#### `withFlag(flagKey, callback, context?)`
Execute code conditionally.

#### `evaluateForRequest(request, flagKey, context?)`
Evaluate with automatic request context extraction.

#### `getRequestContext(request, overrides?)`
Extract context from request headers/cookies.

#### `trackError(flagKey, error, context?)`
Track errors with flag context.

### Client-Side

All hooks from `@savvagent/react` are available:
- `useFlag(flagKey, options)`
- `useSavvagent()`
- `useUser()`
- `useTrackError(flagKey, context)`

## Examples

### User-Targeted Feature

```tsx
import { isEnabled, getRequestContext } from '@savvagent/remix';
import { LoaderFunctionArgs } from '@remix-run/node';

export async function loader({ request }: LoaderFunctionArgs) {
  const context = getRequestContext(request);
  const isPremium = await isEnabled('premium-features', {
    ...context,
    attributes: { plan: 'premium' },
  });

  return json({ isPremium });
}
```

### A/B Testing in Loader

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const variantB = await evaluateForRequest(request, 'checkout-variant-b');

  return json({
    checkoutComponent: variantB ? 'CheckoutB' : 'CheckoutA',
  });
}
```

### Error Tracking in Action

```tsx
export async function action({ request }: ActionFunctionArgs) {
  const useNewAlgorithm = await isEnabled('new-algorithm');

  try {
    if (useNewAlgorithm) {
      await processWithNewAlgorithm(await request.formData());
    } else {
      await processWithOldAlgorithm(await request.formData());
    }
    return json({ success: true });
  } catch (error) {
    trackError('new-algorithm', error as Error);
    return json({ error: 'Processing failed' }, { status: 500 });
  }
}
```

## License

MIT

# @savvagent/typescript

Official TypeScript/JavaScript SDK for Savvagent - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: Local caching with configurable TTL
- 🔄 **Real-time Updates**: Automatic cache invalidation via Server-Sent Events
- 📊 **Telemetry**: Automatic tracking of flag evaluations and errors
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **TypeScript**: Full type safety with TypeScript definitions
- 🌐 **Universal**: Works in browsers and Node.js

## Installation

```bash
npm install @savvagent/typescript
# or
yarn add @savvagent/typescript
# or
pnpm add @savvagent/typescript
```

## Quick Start

```typescript
import { FlagClient } from '@savvagent/typescript';

// Initialize the client
const client = new FlagClient({
  apiKey: 'sdk_dev_your_api_key_here',
  baseUrl: 'https://api.savvagent.com/flags', // Optional: defaults to production
  enableRealtime: true,
  enableTelemetry: true,
});

// Check if a flag is enabled
const isNewUIEnabled = await client.isEnabled('new-ui');

if (isNewUIEnabled) {
  // Show new UI
}

// Execute code conditionally
await client.withFlag('experimental-feature', async () => {
  // This code only runs if the flag is enabled
  // Errors are automatically tracked with flag context
  await experimentalFeature();
});
```

## Usage

### Basic Flag Evaluation

```typescript
// Simple boolean check
const enabled = await client.isEnabled('my-feature');

// With user context for targeted rollouts
const enabled = await client.isEnabled('my-feature', {
  userId: 'user-123',
  attributes: {
    plan: 'premium',
    region: 'us-east',
  },
});

// Get detailed evaluation result
const result = await client.evaluate('my-feature', { userId: 'user-123' });
console.log(result);
// {
//   key: 'my-feature',
//   value: true,
//   reason: 'evaluated', // or 'cached', 'default', 'error'
//   metadata: {
//     flagId: '...',
//     description: 'My awesome feature'
//   }
// }
```

### Conditional Execution with Error Tracking

The `withFlag` method makes it easy to run code conditionally and automatically track errors:

```typescript
// Errors are automatically tracked with flag context
const result = await client.withFlag('new-algorithm', async () => {
  return await complexCalculation();
});

if (result) {
  // Flag was enabled and code executed successfully
  console.log('Result:', result);
} else {
  // Flag was disabled
  console.log('Feature not enabled');
}
```

### Manual Error Tracking

```typescript
try {
  await riskyOperation();
} catch (error) {
  // Manually track error with flag context
  client.trackError('my-feature', error, {
    userId: 'user-123',
  });
  throw error;
}
```

### Real-time Updates

Subscribe to flag changes and react in real-time:

```typescript
// Subscribe to a specific flag
const unsubscribe = client.subscribe('my-feature', () => {
  console.log('Flag was updated! Re-evaluating...');
  // React to flag change (e.g., re-render UI)
});

// Subscribe to all flag changes
client.subscribe('*', () => {
  console.log('Some flag was updated');
});

// Unsubscribe when done
unsubscribe();
```

### Cache Management

```typescript
// Get all cached flags
const cachedFlags = client.getCachedFlags();
console.log('Cached:', cachedFlags);

// Clear cache (forces re-evaluation)
client.clearCache();

// Check real-time connection status
if (client.isRealtimeConnected()) {
  console.log('Connected to real-time updates');
}
```

### Using `FlagCache` directly

`FlagCache` is the client's evaluation cache, exported for code that builds its own client (`@savvagent/node-server` uses it). It is keyed by flag key and context key, where the context key is `contextCacheKey(context)` of the context as sent to the server:

```typescript
import { FlagCache, contextCacheKey, DEFAULT_CACHE_MAX_ENTRIES } from '@savvagent/sdk';

const cache = new FlagCache(60_000, DEFAULT_CACHE_MAX_ENTRIES); // TTL in ms, LRU cap
const key = contextCacheKey({ user_id: 'user-123', environment: 'production' });

const generation = cache.generation('new-checkout'); // read before the request
cache.set('new-checkout', true, undefined, key, undefined, generation); // dropped if invalidated since

cache.get('new-checkout', key); // true
cache.get('new-checkout');      // null: without a context key, only the empty-context entry is read
cache.invalidate('new-checkout'); // every context
```

- `get(key)` and `getEntry(key)` without a context key read only the entry stored for the empty context (`''`), never a value cached for another context.
- Reads return `null` on a miss or an expired entry. A TTL of 0 or `maxEntries` of 0 stores nothing.
- `invalidate(key)` and `clear()` advance the generation that `set` checks, so a result whose request started before the invalidation is not cached.

The flag-key rule and the defaults lookup are exported too: `isValidFlagKey(key)` (1-128 characters of `[A-Za-z0-9._-]`, not `.` or `..`) and `defaultFor(defaults, key)` (`true` only for an own `true` entry).

## Configuration

```typescript
interface FlagClientConfig {
  /** SDK API key (required, starts with sdk_) */
  apiKey: string;

  /** Base URL for the Savvagent API (default: production) */
  baseUrl?: string;

  /** Environment for flag evaluation (default: 'production') */
  environment?: string;

  /** Enable real-time flag updates via SSE (default: true) */
  enableRealtime?: boolean;

  /** Cache TTL in milliseconds (default: 60000 = 1 minute; 0 disables caching) */
  cacheTtl?: number;

  /**
   * Maximum number of cached evaluation results (default: 10000). Results are
   * cached per flag and per evaluation context; the least recently used are
   * evicted, so a server-side client seeing many users stays bounded.
   */
  cacheMaxEntries?: number;

  /** Enable telemetry tracking (default: true) */
  enableTelemetry?: boolean;

  /** Default flag values when evaluation fails */
  defaults?: Record<string, boolean>;

  /** Custom error handler */
  onError?: (error: Error) => void;
}
```

### Example with All Options

```typescript
const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',
  baseUrl: 'https://api.savvagent.com/flags',
  environment: 'staging', // Use staging environment flags
  enableRealtime: true,
  cacheTtl: 30000, // 30 seconds
  cacheMaxEntries: 10000, // per-(flag, context) results kept, LRU-evicted; 0 disables caching
  enableTelemetry: true,
  defaults: {
    'new-ui': false, // Default to false if evaluation fails
    'experimental-feature': false,
  },
  onError: (error) => {
    console.error('Savvagent error:', error);
    // Send to your error tracking service
  },
});
```

### Environment Configuration

The `environment` option controls which environment's flag values are used during evaluation. Common values include:

- `'production'` (default) - Production environment
- `'staging'` - Staging/pre-production environment
- `'development'` - Local development environment
- `'beta'` - Beta testing environment

```typescript
// Production app
const client = new FlagClient({
  apiKey: 'sdk_prod_...',
  environment: 'production',
});

// Staging/QA app
const client = new FlagClient({
  apiKey: 'sdk_staging_...',
  environment: 'staging',
});

// Development
const client = new FlagClient({
  apiKey: 'sdk_dev_...',
  environment: 'development',
});
```

You can also change the environment at runtime:

```typescript
// Switch to beta environment
client.setEnvironment('beta');

// Get current environment
console.log(client.getEnvironment()); // 'beta'
```

Note: Changing the environment clears the cache since flag values may differ between environments.

## Framework Integration

### React

```typescript
import { FlagClient } from '@savvagent/client-web';
import { createContext, useContext, useEffect, useState } from 'react';

// Create context
const FlagContext = createContext<FlagClient | null>(null);

// Provider component
export function FlagProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new FlagClient({
        apiKey: process.env.NEXT_PUBLIC_SAVVAGENT_KEY!,
      })
  );

  return <FlagContext.Provider value={client}>{children}</FlagContext.Provider>;
}

// Hook for using flags
export function useFlag(flagKey: string, context?: any) {
  const client = useContext(FlagContext);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!client) return;

    // Initial evaluation
    client.isEnabled(flagKey, context).then(setEnabled);

    // Subscribe to updates
    const unsubscribe = client.subscribe(flagKey, async () => {
      const newValue = await client.isEnabled(flagKey, context);
      setEnabled(newValue);
    });

    return unsubscribe;
  }, [client, flagKey, context]);

  return enabled;
}

// Usage in component
function MyComponent() {
  const isNewUIEnabled = useFlag('new-ui');

  return <div>{isNewUIEnabled ? <NewUI /> : <OldUI />}</div>;
}
```

### Vue 3

```typescript
import { FlagClient } from '@savvagent/client-web';
import { ref, onMounted, onUnmounted } from 'vue';

const client = new FlagClient({
  apiKey: import.meta.env.VITE_SAVVAGENT_KEY,
});

export function useFlag(flagKey: string, context?: any) {
  const enabled = ref(false);
  let unsubscribe: (() => void) | null = null;

  onMounted(async () => {
    enabled.value = await client.isEnabled(flagKey, context);

    unsubscribe = client.subscribe(flagKey, async () => {
      enabled.value = await client.isEnabled(flagKey, context);
    });
  });

  onUnmounted(() => {
    unsubscribe?.();
  });

  return enabled;
}
```

### Svelte

```typescript
import { FlagClient } from '@savvagent/client-web';
import { writable } from 'svelte/store';

const client = new FlagClient({
  apiKey: import.meta.env.VITE_SAVVAGENT_KEY,
});

export function flagStore(flagKey: string, context?: any) {
  const { subscribe, set } = writable(false);

  // Initial evaluation
  client.isEnabled(flagKey, context).then(set);

  // Subscribe to updates
  const unsubscribe = client.subscribe(flagKey, async () => {
    const value = await client.isEnabled(flagKey, context);
    set(value);
  });

  return {
    subscribe,
    unsubscribe,
  };
}
```

## Server request scope (`@savvagent/sdk/server`)

`@savvagent/sdk/server` is the per-request layer the server integrations
(`@savvagent/nextjs`, `@savvagent/sveltekit`) are built on. Use it to
integrate a server framework that has no package of its own. It has no
runtime dependency on the rest of the SDK: you pass it the `FlagClient`
constructor (or instance) you already use, and it needs only Web Crypto, so
it runs on Node.js, edge runtimes, Deno and Bun.

```typescript
import { FlagClient } from '@savvagent/sdk';
import {
  assignAnonymousId,
  buildRequestContext,
  createRequestScope,
  createServerClient,
  isSecureUrl,
  parseCookies,
  serializeAnonymousIdCookie,
} from '@savvagent/sdk/server';

// Once per process: server defaults and a throttled onError.
const server = createServerClient(FlagClient, { apiKey: process.env.SAVVAGENT_SDK_KEY! });

async function handle(request: Request): Promise<Response> {
  const context = buildRequestContext({
    cookies: parseCookies(request.headers.get('cookie')),
    acceptLanguage: request.headers.get('accept-language'),
  });
  const { anonymousId, isNew } = assignAnonymousId(context);
  const flags = createRequestScope({
    client: server.client,
    context,
    getUserId: () => verifySession(request), // your auth
    evaluationTimeoutMs: server.timeoutMs,
    reportError: server.reportError,
    defaults: server.config.defaults,
  });

  const response = new Response((await flags.isEnabled('new-checkout')) ? 'new' : 'old');
  if (isNew) {
    response.headers.append('Set-Cookie', serializeAnonymousIdCookie(anonymousId, { secure: isSecureUrl(request.url) }));
  }
  return response;
}
```

What it guarantees:

- **`user_id`.** The `user_id` cookie is ignored unless you pass
  `trustUserIdCookie: true` to `buildRequestContext`: the browser sets it, so
  any visitor could claim another user's ID. `getUserId` is called at most
  once per scope and bounded by `evaluationTimeoutMs`; if it throws, rejects
  or times out, the failure is reported and the request is evaluated without
  any `user_id`. An explicit `userId` option, or `user_id` in the context you
  pass, wins.
- **Anonymous ID.** `assignAnonymousId` gives a visitor without the
  `savvagent_anonymous_id` cookie a new `anon_<uuid>` ID, so no visitor falls
  into the shared client's process-wide bucket.
  `serializeAnonymousIdCookie` (or `anonymousIdCookieOptions`, for framework
  cookie APIs) stores it: not HttpOnly, so the browser SDK reads it;
  `Path=/`, `SameSite=Lax`, one year, `Secure` on https.
- **Bounded evaluation.** `toServerConfig` (applied by `createServerClient`)
  turns off realtime and language detection and makes one attempt per
  evaluation. `evaluateBounded` and the scope's methods resolve with the
  flag's default from `defaults` (`reason: 'error'`) after
  `evaluationTimeoutMs` (default 1000 ms), on an error, or when the client is
  `null` (it could not be created), and never reject.
- **Errors.** `throttleErrors` reports each message at most once a minute,
  and a throwing handler is logged instead of escaping a timer callback.

Exports: the cookie names and `ANONYMOUS_ID_MAX_AGE`; `parseCookies`,
`parseLanguage`, `newAnonymousId`, `assignAnonymousId`,
`anonymousIdCookieOptions`, `serializeAnonymousIdCookie`, `isSecureUrl`;
`buildRequestContext`, `compactContext`, `mergeContext`, `resolveUserId`;
`toServerConfig`, `createServerClient`, `throttleErrors`, `guardReporter`,
`defaultReportError`, `withTimeout`, `defaultFor`, `fallbackResult`,
`evaluateBounded`, `createRequestScope`; `DEFAULT_EVALUATION_TIMEOUT_MS` and
`ERROR_REPORT_INTERVAL_MS`.

## Best Practices

### 1. Initialize Once

Create a single client instance and reuse it throughout your application:

```typescript
// flags.ts
export const flagClient = new FlagClient({
  apiKey: process.env.SAVVAGENT_API_KEY!,
});

// other-file.ts
import { flagClient } from './flags';
const enabled = await flagClient.isEnabled('my-feature');
```

### 2. Use Context for Targeting

Always pass user context for consistent targeting:

```typescript
const context = {
  userId: currentUser.id,
  attributes: {
    plan: currentUser.plan,
    signupDate: currentUser.createdAt,
  },
};

const enabled = await client.isEnabled('premium-feature', context);
```

### 3. Set Defaults for Critical Flags

```typescript
const client = new FlagClient({
  apiKey: 'sdk_...',
  defaults: {
    'payment-enabled': true, // Default to enabled for critical features
    'experimental-ui': false, // Default to disabled for experiments
  },
});
```

### 4. Clean Up

Always close the client when your application shuts down:

```typescript
// In your cleanup logic
client.close();
```

## Telemetry

The SDK automatically sends telemetry data to help with AI error detection:

- **Evaluations**: Every flag evaluation is tracked (batched every 5 seconds)
- **Errors**: Errors in flagged code are tracked immediately
- **Privacy**: Only flag keys, results, and error metadata are sent (no sensitive data)

To disable telemetry:

```typescript
const client = new FlagClient({
  apiKey: 'sdk_...',
  enableTelemetry: false,
});
```

## Real-time Updates

Real-time updates use Server-Sent Events (SSE) to push flag changes instantly:

- Automatic reconnection with exponential backoff
- Cache invalidation on flag updates
- Low overhead (single connection for all flags)

To disable real-time updates:

```typescript
const client = new FlagClient({
  apiKey: 'sdk_...',
  enableRealtime: false,
});
```

## API Reference

### FlagClient

#### Methods

- `isEnabled(flagKey, context?)`: Check if flag is enabled
- `evaluate(flagKey, context?)`: Get detailed evaluation result
- `withFlag(flagKey, callback, context?)`: Execute code conditionally
- `trackError(flagKey, error, context?)`: Manually track an error
- `subscribe(flagKey, callback)`: Subscribe to flag updates
- `setEnvironment(environment)`: Set the environment for flag evaluation
- `getEnvironment()`: Get the current environment
- `setUserId(userId)`: Set the user ID for targeted rollouts
- `getUserId()`: Get the current user ID
- `getCachedFlags()`: Get all cached flag keys
- `clearCache()`: Clear the flag cache
- `isRealtimeConnected()`: Check real-time connection status
- `close()`: Close client and cleanup resources

## Troubleshooting

### Flags always return false

- Check your API key is correct and starts with `sdk_`
- Verify the baseUrl points to your Savvagent instance
- Check network requests in browser DevTools

### Real-time updates not working

- Ensure `enableRealtime: true` (default)
- Check if EventSource is supported in your environment
- Verify SSE endpoint is accessible

### TypeScript errors

- Ensure TypeScript version >= 5.0
- Check that `@savvagent/client-web` types are installed

## License

MIT

## Support

- Documentation: https://flags-docs.savvagent.com
- Issues: https://github.com/savvagent/flags-sdks/issues
- Email: support@savvagent.com

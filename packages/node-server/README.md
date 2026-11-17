# @savvagent/node-server

Official Node.js Server SDK for Savvagent - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: In-memory caching with configurable TTL
- 🔄 **Real-time Updates**: Automatic cache invalidation via Server-Sent Events
- 📊 **Telemetry**: Automatic tracking of flag evaluations and errors
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **TypeScript**: Full type safety with TypeScript definitions
- 🌐 **Server-Optimized**: Built specifically for Node.js server environments

## Installation

```bash
npm install @savvagent/node-server
# or
yarn add @savvagent/node-server
# or
pnpm add @savvagent/node-server
```

## Quick Start

```typescript
import { FlagClient } from '@savvagent/node-server';

// Initialize the client
const client = new FlagClient({
  apiKey: 'sdk_your_api_key_here',
  applicationId: 'your-app-id', // optional
});

// Evaluate a flag
const result = await client.evaluate('new-feature', {
  user_id: 'user-123',
  environment: 'production',
});

console.log(`Feature enabled: ${result.value}`);

// Or use the convenience method
const isEnabled = await client.isEnabled('new-feature', {
  user_id: 'user-123',
});
```

## Configuration

```typescript
const client = new FlagClient({
  apiKey: 'sdk_your_api_key_here',
  applicationId: 'your-app-id',
  baseUrl: 'https://api.savvagent.com/flags', // optional
  enableRealtime: true, // default: true
  cacheTtl: 60000, // default: 60 seconds; 0 disables caching
  cacheMaxEntries: 10000, // default: 10000 cached (flag, context) results, LRU-evicted; 0 disables caching
  enableTelemetry: true, // default: true
  timeout: 5000, // request timeout in ms, default: 5000
  defaults: {
    'feature-a': false,
    'feature-b': true,
  },
  onError: (error) => {
    console.error('Savvagent error:', error);
  },
});
```

A `srv_` server key is a secret. When it would be sent over a base URL that is not `https`, the client logs one warning at construction: `Savvagent Flags: the server key will be sent over http; use an https base_url`. Loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) are exempt, for local development.

### Defaults from an environment variable or a function

For a service moving from env-var flags, `defaultsFrom` computes defaults when the client is built. `defaultFromEnv(name)` reads a variable once: `1`, `true`, `yes`, `on` and `0`, `false`, `no`, `off` (ignoring case and surrounding whitespace). An unset variable is ignored silently; any other value is ignored with a warning that names the variable but not its value. A function returning `true` or `false` replaces `defaults[key]`; `undefined` leaves `defaults[key]`, or `false`, in place. A function that throws is not caught: the error propagates out of the `FlagClient` constructor, so a broken default fails at startup.

```typescript
import { FlagClient, defaultFromEnv } from '@savvagent/node-server';

const client = new FlagClient({
  apiKey: process.env.SAVVAGENT_FLAGS_API_KEY!,
  defaults: { 'beta-banner': false },
  defaultsFrom: {
    'new-checkout': defaultFromEnv('NEW_CHECKOUT'), // "when the server can't be reached, use NEW_CHECKOUT"
    'beta-banner': () => (process.env.REGION === 'eu' ? true : undefined), // any function, called once
  },
});
```

## Usage Examples

### Basic Flag Evaluation

```typescript
// Simple boolean check
const enabled = await client.isEnabled('premium-features', {
  user_id: req.user.id,
});

if (enabled) {
  // Premium features code
}
```

### With Request Context

```typescript
import express from 'express';

app.get('/api/data', async (req, res) => {
  const useNewAlgorithm = await client.isEnabled('new-algorithm', {
    user_id: req.user?.id,
    session_id: req.sessionID,
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
    environment: process.env.NODE_ENV,
    attributes: {
      plan: req.user?.plan,
      country: req.user?.country,
    },
  });

  if (useNewAlgorithm) {
    res.json(await newAlgorithm());
  } else {
    res.json(await oldAlgorithm());
  }
});
```

### Error Tracking

```typescript
const featureEnabled = await client.isEnabled('new-payment-flow');

try {
  if (featureEnabled) {
    await processPaymentV2(order);
  } else {
    await processPaymentV1(order);
  }
} catch (error) {
  // Track error with flag context for AI correlation
  client.trackError('new-payment-flow', error, {
    user_id: order.userId,
    attributes: { orderId: order.id },
  });
  throw error;
}
```

### Real-time Updates

```typescript
// Subscribe to flag changes
const unsubscribe = client.subscribe('feature-toggle', () => {
  console.log('Feature toggle changed!');
  // Invalidation happens automatically
});

// Unsubscribe when done
process.on('SIGTERM', () => {
  unsubscribe();
  client.close();
});
```

### Express Middleware

```typescript
import express from 'express';

// Create a middleware for flag evaluation
const flagMiddleware = (flagKey: string) => {
  return async (req, res, next) => {
    const enabled = await client.isEnabled(flagKey, {
      user_id: req.user?.id,
      session_id: req.sessionID,
    });

    req.flagEnabled = enabled;
    next();
  };
};

app.get('/premium-feature', flagMiddleware('premium-access'), (req, res) => {
  if (!req.flagEnabled) {
    return res.status(403).json({ error: 'Premium access required' });
  }

  res.json({ data: premiumData });
});
```

## API Reference

### FlagClient

#### Constructor

```typescript
new FlagClient(config: FlagClientConfig)
```

#### Methods

##### evaluate(flagKey, context?)

Evaluate a feature flag and return detailed results.

```typescript
const result = await client.evaluate('my-flag', { user_id: '123' });
// Returns: { key, value, reason, metadata? }
// metadata: { version?, scope? } as sent by the server, on evaluated and cached results
```

Flag keys are 1-128 characters of `[A-Za-z0-9._-]` and not `.` or `..`. An invalid key returns the default with `reason: 'error'` (and calls `onError`) without sending a request. A response without a boolean `enabled` is a failed lookup: it returns the default with `reason: 'error'` and is not cached.

##### isEnabled(flagKey, context?)

Check if a flag is enabled (returns boolean).

```typescript
const enabled = await client.isEnabled('my-flag', { user_id: '123' });
```

##### isEnabledCached(flagKey, context?)

Read a flag synchronously, for code that cannot be `async`. It never makes a request or waits: it returns the unexpired cached value for this flag and context, else the configured default (`defaults` / `defaultsFrom`, else `false`). The cache is per context, so keep it warm by calling `isEnabled` or `evaluate` on the same context at least once per `cacheTtl`. A hit counts as an evaluation in telemetry (queued, and sent later in a batch); a miss does not.

```typescript
await client.isEnabled('new-banner', { user_id: '123' }); // warms the cache for this user

function render(userId: string): string {
  return client.isEnabledCached('new-banner', { user_id: userId }) ? 'new' : 'old';
}
```

##### FlagClient.staticFlags(flags)

A client for tests that serves fixed values and never touches the network: each listed flag evaluates to its value, any other flag to `false`, with `reason: 'static'`. No request, telemetry, stream or timer. Config and variation overrides still apply; `getAllFlags()` and `getEnterpriseFlags()` return `[]`. Not for production use.

```typescript
const client = FlagClient.staticFlags({ 'new-checkout': true, 'beta-banner': false });
await client.isEnabled('new-checkout'); // true
client.isEnabledCached('anything-else'); // false
```

It accepts a record, a `Map`, or an array of `[key, value]` pairs.

##### trackError(flagKey, error, context?)

Track an error that occurred in flagged code.

```typescript
client.trackError('my-flag', new Error('Something failed'), {
  user_id: '123',
});
```

##### subscribe(flagKey, callback)

Subscribe to real-time flag updates.

```typescript
const unsubscribe = client.subscribe('my-flag', () => {
  console.log('Flag updated!');
});
```

##### invalidateCache(flagKey?)

Manually invalidate cache for a flag or all flags.

```typescript
client.invalidateCache('my-flag'); // Specific flag
client.invalidateCache(); // All flags
```

##### close()

Clean up resources (flush telemetry, close connections).

```typescript
client.close();
```

### FlagCache

`FlagCache` is the client's evaluation cache, exported for code that manages its own. The cache logic is `@savvagent/sdk`'s `FlagCache` (shared, not copied); node-server's class keeps its call shape:

```typescript
import { FlagCache, contextCacheKey } from '@savvagent/node-server'; // both from @savvagent/sdk

const cache = new FlagCache(60_000, 10_000); // TTL in ms, max (flag, context) entries
const ctx = contextCacheKey({ user_id: 'user-123', environment: 'production' });

const generation = cache.generation('new-checkout'); // read before the request
cache.set('new-checkout', true, 'flag-id', { limit: 5 }, 'treatment', ctx, { version: 3 }, generation);

cache.getEntry('new-checkout', ctx); // { value: true, configuration: { limit: 5 }, variation: 'treatment', ... }
cache.get('new-checkout');           // null: without a context key, only the empty-context entry is read
cache.invalidate('new-checkout');    // every context; invalidate() with no key clears every flag
```

- Entries are keyed by flag key and context key (`contextCacheKey` of the context as sent: yours, with `application_id` and `environment` filled in). `get(key)` and `getEntry(key)` without a context key read only the entry stored for the empty context (`''`), never a value cached for another context.
- Reads return `null` on a miss or an expired entry; at most `maxEntries` entries are kept (least recently used evicted). A TTL of 0 or `maxEntries` of 0 stores nothing.
- `invalidate` and `clear` advance the generation that `set` checks, so a result whose request started before the invalidation is not cached.

## Best Practices

1. **Reuse Client Instance**: Create one client instance and reuse it across your application
2. **Error Handling**: Always wrap flagged code with error tracking
3. **Context**: Provide rich context for better targeting
4. **Cleanup**: Call `client.close()` on shutdown
5. **Defaults**: Set sensible defaults for all flags

## Examples

### NestJS Integration

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { FlagClient } from '@savvagent/node-server';

@Injectable()
export class FlagsService implements OnModuleDestroy {
  private client: FlagClient;

  constructor() {
    this.client = new FlagClient({
      apiKey: process.env.SAVVAGENT_FLAGS_API_KEY,
      applicationId: process.env.APP_ID,
    });
  }

  async isEnabled(flagKey: string, userId?: string) {
    return this.client.isEnabled(flagKey, { user_id: userId });
  }

  onModuleDestroy() {
    this.client.close();
  }
}
```

## License

MIT

## Support

- Documentation: https://flags-docs.savvagent.com
- Issues: https://github.com/savvagent/flags-sdks/issues
- Email: support@savvagent.com

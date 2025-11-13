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
  baseUrl: 'https://api.savvagent.com', // optional
  enableRealtime: true, // default: true
  cacheTtl: 60000, // default: 60 seconds
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
```

##### isEnabled(flagKey, context?)

Check if a flag is enabled (returns boolean).

```typescript
const enabled = await client.isEnabled('my-flag', { user_id: '123' });
```

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
      apiKey: process.env.SAVVAGENT_API_KEY,
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

- Documentation: https://docs.savvagent.com
- Issues: https://github.com/savvagent/savvagent-sdks/issues
- Email: support@savvagent.com

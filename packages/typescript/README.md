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
  baseUrl: 'https://api.savvagent.com', // Optional: defaults to production
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

## Configuration

```typescript
interface FlagClientConfig {
  /** SDK API key (required, starts with sdk_) */
  apiKey: string;

  /** Base URL for the Savvagent API (default: production) */
  baseUrl?: string;

  /** Enable real-time flag updates via SSE (default: true) */
  enableRealtime?: boolean;

  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  cacheTtl?: number;

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
  baseUrl: 'https://api.savvagent.com',
  enableRealtime: true,
  cacheTtl: 30000, // 30 seconds
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

- Documentation: https://docs.savvagent.com
- Issues: https://github.com/yourusername/savvagent/issues
- Email: support@savvagent.com

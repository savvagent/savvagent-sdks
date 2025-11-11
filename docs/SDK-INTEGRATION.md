# SDK Integration Guide

Complete guide for integrating Savvagent SDK into your application.

## Installation

```bash
# Using pnpm (recommended)
pnpm add @savvagent/sdk

# Using npm
npm install @savvagent/sdk

# Using yarn
yarn add @savvagent/sdk
```

## Quick Start

### 1. Initialize the Client

```typescript
import { SavvagentClient } from '@savvagent/sdk';

const savvagent = new SavvagentClient({
  apiUrl: 'https://api.savvagent.com',
  sdkKey: 'your-sdk-key-here',
  environment: 'production', // or 'staging', 'development'
});
```

### 2. Check a Feature Flag

```typescript
const isEnabled = await savvagent.isEnabled('new-feature', {
  userId: 'user-123',
  attributes: {
    email: 'user@example.com',
    plan: 'pro',
    country: 'US',
  },
});

if (isEnabled) {
  // Show new feature
} else {
  // Show old feature
}
```

## Configuration Options

```typescript
interface SavvagentConfig {
  // Required
  apiUrl: string;           // Your Savvagent API URL
  sdkKey: string;          // SDK key from Savvagent dashboard

  // Optional
  environment?: string;     // Environment name (default: 'production')
  timeout?: number;         // Request timeout in ms (default: 5000)

  // Caching
  cache?: {
    enabled: boolean;       // Enable/disable caching (default: true)
    ttl: number;           // Cache TTL in ms (default: 60000)
  };

  // Real-time updates
  realtime?: {
    enabled: boolean;       // Enable WebSocket connection (default: false)
    url?: string;          // WebSocket URL (defaults to apiUrl with ws://)
  };

  // Telemetry
  telemetry?: {
    enabled: boolean;       // Send evaluation metrics (default: true)
    batchSize?: number;    // Batch size for telemetry (default: 100)
    flushInterval?: number; // Flush interval in ms (default: 10000)
  };
}
```

## Usage Examples

### React / Next.js

#### Using in a Component

```typescript
'use client';

import { SavvagentClient } from '@savvagent/sdk';
import { useEffect, useState } from 'react';

export default function MyComponent() {
  const [showNewUI, setShowNewUI] = useState(false);

  useEffect(() => {
    const client = new SavvagentClient({
      apiUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL!,
      sdkKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY!,
    });

    client.isEnabled('new-ui', { userId: 'user-123' })
      .then(setShowNewUI)
      .catch(console.error);
  }, []);

  return showNewUI ? <NewUI /> : <OldUI />;
}
```

#### Creating a Custom Hook

```typescript
// hooks/useFeatureFlag.ts
import { useEffect, useState } from 'react';
import { SavvagentClient } from '@savvagent/sdk';

const client = new SavvagentClient({
  apiUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL!,
  sdkKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY!,
});

export function useFeatureFlag(flagKey: string, userId: string) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.isEnabled(flagKey, { userId })
      .then(setIsEnabled)
      .finally(() => setLoading(false));
  }, [flagKey, userId]);

  return { isEnabled, loading };
}

// Usage
function MyComponent() {
  const { isEnabled, loading } = useFeatureFlag('new-feature', 'user-123');

  if (loading) return <Spinner />;
  return isEnabled ? <NewFeature /> : <OldFeature />;
}
```

### Node.js / Express

```typescript
import express from 'express';
import { SavvagentClient } from '@savvagent/sdk';

const app = express();
const savvagent = new SavvagentClient({
  apiUrl: process.env.SAVVAGENT_API_URL!,
  sdkKey: process.env.SAVVAGENT_SDK_KEY!,
  cache: {
    enabled: true,
    ttl: 60000, // 1 minute
  },
});

app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;

  // Check feature flag
  const useNewEndpoint = await savvagent.isEnabled('new-user-endpoint', {
    userId,
    attributes: {
      userAgent: req.headers['user-agent'],
    },
  });

  if (useNewEndpoint) {
    // Use new implementation
    res.json(await getNewUserData(userId));
  } else {
    // Use old implementation
    res.json(await getOldUserData(userId));
  }
});
```

### SvelteKit

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { SavvagentClient } from '@savvagent/sdk';

  let newFeatureEnabled = $state(false);
  let loading = $state(true);

  onMount(async () => {
    const client = new SavvagentClient({
      apiUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
      sdkKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
    });

    newFeatureEnabled = await client.isEnabled('new-feature', {
      userId: 'user-123',
    });
    loading = false;
  });
</script>

{#if loading}
  <p>Loading...</p>
{:else if newFeatureEnabled}
  <NewFeature />
{:else}
  <OldFeature />
{/if}
```

## Advanced Features

### Real-time Flag Updates

Enable WebSocket connection for instant flag updates:

```typescript
const client = new SavvagentClient({
  apiUrl: 'https://api.savvagent.com',
  sdkKey: 'your-sdk-key',
  realtime: {
    enabled: true,
  },
});

// Listen for flag changes
client.on('flag-updated', (flagKey: string, newValue: boolean) => {
  console.log(`Flag ${flagKey} updated to:`, newValue);
  // Update your UI
});
```

### Batch Flag Evaluation

Check multiple flags at once:

```typescript
const flags = await Promise.all([
  client.isEnabled('feature-a', { userId }),
  client.isEnabled('feature-b', { userId }),
  client.isEnabled('feature-c', { userId }),
]);

const [featureA, featureB, featureC] = flags;
```

### Custom Context Attributes

Pass rich context for targeting rules:

```typescript
const isEnabled = await client.isEnabled('premium-feature', {
  userId: 'user-123',
  attributes: {
    email: 'user@example.com',
    plan: 'pro',
    country: 'US',
    signupDate: '2024-01-15',
    lastActive: new Date().toISOString(),
    customAttribute: 'any-value',
  },
});
```

### Error Handling

```typescript
try {
  const isEnabled = await client.isEnabled('new-feature', { userId });
  // Use the flag
} catch (error) {
  // Log error to monitoring service
  console.error('Failed to evaluate flag:', error);

  // Fall back to safe default
  const isEnabled = false;
}
```

### Graceful Degradation

Always provide fallback values:

```typescript
async function checkFlag(flagKey: string, userId: string, defaultValue = false) {
  try {
    return await client.isEnabled(flagKey, { userId });
  } catch (error) {
    console.error(`Flag ${flagKey} evaluation failed, using default:`, defaultValue);
    return defaultValue;
  }
}

// Usage
const showNewUI = await checkFlag('new-ui', userId, false);
```

## Best Practices

### 1. Initialize Once

Create a single client instance and reuse it:

```typescript
// lib/savvagent.ts
import { SavvagentClient } from '@savvagent/sdk';

export const savvagent = new SavvagentClient({
  apiUrl: process.env.SAVVAGENT_API_URL!,
  sdkKey: process.env.SAVVAGENT_SDK_KEY!,
});

// Use everywhere
import { savvagent } from '@/lib/savvagent';
```

### 2. Use Environment Variables

Never hardcode API keys:

```bash
# .env
SAVVAGENT_API_URL=https://api.savvagent.com
SAVVAGENT_SDK_KEY=sk_prod_xxx

# .env.local (for frontend)
NEXT_PUBLIC_SAVVAGENT_API_URL=https://api.savvagent.com
NEXT_PUBLIC_SAVVAGENT_SDK_KEY=sk_prod_xxx
```

### 3. Enable Caching

Reduce API calls with caching:

```typescript
const client = new SavvagentClient({
  apiUrl: process.env.SAVVAGENT_API_URL!,
  sdkKey: process.env.SAVVAGENT_SDK_KEY!,
  cache: {
    enabled: true,
    ttl: 60000, // 1 minute
  },
});
```

### 4. Handle Errors Gracefully

Always provide fallbacks:

```typescript
const isEnabled = await client.isEnabled('feature', { userId })
  .catch(() => false); // Default to false on error
```

### 5. Use Telemetry

Keep telemetry enabled for analytics:

```typescript
const client = new SavvagentClient({
  apiUrl: process.env.SAVVAGENT_API_URL!,
  sdkKey: process.env.SAVVAGENT_SDK_KEY!,
  telemetry: {
    enabled: true, // Default, but be explicit
  },
});
```

## Environment-Specific Configuration

### Development

```typescript
const client = new SavvagentClient({
  apiUrl: 'http://localhost:8080',
  sdkKey: 'sk_dev_xxx',
  environment: 'development',
  cache: {
    enabled: false, // Disable for testing
  },
});
```

### Staging

```typescript
const client = new SavvagentClient({
  apiUrl: 'https://staging-api.savvagent.com',
  sdkKey: 'sk_staging_xxx',
  environment: 'staging',
});
```

### Production

```typescript
const client = new SavvagentClient({
  apiUrl: 'https://api.savvagent.com',
  sdkKey: 'sk_prod_xxx',
  environment: 'production',
  cache: {
    enabled: true,
    ttl: 60000,
  },
  telemetry: {
    enabled: true,
  },
});
```

## Troubleshooting

### Flags Not Updating

1. Check cache TTL - cached values won't update until TTL expires
2. Verify WebSocket connection for real-time updates
3. Check network connectivity to API

### High Latency

1. Enable caching to reduce API calls
2. Use batch evaluation for multiple flags
3. Consider using real-time updates instead of polling

### Authentication Errors

1. Verify SDK key is correct
2. Check environment matches (dev/staging/prod)
3. Ensure SDK key has not been revoked

## Support

- Documentation: https://docs.savvagent.com
- GitHub Issues: https://github.com/yourusername/savvagent-sdks/issues
- Examples: https://github.com/yourusername/savvagent-sdks/tree/main/examples

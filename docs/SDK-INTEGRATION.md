# SDK Integration Guide

Complete guide for integrating Savvagent SDK into your application.

> **For SDK Developers:** If you're building a new SDK or integrating with the Savvagent API directly, see the [SDK Developer Guide](./SDK-DEVELOPER-GUIDE.md) for API specifications, authentication details, and best practices.

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
import { FlagClient } from '@savvagent/sdk';

// Create a single SDK instance at application startup (recommended)
// Per SDK Developer Guide: Initialize once, create a single SDK instance
const savvagent = new FlagClient({
  baseUrl: 'https://api.savvagent.com',
  apiKey: 'sdk_your_key_here', // SDK keys start with 'sdk_' prefix
  applicationId: 'your-app-id', // For application-scoped flags
  enableRealtime: true, // Enable SSE for real-time updates
  enableTelemetry: true, // Track evaluations and errors
  cacheTtl: 60000, // Cache TTL in milliseconds (default: 1 minute)
});

// Export for use throughout your application
export default savvagent;
```

> **API Key Types (per SDK Developer Guide):**
> - **SDK keys** (`sdk_` prefix) - Safe for client-side apps (browsers, mobile)
> - **Server keys** (`srv_` prefix) - Secret, for server-side apps only (Node.js, Python) - never expose in client-side code

### 2. Check a Feature Flag

```typescript
// Always include user context for consistent rollout behavior
// Per SDK Developer Guide: Context fields for flag evaluation
const isEnabled = await savvagent.isEnabled('new-feature', {
  user_id: 'user-123',           // Required for percentage rollouts
  anonymous_id: 'anon-456',      // Alternative for anonymous users
  session_id: 'session-789',     // Fallback identifier
  environment: 'production',     // Target environment
  organization_id: 'org-uuid',   // For multi-tenant apps
  application_id: 'app-uuid',    // For hierarchical flag lookup
  language: 'en',                // User's language code
  attributes: {                  // Custom attributes for targeting rules
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

> **Important:** Always provide `user_id` or `anonymous_id` for consistent user experiences across evaluations. The `session_id` serves as a fallback identifier.

## Configuration Options

```typescript
// Per SDK Developer Guide: FlagClientConfig options
interface FlagClientConfig {
  // Required
  apiKey: string;              // SDK key (sdk_) or Server key (srv_) from dashboard

  // Optional
  baseUrl?: string;            // Your Savvagent API URL (default: https://api.savvagent.com)
  applicationId?: string;      // Application ID for hierarchical flag lookup

  // Caching
  cacheTtl?: number;           // Cache TTL in ms (default: 60000 = 1 minute)

  // Real-time updates via SSE (Server-Sent Events)
  enableRealtime?: boolean;    // Enable SSE connection (default: true)

  // Telemetry (batched for efficiency - per SDK Developer Guide: batch every 5-10 seconds)
  enableTelemetry?: boolean;   // Send evaluation metrics (default: true)

  // Default values
  defaults?: Record<string, boolean>;  // Default flag values when evaluation fails

  // Error handling
  onError?: (error: Error) => void;    // Custom error handler

  // Server SDK only
  timeout?: number;            // Request timeout in ms (default: 5000)
}
```

> **Best Practice (per SDK Developer Guide):** Set reasonable timeouts (3 seconds recommended) and fall back to cached/default values on failure.

## Usage Examples

### React / Next.js

#### Using the React SDK (Recommended)

```typescript
// Use the @savvagent/react package for React applications
import { SavvagentProvider, useFlag, useUser } from '@savvagent/react';
import type { FlagClientConfig, DefaultFlagContext } from '@savvagent/react';

// App.tsx - Per SDK Developer Guide: Initialize once at app startup
function App() {
  const config: FlagClientConfig = {
    apiKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY!,
    baseUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL,
    enableRealtime: true,
    enableTelemetry: true,
  };

  // Per SDK Developer Guide: Always provide user context
  const defaultContext: DefaultFlagContext = {
    environment: 'production',
    userId: 'user-123',
    language: 'en',
  };

  return (
    <SavvagentProvider config={config} defaultContext={defaultContext}>
      <MyComponent />
    </SavvagentProvider>
  );
}

// MyComponent.tsx - Using the useFlag hook
function MyComponent() {
  const { value: showNewUI, loading } = useFlag('new-ui', {
    defaultValue: false,
    realtime: true, // Enable real-time updates
  });

  if (loading) return <Spinner />;
  return showNewUI ? <NewUI /> : <OldUI />;
}
```

#### Using the Core SDK Directly

```typescript
'use client';

import { FlagClient } from '@savvagent/sdk';
import { useEffect, useState } from 'react';

// Per SDK Developer Guide: Create single instance
const client = new FlagClient({
  apiKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL,
});

export default function MyComponent() {
  const [showNewUI, setShowNewUI] = useState(false);

  useEffect(() => {
    client.isEnabled('new-ui', { user_id: 'user-123' })
      .then(setShowNewUI)
      .catch(console.error);

    // Per SDK Developer Guide: Clean shutdown
    return () => client.close();
  }, []);

  return showNewUI ? <NewUI /> : <OldUI />;
}
```

### Node.js / Express

```typescript
import express from 'express';
import { FlagClient } from '@savvagent/node-server';

const app = express();

// Per SDK Developer Guide: Create single instance at startup
// Server SDK accepts both sdk_ and srv_ keys
const savvagent = new FlagClient({
  apiKey: process.env.SAVVAGENT_SERVER_KEY!, // srv_ key for server-side
  baseUrl: process.env.SAVVAGENT_API_URL,
  cacheTtl: 60000, // 1 minute
  enableRealtime: true,
  timeout: 5000, // 5 second timeout
});

app.get('/api/users/:userId', async (req, res) => {
  const { userId } = req.params;

  // Per SDK Developer Guide: Include context for targeting
  const useNewEndpoint = await savvagent.isEnabled('new-user-endpoint', {
    user_id: userId,
    ip_address: req.ip, // Server-side only field
    user_agent: req.headers['user-agent'], // Server-side only field
    attributes: {
      endpoint: '/api/users',
    },
  });

  if (useNewEndpoint) {
    res.json(await getNewUserData(userId));
  } else {
    res.json(await getOldUserData(userId));
  }
});

// Per SDK Developer Guide: Clean shutdown
process.on('SIGTERM', () => savvagent.close());
```

### SvelteKit

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FlagClient } from '@savvagent/sdk';

  let newFeatureEnabled = $state(false);
  let loading = $state(true);
  let client: FlagClient;

  onMount(async () => {
    // Per SDK Developer Guide: Create single instance
    client = new FlagClient({
      apiKey: import.meta.env.VITE_SAVVAGENT_SDK_KEY,
      baseUrl: import.meta.env.VITE_SAVVAGENT_API_URL,
      enableRealtime: true,
    });

    // Per SDK Developer Guide: Include user context
    newFeatureEnabled = await client.isEnabled('new-feature', {
      user_id: 'user-123',
      environment: 'production',
    });
    loading = false;
  });

  // Per SDK Developer Guide: Clean shutdown
  onDestroy(() => client?.close());
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

### Real-time Flag Updates (SSE)

Enable Server-Sent Events for instant flag updates. Per SDK Developer Guide, the SDK uses `@microsoft/fetch-event-source` internally for header-based authentication (native EventSource doesn't support custom headers):

```typescript
import { FlagClient } from '@savvagent/sdk';

const client = new FlagClient({
  apiKey: 'sdk_your_key',
  baseUrl: 'https://api.savvagent.com',
  enableRealtime: true, // Enable SSE connection
});

// Subscribe to specific flag updates
const unsubscribe = client.subscribe('my-feature', () => {
  console.log('Flag "my-feature" was updated');
  // Cache is automatically invalidated, next evaluation gets fresh value
});

// Cleanup when done
unsubscribe();
```

> **Per SDK Developer Guide:** SSE enhances the SDK but isn't required. The SDK works without real-time updates using cached values.

#### SSE Event Types (per SDK Developer Guide)

| Event | Description |
|-------|-------------|
| `connected` | Connection established |
| `heartbeat` | Keep-alive (every 30s) |
| `flag.created` | New flag created |
| `flag.updated` | Flag configuration changed |
| `flag.deleted` | Flag deleted/archived |

#### Reconnection Strategy

The SDK implements exponential backoff for SSE reconnection (per SDK Developer Guide):

```typescript
// Built-in: delay = min(1000 * 2^attempt, 30000)
// Max 10 reconnection attempts before giving up
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

### Context Fields Reference

Pass rich context for targeting rules. Per SDK Developer Guide, the following fields are supported:

```typescript
const isEnabled = await client.isEnabled('premium-feature', {
  // User identification (at least one required for percentage rollouts)
  user_id: 'user-123',           // Unique user identifier (required for rollouts)
  anonymous_id: 'anon-456',      // Alternative to user_id for anonymous users
  session_id: 'session-789',     // Fallback identifier

  // Targeting
  environment: 'production',     // Target environment (e.g., "production", "staging")
  organization_id: 'org-uuid',   // For multi-tenant apps
  application_id: 'app-uuid',    // For hierarchical flag lookup
  language: 'en',                // User's language code (e.g., "en", "es")

  // Custom attributes for targeting rules
  attributes: {
    email: 'user@example.com',
    plan: 'pro',
    country: 'US',
  },
});
```

| Field | Description | Per SDK Developer Guide |
|-------|-------------|------------------------|
| `user_id` | Unique user identifier | Required for percentage rollouts |
| `anonymous_id` | Alternative to user_id | For anonymous users |
| `session_id` | Fallback identifier | When user_id/anonymous_id unavailable |
| `environment` | Target environment | e.g., "production", "staging" |
| `organization_id` | For multi-tenant apps | Scopes flags to organization |
| `application_id` | For hierarchical flag lookup | Auto-injected from config |
| `language` | User's language code | e.g., "en", "es" |
| `attributes` | Custom attributes | For targeting rules |

### Error Handling

SDKs should accept default values for graceful degradation:

```typescript
// User provides default
const enabled = await client.isEnabled('new-feature', {
  user_id: 'user-123',
  default: false  // Fallback value
});
```

#### HTTP Status Code Handling

| Code | Meaning | SDK Action |
|------|---------|------------|
| `200` | Success | Use response |
| `401` | Invalid/missing SDK key | Check configuration |
| `404` | Flag not found | Return default value |
| `429` | Rate limited | Back off and retry |
| `500` | Server error | Return cached/default value |

### Timeout Handling

Set reasonable timeouts (3 seconds recommended) and fall back to cached/default values:

```typescript
const evaluate = async (key: string, context: any, options: any = {}) => {
  const timeout = options.timeout || 3000;
  const defaultValue = options.default ?? false;

  try {
    const result = await Promise.race([
      client.evaluate(key, context),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeout)
      )
    ]);
    return result.enabled;
  } catch (error) {
    return cache.get(key) ?? defaultValue;
  }
};
```

### Graceful Degradation

Always provide fallback values:

```typescript
async function checkFlag(flagKey: string, user_id: string, defaultValue = false) {
  try {
    return await client.isEnabled(flagKey, { user_id });
  } catch (error) {
    console.error(`Flag ${flagKey} evaluation failed, using default:`, defaultValue);
    return defaultValue;
  }
}

// Usage
const showNewUI = await checkFlag('new-ui', userId, false);
```

## Best Practices

Per SDK Developer Guide, follow these best practices:

### 1. Initialize Once

Create a single SDK instance at application startup:

```typescript
// lib/savvagent.ts
import { FlagClient } from '@savvagent/sdk';

// Good - single instance (per SDK Developer Guide)
export const savvagent = new FlagClient({
  apiKey: process.env.SAVVAGENT_SDK_KEY!,
  baseUrl: process.env.SAVVAGENT_API_URL,
});

// Use everywhere
import { savvagent } from '@/lib/savvagent';
```

```typescript
// Bad - creates multiple connections
function getFlag(key: string) {
  const client = new FlagClient({ apiKey: 'sdk_xxx' });
  return client.isEnabled(key);
}
```

### 2. Provide User Context

Always include user identifiers for consistent rollout behavior (per SDK Developer Guide):

```typescript
// Good - consistent experience
client.isEnabled('feature', { user_id: user.id });

// Bad - random on each evaluation
client.isEnabled('feature');
```

### 3. Use Environment Variables

Never hardcode API keys:

```bash
# .env
SAVVAGENT_API_URL=https://api.savvagent.com
SAVVAGENT_SDK_KEY=sdk_prod_xxx  # SDK keys use sdk_ prefix

# .env.local (for frontend)
NEXT_PUBLIC_SAVVAGENT_API_URL=https://api.savvagent.com
NEXT_PUBLIC_SAVVAGENT_SDK_KEY=sdk_prod_xxx
```

### 4. Enable Caching

Cache evaluations with TTL, invalidate on SSE events for instant updates (per SDK Developer Guide: 5 minutes recommended):

```typescript
const client = new FlagClient({
  apiKey: process.env.SAVVAGENT_SDK_KEY!,
  baseUrl: process.env.SAVVAGENT_API_URL,
  cacheTtl: 300000, // 5 minutes (per SDK Developer Guide)
  enableRealtime: true, // Invalidates cache on flag changes
});
```

### 5. Handle SSE Gracefully

Per SDK Developer Guide: SSE is optional - the SDK should work without it:

```typescript
// SDK automatically handles SSE failures gracefully
// If SSE connection fails, SDK continues working with cached values
const client = new FlagClient({
  apiKey: process.env.SAVVAGENT_SDK_KEY!,
  enableRealtime: true, // SSE enhances but isn't required
});
```

### 6. Batch Telemetry

Per SDK Developer Guide: Don't send telemetry on every evaluation - batch evaluations and send every 5-10 seconds:

```typescript
// The SDK automatically batches telemetry:
// - Evaluations: batched and sent every 5 seconds
// - Errors: sent immediately (critical telemetry)
const client = new FlagClient({
  apiKey: process.env.SAVVAGENT_SDK_KEY!,
  enableTelemetry: true, // Enabled by default
});
```

### 7. Clean Shutdown

Per SDK Developer Guide: Properly close connections on shutdown:

```typescript
// In your app
process.on('SIGTERM', () => {
  client.close();  // Closes SSE, flushes telemetry, clears cache
});
```

## Environment-Specific Configuration

### Development

```typescript
const client = new FlagClient({
  apiKey: 'sdk_dev_xxx',
  baseUrl: 'http://localhost:8080',
  cacheTtl: 10000, // Short TTL for faster testing iterations
  enableRealtime: true,
  enableTelemetry: false, // Disable telemetry in development
});
```

### Staging

```typescript
const client = new FlagClient({
  apiKey: 'sdk_staging_xxx',
  baseUrl: 'https://staging-api.savvagent.com',
  cacheTtl: 60000, // 1 minute
  enableRealtime: true,
  enableTelemetry: true,
});
```

### Production

```typescript
const client = new FlagClient({
  apiKey: 'sdk_prod_xxx',
  baseUrl: 'https://api.savvagent.com',
  cacheTtl: 300000, // 5 minutes (per SDK Developer Guide)
  enableRealtime: true, // Enable SSE for instant updates
  enableTelemetry: true,
  defaults: {
    'critical-feature': true, // Fail-safe defaults
  },
});
```

## API Endpoints Reference

Per SDK Developer Guide:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/flags/{key}/evaluate` | POST | SDK/Server Key or JWT | Evaluate a flag |
| `/api/sdk/flags` | GET | SDK/Server Key | Get all flags for application + enterprise |
| `/api/sdk/enterprise-flags` | GET | SDK/Server Key | Get only enterprise-scoped flags |
| `/api/flags/stream` | GET | SDK/Server Key or JWT | Real-time SSE stream |
| `/api/telemetry/evaluations` | POST | SDK/Server Key | Report evaluations |
| `/api/telemetry/errors` | POST | SDK/Server Key | Report errors |

> **Note:** All endpoints require authentication via `Authorization: Bearer <key>` header.

### Get All Flags (for Local Overrides)

The `/api/sdk/flags` endpoint is designed for SDK consumption with local override support:

```typescript
// Fetch all flags for development environment
const flags = await client.getAllFlags('development');

// Each flag includes:
// - key: Flag key
// - enabled: Enabled state for the requested environment
// - scope: "application" or "enterprise"
// - environments: Full environment configuration
// - variations: Variation definitions (for A/B testing)
// - configuration: Dynamic configuration
// - version: Flag version (for cache invalidation)
```

**Use cases:**
- **Local Override UI**: Display all available flags for developers to toggle locally
- **Offline Mode**: Pre-fetch flags for mobile/desktop apps that need to work offline
- **SDK Initialization**: Bootstrap SDK with all flag values on startup
- **DevTools Integration**: Show available flags in browser dev panels

See [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) for complete API documentation, request/response formats, and best practices.

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

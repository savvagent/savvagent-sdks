# Savvagent SDK Developer Guide

This guide is for developers building SDKs that integrate with the Savvagent feature flag platform. It covers the API endpoints, authentication, real-time updates, and best practices.

> **Note:** For official SDKs and examples, see the [savvagent-sdks repository](https://github.com/savvagent/savvagent-sdks).

## Table of Contents

- [Authentication](#authentication)
- [Core Endpoints](#core-endpoints)
  - [Flag Evaluation](#flag-evaluation)
  - [List All Flags (for Local Overrides)](#list-all-flags-for-local-overrides)
  - [Real-time Updates (SSE)](#real-time-updates-sse)
  - [Telemetry](#telemetry)
- [Backend Performance Features](#backend-performance-features)
- [SDK Architecture Recommendations](#sdk-architecture-recommendations)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## Authentication

Savvagent uses two types of API keys:

| Key Type | Prefix | Use Case | Security Level |
|----------|--------|----------|----------------|
| **SDK Key** | `sdk_` | Client-side apps (browsers, mobile) | Public - safe to embed |
| **Server Key** | `srv_` | Server-side apps (Node.js, Python) | Secret - never expose |

### Passing Authentication

All SDK endpoints accept authentication via headers:

```http
# Recommended: Authorization header
Authorization: Bearer sdk_your_key_here

# Alternative: X-SDK-Key header
X-SDK-Key: sdk_your_key_here
```

**Important:** Never pass API keys as query parameters. This prevents credentials from appearing in logs, browser history, and referrer headers.

---

## Core Endpoints

### Flag Evaluation

**Endpoint:** `POST /api/flags/{key}/evaluate`

**Authentication:** Required (SDK Key or JWT)

Evaluates a feature flag for a given context.

#### Request

```http
POST /api/flags/dark-mode/evaluate
Content-Type: application/json
Authorization: Bearer sdk_xxx

{
  "context": {
    "user_id": "user-123",
    "environment": "production",
    "attributes": {
      "plan": "premium",
      "country": "US"
    }
  }
}
```

#### Response

```json
{
  "key": "dark-mode",
  "enabled": true,
  "scope": "application",
  "variation": "treatment-a",
  "configuration": {
    "theme": "dark-blue",
    "contrast": "high"
  },
  "timestamp": 1700000000,
  "context": { ... }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | The flag key |
| `enabled` | boolean | Whether the flag is enabled for this context |
| `scope` | string | `"application"` or `"enterprise"` |
| `variation` | string? | The allocated variation name (if A/B testing) |
| `configuration` | object? | Dynamic configuration attached to the flag/variation |
| `timestamp` | number | Unix timestamp of evaluation |

#### Context Fields

| Field | Description |
|-------|-------------|
| `user_id` | Unique user identifier (required for rollouts) |
| `anonymous_id` | Alternative to user_id for anonymous users |
| `session_id` | Fallback identifier |
| `environment` | Target environment (e.g., "production", "staging") |
| `organization_id` | For multi-tenant apps |
| `application_id` | For hierarchical flag lookup |
| `language` | User's language code (e.g., "en", "es") |
| `attributes` | Custom attributes for targeting rules |

---

### List All Flags (for Local Overrides)

SDKs often need to fetch all available flags for local override functionality, offline mode, or initialization. Two endpoints are available:

#### Get Application Flags

**Endpoint:** `GET /api/sdk/flags`

**Authentication:** Required (SDK Key)

Returns all active flags for the SDK key's application, plus any enterprise-scoped flags for the organization.

##### Request

```http
GET /api/sdk/flags?environment=production
Authorization: Bearer sdk_xxx
```

##### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `environment` | string | `"development"` | Environment to evaluate enabled state for |

##### Response

```json
{
  "flags": [
    {
      "key": "dark-mode",
      "enabled": true,
      "scope": "application",
      "environments": {
        "production": {"enabled": true, "rollout_percentage": 100},
        "development": {"enabled": true, "rollout_percentage": 100}
      },
      "variations": null,
      "configuration": {"theme": "dark-blue"},
      "version": 5
    },
    {
      "key": "maintenance-mode",
      "enabled": false,
      "scope": "enterprise",
      "environments": {
        "production": {"enabled": false}
      },
      "variations": null,
      "version": 2
    }
  ],
  "count": 2,
  "organization_id": "org-uuid",
  "application_id": "app-uuid"
}
```

##### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `flags` | array | List of flag objects |
| `flags[].key` | string | Flag key |
| `flags[].enabled` | boolean | Enabled state for the requested environment |
| `flags[].scope` | string | `"application"` or `"enterprise"` |
| `flags[].environments` | object | Full environment configuration |
| `flags[].variations` | object? | Variation definitions (for A/B testing) |
| `flags[].configuration` | object? | Dynamic configuration |
| `flags[].version` | number | Flag version (for cache invalidation) |
| `count` | number | Total number of flags returned |
| `organization_id` | string | Organization ID |
| `application_id` | string? | Application ID (present for SDK key auth) |

#### Get Enterprise Flags Only

**Endpoint:** `GET /api/sdk/enterprise-flags`

**Authentication:** Required (SDK Key)

Returns only enterprise-scoped flags for the organization. Enterprise flags are shared across all applications.

##### Request

```http
GET /api/sdk/enterprise-flags?environment=production
Authorization: Bearer sdk_xxx
```

##### Response

Same structure as `/api/sdk/flags`, but only includes flags with `scope: "enterprise"` and `application_id` is always `null`.

#### Use Cases

1. **Local Override UI**: Display all available flags for developers to toggle locally
2. **Offline Mode**: Pre-fetch flags for mobile/desktop apps that need to work offline
3. **SDK Initialization**: Bootstrap SDK with all flag values on startup
4. **DevTools Integration**: Show available flags in browser dev panels

#### SDK Implementation Example

```javascript
class SavvagentClient {
  async getAllFlags(environment = 'development') {
    const response = await fetch(
      `${this.baseUrl}/api/sdk/flags?environment=${environment}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    const { flags } = await response.json();

    // Store in local cache for overrides
    this.flagCache = new Map(flags.map(f => [f.key, f]));
    return flags;
  }

  // Check if flag has local override before evaluating
  async isEnabled(key, context) {
    const override = this.localOverrides.get(key);
    if (override !== undefined) {
      return override; // Use local override
    }
    return this.evaluate(key, context);
  }
}
```

---

### Real-time Updates (SSE)

**Endpoint:** `GET /api/flags/stream`

**Authentication:** Required (SDK Key or JWT)

Server-Sent Events stream for real-time flag change notifications.

#### Connection

```javascript
// Using @microsoft/fetch-event-source (recommended)
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('https://api.savvagent.com/api/flags/stream', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${sdkKey}`,
  },
  onopen(response) {
    if (response.ok) {
      console.log('SSE connected');
    }
  },
  onmessage(event) {
    // Handle events
  },
  onerror(err) {
    // Handle errors, implement reconnection
  },
});
```

> **Why not native EventSource?**
> The browser's native `EventSource` API doesn't support custom headers. We require header-based authentication for security (no credentials in URLs).

#### Event Types

| Event | Description | Data |
|-------|-------------|------|
| `connected` | Connection established | `{"message": "...", "organization_id": "...", "application_id": "..."}` |
| `heartbeat` | Keep-alive (every 30s) | `"ping"` |
| `flag.created` | New flag created | [FlagNotification](#flagnotification) |
| `flag.updated` | Flag configuration changed | [FlagNotification](#flagnotification) |
| `flag.deleted` | Flag deleted/archived | [FlagNotification](#flagnotification) |

#### FlagNotification

```json
{
  "type": "flag.updated",
  "key": "dark-mode",
  "organization_id": "org-uuid",
  "application_id": "app-uuid",
  "environments": { ... },
  "status": "active",
  "version": 5,
  "realtime_enabled": true
}
```

#### Tenant Isolation

SSE connections are scoped to your SDK key's organization and application:
- You only receive notifications for flags in your org/app
- Enterprise-scoped flags (no application_id) are broadcast to all apps in the org
- Flags with `realtime_enabled: false` are not broadcast

#### Reconnection Strategy

Implement exponential backoff for reconnection:

```javascript
const reconnect = (attempt) => {
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
  setTimeout(() => connectSSE(), delay);
};
```

---

### Telemetry

SDKs should report evaluation metrics and errors back to Savvagent for analytics.

#### Track Evaluations

**Endpoint:** `POST /api/telemetry/evaluations`

Batch evaluation events for analytics.

```http
POST /api/telemetry/evaluations
Content-Type: application/json
Authorization: Bearer sdk_xxx

{
  "evaluations": [
    {
      "flag_key": "dark-mode",
      "result": true,
      "user_id": "user-123",
      "context": { ... },
      "timestamp": 1700000000
    }
  ]
}
```

**Best Practice:** Batch evaluations and send every 5-10 seconds to reduce network overhead.

#### Track Errors

**Endpoint:** `POST /api/telemetry/errors`

Report errors that occur while a flag is enabled (for AI-powered correlation).

```http
POST /api/telemetry/errors
Content-Type: application/json
Authorization: Bearer sdk_xxx

{
  "errors": [
    {
      "flag_key": "new-checkout",
      "flag_enabled": true,
      "error_type": "TypeError",
      "error_message": "Cannot read property 'x' of undefined",
      "stack_trace": "...",
      "context": { ... },
      "timestamp": 1700000000
    }
  ]
}
```

---

## Backend Performance Features

The Savvagent backend includes several performance optimizations that benefit SDK integrations:

### Database Connection Pool

The backend uses a configurable PostgreSQL connection pool to handle concurrent requests:

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Max Connections | 20 | `DATABASE_MAX_CONNECTIONS` |
| Acquire Timeout | 10s | `DATABASE_ACQUIRE_TIMEOUT_SECS` |
| Min Connections | 2 | (not configurable) |
| Idle Timeout | 600s | (not configurable) |

**SDK Impact:** With 20 concurrent connections, the backend can handle many simultaneous flag evaluations and SSE connections without blocking.

### SDK Key Caching

SDK key validation is cached in Redis for 5 minutes to reduce database load:

- **Cache TTL:** 300 seconds (5 minutes)
- **Cache Key Pattern:** `sdk_key_cache:{key_preview}`
- **Benefit:** After the first request, subsequent auth validations hit Redis instead of PostgreSQL

This means your SDK's first evaluation or SSE connection may take slightly longer, but subsequent requests will be faster.

### Pool Metrics Logging

The backend logs pool utilization metrics periodically (default: every 30 seconds):

```
pool_size=20 pool_idle=15 pool_active=5 pool_utilization="25.0%"
```

- **< 50% utilization:** Healthy (debug level)
- **50-80% utilization:** Normal load (info level)
- **> 80% utilization:** Under pressure (warning level)

**SDK Impact:** If you see 401 errors or timeouts during high load, it may indicate pool exhaustion on the backend.

### Authentication on Evaluate Endpoint

The `/api/flags/{key}/evaluate` endpoint now requires authentication (SDK key or JWT):

```http
# Required - one of these headers must be present
Authorization: Bearer sdk_xxx
Authorization: Bearer <jwt_token>
X-SDK-Key: sdk_xxx
```

**Breaking Change:** Unauthenticated requests to the evaluate endpoint will now return `401 Unauthorized`.

---

## SDK Architecture Recommendations

### Caching

```
┌─────────────────────────────────────────────┐
│                  SDK                         │
│  ┌─────────────┐    ┌───────────────────┐   │
│  │   Cache     │◄───│  SSE Listener     │   │
│  │  (in-mem)   │    │  (invalidates)    │   │
│  └──────┬──────┘    └───────────────────┘   │
│         │                                    │
│  ┌──────▼──────┐                            │
│  │  Evaluator  │─────► API (on cache miss)  │
│  └─────────────┘                            │
└─────────────────────────────────────────────┘
```

1. **Cache evaluations** with TTL (e.g., 5 minutes)
2. **Invalidate on SSE events** for instant updates
3. **Include version** in cache key to handle stale data

### Suggested Cache Key Format

```
flag:{org_id}:{flag_key}:{user_id}:{version}
```

### Offline Support

For mobile/desktop apps:
1. Persist cache to disk (localStorage, SQLite, etc.)
2. Use cached values when offline
3. Sync when connection restored

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | SDK Action |
|------|---------|------------|
| `200` | Success | Use response |
| `401` | Invalid/missing SDK key | Check configuration |
| `404` | Flag not found | Return default value |
| `429` | Rate limited | Back off and retry |
| `500` | Server error | Return cached/default value |

### Default Values

SDKs should accept default values for graceful degradation:

```javascript
// User provides default
const enabled = await client.isEnabled('new-feature', { default: false });
```

### Timeout Handling

Set reasonable timeouts (e.g., 3 seconds) and fall back to cached/default values:

```javascript
const evaluate = async (key, context, options = {}) => {
  const timeout = options.timeout || 3000;
  const defaultValue = options.default ?? false;

  try {
    const result = await Promise.race([
      fetchEvaluation(key, context),
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

---

## Best Practices

### 1. Initialize Once

Create a single SDK instance at application startup:

```javascript
// Good
const client = new SavvagentClient({ apiKey: 'sdk_xxx' });
export default client;

// Bad - creates multiple connections
function getFlag(key) {
  const client = new SavvagentClient({ apiKey: 'sdk_xxx' });
  return client.isEnabled(key);
}
```

### 2. Provide User Context

Always include user identifiers for consistent rollout behavior:

```javascript
// Good - consistent experience
client.isEnabled('feature', { userId: user.id });

// Bad - random on each evaluation
client.isEnabled('feature');
```

### 3. Handle SSE Gracefully

SSE is optional - the SDK should work without it:

```javascript
class Client {
  constructor(options) {
    this.cache = new Map();

    // SSE enhances but isn't required
    if (options.realtime !== false) {
      this.connectSSE().catch(() => {
        console.warn('SSE unavailable, using polling fallback');
      });
    }
  }
}
```

### 4. Batch Telemetry

Don't send telemetry on every evaluation:

```javascript
class TelemetryBatcher {
  constructor() {
    this.queue = [];
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  track(event) {
    this.queue.push(event);
    if (this.queue.length >= 100) {
      this.flush();
    }
  }

  flush() {
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0);
    sendTelemetry(events);
  }
}
```

### 5. Clean Shutdown

Properly close connections on shutdown:

```javascript
class Client {
  destroy() {
    this.sseController?.abort();
    this.telemetryBatcher.flush();
    this.cache.clear();
  }
}

// Usage
process.on('SIGTERM', () => client.destroy());
```

---

## API Reference Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/flags/{key}/evaluate` | POST | SDK/Server Key or JWT | Evaluate a flag |
| `/api/sdk/flags` | GET | SDK/Server Key | Get all flags for application + enterprise |
| `/api/sdk/enterprise-flags` | GET | SDK/Server Key | Get only enterprise-scoped flags |
| `/api/flags/stream` | GET | SDK/Server Key or JWT | Real-time SSE stream |
| `/api/telemetry/evaluations` | POST | SDK/Server Key | Report evaluations |
| `/api/telemetry/errors` | POST | SDK/Server Key | Report errors |

> **Note:** All endpoints require authentication. The evaluate and stream endpoints accept both SDK/Server keys and JWT tokens, allowing use from both SDKs and the admin UI. The `/api/sdk/*` endpoints are specifically designed for SDK consumption with local override support.

---

## Related Documentation

- [ADMIN-UI-DOGFOODING.md](./ADMIN-UI-DOGFOODING.md) - How the admin UI uses Savvagent flags internally
- [PRD.md](./PRD.md) - Product requirements and feature overview
- External: [savvagent-sdks](https://github.com/savvagent/savvagent-sdks) - Official SDK implementations

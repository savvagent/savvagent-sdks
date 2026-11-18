# Savvagent SDK Developer Guide

This guide is for developers building SDKs for Savvagent Flags, the feature flag product of [savvagent-services](https://github.com/savvagent/savvagent-services), whose Flags API is at `https://api.savvagent.com/flags`. It covers the API endpoints, authentication, real-time updates, and best practices.

> **Note:** For official SDKs and examples, see the [flags-sdks repository](https://github.com/savvagent/flags-sdks).

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
- [Cross-SDK behaviour](#cross-sdk-behaviour)

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

await fetchEventSource('https://api.savvagent.com/flags/api/flags/stream', {
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

## Cross-SDK behaviour

This matrix records how each SDK in this repository behaves where the SDKs could drift apart. Each cell links the test that pins it: the link goes to the test file, and the link text is the test's name. Where an SDK deliberately lacks a behaviour, the cell links a test that pins the absence, or a decision note below. When you change one of these behaviours, change the test and this table in the same pull request.

"TS (browser)" is `@savvagent/sdk` (`packages/typescript`). Its `./server` subpath, used by the Next.js, SvelteKit, Astro and React Router SDKs, wraps the same `FlagClient`, so the column covers them too. "Node" is `@savvagent/node-server`.

### Server and browser SDKs

| Behaviour | Rust | Go | Python | Java | Node | TS (browser) |
|---|---|---|---|---|---|---|
| **API key rule** | `sdk_` and `srv_`; others are rejected: [`client_accepts_a_server_key`](../packages/rust-server/tests/integration_test.rs), [`client_rejects_a_key_without_the_sdk_prefix`](../packages/rust-server/tests/integration_test.rs) | `sdk_` and `srv_`; others are rejected: [`TestServerKeyBuildsAClient`](../packages/go-server/server_key_test.go), [`TestOtherKeysAreRejected`](../packages/go-server/server_key_test.go) | `sdk_` and `srv_`; others are rejected: [`TestFlagClientConstruction.test_valid_server_key`](../packages/python-server/tests/test_client.py), [`test_invalid_key_prefix`](../packages/python-server/tests/test_client.py) | `sdk_` and `srv_`; others are rejected: [`ServerKeyTest.serverKeyBuildsAClient`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/ServerKeyTest.java), [`otherKeysAreRejected`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/ServerKeyTest.java) | `sdk_` and `srv_`; others are rejected: [`accepts a srv_ server key as well as an sdk_ client key`](../packages/node-server/src/behaviour-matrix.test.ts), [`should throw error for invalid API key`](../packages/node-server/src/client.test.ts) | `sdk_` only; `srv_` is rejected, because a browser must never hold the secret key: [`rejects a srv_ server key`](../packages/typescript/tests/behaviour-matrix.test.ts), [`should throw error for invalid API key`](../packages/typescript/tests/client.test.ts) |
| **Flag-key rule** (1–128 characters of `[A-Za-z0-9._-]`, not `.` or `..`; an invalid key gets its default with no request) | [`flag_keys_follow_the_server_rule_minus_dot_segments`](../packages/rust-server/src/client.rs), [`a_key_with_path_or_query_characters_is_refused_without_a_request`](../packages/rust-server/tests/integration_test.rs) | [`TestEvaluateRejectsInvalidFlagKey`](../packages/go-server/flagkey_test.go), [`TestEvaluateSendsValidFlagKeys`](../packages/go-server/flagkey_test.go) | [`TestInvalidFlagKey.test_invalid_key_returns_default_without_request`](../packages/python-server/tests/test_client.py), [`test_128_character_key_is_valid`](../packages/python-server/tests/test_client.py) | [`FlagKeyTest.invalidKeyMakesNoRequestAndReturnsDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagKeyTest.java), [`overlongKeyMakesNoRequestAndReturnsDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagKeyTest.java) | [`returns the default without a request for key %j`](../packages/node-server/src/client.test.ts), [`fetches valid key %j as one path segment`](../packages/node-server/src/client.test.ts) | [`returns an error result with the default and no request for key %j`](../packages/typescript/tests/client.test.ts), [`accepts a 128-character key`](../packages/typescript/tests/client.test.ts) |
| **Strict `enabled`**: a body without a boolean `enabled` is a failed lookup (default, `reason: "error"`), never cached | [`a_body_without_a_boolean_enabled_falls_back_and_is_not_cached`](../packages/rust-server/tests/integration_test.rs) | [`TestEvaluateWithoutBooleanEnabledIsAFailedLookup`](../packages/go-server/evaluate_contract_test.go) | [`TestEvaluateContract.test_body_without_boolean_enabled_is_a_failed_lookup`](../packages/python-server/tests/test_client.py) | [`EvaluateContractTest.bodyWithoutBooleanEnabledIsAFailedLookup`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/EvaluateContractTest.java) | [`treats %j as a failed lookup and does not cache it`](../packages/node-server/src/client.test.ts) | [`a body with %s is a failed lookup and is not cached`](../packages/typescript/tests/client.test.ts) |
| **Stale re-cache guard**: an invalidation while a request is in flight drops that request's result | [`an_invalidation_during_the_request_drops_its_result`](../packages/rust-server/tests/integration_test.rs) | [`TestInvalidationDuringRequestDropsTheCacheWrite`](../packages/go-server/inflight_invalidation_test.go) | [`test_sync_invalidation_during_request_drops_the_write`](../packages/python-server/tests/test_inflight_invalidation.py) | [`InFlightInvalidationTest.invalidationDuringTheRequestDropsTheCacheWrite`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/InFlightInvalidationTest.java) | [`an invalidation of the flag during the request drops its result`](../packages/node-server/src/client.test.ts) | [`a realtime update during the request drops its result`](../packages/typescript/tests/client.test.ts) |
| **Default host** `https://api.savvagent.com/flags` | [`default_base_url_is_the_flags_api`](../packages/rust-server/src/client.rs) | [`TestDefaultBaseURL`](../packages/go-server/base_url_test.go) | [`TestBaseUrl.test_default_base_url`](../packages/python-server/tests/test_client.py) | [`FlagClientTest.testConfigDefaults`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagClientTest.java) | [`defaults to https://api.savvagent.com/flags`](../packages/node-server/src/client.test.ts) | [`defaults to https://api.savvagent.com/flags`](../packages/typescript/tests/client.test.ts) |
| **Defaults: only configured keys count** (own properties only, in JS) | Map lookup, nothing inherited: [`an_unreachable_server_falls_back_to_the_default`](../packages/rust-server/tests/integration_test.rs) | Map lookup, nothing inherited: [`TestClient_IsEnabledUsesDefaultOnError`](../packages/go-server/client_test.go) | Dict lookup, and a non-string key is `False`: [`test_evaluate_uses_configured_default`](../packages/python-server/tests/test_client.py), [`test_non_string_key_returns_false_without_raising`](../packages/python-server/tests/test_client.py) | Map lookup, and a null key is `false`: [`FlagKeyTest.invalidKeyUsesConfiguredDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagKeyTest.java), [`nullKeyMakesNoRequestAndReturnsDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagKeyTest.java) | Own properties only: [`an inherited property name %j is not a default`](../packages/node-server/src/client.test.ts), [`inherited keys still never count as defaults`](../packages/node-server/src/server-parity.test.ts) | Own properties only: [`an inherited property name (%s) is not a default on an error path`](../packages/typescript/tests/client.test.ts), [`defaultFor` `never reads inherited properties`](../packages/typescript/tests/exports.test.ts) |
| **Defaults from an env var or a function**, computed once when the client is configured ([decision](#decision-defaults-from-an-env-var-or-a-function)) | `with_default_env`, `with_default_fn`: [`an_env_var_sets_the_default_served_when_the_server_is_unreachable`](../packages/rust-server/tests/ergonomics_test.rs), [`a_closure_sets_the_default_only_when_it_returns_some`](../packages/rust-server/tests/ergonomics_test.rs) | `SetDefaultFromEnv`, `SetDefaultFunc`: [`TestSetDefaultFromEnvParsesBooleans`](../packages/go-server/defaults_test.go), [`TestSetDefaultFuncCalledOnce`](../packages/go-server/defaults_test.go) | `set_default_from_env`, `default_from`: [`TestDefaultFromEnv.test_accepted_values`](../packages/python-server/tests/test_defaults_cached_static.py), [`TestDefaultFrom.test_called_once_when_set`](../packages/python-server/tests/test_defaults_cached_static.py) | `defaultFromEnv`, `defaultFrom`: [`DefaultsTest.envValuesParseAsBooleans`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/DefaultsTest.java), [`defaultFromCallsTheSupplierOnceAtTheCall`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/DefaultsTest.java); order-independent ([decision](#decision-defaults-from-an-env-var-or-a-function)): [`defaultsMapAndDerivedDefaultsGiveTheSameResultInEitherOrder`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/DefaultsTest.java) | `defaultsFrom`, `defaultFromEnv`: [`an env-derived default is used when evaluation fails`](../packages/node-server/src/server-parity.test.ts), [`each function runs once, when the client is built`](../packages/node-server/src/server-parity.test.ts) | Absent ([decision](#decision-server-parity-helpers-are-server-only)): [`has no static test client, cache-only read or env/function defaults`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Cache-only read**: returns the cached value or the default, never a request ([decision](#decision-cache-only-read-telemetry-and-threading)) | `is_enabled_cached`: [`the_sync_read_returns_a_cached_value`](../packages/rust-server/tests/ergonomics_test.rs), [`the_sync_read_falls_back_to_the_default_on_a_miss`](../packages/rust-server/tests/ergonomics_test.rs) | `IsEnabledCached`: [`TestIsEnabledCachedNeverRequests`](../packages/go-server/defaults_test.go) | `is_enabled_cached`: [`TestIsEnabledCachedSync.test_miss_returns_default_without_request`](../packages/python-server/tests/test_defaults_cached_static.py), [`test_hit_returns_cached_value_for_that_context`](../packages/python-server/tests/test_defaults_cached_static.py) | `isEnabledCached`: [`CachedReadTest.missReturnsTheDefaultWithoutARequest`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/CachedReadTest.java), [`hitReturnsTheCachedValueNotTheDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/CachedReadTest.java) | `isEnabledCached`: [`returns the configured default when nothing is cached, without a request`](../packages/node-server/src/server-parity.test.ts), [`returns the value cached for the same context`](../packages/node-server/src/server-parity.test.ts) | Absent ([decision](#decision-server-parity-helpers-are-server-only)): [`has no static test client, cache-only read or env/function defaults`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Static test client**: fixed values, no network, `reason: "static"` | `FlagClient::static_flags`: [`a_static_client_serves_fixed_values_without_the_network`](../packages/rust-server/tests/ergonomics_test.rs) | `NewStaticClient`: [`TestNewStaticClient`](../packages/go-server/defaults_test.go), [`TestNewStaticClientNeverTouchesTheNetwork`](../packages/go-server/defaults_test.go) | `FlagClient.static_flags`: [`TestStaticFlagsSync.test_serves_fixed_values_without_network`](../packages/python-server/tests/test_defaults_cached_static.py) | `FlagClient.staticFlags`: [`StaticClientTest.listedFlagsHaveTheirValueAndOthersAreFalse`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/StaticClientTest.java), [`neverTouchesTheNetwork`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/StaticClientTest.java) | `FlagClient.staticFlags`: [`serves fixed values and false for any other flag`](../packages/node-server/src/server-parity.test.ts), [`never touches the network`](../packages/node-server/src/server-parity.test.ts) | Absent ([decision](#decision-server-parity-helpers-are-server-only)): [`has no static test client, cache-only read or env/function defaults`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Evaluation metadata**: `version` and `scope` on evaluated and cached results | [`metadata_carries_the_version_and_scope_the_server_sends`](../packages/rust-server/tests/integration_test.rs) | [`TestEvaluateReportsVersionAndScope`](../packages/go-server/metadata_test.go), [`TestEvaluateDropsMalformedMetadata`](../packages/go-server/metadata_test.go) | [`TestResultMetadata.test_evaluated_and_cached_results_carry_version_and_scope`](../packages/python-server/tests/test_client.py) | [`MetadataTest.evaluatedResultCarriesVersionAndScope`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/MetadataTest.java), [`cachedResultCarriesTheSameVersionAndScope`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/MetadataTest.java) | [`reports the version and scope the server sends, and no field it does not`](../packages/node-server/src/client.test.ts), [`carries the same version, scope and flagId on a cached result`](../packages/node-server/src/client.test.ts) | [`are reported on a fresh result and the cached hit when sent`](../packages/typescript/tests/client.test.ts) |
| **trackError** and its context-less fallback | The caller passes `flag_enabled` in an `ErrorReport`, with no context, so no fallback is needed: [`errors_are_reported_with_their_text_truncated`](../packages/rust-server/tests/telemetry_test.rs), [`an_error_built_from_a_rust_error_names_its_type`](../packages/rust-server/tests/telemetry_test.rs) | Absent: Go sends no telemetry ([decision](#decision-no-telemetry-in-go-and-java)): [`TestFlagClientHasNoTrackError`](../packages/go-server/telemetry_absence_test.go), [`TestEnableTelemetrySendsNoTelemetry`](../packages/go-server/telemetry_absence_test.go) | Reports the value cached for the context; without a context, the flag's last evaluated value: [`test_track_error_uses_the_callers_context`](../packages/python-server/tests/test_client.py), [`TestSyncTrackErrorFallback.test_context_less_error_uses_last_value`](../packages/python-server/tests/test_track_error_fallback.py) | Absent: Java sends no telemetry ([decision](#decision-no-telemetry-in-go-and-java)): [`TelemetryAbsenceTest.flagClientHasNoTrackError`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/TelemetryAbsenceTest.java), [`telemetryOnByDefaultSendsNothing`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/TelemetryAbsenceTest.java) | Reports the value cached for the context; without a context, the flag's last evaluated value: [`trackError reports the value cached for its own context`](../packages/node-server/src/client.test.ts), [`trackError without its context reports the flag's last evaluation`](../packages/node-server/src/client.test.ts) | Always reports `flagEnabled: true`, with no fallback ([decision](#decision-server-parity-helpers-are-server-only)): [`trackError without a context reports flagEnabled true, with no last-value fallback`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Plain-HTTP `srv_` warning**: warns once per client for a `srv_` key and a non-`https`, non-loopback base URL | [`a_server_key_over_plain_http_warns_once_naming_the_scheme`](../packages/rust-server/tests/log_test.rs), [`no_plain_http_warning_for_https_loopback_or_a_client_key`](../packages/rust-server/tests/log_test.rs) | [`TestServerKeyOverPlainHTTPWarnsOnce`](../packages/go-server/server_key_test.go), [`TestNoPlainHTTPWarning`](../packages/go-server/server_key_test.go) | [`test_server_key_over_plain_http_warns_once`](../packages/python-server/tests/test_plain_http_warning.py), [`test_no_warning`](../packages/python-server/tests/test_plain_http_warning.py) | [`ServerKeyTest.serverKeyOverPlainHttpWarnsOnce`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/ServerKeyTest.java), [`noWarningForLoopbackHosts`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/ServerKeyTest.java) | [`warns once for a srv_ key over http to a non-loopback host`](../packages/node-server/src/server-parity.test.ts), [`does not warn for the loopback base URL %s`](../packages/node-server/src/server-parity.test.ts) | Not applicable: a `srv_` key is rejected: [`rejects a srv_ server key`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Evaluate response body cap** (1 MiB; a larger body is a failed lookup) | Capped: [`an_oversized_body_falls_back_and_opens_no_window`](../packages/rust-server/tests/backoff_test.rs), [`a_body_exactly_at_the_cap_is_read`](../packages/rust-server/tests/backoff_test.rs) | Capped: [`TestClient_Evaluate_OversizedResponseNotCached`](../packages/go-server/hardening_test.go) | Not capped ([decision](#decision-evaluate-response-body-cap)) | Not capped ([decision](#decision-evaluate-response-body-cap)) | Not capped ([decision](#decision-evaluate-response-body-cap)) | Not capped ([decision](#decision-evaluate-response-body-cap)) |
| **Realtime key validation**: an event whose key fails the flag-key rule invalidates nothing | Validated: [`events_for_other_flags_or_with_invalid_keys_leave_this_one_cached`](../packages/rust-server/tests/realtime_test.rs) | Validated: [`TestRealtimeEventsForOtherFlagsOrWithInvalidKeysLeaveThisOneCached`](../packages/go-server/realtime_test.go), [`TestApplyEventIgnoresHeartbeatsUnknownEventsAndBadKeys`](../packages/go-server/realtime_test.go) | Validated: [`test_sync_flag_event_with_invalid_keys_is_skipped`](../packages/python-server/tests/test_realtime_keys.py), [`test_async_flag_event_with_invalid_keys_is_skipped`](../packages/python-server/tests/test_realtime_keys.py) | Validated: [`RealtimeStreamTest.changedFlagKeyAcceptsOnlyAValidStringKey`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/RealtimeStreamTest.java), [`eventsForOtherFlagsOrWithInvalidKeysLeaveThisOneCached`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/RealtimeStreamTest.java) | Not validated ([decision](#decision-realtime-key-validation)): [`a realtime event invalidates the key it names without validating it`](../packages/node-server/src/behaviour-matrix.test.ts) | Not validated ([decision](#decision-realtime-key-validation)): [`a realtime event invalidates the key it names without validating it`](../packages/typescript/tests/behaviour-matrix.test.ts) |
| **Invalid-key reporting** ([decision](#decision-invalid-flag-key-reporting)) | Logged at `warn`; `evaluate` returns `Ok` with the default and `reason: "error"`. Rust has no error callback: [`an_invalid_flag_key_is_logged_and_answered_with_its_default_not_an_error`](../packages/rust-server/tests/log_test.rs) | `OnError` is called once, and `Evaluate` also returns a wrapped `ErrInvalidFlagKey` with the default result: [`TestEvaluateRejectsInvalidFlagKey`](../packages/go-server/flagkey_test.go) | `on_error` is called once with `InvalidFlagKeyError`: [`TestInvalidFlagKey.test_invalid_key_returns_default_without_request`](../packages/python-server/tests/test_client.py) | `onError` is called once (and the error is logged): [`FlagKeyTest.invalidKeyMakesNoRequestAndReturnsDefault`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/FlagKeyTest.java) | `onError` is called once: [`returns the default without a request for key %j`](../packages/node-server/src/client.test.ts) | `onError` is called once: [`returns an error result with the default and no request for key %j`](../packages/typescript/tests/client.test.ts) |

### Mobile SDKs

The Android and iOS SDKs have their own cache, polling and realtime designs, so only these rows apply to them. The iOS tests run under `swift test` on macOS, and the Android tests under `./gradlew test`; the [`mobile.yml`](../.github/workflows/mobile.yml) workflow runs both.

| Behaviour | Android | iOS |
|---|---|---|
| **API key rule** | No prefix check: any key builds a client. [`SavvagentClientTest.testClientInitialization`](../packages/android-sdk/src/test/kotlin/com/savvagent/sdk/SavvagentClientTest.kt) builds one with `test-key` | No prefix check: any key builds a client. [`SavvagentClientTests.testClientInitialization`](../packages/ios-sdk/Tests/SavvagentSDKTests/SavvagentClientTests.swift) builds one with `test-key` |
| **Flag-key rule** | [`SavvagentClientNetworkTest.testInvalidFlagKeysFailWithoutARequest`](../packages/android-sdk/src/test/kotlin/com/savvagent/sdk/SavvagentClientNetworkTest.kt), [`testValidFlagKeysAreSent`](../packages/android-sdk/src/test/kotlin/com/savvagent/sdk/SavvagentClientNetworkTest.kt) | [`SavvagentClientNetworkTests.testInvalidFlagKeysThrowWithoutARequest`](../packages/ios-sdk/Tests/SavvagentSDKTests/SavvagentClientNetworkTests.swift), [`testValidFlagKeysAreSent`](../packages/ios-sdk/Tests/SavvagentSDKTests/SavvagentClientNetworkTests.swift) |
| **Default host** `https://api.savvagent.com/flags` | [`SavvagentClientTest.testConfigDefaults`](../packages/android-sdk/src/test/kotlin/com/savvagent/sdk/SavvagentClientTest.kt) | [`SavvagentClientTests.testConfigDefaults`](../packages/ios-sdk/Tests/SavvagentSDKTests/SavvagentClientTests.swift) |
| **Invalid-key reporting** ([decision](#decision-invalid-flag-key-reporting)) | `evaluate` and `isEnabled` return `Result.failure(SavvagentException)`; `getVariation` returns its default. There is no error callback: [`testInvalidFlagKeysFailWithoutARequest`](../packages/android-sdk/src/test/kotlin/com/savvagent/sdk/SavvagentClientNetworkTest.kt) | `evaluate` throws `SavvagentError.invalidFlagKey`; `getVariation` returns its default. There is no error callback: [`testInvalidFlagKeysThrowWithoutARequest`](../packages/ios-sdk/Tests/SavvagentSDKTests/SavvagentClientNetworkTests.swift) |

### Decisions

#### Decision: defaults from an env var or a function

Env- and function-derived defaults are applied over the base defaults map whatever order they were set in. Node does so explicitly (`defaultsFrom` after `defaults`), and Java does the same: `defaultFrom` and `defaultFromEnv` results are kept apart and laid over `defaults(Map)` in `build()`, so the order of the builder calls does not matter. Rust, Go and Python merge. If two derived calls name the same flag the later call wins, and a derived value beats the same key in the base map. An unset or invalid env var, or an empty function result, leaves the base default in place. Calling Java's `defaults(Map)` twice still replaces the base map. Pinned by [`DefaultsTest.defaultsMapAndDerivedDefaultsGiveTheSameResultInEitherOrder`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/DefaultsTest.java) and [`sameKeyConflictLaterDerivedCallWinsAndDerivedBeatsBase`](../packages/java-server/src/test/java/com/savvagent/flags/sdk/DefaultsTest.java).

#### Decision: cache-only read, telemetry and threading

The cache-only read reports its cache-hit telemetry differently in each SDK. Node queues the event and defers the flush. Python's async client drops events beyond `MAX_NOWAIT_QUEUE`. Rust sends it directly. Go and Java send no telemetry. Python's async `is_enabled_cached`, and its realtime invalidation path, must be called on the event-loop thread; calling them from another thread is not supported.

#### Decision: invalid flag key reporting

Every SDK refuses an invalid flag key without a request and answers with the flag's default. Each one reports it through the channel it already uses for every other failed lookup, so a host sees an invalid key wherever it already sees errors:

- **Go, Python, Java, Node and TS** call the configured error callback once (`OnError`, `on_error`, `onError`). Go also returns the error, wrapped around `ErrInvalidFlagKey`, because every failed `Evaluate` in Go returns its error. That return stays; it is part of Go's published API.
- **Rust** logs a `warn` through `tracing`, and `evaluate` returns `Ok` with the default and `reason: "error"`. Rust has no error callback, and every other failed lookup in Rust is reported the same way, through `tracing`. Adding a callback only for invalid keys would make it the one failure that reaches it. Returning `Err` would break callers that unwrap `evaluate`, which is documented to return `Ok` for a failed lookup. So Rust keeps logging. A Rust error callback would be a new API covering every failure, and would need its own issue.
- **Android and iOS** have no error callback. They return the error (`Result.failure`, or a thrown `SavvagentError`) as they do for other failed lookups.

The cache-only reads (`is_enabled_cached`, `IsEnabledCached`, `isEnabledCached`) give an invalid key its default and report nothing.

#### Decision: evaluate response body cap

Rust and Go read at most 1 MiB of an evaluate response body, and a larger body is a failed lookup. Python, Java, Node and TS read the whole body. The server's evaluate response is a small JSON object, and the base URL is configured by the host, not by an end user. So an unbounded body is a defence-in-depth gap against a hostile or broken server at a trusted address, not a reachable attack. The other SDKs are not given a cap yet. Adding one is additive: a larger body becomes a failed lookup, as it is in Rust and Go. Recorded in [#45](https://github.com/savvagent/flags-sdks/issues/45).

#### Decision: realtime key validation

Rust, Go, Python and Java apply the flag-key rule to the key in a realtime event, and an event with an invalid key invalidates nothing. Node and TS pass the event's key straight to the cache. That is safe: invalidation only drops cache entries, so the worst an invalid key can do is drop nothing (no flag can have that key) or force one re-evaluation of a flag. The SDK builds no request from the event's key. The behaviour is recorded here, and pinned by the tests in the table, rather than changed. Recorded in [#45](https://github.com/savvagent/flags-sdks/issues/45).

#### Decision: no telemetry in Go and Java

The Go and Java SDKs send no telemetry, so they have no `trackError`. Each accepts `EnableTelemetry` / `enableTelemetry` for compatibility, and the setting has no effect. Flag health and auto-rollback need telemetry, so services that rely on them should use an SDK that sends it (Rust, Python, Node or the browser SDK). The absence tests in the table fail if either SDK gains a `trackError`, so that the change is deliberate and the matrix is updated with it.

#### Decision: server-parity helpers are server-only

The env- and function-derived defaults, the cache-only read, the static test client and the context-less `trackError` fallback are server SDK features, which [#31](https://github.com/savvagent/flags-sdks/issues/31) aligned across the server SDKs. `@savvagent/sdk`, the browser core, was outside that work. It does not take a `srv_` key, so the plain-HTTP warning does not apply to it, and its `trackError` reports `flagEnabled: true` whatever the flag's value. Adding any of these helpers to it would be additive. The absence tests in the table fail if it gains one, so that the change is deliberate and the matrix is updated with it.

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

- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - Integrating the SDKs into an application
- [savvagent-services](https://github.com/savvagent/savvagent-services) - The Flags API these SDKs talk to

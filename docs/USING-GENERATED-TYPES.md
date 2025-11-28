# Using Generated API Types in the SDK

This guide explains how the auto-generated TypeScript types from the OpenAPI spec are (and should be) used in the SDK.

## Current State

The generated types are located at:
```
packages/typescript/src/generated/api-types.ts
```

**Status:** ⚠️ Generated but **not yet integrated** into the SDK code.

## What the Generated Types Provide

The `api-types.ts` file contains TypeScript interfaces matching the Rust backend models:

```typescript
export interface components {
  schemas: {
    // Flag types
    FlagEvaluationResponse: { ... }
    FeatureFlag: { ... }
    CreateFlag: { ... }
    UpdateFlag: { ... }
    EvaluateFlag: { ... }

    // Telemetry types
    FlagEvaluation: { ... }
    FlagError: { ... }

    // Other types
    ArchivedFlag: { ... }
    FlagAuditLog: { ... }
    UserActivity: { ... }
  }
}
```

## Integration Pattern

### Phase 1: Response Typing (Recommended First Step)

**Current Code** (client.ts:222-245):
```typescript
async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  // ... fetch setup ...

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: contextPayload }),
  });

  const data = await response.json(); // ❌ Type is 'any'
  const value = data.enabled || false;

  // ... rest of logic
}
```

**With Generated Types**:
```typescript
import { components } from './generated/api-types';

type ApiResponse = components['schemas']['FlagEvaluationResponse'];

async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  // ... fetch setup ...

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: contextPayload }),
  });

  const data: ApiResponse = await response.json(); // ✅ Type-safe!
  const value = data.enabled || false;

  // Now TypeScript knows:
  // - data.enabled: boolean
  // - data.key: string
  // - data.scope?: string
  // - data.configuration?: JsonValue
  // - data.variation?: string
  // - data.timestamp: number

  // ... rest of logic
}
```

**Benefits:**
- ✅ Compile-time type checking
- ✅ IDE autocomplete for response properties
- ✅ Catches API contract changes at build time

### Phase 2: Request Typing

**Current Code**:
```typescript
const contextPayload = {
  user_id: context?.user_id,
  anonymous_id: context?.anonymous_id,
  session_id: context?.session_id,
  attributes: context?.attributes,
  // ...
};

fetch(url, {
  body: JSON.stringify({ context: contextPayload }), // ❌ Untyped
});
```

**With Generated Types**:
```typescript
import { components } from './generated/api-types';

type EvaluateRequest = components['schemas']['EvaluateFlag'];

async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  const requestBody: EvaluateRequest = {
    context: {
      user_id: context?.user_id,
      anonymous_id: context?.anonymous_id,
      session_id: context?.session_id,
      attributes: context?.attributes,
      environment: context?.environment,
      language: context?.language,
    }
  };

  fetch(url, {
    body: JSON.stringify(requestBody), // ✅ Type-safe request
  });
}
```

### Phase 3: Telemetry Type Alignment

**Current SDK Types** (types.ts):
```typescript
export interface EvaluationEvent {
  flag_id: string;
  flag_key: string;
  result: boolean;
  context?: FlagContext;
  duration_ms?: number;
  timestamp: number;
  trace_id?: string;
}
```

**Backend Type** (from api-types.ts):
```typescript
FlagEvaluation: {
  id: string;               // UUID
  organization_id: string;  // UUID
  flag_id: string;          // UUID
  result: boolean;
  context?: JsonValue;
  duration_ms?: number;
  trace_id?: string;
  timestamp: string;        // date-time format
}
```

**Alignment Strategy**:

Option A: **Transform SDK types to API types**
```typescript
import { components } from './generated/api-types';

type ApiFlagEvaluation = components['schemas']['FlagEvaluation'];

// In TelemetryService
private mapToApiFormat(event: EvaluationEvent): ApiFlagEvaluation {
  return {
    id: crypto.randomUUID(),
    organization_id: this.organizationId,
    flag_id: event.flag_id,
    result: event.result,
    context: event.context,
    duration_ms: event.duration_ms,
    trace_id: event.trace_id,
    timestamp: new Date(event.timestamp).toISOString(),
  };
}
```

Option B: **Extend SDK types from API types** (preferred)
```typescript
import { components } from './generated/api-types';

// Keep SDK's simpler interface for developers
export interface EvaluationEvent {
  flag_id: string;
  flag_key: string;
  result: boolean;
  context?: FlagContext;
  duration_ms?: number;
  timestamp: number;
  trace_id?: string;
}

// Internal mapping ensures API contract compliance
type ApiEvaluation = components['schemas']['FlagEvaluation'];
```

### Phase 4: Export for Advanced Users

**index.ts**:
```typescript
// SDK's developer-friendly types
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
} from './types';

// Re-export generated API types for advanced use cases
export type {
  FlagEvaluationResponse,
  FeatureFlag,
  CreateFlag,
  UpdateFlag,
  FlagEvaluation,
  FlagError,
} from './generated/api-types';

// Or export as namespace
export type * as ApiTypes from './generated/api-types';
```

**Usage by SDK consumers**:
```typescript
import { FlagClient, ApiTypes } from '@savvagent/sdk';

// Advanced: Direct API response type
function processApiResponse(response: ApiTypes.components['schemas']['FlagEvaluationResponse']) {
  // ...
}
```

## Recommended Integration Steps

### Step 1: Add Type Assertions (Non-Breaking)

```typescript
// packages/typescript/src/client.ts

import { components } from './generated/api-types';

type ApiEvaluateResponse = components['schemas']['FlagEvaluationResponse'];

async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  // ... existing code ...

  const response = await fetch(url, { ... });
  const data: ApiEvaluateResponse = await response.json(); // ✅ Add type

  // Rest stays the same
  const value = data.enabled || false;
  // ...
}
```

**Benefit:** Zero runtime changes, compile-time safety

### Step 2: Add Runtime Validation (Optional)

```typescript
// packages/typescript/src/utils/validators.ts

import { components } from '../generated/api-types';

type ApiResponse = components['schemas']['FlagEvaluationResponse'];

export function validateEvaluateResponse(data: unknown): data is ApiResponse {
  if (typeof data !== 'object' || data === null) return false;

  const obj = data as Record<string, unknown>;

  return (
    typeof obj.key === 'string' &&
    typeof obj.enabled === 'boolean' &&
    typeof obj.timestamp === 'number'
  );
}

// Usage in client.ts
const data = await response.json();
if (!validateEvaluateResponse(data)) {
  throw new Error('Invalid API response format');
}
// Now TypeScript knows data is ApiResponse type
```

### Step 3: Type Telemetry Payloads

```typescript
// packages/typescript/src/telemetry.ts

import { components } from './generated/api-types';

type ApiEvaluationBatch = {
  events: components['schemas']['FlagEvaluation'][];
};

async trackEvaluations(events: EvaluationEvent[]): Promise<void> {
  const payload: ApiEvaluationBatch = {
    events: events.map(e => this.mapToApiFormat(e))
  };

  await fetch(`${this.baseUrl}/api/telemetry/evaluations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload), // ✅ Type-safe
  });
}
```

## Type Mapping Reference

### SDK Types → API Types

| SDK Type | API Type | Purpose |
|----------|----------|---------|
| `FlagContext` | `EvaluateFlag['context']` | Request context |
| `FlagEvaluationResult` | `FlagEvaluationResponse` | Response format |
| `EvaluationEvent` | `FlagEvaluation` | Telemetry event |
| `ErrorEvent` | `FlagError` | Error telemetry |

### When to Use Which Type

**Use SDK Types When:**
- ✅ Building public SDK API
- ✅ Developer-facing interfaces
- ✅ Simplifying complex backend types
- ✅ Maintaining backward compatibility

**Use Generated API Types When:**
- ✅ Making HTTP requests
- ✅ Parsing HTTP responses
- ✅ Ensuring API contract compliance
- ✅ Internal implementation details

## Example: Complete Integration

**packages/typescript/src/client.ts** (lines 209-250):

```typescript
import { components } from './generated/api-types';

type ApiEvaluateResponse = components['schemas']['FlagEvaluationResponse'];
type ApiEvaluateRequest = components['schemas']['EvaluateFlag'];

export class FlagClient {
  async evaluate(
    flagKey: string,
    context?: FlagContext
  ): Promise<FlagEvaluationResult> {
    const url = `${this.config.baseUrl}/api/flags/${flagKey}/evaluate`;

    // Build request using generated type
    const requestBody: ApiEvaluateRequest = {
      context: context ? {
        user_id: context.user_id,
        anonymous_id: context.anonymous_id,
        session_id: context.session_id,
        application_id: context.application_id,
        language: context.language,
        attributes: context.attributes,
        environment: context.environment,
      } : undefined
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Flag evaluation failed: ${response.statusText}`);
    }

    // Parse response using generated type
    const data: ApiEvaluateResponse = await response.json();

    // Return SDK's developer-friendly format
    return {
      key: data.key,
      value: data.enabled,
      reason: 'evaluated',
      metadata: {
        scope: data.scope,
        configuration: data.configuration,
        variation: data.variation,
        timestamp: data.timestamp,
      }
    };
  }
}
```

## Benefits Summary

### Compile-Time Benefits
- ✅ Catch API contract changes during build
- ✅ IDE autocomplete for all API fields
- ✅ Type errors when accessing non-existent properties
- ✅ Refactoring safety

### Runtime Benefits
- ✅ Clear error messages when response format changes
- ✅ Optional runtime validation
- ✅ Documentation through types

### Maintenance Benefits
- ✅ Single source of truth (OpenAPI spec)
- ✅ Automatic type updates via sync workflow
- ✅ No manual type copying between repos

## Migration Checklist

- [ ] Add type imports from `./generated/api-types`
- [ ] Type all API responses in client.ts
- [ ] Type all API requests
- [ ] Align telemetry types with backend
- [ ] Add runtime validation (optional)
- [ ] Export generated types in index.ts
- [ ] Update SDK documentation
- [ ] Add tests for type compatibility

## Related Files

- `packages/typescript/src/generated/api-types.ts` - Generated types (auto-synced)
- `packages/typescript/src/types.ts` - SDK's developer-facing types
- `packages/typescript/src/client.ts` - Main client (integration point)
- `packages/typescript/src/telemetry.ts` - Telemetry service (integration point)
- `../../savvagent-flags/docs/openapi.json` - Source OpenAPI spec

## Related Documentation

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Official API specification
- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - SDK integration guide
- [INTEGRATION-EXAMPLE.md](./INTEGRATION-EXAMPLE.md) - Before/after examples

## Further Reading

- [SDK Type Sync Guide](../../savvagent-flags/docs/SDK-TYPE-SYNC.md)
- [openapi-typescript Documentation](https://github.com/drwpow/openapi-typescript)
- [TypeScript Utility Types](https://www.typescriptlang.org/docs/handbook/utility-types.html)

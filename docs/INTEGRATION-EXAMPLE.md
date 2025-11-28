# Generated Types Integration - Practical Example

This is a side-by-side comparison showing how to integrate the generated API types into the SDK.

## Before: Current Implementation

**File:** `packages/typescript/src/client.ts`

```typescript
// ❌ Current code - no type safety
async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  const url = `${this.config.baseUrl}/api/flags/${flagKey}/evaluate`;

  const contextPayload = {
    user_id: context?.user_id,
    anonymous_id: context?.anonymous_id || this.anonymousId,
    session_id: context?.session_id || this.sessionId,
    application_id: context?.application_id || this.config.applicationId,
    language: context?.language || this.language,
    attributes: context?.attributes,
    environment: context?.environment,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ context: contextPayload }),
  });

  if (!response.ok) {
    throw new Error(`Flag evaluation failed: ${response.statusText}`);
  }

  const data = await response.json();  // ⚠️ Type is 'any'
  const value = data.enabled || false;

  // ... cache and return logic
}
```

**Problems:**
- ❌ `data` is typed as `any`
- ❌ No autocomplete for `data.enabled`, `data.scope`, etc.
- ❌ Typos like `data.enabeld` won't be caught
- ❌ API changes won't be detected at compile time
- ❌ Request body structure not validated

## After: With Generated Types

**File:** `packages/typescript/src/client.ts`

```typescript
// ✅ With type safety
import { components } from './generated/api-types';

// Create type aliases for readability
type ApiEvaluateRequest = components['schemas']['EvaluateFlag'];
type ApiEvaluateResponse = components['schemas']['FlagEvaluationResponse'];

async evaluate(flagKey: string, context?: FlagContext): Promise<FlagEvaluationResult> {
  const url = `${this.config.baseUrl}/api/flags/${flagKey}/evaluate`;

  // ✅ Request body is type-checked
  const requestBody: ApiEvaluateRequest = {
    context: {
      user_id: context?.user_id,
      anonymous_id: context?.anonymous_id || this.anonymousId,
      session_id: context?.session_id || this.sessionId,
      application_id: context?.application_id || this.config.applicationId,
      language: context?.language || this.language,
      attributes: context?.attributes,
      environment: context?.environment,
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody), // ✅ Type-safe
  });

  if (!response.ok) {
    throw new Error(`Flag evaluation failed: ${response.statusText}`);
  }

  // ✅ Response is type-checked
  const data: ApiEvaluateResponse = await response.json();
  const value = data.enabled || false;

  // ✅ TypeScript now knows all these fields exist:
  // - data.key: string
  // - data.enabled: boolean
  // - data.scope?: string
  // - data.configuration?: JsonValue
  // - data.variation?: string
  // - data.timestamp: number

  // ... cache and return logic
}
```

**Benefits:**
- ✅ Full type checking for requests and responses
- ✅ IDE autocomplete for all API fields
- ✅ Compile errors if API contract changes
- ✅ Self-documenting code

## Real-World Example: Handling New API Fields

### Scenario: Backend adds `rollout_percentage` field

**Step 1:** Backend adds field to Rust model
```rust
// backend/src/models/flag.rs
#[derive(Debug, Serialize, ToSchema)]
pub struct FlagEvaluationResponse {
    pub key: String,
    pub enabled: bool,
    pub rollout_percentage: Option<f32>,  // NEW FIELD
    // ... rest
}
```

**Step 2:** Sync runs automatically
```bash
# GitHub Action runs
just sync-sdk-types
# Regenerates api-types.ts with new field
```

**Step 3:** TypeScript types update automatically
```typescript
// packages/typescript/src/generated/api-types.ts (auto-generated)
FlagEvaluationResponse: {
  key: string;
  enabled: boolean;
  rollout_percentage?: number;  // ✅ New field available
  // ...
}
```

**Step 4:** SDK developers get autocomplete immediately
```typescript
const data: ApiEvaluateResponse = await response.json();

// ✅ IDE shows new field in autocomplete
console.log(data.rollout_percentage); // number | undefined

// Can now use it in SDK
return {
  value: data.enabled,
  metadata: {
    rolloutPercentage: data.rollout_percentage, // ✅ Type-safe
  }
};
```

## Telemetry Example

### Before (Untyped)

**File:** `packages/typescript/src/telemetry.ts`

```typescript
async trackEvaluations(events: EvaluationEvent[]): Promise<void> {
  const response = await fetch(`${this.baseUrl}/api/telemetry/evaluations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events }), // ❌ Untyped
  });
}
```

### After (Typed)

```typescript
import { components } from './generated/api-types';

type ApiFlagEvaluation = components['schemas']['FlagEvaluation'];
type EvaluationBatch = {
  events: ApiFlagEvaluation[];
};

async trackEvaluations(events: EvaluationEvent[]): Promise<void> {
  // ✅ Transform SDK events to API format
  const apiEvents: ApiFlagEvaluation[] = events.map(event => ({
    id: crypto.randomUUID(),
    organization_id: this.organizationId,
    flag_id: event.flag_id,
    result: event.result,
    context: event.context,
    duration_ms: event.duration_ms,
    trace_id: event.trace_id,
    timestamp: new Date(event.timestamp).toISOString(),
  }));

  const payload: EvaluationBatch = {
    events: apiEvents
  };

  const response = await fetch(`${this.baseUrl}/api/telemetry/evaluations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload), // ✅ Type-safe
  });
}
```

**Benefits:**
- ✅ Ensures telemetry events match backend expectations
- ✅ Catches field name mismatches at compile time
- ✅ Documents required vs optional fields

## Type Utility Helpers

Create helper types for common patterns:

**File:** `packages/typescript/src/utils/api-helpers.ts`

```typescript
import { components } from '../generated/api-types';

// Shorthand type aliases
export type ApiSchemas = components['schemas'];

// Extract specific types
export type FlagResponse = ApiSchemas['FlagEvaluationResponse'];
export type FlagRequest = ApiSchemas['EvaluateFlag'];
export type FlagModel = ApiSchemas['FeatureFlag'];

// Generic API response wrapper
export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// Type-safe fetch wrapper
export async function apiFetch<T>(
  url: string,
  options: RequestInit
): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// Usage in client.ts
import { apiFetch, FlagResponse } from './utils/api-helpers';

async evaluate(...): Promise<FlagEvaluationResult> {
  const data = await apiFetch<FlagResponse>(url, {
    method: 'POST',
    // ...
  });

  // data is typed as FlagResponse
  return { value: data.enabled };
}
```

## Testing with Generated Types

```typescript
// packages/typescript/tests/client.test.ts
import { components } from '../src/generated/api-types';

type MockResponse = components['schemas']['FlagEvaluationResponse'];

describe('FlagClient.evaluate', () => {
  it('should parse API response correctly', async () => {
    // ✅ Mock response matches API contract
    const mockApiResponse: MockResponse = {
      key: 'test-flag',
      enabled: true,
      scope: 'application',
      timestamp: Date.now(),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    const client = new FlagClient({ apiKey: 'test' });
    const result = await client.evaluate('test-flag');

    expect(result.value).toBe(true);
  });

  it('should handle new API fields gracefully', async () => {
    const mockApiResponse: MockResponse = {
      key: 'test-flag',
      enabled: true,
      scope: 'application',
      timestamp: Date.now(),
      configuration: { theme: 'dark' }, // ✅ Optional field
      variation: 'variant-a', // ✅ Optional field
    };

    // Test that SDK doesn't break with new fields
  });
});
```

## Migration Checklist

Quick steps to integrate generated types:

```bash
# 1. Ensure types are generated
cd ~/dev/savvagent-sdks
pnpm run sync:types

# 2. Add type imports
# Edit packages/typescript/src/client.ts
# Add: import { components } from './generated/api-types';

# 3. Create type aliases for readability
# type ApiResponse = components['schemas']['FlagEvaluationResponse'];

# 4. Type API responses
# const data: ApiResponse = await response.json();

# 5. Test that everything compiles
pnpm --filter @savvagent/sdk build

# 6. Update tests to use typed mocks

# 7. Export types for consumers
# Edit packages/typescript/src/index.ts
# Add: export type { components } from './generated/api-types';
```

## Summary

**Current State:**
- ❌ No type safety for API calls
- ❌ Runtime-only error detection
- ❌ Manual type maintenance

**With Generated Types:**
- ✅ Compile-time type checking
- ✅ Automatic sync with backend changes
- ✅ Better developer experience
- ✅ Self-documenting code

The generated types provide a strong contract between the backend and SDK, catching bugs early and improving maintainability.

## Related Documentation

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Official API specification
- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - SDK integration guide
- [USING-GENERATED-TYPES.md](./USING-GENERATED-TYPES.md) - Using generated types

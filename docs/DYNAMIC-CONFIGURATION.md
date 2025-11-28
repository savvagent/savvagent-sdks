# Dynamic Configuration Support

**Last Updated:** November 2024

This document describes Savvagent's dynamic configuration capabilities for feature flags and compares them with industry leaders like Split.io and Harness.

---

## Table of Contents

1. [Overview](#overview)
2. [What is Dynamic Configuration?](#what-is-dynamic-configuration)
3. [Current Capabilities](#current-capabilities)
4. [Industry Comparison](#industry-comparison)
5. [Gap Analysis](#gap-analysis)
6. [Proposed Enhancements](#proposed-enhancements)
7. [Implementation Plan](#implementation-plan)
8. [Use Cases](#use-cases)

---

## Overview

Dynamic configuration allows feature flags to return not just boolean values (enabled/disabled) but also **structured configuration data** (JSON objects, key-value pairs, numbers, strings) that can control feature behavior without code changes.

**Key Benefits:**
- 🎨 **UI Customization**: Change colors, sizes, text without deployments
- ⚙️ **Backend Tuning**: Adjust algorithm weights, timeouts, retry logic
- 🧪 **A/B Testing**: Test different parameter combinations
- 🚀 **Rapid Iteration**: Modify feature behavior instantly
- 💰 **Cost Optimization**: Tune resource limits dynamically

---

## What is Dynamic Configuration?

### Traditional Boolean Flags

```javascript
// Traditional approach: just on/off
const newCheckoutEnabled = await client.isEnabled('new-checkout');

if (newCheckoutEnabled) {
  showNewCheckout();
} else {
  showOldCheckout();
}
```

### Dynamic Configuration Flags

```javascript
// Modern approach: configuration + control
const checkoutConfig = await client.getConfig('checkout-experience');

renderCheckout({
  primaryColor: checkoutConfig.primaryColor || '#007bff',
  buttonSize: checkoutConfig.buttonSize || 'medium',
  enableExpressCheckout: checkoutConfig.expressCheckout || false,
  maxRetries: checkoutConfig.retryAttempts || 3,
  timeoutMs: checkoutConfig.timeout || 5000,
});
```

**Advantages:**
1. **No code changes** needed to modify feature parameters
2. **Gradual rollouts** of configuration changes (percentage-based)
3. **A/B testing** different configurations simultaneously
4. **Targeted configurations** per user segment, geo, etc.

---

## Current Capabilities

### What Savvagent Currently Supports

#### 1. Environment-Specific Configurations ✅

Flags support per-environment settings stored as JSONB in the `environments` column.

**Current Structure:**
```json
{
  "development": {
    "enabled": true,
    "rollout_percentage": 100
  },
  "staging": {
    "enabled": true,
    "rollout_percentage": 50
  },
  "production": {
    "enabled": true,
    "rollout_percentage": 25,
    "targeting_rules": {
      "geo": {
        "countries": ["US", "CA"],
        "operator": "in"
      },
      "language": {
        "enabled": true,
        "languages": ["en", "es"],
        "operator": "in"
      }
    }
  }
}
```

**Supported per environment:**
- ✅ `enabled` (boolean)
- ✅ `rollout_percentage` (0-100)
- ✅ `targeting_rules` (geo, language)

#### 2. Geolocation Targeting ✅

Flags can be targeted by:
- Countries (`["US", "CA", "GB"]`)
- Cities (`["New York", "London"]`)
- Timezones (`["America/New_York"]`)
- Latitude/longitude ranges
- Operators: `"in"` or `"not_in"`

**Reference:** `backend/src/api/flags.rs:754` (evaluate_geo_targeting)

#### 3. Language Targeting ✅

Flags can be targeted by user language:
- Language codes (`["en", "es", "fr"]`)
- Prefix matching (`"en"` matches `"en-US"`, `"en-GB"`)
- Exact matching (`"en-US"` only)
- Operators: `"in"` or `"not_in"`

**Reference:** `backend/src/utils/language.rs:152` (evaluate_language_targeting)

#### 4. Sticky Rollouts ✅

Consistent hashing ensures users always see the same flag state:
- Based on `user_id` or `anonymous_id`
- Hash-based bucket assignment (0-99)
- Documented in: `docs/STICKY-FLAGS.md`

#### 5. Scheduled Flags ✅

Time-based flag activation:
- `scheduled_start_at` - When flag becomes active
- `scheduled_end_at` - When flag auto-disables
- `scheduling_timezone` - Timezone for schedule
- `auto_disable_after_end` - Whether to auto-disable

**Reference:** `docs/FLAG-SCHEDULING.md`

---

### What We DON'T Currently Support ❌

#### 1. Arbitrary JSON Configuration ❌

**Missing:** Ability to attach custom JSON payloads to flag variations.

**What we can't do today:**
```json
{
  "production": {
    "enabled": true,
    "config": {
      "theme": {
        "primaryColor": "#007bff",
        "secondaryColor": "#6c757d",
        "fontSize": "16px"
      },
      "features": {
        "expressCheckout": true,
        "guestCheckout": false
      },
      "limits": {
        "maxItems": 100,
        "timeout": 5000
      }
    }
  }
}
```

#### 2. Multi-Variant Flags ❌

**Missing:** Support for multiple treatments/variations beyond boolean.

**What Split.io/Harness support:**
```json
{
  "treatments": {
    "control": {
      "config": { "algorithm": "standard", "weight": 1.0 }
    },
    "variant_a": {
      "config": { "algorithm": "ml_v1", "weight": 1.5 }
    },
    "variant_b": {
      "config": { "algorithm": "ml_v2", "weight": 2.0 }
    }
  },
  "allocation": {
    "control": 70,
    "variant_a": 15,
    "variant_b": 15
  }
}
```

**We only support:**
- Boolean (enabled/disabled)
- Single rollout percentage

#### 3. Attribute-Based Targeting ❌

**Missing:** Targeting rules based on arbitrary user attributes.

**What competitors support:**
```json
{
  "targeting_rules": {
    "user_attributes": {
      "plan": { "operator": "in", "values": ["premium", "enterprise"] },
      "age": { "operator": ">=", "value": 18 },
      "email": { "operator": "endsWith", "value": "@company.com" }
    }
  }
}
```

**We only support:**
- Geolocation (country, city, timezone)
- Language
- Rollout percentage

#### 4. User Segments ❌

**Missing:** Reusable user segments for targeting.

**What competitors support:**
```json
{
  "segments": ["beta_users", "enterprise_customers", "power_users"],
  "targeting": {
    "include_segments": ["beta_users"],
    "exclude_segments": ["blocked_users"]
  }
}
```

#### 5. SDK Config Retrieval ❌

**Missing:** SDK method to retrieve configuration values.

**What we need:**
```typescript
// Current SDK (boolean only)
const enabled = await client.isEnabled('new-checkout');

// Proposed SDK (with config)
const config = await client.getConfig('new-checkout');
// Returns: { enabled: true, config: { theme: {...}, limits: {...} } }
```

---

## Industry Comparison

### Split.io Dynamic Configuration

**Capabilities:**
- ✅ Attach JSON configs to treatments (up to 1KB per flag)
- ✅ Key-value pairs or full JSON format
- ✅ Multi-variant treatments (control, A, B, C, ...)
- ✅ Percentage-based allocation across treatments
- ✅ Attribute-based targeting (custom attributes)
- ✅ User segments (reusable audiences)
- ✅ Dynamic configuration UI (no code changes)

**Example Flag Definition:**
```json
{
  "treatments": {
    "on": {
      "configuration": "{\"color\": \"blue\", \"size\": \"large\"}"
    },
    "off": {
      "configuration": "{\"color\": \"gray\", \"size\": \"medium\"}"
    }
  },
  "default_treatment": "off",
  "rules": [
    {
      "condition": {
        "matcherGroup": {
          "matchers": [
            {
              "attribute": "plan",
              "matcherType": "IN_LIST",
              "values": ["premium", "enterprise"]
            }
          ]
        }
      },
      "buckets": [
        { "treatment": "on", "size": 100 }
      ]
    }
  ]
}
```

**SDK Usage:**
```javascript
const treatment = client.getTreatment('checkout-experience');
const config = client.getTreatmentWithConfig('checkout-experience');

console.log(config);
// {
//   treatment: 'on',
//   config: { color: 'blue', size: 'large' }
// }
```

---

### Harness Feature Flags

**Capabilities:**
- ✅ Multi-variate flags (boolean, string, number, JSON)
- ✅ Dynamic configuration (JSON or key-value)
- ✅ Attribute-based targeting (custom attributes)
- ✅ Target groups (reusable segments)
- ✅ Percentage rollouts per variation
- ✅ Flag dependencies (prerequisite flags)
- ✅ Variation-specific configurations

**Example Flag Definition:**
```json
{
  "kind": "multivariate",
  "variations": [
    {
      "identifier": "control",
      "value": "false",
      "configuration": {
        "theme": "default",
        "maxRetries": 3
      }
    },
    {
      "identifier": "blue_theme",
      "value": "true",
      "configuration": {
        "theme": "blue",
        "maxRetries": 5
      }
    }
  ],
  "rules": [
    {
      "priority": 1,
      "clauses": [
        {
          "attribute": "identifier",
          "op": "segmentMatch",
          "values": ["beta_users"]
        }
      ],
      "serve": {
        "variation": "blue_theme"
      }
    }
  ],
  "defaultServe": {
    "variation": "control"
  }
}
```

**SDK Usage:**
```javascript
const variation = client.variation('checkout-experience', 'control');
const config = client.jsonVariation('checkout-config', {});

console.log(config);
// { theme: 'blue', maxRetries: 5 }
```

---

### Savvagent (Current State)

**Capabilities:**
- ✅ Boolean flags (enabled/disabled)
- ✅ Percentage rollouts (sticky, consistent hashing)
- ✅ Environment-specific settings
- ✅ Geolocation targeting (country, city, timezone)
- ✅ Language targeting
- ✅ Flag scheduling (time-based activation)
- ✅ Enterprise vs application scope
- ❌ **Multi-variant flags**
- ❌ **Arbitrary JSON configuration**
- ❌ **Attribute-based targeting**
- ❌ **User segments**
- ❌ **Flag dependencies**

**Current SDK Usage:**
```typescript
const enabled = await client.isEnabled('new-checkout', {
  userId: 'user-123',
  attributes: {
    environment: 'production',
    language: 'en-US'
  }
});

// Can only get boolean, not configuration
```

---

## Gap Analysis

### Critical Gaps (P0)

1. **No Dynamic Configuration Return Value**
   - **Impact:** Cannot change feature parameters without code changes
   - **Competitor Advantage:** Split.io and Harness both support this
   - **User Request Likelihood:** High (standard feature)

2. **No Multi-Variant Support**
   - **Impact:** Can't run A/B/n tests with different configurations
   - **Competitor Advantage:** Fundamental to modern feature flagging
   - **User Request Likelihood:** Very High

3. **No SDK Method for Config Retrieval**
   - **Impact:** Even if we stored configs, SDKs can't retrieve them
   - **Competitor Advantage:** Core API in all competitors
   - **User Request Likelihood:** Required for dynamic config

### Important Gaps (P1)

4. **No Attribute-Based Targeting**
   - **Impact:** Limited targeting flexibility (only geo/language)
   - **Competitor Advantage:** Allows custom business logic targeting
   - **User Request Likelihood:** High (common use case)

5. **No User Segments**
   - **Impact:** Must duplicate targeting rules across flags
   - **Competitor Advantage:** Reusable audiences, easier management
   - **User Request Likelihood:** Medium-High

### Nice-to-Have Gaps (P2)

6. **No Flag Dependencies**
   - **Impact:** Can't require prerequisite flags
   - **Competitor Advantage:** Prevents misconfiguration
   - **User Request Likelihood:** Medium

7. **No Configuration Validation**
   - **Impact:** Can store invalid JSON, errors at runtime
   - **Competitor Advantage:** Pre-validates configs in UI
   - **User Request Likelihood:** Low-Medium

---

## Proposed Enhancements

### Phase 1: Foundation

#### 1.1 Add `configuration` Field to Environments

**Database Migration:**
```sql
-- Extend environments JSONB to support configuration
-- Example structure:
{
  "production": {
    "enabled": true,
    "rollout_percentage": 50,
    "targeting_rules": { ... },
    "configuration": {
      "theme": {
        "primaryColor": "#007bff",
        "secondaryColor": "#6c757d"
      },
      "limits": {
        "maxItems": 100,
        "timeout": 5000
      }
    }
  }
}
```

**No schema change needed** - `environments` is already JSONB!

#### 1.2 Update Flag Evaluation to Return Configuration

**Backend Changes:**
```rust
// backend/src/models/flag.rs
#[derive(Debug, Serialize)]
pub struct FlagEvaluationResponse {
    pub key: String,
    pub enabled: bool,
    pub scope: Option<String>,
    pub configuration: Option<JsonValue>,  // NEW
    pub timestamp: i64,
    pub context: Option<JsonValue>,
}
```

**Evaluation Logic:**
```rust
// backend/src/api/flags.rs
let (enabled, configuration) = flag
    .environments
    .get(environment)
    .and_then(|v| {
        if let Some(obj) = v.as_object() {
            let enabled = obj.get("enabled").and_then(|e| e.as_bool()).unwrap_or(false);
            let config = obj.get("configuration").cloned();
            Some((enabled, config))
        } else {
            None
        }
    })
    .unwrap_or((false, None));

// Return both enabled + configuration
FlagEvaluationResponse {
    key,
    enabled,
    configuration,
    // ...
}
```

#### 1.3 Add SDK Method for Config Retrieval

**JavaScript/TypeScript SDK:**

The SDK returns response fields aligned with the API (see [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md)):

```typescript
// @savvagent/client-web

interface FlagEvaluationResult {
  key: string;                    // The flag key
  enabled: boolean;               // Whether the flag is enabled for this context
  scope?: 'application' | 'enterprise';
  variation?: string;             // The allocated variation name (if A/B testing)
  configuration?: any;            // Dynamic configuration attached to flag/variation
  timestamp: number;              // Unix timestamp of evaluation
}

class FlagClient {
  // Existing method (unchanged)
  async isEnabled(flagKey: string, context?: any): Promise<boolean> {
    const result = await this.evaluate(flagKey, context);
    return result.enabled;
  }

  // NEW: Get full evaluation result with config
  async evaluate(flagKey: string, context?: any): Promise<FlagEvaluationResult> {
    const response = await fetch(`${this.apiUrl}/api/flags/${flagKey}/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context }),
    });

    const data = await response.json();
    return {
      enabled: data.enabled,
      configuration: data.configuration,
      scope: data.scope,
      timestamp: data.timestamp,
    };
  }

  // NEW: Get configuration only (returns null if disabled)
  async getConfig<T = any>(flagKey: string, context?: any, defaultValue?: T): Promise<T | null> {
    const result = await this.evaluate(flagKey, context);

    if (!result.enabled) {
      return defaultValue ?? null;
    }

    return result.configuration ?? defaultValue ?? null;
  }
}
```

**Usage Examples:**
```typescript
// Example 1: Simple boolean check (unchanged)
// Always provide user context for consistent rollout behavior
const enabled = await client.isEnabled('new-checkout', { user_id: 'user-123' });

// Example 2: Get configuration only
const config = await client.getConfig('checkout-experience', { user_id: 'user-123' });
if (config) {
  renderCheckout(config);
}

// Example 3: Get configuration with default (graceful degradation)
const themeConfig = await client.getConfig('theme-settings', context, {
  primaryColor: '#007bff',
  fontSize: 16,
});

// Example 4: Full evaluation result
const result = await client.evaluate('new-feature', context);
if (result.enabled) {
  initFeature(result.configuration);
}
```

> **Important:** Always provide `user_id` or `anonymous_id` for consistent user experiences across evaluations.

---

### Phase 2: Multi-Variant Flags

#### 2.1 Add Variations Support

**Database Schema Enhancement:**
```sql
-- Add variations field to feature_flags table
ALTER TABLE feature_flags ADD COLUMN variations JSONB DEFAULT NULL;

-- Example variations structure:
{
  "control": {
    "name": "Control Group",
    "description": "Original experience",
    "allocation": 50,
    "configuration": {
      "algorithm": "standard",
      "weight": 1.0
    }
  },
  "variant_a": {
    "name": "ML Algorithm v1",
    "description": "First ML variant",
    "allocation": 25,
    "configuration": {
      "algorithm": "ml_v1",
      "weight": 1.5
    }
  },
  "variant_b": {
    "name": "ML Algorithm v2",
    "description": "Second ML variant",
    "allocation": 25,
    "configuration": {
      "algorithm": "ml_v2",
      "weight": 2.0
    }
  }
}
```

#### 2.2 Variation Allocation Logic

**Consistent Hashing Across Variations:**
```rust
// Assign user to variation bucket
fn allocate_variation(
    variations: &JsonValue,
    user_id: &str,
    flag_key: &str,
) -> Option<(String, JsonValue)> {
    // Calculate hash bucket (0-99)
    let hash = calculate_rollout_hash(flag_key, user_id);

    // Build cumulative allocation ranges
    let mut cumulative = 0;
    for (name, variant) in variations.as_object()? {
        let allocation = variant.get("allocation")?.as_u64()? as u8;
        cumulative += allocation;

        if hash < cumulative {
            let config = variant.get("configuration").cloned();
            return Some((name.clone(), config.unwrap_or(JsonValue::Null)));
        }
    }

    None
}
```

#### 2.3 SDK Support for Variations

```typescript
interface VariationResult {
  variation: string;        // e.g., "control", "variant_a"
  enabled: boolean;
  configuration?: any;
}

class FlagClient {
  async getVariation(flagKey: string, context?: any): Promise<VariationResult> {
    const response = await this.evaluate(flagKey, context);
    return {
      variation: response.variation || 'control',
      enabled: response.enabled,
      configuration: response.configuration,
    };
  }
}
```

**Usage:**
```typescript
const result = await client.getVariation('search-algorithm', { userId: user.id });

switch (result.variation) {
  case 'control':
    useStandardSearch(result.configuration);
    break;
  case 'variant_a':
    useMLSearchV1(result.configuration);
    break;
  case 'variant_b':
    useMLSearchV2(result.configuration);
    break;
}
```

---

### Phase 3: Attribute-Based Targeting

#### 3.1 Generic Attribute Targeting

**Extend targeting_rules:**
```json
{
  "production": {
    "enabled": true,
    "targeting_rules": {
      "attributes": [
        {
          "key": "plan",
          "operator": "in",
          "values": ["premium", "enterprise"]
        },
        {
          "key": "age",
          "operator": ">=",
          "value": 18
        },
        {
          "key": "email",
          "operator": "endsWith",
          "value": "@company.com"
        },
        {
          "key": "signupDate",
          "operator": ">=",
          "value": "2024-01-01"
        }
      ],
      "operator": "AND"  // or "OR"
    }
  }
}
```

**Supported Operators:**
- `"in"` - Value in list
- `"not_in"` - Value not in list
- `"="` - Equals
- `"!="` - Not equals
- `">"` - Greater than (numbers, dates)
- `">="` - Greater than or equal
- `"<"` - Less than
- `"<="` - Less than or equal
- `"startsWith"` - String starts with
- `"endsWith"` - String ends with
- `"contains"` - String contains
- `"matches"` - Regex match

#### 3.2 Attribute Evaluation Engine

```rust
fn evaluate_attribute_rules(
    rules: &JsonValue,
    context_attributes: &JsonValue,
) -> bool {
    let rules_array = match rules.get("attributes").and_then(|r| r.as_array()) {
        Some(arr) => arr,
        None => return true, // No rules = allow
    };

    let operator = rules.get("operator")
        .and_then(|o| o.as_str())
        .unwrap_or("AND");

    let mut results = Vec::new();

    for rule in rules_array {
        let key = rule.get("key").and_then(|k| k.as_str()).unwrap();
        let op = rule.get("operator").and_then(|o| o.as_str()).unwrap();

        let user_value = context_attributes.get(key);
        let result = match op {
            "in" => {
                let values = rule.get("values").and_then(|v| v.as_array());
                user_value.map(|v| values.map(|vals| vals.contains(v)).unwrap_or(false)).unwrap_or(false)
            },
            ">=" => {
                // Numeric comparison
                let threshold = rule.get("value").and_then(|v| v.as_f64());
                user_value.and_then(|v| v.as_f64())
                    .and_then(|uv| threshold.map(|t| uv >= t))
                    .unwrap_or(false)
            },
            "endsWith" => {
                let suffix = rule.get("value").and_then(|v| v.as_str()).unwrap();
                user_value.and_then(|v| v.as_str())
                    .map(|s| s.ends_with(suffix))
                    .unwrap_or(false)
            },
            // ... implement other operators
            _ => false,
        };

        results.push(result);
    }

    // Combine results based on operator
    match operator {
        "AND" => results.iter().all(|&r| r),
        "OR" => results.iter().any(|&r| r),
        _ => false,
    }
}
```

---

### Phase 4: User Segments

#### 4.1 Segments Table

```sql
CREATE TABLE user_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, key)
);

CREATE INDEX idx_user_segments_org ON user_segments(organization_id);
```

**Example Segment:**
```json
{
  "key": "premium_users",
  "name": "Premium Users",
  "rules": {
    "attributes": [
      {
        "key": "plan",
        "operator": "in",
        "values": ["premium", "enterprise"]
      }
    ]
  }
}
```

#### 4.2 Segment-Based Targeting

```json
{
  "production": {
    "enabled": true,
    "targeting_rules": {
      "segments": {
        "include": ["premium_users", "beta_testers"],
        "exclude": ["blocked_users"]
      }
    }
  }
}
```

#### 4.3 Segment Evaluation

```rust
async fn evaluate_segment_rules(
    pool: &Pool<Postgres>,
    org_id: Uuid,
    segment_keys: &[String],
    context: &JsonValue,
) -> bool {
    for key in segment_keys {
        let segment = sqlx::query_as::<_, UserSegment>(
            "SELECT * FROM user_segments WHERE organization_id = $1 AND key = $2"
        )
        .bind(org_id)
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        if let Some(seg) = segment {
            if !evaluate_attribute_rules(&seg.rules, context) {
                return false;
            }
        }
    }

    true
}
```

---

## Implementation Plan

### Phase 1: Foundation (Dynamic Configuration)
- [ ] Add `configuration` field support to environment JSONB
- [ ] Update `FlagEvaluationResponse` to include configuration
- [ ] Modify evaluation logic to return configuration
- [ ] Add SDK methods: `getConfig()`, `evaluate()`
- [ ] Update frontend UI to edit configurations
- [ ] Write tests and documentation

**Deliverables:**
- Backend returns configuration in evaluation response
- SDKs can retrieve configuration values
- UI supports editing flag configurations
- Documentation with examples

### Phase 2: Multi-Variant Flags
- [ ] Add `variations` column to feature_flags table
- [ ] Implement variation allocation logic (consistent hashing)
- [ ] Update evaluation to select variation and return config
- [ ] Add SDK method: `getVariation()`
- [ ] Build UI for managing variations
- [ ] Analytics for variation distribution

**Deliverables:**
- Support for multiple variations per flag
- Consistent user assignment to variations
- SDK returns variation name + config
- UI for A/B/n test setup

### Phase 3: Attribute-Based Targeting
- [ ] Design attribute targeting rule schema
- [ ] Implement attribute evaluation engine
- [ ] Support all operators (in, >=, endsWith, etc.)
- [ ] Extend evaluation to check attribute rules
- [ ] Build UI for attribute rule builder
- [ ] Add attribute validation

**Deliverables:**
- Generic attribute-based targeting
- Flexible operator support
- Visual rule builder in UI
- Comprehensive operator coverage

### Phase 4: User Segments
- [ ] Create user_segments table
- [ ] Build segment CRUD APIs
- [ ] Implement segment evaluation in flag logic
- [ ] Add segment management UI
- [ ] Support include/exclude segment lists
- [ ] Segment usage analytics

**Deliverables:**
- Reusable user segments
- Segment-based flag targeting
- Segment management UI
- Usage tracking

---

## Use Cases

### Use Case 1: UI Theme Experimentation

**Goal:** Test different color schemes without code changes.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "rollout_percentage": 100,
    "configuration": {
      "theme": {
        "primaryColor": "#007bff",
        "secondaryColor": "#6c757d",
        "accentColor": "#28a745",
        "fontSize": 16
      }
    }
  }
}
```

**Application Code:**
```typescript
const themeConfig = await client.getConfig('app-theme', { userId });

applyTheme({
  primaryColor: themeConfig?.theme?.primaryColor || '#000',
  secondaryColor: themeConfig?.theme?.secondaryColor || '#666',
  accentColor: themeConfig?.theme?.accentColor || '#0066cc',
  fontSize: themeConfig?.theme?.fontSize || 14,
});
```

**Benefit:** Product team can test 10 different color combinations without engineering involvement.

---

### Use Case 2: Search Algorithm Tuning

**Goal:** A/B test different search ranking algorithms.

**Flag Configuration (Multi-Variant):**
```json
{
  "variations": {
    "control": {
      "allocation": 70,
      "configuration": {
        "algorithm": "bm25",
        "boost_recency": 1.0,
        "boost_popularity": 1.0
      }
    },
    "variant_a": {
      "allocation": 15,
      "configuration": {
        "algorithm": "bm25",
        "boost_recency": 1.5,
        "boost_popularity": 1.2
      }
    },
    "variant_b": {
      "allocation": 15,
      "configuration": {
        "algorithm": "neural_search",
        "model": "v2.1",
        "threshold": 0.7
      }
    }
  }
}
```

**Application Code:**
```typescript
const result = await client.getVariation('search-ranking', { userId });

const searchResults = performSearch(query, {
  algorithm: result.configuration.algorithm,
  boostRecency: result.configuration.boost_recency,
  boostPopularity: result.configuration.boost_popularity,
});

// Track which variation performed better
analytics.track('search_performed', {
  variation: result.variation,
  resultsCount: searchResults.length,
  clickedFirstResult: /* ... */,
});
```

**Benefit:** Data science team can test different algorithms and parameters without redeploying.

---

### Use Case 3: Payment Gateway Configuration

**Goal:** Dynamically adjust timeout and retry settings.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "gateway": "stripe",
      "timeout_ms": 5000,
      "max_retries": 3,
      "retry_backoff": "exponential",
      "enable_fallback": true,
      "fallback_gateway": "paypal"
    }
  }
}
```

**Application Code:**
```typescript
const paymentConfig = await client.getConfig('payment-settings', { userId });

const result = await processPayment(order, {
  gateway: paymentConfig.gateway,
  timeout: paymentConfig.timeout_ms,
  maxRetries: paymentConfig.max_retries,
  retryBackoff: paymentConfig.retry_backoff,
  fallback: paymentConfig.enable_fallback ? paymentConfig.fallback_gateway : null,
});
```

**Benefit:** Operations team can adjust payment processing parameters instantly during incidents.

---

### Use Case 4: Feature Limits by Plan

**Goal:** Different feature limits for different subscription tiers.

**Flag with Attribute Targeting:**
```json
{
  "production": {
    "enabled": true,
    "targeting_rules": {
      "attributes": [
        {
          "key": "plan",
          "operator": "in",
          "values": ["premium", "enterprise"]
        }
      ]
    },
    "configuration": {
      "maxProjects": 100,
      "maxTeamMembers": 50,
      "enableAdvancedAnalytics": true,
      "apiRateLimit": 10000
    }
  }
}
```

**Fallback for Free Users:**
```json
{
  "development": {
    "enabled": true,
    "configuration": {
      "maxProjects": 3,
      "maxTeamMembers": 5,
      "enableAdvancedAnalytics": false,
      "apiRateLimit": 1000
    }
  }
}
```

**Application Code:**
```typescript
const limits = await client.getConfig('plan-limits', {
  userId,
  attributes: { plan: user.subscriptionPlan },
});

if (user.projectCount >= limits.maxProjects) {
  throw new Error('Project limit reached. Upgrade to create more.');
}
```

**Benefit:** Instantly adjust plan limits without code changes or database migrations.

---

## Summary

### Current State
- ✅ Boolean flags with environment-specific settings
- ✅ Percentage rollouts (sticky)
- ✅ Geolocation and language targeting
- ✅ Scheduled flags
- ❌ No dynamic configuration
- ❌ No multi-variant support
- ❌ No attribute-based targeting

### After Implementation
- ✅ Full dynamic configuration support
- ✅ Multi-variant flags (A/B/n testing)
- ✅ Attribute-based targeting with rich operators
- ✅ Reusable user segments
- ✅ SDK methods for config retrieval
- ✅ UI for managing all features

### Competitive Position
- **Current:** Behind Split.io and Harness
- **After Phase 1-2:** Competitive with basic dynamic config
- **After Phase 3-4:** Feature parity with industry leaders

---

## References

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Official SDK development guide with API specification
- Split.io Dynamic Configuration: https://www.split.io/product/dynamic-configuration/
- Harness Feature Flags: https://developer.harness.io/docs/feature-management-experimentation/
- Current flag evaluation: `backend/src/api/flags.rs:338`
- Current SDK: `docs/SDK-REFERENCE.md`
- Geolocation targeting: `docs/GEOLOCATION-TARGETING.md`
- Language targeting: `docs/LANGUAGE-TARGETING.md`

---

**Questions or feedback?**
- GitHub Issues: https://github.com/savvagent/savvagent/issues
- Email: support@savvagent.com

**Last Updated:** November 2024

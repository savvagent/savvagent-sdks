# Configuration Overrides Guide

**Testing Dynamic Configurations & Variations Without Server Changes**

---

## Overview

Configuration overrides allow you to test different flag configurations and variations locally without making changes to your Savvagent dashboard. This is especially useful for:

- **Local Development**: Test different configurations while developing features
- **QA Testing**: Verify behavior with various configurations without environment changes
- **A/B Testing**: Force specific variations to test different user experiences
- **Debugging**: Isolate issues by testing specific configuration values

---

## Quick Start

### Node.js / TypeScript

```typescript
import { FlagClient } from '@savvagent/node-server';

const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',
});

// Override configuration completely
client.setConfigOverride('checkout-experience', {
  theme: { primaryColor: '#ff0000' },
  timeout: 3000,
});

// Override with merge (preserves other fields)
client.setConfigOverride('payment-settings', {
  gateway: 'stripe_test',
}, { merge: true });

// Override variation
client.setVariationOverride('search-algorithm', 'variant_b');

// Get config with override applied
const config = await client.getConfig('checkout-experience');
```

### Go

```go
package main

import (
    "github.com/savvagent/go-server"
)

func main() {
    client, _ := savvagent.NewClient(savvagent.Config{
        APIKey: "sdk_dev_abc123",
    })

    // Override configuration
    client.SetConfigOverride("checkout-experience", map[string]interface{}{
        "theme": map[string]interface{}{
            "primaryColor": "#ff0000",
        },
        "timeout": 3000,
    }, nil)

    // Override with merge
    client.SetConfigOverride("payment-settings", map[string]interface{}{
        "gateway": "stripe_test",
    }, &savvagent.ConfigOverrideOptions{Merge: true})

    // Override variation
    client.SetVariationOverride("search-algorithm", "variant_b")

    // Get config with override applied
    config, _ := client.GetConfig("checkout-experience", nil)
}
```

### Rust

```rust
use savvagent_sdk::{Config, ConfigOverrideOptions, FlagClient};
use serde_json::json;

#[tokio::main]
async fn main() {
    let config = Config::new("sdk_dev_abc123");
    let client = FlagClient::new(config).unwrap();

    // Override configuration
    client.set_config_override(
        "checkout-experience",
        json!({
            "theme": {
                "primaryColor": "#ff0000"
            },
            "timeout": 3000
        }),
        None,
    ).unwrap();

    // Override with merge
    client.set_config_override(
        "payment-settings",
        json!({ "gateway": "stripe_test" }),
        Some(ConfigOverrideOptions::new().with_merge(true)),
    ).unwrap();

    // Override variation
    client.set_variation_override("search-algorithm", "variant_b");

    // Get config with override applied
    let config = client.get_config("checkout-experience", None).await.unwrap();
}
```

### Java

```java
import com.savvagent.sdk.*;
import java.util.HashMap;
import java.util.Map;

public class Example {
    public static void main(String[] args) {
        FlagClientConfig config = new FlagClientConfig.Builder()
            .apiKey("sdk_dev_abc123")
            .build();

        FlagClient client = new FlagClient(config);

        // Override configuration
        Map<String, Object> override = new HashMap<>();
        override.put("theme", Map.of("primaryColor", "#ff0000"));
        override.put("timeout", 3000);
        client.setConfigOverride("checkout-experience", override);

        // Override with merge
        Map<String, Object> mergeOverride = new HashMap<>();
        mergeOverride.put("gateway", "stripe_test");
        client.setConfigOverride("payment-settings", mergeOverride, true);

        // Override variation
        client.setVariationOverride("search-algorithm", "variant_b");

        // Get config with override applied
        Object config = client.getConfig("checkout-experience");
    }
}
```

### Android (Kotlin)

```kotlin
import com.savvagent.sdk.*

val config = SavvagentConfig(
    sdkKey = "sdk_dev_abc123"
)

val client = SavvagentClient(config, context)

// Override configuration
client.setConfigOverride("checkout-experience", mapOf(
    "theme" to mapOf("primaryColor" to "#ff0000"),
    "timeout" to 3000
))

// Override with merge
client.setConfigOverride("payment-settings", mapOf(
    "gateway" to "stripe_test"
), merge = true)

// Override variation
client.setVariationOverride("search-algorithm", "variant_b")

// Get config with override applied
val config = client.getConfig("checkout-experience", userContext).getOrNull()
```

### iOS (Swift)

```swift
import SavvagentSDK

let config = SavvagentConfig(sdkKey: "sdk_dev_abc123")
let client = SavvagentClient(config: config)

// Override configuration
client.setConfigOverride(flagKey: "checkout-experience", config: [
    "theme": ["primaryColor": "#ff0000"],
    "timeout": 3000
])

// Override with merge
client.setConfigOverride(flagKey: "payment-settings", config: [
    "gateway": "stripe_test"
], merge: true)

// Override variation
client.setVariationOverride(flagKey: "search-algorithm", variation: "variant_b")

// Get config with override applied
let config = try await client.getConfig(flagKey: "checkout-experience", context: context)
```

---

## Override Patterns

### Pattern 1: Complete Replacement

Replace the entire configuration with your override:

```typescript
// API returns: { primaryColor: '#007bff', fontSize: 16, fontFamily: 'Arial' }

client.setConfigOverride('theme-settings', {
  primaryColor: '#ff0000',
});

// Result: { primaryColor: '#ff0000' }
// fontSize and fontFamily are NOT preserved
```

**Use when**: You want complete control and don't need any API values.

### Pattern 2: Partial Merge

Merge override with API configuration:

```typescript
// API returns: { primaryColor: '#007bff', fontSize: 16, fontFamily: 'Arial' }

client.setConfigOverride('theme-settings', {
  primaryColor: '#ff0000',
}, { merge: true });

// Result: { primaryColor: '#ff0000', fontSize: 16, fontFamily: 'Arial' }
// Override only primaryColor, preserve fontSize and fontFamily
```

**Use when**: You want to change specific fields while preserving others.

### Pattern 3: Deep Merge

Merge nested objects:

```typescript
// API returns:
// {
//   theme: { primary: '#007bff', secondary: '#6c757d' },
//   limits: { maxItems: 100 }
// }

client.setConfigOverride('app-config', {
  theme: { primary: '#ff0000' },
  newField: 'added',
}, { merge: true });

// Result:
// {
//   theme: { primary: '#ff0000', secondary: '#6c757d' },
//   limits: { maxItems: 100 },
//   newField: 'added'
// }
```

**Use when**: You need to override nested configuration fields.

### Pattern 4: Variation Override

Force a specific variation for A/B testing:

```typescript
// API returns: variation = 'control'

client.setVariationOverride('search-algorithm', 'variant_b');

const result = await client.getVariation('search-algorithm');
// result.variation === 'variant_b'
```

**Use when**: Testing specific variants without changing user targeting.

---

## Use Cases

### Use Case 1: Testing UI Themes

```typescript
// Test different color schemes rapidly
const themes = {
  blue: { primaryColor: '#007bff', accentColor: '#0056b3' },
  red: { primaryColor: '#dc3545', accentColor: '#c82333' },
  dark: { primaryColor: '#343a40', accentColor: '#23272b' },
};

function testTheme(themeName: string) {
  client.setConfigOverride('app-theme', themes[themeName]);
  // Re-render UI with new theme
}

// Test in browser console
testTheme('red');    // Test red theme
testTheme('dark');   // Test dark theme
```

### Use Case 2: QA Testing Plan Limits

```typescript
// Test different subscription plan configurations
async function testPlanLimits(plan: string) {
  const planConfigs = {
    free: {
      maxProjects: 1,
      maxTeamMembers: 1,
      apiRateLimit: 10,
    },
    pro: {
      maxProjects: 10,
      maxTeamMembers: 5,
      apiRateLimit: 100,
    },
    enterprise: {
      maxProjects: 1000,
      maxTeamMembers: 500,
      apiRateLimit: 100000,
    },
  };

  client.setConfigOverride('plan-limits', planConfigs[plan]);

  // Test creating projects
  try {
    await createProject(); // Should succeed or fail based on limits
  } catch (error) {
    console.log(`Limit reached for ${plan} plan`);
  }
}

testPlanLimits('free');
testPlanLimits('enterprise');
```

### Use Case 3: Testing API Configurations

```typescript
// Test different timeout and retry settings
client.setConfigOverride('api-settings', {
  timeout_ms: 100,      // Very aggressive timeout
  max_retries: 1,       // Only retry once
  retry_backoff: 'none',
});

try {
  await callAPI(); // Should timeout quickly
} catch (error) {
  console.log('Timeout triggered as expected');
}

// Test with more lenient settings
client.setConfigOverride('api-settings', {
  timeout_ms: 30000,
  max_retries: 5,
  retry_backoff: 'exponential',
});
```

### Use Case 4: A/B Test Variant Testing

```typescript
// Test all variants of a feature
const variants = ['control', 'variant_a', 'variant_b', 'variant_c'];

for (const variant of variants) {
  client.setVariationOverride('new-feature', variant);

  const result = await client.getVariation('new-feature');
  console.log(`Testing variant: ${result.variation}`);

  // Test the feature with this variant
  await testFeatureWithVariant(result.configuration);
}
```

---

## Management Methods

### Check if Override Exists

```typescript
// Check for configuration override
if (client.hasConfigOverride('feature-flag')) {
  console.log('Configuration is overridden');
}

// Check for variation override
if (client.hasVariationOverride('ab-test')) {
  console.log('Variation is overridden');
}
```

### Inspect All Overrides

```typescript
// Get all configuration overrides
const configOverrides = client.getConfigOverrides();
console.log('Config overrides:', configOverrides);
// {
//   'flag-1': { config: {...}, merge: false, timestamp: 1234567890 },
//   'flag-2': { config: {...}, merge: true, timestamp: 1234567891 }
// }

// Get all variation overrides
const variationOverrides = client.getVariationOverrides();
console.log('Variation overrides:', variationOverrides);
// {
//   'flag-3': { variation: 'variant_a', timestamp: 1234567892 }
// }
```

### Clear Overrides

```typescript
// Clear specific configuration override
client.clearConfigOverride('feature-flag');

// Clear specific variation override
client.clearVariationOverride('ab-test');

// Clear ALL overrides (config and variation)
client.clearAllOverrides();
```

---

## Best Practices

### 1. Use Descriptive Override Comments

```typescript
// Testing checkout with aggressive timeout for error handling verification
client.setConfigOverride('checkout-flow', {
  timeout: 100,
  showErrorDetails: true,
});
```

### 2. Clean Up After Tests

```typescript
async function runTest() {
  try {
    // Set override for test
    client.setConfigOverride('feature', testConfig);

    // Run your test
    await performTest();
  } finally {
    // Always clean up
    client.clearConfigOverride('feature');
  }
}
```

### 3. Document Override Scenarios

```typescript
/**
 * Test scenarios for payment gateway:
 * - 'test-mode': Uses test gateway with instant responses
 * - 'slow-mode': Simulates slow responses (5s timeout)
 * - 'error-mode': Forces errors for testing error handling
 */
const paymentScenarios = {
  'test-mode': { gateway: 'stripe_test', timeout: 1000 },
  'slow-mode': { gateway: 'stripe', timeout: 5000 },
  'error-mode': { gateway: 'stripe_fail', timeout: 1000 },
};
```

### 4. Use Environment Variables for Automation

```typescript
// Automatically apply overrides from env vars
const configOverride = process.env.FLAG_CONFIG_OVERRIDE;
if (configOverride) {
  try {
    const config = JSON.parse(configOverride);
    client.setConfigOverride('my-flag', config);
  } catch (error) {
    console.error('Invalid override JSON');
  }
}

// Usage: FLAG_CONFIG_OVERRIDE='{"timeout":1000}' npm test
```

### 5. Validate Overrides

```typescript
// Set override with validation enabled (default)
try {
  client.setConfigOverride('feature', invalidConfig);
} catch (error) {
  console.error('Invalid configuration:', error.message);
}

// Skip validation for trusted sources
client.setConfigOverride('feature', config, {
  validate: false,
  merge: true,
});
```

---

## Troubleshooting

### Override Not Taking Effect

**Problem**: Set an override but still getting API values.

**Solution**: Ensure cache is invalidated when setting override (SDKs do this automatically).

```typescript
// Overrides automatically invalidate cache
client.setConfigOverride('flag', config); // Cache is cleared

// If needed, manually clear cache
client.invalidateCache('flag');
```

### Merge Not Working as Expected

**Problem**: Merged configuration missing expected fields.

**Solution**: Check that merge option is set to `true`:

```typescript
// Wrong - will replace completely
client.setConfigOverride('flag', partial);

// Correct - will merge
client.setConfigOverride('flag', partial, { merge: true });
```

### Overrides Persisting

**Problem**: Overrides remain after testing.

**Solution**: Always clean up overrides:

```typescript
// Clear specific override
client.clearConfigOverride('test-flag');

// Or clear all at once
client.clearAllOverrides();
```

---

## Limitations

1. **Not Persisted**: Overrides are stored in memory only and are lost when the client is destroyed
2. **Local Only**: Overrides only affect the current client instance, not other instances or processes
3. **Cache Invalidation**: Setting overrides clears the cache, causing re-evaluation on next request
4. **No Validation**: Override values are not validated against flag schemas (if using flag schemas)

---

## Next Steps

- See [DYNAMIC-CONFIGURATION.md](./DYNAMIC-CONFIGURATION.md) for more on dynamic configs
- See [MIGRATION-GUIDE.md](./MIGRATION-GUIDE.md) for upgrading to v2.0
- See [CLIENT-SIDE-OVERRIDES.md](./CLIENT-SIDE-OVERRIDES.md) for browser-based overrides

---

**Happy Testing!** 🎉

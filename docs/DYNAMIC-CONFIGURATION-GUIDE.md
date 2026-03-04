# Dynamic Configuration & Multi-Variant Flags - Usage Guide

**Version:** 2.0
**Last Updated:** November 2024

This guide shows you how to use Savvagent's new **Dynamic Configuration** and **Multi-Variant Flags** features across all SDKs.

---

## Table of Contents

1. [What's New](#whats-new)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [SDK-Specific Examples](#sdk-specific-examples)
5. [Common Use Cases](#common-use-cases)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## What's New

### Phase 1: Dynamic Configuration

**Before:**
```javascript
const enabled = await client.isEnabled('new-checkout');
if (enabled) {
  showNewCheckout();
}
```

**After:**
```javascript
const config = await client.getConfig('checkout-experience');
renderCheckout({
  primaryColor: config.theme.primaryColor,
  timeout: config.limits.timeout,
  enableExpressCheckout: config.features.expressCheckout
});
```

### Phase 2: Multi-Variant Flags

**Before:** Boolean on/off only

**After:**
```javascript
const result = await client.getVariation('search-algorithm');

switch (result.variation) {
  case 'control':
    useStandardSearch(result.configuration);
    break;
  case 'ml_v1':
    useMLSearchV1(result.configuration);
    break;
  case 'ml_v2':
    useMLSearchV2(result.configuration);
    break;
}
```

---

## Quick Start

### Installation

No changes needed - use your existing SDK installation.

### Basic Usage

**Node.js/TypeScript:**
```typescript
import { FlagClient } from '@savvagent/node-server';

// Create a single SDK instance at application startup
const client = new FlagClient({
  apiKey: 'sdk_your_key',  // SDK keys use 'sdk_' prefix
  applicationId: 'your-app-id'
});

// Always provide user context for consistent rollout behavior
const context = {
  user_id: 'user-123',
  environment: 'production'
};

// Get dynamic configuration
const config = await client.getConfig('checkout-experience', context);
if (config) {
  console.log('Primary color:', config.theme.primaryColor);
}

// Get variation details
const variation = await client.getVariation('search-algorithm', context);
console.log('Variation:', variation.variation);
console.log('Config:', variation.configuration);
```

---

## Core Concepts

### 1. Dynamic Configuration

Attach JSON data to your flags to control feature behavior without code changes.

**What you can configure:**
- UI settings (colors, sizes, text)
- Backend parameters (timeouts, retries, URLs)
- Business logic (thresholds, limits, rules)
- A/B test parameters

### 2. Multi-Variant Flags

Instead of just on/off, run A/B/n tests with different configurations for each variant.

**Use cases:**
- Testing multiple algorithm implementations
- Comparing different UI designs
- Gradual rollout of new features with fallbacks

### 3. Evaluation Response

All SDKs now return the following response fields (aligned with the API):

```typescript
{
  key: string,              // Flag key
  enabled: boolean,         // Whether the flag is enabled for this context
  scope?: string,           // "application" or "enterprise"
  variation?: string,       // The allocated variation name (if A/B testing)
  configuration?: any,      // Dynamic configuration attached to flag/variation
  timestamp: number,        // Unix timestamp of evaluation
  context?: any             // Echo of the evaluation context
}
```

See [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) for the complete API response specification.

---

## SDK-Specific Examples

### Node.js / TypeScript

```typescript
import { FlagClient } from '@savvagent/node-server';

// Create a single SDK instance at application startup
const client = new FlagClient({
  apiKey: process.env.SAVVAGENT_API_KEY,  // SDK key (sdk_) or Server key (srv_)
  applicationId: 'my-app'
});

// Always provide user context for consistent rollout behavior
const context = {
  user_id: 'user-123',
  environment: 'production',
  attributes: {
    plan: 'premium'
  }
};

// 1. Get configuration for enabled flag
const themeConfig = await client.getConfig('app-theme', context);

if (themeConfig) {
  applyTheme({
    primaryColor: themeConfig.colors.primary,
    secondaryColor: themeConfig.colors.secondary,
    fontSize: themeConfig.typography.fontSize
  });
}

// 2. Get configuration with default fallback
const apiConfig = await client.getConfig('api-settings', context, {
  endpoint: 'https://api.default.com',
  timeout: 5000,
  retries: 3
});

// 3. Get variation for A/B test
const searchVariation = await client.getVariation('search-ranking');

const results = performSearch(query, {
  algorithm: searchVariation.configuration.algorithm,
  weights: searchVariation.configuration.weights
});

// Track which variation was shown
analytics.track('search_performed', {
  variation: searchVariation.variation,
  resultsCount: results.length
});

// 4. Full evaluation (includes all fields)
const fullResult = await client.evaluate('feature-x');
console.log({
  enabled: fullResult.value,
  config: fullResult.configuration,
  variation: fullResult.variation,
  cached: fullResult.reason === 'cached'
});
```

---

### Go

```go
package main

import (
	"context"
	"fmt"
	"github.com/savvagent/go-server"
)

func main() {
	client, _ := savvagent.NewClient(savvagent.Config{
		APIKey:        os.Getenv("SAVVAGENT_API_KEY"),
		ApplicationID: "my-app",
	})
	defer client.Close()

	ctx := &savvagent.Context{
		UserID: "user-123",
	}

	// 1. Get configuration
	config, err := client.GetConfig("api-settings", ctx)
	if err != nil {
		log.Fatal(err)
	}

	if config != nil {
		endpoint := config["endpoint"].(string)
		timeout := int(config["timeout"].(float64))
		fmt.Printf("API: %s, Timeout: %d\n", endpoint, timeout)
	}

	// 2. Get variation
	variation, err := client.GetVariation("search-algorithm", ctx)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Using variation: %s\n", variation.Variation)

	switch variation.Variation {
	case "control":
		useStandardSearch(variation.Configuration)
	case "ml_v1":
		useMLSearchV1(variation.Configuration)
	case "ml_v2":
		useMLSearchV2(variation.Configuration)
	}

	// 3. Full evaluation
	result, err := client.Evaluate("feature-x", ctx)
	if err != nil {
		log.Fatal(err)
	}

	if result.Value && result.Configuration != nil {
		processFeature(result.Configuration)
	}
}
```

---

### Rust

```rust
use savvagent_sdk::{Config, Context, FlagClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::new(env::var("SAVVAGENT_API_KEY")?)
        .with_application_id("my-app");

    let client = FlagClient::new(config)?;

    let context = Context::new()
        .with_user_id("user-123");

    // 1. Get configuration
    if let Some(config) = client.get_config("api-settings", Some(&context)).await? {
        let endpoint = config["endpoint"].as_str().unwrap();
        let timeout = config["timeout"].as_i64().unwrap();
        println!("API: {}, Timeout: {}", endpoint, timeout);
    }

    // 2. Get variation
    let variation = client.get_variation("search-algorithm", Some(&context)).await?;

    match variation.variation.as_str() {
        "control" => use_standard_search(&variation.configuration),
        "ml_v1" => use_ml_search_v1(&variation.configuration),
        "ml_v2" => use_ml_search_v2(&variation.configuration),
        _ => {}
    }

    // 3. Full evaluation
    let result = client.evaluate("feature-x", Some(&context)).await?;

    if result.value {
        if let Some(config) = result.configuration {
            process_feature(&config);
        }
    }

    Ok(())
}
```

---

### Java

```java
import com.savvagent.sdk.*;
import com.google.gson.JsonObject;

public class Example {
    public static void main(String[] args) {
        FlagClientConfig config = new FlagClientConfig.Builder()
            .apiKey(System.getenv("SAVVAGENT_API_KEY"))
            .applicationId("my-app")
            .build();

        try (FlagClient client = new FlagClient(config)) {
            FlagContext context = new FlagContext();
            context.setUserId("user-123");

            // 1. Get configuration as Object
            Object config = client.getConfig("api-settings", context);
            if (config != null) {
                JsonObject json = (JsonObject) config;
                String endpoint = json.get("endpoint").getAsString();
                int timeout = json.get("timeout").getAsInt();
                System.out.println("API: " + endpoint + ", Timeout: " + timeout);
            }

            // 2. Get configuration with type casting
            ApiSettings settings = client.getConfig("api-settings", context, ApiSettings.class);
            if (settings != null) {
                makeApiCall(settings.endpoint, settings.timeout);
            }

            // 3. Get variation
            VariationResult variation = client.getVariation("search-algorithm", context);

            switch (variation.getVariation()) {
                case "control":
                    useStandardSearch(variation.getConfiguration());
                    break;
                case "ml_v1":
                    useMLSearchV1(variation.getConfiguration());
                    break;
                case "ml_v2":
                    useMLSearchV2(variation.getConfiguration());
                    break;
            }

            // 4. Full evaluation
            FlagEvaluationResult result = client.evaluate("feature-x", context);

            if (result.getValue() && result.getConfiguration() != null) {
                processFeature(result.getConfiguration());
            }
        }
    }

    static class ApiSettings {
        String endpoint;
        int timeout;
        int retries;
    }
}
```

---

### Android (Kotlin)

```kotlin
import com.savvagent.sdk.*
import kotlinx.coroutines.runBlocking

class MainActivity : AppCompatActivity() {
    private lateinit var client: SavvagentClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        client = SavvagentClient(
            config = SavvagentConfig(
                sdkKey = BuildConfig.SAVVAGENT_API_KEY,
                apiUrl = "https://flags-api.savvagent.com"
            ),
            context = this
        )

        lifecycleScope.launch {
            setupFeatures()
        }
    }

    private suspend fun setupFeatures() {
        val userContext = UserContext(
            userId = "user-123",
            attributes = mapOf("plan" to "premium")
        )

        // 1. Get configuration
        val themeConfig = client.getConfig("app-theme", userContext).getOrNull()
        themeConfig?.let { config ->
            val primaryColor = config["primaryColor"] as? String
            val fontSize = config["fontSize"] as? Int
            applyTheme(primaryColor, fontSize)
        }

        // 2. Get variation
        val searchVariation = client.getVariationDetails("search-algorithm", userContext).getOrNull()
        searchVariation?.let { result ->
            when (result.variation) {
                "control" -> useStandardSearch(result.configuration)
                "ml_v1" -> useMLSearchV1(result.configuration)
                "ml_v2" -> useMLSearchV2(result.configuration)
            }
        }

        // 3. Full evaluation
        val featureResult = client.evaluate("new-feature", userContext).getOrNull()
        featureResult?.let { result ->
            if (result.value) {
                enableFeature(result.configuration)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        client.close()
    }
}
```

---

### iOS (Swift)

```swift
import SavvagentSDK

class ViewController: UIViewController {
    let client: SavvagentClient

    init() {
        let config = SavvagentConfig(
            sdkKey: Bundle.main.infoDictionary?["SAVVAGENT_API_KEY"] as! String,
            apiUrl: "https://flags-api.savvagent.com"
        )
        client = SavvagentClient(config: config)
        super.init(nibName: nil, bundle: nil)
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        Task {
            await setupFeatures()
        }
    }

    func setupFeatures() async {
        let context = UserContext(
            userId: "user-123",
            attributes: ["plan": "premium"]
        )

        do {
            // 1. Get configuration
            if let themeConfig = try await client.getConfig(
                flagKey: "app-theme",
                context: context
            ) {
                if let primaryColor = themeConfig["primaryColor"] as? String,
                   let fontSize = themeConfig["fontSize"] as? Int {
                    applyTheme(color: primaryColor, fontSize: fontSize)
                }
            }

            // 2. Get variation
            let searchVariation = try await client.getVariationDetails(
                flagKey: "search-algorithm",
                context: context
            )

            switch searchVariation.variation {
            case "control":
                useStandardSearch(config: searchVariation.configuration)
            case "ml_v1":
                useMLSearchV1(config: searchVariation.configuration)
            case "ml_v2":
                useMLSearchV2(config: searchVariation.configuration)
            default:
                break
            }

            // 3. Full evaluation
            let featureResult = try await client.evaluate(
                flagKey: "new-feature",
                context: context
            )

            if featureResult.value {
                enableFeature(config: featureResult.configuration)
            }

        } catch {
            print("Error: \(error)")
        }
    }

    deinit {
        client.close()
    }
}
```

---

## Common Use Cases

### Use Case 1: Dynamic UI Theming

**Goal:** Change app colors/typography without code deployment.

**Flag Configuration (in Savvagent Dashboard):**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "colors": {
        "primary": "#007bff",
        "secondary": "#6c757d",
        "accent": "#28a745"
      },
      "typography": {
        "fontSize": 16,
        "fontFamily": "Inter"
      },
      "spacing": {
        "padding": 16,
        "margin": 8
      }
    }
  }
}
```

**Application Code:**
```typescript
const theme = await client.getConfig('app-theme', { userId });

if (theme) {
  document.documentElement.style.setProperty('--primary-color', theme.colors.primary);
  document.documentElement.style.setProperty('--font-size', `${theme.typography.fontSize}px`);
  document.documentElement.style.setProperty('--padding', `${theme.spacing.padding}px`);
}
```

**Benefits:**
- Test 10 different color schemes in production
- No app updates required
- Instant rollback if users complain
- Segment by user type (free vs premium)

---

### Use Case 2: A/B Testing Search Algorithms

**Goal:** Compare 3 different ranking algorithms.

**Flag Configuration:**
```json
{
  "variations": {
    "control": {
      "allocation": 60,
      "configuration": {
        "algorithm": "bm25",
        "boostRecency": 1.0,
        "boostPopularity": 1.0
      }
    },
    "variant_a": {
      "allocation": 20,
      "configuration": {
        "algorithm": "bm25",
        "boostRecency": 1.5,
        "boostPopularity": 1.2
      }
    },
    "variant_b": {
      "allocation": 20,
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
const variation = await client.getVariation('search-ranking', { userId });

const results = performSearch(query, {
  algorithm: variation.configuration.algorithm,
  boostRecency: variation.configuration.boostRecency,
  boostPopularity: variation.configuration.boostPopularity
});

// Track metrics per variation
analytics.track('search_performed', {
  variation: variation.variation,
  query,
  resultsCount: results.length,
  clickThroughRate: /* calculate */
});
```

**Benefits:**
- Data-driven algorithm selection
- No code changes to test parameters
- Easy to add variant C, D, etc.
- Users consistently see same algorithm

---

### Use Case 3: Feature Limits by Plan

**Goal:** Different limits for free vs premium users.

**Flag Configuration:**
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
  },
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
  attributes: { plan: user.subscriptionPlan }
});

// Enforce limits
if (user.projectCount >= limits.maxProjects) {
  throw new Error(`Project limit reached (${limits.maxProjects}). Upgrade to create more.`);
}

// Enable/disable features
if (limits.enableAdvancedAnalytics) {
  showAdvancedAnalytics();
}

// Apply rate limiting
setRateLimit(limits.apiRateLimit);
```

**Benefits:**
- No hardcoded limits in code
- Easy to adjust limits for testing
- Instant limit changes for promotions
- Granular control per environment

---

### Use Case 4: Backend API Configuration

**Goal:** Dynamically adjust timeouts and retry logic.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "primaryEndpoint": "https://api.primary.com",
      "fallbackEndpoint": "https://api.fallback.com",
      "timeout": 5000,
      "maxRetries": 3,
      "retryBackoff": "exponential",
      "circuitBreakerThreshold": 5,
      "enableFallback": true
    }
  }
}
```

**Application Code:**
```typescript
const apiConfig = await client.getConfig('api-settings');

async function makeApiCall(endpoint: string, data: any) {
  const config = apiConfig || DEFAULT_CONFIG;

  const options = {
    timeout: config.timeout,
    retry: {
      limit: config.maxRetries,
      backoff: config.retryBackoff
    }
  };

  try {
    return await fetch(config.primaryEndpoint + endpoint, options);
  } catch (error) {
    if (config.enableFallback) {
      console.log('Falling back to secondary endpoint');
      return await fetch(config.fallbackEndpoint + endpoint, options);
    }
    throw error;
  }
}
```

**Benefits:**
- Adjust timeouts during incidents
- Enable/disable fallbacks on the fly
- Test different retry strategies
- No deployment for config changes

---

## Best Practices

### 1. Always Provide Default Values

```typescript
// Good
const config = await client.getConfig('api-settings', context, {
  endpoint: 'https://api.default.com',
  timeout: 5000
});

// Bad - may throw if flag is disabled
const config = await client.getConfig('api-settings', context);
const endpoint = config.endpoint; // Error if config is null!
```

### 2. Use Type-Safe Configuration

**TypeScript:**
```typescript
interface ApiConfig {
  endpoint: string;
  timeout: number;
  retries: number;
}

const config = await client.getConfig<ApiConfig>('api-settings', context, {
  endpoint: 'https://api.default.com',
  timeout: 5000,
  retries: 3
});

// Type-safe access
console.log(config.timeout); // TypeScript knows this is a number
```

**Java:**
```java
ApiSettings config = client.getConfig("api-settings", context, ApiSettings.class);
if (config != null) {
    makeApiCall(config.endpoint, config.timeout);
}
```

### 3. Cache Configuration Locally

For frequently accessed configs:

```typescript
class ConfigService {
  private configCache: Map<string, any> = new Map();

  async getConfig(key: string): Promise<any> {
    if (this.configCache.has(key)) {
      return this.configCache.get(key);
    }

    const config = await flagClient.getConfig(key);
    if (config) {
      this.configCache.set(key, config);
    }
    return config;
  }

  invalidate(key: string) {
    this.configCache.delete(key);
  }
}
```

### 4. Track Variation Metrics

```typescript
const variation = await client.getVariation('search-algorithm', { userId });

// Track which variation was used
analytics.identify(userId, {
  searchAlgorithmVariation: variation.variation
});

// Track outcomes per variation
analytics.track('search_completed', {
  variation: variation.variation,
  resultsFound: results.length,
  clickedResult: userClicked,
  timeToFirstClick: duration
});
```

### 5. Handle Configuration Errors Gracefully

```typescript
try {
  const config = await client.getConfig('api-settings');
  if (config) {
    useCustomConfig(config);
  } else {
    useDefaultConfig();
  }
} catch (error) {
  console.error('Failed to fetch config:', error);
  useDefaultConfig();
}
```

### 6. Document Configuration Schema

Create a TypeScript interface or JSON schema:

```typescript
/**
 * Configuration for API settings
 */
interface ApiConfig {
  /** Primary API endpoint URL */
  endpoint: string;

  /** Request timeout in milliseconds */
  timeout: number;

  /** Maximum number of retry attempts */
  retries: number;

  /** Whether to enable fallback endpoint */
  enableFallback: boolean;
}
```

---

## Troubleshooting

### Q: Configuration returns null even though flag is enabled

**A:** Check these:
1. Is `configuration` field set in flag settings?
2. Is the flag enabled for your environment?
3. Do targeting rules match your user context?
4. Check API response in network tab

### Q: Variation always returns "control"

**A:**
1. Check if `variations` field is set (not just `configuration`)
2. Verify allocation percentages add up to 100
3. Ensure consistent hashing is working (same user_id)

### Q: Cache not updating after flag change

**A:**
```typescript
// Manually invalidate cache
client.invalidateCache('flag-key');

// Or invalidate all
client.invalidateCache();
```

### Q: TypeScript types are wrong for configuration

**A:** Cast to your expected type:
```typescript
interface MyConfig {
  setting: string;
}

const config = await client.getConfig<MyConfig>('my-flag');
```

### Q: How do I test locally?

**A:** Use environment-specific flags:
```typescript
const config = await client.getConfig('feature-x', {
  environment: process.env.NODE_ENV // 'development'
});
```

---

## Migration from v1.x

See [MIGRATION-GUIDE.md](./MIGRATION-GUIDE.md) for detailed migration instructions.

**Quick Summary:**
- ✅ Existing `isEnabled()` calls work unchanged
- ✅ No breaking changes to existing API
- ✅ New methods are additions, not replacements
- ✅ Backward compatible with old API responses

## Related Documentation

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Complete API specification and SDK architecture
- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - SDK integration guide
- [MIGRATION-GUIDE.md](./MIGRATION-GUIDE.md) - Migration instructions

---

## Support

- 📚 [Full API Reference](./SDK-REFERENCE.md)
- 💬 [GitHub Discussions](https://github.com/savvagent/savvagent-sdks/discussions)
- 🐛 [Report Issues](https://github.com/savvagent/savvagent-sdks/issues)
- 📧 Email: support@savvagent.com

---

**Version:** 2.0
**Last Updated:** November 2024

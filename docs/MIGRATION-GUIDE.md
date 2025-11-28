# Migration Guide: v1.x → v2.0

**Upgrading to Dynamic Configuration & Multi-Variant Flags**

---

## Overview

Version 2.0 introduces **Dynamic Configuration** and **Multi-Variant Flags** while maintaining 100% backward compatibility with v1.x.

**Good News:**
- ✅ No breaking changes
- ✅ Existing code continues to work
- ✅ Migrate incrementally at your own pace
- ✅ New features are opt-in

---

## What's Changed

### New Features

1. **Dynamic Configuration** - Attach JSON data to flags
2. **Multi-Variant Flags** - A/B/n testing beyond boolean
3. **Enhanced Evaluation Response** - Includes configuration and variation
4. **New SDK Methods** - `getConfig()`, `getVariation()`, `evaluate()`

### No Breaking Changes

- ✅ `isEnabled()` works exactly as before
- ✅ Old API responses still supported
- ✅ Cache behavior unchanged
- ✅ All existing flags continue working

---

## Migration Steps

### Step 1: Update SDK

Update to the latest version:

**Node.js:**
```bash
npm install @savvagent/node-server@latest
# or
yarn upgrade @savvagent/node-server
```

**Go:**
```bash
go get -u github.com/savvagent/go-server@latest
```

**Rust:**
```toml
[dependencies]
savvagent-sdk = "2.0"
```

**Java:**
```xml
<dependency>
    <groupId>com.savvagent</groupId>
    <artifactId>savvagent-sdk</artifactId>
    <version>2.0.0</version>
</dependency>
```

**Android/iOS:**
Update via your package manager (Gradle/CocoaPods/SPM).

### Step 2: Test Existing Code

**Your existing code still works:**

```typescript
// v1.x code - STILL WORKS in v2.0
// Always provide user context for consistent rollout behavior
const enabled = await client.isEnabled('my-flag', { user_id: 'user-123' });
if (enabled) {
  showNewFeature();
}
```

Run your test suite - everything should pass!

### Step 3: Migrate Incrementally

Choose flags to migrate based on value:

**High Value:** Flags that change frequently
**Medium Value:** A/B tests
**Low Value:** Simple on/off toggles

---

## Migration Patterns

### Pattern 1: Simple Configuration

**Before (v1.x):**
```typescript
// Always provide user context for consistent rollout behavior
const enabled = await client.isEnabled('new-checkout', { user_id: 'user-123' });

if (enabled) {
  renderCheckout({
    primaryColor: '#007bff',    // Hardcoded
    buttonText: 'Checkout',      // Hardcoded
    timeout: 5000                // Hardcoded
  });
}
```

**After (v2.0):**
```typescript
// Configuration includes default values for graceful degradation
const config = await client.getConfig('checkout-experience', { user_id: 'user-123' }, {
  primaryColor: '#007bff',
  buttonText: 'Checkout',
  timeout: 5000
});

if (config) {
  renderCheckout(config);
}
```

**Benefits:**
- Change colors without deployment
- Test different button text
- Adjust timeouts on the fly

---

### Pattern 2: A/B Testing

**Before (v1.x):**
```typescript
const useNewAlgorithm = await client.isEnabled('new-search-algo');

if (useNewAlgorithm) {
  results = newSearchAlgorithm(query);
} else {
  results = oldSearchAlgorithm(query);
}
```

**After (v2.0):**
```typescript
const variation = await client.getVariation('search-algorithm');

switch (variation.variation) {
  case 'control':
    results = oldSearchAlgorithm(query, variation.configuration);
    break;
  case 'new_algo':
    results = newSearchAlgorithm(query, variation.configuration);
    break;
  case 'ml_algo':
    results = mlSearchAlgorithm(query, variation.configuration);
    break;
}

// Track results by variation
analytics.track('search', {
  variation: variation.variation,
  resultsCount: results.length
});
```

**Benefits:**
- Test 3+ variations simultaneously
- Each variation has its own config
- Easy to add more variants
- Consistent user experience

---

### Pattern 3: Feature Configuration

**Before (v1.x):**
```typescript
const enableNewFeature = await client.isEnabled('feature-x');

if (enableNewFeature) {
  // Feature always uses same settings
  initFeature({
    mode: 'advanced',
    limit: 100
  });
}
```

**After (v2.0):**
```typescript
const result = await client.evaluate('feature-x');

if (result.value && result.configuration) {
  // Use dynamic settings
  initFeature({
    mode: result.configuration.mode,
    limit: result.configuration.limit,
    enableBeta: result.configuration.enableBeta
  });
}
```

**Benefits:**
- Different settings per environment
- Different settings per user segment
- Change settings without redeployment

---

## SDK-Specific Migration

### Node.js/TypeScript

**Old:**
```typescript
const enabled = await client.isEnabled('flag-key');
```

**New Options:**
```typescript
// Option 1: Just get configuration
const config = await client.getConfig('flag-key');

// Option 2: Get full details
const result = await client.evaluate('flag-key');
console.log(result.value, result.configuration, result.variation);

// Option 3: Get variation
const variation = await client.getVariation('flag-key');
console.log(variation.variation, variation.enabled, variation.configuration);
```

### Go

**Old:**
```go
enabled := client.IsEnabled("flag-key", ctx)
```

**New Options:**
```go
// Option 1: Just get configuration
config, err := client.GetConfig("flag-key", ctx)

// Option 2: Get full details
result, err := client.Evaluate("flag-key", ctx)
fmt.Println(result.Value, result.Configuration, result.Variation)

// Option 3: Get variation
variation, err := client.GetVariation("flag-key", ctx)
fmt.Println(variation.Variation, variation.Enabled, variation.Configuration)
```

### Rust

**Old:**
```rust
let enabled = client.is_enabled("flag-key", None).await;
```

**New Options:**
```rust
// Option 1: Just get configuration
let config = client.get_config("flag-key", None).await?;

// Option 2: Get full details
let result = client.evaluate("flag-key", None).await?;
println!("{} {} {:?}", result.value, result.variation, result.configuration);

// Option 3: Get variation
let variation = client.get_variation("flag-key", None).await?;
println!("{} {}", variation.variation, variation.enabled);
```

### Java

**Old:**
```java
boolean enabled = client.isEnabled("flag-key", context);
```

**New Options:**
```java
// Option 1: Just get configuration
Object config = client.getConfig("flag-key", context);

// Option 2: Get configuration with type
ApiSettings settings = client.getConfig("flag-key", context, ApiSettings.class);

// Option 3: Get full details
FlagEvaluationResult result = client.evaluate("flag-key", context);
System.out.println(result.getValue());
System.out.println(result.getConfiguration());
System.out.println(result.getVariation());

// Option 4: Get variation
VariationResult variation = client.getVariation("flag-key", context);
```

### Android (Kotlin)

**Old:**
```kotlin
val enabled = client.isEnabled(flagKey, userContext).getOrNull() ?: false
```

**New Options:**
```kotlin
// Option 1: Just get configuration
val config = client.getConfig(flagKey, userContext).getOrNull()

// Option 2: Get full details
val result = client.evaluate(flagKey, userContext).getOrNull()
println("${result?.value} ${result?.configuration} ${result?.variation}")

// Option 3: Get variation
val variation = client.getVariationDetails(flagKey, userContext).getOrNull()
println("${variation?.variation} ${variation?.enabled}")
```

### iOS (Swift)

**Old:**
```swift
let enabled = try await client.isEnabled(flagKey: "flag-key", context: context)
```

**New Options:**
```swift
// Option 1: Just get configuration
let config = try await client.getConfig(flagKey: "flag-key", context: context)

// Option 2: Get full details
let result = try await client.evaluate(flagKey: "flag-key", context: context)
print("\(result.value) \(result.configuration) \(result.variation)")

// Option 3: Get variation
let variation = try await client.getVariationDetails(flagKey: "flag-key", context: context)
print("\(variation.variation) \(variation.enabled)")
```

---

## Dashboard Configuration

### Adding Configuration to Existing Flags

1. **Navigate to your flag** in the Savvagent dashboard
2. **Click "Add Configuration"** under environment settings
3. **Enter JSON configuration:**

```json
{
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d"
  },
  "limits": {
    "maxItems": 100,
    "timeout": 5000
  },
  "features": {
    "expressCheckout": true,
    "guestCheckout": false
  }
}
```

4. **Save and deploy**

### Creating Multi-Variant Flags

1. **Create new flag** or edit existing one
2. **Switch to "Multi-Variant" mode**
3. **Add variations:**

```json
{
  "control": {
    "allocation": 60,
    "configuration": {
      "algorithm": "standard",
      "weight": 1.0
    }
  },
  "variant_a": {
    "allocation": 20,
    "configuration": {
      "algorithm": "ml_v1",
      "weight": 1.5
    }
  },
  "variant_b": {
    "allocation": 20,
    "configuration": {
      "algorithm": "ml_v2",
      "weight": 2.0
    }
  }
}
```

4. **Save and deploy**

---

## Common Migration Scenarios

### Scenario 1: Migrating Kill Switch

**Before:**
```typescript
if (await client.isEnabled('new-api')) {
  await callNewAPI();
} else {
  await callOldAPI();
}
```

**After (with rollback config):**
```typescript
const config = await client.getConfig('api-settings', context, {
  useNewAPI: true,
  endpoint: 'https://api.new.com',
  fallback: 'https://api.old.com'
});

try {
  if (config.useNewAPI) {
    await callAPI(config.endpoint);
  } else {
    await callAPI(config.fallback);
  }
} catch (error) {
  // Auto-fallback
  await callAPI(config.fallback);
}
```

### Scenario 2: Migrating Percentage Rollout

**Before:**
```typescript
// 20% of users see new feature
const enabled = await client.isEnabled('new-feature', { userId });
```

**After (with configuration):**
```typescript
// 20% see new feature with config A, 80% see old with config B
const variation = await client.getVariation('feature-rollout', { userId });

if (variation.enabled) {
  showFeature(variation.configuration); // Config A
} else {
  showOldFeature(variation.configuration); // Config B
}
```

### Scenario 3: Migrating Environment-Specific Settings

**Before:**
```typescript
const enabled = await client.isEnabled('feature-x');

if (enabled) {
  const settings = process.env.NODE_ENV === 'production'
    ? { maxRetries: 3, timeout: 5000 }
    : { maxRetries: 1, timeout: 10000 };

  initFeature(settings);
}
```

**After:**
```typescript
const config = await client.getConfig('feature-x', {
  environment: process.env.NODE_ENV
});

if (config) {
  // Environment-specific config from dashboard
  initFeature({
    maxRetries: config.maxRetries,
    timeout: config.timeout
  });
}
```

---

## Testing Your Migration

### Unit Tests

**Before:**
```typescript
it('shows new feature when enabled', async () => {
  mockClient.isEnabled.mockResolvedValue(true);
  await renderComponent();
  expect(screen.getByText('New Feature')).toBeInTheDocument();
});
```

**After:**
```typescript
it('shows new feature with configuration', async () => {
  mockClient.getConfig.mockResolvedValue({
    title: 'New Feature',
    color: '#007bff'
  });
  await renderComponent();
  expect(screen.getByText('New Feature')).toBeInTheDocument();
  expect(screen.getByText('New Feature')).toHaveStyle({ color: '#007bff' });
});
```

### Integration Tests

```typescript
describe('Dynamic Configuration', () => {
  it('uses configuration from API', async () => {
    // Mock API response with configuration
    nock('https://api.savvagent.com')
      .post('/api/evaluate/feature-x')
      .reply(200, {
        value: true,
        configuration: {
          maxItems: 50,
          timeout: 3000
        }
      });

    const config = await client.getConfig('feature-x');
    expect(config.maxItems).toBe(50);
    expect(config.timeout).toBe(3000);
  });
});
```

---

## Rollback Plan

If you encounter issues:

### 1. Revert to Old API Calls

```typescript
// Temporarily revert to old pattern
const enabled = await client.isEnabled('flag-key');
// ... old code ...
```

Your old code still works! No rush to migrate.

### 2. Remove Configuration

In dashboard:
1. Clear `configuration` field
2. Keep flag as simple boolean
3. SDK will work with or without configuration

### 3. Downgrade SDK (if needed)

```bash
npm install @savvagent/node-server@1.x
```

But this shouldn't be necessary - v2.0 is fully backward compatible.

---

## Performance Considerations

### Cache Behavior

- ✅ Configuration is cached along with flag value
- ✅ No additional network calls for `getConfig()`
- ✅ Same cache TTL as before
- ✅ Cache invalidation works same way

### Response Size

Configuration adds to response size, but:
- Gzip compression helps significantly
- Configuration is cached
- Typical configs are small (< 1KB)
- Much smaller than alternative solutions

### Example:

**Without config:** ~100 bytes
```json
{ "value": true, "flag_id": "xyz" }
```

**With config:** ~300 bytes (still tiny!)
```json
{
  "value": true,
  "flag_id": "xyz",
  "configuration": {
    "theme": { "color": "#007bff" },
    "limits": { "max": 100 }
  }
}
```

---

## Best Practices for Migration

### 1. Start Small

Pick 1-2 flags to migrate first:
- Flags you change frequently
- Flags with hardcoded values
- A/B tests with multiple variants

### 2. Test Thoroughly

- Test with configuration present
- Test with configuration missing
- Test with flag disabled
- Test cache behavior

### 3. Monitor Impact

```typescript
const startTime = Date.now();
const config = await client.getConfig('feature-x');
const duration = Date.now() - startTime;

analytics.track('config_fetch', {
  flagKey: 'feature-x',
  duration,
  cached: duration < 10,
  hasConfig: config !== null
});
```

### 4. Document Configurations

Create interfaces/types for your configurations:

```typescript
/**
 * Configuration for checkout experience
 */
interface CheckoutConfig {
  /** Primary theme color */
  primaryColor: string;

  /** Button text */
  buttonText: string;

  /** Checkout timeout in milliseconds */
  timeout: number;

  /** Enable express checkout */
  expressCheckout: boolean;
}

const config = await client.getConfig<CheckoutConfig>('checkout');
```

### 5. Gradual Rollout

1. Deploy code that reads configuration (with defaults)
2. Test in development/staging
3. Add configuration to production flags
4. Monitor for issues
5. Expand usage

---

## Troubleshooting

### "Configuration is undefined"

**Cause:** Flag doesn't have configuration set

**Solution:**
```typescript
// Always provide defaults
const config = await client.getConfig('flag', context, {
  fallback: 'value'
});
```

### "Variation always returns 'control'"

**Cause:** Flag is boolean, not multi-variant

**Solution:** Convert flag to multi-variant in dashboard

### "Cache not showing new configuration"

**Solution:**
```typescript
client.invalidateCache('flag-key');
```

### "TypeScript errors on configuration"

**Solution:** Add proper typing:
```typescript
interface MyConfig {
  setting: string;
}

const config = await client.getConfig<MyConfig>('flag');
```

---

## Support & Resources

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Official API specification
- [Dynamic Configuration Guide](./DYNAMIC-CONFIGURATION-GUIDE.md)
- [SDK Integration Guide](./SDK-INTEGRATION.md)
- [Community Forum](https://github.com/savvagent/savvagent-sdks/discussions)
- [Report Issues](https://github.com/savvagent/savvagent-sdks/issues)
- support@savvagent.com

---

## Summary

✅ **No breaking changes** - Your existing code works
✅ **Migrate incrementally** - One flag at a time
✅ **New features are opt-in** - Use when ready
✅ **Full backward compatibility** - Old and new work together
✅ **Easy rollback** - Revert anytime without issues

Happy migrating! 🎉

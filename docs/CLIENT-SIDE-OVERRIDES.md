# Client-Side Flag Overrides

**Last Updated:** November 2024

This document describes the client-side override capabilities for Savvagent feature flags, enabling developers and users to override flag values locally for testing, debugging, and development purposes.

---

## Table of Contents

1. [Overview](#overview)
2. [API Limitations](#api-limitations)
3. [SDK Override Patterns](#sdk-override-patterns)
4. [Dynamic Configuration Overrides](#dynamic-configuration-overrides)
5. [Web Platform Overrides](#web-platform-overrides)
6. [Mobile Platform Overrides](#mobile-platform-overrides)
7. [Developer Testing](#developer-testing)
8. [User Testing](#user-testing)
9. [Security Considerations](#security-considerations)
10. [Implementation Checklist](#implementation-checklist)

---

## Overview

Savvagent's architecture separates server-side flag evaluation from client-side override capabilities:

- **Server-side (API)**: Evaluates flags based on configuration, targeting rules, and context
- **Client-side (SDK)**: Can override flag values locally without affecting the server evaluation

This separation enables:
- **Developers** to test features locally without modifying production flag configurations
- **Users** to opt into beta features on their device
- **QA teams** to test specific flag combinations without creating custom environments

---

## API Limitations

### What the API Does NOT Support

The `POST /api/flags/:key/evaluate` endpoint **does not accept override parameters**.

**Current API behavior:**
```json
POST /api/flags/:key/evaluate
{
  "context": {
    "user_id": "user-123",
    "environment": "production",
    "language": "en-US"
  }
}
```

The API evaluates flags based on:
- Flag configuration (enabled/disabled per environment)
- Targeting rules (geolocation, language)
- Rollout percentage (sticky hashing)
- Scheduling (time-based activation)

**What is NOT supported:**
- ❌ Override parameter in request body
- ❌ Force-enable/disable flags via API
- ❌ Server-enforced local overrides

### Why Client-Side Overrides?

Since the API doesn't support overrides, **all override logic must be implemented client-side in SDKs**. This approach:
- ✅ Keeps server logic simple and consistent
- ✅ Enables offline testing without API calls
- ✅ Allows per-device customization
- ✅ Preserves server-side analytics accuracy

---

## Fetching All Flags

Before setting up local overrides, you may want to fetch all available flags for your application. The SDK provides the `getAllFlags()` method for this purpose:

```typescript
// Fetch all flags for the current environment
const flags = await client.getAllFlags('development');

// Display in developer UI or console
flags.forEach(flag => {
  console.log(`${flag.key}: ${flag.enabled} (${flag.scope})`);
});

// Store in local cache for overrides
const flagCache = new Map(flags.map(f => [f.key, f]));
```

**Response includes:**
- `key`: Flag identifier
- `enabled`: Current enabled state for the environment
- `scope`: "application" or "enterprise"
- `environments`: Full environment configuration
- `variations`: Variation definitions (for A/B testing)
- `configuration`: Dynamic configuration attached to the flag
- `version`: Flag version (for cache invalidation)

**Use cases:**
- **Local Override UI**: Display all available flags for developers to toggle locally
- **Offline Mode**: Pre-fetch flags for mobile/desktop apps that need to work offline
- **SDK Initialization**: Bootstrap SDK with all flag values on startup
- **DevTools Integration**: Show available flags in browser dev panels

For enterprise-only flags, use `getEnterpriseFlags()`:

```typescript
const enterpriseFlags = await client.getEnterpriseFlags('production');
```

---

## SDK Override Patterns

The SDKs should support multiple override mechanisms to accommodate different use cases.

### 1. Configuration-Based Overrides

Developers can provide overrides during SDK initialization:

```typescript
// Create a single SDK instance at application startup
const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',    // SDK keys use 'sdk_' prefix
  applicationId: 'app-xyz',
  environment: 'development',

  // Override specific flags
  overrides: {
    'new-checkout': true,
    'beta-feature': false,
    'dark-mode': true,
  },
});

// This flag will always return true, even if API says false
// Always provide user context for consistent rollout behavior
await client.isEnabled('new-checkout', { user_id: 'user-123' }); // → true
```

**Use cases:**
- Local development testing
- Feature demos
- Integration tests

---

### 2. Runtime Overrides

Developers can set overrides programmatically after initialization:

```typescript
// Set override for a specific flag
client.setOverride('feature-x', true);

// Now this flag is forced to true
await client.isEnabled('feature-x'); // → true

// Clear the override to use API value again
client.clearOverride('feature-x');

// Clear all overrides
client.clearAllOverrides();
```

**Use cases:**
- Dynamic testing scenarios
- A/B test simulation
- Debugging specific states

---

### 3. LocalStorage-Based Overrides

For web applications, overrides can be persisted in localStorage:

```typescript
// Automatically persist overrides to localStorage
const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',  // SDK keys use 'sdk_' prefix
  persistOverrides: true, // Enables localStorage persistence
});

// Set override (saved to localStorage automatically)
client.setOverride('dark-mode', true);

// Persists across page reloads
// On next page load, dark-mode is still overridden to true
```

**Storage format:**
```javascript
// localStorage key: "savvagent_overrides"
{
  "dark-mode": true,
  "beta-features": false,
  "new-ui": true
}
```

---

### 4. Query Parameter Overrides

Enable flags via URL query parameters for easy testing:

```typescript
// Enable via query param
// https://app.example.com?flag:dark-mode=true&flag:beta-ui=false

const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',  // SDK keys use 'sdk_' prefix
  enableQueryOverrides: true, // Reads from URL query params
});

// Automatically applies overrides from URL
await client.isEnabled('dark-mode'); // → true (from query param)
```

**Query param format:**
- `flag:{flagKey}=true` - Enable flag
- `flag:{flagKey}=false` - Disable flag
- `flag:{flagKey}=clear` - Clear override

**Use cases:**
- Shareable testing links
- QA issue reproduction
- Customer support debugging

---

## Dynamic Configuration Overrides

In addition to overriding boolean flag states, SDKs should support **overriding dynamic configuration values** to enable testing different feature parameters without server changes.

See [DYNAMIC-CONFIGURATION.md](./DYNAMIC-CONFIGURATION.md) for complete details on dynamic configuration support.

### Configuration Override Patterns

#### 1. Boolean + Configuration Override

Override both the enabled state AND the configuration:

```typescript
const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',  // SDK keys use 'sdk_' prefix
  overrides: {
    'checkout-experience': {
      enabled: true,
      configuration: {
        theme: {
          primaryColor: '#ff0000',  // Test with red theme
          secondaryColor: '#00ff00',
          fontSize: 18,
        },
        features: {
          expressCheckout: true,
          guestCheckout: false,
        },
        limits: {
          maxItems: 50,
          timeout: 3000,
        },
      },
    },
  },
});

// Get overridden configuration
const config = await client.getConfig('checkout-experience');
console.log(config.theme.primaryColor); // → '#ff0000'
```

#### 2. Configuration-Only Override

Override just the configuration while letting the API control enabled/disabled:

```typescript
client.setConfigOverride('payment-settings', {
  gateway: 'stripe_test',
  timeout_ms: 10000,
  max_retries: 5,
  enable_fallback: false,
});

// API controls if flag is enabled, but config is overridden
const result = await client.evaluate('payment-settings');
if (result.enabled) {
  // Uses overridden config values
  processPayment(result.configuration);
}
```

#### 3. Partial Configuration Override

Override only specific configuration keys, merge with API values:

```typescript
// API returns: { primaryColor: '#007bff', fontSize: 16, fontFamily: 'Arial' }

client.setConfigOverride('theme-settings', {
  primaryColor: '#ff0000',  // Override only this
  // fontSize and fontFamily come from API
}, { merge: true });

const config = await client.getConfig('theme-settings');
// Result: { primaryColor: '#ff0000', fontSize: 16, fontFamily: 'Arial' }
```

#### 4. Multi-Variant Override

Override which variation is returned (for A/B/n testing):

```typescript
// Force user into specific variant
client.setVariationOverride('search-algorithm', 'variant_b');

const result = await client.getVariation('search-algorithm');
console.log(result.variation); // → 'variant_b'
console.log(result.configuration); // → config for variant_b
```

---

### Dynamic Configuration in Developer UI

The developer console should support editing configuration values visually:

**UI Example:**
```
┌─────────────────────────────────────────────────┐
│ Feature Flag: checkout-experience               │
├─────────────────────────────────────────────────┤
│ Enabled: ☑ Overridden (ON)                      │
│                                                  │
│ Configuration Override:                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ {                                           │ │
│ │   "theme": {                                │ │
│ │     "primaryColor": "#ff0000",  ← Editing   │ │
│ │     "fontSize": 18                          │ │
│ │   },                                        │ │
│ │   "features": {                             │ │
│ │     "expressCheckout": true                 │ │
│ │   }                                         │ │
│ │ }                                           │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ [Validate JSON] [Apply] [Reset to API]          │
└─────────────────────────────────────────────────┘
```

**Features:**
- JSON editor with syntax highlighting
- Real-time validation
- Merge mode toggle (full override vs partial)
- Preview mode (see changes without applying)
- Reset to API values
- Export/import configurations

---

### Configuration Override Storage

**LocalStorage Format:**
```javascript
// localStorage key: "savvagent_config_overrides"
{
  "checkout-experience": {
    "enabled": true,
    "configuration": {
      "theme": {
        "primaryColor": "#ff0000",
        "fontSize": 18
      }
    },
    "merge": false  // Full override, not partial
  },
  "search-algorithm": {
    "variation": "variant_b",  // Force specific variant
    "configuration": {
      "algorithm": "neural_search",
      "threshold": 0.8
    }
  }
}
```

---

### URL Query Parameter Configuration

Support passing configuration values via URL for instant testing:

**Simple Configuration:**
```
https://app.example.com?flag:theme-settings:primaryColor=%23ff0000&flag:theme-settings:fontSize=18
```

**JSON Configuration:**
```
https://app.example.com?flag:checkout-experience:config={"theme":{"primaryColor":"#ff0000"}}
```

**SDK Parsing:**
```typescript
const client = new FlagClient({
  apiKey: 'sdk_dev_abc123',  // SDK keys use 'sdk_' prefix
  enableQueryOverrides: true,
});

// Automatically parses URL and applies overrides
// ?flag:theme-settings:primaryColor=%23ff0000
// → client.setConfigOverride('theme-settings', { primaryColor: '#ff0000' })
```

---

### Mobile Configuration Overrides

#### iOS Developer Menu

```swift
// Show configuration editor
let configEditor = ConfigOverrideViewController(flagKey: "checkout-experience")
configEditor.currentConfig = """
{
  "theme": {
    "primaryColor": "#007bff",
    "fontSize": 16
  }
}
"""
present(configEditor, animated: true)

// Apply override
FlagClient.shared.setConfigOverride(
    "checkout-experience",
    config: ["theme": ["primaryColor": "#ff0000", "fontSize": 18]]
)
```

#### Android Developer Menu

```kotlin
// Show configuration editor dialog
val configDialog = ConfigOverrideDialog(flagKey = "checkout-experience")
configDialog.show(supportFragmentManager, "config_override")

// Apply override
val config = mapOf(
    "theme" to mapOf(
        "primaryColor" to "#ff0000",
        "fontSize" to 18
    )
)
// Use instance method, not static
client.setConfigOverride("checkout-experience", config)
```

---

### Testing Use Cases

#### Use Case 1: UI Theme Testing

**Scenario:** Designer wants to test 5 different color schemes rapidly.

**Solution:**
```typescript
// Preset configurations
const themes = {
  blue: { primaryColor: '#007bff', accentColor: '#0056b3' },
  red: { primaryColor: '#dc3545', accentColor: '#c82333' },
  green: { primaryColor: '#28a745', accentColor: '#218838' },
  purple: { primaryColor: '#6f42c1', accentColor: '#5a32a3' },
  orange: { primaryColor: '#fd7e14', accentColor: '#e66a00' },
};

// Switch themes instantly
function testTheme(themeName) {
  client.setConfigOverride('app-theme', themes[themeName]);
  location.reload(); // Apply theme
}

// Test in browser console
testTheme('red');    // Test red theme
testTheme('purple'); // Test purple theme
```

#### Use Case 2: Algorithm Parameter Tuning

**Scenario:** Data scientist tweaking search ranking parameters.

**Solution:**
```typescript
// Override search algorithm weights
client.setConfigOverride('search-ranking', {
  boost_recency: 2.0,    // Try different weight
  boost_popularity: 1.5,
  boost_relevance: 3.0,
});

// Run test searches
const results = await performSearch('test query');
console.log('Results with new weights:', results);

// Adjust and retry
client.setConfigOverride('search-ranking', {
  boost_recency: 1.5,    // Lower recency
  boost_popularity: 2.0,  // Higher popularity
  boost_relevance: 3.0,
});
```

#### Use Case 3: Feature Limit Testing

**Scenario:** QA testing edge cases for different plan limits.

**Solution:**
```typescript
// Test free plan limits
client.setConfigOverride('plan-limits', {
  maxProjects: 1,
  maxTeamMembers: 1,
  apiRateLimit: 10,
});

// Try creating project (should fail after 1)
await createProject(); // Success
await createProject(); // Error: "Project limit reached"

// Test enterprise limits
client.setConfigOverride('plan-limits', {
  maxProjects: 1000,
  maxTeamMembers: 500,
  apiRateLimit: 100000,
});
```

#### Use Case 4: Error Handling Testing

**Scenario:** Testing timeout and retry behavior.

**Solution:**
```typescript
// Simulate aggressive timeouts
client.setConfigOverride('api-settings', {
  timeout_ms: 100,      // Very short timeout
  max_retries: 1,       // Only retry once
  retry_backoff: 'none',
});

// Should trigger timeout quickly
try {
  await callAPI();
} catch (error) {
  console.log('Timeout triggered:', error);
}

// Test with more lenient settings
client.setConfigOverride('api-settings', {
  timeout_ms: 30000,
  max_retries: 5,
  retry_backoff: 'exponential',
});
```

---

### Configuration Override Validation

SDKs should validate configuration overrides before applying:

```typescript
class FlagClient {
  setConfigOverride(flagKey: string, config: any, options?: {
    merge?: boolean;
    validate?: boolean;  // Default: true
  }) {
    // Validate JSON structure
    if (options?.validate !== false) {
      try {
        JSON.stringify(config);
      } catch (error) {
        throw new Error(`Invalid configuration for flag '${flagKey}': ${error.message}`);
      }
    }

    // Optionally validate against schema (if available)
    if (this.flagSchemas[flagKey]) {
      const isValid = validateSchema(config, this.flagSchemas[flagKey]);
      if (!isValid) {
        console.warn(`Configuration for '${flagKey}' does not match expected schema`);
      }
    }

    // Store override
    this.configOverrides[flagKey] = {
      config,
      merge: options?.merge ?? false,
      timestamp: Date.now(),
    };

    // Persist to localStorage if enabled
    if (this.persistOverrides) {
      this.saveOverridesToStorage();
    }

    // Notify listeners
    this.notifyConfigChanged(flagKey);
  }
}
```

---

### Configuration Override Analytics

Track when configurations are overridden for debugging:

```typescript
// When evaluating a flag with config override
const hasConfigOverride = client.hasConfigOverride(flagKey);
const result = await client.evaluate(flagKey);

if (hasConfigOverride) {
  analytics.track('flag_config_overridden', {
    flagKey,
    enabled: result.enabled,
    configOverridden: true,
    overrideSource: 'localStorage', // or 'queryParam', 'manual'
    timestamp: Date.now(),
  });
}
```

**Benefits:**
- Distinguish test data from real usage
- Track which overrides are most used
- Identify configuration issues early

---

### Security Considerations for Configuration Overrides

1. **Validate Configuration Structure**
   ```typescript
   // Don't allow arbitrary code execution
   const config = JSON.parse(configString); // Safe: just data
   // ❌ eval(configString) // NEVER do this
   ```

2. **Sanitize User Input**
   ```typescript
   // If config includes URLs or HTML
   const sanitized = {
     ...config,
     imageUrl: sanitizeUrl(config.imageUrl),
     htmlContent: escapeHtml(config.htmlContent),
   };
   ```

3. **Size Limits**
   ```typescript
   const MAX_CONFIG_SIZE = 100 * 1024; // 100KB

   if (JSON.stringify(config).length > MAX_CONFIG_SIZE) {
     throw new Error('Configuration too large');
   }
   ```

4. **Production Restrictions**
   ```typescript
   const client = new FlagClient({
     sdkKey: sdkKey,
     // Only allow config overrides in development
     allowConfigOverrides: process.env.NODE_ENV !== 'production',
   });
   ```

---

## Web Platform Overrides

### Developer Console UI

Provide a developer menu in the web app for managing overrides:

```typescript
// Toggle developer menu (e.g., Ctrl+Shift+D)
client.showDeveloperMenu();
```

**Developer menu features:**
- List all available flags
- Show current state (API value vs override value)
- Toggle overrides on/off
- Clear all overrides
- Export/import override configurations

**UI Example:**
```
┌─────────────────────────────────────┐
│ Feature Flags (Developer Mode)       │
├─────────────────────────────────────┤
│ □ dark-mode         [API: false]    │
│ ☑ new-checkout      [Override: ON]  │
│ □ beta-features     [API: false]    │
│                                     │
│ [Clear All] [Export] [Import]       │
└─────────────────────────────────────┘
```

---

### Browser DevTools Integration

Enable Chrome DevTools extension for flag management:

**Example DevTools panel:**
```
Feature Flags
─────────────────────────────────────
 Flag Key         | API    | Override
─────────────────────────────────────
 dark-mode        | false  | [Toggle]
 new-checkout     | true   | [Toggle]
 beta-features    | false  | ✓ true
 rollout-test     | false  | [Toggle]
─────────────────────────────────────
[Refresh] [Clear All] [Export JSON]
```

---

### User-Facing Feature Toggles

Allow end-users to opt into beta features via settings page:

```typescript
// User settings page
function FeatureSettings() {
  const handleToggleBeta = async (flagKey: string, enabled: boolean) => {
    // Set user preference
    client.setOverride(flagKey, enabled);

    // Optionally sync to user profile on server
    await api.updateUserPreferences({
      betaFeatures: { [flagKey]: enabled },
    });
  };

  return (
    <div>
      <h3>Beta Features</h3>
      <label>
        <input
          type="checkbox"
          onChange={(e) => handleToggleBeta('new-ui', e.target.checked)}
        />
        Try New UI (Beta)
      </label>
    </div>
  );
}
```

**Storage:**
- Client-side: localStorage for immediate effect
- Server-side: User preferences table (optional, for cross-device sync)

---

## Mobile Platform Overrides

### iOS/Android Developer Menu

Provide an in-app developer menu accessible via gesture (e.g., triple-tap):

**iOS Example (Swift):**
```swift
// Triple-tap gesture to show flag override menu
let tapGesture = UITapGestureRecognizer(target: self, action: #selector(showFlagMenu))
tapGesture.numberOfTapsRequired = 3
view.addGestureRecognizer(tapGesture)

@objc func showFlagMenu() {
    let flagVC = FlagOverrideViewController()
    present(flagVC, animated: true)
}
```

**Android Example (Kotlin):**
```kotlin
// Triple-tap to show developer menu
var tapCount = 0
view.setOnClickListener {
    tapCount++
    if (tapCount >= 3) {
        showFlagOverrideDialog()
        tapCount = 0
    }
}
```

---

### Local Storage (Mobile)

Store overrides in platform-specific storage:

**iOS (UserDefaults):**
```swift
// Save override
UserDefaults.standard.set(true, forKey: "flag_override_dark_mode")

// Read override
let override = UserDefaults.standard.bool(forKey: "flag_override_dark_mode")
```

**Android (SharedPreferences):**
```kotlin
// Save override
val prefs = context.getSharedPreferences("savvagent_overrides", MODE_PRIVATE)
prefs.edit().putBoolean("dark_mode", true).apply()

// Read override
val override = prefs.getBoolean("dark_mode", false)
```

---

### Debug Builds Only

Restrict override UI to debug builds for security:

**iOS:**
```swift
#if DEBUG
// Show developer menu in debug builds only
func showDeveloperMenu() {
    let menu = FlagOverrideMenu()
    present(menu, animated: true)
}
#endif
```

**Android:**
```kotlin
if (BuildConfig.DEBUG) {
    // Show developer menu in debug builds only
    showFlagOverrideMenu()
}
```

---

### Deep Links for Testing

Support deep links to enable specific flag combinations:

```
// Deep link format
myapp://flags?dark-mode=true&beta-ui=false&new-checkout=true

// SDK handles deep link
client.handleDeepLink(url) // Applies overrides from URL
```

**Use cases:**
- QA testing scenarios
- Bug reproduction links
- Feature preview links

---

## Developer Testing

### Local Development Workflow

```typescript
// Step 1: Initialize SDK with local overrides
const client = new FlagClient({
  sdkKey: 'sdk_dev_local',
  environment: 'development',

  // Enable all testing features
  overrides: {
    'feature-under-development': true,
    'dependencies': true,
  },
});

// Step 2: Test feature
if (await client.isEnabled('feature-under-development')) {
  renderNewFeature();
}

// Step 3: Clear overrides to test production behavior
client.clearAllOverrides();
```

---

### Integration Testing

```typescript
// In test setup
beforeEach(() => {
  client.setOverride('payment-processing', true);
  client.setOverride('email-notifications', false);
});

// Test runs with controlled flag states
test('checkout flow with payments enabled', async () => {
  const result = await client.isEnabled('payment-processing');
  expect(result).toBe(true);

  // Test checkout logic
});

afterEach(() => {
  client.clearAllOverrides();
});
```

---

### Environment-Specific Defaults

```typescript
// Different override sets per environment
const overrides = {
  development: {
    'all-features': true,
    'debug-mode': true,
  },
  staging: {
    'beta-features': true,
  },
  production: {
    // No overrides in production
  },
};

const client = new FlagClient({
  sdkKey: sdkKey,
  environment: process.env.NODE_ENV,
  overrides: overrides[process.env.NODE_ENV],
});
```

---

## User Testing

### Beta Program Opt-In

Allow users to enable beta features:

```typescript
// User settings component
function BetaSettings({ userId }: { userId: string }) {
  const [betaEnabled, setBetaEnabled] = useState(false);

  const toggleBeta = async (enabled: boolean) => {
    // Apply client-side override
    client.setOverride('beta-program', enabled);

    // Persist to user profile
    await api.updateUserSettings(userId, {
      betaProgram: enabled,
    });

    setBetaEnabled(enabled);
  };

  return (
    <div>
      <h3>Beta Testing</h3>
      <p>Get early access to new features</p>
      <Switch checked={betaEnabled} onChange={toggleBeta} />
    </div>
  );
}
```

---

### Feature Previews

Allow users to preview individual features:

```typescript
// Feature catalog with previews
const betaFeatures = [
  {
    key: 'new-dashboard',
    name: 'Redesigned Dashboard',
    description: 'Try our new analytics dashboard',
  },
  {
    key: 'ai-insights',
    name: 'AI-Powered Insights',
    description: 'Get smart recommendations',
  },
];

function FeaturePreviews() {
  return (
    <div>
      <h3>Preview Features</h3>
      {betaFeatures.map((feature) => (
        <FeatureToggle
          key={feature.key}
          flagKey={feature.key}
          name={feature.name}
          description={feature.description}
        />
      ))}
    </div>
  );
}
```

---

### Per-Device Overrides

Allow users to enable features on specific devices:

```typescript
// Device-specific override
const deviceId = getDeviceId(); // e.g., UUID stored in localStorage/SharedPreferences

client.setOverride('mobile-beta-ui', true);
// Only affects this device, not other devices for the same user
```

**Use cases:**
- Users test on one device without affecting others
- Mobile vs desktop different experiences
- Personal vs work device differentiation

---

## Security Considerations

### 1. Production Override Restrictions

**Recommendation:** Disable overrides in production builds by default.

```typescript
const client = new FlagClient({
  apiKey: sdkKey,  // SDK keys use 'sdk_' prefix
  environment: process.env.NODE_ENV,

  // Only allow overrides in development
  allowOverrides: process.env.NODE_ENV !== 'production',
});
```

**Exception:** Allow overrides for beta program users with explicit opt-in.

---

### 2. Override Visibility

Overrides should be transparent and visible:

```typescript
// Show override indicator in UI (development only)
if (client.hasOverride('feature-x')) {
  console.warn('⚠️  Flag "feature-x" is overridden locally');
}

// List all active overrides
console.log('Active overrides:', client.getOverrides());
// → { "dark-mode": true, "beta-ui": false }
```

---

### 3. Telemetry with Overrides

Track when overrides are used:

```typescript
// When evaluating a flag with an override
const hasOverride = client.hasOverride(flagKey);
const result = await client.isEnabled(flagKey);

// Send telemetry with override flag
if (hasOverride) {
  analytics.track('flag_evaluation', {
    flagKey,
    result,
    overridden: true, // Mark this evaluation as overridden
  });
}
```

**Benefits:**
- Distinguish real flag evaluations from test/override evaluations
- Prevent skewed analytics
- Track beta program usage

---

### 4. Server-Side Validation

For user-facing beta features, validate on the server:

```typescript
// Client: User enables beta feature
client.setOverride('beta-feature', true);

// Server: Verify user is in beta program
app.get('/api/beta-feature-data', async (req, res) => {
  const user = await getUser(req.userId);

  if (!user.betaProgramEnabled) {
    return res.status(403).json({ error: 'Not in beta program' });
  }

  // Serve beta feature data
  res.json({ data: 'beta data' });
});
```

**Important:** Never trust client-side overrides for security-critical features. Always validate on the server.

---

## Implementation Checklist

### SDK Features (To Be Implemented)

**Boolean Override Support:**
- [ ] Configuration-based overrides (`overrides` option)
- [ ] Runtime override methods (`setOverride`, `clearOverride`, `clearAllOverrides`)
- [ ] Override inspection (`getOverrides`, `hasOverride`)
- [ ] Production override restrictions

**Dynamic Configuration Override Support:**
- [ ] Configuration override methods (`setConfigOverride`, `getConfigOverride`, `clearConfigOverride`)
- [ ] Partial configuration merging (`merge: true` option)
- [ ] Multi-variant override (`setVariationOverride`)
- [ ] Configuration validation (JSON structure, size limits)
- [ ] Configuration override inspection (`hasConfigOverride`, `getConfigOverrides`)
- [ ] Schema validation (optional)

**Persistence & Transport:**
- [ ] LocalStorage persistence (`persistOverrides` option)
- [ ] Query parameter overrides (`enableQueryOverrides` option)
- [ ] Query parameter config parsing (JSON and key-value)
- [ ] Deep link support (mobile SDK)

**UI & Developer Tools:**
- [ ] Developer menu UI (web SDK)
- [ ] JSON editor with syntax highlighting
- [ ] Configuration preview mode
- [ ] Export/import configurations
- [ ] Telemetry with override tracking

### Web SDK

**Boolean Overrides:**
- [ ] Browser DevTools extension
- [ ] Developer console UI (Ctrl+Shift+D)
- [ ] LocalStorage persistence
- [ ] URL query parameter parsing
- [ ] Export/import override configurations

**Configuration Overrides:**
- [ ] JSON configuration editor UI
- [ ] Syntax highlighting and validation
- [ ] Merge mode toggle
- [ ] URL query parameter config parsing
- [ ] Configuration preset manager
- [ ] Visual schema validator (if schemas available)

### Mobile SDK (iOS/Android)

**Boolean Overrides:**
- [ ] In-app developer menu (gesture-activated)
- [ ] UserDefaults/SharedPreferences persistence
- [ ] Debug build restrictions
- [ ] Deep link handler
- [ ] Override status indicators

**Configuration Overrides:**
- [ ] JSON configuration editor UI (native)
- [ ] Configuration validation
- [ ] Deep link config parsing
- [ ] Configuration preset manager
- [ ] Export/share configurations

### Documentation

- [x] API limitations documented
- [x] SDK override patterns defined
- [x] Web platform override guide
- [x] Mobile platform override guide
- [x] Dynamic configuration override patterns
- [x] Configuration override use cases
- [ ] Update SDK-REFERENCE.md with override API
- [ ] Add examples to USER-GETTING-STARTED.md

---

## Next Steps

### Phase 1: Core SDK Support
**Boolean Overrides:**
1. Implement configuration-based overrides
2. Add runtime override methods (`setOverride`, `clearOverride`)
3. Add override inspection methods (`hasOverride`, `getOverrides`)
4. Update SDK tests

**Dynamic Configuration Overrides:**
5. Add configuration override methods (`setConfigOverride`, `clearConfigOverride`)
6. Implement configuration merging logic
7. Add configuration validation
8. Update SDK tests for config overrides

### Phase 2: Persistence
**Boolean Overrides:**
1. LocalStorage persistence (web)
2. UserDefaults/SharedPreferences (mobile)
3. Query parameter overrides (web)
4. Deep link support (mobile)

**Configuration Overrides:**
5. LocalStorage config persistence (web)
6. Query parameter config parsing (JSON + key-value)
7. Deep link config parsing (mobile)
8. Configuration size limits enforcement

### Phase 3: Developer UX
**Boolean Overrides:**
1. Developer console UI (web)
2. In-app developer menu (mobile)
3. Browser DevTools extension
4. Export/import override configurations

**Configuration Overrides:**
5. JSON configuration editor UI
6. Syntax highlighting and validation
7. Configuration preset manager
8. Merge mode toggle UI

### Phase 4: User Features
**Boolean Overrides:**
1. Beta program opt-in UI
2. Feature preview catalog
3. Per-device override management

**Configuration Overrides:**
4. User-friendly configuration editors (non-technical users)
5. Configuration templates/presets
6. Server-side user preference sync (optional)

---

## References

- [SDK-DEVELOPER-GUIDE.md](./SDK-DEVELOPER-GUIDE.md) - Official SDK development guide with API specification
- [SDK-INTEGRATION.md](./SDK-INTEGRATION.md) - SDK integration guide
- [Dynamic Configuration](./DYNAMIC-CONFIGURATION.md) - Dynamic configuration capabilities
- Backend evaluation logic: `backend/src/api/flags.rs:338`

---

**Questions or feedback?**
- GitHub Issues: https://github.com/savvagent/savvagent/issues
- Email: support@savvagent.com

**Last Updated:** November 2024

# Savvagent Android SDK

The official Android SDK for [Savvagent](https://flags.savvagent.com) - the AI-powered feature flag platform that prevents production incidents.

## Features

- **Native Kotlin API** - Idiomatic Kotlin with coroutines support
- **Real-time Updates** - Server-Sent Events stream for instant flag invalidation, with automatic reconnect
- **Automatic Caching** - Per-user evaluation cache, refreshed by polling and realtime events
- **Telemetry** - Batched evaluation and error reporting
- **Type-Safe** - Full type safety with Kotlin's type system
- **Lightweight** - Minimal dependencies
- **Lifecycle Aware** - Integrates with Android lifecycle components
- **Flow Support** - Reactive flag updates using Kotlin Flow

## Requirements

- Android 5.0 (API level 21) or higher
- Kotlin 1.9+
- Gradle 8.0+

## Installation

### Gradle (Kotlin DSL)

Add to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("com.savvagent:android-sdk:0.1.0")
}
```

### Gradle (Groovy)

Add to your `build.gradle`:

```groovy
dependencies {
    implementation 'com.savvagent:android-sdk:0.1.0'
}
```

### Maven

```xml
<dependency>
    <groupId>com.savvagent</groupId>
    <artifactId>android-sdk</artifactId>
    <version>0.1.0</version>
</dependency>
```

## Quick Start

### Basic Usage

```kotlin
import com.savvagent.sdk.*
import kotlinx.coroutines.launch

// Configure the SDK
val config = SavvagentConfig(
    sdkKey = "your-sdk-key",
    environment = "production"
    // apiUrl defaults to https://api.savvagent.com/flags
)

// Initialize the client
val client = SavvagentClient(config, context)

// Create user context
val userContext = UserContext(
    userId = "user-123",
    attributes = mapOf(
        "email" to "user@example.com",
        "plan" to "pro"
    )
)

// Check if a feature is enabled
lifecycleScope.launch {
    val result = client.isEnabled("new-feature", userContext)
    result.onSuccess { isEnabled ->
        if (isEnabled) {
            // Show new feature
        } else {
            // Show old feature
        }
    }
}
```

### Jetpack Compose Integration

```kotlin
import androidx.compose.runtime.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun FeatureScreen(client: SavvagentClient) {
    val flags by client.flagUpdates.collectAsStateWithLifecycle()
    val isNewUIEnabled = flags["new-ui"] ?: false

    if (isNewUIEnabled) {
        NewUI()
    } else {
        OldUI()
    }
}

// ViewModel integration
class FeatureViewModel(private val client: SavvagentClient) : ViewModel() {
    private val userContext = UserContext(userId = "current-user")

    val isFeatureEnabled = MutableLiveData<Boolean>()

    fun checkFeature() {
        viewModelScope.launch {
            val result = client.isEnabled("new-feature", userContext)
            result.onSuccess { enabled ->
                isFeatureEnabled.postValue(enabled)
            }
        }
    }
}
```

### Traditional View Integration

```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var client: SavvagentClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val config = SavvagentConfig(
            sdkKey = "your-sdk-key",
            environment = "production"
        )
        client = SavvagentClient(config, this)

        loadFeatureFlags()
    }

    private fun loadFeatureFlags() {
        lifecycleScope.launch {
            val context = UserContext(userId = "user-123")

            val result = client.isEnabled("new-feature", context)
            result.onSuccess { isEnabled ->
                if (isEnabled) {
                    setupNewFeature()
                } else {
                    setupOldFeature()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        client.close()
    }
}
```

## Advanced Usage

### Configuration Options

```kotlin
val config = SavvagentConfig(
    apiUrl = "https://api.savvagent.com/flags", // default; trailing slashes are ignored
    sdkKey = "your-sdk-key",
    environment = "production",
    pollingInterval = 60_000L,     // Re-fetch the environment flag list every 60 seconds (0 disables)
    enableWebSocket = true,         // Enable realtime updates (Server-Sent Events)
    timeout = 30_000L,              // Request timeout in milliseconds
    enableLogging = true,           // Enable debug logging
    enableTelemetry = true          // Report evaluations and errors
)
```

Requests are authenticated with `Authorization: Bearer <sdk key>`.

### Getting Variation Values

The evaluate response carries the variation and configuration, so there is no separate
variation request. `getVariation` evaluates the flag and returns the variation name or the
flag configuration, whichever matches the type of the default value.

```kotlin
// Get string variation
val theme = client.getVariation(
    flagKey = "app-theme",
    userContext = context,
    defaultValue = "light"
)

// Full details
val details = client.getVariationDetails("app-theme", context).getOrNull()
// details?.variation, details?.enabled, details?.configuration
```

### Telemetry

Evaluations are batched and sent to `POST /api/telemetry/evaluations` every 5 seconds (or when
50 are queued, at most 1000 per request). Report errors that happen while a flag is in effect so
the server can compare error rates with the flag on and off:

```kotlin
try {
    renderNewCheckout()
} catch (e: Exception) {
    client.reportError("new-checkout", e, userContext, flagEnabled = true)
}

// Force a flush (for example before the app is backgrounded)
lifecycleScope.launch { client.flush() }
```

`track(...)` is deprecated and does nothing: the Flags API has no custom event endpoint.

### Real-time Flag Updates

The client keeps a Server-Sent Events connection to `GET /api/flags/stream`. On any
`flag.created`, `flag.updated` or `flag.deleted` event the cached value for that flag is
discarded, so the next evaluation fetches fresh data, and listeners are notified. The
connection reconnects with exponential backoff (1s up to 30s).

```kotlin
client.addFlagChangeListener { flagKey, eventType ->
    // eventType is "flag.updated", etc. Runs on a background thread.
}

// Observe flag updates using Flow
lifecycleScope.launch {
    client.flagUpdates.collect { flags ->
        val isEnabled = flags["new-feature"] ?: false
        updateUI(isEnabled)
    }
}
```

### Cleanup

```kotlin
// Close the client when done
override fun onDestroy() {
    super.onDestroy()
    client.close()
}
```

## Configuration

### User Context

The `UserContext` object contains information about the user for flag evaluation:

```kotlin
val context = UserContext(
    userId = "user-123",
    attributes = mapOf(
        "email" to "user@example.com",
        "plan" to "pro",
        "signupDate" to "2024-01-01",
        "country" to "US",
        "customAttribute" to true
    )
)
```

### Realtime Support

Realtime updates use Server-Sent Events. The `enableWebSocket` option name is kept for
compatibility and controls whether the stream is opened:

```kotlin
val config = SavvagentConfig(
    sdkKey = "your-sdk-key",
    enableWebSocket = true  // Cached flags are invalidated in real time
)
```

### Caching

The SDK caches flag evaluations (per user) to improve performance. The polling interval controls
how often the environment flag list (`GET /api/sdk/flags?environment=...`) is re-fetched; cached
evaluations whose flag version changed are discarded. Call `refresh()` to fetch on demand.

```kotlin
val config = SavvagentConfig(
    sdkKey = "your-sdk-key",
    pollingInterval = 30_000L  // Poll every 30 seconds
)
```

## Testing

The SDK includes comprehensive unit tests:

```bash
./gradlew test
```

Run instrumentation tests:

```bash
./gradlew connectedAndroidTest
```

## Error Handling

The SDK uses Kotlin's `Result` type for error handling:

```kotlin
val result = client.isEnabled("feature", context)

result
    .onSuccess { isEnabled ->
        // Handle success
    }
    .onFailure { error ->
        when (error) {
            is SavvagentException -> {
                // Handle Savvagent-specific error
            }
            else -> {
                // Handle other errors
            }
        }
    }
```

## ProGuard / R8

If you're using ProGuard or R8, add these rules to your `proguard-rules.pro`:

```proguard
# Savvagent SDK
-keep class com.savvagent.sdk.** { *; }
-keepclassmembers class com.savvagent.sdk.** { *; }

# OkHttp
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }

# Kotlin Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
```

## Best Practices

1. **Initialize Once** - Create a single client instance and reuse it (consider using Dependency Injection)
2. **Use Context** - Provide rich user context for accurate targeting
3. **Handle Errors** - Always handle potential errors gracefully using Result
4. **Observe Updates** - Use Flow to react to flag changes in real-time
5. **Clean Up** - Call `close()` when your Activity/Fragment is destroyed
6. **Background Thread** - The SDK handles threading automatically with coroutines

## Example App

See the [Android example app](../../examples/android-app) for a complete implementation.

## Documentation

- [API Reference](https://flags-docs.savvagent.com/android-sdk)
- [Integration Guide](https://flags-docs.savvagent.com/guides/android)
- [Migration Guide](https://flags-docs.savvagent.com/migration/android)

## Support

- [GitHub Issues](https://github.com/savvagent/flags-sdks/issues)
- [Documentation](https://flags-docs.savvagent.com)
- [Email](mailto:support@savvagent.com)

## License

MIT License - see [LICENSE](../../LICENSE) for details

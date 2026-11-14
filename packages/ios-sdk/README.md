# Savvagent iOS SDK

The official iOS SDK for [Savvagent](https://flags.savvagent.com) - the AI-powered feature flag platform that prevents production incidents.

## Features

- **Native Swift API** - Idiomatic Swift with async/await support
- **Real-time Updates** - Server-Sent Events stream for instant flag updates
- **Automatic Caching** - Smart caching with configurable polling
- **Type-Safe** - Full type safety with Swift's type system
- **Lightweight** - Zero external dependencies
- **Cross-Platform** - Works on iOS, macOS, tvOS, and watchOS

## Requirements

- iOS 15.0+ / macOS 12.0+ / tvOS 15.0+ / watchOS 8.0+
- Swift 5.9+
- Xcode 15.0+

## Installation

### Swift Package Manager

Add the following to your `Package.swift` file:

```swift
dependencies: [
    .package(url: "https://github.com/savvagent/savvagent-sdks", from: "0.1.0")
]
```

Or in Xcode:

1. File > Add Package Dependencies
2. Enter package URL: `https://github.com/savvagent/savvagent-sdks`
3. Select `SavvagentSDK` package

### CocoaPods

```ruby
pod 'SavvagentSDK', '~> 0.1.0'
```

### Carthage

```
github "savvagent/savvagent-sdks" ~> 0.1.0
```

## Quick Start

### Basic Usage

```swift
import SavvagentSDK

// Configure the SDK
let config = SavvagentConfig(
    apiUrl: "https://api.savvagent.com/flags",
    sdkKey: "your-sdk-key",
    environment: "production"
)

// Initialize the client
let client = SavvagentClient(config: config)

// Create user context
let context = UserContext(
    userId: "user-123",
    attributes: [
        "email": "user@example.com",
        "plan": "pro"
    ]
)

// Check if a feature is enabled
do {
    let isEnabled = try await client.isEnabled(
        flagKey: "new-feature",
        context: context
    )

    if isEnabled {
        // Show new feature
    } else {
        // Show old feature
    }
} catch {
    print("Error checking flag: \(error)")
}
```

### SwiftUI Integration

```swift
import SwiftUI
import SavvagentSDK

struct ContentView: View {
    @StateObject private var featureFlags = FeatureFlagManager()

    var body: some View {
        VStack {
            if featureFlags.isEnabled("new-ui") {
                NewUIView()
            } else {
                OldUIView()
            }
        }
        .task {
            await featureFlags.load()
        }
    }
}

@MainActor
class FeatureFlagManager: ObservableObject {
    @Published var flags: [String: Bool] = [:]
    private let client: SavvagentClient

    init() {
        let config = SavvagentConfig(
            sdkKey: "your-sdk-key",
            environment: "production"
        )
        self.client = SavvagentClient(config: config)
    }

    func isEnabled(_ key: String) -> Bool {
        return flags[key] ?? false
    }

    func load() async {
        let context = UserContext(userId: "current-user")

        do {
            flags["new-ui"] = try await client.isEnabled(
                flagKey: "new-ui",
                context: context
            )
        } catch {
            print("Error loading flags: \(error)")
        }
    }
}
```

### UIKit Integration

```swift
import UIKit
import SavvagentSDK

class ViewController: UIViewController {
    private let client: SavvagentClient

    init() {
        let config = SavvagentConfig(
            sdkKey: "your-sdk-key",
            environment: "production"
        )
        self.client = SavvagentClient(config: config)
        super.init(nibName: nil, bundle: nil)
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        Task {
            await loadFeatureFlags()
        }
    }

    func loadFeatureFlags() async {
        let context = UserContext(userId: "user-123")

        do {
            let showNewFeature = try await client.isEnabled(
                flagKey: "new-feature",
                context: context
            )

            if showNewFeature {
                setupNewFeature()
            } else {
                setupOldFeature()
            }
        } catch {
            print("Error: \(error)")
        }
    }
}
```

## Advanced Usage

### Configuration Options

```swift
let config = SavvagentConfig(
    apiUrl: "https://api.savvagent.com/flags", // default; trailing slashes are stripped
    sdkKey: "your-sdk-key",
    environment: "production",
    pollingInterval: 60,        // Re-sync flag versions every 60 seconds (0 disables)
    enableWebSocket: true,       // Realtime updates over Server-Sent Events (name kept for compatibility)
    timeout: 30,                 // Request timeout in seconds
    enableTelemetry: true        // Batched evaluation telemetry
)
```

### Getting Variation Values

The server has no separate variation endpoint; the variation is part of the
evaluate response (`POST /api/flags/{key}/evaluate`).

```swift
// Variation name (String), falling back to the default on any error
let theme = await client.getVariation(
    flagKey: "app-theme",
    context: context,
    defaultValue: "light"
)

// Full details
let details = try await client.getVariationDetails(flagKey: "app-theme", context: context)
print(details.variation, details.enabled, details.configuration ?? [:])
```

### Bulk Fetch

```swift
// GET /api/sdk/flags?environment=...
// `enabled` is the environment master switch, not a per-user evaluation.
let flags = try await client.fetchAllFlags()
```

### Telemetry and Error Reporting

Evaluations are batched and sent to `/api/telemetry/evaluations` (at most 1000 per
request). Call `flush()` to send immediately.

```swift
await client.flush()

// POST /api/telemetry/errors
await client.reportError(flagKey: "new-checkout", flagEnabled: true, error: error, context: context)
```

`track(eventName:...)` is deprecated and does nothing: the Flags API has no custom
events endpoint.

### Cleanup

```swift
// Close the client when done
client.close()
```

## Configuration

### User Context

The `UserContext` object contains information about the user for flag evaluation:

```swift
let context = UserContext(
    userId: "user-123",
    attributes: [
        "email": "user@example.com",
        "plan": "pro",
        "signupDate": "2024-01-01",
        "country": "US",
        "customAttribute": true
    ]
)
```

### Realtime Updates (SSE)

With `enableWebSocket: true` (the default) the client keeps a Server-Sent Events
connection open to `GET /api/flags/stream`. On `flag.created`, `flag.updated` and
`flag.deleted` events the cached value for that flag is dropped and listeners are
notified. The connection reconnects with exponential backoff (1s up to 30s).

```swift
let token = client.addFlagChangeListener { event in
    print(event.type, event.flagKey, event.version ?? -1)
}
client.removeFlagChangeListener(token)
```

### Caching

The SDK caches evaluations per flag and user. The polling interval controls how often flag versions are re-synced via the bulk endpoint; stale entries are dropped:

```swift
let config = SavvagentConfig(
    sdkKey: "your-sdk-key",
    pollingInterval: 30  // Poll every 30 seconds
)
```

## Testing

The SDK includes comprehensive unit tests:

```bash
swift test
```

## Error Handling

The SDK defines the following errors:

```swift
enum SavvagentError: Error {
    case invalidURL
    case requestFailed
    case invalidResponse
    case networkError(Error)
}
```

Handle errors appropriately:

```swift
do {
    let isEnabled = try await client.isEnabled(
        flagKey: "feature",
        context: context
    )
} catch SavvagentError.requestFailed {
    print("Request failed")
} catch SavvagentError.invalidResponse {
    print("Invalid response")
} catch {
    print("Unknown error: \(error)")
}
```

## Best Practices

1. **Initialize Once** - Create a single client instance and reuse it
2. **Use Context** - Provide rich user context for accurate targeting
3. **Handle Errors** - Always handle potential errors gracefully
4. **Cache Results** - Let the SDK handle caching automatically
5. **Clean Up** - Call `close()` when your app terminates

## Example App

See the [iOS example app](../../examples/ios-app) for a complete implementation.

## Documentation

- [API Reference](https://flags-docs.savvagent.com/ios-sdk)
- [Integration Guide](https://flags-docs.savvagent.com/guides/ios)
- [Migration Guide](https://flags-docs.savvagent.com/migration/ios)

## Support

- [GitHub Issues](https://github.com/savvagent/savvagent-sdks/issues)
- [Documentation](https://flags-docs.savvagent.com)
- [Email](mailto:support@savvagent.com)

## License

MIT License - see [LICENSE](../../LICENSE) for details

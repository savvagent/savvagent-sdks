# Savvagent iOS SDK

The official iOS SDK for [Savvagent](https://flags.savvagent.com) - the AI-powered feature flag platform that prevents production incidents.

## Features

- **Native Swift API** - Idiomatic Swift with async/await support
- **Real-time Updates** - WebSocket support for instant flag updates
- **Automatic Caching** - Smart caching with configurable polling
- **Type-Safe** - Full type safety with Swift's type system
- **Lightweight** - Zero external dependencies
- **Cross-Platform** - Works on iOS, macOS, tvOS, and watchOS

## Requirements

- iOS 13.0+ / macOS 10.15+ / tvOS 13.0+ / watchOS 6.0+
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
    apiUrl: "https://flags-beta.savvagent.com",
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
    apiUrl: "https://flags-beta.savvagent.com",
    sdkKey: "your-sdk-key",
    environment: "production",
    pollingInterval: 60,        // Poll every 60 seconds
    enableWebSocket: true,       // Enable real-time updates
    timeout: 30                  // Request timeout in seconds
)
```

### Getting Variation Values

```swift
// Get string variation
let theme = await client.getVariation(
    flagKey: "app-theme",
    context: context,
    defaultValue: "light"
)

// Get numeric variation
let maxItems = await client.getVariation(
    flagKey: "max-items",
    context: context,
    defaultValue: 10
)

// Get JSON variation
let config = await client.getVariation(
    flagKey: "app-config",
    context: context,
    defaultValue: ["key": "value"]
)
```

### Event Tracking

```swift
// Track custom events
await client.track(
    eventName: "feature_used",
    context: context,
    properties: [
        "feature": "new-checkout",
        "duration": 1234
    ]
)
```

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

### WebSocket Support

Enable WebSocket for real-time flag updates:

```swift
let config = SavvagentConfig(
    sdkKey: "your-sdk-key",
    enableWebSocket: true  // Flags update in real-time
)
```

### Caching

The SDK automatically caches flag evaluations to improve performance. Configure polling interval:

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

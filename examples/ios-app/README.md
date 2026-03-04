# Savvagent iOS Example App

This is an example iOS application demonstrating how to integrate and use the Savvagent iOS SDK.

## Features

- SwiftUI-based modern iOS app
- Real-time feature flag evaluation
- Clean architecture with EnvironmentObject
- Multiple feature flag examples
- Interactive UI to see flags in action

## Requirements

- iOS 17.0+
- Xcode 15.0+
- Swift 5.9+

## Setup

1. Open the project in Xcode:
   ```bash
   cd examples/ios-app
   open SavvagentExample.xcodeproj
   ```

2. Update the SDK key in `SavvagentExampleApp.swift`:
   ```swift
   let config = SavvagentConfig(
       apiUrl: "https://flags-beta.savvagent.com",
       sdkKey: "your-sdk-key",  // Replace with your SDK key
       environment: "production"
   )
   ```

3. Run the app:
   - Select a simulator or device
   - Press Cmd+R to build and run

## Project Structure

```
SavvagentExample/
├── SavvagentExampleApp.swift      # App entry point and flag manager
├── ContentView.swift               # Main view with feature flag list
└── Assets.xcassets/                # App assets
```

## Key Components

### FeatureFlagManager

The `FeatureFlagManager` class manages the Savvagent SDK client and provides feature flag state to the SwiftUI views:

```swift
@StateObject private var featureFlags = FeatureFlagManager()
```

### Feature Flags Used

- `new-ui` - Demonstrates UI variations
- `dark-mode` - Shows theme switching
- `premium-features` - Demonstrates feature access control

## Usage Examples

### Checking a Flag

```swift
if featureFlags.isEnabled("new-ui") {
    NewUIView()
} else {
    OldUIView()
}
```

### Refreshing Flags

```swift
Button("Refresh Flags") {
    Task {
        await featureFlags.loadFlags()
    }
}
```

## Customization

You can add more feature flags by:

1. Adding them to the `loadFlags()` method in `FeatureFlagManager`
2. Creating corresponding UI components
3. Using them in your views

## Learn More

- [iOS SDK Documentation](../../packages/ios-sdk/README.md)
- [Savvagent Documentation](https://flags-docs.savvagent.com)
- [SwiftUI Guide](https://developer.apple.com/tutorials/swiftui)

## License

MIT License - see [LICENSE](../../LICENSE) for details

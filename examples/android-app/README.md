# Savvagent Android Example App

This is an example Android application demonstrating how to integrate and use the Savvagent Android SDK.

## Features

- Jetpack Compose modern UI
- Real-time feature flag evaluation
- MVVM architecture with ViewModel
- Kotlin Coroutines and Flow
- Material Design 3
- Error handling and loading states

## Requirements

- Android 5.0 (API level 21) or higher
- Android Studio Hedgehog (2023.1.1) or later
- Kotlin 1.9+
- Gradle 8.0+

## Setup

1. Open the project in Android Studio:
   ```bash
   cd examples/android-app
   # Open in Android Studio
   ```

2. Update the SDK key in `FeatureFlagsViewModel.kt`:
   ```kotlin
   val config = SavvagentConfig(
       apiUrl = "https://flags-beta.savvagent.com",
       sdkKey = "your-sdk-key",  // Replace with your SDK key
       environment = "production"
   )
   ```

3. Sync Gradle files and run the app:
   - Click "Sync Now" when prompted
   - Select a device or emulator
   - Click the Run button

## Project Structure

```
app/src/main/java/com/savvagent/example/
├── MainActivity.kt                 # Main activity with Compose UI
├── FeatureFlagsViewModel.kt        # ViewModel managing SDK
└── ui/theme/
    └── Theme.kt                    # Material Design theme
```

## Key Components

### FeatureFlagsViewModel

The `FeatureFlagsViewModel` manages the Savvagent SDK client and provides feature flag state:

```kotlin
class FeatureFlagsViewModel : AndroidViewModel {
    val uiState: StateFlow<FeatureFlagsUiState>
    fun refreshFlags()
}
```

### Feature Flags Used

- `new-ui` - Demonstrates UI variations
- `dark-mode` - Shows theme switching
- `premium-features` - Demonstrates feature access control

## Usage Examples

### Observing Flags in Compose

```kotlin
@Composable
fun FeatureFlagsScreen(viewModel: FeatureFlagsViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    if (uiState.isFeatureEnabled("new-ui")) {
        NewUI()
    } else {
        OldUI()
    }
}
```

### Refreshing Flags

```kotlin
IconButton(onClick = { viewModel.refreshFlags() }) {
    Icon(Icons.Default.Refresh, contentDescription = "Refresh")
}
```

## Building

### Debug Build

```bash
./gradlew assembleDebug
```

### Release Build

```bash
./gradlew assembleRelease
```

### Run Tests

```bash
./gradlew test
```

## Customization

You can add more feature flags by:

1. Adding them to `featureFlagDefinitions` in `FeatureFlagsViewModel`
2. Creating corresponding UI components in `MainActivity`
3. Using them in your composables

## Architecture

The app follows modern Android development best practices:

- **MVVM Architecture** - Separation of concerns with ViewModel
- **Jetpack Compose** - Modern declarative UI toolkit
- **Kotlin Coroutines** - Asynchronous programming
- **StateFlow** - Reactive state management
- **Material Design 3** - Modern design system

## Learn More

- [Android SDK Documentation](../../packages/android-sdk/README.md)
- [Savvagent Documentation](https://flags-docs.savvagent.com)
- [Jetpack Compose Guide](https://developer.android.com/jetpack/compose)

## License

MIT License - see [LICENSE](../../LICENSE) for details

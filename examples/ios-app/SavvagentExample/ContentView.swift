import SwiftUI
import SavvagentSDK

struct ContentView: View {
    @EnvironmentObject var featureFlags: FeatureFlagManager

    var body: some View {
        NavigationStack {
            ZStack {
                if featureFlags.isLoading {
                    ProgressView("Loading feature flags...")
                } else {
                    FeatureFlagsList()
                }
            }
            .navigationTitle("Savvagent Demo")
        }
    }
}

struct FeatureFlagsList: View {
    @EnvironmentObject var featureFlags: FeatureFlagManager

    var body: some View {
        List {
            Section("Feature Flags") {
                FeatureFlagRow(
                    title: "New UI",
                    description: "Modern redesigned user interface",
                    isEnabled: featureFlags.isEnabled("new-ui")
                )

                FeatureFlagRow(
                    title: "Dark Mode",
                    description: "System-wide dark mode support",
                    isEnabled: featureFlags.isEnabled("dark-mode")
                )

                FeatureFlagRow(
                    title: "Premium Features",
                    description: "Access to premium functionality",
                    isEnabled: featureFlags.isEnabled("premium-features")
                )
            }

            Section("Demo Content") {
                if featureFlags.isEnabled("new-ui") {
                    NavigationLink("New UI Demo") {
                        NewUIView()
                    }
                }

                if featureFlags.isEnabled("premium-features") {
                    NavigationLink("Premium Features") {
                        PremiumFeaturesView()
                    }
                }
            }

            Section("Actions") {
                Button("Refresh Flags") {
                    Task {
                        await featureFlags.loadFlags()
                    }
                }
            }
        }
    }
}

struct FeatureFlagRow: View {
    let title: String
    let description: String
    let isEnabled: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)

                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: isEnabled ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(isEnabled ? .green : .red)
                .font(.title2)
        }
        .padding(.vertical, 4)
    }
}

struct NewUIView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "sparkles")
                .font(.system(size: 60))
                .foregroundStyle(.blue)

            Text("New UI")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("This is the new modern UI design")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle("New UI")
    }
}

struct PremiumFeaturesView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "crown.fill")
                .font(.system(size: 60))
                .foregroundStyle(.yellow)

            Text("Premium Features")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("You have access to premium functionality")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            List {
                Label("Advanced Analytics", systemImage: "chart.bar.fill")
                Label("Priority Support", systemImage: "headphones")
                Label("Custom Integrations", systemImage: "puzzlepiece.extension.fill")
                Label("Unlimited Projects", systemImage: "infinity")
            }
        }
        .padding()
        .navigationTitle("Premium")
    }
}

#Preview {
    ContentView()
        .environmentObject(FeatureFlagManager())
}

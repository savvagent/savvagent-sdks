import SwiftUI
import SavvagentSDK

@main
struct SavvagentExampleApp: App {
    @StateObject private var featureFlags = FeatureFlagManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(featureFlags)
                .task {
                    await featureFlags.initialize()
                }
        }
    }
}

@MainActor
class FeatureFlagManager: ObservableObject {
    @Published var flags: [String: Bool] = [:]
    @Published var isLoading = true

    private var client: SavvagentClient?

    func initialize() async {
        let config = SavvagentConfig(
            apiUrl: "https://beta.savvagent.com",
            sdkKey: "demo-sdk-key",
            environment: "development"
        )

        client = SavvagentClient(config: config)

        await loadFlags()
        isLoading = false
    }

    func loadFlags() async {
        let context = UserContext(
            userId: "demo-user",
            attributes: [
                "email": "demo@example.com",
                "plan": "pro"
            ]
        )

        do {
            // Load multiple feature flags
            flags["new-ui"] = try await client?.isEnabled(
                flagKey: "new-ui",
                context: context
            ) ?? false

            flags["dark-mode"] = try await client?.isEnabled(
                flagKey: "dark-mode",
                context: context
            ) ?? false

            flags["premium-features"] = try await client?.isEnabled(
                flagKey: "premium-features",
                context: context
            ) ?? false
        } catch {
            print("Error loading flags: \(error)")
        }
    }

    func isEnabled(_ key: String) -> Bool {
        return flags[key] ?? false
    }
}

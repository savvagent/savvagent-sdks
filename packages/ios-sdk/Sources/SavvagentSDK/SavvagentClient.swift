import Foundation

/// Configuration for the Savvagent SDK client
public struct SavvagentConfig {
    let apiUrl: String
    let sdkKey: String
    let environment: String
    let pollingInterval: TimeInterval
    let enableWebSocket: Bool
    let timeout: TimeInterval

    public init(
        apiUrl: String = "https://beta.savvagent.com",
        sdkKey: String,
        environment: String = "production",
        pollingInterval: TimeInterval = 60,
        enableWebSocket: Bool = true,
        timeout: TimeInterval = 30
    ) {
        self.apiUrl = apiUrl
        self.sdkKey = sdkKey
        self.environment = environment
        self.pollingInterval = pollingInterval
        self.enableWebSocket = enableWebSocket
        self.timeout = timeout
    }
}

/// User context for feature flag evaluation
public struct UserContext {
    let userId: String
    let attributes: [String: Any]

    public init(userId: String, attributes: [String: Any] = [:]) {
        self.userId = userId
        self.attributes = attributes
    }

    func toJSON() -> [String: Any] {
        return [
            "userId": userId,
            "attributes": attributes
        ]
    }
}

/// Result from flag evaluation
public struct FlagEvaluationResult {
    public let key: String
    public let value: Bool
    public let configuration: [String: Any]?
    public let variation: String?
    public let reason: String

    public init(key: String, value: Bool, configuration: [String: Any]? = nil, variation: String? = nil, reason: String = "evaluated") {
        self.key = key
        self.value = value
        self.configuration = configuration
        self.variation = variation
        self.reason = reason
    }
}

/// Result from variation evaluation for multi-variant flags
public struct VariationResult {
    public let variation: String
    public let enabled: Bool
    public let configuration: [String: Any]?

    public init(variation: String, enabled: Bool, configuration: [String: Any]? = nil) {
        self.variation = variation
        self.enabled = enabled
        self.configuration = configuration
    }
}

/// Cache entry for flag values
private struct CacheEntry {
    let value: Bool
    let configuration: [String: Any]?
    let variation: String?
}

/// Configuration override entry
private struct ConfigOverrideEntry {
    let config: [String: Any]
    let merge: Bool
    let timestamp: Date
}

/// Variation override entry
private struct VariationOverrideEntry {
    let variation: String
    let timestamp: Date
}

/// Main Savvagent SDK client for feature flag evaluation
public class SavvagentClient {
    private let config: SavvagentConfig
    private var flagCache: [String: CacheEntry] = [:]
    private var configOverrides: [String: ConfigOverrideEntry] = [:]
    private var variationOverrides: [String: VariationOverrideEntry] = [:]
    private var webSocketTask: URLSessionWebSocketTask?
    private let session: URLSession
    private let queue = DispatchQueue(label: "com.savvagent.sdk", qos: .utility)

    /// Initialize the Savvagent client
    /// - Parameter config: Configuration for the SDK
    public init(config: SavvagentConfig) {
        self.config = config
        self.session = URLSession(configuration: .default)

        if config.enableWebSocket {
            setupWebSocket()
        }

        startPolling()
    }

    /// Evaluate a feature flag and get full details (Phase 1 & 2)
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: FlagEvaluationResult with value, configuration, and variation
    public func evaluate(flagKey: String, context: UserContext) async throws -> FlagEvaluationResult {
        // Check cache first
        if let cached = flagCache[flagKey] {
            var configuration = cached.configuration
            var variation = cached.variation

            // Apply overrides
            if let configOverride = configOverrides[flagKey] {
                configuration = if configOverride.merge, let baseConfig = configuration {
                    mergeConfigurations(base: baseConfig, override: configOverride.config)
                } else {
                    configOverride.config
                }
            }

            if let variationOverride = variationOverrides[flagKey] {
                variation = variationOverride.variation
            }

            return FlagEvaluationResult(
                key: flagKey,
                value: cached.value,
                configuration: configuration,
                variation: variation,
                reason: "cached"
            )
        }

        // Fetch from API
        guard let url = URL(string: "\(config.apiUrl)/v1/flags/\(flagKey)/evaluate") else {
            throw SavvagentError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = config.timeout

        let body = try JSONSerialization.data(withJSONObject: context.toJSON())
        request.httpBody = body

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw SavvagentError.requestFailed
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let enabled = json["enabled"] as? Bool else {
            throw SavvagentError.invalidResponse
        }

        var configuration = json["configuration"] as? [String: Any]
        var variation = json["variation"] as? String

        // Update cache
        queue.async { [weak self] in
            self?.flagCache[flagKey] = CacheEntry(value: enabled, configuration: configuration, variation: variation)
        }

        // Apply overrides to evaluated result
        if let configOverride = configOverrides[flagKey] {
            configuration = if configOverride.merge, let baseConfig = configuration {
                mergeConfigurations(base: baseConfig, override: configOverride.config)
            } else {
                configOverride.config
            }
        }

        if let variationOverride = variationOverrides[flagKey] {
            variation = variationOverride.variation
        }

        return FlagEvaluationResult(
            key: flagKey,
            value: enabled,
            configuration: configuration,
            variation: variation,
            reason: "evaluated"
        )
    }

    /// Check if a feature flag is enabled for a given user context (convenience method)
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: Boolean indicating if the flag is enabled
    public func isEnabled(flagKey: String, context: UserContext) async throws -> Bool {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return result.value
    }

    /// Get dynamic configuration for a flag (Phase 1)
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: Configuration dictionary if flag is enabled, otherwise nil
    public func getConfig(flagKey: String, context: UserContext) async throws -> [String: Any]? {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return result.value ? result.configuration : nil
    }

    /// Get variation details for multi-variant flags (Phase 2)
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: VariationResult with variation name, enabled status, and configuration
    public func getVariationDetails(flagKey: String, context: UserContext) async throws -> VariationResult {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return VariationResult(
            variation: result.variation ?? "control",
            enabled: result.value,
            configuration: result.configuration
        )
    }

    /// Get a variation value for a feature flag (legacy method - kept for backward compatibility)
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    ///   - defaultValue: Default value if flag evaluation fails
    /// - Returns: The variation value or default
    public func getVariation<T>(flagKey: String, context: UserContext, defaultValue: T) async -> T {
        do {
            guard let url = URL(string: "\(config.apiUrl)/v1/flags/\(flagKey)/variation") else {
                return defaultValue
            }

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = config.timeout

            let body = try JSONSerialization.data(withJSONObject: context.toJSON())
            request.httpBody = body

            let (data, _) = try await session.data(for: request)

            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let value = json["value"] as? T else {
                return defaultValue
            }

            return value
        } catch {
            return defaultValue
        }
    }

    /// Track an event for analytics
    /// - Parameters:
    ///   - eventName: Name of the event
    ///   - context: User context
    ///   - properties: Additional event properties
    public func track(eventName: String, context: UserContext, properties: [String: Any] = [:]) async {
        guard let url = URL(string: "\(config.apiUrl)/v1/events") else {
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "event": eventName,
            "context": context.toJSON(),
            "properties": properties,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            _ = try await session.data(for: request)
        } catch {
            // Silently fail for tracking
        }
    }

    /// Flush any pending events or data
    public func flush() async {
        // Implementation for flushing pending events
    }

    /// Close the client and cleanup resources
    public func close() {
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }

    /// Set a configuration override for a flag
    /// Useful for testing different configuration values without server changes
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - config: Configuration dictionary to override with
    ///   - merge: Whether to merge with existing configuration (default: false)
    public func setConfigOverride(flagKey: String, config: [String: Any], merge: Bool = false) {
        queue.async { [weak self] in
            self?.configOverrides[flagKey] = ConfigOverrideEntry(config: config, merge: merge, timestamp: Date())
            // Clear cache to force re-evaluation with override
            self?.flagCache.removeValue(forKey: flagKey)
        }
    }

    /// Clear configuration override for a flag
    /// - Parameter flagKey: The key of the feature flag
    public func clearConfigOverride(flagKey: String) {
        queue.async { [weak self] in
            self?.configOverrides.removeValue(forKey: flagKey)
            // Clear cache to get fresh API values
            self?.flagCache.removeValue(forKey: flagKey)
        }
    }

    /// Set a variation override for a multi-variant flag
    /// Forces the flag to return a specific variation
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - variation: The variation identifier to force
    public func setVariationOverride(flagKey: String, variation: String) {
        queue.async { [weak self] in
            self?.variationOverrides[flagKey] = VariationOverrideEntry(variation: variation, timestamp: Date())
            // Clear cache to force re-evaluation with override
            self?.flagCache.removeValue(forKey: flagKey)
        }
    }

    /// Clear variation override for a flag
    /// - Parameter flagKey: The key of the feature flag
    public func clearVariationOverride(flagKey: String) {
        queue.async { [weak self] in
            self?.variationOverrides.removeValue(forKey: flagKey)
            // Clear cache to get fresh API values
            self?.flagCache.removeValue(forKey: flagKey)
        }
    }

    /// Check if a flag has a configuration override
    /// - Parameter flagKey: The key of the feature flag
    /// - Returns: Boolean indicating if override exists
    public func hasConfigOverride(flagKey: String) -> Bool {
        return configOverrides[flagKey] != nil
    }

    /// Check if a flag has a variation override
    /// - Parameter flagKey: The key of the feature flag
    /// - Returns: Boolean indicating if override exists
    public func hasVariationOverride(flagKey: String) -> Bool {
        return variationOverrides[flagKey] != nil
    }

    /// Get all configuration overrides (for debugging/inspection)
    /// - Returns: Dictionary mapping flag keys to override details
    public func getConfigOverrides() -> [String: [String: Any]] {
        return configOverrides.mapValues { entry in
            [
                "config": entry.config,
                "merge": entry.merge,
                "timestamp": entry.timestamp
            ] as [String: Any]
        }
    }

    /// Get all variation overrides (for debugging/inspection)
    /// - Returns: Dictionary mapping flag keys to override details
    public func getVariationOverrides() -> [String: [String: Any]] {
        return variationOverrides.mapValues { entry in
            [
                "variation": entry.variation,
                "timestamp": entry.timestamp
            ] as [String: Any]
        }
    }

    /// Clear all configuration and variation overrides
    public func clearAllOverrides() {
        queue.async { [weak self] in
            self?.configOverrides.removeAll()
            self?.variationOverrides.removeAll()
            self?.flagCache.removeAll()
        }
    }

    // MARK: - Private Methods

    private func setupWebSocket() {
        guard let url = URL(string: config.apiUrl.replacingOccurrences(of: "http", with: "ws") + "/v1/stream") else {
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")

        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()

        receiveWebSocketMessage()
    }

    private func receiveWebSocketMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleWebSocketMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.handleWebSocketMessage(text)
                    }
                @unknown default:
                    break
                }

                self.receiveWebSocketMessage()

            case .failure:
                // Attempt to reconnect after delay
                DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
                    self.setupWebSocket()
                }
            }
        }
    }

    private func handleWebSocketMessage(_ message: String) {
        guard let data = message.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let flagKey = json["flagKey"] as? String,
              let enabled = json["enabled"] as? Bool else {
            return
        }

        let configuration = json["configuration"] as? [String: Any]
        let variation = json["variation"] as? String

        queue.async { [weak self] in
            self?.flagCache[flagKey] = CacheEntry(value: enabled, configuration: configuration, variation: variation)
        }
    }

    private func startPolling() {
        guard config.pollingInterval > 0 else { return }

        queue.asyncAfter(deadline: .now() + config.pollingInterval) { [weak self] in
            self?.refreshFlags()
            self?.startPolling()
        }
    }

    private func refreshFlags() {
        Task {
            guard let url = URL(string: "\(config.apiUrl)/v1/flags") else {
                return
            }

            var request = URLRequest(url: url)
            request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")

            do {
                let (data, _) = try await session.data(for: request)
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let flags = json["flags"] as? [[String: Any]] {

                    for flag in flags {
                        if let key = flag["key"] as? String,
                           let enabled = flag["enabled"] as? Bool {
                            let configuration = flag["configuration"] as? [String: Any]
                            let variation = flag["variation"] as? String
                            queue.async { [weak self] in
                                self?.flagCache[key] = CacheEntry(value: enabled, configuration: configuration, variation: variation)
                            }
                        }
                    }
                }
            } catch {
                // Silently fail for polling
            }
        }
    }

    /// Merge two configuration dictionaries (for partial overrides)
    /// Deep merge where override values take precedence
    /// - Parameters:
    ///   - base: Base configuration dictionary
    ///   - override: Override configuration dictionary
    /// - Returns: Merged configuration dictionary
    private func mergeConfigurations(base: [String: Any], override: [String: Any]) -> [String: Any] {
        var result = base

        for (key, overrideValue) in override {
            if let baseValue = result[key] as? [String: Any],
               let overrideDict = overrideValue as? [String: Any] {
                // Recursively merge nested dictionaries
                result[key] = mergeConfigurations(base: baseValue, override: overrideDict)
            } else {
                // Override the value
                result[key] = overrideValue
            }
        }

        return result
    }
}

/// Errors that can occur in the Savvagent SDK
public enum SavvagentError: Error {
    case invalidURL
    case requestFailed
    case invalidResponse
    case networkError(Error)
}

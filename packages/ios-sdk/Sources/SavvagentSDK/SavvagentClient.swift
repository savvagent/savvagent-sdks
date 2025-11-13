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

/// Main Savvagent SDK client for feature flag evaluation
public class SavvagentClient {
    private let config: SavvagentConfig
    private var flagCache: [String: Bool] = [:]
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

    /// Check if a feature flag is enabled for a given user context
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: Boolean indicating if the flag is enabled
    public func isEnabled(flagKey: String, context: UserContext) async throws -> Bool {
        // Check cache first
        if let cached = flagCache[flagKey] {
            return cached
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

        // Update cache
        queue.async { [weak self] in
            self?.flagCache[flagKey] = enabled
        }

        return enabled
    }

    /// Get a variation value for a feature flag
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

        queue.async { [weak self] in
            self?.flagCache[flagKey] = enabled
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
                            queue.async { [weak self] in
                                self?.flagCache[key] = enabled
                            }
                        }
                    }
                }
            } catch {
                // Silently fail for polling
            }
        }
    }
}

/// Errors that can occur in the Savvagent SDK
public enum SavvagentError: Error {
    case invalidURL
    case requestFailed
    case invalidResponse
    case networkError(Error)
}

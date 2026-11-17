import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Default base URL of the Savvagent Flags service (no trailing slash).
public let savvagentDefaultApiUrl = "https://api.savvagent.com/flags"

/// Configuration for the Savvagent SDK client
public struct SavvagentConfig {
    /// Base URL of the Flags API, without a trailing slash.
    let apiUrl: String
    let sdkKey: String
    let environment: String
    let pollingInterval: TimeInterval
    /// Enables the realtime Server-Sent Events stream. (The name is kept for source
    /// compatibility; the transport is SSE, not WebSocket.)
    let enableWebSocket: Bool
    let timeout: TimeInterval
    /// Enables batched evaluation telemetry.
    let enableTelemetry: Bool

    public init(
        apiUrl: String = savvagentDefaultApiUrl,
        sdkKey: String,
        environment: String = "production",
        pollingInterval: TimeInterval = 60,
        enableWebSocket: Bool = true,
        timeout: TimeInterval = 30,
        enableTelemetry: Bool = true
    ) {
        var url = apiUrl
        while url.hasSuffix("/") { url.removeLast() }
        self.apiUrl = url
        self.sdkKey = sdkKey
        self.environment = environment
        self.pollingInterval = pollingInterval
        self.enableWebSocket = enableWebSocket
        self.timeout = timeout
        self.enableTelemetry = enableTelemetry
    }
}

/// User context for feature flag evaluation
public struct UserContext {
    let userId: String
    let attributes: [String: Any]
    let anonymousId: String?
    let sessionId: String?
    let language: String?
    let organizationId: String?
    let applicationId: String?

    public init(
        userId: String,
        attributes: [String: Any] = [:],
        anonymousId: String? = nil,
        sessionId: String? = nil,
        language: String? = nil,
        organizationId: String? = nil,
        applicationId: String? = nil
    ) {
        self.userId = userId
        self.attributes = attributes
        self.anonymousId = anonymousId
        self.sessionId = sessionId
        self.language = language
        self.organizationId = organizationId
        self.applicationId = applicationId
    }

    /// Serializes to the server's snake_case context shape.
    func toJSON(environment: String? = nil) -> [String: Any] {
        var json: [String: Any] = [
            "user_id": userId,
            "attributes": attributes
        ]
        if let anonymousId = anonymousId { json["anonymous_id"] = anonymousId }
        if let sessionId = sessionId { json["session_id"] = sessionId }
        if let environment = environment { json["environment"] = environment }
        if let language = language { json["language"] = language }
        if let organizationId = organizationId { json["organization_id"] = organizationId }
        if let applicationId = applicationId { json["application_id"] = applicationId }
        return json
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

/// A flag definition returned by the bulk endpoint (`GET /api/sdk/flags`).
/// `enabled` is the environment's master switch, not a per-user evaluation.
public struct FlagDefinition {
    public let key: String
    public let enabled: Bool
    public let scope: String?
    public let version: Int?
    public let environments: [String: Any]?
    public let variations: [String: Any]?
    public let configuration: [String: Any]?
}

/// Type of a realtime flag event.
public enum FlagChangeType: String {
    case created = "flag.created"
    case updated = "flag.updated"
    case deleted = "flag.deleted"
}

/// Emitted to listeners when a realtime `flag.*` event arrives.
public struct FlagChangeEvent {
    public let type: FlagChangeType
    public let flagKey: String
    public let version: Int?
}

/// A single parsed Server-Sent Event.
struct SSEEvent: Equatable {
    let event: String
    let data: String
}

/// Incremental line-based SSE parser. Feed it one line at a time (without the line terminator).
/// A blank line dispatches the accumulated event.
struct SSEParser {
    private var eventName: String?
    private var dataLines: [String] = []

    init() {}

    mutating func feed(line: String) -> SSEEvent? {
        if line.isEmpty {
            defer { eventName = nil; dataLines = [] }
            if eventName == nil && dataLines.isEmpty { return nil }
            return SSEEvent(event: eventName ?? "message", data: dataLines.joined(separator: "\n"))
        }
        if line.hasPrefix(":") { return nil } // comment

        let field: String
        var value: String
        if let idx = line.firstIndex(of: ":") {
            field = String(line[line.startIndex..<idx])
            value = String(line[line.index(after: idx)...])
            if value.hasPrefix(" ") { value.removeFirst() }
        } else {
            field = line
            value = ""
        }

        switch field {
        case "event": eventName = value
        case "data": dataLines.append(value)
        default: break // id, retry: ignored
        }
        return nil
    }
}

/// Cache entry for flag values
private struct CacheEntry {
    let value: Bool
    let configuration: [String: Any]?
    let variation: String?
    let version: Int?
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

/// Pending evaluation telemetry record
private struct EvaluationRecord {
    let flagKey: String
    let result: Bool
    let variation: String?
    let context: [String: Any]
    let timestamp: Int64
}

/// Main Savvagent SDK client for feature flag evaluation
public class SavvagentClient {
    /// Maximum telemetry records per request, per the server contract.
    static let maxTelemetryBatch = 1000
    private static let telemetryAutoFlushThreshold = 50

    private let config: SavvagentConfig
    private let session: URLSession
    private let lock = NSLock()

    // Guarded by `lock`
    private var flagCache: [String: [String: CacheEntry]] = [:] // flagKey -> contextKey -> entry
    private var configOverrides: [String: ConfigOverrideEntry] = [:]
    private var variationOverrides: [String: VariationOverrideEntry] = [:]
    private var pendingEvaluations: [EvaluationRecord] = []
    private var listeners: [UUID: (FlagChangeEvent) -> Void] = [:]
    private var realtimeTask: Task<Void, Never>?
    private var pollingTask: Task<Void, Never>?
    private var closed = false

    /// Initialize the Savvagent client
    /// - Parameters:
    ///   - config: Configuration for the SDK
    ///   - session: Optional URLSession (primarily for testing)
    public init(config: SavvagentConfig, session: URLSession? = nil) {
        self.config = config
        self.session = session ?? URLSession(configuration: .default)

        if config.enableWebSocket {
            startRealtime()
        }
        startPolling()
    }

    deinit {
        realtimeTask?.cancel()
        pollingTask?.cancel()
    }

    // MARK: - State access

    /// Runs `body` while holding the state lock. Synchronous so async code never touches the lock directly.
    private func withState<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private func cachedEntry(flagKey: String, contextKey: String) -> CacheEntry? {
        return withState { flagCache[flagKey]?[contextKey] }
    }

    private func storeEntry(_ entry: CacheEntry, flagKey: String, contextKey: String) {
        withState { flagCache[flagKey, default: [:]][contextKey] = entry }
    }

    private func takePendingEvaluations() -> [EvaluationRecord] {
        return withState {
            let records = pendingEvaluations
            pendingEvaluations.removeAll()
            return records
        }
    }

    // MARK: - URL building

    /// Builds `<baseUrl><path>` with optional query items. Trailing slashes on the base are ignored.
    static func makeURL(base: String, path: String, query: [URLQueryItem] = []) -> URL? {
        var b = base
        while b.hasSuffix("/") { b.removeLast() }
        guard var components = URLComponents(string: b + path) else { return nil }
        if !query.isEmpty { components.queryItems = query }
        return components.url
    }

    /// Whether `key` is a valid flag key: 1-128 characters of `[A-Za-z0-9._-]`, and not `.` or `..`.
    /// This is the server's key rule, shared by every Savvagent SDK. The key becomes one segment of
    /// the evaluate URL path: `.` and `..` cannot be carried in a path (they are normalized away),
    /// and characters such as `/`, `?` and `#` would send the request, and the SDK key with it, to
    /// another endpoint.
    static func isValidFlagKey(_ key: String) -> Bool {
        if key == "." || key == ".." { return false }
        // Every allowed character is one ASCII byte, so the UTF-8 length is the character count.
        let bytes = key.utf8
        if bytes.isEmpty || bytes.count > 128 { return false }
        for byte in bytes {
            switch byte {
            case UInt8(ascii: "a")...UInt8(ascii: "z"),
                 UInt8(ascii: "A")...UInt8(ascii: "Z"),
                 UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "-"), UInt8(ascii: "_"), UInt8(ascii: "."):
                continue
            default:
                return false
            }
        }
        return true
    }

    static func encodePathSegment(_ segment: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return segment.addingPercentEncoding(withAllowedCharacters: allowed) ?? segment
    }

    private func url(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard let url = SavvagentClient.makeURL(base: config.apiUrl, path: path, query: query) else {
            throw SavvagentError.invalidURL
        }
        return url
    }

    private func authorized(_ request: URLRequest) -> URLRequest {
        var request = request
        request.setValue("Bearer \(config.sdkKey)", forHTTPHeaderField: "Authorization")
        return request
    }

    // MARK: - Response parsing

    struct EvaluationResponse {
        let enabled: Bool
        let variation: String?
        let configuration: [String: Any]?
        let version: Int?
    }

    static func parseEvaluation(_ data: Data) throws -> EvaluationResponse {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let enabled = json["enabled"] as? Bool else {
            throw SavvagentError.invalidResponse
        }
        return EvaluationResponse(
            enabled: enabled,
            variation: json["variation"] as? String,
            configuration: json["configuration"] as? [String: Any],
            version: (json["version"] as? NSNumber)?.intValue
        )
    }

    static func parseFlagList(_ data: Data) throws -> [FlagDefinition] {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let flags = json["flags"] as? [[String: Any]] else {
            throw SavvagentError.invalidResponse
        }
        return flags.compactMap { flag in
            guard let key = flag["key"] as? String, let enabled = flag["enabled"] as? Bool else { return nil }
            return FlagDefinition(
                key: key,
                enabled: enabled,
                scope: flag["scope"] as? String,
                version: (flag["version"] as? NSNumber)?.intValue,
                environments: flag["environments"] as? [String: Any],
                variations: flag["variations"] as? [String: Any],
                configuration: flag["configuration"] as? [String: Any]
            )
        }
    }

    /// Parses an SSE `flag.*` event into a change event.
    static func parseFlagChange(_ event: SSEEvent) -> FlagChangeEvent? {
        guard let type = FlagChangeType(rawValue: event.event),
              let data = event.data.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = json["key"] as? String else {
            return nil
        }
        return FlagChangeEvent(type: type, flagKey: key, version: (json["version"] as? NSNumber)?.intValue)
    }

    // MARK: - Evaluation

    private func contextKey(_ context: UserContext) -> String {
        return context.userId
    }

    private func applyOverrides(
        flagKey: String,
        configuration: [String: Any]?,
        variation: String?
    ) -> (configuration: [String: Any]?, variation: String?) {
        lock.lock()
        let configOverride = configOverrides[flagKey]
        let variationOverride = variationOverrides[flagKey]
        lock.unlock()

        var configuration = configuration
        var variation = variation
        if let configOverride = configOverride {
            if configOverride.merge, let base = configuration {
                configuration = mergeConfigurations(base: base, override: configOverride.config)
            } else {
                configuration = configOverride.config
            }
        }
        if let variationOverride = variationOverride {
            variation = variationOverride.variation
        }
        return (configuration, variation)
    }

    /// Evaluate a feature flag and get full details
    /// - Parameters:
    ///   - flagKey: The key of the feature flag
    ///   - context: User context for evaluation
    /// - Returns: FlagEvaluationResult with value, configuration, and variation
    public func evaluate(flagKey: String, context: UserContext) async throws -> FlagEvaluationResult {
        // Reject a key that is not one safe URL path segment before any request is built
        guard SavvagentClient.isValidFlagKey(flagKey) else {
            throw SavvagentError.invalidFlagKey(flagKey)
        }

        let ctxKey = contextKey(context)

        let cached = cachedEntry(flagKey: flagKey, contextKey: ctxKey)

        if let cached = cached {
            let applied = applyOverrides(flagKey: flagKey, configuration: cached.configuration, variation: cached.variation)
            return FlagEvaluationResult(
                key: flagKey,
                value: cached.value,
                configuration: applied.configuration,
                variation: applied.variation,
                reason: "cached"
            )
        }

        let requestUrl = try url("/api/flags/\(SavvagentClient.encodePathSegment(flagKey))/evaluate")
        var request = authorized(URLRequest(url: requestUrl))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = config.timeout

        let contextJSON = context.toJSON(environment: config.environment)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["context": contextJSON])

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw SavvagentError.requestFailed
        }

        let parsed = try SavvagentClient.parseEvaluation(data)

        storeEntry(
            CacheEntry(
                value: parsed.enabled,
                configuration: parsed.configuration,
                variation: parsed.variation,
                version: parsed.version
            ),
            flagKey: flagKey,
            contextKey: ctxKey
        )

        recordEvaluation(flagKey: flagKey, result: parsed.enabled, variation: parsed.variation, context: contextJSON)

        let applied = applyOverrides(flagKey: flagKey, configuration: parsed.configuration, variation: parsed.variation)
        return FlagEvaluationResult(
            key: flagKey,
            value: parsed.enabled,
            configuration: applied.configuration,
            variation: applied.variation,
            reason: "evaluated"
        )
    }

    /// Check if a feature flag is enabled for a given user context (convenience method)
    public func isEnabled(flagKey: String, context: UserContext) async throws -> Bool {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return result.value
    }

    /// Get dynamic configuration for a flag
    /// - Returns: Configuration dictionary if flag is enabled, otherwise nil
    public func getConfig(flagKey: String, context: UserContext) async throws -> [String: Any]? {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return result.value ? result.configuration : nil
    }

    /// Get variation details for multi-variant flags
    /// - Returns: VariationResult with variation name, enabled status, and configuration
    public func getVariationDetails(flagKey: String, context: UserContext) async throws -> VariationResult {
        let result = try await evaluate(flagKey: flagKey, context: context)
        return VariationResult(
            variation: result.variation ?? "control",
            enabled: result.value,
            configuration: result.configuration
        )
    }

    /// Get a variation value for a feature flag.
    /// The variation is taken from the evaluate response (the server has no separate variation endpoint).
    /// Returns the variation string, the enabled flag, or the configuration, whichever matches `T`;
    /// otherwise `defaultValue`.
    public func getVariation<T>(flagKey: String, context: UserContext, defaultValue: T) async -> T {
        do {
            let result = try await evaluate(flagKey: flagKey, context: context)
            if let variation = result.variation as? T { return variation }
            if let configuration = result.configuration as? T { return configuration }
            if let enabled = result.value as? T { return enabled }
            return defaultValue
        } catch {
            return defaultValue
        }
    }

    /// Fetch all flag definitions for the configured environment (`GET /api/sdk/flags`).
    /// Note that each definition's `enabled` is the environment master switch, not a per-user result.
    public func fetchAllFlags() async throws -> [FlagDefinition] {
        let requestUrl = try url("/api/sdk/flags", query: [URLQueryItem(name: "environment", value: config.environment)])
        var request = authorized(URLRequest(url: requestUrl))
        request.httpMethod = "GET"
        request.timeoutInterval = config.timeout

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw SavvagentError.requestFailed
        }
        return try SavvagentClient.parseFlagList(data)
    }

    // MARK: - Tracking / telemetry

    /// Retained for source compatibility. The Flags API has no custom-event endpoint,
    /// so this does nothing. Evaluation telemetry is sent automatically; use `reportError` for errors.
    @available(*, deprecated, message: "The Flags API has no custom events endpoint; this is a no-op.")
    public func track(eventName: String, context: UserContext, properties: [String: Any] = [:]) async {
    }

    /// Report an error that occurred while a flag was active (`POST /api/telemetry/errors`).
    public func reportError(
        flagKey: String,
        flagEnabled: Bool,
        error: Error,
        context: UserContext,
        stackTrace: String? = nil
    ) async {
        var item: [String: Any] = [
            "flag_key": flagKey,
            "flag_enabled": flagEnabled,
            "error_type": String(describing: type(of: error)),
            "error_message": error.localizedDescription,
            "environment": config.environment,
            "context": context.toJSON(environment: config.environment),
            "timestamp": SavvagentClient.nowMillis()
        ]
        if let stackTrace = stackTrace { item["stack_trace"] = stackTrace }
        await postBatches(path: "/api/telemetry/errors", key: "errors", items: [item])
    }

    private static func nowMillis() -> Int64 {
        return Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func recordEvaluation(flagKey: String, result: Bool, variation: String?, context: [String: Any]) {
        guard config.enableTelemetry else { return }
        lock.lock()
        pendingEvaluations.append(EvaluationRecord(
            flagKey: flagKey, result: result, variation: variation,
            context: context, timestamp: SavvagentClient.nowMillis()
        ))
        let shouldFlush = pendingEvaluations.count >= SavvagentClient.telemetryAutoFlushThreshold
        lock.unlock()

        if shouldFlush {
            Task { [weak self] in await self?.flush() }
        }
    }

    /// Builds telemetry payload items for evaluation records.
    private func evaluationItems(_ records: [EvaluationRecord]) -> [[String: Any]] {
        return records.map { record in
            var item: [String: Any] = [
                "flag_key": record.flagKey,
                "result": record.result,
                "environment": config.environment,
                "context": record.context,
                "timestamp": record.timestamp
            ]
            if let variation = record.variation { item["variation"] = variation }
            return item
        }
    }

    /// Splits items into chunks of at most `maxTelemetryBatch`.
    static func chunk<T>(_ items: [T], size: Int = maxTelemetryBatch) -> [[T]] {
        guard size > 0, !items.isEmpty else { return [] }
        return stride(from: 0, to: items.count, by: size).map {
            Array(items[$0..<Swift.min($0 + size, items.count)])
        }
    }

    private func postBatches(path: String, key: String, items: [[String: Any]]) async {
        for batch in SavvagentClient.chunk(items) {
            guard let requestUrl = try? url(path) else { return }
            var request = authorized(URLRequest(url: requestUrl))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = config.timeout
            guard JSONSerialization.isValidJSONObject([key: batch]),
                  let body = try? JSONSerialization.data(withJSONObject: [key: batch]) else { continue }
            request.httpBody = body
            _ = try? await session.data(for: request) // telemetry is best effort
        }
    }

    /// Flush any pending telemetry
    public func flush() async {
        let records = takePendingEvaluations()

        guard !records.isEmpty else { return }
        await postBatches(path: "/api/telemetry/evaluations", key: "evaluations", items: evaluationItems(records))
    }

    /// Close the client and cleanup resources
    public func close() {
        lock.lock()
        closed = true
        let rt = realtimeTask
        let pt = pollingTask
        realtimeTask = nil
        pollingTask = nil
        lock.unlock()
        rt?.cancel()
        pt?.cancel()

        // Best-effort final telemetry flush
        Task { [weak self] in await self?.flush() }
    }

    // MARK: - Listeners

    /// Register a listener for realtime flag changes. Returns a token for `removeFlagChangeListener`.
    @discardableResult
    public func addFlagChangeListener(_ listener: @escaping (FlagChangeEvent) -> Void) -> UUID {
        let token = UUID()
        lock.lock()
        listeners[token] = listener
        lock.unlock()
        return token
    }

    public func removeFlagChangeListener(_ token: UUID) {
        lock.lock()
        listeners.removeValue(forKey: token)
        lock.unlock()
    }

    // MARK: - Overrides

    /// Set a configuration override for a flag
    public func setConfigOverride(flagKey: String, config: [String: Any], merge: Bool = false) {
        lock.lock()
        configOverrides[flagKey] = ConfigOverrideEntry(config: config, merge: merge, timestamp: Date())
        flagCache.removeValue(forKey: flagKey)
        lock.unlock()
    }

    /// Clear configuration override for a flag
    public func clearConfigOverride(flagKey: String) {
        lock.lock()
        configOverrides.removeValue(forKey: flagKey)
        flagCache.removeValue(forKey: flagKey)
        lock.unlock()
    }

    /// Set a variation override for a multi-variant flag
    public func setVariationOverride(flagKey: String, variation: String) {
        lock.lock()
        variationOverrides[flagKey] = VariationOverrideEntry(variation: variation, timestamp: Date())
        flagCache.removeValue(forKey: flagKey)
        lock.unlock()
    }

    /// Clear variation override for a flag
    public func clearVariationOverride(flagKey: String) {
        lock.lock()
        variationOverrides.removeValue(forKey: flagKey)
        flagCache.removeValue(forKey: flagKey)
        lock.unlock()
    }

    /// Check if a flag has a configuration override
    public func hasConfigOverride(flagKey: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return configOverrides[flagKey] != nil
    }

    /// Check if a flag has a variation override
    public func hasVariationOverride(flagKey: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return variationOverrides[flagKey] != nil
    }

    /// Get all configuration overrides (for debugging/inspection)
    public func getConfigOverrides() -> [String: [String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return configOverrides.mapValues { entry in
            [
                "config": entry.config,
                "merge": entry.merge,
                "timestamp": entry.timestamp
            ] as [String: Any]
        }
    }

    /// Get all variation overrides (for debugging/inspection)
    public func getVariationOverrides() -> [String: [String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return variationOverrides.mapValues { entry in
            [
                "variation": entry.variation,
                "timestamp": entry.timestamp
            ] as [String: Any]
        }
    }

    /// Clear all configuration and variation overrides
    public func clearAllOverrides() {
        lock.lock()
        configOverrides.removeAll()
        variationOverrides.removeAll()
        flagCache.removeAll()
        lock.unlock()
    }

    // MARK: - Realtime (SSE)

    private func startRealtime() {
        let task = Task { [weak self] in
            var delay: TimeInterval = 1
            while !Task.isCancelled {
                guard let self = self else { return }
                let connected = await self.runStream()
                if Task.isCancelled { return }
                if connected { delay = 1 }
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                delay = Swift.min(delay * 2, 30)
            }
        }
        lock.lock()
        realtimeTask = task
        lock.unlock()
    }

    /// Opens the SSE stream and processes events until it ends or fails.
    /// - Returns: true if the server acknowledged the connection (`connected` event).
    private func runStream() async -> Bool {
        guard let requestUrl = try? url("/api/flags/stream") else { return false }
        var request = authorized(URLRequest(url: requestUrl))
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = 90 // heartbeats arrive roughly every 30s

        var sawConnected = false
        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return false
            }

            var parser = SSEParser()
            var buffer: [UInt8] = []
            // AsyncBytes.lines drops blank lines, which SSE needs, so split on LF manually.
            for try await byte in bytes {
                if Task.isCancelled { return sawConnected }
                if byte == 0x0A {
                    if buffer.last == 0x0D { buffer.removeLast() }
                    let line = String(decoding: buffer, as: UTF8.self)
                    buffer.removeAll(keepingCapacity: true)
                    if let event = parser.feed(line: line) {
                        if event.event == "connected" { sawConnected = true }
                        handleStreamEvent(event)
                    }
                } else {
                    buffer.append(byte)
                }
            }
        } catch {
            // Fall through to reconnect with backoff
        }
        return sawConnected
    }

    func handleStreamEvent(_ event: SSEEvent) {
        switch event.event {
        case "connected", "heartbeat":
            break
        case "flag.created", "flag.updated", "flag.deleted":
            guard let change = SavvagentClient.parseFlagChange(event) else { return }
            lock.lock()
            flagCache.removeValue(forKey: change.flagKey)
            let handlers = Array(listeners.values)
            lock.unlock()
            handlers.forEach { $0(change) }
        default:
            break
        }
    }

    // MARK: - Polling

    private func startPolling() {
        guard config.pollingInterval > 0 else { return }
        let interval = config.pollingInterval
        let task = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                if Task.isCancelled { return }
                await self?.refreshFlags()
            }
        }
        lock.lock()
        pollingTask = task
        lock.unlock()
    }

    /// Bulk-fetches definitions and drops cached evaluations whose flag version changed or was removed.
    func refreshFlags() async {
        guard let definitions = try? await fetchAllFlags() else { return }
        let versions = Dictionary(definitions.map { ($0.key, $0.version) }, uniquingKeysWith: { _, last in last })

        invalidateStale(versions: versions)
    }

    private func invalidateStale(versions: [String: Int?]) {
        withState {
            for (key, entries) in flagCache {
                guard let known = versions[key] else {
                    flagCache.removeValue(forKey: key)
                    continue
                }
                if let serverVersion = known,
                   entries.values.contains(where: { $0.version != serverVersion }) {
                    flagCache.removeValue(forKey: key)
                }
            }
        }
    }

    /// Deep merge where override values take precedence
    private func mergeConfigurations(base: [String: Any], override: [String: Any]) -> [String: Any] {
        var result = base
        for (key, overrideValue) in override {
            if let baseValue = result[key] as? [String: Any],
               let overrideDict = overrideValue as? [String: Any] {
                result[key] = mergeConfigurations(base: baseValue, override: overrideDict)
            } else {
                result[key] = overrideValue
            }
        }
        return result
    }
}

/// Errors that can occur in the Savvagent SDK
public enum SavvagentError: Error {
    /// The flag key is not 1-128 characters of `[A-Za-z0-9._-]`, or is `.` or `..`.
    /// No request was made. The associated value is the rejected key.
    case invalidFlagKey(String)
    case invalidURL
    case requestFailed
    case invalidResponse
    case networkError(Error)
}

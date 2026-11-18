import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import SavvagentSDK

final class SavvagentClientNetworkTests: XCTestCase {
    var client: SavvagentClient!

    private func ok(_ request: URLRequest, _ body: String) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        return (response, body.data(using: .utf8)!)
    }

    override func setUp() {
        super.setUp()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let session = URLSession(configuration: configuration)

        let config = SavvagentConfig(
            sdkKey: "test-key",
            environment: "test",
            pollingInterval: 0,
            enableWebSocket: false,
            enableTelemetry: false
        )
        client = SavvagentClient(config: config, session: session)
    }

    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        MockURLProtocol.error = nil
        client?.close()
        client = nil
        super.tearDown()
    }

    // MARK: Evaluate

    func testEvaluateRequestShapeAndParsing() async throws {
        MockURLProtocol.requestHandler = { [self] request in
            XCTAssertEqual(request.url?.path, "/flags/api/flags/test-flag/evaluate")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")

            let body = try JSONSerialization.jsonObject(with: request.readBody() ?? Data()) as? [String: Any]
            let ctx = body?["context"] as? [String: Any]
            XCTAssertEqual(ctx?["user_id"] as? String, "user-123")
            XCTAssertEqual(ctx?["environment"] as? String, "test")
            XCTAssertEqual((ctx?["attributes"] as? [String: Any])?["plan"] as? String, "pro")

            return ok(request, """
            {"key":"test-flag","enabled":true,"scope":"application","variation":"blue",
             "configuration":{"color":"#00f"},"timestamp":1731550000,"version":3,"context":{}}
            """)
        }

        let result = try await client.evaluate(
            flagKey: "test-flag",
            context: UserContext(userId: "user-123", attributes: ["plan": "pro"])
        )
        XCTAssertTrue(result.value)
        XCTAssertEqual(result.variation, "blue")
        XCTAssertEqual(result.configuration?["color"] as? String, "#00f")
        XCTAssertEqual(result.reason, "evaluated")
    }

    func testEvaluateUsesCache() async throws {
        var calls = 0
        MockURLProtocol.requestHandler = { [self] request in
            calls += 1
            return ok(request, #"{"key":"f","enabled":true,"variation":null,"configuration":null,"version":1}"#)
        }
        let ctx = UserContext(userId: "u")
        _ = try await client.evaluate(flagKey: "f", context: ctx)
        let second = try await client.evaluate(flagKey: "f", context: ctx)
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(second.reason, "cached")
    }

    func testEvaluateHTTPErrorThrowsRequestFailed() async {
        MockURLProtocol.requestHandler = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: nil, headerFields: nil)!, Data())
        }
        do {
            _ = try await client.evaluate(flagKey: "missing", context: UserContext(userId: "u"))
            XCTFail("expected throw")
        } catch SavvagentError.requestFailed {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testEvaluateInvalidResponseThrows() async {
        MockURLProtocol.requestHandler = { [self] request in ok(request, #"{"nope":1}"#) }
        do {
            _ = try await client.evaluate(flagKey: "f", context: UserContext(userId: "u"))
            XCTFail("expected throw")
        } catch SavvagentError.invalidResponse {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testEvaluateNetworkErrorThrows() async {
        MockURLProtocol.error = URLError(.notConnectedToInternet)
        do {
            _ = try await client.isEnabled(flagKey: "f", context: UserContext(userId: "u"))
            XCTFail("expected throw")
        } catch {
            // expected
        }
    }

    // MARK: Flag keys

    func testInvalidFlagKeysThrowWithoutARequest() async {
        var calls = 0
        MockURLProtocol.requestHandler = { [self] request in
            calls += 1
            return ok(request, #"{"key":"f","enabled":true,"variation":null,"configuration":null,"version":1}"#)
        }
        let invalidKeys = [
            "", "/", ".", "..", String(repeating: "a", count: 129),
            "a/b", "flag?x=1", "flag#x", "fl ag", "flag%2F", "caf\u{00E9}"
        ]
        for key in invalidKeys {
            do {
                _ = try await client.evaluate(flagKey: key, context: UserContext(userId: "u"))
                XCTFail("expected throw for \"\(key)\"")
            } catch SavvagentError.invalidFlagKey(let rejected) {
                XCTAssertEqual(rejected, key)
            } catch {
                XCTFail("unexpected error \(error) for \"\(key)\"")
            }
            let fallback = await client.getVariation(flagKey: key, context: UserContext(userId: "u"), defaultValue: "fallback")
            XCTAssertEqual(fallback, "fallback")
        }
        XCTAssertEqual(calls, 0)
    }

    func testValidFlagKeysAreSent() async throws {
        var paths: [String] = []
        MockURLProtocol.requestHandler = { [self] request in
            paths.append(request.url?.path ?? "")
            return ok(request, #"{"key":"f","enabled":true,"variation":null,"configuration":null,"version":1}"#)
        }
        let validKeys = ["test-flag", "My_Flag.v2", "a", String(repeating: "a", count: 128)]
        for key in validKeys {
            let result = try await client.evaluate(flagKey: key, context: UserContext(userId: "u"))
            XCTAssertTrue(result.value)
        }
        XCTAssertEqual(paths, validKeys.map { "/flags/api/flags/\($0)/evaluate" })
    }

    func testIsValidFlagKey() {
        XCTAssertTrue(SavvagentClient.isValidFlagKey("test-flag"))
        XCTAssertTrue(SavvagentClient.isValidFlagKey("My_Flag.v2"))
        XCTAssertTrue(SavvagentClient.isValidFlagKey("..."))
        XCTAssertTrue(SavvagentClient.isValidFlagKey(String(repeating: "a", count: 128)))
        XCTAssertFalse(SavvagentClient.isValidFlagKey(""))
        XCTAssertFalse(SavvagentClient.isValidFlagKey("/"))
        XCTAssertFalse(SavvagentClient.isValidFlagKey("."))
        XCTAssertFalse(SavvagentClient.isValidFlagKey(".."))
        XCTAssertFalse(SavvagentClient.isValidFlagKey(String(repeating: "a", count: 129)))
        XCTAssertFalse(SavvagentClient.isValidFlagKey("caf\u{00E9}"))
    }

    // MARK: Variation

    func testGetVariationComesFromEvaluateResponse() async {
        MockURLProtocol.requestHandler = { [self] request in
            XCTAssertTrue(request.url!.path.hasSuffix("/api/flags/theme/evaluate"))
            return ok(request, #"{"key":"theme","enabled":true,"variation":"dark-mode","version":1}"#)
        }
        let value = await client.getVariation(flagKey: "theme", context: UserContext(userId: "u"), defaultValue: "light")
        XCTAssertEqual(value, "dark-mode")
    }

    func testGetVariationReturnsDefaultOnError() async {
        MockURLProtocol.error = URLError(.notConnectedToInternet)
        let value = await client.getVariation(flagKey: "theme", context: UserContext(userId: "u"), defaultValue: "light")
        XCTAssertEqual(value, "light")
    }

    func testVariationOverrideApplied() async throws {
        MockURLProtocol.requestHandler = { [self] request in
            ok(request, #"{"key":"f","enabled":true,"variation":"a","version":1}"#)
        }
        client.setVariationOverride(flagKey: "f", variation: "forced")
        let details = try await client.getVariationDetails(flagKey: "f", context: UserContext(userId: "u"))
        XCTAssertEqual(details.variation, "forced")
    }

    // MARK: Bulk fetch

    func testFetchAllFlags() async throws {
        MockURLProtocol.requestHandler = { [self] request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/flags/api/sdk/flags")
            XCTAssertEqual(request.url?.query, "environment=test")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
            return ok(request, """
            {"flags":[{"key":"a","enabled":true,"scope":"application","environments":{},"variations":null,
                       "configuration":{"x":1},"version":3},
                      {"key":"b","enabled":false}],
             "count":2,"organization_id":"o","application_id":"app"}
            """)
        }
        let flags = try await client.fetchAllFlags()
        XCTAssertEqual(flags.map { $0.key }, ["a", "b"])
        XCTAssertEqual(flags[0].version, 3)
        XCTAssertTrue(flags[0].enabled)
        XCTAssertFalse(flags[1].enabled)
    }

    func testFetchAllFlagsSkipsEntriesWhoseEnabledIsNotABoolean() async throws {
        MockURLProtocol.requestHandler = { [self] request in
            ok(request, """
            {"flags":[{"key":"str","enabled":"true"},{"key":"num","enabled":1},{"key":"zero","enabled":0},
                      {"key":"real","enabled":true},{"key":"off","enabled":false}]}
            """)
        }
        let flags = try await client.fetchAllFlags()
        XCTAssertEqual(flags.map { $0.key }, ["real", "off"])
    }

    // MARK: Telemetry

    func testFlushPostsEvaluationTelemetry() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        let telemetryClient = SavvagentClient(
            config: SavvagentConfig(sdkKey: "k", environment: "test", pollingInterval: 0, enableWebSocket: false),
            session: URLSession(configuration: configuration)
        )
        defer { telemetryClient.close() }

        var telemetryBody: [String: Any]?
        MockURLProtocol.requestHandler = { [self] request in
            if request.url!.path.hasSuffix("/api/telemetry/evaluations") {
                telemetryBody = try JSONSerialization.jsonObject(with: request.readBody() ?? Data()) as? [String: Any]
                return ok(request, "{}")
            }
            return ok(request, #"{"key":"f","enabled":true,"variation":"blue","version":1}"#)
        }

        _ = try await telemetryClient.evaluate(flagKey: "f", context: UserContext(userId: "u"))
        await telemetryClient.flush()

        let evals = telemetryBody?["evaluations"] as? [[String: Any]]
        XCTAssertEqual(evals?.count, 1)
        XCTAssertEqual(evals?.first?["flag_key"] as? String, "f")
        XCTAssertEqual(evals?.first?["result"] as? Bool, true)
        XCTAssertEqual(evals?.first?["variation"] as? String, "blue")
        XCTAssertEqual(evals?.first?["environment"] as? String, "test")
        XCTAssertNotNil(evals?.first?["timestamp"])
    }

    func testTelemetryBatchesAreCappedAt1000() {
        let chunks = SavvagentClient.chunk(Array(0..<2500))
        XCTAssertEqual(chunks.map { $0.count }, [1000, 1000, 500])
        XCTAssertTrue(SavvagentClient.chunk([Int]()).isEmpty)
    }

    // MARK: Context / URL building

    func testUserContextSerializesToSnakeCaseJSON() {
        let context = UserContext(
            userId: "user-123",
            attributes: ["email": "test@example.com", "age": 25, "premium": true],
            anonymousId: "anon",
            sessionId: "sess",
            language: "en"
        )
        let json = context.toJSON(environment: "production")

        XCTAssertEqual(json["user_id"] as? String, "user-123")
        XCTAssertNil(json["userId"])
        XCTAssertEqual(json["anonymous_id"] as? String, "anon")
        XCTAssertEqual(json["session_id"] as? String, "sess")
        XCTAssertEqual(json["environment"] as? String, "production")
        XCTAssertEqual(json["language"] as? String, "en")
        XCTAssertNil(json["organization_id"])

        let attrs = json["attributes"] as? [String: Any]
        XCTAssertEqual(attrs?["email"] as? String, "test@example.com")
        XCTAssertEqual(attrs?["age"] as? Int, 25)
        XCTAssertEqual(attrs?["premium"] as? Bool, true)
    }

    func testMakeURL() {
        XCTAssertEqual(
            SavvagentClient.makeURL(base: "https://api.savvagent.com/flags/", path: "/api/flags/stream")?.absoluteString,
            "https://api.savvagent.com/flags/api/flags/stream"
        )
        XCTAssertEqual(
            SavvagentClient.makeURL(
                base: "https://api.savvagent.com/flags",
                path: "/api/sdk/flags",
                query: [URLQueryItem(name: "environment", value: "production")]
            )?.absoluteString,
            "https://api.savvagent.com/flags/api/sdk/flags?environment=production"
        )
        XCTAssertEqual(SavvagentClient.encodePathSegment("a/b c"), "a%2Fb%20c")
    }

    // MARK: SSE

    func testSSEParserDispatchesOnBlankLine() {
        var parser = SSEParser()
        XCTAssertNil(parser.feed(line: "event: flag.updated"))
        XCTAssertNil(parser.feed(line: #"data: {"key":"f"}"#))
        let event = parser.feed(line: "")
        XCTAssertEqual(event, SSEEvent(event: "flag.updated", data: #"{"key":"f"}"#))
        // State resets
        XCTAssertNil(parser.feed(line: ""))
    }

    func testSSEParserHeartbeatCommentsAndMultilineData() {
        var parser = SSEParser()
        XCTAssertNil(parser.feed(line: ": keep-alive"))
        XCTAssertNil(parser.feed(line: "event: heartbeat"))
        XCTAssertNil(parser.feed(line: "data: ping"))
        XCTAssertEqual(parser.feed(line: ""), SSEEvent(event: "heartbeat", data: "ping"))

        XCTAssertNil(parser.feed(line: "data:one"))
        XCTAssertNil(parser.feed(line: "data: two"))
        XCTAssertEqual(parser.feed(line: ""), SSEEvent(event: "message", data: "one\ntwo"))
    }

    func testParseFlagChange() {
        let event = SSEEvent(event: "flag.deleted", data: #"{"type":"flag.deleted","key":"f","version":4}"#)
        let change = SavvagentClient.parseFlagChange(event)
        XCTAssertEqual(change?.type, .deleted)
        XCTAssertEqual(change?.flagKey, "f")
        XCTAssertEqual(change?.version, 4)
        XCTAssertNil(SavvagentClient.parseFlagChange(SSEEvent(event: "heartbeat", data: "ping")))
    }

    func testFlagEventInvalidatesCacheAndNotifiesListeners() async throws {
        var calls = 0
        MockURLProtocol.requestHandler = { [self] request in
            calls += 1
            return ok(request, #"{"key":"f","enabled":true,"version":1}"#)
        }
        let ctx = UserContext(userId: "u")
        _ = try await client.evaluate(flagKey: "f", context: ctx)

        var received: FlagChangeEvent?
        let token = client.addFlagChangeListener { received = $0 }
        client.handleStreamEvent(SSEEvent(event: "flag.updated", data: #"{"key":"f","version":2}"#))
        XCTAssertEqual(received?.flagKey, "f")

        _ = try await client.evaluate(flagKey: "f", context: ctx)
        XCTAssertEqual(calls, 2)

        client.removeFlagChangeListener(token)
        received = nil
        client.handleStreamEvent(SSEEvent(event: "flag.updated", data: #"{"key":"f","version":3}"#))
        XCTAssertNil(received)
    }

    // MARK: Config

    func testConfigurationDefaults() {
        let config = SavvagentConfig(sdkKey: "test-key")
        XCTAssertEqual(config.apiUrl, "https://api.savvagent.com/flags")
        XCTAssertEqual(config.environment, "production")
        XCTAssertEqual(config.pollingInterval, 60)
        XCTAssertTrue(config.enableWebSocket)
        XCTAssertEqual(config.timeout, 30)
    }

    func testConfigurationCustomValues() {
        let config = SavvagentConfig(
            apiUrl: "https://custom.api.com/",
            sdkKey: "custom-key",
            environment: "staging",
            pollingInterval: 120,
            enableWebSocket: false,
            timeout: 45
        )
        XCTAssertEqual(config.apiUrl, "https://custom.api.com")
        XCTAssertEqual(config.sdkKey, "custom-key")
        XCTAssertEqual(config.environment, "staging")
        XCTAssertEqual(config.pollingInterval, 120)
        XCTAssertFalse(config.enableWebSocket)
        XCTAssertEqual(config.timeout, 45)
    }

    // MARK: #59 strict boolean enabled

    func testNonBooleanEnabledIsInvalidResponseAndNotCached() async {
        let bodies = [
            #"{"enabled":"true"}"#,
            #"{"enabled":1}"#,
            #"{"enabled":0}"#,
            #"{"enabled":null}"#,
            #"{"key":"f"}"#
        ]
        for body in bodies {
            MockURLProtocol.requestHandler = { [self] request in ok(request, body) }
            do {
                _ = try await client.evaluate(flagKey: "f", context: UserContext(userId: "u"))
                XCTFail("expected throw for \(body)")
            } catch SavvagentError.invalidResponse {
            } catch {
                XCTFail("unexpected error \(error) for \(body)")
            }
            XCTAssertTrue(client.cachedDigestsForTesting().isEmpty, "nothing cached for \(body)")
        }
        let value = await client.getVariation(flagKey: "f", context: UserContext(userId: "u"), defaultValue: "dflt")
        XCTAssertEqual(value, "dflt")
    }

    func testRealBooleanEnabledStillWorks() async throws {
        MockURLProtocol.requestHandler = { [self] request in
            ok(request, request.url!.path.contains("on-flag") ? #"{"enabled":true}"# : #"{"enabled":false}"#)
        }
        let on = try await client.isEnabled(flagKey: "on-flag", context: UserContext(userId: "u"))
        let off = try await client.isEnabled(flagKey: "off-flag", context: UserContext(userId: "u"))
        XCTAssertTrue(on)
        XCTAssertFalse(off)
    }

    // MARK: #30 digest keys and one total bound

    private func seed(_ flag: String, user: String) async throws {
        MockURLProtocol.requestHandler = { [self] request in ok(request, #"{"enabled":true}"#) }
        _ = try await client.evaluate(flagKey: flag, context: UserContext(userId: user))
    }

    func testCacheKeyIsSHA256HexOfContextKey() async throws {
        try await seed("f", user: "user-123")
        try await seed("f", user: "user-123")
        let digests = client.cachedDigestsForTesting()["f"] ?? []
        XCTAssertEqual(digests, ["fcdec6df4d44dbc637c7c5b58efface52a7f8a88535423430255be0bb89bedd8"])
        XCTAssertFalse(digests.contains { $0.contains("user-123") })
        XCTAssertEqual(
            SavvagentClient.contextDigest(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
        XCTAssertEqual(
            SavvagentClient.contextDigest("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testDifferentContextsGetDifferentEntries() async throws {
        try await seed("f", user: "alice")
        try await seed("f", user: "bob")
        XCTAssertEqual(client.cachedDigestsForTesting()["f"]?.count, 2)
    }

    func testCacheIsBoundedByTotalCapAndEvictsLeastRecentlyUsed() async throws {
        client.maxCacheEntries = 2
        try await seed("flag-a", user: "u")
        try await seed("flag-b", user: "u")
        try await seed("flag-c", user: "u")
        let cached = client.cachedDigestsForTesting()
        XCTAssertEqual(Set(cached.keys), ["flag-b", "flag-c"])
        XCTAssertEqual(cached.values.reduce(0) { $0 + $1.count }, 2)
    }

    func testCacheCountNeverExceedsCapAfterManyInserts() async throws {
        client.maxCacheEntries = 20
        for i in 0..<100 {
            try await seed("flag-\(i % 7)", user: "user-\(i)")
            let total = client.cachedDigestsForTesting().values.reduce(0) { $0 + $1.count }
            XCTAssertLessThanOrEqual(total, 20)
            XCTAssertEqual(client.cacheEntryCountForTesting(), total)
        }
    }

    func testCacheCapCountsContextsAcrossFlags() async throws {
        client.maxCacheEntries = 2
        try await seed("flag-a", user: "u1")
        try await seed("flag-a", user: "u2")
        try await seed("flag-b", user: "u1")
        let cached = client.cachedDigestsForTesting()
        XCTAssertEqual(cached.values.reduce(0) { $0 + $1.count }, 2)
        XCTAssertEqual(cached["flag-a"]?.count, 1)
        XCTAssertEqual(cached["flag-b"]?.count, 1)
    }

    func testCacheHitRefreshesRecency() async throws {
        client.maxCacheEntries = 2
        try await seed("flag-a", user: "u")
        try await seed("flag-b", user: "u")
        let hit = try await client.evaluate(flagKey: "flag-a", context: UserContext(userId: "u"))
        XCTAssertEqual(hit.reason, "cached")
        try await seed("flag-c", user: "u")
        XCTAssertEqual(Set(client.cachedDigestsForTesting().keys), ["flag-a", "flag-c"])
    }

    func testInvalidateFlagRemovesAllItsContextsOnly() async throws {
        try await seed("flag-a", user: "u1")
        try await seed("flag-a", user: "u2")
        try await seed("flag-b", user: "u1")
        client.clearConfigOverride(flagKey: "flag-a") // drops every cached context for the flag
        let cached = client.cachedDigestsForTesting()
        XCTAssertNil(cached["flag-a"])
        XCTAssertEqual(cached["flag-b"]?.count, 1)
    }
}

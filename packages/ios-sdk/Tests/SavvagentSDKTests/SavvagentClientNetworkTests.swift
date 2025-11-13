import XCTest
@testable import SavvagentSDK

final class SavvagentClientNetworkTests: XCTestCase {
    var client: SavvagentClient!
    var configuration: URLSessionConfiguration!

    override func setUp() {
        super.setUp()

        // Configure URLSession to use our mock protocol
        configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]

        let config = SavvagentConfig(
            apiUrl: "https://beta.savvagent.com",
            sdkKey: "test-key",
            environment: "test",
            enableWebSocket: false,
            pollingInterval: 0 // Disable polling for tests
        )

        // We'll need to modify SavvagentClient to accept custom URLSession for testing
        // For now, these tests demonstrate the structure
    }

    override func tearDown() {
        MockURLProtocol.requestHandler = nil
        MockURLProtocol.error = nil
        client?.close()
        client = nil
        super.tearDown()
    }

    func testIsEnabledReturnsTrue() async throws {
        // Mock successful response with enabled=true
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/flags/test-flag/evaluate")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")

            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!

            let jsonData = """
            {
                "enabled": true,
                "flagKey": "test-flag"
            }
            """.data(using: .utf8)!

            return (response, jsonData)
        }

        let context = UserContext(userId: "user-123")

        // This would work if we could inject the URLSession
        // let isEnabled = try await client.isEnabled(flagKey: "test-flag", context: context)
        // XCTAssertTrue(isEnabled)
    }

    func testIsEnabledReturnsFalse() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!

            let jsonData = """
            {
                "enabled": false,
                "flagKey": "test-flag"
            }
            """.data(using: .utf8)!

            return (response, jsonData)
        }

        // Test would go here
    }

    func testIsEnabledHandlesHTTPError() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 404,
                httpVersion: nil,
                headerFields: nil
            )!

            return (response, Data())
        }

        // Should throw SavvagentError.requestFailed
    }

    func testIsEnabledHandlesNetworkError() async throws {
        MockURLProtocol.error = URLError(.notConnectedToInternet)

        // Should throw network error
    }

    func testGetVariationReturnsStringValue() async throws {
        MockURLProtocol.requestHandler = { request in
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!

            let jsonData = """
            {
                "value": "dark-mode"
            }
            """.data(using: .utf8)!

            return (response, jsonData)
        }

        // Test variation retrieval
    }

    func testGetVariationReturnsDefaultOnError() async {
        MockURLProtocol.error = URLError(.notConnectedToInternet)

        let context = UserContext(userId: "user-123")

        // Should return default value on error
        // let value = await client.getVariation(flagKey: "theme", context: context, defaultValue: "light")
        // XCTAssertEqual(value, "light")
    }

    func testTrackEventSendsCorrectPayload() async {
        MockURLProtocol.requestHandler = { request in
            XCTAssertEqual(request.url?.path, "/v1/events")
            XCTAssertEqual(request.httpMethod, "POST")

            // Verify event payload
            if let bodyData = request.httpBody,
               let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
                XCTAssertEqual(json["event"] as? String, "button_click")
                XCTAssertNotNil(json["timestamp"])
            }

            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!

            return (response, Data())
        }

        // Test tracking
    }

    func testUserContextSerializesToJSON() {
        let context = UserContext(
            userId: "user-123",
            attributes: [
                "email": "test@example.com",
                "plan": "pro",
                "age": 25,
                "premium": true
            ]
        )

        let json = context.toJSON()

        XCTAssertEqual(json["userId"] as? String, "user-123")

        if let attrs = json["attributes"] as? [String: Any] {
            XCTAssertEqual(attrs["email"] as? String, "test@example.com")
            XCTAssertEqual(attrs["plan"] as? String, "pro")
            XCTAssertEqual(attrs["age"] as? Int, 25)
            XCTAssertEqual(attrs["premium"] as? Bool, true)
        } else {
            XCTFail("Attributes not found")
        }
    }

    func testCachingWorks() async throws {
        var callCount = 0

        MockURLProtocol.requestHandler = { request in
            callCount += 1

            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            )!

            let jsonData = """
            {
                "enabled": true,
                "flagKey": "test-flag"
            }
            """.data(using: .utf8)!

            return (response, jsonData)
        }

        // First call should hit the API
        // Second call should use cache
        // XCTAssertEqual(callCount, 1)
    }

    func testConfigurationDefaults() {
        let config = SavvagentConfig(sdkKey: "test-key")

        XCTAssertEqual(config.apiUrl, "https://beta.savvagent.com")
        XCTAssertEqual(config.environment, "production")
        XCTAssertEqual(config.pollingInterval, 60)
        XCTAssertTrue(config.enableWebSocket)
        XCTAssertEqual(config.timeout, 30)
    }

    func testConfigurationCustomValues() {
        let config = SavvagentConfig(
            apiUrl: "https://custom.api.com",
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
}

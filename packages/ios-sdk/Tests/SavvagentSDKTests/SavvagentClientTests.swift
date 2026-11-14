import XCTest
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import SavvagentSDK

final class SavvagentClientTests: XCTestCase {
    var client: SavvagentClient!

    override func setUp() {
        super.setUp()
        let config = SavvagentConfig(
            sdkKey: "test-key",
            environment: "test",
            pollingInterval: 0, // Disable polling for tests
            enableWebSocket: false
        )
        client = SavvagentClient(config: config)
    }

    override func tearDown() {
        client.close()
        client = nil
        super.tearDown()
    }

    func testClientInitialization() {
        XCTAssertNotNil(client)
    }

    func testUserContextCreation() {
        let context = UserContext(
            userId: "user-123",
            attributes: [
                "email": "test@example.com",
                "plan": "pro"
            ]
        )

        XCTAssertEqual(context.userId, "user-123")
        XCTAssertEqual(context.attributes["email"] as? String, "test@example.com")
        XCTAssertEqual(context.attributes["plan"] as? String, "pro")
    }

    func testUserContextWithEmptyAttributes() {
        let context = UserContext(userId: "user-456")

        XCTAssertEqual(context.userId, "user-456")
        XCTAssertTrue(context.attributes.isEmpty)
    }

    func testUserContextWithComplexAttributes() {
        let context = UserContext(
            userId: "user-789",
            attributes: [
                "email": "complex@example.com",
                "age": 30,
                "isPremium": true,
                "tags": ["vip", "early-adopter"]
            ]
        )

        XCTAssertEqual(context.userId, "user-789")
        XCTAssertEqual(context.attributes["email"] as? String, "complex@example.com")
        XCTAssertEqual(context.attributes["age"] as? Int, 30)
        XCTAssertEqual(context.attributes["isPremium"] as? Bool, true)
        XCTAssertNotNil(context.attributes["tags"])
    }

    func testConfigDefaults() {
        let config = SavvagentConfig(sdkKey: "test-key")

        XCTAssertEqual(config.apiUrl, "https://api.savvagent.com/flags")
        XCTAssertEqual(config.environment, "production")
        XCTAssertEqual(config.pollingInterval, 60)
        XCTAssertTrue(config.enableWebSocket)
        XCTAssertEqual(config.timeout, 30)
    }

    func testConfigCustomValues() {
        let config = SavvagentConfig(
            apiUrl: "https://staging.savvagent.com",
            sdkKey: "staging-key",
            environment: "staging",
            pollingInterval: 120,
            enableWebSocket: false,
            timeout: 60
        )

        XCTAssertEqual(config.apiUrl, "https://staging.savvagent.com")
        XCTAssertEqual(config.sdkKey, "staging-key")
        XCTAssertEqual(config.environment, "staging")
        XCTAssertEqual(config.pollingInterval, 120)
        XCTAssertFalse(config.enableWebSocket)
        XCTAssertEqual(config.timeout, 60)
    }

    func testApiUrlTrailingSlashesStripped() {
        let config = SavvagentConfig(apiUrl: "https://example.com/flags///", sdkKey: "k")
        XCTAssertEqual(config.apiUrl, "https://example.com/flags")
    }

    func testClientCleanup() {
        let config = SavvagentConfig(
            sdkKey: "test-key",
            pollingInterval: 0,
            enableWebSocket: false
        )
        let testClient = SavvagentClient(config: config)

        XCTAssertNotNil(testClient)

        // Should not crash
        testClient.close()
        testClient.close() // Multiple closes should be safe
    }

    func testSavvagentErrorTypes() {
        let invalidURLError = SavvagentError.invalidURL
        let requestFailedError = SavvagentError.requestFailed
        let invalidResponseError = SavvagentError.invalidResponse

        XCTAssertNotNil(invalidURLError)
        XCTAssertNotNil(requestFailedError)
        XCTAssertNotNil(invalidResponseError)
    }
}

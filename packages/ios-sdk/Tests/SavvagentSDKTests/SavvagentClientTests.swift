import XCTest
@testable import SavvagentSDK

final class SavvagentClientTests: XCTestCase {
    var client: SavvagentClient!

    override func setUp() {
        super.setUp()
        let config = SavvagentConfig(
            sdkKey: "test-key",
            environment: "test",
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
    }

    func testConfigDefaults() {
        let config = SavvagentConfig(sdkKey: "test-key")

        XCTAssertEqual(config.apiUrl, "https://beta.savvagent.com")
        XCTAssertEqual(config.environment, "production")
        XCTAssertEqual(config.pollingInterval, 60)
        XCTAssertTrue(config.enableWebSocket)
    }
}

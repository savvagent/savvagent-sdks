package com.savvagent.sdk

import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*

class SavvagentClientTest {

    @Test
    fun testConfigDefaults() {
        val config = SavvagentConfig(sdkKey = "test-key")

        assertEquals("https://beta.savvagent.com", config.apiUrl)
        assertEquals("production", config.environment)
        assertEquals(60_000L, config.pollingInterval)
        assertTrue(config.enableWebSocket)
        assertFalse(config.enableLogging)
    }

    @Test
    fun testUserContextCreation() {
        val context = UserContext(
            userId = "user-123",
            attributes = mapOf(
                "email" to "test@example.com",
                "plan" to "pro"
            )
        )

        assertEquals("user-123", context.userId)
        assertEquals("test@example.com", context.attributes["email"])
        assertEquals("pro", context.attributes["plan"])
    }

    @Test
    fun testUserContextToJson() {
        val context = UserContext(
            userId = "user-123",
            attributes = mapOf("email" to "test@example.com")
        )

        val json = context.toJson()

        assertEquals("user-123", json.getString("userId"))
        assertTrue(json.has("attributes"))
    }

    @Test
    fun testClientInitialization() = runTest {
        val config = SavvagentConfig(
            sdkKey = "test-key",
            environment = "test",
            enableWebSocket = false,
            pollingInterval = 0
        )

        val client = SavvagentClient(config)
        assertNotNull(client)

        client.close()
    }
}

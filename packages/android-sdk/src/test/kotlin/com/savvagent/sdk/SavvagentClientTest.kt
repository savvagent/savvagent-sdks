package com.savvagent.sdk

import kotlinx.coroutines.test.runTest
import org.junit.Test
import org.junit.Assert.*
import org.junit.Before
import org.junit.After

class SavvagentClientTest {

    @Before
    fun setUp() {
        // Setup runs before each test
    }

    @After
    fun tearDown() {
        // Cleanup runs after each test
    }

    @Test
    fun testConfigDefaults() {
        val config = SavvagentConfig(sdkKey = "test-key")

        assertEquals("https://beta.savvagent.com", config.apiUrl)
        assertEquals("production", config.environment)
        assertEquals(60_000L, config.pollingInterval)
        assertTrue(config.enableWebSocket)
        assertFalse(config.enableLogging)
        assertEquals(30_000L, config.timeout)
    }

    @Test
    fun testConfigCustomValues() {
        val config = SavvagentConfig(
            apiUrl = "https://staging.savvagent.com",
            sdkKey = "staging-key",
            environment = "staging",
            pollingInterval = 120_000L,
            enableWebSocket = false,
            timeout = 60_000L,
            enableLogging = true
        )

        assertEquals("https://staging.savvagent.com", config.apiUrl)
        assertEquals("staging-key", config.sdkKey)
        assertEquals("staging", config.environment)
        assertEquals(120_000L, config.pollingInterval)
        assertFalse(config.enableWebSocket)
        assertEquals(60_000L, config.timeout)
        assertTrue(config.enableLogging)
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
    fun testUserContextWithEmptyAttributes() {
        val context = UserContext(userId = "user-456")

        assertEquals("user-456", context.userId)
        assertTrue(context.attributes.isEmpty())
    }

    @Test
    fun testUserContextWithComplexAttributes() {
        val context = UserContext(
            userId = "user-789",
            attributes = mapOf(
                "email" to "complex@example.com",
                "age" to 30,
                "isPremium" to true,
                "score" to 95.5
            )
        )

        assertEquals("user-789", context.userId)
        assertEquals("complex@example.com", context.attributes["email"])
        assertEquals(30, context.attributes["age"])
        assertEquals(true, context.attributes["isPremium"])
        assertEquals(95.5, context.attributes["score"])
    }

    @Test
    fun testUserContextToJson() {
        val context = UserContext(
            userId = "user-123",
            attributes = mapOf(
                "email" to "test@example.com",
                "plan" to "pro"
            )
        )

        val json = context.toJson()

        assertEquals("user-123", json.getString("userId"))
        assertTrue(json.has("attributes"))

        val attrs = json.getJSONObject("attributes")
        assertEquals("test@example.com", attrs.getString("email"))
        assertEquals("pro", attrs.getString("plan"))
    }

    @Test
    fun testUserContextJsonWithVariousTypes() {
        val context = UserContext(
            userId = "user-multi",
            attributes = mapOf(
                "string" to "value",
                "int" to 42,
                "boolean" to true,
                "double" to 3.14
            )
        )

        val json = context.toJson()
        val attrs = json.getJSONObject("attributes")

        assertEquals("value", attrs.getString("string"))
        assertEquals(42, attrs.getInt("int"))
        assertEquals(true, attrs.getBoolean("boolean"))
        assertEquals(3.14, attrs.getDouble("double"), 0.001)
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

    @Test
    fun testClientCleanup() = runTest {
        val config = SavvagentConfig(
            sdkKey = "test-key",
            enableWebSocket = false,
            pollingInterval = 0
        )

        val client = SavvagentClient(config)
        assertNotNull(client)

        // Should not crash
        client.close()
        client.close() // Multiple closes should be safe
    }

    @Test
    fun testSavvagentExceptionCreation() {
        val exception = SavvagentException("Test error")
        assertEquals("Test error", exception.message)

        val exceptionWithCause = SavvagentException(
            "Test error with cause",
            RuntimeException("Cause")
        )
        assertEquals("Test error with cause", exceptionWithCause.message)
        assertNotNull(exceptionWithCause.cause)
    }
}

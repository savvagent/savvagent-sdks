package com.savvagent.sdk

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

class SavvagentClientNetworkTest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var client: SavvagentClient

    @Before
    fun setUp() {
        mockWebServer = MockWebServer()
        mockWebServer.start()

        val config = SavvagentConfig(
            apiUrl = mockWebServer.url("/").toString().removeSuffix("/"),
            sdkKey = "test-key",
            environment = "test",
            enableWebSocket = false,
            pollingInterval = 0,
            enableLogging = true
        )

        client = SavvagentClient(config)
    }

    @After
    fun tearDown() {
        client.close()
        mockWebServer.shutdown()
    }

    @Test
    fun testIsEnabledReturnsTrue() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true, "flagKey": "test-flag"}""")
                .addHeader("Content-Type", "application/json")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("test-flag", context)

        assertTrue(result.isSuccess)
        assertTrue(result.getOrDefault(false))

        val request = mockWebServer.takeRequest()
        assertEquals("/v1/flags/test-flag/evaluate", request.path)
        assertEquals("POST", request.method)
        assertEquals("Bearer test-key", request.getHeader("Authorization"))
    }

    @Test
    fun testIsEnabledReturnsFalse() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": false, "flagKey": "test-flag"}""")
                .addHeader("Content-Type", "application/json")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("test-flag", context)

        assertTrue(result.isSuccess)
        assertFalse(result.getOrDefault(true))
    }

    @Test
    fun testIsEnabledHandles404() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setBody("""{"error": "Flag not found"}""")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("missing-flag", context)

        assertTrue(result.isFailure)
    }

    @Test
    fun testIsEnabledHandles500() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(500)
                .setBody("Internal server error")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("test-flag", context)

        assertTrue(result.isFailure)
    }

    @Test
    fun testIsEnabledHandlesInvalidJSON() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("invalid json")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("test-flag", context)

        assertTrue(result.isFailure)
    }

    @Test
    fun testIsEnabledSendsUserContext() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true}""")
        )

        val context = UserContext(
            userId = "user-456",
            attributes = mapOf(
                "email" to "test@example.com",
                "plan" to "pro"
            )
        )

        client.isEnabled("test-flag", context)

        val request = mockWebServer.takeRequest()
        val body = request.body.readUtf8()

        assertTrue(body.contains("user-456"))
        assertTrue(body.contains("email"))
        assertTrue(body.contains("test@example.com"))
    }

    @Test
    fun testGetVariationReturnsValue() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"value": "dark-mode"}""")
        )

        val context = UserContext(userId = "user-123")
        val value = client.getVariation("theme", context, "light")

        assertEquals("dark-mode", value)
    }

    @Test
    fun testGetVariationReturnsDefaultOnError() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(500)
        )

        val context = UserContext(userId = "user-123")
        val value = client.getVariation("theme", context, "light")

        assertEquals("light", value)
    }

    @Test
    fun testGetVariationWithNumericValue() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"value": 100}""")
        )

        val context = UserContext(userId = "user-123")
        val value = client.getVariation("max-items", context, 10)

        assertEquals(100, value)
    }

    @Test
    fun testTrackEventSendsCorrectPayload() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
        )

        val context = UserContext(userId = "user-123")
        val properties = mapOf(
            "button" to "checkout",
            "value" to 99.99
        )

        client.track("button_click", context, properties)

        val request = mockWebServer.takeRequest()
        assertEquals("/v1/events", request.path)
        assertEquals("POST", request.method)

        val body = request.body.readUtf8()
        assertTrue(body.contains("button_click"))
        assertTrue(body.contains("user-123"))
        assertTrue(body.contains("button"))
        assertTrue(body.contains("checkout"))
    }

    @Test
    fun testTrackEventDoesNotThrowOnFailure() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(500)
        )

        val context = UserContext(userId = "user-123")

        // Should not throw
        client.track("test_event", context)
    }

    @Test
    fun testMultipleSequentialRequests() = runTest {
        // Queue multiple responses
        repeat(3) {
            mockWebServer.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .setBody("""{"enabled": true}""")
            )
        }

        val context = UserContext(userId = "user-123")

        val result1 = client.isEnabled("flag1", context)
        val result2 = client.isEnabled("flag2", context)
        val result3 = client.isEnabled("flag3", context)

        assertTrue(result1.isSuccess)
        assertTrue(result2.isSuccess)
        assertTrue(result3.isSuccess)

        assertEquals(3, mockWebServer.requestCount)
    }

    @Test
    fun testRequestHeaders() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true}""")
        )

        val context = UserContext(userId = "user-123")
        client.isEnabled("test-flag", context)

        val request = mockWebServer.takeRequest()

        assertEquals("Bearer test-key", request.getHeader("Authorization"))
        assertEquals("application/json", request.getHeader("Content-Type"))
    }
}

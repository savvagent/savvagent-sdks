package com.savvagent.sdk

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SavvagentClientNetworkTest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var client: SavvagentClient

    private fun baseUrl(): String = mockWebServer.url("/").toString().removeSuffix("/")

    @Before
    fun setUp() {
        mockWebServer = MockWebServer()
        mockWebServer.start()

        val config = SavvagentConfig(
            apiUrl = baseUrl(),
            sdkKey = "test-key",
            environment = "test",
            enableWebSocket = false,
            pollingInterval = 0,
            enableLogging = true,
            enableTelemetry = false
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
                .setBody("""{"key": "test-flag", "enabled": true, "scope": "application", "variation": null, "configuration": null, "version": 3}""")
                .addHeader("Content-Type", "application/json")
        )

        val context = UserContext(userId = "user-123")
        val result = client.isEnabled("test-flag", context)

        assertTrue(result.isSuccess)
        assertTrue(result.getOrDefault(false))

        val request = mockWebServer.takeRequest()
        assertEquals("/api/flags/test-flag/evaluate", request.path)
        assertEquals("POST", request.method)
        assertEquals("Bearer test-key", request.getHeader("Authorization"))
    }

    @Test
    fun testIsEnabledReturnsFalse() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"key": "test-flag", "enabled": false}""")
                .addHeader("Content-Type", "application/json")
        )

        val result = client.isEnabled("test-flag", UserContext(userId = "user-123"))

        assertTrue(result.isSuccess)
        assertFalse(result.getOrDefault(true))
    }

    @Test
    fun testEvaluateParsesVariationAndConfiguration() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"key": "theme", "enabled": true, "variation": "blue", "configuration": {"size": 3, "nested": {"a": "b"}}, "version": 2}""")
        )

        val result = client.evaluate("theme", UserContext(userId = "user-123")).getOrThrow()

        assertTrue(result.value)
        assertEquals("blue", result.variation)
        assertEquals(3, result.configuration?.get("size"))
        assertEquals(mapOf("a" to "b"), result.configuration?.get("nested"))
        assertEquals("evaluated", result.reason)
    }

    @Test
    fun testEvaluateCachesResultForSameUser() = runTest {
        mockWebServer.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"enabled": true}""")
        )
        val context = UserContext(userId = "user-123")

        client.evaluate("flag", context)
        val second = client.evaluate("flag", context).getOrThrow()

        assertEquals("cached", second.reason)
        assertEquals(1, mockWebServer.requestCount)
    }

    @Test
    fun testIsEnabledHandles404() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setBody("""{"error": "Flag not found"}""")
        )

        val result = client.isEnabled("missing-flag", UserContext(userId = "user-123"))

        assertTrue(result.isFailure)
    }

    @Test
    fun testIsEnabledHandles500() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(500)
                .setBody("Internal server error")
        )

        val result = client.isEnabled("test-flag", UserContext(userId = "user-123"))

        assertTrue(result.isFailure)
    }

    @Test
    fun testIsEnabledHandlesInvalidJSON() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("invalid json")
        )

        val result = client.isEnabled("test-flag", UserContext(userId = "user-123"))

        assertTrue(result.isFailure)
    }

    @Test
    fun testInvalidFlagKeysFailWithoutARequest() = runTest {
        val invalidKeys = listOf("", "/", ".", "..", "a".repeat(129), "a/b", "flag?x=1", "flag#x", "fl ag", "flag%2F", "caf\u00e9")

        for (key in invalidKeys) {
            val result = client.evaluate(key, UserContext(userId = "user-123"))

            assertTrue("expected failure for \"$key\"", result.isFailure)
            val error = result.exceptionOrNull()
            assertTrue("expected SavvagentException for \"$key\"", error is SavvagentException)
            assertTrue(error!!.message!!.contains("Invalid flag key"))
            assertTrue(client.isEnabled(key, UserContext(userId = "user-123")).isFailure)
            assertEquals("fallback", client.getVariation(key, UserContext(userId = "user-123"), "fallback"))
        }

        assertEquals(0, mockWebServer.requestCount)
    }

    @Test
    fun testInvalidFlagKeyMessageHasNoControlCharacters() = runTest {
        val result = client.evaluate("bad\r\nkey\tx\u0000", UserContext(userId = "user-123"))

        val message = result.exceptionOrNull()!!.message!!
        assertTrue(message.contains("Invalid flag key"))
        assertTrue(message.contains("bad??key?x?"))
        assertTrue(message.none { Character.isISOControl(it) })
        assertEquals(0, mockWebServer.requestCount)
    }

    @Test
    fun testInvalidFlagKeyMessageHasNoLineSeparatorsOrBidiControls() = runTest {
        val result = client.evaluate("a\u2028b\u2029c\u202Ed\u200Be", UserContext(userId = "user-123"))

        val message = result.exceptionOrNull()!!.message!!
        assertTrue(message.contains("a?b?c?d?e"))
        assertTrue(
            message.none {
                val type = Character.getType(it).toByte()
                type == Character.LINE_SEPARATOR || type == Character.PARAGRAPH_SEPARATOR || type == Character.FORMAT
            }
        )
        assertEquals(0, mockWebServer.requestCount)
    }

    @Test
    fun testValidFlagKeysAreSent() = runTest {
        val longest = "a".repeat(128)
        val validKeys = listOf("test-flag", "My_Flag.v2", "a", "...", longest)

        for (key in validKeys) {
            mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))

            val result = client.isEnabled(key, UserContext(userId = "user-123"))

            assertTrue("expected success for \"$key\"", result.isSuccess)
            assertEquals("/api/flags/$key/evaluate", mockWebServer.takeRequest().path)
        }
    }

    @Test
    fun testIsValidFlagKey() {
        assertTrue(isValidFlagKey("test-flag"))
        assertTrue(isValidFlagKey("a".repeat(128)))
        assertFalse(isValidFlagKey(""))
        assertFalse(isValidFlagKey("/"))
        assertFalse(isValidFlagKey("."))
        assertFalse(isValidFlagKey(".."))
        assertFalse(isValidFlagKey("a".repeat(129)))
    }

    @Test
    fun testIsEnabledSendsSnakeCaseContext() = runTest {
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
            ),
            anonymousId = "anon-1"
        )

        client.isEnabled("test-flag", context)

        val request = mockWebServer.takeRequest()
        val body = JSONObject(request.body.readUtf8())
        val ctx = body.getJSONObject("context")

        assertEquals("user-456", ctx.getString("user_id"))
        assertEquals("anon-1", ctx.getString("anonymous_id"))
        assertEquals("test", ctx.getString("environment"))
        assertFalse(ctx.has("userId"))
        assertEquals("test@example.com", ctx.getJSONObject("attributes").getString("email"))
        assertEquals("pro", ctx.getJSONObject("attributes").getString("plan"))
    }

    @Test
    fun testTrailingSlashesInApiUrlAreStripped() = runTest {
        val slashed = SavvagentClient(
            SavvagentConfig(
                apiUrl = baseUrl() + "/flags//",
                sdkKey = "test-key",
                enableWebSocket = false,
                pollingInterval = 0,
                enableTelemetry = false
            )
        )
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))

        slashed.isEnabled("test-flag", UserContext(userId = "u"))
        slashed.close()

        assertEquals("/flags/api/flags/test-flag/evaluate", mockWebServer.takeRequest().path)
    }

    @Test
    fun testGetVariationReturnsVariationFromEvaluate() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true, "variation": "dark-mode"}""")
        )

        val value = client.getVariation("theme", UserContext(userId = "user-123"), "light")

        assertEquals("dark-mode", value)
        // No separate variation endpoint exists: it must use evaluate
        assertEquals("/api/flags/theme/evaluate", mockWebServer.takeRequest().path)
    }

    @Test
    fun testGetVariationReturnsDefaultOnError() = runTest {
        mockWebServer.enqueue(MockResponse().setResponseCode(500))

        val value = client.getVariation("theme", UserContext(userId = "user-123"), "light")

        assertEquals("light", value)
    }

    @Test
    fun testGetVariationReturnsDefaultOnTypeMismatch() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true, "variation": "blue"}""")
        )

        val value = client.getVariation("max-items", UserContext(userId = "user-123"), 10)

        assertEquals(10, value)
    }

    @Test
    fun testRefreshUsesBulkEndpointWithEnvironment() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"flags": [{"key": "a", "enabled": true, "version": 1}, {"key": "b", "enabled": false, "version": 4}], "count": 2}""")
        )

        val result = client.refresh()

        assertTrue(result.isSuccess)
        val request = mockWebServer.takeRequest()
        assertEquals("GET", request.method)
        assertEquals("/api/sdk/flags?environment=test", request.path)
        assertEquals("Bearer test-key", request.getHeader("Authorization"))
        assertEquals(mapOf("a" to true, "b" to false), client.flagUpdates.value)
    }

    @Test
    fun testRefreshTreatsNonBooleanEnabledAsDisabled() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"flags": [{"key": "str", "enabled": "true"}, {"key": "num", "enabled": 1}, {"key": "real", "enabled": true}]}""")
        )

        assertTrue(client.refresh().isSuccess)

        assertEquals(mapOf("str" to false, "num" to false, "real" to true), client.flagUpdates.value)
    }

    @Test
    fun testUserDigestIsLowercaseSha256Hex() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", client.userDigest("abc"))
    }

    @Test
    fun testRefreshInvalidatesCacheWhenVersionChanges() = runTest {
        mockWebServer.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"enabled": true, "version": 1}""")
        )
        mockWebServer.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"flags": [{"key": "a", "enabled": true, "version": 2}]}""")
        )
        mockWebServer.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"enabled": false, "version": 2}""")
        )
        val context = UserContext(userId = "u")

        assertTrue(client.isEnabled("a", context).getOrThrow())
        client.refresh()
        assertFalse(client.isEnabled("a", context).getOrThrow())
    }

    @Test
    @Suppress("DEPRECATION")
    fun testTrackSendsNothing() = runTest {
        client.track("button_click", UserContext(userId = "user-123"), mapOf("button" to "checkout"))

        assertEquals(0, mockWebServer.requestCount)
    }

    @Test
    fun testMultipleSequentialRequests() = runTest {
        repeat(3) {
            mockWebServer.enqueue(
                MockResponse()
                    .setResponseCode(200)
                    .setBody("""{"enabled": true}""")
            )
        }

        val context = UserContext(userId = "user-123")

        assertTrue(client.isEnabled("flag1", context).isSuccess)
        assertTrue(client.isEnabled("flag2", context).isSuccess)
        assertTrue(client.isEnabled("flag3", context).isSuccess)

        assertEquals(3, mockWebServer.requestCount)
    }

    @Test
    fun testRequestHeaders() = runTest {
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"enabled": true}""")
        )

        client.isEnabled("test-flag", UserContext(userId = "user-123"))

        val request = mockWebServer.takeRequest()

        assertEquals("Bearer test-key", request.getHeader("Authorization"))
        assertTrue(request.getHeader("Content-Type")!!.startsWith("application/json"))
    }

    @Test
    fun testTelemetryFlushPostsEvaluationsAndErrors() = runTest {
        val telemetryClient = SavvagentClient(
            SavvagentConfig(
                apiUrl = baseUrl(),
                sdkKey = "test-key",
                environment = "test",
                enableWebSocket = false,
                pollingInterval = 0,
                enableTelemetry = true
            )
        )
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true, "variation": "blue"}"""))
        mockWebServer.enqueue(MockResponse().setResponseCode(202)) // evaluations
        mockWebServer.enqueue(MockResponse().setResponseCode(202)) // errors

        telemetryClient.evaluate("f", UserContext(userId = "u"))
        telemetryClient.reportError("f", IllegalStateException("boom"), UserContext(userId = "u"), true)
        // reportError flushes asynchronously and may race with flush(); drain both paths
        telemetryClient.flush()

        mockWebServer.takeRequest() // evaluate
        val paths = mutableMapOf<String, JSONObject>()
        repeat(2) {
            val req = mockWebServer.takeRequest(5, TimeUnit.SECONDS) ?: return@repeat
            paths[req.path!!] = JSONObject(req.body.readUtf8())
        }
        telemetryClient.close()

        val evals = paths["/api/telemetry/evaluations"]!!.getJSONArray("evaluations")
        assertEquals(1, evals.length())
        assertEquals("f", evals.getJSONObject(0).getString("flag_key"))
        assertTrue(evals.getJSONObject(0).getBoolean("result"))
        assertEquals("blue", evals.getJSONObject(0).getString("variation"))
        assertEquals("test", evals.getJSONObject(0).getString("environment"))

        val errors = paths["/api/telemetry/errors"]!!.getJSONArray("errors")
        assertEquals("IllegalStateException", errors.getJSONObject(0).getString("error_type"))
        assertEquals("boom", errors.getJSONObject(0).getString("error_message"))
    }

    @Test
    fun testRealtimeStreamInvalidatesCacheAndNotifiesListeners() {
        val streamClient = SavvagentClient(
            SavvagentConfig(
                apiUrl = baseUrl(),
                sdkKey = "test-key",
                environment = "test",
                enableWebSocket = true,
                pollingInterval = 0,
                enableTelemetry = false
            )
        )
        val latch = CountDownLatch(1)
        var changedKey: String? = null
        var changedType: String? = null
        streamClient.addFlagChangeListener { key, type ->
            changedKey = key
            changedType = type
            latch.countDown()
        }

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(
                    "event: connected\ndata: {\"message\":\"ok\"}\n\n" +
                        "event: heartbeat\ndata: ping\n\n" +
                        "event: flag.updated\ndata: {\"type\":\"flag.updated\",\"key\":\"my-flag\",\"version\":4}\n\n"
                )
        )

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        streamClient.close()

        assertEquals("my-flag", changedKey)
        assertEquals("flag.updated", changedType)
        val request = mockWebServer.takeRequest()
        assertEquals("/api/flags/stream", request.path)
        assertEquals("text/event-stream", request.getHeader("Accept"))
        assertEquals("Bearer test-key", request.getHeader("Authorization"))
    }

    // --- #59: strict boolean "enabled" ---

    @Test
    fun testNonBooleanEnabledIsAFailedLookupAndNotCached() = runTest {
        val bodies = listOf(
            """{"enabled": "true"}""",
            """{"enabled": 1}""",
            """{"enabled": 0}""",
            """{"enabled": null}""",
            """{"key": "flag"}"""
        )
        val context = UserContext(userId = "user-123")
        for (body in bodies) {
            mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(body))
            val result = client.isEnabled("flag", context)
            assertTrue("expected failure for $body", result.isFailure)
            assertEquals("default for $body", true, result.getOrDefault(true))
            assertEquals("default for $body", false, result.getOrDefault(false))
            assertTrue("nothing cached for $body", client.cachedFlagKeys().isEmpty())
        }
        assertEquals(bodies.size, mockWebServer.requestCount)
    }

    @Test
    fun testRealBooleanEnabledStillWorks() = runTest {
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": false}"""))
        val context = UserContext(userId = "user-123")
        assertEquals(true, client.isEnabled("on-flag", context).getOrThrow())
        assertEquals(false, client.isEnabled("off-flag", context).getOrThrow())
        assertEquals(setOf("on-flag", "off-flag"), client.cachedFlagKeys())
    }

    // --- #30: one total bound, least recently used ---

    @Test
    fun testCacheIsBoundedByTotalCapAndEvictsLeastRecentlyUsed() = runTest {
        client.maxCacheEntries = 2
        val context = UserContext(userId = "user-123")
        for (flag in listOf("flag-a", "flag-b", "flag-c")) {
            mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
            client.evaluate(flag, context)
        }
        assertEquals(setOf("flag-b", "flag-c"), client.cachedFlagKeys())
    }

    @Test
    fun testCacheHitRefreshesRecency() = runTest {
        client.maxCacheEntries = 2
        val context = UserContext(userId = "user-123")
        for (flag in listOf("flag-a", "flag-b")) {
            mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
            client.evaluate(flag, context)
        }
        assertEquals("cached", client.evaluate("flag-a", context).getOrThrow().reason)
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
        client.evaluate("flag-c", context)
        assertEquals(setOf("flag-a", "flag-c"), client.cachedFlagKeys())
    }

    @Test
    fun testInvalidateCacheRemovesOnlyThatFlag() = runTest {
        val context = UserContext(userId = "user-123")
        for (flag in listOf("flag-a", "flag-b")) {
            mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
            client.evaluate(flag, context)
        }
        client.invalidateCache("flag-a")
        assertEquals(setOf("flag-b"), client.cachedFlagKeys())
    }

    @Test
    fun testCacheEntriesHoldDigestNotRawUserId() = runTest {
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": true}"""))
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody("""{"enabled": false}"""))
        client.evaluate("flag", UserContext(userId = "user-123"))
        assertEquals(
            listOf("fcdec6df4d44dbc637c7c5b58efface52a7f8a88535423430255be0bb89bedd8"),
            client.cachedUserDigests()
        )
        assertTrue(client.cachedUserDigests().none { it?.contains("user-123") == true })
        // Same user hits the cache; a different user does not
        assertEquals("cached", client.evaluate("flag", UserContext(userId = "user-123")).getOrThrow().reason)
        assertEquals("evaluated", client.evaluate("flag", UserContext(userId = "user-456")).getOrThrow().reason)
    }
}

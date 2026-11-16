package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.*;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Client behaviour against a mock server: request shape, results, defaults on failure, caching,
 * variations, configuration and overrides. The evaluate wire contract itself is pinned in
 * EvaluateContractTest; the per-context cache in ContextCacheTest; key validation in FlagKeyTest.
 */
class FlagClientTest {

    private MockWebServer mockWebServer;
    private FlagClient client;
    private AtomicInteger errors;

    @BeforeEach
    void setUp() throws Exception {
        mockWebServer = new MockWebServer();
        mockWebServer.start();
        errors = new AtomicInteger();
        client = newClient(new HashMap<>());
    }

    @AfterEach
    void tearDown() throws Exception {
        if (client != null) {
            client.close();
        }
        mockWebServer.shutdown();
    }

    private String baseUrl() {
        return mockWebServer.url("/").toString().replaceAll("/$", "");
    }

    private FlagClient newClient(Map<String, Boolean> defaults) {
        return new FlagClient(FlagClientConfig.builder("sdk_test_key")
                .baseUrl(baseUrl())
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(defaults)
                .onError(e -> errors.incrementAndGet())
                .build());
    }

    private void enqueueJson(String body) {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody(body));
    }

    private static FlagContext user(String id) {
        return FlagContext.builder().userId(id).build();
    }

    @Test
    void testClientInitialization() {
        assertNotNull(client);
    }

    @Test
    void testIsEnabledReturnsTrue() throws Exception {
        enqueueJson("{\"enabled\":true,\"flagId\":\"flag-123\"}");

        assertTrue(client.isEnabled("test-flag", user("user-123")));

        RecordedRequest request = mockWebServer.takeRequest(5, TimeUnit.SECONDS);
        assertEquals("/api/flags/test-flag/evaluate", request.getPath());
        assertEquals("POST", request.getMethod());
        assertEquals("Bearer sdk_test_key", request.getHeader("Authorization"));
        assertEquals(0, errors.get());
    }

    @Test
    void testIsEnabledReturnsFalse() {
        enqueueJson("{\"enabled\":false}");

        assertFalse(client.isEnabled("test-flag", user("user-123")));
        assertEquals(0, errors.get());
    }

    @Test
    void testIsEnabledWithoutContext() {
        enqueueJson("{\"enabled\":true}");

        assertTrue(client.isEnabled("test-flag"));
    }

    @Test
    void testEvaluateSendsTheContextInTheRequestBody() throws Exception {
        enqueueJson("{\"enabled\":true}");

        Map<String, Object> attributes = new HashMap<>();
        attributes.put("email", "test@example.com");
        attributes.put("plan", "pro");
        attributes.put("age", 30);
        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .attributes(attributes)
                .build();

        assertTrue(client.isEnabled("test-flag", context));

        RecordedRequest request = mockWebServer.takeRequest(5, TimeUnit.SECONDS);
        JsonObject sent = JsonParser.parseString(request.getBody().readUtf8()).getAsJsonObject()
                .getAsJsonObject("context");
        assertEquals("user-123", sent.get("userId").getAsString());
        JsonObject sentAttributes = sent.getAsJsonObject("attributes");
        assertEquals("test@example.com", sentAttributes.get("email").getAsString());
        assertEquals("pro", sentAttributes.get("plan").getAsString());
        assertEquals(30, sentAttributes.get("age").getAsInt());
    }

    @Test
    void testApplicationIdFromConfigIsAddedToTheContext() throws Exception {
        try (FlagClient scoped = new FlagClient(FlagClientConfig.builder("sdk_test_key")
                .baseUrl(baseUrl())
                .applicationId("app-1")
                .enableRealtime(false)
                .enableTelemetry(false)
                .build())) {
            enqueueJson("{\"enabled\":true}");

            scoped.isEnabled("test-flag", user("user-123"));

            RecordedRequest request = mockWebServer.takeRequest(5, TimeUnit.SECONDS);
            JsonObject sent = JsonParser.parseString(request.getBody().readUtf8()).getAsJsonObject()
                    .getAsJsonObject("context");
            assertEquals("app-1", sent.get("applicationId").getAsString());
        }
    }

    @Test
    void testFailedLookupsReturnTheDefaultAndReportTheError() {
        // A failed lookup never throws into the host app: it reports the error and serves the
        // configured default (false when the flag has none).
        Map<String, Boolean> defaults = new HashMap<>();
        defaults.put("on-by-default", true);
        try (FlagClient withDefaults = newClient(defaults)) {
            mockWebServer.enqueue(new MockResponse().setResponseCode(404)
                    .setBody("{\"error\":\"Flag not found\"}"));
            mockWebServer.enqueue(new MockResponse().setResponseCode(500)
                    .setBody("Internal server error"));
            mockWebServer.enqueue(new MockResponse().setResponseCode(500));

            FlagEvaluationResult missing = withDefaults.evaluate("missing-flag", user("user-123"));
            assertFalse(missing.getValue());
            assertEquals("error", missing.getReason());

            assertFalse(withDefaults.isEnabled("test-flag", user("user-123")));
            assertTrue(withDefaults.isEnabled("on-by-default", user("user-123")));
            assertEquals(3, errors.get());
        }
    }

    @Test
    void testInvalidJsonReturnsTheDefaultAndReportsTheError() {
        enqueueJson("invalid json");

        FlagEvaluationResult result = client.evaluate("test-flag", user("user-123"));

        assertFalse(result.getValue());
        assertEquals("error", result.getReason());
        assertEquals(1, errors.get());
    }

    @Test
    void testEmptyResponseReturnsTheDefaultAndReportsTheError() {
        enqueueJson("");

        FlagEvaluationResult result = client.evaluate("test-flag", user("user-123"));

        assertFalse(result.getValue());
        assertEquals("error", result.getReason());
        assertEquals(1, errors.get());
    }

    @Test
    void testEvaluateReturnsMetadata() {
        enqueueJson("{\"enabled\":true,\"flagId\":\"flag-123\",\"description\":\"d\","
                + "\"variant\":\"v\"}");

        FlagEvaluationResult result = client.evaluate("test-flag", user("user-123"));

        assertEquals("test-flag", result.getKey());
        assertNotNull(result.getMetadata());
        assertEquals("flag-123", result.getMetadata().getFlagId());
        assertEquals("d", result.getMetadata().getDescription());
        assertEquals("v", result.getMetadata().getVariant());
    }

    @Test
    void testGetVariationReturnsTheServerVariation() {
        enqueueJson("{\"enabled\":true,\"variation\":\"variant_a\","
                + "\"configuration\":{\"color\":\"blue\"}}");

        VariationResult result = client.getVariation("theme", user("user-123"));

        assertEquals("variant_a", result.getVariation());
        assertTrue(result.isEnabled());
        assertNotNull(result.getConfiguration());
    }

    @Test
    void testGetVariationFallsBackToControl() {
        enqueueJson("{\"enabled\":false,\"variation\":null}");

        VariationResult result = client.getVariation("theme", user("user-123"));

        assertEquals("control", result.getVariation());
        assertFalse(result.isEnabled());
    }

    @Test
    void testGetVariationOnErrorIsControlAndDisabled() {
        mockWebServer.enqueue(new MockResponse().setResponseCode(500));

        VariationResult result = client.getVariation("theme", user("user-123"));

        assertEquals("control", result.getVariation());
        assertFalse(result.isEnabled());
        assertEquals(1, errors.get());
    }

    @Test
    void testGetConfigReturnsConfigurationOnlyWhenEnabled() {
        enqueueJson("{\"enabled\":true,\"configuration\":{\"maxItems\":100}}");
        enqueueJson("{\"enabled\":false,\"configuration\":{\"maxItems\":100}}");

        assertNotNull(client.getConfig("on-flag", user("user-123")));
        assertNull(client.getConfig("off-flag", user("user-123")));
    }

    @Test
    void testGetConfigWithTypeCasting() {
        enqueueJson("{\"enabled\":true,\"configuration\":{\"maxItems\":100,\"label\":\"x\"}}");

        Limits limits = client.getConfig("limits", user("user-123"), Limits.class);

        assertNotNull(limits);
        assertEquals(100, limits.maxItems);
        assertEquals("x", limits.label);
    }

    static class Limits {
        int maxItems;
        String label;
    }

    @Test
    void testCachedResultIsServedWithoutAnotherRequest() {
        enqueueJson("{\"enabled\":true}");
        FlagContext context = user("user-123");

        FlagEvaluationResult first = client.evaluate("test-flag", context);
        FlagEvaluationResult second = client.evaluate("test-flag", context);

        assertEquals("evaluated", first.getReason());
        assertEquals("cached", second.getReason());
        assertTrue(second.getValue());
        assertEquals(1, mockWebServer.getRequestCount());
    }

    @Test
    void testInvalidateCacheForcesANewRequest() {
        enqueueJson("{\"enabled\":true}");
        enqueueJson("{\"enabled\":false}");
        FlagContext context = user("user-123");

        assertTrue(client.isEnabled("test-flag", context));
        client.invalidateCache("test-flag");
        assertFalse(client.isEnabled("test-flag", context));

        assertEquals(2, mockWebServer.getRequestCount());
    }

    @Test
    void testMultipleSequentialRequests() {
        for (int i = 0; i < 3; i++) {
            enqueueJson("{\"enabled\":true}");
        }
        FlagContext context = user("user-123");

        assertTrue(client.isEnabled("flag1", context));
        assertTrue(client.isEnabled("flag2", context));
        assertTrue(client.isEnabled("flag3", context));

        assertEquals(3, mockWebServer.getRequestCount());
    }

    @Test
    void testConfigurationOverrideReplacesTheServerConfiguration() {
        enqueueJson("{\"enabled\":true,\"configuration\":{\"a\":1,\"b\":2}}");
        Map<String, Object> override = new HashMap<>();
        override.put("a", 9);
        client.setConfigOverride("test-flag", override);

        assertTrue(client.hasConfigOverride("test-flag"));
        FlagEvaluationResult result = client.evaluate("test-flag", user("user-123"));

        @SuppressWarnings("unchecked")
        Map<String, Object> configuration = (Map<String, Object>) result.getConfiguration();
        assertEquals(1, configuration.size());
        assertEquals(9, configuration.get("a"));
    }

    @Test
    void testVariationOverrideAndClearAllOverrides() {
        enqueueJson("{\"enabled\":true,\"variation\":\"control\"}");
        enqueueJson("{\"enabled\":true,\"variation\":\"control\"}");
        client.setVariationOverride("test-flag", "variant_b");

        assertTrue(client.hasVariationOverride("test-flag"));
        assertEquals("variant_b", client.evaluate("test-flag", user("user-123")).getVariation());

        client.clearAllOverrides();

        assertFalse(client.hasVariationOverride("test-flag"));
        assertEquals("control", client.evaluate("test-flag", user("user-123")).getVariation());
    }

    @Test
    void testContextBuilder() {
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("email", "test@example.com");
        attributes.put("plan", "enterprise");

        FlagContext context = FlagContext.builder()
                .userId("user-456")
                .attributes(attributes)
                .build();

        assertEquals("user-456", context.getUserId());
        assertEquals("test@example.com", context.getAttributes().get("email"));
        assertEquals("enterprise", context.getAttributes().get("plan"));
    }

    @Test
    void testConfigBuilder() {
        FlagClientConfig config = FlagClientConfig.builder("sdk_custom_key")
                .baseUrl("https://flags.example.com")
                .applicationId("app-1")
                .enableRealtime(false)
                .enableTelemetry(false)
                .cacheTtl(120000L)
                .timeout(60000)
                .build();

        assertEquals("sdk_custom_key", config.getApiKey());
        assertEquals("https://flags.example.com", config.getBaseUrl());
        assertEquals("app-1", config.getApplicationId());
        assertFalse(config.isEnableRealtime());
        assertFalse(config.isEnableTelemetry());
        assertEquals(120000L, config.getCacheTtl());
        assertEquals(60000, config.getTimeout());
    }

    @Test
    void testBaseUrlTrailingSlashesAreStripped() {
        assertEquals("https://api.savvagent.com/flags",
                FlagClientConfig.builder("sdk_k").baseUrl("https://api.savvagent.com/flags/").build().getBaseUrl());
        assertEquals("https://api.savvagent.com/flags",
                FlagClientConfig.builder("sdk_k").baseUrl("https://api.savvagent.com/flags///").build().getBaseUrl());
        assertEquals("https://example.com",
                FlagClientConfig.builder("sdk_k").baseUrl("https://example.com").build().getBaseUrl());
    }

    @Test
    void testConfigDefaults() {
        FlagClientConfig config = FlagClientConfig.builder("sdk_test_key").build();

        assertEquals("https://api.savvagent.com/flags", config.getBaseUrl());
        assertEquals("", config.getApplicationId());
        assertTrue(config.isEnableRealtime());
        assertTrue(config.isEnableTelemetry());
        assertEquals(60000L, config.getCacheTtl());
        assertEquals(5000, config.getTimeout());
        assertNotNull(config.getDefaults());
        assertTrue(config.getDefaults().isEmpty());
        assertNotNull(config.getOnError());
    }

    @Test
    void testConfigRejectsKeysWithoutTheSdkPrefix() {
        assertThrows(IllegalArgumentException.class,
                () -> FlagClientConfig.builder("test-key").build());
        assertThrows(IllegalArgumentException.class,
                () -> FlagClientConfig.builder(null).build());
    }

    @Test
    void testClientCleanup() {
        FlagClient testClient = newClient(new HashMap<>());

        assertNotNull(testClient);

        // Should not throw, and closing twice is safe.
        assertDoesNotThrow(() -> testClient.close());
        assertDoesNotThrow(() -> testClient.close());
    }
}

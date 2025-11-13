package com.savvagent.sdk;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class FlagClientTest {

    private MockWebServer mockWebServer;
    private FlagClient client;

    @BeforeEach
    void setUp() throws Exception {
        mockWebServer = new MockWebServer();
        mockWebServer.start();

        FlagClientConfig config = FlagClientConfig.builder()
                .apiUrl(mockWebServer.url("/").toString())
                .sdkKey("test-sdk-key")
                .environment("test")
                .enableWebSocket(false)
                .pollingInterval(0)
                .build();

        client = new FlagClient(config);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (client != null) {
            client.close();
        }
        mockWebServer.shutdown();
    }

    @Test
    void testClientInitialization() {
        assertNotNull(client);
    }

    @Test
    void testIsEnabledReturnsTrue() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"enabled\":true,\"flagKey\":\"test-flag\"}")
                .addHeader("Content-Type", "application/json"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        boolean isEnabled = client.isEnabled("test-flag", context);

        assertTrue(isEnabled);

        RecordedRequest request = mockWebServer.takeRequest();
        assertEquals("/v1/flags/test-flag/evaluate", request.getPath());
        assertEquals("POST", request.getMethod());
        assertEquals("Bearer test-sdk-key", request.getHeader("Authorization"));
    }

    @Test
    void testIsEnabledReturnsFalse() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"enabled\":false,\"flagKey\":\"test-flag\"}")
                .addHeader("Content-Type", "application/json"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        boolean isEnabled = client.isEnabled("test-flag", context);

        assertFalse(isEnabled);
    }

    @Test
    void testIsEnabledWithAttributes() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"enabled\":true}"));

        Map<String, Object> attributes = new HashMap<>();
        attributes.put("email", "test@example.com");
        attributes.put("plan", "pro");
        attributes.put("age", 30);

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .attributes(attributes)
                .build();

        boolean isEnabled = client.isEnabled("test-flag", context);

        assertTrue(isEnabled);

        RecordedRequest request = mockWebServer.takeRequest();
        String body = request.getBody().readUtf8();

        assertTrue(body.contains("user-123"));
        assertTrue(body.contains("test@example.com"));
        assertTrue(body.contains("pro"));
    }

    @Test
    void testIsEnabledHandles404() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(404)
                .setBody("{\"error\":\"Flag not found\"}"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        assertThrows(Exception.class, () -> {
            client.isEnabled("missing-flag", context);
        });
    }

    @Test
    void testIsEnabledHandles500() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(500)
                .setBody("Internal server error"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        assertThrows(Exception.class, () -> {
            client.isEnabled("test-flag", context);
        });
    }

    @Test
    void testGetVariationReturnsStringValue() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"value\":\"dark-mode\"}"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        String value = client.getVariation("theme", context, "light");

        assertEquals("dark-mode", value);
    }

    @Test
    void testGetVariationReturnsDefaultOnError() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(500));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        String value = client.getVariation("theme", context, "light");

        assertEquals("light", value);
    }

    @Test
    void testGetVariationReturnsIntegerValue() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"value\":100}"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        Integer value = client.getVariation("max-items", context, 10);

        assertEquals(100, value);
    }

    @Test
    void testTrackEventSendsCorrectPayload() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        Map<String, Object> properties = new HashMap<>();
        properties.put("button", "checkout");
        properties.put("value", 99.99);

        client.track("button_click", context, properties);

        RecordedRequest request = mockWebServer.takeRequest();
        assertEquals("/v1/events", request.getPath());
        assertEquals("POST", request.getMethod());

        String body = request.getBody().readUtf8();
        assertTrue(body.contains("button_click"));
        assertTrue(body.contains("user-123"));
        assertTrue(body.contains("checkout"));
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
        FlagClientConfig config = FlagClientConfig.builder()
                .apiUrl("https://beta.savvagent.com")
                .sdkKey("custom-key")
                .environment("staging")
                .enableWebSocket(false)
                .pollingInterval(120000)
                .timeout(60000)
                .build();

        assertEquals("https://beta.savvagent.com", config.getApiUrl());
        assertEquals("custom-key", config.getSdkKey());
        assertEquals("staging", config.getEnvironment());
        assertFalse(config.isEnableWebSocket());
        assertEquals(120000, config.getPollingInterval());
        assertEquals(60000, config.getTimeout());
    }

    @Test
    void testConfigDefaults() {
        FlagClientConfig config = FlagClientConfig.builder()
                .sdkKey("test-key")
                .build();

        assertNotNull(config.getApiUrl());
        assertEquals("production", config.getEnvironment());
        assertTrue(config.isEnableWebSocket());
        assertTrue(config.getPollingInterval() > 0);
    }

    @Test
    void testMultipleSequentialRequests() throws Exception {
        // Queue multiple responses
        for (int i = 0; i < 3; i++) {
            mockWebServer.enqueue(new MockResponse()
                    .setResponseCode(200)
                    .setBody("{\"enabled\":true}"));
        }

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        boolean result1 = client.isEnabled("flag1", context);
        boolean result2 = client.isEnabled("flag2", context);
        boolean result3 = client.isEnabled("flag3", context);

        assertTrue(result1);
        assertTrue(result2);
        assertTrue(result3);

        assertEquals(3, mockWebServer.getRequestCount());
    }

    @Test
    void testClientCleanup() {
        FlagClientConfig config = FlagClientConfig.builder()
                .apiUrl(mockWebServer.url("/").toString())
                .sdkKey("test-key")
                .enableWebSocket(false)
                .pollingInterval(0)
                .build();

        FlagClient testClient = new FlagClient(config);

        assertNotNull(testClient);

        // Should not throw
        assertDoesNotThrow(() -> testClient.close());
        assertDoesNotThrow(() -> testClient.close()); // Multiple closes should be safe
    }

    @Test
    void testInvalidJSON() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("invalid json"));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        assertThrows(Exception.class, () -> {
            client.isEnabled("test-flag", context);
        });
    }

    @Test
    void testEmptyResponse() throws Exception {
        mockWebServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody(""));

        FlagContext context = FlagContext.builder()
                .userId("user-123")
                .build();

        assertThrows(Exception.class, () -> {
            client.isEnabled("test-flag", context);
        });
    }
}

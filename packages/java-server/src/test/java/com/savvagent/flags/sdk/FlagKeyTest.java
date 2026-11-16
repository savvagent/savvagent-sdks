package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** Flag keys that cannot be a single URL path segment must never reach the network (#107). */
class FlagKeyTest {
    private MockWebServer server;
    private AtomicInteger errors;
    private FlagClient client;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        errors = new AtomicInteger();
        Map<String, Boolean> defaults = new HashMap<>();
        defaults.put("a/b", true);
        defaults.put("new-checkout.v2_b", false);
        FlagClientConfig config = FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(defaults)
                .onError(e -> errors.incrementAndGet())
                .build();
        client = new FlagClient(config);
    }

    @AfterEach
    void tearDown() throws Exception {
        client.close();
        server.shutdown();
    }

    @ParameterizedTest
    @ValueSource(strings = {"a/b", "a?b", "a#b", ".", "..", "", "bad key"})
    void invalidKeyMakesNoRequestAndReturnsDefault(String key) {
        assertInvalid(key);
    }

    @Test
    void overlongKeyMakesNoRequestAndReturnsDefault() {
        assertInvalid("a".repeat(129));
    }

    @Test
    void nullKeyMakesNoRequestAndReturnsDefault() {
        assertInvalid(null);
    }

    @Test
    void invalidKeyUsesConfiguredDefault() {
        FlagEvaluationResult result = client.evaluate("a/b", null);
        assertTrue(result.getValue());
        assertEquals("error", result.getReason());
    }

    @Test
    void validKeyUsesTheDocumentedPath() throws Exception {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"enabled\":true}"));
        FlagEvaluationResult result = client.evaluate("new-checkout.v2_b", null);
        RecordedRequest request = server.takeRequest(5, TimeUnit.SECONDS);
        assertEquals("/api/flags/new-checkout.v2_b/evaluate", request.getPath());
        assertTrue(result.getValue());
        assertEquals(0, errors.get());
    }

    @Test
    void tripleDotKeyIsValidAndMakesARequest() throws Exception {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("{\"enabled\":true}"));
        client.evaluate("...", null);
        assertEquals(1, server.getRequestCount());
    }

    private void assertInvalid(String key) {
        FlagEvaluationResult result = client.evaluate(key, null);
        assertEquals(0, server.getRequestCount());
        assertEquals("error", result.getReason());
        assertEquals(key != null && key.equals("a/b"), result.getValue());
        assertEquals(1, errors.get());
        assertFalse(key == null && result.getValue());
    }
}

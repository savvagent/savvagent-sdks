package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Result metadata carries the "version" and "scope" the server sends (#124), and nothing is
 * read from fields it never sends.
 */
class MetadataTest {
    private MockWebServer server;
    private AtomicInteger errors;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.start();
        errors = new AtomicInteger();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    private FlagClient client(boolean defaultValue) {
        Map<String, Boolean> defaults = new HashMap<>();
        defaults.put("checkout", defaultValue);
        return new FlagClient(FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(defaults)
                .onError(e -> errors.incrementAndGet())
                .build());
    }

    /** The evaluate response exactly as the server sends it. */
    private static String serverBody(boolean enabled) {
        return body(enabled, "3", "\"application\"");
    }

    private static String body(boolean enabled, String version, String scope) {
        return "{\"key\":\"checkout\",\"enabled\":" + enabled + ",\"scope\":" + scope + ","
                + "\"variation\":null,\"configuration\":null,\"timestamp\":1700000000,"
                + "\"version\":" + version + ",\"context\":{\"environment\":\"production\"}}";
    }

    private void enqueue(String body) {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(body));
    }

    @Test
    void evaluatedResultCarriesVersionAndScope() throws Exception {
        enqueue(serverBody(true));
        try (FlagClient client = client(false)) {
            FlagEvaluationResult result = client.evaluate("checkout", null);
            assertTrue(result.getValue());
            assertEquals("evaluated", result.getReason());
            FlagEvaluationResult.Metadata metadata = result.getMetadata();
            assertNotNull(metadata);
            assertEquals(Long.valueOf(3L), metadata.getVersion());
            assertEquals("application", metadata.getScope());
            assertNull(metadata.getFlagId());
            assertNull(metadata.getDescription());
            assertNull(metadata.getVariant());
            assertEquals(0, errors.get());
        }
    }

    @Test
    void cachedResultCarriesTheSameVersionAndScope() throws Exception {
        enqueue(serverBody(true));
        try (FlagClient client = client(false)) {
            client.evaluate("checkout", null);
            FlagEvaluationResult cached = client.evaluate("checkout", null);
            assertEquals("cached", cached.getReason());
            assertEquals(1, server.getRequestCount());
            FlagEvaluationResult.Metadata metadata = cached.getMetadata();
            assertNotNull(metadata);
            assertEquals(Long.valueOf(3L), metadata.getVersion());
            assertEquals("application", metadata.getScope());
            assertNull(metadata.getFlagId());
            assertNull(metadata.getDescription());
            assertNull(metadata.getVariant());
        }
    }

    @Test
    void stringVersionAndNumericScopeAreUnsetWithoutFailingTheLookup() throws Exception {
        enqueue(body(true, "\"3\"", "7"));
        try (FlagClient client = client(false)) {
            FlagEvaluationResult result = client.evaluate("checkout", null);
            assertTrue(result.getValue());
            assertEquals("evaluated", result.getReason());
            assertNull(result.getMetadata().getVersion());
            assertNull(result.getMetadata().getScope());
            assertEquals(0, errors.get());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"true", "1.5", "null", "{}", "[3]", "1e30"})
    void nonIntegralVersionIsUnset(String version) throws Exception {
        enqueue(body(true, version, "\"application\""));
        try (FlagClient client = client(false)) {
            FlagEvaluationResult result = client.evaluate("checkout", null);
            assertTrue(result.getValue());
            assertEquals("evaluated", result.getReason());
            assertNull(result.getMetadata().getVersion());
            assertEquals("application", result.getMetadata().getScope());
            assertEquals(0, errors.get());
        }
    }

    @Test
    void malformedOldFieldsDoNotFailTheLookup() throws Exception {
        enqueue("{\"key\":\"checkout\",\"enabled\":true,\"flagId\":{},\"description\":[1],"
                + "\"variant\":7,\"version\":3,\"scope\":\"application\"}");
        try (FlagClient client = client(false)) {
            FlagEvaluationResult result = client.evaluate("checkout", null);
            assertTrue(result.getValue());
            assertEquals("evaluated", result.getReason());
            assertNull(result.getMetadata().getFlagId());
            assertNull(result.getMetadata().getDescription());
            assertNull(result.getMetadata().getVariant());
            assertEquals(Long.valueOf(3L), result.getMetadata().getVersion());
            assertEquals(0, errors.get());
        }
    }
}

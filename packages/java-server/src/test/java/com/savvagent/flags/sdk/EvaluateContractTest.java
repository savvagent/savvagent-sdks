package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The evaluate call follows docs/SDK-DEVELOPER-GUIDE.md (#112): POST /api/flags/{key}/evaluate,
 * with the result in "enabled", and "variation"/"configuration" sent as null when absent.
 */
class EvaluateContractTest {
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
        return "{\"key\":\"checkout\",\"enabled\":" + enabled + ",\"scope\":\"application\","
                + "\"variation\":null,\"configuration\":null,\"timestamp\":1700000000,"
                + "\"version\":3,\"context\":{\"environment\":\"production\"}}";
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void readsEnabledFromTheDocumentedPath(boolean enabled) throws Exception {
        server.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(serverBody(enabled)));
        try (FlagClient client = client(!enabled)) {
            FlagEvaluationResult result = client.evaluate("checkout", null);
            RecordedRequest request = server.takeRequest(5, TimeUnit.SECONDS);
            assertEquals("POST", request.getMethod());
            assertEquals("/api/flags/checkout/evaluate", request.getPath());
            assertEquals(enabled, result.getValue());
            assertEquals("evaluated", result.getReason());
            assertNull(result.getVariation());
            assertNull(result.getConfiguration());
            assertEquals(0, errors.get());
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{\"value\":true}",
        "{\"enabled\":null}",
        "{\"enabled\":\"true\"}",
        "{\"enabled\":1}",
        "null"
    })
    void bodyWithoutBooleanEnabledIsAFailedLookup(String body) throws Exception {
        for (int i = 0; i < 2; i++) {
            server.enqueue(new MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody(body));
        }
        try (FlagClient client = client(false)) {
            FlagEvaluationResult first = client.evaluate("checkout", null);
            FlagEvaluationResult second = client.evaluate("checkout", null);
            assertFalse(first.getValue());
            assertEquals("error", first.getReason());
            assertEquals("error", second.getReason());
            assertEquals(2, errors.get());
            // Not cached: the second lookup asks the server again.
            assertEquals(2, server.getRequestCount());
        }
    }
}

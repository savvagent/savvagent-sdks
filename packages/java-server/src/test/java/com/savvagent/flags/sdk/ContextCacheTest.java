package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Evaluations are cached per flag and per context (#127): the server's answer depends on the
 * context, so a result is reused only for the context that produced it.
 */
class ContextCacheTest {
    private MockWebServer server;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        // The server answers by the request body: user "a" and plan "pro" get true.
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                JsonObject body = new Gson().fromJson(request.getBody().readUtf8(), JsonObject.class);
                JsonObject context = body.getAsJsonObject("context");
                boolean enabled = false;
                JsonElement userId = context.get("userId");
                if (userId != null && userId.getAsString().equals("a")) {
                    enabled = true;
                }
                JsonObject attributes = context.has("attributes")
                        ? context.getAsJsonObject("attributes") : null;
                JsonElement plan = attributes == null ? null : attributes.get("plan");
                if (plan != null && plan.getAsString().equals("pro")) {
                    enabled = true;
                }
                return new MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setBody("{\"key\":\"checkout\",\"enabled\":" + enabled
                                + ",\"variation\":null,\"configuration\":null}");
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    private FlagClient client(int maxContextsPerFlag) {
        return new FlagClient(FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(new HashMap<>())
                .build(), maxContextsPerFlag);
    }

    private static FlagContext user(String userId) {
        FlagContext context = new FlagContext();
        context.setUserId(userId);
        return context;
    }

    private static void assertResult(FlagEvaluationResult result, boolean value, String reason) {
        assertEquals(value, result.getValue());
        assertEquals(reason, result.getReason());
    }

    @Test
    void eachUserGetsTheirOwnCachedResult() {
        try (FlagClient client = client(FlagClient.MAX_CONTEXTS_PER_FLAG)) {
            assertResult(client.evaluate("checkout", user("a")), true, "evaluated");
            assertResult(client.evaluate("checkout", user("b")), false, "evaluated");
            assertResult(client.evaluate("checkout", user("a")), true, "cached");
            assertResult(client.evaluate("checkout", user("b")), false, "cached");
            assertEquals(2, server.getRequestCount());
        }
    }

    @Test
    void contextsDifferingOnlyInAnAttributeAreCachedApart() {
        try (FlagClient client = client(FlagClient.MAX_CONTEXTS_PER_FLAG)) {
            FlagContext pro = user("u");
            pro.setAttribute("plan", "pro");
            FlagContext free = user("u");
            free.setAttribute("plan", "free");
            assertResult(client.evaluate("checkout", pro), true, "evaluated");
            assertResult(client.evaluate("checkout", free), false, "evaluated");
            assertEquals(2, server.getRequestCount());
        }
    }

    @Test
    void attributeInsertionOrderDoesNotChangeTheCacheKey() {
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("plan", "free");
        first.put("region", "eu");
        Map<String, Object> second = new LinkedHashMap<>();
        second.put("region", "eu");
        second.put("plan", "free");
        FlagContext one = user("u");
        one.setAttributes(first);
        FlagContext two = user("u");
        two.setAttributes(second);

        try (FlagClient client = client(FlagClient.MAX_CONTEXTS_PER_FLAG)) {
            assertResult(client.evaluate("checkout", one), false, "evaluated");
            assertResult(client.evaluate("checkout", two), false, "cached");
            assertEquals(1, server.getRequestCount());
        }
    }

    @Test
    void invalidatingAFlagDropsEveryContext() {
        try (FlagClient client = client(FlagClient.MAX_CONTEXTS_PER_FLAG)) {
            client.evaluate("checkout", user("a"));
            client.evaluate("checkout", user("b"));
            client.invalidateCache("checkout");
            assertResult(client.evaluate("checkout", user("a")), true, "evaluated");
            assertResult(client.evaluate("checkout", user("b")), false, "evaluated");
            assertEquals(4, server.getRequestCount());
        }
    }

    @Test
    void contextsPerFlagAreBounded() {
        int bound = 4;
        try (FlagClient client = client(bound)) {
            for (int i = 0; i < 10; i++) {
                client.evaluate("checkout", user("user-" + i));
                assertTrue(client.cachedContextCount("checkout") <= bound);
            }
            assertEquals(10, server.getRequestCount());
            // The newest entry is retrievable.
            assertResult(client.evaluate("checkout", user("user-9")), false, "cached");
            assertEquals(10, server.getRequestCount());
            assertFalse(client.cachedContextCount("checkout") > bound);
        }
    }
}

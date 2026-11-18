package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * {@code isEnabledCached} (#31): the unexpired cached value for the flag and context, else the
 * configured default, and never a request.
 */
class CachedReadTest {
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

    private FlagClient client(Map<String, Boolean> defaults, long ttl, String applicationId) {
        return new FlagClient(FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString())
                .enableRealtime(false)
                .applicationId(applicationId)
                .cacheTtl(ttl)
                .defaults(defaults)
                .onError(e -> errors.incrementAndGet())
                .build());
    }

    private void enqueueEnabled(boolean enabled) {
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
                .setBody("{\"enabled\":" + enabled + ",\"configuration\":null,\"variation\":null}"));
    }

    private static FlagContext user(String id) {
        return FlagContext.builder().userId(id).build();
    }

    @Test
    void missReturnsTheDefaultWithoutARequest() {
        try (FlagClient client = client(Collections.singletonMap("on-by-default", true), 60_000, "")) {
            assertTrue(client.isEnabledCached("on-by-default", user("u")));
            assertTrue(client.isEnabledCached("on-by-default"));
            assertFalse(client.isEnabledCached("unlisted", user("u")));
            assertFalse(client.isEnabledCached("unlisted"));
        }
        assertEquals(0, server.getRequestCount());
        assertEquals(0, errors.get());
    }

    @Test
    void hitReturnsTheCachedValueNotTheDefault() {
        enqueueEnabled(false);
        try (FlagClient client = client(Collections.singletonMap("checkout", true), 60_000, "")) {
            assertFalse(client.isEnabled("checkout", user("a")));
            assertEquals(1, server.getRequestCount());
            assertFalse(client.isEnabledCached("checkout", user("a")));
            // Another context was never looked up: its default.
            assertTrue(client.isEnabledCached("checkout", user("b")));
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void keyMatchesEvaluateIncludingTheConfiguredApplicationIdAndAttributeOrder() {
        enqueueEnabled(true);
        try (FlagClient client = client(new HashMap<>(), 60_000, "app-1")) {
            Map<String, Object> first = new LinkedHashMap<>();
            first.put("plan", "pro");
            first.put("region", "eu");
            assertTrue(client.isEnabled("checkout",
                    FlagContext.builder().userId("a").attributes(first).build()));

            Map<String, Object> second = new LinkedHashMap<>();
            second.put("region", "eu");
            second.put("plan", "pro");
            FlagContext same = FlagContext.builder().userId("a").attributes(second).build();
            assertTrue(client.isEnabledCached("checkout", same));
            // The cached read fills in the application id for the key, but leaves the caller's
            // context alone.
            assertNull(same.getApplicationId());

            // An explicit, matching application id is the same context.
            assertTrue(client.isEnabledCached("checkout",
                    FlagContext.builder().userId("a").applicationId("app-1").attributes(second).build()));
            // A different application id is not.
            assertFalse(client.isEnabledCached("checkout",
                    FlagContext.builder().userId("a").applicationId("app-2").attributes(second).build()));
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void nullContextMatchesAnEmptyContext() {
        enqueueEnabled(true);
        try (FlagClient client = client(new HashMap<>(), 60_000, "app-1")) {
            assertTrue(client.isEnabled("checkout"));
            assertTrue(client.isEnabledCached("checkout"));
            assertTrue(client.isEnabledCached("checkout", new FlagContext()));
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void expiredEntryIsAMiss() throws Exception {
        enqueueEnabled(true);
        try (FlagClient client = client(new HashMap<>(), 50, "")) {
            assertTrue(client.isEnabled("checkout", user("a")));
            assertTrue(client.isEnabledCached("checkout", user("a")));
            Thread.sleep(120);
            assertFalse(client.isEnabledCached("checkout", user("a")));
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void invalidatedEntryIsAMiss() {
        enqueueEnabled(true);
        try (FlagClient client = client(new HashMap<>(), 60_000, "")) {
            assertTrue(client.isEnabled("checkout", user("a")));
            client.invalidateCache("checkout");
            assertFalse(client.isEnabledCached("checkout", user("a")));
        }
        assertEquals(1, server.getRequestCount());
    }

    @Test
    void failedLookupIsNotCached() {
        server.enqueue(new MockResponse().setResponseCode(500));
        try (FlagClient client = client(new HashMap<>(), 60_000, "")) {
            assertFalse(client.isEnabled("checkout", user("a")));
            assertFalse(client.isEnabledCached("checkout", user("a")));
        }
        assertEquals(1, errors.get());
    }

    @Test
    void invalidFlagKeyGetsItsDefaultQuietly() {
        try (FlagClient client = client(Collections.singletonMap("bad/key", true), 60_000, "")) {
            assertTrue(client.isEnabledCached("bad/key", user("a")));
            assertFalse(client.isEnabledCached("..", user("a")));
            assertFalse(client.isEnabledCached(null, user("a")));
        }
        assertEquals(0, server.getRequestCount());
        assertEquals(0, errors.get());
    }

    @Test
    void overridesDoNotChangeTheValue() {
        enqueueEnabled(true);
        try (FlagClient client = client(new HashMap<>(), 60_000, "")) {
            assertTrue(client.isEnabled("checkout", user("a")));
            client.setVariationOverride("other", "b");
            assertTrue(client.isEnabledCached("checkout", user("a")));
        }
    }
}

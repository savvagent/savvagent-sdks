package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The cache is keyed by the SHA-256 digest of the context, never the context itself, and holds
 * one total number of entries across every flag, evicted least recently used (#30).
 */
class CacheDigestTest {
    private MockWebServer server;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                return new MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setBody("{\"enabled\":true}");
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    private FlagClient client(int maxCacheEntries) {
        return new FlagClient(FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(new HashMap<>())
                .build(), maxCacheEntries);
    }

    private static FlagContext user(String userId) {
        FlagContext context = new FlagContext();
        context.setUserId(userId);
        return context;
    }

    private static String sha256Hex(String s) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    private static void assertReason(FlagEvaluationResult result, String reason) {
        assertEquals(reason, result.getReason());
    }

    @Test
    void cacheKeyIsTheSha256DigestOfTheCanonicalContext() throws Exception {
        String userId = "alice-raw-user-id";
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("plan", "pro");
        first.put("region", "eu");
        Map<String, Object> second = new LinkedHashMap<>();
        second.put("region", "eu");
        second.put("plan", "pro");
        FlagContext one = user(userId);
        one.setAttributes(first);
        FlagContext two = user(userId);
        two.setAttributes(second);

        try (FlagClient client = client(FlagClient.MAX_CACHE_ENTRIES)) {
            assertReason(client.evaluate("checkout", one), "evaluated");
            // The canonical JSON of the context, keys sorted at every level, pinned to today's
            // bytes; the cache key is its lowercase hex SHA-256.
            String canonical = "{\"attributes\":{\"plan\":\"pro\",\"region\":\"eu\"},"
                    + "\"userId\":\"alice-raw-user-id\"}";
            assertEquals(Set.of(sha256Hex(canonical)), client.cachedContextKeys("checkout"));

            // An equal context with its keys in another order shares the entry.
            assertReason(client.evaluate("checkout", two), "cached");
            assertEquals(1, client.cachedEntryCount());

            // A different context gets its own entry.
            assertReason(client.evaluate("checkout", user("bob-raw-user-id")), "evaluated");
            assertEquals(2, client.cachedEntryCount());
            assertEquals(2, server.getRequestCount());

            for (String key : client.cachedContextKeys("checkout")) {
                assertTrue(key.matches("[0-9a-f]{64}"), key + " is not lowercase SHA-256 hex");
                assertFalse(key.contains("raw-user-id"), key + " holds the raw user id");
            }
            for (String key : client.cachedKeyStrings()) {
                assertFalse(key.contains("raw-user-id"), key + " holds the raw user id");
            }
            // The request body still carries the full context.
            String body = server.takeRequest().getBody().readUtf8();
            assertTrue(body.contains(userId), body);
        }
    }

    @Test
    void totalBoundAcrossFlagsEvictsTheLeastRecentlyUsed() {
        int bound = 4;
        String[] flags = {"checkout", "banner", "search"};
        try (FlagClient client = client(bound)) {
            for (int i = 0; i < 12; i++) {
                client.evaluate(flags[i % flags.length], user("user-" + i));
                assertTrue(client.cachedEntryCount() <= bound,
                        "after " + (i + 1) + " inserts " + client.cachedEntryCount() + " held");
            }
            assertEquals(12, server.getRequestCount());
            // The four newest are cached; the oldest are gone.
            for (int i = 8; i < 12; i++) {
                assertTrue(client.isCached(flags[i % flags.length], user("user-" + i)),
                        "user-" + i + " was evicted");
            }
            for (int i = 0; i < 8; i++) {
                assertFalse(client.isCached(flags[i % flags.length], user("user-" + i)),
                        "user-" + i + " survived");
            }
        }
        assertEquals(10_000, FlagClient.MAX_CACHE_ENTRIES);
    }

    @Test
    void aCacheHitRefreshesRecency() {
        try (FlagClient client = client(3)) {
            client.evaluate("checkout", user("a"));
            client.evaluate("banner", user("b"));
            client.evaluate("checkout", user("c"));
            assertReason(client.evaluate("checkout", user("a")), "cached");
            client.evaluate("search", user("d"));

            assertTrue(client.isCached("checkout", user("a")), "the entry just read was evicted");
            assertFalse(client.isCached("banner", user("b")), "the least recently used survived");
            assertTrue(client.isCached("checkout", user("c")));
            assertTrue(client.isCached("search", user("d")));
            assertEquals(3, client.cachedEntryCount());
        }
    }

    @Test
    void invalidatingAFlagLeavesOtherFlagsUnderTheTotalBound() {
        try (FlagClient client = client(4)) {
            client.evaluate("checkout", user("a"));
            client.evaluate("checkout", user("b"));
            client.evaluate("banner", user("a"));
            client.evaluate("banner", user("b"));
            client.invalidateCache("checkout");

            assertEquals(0, client.cachedContextCount("checkout"));
            assertEquals(2, client.cachedContextCount("banner"));
            assertEquals(2, client.cachedEntryCount());

            // The freed room is reused without evicting banner.
            client.evaluate("search", user("a"));
            client.evaluate("search", user("b"));
            assertTrue(client.isCached("banner", user("a")));
            assertTrue(client.isCached("banner", user("b")));
            assertEquals(4, client.cachedEntryCount());
        }
    }
}

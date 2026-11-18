package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** An evaluate in flight when its flag is invalidated must not cache its stale result (#137). */
class InFlightInvalidationTest {
    private MockWebServer server;
    private final AtomicInteger requests = new AtomicInteger();
    private final AtomicReference<FlagClient> client = new AtomicReference<>();
    private volatile String invalidateOnFirstRequest;
    /** When set, runs on the first request instead of {@link #invalidateOnFirstRequest}. */
    private volatile Runnable onFirstRequest;

    @BeforeEach
    void setUp() throws Exception {
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                int n = requests.incrementAndGet();
                if (n == 1 && onFirstRequest != null) {
                    onFirstRequest.run();
                } else if (n == 1 && invalidateOnFirstRequest != null) {
                    // The kill switch flips while this (stale) request is in flight.
                    client.get().invalidateCache(invalidateOnFirstRequest);
                }
                return new MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setBody("{\"key\":\"checkout\",\"enabled\":" + (n == 1)
                                + ",\"variation\":null,\"configuration\":null}");
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() throws Exception {
        server.shutdown();
    }

    private FlagClient newClient() {
        FlagClient created = new FlagClient(FlagClientConfig.builder("sdk_test")
                .baseUrl(server.url("/").toString().replaceAll("/$", ""))
                .enableRealtime(false)
                .enableTelemetry(false)
                .defaults(new HashMap<>())
                .build());
        client.set(created);
        return created;
    }

    private static FlagContext user(String userId) {
        FlagContext context = new FlagContext();
        context.setUserId(userId);
        return context;
    }

    @Test
    void invalidationDuringTheRequestDropsTheCacheWrite() {
        invalidateOnFirstRequest = "checkout";
        try (FlagClient c = newClient()) {
            assertTrue(c.evaluate("checkout", user("a")).getValue());
            FlagEvaluationResult second = c.evaluate("checkout", user("a"));
            assertEquals("evaluated", second.getReason());
            assertFalse(second.getValue());
            assertEquals(2, server.getRequestCount());
        }
    }

    @Test
    void invalidatingAnotherFlagKeepsTheCacheWrite() {
        invalidateOnFirstRequest = "other";
        try (FlagClient c = newClient()) {
            c.evaluate("checkout", user("a"));
            assertEquals("cached", c.evaluate("checkout", user("a")).getReason());
            assertEquals(1, server.getRequestCount());
        }
    }

    @Test
    void generationsAreBoundedAndTheGuardHoldsAcrossTheReset() {
        try (FlagClient c = newClient()) {
            c.maxGenerations = 3; // set before any other thread touches the client
            // "checkout" has been invalidated once, so the request below reads generation 1.
            c.invalidateCache("checkout");
            AtomicInteger mostCounters = new AtomicInteger();
            onFirstRequest = () -> {
                // While the request is in flight, enough other flags are invalidated to reset
                // the counters, and then "checkout" is invalidated again, back to 1.
                for (int i = 0; i < 10; i++) {
                    c.invalidateCache("other-" + i);
                    mostCounters.accumulateAndGet(c.generationCount(), Math::max);
                }
                c.invalidateCache("checkout");
            };
            assertTrue(c.evaluate("checkout", user("a")).getValue());
            // The stale write was dropped: the next read goes to the server again.
            assertEquals("evaluated", c.evaluate("checkout", user("a")).getReason());
            assertEquals(2, server.getRequestCount());
            assertTrue(mostCounters.get() <= 3,
                    "generations held " + mostCounters.get() + " counters, cap is 3");
        }
    }

    @Test
    void defaultGenerationCapIsTenThousand() {
        assertEquals(10_000, FlagClient.MAX_GENERATIONS);
    }
}

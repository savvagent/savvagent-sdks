package com.savvagent.flags.sdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.IntFunction;
import okhttp3.HttpUrl;
import okhttp3.mockwebserver.Dispatcher;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.ThrowingSupplier;

/**
 * The flag-change stream against a test server speaking the documented contract
 * (docs/SDK-DEVELOPER-GUIDE.md, Real-time Updates): GET /api/flags/stream with the client's key,
 * connected on every connect, flag.* events naming the changed flag (#167).
 *
 * <p>A stream response that must wait for the test blocks in the dispatcher on a latch (bounded,
 * and released in {@link #tearDown()}), so its headers and events arrive only when the test says.
 * Every timing is a small injected {@link RealtimeStream.Options}: nothing waits for seconds.
 */
class RealtimeStreamTest {
    private static final String KEY = "sdk_test_key";
    private static final long LONG_TTL = 600_000L;

    private MockWebServer server;
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicInteger streams = new AtomicInteger();
    private final List<RecordedRequest> streamRequests = new CopyOnWriteArrayList<>();
    private final List<CountDownLatch> latches = new CopyOnWriteArrayList<>();
    private final List<FlagClient> clients = new CopyOnWriteArrayList<>();
    private final List<Exception> errors = new CopyOnWriteArrayList<>();
    /** The path prefix the stream is served under. */
    private volatile String prefix = "";
    /** Answers stream request number n (from 1). */
    private volatile IntFunction<MockResponse> stream = n -> hold();

    @BeforeEach
    void setUp() throws IOException {
        server = new MockWebServer();
        server.setDispatcher(new Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
                HttpUrl url = request.getRequestUrl();
                String path = url == null ? "" : url.encodedPath();
                if ("GET".equals(request.getMethod())
                        && path.equals(prefix + "/api/flags/stream")) {
                    streamRequests.add(request);
                    return stream.apply(streams.incrementAndGet());
                }
                return new MockResponse()
                        .setHeader("Content-Type", "application/json")
                        .setBody("{\"key\":\"f\",\"enabled\":" + enabled.get()
                                + ",\"variation\":null,\"configuration\":null}");
            }
        });
        server.start();
    }

    @AfterEach
    void tearDown() throws IOException {
        // Clients first, so held streams end; then the latches, so no dispatcher thread is left
        // blocked when the server waits for its threads.
        for (FlagClient client : clients) {
            client.close();
        }
        for (CountDownLatch latch : latches) {
            while (latch.getCount() > 0) {
                latch.countDown();
            }
        }
        server.shutdown();
    }

    // ---- helpers ----------------------------------------------------------------------------

    private static RealtimeStream.Options options(long readTimeoutMillis, long maxRetryAfterMillis) {
        return new RealtimeStream.Options(5L, 20L, 20L, maxRetryAfterMillis, 30_000L, 5L,
                readTimeoutMillis, () -> 0.5);
    }

    private static RealtimeStream.Options testOptions() {
        return options(5_000L, 20L);
    }

    private String baseUrl() {
        return server.url("/").toString().replaceAll("/$", "");
    }

    private FlagClient client(String baseUrl, long ttl, boolean realtime,
            RealtimeStream.Options options) {
        Consumer<Exception> onError = errors::add;
        FlagClient created = new FlagClient(FlagClientConfig.builder(KEY)
                .baseUrl(baseUrl)
                .enableRealtime(realtime)
                .enableTelemetry(false)
                .cacheTtl(ttl)
                .defaults(new HashMap<>())
                .onError(onError)
                .build(), FlagClient.MAX_CONTEXTS_PER_FLAG, options);
        clients.add(created);
        return created;
    }

    private FlagClient client() {
        return client(baseUrl(), LONG_TTL, true, testOptions());
    }

    private CountDownLatch latch() {
        CountDownLatch latch = new CountDownLatch(1);
        latches.add(latch);
        return latch;
    }

    /** Waits (bounded) for the test to release {@code latch}; false if it never did. */
    private static boolean await(CountDownLatch latch) {
        try {
            return latch.await(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** An event stream whose body is {@code body}; the stream ends after it. */
    private static MockResponse events(String body) {
        return new MockResponse()
                .setHeader("Content-Type", "text/event-stream")
                .setBody(body);
    }

    /** Holds the request without answering until the client goes away. */
    private static MockResponse hold() {
        return new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE);
    }

    private static String reason(FlagClient client, String flag) {
        return client.evaluate(flag, null).getReason();
    }

    /** Polls {@code condition} every 5 ms and fails if it is not true within 3 s. */
    private static void waitFor(String what, BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                fail("timed out waiting for " + what);
            }
            Thread.sleep(5);
        }
    }

    // ---- against the server -----------------------------------------------------------------

    @Test
    void anUpdateEventDropsTheCachedEvaluation() throws Exception {
        CountDownLatch release = latch();
        // No connected event: it would clear the cache by itself and prove nothing.
        stream = n -> n == 1 && await(release)
                ? events("event: flag.updated\ndata: {\"key\":\"f\",\"version\":4}\n\n")
                : hold();
        FlagClient c = client();
        waitFor("the stream request", () -> streams.get() >= 1);

        assertEquals("evaluated", reason(c, "f"));
        assertEquals("cached", reason(c, "f"));
        enabled.set(false);
        release.countDown();

        // The event, not the TTL, ended the cache entry.
        waitFor("a fresh false after the event", () -> {
            FlagEvaluationResult result = c.evaluate("f", null);
            return !result.getValue() && "evaluated".equals(result.getReason());
        });
    }

    @Test
    void aDroppedStreamReconnectsAndConnectedClearsTheCache() throws Exception {
        CountDownLatch release1 = latch();
        CountDownLatch release2 = latch();
        stream = n -> {
            if (n == 1) {
                // Ends after the event, so the client must reconnect.
                return await(release1) ? events("event: connected\ndata: {}\n\n") : hold();
            }
            if (n == 2) {
                return await(release2) ? events("event: connected\ndata: {}\n\n") : hold();
            }
            return hold();
        };
        FlagClient c = client();
        waitFor("the stream request", () -> streams.get() >= 1);

        assertEquals("evaluated", reason(c, "g"));
        assertEquals("cached", reason(c, "g"));
        release1.countDown();
        waitFor("a second stream request", () -> streams.get() >= 2);

        // The first stream was read to its end before the client reconnected, so its connected
        // event has cleared the cache.
        assertEquals("evaluated", reason(c, "g"));
        assertEquals("cached", reason(c, "g"));

        // The reconnected stream's connected event clears it again.
        release2.countDown();
        waitFor("the reconnected stream to clear the cache",
                () -> "evaluated".equals(reason(c, "g")));
    }

    @Test
    void lookupsAreServedAndExpireByTtlWhileTheStreamIsRefused() throws Exception {
        stream = n -> new MockResponse().setResponseCode(503);
        FlagClient c = client(baseUrl(), 250L, true, testOptions());

        assertEquals("evaluated", reason(c, "f"));
        assertEquals("cached", reason(c, "f"));
        Thread.sleep(300);
        assertEquals("evaluated", reason(c, "f"));
        assertTrue(c.isEnabled("f"));

        // The refused stream is retried, and each refusal is reported without the key.
        waitFor("the refused stream to be retried", () -> streams.get() >= 2);
        assertFalse(errors.isEmpty(), "a refused stream was not reported to onError");
        for (Exception error : errors) {
            assertTrue(error.getMessage().contains("503"), error.getMessage());
            assertFalse(error.getMessage().contains(KEY), "onError carries the key");
        }
    }

    @Test
    void noStreamWhenRealtimeIsOff() throws Exception {
        stream = n -> events("event: connected\ndata: {}\n\n");
        FlagClient c = client(baseUrl(), LONG_TTL, false, testOptions());

        assertNull(c.realtimeStream());
        assertEquals("evaluated", reason(c, "f"));
        Thread.sleep(50);
        assertEquals(0, streams.get());
    }

    @Test
    void realtimeIsOnByDefault() throws Exception {
        FlagClientConfig config = FlagClientConfig.builder(KEY)
                .baseUrl(baseUrl())
                .enableTelemetry(false)
                .onError(errors::add)
                .build();
        assertTrue(config.isEnableRealtime());

        FlagClient c = new FlagClient(config);
        clients.add(c);
        assertNotNull(c.realtimeStream());
        waitFor("the stream request", () -> streams.get() >= 1);
    }

    @Test
    void aLookupDoesNotWaitForTheStream() throws Exception {
        // Never answered: the client is still waiting for the headers.
        stream = n -> hold();
        FlagClient c = client();
        waitFor("the stream request", () -> streams.get() >= 1);

        ThrowingSupplier<FlagEvaluationResult> lookup = () -> c.evaluate("f", null);
        FlagEvaluationResult result = assertTimeoutPreemptively(Duration.ofSeconds(2), lookup,
                "the lookup waited on the stream");
        assertEquals("evaluated", result.getReason());
        assertTrue(result.getValue());
    }

    @Test
    void theRequestCarriesTheKeyInTheHeaderOnlyAndNoQuery() throws Exception {
        prefix = "/prefix";
        stream = n -> hold();
        // The base URL's path prefix is kept, its trailing slash absorbed, its query dropped.
        client(server.url("/prefix/?x=1").toString(), LONG_TTL, true, testOptions());
        waitFor("the stream request", () -> streams.get() >= 1);

        for (RecordedRequest request : streamRequests) {
            assertEquals("/prefix/api/flags/stream", request.getPath());
            assertEquals("Bearer " + KEY, request.getHeader("Authorization"));
            String accept = request.getHeader("Accept");
            assertTrue(accept != null && accept.contains("text/event-stream"), accept);
        }
    }

    @Test
    void eventsForOtherFlagsOrWithInvalidKeysLeaveThisOneCached() throws Exception {
        CountDownLatch release = latch();
        // Events are applied in order, so once the last one (sentinel) has been, so have the
        // others.
        stream = n -> n == 1 && await(release)
                ? events("event: flag.deleted\ndata: {\"key\":\"other\"}\n\n"
                        + "event: flag.updated\ndata: {\"key\":\"a/b\"}\n\n"
                        + "event: flag.updated\ndata: {\"key\":\"\"}\n\n"
                        + "event: flag.updated\ndata: not json\n\n"
                        + "event: flag.updated\ndata: {\"key\":5}\n\n"
                        + "event: heartbeat\ndata: {}\n\n"
                        + "data: {\"key\":\"f\"}\n\n"
                        + "event: flag.updated\ndata: {\"key\":\"sentinel\"}\n\n")
                : hold();
        FlagClient c = client();
        waitFor("the stream request", () -> streams.get() >= 1);

        assertEquals("evaluated", reason(c, "f"));
        assertEquals("evaluated", reason(c, "sentinel"));
        release.countDown();
        waitFor("the sentinel event", () -> "evaluated".equals(reason(c, "sentinel")));
        assertEquals("cached", reason(c, "f"));
    }

    @Test
    void a200ThatIsNotAnEventStreamIsNotReadAsEvents() throws Exception {
        // A proxy's page that happens to look like an event.
        stream = n -> new MockResponse()
                .setHeader("Content-Type", "text/html")
                .setBody("event: connected\ndata: {}\n\n");
        FlagClient c = client();

        assertEquals("evaluated", reason(c, "h"));
        // Request n0+1 began after the lookup and ended before request n0+2 began.
        int n0 = streams.get();
        waitFor("two more stream requests", () -> streams.get() >= n0 + 2);
        // The connected event would have cleared the cache.
        assertEquals("cached", reason(c, "h"));
        assertFalse(errors.isEmpty(), "a non-event-stream response was not reported to onError");
    }

    @Test
    void aStalledConnectIsAbandonedAndRetried() throws Exception {
        stream = n -> hold();
        client(baseUrl(), LONG_TTL, true, options(100L, 20L));
        waitFor("a retry after the read timeout", () -> streams.get() >= 2);
    }

    @Test
    void anIdleStreamIsDroppedAndReopened() throws Exception {
        // The headers arrive, then nothing for longer than the read timeout (the heartbeat
        // watchdog). The delay is short so the server's thread is free soon after.
        stream = n -> events(": heartbeat\n\n").setBodyDelay(300, TimeUnit.MILLISECONDS);
        client(baseUrl(), LONG_TTL, true, options(100L, 20L));
        waitFor("a reconnect after the read timeout", () -> streams.get() >= 2);
    }

    @Test
    void closeStopsTheStreamAndIsIdempotent() throws Exception {
        stream = n -> hold();
        FlagClient c = client();
        waitFor("the stream request", () -> streams.get() >= 1);
        RealtimeStream realtime = c.realtimeStream();
        assertNotNull(realtime);

        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> c.close());
        assertTrue(realtime.isClosed());
        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> c.close());
        Thread.sleep(100);
        assertEquals(1, streams.get());
    }

    @Test
    void closeInterruptsALongRetryWait() throws Exception {
        stream = n -> new MockResponse().setResponseCode(503).setHeader("Retry-After", "60");
        FlagClient c = client(baseUrl(), LONG_TTL, true, options(5_000L, 60_000L));
        waitFor("the refusal to be reported", () -> !errors.isEmpty());

        assertTimeoutPreemptively(Duration.ofSeconds(2), () -> c.close());
        Thread.sleep(100);
        assertEquals(1, streams.get(), "Retry-After was not honored");
    }

    @Test
    void onErrorMayCloseTheClientFromTheStreamThread() throws Exception {
        stream = n -> new MockResponse().setResponseCode(503);
        AtomicReference<FlagClient> self = new AtomicReference<>();
        FlagClient c = new FlagClient(FlagClientConfig.builder(KEY)
                .baseUrl(baseUrl())
                .enableTelemetry(false)
                .onError(e -> {
                    FlagClient current = self.get();
                    if (current != null) {
                        current.close();
                    }
                })
                .build(), FlagClient.MAX_CONTEXTS_PER_FLAG, testOptions());
        self.set(c);
        clients.add(c);
        RealtimeStream realtime = c.realtimeStream();
        assertNotNull(realtime);

        waitFor("onError to close the client", realtime::isClosed);
        int seen = streams.get();
        Thread.sleep(100);
        assertEquals(seen, streams.get());
    }

    @Test
    void aBadBaseUrlReportsAndStartsNothing() {
        FlagClient c = client("not a url", LONG_TTL, true, testOptions());
        assertNull(c.realtimeStream());
        assertEquals(1, errors.size());
        assertFalse(errors.get(0).getMessage().contains(KEY));
    }

    // ---- pure functions ---------------------------------------------------------------------

    @Test
    void reconnectDelayDoublesToTheCeilingWithJitter() {
        assertEquals(500L, RealtimeStream.reconnectDelay(1_000L, 0, 30_000L, 0.0));
        assertEquals(750L, RealtimeStream.reconnectDelay(1_000L, 0, 30_000L, 0.5));
        assertTrue(RealtimeStream.reconnectDelay(1_000L, 0, 30_000L, 0.999_999) < 1_000L);
        assertEquals(1_500L, RealtimeStream.reconnectDelay(1_000L, 1, 30_000L, 0.5));
        assertEquals(22_500L, RealtimeStream.reconnectDelay(1_000L, 5, 30_000L, 0.5));
        assertEquals(22_500L, RealtimeStream.reconnectDelay(1_000L, RealtimeStream.MAX_ATTEMPT,
                30_000L, 0.5));
        assertEquals(22_500L, RealtimeStream.reconnectDelay(1_000L, Integer.MAX_VALUE,
                30_000L, 0.5));
        // A unit out of range is clamped; NaN is 0.
        assertEquals(15_000L, RealtimeStream.reconnectDelay(1_000L, 10, 30_000L, -1.0));
        assertEquals(30_000L, RealtimeStream.reconnectDelay(1_000L, 10, 30_000L, 2.0));
        assertEquals(15_000L, RealtimeStream.reconnectDelay(1_000L, 10, 30_000L, Double.NaN));
        assertEquals(0L, RealtimeStream.reconnectDelay(0L, 3, 30_000L, 0.5));
        assertEquals(0L, RealtimeStream.reconnectDelay(1_000L, 3, 0L, 0.5));
        // A ceiling near the top of the range does not overflow.
        assertTrue(RealtimeStream.reconnectDelay(1_000L, 200, Long.MAX_VALUE, 0.5) > 0);
    }

    @Test
    void reconnectSpreadAppliesOnlyToTheFirstRetryOfAnEstablishedStream() {
        assertEquals(2_500L, RealtimeStream.reconnectSpread(5_000L, 0, true, 0.5));
        assertEquals(0L, RealtimeStream.reconnectSpread(5_000L, 1, true, 0.5));
        assertEquals(0L, RealtimeStream.reconnectSpread(5_000L, 0, false, 0.5));
        assertEquals(0L, RealtimeStream.reconnectSpread(5_000L, 0, true, Double.NaN));
        assertEquals(5_000L, RealtimeStream.reconnectSpread(5_000L, 0, true, 7.0));
    }

    @Test
    void nextDelayPicksTheCeilingAndHonorsRetryAfter() {
        RealtimeStream.Options o = new RealtimeStream.Options(1_000L, 30_000L, 300_000L,
                60_000L, 30_000L, 5_000L, 90_000L, () -> 0.5);
        RealtimeStream.End unreachable = RealtimeStream.End.UNREACHABLE;
        RealtimeStream.End refused = RealtimeStream.End.REFUSED;
        RealtimeStream.End dropped = RealtimeStream.End.DROPPED;

        assertEquals(750L, o.nextDelay(unreachable, 0, -1L, 0));
        // The first retry after a stream that was up is spread.
        assertEquals(750L + 2_500L, o.nextDelay(dropped, 0, -1L, 0));
        assertEquals(1_500L, o.nextDelay(dropped, 0, -1L, 1));
        // A refused key or a missing endpoint backs off to the longer ceiling.
        assertEquals(225_000L, o.nextDelay(refused, 401, -1L, 20));
        assertEquals(225_000L, o.nextDelay(refused, 403, -1L, 20));
        assertEquals(225_000L, o.nextDelay(refused, 404, -1L, 20));
        assertEquals(22_500L, o.nextDelay(refused, 500, -1L, 20));
        // Retry-After on 429 and 503 lengthens the wait, capped, and never shortens it.
        assertEquals(10_000L, o.nextDelay(refused, 503, 10_000L, 0));
        assertEquals(10_000L, o.nextDelay(refused, 429, 10_000L, 0));
        assertEquals(60_000L, o.nextDelay(refused, 503, 3_600_000L, 0));
        assertEquals(60_000L, o.nextDelay(refused, 503, Long.MAX_VALUE, 0));
        assertEquals(750L, o.nextDelay(refused, 503, 100L, 0));
        assertEquals(750L, o.nextDelay(refused, 500, 10_000L, 0));
    }

    @Test
    void parseRetryAfterReadsSecondsOnly() {
        assertEquals(120_000L, RealtimeStream.parseRetryAfter("120"));
        assertEquals(5_000L, RealtimeStream.parseRetryAfter(" 5 "));
        assertEquals(0L, RealtimeStream.parseRetryAfter("0"));
        assertEquals(-1L, RealtimeStream.parseRetryAfter(null));
        assertEquals(-1L, RealtimeStream.parseRetryAfter(""));
        assertEquals(-1L, RealtimeStream.parseRetryAfter("1.5"));
        assertEquals(-1L, RealtimeStream.parseRetryAfter("-1"));
        assertEquals(-1L, RealtimeStream.parseRetryAfter("+1"));
        assertEquals(-1L, RealtimeStream.parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT"));
        assertEquals(Long.MAX_VALUE, RealtimeStream.parseRetryAfter("99999999999999999999999"));
        assertEquals(Long.MAX_VALUE, RealtimeStream.parseRetryAfter("9223372036854775807"));
    }

    @Test
    void streamUrlKeepsThePrefixAndDropsTheQuery() {
        assertEquals("https://flags.example.com/api/flags/stream",
                String.valueOf(RealtimeStream.streamUrl("https://flags.example.com")));
        assertEquals("https://flags.example.com/api/flags/stream",
                String.valueOf(RealtimeStream.streamUrl("https://flags.example.com/")));
        assertEquals("https://flags.example.com/prefix/api/flags/stream",
                String.valueOf(RealtimeStream.streamUrl("https://flags.example.com/prefix")));
        assertEquals("https://flags.example.com/prefix/api/flags/stream",
                String.valueOf(RealtimeStream.streamUrl("https://flags.example.com/prefix/")));
        assertEquals("http://localhost:8080/api/flags/stream",
                String.valueOf(RealtimeStream.streamUrl("http://localhost:8080/?a=b#frag")));
        assertNull(RealtimeStream.streamUrl("not a url"));
        assertNull(RealtimeStream.streamUrl("ftp://flags.example.com"));
        assertNull(RealtimeStream.streamUrl(""));
        assertNull(RealtimeStream.streamUrl(null));
    }

    @Test
    void changedFlagKeyAcceptsOnlyAValidStringKey() {
        assertEquals("f", RealtimeStream.changedFlagKey("{\"key\":\"f\",\"version\":4}"));
        assertEquals("a.b_c-1", RealtimeStream.changedFlagKey("{\"key\":\"a.b_c-1\"}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":\"a/b\"}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":\"..\"}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":\"\"}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":5}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":null}"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":[\"f\"]}"));
        assertNull(RealtimeStream.changedFlagKey("{}"));
        assertNull(RealtimeStream.changedFlagKey("[\"f\"]"));
        assertNull(RealtimeStream.changedFlagKey("\"f\""));
        assertNull(RealtimeStream.changedFlagKey("not json"));
        assertNull(RealtimeStream.changedFlagKey("{\"key\":"));
        assertNull(RealtimeStream.changedFlagKey(""));
        assertNull(RealtimeStream.changedFlagKey(null));
    }

    @Test
    void applyEventInvalidatesOnlyWhatTheEventNames() {
        List<String> seen = new ArrayList<>();
        Consumer<String> record = seen::add;

        RealtimeStream.applyEvent("connected", "{}", record);
        assertEquals(1, seen.size());
        assertNull(seen.get(0), "connected must invalidate every flag");

        seen.clear();
        RealtimeStream.applyEvent("flag.created", "{\"key\":\"a\"}", record);
        RealtimeStream.applyEvent("flag.updated", "{\"key\":\"b\"}", record);
        RealtimeStream.applyEvent("flag.deleted", "{\"key\":\"c\"}", record);
        assertEquals(List.of("a", "b", "c"), seen);

        seen.clear();
        RealtimeStream.applyEvent("heartbeat", "{}", record);
        RealtimeStream.applyEvent("flag.archived", "{\"key\":\"a\"}", record);
        RealtimeStream.applyEvent(null, "{\"key\":\"a\"}", record);
        RealtimeStream.applyEvent("message", "{\"key\":\"a\"}", record);
        RealtimeStream.applyEvent("flag.updated", "{\"key\":\"\"}", record);
        RealtimeStream.applyEvent("flag.updated", "garbage", record);
        assertTrue(seen.isEmpty(), seen.toString());
    }
}

package com.savvagent.flags.sdk;

import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.DoubleSupplier;
import okhttp3.Dispatcher;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The flag-change stream, {@code GET /api/flags/stream} (docs/SDK-DEVELOPER-GUIDE.md, Real-time
 * Updates), which invalidates cached evaluations so a flag change, a kill switch above all,
 * reaches the client in about a round trip instead of after the cache TTL (#167).
 *
 * <p>One long-lived connection per client, read on an OkHttp dispatcher thread, until
 * {@link #close()}. A {@code flag.created}, {@code flag.updated} or {@code flag.deleted} event
 * invalidates that flag through the client's generation counters, so an evaluation in flight
 * when it arrived is not cached either (#137). Each {@code connected} event (the server sends one
 * on every connect) invalidates the whole cache: events may have been missed while the stream was
 * down, and the cache TTL bounds staleness in the meantime. Lookups never wait on the stream: it
 * only invalidates.
 *
 * <p>A dropped or refused stream is retried with exponential backoff and jitter; the attempt
 * count resets only after a connection stayed up for {@link Options#stableAfterMillis}, so a
 * server that accepts and drops at once is not retried at the base delay forever. A failed
 * connect attempt calls {@code onError} once, possibly on the stream's own threads; nothing else
 * reaches the host, and nothing is ever thrown into it. The key is sent only in the
 * {@code Authorization} header and is never put in an error or a log line.
 *
 * <p>Thread safety: the connection state and the attempt counter are guarded by {@code lock};
 * {@code closed} is volatile so callbacks of a cancelled connection see it without the lock.
 */
final class RealtimeStream implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(RealtimeStream.class);

    /** Bounds the attempt counter; the delay reaches its cap long before. */
    static final int MAX_ATTEMPT = 64;

    /** How one connection attempt ended. */
    enum End {
        /** The request failed before a response (refused, unreachable, timeout). */
        UNREACHABLE,
        /** A non-2xx status, or a 2xx that is not {@code text/event-stream}. */
        REFUSED,
        /** The stream was open, then ended (closed, broke, or went idle). */
        DROPPED
    }

    /**
     * The stream's timings. {@link FlagClient} uses {@link #defaults()}; tests pass small ones so
     * nothing waits for seconds.
     */
    static final class Options {
        /** The first retry's full delay; the wait is half of it to all of it. */
        final long baseDelayMillis;
        /** Caps the delay after a dropped stream or a transport error. */
        final long maxDelayMillis;
        /**
         * Caps the delay after a 401, 403 or 404: the key is refused or the endpoint absent, and
         * retrying fast changes nothing.
         */
        final long rejectedMaxDelayMillis;
        /** Caps how far a Retry-After can stretch one wait, so a proxy cannot hold off for hours. */
        final long maxRetryAfterMillis;
        /** How long a connection must stay up to reset the backoff. */
        final long stableAfterMillis;
        /**
         * The longest extra wait before the first retry of a stream that was up, so clients whose
         * streams one deploy dropped do not reconnect together.
         */
        final long spreadMillis;
        /**
         * The socket read timeout: it bounds the wait for the response headers and drops a
         * connection that received nothing for this long. The server sends a heartbeat every
         * 30 s; three missed ones mean the connection is dead even if the socket has not noticed.
         */
        final long readTimeoutMillis;
        /** Returns a value in [0, 1) for jitter. Must be safe for concurrent use. */
        final DoubleSupplier random;

        Options(long baseDelayMillis, long maxDelayMillis, long rejectedMaxDelayMillis,
                long maxRetryAfterMillis, long stableAfterMillis, long spreadMillis,
                long readTimeoutMillis, DoubleSupplier random) {
            this.baseDelayMillis = baseDelayMillis;
            this.maxDelayMillis = maxDelayMillis;
            this.rejectedMaxDelayMillis = rejectedMaxDelayMillis;
            this.maxRetryAfterMillis = maxRetryAfterMillis;
            this.stableAfterMillis = stableAfterMillis;
            this.spreadMillis = spreadMillis;
            this.readTimeoutMillis = readTimeoutMillis;
            this.random = random;
        }

        /** The production timings. */
        static Options defaults() {
            return new Options(1_000L, 30_000L, 300_000L, 60_000L, 30_000L, 5_000L, 90_000L,
                    () -> ThreadLocalRandom.current().nextDouble());
        }

        /**
         * The wait after a connection that ended as {@code end} before attempt {@code attempt}
         * (from 0).
         *
         * @param end how the connection ended
         * @param status the HTTP status of a refused attempt, else ignored
         * @param retryAfterMillis the parsed Retry-After of a refused attempt, or -1 when absent
         * @param attempt the attempt about to be made, from 0
         * @return the delay in milliseconds, never negative
         */
        long nextDelay(End end, int status, long retryAfterMillis, int attempt) {
            long ceiling = maxDelayMillis;
            if (end == End.REFUSED && (status == 401 || status == 403 || status == 404)) {
                ceiling = rejectedMaxDelayMillis;
            }
            long delay = reconnectDelay(baseDelayMillis, attempt, ceiling, random.getAsDouble());
            long spread = reconnectSpread(spreadMillis, attempt, end == End.DROPPED,
                    random.getAsDouble());
            delay = saturatedAdd(delay, spread);
            if (end == End.REFUSED && retryAfterMillis >= 0 && (status == 429 || status == 503)) {
                long retryAfter = Math.min(retryAfterMillis, maxRetryAfterMillis);
                delay = Math.max(delay, retryAfter);
            }
            return delay;
        }
    }

    private final Consumer<String> invalidate;
    private final Consumer<Exception> onError;
    private final Options options;
    private final Request request;
    private final EventSource.Factory factory;
    private final ExecutorService streamExecutor;
    private final ScheduledThreadPoolExecutor scheduler;

    private final Object lock = new Object();
    private volatile boolean closed;
    /** The current connection's event source. Guarded by {@code lock}. */
    private EventSource current;
    /** The next attempt's number for the backoff. Guarded by {@code lock}. */
    private int attempt;

    private RealtimeStream(HttpUrl url, FlagClientConfig config, OkHttpClient baseClient,
            Consumer<String> invalidate, Options options) {
        this.invalidate = invalidate;
        this.onError = config.getOnError();
        this.options = options;
        this.request = new Request.Builder()
                .url(url)
                .get()
                .header("Authorization", "Bearer " + config.getApiKey())
                .header("Accept", "text/event-stream")
                // Transparent gzip could hold events back behind a proxy that compresses
                // without flushing each one.
                .header("Accept-Encoding", "identity")
                .build();
        // Its own dispatcher on daemon threads: a held stream must not keep the JVM alive when
        // the host never calls close(), and the stream does not take the shared dispatcher's
        // per-host slots.
        this.streamExecutor = new ThreadPoolExecutor(0, Integer.MAX_VALUE, 60L, TimeUnit.SECONDS,
                new SynchronousQueue<>(), daemonThreads("savvagent-flags-stream-reader"));
        OkHttpClient streamClient = baseClient.newBuilder()
                .dispatcher(new Dispatcher(streamExecutor))
                .connectTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .readTimeout(options.readTimeoutMillis, TimeUnit.MILLISECONDS)
                // No total timeout, which would cut the stream off.
                .callTimeout(0L, TimeUnit.MILLISECONDS)
                // A redirect could carry the key elsewhere; a 3xx is a refused attempt.
                .followRedirects(false)
                .followSslRedirects(false)
                .build();
        this.factory = EventSources.createFactory(streamClient);
        ScheduledThreadPoolExecutor executor =
                new ScheduledThreadPoolExecutor(1, daemonThreads("savvagent-flags-stream"));
        executor.setRemoveOnCancelPolicy(true);
        executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        this.scheduler = executor;
    }

    /**
     * Starts the stream for {@code config}. Returns null, after one {@code onError} call, when
     * the base URL cannot carry the stream path. Never throws.
     *
     * @param config the client's configuration
     * @param baseClient the client's HTTP client, whose settings the stream's client derives from
     * @param invalidate invalidates one flag, or every flag when passed null
     * @param options the stream's timings
     * @return the running stream, or null when none was started
     */
    static RealtimeStream start(FlagClientConfig config, OkHttpClient baseClient,
            Consumer<String> invalidate, Options options) {
        HttpUrl url = streamUrl(config.getBaseUrl());
        if (url == null) {
            report(config.getOnError(), new IllegalArgumentException(
                    "Savvagent Flags stream: baseUrl is not an http(s) URL; real-time updates are off"));
            return null;
        }
        RealtimeStream stream = new RealtimeStream(url, config, baseClient, invalidate, options);
        stream.connect();
        return stream;
    }

    /**
     * Stops the stream: cancels the connection and any pending retry. Idempotent, never blocks,
     * and safe to call from {@code onError} on the stream's own threads.
     */
    @Override
    public void close() {
        EventSource source;
        synchronized (lock) {
            if (closed) {
                return;
            }
            closed = true;
            source = current;
            current = null;
        }
        if (source != null) {
            try {
                source.cancel();
            } catch (RuntimeException e) {
                logger.debug("Savvagent Flags stream: cancel failed: {}", e.toString());
            }
        }
        scheduler.shutdownNow();
        // Running reader tasks end once their cancelled call returns.
        streamExecutor.shutdown();
    }

    /** Whether {@link #close()} has been called. */
    boolean isClosed() {
        return closed;
    }

    /** Opens one connection. Runs at start and on the scheduler thread. */
    private void connect() {
        Connection connection = new Connection();
        synchronized (lock) {
            if (closed) {
                return;
            }
            try {
                // Enqueues the call; its callbacks run on the stream executor. A rejected
                // enqueue calls onFailure on this thread, which re-enters the lock (reentrant).
                EventSource source = factory.newEventSource(request, connection);
                if (!connection.done.get()) {
                    current = source;
                }
            } catch (RuntimeException e) {
                connection.end(End.UNREACHABLE, 0, -1L, e);
            }
        }
    }

    /** Called once per connection, when it ended. */
    private void ended(Connection connection, End end, int status, long retryAfterMillis,
            Throwable cause) {
        synchronized (lock) {
            if (closed) {
                return;
            }
            if (end == End.DROPPED && TimeUnit.NANOSECONDS.toMillis(
                    System.nanoTime() - connection.openedAtNanos) >= options.stableAfterMillis) {
                attempt = 0;
            }
            long delay = options.nextDelay(end, status, retryAfterMillis, attempt);
            if (attempt < MAX_ATTEMPT) {
                attempt++;
            }
            current = null;
            try {
                scheduler.schedule(this::connectSafely, delay, TimeUnit.MILLISECONDS);
            } catch (RejectedExecutionException e) {
                // Only after close(), which shuts the scheduler down.
                return;
            }
            logger.debug("Savvagent Flags stream: {} (status {}); reconnecting in {} ms",
                    end, status, delay);
        }
        if (end == End.DROPPED) {
            return;
        }
        String message;
        if (end == End.REFUSED) {
            message = status >= 200 && status <= 299
                    ? "Savvagent Flags stream: the response is not text/event-stream (status "
                            + status + ")"
                    : "Savvagent Flags stream: connect refused (status " + status + ")";
        } else {
            message = "Savvagent Flags stream: connect failed: "
                    + (cause == null ? "unknown error" : cause.toString());
        }
        if (!closed) {
            report(onError, cause == null ? new IOException(message) : new IOException(message, cause));
        }
    }

    /** The scheduled reconnect; nothing may escape it into the scheduler. */
    private void connectSafely() {
        try {
            connect();
        } catch (RuntimeException e) {
            logger.warn("Savvagent Flags stream: reconnect failed: {}", e.toString());
        }
    }

    /** Passes {@code error} to the host's callback, which must not break the stream. */
    private static void report(Consumer<Exception> onError, Exception error) {
        try {
            onError.accept(error);
        } catch (RuntimeException callbackFailure) {
            logger.error("onError callback failed: {}", callbackFailure.toString());
        }
    }

    /**
     * Applies one event. {@code heartbeat} and events this SDK does not know are ignored. A flag
     * event can never clear the whole cache: only {@code connected} passes null.
     *
     * @param type the event's type, null when it had no {@code event} field
     * @param data the event's data
     * @param invalidate invalidates one flag, or every flag when passed null
     */
    static void applyEvent(String type, String data, Consumer<String> invalidate) {
        if (type == null) {
            return;
        }
        switch (type) {
            case "connected":
                invalidate.accept(null);
                break;
            case "flag.created":
            case "flag.updated":
            case "flag.deleted":
                String key = changedFlagKey(data);
                if (key != null) {
                    invalidate.accept(key);
                }
                break;
            default:
                break;
        }
    }

    /**
     * The key of a flag event, if its data is a JSON object with a string {@code key} that a flag
     * can have; else null. Event text is untrusted: it is only ever used as a cache key, and only
     * after this check.
     */
    static String changedFlagKey(String data) {
        if (data == null) {
            return null;
        }
        try {
            JsonElement root = JsonParser.parseString(data);
            if (root == null || !root.isJsonObject()) {
                return null;
            }
            JsonElement key = root.getAsJsonObject().get("key");
            if (key == null || !key.isJsonPrimitive() || !key.getAsJsonPrimitive().isString()) {
                return null;
            }
            String value = key.getAsString();
            return FlagClient.isValidFlagKey(value) ? value : null;
        } catch (RuntimeException e) {
            // JsonParseException (malformed), IllegalStateException, ClassCastException.
            return null;
        }
    }

    /**
     * {@code <baseUrl>/api/flags/stream}, keeping any path prefix in {@code baseUrl} (a trailing
     * slash is absorbed) and dropping any query or fragment; null when {@code baseUrl} is not an
     * http(s) URL.
     */
    static HttpUrl streamUrl(String baseUrl) {
        if (baseUrl == null) {
            return null;
        }
        HttpUrl base = HttpUrl.parse(baseUrl);
        if (base == null) {
            return null;
        }
        // An empty last segment (a trailing slash) is replaced by the first added one.
        return base.newBuilder()
                .query(null)
                .fragment(null)
                .addPathSegment("api")
                .addPathSegment("flags")
                .addPathSegment("stream")
                .build();
    }

    /** Maps {@code unit} into [0, 1]; NaN is 0. */
    static double clampUnit(double unit) {
        if (Double.isNaN(unit) || unit < 0) {
            return 0;
        }
        return Math.min(unit, 1);
    }

    /**
     * The wait before reconnect attempt {@code attempt} (from 0): {@code min(base * 2^attempt,
     * ceiling)}, scaled into [50%, 100%] by {@code unit} in [0, 1), so clients dropped together
     * do not reconnect together. A unit out of range is clamped.
     */
    static long reconnectDelay(long baseMillis, int attempt, long ceilingMillis, double unit) {
        if (baseMillis <= 0 || ceilingMillis <= 0) {
            return 0;
        }
        long d = baseMillis;
        for (int i = 0; i < attempt && d < ceilingMillis; i++) {
            d = d > Long.MAX_VALUE / 2 ? Long.MAX_VALUE : d * 2;
        }
        d = Math.min(d, ceilingMillis);
        return (long) (d * (0.5 + clampUnit(unit) / 2));
    }

    /**
     * The extra wait on top of {@link #reconnectDelay} for the first retry after an established
     * stream ended, uniform in [0, spread) by {@code unit}; zero otherwise. The base delay is
     * about a second, far too narrow to spread every client of an app whose streams one deploy
     * dropped at the same instant.
     */
    static long reconnectSpread(long spreadMillis, int attempt, boolean wasUp, double unit) {
        if (attempt != 0 || !wasUp || spreadMillis <= 0 || Double.isNaN(unit)) {
            return 0;
        }
        return (long) (spreadMillis * clampUnit(unit));
    }

    /**
     * A Retry-After header given in seconds, in milliseconds; -1 when absent or not a plain
     * non-negative integer (an HTTP date, a negative or fractional value). A value too large for
     * a long saturates.
     */
    static long parseRetryAfter(String value) {
        if (value == null) {
            return -1L;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return -1L;
        }
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (c < '0' || c > '9') {
                return -1L;
            }
        }
        long seconds;
        try {
            seconds = Long.parseLong(trimmed);
        } catch (NumberFormatException tooLarge) {
            return Long.MAX_VALUE;
        }
        return seconds > Long.MAX_VALUE / 1000 ? Long.MAX_VALUE : seconds * 1000;
    }

    private static long saturatedAdd(long a, long b) {
        long sum = a + b;
        return sum < 0 ? Long.MAX_VALUE : sum;
    }

    private static ThreadFactory daemonThreads(String name) {
        AtomicInteger count = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, name + "-" + count.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    /** The listener of one connection attempt; it ends exactly once. */
    private final class Connection extends EventSourceListener {
        final AtomicBoolean done = new AtomicBoolean();
        volatile boolean opened;
        volatile long openedAtNanos;

        @Override
        public void onOpen(EventSource eventSource, Response response) {
            openedAtNanos = System.nanoTime();
            opened = true;
        }

        @Override
        public void onEvent(EventSource eventSource, String id, String type, String data) {
            if (closed) {
                return;
            }
            try {
                applyEvent(type, data, invalidate);
            } catch (RuntimeException | StackOverflowError e) {
                logger.warn("Savvagent Flags stream: applying an event failed: {}", e.toString());
            }
        }

        @Override
        public void onClosed(EventSource eventSource) {
            end(End.DROPPED, 0, -1L, null);
        }

        @Override
        public void onFailure(EventSource eventSource, Throwable t, Response response) {
            if (opened) {
                end(End.DROPPED, 0, -1L, t);
            } else if (response != null) {
                end(End.REFUSED, response.code(),
                        parseRetryAfter(response.header("Retry-After")), t);
            } else {
                end(End.UNREACHABLE, 0, -1L, t);
            }
        }

        void end(End end, int status, long retryAfterMillis, Throwable cause) {
            if (!done.compareAndSet(false, true)) {
                return;
            }
            try {
                ended(this, end, status, retryAfterMillis, cause);
            } catch (RuntimeException e) {
                logger.warn("Savvagent Flags stream: scheduling a reconnect failed: {}", e.toString());
            }
        }
    }
}

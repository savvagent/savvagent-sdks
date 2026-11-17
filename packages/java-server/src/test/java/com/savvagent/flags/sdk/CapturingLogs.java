package com.savvagent.flags.sdk;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.ILoggerFactory;
import org.slf4j.IMarkerFactory;
import org.slf4j.Marker;
import org.slf4j.event.Level;
import org.slf4j.helpers.BasicMDCAdapter;
import org.slf4j.helpers.BasicMarkerFactory;
import org.slf4j.helpers.LegacyAbstractLogger;
import org.slf4j.helpers.MessageFormatter;
import org.slf4j.spi.MDCAdapter;
import org.slf4j.spi.SLF4JServiceProvider;

/**
 * A test-only SLF4J binding that keeps every WARN and ERROR event in memory, so a test can
 * assert what the SDK logged through the logging it really uses. Registered through
 * {@code META-INF/services/org.slf4j.spi.SLF4JServiceProvider} on the test classpath only.
 */
public class CapturingLogs implements SLF4JServiceProvider {

    /** One captured event: the level and the formatted message. */
    static final class Event {
        final Level level;
        final String message;

        Event(Level level, String message) {
            this.level = level;
            this.message = message;
        }

        @Override
        public String toString() {
            return level + " " + message;
        }
    }

    private static final List<Event> EVENTS = new CopyOnWriteArrayList<>();

    /** Forgets every event captured so far. */
    static void clear() {
        EVENTS.clear();
    }

    /** The WARN events captured since the last {@link #clear()}, as their messages. */
    static List<String> warnings() {
        List<String> result = new ArrayList<>();
        for (Event event : EVENTS) {
            if (event.level == Level.WARN) {
                result.add(event.message);
            }
        }
        return result;
    }

    private final ILoggerFactory loggerFactory = CapturingLogger::new;
    private final IMarkerFactory markerFactory = new BasicMarkerFactory();
    private final MDCAdapter mdcAdapter = new BasicMDCAdapter();

    @Override
    public ILoggerFactory getLoggerFactory() {
        return loggerFactory;
    }

    @Override
    public IMarkerFactory getMarkerFactory() {
        return markerFactory;
    }

    @Override
    public MDCAdapter getMDCAdapter() {
        return mdcAdapter;
    }

    @Override
    public String getRequestedApiVersion() {
        return "2.0.99";
    }

    @Override
    public void initialize() {
    }

    private static final class CapturingLogger extends LegacyAbstractLogger {
        private static final long serialVersionUID = 1L;

        CapturingLogger(String name) {
            this.name = name;
        }

        @Override public boolean isTraceEnabled() { return false; }
        @Override public boolean isDebugEnabled() { return false; }
        @Override public boolean isInfoEnabled() { return false; }
        @Override public boolean isWarnEnabled() { return true; }
        @Override public boolean isErrorEnabled() { return true; }

        @Override
        protected String getFullyQualifiedCallerName() {
            return null;
        }

        @Override
        protected void handleNormalizedLoggingCall(Level level, Marker marker, String messagePattern,
                Object[] arguments, Throwable throwable) {
            EVENTS.add(new Event(level, MessageFormatter.basicArrayFormat(messagePattern, arguments)));
        }
    }
}

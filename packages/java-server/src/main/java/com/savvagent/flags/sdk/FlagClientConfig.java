package com.savvagent.flags.sdk;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Configuration for the Savvagent Flags FlagClient
 */
public class FlagClientConfig {
    private final String apiKey;
    private final String applicationId;
    private final String baseUrl;
    private final boolean enableRealtime;
    private final long cacheTtl;
    private final boolean enableTelemetry;
    private final Map<String, Boolean> defaults;
    private final Consumer<Exception> onError;
    private final int timeout;

    private FlagClientConfig(Builder builder) {
        this.apiKey = builder.apiKey;
        this.applicationId = builder.applicationId;
        this.baseUrl = builder.baseUrl == null ? null : builder.baseUrl.replaceAll("/+$", "");
        this.enableRealtime = builder.enableRealtime;
        this.cacheTtl = builder.cacheTtl;
        this.enableTelemetry = builder.enableTelemetry;
        this.defaults = builder.defaults;
        this.onError = builder.onError;
        this.timeout = builder.timeout;
    }

    public String getApiKey() { return apiKey; }
    public String getApplicationId() { return applicationId; }
    public String getBaseUrl() { return baseUrl; }
    /**
     * Whether the client reads the flag-change stream; see {@link Builder#enableRealtime(boolean)}.
     *
     * @return true when real-time updates are on (the default)
     */
    public boolean isEnableRealtime() { return enableRealtime; }
    public long getCacheTtl() { return cacheTtl; }
    public boolean isEnableTelemetry() { return enableTelemetry; }
    public Map<String, Boolean> getDefaults() { return defaults; }
    public Consumer<Exception> getOnError() { return onError; }
    public int getTimeout() { return timeout; }

    public static Builder builder(String apiKey) {
        return new Builder(apiKey);
    }

    public static class Builder {
        private final String apiKey;
        private String applicationId = "";
        private String baseUrl = "https://api.savvagent.com/flags";
        private boolean enableRealtime = true;
        private long cacheTtl = 60000L;
        private boolean enableTelemetry = true;
        private Map<String, Boolean> defaults = new HashMap<>();
        private Consumer<Exception> onError = e -> System.err.println("[Savvagent Flags] " + e.getMessage());
        private int timeout = 5000;

        private Builder(String apiKey) {
            this.apiKey = apiKey;
        }

        public Builder applicationId(String applicationId) {
            this.applicationId = applicationId;
            return this;
        }

        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl;
            return this;
        }

        /**
         * Turns real-time updates on or off. Default: {@code true}.
         *
         * <p>When on, the client holds one long-lived connection to
         * {@code GET <baseUrl>/api/flags/stream} on a background (daemon) thread and drops a
         * cached evaluation as soon as the server reports that its flag changed, so a change, a
         * kill switch above all, takes effect in about a round trip instead of after
         * {@link #cacheTtl(long)}. Every (re)connect clears the whole cache, since changes may
         * have been missed while the stream was down. A dropped or refused stream is retried
         * with exponential backoff; lookups never wait on it and keep being served from the
         * cache and the evaluate endpoint meanwhile.
         *
         * <p>A failed connect attempt is passed to {@link #onError(Consumer)}, which may then run
         * on the stream's own thread rather than a caller's. Call {@link FlagClient#close()} to
         * stop the stream.
         *
         * @param enableRealtime true to read the flag-change stream
         * @return this builder
         */
        public Builder enableRealtime(boolean enableRealtime) {
            this.enableRealtime = enableRealtime;
            return this;
        }

        public Builder cacheTtl(long cacheTtl) {
            this.cacheTtl = cacheTtl;
            return this;
        }

        public Builder enableTelemetry(boolean enableTelemetry) {
            this.enableTelemetry = enableTelemetry;
            return this;
        }

        public Builder defaults(Map<String, Boolean> defaults) {
            this.defaults = defaults;
            return this;
        }

        public Builder onError(Consumer<Exception> onError) {
            this.onError = onError;
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        public FlagClientConfig build() {
            if (apiKey == null || !apiKey.startsWith("sdk_")) {
                throw new IllegalArgumentException("Invalid API key. SDK keys must start with 'sdk_'");
            }
            return new FlagClientConfig(this);
        }
    }
}

package com.savvagent.sdk;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Configuration for the Savvagent FlagClient
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
        this.baseUrl = builder.baseUrl;
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
        private String baseUrl = "https://flags-api.savvagent.com";
        private boolean enableRealtime = true;
        private long cacheTtl = 60000L;
        private boolean enableTelemetry = true;
        private Map<String, Boolean> defaults = new HashMap<>();
        private Consumer<Exception> onError = e -> System.err.println("[Savvagent] " + e.getMessage());
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

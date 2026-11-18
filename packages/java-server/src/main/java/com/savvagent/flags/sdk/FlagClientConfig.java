package com.savvagent.flags.sdk;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Configuration for the Savvagent Flags FlagClient
 */
public class FlagClientConfig {
    private static final Logger logger = LoggerFactory.getLogger(FlagClientConfig.class);

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
        if (builder.derivedDefaults.isEmpty()) {
            this.defaults = builder.defaults;
        } else {
            // Derived defaults (defaultFrom, defaultFromEnv) win over the base map, whatever
            // order the builder methods were called in. The caller's map is never modified.
            Map<String, Boolean> merged = builder.defaults == null
                    ? new HashMap<>() : new HashMap<>(builder.defaults);
            merged.putAll(builder.derivedDefaults);
            this.defaults = merged;
        }
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
    /**
     * The value given to {@link Builder#enableTelemetry(boolean)}, which has no effect.
     *
     * @return the value set, true by default
     * @deprecated this SDK sends no telemetry, so the setting does nothing
     */
    @Deprecated
    public boolean isEnableTelemetry() { return enableTelemetry; }
    public Map<String, Boolean> getDefaults() { return defaults; }
    public Consumer<Exception> getOnError() { return onError; }
    public int getTimeout() { return timeout; }

    /**
     * Starts a configuration.
     *
     * @param apiKey a server key ({@code srv_...}, recommended for server apps) or a client key
     *               ({@code sdk_...}); {@link Builder#build()} rejects anything else
     * @return a builder
     */
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
        // Results of defaultFrom / defaultFromEnv, kept apart so build() can lay them over the
        // base map from defaults(Map) regardless of call order.
        private final Map<String, Boolean> derivedDefaults = new LinkedHashMap<>();
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

        /**
         * Accepted for compatibility; it has no effect. This SDK sends no telemetry.
         *
         * @param enableTelemetry ignored
         * @return this builder
         * @deprecated this SDK sends no telemetry, so the setting does nothing
         */
        @Deprecated
        public Builder enableTelemetry(boolean enableTelemetry) {
            this.enableTelemetry = enableTelemetry;
            return this;
        }

        /**
         * Sets the base values lookups return when a flag cannot be evaluated (default: none, so
         * {@code false}). Calling it again replaces the earlier base map.
         *
         * <p>Defaults set with {@link #defaultFromEnv(String, String)} and
         * {@link #defaultFrom(String, Supplier)} are kept separately and applied over this map
         * in {@link #build()}, so the result does not depend on the order of the calls. If both
         * name the same flag, the derived value wins; between two derived calls for the same
         * flag, the later call wins.
         *
         * @param defaults flag key to default value
         * @return this builder
         */
        public Builder defaults(Map<String, Boolean> defaults) {
            this.defaults = defaults;
            return this;
        }

        /**
         * Sets one flag's default from {@code value}, which is called once, now. An empty (or
         * null) result leaves the base default from {@link #defaults(Map)}, or the built-in
         * {@code false}, in place (or an earlier derived default for the same flag). It is
         * for a default that comes from somewhere other than a constant; the result is fixed
         * when this method is called, not re-read per lookup.
         *
         * <pre>{@code
         * FlagClientConfig.builder(apiKey)
         *     .defaultFrom("beta-banner", () -> Optional.of(region.equals("eu")))
         *     .build();
         * }</pre>
         *
         * <p>The default is applied over {@link #defaults(Map)} when the configuration is built,
         * whichever was called first. The map given to {@code defaults} is never modified: the
         * merge is written to a copy.
         *
         * <p>A null {@code value} throws {@link NullPointerException}. A supplier that throws is
         * not caught: the exception propagates out of this method, while the configuration is
         * being built, so a broken default fails at startup rather than silently.
         *
         * @param flagKey the flag
         * @param value   gives the default, or an empty Optional to leave it unset
         * @return this builder
         * @throws NullPointerException if {@code value} is null
         */
        public Builder defaultFrom(String flagKey, Supplier<Optional<Boolean>> value) {
            Optional<Boolean> result = value.get();
            if (result != null && result.isPresent()) {
                derivedDefaults.put(flagKey, result.get());
            }
            return this;
        }

        /**
         * Sets one flag's default from the environment variable {@code envVar}, read once, now.
         * It is for a service moving from env-var flags: "when Savvagent Flags cannot be
         * reached, use what the variable says".
         *
         * <p>Accepted values, ignoring case and surrounding whitespace, are {@code 1},
         * {@code true}, {@code yes}, {@code on} and {@code 0}, {@code false}, {@code no},
         * {@code off}. An unset variable is ignored silently (in production it is the normal
         * case); one that is empty or says anything else is ignored with an SLF4J warning that
         * names the variable but never its value. Either way the base default from
         * {@link #defaults(Map)}, or the built-in {@code false}, stays in place.
         *
         * <pre>{@code
         * FlagClientConfig.builder(System.getenv("SAVVAGENT_FLAGS_API_KEY"))
         *     .defaultFromEnv("new-checkout", "NEW_CHECKOUT_ENABLED")
         *     .build();
         * }</pre>
         *
         * @param flagKey the flag
         * @param envVar  the environment variable to read
         * @return this builder
         */
        public Builder defaultFromEnv(String flagKey, String envVar) {
            return defaultFromEnv(flagKey, envVar, System::getenv);
        }

        /** {@link #defaultFromEnv(String, String)} reading the variable through {@code getenv}. */
        Builder defaultFromEnv(String flagKey, String envVar, Function<String, String> getenv) {
            return defaultFrom(flagKey, () -> {
                String raw = getenv.apply(envVar);
                if (raw == null) {
                    return Optional.empty();
                }
                Optional<Boolean> parsed = parseBoolean(raw);
                if (!parsed.isPresent()) {
                    logger.warn("Savvagent Flags: environment variable \"{}\" is not a boolean; ignoring it",
                            envVar);
                }
                return parsed;
            });
        }

        public Builder onError(Consumer<Exception> onError) {
            this.onError = onError;
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        /**
         * Builds the configuration.
         *
         * @return the configuration
         * @throws IllegalArgumentException if the API key starts with neither {@code srv_} nor
         *                                  {@code sdk_}
         */
        public FlagClientConfig build() {
            // The public client key or the secret server key, which the SDK guide recommends for
            // server apps.
            if (apiKey == null || !(apiKey.startsWith("sdk_") || apiKey.startsWith("srv_"))) {
                throw new IllegalArgumentException(
                        "Invalid API key: must start with 'sdk_' (client key) or 'srv_' (server key)");
            }
            return new FlagClientConfig(this);
        }
    }

    /** 1/true/yes/on and 0/false/no/off, ignoring case and surrounding whitespace. */
    static Optional<Boolean> parseBoolean(String raw) {
        switch (raw.strip().toLowerCase(Locale.ROOT)) {
            case "1": case "true": case "yes": case "on":
                return Optional.of(true);
            case "0": case "false": case "no": case "off":
                return Optional.of(false);
            default:
                return Optional.empty();
        }
    }
}

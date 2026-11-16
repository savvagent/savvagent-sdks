package com.savvagent.flags.sdk;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Savvagent Flags FlagClient for server-side feature flag evaluation
 */
public class FlagClient implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(FlagClient.class);
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final FlagClientConfig config;
    private final OkHttpClient httpClient;
    private final Gson gson;
    /**
     * Most contexts cached for one flag. When a new context finds its flag full, expired entries
     * are swept, and if more than half the bound is still live the flag is cleared. The cost of
     * the bound is cache misses, never a wrong answer.
     */
    static final int MAX_CONTEXTS_PER_FLAG = 10_000;

    private final int maxContextsPerFlag;
    /** Flag key to (context key to entry). The context key is the canonical JSON of the context. */
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, CacheEntry>> cache;
    /**
     * Bumped by every invalidation, so a result fetched before one is dropped instead of cached.
     * Guarded by {@code generationLock}, which also makes check-then-store and bump-then-remove
     * atomic with respect to each other.
     */
    private final Object generationLock = new Object();
    private long epoch;
    private final java.util.HashMap<String, Long> generations = new java.util.HashMap<>();
    private final ConcurrentHashMap<String, ConfigOverrideEntry> configOverrides;
    private final ConcurrentHashMap<String, VariationOverrideEntry> variationOverrides;
    /** The flag-change stream, or null when real-time updates are off or could not start. */
    private final RealtimeStream realtime;

    /**
     * Creates a client. When {@link FlagClientConfig#isEnableRealtime()} is true (the default),
     * this also opens the flag-change stream on a background thread; call {@link #close()} to
     * stop it.
     *
     * @param config the client's configuration
     */
    public FlagClient(FlagClientConfig config) {
        this(config, MAX_CONTEXTS_PER_FLAG);
    }

    FlagClient(FlagClientConfig config, int maxContextsPerFlag) {
        this(config, maxContextsPerFlag, RealtimeStream.Options.defaults());
    }

    FlagClient(FlagClientConfig config, int maxContextsPerFlag,
            RealtimeStream.Options realtimeOptions) {
        this.config = config;
        this.maxContextsPerFlag = maxContextsPerFlag;
        this.gson = new Gson();
        this.cache = new ConcurrentHashMap<>();
        this.configOverrides = new ConcurrentHashMap<>();
        this.variationOverrides = new ConcurrentHashMap<>();

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .readTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .writeTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .build();

        RealtimeStream stream = null;
        if (config.isEnableRealtime()) {
            try {
                stream = RealtimeStream.start(config, httpClient, this::invalidateCache,
                        realtimeOptions);
            } catch (RuntimeException e) {
                // Never thrown into the host: lookups work without the stream, bounded by the TTL.
                logger.warn("Savvagent Flags stream did not start; real-time updates are off: {}",
                        e.toString());
            }
        }
        this.realtime = stream;

        logger.info("Savvagent Flags FlagClient initialized");
    }

    /**
     * Evaluate a feature flag
     */
    public FlagEvaluationResult evaluate(String flagKey, FlagContext context) {
        long startTime = System.currentTimeMillis();

        if (!isValidFlagKey(flagKey)) {
            String message = describeInvalidFlagKey(flagKey);
            logger.error("{}", message);
            try {
                config.getOnError().accept(new IllegalArgumentException(message));
            } catch (RuntimeException callbackFailure) {
                logger.error("onError callback failed: {}", callbackFailure.getMessage());
            }
            return new FlagEvaluationResult(flagKey, defaultFor(flagKey), "error", null);
        }

        try {
            // Prepare context
            if (context == null) {
                context = new FlagContext();
            }
            if (context.getApplicationId() == null && !config.getApplicationId().isEmpty()) {
                context.setApplicationId(config.getApplicationId());
            }

            // The cache is keyed by flag and context: the answer depends on the context. The
            // request body carries this same tree. A context that cannot be keyed is not cached.
            JsonElement contextJson = gson.toJsonTree(context);
            String ctxKey;
            try {
                ctxKey = canonicalJson(contextJson);
            } catch (RuntimeException e) {
                ctxKey = null;
            }

            // Check cache first
            CacheEntry cachedEntry = ctxKey == null ? null : getCachedEntry(flagKey, ctxKey);
            if (cachedEntry != null) {
                Object configuration = cachedEntry.configuration;
                String variation = cachedEntry.variation;

                // Apply overrides
                ConfigOverrideEntry configOverride = configOverrides.get(flagKey);
                if (configOverride != null) {
                    if (configOverride.merge && configuration != null) {
                        configuration = mergeConfigurations(configuration, configOverride.config);
                    } else {
                        configuration = configOverride.config;
                    }
                }

                VariationOverrideEntry variationOverride = variationOverrides.get(flagKey);
                if (variationOverride != null) {
                    variation = variationOverride.variation;
                }

                logger.debug("Flag '{}' returned from cache: {}", flagKey, cachedEntry.value);
                FlagEvaluationResult.Metadata cachedMetadata = new FlagEvaluationResult.Metadata();
                cachedMetadata.setVersion(cachedEntry.version);
                cachedMetadata.setScope(cachedEntry.scope);
                return new FlagEvaluationResult(flagKey, cachedEntry.value, configuration,
                        variation, "cached", cachedMetadata);
            }

            // Read before the request: an invalidation while it is in flight drops this result.
            long[] generation = generationOf(flagKey);

            // Call API
            // Build the URL segment by segment so the key is encoded as one path segment.
            HttpUrl url = HttpUrl.get(config.getBaseUrl()).newBuilder()
                    .addPathSegment("api")
                    .addPathSegment("flags")
                    .addPathSegment(flagKey)
                    .addPathSegment("evaluate")
                    .build();
            JsonObject requestBody = new JsonObject();
            requestBody.add("context", contextJson);

            Request request = new Request.Builder()
                    .url(url)
                    .post(RequestBody.create(gson.toJson(requestBody), JSON))
                    .addHeader("Authorization", "Bearer " + config.getApiKey())
                    .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    throw new IOException("API error: " + response.code() + " " + response.message());
                }

                JsonObject data = gson.fromJson(response.body().string(), JsonObject.class);
                // The result is "enabled" (docs/SDK-DEVELOPER-GUIDE.md). A body without a
                // boolean "enabled" is a failed lookup, not a default to cache (#112).
                JsonElement enabled = data == null ? null : data.get("enabled");
                if (enabled == null || !enabled.isJsonPrimitive()
                        || !enabled.getAsJsonPrimitive().isBoolean()) {
                    throw new IOException("The evaluate response has no boolean \"enabled\"");
                }
                boolean value = enabled.getAsBoolean();

                // The server sends both fields, as null when the flag has none.
                Object configuration = presentOrNull(data.get("configuration"));
                JsonElement variationElement = presentOrNull(data.get("variation"));
                String variation = variationElement == null ? null : variationElement.getAsString();

                // Parse everything before caching, so a failure here caches nothing.
                FlagEvaluationResult.Metadata metadata = new FlagEvaluationResult.Metadata();
                // The server never sends flagId, description or variant; read them only if
                // present, and never let a malformed value fail the lookup.
                metadata.setFlagId(stringOrNull(data.get("flagId")));
                metadata.setDescription(stringOrNull(data.get("description")));
                metadata.setVariant(stringOrNull(data.get("variant")));
                // What the server does send: the flag's version and the evaluation scope.
                metadata.setVersion(integralOrNull(data.get("version")));
                metadata.setScope(stringOrNull(data.get("scope")));

                // Cache the result (including configuration and variation)
                if (ctxKey != null) {
                    setCachedValue(flagKey, ctxKey, value, configuration, variation,
                            metadata.getVersion(), metadata.getScope(), generation);
                }

                // Apply overrides to evaluated result
                ConfigOverrideEntry configOverride = configOverrides.get(flagKey);
                if (configOverride != null) {
                    if (configOverride.merge && configuration != null) {
                        configuration = mergeConfigurations(configuration, configOverride.config);
                    } else {
                        configuration = configOverride.config;
                    }
                }

                VariationOverrideEntry variationOverride = variationOverrides.get(flagKey);
                if (variationOverride != null) {
                    variation = variationOverride.variation;
                }

                logger.debug("Flag '{}' evaluated: {}", flagKey, value);
                return new FlagEvaluationResult(flagKey, value, configuration, variation, "evaluated", metadata);
            }
        } catch (Exception e) {
            logger.error("Error evaluating flag '{}': {}", flagKey, e.getMessage());
            config.getOnError().accept(e instanceof Exception ? (Exception) e : new Exception(e));

            // Return default value
            boolean defaultValue = defaultFor(flagKey);
            return new FlagEvaluationResult(flagKey, defaultValue, "error", null);
        }
    }

    /**
     * Returns whether a flag key may be sent to the API.
     *
     * <p>A key is valid when it is 1 to 128 characters long, every character is in
     * {@code [A-Za-z0-9._-]}, and it is not {@code .} or {@code ..}. This mirrors the
     * server's flag key rule. The key becomes one URL path segment carrying the SDK key in
     * the Authorization header; a key containing {@code /}, {@code ?} or {@code #} could
     * steer the request, and that header, to another endpoint, and {@code .} or {@code ..}
     * cannot be carried in a URL path because clients normalize them away (#107).
     *
     * @param key the flag key, possibly null
     * @return true if the key is safe to use as a path segment
     */
    static boolean isValidFlagKey(String key) {
        if (key == null || key.isEmpty() || key.length() > 128) {
            return false;
        }
        if (key.equals(".") || key.equals("..")) {
            return false;
        }
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-';
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    private String describeInvalidFlagKey(String key) {
        if (key == null) {
            return "Invalid flag key: null";
        }
        String prefix = key.length() > 64 ? key.substring(0, 64) : key;
        return "Invalid flag key " + gson.toJson(prefix) + " (length " + key.length()
                + "): keys must be 1-128 characters of A-Z a-z 0-9 . _ - and not . or ..";
    }

    /** {@code element}, or null when it is absent or JSON {@code null}. */
    private static JsonElement presentOrNull(JsonElement element) {
        return element == null || element.isJsonNull() ? null : element;
    }

    /** The string value of {@code element}, or null unless it is a JSON string. */
    private static String stringOrNull(JsonElement element) {
        JsonElement present = presentOrNull(element);
        if (present == null || !present.isJsonPrimitive()
                || !present.getAsJsonPrimitive().isString()) {
            return null;
        }
        return present.getAsString();
    }

    /** The value of {@code element} when it is a JSON number with an integral value, else null. */
    private static Long integralOrNull(JsonElement element) {
        JsonElement present = presentOrNull(element);
        if (present == null || !present.isJsonPrimitive()
                || !present.getAsJsonPrimitive().isNumber()) {
            return null;
        }
        try {
            BigDecimal number = present.getAsBigDecimal();
            if (number.stripTrailingZeros().scale() > 0) {
                return null;
            }
            return number.longValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return null;
        }
    }

    private boolean defaultFor(String flagKey) {
        Map<String, Boolean> defaults = config.getDefaults();
        if (flagKey == null || defaults == null) {
            return false;
        }
        Boolean value = defaults.get(flagKey);
        return value != null ? value : false;
    }

    /**
     * Check if a flag is enabled (convenience method)
     */
    public boolean isEnabled(String flagKey, FlagContext context) {
        return evaluate(flagKey, context).getValue();
    }

    /**
     * Check if a flag is enabled without context
     */
    public boolean isEnabled(String flagKey) {
        return isEnabled(flagKey, null);
    }

    /**
     * Get dynamic configuration for a flag (Phase 1)
     * Returns configuration if flag is enabled, otherwise returns null
     */
    public Object getConfig(String flagKey, FlagContext context) {
        FlagEvaluationResult result = evaluate(flagKey, context);
        if (!result.getValue()) {
            return null;
        }
        return result.getConfiguration();
    }

    /**
     * Get dynamic configuration without context
     */
    public Object getConfig(String flagKey) {
        return getConfig(flagKey, null);
    }

    /**
     * Get dynamic configuration with type casting (Phase 1)
     */
    public <T> T getConfig(String flagKey, FlagContext context, Class<T> type) {
        Object config = getConfig(flagKey, context);
        if (config == null) {
            return null;
        }
        return gson.fromJson(gson.toJson(config), type);
    }

    /**
     * Get variation details for multi-variant flags (Phase 2)
     * Returns variation name, enabled status, and configuration
     */
    public VariationResult getVariation(String flagKey, FlagContext context) {
        FlagEvaluationResult result = evaluate(flagKey, context);
        String variation = result.getVariation() != null ? result.getVariation() : "control";
        return new VariationResult(variation, result.getValue(), result.getConfiguration());
    }

    /**
     * Get variation without context
     */
    public VariationResult getVariation(String flagKey) {
        return getVariation(flagKey, null);
    }

    /**
     * Invalidate cache for a specific flag
     */
    public void invalidateCache(String flagKey) {
        synchronized (generationLock) {
            if (flagKey != null) {
                generations.merge(flagKey, 1L, Long::sum);
                cache.remove(flagKey);
            } else {
                epoch++;
                generations.clear();
                cache.clear();
            }
        }
    }

    /** The flag's invalidation generation, to pass to {@link #setCachedValue}. */
    private long[] generationOf(String flagKey) {
        synchronized (generationLock) {
            return new long[] {epoch, generations.getOrDefault(flagKey, 0L)};
        }
    }

    /** The flag-change stream, or null when none is running (for tests). */
    RealtimeStream realtimeStream() {
        return realtime;
    }

    /** Number of contexts currently cached for a flag (for tests). */
    int cachedContextCount(String flagKey) {
        ConcurrentHashMap<String, CacheEntry> contexts = cache.get(flagKey);
        return contexts == null ? 0 : contexts.size();
    }

    /**
     * The JSON text of {@code element} with every object's keys sorted, so two contexts that
     * carry the same data share a key whatever the iteration order of their attribute maps.
     */
    private static String canonicalJson(JsonElement element) {
        return sorted(element).toString();
    }

    private static JsonElement sorted(JsonElement element) {
        if (element.isJsonObject()) {
            JsonObject source = element.getAsJsonObject();
            JsonObject result = new JsonObject();
            for (String key : new TreeSet<>(source.keySet())) {
                result.add(key, sorted(source.get(key)));
            }
            return result;
        }
        if (element.isJsonArray()) {
            JsonArray result = new JsonArray();
            for (JsonElement item : element.getAsJsonArray()) {
                result.add(sorted(item));
            }
            return result;
        }
        return element;
    }

    private CacheEntry getCachedEntry(String flagKey, String ctxKey) {
        ConcurrentHashMap<String, CacheEntry> contexts = cache.get(flagKey);
        if (contexts == null) return null;
        CacheEntry entry = contexts.get(ctxKey);
        if (entry == null) return null;

        if (System.currentTimeMillis() > entry.expiresAt) {
            contexts.remove(ctxKey, entry);
            return null;
        }

        return entry;
    }

    private void setCachedValue(String flagKey, String ctxKey, boolean value,
            Object configuration, String variation, Long version, String scope, long[] generation) {
        synchronized (generationLock) {
            // The flag was invalidated after the request started: its result is stale.
            if (!java.util.Arrays.equals(generation, new long[] {
                    epoch, generations.getOrDefault(flagKey, 0L)})) {
                return;
            }
            storeCachedValue(flagKey, ctxKey, value, configuration, variation, version, scope);
        }
    }

    private void storeCachedValue(String flagKey, String ctxKey, boolean value,
            Object configuration, String variation, Long version, String scope) {
        ConcurrentHashMap<String, CacheEntry> contexts =
                cache.computeIfAbsent(flagKey, k -> new ConcurrentHashMap<>());
        long now = System.currentTimeMillis();
        synchronized (contexts) {
            if (contexts.size() >= maxContextsPerFlag && !contexts.containsKey(ctxKey)) {
                contexts.values().removeIf(e -> e.expiresAt < now);
                if (contexts.size() > maxContextsPerFlag / 2) {
                    contexts.clear();
                }
            }
            contexts.put(ctxKey, new CacheEntry(value, configuration, variation,
                    version, scope, now + config.getCacheTtl()));
        }
    }

    /**
     * Set a configuration override for a flag
     * Useful for testing different configuration values without server changes
     */
    public void setConfigOverride(String flagKey, Object config, boolean merge) {
        configOverrides.put(flagKey, new ConfigOverrideEntry(config, merge, System.currentTimeMillis()));
        invalidateCache(flagKey);
    }

    /**
     * Set a configuration override with default merge=false
     */
    public void setConfigOverride(String flagKey, Object config) {
        setConfigOverride(flagKey, config, false);
    }

    /**
     * Clear configuration override for a flag
     */
    public void clearConfigOverride(String flagKey) {
        configOverrides.remove(flagKey);
        invalidateCache(flagKey);
    }

    /**
     * Set a variation override for a multi-variant flag
     * Forces the flag to return a specific variation
     */
    public void setVariationOverride(String flagKey, String variation) {
        variationOverrides.put(flagKey, new VariationOverrideEntry(variation, System.currentTimeMillis()));
        invalidateCache(flagKey);
    }

    /**
     * Clear variation override for a flag
     */
    public void clearVariationOverride(String flagKey) {
        variationOverrides.remove(flagKey);
        invalidateCache(flagKey);
    }

    /**
     * Check if a flag has a configuration override
     */
    public boolean hasConfigOverride(String flagKey) {
        return configOverrides.containsKey(flagKey);
    }

    /**
     * Check if a flag has a variation override
     */
    public boolean hasVariationOverride(String flagKey) {
        return variationOverrides.containsKey(flagKey);
    }

    /**
     * Get all configuration overrides (for debugging/inspection)
     */
    public Map<String, Object> getConfigOverrides() {
        Map<String, Object> overrides = new HashMap<>();
        configOverrides.forEach((key, entry) -> {
            Map<String, Object> value = new HashMap<>();
            value.put("config", entry.config);
            value.put("merge", entry.merge);
            value.put("timestamp", entry.timestamp);
            overrides.put(key, value);
        });
        return overrides;
    }

    /**
     * Get all variation overrides (for debugging/inspection)
     */
    public Map<String, Object> getVariationOverrides() {
        Map<String, Object> overrides = new HashMap<>();
        variationOverrides.forEach((key, entry) -> {
            Map<String, Object> value = new HashMap<>();
            value.put("variation", entry.variation);
            value.put("timestamp", entry.timestamp);
            overrides.put(key, value);
        });
        return overrides;
    }

    /**
     * Clear all configuration and variation overrides
     */
    public void clearAllOverrides() {
        configOverrides.clear();
        variationOverrides.clear();
        invalidateCache(null);
    }

    /**
     * Merge two configuration objects (for partial overrides)
     * Deep merge where override values take precedence
     */
    @SuppressWarnings("unchecked")
    private Object mergeConfigurations(Object base, Object override) {
        if (base == null) return override;
        if (override == null) return override;

        if (base instanceof Map && override instanceof Map) {
            Map<String, Object> baseMap = new HashMap<>((Map<String, Object>) base);
            Map<String, Object> overrideMap = (Map<String, Object>) override;

            for (Map.Entry<String, Object> entry : overrideMap.entrySet()) {
                String key = entry.getKey();
                Object overrideValue = entry.getValue();

                if (baseMap.containsKey(key)) {
                    Object baseValue = baseMap.get(key);
                    if (baseValue instanceof Map && overrideValue instanceof Map) {
                        baseMap.put(key, mergeConfigurations(baseValue, overrideValue));
                        continue;
                    }
                }
                baseMap.put(key, overrideValue);
            }

            return baseMap;
        }

        return override;
    }

    /**
     * Stops the flag-change stream, clears the cache, and releases the HTTP client's threads and
     * connections. Idempotent.
     */
    @Override
    public void close() {
        if (realtime != null) {
            realtime.close();
        }
        invalidateCache(null);
        httpClient.dispatcher().executorService().shutdown();
        httpClient.connectionPool().evictAll();
        logger.info("Savvagent Flags FlagClient closed");
    }

    private static class CacheEntry {
        final boolean value;
        final Object configuration;
        final String variation;
        final Long version;
        final String scope;
        final long expiresAt;

        CacheEntry(boolean value, Object configuration, String variation,
                Long version, String scope, long expiresAt) {
            this.value = value;
            this.configuration = configuration;
            this.variation = variation;
            this.version = version;
            this.scope = scope;
            this.expiresAt = expiresAt;
        }
    }

    private static class ConfigOverrideEntry {
        final Object config;
        final boolean merge;
        final long timestamp;

        ConfigOverrideEntry(Object config, boolean merge, long timestamp) {
            this.config = config;
            this.merge = merge;
            this.timestamp = timestamp;
        }
    }

    private static class VariationOverrideEntry {
        final String variation;
        final long timestamp;

        VariationOverrideEntry(String variation, long timestamp) {
            this.variation = variation;
            this.timestamp = timestamp;
        }
    }
}

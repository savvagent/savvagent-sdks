package com.savvagent.sdk;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Savvagent FlagClient for server-side feature flag evaluation
 */
public class FlagClient implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(FlagClient.class);
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final FlagClientConfig config;
    private final OkHttpClient httpClient;
    private final Gson gson;
    private final ConcurrentHashMap<String, CacheEntry> cache;

    public FlagClient(FlagClientConfig config) {
        this.config = config;
        this.gson = new Gson();
        this.cache = new ConcurrentHashMap<>();

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .readTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .writeTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
                .build();

        logger.info("Savvagent FlagClient initialized");
    }

    /**
     * Evaluate a feature flag
     */
    public FlagEvaluationResult evaluate(String flagKey, FlagContext context) {
        long startTime = System.currentTimeMillis();

        try {
            // Check cache first
            Boolean cachedValue = getCachedValue(flagKey);
            if (cachedValue != null) {
                logger.debug("Flag '{}' returned from cache: {}", flagKey, cachedValue);
                return new FlagEvaluationResult(flagKey, cachedValue, "cached", null);
            }

            // Prepare context
            if (context == null) {
                context = new FlagContext();
            }
            if (context.getApplicationId() == null && !config.getApplicationId().isEmpty()) {
                context.setApplicationId(config.getApplicationId());
            }

            // Call API
            String url = config.getBaseUrl() + "/api/evaluate/" + flagKey;
            JsonObject requestBody = new JsonObject();
            requestBody.add("context", gson.toJsonTree(context));

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
                boolean value = data.has("value") ? data.get("value").getAsBoolean()
                                : config.getDefaults().getOrDefault(flagKey, false);

                // Cache the result
                setCachedValue(flagKey, value);

                FlagEvaluationResult.Metadata metadata = new FlagEvaluationResult.Metadata();
                if (data.has("flagId")) metadata.setFlagId(data.get("flagId").getAsString());
                if (data.has("description")) metadata.setDescription(data.get("description").getAsString());
                if (data.has("variant")) metadata.setVariant(data.get("variant").getAsString());

                logger.debug("Flag '{}' evaluated: {}", flagKey, value);
                return new FlagEvaluationResult(flagKey, value, "evaluated", metadata);
            }
        } catch (Exception e) {
            logger.error("Error evaluating flag '{}': {}", flagKey, e.getMessage());
            config.getOnError().accept(e instanceof Exception ? (Exception) e : new Exception(e));

            // Return default value
            boolean defaultValue = config.getDefaults().getOrDefault(flagKey, false);
            return new FlagEvaluationResult(flagKey, defaultValue, "error", null);
        }
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
     * Invalidate cache for a specific flag
     */
    public void invalidateCache(String flagKey) {
        if (flagKey != null) {
            cache.remove(flagKey);
        } else {
            cache.clear();
        }
    }

    private Boolean getCachedValue(String flagKey) {
        CacheEntry entry = cache.get(flagKey);
        if (entry == null) return null;

        if (System.currentTimeMillis() > entry.expiresAt) {
            cache.remove(flagKey);
            return null;
        }

        return entry.value;
    }

    private void setCachedValue(String flagKey, boolean value) {
        cache.put(flagKey, new CacheEntry(value, System.currentTimeMillis() + config.getCacheTtl()));
    }

    @Override
    public void close() {
        cache.clear();
        httpClient.dispatcher().executorService().shutdown();
        httpClient.connectionPool().evictAll();
        logger.info("Savvagent FlagClient closed");
    }

    private static class CacheEntry {
        final boolean value;
        final long expiresAt;

        CacheEntry(boolean value, long expiresAt) {
            this.value = value;
            this.expiresAt = expiresAt;
        }
    }
}

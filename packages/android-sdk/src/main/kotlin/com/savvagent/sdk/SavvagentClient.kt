package com.savvagent.sdk

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Configuration for the Savvagent SDK client
 */
data class SavvagentConfig(
    val apiUrl: String = "https://beta.savvagent.com",
    val sdkKey: String,
    val environment: String = "production",
    val pollingInterval: Long = 60_000L, // milliseconds
    val enableWebSocket: Boolean = true,
    val timeout: Long = 30_000L, // milliseconds
    val enableLogging: Boolean = false
)

/**
 * User context for feature flag evaluation
 */
data class UserContext(
    val userId: String,
    val attributes: Map<String, Any> = emptyMap()
) {
    fun toJson(): JSONObject {
        return JSONObject().apply {
            put("userId", userId)
            put("attributes", JSONObject(attributes))
        }
    }
}

/**
 * Result from flag evaluation
 */
data class FlagEvaluationResult(
    val key: String,
    val value: Boolean,
    val configuration: Map<String, Any>? = null,
    val variation: String? = null,
    val reason: String = "evaluated"
)

/**
 * Result from variation evaluation for multi-variant flags
 */
data class VariationResult(
    val variation: String,
    val enabled: Boolean,
    val configuration: Map<String, Any>? = null
)

/**
 * Cache entry for flag values
 */
private data class CacheEntry(
    val value: Boolean,
    val configuration: Map<String, Any>? = null,
    val variation: String? = null
)

/**
 * Configuration override entry
 */
private data class ConfigOverrideEntry(
    val config: Map<String, Any>,
    val merge: Boolean,
    val timestamp: Long
)

/**
 * Variation override entry
 */
private data class VariationOverrideEntry(
    val variation: String,
    val timestamp: Long
)

/**
 * Main Savvagent SDK client for feature flag evaluation
 */
class SavvagentClient(
    private val config: SavvagentConfig,
    private val context: Context? = null
) {
    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .readTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .writeTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .apply {
            if (config.enableLogging) {
                addInterceptor(okhttp3.logging.HttpLoggingInterceptor().apply {
                    level = okhttp3.logging.HttpLoggingInterceptor.Level.BODY
                })
            }
        }
        .build()

    private val flagCache = ConcurrentHashMap<String, CacheEntry>()
    private val configOverrides = ConcurrentHashMap<String, ConfigOverrideEntry>()
    private val variationOverrides = ConcurrentHashMap<String, VariationOverrideEntry>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var webSocket: WebSocket? = null
    private var pollingJob: Job? = null

    private val _flagUpdates = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val flagUpdates: StateFlow<Map<String, Boolean>> = _flagUpdates

    init {
        if (config.enableWebSocket) {
            setupWebSocket()
        }
        startPolling()
    }

    /**
     * Evaluate a feature flag and get full details (Phase 1 & 2)
     */
    suspend fun evaluate(flagKey: String, userContext: UserContext): Result<FlagEvaluationResult> {
        return withContext(Dispatchers.IO) {
            try {
                // Check cache first
                flagCache[flagKey]?.let { cached ->
                    var configuration = cached.configuration
                    var variation = cached.variation

                    // Apply overrides
                    configOverrides[flagKey]?.let { override ->
                        configuration = if (override.merge && configuration != null) {
                            mergeConfigurations(configuration, override.config)
                        } else {
                            override.config
                        }
                    }

                    variationOverrides[flagKey]?.let { override ->
                        variation = override.variation
                    }

                    return@withContext Result.success(
                        FlagEvaluationResult(
                            key = flagKey,
                            value = cached.value,
                            configuration = configuration,
                            variation = variation,
                            reason = "cached"
                        )
                    )
                }

                // Fetch from API
                val url = "${config.apiUrl}/v1/flags/$flagKey/evaluate"
                val json = userContext.toJson()

                val request = Request.Builder()
                    .url(url)
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer ${config.sdkKey}")
                    .build()

                val response = okHttpClient.newCall(request).execute()

                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        SavvagentException("Request failed with code: ${response.code}")
                    )
                }

                val body = response.body?.string() ?: ""
                val jsonResponse = JSONObject(body)
                val enabled = jsonResponse.getBoolean("enabled")

                var configuration = if (jsonResponse.has("configuration")) {
                    jsonResponse.getJSONObject("configuration").toMap()
                } else null

                var variation = if (jsonResponse.has("variation")) {
                    jsonResponse.getString("variation")
                } else null

                // Update cache
                flagCache[flagKey] = CacheEntry(enabled, configuration, variation)
                updateFlagFlow()

                // Apply overrides to evaluated result
                configOverrides[flagKey]?.let { override ->
                    configuration = if (override.merge && configuration != null) {
                        mergeConfigurations(configuration, override.config)
                    } else {
                        override.config
                    }
                }

                variationOverrides[flagKey]?.let { override ->
                    variation = override.variation
                }

                Result.success(FlagEvaluationResult(
                    key = flagKey,
                    value = enabled,
                    configuration = configuration,
                    variation = variation,
                    reason = "evaluated"
                ))
            } catch (e: Exception) {
                logError("Error checking flag: $flagKey", e)
                Result.failure(e)
            }
        }
    }

    /**
     * Check if a feature flag is enabled for a given user context (convenience method)
     */
    suspend fun isEnabled(flagKey: String, userContext: UserContext): Result<Boolean> {
        return evaluate(flagKey, userContext).map { it.value }
    }

    /**
     * Get dynamic configuration for a flag (Phase 1)
     * Returns configuration if flag is enabled, otherwise returns null
     */
    suspend fun getConfig(flagKey: String, userContext: UserContext): Result<Map<String, Any>?> {
        return evaluate(flagKey, userContext).map { result ->
            if (result.value) result.configuration else null
        }
    }

    /**
     * Get variation details for multi-variant flags (Phase 2)
     * Returns variation name, enabled status, and configuration
     */
    suspend fun getVariationDetails(flagKey: String, userContext: UserContext): Result<VariationResult> {
        return evaluate(flagKey, userContext).map { result ->
            VariationResult(
                variation = result.variation ?: "control",
                enabled = result.value,
                configuration = result.configuration
            )
        }
    }

    /**
     * Get a variation value for a feature flag (legacy method - kept for backward compatibility)
     */
    suspend fun <T> getVariation(
        flagKey: String,
        userContext: UserContext,
        defaultValue: T
    ): T {
        return withContext(Dispatchers.IO) {
            try {
                val url = "${config.apiUrl}/v1/flags/$flagKey/variation"
                val json = userContext.toJson()

                val request = Request.Builder()
                    .url(url)
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer ${config.sdkKey}")
                    .build()

                val response = okHttpClient.newCall(request).execute()

                if (!response.isSuccessful) {
                    return@withContext defaultValue
                }

                val body = response.body?.string() ?: ""
                val jsonResponse = JSONObject(body)

                @Suppress("UNCHECKED_CAST")
                (jsonResponse.get("value") as? T) ?: defaultValue
            } catch (e: Exception) {
                logError("Error getting variation: $flagKey", e)
                defaultValue
            }
        }
    }

    /**
     * Track an event for analytics
     */
    suspend fun track(
        eventName: String,
        userContext: UserContext,
        properties: Map<String, Any> = emptyMap()
    ) {
        withContext(Dispatchers.IO) {
            try {
                val url = "${config.apiUrl}/v1/events"
                val json = JSONObject().apply {
                    put("event", eventName)
                    put("context", userContext.toJson())
                    put("properties", JSONObject(properties))
                    put("timestamp", System.currentTimeMillis())
                }

                val request = Request.Builder()
                    .url(url)
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .addHeader("Authorization", "Bearer ${config.sdkKey}")
                    .build()

                okHttpClient.newCall(request).execute().close()
            } catch (e: Exception) {
                logError("Error tracking event: $eventName", e)
            }
        }
    }

    /**
     * Flush any pending events or data
     */
    suspend fun flush() {
        // Implementation for flushing pending events
    }

    /**
     * Close the client and cleanup resources
     */
    fun close() {
        pollingJob?.cancel()
        webSocket?.close(1000, "Client closed")
        scope.cancel()
    }

    /**
     * Set a configuration override for a flag
     * Useful for testing different configuration values without server changes
     */
    fun setConfigOverride(flagKey: String, config: Map<String, Any>, merge: Boolean = false) {
        configOverrides[flagKey] = ConfigOverrideEntry(config, merge, System.currentTimeMillis())
        // Clear cache to force re-evaluation with override
        flagCache.remove(flagKey)
    }

    /**
     * Clear configuration override for a flag
     */
    fun clearConfigOverride(flagKey: String) {
        configOverrides.remove(flagKey)
        // Clear cache to get fresh API values
        flagCache.remove(flagKey)
    }

    /**
     * Set a variation override for a multi-variant flag
     * Forces the flag to return a specific variation
     */
    fun setVariationOverride(flagKey: String, variation: String) {
        variationOverrides[flagKey] = VariationOverrideEntry(variation, System.currentTimeMillis())
        // Clear cache to force re-evaluation with override
        flagCache.remove(flagKey)
    }

    /**
     * Clear variation override for a flag
     */
    fun clearVariationOverride(flagKey: String) {
        variationOverrides.remove(flagKey)
        // Clear cache to get fresh API values
        flagCache.remove(flagKey)
    }

    /**
     * Check if a flag has a configuration override
     */
    fun hasConfigOverride(flagKey: String): Boolean {
        return configOverrides.containsKey(flagKey)
    }

    /**
     * Check if a flag has a variation override
     */
    fun hasVariationOverride(flagKey: String): Boolean {
        return variationOverrides.containsKey(flagKey)
    }

    /**
     * Get all configuration overrides (for debugging/inspection)
     */
    fun getConfigOverrides(): Map<String, Map<String, Any>> {
        return configOverrides.mapValues { (_, entry) ->
            mapOf(
                "config" to entry.config,
                "merge" to entry.merge,
                "timestamp" to entry.timestamp
            )
        }
    }

    /**
     * Get all variation overrides (for debugging/inspection)
     */
    fun getVariationOverrides(): Map<String, Map<String, Any>> {
        return variationOverrides.mapValues { (_, entry) ->
            mapOf(
                "variation" to entry.variation,
                "timestamp" to entry.timestamp
            )
        }
    }

    /**
     * Clear all configuration and variation overrides
     */
    fun clearAllOverrides() {
        configOverrides.clear()
        variationOverrides.clear()
        flagCache.clear()
    }

    // MARK: - Private Methods

    private fun setupWebSocket() {
        try {
            val wsUrl = config.apiUrl.replace("http", "ws") + "/v1/stream"
            val request = Request.Builder()
                .url(wsUrl)
                .addHeader("Authorization", "Bearer ${config.sdkKey}")
                .build()

            webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    handleWebSocketMessage(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    logError("WebSocket failure", t)
                    // Attempt to reconnect after delay
                    scope.launch {
                        delay(5000)
                        setupWebSocket()
                    }
                }
            })
        } catch (e: Exception) {
            logError("Error setting up WebSocket", e)
        }
    }

    private fun handleWebSocketMessage(message: String) {
        try {
            val json = JSONObject(message)
            val flagKey = json.getString("flagKey")
            val enabled = json.getBoolean("enabled")
            val configuration = if (json.has("configuration")) {
                json.getJSONObject("configuration").toMap()
            } else null
            val variation = if (json.has("variation")) json.getString("variation") else null

            flagCache[flagKey] = CacheEntry(enabled, configuration, variation)
            updateFlagFlow()
        } catch (e: Exception) {
            logError("Error handling WebSocket message", e)
        }
    }

    private fun startPolling() {
        if (config.pollingInterval <= 0) return

        pollingJob = scope.launch {
            while (isActive) {
                delay(config.pollingInterval)
                refreshFlags()
            }
        }
    }

    private suspend fun refreshFlags() {
        try {
            val url = "${config.apiUrl}/v1/flags"
            val request = Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer ${config.sdkKey}")
                .build()

            val response = okHttpClient.newCall(request).execute()

            if (response.isSuccessful) {
                val body = response.body?.string() ?: ""
                val json = JSONObject(body)
                val flags = json.getJSONArray("flags")

                for (i in 0 until flags.length()) {
                    val flag = flags.getJSONObject(i)
                    val key = flag.getString("key")
                    val enabled = flag.getBoolean("enabled")
                    val configuration = if (flag.has("configuration")) {
                        flag.getJSONObject("configuration").toMap()
                    } else null
                    val variation = if (flag.has("variation")) flag.getString("variation") else null
                    flagCache[key] = CacheEntry(enabled, configuration, variation)
                }

                updateFlagFlow()
            }
        } catch (e: Exception) {
            logError("Error refreshing flags", e)
        }
    }

    private fun updateFlagFlow() {
        _flagUpdates.value = flagCache.mapValues { it.value.value }
    }

    private fun logError(message: String, throwable: Throwable? = null) {
        if (config.enableLogging) {
            Log.e(TAG, message, throwable)
        }
    }

    /**
     * Merge two configuration maps (for partial overrides)
     * Deep merge where override values take precedence
     */
    @Suppress("UNCHECKED_CAST")
    private fun mergeConfigurations(base: Map<String, Any>, override: Map<String, Any>): Map<String, Any> {
        val result = base.toMutableMap()

        for ((key, overrideValue) in override) {
            val baseValue = result[key]

            if (baseValue is Map<*, *> && overrideValue is Map<*, *>) {
                // Recursively merge nested maps
                result[key] = mergeConfigurations(
                    baseValue as Map<String, Any>,
                    overrideValue as Map<String, Any>
                )
            } else {
                // Override the value
                result[key] = overrideValue
            }
        }

        return result
    }

    companion object {
        private const val TAG = "SavvagentClient"
    }
}

/**
 * Exception thrown by the Savvagent SDK
 */
class SavvagentException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Extension function to convert JSONObject to Map
 */
private fun JSONObject.toMap(): Map<String, Any> {
    val map = mutableMapOf<String, Any>()
    keys().forEach { key ->
        val value = get(key)
        map[key] = when (value) {
            is JSONObject -> value.toMap()
            is org.json.JSONArray -> {
                val list = mutableListOf<Any>()
                for (i in 0 until value.length()) {
                    list.add(value.get(i))
                }
                list
            }
            else -> value
        }
    }
    return map
}

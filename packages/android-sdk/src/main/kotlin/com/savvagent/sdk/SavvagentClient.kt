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

    private val flagCache = ConcurrentHashMap<String, Boolean>()
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
     * Check if a feature flag is enabled for a given user context
     */
    suspend fun isEnabled(flagKey: String, userContext: UserContext): Result<Boolean> {
        return withContext(Dispatchers.IO) {
            try {
                // Check cache first
                flagCache[flagKey]?.let {
                    return@withContext Result.success(it)
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

                // Update cache
                flagCache[flagKey] = enabled
                updateFlagFlow()

                Result.success(enabled)
            } catch (e: Exception) {
                logError("Error checking flag: $flagKey", e)
                Result.failure(e)
            }
        }
    }

    /**
     * Get a variation value for a feature flag
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

            flagCache[flagKey] = enabled
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
                    flagCache[key] = enabled
                }

                updateFlagFlow()
            }
        } catch (e: Exception) {
            logError("Error refreshing flags", e)
        }
    }

    private fun updateFlagFlow() {
        _flagUpdates.value = flagCache.toMap()
    }

    private fun logError(message: String, throwable: Throwable? = null) {
        if (config.enableLogging) {
            Log.e(TAG, message, throwable)
        }
    }

    companion object {
        private const val TAG = "SavvagentClient"
    }
}

/**
 * Exception thrown by the Savvagent SDK
 */
class SavvagentException(message: String, cause: Throwable? = null) : Exception(message, cause)

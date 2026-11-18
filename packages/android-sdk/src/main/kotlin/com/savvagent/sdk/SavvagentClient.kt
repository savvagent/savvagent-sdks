package com.savvagent.sdk

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.Call
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSource
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Default base URL of the Savvagent Flags API gateway.
 */
const val DEFAULT_API_URL = "https://api.savvagent.com/flags"

/**
 * Configuration for the Savvagent SDK client
 *
 * @property apiUrl Base URL of the Flags API. Trailing slashes are ignored.
 * @property pollingInterval How often (ms) the environment flag list is re-fetched. 0 disables polling.
 * @property enableWebSocket Enables realtime flag updates. Realtime now uses Server-Sent Events
 *   (the server has no WebSocket endpoint); the property name is kept for source compatibility.
 * @property enableTelemetry Batch and report evaluations and errors to the telemetry endpoints.
 */
data class SavvagentConfig(
    val apiUrl: String = DEFAULT_API_URL,
    val sdkKey: String,
    val environment: String = "production",
    val pollingInterval: Long = 60_000L, // milliseconds
    val enableWebSocket: Boolean = true,
    val timeout: Long = 30_000L, // milliseconds
    val enableLogging: Boolean = false,
    val enableTelemetry: Boolean = true
)

/**
 * User context for feature flag evaluation.
 *
 * Serialized using the server's snake_case context fields.
 */
data class UserContext(
    val userId: String,
    val attributes: Map<String, Any> = emptyMap(),
    val anonymousId: String? = null,
    val sessionId: String? = null,
    val language: String? = null,
    val organizationId: String? = null,
    val applicationId: String? = null
) {
    fun toJson(environment: String? = null): JSONObject {
        return JSONObject().apply {
            put("user_id", userId)
            anonymousId?.let { put("anonymous_id", it) }
            sessionId?.let { put("session_id", it) }
            environment?.let { put("environment", it) }
            language?.let { put("language", it) }
            organizationId?.let { put("organization_id", it) }
            applicationId?.let { put("application_id", it) }
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
 * Listener notified when the server reports that a flag was created, updated or deleted.
 */
fun interface FlagChangeListener {
    /**
     * @param flagKey the flag that changed
     * @param eventType one of "flag.created", "flag.updated", "flag.deleted"
     */
    fun onFlagChanged(flagKey: String, eventType: String)
}

/**
 * Cache entry for flag values
 */
private data class CacheEntry(
    val value: Boolean,
    val configuration: Map<String, Any>? = null,
    val variation: String? = null,
    val userDigest: String? = null,
    val version: Long = -1L
) {
    /** Recency stamp for least-recently-used eviction; not part of equality. */
    @Volatile var lastUsed: Long = 0L
}

/** Default cap on the evaluation cache, counted across all flags. */
internal const val DEFAULT_MAX_CACHE_ENTRIES = 10_000

/**
 * Environment-level flag state from the bulk endpoint (master switch, not per-user)
 */
private data class EnvironmentFlag(
    val enabled: Boolean,
    val version: Long
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
    private val baseUrl: String = config.apiUrl.trimEnd('/')

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .readTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .writeTimeout(config.timeout, TimeUnit.MILLISECONDS)
        .apply {
            if (config.enableLogging) {
                addInterceptor(okhttp3.logging.HttpLoggingInterceptor().apply {
                    level = okhttp3.logging.HttpLoggingInterceptor.Level.BASIC
                })
            }
        }
        .build()

    // The SSE stream is long-lived: no read timeout (server heartbeats every ~30s)
    private val streamClient: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    // Keyed by flag key only (one entry per flag, remembering a SHA-256 digest of the user it was evaluated for), so
    // no context-derived string is used as a key and there is no context JSON to digest. It is
    // bounded by a single total cap with least-recently-used eviction.
    private val flagCache = ConcurrentHashMap<String, CacheEntry>()
    private val cacheClock = java.util.concurrent.atomic.AtomicLong()

    /** Total cache cap across all flags. Internal so tests can use a small value. */
    @Volatile internal var maxCacheEntries: Int = DEFAULT_MAX_CACHE_ENTRIES

    /** Lowercase SHA-256 hex of the user id; the cache never holds the raw id. */
    internal fun userDigest(userId: String): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(userId.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    internal fun cachedUserDigests(): List<String?> = flagCache.values.map { it.userDigest }

    internal fun cachedFlagKeys(): Set<String> = flagCache.keys.toSet()

    private fun putCache(flagKey: String, entry: CacheEntry) {
        entry.lastUsed = cacheClock.incrementAndGet()
        flagCache[flagKey] = entry
        while (flagCache.size > maxCacheEntries) {
            val oldest = flagCache.entries.minByOrNull { it.value.lastUsed } ?: break
            flagCache.remove(oldest.key, oldest.value)
        }
    }

    private val environmentFlags = ConcurrentHashMap<String, EnvironmentFlag>()
    private val configOverrides = ConcurrentHashMap<String, ConfigOverrideEntry>()
    private val variationOverrides = ConcurrentHashMap<String, VariationOverrideEntry>()
    private val listeners = CopyOnWriteArraySet<FlagChangeListener>()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val closed = AtomicBoolean(false)

    private var streamJob: Job? = null
    private var pollingJob: Job? = null
    private var telemetryJob: Job? = null
    @Volatile private var streamCall: Call? = null
    @Volatile private var reconnectAttempt = 0

    private val telemetryLock = Any()
    private val evaluationQueue = ArrayDeque<JSONObject>()
    private val errorQueue = ArrayDeque<JSONObject>()

    private val _flagUpdates = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val flagUpdates: StateFlow<Map<String, Boolean>> = _flagUpdates

    init {
        if (config.enableWebSocket) {
            startRealtime()
        }
        startPolling()
        startTelemetry()
    }

    /**
     * Replaces control characters (CR, LF, tab and every other ISO control), Unicode line and
     * paragraph separators (U+2028, U+2029) and format characters (bidi overrides such as
     * U+202E) with `?` so an untrusted flag key cannot forge log lines (CWE-117) or reorder
     * how the message is displayed.
     */
    private fun sanitizeForMessage(text: String): String =
        text.map { if (isUnsafeForMessage(it)) '?' else it }.joinToString("")

    private fun isUnsafeForMessage(c: Char): Boolean =
        Character.isISOControl(c) || when (Character.getType(c).toByte()) {
            Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR, Character.FORMAT -> true
            else -> false
        }

    /**
     * Evaluate a feature flag and get full details (Phase 1 & 2)
     */
    suspend fun evaluate(flagKey: String, userContext: UserContext): Result<FlagEvaluationResult> {
        // Reject a key that is not one safe URL path segment before any request is built
        if (!isValidFlagKey(flagKey)) {
            val error = SavvagentException(
                "Invalid flag key \"${sanitizeForMessage(flagKey.take(64))}\" (length ${flagKey.length}): " +
                    "keys are 1-128 characters of [A-Za-z0-9._-] and not \".\" or \"..\""
            )
            logError(error.message ?: "Invalid flag key")
            return Result.failure(error)
        }
        return withContext(Dispatchers.IO) {
            try {
                // Check cache first (only valid for the same user)
                flagCache[flagKey]?.takeIf { it.userDigest == userDigest(userContext.userId) }?.let { cached ->
                    cached.lastUsed = cacheClock.incrementAndGet()
                    val result = applyOverrides(
                        flagKey, cached.value, cached.configuration, cached.variation, "cached"
                    )
                    recordEvaluation(result, userContext)
                    return@withContext Result.success(result)
                }

                // Fetch from API
                val url = apiUrl("api", "flags", flagKey, "evaluate")
                val body = JSONObject().put("context", userContext.toJson(config.environment))

                val request = Request.Builder()
                    .url(url)
                    .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                    .addHeader("Authorization", "Bearer ${config.sdkKey}")
                    .addHeader("Accept", "application/json")
                    .build()

                val jsonResponse = okHttpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        return@withContext Result.failure(
                            SavvagentException("Request failed with code: ${response.code}")
                        )
                    }
                    JSONObject(response.body?.string() ?: "")
                }

                // org.json's getBoolean also accepts the string "true"; require a real boolean
                val enabled = jsonResponse.opt("enabled") as? Boolean
                    ?: throw SavvagentException(
                        "Malformed evaluate response for flag \"${sanitizeForMessage(flagKey)}\": " +
                            "\"enabled\" is not a boolean"
                    )
                val configuration = jsonResponse.optJSONObject("configuration")?.toMap()
                val variation = jsonResponse.optStringOrNull("variation")
                val version = jsonResponse.optLong("version", -1L)

                // Update cache
                putCache(flagKey, CacheEntry(enabled, configuration, variation, userDigest(userContext.userId), version))
                updateFlagFlow()

                val result = applyOverrides(flagKey, enabled, configuration, variation, "evaluated")
                recordEvaluation(result, userContext)
                Result.success(result)
            } catch (e: CancellationException) {
                throw e
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
     * Get a variation value for a feature flag (legacy method - kept for backward compatibility).
     *
     * The server has no separate variation endpoint, so this evaluates the flag and returns the
     * variation name, or else the flag configuration, whichever has the same type as
     * [defaultValue]. Falls back to [defaultValue] on any error or type mismatch.
     */
    suspend fun <T> getVariation(
        flagKey: String,
        userContext: UserContext,
        defaultValue: T
    ): T {
        val result = evaluate(flagKey, userContext).getOrNull() ?: return defaultValue
        val candidates = listOf<Any?>(result.variation, result.configuration)
        for (candidate in candidates) {
            if (candidate != null && sameKind(candidate, defaultValue)) {
                @Suppress("UNCHECKED_CAST")
                return candidate as T
            }
        }
        return defaultValue
    }

    /**
     * Track an event for analytics.
     *
     * The Flags API has no custom-event endpoint, so this is a no-op kept for source
     * compatibility. Evaluations and errors are reported automatically (see [reportError]).
     */
    @Deprecated("The Flags API has no event endpoint; this call does nothing.")
    @Suppress("UNUSED_PARAMETER")
    suspend fun track(
        eventName: String,
        userContext: UserContext,
        properties: Map<String, Any> = emptyMap()
    ) {
        logDebug("track(\"$eventName\") ignored: the Flags API has no event endpoint")
    }

    /**
     * Report an error that occurred while a flag was in effect, so the server can compare
     * error rates with the flag on and off.
     */
    fun reportError(
        flagKey: String,
        error: Throwable,
        userContext: UserContext? = null,
        flagEnabled: Boolean? = null
    ) {
        if (!config.enableTelemetry || closed.get()) return
        val event = JSONObject().apply {
            put("flag_key", flagKey)
            flagEnabled?.let { put("flag_enabled", it) }
            put("error_type", error.javaClass.simpleName.ifEmpty { "Error" })
            put("error_message", error.message ?: error.toString())
            put("stack_trace", error.stackTraceToString().take(MAX_STACK_TRACE))
            put("environment", config.environment)
            put(
                "context",
                userContext?.toJson(config.environment)
                    ?: JSONObject().put("environment", config.environment)
            )
            put("timestamp", System.currentTimeMillis())
        }
        synchronized(telemetryLock) { enqueue(errorQueue, event) }
        // Errors are critical telemetry: flush immediately
        scope.launch { flushQueue(errorQueue, "errors", "errors") }
    }

    /**
     * Flush any pending telemetry (evaluations and errors) to the server.
     */
    suspend fun flush() {
        withContext(Dispatchers.IO) {
            flushTelemetry()
        }
    }

    /**
     * Re-fetch the environment flag list. Cached evaluations whose flag version changed are
     * discarded. Invoked periodically when [SavvagentConfig.pollingInterval] is positive.
     */
    suspend fun refresh(): Result<Unit> {
        return withContext(Dispatchers.IO) { refreshFlags() }
    }

    /**
     * Register a listener for server-pushed flag changes. Listeners run on a background thread.
     */
    fun addFlagChangeListener(listener: FlagChangeListener) {
        listeners.add(listener)
    }

    /**
     * Remove a previously registered listener.
     */
    fun removeFlagChangeListener(listener: FlagChangeListener) {
        listeners.remove(listener)
    }

    /**
     * Invalidate the cached value for one flag, or for all flags when [flagKey] is null.
     */
    fun invalidateCache(flagKey: String? = null) {
        if (flagKey == null) flagCache.clear() else flagCache.remove(flagKey)
        updateFlagFlow()
    }

    /**
     * Close the client and cleanup resources
     */
    fun close() {
        if (!closed.compareAndSet(false, true)) return

        streamCall?.cancel()
        streamJob?.cancel()
        pollingJob?.cancel()
        telemetryJob?.cancel()
        scope.cancel()

        // Best-effort final telemetry flush on a short-lived scope (never on the caller's thread)
        val pending = config.enableTelemetry && synchronized(telemetryLock) {
            evaluationQueue.isNotEmpty() || errorQueue.isNotEmpty()
        }
        if (pending) {
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    flushTelemetry()
                } catch (e: Exception) {
                    logError("Error flushing telemetry on close", e)
                }
            }
        }
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

    private fun apiUrl(vararg segments: String): HttpUrl {
        val builder = baseUrl.toHttpUrl().newBuilder()
        segments.forEach { builder.addPathSegment(it) }
        return builder.build()
    }

    private fun applyOverrides(
        flagKey: String,
        enabled: Boolean,
        configuration: Map<String, Any>?,
        variation: String?,
        reason: String
    ): FlagEvaluationResult {
        var finalConfig = configuration
        var finalVariation = variation

        configOverrides[flagKey]?.let { override ->
            finalConfig = if (override.merge && finalConfig != null) {
                mergeConfigurations(finalConfig!!, override.config)
            } else {
                override.config
            }
        }
        variationOverrides[flagKey]?.let { override ->
            finalVariation = override.variation
        }

        return FlagEvaluationResult(
            key = flagKey,
            value = enabled,
            configuration = finalConfig,
            variation = finalVariation,
            reason = reason
        )
    }

    private fun sameKind(candidate: Any, reference: Any?): Boolean {
        return when (reference) {
            null -> true
            is Map<*, *> -> candidate is Map<*, *>
            is List<*> -> candidate is List<*>
            is Number -> candidate is Number
            else -> reference.javaClass.isInstance(candidate)
        }
    }

    // MARK: Realtime (Server-Sent Events)

    private fun startRealtime() {
        streamJob = scope.launch {
            while (isActive) {
                try {
                    streamOnce()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (!isActive) break
                    logError("Realtime stream error", e)
                }
                if (!isActive) break
                delay(nextReconnectDelay())
            }
        }
    }

    private fun nextReconnectDelay(): Long {
        val attempt = reconnectAttempt
        reconnectAttempt = attempt + 1
        val exponential = RECONNECT_BASE_MS shl minOf(attempt, 5)
        return minOf(exponential, RECONNECT_MAX_MS)
    }

    private fun streamOnce() {
        val request = Request.Builder()
            .url(apiUrl("api", "flags", "stream"))
            .addHeader("Authorization", "Bearer ${config.sdkKey}")
            .addHeader("Accept", "text/event-stream")
            .addHeader("Cache-Control", "no-cache")
            .build()

        val call = streamClient.newCall(request)
        streamCall = call
        call.execute().use { response ->
            if (!response.isSuccessful) {
                throw SavvagentException("Stream request failed with code: ${response.code}")
            }
            val source = response.body?.source() ?: throw SavvagentException("Empty stream body")
            readEvents(source) { event, data -> handleStreamEvent(event, data) }
        }
        // Stream ended cleanly: the caller reconnects with backoff.
    }

    private fun readEvents(source: BufferedSource, onEvent: (String, String) -> Unit) {
        var event = "message"
        val data = StringBuilder()
        while (true) {
            val line = source.readUtf8Line() ?: break
            if (line.isEmpty()) {
                if (data.isNotEmpty() || event != "message") {
                    onEvent(event, data.toString())
                }
                event = "message"
                data.setLength(0)
                continue
            }
            if (line.startsWith(":")) continue // comment
            val idx = line.indexOf(':')
            val field = if (idx < 0) line else line.substring(0, idx)
            var value = if (idx < 0) "" else line.substring(idx + 1)
            if (value.startsWith(" ")) value = value.substring(1)
            when (field) {
                "event" -> event = value
                "data" -> {
                    if (data.isNotEmpty()) data.append('\n')
                    data.append(value)
                }
            }
        }
    }

    private fun handleStreamEvent(event: String, data: String) {
        when {
            event == "connected" -> {
                reconnectAttempt = 0
                logDebug("Realtime stream connected")
            }
            event == "heartbeat" -> Unit
            event.startsWith("flag.") -> {
                try {
                    val json = JSONObject(data)
                    val key = json.optStringOrNull("key") ?: return
                    val type = json.optStringOrNull("type") ?: event
                    flagCache.remove(key)
                    if (event == "flag.deleted") environmentFlags.remove(key)
                    updateFlagFlow()
                    listeners.forEach { listener ->
                        try {
                            listener.onFlagChanged(key, type)
                        } catch (e: Exception) {
                            logError("Flag change listener threw", e)
                        }
                    }
                } catch (e: Exception) {
                    logError("Error handling stream event: $event", e)
                }
            }
        }
    }

    // MARK: Polling (bulk environment fetch)

    private fun startPolling() {
        if (config.pollingInterval <= 0) return

        pollingJob = scope.launch {
            while (isActive) {
                refreshFlags()
                delay(config.pollingInterval)
            }
        }
    }

    private fun refreshFlags(): Result<Unit> {
        return try {
            val url = apiUrl("api", "sdk", "flags").newBuilder()
                .addQueryParameter("environment", config.environment)
                .build()
            val request = Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer ${config.sdkKey}")
                .addHeader("Accept", "application/json")
                .build()

            val json = okHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return Result.failure(SavvagentException("Request failed with code: ${response.code}"))
                }
                JSONObject(response.body?.string() ?: "")
            }

            val flags = json.optJSONArray("flags") ?: JSONArray()
            val fresh = HashMap<String, EnvironmentFlag>()
            for (i in 0 until flags.length()) {
                val flag = flags.getJSONObject(i)
                fresh[flag.getString("key")] = EnvironmentFlag(
                    enabled = flag.optBoolean("enabled", false),
                    version = flag.optLong("version", -1L)
                )
            }

            // Drop cached evaluations whose flag changed or disappeared
            for ((key, entry) in flagCache) {
                val latest = fresh[key]
                if (latest == null || (latest.version >= 0 && entry.version >= 0 && latest.version != entry.version)) {
                    flagCache.remove(key, entry)
                }
            }
            environmentFlags.clear()
            environmentFlags.putAll(fresh)
            updateFlagFlow()
            Result.success(Unit)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logError("Error refreshing flags", e)
            Result.failure(e)
        }
    }

    // MARK: Telemetry

    private fun startTelemetry() {
        if (!config.enableTelemetry) return

        telemetryJob = scope.launch {
            while (isActive) {
                delay(TELEMETRY_FLUSH_INTERVAL_MS)
                flushTelemetry()
            }
        }
    }

    private fun recordEvaluation(result: FlagEvaluationResult, userContext: UserContext) {
        if (!config.enableTelemetry || closed.get()) return
        val event = JSONObject().apply {
            put("flag_key", result.key)
            put("result", result.value)
            result.variation?.let { put("variation", it) }
            put("environment", config.environment)
            put("context", userContext.toJson(config.environment))
            put("timestamp", System.currentTimeMillis())
        }
        val flushNow = synchronized(telemetryLock) {
            enqueue(evaluationQueue, event)
            evaluationQueue.size >= TELEMETRY_BATCH_SIZE
        }
        if (flushNow) {
            scope.launch { flushQueue(evaluationQueue, "evaluations", "evaluations") }
        }
    }

    // Must be called while holding telemetryLock
    private fun enqueue(queue: ArrayDeque<JSONObject>, event: JSONObject) {
        queue.addLast(event)
        while (queue.size > TELEMETRY_MAX_QUEUE) queue.removeFirst()
    }

    private fun flushTelemetry() {
        flushQueue(evaluationQueue, "evaluations", "evaluations")
        flushQueue(errorQueue, "errors", "errors")
    }

    /**
     * Send queued events in batches of at most [TELEMETRY_MAX_BATCH]. On a transient failure the
     * batch is put back at the head of the queue.
     */
    private fun flushQueue(queue: ArrayDeque<JSONObject>, path: String, field: String) {
        while (true) {
            val batch = synchronized(telemetryLock) {
                val n = minOf(queue.size, TELEMETRY_MAX_BATCH)
                List(n) { queue.removeFirst() }
            }
            if (batch.isEmpty()) return

            if (!postTelemetry(path, field, batch)) {
                synchronized(telemetryLock) {
                    batch.asReversed().forEach { queue.addFirst(it) }
                    while (queue.size > TELEMETRY_MAX_QUEUE) queue.removeFirst()
                }
                return
            }
        }
    }

    /**
     * @return true if the batch was delivered or must be dropped; false if it should be retried
     */
    private fun postTelemetry(path: String, field: String, batch: List<JSONObject>): Boolean {
        return try {
            val body = JSONObject().put(field, JSONArray(batch))
            val request = Request.Builder()
                .url(apiUrl("api", "telemetry", path))
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .addHeader("Authorization", "Bearer ${config.sdkKey}")
                .build()

            okHttpClient.newCall(request).execute().use { response ->
                val code = response.code
                when {
                    response.isSuccessful -> true
                    code in 400..499 && code != 408 && code != 429 -> {
                        logError("Telemetry batch rejected with code $code; dropping ${batch.size} events")
                        true
                    }
                    else -> {
                        logError("Telemetry request failed with code $code; will retry")
                        false
                    }
                }
            }
        } catch (e: Exception) {
            logError("Error sending telemetry", e)
            false
        }
    }

    private fun updateFlagFlow() {
        val merged = HashMap<String, Boolean>()
        environmentFlags.forEach { (key, flag) -> merged[key] = flag.enabled }
        flagCache.forEach { (key, entry) -> merged[key] = entry.value }
        _flagUpdates.value = merged
    }

    private fun logError(message: String, throwable: Throwable? = null) {
        if (config.enableLogging) {
            Log.e(TAG, message, throwable)
        }
    }

    private fun logDebug(message: String) {
        if (config.enableLogging) {
            Log.d(TAG, message)
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
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        private const val RECONNECT_BASE_MS = 1_000L
        private const val RECONNECT_MAX_MS = 30_000L

        private const val TELEMETRY_FLUSH_INTERVAL_MS = 5_000L
        private const val TELEMETRY_BATCH_SIZE = 50
        private const val TELEMETRY_MAX_BATCH = 1000 // server limit per request
        private const val TELEMETRY_MAX_QUEUE = 5_000
        private const val MAX_STACK_TRACE = 8_000
    }
}

/**
 * Exception thrown by the Savvagent SDK
 */
class SavvagentException(message: String, cause: Throwable? = null) : Exception(message, cause)

private val FLAG_KEY_PATTERN = Regex("^[A-Za-z0-9._-]{1,128}$")

/**
 * Whether [key] is a valid flag key: 1-128 characters of `[A-Za-z0-9._-]`, and not `.` or `..`.
 * This is the server's key rule, shared by every Savvagent SDK. The key becomes one segment of
 * the evaluate URL path: `.` and `..` cannot be carried in a path (they are normalized away),
 * and characters such as `/`, `?` and `#` would send the request, and the SDK key with it, to
 * another endpoint.
 */
internal fun isValidFlagKey(key: String): Boolean =
    key != "." && key != ".." && FLAG_KEY_PATTERN.matches(key)

private fun JSONObject.optStringOrNull(name: String): String? {
    return if (has(name) && !isNull(name)) getString(name) else null
}

private fun Any?.toKotlinValue(): Any? = when (this) {
    null, JSONObject.NULL -> null
    is JSONObject -> toMap()
    is JSONArray -> {
        val list = mutableListOf<Any>()
        for (i in 0 until length()) {
            get(i).toKotlinValue()?.let { list.add(it) }
        }
        list
    }
    else -> this
}

/**
 * Extension function to convert JSONObject to Map (JSON nulls are omitted)
 */
private fun JSONObject.toMap(): Map<String, Any> {
    val map = mutableMapOf<String, Any>()
    keys().forEach { key ->
        get(key).toKotlinValue()?.let { map[key] = it }
    }
    return map
}

use crate::backoff::{parse_retry_after, Backoff, Scope};
use crate::cache::{context_key, Cache};
use crate::realtime::{stream_url, Realtime, StreamTarget, IDLE_TIMEOUT};
use crate::telemetry::Telemetry;
use crate::types::{
    Config, ConfigOverrideEntry, ConfigOverrideOptions, Context, ErrorReport, EvaluationResult,
    Metadata, VariationOverrideEntry, VariationResult,
};
use reqwest::Client as HttpClient;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SavvagentFlagsError {
    #[error("Invalid API key: must start with 'sdk_' (client key) or 'srv_' (server key)")]
    InvalidApiKey,

    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("API error: {0}")]
    ApiError(String),
}

/// Whether the server could hold this flag key, and a URL path can address it.
///
/// Mirrors the server's key rule (1-128 ASCII letters, digits, `-`, `_`, `.`; `validate_key` in
/// `crates/flags-core/src/flags.rs`), so refusing anything else loses no flag. `.` and `..` pass
/// that rule but no URL can carry them as a path segment (the `url` crate drops them, and
/// WHATWG parsing treats `%2e` as a dot segment), so they would reach another endpoint (#95).
pub(crate) fn is_valid_flag_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key != "."
        && key != ".."
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// The most of an evaluate response the SDK reads; a larger body is a failed lookup.
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

/// The largest evaluate request body the SDK sends, ample for user attributes. A larger one is
/// refused before sending, as a failure of this request (no cooldown). Host code builds the
/// context from end-user input, and the server echoes it, so a large one could otherwise fail
/// mid-upload or time out as a transport error, which pauses every flag for every user.
const MAX_REQUEST_BYTES: usize = 64 * 1024;

/// Why a lookup fell back, for the log and the cooldown.
struct Failure {
    why: String,
    /// The server refused the SDK key (401).
    rejected_key: bool,
    /// Whom the cooldown after this failure covers.
    scope: Scope,
    /// The server's `Retry-After` on a 429 or 503.
    retry_after: Option<Duration>,
}

impl Failure {
    fn new(why: impl Into<String>) -> Self {
        Self {
            why: why.into(),
            rejected_key: false,
            scope: Scope::Client,
            retry_after: None,
        }
    }

    /// A failure caused by this request's own content: it opens no cooldown.
    fn request(why: impl Into<String>) -> Self {
        Self {
            scope: Scope::Request,
            ..Self::new(why)
        }
    }
}

/// Whom the cooldown after a non-2xx answer covers (see `crate::backoff`).
fn failure_scope(status: reqwest::StatusCode) -> Scope {
    match status.as_u16() {
        // The server answers 404 for a key with no active flag: only that flag waits.
        404 => Scope::Flag,
        // A rejected key, a timeout, rate limiting: the client as a whole should wait.
        401 | 408 | 429 => Scope::Client,
        // Any other 4xx refuses this request's content (a context the host built from end-user
        // input); it says nothing about the service, so it opens no window. That includes 403:
        // the server answers 401 for every key problem, so a 403 comes from something in
        // between, such as a WAF blocking a request for what its context contains.
        400..=499 => Scope::Request,
        _ => Scope::Client,
    }
}

/// Read a response body of at most `cap` bytes: checked against `Content-Length` before reading,
/// and against the bytes read so far otherwise, so no more than the cap plus one chunk is held.
async fn read_capped(mut response: reqwest::Response, cap: usize) -> Result<Vec<u8>, Failure> {
    // The server echoes the context, so a large one can push the response over the cap: the
    // failure belongs to this request (`Scope::Request`).
    let too_large = || Failure::request(format!("the body is larger than {cap} bytes"));
    if response
        .content_length()
        .is_some_and(|len| len > cap as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if body.len() + chunk.len() > cap {
                    return Err(too_large());
                }
                body.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(body),
            // A timeout or reset while reading the body.
            Err(e) => {
                return Err(Failure::new(format!(
                    "reading the body failed: {}",
                    e.without_url()
                )))
            }
        }
    }
}

/// Savvagent Flags FlagClient for server-side feature flag evaluation
#[derive(Clone)]
pub struct FlagClient {
    config: Arc<Config>,
    http_client: HttpClient,
    cache: Cache,
    backoff: Backoff,
    telemetry: Telemetry,
    realtime: Realtime,
    stream: Option<StreamTarget>,
    /// Set by `FlagClient::static_flags`: the values served instead of any lookup.
    fixed: Option<Arc<HashMap<String, bool>>>,
    config_overrides: Arc<RwLock<HashMap<String, ConfigOverrideEntry>>>,
    variation_overrides: Arc<RwLock<HashMap<String, VariationOverrideEntry>>>,
}

impl FlagClient {
    /// Create a new FlagClient with the given configuration
    pub fn new(mut config: Config) -> Result<Self, SavvagentFlagsError> {
        // Routes are appended to the base URL, so any trailing slashes would double up.
        let trimmed = config.base_url.trim_end_matches('/').len();
        config.base_url.truncate(trimmed);

        // Validate API key: the public client key or the secret server key, which the SDK
        // guide recommends for server-side SDKs (and whose telemetry drives auto-rollback).
        if !(config.api_key.starts_with("sdk_") || config.api_key.starts_with("srv_")) {
            return Err(SavvagentFlagsError::InvalidApiKey);
        }

        // The server key is a secret: warn when it would cross the network in clear text.
        if config.api_key.starts_with("srv_") {
            if let Ok(url) = reqwest::Url::parse(&config.base_url) {
                let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
                if url.scheme() != "https" && !loopback {
                    tracing::warn!(
                        "Savvagent Flags: the server key will be sent over {}; use an https base_url",
                        url.scheme()
                    );
                }
            }
        }

        let http_client = HttpClient::builder()
            .timeout(config.timeout)
            .build()
            .map_err(SavvagentFlagsError::RequestFailed)?;

        let cache = Cache::new(config.cache_ttl);
        let backoff = Backoff::new(config.failure_cooldown);
        let telemetry = Telemetry::new(
            http_client.clone(),
            config.base_url.clone(),
            config.api_key.clone(),
            config.enable_telemetry,
        );

        // The stream is one long-lived response: it gets a connect timeout but no total one.
        let stream = if config.enable_realtime {
            let http = HttpClient::builder()
                .connect_timeout(config.timeout)
                // A redirect is a refused attempt, not a reason to send the key elsewhere.
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(SavvagentFlagsError::RequestFailed)?;
            match stream_url(&config.base_url) {
                Some(url) => Some(StreamTarget {
                    cache: cache.clone(),
                    http,
                    url,
                    api_key: config.api_key.clone(),
                    header_timeout: IDLE_TIMEOUT,
                }),
                None => {
                    tracing::warn!(
                        "Savvagent Flags: base_url is not a valid URL; real-time updates are off"
                    );
                    None
                }
            }
        } else {
            None
        };
        let realtime = Realtime::new();
        if let Some(target) = &stream {
            realtime.ensure_started(target);
        }

        tracing::info!("Savvagent Flags FlagClient initialized");

        Ok(Self {
            config: Arc::new(config),
            http_client,
            cache,
            backoff,
            telemetry,
            realtime,
            stream,
            fixed: None,
            config_overrides: Arc::new(RwLock::new(HashMap::new())),
            variation_overrides: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// A client that serves fixed flag values and never touches the network, for tests.
    ///
    /// Each flag in `flags` evaluates to its value, any other flag to `false`; `evaluate` reports
    /// `reason: "static"`. No request is made, nothing is reported, no stream is opened and no
    /// background task is started, so it works outside a Tokio runtime. Config and variation
    /// overrides still apply, which lets a test exercise code that reads them. It is not for
    /// production use: it ignores the server entirely.
    ///
    /// # Panics
    ///
    /// If the HTTP client cannot be built, which `FlagClient::new` also needs (for example a
    /// host where the TLS backend fails to initialise).
    ///
    /// ```
    /// use savvagent_flags::FlagClient;
    ///
    /// let client = FlagClient::static_flags([("new-checkout", true)]);
    /// assert!(client.is_enabled_cached("new-checkout", None));
    /// assert!(!client.is_enabled_cached("anything-else", None));
    /// ```
    pub fn static_flags<K, I>(flags: I) -> Self
    where
        K: Into<String>,
        I: IntoIterator<Item = (K, bool)>,
    {
        let config = Config::new("sdk_static")
            .with_telemetry(false)
            .with_realtime(false);
        let mut client =
            Self::new(config).expect("the HTTP client of a static client failed to build");
        client.fixed = Some(Arc::new(
            flags.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        ));
        client
    }

    /// Evaluate a feature flag
    ///
    /// Results are cached for `Config::cache_ttl` per flag key and evaluation context (the
    /// context as sent, after `application_id` is filled in): a different context, such as
    /// another user or other attributes, is evaluated by the server.
    ///
    /// A lookup does not return `Err`. Any failure (an invalid flag key or `base_url`, the
    /// server unreachable or timing out, a non-2xx status, a response that is not the evaluate
    /// response) gives the flag's configured default with `reason: "error"`, is logged (at
    /// `error` when the server refuses the SDK key, else `warn`), and is not cached. Config and
    /// variation overrides are not applied to such a fallback. The `Result` is kept for
    /// compatibility.
    ///
    /// After a failed lookup, lookups return the default without a request for
    /// `Config::failure_cooldown` (see there for which lookups it covers), and a window logs one
    /// warning (plus one per lookup already in flight when it opened). A cached answer is still
    /// served. The response body is read up to 1 MiB; a larger one is a failed lookup.
    pub async fn evaluate(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<EvaluationResult, SavvagentFlagsError> {
        // A key no flag can have would only change which endpoint the request (and its SDK
        // key) reaches; it gets its default without a request.
        if !is_valid_flag_key(flag_key) {
            // Host code may build keys from input: log a bounded, escaped prefix.
            let shown: String = flag_key.chars().take(64).collect();
            tracing::warn!(
                "Flag key {:?} ({} bytes) is not a valid flag key; using its default",
                shown,
                flag_key.len()
            );
            return self.get_default_result(flag_key);
        }

        if let Some(fixed) = &self.fixed {
            let value = fixed.get(flag_key).copied().unwrap_or(false);
            let (mut configuration, mut variation) = (None, None);
            self.apply_overrides(flag_key, &mut configuration, &mut variation);
            return Ok(EvaluationResult {
                key: flag_key.to_string(),
                value,
                configuration,
                variation,
                reason: "static".to_string(),
                metadata: None,
            });
        }

        // Starts the stream task on the first lookup inside a runtime (a client built outside
        // one has none yet); afterwards this is one atomic load.
        if let Some(target) = &self.stream {
            self.realtime.ensure_started(target);
        }

        // Prepare context: the cache key and the request body use the same one.
        let mut ctx = context.unwrap_or_default();
        if ctx.application_id.is_none() {
            ctx.application_id = self.config.application_id.clone();
        }
        let ctx_key = context_key(&ctx);

        // Check cache first
        if let Some(cached_entry) = ctx_key
            .as_deref()
            .and_then(|key| self.cache.get_entry(flag_key, key))
        {
            // Report the server's answer, not an override applied on top of it.
            self.telemetry.track_evaluation(
                flag_key,
                cached_entry.value,
                cached_entry.variation.as_deref(),
                ctx.environment.as_deref(),
            );

            let mut configuration = cached_entry.configuration.clone();
            let mut variation = cached_entry.variation.clone();

            self.apply_overrides(flag_key, &mut configuration, &mut variation);

            tracing::debug!(
                "Flag '{}' returned from cache: {}",
                flag_key,
                cached_entry.value
            );
            return Ok(EvaluationResult {
                key: flag_key.to_string(),
                value: cached_entry.value,
                configuration,
                variation,
                reason: "cached".to_string(),
                metadata: cached_entry.metadata.clone(),
            });
        }

        if let Some(left) = self.backoff.remaining(flag_key, Instant::now()) {
            tracing::debug!(
                "Flag {:?} lookup skipped: backing off for {:?} after a failed lookup; using its default",
                flag_key,
                left
            );
            return self.get_default_result(flag_key);
        }

        // Read before the request: an invalidation while it is in flight drops this result.
        let generation = self.cache.generation(flag_key);

        let data = match self.fetch(flag_key, &ctx).await {
            Ok(data) => data,
            Err(failure) => {
                let window = self.backoff.record(
                    flag_key,
                    failure.scope,
                    failure.retry_after,
                    Instant::now(),
                );
                let next = if window.is_zero() {
                    String::new()
                } else {
                    format!("; next lookup in {window:?}")
                };
                // A rejected key is a misconfiguration that will not heal by itself.
                if failure.rejected_key {
                    tracing::error!(
                        "Flag {:?} lookup failed ({}): check the SDK key; using its default{}",
                        flag_key,
                        failure.why,
                        next
                    );
                } else {
                    tracing::warn!(
                        "Flag {:?} lookup failed ({}); using its default{}",
                        flag_key,
                        failure.why,
                        next
                    );
                }
                return self.get_default_result(flag_key);
            }
        };
        let value = data["enabled"].as_bool().unwrap_or_default();

        // The server always sends the key, as `null` when the flag has no configuration;
        // `null` means absent (`object?` in docs/SDK-DEVELOPER-GUIDE.md).
        let mut configuration = data.get("configuration").filter(|v| !v.is_null()).cloned();
        let mut variation = data["variation"].as_str().map(String::from);

        // Report the server's answer, not an override applied on top of it.
        self.telemetry.track_evaluation(
            flag_key,
            value,
            variation.as_deref(),
            ctx.environment.as_deref(),
        );

        let metadata = Metadata {
            version: data["version"].as_i64(),
            scope: data["scope"].as_str().map(String::from),
            ..Metadata::default()
        };

        // Cache the result (including configuration, variation and metadata) for this context
        if let Some(key) = ctx_key {
            self.cache.set_at(
                generation,
                flag_key,
                key,
                value,
                configuration.clone(),
                variation.clone(),
                Some(metadata.clone()),
            );
        }

        // Apply overrides to evaluated result
        self.apply_overrides(flag_key, &mut configuration, &mut variation);

        tracing::debug!("Flag '{}' evaluated: {}", flag_key, value);

        Ok(EvaluationResult {
            key: flag_key.to_string(),
            value,
            configuration,
            variation,
            reason: "evaluated".to_string(),
            metadata: Some(metadata),
        })
    }

    /// Replace `configuration` and `variation` with the overrides set for the flag, if any.
    fn apply_overrides(
        &self,
        flag_key: &str,
        configuration: &mut Option<serde_json::Value>,
        variation: &mut Option<String>,
    ) {
        if let Ok(config_overrides) = self.config_overrides.read() {
            if let Some(config_override) = config_overrides.get(flag_key) {
                *configuration = match (config_override.merge, configuration.take()) {
                    (true, Some(base)) => {
                        Some(self.merge_configurations(&base, &config_override.config))
                    }
                    _ => Some(config_override.config.clone()),
                };
            }
        }

        if let Ok(variation_overrides) = self.variation_overrides.read() {
            if let Some(variation_override) = variation_overrides.get(flag_key) {
                *variation = Some(variation_override.variation.clone());
            }
        }
    }

    /// POST the evaluate request and return the response body, which is known to carry a
    /// boolean `enabled`; or why not, for the log.
    async fn fetch(&self, flag_key: &str, ctx: &Context) -> Result<serde_json::Value, Failure> {
        let url = self
            .evaluate_url(flag_key)
            .map_err(|e| Failure::new(e.to_string()))?;
        let body = serde_json::to_vec(&json!({ "context": ctx }))
            .map_err(|_| Failure::request("the context cannot be serialized"))?;
        if body.len() > MAX_REQUEST_BYTES {
            return Err(Failure::request(format!(
                "the context is larger than {MAX_REQUEST_BYTES} bytes"
            )));
        }
        let response = self
            .http_client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            // The URL is already in the log line's context; drop it from the error text.
            .map_err(|e| Failure::new(format!("request failed: {}", e.without_url())))?;
        let status = response.status();
        if !status.is_success() {
            let retry_after = if matches!(status.as_u16(), 429 | 503) {
                response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_retry_after)
            } else {
                None
            };
            return Err(Failure {
                why: format!("status {status}"),
                // The server answers 401 for every key problem; a 403 comes from something in
                // between and is logged as an ordinary failure.
                rejected_key: status == reqwest::StatusCode::UNAUTHORIZED,
                scope: failure_scope(status),
                retry_after,
            });
        }
        let bytes = read_capped(response, MAX_RESPONSE_BYTES).await?;
        let data: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| Failure::new("the body is not JSON"))?;
        if !data["enabled"].is_boolean() {
            return Err(Failure::new("the body has no boolean `enabled`"));
        }
        Ok(data)
    }

    /// `<base_url>/api/flags/<key>/evaluate`, with the key as one encoded path segment and any
    /// path prefix in `base_url` kept.
    fn evaluate_url(&self, flag_key: &str) -> Result<reqwest::Url, SavvagentFlagsError> {
        let mut url = reqwest::Url::parse(&self.config.base_url)
            .map_err(|e| SavvagentFlagsError::ApiError(format!("invalid base_url: {e}")))?;
        url.path_segments_mut()
            .map_err(|()| {
                SavvagentFlagsError::ApiError("invalid base_url: cannot be a base".into())
            })?
            .pop_if_empty()
            .extend(["api", "flags", flag_key, "evaluate"]);
        Ok(url)
    }

    /// Report an error the host raised while a flag was in play, for flag health and
    /// auto-rollback. It is queued and sent in a batch; it never blocks or fails. Does nothing
    /// when telemetry is off (`Config::with_telemetry(false)`).
    pub fn track_error(&self, report: ErrorReport) {
        self.telemetry.track_error(report);
    }

    /// Send all queued telemetry now. Call it before the process exits: queued events are
    /// otherwise sent every few seconds by a background task, and lost at exit. Failures are
    /// logged, never returned; against an unreachable server it can take up to
    /// `Config::timeout` per batch.
    pub async fn flush(&self) {
        self.telemetry.flush().await;
    }

    /// Check if a flag is enabled (convenience method); the default on any failure
    pub async fn is_enabled(&self, flag_key: &str, context: Option<Context>) -> bool {
        match self.evaluate(flag_key, context).await {
            Ok(result) => result.value,
            Err(e) => {
                tracing::error!("Error evaluating flag '{}': {}", flag_key, e);
                self.config.defaults.get(flag_key).copied().unwrap_or(false)
            }
        }
    }

    /// Read a flag from the cache without waiting, for code that cannot be `async`.
    ///
    /// It makes no request and does not wait: it returns the unexpired
    /// cached value for this flag and context (the same context passed to an earlier `evaluate`
    /// or `is_enabled`, since the cache is per context), and otherwise the flag's configured
    /// default (`Config::with_default`, else `false`). A flag that has never been looked up, one
    /// whose entry has outlived `Config::cache_ttl`, and one invalidated by the stream are all
    /// misses, so something must keep the cache warm: call `evaluate` or `is_enabled` from async
    /// code on the same context at least once per TTL. A hit is counted as an evaluation in
    /// telemetry, as a cached `evaluate` is; a miss is not. On a client from
    /// [`FlagClient::static_flags`] it returns the fixed value.
    ///
    /// Config and variation overrides never change the answer (they do not change a flag's
    /// value in `evaluate` either).
    ///
    /// ```
    /// use savvagent_flags::{Config, FlagClient};
    ///
    /// let client = FlagClient::new(Config::new("sdk_key").with_default("new-banner", true)).unwrap();
    /// // Nothing is cached yet, so this is the configured default.
    /// assert!(client.is_enabled_cached("new-banner", None));
    /// ```
    pub fn is_enabled_cached(&self, flag_key: &str, context: Option<&Context>) -> bool {
        // As `evaluate` does, a key no flag can have gets its default.
        if !is_valid_flag_key(flag_key) {
            return self.config.defaults.get(flag_key).copied().unwrap_or(false);
        }
        if let Some(fixed) = &self.fixed {
            return fixed.get(flag_key).copied().unwrap_or(false);
        }
        let mut ctx = context.cloned().unwrap_or_default();
        if ctx.application_id.is_none() {
            ctx.application_id = self.config.application_id.clone();
        }
        let entry = context_key(&ctx)
            .as_deref()
            .and_then(|key| self.cache.get_entry(flag_key, key));
        match entry {
            Some(entry) => {
                self.telemetry.track_evaluation(
                    flag_key,
                    entry.value,
                    entry.variation.as_deref(),
                    ctx.environment.as_deref(),
                );
                entry.value
            }
            None => self.config.defaults.get(flag_key).copied().unwrap_or(false),
        }
    }

    /// Get dynamic configuration for a flag (Phase 1)
    /// Returns configuration if flag is enabled, otherwise returns None. Like `evaluate`, a
    /// lookup failure falls back (to `None`) rather than returning `Err`.
    pub async fn get_config(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<Option<serde_json::Value>, SavvagentFlagsError> {
        let result = self.evaluate(flag_key, context).await?;

        if !result.value {
            return Ok(None);
        }

        Ok(result.configuration)
    }

    /// Get variation details for multi-variant flags (Phase 2)
    /// Returns variation name, enabled status, and configuration. Like `evaluate`, a lookup
    /// failure falls back (to `"control"` and the default) rather than returning `Err`.
    pub async fn get_variation(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<VariationResult, SavvagentFlagsError> {
        let result = self.evaluate(flag_key, context).await?;

        let variation = result.variation.unwrap_or_else(|| "control".to_string());

        Ok(VariationResult {
            variation,
            enabled: result.value,
            configuration: result.configuration,
        })
    }

    /// Invalidate cache for a specific flag (for every context) or all flags
    pub fn invalidate_cache(&self, flag_key: Option<&str>) {
        self.cache.invalidate(flag_key);
    }

    /// Clear all cached values
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    fn get_default_result(&self, flag_key: &str) -> Result<EvaluationResult, SavvagentFlagsError> {
        let default_value = self.config.defaults.get(flag_key).copied().unwrap_or(false);

        Ok(EvaluationResult {
            key: flag_key.to_string(),
            value: default_value,
            configuration: None,
            variation: None,
            reason: "error".to_string(),
            metadata: None,
        })
    }

    /// Set a configuration override for a flag
    /// Useful for testing different configuration values without server changes
    pub fn set_config_override(
        &self,
        flag_key: impl Into<String>,
        config: serde_json::Value,
        options: Option<ConfigOverrideOptions>,
    ) -> Result<(), SavvagentFlagsError> {
        let flag_key = flag_key.into();
        let opts = options.unwrap_or_default();

        // Validate JSON structure
        if opts.validate {
            serde_json::to_string(&config).map_err(|e| {
                SavvagentFlagsError::ApiError(format!(
                    "Invalid configuration for flag '{}': {}",
                    flag_key, e
                ))
            })?;
        }

        if let Ok(mut overrides) = self.config_overrides.write() {
            overrides.insert(
                flag_key.clone(),
                ConfigOverrideEntry {
                    config,
                    merge: opts.merge,
                    timestamp: SystemTime::now(),
                },
            );
        }

        // Invalidate cache to force re-evaluation with override
        self.invalidate_cache(Some(&flag_key));

        Ok(())
    }

    /// Clear configuration override for a flag
    pub fn clear_config_override(&self, flag_key: &str) {
        if let Ok(mut overrides) = self.config_overrides.write() {
            overrides.remove(flag_key);
        }

        // Invalidate cache to get fresh API values
        self.invalidate_cache(Some(flag_key));
    }

    /// Set a variation override for a multi-variant flag
    /// Forces the flag to return a specific variation
    pub fn set_variation_override(
        &self,
        flag_key: impl Into<String>,
        variation: impl Into<String>,
    ) {
        let flag_key = flag_key.into();
        let variation = variation.into();

        if let Ok(mut overrides) = self.variation_overrides.write() {
            overrides.insert(
                flag_key.clone(),
                VariationOverrideEntry {
                    variation,
                    timestamp: SystemTime::now(),
                },
            );
        }

        // Invalidate cache to force re-evaluation with override
        self.invalidate_cache(Some(&flag_key));
    }

    /// Clear variation override for a flag
    pub fn clear_variation_override(&self, flag_key: &str) {
        if let Ok(mut overrides) = self.variation_overrides.write() {
            overrides.remove(flag_key);
        }

        // Invalidate cache to get fresh API values
        self.invalidate_cache(Some(flag_key));
    }

    /// Check if a flag has a configuration override
    pub fn has_config_override(&self, flag_key: &str) -> bool {
        if let Ok(overrides) = self.config_overrides.read() {
            overrides.contains_key(flag_key)
        } else {
            false
        }
    }

    /// Check if a flag has a variation override
    pub fn has_variation_override(&self, flag_key: &str) -> bool {
        if let Ok(overrides) = self.variation_overrides.read() {
            overrides.contains_key(flag_key)
        } else {
            false
        }
    }

    /// Get all configuration overrides (for debugging/inspection)
    pub fn get_config_overrides(&self) -> HashMap<String, serde_json::Value> {
        if let Ok(overrides) = self.config_overrides.read() {
            overrides
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        json!({
                            "config": v.config,
                            "merge": v.merge,
                            "timestamp": v.timestamp,
                        }),
                    )
                })
                .collect()
        } else {
            HashMap::new()
        }
    }

    /// Get all variation overrides (for debugging/inspection)
    pub fn get_variation_overrides(&self) -> HashMap<String, serde_json::Value> {
        if let Ok(overrides) = self.variation_overrides.read() {
            overrides
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        json!({
                            "variation": v.variation,
                            "timestamp": v.timestamp,
                        }),
                    )
                })
                .collect()
        } else {
            HashMap::new()
        }
    }

    /// Clear all configuration and variation overrides
    pub fn clear_all_overrides(&self) {
        if let Ok(mut config_overrides) = self.config_overrides.write() {
            config_overrides.clear();
        }
        if let Ok(mut variation_overrides) = self.variation_overrides.write() {
            variation_overrides.clear();
        }

        self.clear_cache();
    }

    /// Merge two configuration objects (for partial overrides)
    /// Deep merge where override values take precedence
    fn merge_configurations(
        &self,
        base: &serde_json::Value,
        override_val: &serde_json::Value,
    ) -> serde_json::Value {
        match (base, override_val) {
            (serde_json::Value::Object(base_map), serde_json::Value::Object(override_map)) => {
                let mut result = base_map.clone();
                for (k, v) in override_map {
                    if let Some(base_v) = base_map.get(k) {
                        if base_v.is_object() && v.is_object() {
                            result.insert(k.clone(), self.merge_configurations(base_v, v));
                            continue;
                        }
                    }
                    result.insert(k.clone(), v.clone());
                }
                serde_json::Value::Object(result)
            }
            _ => override_val.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_valid_flag_key, FlagClient};
    use crate::types::Config;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn config(base_url: &str) -> Config {
        Config {
            api_key: "sdk_test".to_string(),
            base_url: base_url.to_string(),
            enable_realtime: false,
            enable_telemetry: false,
            ..Config::default()
        }
    }

    #[test]
    fn default_base_url_is_the_flags_api() {
        assert_eq!(
            Config::default().base_url,
            "https://api.savvagent.com/flags"
        );
    }

    #[test]
    fn trailing_slashes_are_removed_from_the_base_url() {
        let client = FlagClient::new(config("https://flags.example.com/flags//")).unwrap();
        assert_eq!(client.config.base_url, "https://flags.example.com/flags");
    }

    #[tokio::test]
    async fn evaluate_posts_to_the_canonical_route_and_reads_enabled() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/flags/api/flags/new-checkout/evaluate"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "key": "new-checkout",
                "enabled": true,
                "scope": "application",
                "variation": null,
                "configuration": null,
                "timestamp": 1_731_550_000,
                "version": 3,
                "context": {}
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = FlagClient::new(config(&format!("{}/flags//", server.uri()))).unwrap();
        assert!(client.is_enabled("new-checkout", None).await);
    }

    #[test]
    fn flag_keys_follow_the_server_rule_minus_dot_segments() {
        let longest = "k".repeat(128);
        let too_long = "k".repeat(129);
        for ok in ["a", "My.flag_1-x", "...", longest.as_str()] {
            assert!(is_valid_flag_key(ok), "{ok:?}");
        }
        for bad in [
            "",
            ".",
            "..",
            too_long.as_str(),
            "a/b",
            "a?b",
            "a#b",
            "a%2Fb",
            " a",
            "\u{e9}",
        ] {
            assert!(!is_valid_flag_key(bad), "{bad:?}");
        }
    }
}

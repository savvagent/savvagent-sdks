use crate::cache::Cache;
use crate::types::{Config, Context, EvaluationResult, Metadata};
use reqwest::Client as HttpClient;
use serde_json::json;
use std::sync::Arc;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SavvagentError {
    #[error("Invalid API key: must start with 'sdk_'")]
    InvalidApiKey,

    #[error("HTTP request failed: {0}")]
    RequestFailed(#[from] reqwest::Error),

    #[error("API error: {0}")]
    ApiError(String),
}

/// Savvagent FlagClient for server-side feature flag evaluation
#[derive(Clone)]
pub struct FlagClient {
    config: Arc<Config>,
    http_client: HttpClient,
    cache: Cache,
}

impl FlagClient {
    /// Create a new FlagClient with the given configuration
    pub fn new(config: Config) -> Result<Self, SavvagentError> {
        // Validate API key
        if !config.api_key.starts_with("sdk_") {
            return Err(SavvagentError::InvalidApiKey);
        }

        let http_client = HttpClient::builder()
            .timeout(config.timeout)
            .build()
            .map_err(SavvagentError::RequestFailed)?;

        let cache = Cache::new(config.cache_ttl);

        tracing::info!("Savvagent FlagClient initialized");

        Ok(Self {
            config: Arc::new(config),
            http_client,
            cache,
        })
    }

    /// Evaluate a feature flag
    pub async fn evaluate(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<EvaluationResult, SavvagentError> {
        // Check cache first
        if let Some(cached_value) = self.cache.get(flag_key) {
            tracing::debug!("Flag '{}' returned from cache: {}", flag_key, cached_value);
            return Ok(EvaluationResult {
                key: flag_key.to_string(),
                value: cached_value,
                reason: "cached".to_string(),
                metadata: None,
            });
        }

        // Prepare context
        let mut ctx = context.unwrap_or_default();
        if ctx.application_id.is_none() {
            ctx.application_id = self.config.application_id.clone();
        }

        // Make API request
        let url = format!("{}/api/evaluate/{}", self.config.base_url, flag_key);
        let body = json!({ "context": ctx });

        let response = self
            .http_client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_msg = format!("API error: {}", response.status());
            tracing::error!("{}", error_msg);
            return self.get_default_result(flag_key);
        }

        // Parse response
        let data: serde_json::Value = response.json().await?;

        let value = data["value"]
            .as_bool()
            .or_else(|| self.config.defaults.get(flag_key).copied())
            .unwrap_or(false);

        // Cache the result
        self.cache.set(flag_key.to_string(), value);

        let metadata = Metadata {
            flag_id: data["flag_id"].as_str().map(String::from),
            description: data["description"].as_str().map(String::from),
            variant: data["variant"].as_str().map(String::from),
        };

        tracing::debug!("Flag '{}' evaluated: {}", flag_key, value);

        Ok(EvaluationResult {
            key: flag_key.to_string(),
            value,
            reason: "evaluated".to_string(),
            metadata: Some(metadata),
        })
    }

    /// Check if a flag is enabled (convenience method)
    pub async fn is_enabled(&self, flag_key: &str, context: Option<Context>) -> bool {
        match self.evaluate(flag_key, context).await {
            Ok(result) => result.value,
            Err(e) => {
                tracing::error!("Error evaluating flag '{}': {}", flag_key, e);
                self.config.defaults.get(flag_key).copied().unwrap_or(false)
            }
        }
    }

    /// Invalidate cache for a specific flag or all flags
    pub fn invalidate_cache(&self, flag_key: Option<&str>) {
        self.cache.invalidate(flag_key);
    }

    /// Clear all cached values
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    fn get_default_result(&self, flag_key: &str) -> Result<EvaluationResult, SavvagentError> {
        let default_value = self.config.defaults.get(flag_key).copied().unwrap_or(false);

        Ok(EvaluationResult {
            key: flag_key.to_string(),
            value: default_value,
            reason: "error".to_string(),
            metadata: None,
        })
    }
}

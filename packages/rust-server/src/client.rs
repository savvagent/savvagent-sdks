use crate::cache::Cache;
use crate::types::{
    Config, ConfigOverrideEntry, ConfigOverrideOptions, Context, EvaluationResult, Metadata,
    VariationOverrideEntry, VariationResult,
};
use reqwest::Client as HttpClient;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
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
    config_overrides: Arc<RwLock<HashMap<String, ConfigOverrideEntry>>>,
    variation_overrides: Arc<RwLock<HashMap<String, VariationOverrideEntry>>>,
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
            config_overrides: Arc::new(RwLock::new(HashMap::new())),
            variation_overrides: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Evaluate a feature flag
    pub async fn evaluate(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<EvaluationResult, SavvagentError> {
        // Check cache first
        if let Some(cached_entry) = self.cache.get_entry(flag_key) {
            let mut configuration = cached_entry.configuration.clone();
            let mut variation = cached_entry.variation.clone();

            // Apply overrides
            if let Ok(config_overrides) = self.config_overrides.read() {
                if let Some(config_override) = config_overrides.get(flag_key) {
                    if config_override.merge {
                        if let Some(base_config) = configuration {
                            configuration = Some(self.merge_configurations(&base_config, &config_override.config));
                        } else {
                            configuration = Some(config_override.config.clone());
                        }
                    } else {
                        configuration = Some(config_override.config.clone());
                    }
                }
            }

            if let Ok(variation_overrides) = self.variation_overrides.read() {
                if let Some(variation_override) = variation_overrides.get(flag_key) {
                    variation = Some(variation_override.variation.clone());
                }
            }

            tracing::debug!("Flag '{}' returned from cache: {}", flag_key, cached_entry.value);
            return Ok(EvaluationResult {
                key: flag_key.to_string(),
                value: cached_entry.value,
                configuration,
                variation,
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

        let mut configuration = data.get("configuration").cloned();
        let mut variation = data["variation"].as_str().map(String::from);

        // Cache the result (including configuration and variation)
        self.cache.set(
            flag_key.to_string(),
            value,
            configuration.clone(),
            variation.clone(),
        );

        // Apply overrides to evaluated result
        if let Ok(config_overrides) = self.config_overrides.read() {
            if let Some(config_override) = config_overrides.get(flag_key) {
                if config_override.merge {
                    if let Some(base_config) = configuration {
                        configuration = Some(self.merge_configurations(&base_config, &config_override.config));
                    } else {
                        configuration = Some(config_override.config.clone());
                    }
                } else {
                    configuration = Some(config_override.config.clone());
                }
            }
        }

        if let Ok(variation_overrides) = self.variation_overrides.read() {
            if let Some(variation_override) = variation_overrides.get(flag_key) {
                variation = Some(variation_override.variation.clone());
            }
        }

        let metadata = Metadata {
            flag_id: data["flag_id"].as_str().map(String::from),
            description: data["description"].as_str().map(String::from),
            variant: data["variant"].as_str().map(String::from),
        };

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

    /// Get dynamic configuration for a flag (Phase 1)
    /// Returns configuration if flag is enabled, otherwise returns None
    pub async fn get_config(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<Option<serde_json::Value>, SavvagentError> {
        let result = self.evaluate(flag_key, context).await?;

        if !result.value {
            return Ok(None);
        }

        Ok(result.configuration)
    }

    /// Get variation details for multi-variant flags (Phase 2)
    /// Returns variation name, enabled status, and configuration
    pub async fn get_variation(
        &self,
        flag_key: &str,
        context: Option<Context>,
    ) -> Result<VariationResult, SavvagentError> {
        let result = self.evaluate(flag_key, context).await?;

        let variation = result.variation.unwrap_or_else(|| "control".to_string());

        Ok(VariationResult {
            variation,
            enabled: result.value,
            configuration: result.configuration,
        })
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
    ) -> Result<(), SavvagentError> {
        let flag_key = flag_key.into();
        let opts = options.unwrap_or_else(ConfigOverrideOptions::new);

        // Validate JSON structure
        if opts.validate {
            serde_json::to_string(&config).map_err(|e| {
                SavvagentError::ApiError(format!("Invalid configuration for flag '{}': {}", flag_key, e))
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
    pub fn set_variation_override(&self, flag_key: impl Into<String>, variation: impl Into<String>) {
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

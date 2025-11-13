use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Configuration for the FlagClient
#[derive(Clone)]
pub struct Config {
    /// SDK API key (starts with sdk_)
    pub api_key: String,

    /// Application ID for application-scoped flags
    pub application_id: Option<String>,

    /// Base URL for the Savvagent API
    pub base_url: String,

    /// Enable real-time flag updates via SSE
    pub enable_realtime: bool,

    /// Cache TTL duration
    pub cache_ttl: Duration,

    /// Enable telemetry tracking
    pub enable_telemetry: bool,

    /// Default flag values when evaluation fails
    pub defaults: HashMap<String, bool>,

    /// HTTP request timeout
    pub timeout: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            application_id: None,
            base_url: "https://api.savvagent.com".to_string(),
            enable_realtime: true,
            cache_ttl: Duration::from_secs(60),
            enable_telemetry: true,
            defaults: HashMap::new(),
            timeout: Duration::from_secs(5),
        }
    }
}

impl Config {
    /// Create a new Config with the given API key
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            ..Default::default()
        }
    }

    /// Set the application ID
    pub fn with_application_id(mut self, app_id: impl Into<String>) -> Self {
        self.application_id = Some(app_id.into());
        self
    }

    /// Set the base URL
    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }

    /// Set cache TTL
    pub fn with_cache_ttl(mut self, ttl: Duration) -> Self {
        self.cache_ttl = ttl;
        self
    }

    /// Set request timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }

    /// Add a default flag value
    pub fn with_default(mut self, key: impl Into<String>, value: bool) -> Self {
        self.defaults.insert(key.into(), value);
        self
    }
}

/// Context for flag evaluation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Context {
    /// User ID for targeted rollouts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,

    /// Session ID for session-based rollouts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,

    /// Application ID for application-scoped flags
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,

    /// Custom attributes for targeting rules
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attributes: Option<HashMap<String, serde_json::Value>>,

    /// Environment (dev, staging, production)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub environment: Option<String>,

    /// IP address for geo-targeting
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,

    /// User agent string
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
}

impl Context {
    /// Create a new empty context
    pub fn new() -> Self {
        Self::default()
    }

    /// Set user ID
    pub fn with_user_id(mut self, user_id: impl Into<String>) -> Self {
        self.user_id = Some(user_id.into());
        self
    }

    /// Set session ID
    pub fn with_session_id(mut self, session_id: impl Into<String>) -> Self {
        self.session_id = Some(session_id.into());
        self
    }

    /// Set environment
    pub fn with_environment(mut self, env: impl Into<String>) -> Self {
        self.environment = Some(env.into());
        self
    }

    /// Add an attribute
    pub fn with_attribute(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.attributes
            .get_or_insert_with(HashMap::new)
            .insert(key.into(), value);
        self
    }
}

/// Result from flag evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationResult {
    /// Flag key
    pub key: String,

    /// Evaluated value
    pub value: bool,

    /// Dynamic configuration attached to the flag (Phase 1)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<serde_json::Value>,

    /// Variation identifier for multi-variant flags (Phase 2)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variation: Option<String>,

    /// Reason for the value
    pub reason: String,

    /// Metadata about the flag
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Metadata>,
}

/// Result from variation evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariationResult {
    /// Variation identifier (e.g., "control", "variant_a")
    pub variation: String,

    /// Whether the flag is enabled
    pub enabled: bool,

    /// Dynamic configuration for this variation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub configuration: Option<serde_json::Value>,
}

/// Metadata about a flag
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flag_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
}

/// Options for setting configuration overrides
#[derive(Debug, Clone, Default)]
pub struct ConfigOverrideOptions {
    /// Merge with API configuration instead of replacing (default: false)
    pub merge: bool,

    /// Validate configuration structure (default: true)
    pub validate: bool,
}

impl ConfigOverrideOptions {
    pub fn new() -> Self {
        Self {
            merge: false,
            validate: true,
        }
    }

    pub fn with_merge(mut self, merge: bool) -> Self {
        self.merge = merge;
        self
    }

    pub fn with_validate(mut self, validate: bool) -> Self {
        self.validate = validate;
        self
    }
}

/// Internal structure for storing configuration overrides
#[derive(Debug, Clone)]
pub(crate) struct ConfigOverrideEntry {
    pub config: serde_json::Value,
    pub merge: bool,
    pub timestamp: std::time::SystemTime,
}

/// Internal structure for storing variation overrides
#[derive(Debug, Clone)]
pub(crate) struct VariationOverrideEntry {
    pub variation: String,
    pub timestamp: std::time::SystemTime,
}

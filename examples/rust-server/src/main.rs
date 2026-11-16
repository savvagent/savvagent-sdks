//! Example Axum server that evaluates Savvagent Flags with the Rust server SDK.
//!
//! Configuration comes from the environment (see `Settings::from_env`):
//! `SAVVAGENT_FLAGS_SDK_KEY` (required: the app's server key `srv_...`, or its client key `sdk_...`),
//! `SAVVAGENT_FLAGS_API_URL`, `SAVVAGENT_FLAGS_ENVIRONMENT`, and `PORT`; `RUST_LOG` sets the log filter.

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use savvagent_flags::{Config, Context, FlagClient};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// The production Savvagent Flags API, used when `SAVVAGENT_FLAGS_API_URL` is not set.
const DEFAULT_API_URL: &str = "https://api.savvagent.com/flags";
const DEFAULT_ENVIRONMENT: &str = "development";
const DEFAULT_PORT: u16 = 8083;

const NEW_UI: &str = "new-ui";
const BETA_FEATURES: &str = "beta-features";
const ADVANCED_ANALYTICS: &str = "advanced-analytics";
const ADVANCED_PROCESSING: &str = "advanced-processing";

/// Every flag this example reads, with the value it falls back to when evaluation fails.
const FLAG_DEFAULTS: &[(&str, bool)] = &[
    (NEW_UI, false),
    (BETA_FEATURES, false),
    (ADVANCED_ANALYTICS, false),
    (ADVANCED_PROCESSING, false),
];

/// Settings read from the environment.
#[derive(Debug, PartialEq, Eq)]
struct Settings {
    sdk_key: String,
    api_url: String,
    environment: String,
    port: u16,
}

impl Settings {
    /// Reads settings through `lookup` (normally `std::env::var(..).ok()`). A variable set to an
    /// empty string counts as unset. The key's format is left to `FlagClient::new`, which
    /// rejects keys it does not accept.
    fn from_env(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let var = |name: &str| lookup(name).filter(|v| !v.is_empty());
        let sdk_key = var("SAVVAGENT_FLAGS_SDK_KEY")
            .ok_or("SAVVAGENT_FLAGS_SDK_KEY is not set; use the app's server key (srv_...)")?;
        let port = match var("PORT") {
            Some(p) => p
                .parse()
                .map_err(|_| format!("PORT is not a port number: {p}"))?,
            None => DEFAULT_PORT,
        };
        Ok(Self {
            sdk_key,
            api_url: var("SAVVAGENT_FLAGS_API_URL").unwrap_or_else(|| DEFAULT_API_URL.into()),
            environment: var("SAVVAGENT_FLAGS_ENVIRONMENT")
                .unwrap_or_else(|| DEFAULT_ENVIRONMENT.into()),
            port,
        })
    }
}

#[derive(Clone)]
struct AppState {
    // `FlagClient` is cheap to clone: its cache and HTTP client are shared.
    flags: FlagClient,
    environment: String,
}

impl AppState {
    /// An evaluation context for one user in the configured environment.
    fn context(&self, user_id: &str) -> Context {
        Context::new()
            .with_user_id(user_id)
            .with_environment(&self.environment)
    }
}

#[derive(Deserialize)]
struct FeaturesQuery {
    #[serde(rename = "userId")]
    user_id: String,
}

#[derive(Serialize)]
struct FeaturesResponse {
    #[serde(rename = "userId")]
    user_id: String,
    features: BTreeMap<&'static str, bool>,
}

#[derive(Deserialize)]
struct DataRequest {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    data: serde_json::Value,
}

#[derive(Serialize)]
struct DataResponse {
    processed: bool,
    method: &'static str,
    data: serde_json::Value,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "rust_server_example=info,savvagent_flags=info,tower_http=info".into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let settings = Settings::from_env(|name| std::env::var(name).ok())?;

    let config = FLAG_DEFAULTS.iter().fold(
        Config::new(&settings.sdk_key).with_base_url(&settings.api_url),
        |config, (key, value)| config.with_default(*key, *value),
    );
    // Format the error so a rejected key prints the SDK's message, not its `Debug` form.
    let flags = FlagClient::new(config)
        .map_err(|e| format!("cannot create the Savvagent Flags client: {e}"))?;

    tracing::info!(
        "Savvagent Flags API URL: {} (environment: {})",
        settings.api_url,
        settings.environment
    );

    let state = AppState {
        flags: flags.clone(),
        environment: settings.environment,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/features", get(get_features))
        .route("/api/data", post(process_data))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], settings.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("Server listening on {}", listener.local_addr()?);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    // Send the evaluations still queued for telemetry before exiting.
    flags.flush().await;
    Ok(())
}

/// Resolves on Ctrl-C, or on SIGTERM (how containers and Fly stop a process).
async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::warn!("cannot listen for Ctrl-C: {e}");
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(e) => {
                tracing::warn!("cannot listen for SIGTERM: {e}");
                std::future::pending::<()>().await;
            }
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("Shutting down");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

/// Reports which features are on for a user. `is_enabled` never fails: on any error (logged by
/// the SDK) it returns the flag's configured default, so this handler always answers. The three
/// lookups run concurrently, so an unreachable API costs one SDK timeout, not three.
async fn get_features(
    State(state): State<AppState>,
    Query(params): Query<FeaturesQuery>,
) -> Json<FeaturesResponse> {
    let ctx = state.context(&params.user_id);
    let (new_ui, beta_features, advanced_analytics) = tokio::join!(
        state.flags.is_enabled(NEW_UI, Some(ctx.clone())),
        state.flags.is_enabled(BETA_FEATURES, Some(ctx.clone())),
        state.flags.is_enabled(ADVANCED_ANALYTICS, Some(ctx)),
    );

    Json(FeaturesResponse {
        user_id: params.user_id,
        features: BTreeMap::from([
            ("newUI", new_ui),
            ("betaFeatures", beta_features),
            ("advancedAnalytics", advanced_analytics),
        ]),
    })
}

/// Processes data with the advanced or basic method, gated on `advanced-processing`.
async fn process_data(
    State(state): State<AppState>,
    Json(request): Json<DataRequest>,
) -> Json<DataResponse> {
    let user_id = request.user_id.as_deref().unwrap_or("anonymous");
    let ctx = state
        .context(user_id)
        .with_attribute("endpoint", serde_json::json!("/api/data"));

    let method = if state.flags.is_enabled(ADVANCED_PROCESSING, Some(ctx)).await {
        "advanced"
    } else {
        "basic"
    };

    Json(DataResponse {
        processed: true,
        method,
        data: request.data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |name| vars.get(name).cloned()
    }

    #[test]
    fn sdk_key_is_required() {
        let err = Settings::from_env(lookup(&[])).unwrap_err();
        assert!(err.contains("SAVVAGENT_FLAGS_SDK_KEY"), "{err}");
    }

    #[test]
    fn an_empty_variable_counts_as_unset() {
        assert!(Settings::from_env(lookup(&[("SAVVAGENT_FLAGS_SDK_KEY", "")])).is_err());
        let settings = Settings::from_env(lookup(&[
            ("SAVVAGENT_FLAGS_SDK_KEY", "sdk_abc"),
            ("SAVVAGENT_FLAGS_API_URL", ""),
            ("SAVVAGENT_FLAGS_ENVIRONMENT", ""),
            ("PORT", ""),
        ]))
        .unwrap();
        assert_eq!(settings.api_url, DEFAULT_API_URL);
        assert_eq!(settings.environment, DEFAULT_ENVIRONMENT);
        assert_eq!(settings.port, DEFAULT_PORT);
    }

    #[test]
    fn defaults_to_production_development_and_port_8083() {
        let settings =
            Settings::from_env(lookup(&[("SAVVAGENT_FLAGS_SDK_KEY", "sdk_abc")])).unwrap();
        assert_eq!(
            settings,
            Settings {
                sdk_key: "sdk_abc".into(),
                api_url: "https://api.savvagent.com/flags".into(),
                environment: "development".into(),
                port: 8083,
            }
        );
    }

    #[test]
    fn every_variable_is_honoured() {
        let settings = Settings::from_env(lookup(&[
            ("SAVVAGENT_FLAGS_SDK_KEY", "sdk_abc"),
            ("SAVVAGENT_FLAGS_API_URL", "http://localhost:8080"),
            ("SAVVAGENT_FLAGS_ENVIRONMENT", "staging"),
            ("PORT", "9000"),
        ]))
        .unwrap();
        assert_eq!(settings.api_url, "http://localhost:8080");
        assert_eq!(settings.environment, "staging");
        assert_eq!(settings.port, 9000);
    }

    #[test]
    fn a_server_key_is_accepted() {
        let settings =
            Settings::from_env(lookup(&[("SAVVAGENT_FLAGS_SDK_KEY", "srv_abc")])).unwrap();
        assert_eq!(settings.sdk_key, "srv_abc");
        assert!(FlagClient::new(Config::new(&settings.sdk_key)).is_ok());
    }

    #[test]
    fn a_bad_port_is_an_error() {
        let err = Settings::from_env(lookup(&[
            ("SAVVAGENT_FLAGS_SDK_KEY", "sdk_abc"),
            ("PORT", "x"),
        ]))
        .unwrap_err();
        assert!(err.contains("PORT"), "{err}");
    }

    #[test]
    fn response_shapes_are_unchanged() {
        let features = FeaturesResponse {
            user_id: "u1".into(),
            features: BTreeMap::from([
                ("newUI", true),
                ("betaFeatures", false),
                ("advancedAnalytics", true),
            ]),
        };
        assert_eq!(
            serde_json::to_value(features).unwrap(),
            serde_json::json!({
                "userId": "u1",
                "features": {"newUI": true, "betaFeatures": false, "advancedAnalytics": true}
            })
        );
        let data = DataResponse {
            processed: true,
            method: "basic",
            data: serde_json::json!("x"),
        };
        assert_eq!(
            serde_json::to_value(data).unwrap(),
            serde_json::json!({"processed": true, "method": "basic", "data": "x"})
        );
    }
}

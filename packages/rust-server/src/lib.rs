//! # Savvagent Flags Rust Server SDK
//!
//! Official Rust Server SDK for Savvagent Flags - AI-powered feature flags with automatic error detection.
//!
//! ## Features
//!
//! - 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
//! - 📡 **Real-time updates**: a flag change reaches the cache over the server's event stream
//!   (`Config::with_realtime`, on by default) instead of waiting for the TTL
//! - 📊 **Telemetry**: Evaluation counts and reported errors, batched (`FlagClient::track_error`,
//!   `FlagClient::flush`)
//! - 🤖 **AI Error Detection**: Correlate errors with flag changes
//! - 📦 **Type Safe**: Full Rust type safety with comprehensive documentation
//! - 🌐 **Server-Optimized**: Built specifically for Rust server environments
//! - ⚡ **High Performance**: Async/await with Tokio runtime
//!
//! ## Quick Start
//!
//! ```no_run
//! use savvagent_flags::{Config, Context, FlagClient};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Initialize the client
//!     // The app's server key (srv_...) or client key (sdk_...)
//!     let config = Config::new("srv_your_server_key_here")
//!         .with_application_id("your-app-id");
//!
//!     let client = FlagClient::new(config)?;
//!
//!     // Evaluate a flag
//!     let context = Context::new()
//!         .with_user_id("user-123")
//!         .with_environment("production");
//!
//!     let result = client.evaluate("new-feature", Some(context)).await?;
//!     println!("Feature enabled: {}", result.value);
//!
//!     // Or use the convenience method
//!     if client.is_enabled("new-feature", None).await {
//!         // New feature code
//!     }
//!
//!     // Send queued telemetry before exiting
//!     client.flush().await;
//!
//!     Ok(())
//! }
//! ```

mod backoff;
mod cache;
mod client;
mod realtime;
mod telemetry;
mod types;

pub use client::{FlagClient, SavvagentFlagsError};
pub use types::{
    Config, ConfigOverrideOptions, Context, ErrorReport, EvaluationResult, Metadata,
    VariationResult,
};

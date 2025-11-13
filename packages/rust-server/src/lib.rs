//! # Savvagent Rust Server SDK
//!
//! Official Rust Server SDK for Savvagent - AI-powered feature flags with automatic error detection.
//!
//! ## Features
//!
//! - 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
//! - 📊 **Telemetry**: Automatic tracking of flag evaluations
//! - 🤖 **AI Error Detection**: Correlate errors with flag changes
//! - 📦 **Type Safe**: Full Rust type safety with comprehensive documentation
//! - 🌐 **Server-Optimized**: Built specifically for Rust server environments
//! - ⚡ **High Performance**: Async/await with Tokio runtime
//!
//! ## Quick Start
//!
//! ```no_run
//! use savvagent::{Config, Context, FlagClient};
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     // Initialize the client
//!     let config = Config::new("sdk_your_api_key_here")
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
//!     Ok(())
//! }
//! ```

mod cache;
mod client;
mod types;

pub use client::{FlagClient, SavvagentError};
pub use types::{Config, Context, EvaluationResult, Metadata};

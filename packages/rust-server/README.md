# Savvagent Rust Server SDK

Official Rust Server SDK for Savvagent - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
- 📊 **Telemetry**: Automatic tracking of flag evaluations
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **Type Safe**: Full Rust type safety with comprehensive documentation
- 🌐 **Server-Optimized**: Built specifically for Rust server environments
- ⚡ **High Performance**: Async/await with Tokio runtime
- 🔒 **Memory Safe**: Zero-cost abstractions with Rust's ownership system

## Requirements

- Rust 1.70 or higher

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
savvagent = "0.1.0"
tokio = { version = "1.0", features = ["full"] }
```

## Quick Start

```rust
use savvagent::{Config, Context, FlagClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize the client
    let config = Config::new("sdk_your_api_key_here")
        .with_application_id("your-app-id");

    let client = FlagClient::new(config)?;

    // Evaluate a flag
    let context = Context::new()
        .with_user_id("user-123")
        .with_environment("production");

    let result = client.evaluate("new-feature", Some(context)).await?;
    println!("Feature enabled: {}", result.value);

    // Or use the convenience method
    if client.is_enabled("new-feature", None).await {
        // New feature code
    }

    Ok(())
}
```

## Configuration

```rust
use savvagent::Config;
use std::time::Duration;

let config = Config::new("sdk_your_api_key_here")
    .with_application_id("your-app-id")
    .with_base_url("https://api.savvagent.com")
    .with_cache_ttl(Duration::from_secs(60))
    .with_timeout(Duration::from_secs(5))
    .with_default("feature-a", false)
    .with_default("feature-b", true);

let client = FlagClient::new(config)?;
```

## Usage Examples

### Actix Web

```rust
use actix_web::{web, App, HttpResponse, HttpServer};
use savvagent::{Config, Context, FlagClient};

struct AppState {
    flag_client: FlagClient,
}

async fn handler(
    data: web::Data<AppState>,
    req: actix_web::HttpRequest,
) -> HttpResponse {
    let context = Context::new()
        .with_user_id(req.headers()
            .get("X-User-ID")
            .and_then(|h| h.to_str().ok())
            .unwrap_or(""))
        .with_ip_address(req.peer_addr()
            .map(|addr| addr.ip().to_string()));

    if data.flag_client.is_enabled("new-feature", Some(context)).await {
        HttpResponse::Ok().body("New feature!")
    } else {
        HttpResponse::Ok().body("Old feature")
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let config = Config::new("sdk_your_key");
    let client = FlagClient::new(config).unwrap();

    HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(AppState {
                flag_client: client.clone(),
            }))
            .route("/", web::get().to(handler))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
```

### Axum

```rust
use axum::{
    extract::State,
    routing::get,
    Router,
};
use savvagent::{Config, Context, FlagClient};
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    flag_client: FlagClient,
}

async fn handler(State(state): State<Arc<AppState>>) -> String {
    let context = Context::new()
        .with_user_id("user-123")
        .with_environment("production");

    if state.flag_client.is_enabled("new-feature", Some(context)).await {
        "New feature!".to_string()
    } else {
        "Old feature".to_string()
    }
}

#[tokio::main]
async fn main() {
    let config = Config::new("sdk_your_key");
    let client = FlagClient::new(config).unwrap();

    let state = Arc::new(AppState {
        flag_client: client,
    });

    let app = Router::new()
        .route("/", get(handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .unwrap();

    axum::serve(listener, app).await.unwrap();
}
```

### Rocket

```rust
use rocket::{State, get, launch, routes};
use savvagent::{Config, Context, FlagClient};

#[get("/")]
async fn index(client: &State<FlagClient>) -> String {
    let context = Context::new()
        .with_user_id("user-123");

    if client.is_enabled("new-feature", Some(context)).await {
        "New feature!".to_string()
    } else {
        "Old feature".to_string()
    }
}

#[launch]
fn rocket() -> _ {
    let config = Config::new("sdk_your_key");
    let client = FlagClient::new(config).unwrap();

    rocket::build()
        .manage(client)
        .mount("/", routes![index])
}
```

### Middleware Pattern

```rust
use savvagent::{Context, FlagClient};

async fn feature_middleware(
    client: &FlagClient,
    user_id: &str,
    next: impl Future<Output = Response>,
) -> Response {
    let context = Context::new().with_user_id(user_id);

    if !client.is_enabled("feature-enabled", Some(context)).await {
        return Response::Forbidden("Feature not enabled");
    }

    next.await
}
```

### With Custom Context

```rust
use savvagent::Context;
use serde_json::json;

let context = Context::new()
    .with_user_id("user-123")
    .with_session_id("session-abc")
    .with_environment("production")
    .with_attribute("plan", json!("premium"))
    .with_attribute("beta_user", json!(true))
    .with_attribute("country", json!("US"));

let result = client.evaluate("premium-features", Some(context)).await?;
```

## API Reference

### Types

#### Config

Configuration builder for the FlagClient.

```rust
let config = Config::new("sdk_key")
    .with_application_id("app-id")
    .with_base_url("https://api.savvagent.com")
    .with_cache_ttl(Duration::from_secs(60))
    .with_timeout(Duration::from_secs(5))
    .with_default("flag", false);
```

#### Context

Context builder for flag evaluation.

```rust
let context = Context::new()
    .with_user_id("user-123")
    .with_session_id("session-abc")
    .with_environment("production")
    .with_attribute("key", json!("value"));
```

#### EvaluationResult

Result from flag evaluation.

```rust
pub struct EvaluationResult {
    pub key: String,
    pub value: bool,
    pub reason: String,  // "cached", "evaluated", "error"
    pub metadata: Option<Metadata>,
}
```

### Methods

#### FlagClient::new(config: Config) -> Result<Self, SavvagentError>

Creates a new FlagClient.

```rust
let client = FlagClient::new(config)?;
```

#### evaluate(&self, flag_key: &str, context: Option<Context>) -> Result<EvaluationResult, SavvagentError>

Evaluates a feature flag.

```rust
let result = client.evaluate("my-flag", Some(context)).await?;
```

#### is_enabled(&self, flag_key: &str, context: Option<Context>) -> bool

Checks if a flag is enabled (convenience method).

```rust
let enabled = client.is_enabled("my-flag", Some(context)).await;
```

#### invalidate_cache(&self, flag_key: Option<&str>)

Invalidates the cache.

```rust
client.invalidate_cache(Some("my-flag")); // Specific flag
client.invalidate_cache(None);            // All flags
```

#### clear_cache(&self)

Clears all cached values.

```rust
client.clear_cache();
```

## Error Handling

```rust
use savvagent::SavvagentError;

match client.evaluate("my-flag", None).await {
    Ok(result) => {
        println!("Flag value: {}", result.value);
    }
    Err(SavvagentError::InvalidApiKey) => {
        eprintln!("Invalid API key");
    }
    Err(SavvagentError::RequestFailed(e)) => {
        eprintln!("Request failed: {}", e);
    }
    Err(SavvagentError::ApiError(msg)) => {
        eprintln!("API error: {}", msg);
    }
}
```

## Best Practices

1. **Clone the Client**: The `FlagClient` is designed to be cloned cheaply
2. **Share State**: Use `Arc` or framework state management
3. **Context**: Provide rich context for better targeting
4. **Defaults**: Set sensible defaults for all flags
5. **Error Handling**: Handle errors gracefully
6. **Async Runtime**: Use Tokio for the async runtime

## Performance

The SDK is optimized for high-performance server environments:

- Thread-safe concurrent access with `Arc` and `RwLock`
- Efficient in-memory caching
- Zero-copy deserialization where possible
- Connection pooling via reqwest
- Configurable timeouts

## Logging

The SDK uses the `tracing` crate for logging. Configure your subscriber:

```rust
use tracing_subscriber;

tracing_subscriber::fmt::init();
```

## License

MIT

## Support

- Documentation: https://docs.savvagent.com
- API Docs: https://docs.rs/savvagent
- Issues: https://github.com/savvagent/savvagent-sdks/issues
- Email: support@savvagent.com

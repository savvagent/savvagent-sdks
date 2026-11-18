# Savvagent Flags Rust Server SDK

The Rust server SDK for [Savvagent Flags](https://github.com/savvagent/flags-sdks), the feature flag product of [savvagent-services](https://github.com/savvagent/savvagent-services).

## Features

- 🚀 **Fast Evaluation**: Thread-safe in-memory caching with configurable TTL
- 📊 **Telemetry**: Evaluation counts and reported errors, batched, for flag health and auto-rollback
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 📦 **Type Safe**: Full Rust type safety with comprehensive documentation
- 🌐 **Server-Optimized**: Built specifically for Rust server environments
- 📡 **Real-time updates**: a flag change drops its cached results over the server's event stream
- ⚡ **High Performance**: Async/await with Tokio runtime
- 🔒 **Memory Safe**: Zero-cost abstractions with Rust's ownership system

## Requirements

- Rust stable (the crate declares no minimum `rust-version`; CI builds on stable)

## Installation

The crate is not published to crates.io yet. Add it to your `Cargo.toml`, pinned to a commit of savvagent/flags-sdks (the library is imported as `savvagent_flags`):

```toml
[dependencies]
savvagent-flags = { git = "https://github.com/savvagent/flags-sdks", rev = "<commit>" }
tokio = { version = "1.0", features = ["full"] }
```

## Quick Start

```rust
use savvagent_flags::{Config, Context, FlagClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize the client
    // A server uses the app's secret server key (srv_...); the public client key (sdk_...)
    // also works.
    let config = Config::new("srv_your_server_key_here")
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

    // Send queued telemetry before exiting
    client.flush().await;

    Ok(())
}
```

## Configuration

```rust
use savvagent_flags::Config;
use std::time::Duration;

let config = Config::new("srv_your_server_key_here")
    .with_application_id("your-app-id")
    .with_base_url("https://api.savvagent.com/flags")
    .with_cache_ttl(Duration::from_secs(60))
    .with_timeout(Duration::from_secs(5))
    .with_failure_cooldown(Duration::from_secs(5)) // the default
    .with_default("feature-a", false)
    .with_default("feature-b", true);

let client = FlagClient::new(config)?;
```

### Keys

`FlagClient::new` accepts the app's server key (`srv_...`) or its client key (`sdk_...`). Use the
server key in a server: it is secret, and only telemetry reported with it drives auto-rollback by
default (reports made with the public client key count only for policies that opt in). Never ship
a `srv_` key to a browser or mobile app.

## Telemetry

With telemetry on (the default), the SDK reports to Savvagent Flags, with the client's key:

- **Evaluations**: one per lookup that got the server's answer (`reason` `"evaluated"` or
  `"cached"`): the flag key, the result, the variation, the context's `environment`, and a
  timestamp. No user id, attributes, or other context. Fallbacks (`reason: "error"`) are not
  reported.
- **Errors** you report with `track_error`, for errors raised while a flag was in play:

```rust
use savvagent_flags::ErrorReport;

match charge(&order).await {
    Ok(receipt) => receipt,
    Err(e) => {
        client.track_error(ErrorReport::from_error("new-checkout", enabled, &e));
        return Err(e.into());
    }
}
// Or by hand:
client.track_error(
    ErrorReport::new("new-checkout", true, "PaymentDeclined", "card declined")
        .with_environment("production"),
);
```

Flag health compares the error rate with a flag on against the rate with it off, and
auto-rollback acts on it, so report errors from both code paths.

Events are queued in memory and sent in batches every 5 seconds by a background task on the
Tokio runtime, sooner when a full batch (1,000) is waiting, but at most one send pass per kind a
second; each request carries up to 1,000 events, so a busy process sends about one request per
1,000 lookups. Call `client.flush().await` before the process exits (it also
waits for a send already under way), or the last few seconds of events are lost.

The error message and stack trace are stored by Savvagent Flags for 14 days and shown to the agents
that manage your flags: keep end-user data (emails, ids, query values) out of them. A `srv_` key
is secret: use an `https` `base_url` (the SDK warns otherwise). Telemetry never blocks or fails a lookup: if the
queue is full (10,000 events per kind) new events are dropped, and a batch that cannot be sent is
logged at `warn` and dropped, not retried. Turn it off with `Config::with_telemetry(false)`.

## Usage Examples

### Actix Web

```rust
use actix_web::{web, App, HttpResponse, HttpServer};
use savvagent_flags::{Config, Context, FlagClient};

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
use savvagent_flags::{Config, Context, FlagClient};
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
use savvagent_flags::{Config, Context, FlagClient};

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
use savvagent_flags::{Context, FlagClient};

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
use savvagent_flags::Context;
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

Configuration builder for the FlagClient. `with_default_env` accepts `1`, `true`, `yes`, `on` and
`0`, `false`, `no`, `off` (ignoring case and surrounding whitespace). An unset variable is ignored
silently; an empty, non-Unicode or unrecognized one is ignored with a warning that names the
variable, not its value. Either way any earlier default (else `false`) stays.

```rust
let config = Config::new("srv_key")  // or "sdk_key"
    .with_application_id("app-id")
    .with_base_url("https://api.savvagent.com/flags")
    .with_cache_ttl(Duration::from_secs(60))
    .with_timeout(Duration::from_secs(5))
    .with_failure_cooldown(Duration::from_secs(5)) // the default
    .with_telemetry(true)             // the default
    .with_realtime(true)              // the default; false opens no stream
    .with_default("flag", false)
    .with_default_env("other-flag", "OTHER_FLAG") // default from an env var, read once
    .with_default_fn("third-flag", || Some(false)); // default from any closure
```

Results are cached for `cache_ttl` per flag key and evaluation context: a different context
(another user, other attributes) is evaluated by the server, and `invalidate_cache(Some(key))`
drops a flag's cached results for every context. The cache holds at most 10,000 results in
total across all flags, evicting the least recently used, and stores each context only as the
SHA-256 digest of its JSON, never the user ID or attributes themselves.

#### Real-time updates

Real-time updates are on by default. The client reads the server's flag-change stream in the
background and drops a changed flag's cached results as soon as the change arrives, so a kill switch
does not wait for `cache_ttl`. The stream connects when the client is created inside a Tokio
runtime, otherwise on the first `evaluate`; it never delays or fails a lookup. While it is down,
`cache_ttl` bounds how stale a result can be, as without it. It reconnects with exponential backoff
(about 1 second up to 30 seconds, 5 minutes if the key is rejected) and drops the whole cache on every
connection, since changes may have been missed. Clones of a client share one stream. Turn it off
with `with_realtime(false)`.

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
    pub configuration: Option<serde_json::Value>,
    pub variation: Option<String>,
    pub reason: String,  // "cached", "evaluated", "error"
    pub metadata: Option<Metadata>,  // None when reason is "error"
}

pub struct Metadata {
    pub version: Option<i64>,     // the flag version that produced the result
    pub scope: Option<String>,    // "application" or "enterprise"
    // flag_id, description, variant: not sent by the server; always None
}
```

### Methods

#### FlagClient::new(config: Config) -> Result<Self, SavvagentFlagsError>

Creates a new FlagClient.

```rust
let client = FlagClient::new(config)?;
```

#### evaluate(&self, flag_key: &str, context: Option<Context>) -> Result<EvaluationResult, SavvagentFlagsError>

Evaluates a feature flag. Flag keys are 1-128 ASCII letters, digits, `-`, `_` and `.` (but not
`.` or `..`), as the server requires; any other key returns its default with `reason: "error"`
and makes no request.

```rust
let result = client.evaluate("my-flag", Some(context)).await?;
```

#### is_enabled(&self, flag_key: &str, context: Option<Context>) -> bool

Checks if a flag is enabled (convenience method).

```rust
let enabled = client.is_enabled("my-flag", Some(context)).await;
```

#### is_enabled_cached(&self, flag_key: &str, context: Option<&Context>) -> bool

A synchronous read for code that cannot be `async`. It makes no request and does not wait: it
returns the unexpired cached value for this flag and context, else the flag's configured default.
Overrides never change the answer. The cache is per context, and an entry lives for `cache_ttl`, so
call `evaluate` or
`is_enabled` from async code with the same context at least once per TTL to keep it warm; a flag
that was never looked up, or whose entry expired or was invalidated, gets its default.

```rust
fn render_banner(client: &FlagClient, ctx: &Context) -> &'static str {
    if client.is_enabled_cached("new-banner", Some(ctx)) { "new" } else { "old" }
}
```

#### FlagClient::static_flags(flags) -> FlagClient

A client that serves fixed values and never uses the network, for tests. Flags not listed are
`false`; `evaluate` reports `reason: "static"`; overrides still apply. It makes no request, reports
no telemetry, opens no stream and needs no Tokio runtime to build.

```rust
let client = FlagClient::static_flags([("new-checkout", true), ("beta-banner", false)]);
assert!(client.is_enabled_cached("new-checkout", None));
assert!(client.is_enabled("new-checkout", None).await);
```

#### invalidate_cache(&self, flag_key: Option<&str>)

Invalidates the cache.

```rust
client.invalidate_cache(Some("my-flag")); // Specific flag, every context
client.invalidate_cache(None);            // All flags
```

#### clear_cache(&self)

Clears all cached values.

```rust
client.clear_cache();
```

#### track_error(&self, report: ErrorReport)

Queues an error raised while a flag was in play (see [Telemetry](#telemetry)).

#### flush(&self)

Sends all queued telemetry now; call it before the process exits.

```rust
client.flush().await;
```

## Error Handling

A flag lookup never fails your request. `evaluate`, `is_enabled`, `get_config`, and
`get_variation` fall back to the flag's configured default (`with_default`, else `false`) when the
key is invalid, the server is unreachable or slow (`with_timeout`), it answers with an error
status, or the response is not an evaluate response. The fallback has `reason: "error"`, is logged
through `tracing` (at `error` when the server refuses the SDK key, else `warn`), and is not cached,
so a later lookup asks the server again (after the cooldown below). Config and variation
overrides are not applied to a fallback; `get_config` gives `None` and `get_variation` gives
`"control"`, so use `evaluate` when you need to tell a fallback from a real answer. The lookup
methods keep their `Result` for compatibility but do not return `Err`, so `?` is safe.

After a failed lookup the client backs off for `failure_cooldown` (5 seconds by default;
`Duration::ZERO` turns it off): lookups in that window return their default with
`reason: "error"` without a request, so an outage costs one request and one warning per window
instead of one per lookup. A 404 (no such flag) pauses only that flag. A failure caused by the
request itself (another 4xx except 401, 408 and 429, a context over 64 KiB, which is not
sent, or a response body over 1 MiB, the most the SDK reads) pauses nothing, so a context built from one end user's input cannot switch
flags off for everyone. Any other failure (a timeout, a 5xx, a rejected key, a response that is
not an evaluate response) pauses every flag. A `Retry-After` in seconds on a 429 or 503
lengthens the window, up to 60 seconds; it never shortens it. Cached answers are still served
during a cooldown, and the first lookup after it goes to the server. A `base_url` with a wrong
path prefix makes every flag answer 404, which pauses each flag separately: one warning per flag
per window.

```rust
let result = client.evaluate("my-flag", None).await?;
if result.reason == "error" {
    // The server's answer was unavailable; `result.value` is the default.
}
```

Only `FlagClient::new` returns `Err` in practice: `SavvagentFlagsError::InvalidApiKey` for a key that
starts with neither `srv_` nor `sdk_`, or `RequestFailed` if the HTTP client cannot be built.

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

- Documentation: https://github.com/savvagent/flags-sdks#readme
- API Docs: https://docs.rs/savvagent-flags
- Issues: https://github.com/savvagent/flags-sdks/issues
- Email: support@savvagent.com

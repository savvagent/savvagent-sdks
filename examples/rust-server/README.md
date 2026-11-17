# Savvagent Flags Rust Server Example

Example Axum server that evaluates Savvagent Flags with the Savvagent Flags Rust Server SDK
(`packages/rust-server`, used here as a path dependency).

## What it shows

- Creating one `FlagClient` at startup and sharing it across handlers (it is cheap to clone)
- Evaluating flags per request with a `Context` (user ID, environment, attributes)
- Configured fallbacks: `is_enabled` never fails; on any error (unreachable API, a rejected key,
  an unknown flag) the SDK logs it and returns the default set with `Config::with_default`, so a
  flag lookup never breaks a request
- Telemetry: the SDK reports each answered lookup (no user data) for flag health and
  auto-rollback, and the example calls `flush()` after a graceful shutdown (Ctrl-C or SIGTERM)
  so queued events are not lost
- axum 0.7: `tokio::net::TcpListener` + `axum::serve` with graceful shutdown

## Prerequisites

- Stable Rust and Cargo
- An Savvagent Flags app and its server key (`srv_...`). An agent creates the app and gets its keys over
  MCP (`create_app`); the flags this example reads are `new-ui`, `beta-features`,
  `advanced-analytics`, and `advanced-processing`. A flag that does not exist falls back to the
  example's default, which is off for all four.

## Configuration

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SAVVAGENT_FLAGS_API_KEY` | yes | | The app's server key (`srv_...`, recommended: it is secret, and its telemetry drives auto-rollback) or its public client key (`sdk_...`) |
| `SAVVAGENT_FLAGS_API_URL` | no | `https://api.savvagent.com/flags` | Savvagent Flags API base URL |
| `SAVVAGENT_ENVIRONMENT` | no | `development` | Environment flags are evaluated in |
| `PORT` | no | `8083` | Port the example listens on |
| `RUST_LOG` | no | `rust_server_example=info,savvagent_flags=info,tower_http=info` | Log filter |

A variable set to an empty string counts as unset. The server exits with an error if
`SAVVAGENT_FLAGS_API_KEY` is missing or the SDK rejects it, or if `PORT` is not a port number.

## Run

```bash
export SAVVAGENT_FLAGS_API_KEY=srv_your_server_key_here
cargo run --release
```

The server listens on [http://localhost:8083](http://localhost:8083).

## API Endpoints

### Health check

```bash
curl http://localhost:8083/health
```

```json
{ "status": "ok" }
```

### Get user features

```bash
curl 'http://localhost:8083/api/features?userId=user-123'
```

`userId` is required (without it the request is rejected with 400). Evaluates `new-ui`,
`beta-features`, and `advanced-analytics` for the user:

```json
{
  "userId": "user-123",
  "features": {
    "advancedAnalytics": true,
    "betaFeatures": false,
    "newUI": true
  }
}
```

### Process data (feature-gated)

```bash
curl -X POST http://localhost:8083/api/data \
  -H 'Content-Type: application/json' \
  -d '{"userId": "user-123", "data": "example data"}'
```

Evaluates `advanced-processing` for the user (`anonymous` when `userId` is omitted), with an
`endpoint` attribute of `/api/data`, and reports which method it used:

```json
{ "processed": true, "method": "advanced", "data": "example data" }
```

## Usage in brief

```rust
use axum::{extract::State, routing::get, Router};
use savvagent_flags::{Config, Context, FlagClient};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The base URL defaults to https://api.savvagent.com/flags; `with_base_url` overrides it.
    let config = Config::new(std::env::var("SAVVAGENT_FLAGS_API_KEY")?).with_default("new-ui", false);
    let flags = FlagClient::new(config)?;

    let app = Router::new()
        .route("/", get(index))
        .with_state(flags);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8083").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn index(State(flags): State<FlagClient>) -> &'static str {
    let ctx = Context::new()
        .with_user_id("user-123")
        .with_environment("development");
    if flags.is_enabled("new-ui", Some(ctx)).await {
        "new UI"
    } else {
        "old UI"
    }
}
```

`src/main.rs` is the full example.

## Learn More

- [Savvagent Flags Rust SDK](../../packages/rust-server/README.md)
- [SDK Developer Guide](../../docs/SDK-DEVELOPER-GUIDE.md)
- [Axum](https://github.com/tokio-rs/axum)
- [Tokio](https://tokio.rs/)

# Savvagent Rust Server Example

Example Rust application demonstrating how to use the Savvagent Rust Server SDK with Axum framework.

## Features

- Rust 1.70+
- Axum web framework
- Tokio async runtime
- Savvagent Rust Server SDK
- RESTful API endpoints
- Feature-gated functionality
- Thread-safe concurrent access
- In-memory caching

## Prerequisites

- Rust 1.70 or higher
- Cargo

## Setup

1. **Configure environment variables:**
   ```bash
   export SAVVAGENT_API_URL=http://localhost:8080
   export SAVVAGENT_SDK_KEY=your-sdk-key-here
   export PORT=8083
   ```

2. **Build the project:**
   ```bash
   cargo build --release
   ```

3. **Run the server:**
   ```bash
   cargo run --release
   ```

   Or for development with auto-reload:
   ```bash
   cargo watch -x run
   ```

4. The server will start on [http://localhost:8083](http://localhost:8083)

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Get User Features

```bash
GET /api/features?userId=user-123
```

Returns all feature flags for a user.

Example response:
```json
{
  "userId": "user-123",
  "features": {
    "newUI": true,
    "betaFeatures": false,
    "advancedAnalytics": true
  }
}
```

### Process Data (Feature-Gated)

```bash
POST /api/data
Content-Type: application/json

{
  "userId": "user-123",
  "data": "example data"
}
```

Uses the `advanced-processing` flag to determine processing method.

## Usage Example

```rust
use axum::{Router, Json, extract::Query};
use savvagent::{SavvagentClient, EvaluationContext};

#[tokio::main]
async fn main() {
    let client = SavvagentClient::new(
        std::env::var("SAVVAGENT_API_URL").unwrap(),
        std::env::var("SAVVAGENT_SDK_KEY").unwrap(),
    ).await.unwrap();

    let app = Router::new()
        .route("/api/features", get(get_features))
        .with_state(client);

    axum::Server::bind(&"0.0.0.0:8083".parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn get_features(
    State(client): State<SavvagentClient>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = params.get("userId").ok_or(StatusCode::BAD_REQUEST)?;

    let is_enabled = client
        .is_enabled(
            "new-feature",
            EvaluationContext::builder()
                .user_id(user_id)
                .attribute("plan", "pro")
                .build(),
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "userId": user_id,
        "newFeature": is_enabled,
    })))
}
```

## Learn More

- [Rust Documentation](https://www.rust-lang.org/)
- [Axum Framework](https://github.com/tokio-rs/axum)
- [Tokio Runtime](https://tokio.rs/)
- [Savvagent Rust SDK Documentation](../../packages/rust-server/README.md)
- [SDK Integration Guide](../../docs/SDK-INTEGRATION.md)

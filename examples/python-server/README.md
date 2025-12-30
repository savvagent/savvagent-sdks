# Savvagent Python Server Example

Example Python backend demonstrating how to use the Savvagent SDK in a server environment with both FastAPI (async) and Flask (sync) implementations.

## Features

- FastAPI async server example
- Flask sync server example
- Feature-gated API endpoints
- Dynamic configuration retrieval
- A/B testing variation support
- Error tracking integration
- Caching for improved performance

## Setup

1. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. **Install dependencies:**
   ```bash
   # Install the local SDK first
   pip install -e ../../packages/python-server

   # Then install other dependencies
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```bash
   SAVVAGENT_API_KEY=sdk_your_key_here
   SAVVAGENT_APP_ID=python-server-example
   SAVVAGENT_API_URL=http://localhost:8080
   PORT=8000
   ```

4. **Run the server:**
   ```bash
   # FastAPI (async) - recommended for production
   python main.py
   # Or with uvicorn directly:
   uvicorn main:app --reload --port 8000

   # Flask (sync) - simpler setup
   python flask_example.py
   ```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Get User Features

```bash
GET /api/features/:userId
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
  "data": {...}
}
```

Uses the `advanced-processing` flag to determine processing method.

### Get Dynamic Configuration

```bash
GET /api/config/:userId
```

Returns dynamic configuration for UI settings.

Example response:
```json
{
  "userId": "user-123",
  "config": {
    "theme": "dark",
    "density": "compact",
    "language": "en"
  }
}
```

### Get Experiment Variation

```bash
GET /api/experiment/:userId
```

Returns A/B test variation assignment.

Example response:
```json
{
  "userId": "user-123",
  "experiment": "checkout-experiment",
  "variation": "variant_a",
  "enabled": true,
  "configuration": {}
}
```

## Usage Examples

### FastAPI with Async Client

```python
from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

config = FlagClientConfig(api_key="sdk_your_key")

async with AsyncFlagClient(config) as client:
    # Simple boolean check
    if await client.is_enabled("new-feature", FlagContext(user_id=user_id)):
        await do_new_thing()

    # Get dynamic configuration
    settings = await client.get_config("ui-settings", context)

    # Get experiment variation
    variation = await client.get_variation("experiment", context)
```

### Flask with Sync Client

```python
from savvagent import FlagClient, FlagClientConfig, FlagContext

config = FlagClientConfig(api_key="sdk_your_key")
client = FlagClient(config)

# Simple boolean check
if client.is_enabled("new-feature", FlagContext(user_id=user_id)):
    do_new_thing()

# Track errors
try:
    risky_operation()
except Exception as e:
    client.track_error("risky-feature", e, context)
    raise
```

### Batch Feature Evaluation

```python
import asyncio

# Evaluate multiple flags concurrently
new_ui, beta, analytics = await asyncio.gather(
    client.is_enabled("new-ui", context),
    client.is_enabled("beta-features", context),
    client.is_enabled("advanced-analytics", context),
)
```

## Testing

You can test the endpoints with curl:

```bash
# Health check
curl http://localhost:8000/health

# Get features
curl http://localhost:8000/api/features/user-123

# Process data
curl -X POST http://localhost:8000/api/data \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "data": {"key": "value"}}'

# Get config
curl http://localhost:8000/api/config/user-123

# Get experiment variation
curl http://localhost:8000/api/experiment/user-123
```

## Learn More

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [Savvagent Python SDK](../../packages/python-server/README.md)

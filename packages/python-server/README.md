# savvagent

Official Python Server SDK for Savvagent - AI-powered feature flags with automatic error detection.

## Features

- 🚀 **Fast Evaluation**: In-memory caching with configurable TTL
- 🔄 **Real-time Updates**: Automatic cache invalidation via Server-Sent Events
- 📊 **Telemetry**: Automatic tracking of flag evaluations and errors
- 🤖 **AI Error Detection**: Correlate errors with flag changes
- 🐍 **Sync & Async**: Both synchronous and asynchronous clients
- 🔒 **Type Safe**: Full type hints with PEP 561 support
- 🌐 **Framework Ready**: Examples for FastAPI, Flask, and Django

## Installation

```bash
pip install savvagent
```

## Quick Start

### Synchronous Usage

```python
from savvagent import FlagClient, FlagClientConfig, FlagContext

# Initialize the client
config = FlagClientConfig(
    api_key="sdk_your_api_key_here",
    application_id="your-app-id",  # optional
)

with FlagClient(config) as client:
    # Evaluate a flag
    result = client.evaluate("new-feature", FlagContext(
        user_id="user-123",
        environment="production",
    ))
    print(f"Feature enabled: {result.value}")

    # Or use the convenience method
    if client.is_enabled("new-feature", FlagContext(user_id="user-123")):
        do_new_thing()
```

### Asynchronous Usage

```python
from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

config = FlagClientConfig(api_key="sdk_your_api_key_here")

async with AsyncFlagClient(config) as client:
    if await client.is_enabled("new-feature", FlagContext(user_id="user-123")):
        await do_new_thing()
```

## Configuration

```python
from savvagent import FlagClientConfig

config = FlagClientConfig(
    api_key="sdk_your_api_key_here",
    application_id="your-app-id",
    base_url="https://api.savvagent.com",  # optional
    enable_realtime=True,  # default: True
    cache_ttl=60,  # seconds, default: 60
    enable_telemetry=True,  # default: True
    timeout=5.0,  # seconds, default: 5.0
    defaults={
        "feature-a": False,
        "feature-b": True,
    },
    on_error=lambda e: print(f"Savvagent error: {e}"),
)
```

## Usage Examples

### Basic Flag Evaluation

```python
# Simple boolean check
enabled = client.is_enabled("premium-features", FlagContext(user_id=user_id))

if enabled:
    # Premium features code
    show_premium_ui()
```

### Dynamic Configuration (Phase 1)

```python
# Get configuration attached to a flag
config = client.get_config(
    "ui-settings",
    context,
    default={"theme": "light", "density": "normal"},
)

theme = config["theme"]
density = config["density"]
```

### Multi-Variant Experiments (Phase 2)

```python
# Get variation for A/B testing
variation = client.get_variation("checkout-experiment", context)

if variation.variation == "variant_a":
    show_variant_a_checkout()
elif variation.variation == "variant_b":
    show_variant_b_checkout()
else:
    show_control_checkout()
```

### Error Tracking

```python
feature_enabled = client.is_enabled("new-payment-flow")

try:
    if feature_enabled:
        process_payment_v2(order)
    else:
        process_payment_v1(order)
except Exception as e:
    # Track error with flag context for AI correlation
    client.track_error("new-payment-flow", e, FlagContext(
        user_id=order.user_id,
        attributes={"order_id": order.id},
    ))
    raise
```

### Real-time Updates

```python
# Subscribe to flag changes
def on_flag_change():
    print("Feature toggle changed!")
    # Cache is invalidated automatically

unsubscribe = client.subscribe("feature-toggle", on_flag_change)

# Unsubscribe when done
import atexit
atexit.register(unsubscribe)
atexit.register(client.close)
```

### Configuration Overrides (Testing)

```python
from savvagent import ConfigOverrideOptions

# Override configuration for testing
client.set_config_override("ui-settings", {"theme": "dark", "new_feature": True})

# Merge with API configuration
client.set_config_override(
    "ui-settings",
    {"new_feature": True},
    ConfigOverrideOptions(merge=True),
)

# Force a specific variation
client.set_variation_override("experiment", "variant_a")

# Clear overrides
client.clear_all_overrides()
```

## Framework Integration

### FastAPI

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request
from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

client: AsyncFlagClient | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client
    config = FlagClientConfig(api_key="sdk_your_key")
    client = AsyncFlagClient(config)
    await client.__aenter__()
    yield
    await client.close()

app = FastAPI(lifespan=lifespan)

def get_flag_context(request: Request) -> FlagContext:
    return FlagContext(
        user_id=request.headers.get("X-User-ID"),
        ip_address=request.client.host if request.client else None,
    )

@app.get("/api/feature/{user_id}")
async def get_feature(user_id: str, context: FlagContext = Depends(get_flag_context)):
    context.user_id = user_id
    enabled = await client.is_enabled("new-feature", context)
    return {"enabled": enabled}
```

### Flask

```python
import atexit
from flask import Flask, g, request
from savvagent import FlagClient, FlagClientConfig, FlagContext

app = Flask(__name__)

config = FlagClientConfig(api_key="sdk_your_key")
client = FlagClient(config)
atexit.register(client.close)

@app.before_request
def before_request():
    g.flag_context = FlagContext(
        user_id=request.headers.get("X-User-ID"),
        ip_address=request.remote_addr,
    )

@app.route("/api/feature/<user_id>")
def get_feature(user_id: str):
    g.flag_context.user_id = user_id
    enabled = client.is_enabled("new-feature", g.flag_context)
    return {"enabled": enabled}
```

### Django

```python
# middleware.py
from savvagent import FlagClient, FlagClientConfig, FlagContext

_client = None

def get_client():
    global _client
    if _client is None:
        from django.conf import settings
        _client = FlagClient(FlagClientConfig(
            api_key=settings.SAVVAGENT_API_KEY,
        ))
    return _client

class SavvagentMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.savvagent = get_client()
        request.flag_context = FlagContext(
            user_id=str(request.user.id) if request.user.is_authenticated else None,
            ip_address=request.META.get("REMOTE_ADDR"),
        )
        return self.get_response(request)

# views.py
def my_view(request):
    enabled = request.savvagent.is_enabled("new-feature", request.flag_context)
    return JsonResponse({"enabled": enabled})
```

## API Reference

### FlagClient / AsyncFlagClient

#### Constructor

```python
FlagClient(config: FlagClientConfig)
AsyncFlagClient(config: FlagClientConfig)
```

#### Methods

##### evaluate(flag_key, context?) → FlagEvaluationResult

Evaluate a feature flag and return detailed results.

```python
result = client.evaluate("my-flag", FlagContext(user_id="123"))
# Returns: FlagEvaluationResult(key, value, configuration, variation, reason, metadata)
```

##### is_enabled(flag_key, context?) → bool

Check if a flag is enabled.

```python
enabled = client.is_enabled("my-flag", FlagContext(user_id="123"))
```

##### get_config(flag_key, context?, default?) → Any

Get dynamic configuration for an enabled flag.

```python
config = client.get_config("settings-flag", context, default={"timeout": 30})
```

##### get_variation(flag_key, context?) → VariationResult

Get variation details for multi-variant flags.

```python
variation = client.get_variation("experiment", context)
# Returns: VariationResult(variation, enabled, configuration)
```

##### track_error(flag_key, error, context?)

Track an error that occurred in flagged code.

```python
client.track_error("my-flag", exception, FlagContext(user_id="123"))
```

##### subscribe(flag_key, callback) → Callable

Subscribe to real-time flag updates.

```python
unsubscribe = client.subscribe("my-flag", lambda: print("Updated!"))
```

##### invalidate_cache(flag_key?)

Manually invalidate cache.

```python
client.invalidate_cache("my-flag")  # Specific flag
client.invalidate_cache()  # All flags
```

##### close()

Clean up resources.

```python
client.close()
```

### FlagContext

Context for flag evaluation targeting.

```python
context = FlagContext(
    user_id="user-123",           # For logged-in users
    anonymous_id="anon-456",      # For anonymous users
    session_id="session-789",     # Session identifier
    environment="production",      # Target environment
    organization_id="org-abc",    # For multi-tenant apps
    application_id="app-def",     # Auto-injected from config
    ip_address="192.168.1.1",     # For geo-targeting
    user_agent="Mozilla/5.0...",  # For device targeting
    attributes={                   # Custom targeting
        "plan": "premium",
        "country": "US",
    },
)
```

## Best Practices

1. **Reuse Client Instance**: Create one client and reuse it across your application
2. **Use Context Managers**: Use `with` or `async with` for automatic cleanup
3. **Error Handling**: Wrap flagged code with error tracking
4. **Rich Context**: Provide detailed context for better targeting
5. **Set Defaults**: Configure sensible defaults for all flags
6. **Cleanup**: Call `client.close()` on shutdown

## Requirements

- Python 3.9+
- httpx >= 0.25.0
- httpx-sse >= 0.4.0

## License

MIT

## Support

- Documentation: https://docs.savvagent.com
- Issues: https://github.com/savvagent/savvagent-sdks/issues
- Email: support@savvagent.com

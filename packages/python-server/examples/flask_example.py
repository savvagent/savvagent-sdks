"""
Flask Example for Savvagent SDK

This example demonstrates how to use the Savvagent SDK with Flask,
including module-level client initialization and request context extraction.

Requirements:
    pip install savvagent flask

Run:
    python examples/flask_example.py
"""

import atexit
import os

from flask import Flask, g, jsonify, request

from savvagent import FlagClient, FlagClientConfig, FlagContext

app = Flask(__name__)

# Initialize client at module level (singleton pattern)
config = FlagClientConfig(
    api_key=os.getenv("SAVVAGENT_API_KEY", "sdk_your_key_here"),
    application_id=os.getenv("SAVVAGENT_APP_ID"),
    enable_realtime=True,
)
client = FlagClient(config)


# Clean up on shutdown
atexit.register(client.close)


def get_flag_context() -> FlagContext:
    """Extract flag context from Flask request."""
    return FlagContext(
        user_id=request.headers.get("X-User-ID"),
        session_id=request.headers.get("X-Session-ID"),
        ip_address=request.remote_addr,
        user_agent=request.user_agent.string if request.user_agent else None,
        environment=os.getenv("ENVIRONMENT", "development"),
    )


@app.before_request
def before_request():
    """Attach flag context to Flask g object."""
    g.flag_context = get_flag_context()


@app.route("/")
def root():
    """Health check endpoint."""
    return jsonify({"status": "ok", "service": "savvagent-flask-example"})


@app.route("/api/features/<user_id>")
def get_features(user_id: str):
    """Get feature flags for a user."""
    context = g.flag_context
    context.user_id = user_id

    new_ui = client.is_enabled("new-ui", context)
    beta_features = client.is_enabled("beta-features", context)
    dark_mode = client.is_enabled("dark-mode", context)

    return jsonify({
        "user_id": user_id,
        "features": {
            "new_ui": new_ui,
            "beta_features": beta_features,
            "dark_mode": dark_mode,
        },
    })


@app.route("/api/settings")
def get_settings():
    """Get dynamic configuration from a feature flag."""
    context = g.flag_context

    processing_config = client.get_config(
        "processing-settings",
        context,
        default={"method": "basic", "timeout": 30, "retry_count": 3},
    )

    return jsonify({
        "settings": processing_config,
    })


@app.route("/api/experiment")
def get_experiment():
    """Get A/B test variation for a user."""
    context = g.flag_context

    variation = client.get_variation("checkout-experiment", context)

    return jsonify({
        "experiment": "checkout-experiment",
        "variation": variation.variation,
        "enabled": variation.enabled,
        "configuration": variation.configuration,
    })


@app.route("/api/process", methods=["POST"])
def process_data():
    """Process data with feature flag controlled behavior."""
    context = g.flag_context

    use_new_processor = client.is_enabled("new-processor", context)

    try:
        if use_new_processor:
            # New processing logic
            result = {"processor": "v2", "status": "processed"}
        else:
            # Legacy processing logic
            result = {"processor": "v1", "status": "processed"}

        return jsonify(result)

    except Exception as e:
        # Track errors correlated with the feature flag
        client.track_error("new-processor", e, context)
        raise


# Middleware example for feature-gated routes
def require_feature(flag_key: str):
    """Decorator to require a feature flag for a route."""
    from functools import wraps

    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            context = g.flag_context
            if not client.is_enabled(flag_key, context):
                return jsonify({"error": "Feature not available"}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator


@app.route("/api/premium-feature")
@require_feature("premium-access")
def premium_feature():
    """A route that requires the premium-access flag."""
    return jsonify({"message": "Welcome to premium features!"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

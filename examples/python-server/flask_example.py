"""
Savvagent Python Server Example - Flask

This example demonstrates how to use the Savvagent Python SDK with Flask
for feature-gated API endpoints using the synchronous client.
"""

import atexit
import os

from flask import Flask, g, jsonify, request

from savvagent import FlagClient, FlagClientConfig, FlagContext

app = Flask(__name__)

# Initialize Savvagent client
config = FlagClientConfig(
    api_key=os.environ.get("SAVVAGENT_API_KEY", "sdk_your_key_here"),
    application_id=os.environ.get("SAVVAGENT_APP_ID", "python-server-example"),
    base_url=os.environ.get("SAVVAGENT_API_URL", "http://localhost:8080"),
    enable_realtime=True,
    cache_ttl=60,
    enable_telemetry=True,
)

client = FlagClient(config)
atexit.register(client.close)

print(f"Savvagent client initialized - API URL: {config.base_url}")


@app.before_request
def before_request():
    """Create flag context for each request."""
    g.flag_context = FlagContext(
        user_id=request.headers.get("X-User-ID"),
        ip_address=request.remote_addr,
        user_agent=request.headers.get("User-Agent"),
        attributes={
            "path": request.path,
            "method": request.method,
        },
    )


@app.route("/health")
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "ok"})


@app.route("/api/features/<user_id>")
def get_features(user_id: str):
    """Get all feature flags for a user."""
    g.flag_context.user_id = user_id

    try:
        new_ui = client.is_enabled("new-ui", g.flag_context)
        beta_features = client.is_enabled("beta-features", g.flag_context)
        advanced_analytics = client.is_enabled("advanced-analytics", g.flag_context)

        return jsonify({
            "userId": user_id,
            "features": {
                "newUI": new_ui,
                "betaFeatures": beta_features,
                "advancedAnalytics": advanced_analytics,
            },
        })
    except Exception as e:
        return jsonify({"error": f"Failed to check feature flags: {e}"}), 500


@app.route("/api/data", methods=["POST"])
def process_data():
    """Process data with feature-gated functionality."""
    data = request.get_json() or {}
    user_id = data.get("userId", "anonymous")

    g.flag_context.user_id = user_id
    g.flag_context.attributes["endpoint"] = "/api/data"

    try:
        advanced_processing = client.is_enabled("advanced-processing", g.flag_context)

        if advanced_processing:
            result = {
                "processed": True,
                "method": "advanced",
                "data": data.get("data", {}),
            }
        else:
            result = {
                "processed": True,
                "method": "basic",
                "data": data.get("data", {}),
            }

        return jsonify(result)

    except Exception as e:
        client.track_error("advanced-processing", e, g.flag_context)
        return jsonify({"error": f"Failed to process data: {e}"}), 500


@app.route("/api/config/<user_id>")
def get_user_config(user_id: str):
    """Get dynamic configuration for a user."""
    g.flag_context.user_id = user_id

    try:
        ui_config = client.get_config(
            "ui-settings",
            g.flag_context,
            default={"theme": "light", "density": "normal", "language": "en"},
        )

        return jsonify({
            "userId": user_id,
            "config": ui_config,
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get config: {e}"}), 500


@app.route("/api/experiment/<user_id>")
def get_experiment_variation(user_id: str):
    """Get experiment variation for A/B testing."""
    g.flag_context.user_id = user_id

    try:
        variation = client.get_variation("checkout-experiment", g.flag_context)

        return jsonify({
            "userId": user_id,
            "experiment": "checkout-experiment",
            "variation": variation.variation,
            "enabled": variation.enabled,
            "configuration": variation.configuration,
        })
    except Exception as e:
        return jsonify({"error": f"Failed to get variation: {e}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)

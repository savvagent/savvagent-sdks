"""
FastAPI Example for Savvagent SDK

This example demonstrates how to use the Savvagent SDK with FastAPI,
including dependency injection, lifespan management, and async evaluation.

Requirements:
    pip install savvagent fastapi uvicorn

Run:
    uvicorn examples.fastapi_example:app --reload
"""

import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request

from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

# Global client instance
client: AsyncFlagClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage the Savvagent client lifecycle."""
    global client

    config = FlagClientConfig(
        api_key=os.getenv("SAVVAGENT_API_KEY", "sdk_your_key_here"),
        application_id=os.getenv("SAVVAGENT_APP_ID"),
        enable_realtime=True,
    )

    client = AsyncFlagClient(config)
    await client.__aenter__()

    yield

    await client.close()


app = FastAPI(
    title="Savvagent FastAPI Example",
    lifespan=lifespan,
)


def get_client() -> AsyncFlagClient:
    """Dependency to get the Savvagent client."""
    if client is None:
        raise RuntimeError("Savvagent client not initialized")
    return client


def get_flag_context(request: Request) -> FlagContext:
    """Extract flag context from the request."""
    return FlagContext(
        user_id=request.headers.get("X-User-ID"),
        session_id=request.headers.get("X-Session-ID"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
        environment=os.getenv("ENVIRONMENT", "development"),
    )


# Type aliases for dependencies
SavvagentClient = Annotated[AsyncFlagClient, Depends(get_client)]
RequestContext = Annotated[FlagContext, Depends(get_flag_context)]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "savvagent-fastapi-example"}


@app.get("/api/features/{user_id}")
async def get_features(
    user_id: str,
    savvagent: SavvagentClient,
    context: RequestContext,
):
    """Get feature flags for a user."""
    # Override user_id from path parameter
    context.user_id = user_id

    # Check multiple flags concurrently
    new_ui = await savvagent.is_enabled("new-ui", context)
    beta_features = await savvagent.is_enabled("beta-features", context)
    dark_mode = await savvagent.is_enabled("dark-mode", context)

    return {
        "user_id": user_id,
        "features": {
            "new_ui": new_ui,
            "beta_features": beta_features,
            "dark_mode": dark_mode,
        },
    }


@app.get("/api/settings")
async def get_settings(
    savvagent: SavvagentClient,
    context: RequestContext,
):
    """Get dynamic configuration from a feature flag."""
    # Get configuration with a default fallback
    processing_config = await savvagent.get_config(
        "processing-settings",
        context,
        default={"method": "basic", "timeout": 30, "retry_count": 3},
    )

    return {
        "settings": processing_config,
    }


@app.get("/api/experiment")
async def get_experiment(
    savvagent: SavvagentClient,
    context: RequestContext,
):
    """Get A/B test variation for a user."""
    variation = await savvagent.get_variation("checkout-experiment", context)

    return {
        "experiment": "checkout-experiment",
        "variation": variation.variation,
        "enabled": variation.enabled,
        "configuration": variation.configuration,
    }


@app.post("/api/process")
async def process_data(
    request: Request,
    savvagent: SavvagentClient,
    context: RequestContext,
):
    """Process data with feature flag controlled behavior."""
    use_new_processor = await savvagent.is_enabled("new-processor", context)

    try:
        if use_new_processor:
            # New processing logic
            result = {"processor": "v2", "status": "processed"}
        else:
            # Legacy processing logic
            result = {"processor": "v1", "status": "processed"}

        return result

    except Exception as e:
        # Track errors correlated with the feature flag
        await savvagent.track_error("new-processor", e, context)
        raise


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

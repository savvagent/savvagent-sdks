"""
Savvagent Python Server Example - FastAPI

This example demonstrates how to use the Savvagent Python SDK with FastAPI
for feature-gated API endpoints.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from savvagent import AsyncFlagClient, FlagClientConfig, FlagContext

# Global client instance
client: AsyncFlagClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage Savvagent client lifecycle."""
    global client

    config = FlagClientConfig(
        api_key=os.environ.get("SAVVAGENT_API_KEY", "sdk_your_key_here"),
        application_id=os.environ.get("SAVVAGENT_APP_ID", "python-server-example"),
        base_url=os.environ.get("SAVVAGENT_API_URL", "http://localhost:8080"),
        enable_realtime=True,
        cache_ttl=60,
        enable_telemetry=True,
    )

    client = AsyncFlagClient(config)
    await client.__aenter__()
    print(f"Savvagent client initialized - API URL: {config.base_url}")

    yield

    await client.close()
    print("Savvagent client closed")


app = FastAPI(
    title="Savvagent Python Example",
    description="Example FastAPI server demonstrating Savvagent SDK usage",
    version="1.0.0",
    lifespan=lifespan,
)


def get_flag_context(request: Request) -> FlagContext:
    """Extract flag context from request."""
    return FlagContext(
        user_id=request.headers.get("X-User-ID"),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
        attributes={
            "path": request.url.path,
            "method": request.method,
        },
    )


class DataRequest(BaseModel):
    """Request body for data processing endpoint."""

    user_id: str = "anonymous"
    data: dict[str, Any] = {}


class FeatureResponse(BaseModel):
    """Response with user features."""

    user_id: str
    features: dict[str, bool]


class ProcessedResponse(BaseModel):
    """Response from data processing."""

    processed: bool
    method: str
    data: dict[str, Any]


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/features/{user_id}", response_model=FeatureResponse)
async def get_features(
    user_id: str,
    context: FlagContext = Depends(get_flag_context),
):
    """Get all feature flags for a user."""
    if client is None:
        raise HTTPException(status_code=503, detail="Savvagent client not initialized")

    context.user_id = user_id

    try:
        new_ui, beta_features, advanced_analytics = await asyncio.gather(
            client.is_enabled("new-ui", context),
            client.is_enabled("beta-features", context),
            client.is_enabled("advanced-analytics", context),
        )

        return FeatureResponse(
            user_id=user_id,
            features={
                "newUI": new_ui,
                "betaFeatures": beta_features,
                "advancedAnalytics": advanced_analytics,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check feature flags: {e}")


@app.post("/api/data", response_model=ProcessedResponse)
async def process_data(
    request_body: DataRequest,
    context: FlagContext = Depends(get_flag_context),
):
    """Process data with feature-gated functionality."""
    if client is None:
        raise HTTPException(status_code=503, detail="Savvagent client not initialized")

    context.user_id = request_body.user_id
    context.attributes["endpoint"] = "/api/data"

    try:
        advanced_processing = await client.is_enabled("advanced-processing", context)

        if advanced_processing:
            result = ProcessedResponse(
                processed=True,
                method="advanced",
                data=request_body.data,
            )
        else:
            result = ProcessedResponse(
                processed=True,
                method="basic",
                data=request_body.data,
            )

        return result

    except Exception as e:
        await client.track_error("advanced-processing", e, context)
        raise HTTPException(status_code=500, detail=f"Failed to process data: {e}")


@app.get("/api/config/{user_id}")
async def get_user_config(
    user_id: str,
    context: FlagContext = Depends(get_flag_context),
):
    """Get dynamic configuration for a user."""
    if client is None:
        raise HTTPException(status_code=503, detail="Savvagent client not initialized")

    context.user_id = user_id

    try:
        ui_config = await client.get_config(
            "ui-settings",
            context,
            default={"theme": "light", "density": "normal", "language": "en"},
        )

        return {
            "user_id": user_id,
            "config": ui_config,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get config: {e}")


@app.get("/api/experiment/{user_id}")
async def get_experiment_variation(
    user_id: str,
    context: FlagContext = Depends(get_flag_context),
):
    """Get experiment variation for A/B testing."""
    if client is None:
        raise HTTPException(status_code=503, detail="Savvagent client not initialized")

    context.user_id = user_id

    try:
        variation = await client.get_variation("checkout-experiment", context)

        return {
            "user_id": user_id,
            "experiment": "checkout-experiment",
            "variation": variation.variation,
            "enabled": variation.enabled,
            "configuration": variation.configuration,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get variation: {e}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

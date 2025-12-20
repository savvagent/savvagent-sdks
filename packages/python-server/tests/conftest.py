"""Shared test fixtures for Savvagent SDK tests."""

import pytest
import httpx
import respx

from savvagent import FlagClient, AsyncFlagClient, FlagClientConfig


@pytest.fixture
def client_config() -> FlagClientConfig:
    """Create a test client configuration."""
    return FlagClientConfig(
        api_key="sdk_test_key_12345",
        application_id="test-app",
        base_url="https://api.savvagent.com",
        enable_realtime=False,  # Disable for unit tests
        enable_telemetry=False,  # Disable for unit tests
        cache_ttl=60,
        timeout=5.0,
        defaults={"default-flag": True},
    )


@pytest.fixture
def client(client_config: FlagClientConfig) -> FlagClient:
    """Create a sync FlagClient for testing."""
    client = FlagClient(client_config)
    yield client
    client.close()


@pytest.fixture
async def async_client(client_config: FlagClientConfig) -> AsyncFlagClient:
    """Create an async FlagClient for testing."""
    async with AsyncFlagClient(client_config) as client:
        yield client


@pytest.fixture
def mock_api():
    """Fixture to mock API responses."""
    with respx.mock(assert_all_called=False) as respx_mock:
        yield respx_mock


def mock_flag_response(
    respx_mock: respx.MockRouter,
    flag_key: str,
    value: bool = True,
    configuration: dict | None = None,
    variation: str | None = None,
    flag_id: str = "flag_123",
) -> None:
    """Helper to mock a flag evaluation response."""
    response_data = {
        "value": value,
        "flagId": flag_id,
        "configuration": configuration,
        "variation": variation,
    }
    respx_mock.post(
        f"https://api.savvagent.com/api/flags/{flag_key}/evaluate"
    ).mock(return_value=httpx.Response(200, json=response_data))


def mock_flags_list_response(
    respx_mock: respx.MockRouter,
    flags: list[dict],
) -> None:
    """Helper to mock get all flags response."""
    respx_mock.get("https://api.savvagent.com/api/sdk/flags").mock(
        return_value=httpx.Response(
            200,
            json={
                "flags": flags,
                "count": len(flags),
                "organization_id": "org_123",
                "application_id": "app_123",
            },
        )
    )

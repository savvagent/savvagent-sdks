"""
Django Example for Savvagent SDK

This example demonstrates how to use the Savvagent SDK with Django,
including singleton client pattern, middleware for context injection,
and usage in views.

This file shows the pattern - actual Django projects would split this
across settings.py, middleware.py, and views.py files.

Requirements:
    pip install savvagent django

Setup:
    1. Add 'savvagent_app' to INSTALLED_APPS
    2. Add SavvagentMiddleware to MIDDLEWARE
    3. Set SAVVAGENT_API_KEY in settings
"""

import os
from functools import wraps
from typing import Any

# =============================================================================
# savvagent_client.py - Singleton client pattern
# =============================================================================

from savvagent import FlagClient, FlagClientConfig, FlagContext

_client: FlagClient | None = None


def get_savvagent_client() -> FlagClient:
    """Get or create the Savvagent client singleton."""
    global _client
    if _client is None:
        from django.conf import settings

        config = FlagClientConfig(
            api_key=getattr(settings, "SAVVAGENT_API_KEY", os.getenv("SAVVAGENT_API_KEY", "")),
            application_id=getattr(settings, "SAVVAGENT_APP_ID", None),
            enable_realtime=getattr(settings, "SAVVAGENT_ENABLE_REALTIME", True),
            enable_telemetry=getattr(settings, "SAVVAGENT_ENABLE_TELEMETRY", True),
        )
        _client = FlagClient(config)
    return _client


def close_savvagent_client() -> None:
    """Close the Savvagent client (call on shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None


# =============================================================================
# middleware.py - Request context extraction
# =============================================================================

from django.http import HttpRequest, HttpResponse


class SavvagentMiddleware:
    """Django middleware to attach flag context to requests."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.client = get_savvagent_client()

    def __call__(self, request: HttpRequest) -> HttpResponse:
        # Attach flag context to request
        request.flag_context = self._build_context(request)
        request.savvagent = self.client

        response = self.get_response(request)
        return response

    def _build_context(self, request: HttpRequest) -> FlagContext:
        """Build flag context from Django request."""
        user_id = None
        if hasattr(request, "user") and request.user.is_authenticated:
            user_id = str(request.user.id)

        return FlagContext(
            user_id=user_id,
            session_id=request.session.session_key if hasattr(request, "session") else None,
            ip_address=self._get_client_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT"),
            environment=os.getenv("ENVIRONMENT", "development"),
        )

    def _get_client_ip(self, request: HttpRequest) -> str:
        """Extract client IP from request."""
        x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if x_forwarded_for:
            return x_forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")


# =============================================================================
# decorators.py - View decorators for feature flags
# =============================================================================

from django.http import JsonResponse


def require_feature(flag_key: str):
    """Decorator to require a feature flag for a view."""

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request: HttpRequest, *args, **kwargs):
            client = get_savvagent_client()
            context = getattr(request, "flag_context", FlagContext())

            if not client.is_enabled(flag_key, context):
                return JsonResponse(
                    {"error": "Feature not available"},
                    status=403,
                )
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator


def with_feature_flag(flag_key: str, attribute_name: str = "feature_enabled"):
    """Decorator to inject feature flag status into request."""

    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request: HttpRequest, *args, **kwargs):
            client = get_savvagent_client()
            context = getattr(request, "flag_context", FlagContext())

            setattr(request, attribute_name, client.is_enabled(flag_key, context))
            return view_func(request, *args, **kwargs)

        return wrapper

    return decorator


# =============================================================================
# views.py - Example views
# =============================================================================

from django.views import View


def health_check(request: HttpRequest) -> JsonResponse:
    """Health check endpoint."""
    return JsonResponse({"status": "ok", "service": "savvagent-django-example"})


def get_features(request: HttpRequest, user_id: str) -> JsonResponse:
    """Get feature flags for a user."""
    client = request.savvagent
    context = request.flag_context
    context.user_id = user_id

    new_ui = client.is_enabled("new-ui", context)
    beta_features = client.is_enabled("beta-features", context)
    dark_mode = client.is_enabled("dark-mode", context)

    return JsonResponse({
        "user_id": user_id,
        "features": {
            "new_ui": new_ui,
            "beta_features": beta_features,
            "dark_mode": dark_mode,
        },
    })


def get_settings(request: HttpRequest) -> JsonResponse:
    """Get dynamic configuration from a feature flag."""
    client = request.savvagent
    context = request.flag_context

    processing_config = client.get_config(
        "processing-settings",
        context,
        default={"method": "basic", "timeout": 30, "retry_count": 3},
    )

    return JsonResponse({
        "settings": processing_config,
    })


def get_experiment(request: HttpRequest) -> JsonResponse:
    """Get A/B test variation for a user."""
    client = request.savvagent
    context = request.flag_context

    variation = client.get_variation("checkout-experiment", context)

    return JsonResponse({
        "experiment": "checkout-experiment",
        "variation": variation.variation,
        "enabled": variation.enabled,
        "configuration": variation.configuration,
    })


@require_feature("premium-access")
def premium_feature(request: HttpRequest) -> JsonResponse:
    """A view that requires the premium-access flag."""
    return JsonResponse({"message": "Welcome to premium features!"})


class FeatureGatedView(View):
    """Class-based view with feature flag."""

    def get(self, request: HttpRequest) -> JsonResponse:
        client = request.savvagent
        context = request.flag_context

        if client.is_enabled("new-dashboard", context):
            return JsonResponse({"dashboard": "v2", "features": ["charts", "realtime"]})
        else:
            return JsonResponse({"dashboard": "v1", "features": ["basic"]})


# =============================================================================
# apps.py - Django app configuration with cleanup
# =============================================================================

from django.apps import AppConfig


class SavvagentAppConfig(AppConfig):
    """Django app configuration for Savvagent integration."""

    name = "savvagent_app"
    verbose_name = "Savvagent Feature Flags"

    def ready(self) -> None:
        """Initialize Savvagent client on app startup."""
        import atexit

        # Initialize the client
        get_savvagent_client()

        # Register cleanup on shutdown
        atexit.register(close_savvagent_client)


# =============================================================================
# urls.py - Example URL configuration
# =============================================================================
#
# from django.urls import path
# from . import views
#
# urlpatterns = [
#     path('', views.health_check, name='health'),
#     path('api/features/<str:user_id>/', views.get_features, name='features'),
#     path('api/settings/', views.get_settings, name='settings'),
#     path('api/experiment/', views.get_experiment, name='experiment'),
#     path('api/premium/', views.premium_feature, name='premium'),
#     path('api/dashboard/', views.FeatureGatedView.as_view(), name='dashboard'),
# ]

# =============================================================================
# settings.py additions
# =============================================================================
#
# SAVVAGENT_API_KEY = os.getenv("SAVVAGENT_API_KEY", "sdk_your_key_here")
# SAVVAGENT_APP_ID = os.getenv("SAVVAGENT_APP_ID")
# SAVVAGENT_ENABLE_REALTIME = True
# SAVVAGENT_ENABLE_TELEMETRY = True
#
# MIDDLEWARE = [
#     ...
#     'your_app.middleware.SavvagentMiddleware',
# ]

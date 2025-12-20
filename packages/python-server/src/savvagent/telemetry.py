"""
Savvagent Python Server SDK - Telemetry Service

Per SDK Developer Guide: Batch evaluations and send every 5-10 seconds.
"""

from __future__ import annotations

import asyncio
import sys
import threading
from datetime import datetime, timezone
from typing import Any

import httpx

from .types import ErrorEvent, EvaluationEvent


class TelemetryService:
    """
    Synchronous service for tracking flag evaluations and errors.

    Per SDK Developer Guide: Batch evaluations and send every 5-10 seconds.
    Errors are flushed immediately as critical telemetry.
    """

    BATCH_SIZE = 50
    FLUSH_INTERVAL = 5.0  # seconds

    def __init__(self, base_url: str, api_key: str, enabled: bool = True) -> None:
        """
        Initialize the telemetry service.

        Args:
            base_url: Base URL for the Savvagent API.
            api_key: API key for authentication.
            enabled: Whether telemetry is enabled.
        """
        self._base_url = base_url
        self._api_key = api_key
        self._enabled = enabled
        self._evaluation_queue: list[EvaluationEvent] = []
        self._error_queue: list[ErrorEvent] = []
        self._lock = threading.Lock()
        self._flush_timer: threading.Timer | None = None
        self._closed = False

        if self._enabled:
            self._start_auto_flush()

    def track_evaluation(self, event: EvaluationEvent) -> None:
        """
        Track a flag evaluation.

        Args:
            event: The evaluation event to track.
        """
        if not self._enabled:
            return

        with self._lock:
            self._evaluation_queue.append(event)
            if len(self._evaluation_queue) >= self.BATCH_SIZE:
                self._flush_evaluations_unlocked()

    def track_error(self, event: ErrorEvent) -> None:
        """
        Track an error in flagged code.

        Errors are flushed immediately as they're critical telemetry.

        Args:
            event: The error event to track.
        """
        if not self._enabled:
            return

        with self._lock:
            self._error_queue.append(event)

        # Flush errors immediately (critical telemetry)
        self._flush_errors()

    def _start_auto_flush(self) -> None:
        """Start auto-flushing events on a timer."""

        def flush_loop() -> None:
            if not self._closed:
                self.flush()
                self._flush_timer = threading.Timer(self.FLUSH_INTERVAL, flush_loop)
                self._flush_timer.daemon = True
                self._flush_timer.start()

        self._flush_timer = threading.Timer(self.FLUSH_INTERVAL, flush_loop)
        self._flush_timer.daemon = True
        self._flush_timer.start()

    def flush(self) -> None:
        """Flush all events to the server."""
        self._flush_evaluations()
        self._flush_errors()

    def _flush_evaluations_unlocked(self) -> None:
        """Flush evaluations without acquiring lock (caller must hold lock)."""
        if not self._evaluation_queue:
            return

        events = self._evaluation_queue.copy()
        self._evaluation_queue.clear()

        # Release lock before making HTTP request
        self._lock.release()
        try:
            self._send_evaluations(events)
        finally:
            self._lock.acquire()

    def _flush_evaluations(self) -> None:
        """
        Flush evaluation events to the server.

        Per SDK Developer Guide: POST /api/telemetry/evaluations with { "evaluations": [...] }
        """
        with self._lock:
            if not self._evaluation_queue:
                return
            events = self._evaluation_queue.copy()
            self._evaluation_queue.clear()

        self._send_evaluations(events)

    def _send_evaluations(self, events: list[EvaluationEvent]) -> None:
        """Send evaluation events to the API."""
        # Transform to API format per SDK Developer Guide
        evaluations = [
            {
                "flag_key": e.flag_key,
                "result": e.result,
                "user_id": e.context.user_id if e.context else None,
                "context": e.context.to_dict() if e.context else None,
                "timestamp": self._parse_timestamp(e.timestamp),
            }
            for e in events
        ]

        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.post(
                    f"{self._base_url}/api/telemetry/evaluations",
                    json={"evaluations": evaluations},
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._api_key}",
                    },
                )
                if not response.is_success:
                    print(
                        f"[Savvagent] Failed to send evaluations: {response.status_code}",
                        file=sys.stderr,
                    )
        except Exception as e:
            print(f"[Savvagent] Error sending evaluations: {e}", file=sys.stderr)

    def _flush_errors(self) -> None:
        """
        Flush error events to the server.

        Per SDK Developer Guide: POST /api/telemetry/errors with { "errors": [...] }
        """
        with self._lock:
            if not self._error_queue:
                return
            events = self._error_queue.copy()
            self._error_queue.clear()

        # Transform to API format per SDK Developer Guide
        errors = [
            {
                "flag_key": e.flag_key,
                "flag_enabled": e.flag_enabled,
                "error_type": e.error_type,
                "error_message": e.error_message,
                "stack_trace": e.stack_trace,
                "context": e.context.to_dict() if e.context else None,
                "timestamp": self._parse_timestamp(e.timestamp),
            }
            for e in events
        ]

        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.post(
                    f"{self._base_url}/api/telemetry/errors",
                    json={"errors": errors},
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self._api_key}",
                    },
                )
                if not response.is_success:
                    print(
                        f"[Savvagent] Failed to send errors: {response.status_code}",
                        file=sys.stderr,
                    )
        except Exception as e:
            print(f"[Savvagent] Error sending errors: {e}", file=sys.stderr)

    def _parse_timestamp(self, timestamp: str) -> int:
        """Parse ISO timestamp to Unix timestamp."""
        if not timestamp:
            return int(datetime.now(timezone.utc).timestamp())
        try:
            # Handle Z suffix
            ts = timestamp.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts)
            return int(dt.timestamp())
        except ValueError:
            return int(datetime.now(timezone.utc).timestamp())

    def close(self) -> None:
        """Clean up resources and flush remaining events."""
        self._closed = True
        if self._flush_timer:
            self._flush_timer.cancel()
            self._flush_timer = None
        self.flush()


class AsyncTelemetryService:
    """
    Asynchronous service for tracking flag evaluations and errors.

    Per SDK Developer Guide: Batch evaluations and send every 5-10 seconds.
    Errors are flushed immediately as critical telemetry.
    """

    BATCH_SIZE = 50
    FLUSH_INTERVAL = 5.0  # seconds

    def __init__(self, base_url: str, api_key: str, enabled: bool = True) -> None:
        """
        Initialize the telemetry service.

        Args:
            base_url: Base URL for the Savvagent API.
            api_key: API key for authentication.
            enabled: Whether telemetry is enabled.
        """
        self._base_url = base_url
        self._api_key = api_key
        self._enabled = enabled
        self._evaluation_queue: list[EvaluationEvent] = []
        self._error_queue: list[ErrorEvent] = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task[Any] | None = None
        self._closed = False
        self._client: httpx.AsyncClient | None = None

    async def start(self) -> None:
        """Start the telemetry service."""
        if self._enabled:
            self._client = httpx.AsyncClient(timeout=5.0)
            self._flush_task = asyncio.create_task(self._auto_flush_loop())

    async def _auto_flush_loop(self) -> None:
        """Auto-flush loop running in the background."""
        while not self._closed:
            await asyncio.sleep(self.FLUSH_INTERVAL)
            if not self._closed:
                await self.flush()

    async def track_evaluation(self, event: EvaluationEvent) -> None:
        """
        Track a flag evaluation.

        Args:
            event: The evaluation event to track.
        """
        if not self._enabled:
            return

        async with self._lock:
            self._evaluation_queue.append(event)
            if len(self._evaluation_queue) >= self.BATCH_SIZE:
                await self._flush_evaluations_unlocked()

    async def track_error(self, event: ErrorEvent) -> None:
        """
        Track an error in flagged code.

        Errors are flushed immediately as they're critical telemetry.

        Args:
            event: The error event to track.
        """
        if not self._enabled:
            return

        async with self._lock:
            self._error_queue.append(event)

        # Flush errors immediately (critical telemetry)
        await self._flush_errors()

    async def flush(self) -> None:
        """Flush all events to the server."""
        await asyncio.gather(
            self._flush_evaluations(),
            self._flush_errors(),
        )

    async def _flush_evaluations_unlocked(self) -> None:
        """Flush evaluations (caller must hold lock)."""
        if not self._evaluation_queue:
            return

        events = self._evaluation_queue.copy()
        self._evaluation_queue.clear()

        await self._send_evaluations(events)

    async def _flush_evaluations(self) -> None:
        """
        Flush evaluation events to the server.

        Per SDK Developer Guide: POST /api/telemetry/evaluations with { "evaluations": [...] }
        """
        async with self._lock:
            if not self._evaluation_queue:
                return
            events = self._evaluation_queue.copy()
            self._evaluation_queue.clear()

        await self._send_evaluations(events)

    async def _send_evaluations(self, events: list[EvaluationEvent]) -> None:
        """Send evaluation events to the API."""
        if not self._client:
            return

        # Transform to API format per SDK Developer Guide
        evaluations = [
            {
                "flag_key": e.flag_key,
                "result": e.result,
                "user_id": e.context.user_id if e.context else None,
                "context": e.context.to_dict() if e.context else None,
                "timestamp": self._parse_timestamp(e.timestamp),
            }
            for e in events
        ]

        try:
            response = await self._client.post(
                f"{self._base_url}/api/telemetry/evaluations",
                json={"evaluations": evaluations},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
            )
            if not response.is_success:
                print(
                    f"[Savvagent] Failed to send evaluations: {response.status_code}",
                    file=sys.stderr,
                )
        except Exception as e:
            print(f"[Savvagent] Error sending evaluations: {e}", file=sys.stderr)

    async def _flush_errors(self) -> None:
        """
        Flush error events to the server.

        Per SDK Developer Guide: POST /api/telemetry/errors with { "errors": [...] }
        """
        async with self._lock:
            if not self._error_queue:
                return
            events = self._error_queue.copy()
            self._error_queue.clear()

        if not self._client:
            return

        # Transform to API format per SDK Developer Guide
        errors = [
            {
                "flag_key": e.flag_key,
                "flag_enabled": e.flag_enabled,
                "error_type": e.error_type,
                "error_message": e.error_message,
                "stack_trace": e.stack_trace,
                "context": e.context.to_dict() if e.context else None,
                "timestamp": self._parse_timestamp(e.timestamp),
            }
            for e in events
        ]

        try:
            response = await self._client.post(
                f"{self._base_url}/api/telemetry/errors",
                json={"errors": errors},
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
            )
            if not response.is_success:
                print(
                    f"[Savvagent] Failed to send errors: {response.status_code}",
                    file=sys.stderr,
                )
        except Exception as e:
            print(f"[Savvagent] Error sending errors: {e}", file=sys.stderr)

    def _parse_timestamp(self, timestamp: str) -> int:
        """Parse ISO timestamp to Unix timestamp."""
        if not timestamp:
            return int(datetime.now(timezone.utc).timestamp())
        try:
            ts = timestamp.replace("Z", "+00:00")
            dt = datetime.fromisoformat(ts)
            return int(dt.timestamp())
        except ValueError:
            return int(datetime.now(timezone.utc).timestamp())

    async def close(self) -> None:
        """Clean up resources and flush remaining events."""
        self._closed = True
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        await self.flush()
        if self._client:
            await self._client.aclose()
            self._client = None

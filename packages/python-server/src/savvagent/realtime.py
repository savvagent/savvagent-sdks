"""
Savvagent Python Server SDK - Realtime Service

Per SDK Developer Guide: GET /api/flags/stream with Authorization header.
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import time
from typing import Any, Callable

import httpx
from httpx_sse import connect_sse, aconnect_sse

from .types import FlagUpdateEvent


class RealtimeService:
    """
    Synchronous service for real-time flag updates via Server-Sent Events.

    Per SDK Developer Guide: GET /api/flags/stream with Authorization header.
    Implements exponential backoff reconnection (1s → 30s, max 10 attempts).
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        on_connection_change: Callable[[bool], None] | None = None,
    ) -> None:
        """
        Initialize the realtime service.

        Args:
            base_url: Base URL for the Savvagent API.
            api_key: API key for authentication.
            on_connection_change: Callback when connection state changes.
        """
        self._base_url = base_url
        self._api_key = api_key
        self._on_connection_change = on_connection_change or (lambda _: None)
        self._subscribers: dict[str, set[Callable[[FlagUpdateEvent], None]]] = {}
        self._reconnect_attempts = 0
        self._max_reconnect_attempts = 10
        self._reconnect_delay = 1.0  # seconds
        self._max_reconnect_delay = 30.0  # seconds
        self._connected = False
        self._closed = False
        self._thread: threading.Thread | None = None

    def connect(self) -> None:
        """
        Connect to the SSE stream.

        Per SDK Developer Guide: Use Authorization header, never pass API key in URL.
        """
        self._closed = False
        self._thread = threading.Thread(target=self._run_connection, daemon=True)
        self._thread.start()

    def _run_connection(self) -> None:
        """Run the SSE connection in a background thread."""
        url = f"{self._base_url}/api/flags/stream"

        while not self._closed and self._reconnect_attempts < self._max_reconnect_attempts:
            try:
                with httpx.Client(timeout=None) as client:
                    with connect_sse(
                        client,
                        "GET",
                        url,
                        headers={"Authorization": f"Bearer {self._api_key}"},
                    ) as event_source:
                        self._connected = True
                        self._reconnect_attempts = 0
                        self._reconnect_delay = 1.0
                        self._on_connection_change(True)
                        print("[Savvagent] Real-time connection established", file=sys.stderr)

                        for event in event_source.iter_sse():
                            if self._closed:
                                break

                            # Handle different event types
                            if event.event == "heartbeat":
                                continue
                            elif event.event == "connected":
                                continue
                            elif event.event in ("flag.created", "flag.updated", "flag.deleted"):
                                self._handle_flag_event(event.event, event.data)
                            elif event.data:
                                # Fallback for generic messages
                                try:
                                    data = json.loads(event.data)
                                    if "type" in data and "key" in data:
                                        update_event = FlagUpdateEvent(
                                            type=data["type"],
                                            flag_key=data["key"],
                                            data=data,
                                        )
                                        self._notify_subscribers(update_event)
                                except json.JSONDecodeError:
                                    pass

            except Exception as e:
                if not self._closed:
                    print(f"[Savvagent] SSE connection error: {e}", file=sys.stderr)
                    self._handle_disconnect()

    def _handle_flag_event(
        self, event_type: str, data: str
    ) -> None:
        """Handle flag events from the SSE stream."""
        try:
            parsed = json.loads(data)
            update_event = FlagUpdateEvent(
                type=event_type,  # type: ignore
                flag_key=parsed.get("key", ""),
                data=parsed,
            )
            self._notify_subscribers(update_event)
        except json.JSONDecodeError as e:
            print(f"[Savvagent] Error parsing SSE event: {e}", file=sys.stderr)

    def _handle_disconnect(self) -> None:
        """Handle disconnection with exponential backoff reconnection."""
        self._connected = False
        self._on_connection_change(False)

        if self._closed:
            return

        # Attempt reconnect with exponential backoff
        self._reconnect_attempts += 1
        exponential_delay = self._reconnect_delay * (2 ** (self._reconnect_attempts - 1))
        delay = min(exponential_delay, self._max_reconnect_delay)

        print(
            f"[Savvagent] Reconnecting in {delay}s "
            f"(attempt {self._reconnect_attempts}/{self._max_reconnect_attempts})",
            file=sys.stderr,
        )
        time.sleep(delay)

    def subscribe(
        self,
        flag_key: str,
        callback: Callable[[FlagUpdateEvent], None],
    ) -> Callable[[], None]:
        """
        Subscribe to flag updates.

        Args:
            flag_key: The flag key to subscribe to, or "*" for all flags.
            callback: Function to call when the flag is updated.

        Returns:
            An unsubscribe function.
        """
        if flag_key not in self._subscribers:
            self._subscribers[flag_key] = set()

        self._subscribers[flag_key].add(callback)

        def unsubscribe() -> None:
            if flag_key in self._subscribers:
                self._subscribers[flag_key].discard(callback)
                if not self._subscribers[flag_key]:
                    del self._subscribers[flag_key]

        return unsubscribe

    def _notify_subscribers(self, event: FlagUpdateEvent) -> None:
        """Notify all subscribers of an event."""
        # Notify wildcard subscribers first
        wildcard_callbacks = self._subscribers.get("*", set())
        for callback in wildcard_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[Savvagent] Subscriber callback error: {e}", file=sys.stderr)

        # Notify specific flag subscribers
        specific_callbacks = self._subscribers.get(event.flag_key, set())
        for callback in specific_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[Savvagent] Subscriber callback error: {e}", file=sys.stderr)

    @property
    def is_connected(self) -> bool:
        """Check if the SSE connection is active."""
        return self._connected

    def disconnect(self) -> None:
        """Disconnect from the SSE stream."""
        self._closed = True
        self._reconnect_attempts = self._max_reconnect_attempts  # Prevent reconnection

    def close(self) -> None:
        """Clean up resources."""
        self.disconnect()
        self._subscribers.clear()


class AsyncRealtimeService:
    """
    Asynchronous service for real-time flag updates via Server-Sent Events.

    Per SDK Developer Guide: GET /api/flags/stream with Authorization header.
    Implements exponential backoff reconnection (1s → 30s, max 10 attempts).
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        on_connection_change: Callable[[bool], None] | None = None,
    ) -> None:
        """
        Initialize the realtime service.

        Args:
            base_url: Base URL for the Savvagent API.
            api_key: API key for authentication.
            on_connection_change: Callback when connection state changes.
        """
        self._base_url = base_url
        self._api_key = api_key
        self._on_connection_change = on_connection_change or (lambda _: None)
        self._subscribers: dict[str, set[Callable[[FlagUpdateEvent], None]]] = {}
        self._reconnect_attempts = 0
        self._max_reconnect_attempts = 10
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 30.0
        self._connected = False
        self._closed = False
        self._connection_task: asyncio.Task[Any] | None = None

    async def connect(self) -> None:
        """
        Connect to the SSE stream.

        Per SDK Developer Guide: Use Authorization header, never pass API key in URL.
        """
        self._closed = False
        self._connection_task = asyncio.create_task(self._run_connection())

    async def _run_connection(self) -> None:
        """Run the SSE connection."""
        url = f"{self._base_url}/api/flags/stream"

        while not self._closed and self._reconnect_attempts < self._max_reconnect_attempts:
            try:
                async with httpx.AsyncClient(timeout=None) as client:
                    async with aconnect_sse(
                        client,
                        "GET",
                        url,
                        headers={"Authorization": f"Bearer {self._api_key}"},
                    ) as event_source:
                        self._connected = True
                        self._reconnect_attempts = 0
                        self._reconnect_delay = 1.0
                        self._on_connection_change(True)
                        print("[Savvagent] Real-time connection established", file=sys.stderr)

                        async for event in event_source.aiter_sse():
                            if self._closed:
                                break

                            if event.event == "heartbeat":
                                continue
                            elif event.event == "connected":
                                continue
                            elif event.event in ("flag.created", "flag.updated", "flag.deleted"):
                                await self._handle_flag_event(event.event, event.data)
                            elif event.data:
                                try:
                                    data = json.loads(event.data)
                                    if "type" in data and "key" in data:
                                        update_event = FlagUpdateEvent(
                                            type=data["type"],
                                            flag_key=data["key"],
                                            data=data,
                                        )
                                        await self._notify_subscribers(update_event)
                                except json.JSONDecodeError:
                                    pass

            except asyncio.CancelledError:
                break
            except Exception as e:
                if not self._closed:
                    print(f"[Savvagent] SSE connection error: {e}", file=sys.stderr)
                    await self._handle_disconnect()

    async def _handle_flag_event(
        self, event_type: str, data: str
    ) -> None:
        """Handle flag events from the SSE stream."""
        try:
            parsed = json.loads(data)
            update_event = FlagUpdateEvent(
                type=event_type,  # type: ignore
                flag_key=parsed.get("key", ""),
                data=parsed,
            )
            await self._notify_subscribers(update_event)
        except json.JSONDecodeError as e:
            print(f"[Savvagent] Error parsing SSE event: {e}", file=sys.stderr)

    async def _handle_disconnect(self) -> None:
        """Handle disconnection with exponential backoff reconnection."""
        self._connected = False
        self._on_connection_change(False)

        if self._closed:
            return

        self._reconnect_attempts += 1
        exponential_delay = self._reconnect_delay * (2 ** (self._reconnect_attempts - 1))
        delay = min(exponential_delay, self._max_reconnect_delay)

        print(
            f"[Savvagent] Reconnecting in {delay}s "
            f"(attempt {self._reconnect_attempts}/{self._max_reconnect_attempts})",
            file=sys.stderr,
        )
        await asyncio.sleep(delay)

    def subscribe(
        self,
        flag_key: str,
        callback: Callable[[FlagUpdateEvent], None],
    ) -> Callable[[], None]:
        """
        Subscribe to flag updates.

        Args:
            flag_key: The flag key to subscribe to, or "*" for all flags.
            callback: Function to call when the flag is updated.

        Returns:
            An unsubscribe function.
        """
        if flag_key not in self._subscribers:
            self._subscribers[flag_key] = set()

        self._subscribers[flag_key].add(callback)

        def unsubscribe() -> None:
            if flag_key in self._subscribers:
                self._subscribers[flag_key].discard(callback)
                if not self._subscribers[flag_key]:
                    del self._subscribers[flag_key]

        return unsubscribe

    async def _notify_subscribers(self, event: FlagUpdateEvent) -> None:
        """Notify all subscribers of an event."""
        # Notify wildcard subscribers first
        wildcard_callbacks = self._subscribers.get("*", set())
        for callback in wildcard_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[Savvagent] Subscriber callback error: {e}", file=sys.stderr)

        # Notify specific flag subscribers
        specific_callbacks = self._subscribers.get(event.flag_key, set())
        for callback in specific_callbacks:
            try:
                callback(event)
            except Exception as e:
                print(f"[Savvagent] Subscriber callback error: {e}", file=sys.stderr)

    @property
    def is_connected(self) -> bool:
        """Check if the SSE connection is active."""
        return self._connected

    async def disconnect(self) -> None:
        """Disconnect from the SSE stream."""
        self._closed = True
        self._reconnect_attempts = self._max_reconnect_attempts
        if self._connection_task:
            self._connection_task.cancel()
            try:
                await self._connection_task
            except asyncio.CancelledError:
                pass
            self._connection_task = None

    async def close(self) -> None:
        """Clean up resources."""
        await self.disconnect()
        self._subscribers.clear()

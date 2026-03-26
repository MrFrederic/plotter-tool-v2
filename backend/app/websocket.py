import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

_HEARTBEAT_INTERVAL: float = 30.0


class ConnectionManager:
    """Manages WebSocket connections grouped by session_id."""

    def __init__(self) -> None:
        self.active_connections: dict[str, list[WebSocket]] = {}
        self._heartbeat_task: asyncio.Task[None] | None = None

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.setdefault(session_id, []).append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        connections = self.active_connections.get(session_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.active_connections.pop(session_id, None)

    async def send_personal(self, websocket: WebSocket, data: dict[str, Any]) -> None:
        await websocket.send_json(data)

    async def broadcast_to_session(
        self, session_id: str, data: dict[str, Any]
    ) -> None:
        broken: list[WebSocket] = []
        for connection in self.active_connections.get(session_id, []):
            try:
                await connection.send_json(data)
            except Exception:
                broken.append(connection)
        # Clean up broken connections
        for conn in broken:
            self.disconnect(session_id, conn)

    # ── heartbeat ─────────────────────────────────────────────────────────

    def start_heartbeat(self) -> None:
        """Start the periodic heartbeat loop (call during app startup)."""
        if self._heartbeat_task is None:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    def stop_heartbeat(self) -> None:
        """Cancel the heartbeat loop (call during app shutdown)."""
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            self._heartbeat_task = None

    async def _heartbeat_loop(self) -> None:
        """Send periodic pings to all connected clients."""
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL)
                for session_id in list(self.active_connections):
                    await self.broadcast_to_session(
                        session_id, {"type": "ping"}
                    )
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.warning("Heartbeat loop error", exc_info=True)

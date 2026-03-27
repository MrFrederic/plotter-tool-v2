import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

_HEARTBEAT_INTERVAL: float = 30.0


async def update_client_session(client_id: str) -> None:
    """Create or update a client session's last_seen timestamp."""
    from app.database import async_session
    from app.models import ClientSession, utcnow

    async with async_session() as session:
        existing = await session.get(ClientSession, client_id)
        if existing:
            existing.last_seen = utcnow()
        else:
            session.add(ClientSession(client_id=client_id))
        await session.commit()


async def cleanup_expired_sessions() -> None:
    """Remove cached files and sessions for clients inactive > 1 hour."""
    from datetime import timedelta
    from pathlib import Path

    from sqlalchemy import delete, select

    from app import session_state
    from app.database import async_session
    from app.models import CachedFile, ClientSession, utcnow

    cutoff = utcnow() - timedelta(hours=1)

    async with async_session() as session:
        result = await session.execute(
            select(ClientSession).where(ClientSession.last_seen < cutoff)
        )
        expired = list(result.scalars().all())

        if not expired:
            return

        for cs in expired:
            files_result = await session.execute(
                select(CachedFile).where(CachedFile.client_id == cs.client_id)
            )
            cached_files = list(files_result.scalars().all())

            for cf in cached_files:
                try:
                    path = Path(cf.file_path)
                    if path.exists():
                        await asyncio.to_thread(path.unlink)
                except Exception:
                    logger.debug("Failed to delete cached file: %s", cf.file_path, exc_info=True)

            await session.execute(
                delete(CachedFile).where(CachedFile.client_id == cs.client_id)
            )
            await session.delete(cs)

            session_state.clear_session(cs.client_id)

        await session.commit()
        logger.info("Cleaned up %d expired client session(s)", len(expired))


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

    async def on_connect(self, session_id: str) -> None:
        """Track session in the database on WebSocket connect."""
        await update_client_session(session_id)

    async def on_disconnect(self, session_id: str) -> None:
        """Update session timestamp on WebSocket disconnect."""
        await update_client_session(session_id)

    async def on_activity(self, session_id: str) -> None:
        """Update last_seen on any WebSocket activity."""
        await update_client_session(session_id)

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
        """Send periodic pings and clean up expired sessions."""
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL)
                for session_id in list(self.active_connections):
                    await self.broadcast_to_session(
                        session_id, {"type": "ping"}
                    )
                try:
                    await cleanup_expired_sessions()
                except Exception:
                    logger.warning("Session cleanup error", exc_info=True)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.warning("Heartbeat loop error", exc_info=True)

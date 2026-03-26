import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.routers import execution, pipelines, plugins, projects
from app.websocket import ConnectionManager

logger = logging.getLogger(__name__)

manager = ConnectionManager()


def _discover_plugins() -> dict[str, dict[str, Any]]:
    """Scan the plugins directory and return discovered plugin schemas.

    Plugin discovery is intentionally a no-op until concrete plugins exist.
    Each plugin package is expected to expose a ``PLUGIN_SCHEMA`` dict.
    """
    discovered: dict[str, dict[str, Any]] = {}
    try:
        import importlib
        import pkgutil

        import plugins as plugins_pkg

        for importer, modname, ispkg in pkgutil.iter_modules(plugins_pkg.__path__):
            try:
                mod = importlib.import_module(f"plugins.{modname}")
                schema: dict[str, Any] | None = getattr(mod, "PLUGIN_SCHEMA", None)
                if schema is not None:
                    discovered[modname] = schema
            except Exception:
                logger.warning("Failed to load plugin '%s'", modname, exc_info=True)
    except Exception:
        logger.warning("Plugin discovery failed", exc_info=True)
    return discovered


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Initializing database …")
    await init_db()

    discovered = _discover_plugins()
    plugins.register_plugins(discovered)
    logger.info("Discovered %d plugin(s)", len(discovered))

    yield
    # Shutdown (cleanup can go here)


app = FastAPI(title="Plotter Tool", version="0.1.0", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(plugins.router)
app.include_router(projects.router)
app.include_router(pipelines.router)
app.include_router(execution.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    await manager.connect(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            # Echo back with session context for node-status updates.
            await manager.broadcast_to_session(
                session_id, {"session_id": session_id, **data}
            )
    except WebSocketDisconnect:
        manager.disconnect(session_id, websocket)

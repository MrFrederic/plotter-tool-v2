import importlib
import inspect
import logging
import pkgutil
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.plugin_base import BasePlugin
from app.routers import execution, pipelines, plugins, preview, projects, users
from app.websocket import ConnectionManager

logger = logging.getLogger(__name__)

manager = ConnectionManager()


def _discover_plugins() -> tuple[dict[str, dict[str, Any]], dict[str, type[BasePlugin]]]:
    """Scan the plugins directory for BasePlugin subclasses.

    Returns a tuple of ``(legacy_schemas, plugin_classes)`` where
    *legacy_schemas* maps name → raw dict (from ``PLUGIN_SCHEMA``) and
    *plugin_classes* maps schema-name → BasePlugin subclass.
    """
    legacy: dict[str, dict[str, Any]] = {}
    classes: dict[str, type[BasePlugin]] = {}

    try:
        import plugins as plugins_pkg

        for _importer, modname, _ispkg in pkgutil.iter_modules(plugins_pkg.__path__):
            try:
                mod = importlib.import_module(f"plugins.{modname}")

                # New-style: look for a module-level ``Plugin`` attribute
                plugin_attr = getattr(mod, "Plugin", None)
                if plugin_attr is not None and _is_plugin_class(plugin_attr):
                    schema_name = plugin_attr.schema().name
                    classes[schema_name] = plugin_attr
                    logger.info("Loaded plugin class '%s' from plugins.%s", schema_name, modname)
                    continue

                # Also scan module for any BasePlugin subclass
                for _name, obj in inspect.getmembers(mod, inspect.isclass):
                    if _is_plugin_class(obj) and obj is not BasePlugin:
                        schema_name = obj.schema().name
                        if schema_name not in classes:
                            classes[schema_name] = obj
                            logger.info(
                                "Loaded plugin class '%s' from plugins.%s",
                                schema_name,
                                modname,
                            )

                # Legacy fallback
                raw_schema: dict[str, Any] | None = getattr(mod, "PLUGIN_SCHEMA", None)
                if raw_schema is not None:
                    legacy[modname] = raw_schema
            except Exception:
                logger.warning("Failed to load plugin '%s'", modname, exc_info=True)
    except Exception:
        logger.warning("Plugin discovery failed", exc_info=True)

    return legacy, classes


def _is_plugin_class(obj: Any) -> bool:
    """Return True if *obj* is a concrete BasePlugin subclass."""
    return (
        inspect.isclass(obj)
        and issubclass(obj, BasePlugin)
        and obj is not BasePlugin
        and not inspect.isabstract(obj)
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Startup
    logger.info("Initializing database …")
    await init_db()

    legacy, classes = _discover_plugins()
    plugins.register_plugins(legacy, classes)
    logger.info("Discovered %d plugin(s)", len(legacy) + len(classes))

    manager.start_heartbeat()

    yield
    # Shutdown
    manager.stop_heartbeat()


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
app.include_router(preview.router)
app.include_router(users.router)


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
    except Exception:
        logger.warning("WebSocket error for session %s", session_id, exc_info=True)
        manager.disconnect(session_id, websocket)
        try:
            await websocket.close()
        except Exception:
            pass

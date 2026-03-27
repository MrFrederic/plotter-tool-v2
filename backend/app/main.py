import asyncio
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
from app.routers import execution, plugins, preview, upload
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
app.include_router(execution.router)
app.include_router(preview.router)
app.include_router(upload.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    from app import session_state
    from app.websocket import update_client_session

    await manager.connect(session_id, websocket)
    await update_client_session(session_id)
    try:
        while True:
            data = await websocket.receive_json()
            await update_client_session(session_id)

            if data.get("type") == "pipeline_sync":
                # Store pipeline state
                session_state.store_pipeline(session_id, data)

                # Check if start node has file_path — if so, auto-execute
                nodes = data.get("nodes", [])
                has_file = any(
                    n.get("params", {}).get("file_path")
                    for n in nodes
                    if n.get("plugin_name") == "Pipeline Input"
                )

                if has_file and not session_state.is_running(session_id):
                    task = asyncio.create_task(_auto_execute(session_id))
                    task.add_done_callback(lambda t: t.exception() if not t.cancelled() and t.exception() else None)
                elif has_file and session_state.is_running(session_id):
                    session_state.request_rerun(session_id)

            # Echo back for real-time collaboration
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


async def _auto_execute(session_id: str) -> None:
    """Run the pipeline for a session using stored state."""
    import time

    from app import session_state
    from app.cache import get_shared_cache
    from app.dag_engine import DAGEngine, ExecutionNode
    from app.routers.execution import _engines, _execution_status
    from app.routers.plugins import get_plugin_classes

    pipeline = session_state.get_pipeline(session_id)
    if not pipeline:
        return

    session_state.set_running(session_id, True)
    try:
        nodes_data = pipeline.get("nodes", [])
        edges_data = pipeline.get("edges", [])

        # Build edges lookup
        edges_by_target: dict[str, list[dict]] = {}
        for edge in edges_data:
            edges_by_target.setdefault(edge["target_node_id"], []).append(edge)

        exec_nodes: list[ExecutionNode] = []
        for n in nodes_data:
            input_conns: dict[str, tuple[str, str]] = {}
            for edge in edges_by_target.get(n["id"], []):
                input_conns[edge["target_input"]] = (
                    edge["source_node_id"],
                    edge["source_output"],
                )
            exec_nodes.append(
                ExecutionNode(
                    node_id=n["id"],
                    plugin_name=n["plugin_name"],
                    params=n.get("params") or {},
                    inputs=input_conns,
                )
            )

        if not exec_nodes:
            return

        plugin_classes = get_plugin_classes()
        raw_edges = [
            (e["source_node_id"], e["source_output"], e["target_node_id"], e["target_input"])
            for e in edges_data
        ]
        engine = DAGEngine(exec_nodes, plugin_classes, edges=raw_edges)

        errors = engine.validate()
        if errors:
            logger.warning(
                "Auto-execution validation errors for session %s: %s",
                session_id,
                errors,
            )
            return

        run_id = engine.run_id
        _engines[run_id] = engine
        _execution_status[run_id] = {
            "session_id": session_id,
            "run_id": run_id,
            "status": "running",
            "nodes": {n.node_id: n.status.value for n in exec_nodes},
            "_created_at": time.monotonic(),
        }

        cache = get_shared_cache()
        await engine.execute(session_id, manager, cache)

        _execution_status[run_id]["status"] = "completed"
        for nid, node in engine.nodes.items():
            _execution_status[run_id]["nodes"][nid] = node.status.value

        await manager.broadcast_to_session(
            session_id,
            {
                "type": "execution_complete",
                "run_id": run_id,
                "status": "completed",
            },
        )
    except Exception:
        logger.exception("Auto-execution failed for session %s", session_id)
        try:
            await manager.broadcast_to_session(
                session_id,
                {
                    "type": "execution_complete",
                    "run_id": "auto",
                    "status": "error",
                },
            )
        except Exception:
            pass
    finally:
        session_state.set_running(session_id, False)
        if session_state.consume_rerun(session_id):
            task = asyncio.create_task(_auto_execute(session_id))
            task.add_done_callback(lambda t: t.exception() if not t.cancelled() and t.exception() else None)

import asyncio
import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException

from app.cache import get_shared_cache
from app.dag_engine import DAGEngine, ExecutionNode
from app.routers.plugins import get_plugin_classes
from app.schemas import ExecutionRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/execute", tags=["execution"])

# In-memory execution status tracker keyed by run_id.
_execution_status: dict[str, dict[str, Any]] = {}
_engines: dict[str, DAGEngine] = {}

# Keep references to background tasks so they aren't garbage-collected.
_background_tasks: set[asyncio.Task] = set()  # type: ignore[type-arg]

_STATUS_TTL_SECONDS: float = 30 * 60  # 30 minutes


def _cleanup_stale_entries() -> None:
    """Remove execution status / engine entries older than the TTL."""
    cutoff = time.monotonic() - _STATUS_TTL_SECONDS
    stale = [
        rid for rid, status in _execution_status.items()
        if status.get("_created_at", 0) < cutoff
    ]
    for rid in stale:
        _execution_status.pop(rid, None)
        _engines.pop(rid, None)


def _get_ws_manager() -> Any:
    """Lazily import the WebSocket manager from main to avoid circular imports."""
    from app.main import manager
    return manager


@router.post("")
async def execute_pipeline(
    body: ExecutionRequest,
) -> dict[str, Any]:
    """Trigger execution of a pipeline from client-supplied nodes/edges.

    The execution runs as a background task; the endpoint returns a run_id
    immediately.
    """
    nodes = body.nodes or []
    edges = body.edges or []

    # Build ExecutionNodes
    edges_by_target: dict[str, list] = {}
    for edge in edges:
        edges_by_target.setdefault(edge.target_node_id, []).append(edge)

    exec_nodes: list[ExecutionNode] = []
    for n in nodes:
        input_conns: dict[str, tuple[str, str]] = {}
        for edge in edges_by_target.get(n.id, []):
            input_conns[edge.target_input] = (
                edge.source_node_id,
                edge.source_output,
            )
        exec_nodes.append(
            ExecutionNode(
                node_id=n.id,
                plugin_name=n.plugin_name,
                params=n.params or {},
                inputs=input_conns,
            )
        )

    plugin_classes = get_plugin_classes()
    raw_edges = [
        (e.source_node_id, e.source_output, e.target_node_id, e.target_input)
        for e in edges
    ]
    engine = DAGEngine(exec_nodes, plugin_classes, edges=raw_edges)

    # Validate before running
    errors = engine.validate()
    if errors:
        raise HTTPException(status_code=400, detail={"validation_errors": errors})

    run_id = engine.run_id
    _cleanup_stale_entries()
    _engines[run_id] = engine
    _execution_status[run_id] = {
        "run_id": run_id,
        "status": "running",
        "nodes": {n.node_id: n.status.value for n in exec_nodes},
        "_created_at": time.monotonic(),
    }

    session_id = body.session_id

    async def _run() -> None:
        try:
            ws_manager = _get_ws_manager()
            await engine.execute(session_id, ws_manager, get_shared_cache())
            _execution_status[run_id]["status"] = "completed"
            await ws_manager.broadcast_to_session(
                session_id,
                {
                    "type": "execution_complete",
                    "run_id": run_id,
                    "status": "completed",
                },
            )
        except Exception:
            logger.exception("Pipeline execution failed (run %s)", run_id)
            _execution_status[run_id]["status"] = "error"
            try:
                ws_manager = _get_ws_manager()
                await ws_manager.broadcast_to_session(
                    session_id,
                    {
                        "type": "execution_complete",
                        "run_id": run_id,
                        "status": "error",
                    },
                )
            except Exception:
                logger.debug("Failed to broadcast execution error")
        finally:
            for nid, node in engine.nodes.items():
                _execution_status[run_id]["nodes"][nid] = node.status.value

    task = asyncio.create_task(_run())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return {"run_id": run_id, "status": "running"}


@router.get("/{run_id}/status")
async def get_execution_status(run_id: str) -> dict[str, Any]:
    """Return the current execution status for a run."""
    if run_id in _execution_status:
        return _execution_status[run_id]

    raise HTTPException(
        status_code=404, detail="No execution found for this run_id"
    )

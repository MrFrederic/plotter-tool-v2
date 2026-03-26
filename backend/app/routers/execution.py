import asyncio
import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cache import FileSystemCache
from app.config import settings
from app.dag_engine import DAGEngine, ExecutionNode
from app.database import get_db
from app.models import Edge, NodeInstance, Pipeline
from app.routers.plugins import get_plugin_classes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/execute", tags=["execution"])

# In-memory execution status tracker keyed by run_id.
_execution_status: dict[str, dict[str, Any]] = {}
_engines: dict[str, DAGEngine] = {}

_cache: FileSystemCache | None = None


def _get_cache() -> FileSystemCache:
    """Lazily create the cache so we don't hit the filesystem at import time."""
    global _cache
    if _cache is None:
        _cache = FileSystemCache(settings.CACHE_DIR)
    return _cache


def _get_ws_manager() -> Any:
    """Lazily import the WebSocket manager from main to avoid circular imports."""
    from app.main import manager
    return manager


@router.post("/{pipeline_id}")
async def execute_pipeline(
    pipeline_id: UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Trigger execution of a pipeline.

    The execution runs as a background task; the endpoint returns a run_id
    immediately.
    """
    stmt = (
        select(Pipeline)
        .options(selectinload(Pipeline.nodes), selectinload(Pipeline.edges))
        .where(Pipeline.id == pipeline_id)
    )
    result = await db.execute(stmt)
    pipeline = result.scalar_one_or_none()
    if pipeline is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Build a mapping from DB node id → node id string for edge resolution
    node_id_map: dict[UUID, str] = {n.id: str(n.id) for n in pipeline.nodes}

    # Index edges by target node
    edges_by_target: dict[str, list[Edge]] = {}
    for edge in pipeline.edges:
        target = str(edge.target_node_id)
        edges_by_target.setdefault(target, []).append(edge)

    # Build ExecutionNodes
    exec_nodes: list[ExecutionNode] = []
    for n in pipeline.nodes:
        nid = str(n.id)
        input_conns: dict[str, tuple[str, str]] = {}
        for edge in edges_by_target.get(nid, []):
            input_conns[edge.target_input] = (
                str(edge.source_node_id),
                edge.source_output,
            )
        exec_nodes.append(
            ExecutionNode(
                node_id=nid,
                plugin_name=n.plugin_name,
                params=n.params or {},
                inputs=input_conns,
            )
        )

    plugin_classes = get_plugin_classes()
    engine = DAGEngine(exec_nodes, plugin_classes)

    # Validate before running
    errors = engine.validate()
    if errors:
        raise HTTPException(status_code=400, detail={"validation_errors": errors})

    run_id = engine.run_id
    _engines[run_id] = engine
    _execution_status[run_id] = {
        "pipeline_id": str(pipeline_id),
        "run_id": run_id,
        "status": "running",
        "nodes": {n.node_id: n.status.value for n in exec_nodes},
    }

    session_id = str(pipeline_id)

    async def _run() -> None:
        try:
            ws_manager = _get_ws_manager()
            await engine.execute(session_id, ws_manager, _get_cache())
            _execution_status[run_id]["status"] = "completed"
        except Exception:
            logger.exception("Pipeline execution failed (run %s)", run_id)
            _execution_status[run_id]["status"] = "error"
        finally:
            # Update per-node statuses
            for nid, node in engine.nodes.items():
                _execution_status[run_id]["nodes"][nid] = node.status.value

    asyncio.create_task(_run())

    return {"pipeline_id": str(pipeline_id), "run_id": run_id, "status": "running"}


@router.get("/{pipeline_id}/status")
async def get_execution_status(pipeline_id: UUID) -> dict[str, Any]:
    """Return the current execution status for a pipeline run."""
    run_id = str(pipeline_id)

    # Try by run_id first, then fall back to pipeline_id match
    if run_id in _execution_status:
        return _execution_status[run_id]

    # Search by pipeline_id
    for rid, status in _execution_status.items():
        if status.get("pipeline_id") == run_id:
            return status

    raise HTTPException(
        status_code=404, detail="No execution found for this pipeline"
    )

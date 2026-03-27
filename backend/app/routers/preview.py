"""Preview router – serves cached intermediate results for nodes."""
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.cache import get_shared_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/preview", tags=["preview"])


@router.get("/{session_id}/{node_id}")
async def get_node_result(session_id: str, node_id: str) -> dict[str, Any]:
    """Return the cached execution result for a specific node."""
    from app.routers.execution import _engines, _execution_status

    cache = get_shared_cache()
    result_hash: str | None = None

    # Search execution records for this session to find the node's result hash
    for _run_id, status in _execution_status.items():
        if status.get("session_id") == session_id:
            engine = _engines.get(_run_id)
            if engine is not None:
                exec_node = engine.nodes.get(node_id)
                if exec_node is not None and exec_node.result_hash:
                    result_hash = exec_node.result_hash
                    break

    if result_hash is None:
        raise HTTPException(
            status_code=404,
            detail=f"No cached result for node '{node_id}' in session '{session_id}'",
        )

    data = await cache.retrieve_json(result_hash)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Cache entry '{result_hash}' not found on disk",
        )

    return {"node_id": node_id, "hash": result_hash, "data": data}


@router.get("/cache/{hash_key}")
async def get_cached_file(hash_key: str, ext: str = ".bin") -> Response:
    """Return a raw cached binary file by its content hash."""
    cache = get_shared_cache()
    raw = await cache.retrieve(hash_key, extension=ext)
    if raw is None:
        raise HTTPException(status_code=404, detail="Cached file not found")

    content_type = "application/octet-stream"
    if ext in (".json",):
        content_type = "application/json"
    elif ext in (".png",):
        content_type = "image/png"
    elif ext in (".svg",):
        content_type = "image/svg+xml"

    return Response(content=raw, media_type=content_type)

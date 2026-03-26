from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Edge, NodeInstance, Pipeline

router = APIRouter(prefix="/execute", tags=["execution"])

# Simple in-memory execution status tracker.
_execution_status: dict[str, dict[str, Any]] = {}


@router.post("/{pipeline_id}")
async def execute_pipeline(
    pipeline_id: UUID, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """Trigger execution of a pipeline."""
    stmt = (
        select(Pipeline)
        .options(selectinload(Pipeline.nodes), selectinload(Pipeline.edges))
        .where(Pipeline.id == pipeline_id)
    )
    result = await db.execute(stmt)
    pipeline = result.scalar_one_or_none()
    if pipeline is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    run_id = str(pipeline_id)
    _execution_status[run_id] = {
        "pipeline_id": str(pipeline_id),
        "status": "running",
        "nodes": {str(n.id): "pending" for n in pipeline.nodes},
    }

    # TODO: replace with real async task execution (e.g. Celery / TaskIQ)
    _execution_status[run_id]["status"] = "completed"
    for node_id in _execution_status[run_id]["nodes"]:
        _execution_status[run_id]["nodes"][node_id] = "completed"

    return {"pipeline_id": str(pipeline_id), "status": "completed"}


@router.get("/{pipeline_id}/status")
async def get_execution_status(pipeline_id: UUID) -> dict[str, Any]:
    """Return the current execution status for a pipeline."""
    run_id = str(pipeline_id)
    if run_id not in _execution_status:
        raise HTTPException(
            status_code=404, detail="No execution found for this pipeline"
        )
    return _execution_status[run_id]

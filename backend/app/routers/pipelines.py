from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import Edge, NodeInstance, Pipeline
from app.schemas import PipelineCreate, PipelineRead, PipelineUpdate

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


async def _get_pipeline_or_404(
    pipeline_id: UUID, db: AsyncSession
) -> Pipeline:
    stmt = (
        select(Pipeline)
        .options(selectinload(Pipeline.nodes), selectinload(Pipeline.edges))
        .where(Pipeline.id == pipeline_id)
    )
    result = await db.execute(stmt)
    pipeline = result.scalar_one_or_none()
    if pipeline is None:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipeline


@router.post("/", response_model=PipelineRead, status_code=201)
async def create_pipeline(
    payload: PipelineCreate, db: AsyncSession = Depends(get_db)
) -> Pipeline:
    pipeline = Pipeline(
        project_id=payload.project_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(pipeline)
    await db.flush()

    node_map: dict[int, UUID] = {}
    for idx, node_data in enumerate(payload.nodes):
        node = NodeInstance(
            pipeline_id=pipeline.id,
            plugin_name=node_data.plugin_name,
            pos_x=node_data.pos_x,
            pos_y=node_data.pos_y,
            params=node_data.params,
        )
        db.add(node)
        await db.flush()
        node_map[idx] = node.id

    for edge_data in payload.edges:
        edge = Edge(
            pipeline_id=pipeline.id,
            source_node_id=edge_data.source_node_id,
            source_output=edge_data.source_output,
            target_node_id=edge_data.target_node_id,
            target_input=edge_data.target_input,
        )
        db.add(edge)

    await db.flush()
    return await _get_pipeline_or_404(pipeline.id, db)


@router.get("/{pipeline_id}", response_model=PipelineRead)
async def get_pipeline(
    pipeline_id: UUID, db: AsyncSession = Depends(get_db)
) -> Pipeline:
    return await _get_pipeline_or_404(pipeline_id, db)


@router.put("/{pipeline_id}", response_model=PipelineRead)
async def update_pipeline(
    pipeline_id: UUID,
    payload: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
) -> Pipeline:
    pipeline = await _get_pipeline_or_404(pipeline_id, db)

    if payload.name is not None:
        pipeline.name = payload.name
    if payload.description is not None:
        pipeline.description = payload.description

    # Full replace: delete existing nodes and edges, then recreate.
    for edge in list(pipeline.edges):
        await db.delete(edge)
    for node in list(pipeline.nodes):
        await db.delete(node)
    await db.flush()

    for node_data in payload.nodes:
        node = NodeInstance(
            pipeline_id=pipeline.id,
            plugin_name=node_data.plugin_name,
            pos_x=node_data.pos_x,
            pos_y=node_data.pos_y,
            params=node_data.params,
        )
        db.add(node)
        await db.flush()

    for edge_data in payload.edges:
        edge = Edge(
            pipeline_id=pipeline.id,
            source_node_id=edge_data.source_node_id,
            source_output=edge_data.source_output,
            target_node_id=edge_data.target_node_id,
            target_input=edge_data.target_input,
        )
        db.add(edge)

    await db.flush()
    return await _get_pipeline_or_404(pipeline.id, db)


@router.delete("/{pipeline_id}", status_code=204)
async def delete_pipeline(
    pipeline_id: UUID, db: AsyncSession = Depends(get_db)
) -> None:
    pipeline = await _get_pipeline_or_404(pipeline_id, db)
    await db.delete(pipeline)

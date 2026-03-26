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


async def _flush_nodes_and_create_edges(nodes, client_ids, payload_edges, pipeline_id, db):
    """Flush node instances, build client→server id map, create edges.

    *client_ids* maps list index → client-provided id string (or ``None``).
    """
    client_id_map: dict[str, UUID] = {}
    for idx, node in enumerate(nodes):
        db.add(node)
        await db.flush()
        cid = client_ids.get(idx)
        if cid is not None:
            client_id_map[cid] = node.id

    for edge_data in payload_edges:
        source_id = client_id_map.get(str(edge_data.source_node_id), edge_data.source_node_id)
        target_id = client_id_map.get(str(edge_data.target_node_id), edge_data.target_node_id)
        edge = Edge(
            pipeline_id=pipeline_id,
            source_node_id=source_id,
            source_output=edge_data.source_output,
            target_node_id=target_id,
            target_input=edge_data.target_input,
        )
        db.add(edge)

    await db.flush()


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

    nodes = []
    client_ids: dict[int, str | None] = {}
    for idx, node_data in enumerate(payload.nodes):
        node = NodeInstance(
            pipeline_id=pipeline.id,
            plugin_name=node_data.plugin_name,
            client_id=node_data.id,
            pos_x=node_data.pos_x,
            pos_y=node_data.pos_y,
            params=node_data.params,
        )
        client_ids[idx] = node_data.id
        nodes.append(node)

    await _flush_nodes_and_create_edges(nodes, client_ids, payload.edges, pipeline.id, db)
    return await _get_pipeline_or_404(pipeline.id, db)


@router.get("/", response_model=list[PipelineRead])
async def list_pipelines(
    project_id: UUID | None = None, db: AsyncSession = Depends(get_db)
) -> list[Pipeline]:
    stmt = select(Pipeline).options(
        selectinload(Pipeline.nodes), selectinload(Pipeline.edges)
    )
    if project_id is not None:
        stmt = stmt.where(Pipeline.project_id == project_id)
    stmt = stmt.order_by(Pipeline.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


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

    # Only replace nodes/edges if explicitly provided
    if payload.nodes is not None:
        for edge in list(pipeline.edges):
            await db.delete(edge)
        for node in list(pipeline.nodes):
            await db.delete(node)
        await db.flush()

        nodes = []
        client_ids: dict[int, str | None] = {}
        for idx, node_data in enumerate(payload.nodes):
            node = NodeInstance(
                pipeline_id=pipeline.id,
                plugin_name=node_data.plugin_name,
                client_id=node_data.id,
                pos_x=node_data.pos_x,
                pos_y=node_data.pos_y,
                params=node_data.params,
            )
            client_ids[idx] = node_data.id
            nodes.append(node)

        edges = payload.edges if payload.edges is not None else []
        await _flush_nodes_and_create_edges(nodes, client_ids, edges, pipeline.id, db)
    elif payload.edges is not None:
        for edge in list(pipeline.edges):
            await db.delete(edge)
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

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Project, User
from app.schemas import ProjectCreate, ProjectRead, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("/", response_model=ProjectRead, status_code=201)
async def create_project(
    payload: ProjectCreate, db: AsyncSession = Depends(get_db)
) -> Project:
    user = await db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    project = Project(
        user_id=payload.user_id,
        name=payload.name,
        description=payload.description,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.get("/", response_model=list[ProjectRead])
async def list_projects(
    user_id: UUID | None = None, db: AsyncSession = Depends(get_db)
) -> list[Project]:
    stmt = select(Project)
    if user_id is not None:
        stmt = stmt.where(Project.user_id == user_id)
    stmt = stmt.order_by(Project.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID, db: AsyncSession = Depends(get_db)
) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)

    await db.flush()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: UUID, db: AsyncSession = Depends(get_db)
) -> None:
    project = await db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.delete(project)

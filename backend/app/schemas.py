from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


# ── User ──────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    display_name: str | None = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    display_name: str | None = None
    created_at: datetime


# ── Project ───────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    user_id: UUID
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime


# ── Pipeline ──────────────────────────────────────────────────────────────────

class NodeInstanceCreate(BaseModel):
    id: str | None = None  # Optional client-provided identifier
    plugin_name: str
    pos_x: float = 0.0
    pos_y: float = 0.0
    params: dict[str, Any] | None = None


class NodeInstanceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pipeline_id: UUID
    plugin_name: str
    pos_x: float
    pos_y: float
    params: dict[str, Any] | None = None
    client_id: str | None = None
    created_at: datetime


class EdgeCreate(BaseModel):
    source_node_id: str
    source_output: str
    target_node_id: str
    target_input: str


class EdgeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pipeline_id: UUID
    source_node_id: UUID
    source_output: str
    target_node_id: UUID
    target_input: str


class PipelineCreate(BaseModel):
    project_id: UUID
    name: str
    description: str | None = None
    nodes: list[NodeInstanceCreate] = []
    edges: list[EdgeCreate] = []


class PipelineUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    nodes: list[NodeInstanceCreate] | None = None
    edges: list[EdgeCreate] | None = None


class PipelineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime
    nodes: list[NodeInstanceRead] = []
    edges: list[EdgeRead] = []


# ── Execution ─────────────────────────────────────────────────────────────────

class ExecutionRequest(BaseModel):
    session_id: str | None = None

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CachedFileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    client_id: str
    node_id: str
    output_name: str
    cache_hash: str
    file_path: str
    data_type: str
    is_upload: bool
    created_at: datetime


class ClientSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    client_id: str
    last_seen: datetime
    created_at: datetime


class NodeData(BaseModel):
    id: str
    plugin_name: str
    pos_x: float = 0.0
    pos_y: float = 0.0
    params: dict[str, Any] | None = None


class EdgeData(BaseModel):
    source_node_id: str
    source_output: str
    target_node_id: str
    target_input: str


class ExecutionRequest(BaseModel):
    session_id: str
    nodes: list[NodeData] | None = None
    edges: list[EdgeData] | None = None

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    projects: Mapped[list["Project"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="projects")
    pipelines: Mapped[list["Pipeline"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Pipeline(Base):
    __tablename__ = "pipelines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    project: Mapped["Project"] = relationship(back_populates="pipelines")
    nodes: Mapped[list["NodeInstance"]] = relationship(
        back_populates="pipeline", cascade="all, delete-orphan"
    )
    edges: Mapped[list["Edge"]] = relationship(
        back_populates="pipeline", cascade="all, delete-orphan"
    )


class NodeInstance(Base):
    __tablename__ = "node_instances"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pipelines.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    plugin_name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pos_x: Mapped[float] = mapped_column(Float, default=0.0)
    pos_y: Mapped[float] = mapped_column(Float, default=0.0)
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    pipeline: Mapped["Pipeline"] = relationship(back_populates="nodes")
    source_edges: Mapped[list["Edge"]] = relationship(
        back_populates="source_node",
        foreign_keys="[Edge.source_node_id]",
        cascade="all, delete-orphan",
    )
    target_edges: Mapped[list["Edge"]] = relationship(
        back_populates="target_node",
        foreign_keys="[Edge.target_node_id]",
        cascade="all, delete-orphan",
    )


class Edge(Base):
    __tablename__ = "edges"
    __table_args__ = (
        UniqueConstraint(
            "source_node_id", "source_output", "target_node_id", "target_input",
            name="uq_edge_connection",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("pipelines.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("node_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_output: Mapped[str] = mapped_column(String(255), nullable=False)
    target_node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("node_instances.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_input: Mapped[str] = mapped_column(String(255), nullable=False)

    pipeline: Mapped["Pipeline"] = relationship(back_populates="edges")
    source_node: Mapped["NodeInstance"] = relationship(
        back_populates="source_edges", foreign_keys=[source_node_id]
    )
    target_node: Mapped["NodeInstance"] = relationship(
        back_populates="target_edges", foreign_keys=[target_node_id]
    )

"""Base plugin interface for the processing pipeline."""
from __future__ import annotations

import abc
import hashlib
import json
from enum import Enum
from typing import Any

from pydantic import BaseModel


class PortType(str, Enum):
    IMAGE = "image"      # Raster image as pixel data
    VECTOR = "vector"    # Vector image, a list of SVG objects such as paths, text, shapes
    GCODE = "gcode"      # A set of G-code instructions
    PATH = "path"        # List of paths; each path has segments (line or arc) with per-segment metadata
    TEXT = "text"         # Arbitrary text
    OTHER = "other"      # Some other arbitrary data


class PortDefinition(BaseModel):
    name: str
    type: PortType
    description: str = ""


class ParameterVisibilityCondition(BaseModel):
    parameter: str | None = None
    equals: Any | None = None
    not_equals: Any | None = None
    one_of: list[Any] | None = None
    none_of: list[Any] | None = None
    all: list[ParameterVisibilityCondition] | None = None
    any: list[ParameterVisibilityCondition] | None = None


ParameterVisibilityCondition.model_rebuild()


class ParameterDefinition(BaseModel):
    name: str
    type: str  # "number", "string", "boolean", "select", "color"
    default: Any
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[str] | None = None
    description: str = ""
    visible_if: ParameterVisibilityCondition | None = None


class PluginSchema(BaseModel):
    name: str
    category: str
    description: str
    inputs: list[PortDefinition]
    outputs: list[PortDefinition]
    parameters: list[ParameterDefinition]


class BasePlugin(abc.ABC):
    """Every processing plugin must inherit from this class."""

    @classmethod
    @abc.abstractmethod
    def schema(cls) -> PluginSchema:
        """Return the plugin's schema describing inputs, outputs, and parameters."""
        ...

    @abc.abstractmethod
    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        """Execute the plugin's processing logic.

        Args:
            inputs: Dict mapping input port names to their data values.
            params: Dict of parameter values from user configuration.

        Returns:
            Dict mapping output port names to their result data.
        """
        ...

    @classmethod
    def compute_hash(cls, inputs_hash: dict[str, str], params: dict[str, Any]) -> str:
        """Compute a deterministic cache hash for this execution.

        Uses the plugin name + input data hashes + parameter values.
        """
        hasher = hashlib.sha256()
        hasher.update(cls.schema().name.encode())
        # Sort for determinism
        for key in sorted(inputs_hash.keys()):
            hasher.update(f"{key}:{inputs_hash[key]}".encode())
        hasher.update(json.dumps(params, sort_keys=True, default=str).encode())
        return hasher.hexdigest()

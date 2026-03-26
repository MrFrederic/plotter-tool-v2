"""PathInput plugin – loads path data from a JSON file."""
import json
from pathlib import Path
from typing import Any

from app.config import settings
from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)

ALLOWED_BASE = Path(settings.CACHE_DIR).resolve()


class PathInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="PathInput",
            category="Input",
            description="Load path data from a JSON file on disk.",
            inputs=[],
            outputs=[
                PortDefinition(name="paths", type=PortType.PATH, description="Loaded paths"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Path to the JSON file within the uploads directory",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        file_path = params.get("file_path", "")
        if not file_path:
            raise ValueError("file_path parameter is required")

        resolved = Path(file_path).resolve()
        if not resolved.is_relative_to(ALLOWED_BASE):
            raise ValueError("file_path must be within the allowed uploads directory")

        raw = resolved.read_text(encoding="utf-8")
        data = json.loads(raw)

        if not isinstance(data, list):
            raise ValueError("Path data must be a list of paths")

        validated: list[list[list[float]]] = []
        for i, path in enumerate(data):
            if not isinstance(path, list):
                raise ValueError(f"Path at index {i} must be a list of points")
            validated_path: list[list[float]] = []
            for j, point in enumerate(path):
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError(
                        f"Point at path[{i}][{j}] must be a list of exactly 2 float values"
                    )
                try:
                    validated_path.append([float(point[0]), float(point[1])])
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"Point at path[{i}][{j}] contains non-numeric values"
                    ) from exc
            validated.append(validated_path)

        return {"paths": validated}


Plugin = PathInput

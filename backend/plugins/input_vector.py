"""VectorInput plugin – loads an SVG file from a file path."""
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


class VectorInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="VectorInput",
            category="Input",
            description="Load an SVG vector file from a file path on disk.",
            inputs=[],
            outputs=[
                PortDefinition(name="vector", type=PortType.VECTOR, description="Loaded SVG"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Path to the SVG file within the uploads directory",
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

        content = resolved.read_text(encoding="utf-8")
        stripped = content.strip()
        if not (stripped.startswith("<") or stripped.startswith("<?")):
            raise ValueError("File does not appear to be a valid SVG document")

        return {"vector": content}


Plugin = VectorInput

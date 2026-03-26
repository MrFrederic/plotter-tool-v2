"""GCodeInput plugin – loads a G-code file from a file path."""
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


class GCodeInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="GCodeInput",
            category="Input",
            description="Load a G-code file from a file path on disk.",
            inputs=[],
            outputs=[
                PortDefinition(name="gcode", type=PortType.GCODE, description="Loaded G-code"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Path to the G-code file within the uploads directory",
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
        normalized = "\n".join(line.rstrip() for line in raw.splitlines())
        return {"gcode": normalized}


Plugin = GCodeInput

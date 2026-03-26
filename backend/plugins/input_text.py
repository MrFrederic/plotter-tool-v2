"""TextInput plugin – loads text from a file path."""
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


class TextInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="TextInput",
            category="Input",
            description="Load text from a file path on disk.",
            inputs=[],
            outputs=[
                PortDefinition(name="text", type=PortType.TEXT, description="Loaded text"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Path to the text file within the uploads directory",
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
        return {"text": content}


Plugin = TextInput

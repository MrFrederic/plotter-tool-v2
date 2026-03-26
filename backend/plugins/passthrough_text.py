"""TextPassthrough plugin – passes text data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class TextPassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="TextPassthrough",
            category="Testing",
            description="Pass text data through unchanged.",
            inputs=[
                PortDefinition(name="text", type=PortType.TEXT, description="Input text"),
            ],
            outputs=[
                PortDefinition(name="text", type=PortType.TEXT, description="Output text"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"text": inputs["text"]}


Plugin = TextPassthrough

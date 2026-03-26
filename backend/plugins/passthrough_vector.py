"""VectorPassthrough plugin – passes vector data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class VectorPassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="VectorPassthrough",
            category="Testing",
            description="Pass vector data through unchanged.",
            inputs=[
                PortDefinition(name="vector", type=PortType.VECTOR, description="Input vector"),
            ],
            outputs=[
                PortDefinition(name="vector", type=PortType.VECTOR, description="Output vector"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"vector": inputs["vector"]}


Plugin = VectorPassthrough

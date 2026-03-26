"""PathPassthrough plugin – passes path data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class PathPassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="PathPassthrough",
            category="Testing",
            description="Pass path data through unchanged.",
            inputs=[
                PortDefinition(name="paths", type=PortType.PATH, description="Input paths"),
            ],
            outputs=[
                PortDefinition(name="paths", type=PortType.PATH, description="Output paths"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"paths": inputs["paths"]}


Plugin = PathPassthrough

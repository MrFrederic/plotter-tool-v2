"""OtherPassthrough plugin – passes arbitrary data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class OtherPassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="OtherPassthrough",
            category="Testing",
            description="Pass arbitrary data through unchanged.",
            inputs=[
                PortDefinition(name="data", type=PortType.OTHER, description="Input data"),
            ],
            outputs=[
                PortDefinition(name="data", type=PortType.OTHER, description="Output data"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"data": inputs["data"]}


Plugin = OtherPassthrough

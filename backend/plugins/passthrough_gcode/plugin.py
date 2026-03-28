"""GCodePassthrough plugin – passes G-code data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class GCodePassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="GCodePassthrough",
            category="Testing",
            description="Pass G-code data through unchanged.",
            inputs=[
                PortDefinition(name="gcode", type=PortType.GCODE, description="Input G-code"),
            ],
            outputs=[
                PortDefinition(name="gcode", type=PortType.GCODE, description="Output G-code"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"gcode": inputs["gcode"]}


Plugin = GCodePassthrough

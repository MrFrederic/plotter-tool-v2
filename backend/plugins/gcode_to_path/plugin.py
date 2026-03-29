"""G-Code to Path plugin — decodes a G-code data stream into canonical PATH objects for pipeline processing."""
from __future__ import annotations

from typing import Any

from app.gcode_path_utils import gcode_to_paths
from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class GCodeToPath(BasePlugin):
    """Decode a G-code program and reconstruct its XY motion as canonical PATH objects."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="G-Code to Path",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="gcode",
                    type=PortType.GCODE,
                    description="Plain-text G-code program to decode. Must contain valid motion commands (G0, G1, G2, G3). The node reads this as a machine instruction stream and routes the XY motion into PATH geometry.",
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description="Reconstructed PATH objects from the decoded motion. Pen-down moves (G1/G2/G3) build path segments; each G0 rapid seals the current path and opens a new boundary.",
                ),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        gcode = inputs.get("gcode")
        if not isinstance(gcode, str) or not gcode.strip():
            raise ValueError("Input 'gcode' must be a non-empty G-code string")
        return {"path": gcode_to_paths(gcode)}


Plugin = GCodeToPath

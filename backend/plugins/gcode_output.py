"""GCodeOutput plugin – converts path data to G-code."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class GCodeOutput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="GCodeOutput",
            category="Output",
            description="Convert path data to G-code for a plotter.",
            inputs=[
                PortDefinition(name="paths", type=PortType.PATH, description="Input paths"),
            ],
            outputs=[
                PortDefinition(name="gcode", type=PortType.GCODE, description="Generated G-code"),
            ],
            parameters=[
                ParameterDefinition(
                    name="feed_rate",
                    type="number",
                    default=1000,
                    min=100,
                    max=5000,
                    step=100,
                    description="Movement feed rate in mm/min",
                ),
                ParameterDefinition(
                    name="z_up",
                    type="number",
                    default=5.0,
                    description="Z height when pen is up",
                ),
                ParameterDefinition(
                    name="z_down",
                    type="number",
                    default=0.0,
                    description="Z height when pen is down",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        paths = inputs.get("paths")
        if paths is None:
            raise ValueError("'paths' input is required")

        feed = float(params.get("feed_rate", 1000))
        z_up = float(params.get("z_up", 5.0))
        z_down = float(params.get("z_down", 0.0))

        lines: list[str] = [
            "G21 ; millimetres",
            "G90 ; absolute positioning",
            f"G0 Z{z_up:.2f} ; pen up",
        ]

        for path in paths:
            if not path or len(path) == 0:
                continue
            # Move to the start of the path with pen up
            x0, y0 = float(path[0][0]), float(path[0][1])
            lines.append(f"G0 X{x0:.3f} Y{y0:.3f} F{feed:.0f}")
            lines.append(f"G1 Z{z_down:.2f} ; pen down")

            for point in path[1:]:
                px, py = float(point[0]), float(point[1])
                lines.append(f"G1 X{px:.3f} Y{py:.3f} F{feed:.0f}")

            lines.append(f"G0 Z{z_up:.2f} ; pen up")

        lines.append("G0 X0 Y0 ; return home")
        lines.append("M2 ; program end")

        return {"gcode": "\n".join(lines)}


Plugin = GCodeOutput

"""ContourTrace plugin – extracts contour paths from a binary image."""
from typing import Any

import cv2
import numpy as np

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class ContourTrace(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="ContourTrace",
            category="Processing",
            description="Find contours in a binary image and return path data.",
            inputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Binary input image"),
            ],
            outputs=[
                PortDefinition(name="paths", type=PortType.PATH, description="Extracted contour paths"),
            ],
            parameters=[
                ParameterDefinition(
                    name="min_area",
                    type="number",
                    default=100,
                    min=0,
                    max=10000,
                    step=1,
                    description="Minimum contour area to keep",
                ),
                ParameterDefinition(
                    name="simplify",
                    type="number",
                    default=1.0,
                    min=0,
                    max=10,
                    step=0.1,
                    description="Contour approximation epsilon",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        raw = inputs.get("image")
        if raw is None:
            raise ValueError("'image' input is required")

        img = np.array(raw, dtype=np.uint8)
        if len(img.shape) == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        min_area = float(params.get("min_area", 100))
        epsilon = float(params.get("simplify", 1.0))

        contours, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        paths: list[list[list[float]]] = []
        for cnt in contours:
            if cv2.contourArea(cnt) < min_area:
                continue
            approx = cv2.approxPolyDP(cnt, epsilon, closed=True)
            path = [[float(pt[0][0]), float(pt[0][1])] for pt in approx]
            paths.append(path)

        return {"paths": paths}


Plugin = ContourTrace

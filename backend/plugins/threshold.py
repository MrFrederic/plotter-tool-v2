"""Threshold plugin – applies binary thresholding to an image."""
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


class Threshold(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Threshold",
            category="Processing",
            description="Apply binary thresholding to an image.",
            inputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Input image"),
            ],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Thresholded image"),
            ],
            parameters=[
                ParameterDefinition(
                    name="threshold_value",
                    type="number",
                    default=128,
                    min=0,
                    max=255,
                    step=1,
                    description="Pixel intensity threshold",
                ),
                ParameterDefinition(
                    name="invert",
                    type="boolean",
                    default=False,
                    description="Invert the threshold result",
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

        thresh_val = int(params.get("threshold_value", 128))
        invert = bool(params.get("invert", False))

        mode = cv2.THRESH_BINARY_INV if invert else cv2.THRESH_BINARY
        _, result = cv2.threshold(img, thresh_val, 255, mode)

        return {"image": result.tolist()}


Plugin = Threshold

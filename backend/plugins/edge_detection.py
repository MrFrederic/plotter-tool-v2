"""EdgeDetection plugin – applies Canny edge detection."""
from typing import Any

import cv2

from app.image_utils import decode_image, encode_image
from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class EdgeDetection(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="EdgeDetection",
            category="Processing",
            description="Apply Canny edge detection to an image.",
            inputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Input image"),
            ],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Edge map"),
            ],
            parameters=[
                ParameterDefinition(
                    name="low_threshold",
                    type="number",
                    default=50,
                    min=0,
                    max=255,
                    step=1,
                    description="Lower hysteresis threshold",
                ),
                ParameterDefinition(
                    name="high_threshold",
                    type="number",
                    default=150,
                    min=0,
                    max=255,
                    step=1,
                    description="Upper hysteresis threshold",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        raw = inputs.get("image")
        if raw is None:
            raise ValueError("'image' input is required")

        img = decode_image(raw)
        if len(img.shape) == 3:
            img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        low = int(params.get("low_threshold", 50))
        high = int(params.get("high_threshold", 150))

        edges = cv2.Canny(img, low, high)
        return {"image": encode_image(edges)}


Plugin = EdgeDetection

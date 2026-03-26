"""ImageInput plugin – loads an image from a file path."""
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


class ImageInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="ImageInput",
            category="Input",
            description="Load an image from a file path on disk.",
            inputs=[],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Loaded image"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Absolute or relative path to the image file",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        file_path = params.get("file_path", "")
        if not file_path:
            raise ValueError("file_path parameter is required")

        # Resolve to an absolute path and block directory traversal via ".."
        from pathlib import Path
        resolved = Path(file_path).resolve()
        if ".." in Path(file_path).parts:
            raise ValueError("Directory traversal is not allowed in file_path")

        img = cv2.imread(str(resolved), cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(f"Could not load image at '{resolved}'")

        return {"image": img.tolist()}


Plugin = ImageInput

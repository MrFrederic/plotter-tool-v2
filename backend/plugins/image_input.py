"""ImageInput plugin – loads an image from a file path."""
from pathlib import Path
from typing import Any

import cv2

from app.config import settings
from app.image_utils import encode_image
from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)

ALLOWED_BASE = Path(settings.CACHE_DIR).resolve()


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
                    description="Relative path to the image file within the uploads directory",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        file_path = params.get("file_path", "")
        if not file_path:
            raise ValueError("file_path parameter is required")

        resolved = Path(file_path).resolve()
        if not resolved.is_relative_to(ALLOWED_BASE):
            raise ValueError(
                "file_path must be within the allowed uploads directory"
            )

        img = cv2.imread(str(resolved), cv2.IMREAD_COLOR)
        if img is None:
            raise FileNotFoundError(f"Could not load image at '{resolved}'")

        return {"image": encode_image(img)}


Plugin = ImageInput

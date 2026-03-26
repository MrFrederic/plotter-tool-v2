"""ImagePassthrough plugin – passes image data through unchanged."""
from typing import Any

from app.plugin_base import (
    BasePlugin,
    PluginSchema,
    PortDefinition,
    PortType,
)


class ImagePassthrough(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="ImagePassthrough",
            category="Testing",
            description="Pass image data through unchanged.",
            inputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Input image"),
            ],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Output image"),
            ],
            parameters=[],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        return {"image": inputs["image"]}


Plugin = ImagePassthrough

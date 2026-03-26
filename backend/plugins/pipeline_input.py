"""PipelineInput plugin – entry point that reads an uploaded file and normalises it for the pipeline."""
import json
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


class PipelineInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Pipeline Input",
            category="Flow",
            description="Entry point — reads an uploaded file and normalizes it for the pipeline",
            inputs=[],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Normalised raster image"),
                PortDefinition(name="vector", type=PortType.VECTOR, description="Normalised SVG content"),
                PortDefinition(name="gcode", type=PortType.GCODE, description="Normalised G-code text"),
                PortDefinition(name="path", type=PortType.PATH, description="Normalised path data"),
                PortDefinition(name="text", type=PortType.TEXT, description="Plain text content"),
                PortDefinition(name="other", type=PortType.OTHER, description="Raw / fallback data"),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Server-side path to the uploaded file",
                ),
                ParameterDefinition(
                    name="file_category",
                    type="string",
                    default="other",
                    description="File category detected during upload",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        file_path = params.get("file_path", "")
        if not file_path:
            raise ValueError("file_path parameter is required")

        resolved = Path(file_path).resolve()
        if not resolved.is_relative_to(ALLOWED_BASE):
            raise ValueError("file_path must be within the allowed uploads directory")
        if not resolved.exists():
            raise FileNotFoundError(f"File not found: {resolved}")

        file_category = params.get("file_category", "other")

        if file_category == "image":
            return self._load_image(resolved)
        if file_category == "vector":
            return self._load_vector(resolved)
        if file_category == "gcode":
            return self._load_gcode(resolved)
        if file_category == "path":
            return self._load_path(resolved)
        if file_category == "text":
            return self._load_text(resolved)
        return self._load_other(resolved)

    # ------------------------------------------------------------------
    # Category-specific loaders
    # ------------------------------------------------------------------

    @staticmethod
    def _load_image(resolved: Path) -> dict[str, Any]:
        img = cv2.imread(str(resolved), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Could not load image at '{resolved}'")
        return {"image": encode_image(img)}

    @staticmethod
    def _load_vector(resolved: Path) -> dict[str, Any]:
        content = resolved.read_text(encoding="utf-8")
        stripped = content.strip()
        if not (stripped.startswith("<") or stripped.startswith("<?")):
            raise ValueError(
                "File does not appear to be a valid SVG document "
                "(content must start with '<' or '<?')"
            )
        return {"vector": content}

    @staticmethod
    def _load_gcode(resolved: Path) -> dict[str, Any]:
        raw = resolved.read_text(encoding="utf-8")
        normalized = "\n".join(line.rstrip() for line in raw.splitlines())
        return {"gcode": normalized}

    @staticmethod
    def _load_path(resolved: Path) -> dict[str, Any]:
        raw = resolved.read_text(encoding="utf-8")
        data = json.loads(raw)

        if not isinstance(data, list):
            raise ValueError("Path data must be a list of paths")

        validated: list[list[list[float]]] = []
        for i, path_item in enumerate(data):
            if not isinstance(path_item, list):
                raise ValueError(f"Path at index {i} must be a list of points")
            validated_path: list[list[float]] = []
            for j, point in enumerate(path_item):
                if not isinstance(point, list) or len(point) != 2:
                    raise ValueError(f"Point at path[{i}][{j}] must be [x, y]")
                try:
                    validated_path.append([float(point[0]), float(point[1])])
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"Point at path[{i}][{j}] contains non-numeric values"
                    ) from exc
            validated.append(validated_path)

        return {"paths": validated}

    @staticmethod
    def _load_text(resolved: Path) -> dict[str, Any]:
        content = resolved.read_text(encoding="utf-8")
        return {"text": content}

    @staticmethod
    def _load_other(resolved: Path) -> dict[str, Any]:
        content = resolved.read_bytes()
        try:
            return {"data": json.loads(content)}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {"data": content.decode("utf-8", errors="replace")}


Plugin = PipelineInput

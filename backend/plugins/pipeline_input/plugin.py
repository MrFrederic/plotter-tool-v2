"""PipelineInput plugin – authorized entry-point node that loads an uploaded file and injects it into the pipeline data stream."""
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


# ---------------------------------------------------------------------------
# Path normalisation helpers
# ---------------------------------------------------------------------------

def _parse_xy(value: object, label: str) -> list[float]:
    """Coerce *value* to a validated [x, y] pair."""
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError(f"{label} must be [x, y]")
    try:
        return [float(value[0]), float(value[1])]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} contains non-numeric values") from exc


def _parse_meta(meta: object) -> dict[str, float | None]:
    """Normalise a segment meta dict; missing keys default to None."""
    if meta is None:
        return {"width": None, "speed": None}
    if not isinstance(meta, dict):
        raise ValueError("Segment 'meta' must be an object or null")
    width = meta.get("width")
    speed = meta.get("speed")
    return {
        "width": float(width) if width is not None else None,
        "speed": float(speed) if speed is not None else None,
    }


def _normalize_segment(seg: object, path_i: int, seg_j: int) -> dict[str, object]:
    """Return a validated, normalised segment dict."""
    ctx = f"path[{path_i}].segments[{seg_j}]"
    if not isinstance(seg, dict):
        raise ValueError(f"{ctx} must be an object")
    seg_type = seg.get("type")
    if seg_type not in ("line", "arc"):
        raise ValueError(f"{ctx}.type must be 'line' or 'arc'")
    from_pt = _parse_xy(seg.get("from"), f"{ctx}.from")
    to_pt = _parse_xy(seg.get("to"), f"{ctx}.to")
    meta = _parse_meta(seg.get("meta"))
    if seg_type == "line":
        return {"type": "line", "from": from_pt, "to": to_pt, "meta": meta}
    # arc
    center = _parse_xy(seg.get("center"), f"{ctx}.center")
    clockwise = seg.get("clockwise", True)
    if not isinstance(clockwise, bool):
        raise ValueError(f"{ctx}.clockwise must be a boolean")
    return {
        "type": "arc",
        "from": from_pt,
        "to": to_pt,
        "center": center,
        "clockwise": clockwise,
        "meta": meta,
    }


def _points_to_segments(points: list[list[float]]) -> list[dict[str, object]]:
    """Convert legacy [x,y] point-list into straight line segments with null meta."""
    segments: list[dict[str, object]] = []
    for k in range(len(points) - 1):
        segments.append({
            "type": "line",
            "from": points[k],
            "to": points[k + 1],
            "meta": {"width": None, "speed": None},
        })
    return segments


def _normalize_paths(data: list[object]) -> list[dict[str, object]]:
    """Normalise raw path data to the canonical segment-based format.

    Accepts either:
      - New format: list of ``{"closed": bool, "segments": [...]}`` objects.
      - Legacy format: ``list[list[list[float]]]`` (point lists).

    Returns a list of path objects conforming to the new convention.
    """
    result: list[dict[str, object]] = []
    for i, path_item in enumerate(data):
        # ------------------------------------------------------------------
        # New format: path_item is a dict with a 'segments' key
        # ------------------------------------------------------------------
        if isinstance(path_item, dict):
            segments_raw = path_item.get("segments")
            if not isinstance(segments_raw, list):
                raise ValueError(f"path[{i}].segments must be a list")
            closed = path_item.get("closed", False)
            if not isinstance(closed, bool):
                raise ValueError(f"path[{i}].closed must be a boolean")
            segments = [_normalize_segment(s, i, j) for j, s in enumerate(segments_raw)]
            result.append({"closed": closed, "segments": segments})
        # ------------------------------------------------------------------
        # Legacy format: path_item is a list of [x, y] points
        # ------------------------------------------------------------------
        elif isinstance(path_item, list):
            validated_pts: list[list[float]] = []
            for j, point in enumerate(path_item):
                validated_pts.append(_parse_xy(point, f"path[{i}][{j}]"))
            segments = _points_to_segments(validated_pts)
            result.append({"closed": False, "segments": segments})
        else:
            raise ValueError(f"path[{i}] must be a list of points or a path object")
    return result


class PipelineInput(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Pipeline Input",
            category="Flow",
            description="file:details.md",
            inputs=[],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Raster image payload (PNG/JPG) loaded and encoded for downstream IMAGE nodes."),
                PortDefinition(name="vector", type=PortType.VECTOR, description="SVG document routed as XML text to downstream VECTOR nodes."),
                PortDefinition(name="gcode", type=PortType.GCODE, description="G-code program text with trailing whitespace stripped per line, ready for GCODE nodes."),
                PortDefinition(name="path", type=PortType.PATH, description="Normalized segment-based path data. Accepts both modern path objects and legacy point lists."),
                PortDefinition(name="text", type=PortType.TEXT, description="Plain UTF-8 text, passed through to TEXT nodes without modification."),
                PortDefinition(name="other", type=PortType.OTHER, description="Fallback channel for unrecognized categories. Returns parsed JSON if valid, otherwise decoded UTF-8 text."),
            ],
            parameters=[
                ParameterDefinition(
                    name="file_path",
                    type="string",
                    default="",
                    description="Server-side path to the uploaded file. Must be non-empty, must exist, and must resolve inside the authorized cache upload directory. Set automatically by the upload flow — do not edit manually.",
                ),
                ParameterDefinition(
                    name="file_category",
                    type="string",
                    default="other",
                    description="Selects the loader and output channel. Known values: `image`, `vector`, `gcode`, `path`, `text`, `other`. Unknown values route to the `other` channel.",
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

        return {"paths": _normalize_paths(data)}

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

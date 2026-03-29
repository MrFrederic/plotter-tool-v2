"""PathSplitter plugin – decomposes multi-segment paths into standalone path objects for per-stroke pipeline control."""
import math
from typing import Any

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)

# Default per-segment metadata used when inherit_meta is disabled or meta is absent.
_DEFAULT_META: dict[str, Any] = {"width": None, "speed": None}


class PathSplitter(BasePlugin):
    """Partitions each incoming path into smaller segment groups and routes them as independent path objects."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path Splitter",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "Incoming PATH data stream. Each path object is read, "
                        "filtered, and decomposed into segment groups for "
                        "downstream processing."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "Output PATH data stream. Each item is a partitioned path "
                        "built from one or more consecutive segments. Split outputs "
                        "are emitted as open paths (`closed=false`) unless a closed "
                        "path is routed through intact."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="preserve_closed",
                    type="boolean",
                    default=False,
                    description=(
                        "Route closed paths (rectangles, circles) through the node "
                        "intact, bypassing the split protocol. When false, closed "
                        "and open paths are both partitioned normally."
                    ),
                ),
                ParameterDefinition(
                    name="inherit_meta",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, each output segment inherits its original "
                        "`meta` values (pen width, speed) from the source path. "
                        "Disable to reset meta to `width=null, speed=null` so "
                        "downstream nodes can assign fresh values."
                    ),
                ),
                ParameterDefinition(
                    name="group_size",
                    type="number",
                    default=1,
                    min=1,
                    max=1000,
                    step=1,
                    description=(
                        "Number of consecutive segments packed into each output path. "
                        "`1` = one path per segment; `2` = pairs; and so on. "
                        "If segments do not divide evenly, the final group contains "
                        "the remainder."
                    ),
                ),
                ParameterDefinition(
                    name="min_segment_length",
                    type="number",
                    default=0.0,
                    min=0.0,
                    max=100.0,
                    step=0.1,
                    description=(
                        "Discard segments whose straight-line `from`→`to` distance "
                        "falls below this threshold before grouping. "
                        "Set `0.0` to execute no filtering and keep all segments."
                    ),
                ),
            ],
        )

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    async def process(
        self, inputs: dict[str, Any], params: dict[str, Any]
    ) -> dict[str, Any]:
        """Split each input PathObject into per-segment (or grouped) PathObjects."""

        # --- Extract & validate inputs --------------------------------
        paths: list[dict[str, Any]] = (inputs or {}).get("path") or []

        # --- Read parameters with safe defaults -----------------------
        preserve_closed: bool = bool(params.get("preserve_closed", False))
        inherit_meta: bool = bool(params.get("inherit_meta", True))
        group_size: int = int(params.get("group_size", 1))
        min_segment_length: float = float(params.get("min_segment_length", 0.0))

        # Clamp group_size to at least 1.
        if group_size < 1:
            group_size = 1

        result: list[dict[str, Any]] = []

        for path_obj in paths:
            # Validate required structure.
            if "segments" not in path_obj:
                raise ValueError("Invalid path object: missing 'segments'")

            # If preserve_closed is enabled and path is closed, pass through.
            if preserve_closed and path_obj.get("closed", False):
                result.append(path_obj)
                continue

            segments: list[dict[str, Any]] = path_obj["segments"]

            # --- Filter by minimum segment length ---------------------
            surviving: list[dict[str, Any]] = []
            for seg in segments:
                length = _segment_length(seg)
                if length >= min_segment_length:
                    surviving.append(seg)

            # If no segments survive, this path contributes nothing.
            if not surviving:
                continue

            # --- Optionally strip meta --------------------------------
            if not inherit_meta:
                surviving = [_reset_meta(seg) for seg in surviving]
            else:
                # Ensure every segment has a meta key.
                surviving = [_ensure_meta(seg) for seg in surviving]

            # --- Group segments into chunks of group_size -------------
            for i in range(0, len(surviving), group_size):
                group = surviving[i : i + group_size]
                result.append({"closed": False, "segments": group})

        return {"path": result}


# ======================================================================
# Helper utilities
# ======================================================================


def _segment_length(seg: dict[str, Any]) -> float:
    """Compute the Euclidean distance from a segment's 'from' to 'to' point."""
    pt_from = seg.get("from", [0, 0])
    pt_to = seg.get("to", [0, 0])
    dx = pt_to[0] - pt_from[0]
    dy = pt_to[1] - pt_from[1]
    return math.hypot(dx, dy)


def _reset_meta(seg: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of *seg* with meta replaced by the default."""
    new_seg = dict(seg)
    new_seg["meta"] = dict(_DEFAULT_META)
    return new_seg


def _ensure_meta(seg: dict[str, Any]) -> dict[str, Any]:
    """Return the segment, adding a default meta dict if the key is missing."""
    if "meta" not in seg:
        new_seg = dict(seg)
        new_seg["meta"] = dict(_DEFAULT_META)
        return new_seg
    return seg


# Module-level alias required by the plugin loader.
Plugin = PathSplitter

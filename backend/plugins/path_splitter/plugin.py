"""PathSplitter plugin – explodes multi-segment paths into minimal standalone path objects."""
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
    """Splits each input path into individual (or small-group) segment path objects."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path Splitter",
            category="Processing",
            description=(
                "Explodes each input path object into multiple single-segment "
                "(or small-group) path objects, effectively converting multi-segment "
                "paths into an expanded array of minimal paths. Supports configurable "
                "group sizing, optional closed-path preservation, and minimum-length "
                "filtering. Useful for per-segment analysis, reordering optimisation, "
                "or feeding individual strokes into downstream processors."
            ),
            inputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "The set of path objects to split. Each PathObject's "
                        "segments are broken apart into standalone paths."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "The expanded PATH array where each original segment "
                        "(or group of segments) is now its own standalone "
                        "PathObject with closed=false (unless preserved)."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="preserve_closed",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, path objects with closed=true are passed "
                        "through intact without splitting. Useful when closed "
                        "shapes must remain as single units while open paths get "
                        "split. When disabled, all paths are split regardless of "
                        "closed status."
                    ),
                ),
                ParameterDefinition(
                    name="inherit_meta",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, each new single-segment PathObject inherits "
                        "the meta dictionary from its source segment. When disabled, "
                        "all new segments receive default meta of {width: null, "
                        "speed: null}. Enable to preserve per-segment metadata "
                        "assigned by upstream plugins."
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
                        "The number of consecutive segments to keep together in "
                        "each output PathObject. A value of 1 means true per-segment "
                        "splitting. A value of 2 groups every two consecutive "
                        "segments. When the last group has fewer segments than "
                        "group_size, it is emitted as-is."
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
                        "The minimum Euclidean length an individual segment must "
                        "have to be included. Segments shorter than this are "
                        "discarded after splitting. Applied per-segment before "
                        "grouping. Set to 0 to keep all segments."
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

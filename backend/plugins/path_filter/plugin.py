"""PathFilter plugin — routes each incoming path through a configurable predicate and dispatches it to pass or fail output channels."""
import math
from typing import Any

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class PathFilter(BasePlugin):
    """Splits an incoming PATH stream into authorized (pass) and rejected (fail) channels based on a single configurable predicate."""

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path Filter",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description="Incoming PATH stream. Each path is evaluated independently against the active filter predicate.",
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path_pass",
                    type=PortType.PATH,
                    description="Paths that satisfied the predicate. If invert is active, receives paths that normally fail.",
                ),
                PortDefinition(
                    name="path_fail",
                    type=PortType.PATH,
                    description="Paths that did not satisfy the predicate. If invert is active, receives paths that normally pass.",
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="filter_mode",
                    type="select",
                    default="closed_open",
                    options=[
                        "closed_open",
                        "min_segments",
                        "min_length",
                        "bbox_area",
                        "has_arcs",
                    ],
                    description="Active filter protocol. Selects which property of each path is tested: closed_open, min_segments, min_length, bbox_area, or has_arcs.",
                ),
                ParameterDefinition(
                    name="keep_closed",
                    type="boolean",
                    default=True,
                    visible_if={"parameter": "filter_mode", "equals": "closed_open"},
                    description="Determines which topology is authorized. True: closed paths pass. False: open paths pass. Active when filter_mode is closed_open.",
                ),
                ParameterDefinition(
                    name="min_segment_count",
                    type="number",
                    default=2,
                    min=1,
                    max=10000,
                    step=1,
                    visible_if={"parameter": "filter_mode", "equals": "min_segments"},
                    description="Minimum segment count required to clear inspection. Paths below this threshold are routed to path_fail. Active when filter_mode is min_segments.",
                ),
                ParameterDefinition(
                    name="min_total_length",
                    type="number",
                    default=10.0,
                    min=0.0,
                    max=100000.0,
                    step=0.1,
                    visible_if={"parameter": "filter_mode", "equals": "min_length"},
                    description="Minimum total path length (sum of segment endpoint distances) required to pass. Active when filter_mode is min_length.",
                ),
                ParameterDefinition(
                    name="min_bbox_area",
                    type="number",
                    default=100.0,
                    min=0.0,
                    max=1000000.0,
                    step=1.0,
                    visible_if={"parameter": "filter_mode", "equals": "bbox_area"},
                    description="Minimum axis-aligned bounding-box area (width × height) required to pass. Active when filter_mode is bbox_area.",
                ),
                ParameterDefinition(
                    name="keep_with_arcs",
                    type="boolean",
                    default=True,
                    visible_if={"parameter": "filter_mode", "equals": "has_arcs"},
                    description="Determines which segment topology is authorized. True: paths containing at least one arc pass. False: line-only paths pass. Active when filter_mode is has_arcs.",
                ),
                ParameterDefinition(
                    name="invert",
                    type="boolean",
                    default=False,
                    description="Swaps pass and fail output channels after the predicate runs. Use to route the opposite set without changing filter thresholds.",
                ),
            ],
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _euclidean_distance(p1: list[float], p2: list[float]) -> float:
        """Return the Euclidean distance between two 2-D points."""
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        return math.sqrt(dx * dx + dy * dy)

    @staticmethod
    def _total_length(segments: list[dict[str, Any]]) -> float:
        """Sum of Euclidean distances across all segments."""
        total = 0.0
        for seg in segments:
            total += PathFilter._euclidean_distance(seg["from"], seg["to"])
        return total

    @staticmethod
    def _bbox_area(segments: list[dict[str, Any]]) -> float:
        """Axis-aligned bounding-box area derived from all segment endpoints."""
        xs: list[float] = []
        ys: list[float] = []
        for seg in segments:
            xs.append(seg["from"][0])
            xs.append(seg["to"][0])
            ys.append(seg["from"][1])
            ys.append(seg["to"][1])
        if not xs:
            return 0.0
        return (max(xs) - min(xs)) * (max(ys) - min(ys))

    @staticmethod
    def _has_arc(segments: list[dict[str, Any]]) -> bool:
        """Return True if any segment has type 'arc'."""
        return any(seg.get("type") == "arc" for seg in segments)

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    async def process(
        self,
        inputs: dict[str, Any],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Route each path through the active filter predicate and dispatch to pass or fail channels."""

        # --- Extract input paths (missing / None → empty list) -----------
        paths: list[dict[str, Any]] = inputs.get("path") or []

        # --- Read parameters ---------------------------------------------
        filter_mode: str = params.get("filter_mode", "closed_open")
        keep_closed: bool = params.get("keep_closed", True)
        min_segment_count: int = int(params.get("min_segment_count", 2))
        min_total_length: float = float(params.get("min_total_length", 10.0))
        min_bbox_area: float = float(params.get("min_bbox_area", 100.0))
        keep_with_arcs: bool = params.get("keep_with_arcs", True)
        invert: bool = params.get("invert", False)

        # Validate filter_mode early
        valid_modes = {"closed_open", "min_segments", "min_length", "bbox_area", "has_arcs"}
        if filter_mode not in valid_modes:
            raise ValueError(f"Unknown filter_mode: {filter_mode}")

        # --- Classify each path ------------------------------------------
        pass_list: list[dict[str, Any]] = []
        fail_list: list[dict[str, Any]] = []

        for path_obj in paths:
            # Validate required 'segments' key
            if "segments" not in path_obj:
                raise ValueError("Invalid path object: missing 'segments'")

            segments: list[dict[str, Any]] = path_obj["segments"]

            # Evaluate the predicate for the active mode
            passes = self._evaluate(
                path_obj,
                segments,
                filter_mode,
                keep_closed,
                min_segment_count,
                min_total_length,
                min_bbox_area,
                keep_with_arcs,
            )

            if passes:
                pass_list.append(path_obj)
            else:
                fail_list.append(path_obj)

        # --- Optionally invert the result --------------------------------
        if invert:
            pass_list, fail_list = fail_list, pass_list

        return {"path_pass": pass_list, "path_fail": fail_list}

    # ------------------------------------------------------------------
    # Predicate dispatcher
    # ------------------------------------------------------------------

    def _evaluate(
        self,
        path_obj: dict[str, Any],
        segments: list[dict[str, Any]],
        mode: str,
        keep_closed: bool,
        min_segment_count: int,
        min_total_length: float,
        min_bbox_area: float,
        keep_with_arcs: bool,
    ) -> bool:
        """Return True when the path satisfies the active filter predicate."""

        if mode == "closed_open":
            # Missing 'closed' key → treat as closed=False
            is_closed = path_obj.get("closed", False)
            return is_closed == keep_closed

        if mode == "min_segments":
            return len(segments) >= min_segment_count

        if mode == "min_length":
            return self._total_length(segments) >= min_total_length

        if mode == "bbox_area":
            return self._bbox_area(segments) >= min_bbox_area

        if mode == "has_arcs":
            has = self._has_arc(segments)
            return has == keep_with_arcs

        # Unreachable when filter_mode is validated beforehand
        raise ValueError(f"Unknown filter_mode: {mode}")  # pragma: no cover


# Module-level alias required by the plugin loader
Plugin = PathFilter

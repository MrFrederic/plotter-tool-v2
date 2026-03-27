"""PathFilter plugin – splits a PATH array into pass/fail outputs based on a configurable predicate."""
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
    """Splits an input PATH array into two outputs using a configurable filter predicate."""

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path Filter",
            category="Processing",
            description=(
                "Splits an input PATH array into two outputs — paths that pass a "
                "configurable predicate and paths that fail it. Supports multiple "
                "filter modes including closed/open classification, minimum segment "
                "count, minimum total length, bounding-box area, and arc presence. "
                "Enables selective routing of path subsets through different "
                "downstream processing branches."
            ),
            inputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "The set of path objects to evaluate and split. Each "
                        "PathObject is independently tested against the active "
                        "filter predicate."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path_pass",
                    type=PortType.PATH,
                    description=(
                        "Path objects that satisfy the active filter condition. "
                        "Swapped with path_fail when invert is enabled."
                    ),
                ),
                PortDefinition(
                    name="path_fail",
                    type=PortType.PATH,
                    description=(
                        "Path objects that do not satisfy the active filter "
                        "condition. Swapped with path_pass when invert is enabled."
                    ),
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
                    description=(
                        "Selects which predicate function is used to evaluate each "
                        "path. closed_open: classifies based on the path's closed "
                        "flag. min_segments: tests whether the path has at least a "
                        "certain number of segments. min_length: tests whether the "
                        "total segment length meets a threshold. bbox_area: tests "
                        "whether the axis-aligned bounding box area meets a "
                        "threshold. has_arcs: tests whether the path contains any "
                        "arc-type segments."
                    ),
                ),
                ParameterDefinition(
                    name="keep_closed",
                    type="boolean",
                    default=True,
                    visible_if={"parameter": "filter_mode", "equals": "closed_open"},
                    description=(
                        "closed_open mode only. When true, closed paths pass and "
                        "open paths fail. When false, open paths pass and closed "
                        "paths fail. Ignored in all other modes."
                    ),
                ),
                ParameterDefinition(
                    name="min_segment_count",
                    type="number",
                    default=2,
                    min=1,
                    max=10000,
                    step=1,
                    visible_if={"parameter": "filter_mode", "equals": "min_segments"},
                    description=(
                        "min_segments mode only. The minimum number of segments a "
                        "path must contain to pass. Paths with fewer segments are "
                        "routed to path_fail. Ignored in other modes."
                    ),
                ),
                ParameterDefinition(
                    name="min_total_length",
                    type="number",
                    default=10.0,
                    min=0.0,
                    max=100000.0,
                    step=0.1,
                    visible_if={"parameter": "filter_mode", "equals": "min_length"},
                    description=(
                        "min_length mode only. The minimum total Euclidean length "
                        "(sum of all segment lengths) for a path to pass. Ignored "
                        "in other modes."
                    ),
                ),
                ParameterDefinition(
                    name="min_bbox_area",
                    type="number",
                    default=100.0,
                    min=0.0,
                    max=1000000.0,
                    step=1.0,
                    visible_if={"parameter": "filter_mode", "equals": "bbox_area"},
                    description=(
                        "bbox_area mode only. The minimum axis-aligned bounding "
                        "box area (width × height) for a path to pass. Ignored in "
                        "other modes."
                    ),
                ),
                ParameterDefinition(
                    name="keep_with_arcs",
                    type="boolean",
                    default=True,
                    visible_if={"parameter": "filter_mode", "equals": "has_arcs"},
                    description=(
                        "has_arcs mode only. When true, paths containing at least "
                        "one arc segment pass. When false, line-only paths pass. "
                        "Ignored in other modes."
                    ),
                ),
                ParameterDefinition(
                    name="invert",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, the pass and fail outputs are swapped after "
                        "evaluation. Effectively negates the filter condition."
                    ),
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
        """Evaluate each path against the active filter predicate and split into pass/fail."""

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

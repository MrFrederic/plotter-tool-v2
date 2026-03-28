"""PathCombine plugin – merges two PATH arrays into a single unified output."""
import math
from typing import Any

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class PathCombine(BasePlugin):
    """Merges two PATH inputs with configurable ordering and optional deduplication."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path Combine",
            category="Processing",
            description=(
                "Merges two PATH arrays into a single unified PATH output. "
                "Supports configurable ordering strategies and optional deduplication "
                "of geometrically identical paths. Useful for combining outputs from "
                "parallel processing branches before routing to a shared G-code "
                "generator or preview node."
            ),
            inputs=[
                PortDefinition(
                    name="path_a",
                    type=PortType.PATH,
                    description=(
                        "The first set of path objects to merge. "
                        "Treated as the 'A' collection for ordering purposes."
                    ),
                ),
                PortDefinition(
                    name="path_b",
                    type=PortType.PATH,
                    description=(
                        "The second set of path objects to merge. "
                        "Treated as the 'B' collection for ordering purposes."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "The merged PATH array containing path objects from both "
                        "inputs, ordered and optionally deduplicated per the "
                        "parameter settings."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="merge_order",
                    type="select",
                    default="a_then_b",
                    options=["a_then_b", "b_then_a", "interleave"],
                    description=(
                        "Controls the order in which path objects from the two "
                        "inputs appear in the output. a_then_b: all of A's paths "
                        "followed by all of B's. b_then_a: all of B's then A's. "
                        "interleave: alternates one from A, one from B; once one "
                        "is exhausted, the remainder of the other is appended."
                    ),
                ),
                ParameterDefinition(
                    name="remove_duplicates",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, geometrically duplicate path objects are "
                        "removed from the merged result. Two paths are considered "
                        "duplicates if every corresponding segment's from and to "
                        "points are within duplicate_tolerance distance. Only the "
                        "first occurrence is kept."
                    ),
                ),
                ParameterDefinition(
                    name="duplicate_tolerance",
                    type="number",
                    default=0.01,
                    min=0.0,
                    max=10.0,
                    step=0.01,
                    visible_if={"parameter": "remove_duplicates", "equals": True},
                    description=(
                        "The maximum Euclidean distance between corresponding "
                        "segment endpoints for two segments to be considered "
                        "identical. Only relevant when remove_duplicates is "
                        "enabled. Increase if coordinate rounding causes "
                        "near-but-not-exact matches."
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
        # --- 1. Extract inputs, treating None/missing as empty lists ---
        path_a = self._normalise_input(inputs, "path_a")
        path_b = self._normalise_input(inputs, "path_b")

        # --- 2. Combine based on merge_order ---
        merge_order: str = params.get("merge_order", "a_then_b")
        combined = self._merge(path_a, path_b, merge_order)

        # --- 3. Optional deduplication ---
        if params.get("remove_duplicates", False):
            tolerance = params.get("duplicate_tolerance", 0.01)
            # Clamp negative tolerance to 0.0
            if tolerance < 0:
                tolerance = 0.0
            combined = self._deduplicate(combined, tolerance)

        return {"path": combined}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_input(
        inputs: dict[str, Any], port_name: str
    ) -> list[dict[str, Any]]:
        """Return a validated list of path objects for *port_name*.

        Missing or ``None`` values are treated as an empty list.
        Each path object must contain a ``segments`` key.
        """
        data = inputs.get(port_name)
        if data is None:
            return []

        for idx, path_obj in enumerate(data):
            if "segments" not in path_obj:
                raise ValueError(
                    f"Invalid path object in {port_name}: missing 'segments'"
                )

        return list(data)

    @staticmethod
    def _merge(
        path_a: list[dict[str, Any]],
        path_b: list[dict[str, Any]],
        order: str,
    ) -> list[dict[str, Any]]:
        """Merge two path lists according to *order* strategy."""
        if order == "b_then_a":
            return path_b + path_a

        if order == "interleave":
            merged: list[dict[str, Any]] = []
            i = 0
            # Alternate elements from A and B
            while i < len(path_a) and i < len(path_b):
                merged.append(path_a[i])
                merged.append(path_b[i])
                i += 1
            # Append any remaining items from the longer list
            merged.extend(path_a[i:])
            merged.extend(path_b[i:])
            return merged

        # Default: a_then_b
        return path_a + path_b

    @staticmethod
    def _paths_are_duplicates(
        p1: dict[str, Any], p2: dict[str, Any], tolerance: float
    ) -> bool:
        """Return ``True`` if *p1* and *p2* are geometrically identical.

        Two path objects are considered duplicates when:
        - They have the same number of segments.
        - They share the same ``closed`` flag.
        - For every pair of corresponding segments the Euclidean distance
          between their ``from`` points AND ``to`` points is <= *tolerance*.
        """
        segs1 = p1.get("segments", [])
        segs2 = p2.get("segments", [])

        # Different segment counts → not duplicates
        if len(segs1) != len(segs2):
            return False

        # Different closed flags → not duplicates
        if p1.get("closed") != p2.get("closed"):
            return False

        for s1, s2 in zip(segs1, segs2):
            # Check 'from' points
            f1 = s1.get("from", [0, 0])
            f2 = s2.get("from", [0, 0])
            if math.dist(f1, f2) > tolerance:
                return False

            # Check 'to' points
            t1 = s1.get("to", [0, 0])
            t2 = s2.get("to", [0, 0])
            if math.dist(t1, t2) > tolerance:
                return False

        return True

    @classmethod
    def _deduplicate(
        cls, paths: list[dict[str, Any]], tolerance: float
    ) -> list[dict[str, Any]]:
        """Remove geometrically duplicate path objects, keeping first occurrence."""
        kept: list[dict[str, Any]] = []
        for path in paths:
            is_dup = any(
                cls._paths_are_duplicates(path, existing, tolerance)
                for existing in kept
            )
            if not is_dup:
                kept.append(path)
        return kept


Plugin = PathCombine

"""Path to G-Code plugin — encodes canonical PATH geometry into machine-executable G-code programs."""
from __future__ import annotations

import math
from typing import Any

from app.gcode_path_utils import DEFAULT_SEGMENT_META
from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)


class PathToGCode(BasePlugin):
    """Encodes canonical PATH geometry into a configurable G-code program for direct machine execution."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Path to G-Code",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "PATH geometry to process into motion commands. "
                        "Each path encodes ordered line/arc segments — plus optional per-segment metadata — that are translated into tool travel and cutting sequences."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="gcode",
                    type=PortType.GCODE,
                    description=(
                        "Emitted G-code program — plain text, controller-ready. "
                        "Contains all setup, travel, cutting, and sequence commands derived from the input PATH."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="units",
                    type="select",
                    default="mm",
                    options=["mm", "inch"],
                    description=(
                        "Output unit system encoded into the G-code program: `mm` emits G21, `inch` emits G20. "
                        "Most hobby plotter protocols operate in millimeters."
                    ),
                ),
                ParameterDefinition(
                    name="coordinate_mode",
                    type="select",
                    default="absolute",
                    options=["absolute", "relative"],
                    description=(
                        "Coordinate encoding protocol: `absolute` (G90) routes each X/Y as a workspace position; "
                        "`relative` (G91) routes each X/Y as an offset from the current position."
                    ),
                ),
                ParameterDefinition(
                    name="cut_feedrate",
                    type="number",
                    default=1200.0,
                    min=0.0,
                    max=200000.0,
                    step=1.0,
                    description=(
                        "Default speed for cutting/drawing moves, in output units/min. "
                        "Applied to G1, G2, and G3 commands; 1200 mm/min is a reasonable starting point for most pen plotter protocols."
                    ),
                ),
                ParameterDefinition(
                    name="travel_feedrate",
                    type="number",
                    default=3000.0,
                    min=0.0,
                    max=200000.0,
                    step=1.0,
                    description=(
                        "Speed for non-cut reposition moves between paths, in output units/min. "
                        "Typically higher than cut feedrate — the tool is off during transit."
                    ),
                ),
                ParameterDefinition(
                    name="use_segment_speed",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, the node reads per-segment `meta.speed` from upstream PATH data and applies it per segment. "
                        "Falls back to `cut_feedrate` when no segment speed is present."
                    ),
                ),
                ParameterDefinition(
                    name="emit_arcs",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, valid arc segments are encoded as `G2`/`G3` circular interpolation commands. "
                        "When disabled, all arcs are linearized into `G1` segments."
                    ),
                ),
                ParameterDefinition(
                    name="arc_linearization_tolerance",
                    type="number",
                    default=0.05,
                    min=0.0001,
                    max=100.0,
                    step=0.0001,
                    description=(
                        "Maximum geometric error (in output units) when an arc is flattened to `G1` segments. "
                        "Smaller values produce more segments and smoother curves; larger values reduce segment count at the cost of fidelity."
                    ),
                ),
                ParameterDefinition(
                    name="auto_close_paths",
                    type="boolean",
                    default=True,
                    description=(
                        "When a path is flagged closed but its end position does not match its start, appends a closing line to complete the loop. "
                        "Prevents open-gap artifacts in closed-contour output."
                    ),
                ),
                ParameterDefinition(
                    name="coordinate_precision",
                    type="number",
                    default=3,
                    min=0,
                    max=10,
                    step=1,
                    description=(
                        "Decimal digits encoded into coordinate and feedrate values. "
                        "Higher precision preserves fine geometry; lower precision yields smaller output files but may round away small details."
                    ),
                ),
                ParameterDefinition(
                    name="header_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code block injected at program start, before all generated motion. "
                        "Use for machine setup, homing sequences, or coordinate system initialization."
                    ),
                ),
                ParameterDefinition(
                    name="tool_on_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code block injected before each cutting path. "
                        "Typical use: pen down, laser on, spindle start."
                    ),
                ),
                ParameterDefinition(
                    name="tool_off_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code block injected after each cutting path completes. "
                        "Typical use: pen up, laser off, spindle stop."
                    ),
                ),
                ParameterDefinition(
                    name="footer_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code block injected at program end, after all generated motion. "
                        "Use for park moves, motor disable, or safe machine shutdown."
                    ),
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        raw_paths = inputs.get("path")
        if not isinstance(raw_paths, list):
            raise ValueError("Input 'path' must be a list of path objects")

        units = str(params.get("units", "mm")).strip().lower()
        if units not in {"mm", "inch"}:
            raise ValueError("Parameter 'units' must be 'mm' or 'inch'")

        coordinate_mode = str(params.get("coordinate_mode", "absolute")).strip().lower()
        if coordinate_mode not in {"absolute", "relative"}:
            raise ValueError("Parameter 'coordinate_mode' must be 'absolute' or 'relative'")

        precision = int(params.get("coordinate_precision", 3))
        precision = min(max(precision, 0), 10)

        emit_arcs = bool(params.get("emit_arcs", True))
        auto_close_paths = bool(params.get("auto_close_paths", True))
        use_segment_speed = bool(params.get("use_segment_speed", True))
        cut_feedrate = float(params.get("cut_feedrate", 1200.0))
        travel_feedrate = float(params.get("travel_feedrate", 3000.0))
        arc_tolerance = max(float(params.get("arc_linearization_tolerance", 0.05)), 0.0001)

        paths = _normalize_paths(raw_paths, auto_close_paths=auto_close_paths)
        unit_scale = 1.0 if units == "mm" else 1.0 / 25.4
        absolute_mode = coordinate_mode == "absolute"

        lines: list[str] = []
        current_position = [0.0, 0.0]
        current_feed: float | None = None
        tool_active = False

        def append_sequence(sequence: str) -> None:
            nonlocal current_feed
            sequence_lines = _split_sequence(sequence)
            if not sequence_lines:
                return
            lines.extend(sequence_lines)
            current_feed = None

        def emit_tool_on() -> None:
            nonlocal tool_active
            if tool_active:
                return
            append_sequence(str(params.get("tool_on_sequence", "")))
            tool_active = True

        def emit_tool_off() -> None:
            nonlocal tool_active
            if not tool_active:
                return
            append_sequence(str(params.get("tool_off_sequence", "")))
            tool_active = False

        append_sequence(str(params.get("header_sequence", "")))
        lines.append("G17")
        lines.append("G21" if units == "mm" else "G20")
        lines.append("G90" if absolute_mode else "G91")

        for path_obj in paths:
            segments = path_obj["segments"]
            if not segments:
                continue

            start_point = _scale_point(segments[0]["from"], unit_scale)
            travel_line, current_feed = _build_linear_move(
                command="G0",
                target=start_point,
                current_position=current_position,
                absolute_mode=absolute_mode,
                feedrate=travel_feedrate,
                current_feed=current_feed,
                precision=precision,
            )
            if travel_line is not None:
                lines.append(travel_line)
            current_position = [start_point[0], start_point[1]]

            emit_tool_on()

            for segment in segments:
                seg_start = _scale_point(segment["from"], unit_scale)
                if not _points_close(current_position, seg_start):
                    emit_tool_off()
                    travel_line, current_feed = _build_linear_move(
                        command="G0",
                        target=seg_start,
                        current_position=current_position,
                        absolute_mode=absolute_mode,
                        feedrate=travel_feedrate,
                        current_feed=current_feed,
                        precision=precision,
                    )
                    if travel_line is not None:
                        lines.append(travel_line)
                    current_position = [seg_start[0], seg_start[1]]
                    emit_tool_on()

                segment_feed = cut_feedrate
                segment_speed = (segment.get("meta") or {}).get("speed")
                if use_segment_speed and segment_speed is not None:
                    segment_feed = float(segment_speed)

                emitted_lines, current_position, current_feed = _emit_segment(
                    segment=segment,
                    current_position=current_position,
                    current_feed=current_feed,
                    absolute_mode=absolute_mode,
                    unit_scale=unit_scale,
                    emit_arcs=emit_arcs,
                    arc_tolerance=arc_tolerance,
                    feedrate=segment_feed,
                    precision=precision,
                )
                lines.extend(emitted_lines)

            emit_tool_off()

        append_sequence(str(params.get("footer_sequence", "")))
        return {"gcode": "\n".join(lines)}


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
    """Normalise per-segment meta, defaulting missing values to None."""
    if meta is None:
        return dict(DEFAULT_SEGMENT_META)
    if not isinstance(meta, dict):
        raise ValueError("Segment 'meta' must be an object or null")
    width = meta.get("width")
    speed = meta.get("speed")
    return {
        "width": float(width) if width is not None else None,
        "speed": float(speed) if speed is not None else None,
    }



def _normalize_segment(seg: object, path_i: int, seg_j: int) -> dict[str, Any]:
    """Validate and normalise one segment into canonical PATH structure."""
    ctx = f"path[{path_i}].segments[{seg_j}]"
    if not isinstance(seg, dict):
        raise ValueError(f"{ctx} must be an object")

    seg_type = seg.get("type")
    if seg_type not in {"line", "arc"}:
        raise ValueError(f"{ctx}.type must be 'line' or 'arc'")

    from_pt = _parse_xy(seg.get("from"), f"{ctx}.from")
    to_pt = _parse_xy(seg.get("to"), f"{ctx}.to")
    normalized: dict[str, Any] = {
        "type": seg_type,
        "from": from_pt,
        "to": to_pt,
        "meta": _parse_meta(seg.get("meta")),
    }

    if seg_type == "arc":
        normalized["center"] = _parse_xy(seg.get("center"), f"{ctx}.center")
        clockwise = seg.get("clockwise", True)
        if not isinstance(clockwise, bool):
            raise ValueError(f"{ctx}.clockwise must be a boolean")
        normalized["clockwise"] = clockwise

    return normalized



def _normalize_paths(paths: list[Any], auto_close_paths: bool) -> list[dict[str, Any]]:
    """Validate input PATH objects and optionally enforce closed-path closure."""
    normalized_paths: list[dict[str, Any]] = []

    for path_i, path_obj in enumerate(paths):
        if not isinstance(path_obj, dict):
            raise ValueError(f"path[{path_i}] must be an object")
        segments_raw = path_obj.get("segments")
        if not isinstance(segments_raw, list):
            raise ValueError(f"path[{path_i}].segments must be a list")
        closed = path_obj.get("closed", False)
        if not isinstance(closed, bool):
            raise ValueError(f"path[{path_i}].closed must be a boolean")

        segments = [
            _normalize_segment(segment, path_i, seg_j)
            for seg_j, segment in enumerate(segments_raw)
        ]

        if auto_close_paths and closed and segments:
            first_start = segments[0]["from"]
            last_end = segments[-1]["to"]
            if not _points_close(first_start, last_end):
                segments.append({
                    "type": "line",
                    "from": [last_end[0], last_end[1]],
                    "to": [first_start[0], first_start[1]],
                    "meta": dict(segments[-1].get("meta") or DEFAULT_SEGMENT_META),
                })

        normalized_paths.append({"closed": closed, "segments": segments})

    return normalized_paths


# ---------------------------------------------------------------------------
# G-code emission helpers
# ---------------------------------------------------------------------------


def _split_sequence(sequence: str) -> list[str]:
    """Split a multi-line sequence into non-empty G-code lines."""
    return [line.rstrip() for line in sequence.splitlines() if line.strip()]



def _points_close(a: list[float], b: list[float], tolerance: float = 1e-9) -> bool:
    """Return True when points *a* and *b* are within *tolerance*."""
    return math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance



def _format_number(value: float, precision: int) -> str:
    """Format a numeric G-code word value with trimmed trailing zeros."""
    if abs(value) < 10 ** (-(precision + 2)):
        value = 0.0
    formatted = f"{value:.{precision}f}"
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted or "0"



def _build_linear_move(
    command: str,
    target: list[float],
    current_position: list[float],
    absolute_mode: bool,
    feedrate: float,
    current_feed: float | None,
    precision: int,
) -> tuple[str | None, float | None]:
    """Build a G0 or G1 line and update the modal feedrate if needed."""
    x_word = _axis_word(
        axis="X",
        target_value=target[0],
        current_value=current_position[0],
        absolute_mode=absolute_mode,
        precision=precision,
    )
    y_word = _axis_word(
        axis="Y",
        target_value=target[1],
        current_value=current_position[1],
        absolute_mode=absolute_mode,
        precision=precision,
    )

    words = [command]
    if x_word is not None:
        words.append(x_word)
    if y_word is not None:
        words.append(y_word)

    next_feed = current_feed
    if feedrate > 0 and (current_feed is None or abs(current_feed - feedrate) > 1e-12):
        words.append(f"F{_format_number(feedrate, precision)}")
        next_feed = feedrate

    if len(words) == 1:
        return None, next_feed
    return " ".join(words), next_feed



def _emit_segment(
    segment: dict[str, Any],
    current_position: list[float],
    current_feed: float | None,
    absolute_mode: bool,
    unit_scale: float,
    emit_arcs: bool,
    arc_tolerance: float,
    feedrate: float,
    precision: int,
) -> tuple[list[str], list[float], float | None]:
    """Emit one segment as G1 or G2/G3, flattening arcs when necessary."""
    start = _scale_point(segment["from"], unit_scale)
    end = _scale_point(segment["to"], unit_scale)

    if not _points_close(current_position, start):
        current_position = [start[0], start[1]]

    if segment.get("type") == "arc" and emit_arcs:
        center = _scale_point(segment["center"], unit_scale)
        arc_line, next_feed = _build_arc_move(
            segment=segment,
            current_position=current_position,
            end=end,
            center=center,
            absolute_mode=absolute_mode,
            feedrate=feedrate,
            current_feed=current_feed,
            precision=precision,
            tolerance=arc_tolerance,
        )
        if arc_line is not None:
            return [arc_line], [end[0], end[1]], next_feed

    if segment.get("type") == "arc":
        points = _flatten_arc_points(
            start=start,
            end=end,
            center=_scale_point(segment["center"], unit_scale),
            clockwise=bool(segment.get("clockwise", True)),
            tolerance=arc_tolerance,
        )
    else:
        points = [end]

    emitted: list[str] = []
    next_feed = current_feed
    position = [current_position[0], current_position[1]]
    for point in points:
        line, next_feed = _build_linear_move(
            command="G1",
            target=point,
            current_position=position,
            absolute_mode=absolute_mode,
            feedrate=feedrate,
            current_feed=next_feed,
            precision=precision,
        )
        if line is not None:
            emitted.append(line)
        position = [point[0], point[1]]

    return emitted, position, next_feed



def _build_arc_move(
    segment: dict[str, Any],
    current_position: list[float],
    end: list[float],
    center: list[float],
    absolute_mode: bool,
    feedrate: float,
    current_feed: float | None,
    precision: int,
    tolerance: float,
) -> tuple[str | None, float | None]:
    """Build a G2/G3 line if the arc geometry is valid enough to emit."""
    start = current_position
    radius_start = math.hypot(start[0] - center[0], start[1] - center[1])
    radius_end = math.hypot(end[0] - center[0], end[1] - center[1])
    if radius_start < 1e-9 or radius_end < 1e-9:
        return None, current_feed
    if abs(radius_start - radius_end) > max(tolerance, 1e-6):
        return None, current_feed
    if _points_close(start, end):
        return None, current_feed

    command = "G2" if bool(segment.get("clockwise", True)) else "G3"
    words = [command]

    x_word = _axis_word(
        axis="X",
        target_value=end[0],
        current_value=start[0],
        absolute_mode=absolute_mode,
        precision=precision,
    )
    y_word = _axis_word(
        axis="Y",
        target_value=end[1],
        current_value=start[1],
        absolute_mode=absolute_mode,
        precision=precision,
    )
    if x_word is not None:
        words.append(x_word)
    if y_word is not None:
        words.append(y_word)

    i_offset = center[0] - start[0]
    j_offset = center[1] - start[1]
    words.append(f"I{_format_number(i_offset, precision)}")
    words.append(f"J{_format_number(j_offset, precision)}")

    next_feed = current_feed
    if feedrate > 0 and (current_feed is None or abs(current_feed - feedrate) > 1e-12):
        words.append(f"F{_format_number(feedrate, precision)}")
        next_feed = feedrate

    return " ".join(words), next_feed



def _axis_word(
    axis: str,
    target_value: float,
    current_value: float,
    absolute_mode: bool,
    precision: int,
) -> str | None:
    """Return one axis word or None when no movement is needed on that axis."""
    value = target_value if absolute_mode else target_value - current_value
    if abs(value) <= 1e-12:
        return None
    return f"{axis}{_format_number(value, precision)}"



def _scale_point(point: list[float], unit_scale: float) -> list[float]:
    """Scale a point from canonical mm-space into requested output units."""
    return [point[0] * unit_scale, point[1] * unit_scale]



def _flatten_arc_points(
    start: list[float],
    end: list[float],
    center: list[float],
    clockwise: bool,
    tolerance: float,
) -> list[list[float]]:
    """Approximate an arc with a polyline whose chord error stays within tolerance."""
    radius_start = math.hypot(start[0] - center[0], start[1] - center[1])
    radius_end = math.hypot(end[0] - center[0], end[1] - center[1])
    radius = (radius_start + radius_end) * 0.5
    if radius < 1e-9 or abs(radius_start - radius_end) > max(tolerance, 1e-6):
        return [end]

    start_angle = math.atan2(start[1] - center[1], start[0] - center[0])
    end_angle = math.atan2(end[1] - center[1], end[0] - center[0])
    if clockwise:
        sweep = -((start_angle - end_angle) % (2.0 * math.pi))
    else:
        sweep = (end_angle - start_angle) % (2.0 * math.pi)

    if abs(sweep) < 1e-12:
        return [end]

    effective_tolerance = min(max(tolerance, 1e-6), radius)
    if effective_tolerance >= radius:
        max_angle = math.pi / 2.0
    else:
        max_angle = 2.0 * math.acos(max(-1.0, min(1.0, 1.0 - effective_tolerance / radius)))
        if max_angle < 1e-6:
            max_angle = math.pi / 90.0

    segment_count = max(1, int(math.ceil(abs(sweep) / max_angle)))
    points: list[list[float]] = []
    for index in range(1, segment_count + 1):
        angle = start_angle + sweep * (index / segment_count)
        points.append([
            center[0] + radius * math.cos(angle),
            center[1] + radius * math.sin(angle),
        ])
    points[-1] = [end[0], end[1]]
    return points


Plugin = PathToGCode

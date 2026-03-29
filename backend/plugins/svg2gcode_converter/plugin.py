"""SVG to G-Code node — routes SVG input through the external svg2gcode CLI, compiles a machine program, and emits PATH preview geometry reconstructed from the emitted motion."""

import asyncio
import json
import math
import os
import re
import shutil
import tempfile
from typing import Any

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)

_DEFAULT_SEGMENT_META: dict[str, float | None] = {"width": None, "speed": None}
_WORD_RE = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)")
_PAREN_COMMENT_RE = re.compile(r"\([^)]*\)")


class SVG2GCode(BasePlugin):
    """Execute the svg2gcode external module on an SVG input, compile a G-code program, and reconstruct PATH preview segments from emitted motion commands."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="SVG to G-Code",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="vector",
                    type=PortType.VECTOR,
                    description="SVG XML document to route into the svg2gcode conversion pipeline.",
                ),
            ],
            outputs=[
                PortDefinition(
                    name="gcode",
                    type=PortType.GCODE,
                    description="Compiled G-code program ready to transmit to your plotter or CNC controller.",
                ),
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description="PATH preview reconstructed from emitted motion commands — inspect the toolpath before deploying to hardware.",
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="tolerance",
                    type="number",
                    default=0.002,
                    min=0.000001,
                    max=10.0,
                    step=0.000001,
                    description=(
                        "Curve approximation precision in mm. "
                        "Lower values produce smoother curves with more output segments; "
                        "higher values reduce segment count at the cost of curve fidelity."
                    ),
                ),
                ParameterDefinition(
                    name="feedrate",
                    type="number",
                    default=300.0,
                    min=0.0,
                    max=200000.0,
                    step=1.0,
                    description="Linear move speed in mm/min emitted for all drawing and cutting motion.",
                ),
                ParameterDefinition(
                    name="dpi",
                    type="number",
                    default=96.0,
                    min=1.0,
                    max=10000.0,
                    step=1.0,
                    description=(
                        "SVG unit-to-physical scale in dots per inch. "
                        "Match this to the DPI your SVG was authored at to preserve real-world dimensions."
                    ),
                ),
                ParameterDefinition(
                    name="origin_x_enabled",
                    type="boolean",
                    default=True,
                    description=(
                        "Enable a custom X origin offset. "
                        "Activate to reposition where the job is routed on your machine bed."
                    ),
                ),
                ParameterDefinition(
                    name="origin_x",
                    type="number",
                    default=0.0,
                    min=-1000000.0,
                    max=1000000.0,
                    step=0.001,
                    visible_if={"parameter": "origin_x_enabled", "equals": True},
                    description="X origin coordinate in mm. Active when X origin override is enabled.",
                ),
                ParameterDefinition(
                    name="origin_y_enabled",
                    type="boolean",
                    default=True,
                    description=(
                        "Enable a custom Y origin offset. "
                        "Pair with X origin to align the job to a fixture corner or machine zero."
                    ),
                ),
                ParameterDefinition(
                    name="origin_y",
                    type="number",
                    default=0.0,
                    min=-1000000.0,
                    max=1000000.0,
                    step=0.001,
                    visible_if={"parameter": "origin_y_enabled", "equals": True},
                    description="Y origin coordinate in mm. Active when Y origin override is enabled.",
                ),
                ParameterDefinition(
                    name="extra_attribute_name",
                    type="string",
                    default="",
                    description=(
                        "SVG attribute name for advanced per-element processing overrides. "
                        "Leave empty unless your SVG embeds custom metadata directives."
                    ),
                ),
                ParameterDefinition(
                    name="circular_interpolation",
                    type="boolean",
                    default=False,
                    description=(
                        "Emit native arc commands (`G2`/`G3`) when your controller supports the arc protocol. "
                        "Disabled: arcs are linearized into `G1` segments."
                    ),
                ),
                ParameterDefinition(
                    name="tool_on_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code snippet injected each time the tool activates before a draw or cut move. "
                        "Use for spindle-on, laser-enable, or equivalent controller commands."
                    ),
                ),
                ParameterDefinition(
                    name="tool_off_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code snippet injected each time the tool deactivates after motion. "
                        "Use for spindle-off, laser-disable, or equivalent safe-stop commands."
                    ),
                ),
                ParameterDefinition(
                    name="begin_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code injected at the start of the compiled program. "
                        "Use for machine initialization: units, positioning mode, spindle setup."
                    ),
                ),
                ParameterDefinition(
                    name="end_sequence",
                    type="string",
                    default="",
                    description=(
                        "Raw G-code injected at the end of the compiled program. "
                        "Use for teardown: parking moves, tool shutdown, or safe-state commands."
                    ),
                ),
                ParameterDefinition(
                    name="line_numbers",
                    type="boolean",
                    default=False,
                    description="Prefix each output block with a sequential line number for controllers that require numbered programs.",
                ),
                ParameterDefinition(
                    name="checksums",
                    type="boolean",
                    default=False,
                    description="Append transmission checksums to each line for firmware that validates integrity on receipt.",
                ),
                ParameterDefinition(
                    name="newline_before_comment",
                    type="boolean",
                    default=False,
                    description="Route comments to their own preceding line for cleaner program formatting.",
                ),
                ParameterDefinition(
                    name="settings_version",
                    type="select",
                    default="V5",
                    options=["V5", "V0"],
                    description=(
                        "Settings schema version tag passed to the svg2gcode CLI. "
                        "Must match the protocol version your installed CLI expects."
                    ),
                ),
                ParameterDefinition(
                    name="dimension_width_enabled",
                    type="boolean",
                    default=False,
                    description=(
                        "Enable a physical width override. "
                        "Rescales the output to a target width regardless of original SVG dimensions."
                    ),
                ),
                ParameterDefinition(
                    name="dimension_width",
                    type="number",
                    default=210.0,
                    min=0.0,
                    max=1000000.0,
                    step=0.001,
                    visible_if={"parameter": "dimension_width_enabled", "equals": True},
                    description="Target output width value. Active when width override is enabled.",
                ),
                ParameterDefinition(
                    name="dimension_width_unit",
                    type="select",
                    default="mm",
                    options=["none", "em", "ex", "px", "in", "cm", "mm", "pt", "pc", "percent"],
                    visible_if={"parameter": "dimension_width_enabled", "equals": True},
                    description="Unit for the width override (mm, in, px, percent, etc.).",
                ),
                ParameterDefinition(
                    name="dimension_height_enabled",
                    type="boolean",
                    default=False,
                    description=(
                        "Enable a physical height override. "
                        "Rescales the output to a target height regardless of original SVG dimensions."
                    ),
                ),
                ParameterDefinition(
                    name="dimension_height",
                    type="number",
                    default=297.0,
                    min=0.0,
                    max=1000000.0,
                    step=0.001,
                    visible_if={"parameter": "dimension_height_enabled", "equals": True},
                    description="Target output height value. Active when height override is enabled.",
                ),
                ParameterDefinition(
                    name="dimension_height_unit",
                    type="select",
                    default="mm",
                    options=["none", "em", "ex", "px", "in", "cm", "mm", "pt", "pc", "percent"],
                    visible_if={"parameter": "dimension_height_enabled", "equals": True},
                    description="Unit for the height override (mm, in, px, percent, etc.).",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        svg_data = inputs.get("vector")
        if not isinstance(svg_data, str) or not svg_data.strip():
            raise ValueError("Input 'vector' must be a non-empty SVG string")

        binary = os.getenv("SVG2GCODE_BIN", "svg2gcode")
        if shutil.which(binary) is None:
            raise RuntimeError(
                f"svg2gcode binary '{binary}' not found in PATH. "
                "Install svg2gcode-cli or set SVG2GCODE_BIN to a valid executable."
            )

        settings = self._build_settings(params)
        dimensions = self._build_dimensions_arg(params)

        settings_file = tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".json",
            delete=False,
        )
        try:
            json.dump(settings, settings_file)
            settings_file.flush()
            settings_file.close()

            command = [binary, "--settings", settings_file.name]
            if dimensions is not None:
                command.extend(["--dimensions", dimensions])

            process = await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate(svg_data.encode("utf-8"))
        finally:
            try:
                os.unlink(settings_file.name)
            except OSError:
                pass

        if process.returncode != 0:
            stderr_text = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(
                "svg2gcode conversion failed"
                + (f": {stderr_text}" if stderr_text else "")
            )

        gcode_raw = stdout.decode("utf-8", errors="replace")
        gcode = "\n".join(line.rstrip() for line in gcode_raw.splitlines())
        paths = _gcode_to_paths(gcode)
        return {"gcode": gcode, "path": paths}

    @staticmethod
    def _build_settings(params: dict[str, Any]) -> dict[str, Any]:
        origin_x_enabled = bool(params.get("origin_x_enabled", True))
        origin_y_enabled = bool(params.get("origin_y_enabled", True))

        origin_x = (
            float(params.get("origin_x", 0.0)) if origin_x_enabled else None
        )
        origin_y = (
            float(params.get("origin_y", 0.0)) if origin_y_enabled else None
        )

        extra_attribute_name = str(params.get("extra_attribute_name", "")).strip()

        def _none_if_blank(value: Any) -> str | None:
            text = str(value).strip()
            return text or None

        return {
            "version": str(params.get("settings_version", "V5")),
            "conversion": {
                "tolerance": float(params.get("tolerance", 0.002)),
                "feedrate": float(params.get("feedrate", 300.0)),
                "dpi": float(params.get("dpi", 96.0)),
                "origin": [origin_x, origin_y],
                "extra_attribute_name": extra_attribute_name or None,
            },
            "machine": {
                "supported_functionality": {
                    "circular_interpolation": bool(
                        params.get("circular_interpolation", False)
                    ),
                },
                "tool_on_sequence": _none_if_blank(params.get("tool_on_sequence", "")),
                "tool_off_sequence": _none_if_blank(params.get("tool_off_sequence", "")),
                "begin_sequence": _none_if_blank(params.get("begin_sequence", "")),
                "end_sequence": _none_if_blank(params.get("end_sequence", "")),
            },
            "postprocess": {
                "line_numbers": bool(params.get("line_numbers", False)),
                "checksums": bool(params.get("checksums", False)),
                "newline_before_comment": bool(
                    params.get("newline_before_comment", False)
                ),
            },
        }

    @staticmethod
    def _build_dimensions_arg(params: dict[str, Any]) -> str | None:
        width_enabled = bool(params.get("dimension_width_enabled", False))
        height_enabled = bool(params.get("dimension_height_enabled", False))
        if not width_enabled and not height_enabled:
            return None

        width = ""
        height = ""

        if width_enabled:
            width = _format_length(
                float(params.get("dimension_width", 210.0)),
                str(params.get("dimension_width_unit", "mm")),
            )
        if height_enabled:
            height = _format_length(
                float(params.get("dimension_height", 297.0)),
                str(params.get("dimension_height_unit", "mm")),
            )

        return f"{width},{height}"


def _format_length(value: float, unit: str) -> str:
    unit_normalized = unit.lower().strip()
    if unit_normalized == "none":
        suffix = ""
    elif unit_normalized == "percent":
        suffix = "%"
    elif unit_normalized in {"em", "ex", "px", "in", "cm", "mm", "pt", "pc"}:
        suffix = unit_normalized
    else:
        raise ValueError(f"Unsupported dimensions unit: {unit}")
    return f"{value:g}{suffix}"


def _strip_inline_comments(line: str) -> str:
    """Remove semicolon and parenthesized comments from a single G-code line."""
    no_paren = _PAREN_COMMENT_RE.sub("", line)
    return no_paren.split(";", 1)[0].strip()


def _gcode_to_paths(gcode: str) -> list[dict[str, Any]]:
    """Parse G0/G1/G2/G3 motions into canonical PATH objects."""
    paths: list[dict[str, Any]] = []
    current_segments: list[dict[str, Any]] = []

    current_x = 0.0
    current_y = 0.0
    absolute_mode = True
    unit_scale = 1.0
    motion_mode = 0

    def flush_path() -> None:
        if current_segments:
            paths.append({"closed": False, "segments": list(current_segments)})
            current_segments.clear()

    for raw_line in gcode.splitlines():
        line = _strip_inline_comments(raw_line)
        if not line:
            continue

        words = [
            (match.group(1).upper(), float(match.group(2)))
            for match in _WORD_RE.finditer(line)
        ]
        if not words:
            continue

        g_codes = [int(round(value)) for letter, value in words if letter == "G"]
        for code in g_codes:
            if code == 20:
                unit_scale = 25.4
            elif code == 21:
                unit_scale = 1.0
            elif code == 90:
                absolute_mode = True
            elif code == 91:
                absolute_mode = False
            elif code in (0, 1, 2, 3):
                motion_mode = code

        has_x = any(letter == "X" for letter, _ in words)
        has_y = any(letter == "Y" for letter, _ in words)
        has_i = any(letter == "I" for letter, _ in words)
        has_j = any(letter == "J" for letter, _ in words)
        has_r = any(letter == "R" for letter, _ in words)

        if motion_mode not in (0, 1, 2, 3):
            continue
        if motion_mode in (0, 1) and (not has_x and not has_y):
            continue
        if motion_mode in (2, 3) and (not has_x and not has_y and not has_i and not has_j and not has_r):
            continue

        raw_x = next((value for letter, value in words if letter == "X"), None)
        raw_y = next((value for letter, value in words if letter == "Y"), None)

        target_x = current_x
        target_y = current_y
        if raw_x is not None:
            value = raw_x * unit_scale
            target_x = value if absolute_mode else current_x + value
        if raw_y is not None:
            value = raw_y * unit_scale
            target_y = value if absolute_mode else current_y + value

        if motion_mode == 0:
            flush_path()
            current_x, current_y = target_x, target_y
            continue

        if abs(target_x - current_x) < 1e-12 and abs(target_y - current_y) < 1e-12:
            continue

        if motion_mode == 1:
            current_segments.append(
                {
                    "type": "line",
                    "from": [current_x, current_y],
                    "to": [target_x, target_y],
                    "meta": dict(_DEFAULT_SEGMENT_META),
                }
            )
        else:
            raw_i = next((value for letter, value in words if letter == "I"), None)
            raw_j = next((value for letter, value in words if letter == "J"), None)
            raw_r = next((value for letter, value in words if letter == "R"), None)

            center: tuple[float, float] | None = None
            if raw_i is not None and raw_j is not None:
                center = (current_x + raw_i * unit_scale, current_y + raw_j * unit_scale)
            elif raw_r is not None:
                center = _center_from_radius_arc(
                    x0=current_x,
                    y0=current_y,
                    x1=target_x,
                    y1=target_y,
                    radius=raw_r * unit_scale,
                    clockwise=motion_mode == 2,
                )

            if center is None:
                current_segments.append(
                    {
                        "type": "line",
                        "from": [current_x, current_y],
                        "to": [target_x, target_y],
                        "meta": dict(_DEFAULT_SEGMENT_META),
                    }
                )
            else:
                current_segments.append(
                    {
                        "type": "arc",
                        "from": [current_x, current_y],
                        "to": [target_x, target_y],
                        "center": [center[0], center[1]],
                        "clockwise": motion_mode == 2,
                        "meta": dict(_DEFAULT_SEGMENT_META),
                    }
                )

        current_x, current_y = target_x, target_y

    flush_path()
    return paths


def _center_from_radius_arc(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    radius: float,
    clockwise: bool,
) -> tuple[float, float] | None:
    """Compute arc center from G2/G3 R-parameter form.

    Returns None when the geometry is degenerate/invalid.
    """
    dx = x1 - x0
    dy = y1 - y0
    chord = math.hypot(dx, dy)
    if chord < 1e-12:
        return None

    r_abs = abs(radius)
    half = chord * 0.5
    if r_abs < half:
        return None

    mx = (x0 + x1) * 0.5
    my = (y0 + y1) * 0.5
    ux = -dy / chord
    uy = dx / chord

    h_sq = max(r_abs * r_abs - half * half, 0.0)
    h = math.sqrt(h_sq)

    candidates = [
        (mx + ux * h, my + uy * h),
        (mx - ux * h, my - uy * h),
    ]

    prefer_major = radius < 0.0
    best: tuple[float, float] | None = None
    best_score = -1.0

    for cx, cy in candidates:
        a0 = math.atan2(y0 - cy, x0 - cx)
        a1 = math.atan2(y1 - cy, x1 - cx)
        if clockwise:
            sweep = (a0 - a1) % (2.0 * math.pi)
        else:
            sweep = (a1 - a0) % (2.0 * math.pi)

        if sweep < 1e-12:
            continue

        is_major = sweep > math.pi
        score = 2.0 if is_major == prefer_major else 1.0
        if score > best_score:
            best_score = score
            best = (cx, cy)

    return best


Plugin = SVG2GCode

"""VectorToPath plugin – converts all geometric content in an SVG document
into internal PATH-format line segments, flattening curves, arcs, and
optionally text outlines into plotter-ready polylines.
"""

import logging
import math
import re
import xml.etree.ElementTree as ET
from typing import Any

import numpy as np

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)

# ---------------------------------------------------------------------------
# SVG namespace helpers
# ---------------------------------------------------------------------------

_SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")

_logger = logging.getLogger(__name__)
_DEFAULT_SEGMENT_META: dict[str, float | None] = {"width": None, "speed": None}

# ---------------------------------------------------------------------------
# Regex helpers for SVG path data tokenising
# ---------------------------------------------------------------------------

_CMD_RE = re.compile(r"([MmZzLlHhVvCcSsQqTtAa])")
_NUM_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")


def _strip_ns(tag: str) -> str:
    """Strip XML namespace prefix from *tag*, e.g. ``{http://…}rect`` → ``rect``."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


# ---------------------------------------------------------------------------
# Affine transform helpers (3×3 matrices stored as 2×3 flat: a,b,c,d,e,f)
# ---------------------------------------------------------------------------

def _identity() -> np.ndarray:
    """Return a 3×3 identity matrix as a float64 ndarray."""
    return np.eye(3, dtype=np.float64)


def _parse_transform(attr: str) -> np.ndarray:
    """Parse an SVG ``transform`` attribute value into a combined 3×3 matrix.

    Supports ``translate``, ``scale``, ``rotate``, and ``matrix``.
    Multiple transform functions are applied left-to-right (per SVG spec).
    """
    mat = _identity()
    # Match individual transform functions
    func_re = re.compile(
        r"(translate|scale|rotate|matrix|skewX|skewY)\s*\(([^)]*)\)", re.IGNORECASE
    )
    for match in func_re.finditer(attr):
        name = match.group(1).lower()
        args = [float(v) for v in _NUM_RE.findall(match.group(2))]
        t = _identity()
        if name == "translate":
            tx = args[0] if len(args) > 0 else 0.0
            ty = args[1] if len(args) > 1 else 0.0
            t[0, 2] = tx
            t[1, 2] = ty
        elif name == "scale":
            sx = args[0] if len(args) > 0 else 1.0
            sy = args[1] if len(args) > 1 else sx
            t[0, 0] = sx
            t[1, 1] = sy
        elif name == "rotate":
            angle_deg = args[0] if len(args) > 0 else 0.0
            angle = math.radians(angle_deg)
            cos_a = math.cos(angle)
            sin_a = math.sin(angle)
            if len(args) >= 3:
                cx, cy = args[1], args[2]
                # rotate(a, cx, cy) = translate(cx,cy) · rotate(a) · translate(-cx,-cy)
                t[0, 0] = cos_a
                t[0, 1] = -sin_a
                t[0, 2] = cx - cos_a * cx + sin_a * cy
                t[1, 0] = sin_a
                t[1, 1] = cos_a
                t[1, 2] = cy - sin_a * cx - cos_a * cy
            else:
                t[0, 0] = cos_a
                t[0, 1] = -sin_a
                t[1, 0] = sin_a
                t[1, 1] = cos_a
        elif name == "matrix":
            if len(args) >= 6:
                a, b, c, d, e, f = args[:6]
                t[0, 0] = a
                t[1, 0] = b
                t[0, 1] = c
                t[1, 1] = d
                t[0, 2] = e
                t[1, 2] = f
        elif name == "skewx":
            if args:
                t[0, 1] = math.tan(math.radians(args[0]))
        elif name == "skewy":
            if args:
                t[1, 0] = math.tan(math.radians(args[0]))
        mat = mat @ t
    return mat


def _apply_transform(mat: np.ndarray, x: float, y: float) -> tuple[float, float]:
    """Apply an affine 3×3 *mat* to point (x, y) → (x', y')."""
    xp = mat[0, 0] * x + mat[0, 1] * y + mat[0, 2]
    yp = mat[1, 0] * x + mat[1, 1] * y + mat[1, 2]
    return (xp, yp)


def _apply_transform_points(
    mat: np.ndarray, points: list[list[float]]
) -> list[list[float]]:
    """Apply affine matrix to a list of [x, y] points."""
    return [list(_apply_transform(mat, p[0], p[1])) for p in points]


def _is_similarity_transform(mat: np.ndarray, tol: float = 1e-6) -> bool:
    """Return True if *mat* preserves circles (uniform scale + rotation/reflection)."""
    vx = np.array([mat[0, 0], mat[1, 0]], dtype=np.float64)
    vy = np.array([mat[0, 1], mat[1, 1]], dtype=np.float64)
    nx = float(np.linalg.norm(vx))
    ny = float(np.linalg.norm(vy))
    if nx < tol or ny < tol:
        return False
    return abs(np.dot(vx, vy)) <= tol and abs(nx - ny) <= tol


def _apply_transform_segments(
    mat: np.ndarray, segments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Apply affine matrix to segment geometry.

    Arc segments are kept only for similarity transforms; otherwise they are
    downgraded to lines to avoid invalid circular-arc representation.
    """
    keep_arc = _is_similarity_transform(mat)
    det = mat[0, 0] * mat[1, 1] - mat[0, 1] * mat[1, 0]

    transformed: list[dict[str, Any]] = []
    for seg in segments:
        meta = dict(seg.get("meta") or _DEFAULT_SEGMENT_META)
        p_from = list(_apply_transform(mat, seg["from"][0], seg["from"][1]))
        p_to = list(_apply_transform(mat, seg["to"][0], seg["to"][1]))

        if seg.get("type") == "arc" and keep_arc and "center" in seg:
            center = list(_apply_transform(mat, seg["center"][0], seg["center"][1]))
            clockwise = bool(seg.get("clockwise", True))
            if det < 0:
                clockwise = not clockwise
            transformed.append({
                "type": "arc",
                "from": p_from,
                "to": p_to,
                "center": center,
                "clockwise": clockwise,
                "meta": meta,
            })
            continue

        transformed.append({
            "type": "line",
            "from": p_from,
            "to": p_to,
            "meta": meta,
        })

    return transformed


# ---------------------------------------------------------------------------
# Bezier flattening
# ---------------------------------------------------------------------------

def _flatten_cubic(
    p0: list[float],
    p1: list[float],
    p2: list[float],
    p3: list[float],
    tolerance: float,
    result: list[list[float]],
) -> None:
    """Recursively subdivide a cubic Bézier until it is flat within *tolerance*.

    Appends intermediate and final points to *result* (does NOT append *p0*).
    """
    # Check flatness: max distance from control points to the line p0→p3
    dx = p3[0] - p0[0]
    dy = p3[1] - p0[1]
    line_len_sq = dx * dx + dy * dy

    if line_len_sq < 1e-12:
        # Degenerate: start ≈ end → check distance from controls to p0
        d1 = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        d2 = math.hypot(p2[0] - p0[0], p2[1] - p0[1])
        max_dev = max(d1, d2)
    else:
        inv_len = 1.0 / math.sqrt(line_len_sq)
        # Signed distance from p1 to line p0→p3
        d1 = abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) * inv_len
        d2 = abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) * inv_len
        max_dev = max(d1, d2)

    if max_dev <= tolerance:
        result.append(p3[:])
        return

    # De Casteljau split at t = 0.5
    m01 = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]
    m12 = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]
    m23 = [(p2[0] + p3[0]) * 0.5, (p2[1] + p3[1]) * 0.5]
    m012 = [(m01[0] + m12[0]) * 0.5, (m01[1] + m12[1]) * 0.5]
    m123 = [(m12[0] + m23[0]) * 0.5, (m12[1] + m23[1]) * 0.5]
    mid = [(m012[0] + m123[0]) * 0.5, (m012[1] + m123[1]) * 0.5]

    _flatten_cubic(p0, m01, m012, mid, tolerance, result)
    _flatten_cubic(mid, m123, m23, p3, tolerance, result)


def _flatten_quadratic(
    p0: list[float],
    p1: list[float],
    p2: list[float],
    tolerance: float,
    result: list[list[float]],
) -> None:
    """Recursively subdivide a quadratic Bézier until flat within *tolerance*.

    Appends intermediate and final points to *result* (does NOT append *p0*).
    """
    dx = p2[0] - p0[0]
    dy = p2[1] - p0[1]
    line_len_sq = dx * dx + dy * dy

    if line_len_sq < 1e-12:
        d1 = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        max_dev = d1
    else:
        inv_len = 1.0 / math.sqrt(line_len_sq)
        max_dev = abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) * inv_len

    if max_dev <= tolerance:
        result.append(p2[:])
        return

    # De Casteljau split at t = 0.5
    m01 = [(p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5]
    m12 = [(p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5]
    mid = [(m01[0] + m12[0]) * 0.5, (m01[1] + m12[1]) * 0.5]

    _flatten_quadratic(p0, m01, mid, tolerance, result)
    _flatten_quadratic(mid, m12, p2, tolerance, result)


# ---------------------------------------------------------------------------
# SVG arc → line segments
# ---------------------------------------------------------------------------

def _arc_to_points(
    x0: float,
    y0: float,
    rx: float,
    ry: float,
    x_rotation_deg: float,
    large_arc: bool,
    sweep: bool,
    x1: float,
    y1: float,
    arc_segments: int,
) -> list[list[float]]:
    """Convert an SVG-style arc command to a list of [x, y] points.

    Returns points along the elliptical arc (excluding the start point).
    Uses centre-parameterisation per the SVG spec.
    """
    # Handle degenerate cases
    if (abs(x1 - x0) < 1e-10 and abs(y1 - y0) < 1e-10) or rx < 1e-10 or ry < 1e-10:
        return [[x1, y1]]

    rx, ry = abs(rx), abs(ry)
    phi = math.radians(x_rotation_deg)
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)

    # Step 1: Compute (x1', y1') in rotated coordinate system
    dx2 = (x0 - x1) / 2.0
    dy2 = (y0 - y1) / 2.0
    x1p = cos_phi * dx2 + sin_phi * dy2
    y1p = -sin_phi * dx2 + cos_phi * dy2

    # Step 2: Ensure radii are large enough
    x1p_sq = x1p * x1p
    y1p_sq = y1p * y1p
    rx_sq = rx * rx
    ry_sq = ry * ry
    radii_check = x1p_sq / rx_sq + y1p_sq / ry_sq
    if radii_check > 1.0:
        scale = math.sqrt(radii_check)
        rx *= scale
        ry *= scale
        rx_sq = rx * rx
        ry_sq = ry * ry

    # Step 3: Compute centre point (cx', cy') in rotated system
    num = max(rx_sq * ry_sq - rx_sq * y1p_sq - ry_sq * x1p_sq, 0.0)
    den = rx_sq * y1p_sq + ry_sq * x1p_sq
    sq = math.sqrt(num / den) if den > 1e-12 else 0.0
    if large_arc == sweep:
        sq = -sq
    cxp = sq * rx * y1p / ry
    cyp = -sq * ry * x1p / rx

    # Step 4: Compute centre (cx, cy) in original coordinates
    cx = cos_phi * cxp - sin_phi * cyp + (x0 + x1) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (y0 + y1) / 2.0

    # Step 5: Compute start and sweep angles
    def _angle(ux: float, uy: float, vx: float, vy: float) -> float:
        dot = ux * vx + uy * vy
        length = math.sqrt(ux * ux + uy * uy) * math.sqrt(vx * vx + vy * vy)
        cos_val = max(-1.0, min(1.0, dot / length)) if length > 1e-12 else 1.0
        ang = math.acos(cos_val)
        if ux * vy - uy * vx < 0:
            ang = -ang
        return ang

    theta1 = _angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = _angle(
        (x1p - cxp) / rx, (y1p - cyp) / ry,
        (-x1p - cxp) / rx, (-y1p - cyp) / ry,
    )

    if not sweep and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep and dtheta < 0:
        dtheta += 2 * math.pi

    # Step 6: Generate points along the arc
    n = max(arc_segments, 2)
    points: list[list[float]] = []
    for i in range(1, n + 1):
        t = i / n
        angle = theta1 + dtheta * t
        xa = rx * math.cos(angle)
        ya = ry * math.sin(angle)
        x_out = cos_phi * xa - sin_phi * ya + cx
        y_out = sin_phi * xa + cos_phi * ya + cy
        points.append([x_out, y_out])

    return points


def _arc_center_parameterization(
    x0: float,
    y0: float,
    rx: float,
    ry: float,
    x_rotation_deg: float,
    large_arc: bool,
    sweep: bool,
    x1: float,
    y1: float,
) -> tuple[float, float, float, float, float, float, float] | None:
    """Return SVG arc center-form parameters or None for degenerate input."""
    if (abs(x1 - x0) < 1e-10 and abs(y1 - y0) < 1e-10) or rx < 1e-10 or ry < 1e-10:
        return None

    rx, ry = abs(rx), abs(ry)
    phi = math.radians(x_rotation_deg)
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)

    dx2 = (x0 - x1) / 2.0
    dy2 = (y0 - y1) / 2.0
    x1p = cos_phi * dx2 + sin_phi * dy2
    y1p = -sin_phi * dx2 + cos_phi * dy2

    x1p_sq = x1p * x1p
    y1p_sq = y1p * y1p
    rx_sq = rx * rx
    ry_sq = ry * ry
    radii_check = x1p_sq / rx_sq + y1p_sq / ry_sq
    if radii_check > 1.0:
        scale = math.sqrt(radii_check)
        rx *= scale
        ry *= scale
        rx_sq = rx * rx
        ry_sq = ry * ry

    num = max(rx_sq * ry_sq - rx_sq * y1p_sq - ry_sq * x1p_sq, 0.0)
    den = rx_sq * y1p_sq + ry_sq * x1p_sq
    sq = math.sqrt(num / den) if den > 1e-12 else 0.0
    if large_arc == sweep:
        sq = -sq
    cxp = sq * rx * y1p / ry
    cyp = -sq * ry * x1p / rx

    cx = cos_phi * cxp - sin_phi * cyp + (x0 + x1) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (y0 + y1) / 2.0

    def _angle(ux: float, uy: float, vx: float, vy: float) -> float:
        dot = ux * vx + uy * vy
        length = math.sqrt(ux * ux + uy * uy) * math.sqrt(vx * vx + vy * vy)
        cos_val = max(-1.0, min(1.0, dot / length)) if length > 1e-12 else 1.0
        ang = math.acos(cos_val)
        if ux * vy - uy * vx < 0:
            ang = -ang
        return ang

    theta1 = _angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = _angle(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    )
    if not sweep and dtheta > 0:
        dtheta -= 2 * math.pi
    elif sweep and dtheta < 0:
        dtheta += 2 * math.pi

    return cx, cy, theta1, dtheta, rx, ry, phi


def _arc_command_to_segments(
    x0: float,
    y0: float,
    rx: float,
    ry: float,
    x_rotation_deg: float,
    large_arc: bool,
    sweep: bool,
    x1: float,
    y1: float,
    arc_segments: int,
    segment_meta: dict[str, Any],
) -> list[dict[str, Any]]:
    """Convert one SVG A/a command to arc segments (or line fallback)."""
    params = _arc_center_parameterization(
        x0, y0, rx, ry, x_rotation_deg, large_arc, sweep, x1, y1
    )
    if params is None:
        return [{
            "type": "line",
            "from": [x0, y0],
            "to": [x1, y1],
            "meta": dict(segment_meta),
        }]

    cx, cy, theta1, dtheta, rx_adj, ry_adj, phi = params
    is_circular = abs(rx_adj - ry_adj) <= 1e-6

    if is_circular:
        steps = max(1, int(math.ceil(abs(dtheta) / math.pi)))
        result: list[dict[str, Any]] = []
        prev = [x0, y0]
        clockwise = dtheta < 0
        cos_phi = math.cos(phi)
        sin_phi = math.sin(phi)
        for i in range(1, steps + 1):
            if i == steps:
                p_to = [x1, y1]
            else:
                t = theta1 + dtheta * i / steps
                xa = rx_adj * math.cos(t)
                ya = ry_adj * math.sin(t)
                p_to = [
                    cos_phi * xa - sin_phi * ya + cx,
                    sin_phi * xa + cos_phi * ya + cy,
                ]
            result.append({
                "type": "arc",
                "from": prev,
                "to": p_to,
                "center": [cx, cy],
                "clockwise": clockwise,
                "meta": dict(segment_meta),
            })
            prev = p_to
        return result

    points = _arc_to_points(
        x0, y0, rx, ry, x_rotation_deg, large_arc, sweep, x1, y1, arc_segments
    )
    result = []
    prev = [x0, y0]
    for pt in points:
        result.append({
            "type": "line",
            "from": prev,
            "to": pt,
            "meta": dict(segment_meta),
        })
        prev = pt
    return result


# ---------------------------------------------------------------------------
# SVG path ``d`` attribute parser
# ---------------------------------------------------------------------------

def _parse_path_d(
    d_attr: str,
    tolerance: float,
    arc_segments: int,
    segment_meta: dict[str, Any] | None = None,
) -> list[dict]:
    """Parse an SVG path ``d`` attribute and return a list of sub-paths.

    Each sub-path is a dict: ``{"segments": [...], "closed": bool}``.
    Béziers are flattened to line segments. Circular arcs are emitted as
    arc segments where representable; non-circular arcs are line-flattened.
    """
    # Tokenise: split into alternating commands and number groups
    parts = _CMD_RE.split(d_attr)
    tokens: list[str | float] = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if _CMD_RE.fullmatch(part):
            tokens.append(part)
        else:
            for num_str in _NUM_RE.findall(part):
                tokens.append(float(num_str))

    # Walk through tokens building sub-paths
    seg_meta = dict(segment_meta or _DEFAULT_SEGMENT_META)

    sub_paths: list[dict] = []
    current_segments: list[dict[str, Any]] = []
    cx, cy = 0.0, 0.0  # current point
    sx, sy = 0.0, 0.0  # sub-path start
    last_cmd = ""
    last_ctrl: list[float] | None = None  # for S/s, T/t reflected control

    idx = 0
    while idx < len(tokens):
        token = tokens[idx]

        if isinstance(token, str):
            cmd = token
            idx += 1
        else:
            # Implicit repeat: reuse previous command
            # (M after first point becomes L, m becomes l)
            if last_cmd in ("M", "m"):
                cmd = "L" if last_cmd == "M" else "l"
            else:
                cmd = last_cmd

        def _nums(count: int) -> list[float]:
            """Consume *count* numbers from *tokens* starting at current *idx*."""
            nonlocal idx
            result = []
            for _ in range(count):
                if idx < len(tokens) and isinstance(tokens[idx], (int, float)):
                    result.append(float(tokens[idx]))
                    idx += 1
                else:
                    break
            return result

        def _append_line(nx: float, ny: float) -> None:
            nonlocal cx, cy
            current_segments.append({
                "type": "line",
                "from": [cx, cy],
                "to": [nx, ny],
                "meta": dict(seg_meta),
            })
            cx, cy = nx, ny

        if cmd in ("M", "m"):
            coords = _nums(2)
            if len(coords) < 2:
                last_cmd = cmd
                continue
            if cmd == "m":
                coords[0] += cx
                coords[1] += cy
            # Start new sub-path: save any existing
            if current_segments:
                sub_paths.append({"segments": current_segments, "closed": False})
            cx, cy = coords[0], coords[1]
            sx, sy = cx, cy
            current_segments = []
            last_ctrl = None
            last_cmd = cmd
            continue

        elif cmd in ("L", "l"):
            coords = _nums(2)
            if len(coords) < 2:
                last_cmd = cmd
                continue
            if cmd == "l":
                coords[0] += cx
                coords[1] += cy
            _append_line(coords[0], coords[1])
            last_ctrl = None

        elif cmd in ("H", "h"):
            coords = _nums(1)
            if not coords:
                last_cmd = cmd
                continue
            x_val = coords[0] + (cx if cmd == "h" else 0.0)
            _append_line(x_val, cy)
            last_ctrl = None

        elif cmd in ("V", "v"):
            coords = _nums(1)
            if not coords:
                last_cmd = cmd
                continue
            y_val = coords[0] + (cy if cmd == "v" else 0.0)
            _append_line(cx, y_val)
            last_ctrl = None

        elif cmd in ("C", "c"):
            coords = _nums(6)
            if len(coords) < 6:
                last_cmd = cmd
                continue
            if cmd == "c":
                for i in (0, 2, 4):
                    coords[i] += cx
                for i in (1, 3, 5):
                    coords[i] += cy
            p0 = [cx, cy]
            p1 = [coords[0], coords[1]]
            p2 = [coords[2], coords[3]]
            p3 = [coords[4], coords[5]]
            flat: list[list[float]] = []
            _flatten_cubic(p0, p1, p2, p3, tolerance, flat)
            for pt in flat:
                _append_line(pt[0], pt[1])
            cx, cy = p3[0], p3[1]
            last_ctrl = [p2[0], p2[1]]

        elif cmd in ("S", "s"):
            coords = _nums(4)
            if len(coords) < 4:
                last_cmd = cmd
                continue
            if cmd == "s":
                for i in (0, 2):
                    coords[i] += cx
                for i in (1, 3):
                    coords[i] += cy
            # Reflected control point
            if last_ctrl is not None and last_cmd in ("C", "c", "S", "s"):
                p1 = [2 * cx - last_ctrl[0], 2 * cy - last_ctrl[1]]
            else:
                p1 = [cx, cy]
            p0 = [cx, cy]
            p2 = [coords[0], coords[1]]
            p3 = [coords[2], coords[3]]
            flat = []
            _flatten_cubic(p0, p1, p2, p3, tolerance, flat)
            for pt in flat:
                _append_line(pt[0], pt[1])
            cx, cy = p3[0], p3[1]
            last_ctrl = [p2[0], p2[1]]

        elif cmd in ("Q", "q"):
            coords = _nums(4)
            if len(coords) < 4:
                last_cmd = cmd
                continue
            if cmd == "q":
                for i in (0, 2):
                    coords[i] += cx
                for i in (1, 3):
                    coords[i] += cy
            p0 = [cx, cy]
            p1 = [coords[0], coords[1]]
            p2 = [coords[2], coords[3]]
            flat = []
            _flatten_quadratic(p0, p1, p2, tolerance, flat)
            for pt in flat:
                _append_line(pt[0], pt[1])
            cx, cy = p2[0], p2[1]
            last_ctrl = [p1[0], p1[1]]

        elif cmd in ("T", "t"):
            coords = _nums(2)
            if len(coords) < 2:
                last_cmd = cmd
                continue
            if cmd == "t":
                coords[0] += cx
                coords[1] += cy
            # Reflected control point for quadratic
            if last_ctrl is not None and last_cmd in ("Q", "q", "T", "t"):
                p1 = [2 * cx - last_ctrl[0], 2 * cy - last_ctrl[1]]
            else:
                p1 = [cx, cy]
            p0 = [cx, cy]
            p2 = [coords[0], coords[1]]
            flat = []
            _flatten_quadratic(p0, p1, p2, tolerance, flat)
            for pt in flat:
                _append_line(pt[0], pt[1])
            cx, cy = p2[0], p2[1]
            last_ctrl = [p1[0], p1[1]]

        elif cmd in ("A", "a"):
            coords = _nums(7)
            if len(coords) < 7:
                last_cmd = cmd
                continue
            arc_rx = coords[0]
            arc_ry = coords[1]
            x_rot = coords[2]
            large = bool(coords[3])
            sweep_flag = bool(coords[4])
            ex, ey = coords[5], coords[6]
            if cmd == "a":
                ex += cx
                ey += cy
            arc_segments_list = _arc_command_to_segments(
                cx,
                cy,
                arc_rx,
                arc_ry,
                x_rot,
                large,
                sweep_flag,
                ex,
                ey,
                arc_segments,
                seg_meta,
            )
            current_segments.extend(arc_segments_list)
            cx, cy = ex, ey
            last_ctrl = None

        elif cmd in ("Z", "z"):
            # Close the sub-path
            cx, cy = sx, sy
            if current_segments:
                if abs(current_segments[-1]["to"][0] - sx) > 1e-9 or abs(current_segments[-1]["to"][1] - sy) > 1e-9:
                    current_segments.append({
                        "type": "line",
                        "from": [current_segments[-1]["to"][0], current_segments[-1]["to"][1]],
                        "to": [sx, sy],
                        "meta": dict(seg_meta),
                    })
                sub_paths.append({"segments": current_segments, "closed": True})
                current_segments = []
            last_ctrl = None
            last_cmd = cmd
            continue

        last_cmd = cmd

    # Flush any remaining open sub-path
    if current_segments:
        sub_paths.append({"segments": current_segments, "closed": False})

    return sub_paths


# ---------------------------------------------------------------------------
# SVG points attribute parser (for polyline / polygon)
# ---------------------------------------------------------------------------

def _parse_points_attr(attr: str) -> list[list[float]]:
    """Parse an SVG ``points`` attribute into a list of [x, y]."""
    nums = [float(v) for v in _NUM_RE.findall(attr)]
    points: list[list[float]] = []
    for i in range(0, len(nums) - 1, 2):
        points.append([nums[i], nums[i + 1]])
    return points


# ---------------------------------------------------------------------------
# Visibility check
# ---------------------------------------------------------------------------

def _is_hidden(elem: ET.Element) -> bool:
    """Return True if the element is visually hidden via display/visibility/opacity."""
    # Check direct XML attributes
    if elem.get("display", "").strip().lower() == "none":
        return True
    if elem.get("visibility", "").strip().lower() == "hidden":
        return True
    opacity_str = elem.get("opacity", "").strip()
    if opacity_str == "0":
        return True

    # Check inline style attribute with regex for flexible whitespace
    style = elem.get("style", "")
    if style:
        style_lower = style.lower()
        if re.search(r"display\s*:\s*none", style_lower):
            return True
        if re.search(r"visibility\s*:\s*hidden", style_lower):
            return True
        m = re.search(r"opacity\s*:\s*([0-9.]+)", style_lower)
        if m and float(m.group(1)) == 0:
            return True

    return False


# ---------------------------------------------------------------------------
# Build PATH segments from a points list
# ---------------------------------------------------------------------------

def _points_to_path_obj(
    points: list[list[float]],
    closed: bool,
    segment_meta: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Create a PathObject dict from a sequence of points.

    Returns ``None`` if fewer than 2 points are provided.
    """
    if len(points) < 2:
        return None

    meta = dict(segment_meta or _DEFAULT_SEGMENT_META)
    segments: list[dict[str, Any]] = []
    for i in range(len(points) - 1):
        segments.append({
            "type": "line",
            "from": points[i],
            "to": points[i + 1],
            "meta": dict(meta),
        })

    if closed:
        # Add closing segment back to start
        segments.append({
            "type": "line",
            "from": points[-1],
            "to": points[0],
            "meta": dict(meta),
        })

    return {"segments": segments, "closed": closed}


# ---------------------------------------------------------------------------
# Stroke-to-path helper (uses Shapely)
# ---------------------------------------------------------------------------

def _stroke_to_path_obj(
    points: list[list[float]],
    stroke_width: float,
    closed: bool,
    segment_meta: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Buffer a polyline by *stroke_width*/2 using Shapely and return a PathObject."""
    try:
        from shapely.geometry import LineString, Polygon  # conditional import

        if len(points) < 2:
            return None

        if closed:
            # Ensure the ring is closed for Polygon
            ring = points[:]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            geom = Polygon(ring).buffer(0)  # clean
            if geom.is_empty:
                geom = LineString(points)
        else:
            geom = LineString(points)

        buffered = geom.buffer(stroke_width / 2.0, cap_style="round", join_style="round")

        if buffered.is_empty:
            return None

        # Extract exterior ring coordinates
        coords = list(buffered.exterior.coords)
        path_points = [[c[0], c[1]] for c in coords]
        return _points_to_path_obj(path_points, closed=True, segment_meta=segment_meta)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Stroke width extraction helper
# ---------------------------------------------------------------------------

def _get_stroke_width(elem: ET.Element) -> float:
    """Extract stroke-width from element attributes or inline style.

    Returns 0.0 if no stroke or stroke is ``none``.
    """
    stroke = elem.get("stroke", "").strip().lower()
    style = elem.get("style", "")

    # Check inline style for stroke
    style_stroke = ""
    style_width = ""
    for part in style.split(";"):
        part = part.strip()
        if part.lower().startswith("stroke-width"):
            style_width = part.split(":", 1)[1].strip() if ":" in part else ""
        elif part.lower().startswith("stroke"):
            style_stroke = part.split(":", 1)[1].strip() if ":" in part else ""

    effective_stroke = style_stroke or stroke
    if not effective_stroke or effective_stroke == "none":
        return 0.0

    # Get width
    width_attr = elem.get("stroke-width", "").strip()
    effective_width = style_width or width_attr
    if not effective_width:
        return 1.0  # SVG default

    # Strip units (px, pt, etc.) and parse
    width_nums = _NUM_RE.findall(effective_width)
    if width_nums:
        return float(width_nums[0])
    return 1.0


def _get_segment_meta(elem: ET.Element) -> dict[str, float | None]:
    """Build per-segment metadata from SVG styling information."""
    stroke_width = _get_stroke_width(elem)
    return {
        "width": stroke_width if stroke_width > 0 else None,
        "speed": None,
    }


# ===========================================================================
# VectorToPath plugin
# ===========================================================================

class VectorToPath(BasePlugin):
    """Converts all geometric content in an SVG document into PATH-format
    line segments, flattening curves, arcs, and optionally text outlines
    into plotter-ready polylines."""

    # ------------------------------------------------------------------
    # Schema
    # ------------------------------------------------------------------

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Vector to Path",
            category="Processing",
            description=(
                "Converts all geometric content in an SVG document into internal "
                "PATH-format line segments, flattening curves, arcs, and optionally "
                "text outlines into plotter-ready polylines. Unlike Vector Decompose, "
                "this plugin produces a single unified PATH output rather than "
                "splitting by element type. Ideal as the final conversion step before "
                "G-code generation or path-level optimisation."
            ),
            inputs=[
                PortDefinition(
                    name="vector",
                    type=PortType.VECTOR,
                    description=(
                        "A complete SVG XML string. All geometric elements within "
                        "will be converted to PATH segments."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "All SVG geometry converted to PATH segments. Circular arcs "
                        "are preserved as arc segments when representable, while "
                        "other curves are flattened to polylines. Each discrete "
                        "SVG shape or sub-path becomes its own PathObject."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="flatten_transforms",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, all transform attributes on elements and "
                        "ancestor <g> groups are applied to point coordinates before "
                        "conversion. Disable only if you intend to handle transforms "
                        "separately. Disabling may result in incorrect geometry if "
                        "the SVG uses nested transforms."
                    ),
                ),
                ParameterDefinition(
                    name="curve_tolerance",
                    type="number",
                    default=0.5,
                    min=0.001,
                    max=5.0,
                    step=0.001,
                    description=(
                        "The maximum allowed deviation (in SVG user units) between "
                        "the original Bézier curve and the approximating polyline. "
                        "Lower values produce more segments and higher fidelity."
                    ),
                ),
                ParameterDefinition(
                    name="arc_segments",
                    type="number",
                    default=32,
                    min=4,
                    max=128,
                    step=1,
                    description=(
                        "The number of line segments used to approximate each SVG "
                        "arc command or circle/ellipse element. Higher values yield "
                        "smoother curves."
                    ),
                ),
                ParameterDefinition(
                    name="include_text",
                    type="boolean",
                    default=True,
                    description=(
                        "When enabled, attempts to convert <text> elements to path "
                        "outlines using basic rectangular glyph approximation. When "
                        "disabled, text elements are silently skipped."
                    ),
                ),
                ParameterDefinition(
                    name="include_hidden",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, elements with display:none, visibility:hidden, "
                        "or opacity:0 are processed. By default, hidden elements are "
                        "skipped."
                    ),
                ),
                ParameterDefinition(
                    name="stroke_to_path",
                    type="boolean",
                    default=False,
                    description=(
                        "When enabled, stroked shapes are converted into outlined "
                        "path geometry representing the stroke's extent using "
                        "Shapely's buffer(). Enable when physical stroke width "
                        "matters for plotter output."
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
                        "The minimum Euclidean length for an individual line segment "
                        "to be kept. Segments shorter than this are discarded. Set "
                        "to 0 to keep all segments."
                    ),
                ),
            ],
        )

    # ------------------------------------------------------------------
    # Processing
    # ------------------------------------------------------------------

    async def process(
        self,
        inputs: dict[str, Any],
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Convert all SVG geometry to PATH-format line segments."""

        # --- Validate input -------------------------------------------------
        svg_string = (inputs or {}).get("vector")
        if not svg_string or not isinstance(svg_string, str):
            raise ValueError("Missing or invalid vector input")

        # --- Extract parameters ---------------------------------------------
        flatten_transforms: bool = params.get("flatten_transforms", True)
        curve_tolerance: float = float(params.get("curve_tolerance", 0.5))
        arc_seg: int = int(params.get("arc_segments", 32))
        include_text: bool = params.get("include_text", True)
        include_hidden: bool = params.get("include_hidden", False)
        stroke_to_path: bool = params.get("stroke_to_path", False)
        min_seg_len: float = float(params.get("min_segment_length", 0.0))

        # --- Parse SVG document ---------------------------------------------
        try:
            root = ET.fromstring(svg_string)
        except ET.ParseError as exc:
            raise ValueError(f"Failed to parse SVG: {exc}") from exc

        # Step 2: Coordinate space — viewBox/width/height are not directly needed
        # for PATH output since coordinates are taken from element attributes.
        # Transform flattening handles any root-level coordinate transformations.

        # --- Recursively walk the SVG tree ----------------------------------
        path_list: list[dict[str, Any]] = []
        self._walk_element(
            root,
            _identity(),
            path_list,
            flatten_transforms=flatten_transforms,
            curve_tolerance=curve_tolerance,
            arc_segments=arc_seg,
            include_text=include_text,
            include_hidden=include_hidden,
            stroke_to_path=stroke_to_path,
        )

        # --- Apply segment length filtering ---------------------------------
        if min_seg_len > 0:
            path_list = self._filter_short_segments(path_list, min_seg_len)

        return {"path": path_list}

    # ------------------------------------------------------------------
    # Tree walker
    # ------------------------------------------------------------------

    def _walk_element(
        self,
        elem: ET.Element,
        parent_transform: np.ndarray,
        path_list: list[dict[str, Any]],
        *,
        flatten_transforms: bool,
        curve_tolerance: float,
        arc_segments: int,
        include_text: bool,
        include_hidden: bool,
        stroke_to_path: bool,
    ) -> None:
        """Recursively walk the SVG element tree and convert shapes to paths."""

        # Visibility check
        if not include_hidden and _is_hidden(elem):
            return

        # Accumulate transforms
        current_transform = parent_transform
        if flatten_transforms:
            transform_attr = elem.get("transform")
            if transform_attr:
                local_mat = _parse_transform(transform_attr)
                current_transform = parent_transform @ local_mat

        tag = _strip_ns(elem.tag)

        # Skip definition/template containers — their children are not rendered directly
        if tag in ("defs", "symbol", "clipPath", "mask", "pattern"):
            return

        # Group elements: recurse into children
        if tag in ("svg", "g", "a", "use"):
            for child in elem:
                self._walk_element(
                    child,
                    current_transform,
                    path_list,
                    flatten_transforms=flatten_transforms,
                    curve_tolerance=curve_tolerance,
                    arc_segments=arc_segments,
                    include_text=include_text,
                    include_hidden=include_hidden,
                    stroke_to_path=stroke_to_path,
                )
            return

        # Convert individual shape elements
        sub_paths: list[dict] | None = None

        segment_meta = _get_segment_meta(elem)

        try:
            if tag == "path":
                sub_paths = self._convert_path(
                    elem,
                    curve_tolerance,
                    arc_segments,
                    segment_meta,
                )
            elif tag == "line":
                sub_paths = self._convert_line(elem)
            elif tag == "polyline":
                sub_paths = self._convert_polyline(elem)
            elif tag == "polygon":
                sub_paths = self._convert_polygon(elem)
            elif tag == "rect":
                sub_paths = self._convert_rect(elem, arc_segments)
            elif tag == "circle":
                sub_paths = self._convert_circle(elem, arc_segments)
            elif tag == "ellipse":
                sub_paths = self._convert_ellipse(elem, arc_segments)
            elif tag == "text" and include_text:
                try:
                    sub_paths = self._convert_text(elem)
                except Exception as exc:
                    _logger.warning("Skipping text element conversion: %s", exc)
                    return
        except Exception as exc:
            _logger.warning("Skipping unparseable %s element: %s", tag, exc)
            return

        if not sub_paths:
            return

        # Build PathObjects from sub-paths
        for sp in sub_paths:
            closed = sp.get("closed", False)

            if "segments" in sp:
                segments = [dict(seg) for seg in sp["segments"]]
            else:
                points = sp["points"]
                path_obj = _points_to_path_obj(points, closed, segment_meta)
                if path_obj:
                    if flatten_transforms and not np.allclose(current_transform, _identity()):
                        path_obj["segments"] = _apply_transform_segments(
                            current_transform,
                            path_obj["segments"],
                        )
                    path_list.append(path_obj)

                if stroke_to_path:
                    sw = _get_stroke_width(elem)
                    if sw > 0:
                        stroke_obj = _stroke_to_path_obj(
                            points,
                            sw,
                            closed,
                            segment_meta,
                        )
                        if stroke_obj:
                            path_list.append(stroke_obj)
                continue

            if flatten_transforms and not np.allclose(current_transform, _identity()):
                segments = _apply_transform_segments(current_transform, segments)

            path_obj = {"segments": segments, "closed": closed} if segments else None
            if path_obj:
                path_list.append(path_obj)

            # Stroke-to-path: add outlined stroke geometry
            if stroke_to_path:
                sw = _get_stroke_width(elem)
                if sw > 0:
                    poly_points = [segments[0]["from"]]
                    poly_points.extend(seg["to"] for seg in segments)
                    stroke_obj = _stroke_to_path_obj(
                        poly_points,
                        sw,
                        closed,
                        segment_meta,
                    )
                    if stroke_obj:
                        path_list.append(stroke_obj)

    # ------------------------------------------------------------------
    # Shape converters — each returns list[{"points": [[x,y],...], "closed": bool}]
    # ------------------------------------------------------------------

    @staticmethod
    def _convert_path(
        elem: ET.Element,
        tolerance: float,
        arc_segments: int,
        segment_meta: dict[str, Any],
    ) -> list[dict] | None:
        """Convert a ``<path>`` element's ``d`` attribute."""
        d_attr = elem.get("d", "").strip()
        if not d_attr:
            return None
        sub_paths = _parse_path_d(d_attr, tolerance, arc_segments, segment_meta)
        return sub_paths if sub_paths else None

    @staticmethod
    def _convert_line(elem: ET.Element) -> list[dict]:
        """Convert a ``<line>`` element."""
        x1 = float(elem.get("x1", "0"))
        y1 = float(elem.get("y1", "0"))
        x2 = float(elem.get("x2", "0"))
        y2 = float(elem.get("y2", "0"))
        return [{"points": [[x1, y1], [x2, y2]], "closed": False}]

    @staticmethod
    def _convert_polyline(elem: ET.Element) -> list[dict] | None:
        """Convert a ``<polyline>`` element."""
        pts_attr = elem.get("points", "").strip()
        if not pts_attr:
            return None
        points = _parse_points_attr(pts_attr)
        if len(points) < 2:
            return None
        return [{"points": points, "closed": False}]

    @staticmethod
    def _convert_polygon(elem: ET.Element) -> list[dict] | None:
        """Convert a ``<polygon>`` element."""
        pts_attr = elem.get("points", "").strip()
        if not pts_attr:
            return None
        points = _parse_points_attr(pts_attr)
        if len(points) < 2:
            return None
        return [{"points": points, "closed": True}]

    @staticmethod
    def _convert_rect(elem: ET.Element, arc_segments: int) -> list[dict] | None:
        """Convert a ``<rect>`` element, with optional rounded corners."""
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))
        w = float(elem.get("width", "0"))
        h = float(elem.get("height", "0"))
        if w <= 0 or h <= 0:
            return None

        rx_attr = elem.get("rx")
        ry_attr = elem.get("ry")
        rx = float(rx_attr) if rx_attr else 0.0
        ry = float(ry_attr) if ry_attr else 0.0

        # Per SVG spec: if only one radius is specified, the other equals it
        if rx_attr and not ry_attr:
            ry = rx
        elif ry_attr and not rx_attr:
            rx = ry

        # Clamp radii to half the rectangle dimensions
        rx = min(rx, w / 2.0)
        ry = min(ry, h / 2.0)

        if rx > 0 and ry > 0:
            # Rounded rectangle: 4 straight sides + 4 quarter-ellipse arcs
            points: list[list[float]] = []
            # Number of segments per quarter arc
            n = max(arc_segments // 4, 2)

            # Top edge (left-to-right)
            points.append([x + rx, y])
            points.append([x + w - rx, y])
            # Top-right corner arc
            for i in range(1, n + 1):
                angle = -math.pi / 2 + (math.pi / 2) * i / n
                points.append([
                    x + w - rx + rx * math.cos(angle),
                    y + ry + ry * math.sin(angle),
                ])
            # Right edge (top-to-bottom)
            points.append([x + w, y + ry])
            points.append([x + w, y + h - ry])
            # Bottom-right corner arc
            for i in range(1, n + 1):
                angle = 0 + (math.pi / 2) * i / n
                points.append([
                    x + w - rx + rx * math.cos(angle),
                    y + h - ry + ry * math.sin(angle),
                ])
            # Bottom edge (right-to-left)
            points.append([x + w - rx, y + h])
            points.append([x + rx, y + h])
            # Bottom-left corner arc
            for i in range(1, n + 1):
                angle = math.pi / 2 + (math.pi / 2) * i / n
                points.append([
                    x + rx + rx * math.cos(angle),
                    y + h - ry + ry * math.sin(angle),
                ])
            # Left edge (bottom-to-top)
            points.append([x, y + h - ry])
            points.append([x, y + ry])
            # Top-left corner arc
            for i in range(1, n + 1):
                angle = math.pi + (math.pi / 2) * i / n
                points.append([
                    x + rx + rx * math.cos(angle),
                    y + ry + ry * math.sin(angle),
                ])

            return [{"points": points, "closed": True}]
        else:
            # Simple rectangle: 4 corners
            points = [
                [x, y],
                [x + w, y],
                [x + w, y + h],
                [x, y + h],
            ]
            return [{"points": points, "closed": True}]

    @staticmethod
    def _convert_circle(elem: ET.Element, arc_segments: int) -> list[dict] | None:
        """Convert a ``<circle>`` element to a regular polygon approximation."""
        cx = float(elem.get("cx", "0"))
        cy = float(elem.get("cy", "0"))
        r = float(elem.get("r", "0"))
        if r <= 0:
            return None

        points: list[list[float]] = []
        for i in range(arc_segments):
            angle = 2 * math.pi * i / arc_segments
            points.append([cx + r * math.cos(angle), cy + r * math.sin(angle)])

        return [{"points": points, "closed": True}]

    @staticmethod
    def _convert_ellipse(elem: ET.Element, arc_segments: int) -> list[dict] | None:
        """Convert an ``<ellipse>`` element to a polygon approximation."""
        cx = float(elem.get("cx", "0"))
        cy = float(elem.get("cy", "0"))
        rx = float(elem.get("rx", "0"))
        ry = float(elem.get("ry", "0"))
        if rx <= 0 or ry <= 0:
            return None

        points: list[list[float]] = []
        for i in range(arc_segments):
            angle = 2 * math.pi * i / arc_segments
            points.append([cx + rx * math.cos(angle), cy + ry * math.sin(angle)])

        return [{"points": points, "closed": True}]

    @staticmethod
    def _convert_text(elem: ET.Element) -> list[dict] | None:
        """Best-effort conversion of a ``<text>`` element to rectangular glyph outlines.

        This is a rough approximation: each character is represented as a
        bounding rectangle based on estimated font size and character width.
        """
        # Gather text content (including nested <tspan>)
        text_content = "".join(elem.itertext()).strip()
        if not text_content:
            return None

        # Determine position and font size
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))

        font_size = 16.0  # default fallback
        fs_attr = elem.get("font-size", "").strip()
        style = elem.get("style", "")

        # Try to extract font-size from style attribute
        if not fs_attr:
            for part in style.split(";"):
                part = part.strip()
                if part.lower().startswith("font-size"):
                    fs_attr = part.split(":", 1)[1].strip() if ":" in part else ""
                    break

        if fs_attr:
            fs_nums = _NUM_RE.findall(fs_attr)
            if fs_nums:
                font_size = float(fs_nums[0])

        # Approximate character width as 0.6 × font_size (monospace-ish)
        char_width = font_size * 0.6
        char_height = font_size

        sub_paths: list[dict] = []
        cursor_x = x
        for char in text_content:
            if char in (" ", "\t", "\n", "\r"):
                cursor_x += char_width
                continue
            # Create bounding rectangle for this character
            # Baseline is at (cursor_x, y); ascent goes upward
            x0 = cursor_x
            y0 = y - char_height  # top of character
            x1 = cursor_x + char_width
            y1 = y  # baseline
            sub_paths.append({
                "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
                "closed": True,
            })
            cursor_x += char_width

        return sub_paths if sub_paths else None

    # ------------------------------------------------------------------
    # Segment length filter
    # ------------------------------------------------------------------

    @staticmethod
    def _filter_short_segments(
        path_list: list[dict[str, Any]], min_length: float
    ) -> list[dict[str, Any]]:
        """Remove segments shorter than *min_length* and discard empty PathObjects."""
        filtered: list[dict[str, Any]] = []
        for path_obj in path_list:
            surviving: list[dict[str, Any]] = []
            for seg in path_obj["segments"]:
                dx = seg["to"][0] - seg["from"][0]
                dy = seg["to"][1] - seg["from"][1]
                if math.hypot(dx, dy) >= min_length:
                    surviving.append(seg)
            if surviving:
                filtered.append({
                    "segments": surviving,
                    "closed": path_obj.get("closed", False),
                })
        return filtered


# Module-level alias required by the plugin loader
Plugin = VectorToPath

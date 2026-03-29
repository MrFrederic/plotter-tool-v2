"""Vector Decompose plugin — parses an SVG data stream and dispatches its elements
to dedicated output ports by element class.

Paths are converted to the internal PATH format; text, lines, shapes, and embedded
raster images are routed to separate VECTOR or IMAGE channels.
"""

from typing import Any
import base64
import math
import re
import xml.etree.ElementTree as ET

import numpy as np
import cv2

from app.plugin_base import (
    BasePlugin,
    ParameterDefinition,
    PluginSchema,
    PortDefinition,
    PortType,
)
from app.image_utils import decode_image, encode_image

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

# Register namespaces so ET.tostring preserves them without ns0/ns1 prefixes.
ET.register_namespace("", SVG_NS)
ET.register_namespace("xlink", XLINK_NS)

# Default per-segment metadata.
_DEFAULT_META: dict[str, Any] = {"width": None, "speed": None}

# Tag sets for element classification (local names, no namespace).
_PATH_TAGS = {"path"}
_TEXT_TAGS = {"text", "tspan"}
_LINE_TAGS = {"line", "polyline"}
_SHAPE_TAGS = {"rect", "circle", "ellipse", "polygon"}
_IMAGE_TAGS = {"image"}


# ======================================================================
# SVG path d-attribute tokeniser & parser
# ======================================================================

# Regex that splits a ``d`` attribute into command letters and numeric tokens.
_TOKEN_RE = re.compile(
    r"([MmLlHhVvCcSsQqTtAaZz])"        # command letters
    r"|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)"  # numbers (int/float/sci)
)


def _tokenise_d(d: str) -> list[str]:
    """Return a flat list of command-letter and number tokens from an SVG ``d`` string."""
    return [m.group() for m in _TOKEN_RE.finditer(d)]


def _consume_floats(tokens: list[str], idx: int, count: int) -> tuple[list[float], int]:
    """Consume *count* numeric tokens starting at *idx*, returning (values, new_idx)."""
    values: list[float] = []
    while len(values) < count and idx < len(tokens):
        try:
            values.append(float(tokens[idx]))
            idx += 1
        except ValueError:
            break
    return values, idx


# ---------------------------------------------------------------------------
# Bezier & arc flattening helpers
# ---------------------------------------------------------------------------

def _flatten_cubic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    tolerance: float,
    depth: int = 0,
) -> list[tuple[float, float]]:
    """Recursively flatten a cubic Bezier into line segments.

    Returns a list of points (excluding *p0*) that approximate the curve within
    *tolerance*.
    """
    if depth > 12:
        return [p3]

    # Flatness test: maximum deviation of control points from the chord p0→p3.
    dx = p3[0] - p0[0]
    dy = p3[1] - p0[1]
    chord_len_sq = dx * dx + dy * dy
    if chord_len_sq == 0:
        # Degenerate: all points coincide.
        return [p3]

    # Distances of p1, p2 from the line p0→p3 (cross-product method).
    d1 = abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx)
    d2 = abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx)
    max_dev = max(d1, d2) / math.sqrt(chord_len_sq)

    if max_dev <= tolerance:
        return [p3]

    # Subdivide at t = 0.5 (de Casteljau).
    m01 = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    m12 = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    m23 = ((p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2)
    m012 = ((m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2)
    m123 = ((m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2)
    mid = ((m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2)

    left = _flatten_cubic(p0, m01, m012, mid, tolerance, depth + 1)
    right = _flatten_cubic(mid, m123, m23, p3, tolerance, depth + 1)
    return left + right


def _flatten_quadratic(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    tolerance: float,
    depth: int = 0,
) -> list[tuple[float, float]]:
    """Recursively flatten a quadratic Bezier into line segments."""
    if depth > 12:
        return [p2]

    dx = p2[0] - p0[0]
    dy = p2[1] - p0[1]
    chord_len_sq = dx * dx + dy * dy
    if chord_len_sq == 0:
        return [p2]

    d1 = abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx)
    max_dev = d1 / math.sqrt(chord_len_sq)

    if max_dev <= tolerance:
        return [p2]

    # Subdivide at t = 0.5.
    m01 = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
    m12 = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    mid = ((m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2)

    left = _flatten_quadratic(p0, m01, mid, tolerance, depth + 1)
    right = _flatten_quadratic(mid, m12, p2, tolerance, depth + 1)
    return left + right


def _arc_to_points(
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    phi: float,
    theta1: float,
    dtheta: float,
    n_segments: int = 16,
) -> list[tuple[float, float]]:
    """Generate points along an elliptical arc (centre parameterisation).

    *phi*, *theta1*, and *dtheta* are in **radians**.
    Returns *n_segments* points (excluding the start point).
    """
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)
    points: list[tuple[float, float]] = []
    for i in range(1, n_segments + 1):
        t = theta1 + dtheta * i / n_segments
        cos_t = math.cos(t)
        sin_t = math.sin(t)
        x = cos_phi * rx * cos_t - sin_phi * ry * sin_t + cx
        y = sin_phi * rx * cos_t + cos_phi * ry * sin_t + cy
        points.append((x, y))
    return points


def _endpoint_to_centre_arc(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    fa: float,
    fs: float,
    rx: float,
    ry: float,
    phi_deg: float,
) -> tuple[float, float, float, float, float, float, float]:
    """Convert SVG endpoint-arc parameters to centre parameterisation.

    Returns (cx, cy, rx, ry, phi_rad, theta1, dtheta).
    """
    phi = math.radians(phi_deg)
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)

    # Step 1: transform to rotated midpoint coordinates.
    dx2 = (x1 - x2) / 2
    dy2 = (y1 - y2) / 2
    x1p = cos_phi * dx2 + sin_phi * dy2
    y1p = -sin_phi * dx2 + cos_phi * dy2

    # Ensure radii are positive and large enough.
    rx = abs(rx)
    ry = abs(ry)
    x1p_sq = x1p * x1p
    y1p_sq = y1p * y1p

    # Scale up if radii are too small.
    lam = x1p_sq / (rx * rx) + y1p_sq / (ry * ry) if rx > 0 and ry > 0 else 0
    if lam > 1:
        scale = math.sqrt(lam)
        rx *= scale
        ry *= scale

    rx_sq = rx * rx
    ry_sq = ry * ry

    # Step 2: compute centre point in rotated frame.
    num = max(rx_sq * ry_sq - rx_sq * y1p_sq - ry_sq * x1p_sq, 0)
    denom = rx_sq * y1p_sq + ry_sq * x1p_sq
    sq = math.sqrt(num / denom) if denom > 0 else 0
    if fa == fs:
        sq = -sq

    cxp = sq * rx * y1p / ry
    cyp = -sq * ry * x1p / rx

    # Step 3: transform back.
    cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2
    cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2

    # Step 4: compute angles.
    def _angle(ux: float, uy: float, vx: float, vy: float) -> float:
        dot_ = ux * vx + uy * vy
        mag = math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
        if mag == 0:
            return 0.0
        cos_a = max(-1.0, min(1.0, dot_ / mag))
        angle_ = math.acos(cos_a)
        if ux * vy - uy * vx < 0:
            angle_ = -angle_
        return angle_

    theta1 = _angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dtheta = _angle(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry,
    )

    if fs == 0 and dtheta > 0:
        dtheta -= 2 * math.pi
    elif fs == 1 and dtheta < 0:
        dtheta += 2 * math.pi

    return cx, cy, rx, ry, phi, theta1, dtheta


# ---------------------------------------------------------------------------
# Full SVG path ``d`` parser → list of polylines
# ---------------------------------------------------------------------------

def _parse_svg_path_d(d: str, tolerance: float = 0.5) -> list[dict[str, Any]]:
    """Parse an SVG path ``d`` attribute and return a list of sub-path dicts.

    Each sub-path is ``{"points": [(x, y), ...], "closed": bool}``.
    Bezier curves and arcs are flattened to line-segment approximations.
    """
    tokens = _tokenise_d(d)
    if not tokens:
        return []

    subpaths: list[dict[str, Any]] = []
    current: list[tuple[float, float]] = []
    cx_ = cy_ = 0.0  # Current point.
    sx_ = sy_ = 0.0  # Start of current sub-path (for Z).
    # Last control point for smooth curves.
    last_cubic_cp: tuple[float, float] | None = None
    last_quad_cp: tuple[float, float] | None = None

    idx = 0
    cmd = ""

    def _finish_subpath(close: bool) -> None:
        nonlocal current
        if current:
            subpaths.append({"points": list(current), "closed": close})
            current = []

    while idx < len(tokens):
        tok = tokens[idx]

        # If the token is a command letter, update cmd and advance.
        if tok.isalpha():
            cmd = tok
            idx += 1
        elif not cmd:
            idx += 1
            continue  # No command yet — skip stray numbers.

        # ---------- M / m  (moveto) ----------
        if cmd in ("M", "m"):
            vals, idx = _consume_floats(tokens, idx, 2)
            if len(vals) < 2:
                continue
            # Finish any open sub-path.
            _finish_subpath(False)
            if cmd == "m":
                cx_ += vals[0]
                cy_ += vals[1]
            else:
                cx_, cy_ = vals[0], vals[1]
            sx_, sy_ = cx_, cy_
            current = [(cx_, cy_)]
            last_cubic_cp = None
            last_quad_cp = None
            # Subsequent coordinate-pairs after M are implicit lineto.
            cmd = "L" if cmd == "M" else "l"

        # ---------- L / l  (lineto) ----------
        elif cmd in ("L", "l"):
            vals, idx = _consume_floats(tokens, idx, 2)
            if len(vals) < 2:
                continue
            if cmd == "l":
                cx_ += vals[0]
                cy_ += vals[1]
            else:
                cx_, cy_ = vals[0], vals[1]
            current.append((cx_, cy_))
            last_cubic_cp = None
            last_quad_cp = None

        # ---------- H / h  (horizontal lineto) ----------
        elif cmd in ("H", "h"):
            vals, idx = _consume_floats(tokens, idx, 1)
            if len(vals) < 1:
                continue
            cx_ = cx_ + vals[0] if cmd == "h" else vals[0]
            current.append((cx_, cy_))
            last_cubic_cp = None
            last_quad_cp = None

        # ---------- V / v  (vertical lineto) ----------
        elif cmd in ("V", "v"):
            vals, idx = _consume_floats(tokens, idx, 1)
            if len(vals) < 1:
                continue
            cy_ = cy_ + vals[0] if cmd == "v" else vals[0]
            current.append((cx_, cy_))
            last_cubic_cp = None
            last_quad_cp = None

        # ---------- C / c  (cubic bezier) ----------
        elif cmd in ("C", "c"):
            vals, idx = _consume_floats(tokens, idx, 6)
            if len(vals) < 6:
                continue
            if cmd == "c":
                p1 = (cx_ + vals[0], cy_ + vals[1])
                p2 = (cx_ + vals[2], cy_ + vals[3])
                p3 = (cx_ + vals[4], cy_ + vals[5])
            else:
                p1 = (vals[0], vals[1])
                p2 = (vals[2], vals[3])
                p3 = (vals[4], vals[5])
            pts = _flatten_cubic((cx_, cy_), p1, p2, p3, tolerance)
            current.extend(pts)
            last_cubic_cp = p2
            last_quad_cp = None
            cx_, cy_ = p3

        # ---------- S / s  (smooth cubic) ----------
        elif cmd in ("S", "s"):
            vals, idx = _consume_floats(tokens, idx, 4)
            if len(vals) < 4:
                continue
            # Reflect last cubic control point.
            if last_cubic_cp is not None:
                p1 = (2 * cx_ - last_cubic_cp[0], 2 * cy_ - last_cubic_cp[1])
            else:
                p1 = (cx_, cy_)
            if cmd == "s":
                p2 = (cx_ + vals[0], cy_ + vals[1])
                p3 = (cx_ + vals[2], cy_ + vals[3])
            else:
                p2 = (vals[0], vals[1])
                p3 = (vals[2], vals[3])
            pts = _flatten_cubic((cx_, cy_), p1, p2, p3, tolerance)
            current.extend(pts)
            last_cubic_cp = p2
            last_quad_cp = None
            cx_, cy_ = p3

        # ---------- Q / q  (quadratic bezier) ----------
        elif cmd in ("Q", "q"):
            vals, idx = _consume_floats(tokens, idx, 4)
            if len(vals) < 4:
                continue
            if cmd == "q":
                p1 = (cx_ + vals[0], cy_ + vals[1])
                p2 = (cx_ + vals[2], cy_ + vals[3])
            else:
                p1 = (vals[0], vals[1])
                p2 = (vals[2], vals[3])
            pts = _flatten_quadratic((cx_, cy_), p1, p2, tolerance)
            current.extend(pts)
            last_quad_cp = p1
            last_cubic_cp = None
            cx_, cy_ = p2

        # ---------- T / t  (smooth quadratic) ----------
        elif cmd in ("T", "t"):
            vals, idx = _consume_floats(tokens, idx, 2)
            if len(vals) < 2:
                continue
            if last_quad_cp is not None:
                p1 = (2 * cx_ - last_quad_cp[0], 2 * cy_ - last_quad_cp[1])
            else:
                p1 = (cx_, cy_)
            if cmd == "t":
                p2 = (cx_ + vals[0], cy_ + vals[1])
            else:
                p2 = (vals[0], vals[1])
            pts = _flatten_quadratic((cx_, cy_), p1, p2, tolerance)
            current.extend(pts)
            last_quad_cp = p1
            last_cubic_cp = None
            cx_, cy_ = p2

        # ---------- A / a  (arc) ----------
        elif cmd in ("A", "a"):
            vals, idx = _consume_floats(tokens, idx, 7)
            if len(vals) < 7:
                continue
            rx_a, ry_a = abs(vals[0]), abs(vals[1])
            phi_deg = vals[2]
            fa = int(vals[3])
            fs = int(vals[4])
            if cmd == "a":
                ex = cx_ + vals[5]
                ey = cy_ + vals[6]
            else:
                ex, ey = vals[5], vals[6]

            # NOTE: Arcs are always flattened to line segments for plotter compatibility.
            # The spec suggests emitting arc-type segments where possible, but polyline
            # approximation is more universally supported by downstream processors.
            if rx_a == 0 or ry_a == 0:
                # Degenerate arc → straight line.
                cx_, cy_ = ex, ey
                current.append((cx_, cy_))
            else:
                cxc, cyc, rx_a, ry_a, phi_r, theta1, dtheta = (
                    _endpoint_to_centre_arc(cx_, cy_, ex, ey, fa, fs, rx_a, ry_a, phi_deg)
                )
                arc_pts = _arc_to_points(cxc, cyc, rx_a, ry_a, phi_r, theta1, dtheta, 16)
                current.extend(arc_pts)
                cx_, cy_ = ex, ey
            last_cubic_cp = None
            last_quad_cp = None

        # ---------- Z / z  (close path) ----------
        elif cmd in ("Z", "z"):
            cx_, cy_ = sx_, sy_
            _finish_subpath(True)
            last_cubic_cp = None
            last_quad_cp = None
            cmd = ""  # Reset; next token must be a new command.

        else:
            # Unknown command – skip.
            idx += 1

    # Close any remaining open sub-path.
    _finish_subpath(False)
    return subpaths


# ---------------------------------------------------------------------------
# Douglas-Peucker post-processing
# ---------------------------------------------------------------------------

def _simplify_path_objects(
    path_objects: list[dict[str, Any]], tolerance: float
) -> list[dict[str, Any]]:
    """Apply Douglas-Peucker simplification to PATH segments."""
    if tolerance <= 0:
        return path_objects
    simplified: list[dict[str, Any]] = []
    for path_obj in path_objects:
        segments = path_obj.get("segments", [])
        if not segments:
            simplified.append(path_obj)
            continue
        # Build point list from segments
        points = [segments[0]["from"]]
        for seg in segments:
            points.append(seg["to"])
        # Convert to numpy array for cv2
        pts_array = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
        closed = path_obj.get("closed", False)
        approx = cv2.approxPolyDP(pts_array, tolerance, closed)
        new_points = approx.reshape(-1, 2).tolist()
        if len(new_points) < 2:
            continue
        new_segments: list[dict[str, Any]] = []
        for i in range(len(new_points) - 1):
            new_segments.append({
                "type": "line",
                "from": new_points[i],
                "to": new_points[i + 1],
                "meta": dict(_DEFAULT_META),
            })
        if closed and len(new_points) >= 2:
            dist = math.hypot(
                new_points[-1][0] - new_points[0][0],
                new_points[-1][1] - new_points[0][1],
            )
            if dist > 1e-6:
                new_segments.append({
                    "type": "line",
                    "from": new_points[-1],
                    "to": new_points[0],
                    "meta": dict(_DEFAULT_META),
                })
        if new_segments:
            simplified.append({"segments": new_segments, "closed": closed})
    return simplified


# ======================================================================
# Transform parsing & matrix utilities
# ======================================================================

_TRANSFORM_RE = re.compile(
    r"(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)"
)


def _parse_transform(attr: str) -> list[tuple[str, list[float]]]:
    """Parse an SVG ``transform`` attribute into a list of (name, values) operations."""
    result: list[tuple[str, list[float]]] = []
    for m in _TRANSFORM_RE.finditer(attr):
        name = m.group(1)
        raw_vals = re.findall(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", m.group(2))
        vals = [float(v) for v in raw_vals]
        result.append((name, vals))
    return result


def _transform_to_matrix(ops: list[tuple[str, list[float]]]) -> np.ndarray:
    """Build a 3×3 affine matrix from a sequence of SVG transform operations."""
    mat = np.eye(3)
    for name, vals in ops:
        if name == "matrix" and len(vals) >= 6:
            # SVG matrix(a, b, c, d, e, f)
            t = np.array([
                [vals[0], vals[2], vals[4]],
                [vals[1], vals[3], vals[5]],
                [0, 0, 1],
            ])
            mat = mat @ t
        elif name == "translate":
            tx = vals[0] if len(vals) >= 1 else 0
            ty = vals[1] if len(vals) >= 2 else 0
            t = np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1]])
            mat = mat @ t
        elif name == "scale":
            sx = vals[0] if len(vals) >= 1 else 1
            sy = vals[1] if len(vals) >= 2 else sx
            t = np.array([[sx, 0, 0], [0, sy, 0], [0, 0, 1]])
            mat = mat @ t
        elif name == "rotate":
            angle = math.radians(vals[0]) if len(vals) >= 1 else 0
            cos_a = math.cos(angle)
            sin_a = math.sin(angle)
            # Optional rotation centre.
            cx_r = vals[1] if len(vals) >= 2 else 0
            cy_r = vals[2] if len(vals) >= 3 else 0
            t = np.eye(3)
            if cx_r or cy_r:
                t = np.array([[1, 0, cx_r], [0, 1, cy_r], [0, 0, 1]])
            r = np.array([[cos_a, -sin_a, 0], [sin_a, cos_a, 0], [0, 0, 1]])
            t = t @ r
            if cx_r or cy_r:
                t = t @ np.array([[1, 0, -cx_r], [0, 1, -cy_r], [0, 0, 1]])
            mat = mat @ t
        elif name == "skewX" and len(vals) >= 1:
            t = np.array([[1, math.tan(math.radians(vals[0])), 0], [0, 1, 0], [0, 0, 1]])
            mat = mat @ t
        elif name == "skewY" and len(vals) >= 1:
            t = np.array([[1, 0, 0], [math.tan(math.radians(vals[0])), 1, 0], [0, 0, 1]])
            mat = mat @ t
    return mat


def _get_element_matrix(
    elem: ET.Element,
    parent_matrix: np.ndarray | None = None,
) -> np.ndarray:
    """Compute the cumulative transform matrix for *elem* including parent chain."""
    mat = parent_matrix if parent_matrix is not None else np.eye(3)
    transform_attr = elem.get("transform", "")
    if transform_attr:
        ops = _parse_transform(transform_attr)
        local_mat = _transform_to_matrix(ops)
        mat = mat @ local_mat
    return mat


def _apply_matrix_to_point(mat: np.ndarray, x: float, y: float) -> tuple[float, float]:
    """Apply a 3×3 affine matrix to a 2-D point, return transformed (x, y)."""
    v = mat @ np.array([x, y, 1.0])
    return float(v[0]), float(v[1])


# ======================================================================
# Visibility checking
# ======================================================================

def _is_hidden(elem: ET.Element) -> bool:
    """Return True if the element is invisible (display, visibility, opacity)."""
    # Check direct attributes.
    if elem.get("display", "").strip().lower() == "none":
        return True
    if elem.get("visibility", "").strip().lower() == "hidden":
        return True
    opacity_str = elem.get("opacity", "").strip()
    if opacity_str and opacity_str == "0":
        return True

    # Check inline style attribute.
    style = elem.get("style", "")
    if style:
        style_lower = style.lower()
        if "display" in style_lower:
            if re.search(r"display\s*:\s*none", style_lower):
                return True
        if "visibility" in style_lower:
            if re.search(r"visibility\s*:\s*hidden", style_lower):
                return True
        if "opacity" in style_lower:
            m = re.search(r"opacity\s*:\s*([0-9.]+)", style_lower)
            if m and float(m.group(1)) == 0:
                return True
    return False


# ======================================================================
# Helpers: local tag name, SVG fragment builder
# ======================================================================

def _local_tag(elem: ET.Element) -> str:
    """Strip namespace URI from an ElementTree tag, returning the local name."""
    tag = elem.tag
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def _build_svg_fragment(
    viewbox: str,
    width: str | None,
    height: str | None,
    elements: list[ET.Element],
) -> str:
    """Build a complete SVG XML string containing the given child elements."""
    svg_root = ET.Element("svg")
    svg_root.set("xmlns", SVG_NS)
    svg_root.set("viewBox", viewbox)
    if width:
        svg_root.set("width", width)
    if height:
        svg_root.set("height", height)
    for el in elements:
        svg_root.append(el)
    return ET.tostring(svg_root, encoding="unicode")


def _transparent_1x1_png() -> str:
    """Return a base64-encoded transparent 1×1 PNG."""
    img = np.zeros((1, 1, 4), dtype=np.uint8)
    return encode_image(img)


# ======================================================================
# Transform application helpers for SVG fragment elements
# ======================================================================

def _apply_transform_to_element(elem: ET.Element, mat: np.ndarray) -> None:
    """Apply an affine matrix to the coordinate attributes of a visual SVG element.

    After application the ``transform`` attribute is removed from the element so
    the output SVG fragment has "baked-in" coordinates.
    """
    tag = _local_tag(elem)

    if tag == "line":
        for attr_pair in [("x1", "y1"), ("x2", "y2")]:
            x = float(elem.get(attr_pair[0], "0"))
            y = float(elem.get(attr_pair[1], "0"))
            nx, ny = _apply_matrix_to_point(mat, x, y)
            elem.set(attr_pair[0], str(nx))
            elem.set(attr_pair[1], str(ny))

    elif tag == "polyline" or tag == "polygon":
        points_str = elem.get("points", "")
        nums = re.findall(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", points_str)
        new_pts: list[str] = []
        for i in range(0, len(nums) - 1, 2):
            x, y = float(nums[i]), float(nums[i + 1])
            nx, ny = _apply_matrix_to_point(mat, x, y)
            new_pts.append(f"{nx},{ny}")
        elem.set("points", " ".join(new_pts))

    elif tag == "rect":
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))
        nx, ny = _apply_matrix_to_point(mat, x, y)
        elem.set("x", str(nx))
        elem.set("y", str(ny))
        # Scale width/height by matrix scale factors (rough approximation).
        w = float(elem.get("width", "0"))
        h = float(elem.get("height", "0"))
        # Use the matrix to transform the width/height vectors.
        sx = math.sqrt(mat[0, 0] ** 2 + mat[1, 0] ** 2)
        sy = math.sqrt(mat[0, 1] ** 2 + mat[1, 1] ** 2)
        elem.set("width", str(w * sx))
        elem.set("height", str(h * sy))

    elif tag == "circle":
        cx_v = float(elem.get("cx", "0"))
        cy_v = float(elem.get("cy", "0"))
        nx, ny = _apply_matrix_to_point(mat, cx_v, cy_v)
        elem.set("cx", str(nx))
        elem.set("cy", str(ny))
        r = float(elem.get("r", "0"))
        s = (math.sqrt(mat[0, 0] ** 2 + mat[1, 0] ** 2) +
             math.sqrt(mat[0, 1] ** 2 + mat[1, 1] ** 2)) / 2
        elem.set("r", str(r * s))

    elif tag == "ellipse":
        cx_v = float(elem.get("cx", "0"))
        cy_v = float(elem.get("cy", "0"))
        nx, ny = _apply_matrix_to_point(mat, cx_v, cy_v)
        elem.set("cx", str(nx))
        elem.set("cy", str(ny))
        rx_v = float(elem.get("rx", "0"))
        ry_v = float(elem.get("ry", "0"))
        sx = math.sqrt(mat[0, 0] ** 2 + mat[1, 0] ** 2)
        sy = math.sqrt(mat[0, 1] ** 2 + mat[1, 1] ** 2)
        elem.set("rx", str(rx_v * sx))
        elem.set("ry", str(ry_v * sy))

    elif tag == "text":
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))
        nx, ny = _apply_matrix_to_point(mat, x, y)
        elem.set("x", str(nx))
        elem.set("y", str(ny))

    # Remove the transform attribute since we baked it in.
    if "transform" in elem.attrib:
        del elem.attrib["transform"]


# ======================================================================
# Plugin class
# ======================================================================

class VectorDecompose(BasePlugin):
    """Parses an SVG document and dispatches element classes to dedicated output
    ports — paths, text, lines, shapes, and embedded raster."""

    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="Vector Decompose",
            category="Processing",
            description="file:details.md",
            inputs=[
                PortDefinition(
                    name="vector",
                    type=PortType.VECTOR,
                    description=(
                        "Inbound SVG data stream (raw SVG XML). Supply a complete, "
                        "well-formed SVG document so all element classes can be "
                        "parsed and dispatched correctly."
                    ),
                ),
            ],
            outputs=[
                PortDefinition(
                    name="path",
                    type=PortType.PATH,
                    description=(
                        "PATH channel: geometry converted from SVG <path> elements. "
                        "Each item carries a closed flag and line segments with "
                        "from/to coordinates, ready for plotter-oriented downstream nodes."
                    ),
                ),
                PortDefinition(
                    name="text_vector",
                    type=PortType.VECTOR,
                    description=(
                        "VECTOR channel: SVG fragment containing only <text> and "
                        "<tspan> elements, with canvas context preserved. Returns "
                        "an empty SVG shell if no text elements are present."
                    ),
                ),
                PortDefinition(
                    name="lines_vector",
                    type=PortType.VECTOR,
                    description=(
                        "VECTOR channel: SVG fragment containing only <line> and "
                        "<polyline> elements. Remains SVG XML rather than PATH objects, "
                        "enabling element-class-specific branch processing."
                    ),
                ),
                PortDefinition(
                    name="shapes_vector",
                    type=PortType.VECTOR,
                    description=(
                        "VECTOR channel: SVG fragment containing <rect>, <circle>, "
                        "<ellipse>, and <polygon> elements. Output is SVG XML, "
                        "preserving shape semantics for downstream vector operations."
                    ),
                ),
                PortDefinition(
                    name="raster_image",
                    type=PortType.IMAGE,
                    description=(
                        "IMAGE channel (base64 PNG): decoded from the first embedded "
                        "<image> element in the document. Only the first raster element "
                        "is extracted. Returns a transparent 1x1 PNG if none is found."
                    ),
                ),
            ],
            parameters=[
                ParameterDefinition(
                    name="flatten_transforms",
                    type="boolean",
                    default=True,
                    description=(
                        "Bakes SVG transforms (translate/scale/rotate/matrix) into "
                        "element coordinates before dispatch. true = coordinates match "
                        "screen placement. false = original coord space with "
                        "transform attributes preserved."
                    ),
                ),
                ParameterDefinition(
                    name="include_hidden",
                    type="boolean",
                    default=False,
                    description=(
                        "Include elements hidden by display:none, visibility:hidden, "
                        "or opacity:0. Default false routes only visible content; "
                        "set true to inspect or process concealed elements."
                    ),
                ),
                ParameterDefinition(
                    name="path_simplification",
                    type="number",
                    default=0.0,
                    min=0.0,
                    max=5.0,
                    step=0.1,
                    description=(
                        "Douglas-Peucker tolerance applied to the path output channel. "
                        "0.0 preserves full detail. Higher values (up to 5.0) reduce "
                        "point count for cleaner paths at the cost of geometric precision."
                    ),
                ),
                ParameterDefinition(
                    name="default_viewbox_size",
                    type="number",
                    default=1000,
                    min=100,
                    max=10000,
                    step=100,
                    description=(
                        "Fallback canvas size when the input SVG lacks a usable viewBox "
                        "and has no width/height attributes. Range 100–10000; affects "
                        "the default coordinate space scale for all output channels."
                    ),
                ),
            ],
        )

    # ------------------------------------------------------------------
    # Main processing
    # ------------------------------------------------------------------

    async def process(
        self, inputs: dict[str, Any], params: dict[str, Any]
    ) -> dict[str, Any]:
        """Decompose an SVG document into element-type buckets."""

        # --- Validate inputs ------------------------------------------
        vector_input: str | None = (inputs or {}).get("vector")
        if not vector_input or not isinstance(vector_input, str):
            raise ValueError("Missing or invalid vector input")

        # --- Read parameters ------------------------------------------
        flatten_transforms: bool = bool(params.get("flatten_transforms", True))
        include_hidden: bool = bool(params.get("include_hidden", False))
        path_simplification: float = float(params.get("path_simplification", 0.0))
        default_viewbox_size: int = int(params.get("default_viewbox_size", 1000))

        bezier_tolerance = path_simplification if path_simplification > 0 else 0.5

        # --- Parse SVG ------------------------------------------------
        try:
            root = ET.fromstring(vector_input)
        except ET.ParseError as exc:
            raise ValueError(f"Failed to parse SVG input: {exc}") from exc

        # --- Extract viewBox, width, height ---------------------------
        viewbox = root.get("viewBox", "")
        width = root.get("width")
        height = root.get("height")
        if not viewbox:
            if width and height:
                # Derive viewBox from width/height (strip units for safety).
                w_num = re.sub(r"[^0-9.]", "", width)
                h_num = re.sub(r"[^0-9.]", "", height)
                viewbox = f"0 0 {w_num} {h_num}"
            else:
                viewbox = f"0 0 {default_viewbox_size} {default_viewbox_size}"

        # --- Collection buckets ---------------------------------------
        path_objects: list[dict[str, Any]] = []
        text_elements: list[ET.Element] = []
        line_elements: list[ET.Element] = []
        shape_elements: list[ET.Element] = []
        first_image_data: str | None = None  # base64 PNG of 1st image
        first_image_seen: bool = False

        # --- Recursive walk -------------------------------------------
        def _walk(elem: ET.Element, parent_mat: np.ndarray) -> None:
            nonlocal first_image_data, first_image_seen

            mat = _get_element_matrix(elem, parent_mat) if flatten_transforms else parent_mat
            tag = _local_tag(elem)

            # Skip hidden elements (unless include_hidden is set).
            if not include_hidden and _is_hidden(elem):
                return

            # --- Classify element -------------------------------------
            if tag in _PATH_TAGS:
                _process_path_element(elem, mat, path_objects, bezier_tolerance, flatten_transforms)

            elif tag in _TEXT_TAGS:
                if tag == "text":
                    collected = _deep_copy_element(elem)
                    if flatten_transforms:
                        _apply_transform_to_element(collected, mat)
                    text_elements.append(collected)
                    return  # Don't recurse into text children
                elif tag == "tspan":
                    # Standalone tspan outside text — wrap in a text element
                    wrapper = ET.Element(f"{{{SVG_NS}}}text")
                    collected = _deep_copy_element(elem)
                    if flatten_transforms:
                        # Copy position attributes from tspan to wrapper for transform
                        for attr in ("x", "y"):
                            val = elem.get(attr)
                            if val:
                                wrapper.set(attr, val)
                        _apply_transform_to_element(wrapper, mat)
                    wrapper.append(collected)
                    text_elements.append(wrapper)

            elif tag in _LINE_TAGS:
                collected = _deep_copy_element(elem)
                if flatten_transforms:
                    _apply_transform_to_element(collected, mat)
                line_elements.append(collected)

            elif tag in _SHAPE_TAGS:
                collected = _deep_copy_element(elem)
                if flatten_transforms:
                    _apply_transform_to_element(collected, mat)
                shape_elements.append(collected)

            elif tag in _IMAGE_TAGS and not first_image_seen:
                first_image_seen = True
                first_image_data = _extract_raster(elem)

            # Recurse into children (groups, defs, etc.).
            for child in elem:
                _walk(child, mat)

        # Kick off the walk from root's children (root itself is <svg>).
        root_mat = np.eye(3)
        if flatten_transforms:
            root_mat = _get_element_matrix(root, np.eye(3))
        for child in root:
            _walk(child, root_mat)

        # --- Douglas-Peucker simplification ---------------------------
        if path_simplification > 0:
            path_objects = _simplify_path_objects(path_objects, path_simplification)

        # --- Build SVG fragments for vector outputs -------------------
        text_svg = _build_svg_fragment(viewbox, width, height, text_elements)
        lines_svg = _build_svg_fragment(viewbox, width, height, line_elements)
        shapes_svg = _build_svg_fragment(viewbox, width, height, shape_elements)

        # --- Raster output (fallback: transparent 1×1 PNG) ------------
        raster_output = first_image_data if first_image_data else _transparent_1x1_png()

        return {
            "path": path_objects,
            "text_vector": text_svg,
            "lines_vector": lines_svg,
            "shapes_vector": shapes_svg,
            "raster_image": raster_output,
        }


# ======================================================================
# Element-level processing helpers
# ======================================================================

def _process_path_element(
    elem: ET.Element,
    mat: np.ndarray,
    path_objects: list[dict[str, Any]],
    tolerance: float,
    flatten: bool,
) -> None:
    """Convert a <path> element into one or more PathObject dicts."""
    d_attr = elem.get("d", "").strip()
    if not d_attr:
        return  # Skip silently.

    subpaths = _parse_svg_path_d(d_attr, tolerance)

    for sp in subpaths:
        points: list[tuple[float, float]] = sp["points"]
        closed: bool = sp["closed"]

        if len(points) < 2:
            continue

        # Optionally apply transform to all points.
        if flatten:
            points = [_apply_matrix_to_point(mat, px, py) for px, py in points]

        # Build line segments.
        segments: list[dict[str, Any]] = []
        for i in range(len(points) - 1):
            segments.append({
                "type": "line",
                "from": list(points[i]),
                "to": list(points[i + 1]),
                "meta": dict(_DEFAULT_META),
            })

        # Closing segment.
        if closed and len(points) >= 2:
            dist = math.hypot(
                points[-1][0] - points[0][0],
                points[-1][1] - points[0][1],
            )
            if dist > 1e-6:
                segments.append({
                    "type": "line",
                    "from": list(points[-1]),
                    "to": list(points[0]),
                    "meta": dict(_DEFAULT_META),
                })

        if segments:
            path_objects.append({"segments": segments, "closed": closed})


def _deep_copy_element(elem: ET.Element) -> ET.Element:
    """Create a shallow-ish copy of an element including its children and text."""
    new = ET.Element(elem.tag, elem.attrib)
    new.text = elem.text
    new.tail = elem.tail
    for child in elem:
        new.append(_deep_copy_element(child))
    return new


def _extract_raster(elem: ET.Element) -> str | None:
    """Extract an embedded raster image from an <image> element.

    Returns a base64-encoded PNG string, or None if extraction fails.
    """
    href = elem.get("href") or elem.get(f"{{{XLINK_NS}}}href")
    if not href:
        return None

    # Handle data-URI encoded images.
    data_match = re.match(r"data:image/[^;]+;base64,(.*)", href, re.DOTALL)
    if not data_match:
        return None  # External URL or unsupported encoding.

    try:
        raw_b64 = data_match.group(1)
        img = decode_image(raw_b64)
        return encode_image(img)
    except Exception:
        return None


# Module-level alias required by the plugin loader.
Plugin = VectorDecompose

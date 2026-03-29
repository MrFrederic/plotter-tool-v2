"""Helpers for converting between G-code motion and canonical PATH objects."""
from __future__ import annotations

import math
import re
from typing import Any

DEFAULT_SEGMENT_META: dict[str, float | None] = {"width": None, "speed": None}
_WORD_RE = re.compile(r"([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)")
_PAREN_COMMENT_RE = re.compile(r"\([^)]*\)")


def strip_inline_comments(line: str) -> str:
    """Remove semicolon and parenthesized comments from one G-code line."""
    no_paren = _PAREN_COMMENT_RE.sub("", line)
    return no_paren.split(";", 1)[0].strip()


def gcode_to_paths(gcode: str) -> list[dict[str, Any]]:
    """Parse G0/G1/G2/G3 motion commands into canonical PATH objects."""
    paths: list[dict[str, Any]] = []
    current_segments: list[dict[str, Any]] = []

    current_x = 0.0
    current_y = 0.0
    absolute_mode = True
    unit_scale = 1.0
    motion_mode = 0

    def flush_path() -> None:
        if not current_segments:
            return
        closed = _path_is_closed(current_segments)
        paths.append({"closed": closed, "segments": list(current_segments)})
        current_segments.clear()

    for raw_line in gcode.splitlines():
        line = strip_inline_comments(raw_line)
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
            current_segments.append({
                "type": "line",
                "from": [current_x, current_y],
                "to": [target_x, target_y],
                "meta": dict(DEFAULT_SEGMENT_META),
            })
        else:
            raw_i = next((value for letter, value in words if letter == "I"), None)
            raw_j = next((value for letter, value in words if letter == "J"), None)
            raw_r = next((value for letter, value in words if letter == "R"), None)

            center: tuple[float, float] | None = None
            if raw_i is not None and raw_j is not None:
                center = (current_x + raw_i * unit_scale, current_y + raw_j * unit_scale)
            elif raw_r is not None:
                center = center_from_radius_arc(
                    x0=current_x,
                    y0=current_y,
                    x1=target_x,
                    y1=target_y,
                    radius=raw_r * unit_scale,
                    clockwise=motion_mode == 2,
                )

            if center is None:
                current_segments.append({
                    "type": "line",
                    "from": [current_x, current_y],
                    "to": [target_x, target_y],
                    "meta": dict(DEFAULT_SEGMENT_META),
                })
            else:
                current_segments.append({
                    "type": "arc",
                    "from": [current_x, current_y],
                    "to": [target_x, target_y],
                    "center": [center[0], center[1]],
                    "clockwise": motion_mode == 2,
                    "meta": dict(DEFAULT_SEGMENT_META),
                })

        current_x, current_y = target_x, target_y

    flush_path()
    return paths


def center_from_radius_arc(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    radius: float,
    clockwise: bool,
) -> tuple[float, float] | None:
    """Compute the arc center for a G2/G3 move using R-parameter form."""
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


def _path_is_closed(segments: list[dict[str, Any]], tolerance: float = 1e-9) -> bool:
    """Infer whether a motion path closes back on its start point."""
    if not segments:
        return False
    start = segments[0].get("from") or [0.0, 0.0]
    end = segments[-1].get("to") or [0.0, 0.0]
    return math.hypot(end[0] - start[0], end[1] - start[1]) <= tolerance

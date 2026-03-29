The **Path Filter** node evaluates each incoming path against a configurable predicate and routes the stream to two discrete outputs: `path_pass` for geometry that satisfies the condition, and `path_fail` for geometry that does not. Use this node to selectively retain, discard, or redirect paths based on properties such as length, enclosed area, or topological class.

# Path Filter

Every path entering this node is evaluated against a single configurable predicate. Paths that satisfy the condition are cleared through `path_pass`; those that do not are routed to `path_fail`. Both output channels carry live geometry — connect them both to keep full control over your data stream.

## Filter Modes

**`closed_open`** — Reads the path's `closed` flag. `keep_closed=true` authorizes closed paths; `keep_closed=false` authorizes open paths.

**`min_segments`** — Counts segments in the path. Paths meeting or exceeding `min_segment_count` are cleared.

**`min_length`** — Sums endpoint-to-endpoint segment distances. Paths meeting or exceeding `min_total_length` are cleared.

**`bbox_area`** — Computes axis-aligned bounding box width × height. Paths meeting or exceeding `min_bbox_area` are cleared.

**`has_arcs`** — Scans segments for type `arc`. `keep_with_arcs=true` clears arc-bearing paths; `keep_with_arcs=false` clears line-only paths.

## Invert

The `invert` toggle swaps the two output channels after the predicate runs — paths headed for `path_pass` are redirected to `path_fail`, and vice versa. No thresholds change; only the routing flips. Use it when you need the opposite result set without reconfiguring the filter.

## Parameters

| Parameter | Type | Visible when | Notes |
|---|---|---|---|
| `filter_mode` | select | always | Active predicate: `closed_open`, `min_segments`, `min_length`, `bbox_area`, `has_arcs`. |
| `keep_closed` | boolean | `filter_mode=closed_open` | `true` → closed paths pass. `false` → open paths pass. |
| `min_segment_count` | number 1–10000 | `filter_mode=min_segments` | Minimum segment count required to clear. |
| `min_total_length` | number 0–100000 | `filter_mode=min_length` | Minimum total path length required to clear. |
| `min_bbox_area` | number 0–1000000 | `filter_mode=bbox_area` | Minimum bounding-box area required to clear. |
| `keep_with_arcs` | boolean | `filter_mode=has_arcs` | `true` → arc paths pass. `false` → line-only paths pass. |
| `invert` | boolean | always | Swaps pass and fail output channels after filtering. |

## Typical Workflows

1. **Strip noise before plotting** — Set `filter_mode=min_length` with a low `min_total_length` threshold. Route `path_pass` to your output node; discard or inspect `path_fail`.

2. **Separate closed shapes from open strokes** — Set `filter_mode=closed_open`, `keep_closed=true`. Feed `path_pass` into a fill pipeline and `path_fail` into a stroke pipeline.

3. **Isolate arc geometry** — Set `filter_mode=has_arcs`, `keep_with_arcs=true`. Route `path_pass` to an arc-aware converter and `path_fail` to a line-optimized branch.

## Tips

- Connect both `path_pass` and `path_fail` during setup — inspecting both channels reveals exactly what the threshold is catching.
- If the result looks backwards, toggle `invert` before touching any threshold.
- Tune one parameter at a time; small incremental changes prevent accidental loss of useful geometry.
- Chain multiple Path Filter nodes in series to apply compound conditions (e.g., min-length then closed-only).

## Limitations

- `min_length` uses straight endpoint-to-endpoint distance per segment — arc chord length, not true curve length, is measured.
- `bbox_area` is axis-aligned — rotated geometry produces a larger bounding box than the path's true footprint.
- The predicate operates on path structure only (`closed` flag, `segments` array); style metadata and external context are not accessible to the filter.

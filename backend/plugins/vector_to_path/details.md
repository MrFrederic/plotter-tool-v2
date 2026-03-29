**Vector to Path** compiles all geometric content in an SVG document into a single unified PATH output. Unlike Vector Decompose, this node does not route to multiple ports — all element types are flattened into one plotter-ready stream for downstream processing.

# Vector to Path

This node interfaces with an SVG document and compiles every geometric element into the pipeline's internal PATH format. Where Vector Decompose routes elements to separate output ports, this node normalizes them into a single unified output — one stream, all shapes. Curves, arcs, and optionally text are flattened into plotter-ready segments ready for downstream processing.

**Inputs:** `vector` (VECTOR — SVG XML text)  
**Outputs:** `path` (PATH)

## Supported Elements

| Element | Behavior |
|---|---|
| `<path>` | `d`-commands parsed and converted; Bézier curves flattened by `curve_tolerance`; circular arcs optionally preserved |
| `<line>` | One open segment |
| `<polyline>` | Open path through listed points |
| `<polygon>` | Closed path (last point connects to first) |
| `<rect>` | Closed path; rounded corners (`rx`/`ry`) approximated |
| `<circle>` | Closed segmented path via `arc_segments` |
| `<ellipse>` | Closed segmented path via `arc_segments` |
| `<text>` | Approximate outline geometry when `include_text=true` (not exact font curves) |
| Hidden elements | Included only when `include_hidden=true` |

## Parameters

- **`flatten_transforms`** _(boolean, default `true`)_ — Bakes SVG transforms directly into coordinates. Keep enabled or output geometry may be shifted, rotated, or scaled incorrectly.

- **`curve_tolerance`** _(number, 0.001–5.0, default `0.5`)_ — Controls how closely Bézier curves are approximated. Lower = more accurate, more segments. Start at `0.5`; lower only when curves look faceted.

- **`arc_segments`** _(number, 4–128, default `32`)_ — Segment count for circles, ellipses, and non-preserved arcs. More = smoother geometry, heavier output. Increase when circles appear polygonal in preview.

- **`include_text`** _(boolean, default `true`)_ — Converts `<text>` elements into PATH geometry. Disable if labels or annotations should not be plotted.

- **`include_hidden`** _(boolean, default `false`)_ — Processes elements hidden by `display:none`, `visibility:hidden`, or `opacity:0`. Leave off for production; enable only to diagnose missing geometry.

- **`stroke_to_path`** _(boolean, default `false`)_ — Expands stroke width into closed outline geometry. Enable when physical pen width or cutting boundary matters.

- **`min_segment_length`** _(number, 0.0–100.0, default `0.0`)_ — Discards segments below this threshold after conversion. `0.0` keeps all. Raise slightly (e.g. `0.1`–`0.5`) to filter noise from complex imported files.

## Common Workflows

- **Standard design-to-toolpath:** SVG input → Vector to Path (defaults) → path ordering node → G-code output.
- **High-fidelity curves:** Lower `curve_tolerance` to `0.1`, raise `arc_segments` to `64`, enable `flatten_transforms`. Preview before export.
- **Stroke-accurate output:** Enable `stroke_to_path` when the SVG uses stroked lines that should translate into real outline geometry for the plotter.

## Tips

- Always enable `flatten_transforms` unless you're explicitly handling transforms in a downstream node.
- Reducing `curve_tolerance` below `0.1` rarely improves visible quality but significantly increases segment count.
- Use `min_segment_length` to clean up noisy exports from tools like Illustrator or Inkscape before further processing.
- If shapes are missing from output, check `include_hidden` — they may be present but flagged invisible in the source file.

## Limitations

- Text conversion produces approximate outlines only. Exact font geometry is not preserved.
- Disabling `flatten_transforms` with nested group transforms will produce incorrect final coordinates.
- Very low `curve_tolerance` or very high `arc_segments` can generate large path payloads and slow downstream nodes.
- Hidden element handling is all-or-nothing; there is no per-layer visibility control within this node.

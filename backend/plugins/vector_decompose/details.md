**Vector Decompose** parses an inbound SVG document and dispatches its elements to dedicated output ports by class — path geometry, text, lines, shapes, and embedded raster images. Each output channel carries only its element type, enabling independent processing branches downstream.

# Vector Decompose

Parses an inbound SVG data stream and dispatches its elements to dedicated output ports by class. Different parts of the same artwork are routed through separate channels, enabling element-specific processing branches. The node does not alter what you don't connect — only wired outputs are evaluated.

## Output Channels

| Port | Element Types | Data Format |
|---|---|---|
| `path` | `<path>` | PATH objects — line segments with `from`/`to` coords and `closed` flag |
| `text_vector` | `<text>`, `<tspan>` | VECTOR — SVG XML fragment |
| `lines_vector` | `<line>`, `<polyline>` | VECTOR — SVG XML fragment |
| `shapes_vector` | `<rect>`, `<circle>`, `<ellipse>`, `<polygon>` | VECTOR — SVG XML fragment |
| `raster_image` | First `<image>` | IMAGE — base64 PNG |

> Only the **first** embedded raster image is extracted; subsequent `<image>` elements are discarded.

## Parameters

- **`flatten_transforms`** (boolean) — Bakes SVG transforms into coordinates before dispatch. `true` = coordinates match screen placement. `false` = original coord space with transforms preserved.
- **`include_hidden`** (boolean, default `false`) — Include elements hidden by `display:none`, `visibility:hidden`, or `opacity:0`. Leave off unless you are debugging concealed content.
- **`path_simplification`** (0.0–5.0) — Douglas-Peucker tolerance on `path` output. `0.0` = full detail. Higher values reduce point count at the cost of precision.
- **`default_viewbox_size`** (100–10000) — Fallback canvas size when the SVG has no usable `viewBox` or dimensions.

## Typical Workflows

1. **Separate geometry from annotation** — Route `path` to a toolpath node, `text_vector` to a label-preview branch.
2. **Element-class cleanup** — Send `lines_vector` and `shapes_vector` to separate vector-normalization nodes before final merge.
3. **Hybrid file decomposition** — Extract `raster_image` for image-processing while vector channels continue through their own pipeline branches.

## Tips

- Preview each output port immediately after the node to verify routing before building downstream branches.
- If coordinates are misaligned, `flatten_transforms` is the first parameter to check.
- Enable `include_hidden` temporarily when expected elements appear missing.
- Keep `path_simplification` at `0.0` during development; increase only at the final export stage.

## Limitations

- Only the **first** embedded `<image>` is extracted; subsequent raster elements are silently discarded.
- `text_vector`, `lines_vector`, and `shapes_vector` remain SVG fragments — they are not converted to PATH objects.
- Curves and arcs in `<path>` elements are flattened to line segments in the `path` output channel.
- `<use>` references and `<symbol>` definitions are not resolved into discrete element classes.

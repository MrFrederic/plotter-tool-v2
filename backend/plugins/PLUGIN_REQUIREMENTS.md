# Plugin Requirements Specification

> **Status:** Draft  
> **Date:** 2025-03-27  
> **Audience:** Developer sub-agent implementing these plugins  
> **Scope:** 6 new backend processing plugins for the plotter pipeline tool

---

## Data Type Notes

All plugins communicate through typed ports. The internal formats are:

| PortType | Internal Representation |
|----------|------------------------|
| **IMAGE** | Base64-encoded PNG string. Use `app.image_utils.encode_image(np.ndarray) -> str` to encode and `app.image_utils.decode_image(str) -> np.ndarray` to decode. OpenCV BGR channel order applies to the NumPy array. |
| **VECTOR** | SVG XML string (UTF-8). A complete or partial SVG document parseable by `xml.etree.ElementTree`. |
| **PATH** | `list[PathObject]`. Each `PathObject` is a dict: `{"closed": bool, "segments": [Segment...]}`. A **line** segment: `{"type": "line", "from": [x, y], "to": [x, y], "meta": {"width": null, "speed": null}}`. An **arc** segment adds: `"center": [x, y], "clockwise": bool`. |
| **GCODE** | String of G-code instructions. |
| **TEXT** | Arbitrary text string. |
| **OTHER** | Any JSON-serialisable data. |

## Conventions

1. **Canonical PATH port key:** Use `path` (singular) for all PATH-type input and output port names, unless a plugin has multiple PATH ports that must be disambiguated (e.g., `path_a`, `path_b`, `path_pass`, `path_fail`).
2. **Module export:** Every plugin file must end with `Plugin = ClassName`.
3. **Imports:** Plugins import from `app.plugin_base` (`BasePlugin`, `PluginSchema`, `PortDefinition`, `PortType`, `ParameterDefinition`) and `app.image_utils` as needed. External dependencies are limited to those in `requirements.txt`: `cv2`, `numpy`, `shapely`, `Pillow`, plus the Python standard library.
4. **Async process:** The `process()` method is `async def` even if the work is CPU-bound. No blocking I/O should occur; CPU work is acceptable inline.
5. **Error handling pattern:** Raise `ValueError` with a clear, user-facing message for invalid inputs or parameter states. Never silently swallow errors that would produce corrupt output data.
6. **Segment meta:** When creating new segments, always include a `"meta"` key with at minimum `{"width": null, "speed": null}` unless inheriting meta from a source segment.

---

## Plugin 1: Edge Detection

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Edge Detection"` |
| **Category** | `"Processing"` |
| **File Name** | `edge_detection.py` |
| **Class Name** | `EdgeDetection` |
| **Module Export** | `Plugin = EdgeDetection` |

### Description

Detects edges in a raster image using configurable computer-vision algorithms (Canny, Sobel, or Laplacian) and converts the resulting contours into PATH-format line segments. Supports pre-processing options such as grayscale conversion and Gaussian blur, plus post-processing controls for contour simplification and minimum-length filtering. Designed for converting photographic or raster artwork into plottable vector outlines.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `image` | IMAGE | The source raster image (base64 PNG) to run edge detection on. Accepts colour or grayscale input. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | Detected edges expressed as PATH-format line segments. Each contour from the image becomes one PathObject. Closed contours have `closed: true`. |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `algorithm` | select | `"canny"` | Options: `["canny", "sobel", "laplacian"]` | The edge-detection algorithm to apply. **Canny** produces binary edges using a double-threshold hysteresis approach and is best for clean, well-defined contours. **Sobel** computes gradient magnitude in both axes and is useful for emphasising directional edges. **Laplacian** computes the second derivative and highlights rapid intensity changes; it tends to produce thinner but noisier edges. Choose based on input characteristics and desired output fidelity. |
| `low_threshold` | number | `50` | Min: 0, Max: 255, Step: 1 | *Canny only.* The lower hysteresis threshold. Pixels with gradient magnitude below this value are rejected. Lower values include more subtle edges but increase noise. Ignored when algorithm is not Canny. |
| `high_threshold` | number | `150` | Min: 0, Max: 255, Step: 1 | *Canny only.* The upper hysteresis threshold. Pixels with gradient magnitude above this value are accepted as strong edges immediately. The gap between low and high controls how aggressively weak edges connected to strong edges are included. Ignored when algorithm is not Canny. |
| `kernel_size` | select | `"3"` | Options: `["1", "3", "5", "7"]` | *Sobel and Laplacian.* The size of the derivative kernel. Larger kernels smooth noise but reduce spatial precision. Must be an odd positive integer. Ignored when algorithm is Canny. |
| `blur_kernel_size` | number | `5` | Min: 1, Max: 31, Step: 2 | The size of the Gaussian blur kernel applied before edge detection. Must be odd; if an even number is provided, round up to the next odd integer. Larger values smooth out noise at the cost of edge sharpness. Set to 1 to disable blurring. |
| `simplification_tolerance` | number | `1.0` | Min: 0.0, Max: 10.0, Step: 0.1 | The epsilon value for the Douglas-Peucker polygon approximation (`cv2.approxPolyDP`). Higher values produce fewer, straighter segments with less fidelity to the original contour shape. Set to 0 to keep all contour points. Useful for reducing output complexity for pen plotters. |
| `min_contour_length` | number | `10` | Min: 0, Max: 1000, Step: 1 | The minimum number of pixels (arc-length) a contour must span to be included in the output. Contours shorter than this threshold are discarded. Increase to filter out noise or tiny artefacts in the source image. |
| `invert` | boolean | `false` | — | When enabled, the edge-detection output is bitwise-inverted before contour extraction. This effectively swaps foreground and background, which can be useful when the subject is lighter than the background. |
| `grayscale` | boolean | `true` | — | When enabled, the input image is converted to single-channel grayscale before processing. If the image is already single-channel, this is a no-op. Disable only when intentionally processing a pre-prepared single-channel image and the upstream format is ambiguous. |

### Processing Flow

1. **Decode image** — Call `decode_image(inputs["image"])` to obtain a NumPy array (BGR or grayscale).
2. **Grayscale conversion** — If `grayscale` is `true` and the image has more than one channel, convert using `cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)`. If already single-channel, skip.
3. **Gaussian blur** — Apply `cv2.GaussianBlur` with kernel size `(blur_kernel_size, blur_kernel_size)` and `sigmaX=0`. Ensure kernel size is odd; if even, increment by 1.
4. **Edge detection** — Based on `algorithm`:
   - **Canny:** `cv2.Canny(blurred, low_threshold, high_threshold)`.
   - **Sobel:** Compute `cv2.Sobel` in X and Y directions with `ksize=int(kernel_size)`, take absolute values, sum, and threshold to binary using `cv2.threshold` (Otsu or fixed at 127).
   - **Laplacian:** `cv2.Laplacian(blurred, cv2.CV_64F, ksize=int(kernel_size))`, take absolute value, convert to uint8, threshold to binary.
5. **Invert** — If `invert` is `true`, apply `cv2.bitwise_not` to the binary edge image.
6. **Find contours** — `cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)`. Use `RETR_LIST` to get all contours without hierarchy.
7. **Simplify contours** — For each contour, apply `cv2.approxPolyDP(contour, simplification_tolerance, closed=True)`.
8. **Filter by length** — Compute `cv2.arcLength(contour, closed)` for each contour; discard those shorter than `min_contour_length`.
9. **Convert to PATH** — For each surviving contour, build a `PathObject`:
   - Determine `closed`: true if first and last point coincide (within 1px) or if the original contour was detected as closed.
   - Create line segments between consecutive points. Each segment: `{"type": "line", "from": [x, y], "to": [x, y], "meta": {"width": null, "speed": null}}`.
   - If closed, add a closing segment from last point back to the first point.
10. **Return** — `{"path": path_list}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| `image` input is missing or not a string | Raise `ValueError("Missing or invalid image input")` |
| Image decode fails | Raise `ValueError("Failed to decode input image")` |
| `blur_kernel_size` is even | Silently round up to next odd integer |
| `low_threshold` >= `high_threshold` (Canny) | Raise `ValueError("low_threshold must be less than high_threshold")` |
| No contours found after filtering | Return `{"path": []}` (empty list, no error) |

### Acceptance Criteria

1. Given a solid-white image, output is an empty PATH list (no edges).
2. Given a 100×100 image with a black rectangle on white background and Canny defaults, output contains at least one closed PathObject whose points approximate the rectangle corners.
3. Changing `algorithm` from `"canny"` to `"sobel"` produces a non-empty PATH output for a non-trivial input image.
4. Setting `min_contour_length` to 99999 on a small image produces an empty PATH list.
5. Setting `simplification_tolerance` to 0 produces more segments than setting it to 5.0 on the same input.
6. The `invert` toggle changes the output for an image with both dark and light regions.
7. All returned segments have correct structure: `type`, `from`, `to`, `meta` keys present.
8. Output port key is `"path"` (singular).

---

## Plugin 2: Vector Decompose

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Vector Decompose"` |
| **Category** | `"Processing"` |
| **File Name** | `vector_decompose.py` |
| **Class Name** | `VectorDecompose` |
| **Module Export** | `Plugin = VectorDecompose` |

### Description

Decomposes an SVG document into its constituent element types, routing each category to a dedicated output port. Path elements are converted to the internal PATH format; text, lines, shapes, and embedded raster images are output as separate VECTOR or IMAGE ports. Enables selective downstream processing of different SVG content types within a single pipeline.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `vector` | VECTOR | A complete SVG XML string to decompose. Must be valid, well-formed SVG. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | All `<path>` elements extracted and converted to internal PATH segments. Each SVG `<path>` becomes one PathObject. |
| `text_vector` | VECTOR | An SVG fragment containing only `<text>` and `<tspan>` elements, preserving the original viewBox and XML namespace. Empty SVG if no text elements exist. |
| `lines_vector` | VECTOR | An SVG fragment containing only `<line>` and `<polyline>` elements, preserving the original viewBox and XML namespace. Empty SVG if no such elements exist. |
| `shapes_vector` | VECTOR | An SVG fragment containing only `<rect>`, `<circle>`, `<ellipse>`, and `<polygon>` elements, preserving the original viewBox and XML namespace. Empty SVG if no shape elements exist. |
| `raster_image` | IMAGE | The first embedded `<image>` element found in the SVG, decoded to a base64 PNG. If no embedded image exists, output a transparent 1×1 PNG. |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `flatten_transforms` | boolean | `true` | — | When enabled, all parent-level `transform` attributes (translate, rotate, scale, matrix) are applied to child element coordinates before extraction. This ensures each output fragment reflects the element's actual rendered position. Disable to preserve the raw SVG coordinate structure, which may be useful when transforms are handled downstream. |
| `include_hidden` | boolean | `false` | — | When enabled, elements with `display:none`, `visibility:hidden`, or `opacity:0` are included in the output. By default these are skipped, matching what a renderer would show. Enable when you need to recover hidden layers or template elements from the SVG. |
| `path_simplification` | number | `0.0` | Min: 0.0, Max: 5.0, Step: 0.1 | Simplification tolerance applied to PATH output segments using Douglas-Peucker approximation. Set to 0 to preserve full path fidelity. Increase to reduce the number of segments in complex paths, trading precision for simpler output. Only affects the `path` output port. |
| `default_viewbox_size` | number | `1000` | Min: 100, Max: 10000, Step: 100 | Fallback viewBox dimension (used for both width and height) if the input SVG lacks a `viewBox` attribute. This ensures the output SVG fragments have a defined coordinate space. Only applied when the source SVG has no viewBox, width, or height attributes. |

### Processing Flow

1. **Parse SVG** — Parse the input string with `xml.etree.ElementTree.fromstring()`. Handle SVG namespace (`http://www.w3.org/2000/svg`).
2. **Determine viewBox** — Extract the `viewBox` attribute from the root `<svg>`. If absent, construct a fallback: `"0 0 {default_viewbox_size} {default_viewbox_size}"`. Also extract `width` and `height` if present.
3. **Walk element tree** — Recursively iterate all descendant elements. Track cumulative transforms if `flatten_transforms` is enabled.
4. **Visibility filter** — If `include_hidden` is `false`, skip elements whose computed style includes `display:none`, `visibility:hidden`, or `opacity` equal to `"0"`. Check both inline `style` attributes and direct XML attributes.
5. **Classify elements** — By local tag name (strip SVG namespace prefix):
   - `path` → collect for PATH conversion
   - `text`, `tspan` → collect for text_vector
   - `line`, `polyline` → collect for lines_vector
   - `rect`, `circle`, `ellipse`, `polygon` → collect for shapes_vector
   - `image` → collect for raster extraction
   - All other elements (e.g., `<g>`, `<defs>`, `<clipPath>`) are structural and not output directly.
6. **Build SVG fragments** — For `text_vector`, `lines_vector`, `shapes_vector`: create a new SVG root element with the same `viewBox`, `xmlns`, `width`, `height` as the source. Append the collected elements (with transforms applied if `flatten_transforms`). Serialise to an XML string.
7. **Convert `<path>` to PATH** — For each `<path>` element:
   - Parse the `d` attribute into move/line/curve/arc commands.
   - Convert cubic and quadratic Bézier curves into sequences of line segments (use a reasonable default tolerance, e.g., 0.5px, or the `path_simplification` value if > 0).
   - Convert SVG arc commands (`A`/`a`) into arc segments with `center`, `clockwise` fields where possible, falling back to line-segment approximation for complex arcs.
   - Build a PathObject with `closed` set to `true` if the sub-path ends with a `Z`/`z` command.
   - If `flatten_transforms`, apply the cumulative transform matrix to all point coordinates.
   - If `path_simplification` > 0, apply Douglas-Peucker simplification to reduce segment count.
8. **Extract raster image** — Find the first `<image>` element. Decode its `href` or `xlink:href`:
   - If it is a `data:image/...;base64,...` URI, decode the base64 payload, re-encode as PNG via `encode_image(decode_image(...))` to normalise format.
   - If no `<image>` element exists, produce a transparent 1×1 PNG: create a `np.zeros((1, 1, 4), dtype=np.uint8)` array and encode it.
9. **Return** — `{"path": path_list, "text_vector": text_svg_str, "lines_vector": lines_svg_str, "shapes_vector": shapes_svg_str, "raster_image": raster_b64}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| `vector` input is missing or not a string | Raise `ValueError("Missing or invalid vector input")` |
| SVG XML is malformed / unparseable | Raise `ValueError("Failed to parse SVG input: {detail}")` |
| `<path>` element has missing or empty `d` attribute | Skip that path element silently; log a warning if logging is available |
| Embedded `<image>` has unsupported encoding | Skip; output transparent 1×1 PNG for `raster_image` |
| SVG has no recognisable elements | Return empty lists/empty SVG fragments for all outputs (no error) |

### Acceptance Criteria

1. An SVG with one `<path>`, one `<text>`, one `<rect>`, and one `<line>` produces non-empty data on all four corresponding output ports.
2. An SVG with no `<image>` elements produces a valid 1×1 transparent PNG on the `raster_image` output.
3. An SVG with `<path d="M 0 0 L 100 0 L 100 100 Z"/>` produces a closed PathObject with 3 line segments.
4. Setting `include_hidden=true` includes a `<rect style="display:none" .../>` in the `shapes_vector` output.
5. Setting `include_hidden=false` (default) excludes that same rect.
6. Setting `path_simplification` to a value > 0 produces fewer segments than 0 for a complex path.
7. The `text_vector` output is a valid SVG string parseable by `xml.etree.ElementTree`.
8. Output port keys match exactly: `path`, `text_vector`, `lines_vector`, `shapes_vector`, `raster_image`.

---

## Plugin 3: Path Combine

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Path Combine"` |
| **Category** | `"Processing"` |
| **File Name** | `path_combine.py` |
| **Class Name** | `PathCombine` |
| **Module Export** | `Plugin = PathCombine` |

### Description

Merges two PATH arrays into a single unified PATH output. Supports configurable ordering strategies and optional deduplication of geometrically identical segments. Useful for combining outputs from parallel processing branches before routing to a shared G-code generator or preview node.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path_a` | PATH | The first set of path objects to merge. Treated as the "A" collection for ordering purposes. |
| `path_b` | PATH | The second set of path objects to merge. Treated as the "B" collection for ordering purposes. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | The merged PATH array containing path objects from both inputs, ordered and optionally deduplicated per the parameter settings. |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `merge_order` | select | `"a_then_b"` | Options: `["a_then_b", "b_then_a", "interleave"]` | Controls the order in which path objects from the two inputs appear in the output. **a_then_b**: all of A's paths followed by all of B's paths. **b_then_a**: all of B's paths followed by all of A's paths. **interleave**: alternates one path from A, one from B, one from A, etc.; once one array is exhausted, the remainder of the other is appended. Choose based on desired plot order or grouping needs. |
| `remove_duplicates` | boolean | `false` | — | When enabled, geometrically duplicate path objects are removed from the merged result. Two paths are considered duplicates if every corresponding segment's `from` and `to` points are within the `duplicate_tolerance` distance of each other. Only the first occurrence is kept. Enable when merging overlapping layers that may share identical geometry. |
| `duplicate_tolerance` | number | `0.01` | Min: 0.0, Max: 10.0, Step: 0.01 | The maximum Euclidean distance between corresponding segment endpoints for two segments to be considered identical. Only relevant when `remove_duplicates` is enabled. Increase if coordinate rounding between upstream plugins causes near-but-not-exact matches. A value of 0 requires exact numeric equality. |

### Processing Flow

1. **Receive inputs** — Extract `path_a` and `path_b` from `inputs`. Both are `list[PathObject]`. If either is `None` or missing, treat as an empty list.
2. **Order** — Based on `merge_order`:
   - `"a_then_b"`: `combined = path_a + path_b`
   - `"b_then_a"`: `combined = path_b + path_a`
   - `"interleave"`: zip the two lists, taking one from each alternately. When one list is shorter, append the remaining elements from the longer list.
3. **Deduplicate** — If `remove_duplicates` is `true`:
   - Iterate through `combined`. For each path, compare against all previously kept paths.
   - Two PathObjects are duplicates if: they have the same number of segments, same `closed` value, and for each pair of corresponding segments the Euclidean distance between `from` points and between `to` points is ≤ `duplicate_tolerance`.
   - Keep the first occurrence; discard subsequent duplicates.
4. **Return** — `{"path": combined}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| Both `path_a` and `path_b` are missing | Return `{"path": []}` |
| One input is missing / None | Treat as empty list; merge proceeds with the other input only |
| Input contains malformed PathObjects (e.g., missing `segments`) | Raise `ValueError("Invalid path object in {port_name}: missing 'segments'")` |
| `duplicate_tolerance` is negative | Clamp to 0.0 silently |

### Acceptance Criteria

1. Two single-path inputs with `merge_order="a_then_b"` produce a 2-element PATH with A's path first.
2. `merge_order="interleave"` with A=[p1, p2, p3] and B=[p4, p5] produces [p1, p4, p2, p5, p3].
3. Two identical single-path inputs with `remove_duplicates=true` and `duplicate_tolerance=0.01` produce a 1-element PATH.
4. `remove_duplicates=false` (default) with identical inputs produces a 2-element PATH.
5. An empty `path_a` and non-empty `path_b` with any merge order produces exactly `path_b`'s contents.
6. Output port key is `"path"`.

---

## Plugin 4: Vector to Path

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Vector to Path"` |
| **Category** | `"Processing"` |
| **File Name** | `vector_to_path.py` |
| **Class Name** | `VectorToPath` |
| **Module Export** | `Plugin = VectorToPath` |

### Description

Converts all geometric content in an SVG document into internal PATH-format line segments, flattening curves, arcs, and optionally text outlines into plotter-ready polylines. Unlike Vector Decompose, this plugin produces a single unified PATH output rather than splitting by element type. Ideal as the final conversion step before G-code generation or path-level optimisation.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `vector` | VECTOR | A complete SVG XML string. All geometric elements within will be converted to PATH segments. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | All SVG geometry converted to line segments in PATH format. Curves and arcs are flattened to polylines. Each discrete SVG shape or sub-path becomes its own PathObject. |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `flatten_transforms` | boolean | `true` | — | When enabled, all `transform` attributes on elements and ancestor `<g>` groups are applied to point coordinates before conversion. Disable only if you intend to handle transforms in a separate downstream step. Disabling may result in incorrect geometry if the SVG uses nested transforms. |
| `curve_tolerance` | number | `0.5` | Min: 0.001, Max: 5.0, Step: 0.001 | The maximum allowed deviation (in SVG user units) between the original Bézier curve and the approximating polyline. Lower values produce more segments and higher fidelity; higher values produce fewer segments but coarser approximation. Affects cubic Bézier (`C`/`c`/`S`/`s`) and quadratic Bézier (`Q`/`q`/`T`/`t`) commands. |
| `arc_segments` | number | `32` | Min: 4, Max: 128, Step: 1 | The number of line segments used to approximate each SVG arc command (`A`/`a`) or circle/ellipse element. Also used for `<circle>`, `<ellipse>` discretisation. Higher values yield smoother curves at the cost of more segments. 16–32 is suitable for most plotters; increase for large-format or high-resolution output. |
| `include_text` | boolean | `true` | — | When enabled, attempts to convert `<text>` elements to path outlines. This uses basic glyph approximation and may not produce perfect results for all fonts. When disabled, text elements are silently skipped. Enable for SVGs where text is part of the design; disable if text has already been converted to paths or is not needed. |
| `include_hidden` | boolean | `false` | — | When enabled, elements with `display:none`, `visibility:hidden`, or `opacity:0` are processed and included in the output. By default, hidden elements are skipped to match the rendered appearance of the SVG. |
| `stroke_to_path` | boolean | `false` | — | When enabled, stroked shapes (elements with a `stroke` attribute and `stroke-width`) are converted into outlined (filled) path geometry representing the stroke's extent. This doubles the geometry for stroked-and-filled shapes. Enable when the physical stroke width matters for the plotter output (e.g., engraving the outline of a thick border). |
| `min_segment_length` | number | `0.0` | Min: 0.0, Max: 100.0, Step: 0.1 | The minimum Euclidean length (in SVG user units) for an individual line segment to be kept. Segments shorter than this are discarded after conversion. Set to 0 to keep all segments. Increase to remove micro-segments that may slow down the plotter without producing visible output. |

### Processing Flow

1. **Parse SVG** — Parse with `xml.etree.ElementTree.fromstring()`. Handle SVG namespace.
2. **Determine coordinate space** — Extract `viewBox`, `width`, `height` from root.
3. **Walk element tree** — Recursively visit all elements, tracking cumulative transform matrices when `flatten_transforms` is enabled.
4. **Visibility filter** — Skip elements with `display:none`, `visibility:hidden`, `opacity=0` unless `include_hidden` is true.
5. **Convert each element type to line segments:**
   - **`<path>`**: Parse `d` attribute. For each sub-path command:
     - `M`/`m`: start a new PathObject.
     - `L`/`l`/`H`/`h`/`V`/`v`: create line segments directly.
     - `C`/`c`/`S`/`s` (cubic Bézier): recursively subdivide until deviation < `curve_tolerance`, output approximating line segments.
     - `Q`/`q`/`T`/`t` (quadratic Bézier): same subdivision approach.
     - `A`/`a` (arc): compute arc centre and angles, subdivide into `arc_segments` line segments.
     - `Z`/`z`: mark PathObject as `closed=true`, add closing segment if needed.
   - **`<line>`**: Single line segment from `(x1,y1)` to `(x2,y2)`.
   - **`<polyline>`**: Sequence of line segments through `points` attribute. `closed=false`.
   - **`<polygon>`**: Like polyline but `closed=true`, with closing segment.
   - **`<rect>`**: Four line segments forming the rectangle. `closed=true`. Handle `rx`/`ry` rounded corners as arc approximations if present.
   - **`<circle>`**: Approximate as regular polygon with `arc_segments` sides. `closed=true`.
   - **`<ellipse>`**: Approximate as polygon with `arc_segments` sides, scaled per `rx`/`ry`. `closed=true`.
   - **`<text>`**: If `include_text` is true, attempt basic outline conversion (character bounding boxes as rectangles, or use Pillow font metrics if feasible). If conversion fails or `include_text` is false, skip.
6. **Apply transforms** — If `flatten_transforms`, apply the cumulative 2D affine matrix to each segment's `from`, `to`, and (for arcs) `center` coordinates.
7. **Stroke to path** — If `stroke_to_path` is true, for elements with a non-zero `stroke-width`, offset the path geometry by ±half stroke width using Shapely's `buffer()` on the linestring, then extract the resulting polygon exterior/interiors as new PathObjects.
8. **Filter by segment length** — Remove any segment whose Euclidean length (`from` to `to`) is less than `min_segment_length`. Remove any PathObject left with zero segments after filtering.
9. **Set meta** — All segments get `"meta": {"width": null, "speed": null}`.
10. **Return** — `{"path": path_list}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| `vector` input missing or not a string | Raise `ValueError("Missing or invalid vector input")` |
| Malformed SVG XML | Raise `ValueError("Failed to parse SVG: {detail}")` |
| A `<path>` `d` attribute has unparseable commands | Skip that path with a warning; continue processing other elements |
| `include_text=true` but text conversion fails for an element | Skip that text element; do not fail the entire process |
| No geometric elements found | Return `{"path": []}` |

### Acceptance Criteria

1. An SVG containing `<rect x="0" y="0" width="100" height="50"/>` produces one closed PathObject with 4 line segments.
2. An SVG containing `<circle cx="50" cy="50" r="25"/>` with `arc_segments=4` produces a closed PathObject with 4 segments.
3. A `<path d="M0,0 C10,20 30,20 40,0"/>` with `curve_tolerance=0.5` produces line segments approximating the cubic curve.
4. Setting `min_segment_length=1000` on small geometry produces an empty PATH list.
5. `include_hidden=true` includes a `<line style="display:none" .../>` in the output.
6. `include_hidden=false` omits it.
7. `flatten_transforms=true` with a `<g transform="translate(10,10)"><line x1="0" y1="0" x2="5" y2="5"/></g>` produces a line from `[10,10]` to `[15,15]`.
8. Output port key is `"path"`.

---

## Plugin 5: Path Filter

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Path Filter"` |
| **Category** | `"Processing"` |
| **File Name** | `path_filter.py` |
| **Class Name** | `PathFilter` |
| **Module Export** | `Plugin = PathFilter` |

### Description

Splits an input PATH array into two outputs — paths that pass a configurable predicate and paths that fail it. Supports multiple filter modes including closed/open classification, minimum segment count, minimum total length, bounding-box area, and arc presence. Enables selective routing of path subsets through different downstream processing branches.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | The set of path objects to evaluate and split. Each PathObject is independently tested against the active filter predicate. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path_pass` | PATH | Path objects that satisfy the active filter condition. (Swapped with `path_fail` when `invert` is enabled.) |
| `path_fail` | PATH | Path objects that do not satisfy the active filter condition. (Swapped with `path_pass` when `invert` is enabled.) |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `filter_mode` | select | `"closed_open"` | Options: `["closed_open", "min_segments", "min_length", "bbox_area", "has_arcs"]` | Selects which predicate function is used to evaluate each path. **closed_open**: classifies based on the path's `closed` flag. **min_segments**: tests whether the path has at least a certain number of segments. **min_length**: tests whether the total segment length meets a threshold. **bbox_area**: tests whether the axis-aligned bounding box area meets a threshold. **has_arcs**: tests whether the path contains any arc-type segments. Only one mode is active at a time. |
| `keep_closed` | boolean | `true` | — | *closed_open mode only.* When `true`, closed paths pass and open paths fail. When `false`, open paths pass and closed paths fail. Ignored in all other modes. Use this to separate filled regions from open strokes, or vice versa. |
| `min_segment_count` | number | `2` | Min: 1, Max: 10000, Step: 1 | *min_segments mode only.* The minimum number of segments a path must contain to pass. Paths with fewer segments are routed to `path_fail`. Useful for filtering out degenerate single-segment paths or isolating complex geometry. Ignored in other modes. |
| `min_total_length` | number | `10.0` | Min: 0.0, Max: 100000.0, Step: 0.1 | *min_length mode only.* The minimum total Euclidean length (sum of all segment lengths) for a path to pass. Computed as the sum of distances from each segment's `from` to `to`. Useful for removing tiny paths that would be invisible when plotted. Ignored in other modes. |
| `min_bbox_area` | number | `100.0` | Min: 0.0, Max: 1000000.0, Step: 1.0 | *bbox_area mode only.* The minimum axis-aligned bounding box area (width × height in coordinate units) for a path to pass. Computed from the extremes of all `from` and `to` points. Useful for filtering out very small shapes. Ignored in other modes. |
| `keep_with_arcs` | boolean | `true` | — | *has_arcs mode only.* When `true`, paths containing at least one arc segment pass and paths with only line segments fail. When `false`, the logic is reversed: line-only paths pass and paths with arcs fail. Useful for separating curved and straight geometry for different tool settings. Ignored in other modes. |
| `invert` | boolean | `false` | — | When enabled, the pass and fail outputs are swapped after evaluation. This applies to all modes and effectively negates the filter condition without changing the mode-specific settings. Use as a quick toggle to reverse the filtering direction. |

### Processing Flow

1. **Receive input** — Extract `path` from `inputs`. If missing or None, treat as empty list.
2. **Initialise output arrays** — `pass_list = []`, `fail_list = []`.
3. **Evaluate each PathObject** — For each path in the input array, apply the predicate based on `filter_mode`:
   - **`closed_open`**: passes if `path["closed"] == keep_closed`.
   - **`min_segments`**: passes if `len(path["segments"]) >= min_segment_count`.
   - **`min_length`**: compute total length as `sum(euclidean_distance(seg["from"], seg["to"]) for seg in path["segments"])`. Passes if total ≥ `min_total_length`.
   - **`bbox_area`**: collect all `from` and `to` x/y values; compute `(max_x - min_x) * (max_y - min_y)`. Passes if area ≥ `min_bbox_area`.
   - **`has_arcs`**: check if any segment has `"type": "arc"`. Passes if `(has_arc_segment == keep_with_arcs)`.
4. **Append** — If predicate is true, append to `pass_list`; otherwise to `fail_list`.
5. **Invert** — If `invert` is `true`, swap: `pass_list, fail_list = fail_list, pass_list`.
6. **Return** — `{"path_pass": pass_list, "path_fail": fail_list}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| `path` input missing or None | Return `{"path_pass": [], "path_fail": []}` |
| PathObject missing `closed` key | Treat as `closed=false` for the closed_open predicate |
| PathObject missing `segments` key | Raise `ValueError("Invalid path object: missing 'segments'")` |
| Path with zero segments | Segment count is 0, total length is 0, bbox area is 0, no arcs — filter accordingly |
| Unknown `filter_mode` value | Raise `ValueError("Unknown filter_mode: {value}")` |

### Acceptance Criteria

1. A list of [closed_path, open_path] with `filter_mode="closed_open"` and `keep_closed=true` produces `path_pass=[closed_path]` and `path_fail=[open_path]`.
2. Setting `keep_closed=false` reverses which path goes to pass vs fail.
3. `filter_mode="min_segments"` with `min_segment_count=3` filters out a 2-segment path to `path_fail`.
4. `filter_mode="min_length"` correctly computes total Euclidean length and filters accordingly.
5. `filter_mode="bbox_area"` correctly filters a tiny 1×1 path when `min_bbox_area=100`.
6. `filter_mode="has_arcs"` with `keep_with_arcs=true` passes a path containing an arc segment.
7. Setting `invert=true` swaps the pass and fail outputs.
8. Empty input produces two empty output arrays, no error.
9. Output port keys are `"path_pass"` and `"path_fail"`.

---

## Plugin 6: Path Splitter

| Field | Value |
|-------|-------|
| **Plugin Name** | `"Path Splitter"` |
| **Category** | `"Processing"` |
| **File Name** | `path_splitter.py` |
| **Class Name** | `PathSplitter` |
| **Module Export** | `Plugin = PathSplitter` |

### Description

Explodes each input path object into multiple single-segment (or small-group) path objects, effectively converting multi-segment paths into an expanded array of minimal paths. Supports configurable group sizing, optional closed-path preservation, and minimum-length filtering. Useful for per-segment analysis, reordering optimisation, or feeding individual strokes into downstream processors.

### Inputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | The set of path objects to split. Each PathObject's segments are broken apart into standalone paths. |

### Outputs

| Port Name | PortType | Description |
|-----------|----------|-------------|
| `path` | PATH | The expanded PATH array where each original segment (or group of segments) is now its own standalone PathObject with `closed=false` (unless preserved). |

### Parameters

| Name | Type | Default | Min / Max / Step / Options | Description |
|------|------|---------|---------------------------|-------------|
| `preserve_closed` | boolean | `false` | — | When enabled, path objects with `closed=true` are passed through intact without splitting. This is useful when closed shapes (e.g., filled polygons or cut contours) must remain as single units, while open paths get split into individual segments. When disabled, all paths are split regardless of their closed status. |
| `inherit_meta` | boolean | `true` | — | When enabled, each new single-segment PathObject inherits the `meta` dictionary from its source segment. When disabled, all new segments receive a default meta of `{"width": null, "speed": null}`. Enable to preserve per-segment metadata (pen width, speed) assigned by upstream plugins. Disable for a clean slate if downstream processing will set its own metadata. |
| `group_size` | number | `1` | Min: 1, Max: 1000, Step: 1 | The number of consecutive segments to keep together in each output PathObject. A value of 1 means true per-segment splitting: each segment becomes its own PathObject. A value of 2 groups every two consecutive segments, and so on. When the last group has fewer segments than `group_size`, it is emitted as-is with however many segments remain. Increase to produce larger chunks, which can be useful for maintaining local stroke continuity. |
| `min_segment_length` | number | `0.0` | Min: 0.0, Max: 100.0, Step: 0.1 | The minimum Euclidean length (distance from `from` to `to`) an individual segment must have to be included in the output. Segments shorter than this are discarded after splitting. Applied per-segment before grouping. Set to 0 to keep all segments. Increase to remove micro-movements or zero-length pen-down/pen-up artefacts. |

### Processing Flow

1. **Receive input** — Extract `path` from `inputs`. If missing or None, treat as empty list.
2. **Initialise output** — `result = []`.
3. **Iterate each source PathObject** — For each path in the input:
   a. **Check preserve_closed** — If `preserve_closed` is `true` and `path["closed"]` is `true`, append the path as-is to `result` and continue to the next path.
   b. **Filter segments by length** — For each segment in `path["segments"]`, compute Euclidean distance from `seg["from"]` to `seg["to"]`. Discard if length < `min_segment_length`.
   c. **Group segments** — Split the surviving segments into consecutive groups of `group_size`. If the final group has fewer than `group_size` segments, include it anyway (do not discard).
   d. **Build new PathObjects** — For each group, create a new PathObject:
      - `"closed": false` (split paths are never closed).
      - `"segments"`: the group's segments. If `inherit_meta` is `true`, keep each segment's existing `meta`. If `false`, replace with `{"width": null, "speed": null}`.
   e. **Append** — Add each new PathObject to `result`.
4. **Return** — `{"path": result}`.

### Error Handling

| Condition | Behaviour |
|-----------|-----------|
| `path` input missing or None | Return `{"path": []}` |
| PathObject missing `segments` key | Raise `ValueError("Invalid path object: missing 'segments'")` |
| `group_size` < 1 | Clamp to 1 silently |
| All segments in a path are shorter than `min_segment_length` | That path contributes zero PathObjects to the output (not an error) |
| Segment missing `meta` key when `inherit_meta=true` | Use default `{"width": null, "speed": null}` for that segment |

### Acceptance Criteria

1. A PathObject with 5 line segments and `group_size=1` produces 5 single-segment PathObjects.
2. A PathObject with 5 segments and `group_size=2` produces 3 PathObjects (2, 2, 1 segments respectively).
3. A closed PathObject with `preserve_closed=true` is passed through unchanged.
4. A closed PathObject with `preserve_closed=false` is split normally.
5. Setting `min_segment_length=50` on a path with only 10-unit segments produces an empty output.
6. `inherit_meta=true` preserves a source segment's `{"width": 0.5, "speed": 100}` in the output.
7. `inherit_meta=false` replaces all meta with `{"width": null, "speed": null}`.
8. All output PathObjects from splitting have `closed=false`.
9. Input port key and output port key are both `"path"`.

---

## Cross-Cutting Concerns

### Dependency Constraints

All plugins must limit imports to:
- `app.plugin_base` (BasePlugin, PluginSchema, PortDefinition, PortType, ParameterDefinition)
- `app.image_utils` (encode_image, decode_image) — for IMAGE-handling plugins
- `cv2` (opencv-python-headless 4.10.0.84)
- `numpy` (1.26.4)
- `shapely` (2.0.6) — only where geometry operations are needed (e.g., stroke_to_path, deduplication)
- `Pillow` (12.1.1) — only if image manipulation beyond cv2 is needed
- Python standard library (xml.etree.ElementTree, base64, re, math, itertools, etc.)

No additional pip dependencies may be introduced.

### Plugin Registration

Each plugin file must be placed in `backend/plugins/` and will be auto-discovered by the DAG engine. The file must end with `Plugin = ClassName`. No changes to `__init__.py` or any registration file should be necessary.

### Performance Expectations

- Plugins should process typical inputs (SVGs under 1MB, images under 4K resolution, PATH arrays under 10,000 objects) in under 5 seconds.
- Avoid unnecessary deep copies of large data structures.
- Use list comprehensions and NumPy vectorised operations where practical.

### Testing Notes

- There is no automated test suite currently. Acceptance criteria should be verifiable via manual API calls or by constructing minimal inputs in a scratch script.
- Developers should ensure each plugin is importable and that `ClassName.schema()` returns a valid `PluginSchema` without errors.
- A basic smoke test: start the API, call `GET /plugins` to confirm the new plugin appears, then execute a minimal DAG that includes the plugin.

The **Edge Detection** node applies a configurable computer-vision algorithm to a raster image input and encodes the resulting boundary contours as PATH geometry. Deploy it as the first processing stage in any pipeline where the source material is a photograph, scan, or raster drawing that must be converted to plottable line-art.

# Edge Detection

The Edge Detection node accepts an image data stream and executes a configurable edge-detection protocol against it. Detected boundaries are traced into contours, filtered, simplified, and injected into the pipeline as PATH objects. Use this module at the start of any pipeline where your source is a photograph, scan, or raster drawing that needs to become plottable line geometry.

**Inputs:** `image` (IMAGE port) → **Outputs:** `path` (PATH port)

## Algorithm Selection

Three detection protocols are authorized for this interface. Select based on your source material and desired output character.

| Algorithm | Character | Use when… | Caution |
|---|---|---|---|
| `canny` | Clean, crisp outlines; hysteresis suppresses weak noise | Default for most images; best starting point | Requires threshold tuning for optimal line density |
| `sobel` | Bold gradients, directionally sensitive | Subject has strong directional edges or bold texture | Tends to include more texture detail — can produce denser paths |
| `laplacian` | Fine all-direction edge response, high sensitivity | You need subtle detail and plan to post-filter noise | Most noise-sensitive; pre-blur becomes critical |

Start with `canny`. Switch only if the output is missing structure you need.

## Parameters

| Parameter | What it controls | Notes |
|---|---|---|
| `algorithm` | Detection protocol to execute | `canny` / `sobel` / `laplacian` |
| `low_threshold` | Lower Canny hysteresis bound *(Canny only)* | Pixels below this are discarded unless connected to strong edges. Lower = more faint lines, more noise |
| `high_threshold` | Upper Canny bound for strong edges *(Canny only)* | Pixels above this are immediately classified as edges. Must exceed `low_threshold` |
| `kernel_size` | Derivative pixel neighborhood *(Sobel / Laplacian only)* | Larger kernel = smoother response but softer fine detail (`1`, `3`, `5`, `7`) |
| `blur_kernel_size` | Gaussian pre-blur strength (odd, 1–31) | Higher values suppress grain before detection; very high values can erase thin features |
| `simplification_tolerance` | Douglas-Peucker contour simplification (0–10) | `0` keeps all points; increase to reduce segment count and file weight |
| `min_contour_length` | Minimum perimeter (px) to keep a contour (0–1000) | Raise to filter out noise artifacts and tiny stray marks |
| `invert` | Swap black/white before contour extraction | Enable when subject and background contrast is reversed from expected |
| `grayscale` | Apply grayscale preprocessing | Recommended on; keeps the detection channel consistent |

## Tips

1. **Start conservative:** `algorithm = canny`, `blur_kernel_size = 5`, `low_threshold = 50`, `high_threshold = 150`. Tune from there.
2. **Too many tiny strokes?** Increase `min_contour_length` first, then raise `blur_kernel_size`. These are the two fastest ways to reduce output noise.
3. **Missing lines?** Lower Canny thresholds before touching the blur. Aggressive blur is a common cause of lost thin features.
4. **Paths too dense for the plotter?** Raise `simplification_tolerance` gradually — even a value of `1.0` to `2.0` can cut segment count significantly without visible shape loss.
5. **White subject on black background?** Toggle `invert` — it flips which regions become contours and can recover edges the standard pass misses.

## Limitations

- Output is contour-based line geometry only. The node does not fit arcs, splines, or smooth curves — all edges are approximated as connected line segments.
- Photographic textures and gradients generate dense contour data with all algorithms, especially at low blur and low thresholds.
- Output quality is directly dependent on source image contrast and resolution. Low-contrast or low-resolution inputs produce unreliable edge maps.
- Simplification and filtering are applied after detection; they cannot recover edges that were lost during the blur or thresholding stage.

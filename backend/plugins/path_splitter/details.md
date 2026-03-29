The **Path Splitter** node decomposes incoming multi-segment paths into smaller, standalone PATH objects and emits each unit independently into the pipeline. Use this node to isolate individual strokes, remove sub-threshold micro-fragments, or prepare geometry for per-stroke processing stages such as variable-speed control.

# Path Splitter

This node partitions incoming path data into smaller, independently processable units. Each path is decomposed into groups of consecutive segments and emitted as new path objects downstream. Essential for per-stroke operations, fragment pruning, or preparing geometry for individual speed control.

**Pipeline position:** `path` in → `path` out (PATH port on both ends).

## How It Works

1. Each incoming path object is read from the `path` input stream.
2. If `preserve_closed=true` and a path is flagged `closed=true` — route it through unchanged.
3. Segments shorter than `min_segment_length` are filtered out before grouping.
4. Surviving segments are partitioned into groups of `group_size` and emitted as new path objects.
5. Metadata (`width`, `speed`) is either carried forward or reset per `inherit_meta`.

## Parameters

- **`preserve_closed`** (boolean, default `false`) — Pass closed paths (rectangles, circles, etc.) through the node intact, bypassing the split protocol entirely. Open paths are still processed normally.

- **`inherit_meta`** (boolean, default `true`) — When enabled, each output segment inherits its original `meta` values (pen width, speed). Disable to reset all meta to `width=null, speed=null`, allowing downstream nodes to assign fresh values.

- **`group_size`** (integer 1–1000, default `1`) — Number of consecutive segments packed into each output path. `1` = one path per segment. `2` = pairs. If the total segment count doesn't divide evenly, the final group contains the remainder.

- **`min_segment_length`** (number 0.0–100.0, step 0.1, default `0.0`) — Segments with a straight-line `from→to` distance below this threshold are discarded before grouping. Set to `0.0` to execute no filtering.

## Typical Workflows

- **Per-stroke speed control:** `group_size=1`, `inherit_meta=true` — each segment becomes its own path, ready for individual speed assignment downstream.
- **Artifact removal:** `min_segment_length=1.0` — purges micro-fragments before the data stream reaches the plotter interface.
- **Selective splitting:** `preserve_closed=true`, `group_size=2` — closed shapes pass through intact while open polylines are split into pairs.

## Tips

- Start at `group_size=1` to map exactly how your geometry fragments before increasing the value.
- If shapes break unexpectedly, enable `preserve_closed` and verify which paths carry the `closed=true` flag.
- Step up `min_segment_length` incrementally (try 0.5, then 1.0) — aggressive thresholds can silently discard useful detail.
- If pen width or speed disappears downstream, confirm `inherit_meta=true` is active on this node.

## Limitations

- All split outputs are emitted as open paths (`closed=false`). Only closed paths kept intact via `preserve_closed` retain their closed flag.
- Segment length is calculated as straight-line distance (`from` → `to`) — curve geometry is not factored in.
- A path whose every segment falls below `min_segment_length` contributes zero output to the pipeline.

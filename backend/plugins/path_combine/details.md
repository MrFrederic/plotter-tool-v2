The **Path Combine** node merges two independent PATH input streams into a single unified output, with configurable merge ordering and optional elimination of duplicate geometry. Insert it at any convergence point in a branched DAG pipeline to rejoin parallel processing channels before downstream stages.

# Path Combine

A convergence node for your pipeline. When your DAG branches into parallel processing channels, Path Combine rejoins them — merging PATH arrays A and B into a single sequenced output stream, ready for downstream processing or G-code conversion.

## Merge Modes

Controlled by `merge_order`. Three routing protocols:

- **`a_then_b`** — All A paths first, then all B paths.
  - `A=[A1,A2,A3]` + `B=[B1,B2]` → `[A1,A2,A3,B1,B2]`
- **`b_then_a`** — All B paths first, then all A paths.
  - `A=[A1,A2,A3]` + `B=[B1,B2]` → `[B1,B2,A1,A2,A3]`
- **`interleave`** — Alternates A and B until one side is exhausted; appends leftovers.
  - `A=[A1,A2,A3]` + `B=[B1,B2,B3,B4,B5]` → `[A1,B1,A2,B2,A3,B3,B4,B5]`

## Duplicate Removal

When `remove_duplicates` is enabled, the node scrubs geometrically identical paths from the merged output — same points, same segment order. Only the first occurrence is retained. Prevents your machine from retracing lines it already plotted.

`duplicate_tolerance` sets the endpoint distance threshold for matching. Lower values require a tighter match; raise it if obvious duplicates survive the filter.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `merge_order` | select | `a_then_b` | Output sequence protocol: `a_then_b`, `b_then_a`, or `interleave`. |
| `remove_duplicates` | boolean | `false` | Purge geometrically identical paths after merge. |
| `duplicate_tolerance` | number (0.0–10.0) | `0.01` | Endpoint proximity threshold for duplicate detection. Visible when `remove_duplicates` is on. |

## Tips

- Use `a_then_b` as your default — predictable, easy to trace in the output sequence.
- `interleave` is useful when you want contributions from both channels distributed evenly across the plot.
- Leave `remove_duplicates` off unless you know both branches may produce overlapping geometry.
- If duplicates persist, raise `duplicate_tolerance` in small increments (`0.01` → `0.02`).

## Limitations

- Duplicate detection requires identical segment count and identical segment order — partial matches are ignored.
- Reversed paths are not flagged as duplicates.
- Geometrically equivalent paths with reordered segments pass through undetected.

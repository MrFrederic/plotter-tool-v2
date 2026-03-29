Every pipeline must begin with a **Pipeline Input** node. It loads an uploaded file from the secure cache directory, verifies the path is within the allowed zone, and dispatches the payload to the appropriate output port based on the declared file category.

# Pipeline Input

**Pipeline Input** is the authorized entry point for all data streams entering the pipeline. It loads an uploaded file from the secure cache directory, verifies the path is within the allowed zone, and routes the payload to exactly one output channel based on the declared `file_category`. No pipeline runs without it.

## Output Channels

| Port | Type | Activates when |
|------|------|----------------|
| `image` | IMAGE | `file_category` = `image` — loads PNG/JPG via OpenCV |
| `vector` | VECTOR | `file_category` = `vector` — reads SVG as XML text |
| `gcode` | GCODE | `file_category` = `gcode` — reads G-code, right-trims each line |
| `path` | PATH | `file_category` = `path` — loads and normalizes JSON path data |
| `text` | TEXT | `file_category` = `text` — reads plain UTF-8 text |
| `other` | OTHER | `file_category` = `other` or any unknown value — JSON or raw text fallback |

Only one output port carries data per run.

## Parameters

- **`file_path`** — Server-side path to the uploaded file. Must be non-empty, must exist, and must resolve inside the authorized cache upload directory. Set automatically by the upload flow — do not edit manually. Invalid paths cause immediate failure.

- **`file_category`** — Selects the loader and output channel. Known values: `image`, `vector`, `gcode`, `path`, `text`, `other`. Any unrecognized value routes to the `other` port.

## Tips

- Upload your file first — `file_path` and `file_category` are populated automatically by the upload flow.
- Connect only the output branch matching your file type; leaving other branches disconnected keeps the graph readable.
- If the pipeline fails at the first node, check `file_path` — a missing file or a path outside the cache directory is the most common cause.
- For `path` files, both the modern segment-based format and legacy `[x, y]` point lists are accepted; the node normalizes them transparently.

## Limitations

- Does not convert file types — it only loads and routes. Pre-convert files to the target format before injecting them into the pipeline.
- SVG validation is shallow: content is checked for XML-like structure, not full SVG compliance.
- The `other` channel is best-effort: valid JSON is parsed, everything else is returned as decoded text.

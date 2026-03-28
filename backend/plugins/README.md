# Plugin Development Guide

This directory contains all processing plugins for the Plotter-Tool pipeline engine. Plugins are automatically discovered at startup — create a folder for each plugin, add a `plugin.py` file inside it, and restart the server.

## Plugin Interface

Every plugin must:

1. **Extend `BasePlugin`** from `app.plugin_base`
2. **Implement `schema()` classmethod** — returns a `PluginSchema` describing inputs, outputs, and parameters
3. **Implement `process()` async method** — performs the actual computation
4. **Expose a module-level `Plugin` variable** — points to the plugin class for auto-discovery

```python
from typing import Any
from app.plugin_base import (
    BasePlugin, PluginSchema, PortDefinition, ParameterDefinition, PortType,
)

class MyPlugin(BasePlugin):
    @classmethod
    def schema(cls) -> PluginSchema:
        return PluginSchema(
            name="MyPlugin",
            category="Processing",
            description="Short description of what this plugin does.",
            inputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Input image"),
            ],
            outputs=[
                PortDefinition(name="image", type=PortType.IMAGE, description="Output image"),
            ],
            parameters=[
                ParameterDefinition(
                    name="strength",
                    type="number",
                    default=50,
                    min=0,
                    max=100,
                    step=1,
                    description="Processing strength",
                ),
            ],
        )

    async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        image_data = inputs.get("image")
        strength = params.get("strength", 50)
        # ... do processing ...
        return {"image": result_data}

Plugin = MyPlugin
```

## Data Type Conventions

Each `PortType` has a standard internal representation used between plugins:

| Type | Enum | Internal Format | Description |
|------|------|----------------|-------------|
| Image | `PortType.IMAGE` | Base64-encoded PNG string | Raster image encoded via `app.image_utils.encode_image()` |
| Vector | `PortType.VECTOR` | SVG XML string (UTF-8) | Complete SVG document as a text string |
| G-code | `PortType.GCODE` | Plain text string | G-code instructions with `\n` line endings |
| Path | `PortType.PATH` | `list[PathObject]` | List of path objects; each has `closed: bool` and `segments: list[Segment]`. A **line segment** carries `type`, `from`, `to`, and `meta` (`width`, `speed`). An **arc segment** additionally carries `center` and `clockwise`. Both `meta` fields default to `null` when omitted. Old `list[list[list[float]]]` inputs are automatically up-converted to straight line segments with `null` metadata. |
| Text | `PortType.TEXT` | Plain text string | Arbitrary text content |
| Other | `PortType.OTHER` | Any | Unconstrained data for custom workflows |

## Parameter Types

| Type | UI Control | Extra Fields |
|------|-----------|-------------|
| `"number"` | Slider / input | `min`, `max`, `step` |
| `"string"` | Text input | — |
| `"boolean"` | Toggle | — |
| `"select"` | Dropdown | `options: list[str]` |
| `"color"` | Color picker | — |

## Plugin Categories

### Pipeline Input (Start Node)

The `Pipeline Input` plugin (`pipeline_input.py`) is a special built-in plugin that backs the **Start node** in the UI. It consolidates all file normalization logic into a single entry point. Users do not interact with it directly — the frontend configures it automatically when a file is uploaded.

- Has **no input ports** (source node in the DAG)
- Has `file_path` and `file_category` parameters set automatically by the upload flow
- **Validates** that the resolved file path is within `CACHE_DIR` (path traversal protection)
- Dispatches to category-specific normalization based on `file_category`

| Category | Output Port | Normalization |
|----------|------------|---------------|
| `image` | image | Loads any image format via cv2, encodes to base64 PNG |
| `vector` | vector | Reads SVG file as UTF-8 text, validates XML structure |
| `gcode` | gcode | Reads text file, strips trailing whitespace per line, normalizes to `\n` |
| `path` | path | Reads JSON, validates and normalises to segment-based path format; backward-compatible with old `list[list[list[float]]]` point-list input |
| `text` | text | Reads file as UTF-8 text |
| `other` | other | Attempts JSON parse, falls back to UTF-8 decoded string |

> **Note:** The five separate input plugins (`ImageInput`, `VectorInput`, `GCodeInput`, `PathInput`, `TextInput`) have been removed. Their normalization logic now lives inside `Pipeline Input`.

### Passthrough (Testing) Plugins

Passthrough plugins accept one input port and forward the data unchanged to one output port. They are useful for:

- **Testing** pipeline connectivity and data flow
- **Debugging** by inserting a passthrough node to inspect intermediate data
- **Validating** that the DAG engine handles each data type correctly

Each passthrough plugin has no parameters and a trivial `process()` that returns its input directly.

| Plugin | Data Type |
|--------|----------|
| `ImagePassthrough` | IMAGE |
| `VectorPassthrough` | VECTOR |
| `GCodePassthrough` | GCODE |
| `PathPassthrough` | PATH |
| `TextPassthrough` | TEXT |
| `OtherPassthrough` | OTHER |

## Step-by-Step: Creating a New Plugin

### 1. Create the plugin folder and file

Create `backend/plugins/my_plugin/plugin.py`.

### 2. Define the schema

The schema tells the frontend what UI to render and the engine what connections are valid:

```python
@classmethod
def schema(cls) -> PluginSchema:
    return PluginSchema(
        name="Brightness",          # Unique name (shown in UI)
        category="Processing",       # Groups in sidebar: Flow, Processing, Output, Testing
        description="Adjust image brightness.",
        inputs=[
            PortDefinition(name="image", type=PortType.IMAGE),
        ],
        outputs=[
            PortDefinition(name="image", type=PortType.IMAGE),
        ],
        parameters=[
            ParameterDefinition(name="factor", type="number", default=1.0, min=0.0, max=3.0, step=0.1),
        ],
    )
```

### 3. Implement processing

```python
async def process(self, inputs: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    from app.image_utils import decode_image, encode_image
    import numpy as np

    raw = inputs["image"]
    img = decode_image(raw)
    factor = float(params.get("factor", 1.0))

    result = np.clip(img.astype(np.float32) * factor, 0, 255).astype(np.uint8)
    return {"image": encode_image(result)}
```

### 4. Export the class

```python
Plugin = Brightness
```

### 5. Restart the server

The plugin loader scans this directory on startup. Your plugin will appear in the frontend sidebar.

## Caching

You don't need to manage caching yourself. The DAG engine automatically:

1. Computes a SHA256 hash from `plugin_name + input_hashes + parameters`
2. Checks if the result already exists in `/cache`
3. Skips execution if a cache hit is found
4. Stores new results automatically after execution

If you need to override the hash computation (e.g., for plugins with external side effects), override the `compute_hash` classmethod:

```python
@classmethod
def compute_hash(cls, inputs_hash: dict[str, str], params: dict[str, Any]) -> str:
    # Custom hash logic
    ...
```

## Existing Plugins

| Plugin | Category | Input | Output | Description |
|--------|----------|-------|--------|-------------|
| `Pipeline Input` | Flow | — | image, vector, gcode, path, text, other | Start node — reads uploaded file and normalizes by category |
| `ImagePassthrough` | Testing | image | image | Pass image data through |
| `VectorPassthrough` | Testing | vector | vector | Pass vector data through |
| `GCodePassthrough` | Testing | gcode | gcode | Pass G-code data through |
| `PathPassthrough` | Testing | paths | paths | Pass path data through |
| `TextPassthrough` | Testing | text | text | Pass text data through |
| `OtherPassthrough` | Testing | data | data | Pass arbitrary data through |

## Testing Plugins

```python
import asyncio
from plugins.passthrough_image import Plugin

async def test():
    p = Plugin()
    result = await p.process(
        inputs={"image": "iVBORw0KGgo..."},
        params={},
    )
    print(result)

asyncio.run(test())
```

# Plugin Development Guide

This directory contains all processing plugins for the Plotter-Tool pipeline engine. Plugins are automatically discovered at startup — just drop a Python file here and restart the server.

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

## Port Types

| Type | Enum | Description |
|------|------|-------------|
| Image | `PortType.IMAGE` | Pixel data (2D/3D array from OpenCV) |
| Path | `PortType.PATH` | Vector paths — list of point lists `[[[x,y], ...], ...]` |
| Text | `PortType.TEXT` | Plain text string |
| G-code | `PortType.GCODE` | G-code string |
| Any | `PortType.ANY` | Accepts any type |

## Parameter Types

| Type | UI Control | Extra Fields |
|------|-----------|-------------|
| `"number"` | Slider / input | `min`, `max`, `step` |
| `"string"` | Text input | — |
| `"boolean"` | Toggle | — |
| `"select"` | Dropdown | `options: list[str]` |
| `"color"` | Color picker | — |

## Step-by-Step: Creating a New Plugin

### 1. Create the file

Create `backend/plugins/my_plugin.py`.

### 2. Define the schema

The schema tells the frontend what UI to render and the engine what connections are valid:

```python
@classmethod
def schema(cls) -> PluginSchema:
    return PluginSchema(
        name="Brightness",          # Unique name (shown in UI)
        category="Processing",       # Groups in sidebar: Input, Processing, Output
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
    import numpy as np

    raw = inputs["image"]
    img = np.array(raw, dtype=np.uint8)
    factor = float(params.get("factor", 1.0))

    result = np.clip(img.astype(np.float32) * factor, 0, 255).astype(np.uint8)
    return {"image": result.tolist()}
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
| `ImageInput` | Input | — | image | Load image from file path |
| `Threshold` | Processing | image | image | Binary thresholding |
| `EdgeDetection` | Processing | image | image | Canny edge detection |
| `ContourTrace` | Processing | image | paths | Extract contour paths |
| `GCodeOutput` | Output | paths | gcode | Convert paths to G-code |

## Testing Plugins

```python
import asyncio
from plugins.my_plugin import Plugin

async def test():
    p = Plugin()
    result = await p.process(
        inputs={"image": [[0, 128, 255], [64, 192, 32]]},
        params={"factor": 1.5},
    )
    print(result)

asyncio.run(test())
```

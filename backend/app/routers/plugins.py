from typing import Any

from fastapi import APIRouter, HTTPException

from app.plugin_base import BasePlugin, PluginSchema

router = APIRouter(prefix="/plugins", tags=["plugins"])

# In-memory plugin registry populated at startup by plugin discovery.
_plugin_registry: dict[str, dict[str, Any]] = {}
_plugin_classes: dict[str, type[BasePlugin]] = {}


def register_plugins(
    plugins: dict[str, dict[str, Any]],
    classes: dict[str, type[BasePlugin]] | None = None,
) -> None:
    """Called during application startup to populate the registry.

    *plugins* maps schema-name → raw dict (legacy path).
    *classes* maps schema-name → BasePlugin subclass.
    """
    _plugin_registry.update(plugins)
    if classes:
        _plugin_classes.update(classes)


def get_plugin_classes() -> dict[str, type[BasePlugin]]:
    """Return the mapping of plugin name → BasePlugin class."""
    return dict(_plugin_classes)


@router.get("/")
async def list_plugins() -> list[dict[str, Any]]:
    """Return all available plugins with their schemas."""
    results: list[dict[str, Any]] = []

    # Serve from class registry first (authoritative)
    for name, cls in _plugin_classes.items():
        results.append(cls.schema().model_dump())

    # Fall back to raw-dict entries not already covered
    seen = {r["name"] for r in results}
    for name, schema in _plugin_registry.items():
        if name not in seen:
            results.append({"name": name, **schema})

    return results


@router.get("/{plugin_name}")
async def get_plugin(plugin_name: str) -> dict[str, Any]:
    """Return the schema for a specific plugin."""
    if plugin_name in _plugin_classes:
        return _plugin_classes[plugin_name].schema().model_dump()
    if plugin_name in _plugin_registry:
        return {"name": plugin_name, **_plugin_registry[plugin_name]}
    raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")

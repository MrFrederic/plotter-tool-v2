from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/plugins", tags=["plugins"])

# In-memory plugin registry populated at startup by plugin discovery.
_plugin_registry: dict[str, dict[str, Any]] = {}


def register_plugins(plugins: dict[str, dict[str, Any]]) -> None:
    """Called during application startup to populate the registry."""
    _plugin_registry.update(plugins)


@router.get("/")
async def list_plugins() -> list[dict[str, Any]]:
    """Return all available plugins with their schemas."""
    return [
        {"name": name, **schema} for name, schema in _plugin_registry.items()
    ]


@router.get("/{plugin_name}")
async def get_plugin(plugin_name: str) -> dict[str, Any]:
    """Return the schema for a specific plugin."""
    if plugin_name not in _plugin_registry:
        raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")
    return {"name": plugin_name, **_plugin_registry[plugin_name]}

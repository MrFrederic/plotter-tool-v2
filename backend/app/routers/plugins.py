import logging
import mimetypes
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.plugin_base import BasePlugin, PluginSchema

router = APIRouter(prefix="/plugins", tags=["plugins"])
logger = logging.getLogger(__name__)

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


def _get_plugin_class(plugin_name: str) -> type[BasePlugin]:
    plugin_class = _plugin_classes.get(plugin_name)
    if plugin_class is None:
        raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")
    return plugin_class


def _get_plugin_root(plugin_class: type[BasePlugin]) -> Path:
    module_file = getattr(__import__(plugin_class.__module__, fromlist=["__file__"]), "__file__", None)
    if not module_file:
        raise HTTPException(
            status_code=500,
            detail=f"Plugin '{plugin_class.schema().name}' does not expose a filesystem path",
        )
    return Path(module_file).resolve().parent


def _resolve_plugin_path(plugin_class: type[BasePlugin], relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute():
        raise HTTPException(status_code=400, detail="Plugin asset paths must be relative")

    plugin_root = _get_plugin_root(plugin_class)
    resolved = (plugin_root / candidate).resolve()
    if not resolved.is_relative_to(plugin_root):
        raise HTTPException(status_code=400, detail="Plugin asset path escapes the plugin directory")

    return resolved


def _resolve_description(plugin_class: type[BasePlugin], schema: PluginSchema) -> str:
    description = schema.description.strip()
    if not description.startswith("file:"):
        return schema.description

    relative_path = description.removeprefix("file:").strip()
    if not relative_path:
        logger.warning("Plugin '%s' has an empty file reference in description", schema.name)
        return ""

    if not relative_path.lower().endswith(".md"):
        logger.warning(
            "Plugin '%s' description file is not markdown: %s",
            schema.name,
            relative_path,
        )
        return ""

    try:
        description_path = _resolve_plugin_path(plugin_class, relative_path)
        if not description_path.is_file():
            logger.warning(
                "Plugin '%s' markdown description file was not found: %s",
                schema.name,
                description_path,
            )
            return ""
        return description_path.read_text(encoding="utf-8")
    except HTTPException:
        raise
    except Exception:
        logger.warning(
            "Failed to load markdown description for plugin '%s'",
            schema.name,
            exc_info=True,
        )
        return ""


def _serialize_plugin_schema(plugin_name: str, plugin_class: type[BasePlugin]) -> dict[str, Any]:
    schema = plugin_class.schema().model_copy(deep=True)
    payload = schema.model_dump()
    payload["description"] = _resolve_description(plugin_class, schema)
    return payload


@router.get("/")
async def list_plugins() -> list[dict[str, Any]]:
    """Return all available plugins with their schemas."""
    results: list[dict[str, Any]] = []

    # Serve from class registry first (authoritative)
    for name, cls in _plugin_classes.items():
        results.append(_serialize_plugin_schema(name, cls))

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
        return _serialize_plugin_schema(plugin_name, _plugin_classes[plugin_name])
    if plugin_name in _plugin_registry:
        return {"name": plugin_name, **_plugin_registry[plugin_name]}
    raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")


@router.get("/{plugin_name}/assets/{asset_path:path}")
async def get_plugin_asset(plugin_name: str, asset_path: str) -> FileResponse:
    """Serve a plugin-local static asset such as a markdown image."""
    plugin_class = _get_plugin_class(plugin_name)
    resolved = _resolve_plugin_path(plugin_class, asset_path)

    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"Plugin asset '{asset_path}' not found")

    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(
        path=resolved,
        filename=resolved.name,
        media_type=media_type or "application/octet-stream",
    )

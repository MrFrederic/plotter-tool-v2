---
applyTo: "backend/**/*.py"
---

# Backend path-specific instructions

## Contracts and architecture
- Keep plugin contracts stable in `backend/plugins/` and `backend/app/plugin_base.py` (`schema()`, `process()`, module-level `Plugin = ClassName`).
- Preserve API shapes used by the frontend unless the task explicitly requires contract changes.
- Keep changes minimal and focused in the appropriate router/engine/module.

## Async and execution behavior
- Maintain async behavior in FastAPI routes and DB access.
- Avoid introducing blocking operations in request paths and WebSocket flows.
- Respect DAG execution semantics and cache behavior (`CACHE_DIR`, content-addressed artifacts).

## Validation
- For backend-only changes, validate by running the API locally or with Docker Compose.
- For API contract changes, verify corresponding frontend usage.
- Prefer targeted validation first, then compose-level smoke checks when behavior crosses layers.

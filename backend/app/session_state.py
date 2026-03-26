"""In-memory pipeline and file state per client session."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# session_id → { "nodes": [...], "edges": [...] }
_session_pipelines: dict[str, dict[str, Any]] = {}

# session_id → { "file_path": str, "file_category": str }
_session_files: dict[str, dict[str, str]] = {}

# session_id → True if execution should be re-triggered after current run
_pending_rerun: dict[str, bool] = {}

# session_id → True if execution is currently running
_running: dict[str, bool] = {}


def store_pipeline(session_id: str, pipeline_data: dict[str, Any]) -> None:
    """Store the latest pipeline state for a session."""
    _session_pipelines[session_id] = pipeline_data


def get_pipeline(session_id: str) -> dict[str, Any] | None:
    """Retrieve the stored pipeline state for a session."""
    return _session_pipelines.get(session_id)


def store_file_info(session_id: str, file_path: str, file_category: str) -> None:
    """Record that a file has been uploaded for this session."""
    _session_files[session_id] = {
        "file_path": file_path,
        "file_category": file_category,
    }


def get_file_info(session_id: str) -> dict[str, str] | None:
    """Retrieve uploaded file info for a session."""
    return _session_files.get(session_id)


def clear_session(session_id: str) -> None:
    """Remove all in-memory state for a session."""
    _session_pipelines.pop(session_id, None)
    _session_files.pop(session_id, None)
    _pending_rerun.pop(session_id, None)
    _running.pop(session_id, None)


def is_running(session_id: str) -> bool:
    return _running.get(session_id, False)


def set_running(session_id: str, running: bool) -> None:
    _running[session_id] = running


def request_rerun(session_id: str) -> None:
    _pending_rerun[session_id] = True


def consume_rerun(session_id: str) -> bool:
    return _pending_rerun.pop(session_id, False)


def get_all_session_ids() -> list[str]:
    """Return all known session IDs."""
    ids = (
        set(_session_pipelines.keys())
        | set(_session_files.keys())
        | set(_pending_rerun.keys())
        | set(_running.keys())
    )
    return list(ids)

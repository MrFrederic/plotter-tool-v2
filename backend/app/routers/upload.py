"""File upload router for storing user files in the cache directory."""
import asyncio
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, select

from app.cache import get_shared_cache
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["upload"])

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

_EXT_TO_DATA_TYPE: dict[str, str] = {}
for _ext in ("png", "jpg", "jpeg", "bmp", "tiff", "tif", "webp", "gif"):
    _EXT_TO_DATA_TYPE[_ext] = "IMAGE"
for _ext in ("svg", "dxf", "ai", "eps"):
    _EXT_TO_DATA_TYPE[_ext] = "VECTOR"
for _ext in ("gcode", "nc", "ngc", "tap", "cnc"):
    _EXT_TO_DATA_TYPE[_ext] = "GCODE"
for _ext in ("txt", "md", "log", "csv", "tsv", "xml", "json", "yaml", "yml"):
    _EXT_TO_DATA_TYPE[_ext] = "TEXT"


def _classify_extension(ext: str) -> str:
    """Return a data-type label for a file extension."""
    return _EXT_TO_DATA_TYPE.get(ext.lstrip(".").lower(), "OTHER")


@router.post("/")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(""),
) -> dict:
    """Accept an uploaded file, store it with a unique name, and return metadata."""
    uploads_dir = Path(settings.CACHE_DIR) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    original_name = file.filename or "upload"
    ext = Path(original_name).suffix
    unique_name = f"{uuid4()}{ext}"
    dest = uploads_dir / unique_name

    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=413, detail="File exceeds maximum upload size of 50 MB"
            )
        await asyncio.to_thread(dest.write_bytes, content)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}") from exc

    # Register in DB if session_id provided
    if session_id:
        try:
            from app.database import async_session
            from app.models import CachedFile

            data_type = _classify_extension(ext)

            async with async_session() as db:
                cached = CachedFile(
                    client_id=session_id,
                    node_id="__start__",
                    output_name="upload",
                    cache_hash=unique_name.removesuffix(ext) if ext else unique_name,
                    file_path=str(dest),
                    data_type=data_type,
                    is_upload=True,
                )
                db.add(cached)
                await db.commit()
        except Exception:
            logger.debug(
                "Failed to register upload in DB (session=%s, file=%s)",
                session_id,
                original_name,
                exc_info=True,
            )

    return {
        "filename": original_name,
        "path": str(dest),
        "size": len(content),
    }


@router.delete("/session/{session_id}")
async def clear_session_upload_cache(session_id: str) -> dict[str, int | str]:
    """Remove cached execution results and uploaded files for a session."""
    from app.database import async_session
    from app.models import CachedFile
    from app.routers.execution import _engines, _execution_status

    cache = get_shared_cache()
    cache_dir = Path(settings.CACHE_DIR).resolve()

    run_ids = [
        run_id
        for run_id, status in list(_execution_status.items())
        if status.get("session_id") == session_id
    ]
    result_hashes: set[str] = set()

    for run_id in run_ids:
        engine = _engines.pop(run_id, None)
        _execution_status.pop(run_id, None)
        if engine is None:
            continue
        for node in engine.nodes.values():
            if node.result_hash:
                result_hashes.add(node.result_hash)

    removed_result_files = 0
    for hash_key in result_hashes:
        if await cache.delete(hash_key, extension=".json"):
            removed_result_files += 1

    upload_paths: set[Path] = set()
    db_rows_removed = 0
    try:
        async with async_session() as db:
            result = await db.execute(
                select(CachedFile).where(CachedFile.client_id == session_id)
            )
            cached_files = list(result.scalars().all())
            db_rows_removed = len(cached_files)
            for cached_file in cached_files:
                try:
                    resolved = Path(cached_file.file_path).resolve()
                except Exception:
                    logger.debug(
                        "Skipping unresolved cached path during session cleanup",
                        exc_info=True,
                    )
                    continue
                if resolved.is_relative_to(cache_dir):
                    upload_paths.add(resolved)

            await db.execute(delete(CachedFile).where(CachedFile.client_id == session_id))
            await db.commit()
    except Exception:
        logger.debug(
            "Failed to remove DB-tracked cache rows for session %s",
            session_id,
            exc_info=True,
        )

    removed_upload_files = 0
    for path in upload_paths:
        try:
            if path.exists() and path.is_file():
                await asyncio.to_thread(path.unlink)
                removed_upload_files += 1
        except Exception:
            logger.debug("Failed to delete cached upload file %s", path, exc_info=True)

    return {
        "session_id": session_id,
        "removed_runs": len(run_ids),
        "removed_result_files": removed_result_files,
        "removed_upload_files": removed_upload_files,
        "removed_db_rows": db_rows_removed,
    }
